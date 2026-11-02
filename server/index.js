import http from 'node:http';
import { isIP } from 'node:net';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { openDatabase, settings } from './db.js';
import { hashToken, randomToken, initializeAdmin, verifyPassword, rateLimit } from './auth.js';
import { queueBookingEmail, createMailer } from './email.js';
import { createReservationPdf } from './ticket.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(existsSync(join(root,'.env'))) process.loadEnvFile(join(root,'.env'));
export function clubToday(offset=0) {
  const date=new Date(Date.now()+offset*86400000);
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function validDate(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value && value>=clubToday() && value<=clubToday(90);
}
function fail(status,message) {throw Object.assign(new Error(message),{status});}
function safeText(value,max) {return typeof value==='string' && value.trim().length>0 && value.trim().length<=max && !/[\x00-\x1f<>]/.test(value);}
const emailValid=value=>typeof value==='string' && value.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

export function createApp(options={}) {
  const production=options.production??process.env.NODE_ENV==='production';
  const dataDir=resolve(options.dataDir??process.env.DATA_DIR??join(root,'data'));
  const siteUrl=options.siteUrl??process.env.SITE_URL??'http://localhost:3000';
  const adminPassword=options.adminPassword??process.env.ADMIN_PASSWORD;
  const demo=options.demo??process.env.DEMO_MODE!=='false';
  if(production && (!siteUrl.startsWith('https://') || !adminPassword || demo)) throw new Error('Production requires HTTPS SITE_URL, ADMIN_PASSWORD, and DEMO_MODE=false.');
  const canonical=new URL(siteUrl);
  const trustedProxyHops=Number(options.trustedProxyHops??process.env.TRUST_PROXY_HOPS??0);
  if(!Number.isInteger(trustedProxyHops)||trustedProxyHops<0||trustedProxyHops>5) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  const db=openDatabase(dataDir);
  initializeAdmin(db,dataDir,adminPassword,production);
  const mailConfig={resendKey:options.resendKey??process.env.RESEND_API_KEY,mailFrom:options.mailFrom??process.env.MAIL_FROM};
  const adminEmail=options.adminEmail??process.env.ADMIN_EMAIL;
  const flushEmails=createMailer(db,mailConfig);
  const interval=setInterval(flushEmails,30000); interval.unref();
  const publicDir=join(root,'public');
  function json(res,status,data) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data));}
  function availability(date) {
    const taken=new Set(db.prepare("SELECT table_id FROM bookings WHERE date=? AND status='confirmed'").all(date).map(x=>x.table_id));
    const holds=new Map(db.prepare('SELECT table_id,blocked FROM holds WHERE date=?').all(date).map(x=>[x.table_id,x.blocked]));
    return db.prepare('SELECT * FROM tables').all().map(t=>({...t,available:!taken.has(t.id) && !(holds.has(t.id)?holds.get(t.id):demo&&['T18','V4'].includes(t.id))}));
  }
  function session(req) {
    const cookie=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('slomo_session='));
    if(!cookie) return null;
    return db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(hashToken(cookie.slice(14)),Date.now());
  }
  function requireAdmin(req,mutating=false) {
    const auth=session(req);
    if(!auth) fail(401,'Please sign in to continue.');
    if(mutating && req.headers['x-csrf-token']!==auth.csrf) fail(403,'Session verification failed. Refresh and try again.');
    return auth;
  }
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'Send requests as application/json.');
    let size=0; const chunks=[];
    for await(const chunk of req) {size+=chunk.length; if(size>20000) fail(413,'Request is too large.'); chunks.push(chunk);}
    try {
      const parsed=JSON.parse(Buffer.concat(chunks).toString());
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) fail(400,'Send a JSON object.');
      return parsed;
    } catch {fail(400,'Invalid JSON object.');}
  }
  function publicBooking(row) {
    return {reference:row.reference,date:row.date,table:row.table_id,guests:row.guests,name:row.name,minimum:row.minimum,status:row.status};
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if(production) res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    try {
      const url=new URL(req.url,'http://local');
      const path=url.pathname;
      const method=req.method;
      const mutating=['POST','PATCH','DELETE','PUT'].includes(method);
      if(mutating) {
        const origin=req.headers.origin;
        const expected=production?canonical.origin:`http://${req.headers.host}`;
        if((origin && origin!==expected && origin!==canonical.origin) || req.headers['sec-fetch-site']==='cross-site') fail(403,'Cross-site requests are not allowed.');
      }
      let ip=req.socket.remoteAddress??'unknown';
      if(trustedProxyHops) {
        const forwarded=String(req.headers['x-forwarded-for']??'').split(',').map(x=>x.trim()).filter(Boolean);
        if(forwarded.length>=trustedProxyHops && forwarded.every(x=>isIP(x))) ip=[...forwarded,ip].at(-trustedProxyHops-1);
      }
      if(path.startsWith('/api/') && !rateLimit(db,`api:${ip}`,240,60000)) fail(429,'Too many requests. Please try again in a minute.');
      if(method==='GET' && path==='/api/health') return json(res,200,{ok:db.prepare('SELECT 1 AS ok').get().ok===1});
      if(method==='GET' && path==='/api/config') return json(res,200,{...settings(db),today:clubToday(),lastDate:clubToday(90),demo,emailMode:mailConfig.resendKey&&mailConfig.mailFrom?'live':'local'});
      if(method==='GET' && path==='/api/availability') {
        const date=url.searchParams.get('date');
        if(!validDate(date)) fail(400,'Choose a valid date within the next 90 days.');
        return json(res,200,{date,tables:availability(date)});
      }
      if(method==='POST' && path==='/api/bookings') {
        if(!rateLimit(db,`booking:${ip}`,12,3600000)) fail(429,'Too many booking attempts. Please contact SLOMO.');
        const input=await body(req);
        if(input.website) fail(400,'Unable to submit this reservation.');
        if(!validDate(input.date)) fail(400,'Choose a valid date within the next 90 days.');
        if(!safeText(input.name,100)) fail(400,'Enter your full name (up to 100 characters).');
        if(!safeText(input.phone,30) || !/^\+?[\d\s().-]{7,30}$/.test(input.phone) || input.phone.replace(/\D/g,'').length<7) fail(400,'Enter a valid phone number.');
        if(!emailValid(input.email)) fail(400,'Enter a valid email address.');
        if(input.consent!==true) fail(400,'Please accept the booking terms and privacy notice.');
        if(typeof input.requestKey!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestKey)) fail(400,'Invalid request key. Please refresh and try again.');
        const existing=db.prepare('SELECT * FROM bookings WHERE request_key=?').get(input.requestKey);
        if(existing) {
          if(existing.email!==input.email.trim().toLowerCase() || existing.table_id!==input.table || existing.date!==input.date) fail(409,'Request key already used. Please refresh.');
          return json(res,200,{booking:publicBooking(existing),replayed:true});
        }
        if(typeof input.table!=='string') fail(400,'Choose a table from the floor plan.');
        const table=db.prepare('SELECT * FROM tables WHERE id=?').get(input.table);
        if(!table) fail(400,'Choose a table from the floor plan.');
        if(!Number.isInteger(input.guests) || input.guests<1 || input.guests>table.capacity) fail(400,`Choose between 1 and ${table.capacity} guests for ${table.id}.`);
        const token=randomToken();
        let booking;
        db.exec('BEGIN IMMEDIATE');
        try {
          if(!availability(input.date).find(t=>t.id===table.id)?.available) fail(409,'This table was just reserved. Please choose another table.');
          const reference=`SLM-${randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`;
          const result=db.prepare('INSERT INTO bookings(reference,date,table_id,guests,name,phone,email,minimum,manage_hash,request_key) VALUES (?,?,?,?,?,?,?,?,?,?)').run(reference,input.date,table.id,input.guests,input.name.trim(),input.phone.trim(),input.email.trim().toLowerCase(),table.minimum,hashToken(token),input.requestKey);
          booking=db.prepare('SELECT * FROM bookings WHERE id=?').get(result.lastInsertRowid);
          queueBookingEmail(db,booking,{siteUrl,token,adminEmail});
          db.exec('COMMIT');
        } catch(error) {db.exec('ROLLBACK');throw error;}
        void flushEmails();
        return json(res,201,{booking:publicBooking(booking),manageToken:token,emailMode:mailConfig.resendKey&&mailConfig.mailFrom?'live':'local'});
      }
      if(method==='POST' && path==='/api/reservations/lookup') {
        if(!rateLimit(db,`lookup:${ip}`,20,900000)) fail(429,'Too many lookup attempts. Try again later.');
        const input=await body(req);
        const booking=db.prepare('SELECT * FROM bookings WHERE reference=? AND email=?').get(String(input.reference??'').trim().toUpperCase(),String(input.email??'').trim().toLowerCase());
        if(!booking) fail(404,'No reservation matches those details.');
        return json(res,200,{booking:publicBooking(booking)});
      }
      if(method==='POST' && path==='/api/reservations/ticket') {
        if(!rateLimit(db,`ticket:${ip}`,15,900000)) fail(429,'Too many ticket downloads. Please try again later.');
        const input=await body(req);
        if(typeof input.reference!=='string'||!emailValid(input.email)) fail(400,'Enter your reservation reference and email.');
        const booking=db.prepare('SELECT * FROM bookings WHERE reference=? AND email=?').get(input.reference.trim().toUpperCase(),input.email.trim().toLowerCase());
        if(!booking) fail(404,'No reservation matches those details.');
        const bytes=await createReservationPdf(booking,settings(db),{siteUrl,demo,dataDir});
        res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'private, no-store','Content-Disposition':`attachment; filename="SLOMO-Reservation-${booking.reference}.pdf"`,'Content-Length':bytes.length});
        return res.end(Buffer.from(bytes));
      }
      if(method==='POST' && path==='/api/reservations/cancel') {
        if(!rateLimit(db,`cancel:${ip}`,15,900000)) fail(429,'Too many attempts. Try again later.');
        const input=await body(req);
        const booking=db.prepare('SELECT * FROM bookings WHERE reference=? AND manage_hash=?').get(String(input.reference??'').toUpperCase(),hashToken(String(input.token??'')));
        if(!booking) fail(404,'Reservation or management code is incorrect.');
        if(booking.date<clubToday()) fail(400,'Past reservations cannot be changed.');
        if(booking.status!=='cancelled') {
          db.exec('BEGIN IMMEDIATE');
          try {
            db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(booking.id);
            queueBookingEmail(db,booking,{siteUrl,cancelled:true,adminEmail});
            db.exec('COMMIT');
          }catch(error){db.exec('ROLLBACK');throw error;}
          void flushEmails();
        }
        return json(res,200,{booking:{...publicBooking(booking),status:'cancelled'}});
      }
      if(method==='POST' && path==='/api/admin/login') {
        if(!rateLimit(db,`login:${ip}`,8,900000)) fail(429,'Too many sign-in attempts. Try again in 15 minutes.');
        const input=await body(req);
        const admin=db.prepare('SELECT * FROM admins WHERE username=?').get('admin');
        if(typeof input.password!=='string' || input.password.length>256 || !verifyPassword(input.password,admin.password_hash)) fail(401,'Incorrect password.');
        const token=randomToken(),csrf=randomToken();
        db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token),csrf,Date.now()+8*3600000);
        res.setHeader('Set-Cookie',`slomo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${production?'; Secure':''}`);
        return json(res,200,{csrf});
      }
      if(path.startsWith('/api/admin/')) {
        const auth=requireAdmin(req,mutating);
        if(method==='GET' && path==='/api/admin/session') return json(res,200,{csrf:auth.csrf});
        if(method==='POST' && path==='/api/admin/logout') {
          db.prepare('DELETE FROM sessions WHERE token_hash=?').run(auth.token_hash);
          res.setHeader('Set-Cookie',`slomo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${production?'; Secure':''}`);
          return json(res,200,{ok:true});
        }
        if(method==='GET' && path==='/api/admin/bookings') {
          const date=url.searchParams.get('date');
          const rows=date?db.prepare('SELECT * FROM bookings WHERE date=? ORDER BY created_at DESC').all(date):db.prepare('SELECT * FROM bookings ORDER BY date DESC,created_at DESC LIMIT 1000').all();
          return json(res,200,{bookings:rows.map(({manage_hash,request_key,...b})=>b)});
        }
        if(method==='PATCH' && path==='/api/admin/booking') {
          const input=await body(req);
          if(typeof input.reference!=='string') fail(400,'Choose a reservation.');
          const booking=db.prepare('SELECT * FROM bookings WHERE reference=?').get(input.reference);
          if(!booking) fail(404,'Reservation not found.');
          if(input.status!=='cancelled') fail(400,'Only cancellation is supported. Create a new reservation to rebook.');
          if(booking.status!=='cancelled') {
            db.exec('BEGIN IMMEDIATE');
            try {
              db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(booking.id);
              queueBookingEmail(db,booking,{siteUrl,cancelled:true,adminEmail});
              db.exec('COMMIT');
            } catch(error) {db.exec('ROLLBACK');throw error;}
            void flushEmails();
          }
          return json(res,200,{ok:true});
        }
        if(method==='POST' && path==='/api/admin/hold') {
          const input=await body(req);
          if(!validDate(input.date) || typeof input.blocked!=='boolean' || typeof input.table!=='string' || !db.prepare('SELECT 1 FROM tables WHERE id=?').get(input.table)) fail(400,'Choose a valid date and table.');
          db.prepare('INSERT INTO holds VALUES (?,?,?) ON CONFLICT(date,table_id) DO UPDATE SET blocked=excluded.blocked').run(input.date,input.table,Number(input.blocked));
          return json(res,200,{ok:true});
        }
        if(method==='GET' && path==='/api/admin/tables') return json(res,200,{tables:db.prepare('SELECT * FROM tables').all()});
        if(method==='PATCH' && path==='/api/admin/table') {
          const input=await body(req);
          if(!Number.isInteger(input.capacity)||input.capacity<1||input.capacity>50||!safeText(input.minimum,120)) fail(400,'Enter a capacity from 1–50 and a minimum order.');
          if(typeof input.id!=='string'||!db.prepare('SELECT 1 FROM tables WHERE id=?').get(input.id)) fail(404,'Table not found.');
          db.prepare('UPDATE tables SET capacity=?,minimum=? WHERE id=?').run(input.capacity,input.minimum.trim(),input.id);
          return json(res,200,{ok:true});
        }
        if(method==='GET' && path==='/api/admin/settings') return json(res,200,{settings:settings(db),emailMode:mailConfig.resendKey&&mailConfig.mailFrom?'live':'local',demo});
        if(method==='PATCH' && path==='/api/admin/settings') {
          const input=await body(req);
          const keys=['phone','address','logoUrl','heroVideoUrl'];
          for(const key of keys) {
            const value=input[key];
            if(typeof value!=='string'||value.length>500||/[\x00-\x1f<>]/.test(value)) fail(400,`Invalid ${key}.`);
            if(key.endsWith('Url') && value && !/^https:\/\/[^\s]+$/.test(value) && !/^\/media\/[a-zA-Z0-9_.-]+$/.test(value)) fail(400,'Media must use an HTTPS URL or /media/filename.');
          }
          const insert=db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
          db.exec('BEGIN');
          try {for(const key of keys) insert.run(key,input[key].trim()); db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
          return json(res,200,{ok:true});
        }
        if(method==='POST' && path==='/api/admin/media') {
          const kind=url.searchParams.get('kind');
          if(!['logo','video'].includes(kind)) fail(400,'Choose logo or video.');
          const types=kind==='logo'?{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}:{'video/mp4':'mp4','video/webm':'webm'};
          const extension=types[req.headers['content-type']];
          if(!extension) fail(415,kind==='logo'?'Upload a PNG, JPEG or WebP image.':'Upload an MP4 or WebM video.');
          const limit=(kind==='logo'?5:25)*1024*1024;
          let size=0;const chunks=[];
          for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,`Maximum upload size is ${limit/1024/1024} MB.`);chunks.push(chunk);}
          const content=Buffer.concat(chunks);
          const valid=extension==='png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):extension==='jpg'?content[0]===255&&content[1]===216&&content[2]===255:extension==='webp'?content.toString('ascii',0,4)==='RIFF'&&content.toString('ascii',8,12)==='WEBP':extension==='mp4'?content.toString('ascii',4,8)==='ftyp':content.subarray(0,4).equals(Buffer.from([26,69,223,163]));
          if(!valid || content.length<16) fail(400,'This file does not match the expected media format.');
          const directory=join(dataDir,'media');await mkdir(directory,{recursive:true,mode:0o700});
          const filename=`${randomUUID()}.${extension}`;await writeFile(join(directory,filename),content,{mode:0o600});
          const mediaUrl=`/media/${filename}`;
          db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(kind==='logo'?'logoUrl':'heroVideoUrl',mediaUrl);
          return json(res,201,{url:mediaUrl});
        }
        if(method==='GET' && path==='/api/admin/emails') return json(res,200,{emails:db.prepare('SELECT id,recipient,subject,status,attempts,error,created_at FROM email_outbox ORDER BY id DESC LIMIT 100').all()});
        if(method==='GET' && /^\/api\/admin\/emails\/\d+$/.test(path)) {
          const message=db.prepare('SELECT * FROM email_outbox WHERE id=?').get(Number(path.split('/').at(-1)));
          if(!message) fail(404,'Email not found.');
          return json(res,200,{email:message});
        }
        if(method==='POST' && path==='/api/admin/emails/retry') {
          if(!mailConfig.resendKey||!mailConfig.mailFrom) fail(400,'Configure RESEND_API_KEY and MAIL_FROM, then restart to send email.');
          const input=await body(req);
          const message=db.prepare('SELECT * FROM email_outbox WHERE id=?').get(input.id??0);
          if(!message || !['failed','local'].includes(message.status)) fail(400,'Only local or failed messages can be retried.');
          db.prepare("UPDATE email_outbox SET status='pending',attempts=0,error=NULL WHERE id=?").run(message.id);
          void flushEmails(); return json(res,200,{ok:true});
        }
      }
      if(path.startsWith('/api/')) fail(404,'Endpoint not found.');
      if(!['GET','HEAD'].includes(method)) fail(405,'Method not allowed.');
      const relative=path==='/'?'index.html':path==='/admin'||path==='/admin/'?'admin.html':decodeURIComponent(path).replace(/^\//,'');
      const media=path.startsWith('/media/');
      const base=media?join(dataDir,'media'):publicDir;
      if(media&&!/^\/media\/[a-zA-Z0-9_.-]+$/.test(path)) fail(404,'File not found.');
      const file=resolve(base,media?path.slice(7):relative);
      if(!file.startsWith(base+'/')) fail(404,'Page not found.');
      const allowed={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff'};
      const mime=allowed[extname(file)];
      if(!mime) fail(404,'File not found.');
      let buffer;
      try {if(!(await stat(file)).isFile()) fail(404,'File not found.');buffer=await readFile(file);} catch(error){if(error.status)throw error;fail(404,'File not found.');}
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range && ['.mp4','.webm'].includes(extname(file))) {
        const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):buffer.length-1,buffer.length-1);
        if(start>end || start>=buffer.length){res.writeHead(416,{'Content-Range':`bytes */${buffer.length}`});return res.end();}
        res.writeHead(206,{'Content-Type':mime,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${buffer.length}`,'Content-Length':end-start+1});
        res.end(method==='HEAD'?undefined:buffer.subarray(start,end+1));
      } else {
        res.writeHead(200,{'Content-Type':mime,'Cache-Control':extname(file)==='.html'?'no-cache':'public, max-age=3600','Content-Length':buffer.length});
        res.end(method==='HEAD'?undefined:buffer);
      }
    } catch(error) {
      if(!res.headersSent) json(res,error.status??500,{error:error.status?error.message:'Something went wrong. Please try again.'});
      else res.end();
      if(!error.status) console.error('Request error:',error.code??error.name);
    }
  });
  server.requestTimeout=20000; server.headersTimeout=15000;
  return {server,db,flushEmails,close:()=>{clearInterval(interval);return new Promise(resolveClose=>{server.close(()=>{db.close();resolveClose();});server.closeIdleConnections();});}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApp();
  const host=process.env.HOST??'0.0.0.0',port=Number(process.env.PORT??3000);
  app.server.listen(port,host,()=>console.log(`SLOMO listening on port ${port}. Admin: /admin. Email: ${process.env.RESEND_API_KEY&&process.env.MAIL_FROM?'live provider':'local outbox'}.`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>void app.close().then(()=>process.exit(0)));
}

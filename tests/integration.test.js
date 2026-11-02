import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, clubToday } from '../server/index.js';
import { TABLES } from '../server/tables.js';
const password=crypto.randomUUID();

async function fixture(t,options={}) {
  const dataDir=await mkdtemp(join(tmpdir(),'slomo-test-'));
  const app=createApp({dataDir,adminPassword:password,demo:true,...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  async function request(path,{method='GET',data,cookie,csrf,headers={},raw}={}) {
    const res=await fetch(base+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},body:raw??(data!==undefined?JSON.stringify(data):undefined)});
    const payload=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();
    return {status:res.status,data:payload,headers:res.headers};
  }
  async function login() {const r=await request('/api/admin/login',{method:'POST',data:{password}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf};}
  function booking(overrides={}) {return {date:clubToday(1),table:'T7',guests:4,name:'Test Guest',phone:'+855 12 345 678',email:'guest@example.com',consent:true,requestKey:crypto.randomUUID(),...overrides};}
  return {app,request,login,booking,dataDir,base};
}

test('reference floor plan has all visible tables, correct minimums and marked T48/T49 positions',()=>{
  assert.equal(new Set(TABLES.map(t=>t.id)).size,TABLES.length);
  assert.equal(TABLES.filter(t=>t.type==='vip').length,10);
  assert.equal(TABLES.find(t=>t.id==='T48').x,TABLES.find(t=>t.id==='T47').x);
  assert.equal(TABLES.find(t=>t.id==='T49').x,TABLES.find(t=>t.id==='T50').x);
  assert.equal(TABLES.find(t=>t.id==='T48').y,638);
  assert.equal(TABLES.find(t=>t.id==='T49').y,555);
  for(const t of TABLES) assert.equal(t.minimum,t.type==='vip'?'2 bottles of whiskey':t.type==='green'?'1 bottle of whiskey':'6 bottles of beer');
});
test('serves site, admin, assets, health and secure headers',async t=>{
  const {request}=await fixture(t);
  for(const path of ['/','/admin','/app.js','/admin.js','/styles.css','/brand.svg'])assert.equal((await request(path)).status,200,path);
  const health=await request('/api/health');assert.equal(health.data.ok,true);assert.equal(health.headers.get('x-content-type-options'),'nosniff');assert.match(health.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await request('/not-a-page')).status,404);assert.equal((await request('/api/nope')).status,404);
});
test('availability respects date range, demo holds and no invented tables',async t=>{
  const {request}=await fixture(t);const config=(await request('/api/config')).data;assert.equal(config.demo,true);assert.equal(config.emailMode,'local');
  const res=await request(`/api/availability?date=${clubToday()}`);assert.equal(res.status,200);assert.equal(res.data.tables.length,TABLES.length);assert.deepEqual(res.data.tables.filter(t=>!t.available).map(t=>t.id).sort(),['T18','V4']);
  for(const date of ['2020-01-01','2026-02-31','invalid',clubToday(91)])assert.equal((await request(`/api/availability?date=${date}`)).status,400);
});
test('creates persistent reservation, unique reference and an escaped confirmation in local outbox',async t=>{
  const {request,booking,app,login}=await fixture(t);const input=booking({name:'Guest & Friends'});
  const res=await request('/api/bookings',{method:'POST',data:input});assert.equal(res.status,201);assert.match(res.data.booking.reference,/^SLM-[A-F0-9]{12}$/);assert.equal(res.data.manageToken.length,64);assert.equal(res.data.booking.minimum,'1 bottle of whiskey');
  const row=app.db.prepare('SELECT * FROM bookings').get();assert.equal(row.name,input.name);assert.notEqual(row.manage_hash,res.data.manageToken);assert.equal(res.data.booking.email,undefined);assert.equal(res.data.booking.manage_hash,undefined);
  const availability=(await request(`/api/availability?date=${input.date}`)).data;assert.equal(availability.tables.find(t=>t.id==='T7').available,false);
  await app.flushEmails();const auth=await login();const messages=(await request('/api/admin/emails',auth)).data.emails;assert.equal(messages.length,1);assert.equal(messages[0].status,'local');
  const email=(await request(`/api/admin/emails/${messages[0].id}`,auth)).data.email;assert.match(email.html,/Guest &amp; Friends/);assert.match(email.html,new RegExp(res.data.booking.reference));
});
test('rejects duplicate and simultaneous reservations; safe idempotent retry',async t=>{
  const {request,booking,app}=await fixture(t);const input=booking();
  const first=await request('/api/bookings',{method:'POST',data:input});const retry=await request('/api/bookings',{method:'POST',data:input});assert.equal(first.status,201);assert.equal(retry.status,200);assert.equal(retry.data.booking.reference,first.data.booking.reference);assert.equal(app.db.prepare('SELECT count(*) AS n FROM email_outbox').get().n,1);
  assert.equal((await request('/api/bookings',{method:'POST',data:booking()})).status,409);
  const simultaneous=await Promise.all([1,2].map(()=>request('/api/bookings',{method:'POST',data:booking({table:'T8'})})));assert.deepEqual(simultaneous.map(r=>r.status).sort(),[201,409]);
});
test('validates contact details, capacity, consent, dates, objects, and unavailable tables',async t=>{
  const {request,booking}=await fixture(t);
  for(const overrides of [{name:'<script>alert(1)</script>'},{email:'bad'},{phone:'x'},{guests:0},{guests:99},{consent:false},{date:'2020-01-01'},{table:'T99'},{table:{id:'T7'}},{requestKey:'x'}])assert.equal((await request('/api/bookings',{method:'POST',data:booking(overrides)})).status,400,JSON.stringify(overrides));
  assert.equal((await request('/api/bookings',{method:'POST',data:booking({table:'V4'})})).status,409);
  assert.equal((await request('/api/bookings',{method:'POST',data:null})).status,400);
});
test('lookup requires matching email; private token cancels and releases table with email',async t=>{
  const {request,booking,app}=await fixture(t);const input=booking();const created=(await request('/api/bookings',{method:'POST',data:input})).data;
  assert.equal((await request('/api/reservations/lookup',{method:'POST',data:{reference:created.booking.reference,email:'wrong@example.com'}})).status,404);
  const found=await request('/api/reservations/lookup',{method:'POST',data:{reference:created.booking.reference,email:input.email}});assert.equal(found.status,200);assert.equal(found.data.manageToken,undefined);
  assert.equal((await request('/api/reservations/cancel',{method:'POST',data:{reference:created.booking.reference,token:'wrong'}})).status,404);
  const cancelData={reference:created.booking.reference,token:created.manageToken};assert.equal((await request('/api/reservations/cancel',{method:'POST',data:cancelData})).data.booking.status,'cancelled');
  await request('/api/reservations/cancel',{method:'POST',data:cancelData});assert.equal(app.db.prepare('SELECT count(*) AS n FROM email_outbox').get().n,2);
  assert.equal((await request(`/api/availability?date=${input.date}`)).data.tables.find(t=>t.id===input.table).available,true);
});
test('admin authentication, HttpOnly cookies, CSRF, logout and private data protection',async t=>{
  const {request,login}=await fixture(t);
  assert.equal((await request('/api/admin/bookings')).status,401);
  assert.equal((await request('/api/admin/login',{method:'POST',data:{password:'wrong'}})).status,401);
  const loginRes=await request('/api/admin/login',{method:'POST',data:{password}});assert.match(loginRes.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const auth=await login();assert.equal((await request('/api/admin/session',auth)).data.csrf,auth.csrf);
  assert.equal((await request('/api/admin/hold',{method:'POST',cookie:auth.cookie,data:{}})).status,403);
  assert.equal((await request('/api/admin/hold',{...auth,method:'POST',headers:{Origin:'https://evil.example'},data:{}})).status,403);
  assert.equal((await request('/api/admin/logout',{...auth,method:'POST',data:{}})).status,200);assert.equal((await request('/api/admin/session',auth)).status,401);
});
test('admin manages holds, table minimums and cancellations',async t=>{
  const {request,login,booking}=await fixture(t);const auth=await login();const date=clubToday(1);
  await request('/api/admin/hold',{...auth,method:'POST',data:{date,table:'T7',blocked:true}});assert.equal((await request('/api/bookings',{method:'POST',data:booking()})).status,409);
  await request('/api/admin/hold',{...auth,method:'POST',data:{date,table:'T7',blocked:false}});
  await request('/api/admin/table',{...auth,method:'PATCH',data:{id:'T7',capacity:5,minimum:'2 bottles of whiskey'}});
  assert.equal((await request('/api/bookings',{method:'POST',data:booking({guests:6})})).status,400);
  const result=(await request('/api/bookings',{method:'POST',data:booking()})).data;assert.equal(result.booking.minimum,'2 bottles of whiskey');
  await request('/api/admin/table',{...auth,method:'PATCH',data:{id:'T7',capacity:8,minimum:'1 bottle of whiskey'}});
  const rows=(await request(`/api/admin/bookings?date=${date}`,auth)).data.bookings;assert.equal(rows[0].minimum,'2 bottles of whiskey');assert.equal(rows[0].manage_hash,undefined);
  await request('/api/admin/booking',{...auth,method:'PATCH',data:{reference:result.booking.reference,status:'cancelled'}});
  assert.equal((await request(`/api/availability?date=${date}`)).data.tables.find(t=>t.id==='T7').available,true);
});
test('settings and uploads reject executable URLs and invalid media; validated upload is served',async t=>{
  const {request,login}=await fixture(t);const auth=await login();const fields={phone:'+855 87 330 003',address:'Phnom Penh',logoUrl:'',heroVideoUrl:''};
  assert.equal((await request('/api/admin/settings',{...auth,method:'PATCH',data:{...fields,logoUrl:'javascript:alert(1)'}})).status,400);
  assert.equal((await request('/api/admin/settings',{...auth,method:'PATCH',data:fields})).status,200);
  assert.equal((await request('/api/admin/media?kind=logo',{...auth,method:'POST',raw:'<svg/>',headers:{'Content-Type':'image/svg+xml'}})).status,415);
  assert.equal((await request('/api/admin/media?kind=logo',{...auth,method:'POST',raw:'not a png image!',headers:{'Content-Type':'image/png'}})).status,400);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64');
  const upload=await request('/api/admin/media?kind=logo',{...auth,method:'POST',raw:png,headers:{'Content-Type':'image/png'}});assert.equal(upload.status,201);assert.match(upload.data.url,/^\/media\/[\w-]+\.png$/);assert.equal((await request(upload.data.url)).status,200);assert.equal((await request('/api/config')).data.logoUrl,upload.data.url);
});
test('admin login rate limit rejects repeated failures',async t=>{
  const {request}=await fixture(t);for(let i=0;i<8;i++)assert.equal((await request('/api/admin/login',{method:'POST',data:{password:'wrong'}})).status,401);assert.equal((await request('/api/admin/login',{method:'POST',data:{password}})).status,429);
});
test('production refuses unsafe configuration',()=>{
  assert.throws(()=>createApp({production:true,siteUrl:'http://localhost:3000',adminPassword:password,demo:false}),/Production requires/);
  assert.throws(()=>createApp({production:true,siteUrl:'https://slomo.example',adminPassword:password,demo:true}),/Production requires/);
});
test('bookings, holds and settings survive a server restart',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'slomo-restart-'));
  let app;
  const options={dataDir,adminPassword:password,demo:false};
  try {
    app=createApp(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.server.address().port}`;
    const created=await fetch(base+'/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date:clubToday(1),table:'T48',guests:3,name:'Restart Test',phone:'+85512345678',email:'restart@example.com',consent:true,requestKey:crypto.randomUUID()})});
    assert.equal(created.status,201);const original=await created.json();
    app.db.prepare('INSERT INTO holds VALUES (?,?,?)').run(clubToday(1),'T49',1);
    app.db.prepare('INSERT INTO settings VALUES (?,?)').run('address','Persistent address');
    await app.close();app=null;
    app=createApp(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const restored=app.db.prepare('SELECT * FROM bookings').get();assert.equal(restored.reference,original.booking.reference);
    assert.equal(app.db.prepare('SELECT value FROM settings WHERE key=?').get('address').value,'Persistent address');
    const res=await fetch(`http://127.0.0.1:${app.server.address().port}/api/availability?date=${clubToday(1)}`);const {tables}=await res.json();assert.equal(tables.find(t=>t.id==='T48').available,false);assert.equal(tables.find(t=>t.id==='T49').available,false);
  }finally{if(app)await app.close();await rm(dataDir,{recursive:true,force:true});}
});

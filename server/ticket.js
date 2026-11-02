import 'regenerator-runtime/runtime.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';

const directory=dirname(fileURLToPath(import.meta.url));
let assets;
const color=value=>rgb(...value.match(/\w\w/g).map(part=>parseInt(part,16)/255));
const ink={background:color('050B14'),panel:color('0B1826'),silver:color('F0F3F5'),muted:color('A9BBC6'),cyan:color('89C8D8'),line:color('263F51')};

export function reservationLookupUrl(siteUrl) {
  // Intentionally generic: no reference, email, name, token or personal data.
  const origin=new URL(siteUrl);
  if(!['http:','https:'].includes(origin.protocol))throw new Error('SITE_URL must be an HTTP or HTTPS origin.');
  return new URL('/#booking',origin.origin).href;
}

export async function createReservationPdf(booking,venue,{siteUrl,demo=false,dataDir}={}) {
  assets??=Promise.all([
    readFile(join(directory,'assets/ticket-serif.ttf')),
    readFile(join(directory,'assets/ticket-sans.ttf')),
    readFile(join(directory,'assets/ticket-khmer.ttf')),
    readFile(join(directory,'../public/brand.svg'),'utf8')
  ]);
  const [serifBytes,sansBytes,khmerBytes,brand]=await assets;
  const document=await PDFDocument.create();
  document.registerFontkit(fontkit);
  const [serif,sans,khmer]=await Promise.all([
    document.embedFont(serifBytes,{subset:true}),
    document.embedFont(sansBytes,{subset:true}),
    document.embedFont(khmerBytes,{subset:true})
  ]);
  document.setTitle(`SLOMO Reservation ${booking.reference}`);
  document.setAuthor('SLOMO');
  document.setSubject('Reservation pass. Reference and email verification are required for lookup.');
  document.setProducer('SLOMO reservation service');
  const page=document.addPage([480,800]);
  page.drawRectangle({x:0,y:0,width:480,height:800,color:ink.background});
  page.drawRectangle({x:20,y:112,width:440,height:655,color:ink.panel,borderColor:ink.line,borderWidth:.6});
  const runs=text=>{
    const result=[];
    for(const character of String(text)) {
      const font=/[\u1780-\u17ff\u19e0-\u19ff]/u.test(character)?khmer:sans;
      if(result.at(-1)?.font===font)result.at(-1).text+=character;
      else result.push({font,text:character});
    }
    return result;
  };
  const measure=(text,size)=>runs(text).reduce((sum,run)=>sum+run.font.widthOfTextAtSize(run.text,size),0);
  const text=(value,x,y,size=10,tone=ink.silver)=>{
    for(const run of runs(value)) {
      page.drawText(run.text,{x,y,size,font:run.font,color:tone});
      x+=run.font.widthOfTextAtSize(run.text,size);
    }
  };
  function wrap(value,size,width) {
    const lines=[];let line='';
    const segments=new Intl.Segmenter('km',{granularity:'grapheme'}).segment(String(value));
    for(const {segment} of segments) {
      if(line && measure(line+segment,size)>width){lines.push(line.trimEnd());line='';}
      line+=segment;
    }
    if(line)lines.push(line.trimEnd());
    return lines;
  }
  function field(value,x,y,width,{size=11,maxLines=3,tone=ink.silver}={}) {
    let lines=wrap(value,size,width);
    while(lines.length>maxLines && size>7){size-=.5;lines=wrap(value,size,width);}
    lines.forEach((line,index)=>text(line,x,y-index*(size+4),size,tone));
    return y-Math.max(0,lines.length-1)*(size+4);
  }
  const label=(value,x,y)=>text(value,x,y,7,ink.muted);

  // Reuse the existing SLOMO mark and wordmark geometry, never the serif font.
  let embeddedLogo=false;
  if(dataDir && /^\/media\/[a-zA-Z0-9_.-]+\.(png|jpe?g)$/i.test(venue.logoUrl??'')) {
    try {
      const bytes=await readFile(join(dataDir,'media',venue.logoUrl.slice(7)));
      const image=/\.png$/i.test(venue.logoUrl)?await document.embedPng(bytes):await document.embedJpg(bytes);
      const dimensions=image.scaleToFit(95,53);
      page.drawImage(image,{x:36,y:720,width:dimensions.width,height:dimensions.height});embeddedLogo=true;
    }catch{/* The bundled vector identity remains available without external media. */}
  }
  if(!embeddedLogo) {
    const paths=[...brand.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map(match=>match[1]);
    page.drawSvgPath(paths[0],{x:30,y:770,scale:.15,borderColor:ink.silver,borderWidth:23});
    page.drawSvgPath(paths.at(-1),{x:30,y:770,scale:.15,borderColor:ink.silver,borderWidth:5});
  }
  label('SLOMO / PHNOM PENH',300,750);
  label('DIGITAL RESERVATION PASS',300,735);
  page.drawLine({start:{x:36,y:708},end:{x:444,y:708},thickness:.7,color:ink.line});
  if(demo)text('PREVIEW / TEST RESERVATION',36,693,7,ink.cyan);
  page.drawEllipse({x:391,y:657,xScale:32,yScale:52,borderColor:ink.line,borderWidth:1,opacity:.5});
  page.drawEllipse({x:403,y:657,xScale:32,yScale:52,borderColor:ink.line,borderWidth:.5,opacity:.4});
  page.drawText('Your night,',{x:36,y:654,font:serif,size:39,color:ink.silver});
  page.drawText('reserved.',{x:36,y:613,font:serif,size:39,color:ink.silver});

  page.drawRectangle({x:36,y:536,width:408,height:57,color:ink.background,borderColor:ink.line,borderWidth:.7});
  label('RESERVATION REFERENCE',49,576);
  text(booking.reference,49,551,17,ink.silver);
  const status=String(booking.status).toUpperCase();
  page.drawRectangle({x:337,y:549,width:94,height:23,color:ink.panel,borderColor:ink.line,borderWidth:.7});
  text(status,344,557,7.5,booking.status==='confirmed'?ink.cyan:ink.muted);

  label('GUEST NAME',36,513);field(booking.name,36,493,408,{size:12,maxLines:2});
  label('RESERVATION DATE / PHNOM PENH',36,453);
  const date=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${booking.date}T12:00:00Z`));
  field(date,36,434,408,{size:11,maxLines:1});
  label('YOUR TABLE',36,396);text(booking.table_id,36,376,15);
  label('NUMBER OF GUESTS',260,396);text(String(booking.guests),260,376,15);
  label('MINIMUM ORDER',36,340);field(booking.minimum,36,320,408,{size:11,maxLines:3});
  page.drawLine({start:{x:36,y:273},end:{x:444,y:273},thickness:.7,color:ink.line});
  label('SLOMO / VENUE',36,251);
  const addressBottom=field(venue.address,36,231,264,{size:9,maxLines:8,tone:ink.muted});
  field(venue.phone,36,Math.max(128,addressBottom-22),264,{size:10,maxLines:2,tone:ink.silver});

  const lookupUrl=reservationLookupUrl(siteUrl);
  const qr=QRCode.create(lookupUrl,{errorCorrectionLevel:'M'});
  const unit=105/(qr.modules.size+8),baseX=334,baseY=146;
  page.drawRectangle({x:baseX,y:baseY,width:105,height:105,color:rgb(1,1,1)});
  for(let row=0;row<qr.modules.size;row++)for(let column=0;column<qr.modules.size;column++) {
    if(qr.modules.get(row,column))page.drawRectangle({x:baseX+(column+4)*unit,y:baseY+(qr.modules.size-row+3)*unit,width:unit+.015,height:unit+.015,color:rgb(0,0,0)});
  }
  text('SCAN TO FIND YOUR BOOKING',328,132,5.8,ink.muted);
  text('Reference + email required',328,120,6,ink.muted);
  page.drawLine({start:{x:36,y:99},end:{x:444,y:99},thickness:.7,color:ink.line});
  text('Keep this pass private. Payment is made at the venue.',36,77,7.8,ink.muted);
  text(demo?'Preview only. Contact SLOMO for an actual reservation.':'Reservation details are verified by SLOMO staff on arrival.',36,61,7,ink.muted);
  text('SLOMO / AFTER DARK',36,31,6.8,ink.cyan);
  text('PHNOM PENH, CAMBODIA',306,31,6.8,ink.muted);
  return document.save({useObjectStreams:false});
}

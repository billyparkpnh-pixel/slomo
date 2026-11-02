import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createApp, clubToday } from '../server/index.js';
import { reservationLookupUrl, createReservationPdf } from '../server/ticket.js';

test('ticket QR link contains no booking identifiers, customer details or cancellation token',()=>{
  assert.equal(reservationLookupUrl('https://slomo.example/'),'https://slomo.example/#booking');
  assert.equal(reservationLookupUrl('https://slomo.example/private-path'),'https://slomo.example/#booking');
  assert.equal(reservationLookupUrl('https://unused:unused@slomo.example/private?key=ignored'),'https://slomo.example/#booking');
  const parsed=new URL(reservationLookupUrl('https://slomo.example'));
  assert.equal(parsed.search,'');assert.equal(parsed.hash,'#booking');
});
test('creates a real, one-page PDF with embedded fonts for Latin and Khmer names',async()=>{
  const bytes=await createReservationPdf({reference:'SLM-TEST00000001',name:'Léa សុខ',date:clubToday(1),table_id:'T48',guests:4,minimum:'6 bottles of beer',status:'confirmed'}, {address:'Street 55, Phnom Penh',phone:'+855 87 330 003'}, {siteUrl:'https://slomo.example',demo:true});
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const document=await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(),1);assert.equal(document.getPage(0).getWidth(),480);assert.equal(document.getPage(0).getHeight(),800);
  assert.equal(document.getTitle(),'SLOMO Reservation SLM-TEST00000001');assert.equal(document.getAuthor(),'SLOMO');
});
test('ticket endpoint verifies reference plus email and preserves the reservation and private code',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'slomo-ticket-'));
  const app=createApp({dataDir,adminPassword:crypto.randomUUID(),demo:true,siteUrl:'https://slomo.example'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const post=(path,data)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const created=await post('/api/bookings',{date:clubToday(1),table:'T48',guests:4,name:'Ticket Test Guest',phone:'+85512345678',email:'ticket@example.com',consent:true,requestKey:crypto.randomUUID()});
  assert.equal(created.status,201);const {booking,manageToken}=await created.json();
  const before=app.db.prepare('SELECT * FROM bookings WHERE reference=?').get(booking.reference);
  assert.equal((await post('/api/reservations/ticket',{reference:booking.reference,email:'wrong@example.com'})).status,404);
  assert.equal((await post('/api/reservations/ticket',{reference:booking.reference})).status,400);
  assert.equal((await post('/api/reservations/ticket',{reference:'SLM-NOTFOUND00',email:'ticket@example.com'})).status,404);
  const response=await post('/api/reservations/ticket',{reference:booking.reference,email:'TICKET@example.com',name:'Forged details',table:'V10'});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('content-disposition'),`attachment; filename="SLOMO-Reservation-${booking.reference}.pdf"`);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(bytes.includes(Buffer.from(manageToken)),false);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
  const after=app.db.prepare('SELECT * FROM bookings WHERE reference=?').get(booking.reference);assert.deepEqual(after,before);
  assert.equal((await post('/api/reservations/cancel',{reference:booking.reference,token:manageToken})).status,200);
  assert.equal((await post('/api/reservations/ticket',{reference:booking.reference,email:'ticket@example.com'})).status,200);
});

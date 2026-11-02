import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { createMailer } from '../server/email.js';

test('email transport retries failed requests with stable idempotency and marks acceptance',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'slomo-mail-'));const db=openDatabase(directory);
  try {
    db.prepare('INSERT INTO email_outbox(recipient,subject,html) VALUES (?,?,?)').run('test@example.com','Test','<p>Test message</p>');
    let attempts=0;const keys=[];
    const transport=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');keys.push(options.headers['Idempotency-Key']);assert.deepEqual(JSON.parse(options.body).to,['test@example.com']);return new Response('',{status:++attempts===1?503:200});};
    const flush=createMailer(db,{resendKey:'unit-test-placeholder',mailFrom:'Test <test@example.com>'},transport);
    await flush();let row=db.prepare('SELECT * FROM email_outbox').get();assert.equal(row.status,'pending');assert.equal(row.attempts,1);assert.match(row.error,/503/);
    await flush();row=db.prepare('SELECT * FROM email_outbox').get();assert.equal(row.status,'sent');assert.equal(row.attempts,2);assert.ok(row.sent_at);assert.equal(keys[0],keys[1]);
    await flush();assert.equal(attempts,2);
  }finally{db.close();await rm(directory,{recursive:true,force:true});}
});
test('email transport stops automatic retries after five failures',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'slomo-mail-'));const db=openDatabase(directory);
  try {
    db.prepare('INSERT INTO email_outbox(recipient,subject,html) VALUES (?,?,?)').run('test@example.com','Test','<p>Test</p>');
    const flush=createMailer(db,{resendKey:'unit-test-placeholder',mailFrom:'test@example.com'},async()=>{throw new Error('Network unavailable');});
    for(let i=0;i<7;i++)await flush();const row=db.prepare('SELECT * FROM email_outbox').get();assert.equal(row.status,'failed');assert.equal(row.attempts,5);assert.equal(row.error,'Network unavailable');
  }finally{db.close();await rm(directory,{recursive:true,force:true});}
});

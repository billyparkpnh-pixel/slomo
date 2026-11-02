import { settings } from './db.js';

export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function queueBookingEmail(db,booking,{siteUrl,token,cancelled=false,adminEmail}) {
  const info=settings(db);
  const subject=cancelled?`SLOMO · Reservation ${booking.reference} cancelled`:`You're on the list · ${booking.reference}`;
  const manage=token?`${siteUrl}/?reservation=${encodeURIComponent(booking.reference)}#booking`:null;
  const html=`<!doctype html><html><body style="margin:0;background:#10120f;color:#f3f1e7;font:16px Arial,sans-serif"><div style="max-width:560px;padding:48px 24px;margin:auto"><p style="letter-spacing:8px;color:#d5eea0">SLOMO</p><h1>${cancelled?'Until next time.':"Your night is reserved."}</h1><p>Hi ${escapeHtml(booking.name)},</p><p>${cancelled?'Your reservation has been cancelled.':'We look forward to seeing you at SLOMO.'}</p><div style="padding:24px;border:1px solid #43483b;border-radius:12px"><p>Reference: <strong>${escapeHtml(booking.reference)}</strong></p><p>${escapeHtml(booking.date)} · Table ${escapeHtml(booking.table_id)} · ${booking.guests} guests</p><p>Minimum order: ${escapeHtml(booking.minimum)}</p><p>Payment is made at the venue.</p></div><p>${escapeHtml(info.address)}<br>${escapeHtml(info.phone)}</p>${manage?`<p><a style="color:#d5eea0" href="${escapeHtml(manage)}">View your reservation</a></p><p>To cancel, enter this private management code on the reservation page:</p><p style="word-break:break-all">${escapeHtml(token)}</p><p>Keep this code private. It authorizes cancellation of your reservation.</p>`:''}<p style="color:#9b9f92;font-size:12px">Your contact details are used to manage your reservation.</p></div></body></html>`;
  const insert=db.prepare('INSERT INTO email_outbox(booking_id,recipient,subject,html) VALUES (?,?,?,?)');
  insert.run(booking.id,booking.email,subject,html);
  if(adminEmail) insert.run(booking.id,adminEmail,`SLOMO staff · ${subject}`,html);
}

export function createMailer(db,config,transport=fetch) {
  let processing=false;
  return async function flushEmails() {
    if(processing) return;
    processing=true;
    try {
      const messages=db.prepare("SELECT * FROM email_outbox WHERE status='pending' AND attempts<5 ORDER BY id LIMIT 10").all();
      for(const message of messages) {
        if(!config.resendKey || !config.mailFrom) {
          db.prepare("UPDATE email_outbox SET status='local',error=NULL WHERE id=?").run(message.id);
          continue;
        }
        try {
          const response=await transport('https://api.resend.com/emails',{
            method:'POST',signal:AbortSignal.timeout(15000),
            headers:{Authorization:`Bearer ${config.resendKey}`,'Content-Type':'application/json','Idempotency-Key':`slomo-email-${message.id}-${message.created_at}`},
            body:JSON.stringify({from:config.mailFrom,to:[message.recipient],subject:message.subject,html:message.html})
          });
          if(!response.ok) throw new Error(`Mail provider returned HTTP ${response.status}`);
          db.prepare("UPDATE email_outbox SET status='sent',attempts=attempts+1,error=NULL,sent_at=? WHERE id=?").run(new Date().toISOString(),message.id);
        } catch(error) {
          db.prepare("UPDATE email_outbox SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END,error=? WHERE id=?").run(error.name==='TimeoutError'?'Mail provider timed out':String(error.message).slice(0,120),message.id);
        }
      }
    } finally {processing=false;}
  };
}

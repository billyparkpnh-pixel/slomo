import { settings } from './db.js';

export const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function queueBookingEmail(db,booking,{siteUrl,token,cancelled=false,adminEmail}) {
  const info=settings(db);
  const subject=cancelled?`SLOMO · Reservation ${booking.reference} cancelled`:`You're on the list · ${booking.reference}`;
  const manage=new URL(`/?reservation=${encodeURIComponent(booking.reference)}#booking`,new URL(siteUrl).origin).href;
  const date=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${booking.date}T12:00:00Z`));
  const logo=info.logoUrl&&/^https:\/\//.test(info.logoUrl)?info.logoUrl:info.logoUrl?.startsWith('/media/')?new URL(info.logoUrl,siteUrl).href:'';
  const html=`<!doctype html><html><body style="margin:0;padding:0;background:#050B14;color:#F0F3F5;font:15px Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse;background:#050B14"><tr><td style="padding:40px 20px"><div style="max-width:560px;margin:auto;background:#0B1826;border:1px solid #263F51;padding:30px">${logo?`<img src="${escapeHtml(logo)}" width="105" alt="SLOMO" style="display:block;max-width:105px;height:auto;margin-bottom:22px">`:'<p style="font:22px Arial,sans-serif;letter-spacing:7px;margin:0 0 26px;color:#F0F3F5">SLOMO</p>'}<p style="font-size:10px;letter-spacing:2px;color:#89C8D8">PHNOM PENH / AFTER DARK</p><h1 style="font:normal 30px Arial,sans-serif;line-height:1.2;color:#F0F3F5;margin:20px 0">${cancelled?'Until next time.':'Your night is reserved.'}</h1><p style="color:#A9BBC6;line-height:1.8">Hi ${escapeHtml(booking.name)},<br>${cancelled?'Your reservation has been cancelled and your table released.':'Your table at SLOMO is confirmed. Keep your reference close.'}</p><div style="padding:22px;background:#050B14;border:1px solid #263F51;margin:24px 0"><p style="font-size:10px;color:#A9BBC6;letter-spacing:1px">RESERVATION REFERENCE</p><p style="font-size:20px;color:#F0F3F5;letter-spacing:1px">${escapeHtml(booking.reference)}</p><p style="color:#F0F3F5;line-height:1.9">${escapeHtml(date)}<br>Table ${escapeHtml(booking.table_id)} · ${booking.guests} guests<br>Minimum order: ${escapeHtml(booking.minimum)}<br>Status: ${cancelled?'Cancelled':'Confirmed'}</p><p style="font-size:12px;color:#A9BBC6">Payment is made at the venue.</p></div><p><a href="${escapeHtml(manage)}" style="display:inline-block;background:#89C8D8;color:#050B14;padding:14px 20px;text-decoration:none;font:13px Arial,sans-serif">View your reservation ↗</a></p><p style="font-size:12px;color:#A9BBC6;line-height:1.8">Enter your reference and booking email to view your reservation or download your PDF pass. The QR code on the pass also leads to this verified lookup.</p><p style="color:#A9BBC6;line-height:1.8">${escapeHtml(info.address)}<br>${escapeHtml(info.phone)}</p>${token?`<div style="padding-top:20px;margin-top:20px;border-top:1px solid #263F51"><p style="font-size:12px;color:#A9BBC6">Private cancellation code — keep it secret. Enter this code on the reservation page to cancel. It is not included in your PDF pass.</p><p style="word-break:break-all;font-size:12px;color:#F0F3F5">${escapeHtml(token)}</p></div>`:''}<p style="font-size:11px;color:#A9BBC6;line-height:1.8;margin-top:24px">Your contact details are used to manage your reservation. SLOMO · Phnom Penh.</p></div></td></tr></table></body></html>`;
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

import { renderPlan } from './plan.js';
import { initSite } from './site.js?v=3';
const $=selector=>document.querySelector(selector);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={config:null,tables:[],selected:null,landscape:matchMedia('(min-width: 720px)').matches,date:'',requestKey:crypto.randomUUID(),loading:false,filter:'all',pending:null,submitting:false};
const site=initSite();
let availabilityRequest=0;
async function api(path,data) {
  const res=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
  const result=await res.json();
  if(!res.ok) throw Object.assign(new Error(result.error??'Unable to connect. Please try again.'),{status:res.status});
  return result;
}
function toast(message) {$('#toast').textContent=message;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function draw() {
  $('#floor-plan').dataset.orientation=state.landscape?'landscape':'portrait';
  renderPlan($('#floor-plan'),state.tables,{selected:state.selected?.id,landscape:state.landscape,onSelect:selectTable});
  for(const table of state.tables) {
    const element=$(`#floor-plan [data-table="${table.id}"]`);
    if(element)element.dataset.category=table.type;
    element?.classList.toggle('is-highlight-muted',state.filter!=='all'&&state.filter!==table.type);
  }
  $('#available-count').textContent=`${state.tables.filter(t=>t.available).length} tables available`;
}
function selectTable(table) {
  state.selected=table;
  state.requestKey=crypto.randomUUID();
  renderSelection();
  draw();
  if(matchMedia('(max-width: 900px)').matches) $('.reservation-card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
function renderSelection() {
  const table=state.selected;
  $('#booking-fields').disabled=false;
  $('#selection-hint').textContent='Your table is selected. Add your details below.';
  $('#selected-table').innerHTML=`<span class="table-badge ${escape(table.type)}">${escape(table.id)}</span><div><span class="availability-label">AVAILABLE</span><strong>${table.type==='vip'?'VIP sofa':table.type==='green'?'Green table':'Turquoise table'} ${escape(table.id)}</strong><span>Up to ${table.capacity} guests</span><span>Minimum · ${escape(table.minimum)}</span></div>`;
  const previous=Number($('#guests').value)||2;
  $('#guests').replaceChildren(...Array.from({length:table.capacity},(_,i)=>new Option(`${i+1} ${i===0?'guest':'guests'}`,String(i+1))));
  $('#guests').value=String(Math.min(previous,table.capacity));
  $('#booking-error').textContent='';
}
function clearSelection() {
  state.selected=null;$('#booking-fields').disabled=true;
  $('#selection-hint').textContent='Select an available table to begin.';
  $('#selected-table').innerHTML='<span class="empty-table" aria-hidden="true">↖</span><div><strong>YOUR PLACE AWAITS.</strong><span>Choose a table on the floor.</span></div>';
}
async function loadAvailability({quiet=false}={}) {
  const request=++availabilityRequest;
  const date=state.date;
  state.loading=true;
  if(!quiet) {$('#available-count').textContent='Checking availability…';$('#booking-fields').disabled=true;}
  try {
    const data=await api(`/api/availability?date=${encodeURIComponent(date)}`);
    if(request!==availabilityRequest) return;
    state.tables=data.tables;
    if(state.selected) {
      const fresh=data.tables.find(t=>t.id===state.selected.id);
      if(!fresh?.available) {clearSelection();toast('That table is no longer available. Please choose another.');}
      else {
        const detailsChanged=fresh.capacity!==state.selected.capacity||fresh.minimum!==state.selected.minimum;
        state.selected=fresh;
        if(detailsChanged)renderSelection();
        else $('#booking-fields').disabled=false;
      }
    }
    $('#availability-message').textContent='';draw();
  }catch(error) {
    if(request!==availabilityRequest) return;
    $('#availability-message').textContent=error.message;
    $('#available-count').textContent='Availability unavailable';
    clearSelection();state.tables=[];draw();$('#available-count').textContent='Unable to load';
  }finally{if(request===availabilityRequest)state.loading=false;}
}
$('#booking-date').addEventListener('change',async e=>{
  state.date=e.target.value;clearSelection();await loadAvailability();
});
$('#rotate-plan').addEventListener('click',()=>{state.landscape=!state.landscape;draw();});
$('#zoom-plan').addEventListener('click',e=>{
  const enlarged=$('#floor-plan').classList.toggle('enlarged');
  e.currentTarget.setAttribute('aria-pressed',String(enlarged));
  e.currentTarget.setAttribute('aria-label',enlarged?'Fit floor plan':'Enlarge floor plan');
  e.currentTarget.innerHTML=enlarged?'− <span>Fit view</span>':'+ <span>Enlarge</span>';
});
function setFilter(type) {
  state.filter=type;
  document.querySelectorAll('[data-table-filter]').forEach(button=>{
    const active=button.dataset.tableFilter===type;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  draw();
}
for(const button of document.querySelectorAll('[data-table-filter]'))button.addEventListener('click',()=>setFilter(button.dataset.tableFilter));
for(const link of document.querySelectorAll('[data-pick-type]'))link.addEventListener('click',()=>setFilter(link.dataset.pickType));
$('#booking-form').addEventListener('submit',e=>{
  e.preventDefault();if(!state.selected||state.loading)return;
  const table=state.selected;
  state.pending={date:state.date,table:table.id,guests:Number($('#guests').value),name:$('#full-name').value.trim(),phone:$('#phone').value.trim(),email:$('#email').value.trim(),website:$('#website').value,consent:$('#consent').checked,requestKey:state.requestKey};
  const input=state.pending;
  $('#booking-error').textContent='';
  $('#review-content').innerHTML=`<p class="eyebrow">ONE LAST LOOK</p><h2 id="review-title">Your night, in detail.</h2><p class="muted">Review your reservation before confirming.</p><div class="review-summary"><dl><div><dt>Date</dt><dd>${escape(prettyDate(input.date))}</dd></div><div><dt>Table</dt><dd>${escape(table.id)} · up to ${table.capacity} guests</dd></div><div><dt>Guests</dt><dd>${input.guests}</dd></div><div><dt>Minimum order</dt><dd>${escape(table.minimum)}</dd></div><div><dt>Full name</dt><dd>${escape(input.name)}</dd></div><div><dt>Phone</dt><dd>${escape(input.phone)}</dd></div><div><dt>Email</dt><dd>${escape(input.email)}</dd></div></dl></div><p class="muted small">Payment is made at the venue. Availability is checked again when you confirm.</p><p class="form-error" id="review-error" role="alert"></p><div class="review-actions"><button class="text-link" id="review-edit">Edit details</button><button class="button" id="review-confirm">Confirm booking <span aria-hidden="true">↗</span></button></div>`;
  $('#review-edit').addEventListener('click',()=>$('#review-dialog').close());
  $('#review-confirm').addEventListener('click',confirmBooking);
  $('#review-dialog').showModal();
});
$('#review-dialog').addEventListener('close',()=>{state.pending=null;});
$('#review-dialog').addEventListener('cancel',e=>{if(state.submitting)e.preventDefault();});
async function confirmBooking() {
  if(!state.pending||state.submitting)return;
  const input={...state.pending};
  state.submitting=true;
  const button=$('#review-confirm');button.disabled=true;button.textContent='Confirming…';
  $('#review-edit').disabled=true;$('#review-dialog .dialog-close').disabled=true;$('#book-submit').disabled=true;
  $('#review-error').textContent='';
  try {
    const data=await api('/api/bookings',input);
    $('#review-dialog').close();
    showReservation(data.booking,{email:input.email,token:data.manageToken,newBooking:true,emailMode:data.emailMode});
    $('#booking-form').reset();clearSelection();state.requestKey=crypto.randomUUID();await loadAvailability({quiet:true});
  }catch(error){
    $('#review-error').textContent=error.message;
    if(error.status===409)await loadAvailability({quiet:true});
  }finally{
    state.submitting=false;button.disabled=false;button.innerHTML='Confirm booking <span aria-hidden="true">↗</span>';
    $('#review-edit').disabled=false;$('#review-dialog .dialog-close').disabled=false;$('#book-submit').disabled=false;
  }
}
function prettyDate(date) {return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));}
function showReservation(booking,{email='',token='',newBooking=false,emailMode=''}={}) {
  const cancelled=booking.status==='cancelled';
  $('#dialog-content').innerHTML=`<div class="confirmation-symbol">${cancelled?'↗':'✳'}</div><p class="eyebrow">${cancelled?'RESERVATION CANCELLED':state.config.demo?'PREVIEW RESERVATION':newBooking?'YOU’RE ON THE LIST':'YOUR RESERVATION'}</p><h2 id="dialog-title">${cancelled?'Until next time.':'Your night, reserved.'}</h2><p class="muted">${cancelled?'Your table has been released.':`${escape(booking.name)}, keep your reference close.`}</p><div class="confirmation-ticket"><div class="ticket-reference"><span>BOOKING REFERENCE</span><strong>${escape(booking.reference)}</strong><button class="inline-link" id="copy-reference">Copy ↗</button></div><dl><div><dt>Your night</dt><dd>${escape(prettyDate(booking.date))}</dd></div><div><dt>Your place</dt><dd>${escape(booking.table)} · ${booking.guests} guests</dd></div><div><dt>Minimum order</dt><dd>${escape(booking.minimum)}</dd></div><div><dt>Status</dt><dd>${cancelled?'Cancelled':'Confirmed'}${state.config.demo?' · preview':''}</dd></div></dl></div>${state.config.demo?'<p class="demo-notice">This is a preview booking. Contact SLOMO to arrange a real reservation.</p>':''}${newBooking?`<p class="muted small">${emailMode==='local'?'Your confirmation is saved in the local email outbox. No email has been sent.':'Your confirmation email is queued for delivery.'}</p>`:''}<div class="confirmation-actions"><button class="button" id="download-ticket">Save reservation PDF <span aria-hidden="true">↓</span></button>${!cancelled?'<button class="text-link" id="show-cancel">Cancel reservation</button>':''}</div><p id="ticket-status" class="download-hint" role="status">Your PDF includes a QR link to the verified reservation lookup.</p><p id="ticket-error" class="download-error" role="alert"></p>${!cancelled?`<div id="cancel-area" hidden><p class="muted small">Enter the private management code from your confirmation email to cancel. It is never included in your PDF.</p><label for="manage-token">MANAGEMENT CODE</label><input id="manage-token" value="${escape(token)}" autocomplete="off" placeholder="Paste your private code"><button class="button button-outline" id="cancel-reservation">Confirm cancellation</button><p id="cancel-error" class="form-error" role="alert"></p></div>`:''}<p class="card-footnote">${escape(state.config.phone)} · Payment at the venue</p>`;
  $('#copy-reference').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(booking.reference);toast('Booking reference copied.');}catch{toast('Select and copy the reference above.');}});
  $('#download-ticket').addEventListener('click',async e=>{
    const button=e.currentTarget;button.disabled=true;button.textContent='Preparing your PDF…';
    $('#ticket-error').textContent='';$('#ticket-status').textContent='Creating your reservation pass…';
    try {
      if(!email)throw new Error('Find your reservation with your reference and email to download the PDF.');
      const response=await fetch('/api/reservations/ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:booking.reference,email})});
      if(!response.ok){const result=await response.json();throw new Error(result.error??'The PDF could not be prepared. Please try again.');}
      const bytes=await response.arrayBuffer();
      if(!response.headers.get('content-type')?.includes('application/pdf')||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error('The PDF could not be prepared. Please try again.');
      const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
      const anchor=document.createElement('a');anchor.href=url;anchor.download=`SLOMO-Reservation-${booking.reference}.pdf`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('#ticket-status').textContent='Your PDF is ready. If it opens in a viewer, use your device’s save controls.';
    }catch(error){$('#ticket-error').textContent=error.message||'The download failed. Please try again.';$('#ticket-status').textContent='Your reservation is still saved. You can retry the download.';}
    finally{button.disabled=false;button.innerHTML='Save reservation PDF <span aria-hidden="true">↓</span>';}
  });
  if(!cancelled) {
    $('#show-cancel').addEventListener('click',()=>{$('#cancel-area').hidden=!$('#cancel-area').hidden;$('#manage-token').focus();});
    $('#cancel-reservation').addEventListener('click',async e=>{
      e.target.disabled=true;$('#cancel-error').textContent='';
      try {const result=await api('/api/reservations/cancel',{reference:booking.reference,token:$('#manage-token').value.trim()});showReservation(result.booking,{email});await loadAvailability({quiet:true});}
      catch(error){$('#cancel-error').textContent=error.message;e.target.disabled=false;}
    });
  }
  if(!$('#reservation-dialog').open) $('#reservation-dialog').showModal();
}
$('#lookup-form').addEventListener('submit',async e=>{
  e.preventDefault();$('#lookup-error').textContent='';
  const button=e.target.querySelector('[type=submit]');button.disabled=true;
  try {const data=await api('/api/reservations/lookup',{reference:$('#lookup-reference').value,email:$('#lookup-email').value});showReservation(data.booking,{email:$('#lookup-email').value.trim()});}
  catch(error){$('#lookup-error').textContent=error.message;} finally{button.disabled=false;}
});
for(const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
}
for(const button of document.querySelectorAll('[data-policy]')) button.addEventListener('click',()=>{
  const privacy=button.dataset.policy==='privacy';
  $('#policy-content').innerHTML=privacy?`<p class="eyebrow">YOUR DETAILS, RESPECTED</p><h2 id="policy-title">Privacy notice</h2><p>We collect your name, phone number, email, reservation date, table and party size to arrange your visit, send reservation messages, and respond to booking queries. We do not enroll you in marketing.</p><p>Reservation details are stored on our booking server and are accessible only to authorized staff. If email is enabled, reservation emails are processed by Resend. Please avoid entering sensitive information.</p><p>Staff sign-in uses an essential, secure session cookie. This website does not use advertising cookies or third-party analytics.</p><p>To request access, correction or deletion of your information, contact ${escape(state.config.phone)}. Retention and any legal requirements are handled by venue staff.</p>`:`<p class="eyebrow">A FEW THINGS BEFORE THE NIGHT</p><h2 id="policy-title">Booking terms</h2><p>Your reservation applies to the selected table and calendar date in Phnom Penh time. Minimum orders are 6 bottles of beer for turquoise tables, 1 bottle of whiskey for green tables and 2 bottles of whiskey for VIP sofas, unless the displayed table minimum has been updated by staff.</p><p>No online payment is collected. Minimum orders and purchases are paid at the venue. Contact SLOMO to confirm arrival times, bottle choices, prices, age requirements and any special requests before visiting.</p><p>Keep your reference and private management code. You can cancel a future reservation from “Find my reservation”, or contact the venue. A change of table or date requires a new reservation.</p><p>${state.config.demo?'This preview accepts test reservations only. Contact the venue for a real booking.':'Availability is checked again when you submit. A reservation is confirmed only after a reference has been generated.'}</p>`;
  $('#policy-dialog').showModal();
});

async function initialize() {
  $('#year').textContent=new Date().getFullYear();
  try {
    state.config=await api('/api/config');
    const input=$('#booking-date');input.min=state.config.today;input.max=state.config.lastDate;input.value=state.config.today;state.date=input.value;
    $('#demo-notice').hidden=!state.config.demo;
    if(state.config.logoUrl) {$('#hero-logo').src=state.config.logoUrl;$('.intro img').src=state.config.logoUrl;}
    if(state.config.heroVideoUrl)site.setVideo(state.config.heroVideoUrl);
    $('#venue-address').textContent=state.config.address;$('#venue-phone').textContent=`${state.config.phone} ↗`;$('#venue-phone').href=`tel:${state.config.phone.replace(/[^\d+]/g,'')}`;
    const reference=new URLSearchParams(location.search).get('reservation');if(reference)$('#lookup-reference').value=reference;
    await loadAvailability();
  }catch(error){$('#availability-message').textContent='We couldn’t load booking details. Please refresh or call +855 87 330 003.';}
}
setInterval(()=>{if(!document.hidden && !$('#reservation-dialog').open && !$('#review-dialog').open && state.config && state.date)void loadAvailability({quiet:true});},30000);
initialize();

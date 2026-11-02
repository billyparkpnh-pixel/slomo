import { renderPlan } from './plan.js';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrf='',bookings=[],tables=[],config={};
async function api(path,{method='GET',data,raw}={}) {
  const headers={};if(method!=='GET')headers['X-CSRF-Token']=csrf;
  if(data)headers['Content-Type']='application/json';
  if(raw)headers['Content-Type']=raw.type;
  const response=await fetch(path,{method,headers,body:raw??(data?JSON.stringify(data):undefined)});
  const result=await response.json();
  if(response.status===401 && path!=='/api/admin/login') {$('#login-section').hidden=false;$('#dashboard').hidden=true;csrf='';}
  if(!response.ok)throw new Error(result.error??'Unable to complete this request.');
  return result;
}
function message(text,isError=false) {$('#admin-message').textContent=isError?text:'';$('#toast').textContent=text;$('#toast').classList.add('visible');setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function guard(fn){return async e=>{try{await fn(e);}catch(error){message(error.message,true);}};}
function dateLabel(date){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`));}
async function showDashboard() {
  $('#login-section').hidden=true;$('#dashboard').hidden=false;
  config=await api('/api/config');
  $('#admin-date').value=config.today;$('#hold-date').value=config.today;$('#hold-date').min=config.today;$('#hold-date').max=config.lastDate;
  tables=(await api('/api/admin/tables')).tables;
  for(const id of ['#hold-table','#edit-table'])$(id).replaceChildren(...tables.map(t=>new Option(`${t.id} · ${t.type==='vip'?'VIP sofa':t.type}`,t.id)));
  fillTable();
  await Promise.all([loadBookings(),loadPlan(),loadSettings(),loadEmails()]);
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();$('#login-error').textContent='';const button=e.target.querySelector('button');button.disabled=true;
  try{const result=await api('/api/admin/login',{method:'POST',data:{password:$('#admin-password').value}});csrf=result.csrf;$('#admin-password').value='';await showDashboard();}
  catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}
});
$('#logout').addEventListener('click',guard(async()=>{await api('/api/admin/logout',{method:'POST',data:{}});csrf='';$('#dashboard').hidden=true;$('#login-section').hidden=false;}));
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));
  document.querySelectorAll('.admin-panel').forEach(p=>p.hidden=p.id!==`panel-${button.dataset.tab}`);
});
async function loadBookings() {
  const date=$('#admin-date').value;
  const result=await api(`/api/admin/bookings${date?`?date=${encodeURIComponent(date)}`:''}`);bookings=result.bookings;drawBookings();
}
function drawBookings() {
  const confirmed=bookings.filter(b=>b.status==='confirmed');
  $('#stats').innerHTML=`<div class="stat"><strong>${confirmed.length}</strong><span>Confirmed reservations</span></div><div class="stat"><strong>${confirmed.reduce((a,b)=>a+b.guests,0)}</strong><span>Guests expected</span></div><div class="stat"><strong>${bookings.length-confirmed.length}</strong><span>Cancelled reservations</span></div>`;
  const term=$('#booking-search').value.toLowerCase();
  const shown=bookings.filter(b=>[b.name,b.reference,b.email,b.phone,b.table_id].some(x=>x.toLowerCase().includes(term)));
  $('#booking-list').innerHTML=shown.length?shown.map(b=>`<article class="booking-row"><div><strong>${escape(b.name)} <span class="status ${b.status==='cancelled'?'cancelled':''}">${escape(b.status)}</span></strong><span>${escape(b.reference)}</span><span>${escape(dateLabel(b.date))} · ${escape(b.table_id)} · ${b.guests} guests</span></div><div><a href="mailto:${escape(b.email)}">${escape(b.email)}</a><a href="tel:${escape(b.phone.replace(/[^\d+]/g,''))}">${escape(b.phone)}</a></div><div><strong>Minimum order</strong><span>${escape(b.minimum)}</span></div><div>${b.status==='confirmed'?`<button class="inline-link cancel-booking" data-reference="${escape(b.reference)}">Cancel reservation</button>`:'<span>Table released</span>'}</div></article>`).join(''):'<div class="empty-state">No reservations here yet. Your next good night is on its way.</div>';
  for(const button of document.querySelectorAll('.cancel-booking'))button.addEventListener('click',()=>{
    const parent=button.parentElement;parent.innerHTML=`<div class="cancel-confirm"><span>Cancel this reservation? The guest will receive a cancellation message.</span><button class="button button-small" data-confirm>Yes, cancel</button><button class="inline-link" data-back>Keep reservation</button></div>`;
    parent.querySelector('[data-back]').addEventListener('click',drawBookings);
    parent.querySelector('[data-confirm]').addEventListener('click',guard(async e=>{e.target.disabled=true;await api('/api/admin/booking',{method:'PATCH',data:{reference:button.dataset.reference,status:'cancelled'}});message('Reservation cancelled.');await Promise.all([loadBookings(),loadPlan(),loadEmails()]);}));
  });
}
$('#booking-search').addEventListener('input',drawBookings);
$('#admin-date').addEventListener('change',guard(loadBookings));
$('#all-dates').addEventListener('click',guard(async()=>{$('#admin-date').value='';await loadBookings();}));
$('#export').addEventListener('click',()=>{
  const columns=['reference','date','table_id','guests','name','phone','email','minimum','status'];
  function cell(value){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return `"${text.replaceAll('"','""')}"`;}
  const csv=[columns.join(','),...bookings.map(b=>columns.map(k=>cell(b[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`SLOMO-reservations-${$('#admin-date').value||'all'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function loadPlan(){const result=await api(`/api/availability?date=${encodeURIComponent($('#hold-date').value)}`);renderPlan($('#admin-plan'),result.tables,{selected:$('#hold-table').value,landscape:matchMedia('(min-width: 650px)').matches,onSelect:t=>{$('#hold-table').value=t.id;void loadPlan().catch(e=>message(e.message,true));}});}
$('#hold-date').addEventListener('change',guard(loadPlan));$('#hold-table').addEventListener('change',guard(loadPlan));
$('#hold-form').addEventListener('submit',guard(async e=>{e.preventDefault();await api('/api/admin/hold',{method:'POST',data:{date:$('#hold-date').value,table:$('#hold-table').value,blocked:$('#hold-status').value==='true'}});message('Table availability saved for this date.');await loadPlan();}));
function fillTable(){const t=tables.find(t=>t.id===$('#edit-table').value);if(t){$('#edit-capacity').value=t.capacity;$('#edit-minimum').value=t.minimum;}}
$('#edit-table').addEventListener('change',fillTable);
$('#table-form').addEventListener('submit',guard(async e=>{e.preventDefault();await api('/api/admin/table',{method:'PATCH',data:{id:$('#edit-table').value,capacity:Number($('#edit-capacity').value),minimum:$('#edit-minimum').value}});tables=(await api('/api/admin/tables')).tables;message('Table settings updated.');await loadPlan();}));
async function loadSettings(){const result=await api('/api/admin/settings');for(const [field,key]of [['phone','phone'],['address','address'],['logo','logoUrl'],['video','heroVideoUrl']])$(`#setting-${field}`).value=result.settings[key];$('#email-mode').textContent=result.emailMode==='local'?'Local mode: confirmations are saved here. No external email is sent. Configure RESEND_API_KEY and MAIL_FROM for real delivery.':'Live mode: confirmations are queued for Resend. Monitor delivery statuses below.';}
$('#settings-form').addEventListener('submit',guard(async e=>{e.preventDefault();await api('/api/admin/settings',{method:'PATCH',data:{phone:$('#setting-phone').value,address:$('#setting-address').value,logoUrl:$('#setting-logo').value,heroVideoUrl:$('#setting-video').value}});message('Venue details saved.');}));
for(const kind of ['logo','video'])$(`#${kind}-upload`).addEventListener('submit',guard(async e=>{
  e.preventDefault();const file=$(`#${kind}-file`).files[0];if(!file)return;
  const limit=(kind==='logo'?5:25)*1024*1024;if(file.size>limit)throw new Error(`Maximum upload is ${limit/1024/1024} MB.`);
  const button=e.target.querySelector('button');button.disabled=true;button.textContent='Uploading…';
  try {await api(`/api/admin/media?kind=${kind}`,{method:'POST',raw:file});message(`${kind==='logo'?'Logo':'Video'} uploaded and connected to the website.`);await loadSettings();e.target.reset();}
  finally{button.disabled=false;button.textContent=`Upload ${kind} ↗`;}
}));
async function loadEmails() {
  const {emails}=await api('/api/admin/emails');
  $('#email-list').innerHTML=emails.length?emails.map(m=>`<article class="email-row"><div><strong>${escape(m.subject)}</strong><span>${escape(m.recipient)}</span>${m.error?`<span class="form-error">${escape(m.error)}</span>`:''}</div><span>${escape(m.status==='local'?'Local · not sent':m.status)}</span><span>${escape(new Date(m.created_at).toLocaleString())}</span><div><button class="inline-link view-email" data-id="${m.id}">View</button>${['local','failed'].includes(m.status)?`<button class="inline-link retry-email" data-id="${m.id}">Send / retry</button>`:''}</div></article>`).join(''):'<div class="empty-state">Confirmation and cancellation emails will appear here.</div>';
  for(const button of document.querySelectorAll('.view-email'))button.addEventListener('click',guard(async()=>{
    const {email}=await api(`/api/admin/emails/${button.dataset.id}`);
    const parsed=new DOMParser().parseFromString(email.html,'text/html');
    const elements=Array.from(parsed.body.querySelectorAll('h1,p')).map(node=>{const p=document.createElement(node.tagName.toLowerCase());p.textContent=node.textContent;p.className=node.tagName==='H1'?'':'muted';return p;});
    $('#email-content').replaceChildren(...elements);$('#email-preview').hidden=false;$('#email-preview').scrollIntoView({behavior:'smooth',block:'start'});
  }));
  for(const button of document.querySelectorAll('.retry-email'))button.addEventListener('click',guard(async()=>{await api('/api/admin/emails/retry',{method:'POST',data:{id:Number(button.dataset.id)}});message('Email queued for delivery.');await loadEmails();}));
}
$('#refresh-emails').addEventListener('click',guard(loadEmails));$('#close-email').addEventListener('click',()=>$('#email-preview').hidden=true);
try{const result=await api('/api/admin/session');csrf=result.csrf;await showDashboard();}catch(error){if(error.message!=='Please sign in to continue.')$('#login-error').textContent=error.message;}

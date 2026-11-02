// Public-facing motion and navigation. Does not touch reservations or admin state.
import { events } from './events-data.js?v=3';

function renderEvents() {
  const list=document.querySelector('#event-list');
  if(!list)return;
  const approved=events.filter(event=>event&&typeof event.title==='string'&&event.title.trim());
  if(!approved.length)return;
  list.classList.add('has-events');
  document.querySelector('.highlights-grid').hidden=true;
  const safeUrl=value=>typeof value==='string'&&(/^(https:\/\/)/.test(value)||/^\/(?!\/)/.test(value));
  list.replaceChildren(...approved.map(event=>{
    const card=document.createElement('article');card.className='event-card';
    const image=document.createElement('img');image.loading='lazy';image.src=safeUrl(event.image)?event.image:'/visuals/light-field.svg';image.alt=`${event.title} — SLOMO event artwork`;
    image.addEventListener('error',()=>image.src='/visuals/light-field.svg',{once:true});
    const content=document.createElement('div');content.className='event-content';
    const date=document.createElement('time');
    if(/^\d{4}-\d{2}-\d{2}$/.test(event.date??'')&&!Number.isNaN(Date.parse(event.date))){date.dateTime=event.date;date.textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(event.date+'T12:00:00Z'));}
    else date.textContent='Date to be announced';
    const title=document.createElement('h3');title.textContent=event.title;
    const description=document.createElement('p');description.textContent=event.description??'';
    const details=document.createElement('ul');
    for(const detail of Array.isArray(event.details)?event.details:[]){const item=document.createElement('li');item.textContent=String(detail);details.append(item);}
    const link=document.createElement('a');link.className='text-link';link.href=safeUrl(event.link)?event.link:'#floor';link.textContent='Explore the night ↗';
    content.append(date,title,description,details,link);card.append(image,content);return card;
  }));
}

export function initSite() {
  renderEvents();
  const header=document.querySelector('.site-header');
  const menu=document.querySelector('#menu-toggle');
  const navigation=document.querySelector('#main-navigation');
  const hero=document.querySelector('.hero');
  const motionButton=document.querySelector('#motion-toggle');
  const video=document.querySelector('#hero-video');
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reducedMotion.matches;

  function closeMenu({restoreFocus=false}={}) {
    header.classList.remove('is-menu-open');
    menu.setAttribute('aria-expanded','false');
    menu.setAttribute('aria-label','Open navigation');
    if(restoreFocus) menu.focus();
  }
  menu.addEventListener('click',()=>{
    const open=header.classList.toggle('is-menu-open');
    menu.setAttribute('aria-expanded',String(open));
    menu.setAttribute('aria-label',open?'Close navigation':'Open navigation');
  });
  navigation.addEventListener('click',event=>{if(event.target.closest('a'))closeMenu();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&header.classList.contains('is-menu-open'))closeMenu({restoreFocus:true});});
  document.addEventListener('click',event=>{if(!header.contains(event.target))closeMenu();});
  matchMedia('(min-width: 651px)').addEventListener('change',event=>{if(event.matches)closeMenu();});

  function updateMotion() {
    document.documentElement.classList.toggle('motion-paused',paused);
    motionButton.setAttribute('aria-pressed',String(paused));
    motionButton.innerHTML=paused?'Resume motion <span aria-hidden="true">+</span>':'Pause motion <span aria-hidden="true">II</span>';
    if(paused||document.hidden)video.pause();
    else if(video.getAttribute('src'))video.play().catch(()=>{});
  }
  motionButton.addEventListener('click',()=>{paused=!paused;updateMotion();});
  reducedMotion.addEventListener('change',event=>{paused=event.matches;updateMotion();});
  document.addEventListener('visibilitychange',updateMotion);
  updateMotion();
  if(matchMedia('(pointer: fine)').matches) {
    hero.addEventListener('pointermove',event=>{
      if(paused||reducedMotion.matches)return;
      const box=hero.getBoundingClientRect();
      hero.style.setProperty('--pointer-x',((event.clientX-box.left)/box.width-.5)*14);
      hero.style.setProperty('--pointer-y',((event.clientY-box.top)/box.height-.5)*10);
    });
    hero.addEventListener('pointerleave',()=>{hero.style.setProperty('--pointer-x','0');hero.style.setProperty('--pointer-y','0');});
  }
  if('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('reveal-in');observer.unobserve(entry.target);}
    },{threshold:.08});
    document.querySelectorAll('.section-heading,.experience-type,.experience-art,.highlight-card,.event-card,.package-card,.visit-layout').forEach(element=>observer.observe(element));
  }
  return {
    setVideo(source) {
      video.src=source;
      video.hidden=false;
      const show=()=>document.documentElement.classList.add('has-hero-video');
      const fallback=()=>{video.hidden=true;document.documentElement.classList.remove('has-hero-video');};
      video.addEventListener('loadeddata',show,{once:true});
      video.addEventListener('error',fallback,{once:true});
      video.load();
      updateMotion();
    }
  };
}

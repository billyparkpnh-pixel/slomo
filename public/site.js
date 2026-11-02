// Public-facing motion and navigation. Does not touch reservations or admin state.
export function initSite() {
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
    document.querySelectorAll('.section-heading,.experience-type,.experience-art,.highlight-card,.package-card,.visit-layout').forEach(element=>observer.observe(element));
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

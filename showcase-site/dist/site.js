const dialog = document.querySelector('#film-dialog');
const video = document.querySelector('#promo-video');
let lastFilmTrigger;
let pendingStart = 0;
document.querySelectorAll('[data-open-film]').forEach(button => button.addEventListener('click', () => {
  lastFilmTrigger = button;
  pendingStart = Number(button.dataset.filmStart || 0);
  dialog.showModal();
  document.body.style.overflow = 'hidden';
  if(video.readyState >= 1){video.currentTime = pendingStart;}
  else{video.addEventListener('loadedmetadata', () => {video.currentTime = pendingStart;}, {once:true});}
  document.querySelector('.video-error').hidden = !video.error;
  if(video.error){video.load();document.querySelector('.video-error').hidden = true;}
  video.play().catch(() => {});
}));
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  video.pause();
  document.body.style.overflow = '';
  lastFilmTrigger?.focus({preventScroll: true});
});
dialog.addEventListener('click', event => {if(event.target === dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
video.addEventListener('error', () => {document.querySelector('.video-error').hidden = false;});

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus = false){
  tabs.forEach(item => {
    const active = item === tab;
    item.setAttribute('aria-selected', String(active));
    item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
  if(focus)tab.focus();
}
tabs.forEach((tab,index) => {
  tab.addEventListener('click',()=>selectTab(tab));
  tab.addEventListener('keydown',event=>{
    let next;
    if(event.key === 'ArrowRight')next=(index+1)%tabs.length;
    if(event.key === 'ArrowLeft')next=(index+tabs.length-1)%tabs.length;
    if(event.key === 'Home')next=0;
    if(event.key === 'End')next=tabs.length-1;
    if(next !== undefined){event.preventDefault();selectTab(tabs[next],true);}
  });
});
const details = [...document.querySelectorAll('.workspace-details details')];
details.forEach(item => item.addEventListener('toggle',()=>{if(item.open)details.forEach(other=>{if(other!==item)other.open=false;});}));

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
if(!reduced.matches && 'IntersectionObserver' in window){
  const observer = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target);}});
  },{threshold:.08});
  document.querySelectorAll('[data-reveal]').forEach(el=>{el.classList.add('reveal-ready');observer.observe(el);});
}

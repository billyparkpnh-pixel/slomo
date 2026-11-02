const ns='http://www.w3.org/2000/svg';
function svgElement(tag,attrs={},text='') {
  const el=document.createElementNS(ns,tag);
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value));
  if(text) el.textContent=text;
  return el;
}
export function renderPlan(container,tables,{selected,landscape=true,onSelect}) {
  const width=590,height=1014;
  const position=(x,y)=>landscape?[y,width-x]:[x,y];
  const svg=svgElement('svg',{viewBox:landscape?`-16 -16 ${height+32} ${width+32}`:`-16 -16 ${width+32} ${height+32}`,role:'group','aria-label':'SLOMO floor plan. Choose an available table.'});
  svg.append(svgElement('title',{},'SLOMO — actual venue layout'));
  const room=svgElement('g',landscape?{transform:`translate(0 ${width}) rotate(-90)`}:{});
  room.append(svgElement('path',{d:'M130 4H574Q585 4 585 20V994Q585 1010 568 1010H130Q100 1010 100 980V795Q100 754 69 754H27Q4 754 4 731V326Q4 299 28 299H74Q100 299 100 272V34Q100 4 130 4Z',fill:'#21272a',stroke:'#73796d','stroke-width':2}));
  for(const y of [26,908]) room.append(svgElement('rect',{x:101,y,width:482,height:84,fill:'#30302b'}));
  for(const y of [111,122,888,901]) room.append(svgElement('path',{d:`M101 ${y}H582`,stroke:'#53584e','stroke-width':1}));
  room.append(svgElement('path',{d:'M4 4H86V267Q86 291 64 291H4Z',fill:'#45473d'}));
  room.append(svgElement('path',{d:'M4 761H68Q86 761 86 788V1010H4Z',fill:'#45473d'}));
  room.append(svgElement('rect',{x:463,y:435,width:120,height:141,rx:3,fill:'#585c50'}));
  room.append(svgElement('rect',{x:469,y:469,width:24,height:72,rx:2,fill:'#d5d5c7'}));
  room.append(svgElement('path',{d:'M87 795h37m-37 57h37',stroke:'#969c88','stroke-width':2}));
  for(const y of [253,504,756]) room.append(svgElement('rect',{x:253,y:y-11,width:21,height:21,rx:4,fill:'#111710',stroke:'#353d32'}));
  svg.append(room);
  function label(x,y,text,size=15,color='#bcc1b0',attrs={}) {
    const [px,py]=position(x,y);
    svg.append(svgElement('text',{x:px,y:py,'text-anchor':'middle','dominant-baseline':'central',fill:color,'font-size':size,'font-family':'Arial, sans-serif',...attrs},text));
  }
  label(45,147,'BAR COUNTER',landscape?15:16,'#e3e2d5',landscape?{}:{transform:'rotate(90 45 147)'});
  label(527,506,'DJ',20,'#f0eee0');
  label(45,887,'ENTRANCE',landscape?15:16,'#e3e2d5',landscape?{}:{transform:'rotate(90 45 887)'});
  label(560,838,'WC',12);
  for(const t of tables) {
    const [x,y]=position(t.x,t.y);
    const chosen=selected===t.id;
    const color=!t.available?'#42483f':t.type==='vip'?'#d4a76c':t.type==='green'?'#a4ce75':'#72c9be';
    const dims=t.type==='vip'?[59,44]:t.type==='green'?[44,61]:[40,40];
    const [w,h]=landscape?[dims[1],dims[0]]:dims;
    const group=svgElement('g',{class:`plan-table ${t.available?'is-available':'is-unavailable'} ${chosen?'is-selected':''}`,role:'button',tabindex:t.available?'0':'-1','aria-label':`${t.id}, ${t.type==='vip'?'VIP sofa':t.type+' table'}, ${t.available?'available':'unavailable'}, up to ${t.capacity} guests, minimum ${t.minimum}`,'aria-disabled':!t.available,'aria-pressed':chosen,'data-table':t.id});
    group.append(svgElement('title',{},`${t.id} · ${t.available?t.minimum:'Unavailable'}`));
    if(chosen) group.append(svgElement('rect',{x:x-w/2-5,y:y-h/2-5,width:w+10,height:h+10,rx:Math.min(w,h)/2,fill:'none',stroke:'#f1f0db','stroke-width':2}));
    group.append(svgElement('rect',{x:x-w/2,y:y-h/2,width:w,height:h,rx:Math.min(w,h)/2,fill:chosen?'#e4efc7':color,stroke:chosen?'#fff8db':'#151b15','stroke-width':3}));
    group.append(svgElement('text',{x,y,'text-anchor':'middle','dominant-baseline':'central','font-family':'Arial, sans-serif','font-size':t.id.length>2?16:17,'font-weight':chosen?700:500,fill:t.available?'#192118':'#8a8f82'},t.id));
    if(!t.available) group.append(svgElement('path',{d:`M${x-w/2+5} ${y+h/2-5}L${x+w/2-5} ${y-h/2+5}`,stroke:'#969c8a','stroke-width':1.5,opacity:.7}));
    if(t.available) {
      group.addEventListener('click',()=>onSelect(t));
      group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ') {e.preventDefault();onSelect(t);}});
    }
    svg.append(group);
  }
  container.replaceChildren(svg);
}

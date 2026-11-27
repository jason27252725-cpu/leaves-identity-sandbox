import {companyDocument} from './company-form.mjs';
import {el,button,dialog,table,hours} from './shared/dom.mjs';
const parse=text=>new DOMParser().parseFromString(text,'application/xml');
const index=ref=>[...ref.replace(/\d/g,'')].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const number=(node,key,fallback)=>Number(node?.getAttribute(key)||fallback);
function color(node){const rgb=node?.getAttribute('rgb');return /^[A-Fa-f0-9]{8}$/.test(rgb||'')?'#'+rgb.slice(2):null;}
export async function mountCompanyPreview(root,data,style,projects,person,{state,writable,onEntry,onNote,onMilestones,documentSource,onCell}){
 root.replaceChildren(el('p',{class:'li-status'},'正在排入公司原表…'));
 const doc=documentSource||await companyDocument(data,style,projects,person);
 if(!root.isConnected)return;
 const styles=parse(doc.files['xl/styles.xml']),xfs=[...styles.querySelector('cellXfs').children],fonts=[...styles.querySelector('fonts').children];
 const strings=doc.files['xl/sharedStrings.xml']?[...parse(doc.files['xl/sharedStrings.xml']).querySelectorAll('si')].map(si=>[...si.querySelectorAll('t')].map(n=>n.textContent).join('')):[];
 const borders=[...styles.querySelector('borders').children],fills=[...styles.querySelector('fills').children];
 const sheets=el('div',{class:'li-company-scroll',tabIndex:0,'aria-label':'月報紙張預覽'});
 const paper=el('div',{class:'li-company-paper'}),content=el('div',{class:'li-company-content'});
 const entries=new Map(data.entries.map(entry=>[entry.id,entry]));
 let page=Math.min(state.page||0,doc.pages.length-1),active=false;
 sheets.append(paper);paper.append(content);
 function inspect(target){
  if(target.kind==='settlement'){onCell?.(target);return;}
  if(target.kind==='project'){onMilestones?.(target);return;}
  if(target.kind==='work'&&target.ids.length===1&&!onNote){onEntry(entries.get(target.ids[0]),target.defaults);return;}
  if(target.kind==='work'&&!target.ids.length&&writable&&!onNote){onEntry(null,target.defaults);return;}
  const d=dialog(target.label||'月報來源');
  if(target.kind==='info'){d.content.append(el('p',{},'此欄由所選月份、人員或公司班表帶入。'));return;}
  const records=target.ids.map(id=>entries.get(id)).filter(Boolean);
  if(records.length){
   d.content.append(table(['日期','工作內容','預計','實際','操作'],records.map(e=>[
    e.work_date,e.description,hours(e.planned_minutes),hours(e.actual_minutes),
    button(writable?'更正紀錄':'查看紀錄',()=>{d.close();onEntry(e,target.defaults);})
   ])));
  }else d.content.append(el('p',{},'這格目前沒有工作紀錄。'));
  if(target.note?.note)d.content.append(el('p',{class:'li-report-note'},target.note.note));
  if(target.kind==='work'){
   if(writable)d.content.append(button('新增每日工作',()=>{d.close();onEntry(null,target.defaults);},'li-primary'));
   if(target.noteTarget&&onNote&&(writable||target.note))d.content.append(button(writable?'編輯月報備註':'查看月報備註',()=>{
    d.close();onNote(target.noteTarget,target.note);
   }));
  }
 }
 const [mmWidth,mmHeight]=doc.paper||[297,210];const paperWidth=mmWidth*96/25.4,paperHeight=mmHeight*96/25.4;
 function zoom(value){
  state.zoom=value;
  const factor=value==='fit'?Math.min(1,Math.max(.5,(sheets.clientWidth-20)/paperWidth)):value/100;
  scale.textContent=value==='fit'?'符合視窗 · '+Math.round(factor*100)+'%':value+'%';
  paper.style.width=paperWidth*factor+'px';
  paper.style.height=paperHeight*factor+'px';
  content.style.width=paperWidth+'px';
  content.style.height=paperHeight+'px';
  content.style.transform='scale('+factor+')';
 }
 function step(delta){
  const base=state.zoom==='fit'?Math.min(100,Math.round((sheets.clientWidth-20)/paperWidth*100)):state.zoom;
  zoom(Math.min(200,Math.max(50,base+delta)));
 }
 sheets.addEventListener('wheel',event=>{
  if(!event.altKey)return;
  event.preventDefault();step(event.deltaY<0?10:-10);
 },{passive:false});
 sheets.addEventListener('scroll',()=>{if(active){state.left=sheets.scrollLeft;state.top=sheets.scrollTop;}});
 if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(()=>{if(state.zoom==='fit'&&sheets.isConnected)zoom('fit');});
  observer.observe(sheets);
  const cleanup=new MutationObserver(()=>{if(!sheets.isConnected){observer.disconnect();cleanup.disconnect();}});
  cleanup.observe(root.closest('.li-dialog')||document.body,{childList:true,subtree:true});
 }
 function paint(){
  const current=doc.pages[page],xml=parse(current.xml),cells=new Map([...xml.querySelectorAll('sheetData row c')].map(c=>[c.getAttribute('r'),c]));
  const merged=new Map(),hidden=new Set();
  for(const n of xml.querySelectorAll('mergeCell')){
   const [from,to]=n.getAttribute('ref').split(':'),c1=index(from),c2=index(to),r1=Number(from.replace(/\D/g,'')),r2=Number(to.replace(/\D/g,''));
   const top=Math.max(r1,current.minRow||1),bottom=Math.min(r2,current.maxRow||72);
   if(top>bottom)continue;
   merged.set(top+','+c1,{rows:bottom-top+1,cols:c2-c1+1});
   for(let r=top;r<=bottom;r++)for(let c=c1;c<=c2;c++)if(r!==top||c!==c1)hidden.add(r+','+c);
  }
  const t=el('table',{class:'li-company-sheet','aria-label':current.name}),cols=el('colgroup');
  const sourceColumns=[...xml.querySelectorAll('cols col')];
  for(let c=current.minCol||1;c<=(current.maxCol||43);c++){const source=sourceColumns.find(n=>number(n,'min',0)<=c&&number(n,'max',0)>=c);cols.append(el('col',{style:'width:'+Math.max(12,number(source,'width',8)*7)+'px'}));}t.append(cols);
  const rows=el('tbody');
  for(const row of xml.querySelectorAll('sheetData row')){
   const r=number(row,'r',0);if(r<(current.minRow||1)||r>(current.maxRow||72))continue;
   const tr=el('tr',{style:'height:'+number(row,'ht',15)*4/3+'px'});
   for(let c=current.minCol||1;c<=(current.maxCol||43);c++){
    if(hidden.has(r+','+c))continue;
    let col='',v=c;while(v){v--;col=String.fromCharCode(65+v%26)+col;v=Math.floor(v/26);}
    const ref=col+r,node=cells.get(ref),span=merged.get(r+','+c),td=el('td',{rowspan:span?.rows||1,colspan:span?.cols||1});
    let text=node?.getAttribute('t')==='inlineStr'?[...node.querySelectorAll('t')].map(n=>n.textContent).join(''):node?.getAttribute('t')==='s'?strings[Number(node.querySelector('v')?.textContent)]||'':node?.querySelector('v')?.textContent||'';
    const xf=xfs[Number(node?.getAttribute('s')||0)],font=fonts[Number(xf?.getAttribute('fontId')||0)],alignment=xf?.querySelector('alignment');
    if(node?.getAttribute('t')!=='inlineStr'&&text!==''&&[9,10].includes(Number(xf?.getAttribute('numFmtId'))))text=(Number(text)*100).toLocaleString('zh-TW',{maximumFractionDigits:2})+'%';
    td.style.fontSize=number(font?.querySelector('sz'),'val',10)*4/3+'px';td.style.fontWeight=font?.querySelector('b')?'600':'400';
    td.style.textAlign=alignment?.getAttribute('horizontal')||'left';td.style.verticalAlign=alignment?.getAttribute('vertical')==='center'?'middle':'top';
    const ink=color(font?.querySelector('color'));if(ink)td.style.color=ink;
    const family=font?.querySelector('name')?.getAttribute('val');if(family)td.style.fontFamily='"'+family.replace(/["\\]/g,'')+'",sans-serif';
    const fill=color(fills[Number(xf?.getAttribute('fillId')||0)]?.querySelector('fgColor'));if(fill)td.style.backgroundColor=fill;
    for(const side of ['left','right','top','bottom']){const edge=borders[Number(xf?.getAttribute('borderId')||0)]?.querySelector(side),kind=edge?.getAttribute('style');if(kind){const width=/thick/.test(kind)?3:/medium|double/.test(kind)?2:1;td.style.setProperty('border-'+side,width+'px '+(kind==='double'?'double':'solid')+' '+(color(edge.querySelector('color'))||'#555'),'important');}}

    const target=current.targets[ref];
    const cell=el('span',{class:'li-sheet-text'},text);
    if(ref.startsWith('B')&&span?.rows>=3)cell.classList.add('li-project-name');
    td.append(cell);
    const accessible=target&&(target.kind!=='project'||onMilestones)
      &&(target.kind!=='work'||writable||target.ids.length||target.note);
    if(accessible){
     const open=()=>inspect(target);
     td.classList.add('li-source-cell');
     td.append(el('button',{type:'button',class:'li-cell-open',onclick:open,'aria-label':target.label||target.projectName||'查看儲存格',title:text||'開啟儲存格'}));
    }
    if(target?.kind==='work'){
     const e=entries.get(target.ids[0]);
     if(e)td.title=e.description;
    }
    tr.append(td);
   }rows.append(tr);
  }
  t.append(rows);content.replaceChildren(t);
  t.style.transform='none';
  const fit=Math.min((paperWidth-32)/t.offsetWidth,(paperHeight-32)/t.offsetHeight);
  t.style.transform='scale('+fit+')';
  for(const td of t.querySelectorAll('.li-sheet-text:not(.li-project-name)')){
   let size=parseFloat(getComputedStyle(td).fontSize);
   while(td.clientWidth>0&&td.scrollWidth>td.clientWidth+1&&size>7){size-=.5;td.style.fontSize=size+'px';}
  }
  label.textContent=current.name+' · '+(page+1)+' / '+doc.pages.length;
  prev.disabled=page===0;next.disabled=page+1===doc.pages.length;
  state.page=page;
 }
 function turn(delta){page+=delta;state.left=state.top=0;paint();sheets.scrollTo(0,0);}
 const label=el('span'),prev=button('上一頁',()=>turn(-1)),next=button('下一頁',()=>turn(1));
 const scale=button('',()=>zoom('fit'));scale.title='恢復符合視窗';
 root.replaceChildren(el('div',{class:'li-toolbar'},el('strong',{},doc.title||(data.reportName||person.name)+' · '+data.month.slice(0,7)),
  label,prev,next,button('縮小',()=>step(-10)),scale,button('放大',()=>step(10))),
  el('p',{class:'li-note'},doc.title?'按住 Alt 滾動滑鼠可縮放。點選工時查看來源。':'按住 Alt 滾動滑鼠可縮放。點選工作格可查看來源或新增工作。'),sheets);
 paint();zoom(state.zoom||'fit');sheets.scrollTo(state.left||0,state.top||0);active=true;
}

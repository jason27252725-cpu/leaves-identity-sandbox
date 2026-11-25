import {el,field,select} from './shared/dom.mjs';

export const businessOptions = [['design','設計階段'],['construction','工程階段'],['internal','內部事務']];
export const taskGroups = {
  design: [
    ['設計＋發想',/設計發想|設計＋發想|概念|提案/], ['3D渲染',/3d\s*渲染|渲染|透視圖/i],
    ['3D實景',/3d\s*實景|動畫|虛擬實景/i], ['基礎圖面',/基礎圖|丈量|放樣圖|平面配置/],
    ['施工圖面',/施工圖|詳圖|大樣/], ['報價',/報價|估價|比價/], ['其他',null],
    ['開會時間',/開會|會議|討論/]
  ],
  construction: [
    ['拆除泥作',/拆除|泥作/], ['木工',/木工|木作/], ['油漆',/油漆|塗料/],
    ['鐵件',/鐵件|鐵工/], ['石材',/石材/], ['系統',/系統櫃|系統板/],
    ['地板',/地板/], ['清潔',/清潔/], ['其他',null], ['現場協調',/現場|協調|監工|驗收/]
  ],
  internal: [['公司會議',/開會|會議/],['教育訓練',/訓練|帶領新人/],['其他',null]]
};
const accounting = [
  ['會計／零用金',/零用金/],['會計／對帳',/對帳/],['會計／發票',/發票/],
  ['會計／請款',/請款/],['會計／薪資',/薪資/],
  ['行政／採買',/採買|採購/],['行政／人事',/人事/],['行政／SOP',/sop|官網|網站/i],
  ['軟裝／家具',/家具|軟裝/]
];
const daily = [['3D渲染',/3d|渲染/i],['空間攝影',/拍攝|攝影/],['修圖',/修圖|調色/],['AI網站',/ai|網站/i]];
const unspecified = /^(每日工作|待分類|其他)?$/;

function suggest(groups,text) {
  const matches = groups.filter(([,matcher])=>matcher?.test(text));
  return matches.length===1 ? matches[0][0] : '';
}

export function projectTaskIndex(entry) {
  const groups = taskGroups[entry.business];
  if(!groups) throw Error('工作階段無效');
  const type = String(entry.work_type||'').trim();
  const index = groups.findIndex(([name])=>name===type && name!=='其他');
  if(index>=0) return index;
  const inferred = unspecified.test(type) ? '' : suggest(groups,type);
  return groups.findIndex(([name])=>name===(inferred||'其他'));
}

export function workFields({projects,entry={},style='project',disabled=false,onChange=()=>{},storageKey=''}) {
  const oldProject=entry.projectId??entry.project_id??'';
  const oldBusiness=entry.business||'';
  const oldType=entry.workType||entry.work_type||'';
  const byId=new Map(projects.map(p=>[p.project_id,p]));
  const selected=oldProject|| (oldBusiness==='internal' ? '__internal' : '');
  const usedKey='leaves-work-recent:'+storageKey;
  let recent=[];
  if(storageKey)try{recent=JSON.parse(localStorage.getItem(usedKey)||'[]');if(!Array.isArray(recent))recent=[];}catch{}
  const normalize=text=>String(text||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
  const category=select('案件分類',[['','全部案件'],['I','專案設計'],['S','服務評估'],['R','維修服務'],['internal','公司內部']],'');
  const listId='li-project-'+crypto.randomUUID();
  const search=field('找案件','text','',{placeholder:'輸入案名或案號',autocomplete:'off',role:'combobox','aria-autocomplete':'list','aria-expanded':'false','aria-controls':listId});
  const results=el('div',{id:listId,class:'li-case-results',role:'listbox',hidden:true});
  let options=[],cursor=-1,composing=false;
  const toggle=el('button',{type:'button','aria-label':'展開案件清單',class:'li-case-toggle'},'▾');
  const wrap=el('div',{class:'li-case-combo'},search.node,toggle,results);
  const display=p=>p.legacy_code?p.legacy_code+' · '+p.name:p.name;
  const entries=[...projects.map(p=>({id:p.project_id,label:display(p),group:normalize(p.legacy_code)[0]})),{id:'__internal',label:'公司內部',group:'internal'}];
  if(oldProject&&!byId.has(oldProject))entries.push({id:oldProject,label:(entry.project_name||entry.projectName||'既有專案')+'（原歸屬）',group:''});
  const project=select('專案',[],selected);
  const stage=select('月報工作階段',businessOptions,oldBusiness);
  const description=field('工作內容','text',entry.description||'',{maxLength:2000,placeholder:'例如：核對木作報價、調整天花施工圖'});
  const type=select('月報分類',[],'');
  const hint=el('small',{class:'li-note','aria-live':'polite'});
  function fillProjects(value) {
    project.input.replaceChildren(el('option',{value:''},'選擇專案'),...entries.map(p=>el('option',{value:p.id},p.label)));
    project.input.value=value;
    search.input.value=entries.find(p=>p.id===value)?.label||'';
    hint.textContent=projects.length?'':'目前沒有指派給你的案件。可填寫公司內部工作，或請主管建立並指派案件。';
  }
  function closeList(){
    results.hidden=true;search.input.setAttribute('aria-expanded','false');search.input.removeAttribute('aria-activedescendant');cursor=-1;
  }
  function choose(id){
    project.input.value=id;search.input.value=entries.find(p=>p.id===id)?.label||'';
    project.input.oninput();search.input.focus();closeList();
  }
  function openList(all=false){
    if(disabled)return;
    const q=all?'':normalize(search.input.value);
    options=entries.filter(p=>(!category.input.value||category.input.value===p.group)&&(!q||normalize(p.label).includes(q)))
      .sort((a,b)=>Number(recent.includes(b.id))-Number(recent.includes(a.id))||a.label.localeCompare(b.label,'zh-Hant'));
    cursor=-1;search.input.removeAttribute('aria-activedescendant');
    results.replaceChildren(...options.map((p,i)=>el('div',{id:listId+'-'+i,role:'option',onpointerdown:e=>e.preventDefault(),onclick:()=>choose(p.id)},p.label)));
    if(!options.length)results.append(el('small',{},'找不到符合的案件，可換案號搜尋或請主管核對指派、結案狀態。'));
    results.hidden=false;search.input.setAttribute('aria-expanded','true');
  }
  function fillStages(value) {
    const internal=project.input.value==='__internal';
    const options=internal?businessOptions.slice(-1):businessOptions.slice(0,2);
    stage.input.replaceChildren(...(internal?[]:[el('option',{value:''},'選擇階段')]),...options.map(([v,t])=>el('option',{value:v},t)));
    stage.input.value=internal?'internal':options.some(([v])=>v===value)?value:'';
    stage.input.disabled=disabled||internal||!project.input.value;stage.node.hidden=internal||!project.input.value;
  }
  let suggestion='';
  function fillTypes(value) {
    const groups=[...(taskGroups[stage.input.value]||[]),...(style==='category'?accounting:style==='daily'?daily:[])];
    const names=[...new Set(groups.map(([name])=>name))];
    suggestion=suggest(style==='category'?accounting:style==='daily'?daily:groups,description.input.value)
      ||suggest(taskGroups[stage.input.value]||[],description.input.value);
    type.input.replaceChildren(el('option',{value:''},suggestion?'依內容分類 · '+suggestion:'待分類'),
      ...[...new Set([...names,...(value?[value]:[])])].map(name=>el('option',{value:name},name)));
    type.input.value=value||'';
  }
  fillProjects(selected);
  fillStages(oldBusiness);
  fillTypes(unspecified.test(oldType)?'':oldType);
  // A saved legacy label remains attached until the user picks another category or changes the description.
  let legacy=unspecified.test(oldType)?oldType:'';
  search.input.disabled=toggle.disabled=category.input.disabled=disabled;
  toggle.addEventListener('pointerdown',e=>e.preventDefault());
  toggle.addEventListener('click',()=>{if(!results.hidden){closeList();return;}search.input.focus();openList(true);});
  search.input.addEventListener('focus',()=>openList(true));
  search.input.addEventListener('blur',closeList);
  search.input.addEventListener('compositionstart',()=>{composing=true;});
  search.input.addEventListener('compositionend',()=>{composing=false;search.input.oninput();});
  search.input.addEventListener('keydown',e=>{
    if(composing||e.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'&&!results.hidden){e.preventDefault();e.stopPropagation();closeList();}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();if(results.hidden)openList(!search.input.value||!!project.input.value);
      if(!options.length)return;
      cursor=cursor<0?(e.key==='ArrowDown'?0:options.length-1):(cursor+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;
      [...results.children].forEach((n,i)=>n.setAttribute('aria-selected',String(i===cursor)));
      search.input.setAttribute('aria-activedescendant',listId+'-'+cursor);results.children[cursor].scrollIntoView?.({block:'nearest'});
    }
    if(e.key==='Enter'&&!results.hidden){e.preventDefault();if(cursor>=0||options.length===1)choose(options[Math.max(0,cursor)].id);}
  });
  category.input.onchange=()=>{search.input.value='';project.input.value='';project.input.oninput();search.input.focus();openList(true);};
  for(const f of [project,description,type])f.input.disabled=disabled;
  search.input.oninput=()=>{if(composing)return;if(project.input.value){project.input.value='';project.input.oninput();}openList();};
  project.input.oninput=()=>{
    const before=stage.input.value;
    fillStages(before);
    if(before!==stage.input.value)legacy='';
    const value=project.input.value;
    if(byId.has(value)&&storageKey){
      recent=[value,...recent.filter(x=>x!==value)].slice(0,6);
      try{localStorage.setItem(usedKey,JSON.stringify(recent));}catch{}
    }
    fillTypes(before===stage.input.value?type.input.value:'');
    onChange();
  };
  stage.input.oninput=()=>{fillTypes('');legacy='';onChange();};
  description.input.oninput=()=>{fillTypes(type.input.value);legacy='';onChange();};
  type.input.oninput=()=>{legacy='';onChange();};
  const details=el('details',{class:'li-work-classification'},el('summary',{},'月報分類（選填）'),type.node);
  if(oldType&&!unspecified.test(oldType))details.open=true;
  function values() {
    const projectValue=project.input.value;
    return {
      projectId:projectValue==='__internal'?'':projectValue,
      projectChoice:projectValue,
      business:stage.input.value,
      workType:type.input.value||legacy||suggestion||'待分類',
      description:description.input.value
    };
  }
  function payload() {
    const v=values();
    if(!v.projectChoice)throw Error('請選擇專案；公司共同工作請選「公司內部」。');
    if(!v.business)throw Error('請選擇這筆工作的設計或工程階段。');
    if(!v.description.trim())throw Error('請填寫工作內容。');
    return {projectId:v.projectId||null,business:v.business,workType:v.workType,description:v.description.trim()};
  }
  return {project,stage,description,type,header:el('div',{class:'li-grid li-work-selector'},stage.node),
    search:el('div',{class:'li-grid li-case-grid'},category.node,wrap),hint,details,values,payload,
    restore(v){
      const choice=v.projectChoice??(v.projectId||(v.business==='internal'?'__internal':''));
      fillProjects(choice);
      fillStages(v.business);
      description.input.value=v.description;
      legacy=unspecified.test(v.workType)?v.workType:'';
      fillTypes(legacy?'':v.workType);
    }};
}

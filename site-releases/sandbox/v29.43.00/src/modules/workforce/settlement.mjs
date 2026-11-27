import {layouts} from './form-layouts.mjs';
import {prepareSheet,setCell} from './company-form.mjs';
import {zipStored} from './xlsx.mjs';
import {column} from './excel-reader.mjs';
import {summarizeReport} from './model.mjs';
const groupKey=x=>JSON.stringify([x.projectId,x.business,x.projectId?'':x.projectName]);
const sum=rows=>rows.reduce((total,x)=>total+x.minutes,0)/60;
function chunks(list,size){const out=[];for(let i=0;i<Math.max(list.length,1);i+=size)out.push(list.slice(i,i+size));return out;}
export function settlementRows(report){
 summarizeReport(report);
 const rows=report.rows.map(r=>({employeeId:r.employeeId,name:r.name,employeeCode:r.employeeCode,projectId:r.entry.project_id,projectName:r.projectName||r.entry.work_type,legacyCode:r.legacyCode,business:r.entry.business,period:'day',start:r.entry.work_date,end:r.entry.work_date,minutes:r.entry.actual_minutes,entry:r.entry,closureId:r.closureId}));
 for(const b of report.balances||[])if(!b.overlap)rows.push(b);
 return rows;
}
export async function settlementDocument(report,kind,options={}){
 const base=kind;
 if(!Object.hasOwn(layouts,base))throw Error('結算表版型無效');
 const bytes=Uint8Array.from(atob(layouts[base]),c=>c.charCodeAt(0));
 const files=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
 const all=settlementRows(report),year=report.year;
 const rows=all.filter(r=>kind!=='personal'||['month','day'].includes(r.period));
 const people=[...new Map(rows.map(x=>[x.employeeId,x])).values()];
 const projects=[...new Map(rows.map(x=>[groupKey(x),x])).values()];
 const pages=[],sheets=[],areas=[];
 const title=kind==='case'?'所有年度該專案時數結算表':kind==='personal'?'個人進度表結算':kind==='a4'?'公司年度案件結算 · A4':'公司年度案件結算 · A3';
 if(kind==='case'&&(!report.projectId||year))throw Error('請選單一專案，並將年度留空。');
 if(kind!=='case'&&!year)throw Error('請指定結算年度。');
 const paper=kind==='personal'?[210,297]:kind==='company'?[420,297]:[297,210];
 const source=files['xl/worksheets/sheet1.xml'];
 function newPage(bound){
  const name='結算表'+(pages.length+1),sheet=prepareSheet(source),targets={};
  const put=(cell,value,formula)=>setCell(sheet,cell,value,formula);
  const amount=(cell,list,formula,defaults=null)=>{if(list.length||formula)put(cell,sum(list),formula);targets[cell]={kind:'settlement',label:cell,records:list,defaults};};
  const note=(cell,anchor,label)=>{const old=options.notes?.[anchor];put(cell,old?.content||'');targets[cell]={kind:'settlement',label,anchor,old,records:[]};};
  const finish=()=>{
   let xml=sheet.finish();
   if(['a4','personal','company'].includes(kind)){
    const orient=kind==='personal'?'portrait':'landscape',size=kind==='company'?'8':'9';
    xml=xml.replace(/<pageSetup\b[^>]*\/>/, '<pageSetup orientation="'+orient+'" paperSize="'+size+'" fitToWidth="1" fitToHeight="1"/>').replace(/<pageSetUpPr\b[^>]*\/>/,'<pageSetUpPr fitToPage="1"/>');
    if(kind==='a4')xml=xml.replace(/<rowBreaks[\s\S]*?<\/rowBreaks>/,'');
   }
   sheets.push(xml);areas.push(bound.area);pages.push({name,xml,targets,...bound});
  };
  return {put,amount,note,finish};
 }
 const dateLabel=year?String(year-1911)+'年度':'所有年度';
 if(kind==='case'){
  const pageGroups=chunks(people,14);
  for(const group of pageGroups){
   const {put,amount,note,finish}=newPage({minCol:2,maxCol:32,minRow:2,maxRow:20,area:'$B$2:$AF$20'});
   put('D3',options.projectName||rows[0]?.projectName||'');put('J3',options.legacyCode||rows[0]?.legacyCode||'');put('V5','所有年度');
   for(const [cell,anchor,label] of [['V3','start','接案日期'],['V4','end','結案日期'],['D4','designLead','設計督導'],['J4','buildLead','工程督導'],['D5','designOwner','設計專案'],['J5','buildOwner','工程專案'],['AA18','reference','參考資料'],['B20','feedback','同事回饋']])note(cell,anchor,label);
   for(const [business,head,r] of [['design',7,9],['construction',13,15]]){
    const stage=rows.filter(x=>x.business===business),part=stage.filter(x=>group.some(p=>p.employeeId===x.employeeId));
    const denominator=pageGroups.length===1?'AF'+r:'('+pageGroups.map((_,page)=>"'結算表"+(page+1)+"'!$AF$"+r).join('+')+')';
    const cols=[];
    group.forEach((p,i)=>{const c=column(4+2*i),data=part.filter(x=>x.employeeId===p.employeeId);cols.push(c);
     note(c+(r+2),'role:'+business+':'+p.employeeId,p.name+' · 參與職務');put(c+head,(p.employeeCode||'')+' '+p.name);amount(c+r,data,undefined,{employeeId:p.employeeId,name:p.name,employeeCode:p.employeeCode,projectId:report.projectId,projectName:options.projectName||rows[0]?.projectName,legacyCode:options.legacyCode||rows[0]?.legacyCode,business,period:'lifetime',start:'1900-01-01',end:'2200-12-31'});
     put(c+(r+1),sum(stage)?sum(data)/sum(stage):0,'IFERROR('+c+r+'/'+denominator+',0)');
    });
    amount('AF'+r,part,cols.map(c=>c+r).join('+')||'0');
    put('AF'+(r+1),sum(stage)?sum(part)/sum(stage):0,cols.map(c=>c+(r+1)).join('+')||'0');
   }finish();
  }
 }else{
  const personal=kind==='personal',a4=kind==='a4';
  const bands=personal?[[8,29],[30,47],[48,56]]:a4?[[6,18],[20,32],[34,46]]:[[6,79],[82,150],[153,186]];
  const stages=['design','construction','internal'];
  const sets=bands.map(([start,end],i)=>chunks(projects.filter(x=>x.business===stages[i]),end-start+1));
  for(const group of chunks(people,personal?1:a4?8:33)){
   for(let ix=0;ix<Math.max(...sets.map(s=>s.length));ix++){
    const last=personal?17:a4?13:38,maxRow=personal?63:a4?48:187;
    const {put,amount,note,finish}=newPage({minCol:personal?2:1,maxCol:last,minRow:2,maxRow,area:'$'+(personal?'B':'A')+'$2:$'+column(last)+'$'+maxRow});
    put('B2',dateLabel+' '+(personal?'專案進度結算表':'公司案件總時數結算'));if(!rows.length)put(personal?'C4':'D6','尚無核定或已匯入工時');
    if(personal)note('D4','note','個人結算備註');
    if(personal)put('P4',(group[0]?.employeeCode||'')+' '+(group[0]?.name||options.name||''));
    else group.forEach((p,i)=>{put(column(5+i)+'4',p.employeeCode||'');put(column(5+i)+'5',p.name);});
    if(a4){put('M4','合計');put('B20','工程專案');put('B34','事務學習');}
    const pageRows=[];
    for(const [section,[start,end]] of bands.entries()){
     const sectionRows=[];
     (sets[section][ix]||[]).forEach((p,i)=>{
      const r=start+i,list=rows.filter(x=>groupKey(x)===groupKey(p)&&group.some(y=>y.employeeId===x.employeeId));pageRows.push(...list);sectionRows.push(...list);
      put('C'+r,p.legacyCode||(p.business==='internal'?p.projectName:''));if(p.projectId)put('D'+r,p.projectName);
      for(let c=5;c<last;c++){
       const detail=personal?list.filter(x=>Number(x.start.slice(5,7))===c-4):list.filter(x=>x.employeeId===group[c-5]?.employeeId);
       const who=personal?group[0]:group[c-5],month=c-4,period=personal?'month':'year';
       const defaults=who?{...p,employeeId:who.employeeId,name:who.name,employeeCode:who.employeeCode,period,
        start:personal?year+'-'+String(month).padStart(2,'0')+'-01':year+'-01-01',
        end:personal?new Date(Date.UTC(year,month,0)).toISOString().slice(0,10):year+'-12-31'}:null;
       amount(column(c)+r,detail,undefined,defaults);
      }
      amount(column(last)+r,list,'SUM(E'+r+':'+column(last-1)+r+')');
     });
     if(!personal){
      const r=a4?end+1:[80,151,187][section];put('C'+r,'合計');
      for(let c=5;c<=last;c++)amount(column(c)+r,c===last?sectionRows:sectionRows.filter(x=>x.employeeId===group[c-5]?.employeeId),'SUM('+column(c)+start+':'+column(c)+end+')');
     }
    }
    if(personal){
     for(let c=5;c<=17;c++){
      const col=column(c),data=c===17?pageRows:pageRows.filter(x=>Number(x.start.slice(5,7))===c-4);
      amount(col+'58',data,c===17?'SUM(E58:P58)':'SUM('+col+'8:'+col+'57)');
      if(options.standard&&ix===0){const normal=c===17?Object.values(options.standard).reduce((a,b)=>a+b,0):options.standard[c-4];if(normal!=null){
       put(col+'59',normal/60,c===17?'SUM(E59:P59)':undefined);
       if(sets.every(s=>s.length===1))put(col+'60',sum(data)-normal/60,col+'58-'+col+'59');
      }}
     }
    }
    finish();
   }
  }
 }
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 files['xl/workbook.xml']=files['xl/workbook.xml'].replace(/<sheets>.*?<\/sheets>/s,'<sheets>'+pages.map((p,i)=>'<sheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" name="'+p.name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets>').replace(/<definedNames(?:\s*\/\s*>|>[\s\S]*?<\/definedNames>)/,'<definedNames>'+pages.map((p,i)=>'<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">'+escape("'"+p.name+"'!"+areas[i])+'</definedName>').join('')+'</definedNames>');
 let rel=files['xl/_rels/workbook.xml.rels'].replace(/<Relationship\b[^>]*Type="[^"]*\/worksheet"[^>]*\/>/g,'').replace(/Id="rId(\d+)"/g,'Id="support$1"');
 for(const [i,s] of sheets.entries()){
  files['xl/worksheets/sheet'+(i+1)+'.xml']=s;
  rel=rel.replace('</Relationships>','<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/></Relationships>');
  if(i)files['[Content_Types].xml']=files['[Content_Types].xml'].replace('</Types>','<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
 }
 files['xl/_rels/workbook.xml.rels']=rel;
 return {pages,workbookPageCount:sheets.length,paper,files,title,download:()=>zipStored(files)};
}

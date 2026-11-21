import {hoursToMinutes} from './model.mjs';
export async function readExcel(file){
 if(file.size>24*1048576||!/\.xlsx$/i.test(file.name))throw Error('請選擇 24 MB 以內的 XLSX 檔案。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const v=new DataView(bytes.buffer),entries=new Map(),entryNames=new Set();let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('不支援的 ZIP 結構');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);if(count>2000||count===65535)throw Error('ZIP 項目過多');let p=start,declaredExpanded=0;
 for(let i=0;i<count;i++){if(p+46>end||v.getUint32(p,true)!==0x02014b50)throw Error('ZIP 清單損壞');const n=v.getUint16(p+28,true),x=v.getUint16(p+30,true),c=v.getUint16(p+32,true),name=new TextDecoder().decode(bytes.slice(p+46,p+46+n));if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.includes('\\')||name.includes('\0')||name.split('/').some(s=>s==='..'||s==='.')||entryNames.has(name.toLowerCase()))throw Error('ZIP 路徑不安全或重複');entryNames.add(name.toLowerCase());declaredExpanded+=v.getUint32(p+24,true);if(declaredExpanded>64*1048576)throw Error('ZIP 展開總大小超過 64 MB');entries.set(name,{method:v.getUint16(p+10,true),flags:v.getUint16(p+8,true),size:v.getUint32(p+24,true),compressed:v.getUint32(p+20,true),offset:v.getUint32(p+42,true)});p+=46+n+x+c;}
 let expanded=0;const cache=new Map();
 async function read(name){if(cache.has(name))return cache.get(name);const e=entries.get(name);if(!e||e.flags&1||e.size>24*1048576||expanded+e.size>64*1048576||![0,8].includes(e.method))throw Error('ZIP 檔案超限或格式不支援');const a=e.offset;if(a+30>start||v.getUint32(a,true)!==0x04034b50)throw Error('ZIP 檔案標頭損壞');const s=a+30+v.getUint16(a+26,true)+v.getUint16(a+28,true);if(s+e.compressed>start)throw Error('ZIP 檔案超出範圍');let data=bytes.slice(s,s+e.compressed);if(e.method===8){const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),parts=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>e.size){await reader.cancel();throw Error('ZIP 解壓大小不符');}parts.push(r.value);}data=new Uint8Array(size);let at=0;for(const b of parts){data.set(b,at);at+=b.length;}}if(data.length!==e.size)throw Error('ZIP 檔案大小不符');expanded+=data.length;cache.set(name,data);return data;}
 const xml=async path=>{
  const text=new TextDecoder().decode(await read(path));
  if(/<!DOCTYPE/i.test(text))throw Error('不支援此 XML 格式。');
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('工作表無法解析。');
  return doc;
 };
 const all=(doc,tag)=>Array.from(doc.getElementsByTagName(tag));
 const shared=entries.has('xl/sharedStrings.xml')?all(await xml('xl/sharedStrings.xml'),'si').map(n=>all(n,'t').map(t=>t.textContent).join('')):[];
 const rels=new Map(all(await xml('xl/_rels/workbook.xml.rels'),'Relationship').filter(n=>n.getAttribute('TargetMode')!=='External').map(n=>[n.getAttribute('Id'),n.getAttribute('Target')]));
 const sheets=[];
 const workbook=await xml('xl/workbook.xml');
 const date1904=['1','true'].includes(all(workbook,'workbookPr')[0]?.getAttribute('date1904'));
 for(const sheet of all(workbook,'sheet')){
  if(sheet.getAttribute('state')==='veryHidden'||sheet.getAttribute('state')==='hidden')continue;
  const target=rels.get(sheet.getAttribute('r:id'));
  if(!target)continue;
  const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path))continue;
  const cells=new Map(),errors=new Map(),types=new Map();let max=0;
  for(const cell of all(await xml(path),'c')){
   const ref=cell.getAttribute('r'),type=cell.getAttribute('t'),raw=all(cell,'v')[0]?.textContent;
   const value=type==='s'?shared[Number(raw)]:type==='inlineStr'?all(cell,'t').map(n=>n.textContent).join(''):raw;
   if(type==='e')errors.set(ref,'Excel 錯誤 '+raw);
   else if(all(cell,'f').length&&(raw==null||raw===''))errors.set(ref,'公式缺少計算結果，請在 Excel 重新計算並儲存');
   if(value!=null&&value!==''){cells.set(ref,value);if(type)types.set(ref,type);}
   if(cells.has(ref)||errors.has(ref))max=Math.max(max,Number(ref.replace(/\D/g,'')));
   if(cells.size>100000||max>15000)throw Error('工作表超過可核對範圍。');
  }
  sheets.push({name:sheet.getAttribute('name'),get:r=>cells.get(r)??'',error:r=>errors.get(r),type:r=>types.get(r),date1904,max});
 }
 const source=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 return {sheets,source};
}
export function column(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
function parsePerson(text){const m=String(text).trim().match(/^(\d{1,8})\s*[-－]?\s*([^\d].*?)$/);return m?{employeeCode:m[1],name:m[2].trim()}:{employeeCode:'',name:text};}
const compact=s=>String(s).replace(/\s/g,'');
function yearOf(s){const found=s.match(/(\d{3,4})\s*年度/);if(!found)throw Error('表頭缺少結算年度。');const n=Number(found[1]);return n<1000?n+1911:n;}
function detailDate(raw,sheet,ref){
 const text=String(raw).trim();
 if(/^\d+$/.test(text)&&[undefined,'n'].includes(sheet.type?.(ref))){
  const serial=Number(text);
  if(!Number.isSafeInteger(serial)||serial<0||serial>2958465||(!sheet.date1904&&serial===60))return '';
  const epoch=sheet.date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,serial<60?31:30);
  return new Date(epoch+serial*86400000).toISOString().slice(0,10);
 }
 const match=text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:T00:00:00(?:\.0+)?Z?)?$/);
 if(!match)return '';
 const iso=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
 const day=new Date(iso+'T00:00:00Z');
 return Number.isFinite(+day)&&day.toISOString().slice(0,10)===iso?iso:'';
}
export function parseSheet(sheet){
 const {get,max}=sheet,title=get('B2'),rows=[],issues=[];
 const getChecked=ref=>{const error=sheet.error?.(ref);if(error)issues.push(ref+'：'+error);return get(ref);};
 if(compact(get('R1'))==='專案月報表'&&get('C3')==='合約進度'){
  const date=get('D2').match(/(\d{4})/),mo=Number(get('E2'));
  if(!date||mo<1||mo>12)return null;
  const y=Number(date[1]),start=y+'-'+String(mo).padStart(2,'0')+'-01',end=new Date(Date.UTC(y,mo,0)).toISOString().slice(0,10);
  const who=parsePerson(get('AL2')),groups=new Map();
  for(const [business,blocks,height] of [['design',[5,13,21,29,37],8],['construction',[46,56],10],['internal',[67],4]]){
   for(const first of blocks){
    const label=get('B'+first).trim(),m=label.match(/^([ISR]\s*\d{5})[\s·：:-]+(.+)$/i);
    for(let r=first;r<first+height;r++){
     const groupName=business==='internal'?(get('H'+r)||'公司內部'):(m?.[2]||label);
     for(const col of ['M','T','AA','AH','AO']){
      const raw=getChecked(col+r);if(raw==='')continue;
      if(!/^\d+(?:\.\d+)?$/.test(raw)){issues.push(col+r+' 的實際時數需核對。');continue;}
      const key=JSON.stringify([business,(m?.[1]||'').replace(/\s+/g,'').toUpperCase(),groupName]);const cell=groups.get(key)||{...who,code:m?.[1]||'',projectName:groupName,business,period:'month',start,end,minutes:0,cell:col+r};
      cell.minutes+=hoursToMinutes(raw,{max:744});groups.set(key,cell);
     }
    }
   }
  }
  return {kind:'balance',legacyMonth:true,rows:[...groups.values()],issues};
 }
 if(get('A1')==='固定 ID'&&get('A5')==='日期'){
  for(let i=6;i<=max;i++){
   const refs='ABCDEFGHIJ'.split('').map(c=>c+i);
   if(refs.every(ref=>get(ref)===''&&!sheet.error?.(ref)))continue;
   const [rawDate,projectName,business,workType,description,plan,actual,id,projectId,revision]=refs.map(getChecked);
   const date=detailDate(rawDate,sheet,'A'+i);
   if(!date){issues.push('A'+i+'：請填寫有效的工作日期。');continue;}
   try{
    rows.push({date,projectName,business,workType,description,plannedMinutes:hoursToMinutes(plan),actualMinutes:hoursToMinutes(actual==='待確認'?'':actual,{optional:true}),id:id||null,projectId:projectId||null,revision:revision||null});
   }catch(e){issues.push('第 '+i+' 列工時：'+e.message);}

  }
  return {kind:'import',employeeId:get('A2'),name:get('B2'),month:get('C2')+'-01',rows,issues};
 }
 const push=(value,row)=>{
  if(value==='')return;
  try{rows.push({...row,minutes:hoursToMinutes(value,{max:166666})});}catch(e){issues.push(row.cell+'：'+e.message);}
 };
 if(/專案進度結算|公司案件總時數結算/.test(compact(title))){
  const personal=compact(title).includes('專案進度結算'),year=yearOf(title);
  const who=parsePerson(get('P4'));let business='';
  const totalColumn=personal?17:(Array.from({length:34},(_,i)=>i+5).find(c=>compact(get(column(c)+'4'))==='合計')||38);
  for(let r=personal?8:6;r<=max;r++){
   const band=compact(get('B'+r));
   if(band.includes('設計專案'))business='design';else if(band.includes('工程專案'))business='construction';else if(band.includes('事務學習'))business='internal';
   if(personal&&band==='合計')break;
   const code=get('C'+r),name=get('D'+r);
   if(!business||(!code&&!name)||[code,name,band].some(x=>compact(x)==='合計'))continue;
   const projectName=business==='internal'?(code||name):name;
   let total=0,filled=0;
   for(let c=5;c<totalColumn;c++){
    const col=column(c),v=getChecked(col+r);if(v==='')continue;
    const person=personal?who:{employeeCode:get(col+'4'),name:get(col+'5')};
    const mo=String(c-4).padStart(2,'0'),monthEnd=new Date(Date.UTC(year,c-4,0)).toISOString().slice(0,10);
    push(v,{...person,business,code:business==='internal'?'':code,projectName,period:personal?'month':'year',
      start:personal?year+'-'+mo+'-01':year+'-01-01',end:personal?monthEnd:year+'-12-31',cell:col+r});
    filled++;total+=Number(v);
   }
   const sum=get(column(totalColumn)+r);
   if(sum!==''&&(!Number.isFinite(Number(sum))||Math.abs(total-Number(sum))>0.0001))issues.push('第 '+r+' 列明細 '+total+' 小時，原表合計 '+sum+' 小時。');
  }
  return {kind:'balance',rows,issues};
 }
 if(compact(title).includes('所有年度公司專案時數結算')){
  for(const [business,head,line] of [['design',7,9],['construction',13,15]]){
   let total=0;
   for(let c=4;c<=30;c+=2){
    const col=column(c),v=getChecked(col+line);if(v==='')continue;
    const person=parsePerson(get(col+head));if(!person.name&&Number(v)===0)continue;
    push(v,{...person,business,code:get('J3'),projectName:get('D3').trim(),period:'lifetime',start:'1900-01-01',end:'2200-12-31',cell:col+line});total+=Number(v);
   }
   const sum=get('AF'+line);if(sum!==''&&(!Number.isFinite(Number(sum))||Math.abs(total-Number(sum))>0.0001))issues.push('第 '+line+' 列合計與分項不符。');
  }
  return {kind:'balance',rows,issues};
 }
 return null;
}

import {customerSheets,isCustomerPosition,isCustomerColumn} from './quotation.visibility.js';

const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack = 'http://schemas.openxmlformats.org/package/2006';
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]);
const bounded = (n, min, max, fallback) => Number.isFinite(n) && n >= min && n <= max ? n : fallback;

function permitted(sheet, r, c) {
  return isCustomerPosition(sheet,r,c) && !sheet.revealedRows?.has(r);
}
function allowedRange(sheet, start, end) {
  if (!permitted(sheet,start.r,start.c) || !permitted(sheet,end.r,end.c)) return false;
  const between = (values,a,b) => [...values].some(v => v >= Math.min(a,b) && v <= Math.max(a,b));
  return !between(sheet.hiddenRows,start.r,end.r) && !between(sheet.revealedRows || [],start.r,end.r) && !between(sheet.hiddenCols,start.c,end.c) && !between(sheet.internalCols || [],start.c,end.c);
}

// Copy only an explicit formula vocabulary and references inside the exported sheets.
// No formula cache from the uploaded archive is reused.
function safeFormula(formula, sheet, sheets, XLSX) {
  const token = /\s+|#REF!|(?:SUM|AVERAGE|MIN|MAX|ROUND|ROUNDUP|ROUNDDOWN|ABS|ROW|TODAY|IFERROR|IF)(?=\s*\()|(?:(?:'((?:[^']|'')+)'|([\p{L}\d_.]+))!)?(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?|\d+(?:\.\d+)?(?:E[+-]?\d+)?|[()+*/%,^=<.>\-]/giyu;
  let pos = 0;
  while (pos < formula.length) {
    const m = token.exec(formula);
    if (!m || m.index !== pos) return false;
    pos = token.lastIndex;
    if (m[3]) {
      const name = m[1]?.replace(/''/g,"'") ?? m[2];
      const target = name === undefined ? sheet : sheets.get(name);
      const point = a => XLSX.utils.decode_cell(a.replace(/\$/g,'').toUpperCase());
      if (!target || !allowedRange(target,point(m[3]),point(m[4] || m[3]))) return false;
    }
  }
  return true;
}
const fontNames = new Set(['Calibri','Arial','Carlito','微軟正黑體','Microsoft JhengHei','Noto Sans CJK TC','新細明體','PMingLiU','標楷體','DFKai-SB']);
const rgb = v => /^#[0-9a-f]{6}$/i.test(v || '') ? 'FF'+v.slice(1).toUpperCase() : '';
const lineStyles=new Set(['thin','medium','dashed','dotted','thick','double','hair','mediumDashed','dashDot','mediumDashDot','dashDotDot','mediumDashDotDot','slantDashDot']);
function visibleBorder(border) {
  return ['left','right','top','bottom'].map(side=>{
    const edge=border?.[side],color=rgb(edge?.color);
    return edge && lineStyles.has(edge.style)?'<'+side+' style="'+edge.style+'">'+(color?'<color rgb="'+color+'"/>':'')+'</'+side+'>':'<'+side+'/>';
  }).join('');
}
function pageSettings(view) {
  const defaults={left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2};
  const number=(v,max,base)=>v!=null && v!=='' ? bounded(Number(v),0,max,base) : base;
  const margins=Object.entries(defaults).map(([k,v])=>k+'="'+number(view?.margins?.[k],49,v)+'"').join(' ');
  const orientation=['landscape','portrait'].includes(view?.orientation)?' orientation="'+view.orientation+'"':'';
  return '<pageMargins '+margins+'/>'+ '<pageSetup paperSize="'+number(view?.paperSize,256,9)+'" fitToWidth="'+number(view?.fitToWidth,9999,1)+'" fitToHeight="'+number(view?.fitToHeight,9999,0)+'"'+orientation+'/>';
}
function styleCatalog() {
  const entries = [], index = new Map(), formats=new Map();
  function get(appearance, cell, format) {
    const s=appearance || {};
    const visibleFormat=format || s.numberFormat || '';
    let numberFormat=({'0':1,'0.00':2,'#,##0':3,'#,##0.00':4,'0%':9,'0.00%':10})[visibleFormat] || (cell?.value instanceof Date ? 14 : 0);
    if(!numberFormat && visibleFormat.length<=64 && /^(?:[0#?,.%()$ +/;:-]|yyyy|yy|mm|dd|hh|ss|m|d|h|s)+$/i.test(visibleFormat)){
      if(!formats.has(visibleFormat))formats.set(visibleFormat,164+formats.size);
      numberFormat=formats.get(visibleFormat);
    }
    const style={border:visibleBorder(s.border),font:fontNames.has(s.family)?s.family:'Calibri',size:bounded(s.size,1,100,11),bold:!!s.bold,italic:!!s.italic,color:rgb(s.color),fill:rgb(s.background),horizontal:['left','right','center','justify'].includes(s.horizontal)?s.horizontal:'',vertical:['top','center','bottom'].includes(s.vertical)?s.vertical:'',wrap:!!s.wrap,numberFormat};
    const key=JSON.stringify(style);
    if (!index.has(key)) {index.set(key,entries.length);entries.push(style);}
    return index.get(key);
  }
  get();
  return {get, build() {
    const fonts = entries.map(s=>'<font>'+(s.bold?'<b/>':'')+(s.italic?'<i/>':'')+'<sz val="'+s.size+'"/>'+(s.color?'<color rgb="'+s.color+'"/>':'')+'<name val="'+xml(s.font)+'"/></font>');
    const fills=['<fill><patternFill patternType="none"/></fill>','<fill><patternFill patternType="gray125"/></fill>'];
    const xfs=entries.map((s,i)=>{
      const fill=s.fill?fills.push('<fill><patternFill patternType="solid"><fgColor rgb="'+s.fill+'"/><bgColor indexed="64"/></patternFill></fill>')-1:0;
      const align=(s.horizontal?' horizontal="'+s.horizontal+'"':'')+(s.vertical?' vertical="'+s.vertical+'"':'')+(s.wrap?' wrapText="1"':'');
      return '<xf xfId="0" fontId="'+i+'" fillId="'+fill+'" borderId="'+i+'" applyBorder="1" numFmtId="'+s.numberFormat+'" applyAlignment="1"><alignment'+align+'/></xf>';
    });
    const fmtXml=[...formats].map(([format,id])=>'<numFmt numFmtId="'+id+'" formatCode="'+xml(format)+'"/>').join('');
    return '<styleSheet xmlns="'+main+'"><numFmts count="'+formats.size+'">'+fmtXml+'</numFmts><fonts count="'+fonts.length+'">'+fonts.join('')+'</fonts><fills count="'+fills.length+'">'+fills.join('')+'</fills><borders count="'+entries.length+'">'+entries.map(s=>'<border>'+s.border+'</border>').join('')+'</borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }};
}
function cellXml(address, style, cell, formula, cached) {
  const start='<c r="'+address+'" s="'+style+'"';
  if (formula) return start+'><f>'+xml(formula)+'</f>'+(Number.isFinite(cached)?'<v>'+cached+'</v>':'')+'</c>';
  const v=cell?.value;
  if (v == null || v === '') return start+'/>';
  if (v instanceof Date && Number.isFinite(+v)) return start+' t="d"><v>'+v.toISOString()+'</v></c>';
  if (typeof v==='number' && Number.isFinite(v)) return start+'><v>'+v+'</v></c>';
  if (typeof v==='boolean') return start+' t="b"><v>'+Number(v)+'</v></c>';
  if (cell.type==='e') return start+' t="e"><v>#VALUE!</v></c>';
  return start+' t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
}
function worksheet(model, sheet, sheets, styles, valueAt) {
  const range=sheet.customerRange||sheet.range, presentation=model.presentation?.sheets?.[sheet.name] || {};
  const source=model.workbook.Sheets[sheet.name], rows=new Map(), XLSX=model.XLSX;
  const pos = a => XLSX.utils.decode_cell(a);
  const addresses=new Set([...sheet.cells.keys(),...Object.keys(presentation.cellStyles||{})]);
  for (const address of addresses) {
    if (!/^[A-Z]{1,3}[1-9]\d*$/.test(address)) continue;
    const {r,c}=pos(address);
    if (!permitted(sheet,r,c)) continue;
    const cell=sheet.cells.get(address);
    const formula=cell?.formula;
    if (formula && !safeFormula(formula,sheet,sheets,XLSX))
      throw Error(sheet.displayName+' '+address+' 的公式參照超出客戶範圍，或使用目前無法驗證的函數。請先確認對外報價數值。');
    const style=styles.get(presentation.cellStyles?.[address],cell,source[address]?.z);
    if (!rows.has(r)) rows.set(r,[]);
    rows.get(r).push({c,xml:cellXml(address,style,cell,formula,formula?valueAt(sheet.name,address):null)});
  }
  const cols=[],lines=[];
  for(let c=range.s.c;c<=range.e.c;c++){
    const width=bounded(source['!cols']?.[c]?.width ?? ((presentation.cols?.[c]?.width-5)/7),0.1,255,10);
    cols.push('<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+width+'" customWidth="1"'+(!isCustomerColumn(sheet,c)?' hidden="1"':'')+'/>');
  }
  for(let r=range.s.r;r<=range.e.r;r++){
    const hidden=sheet.hiddenRows.has(r)||sheet.revealedRows?.has(r);
    const height=bounded(source['!rows']?.[r]?.hpt ?? presentation.rows?.[r]?.height*.75,1,409,0);
    if (!rows.has(r)&&!height&&!hidden) continue;
    lines.push('<row r="'+(r+1)+'"'+(height?' ht="'+height+'" customHeight="1"':'')+(hidden?' hidden="1"':'')+'>'+(rows.get(r)||[]).sort((a,b)=>a.c-b.c).map(x=>x.xml).join('')+'</row>');
  }
  const merges=sheet.merges.filter(m=>allowedRange(sheet,m.s,m.e)).map(m=>'<mergeCell ref="'+XLSX.utils.encode_range(m)+'"/>');
  return '<worksheet xmlns="'+main+'"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><cols>'+cols.join('')+'</cols><sheetData>'+lines.join('')+'</sheetData>'+(merges.length?'<mergeCells count="'+merges.length+'">'+merges.join('')+'</mergeCells>':'')+pageSettings(presentation.printSettings)+'</worksheet>';
}
export async function buildCustomerExport(model,JSZip,evaluate) {
  const selected=customerSheets(model);
  if(!selected.length) throw Error('沒有可匯出的客戶工作表。');
  if(selected.some(s=>s.truncatedRows||s.truncatedCols)) throw Error('工作表超過可完整讀取的範圍，請從原始檔另存客戶報價。');
  const sheets=new Map(selected.map(s=>[s.name,s])),styles=styleCatalog(),zip=new JSZip();
  const values=new Map(),working=new Set();
  function valueAt(name,address) {
    const key=JSON.stringify([name,address]);
    if(values.has(key))return values.get(key);
    if(working.has(key))return NaN;
    const sh=sheets.get(name),pos=model.XLSX.utils.decode_cell(address);
    if(!sh||!permitted(sh,pos.r,pos.c))return NaN;
    const cell=sh.cells.get(address);
    if(!cell?.formula)return cell?.value??'';
    if(!safeFormula(cell.formula,sh,sheets,model.XLSX))return NaN;
    working.add(key);
    try {
      const out=evaluate?.(cell.formula,{sheetName:name,address,getValue:(dep,ref)=>{
        const val=valueAt(dep,ref);
        if(typeof val==='number'&&!Number.isFinite(val))throw Error('未能核對公式');
        return val;
      }});
      const value=out?.ok&&Number.isFinite(out.value)?out.value:NaN;
      values.set(key,value);return value;
    } catch {return NaN;} finally {working.delete(key);}
  }
  const types=[],rels=[],tabs=[],names=[];
  const relationship=(id,type,target)=>'<Relationship Id="'+id+'" Type="'+rel+'/'+type+'" Target="'+target+'"/>';
  for(const [i,s] of selected.entries()){
    const part='worksheets/sheet'+(i+1)+'.xml',id='s'+(i+1);
    zip.file('xl/'+part,worksheet(model,s,sheets,styles,valueAt));
    tabs.push('<sheet name="'+xml(s.name)+'" sheetId="'+(i+1)+'" r:id="'+id+'"/>');
    const area=model.XLSX.utils.encode_range(s.customerRange||s.range).replace(/([A-Z]+)(\d+)/g,'$$$1$$$2');
    names.push('<definedName name="_xlnm.Print_Area" localSheetId="'+i+'">'+xml("'"+s.name.replace(/'/g,"''")+"'!"+area)+'</definedName>');
    rels.push(relationship(id,'worksheet',part));
    types.push('<Override PartName="/xl/'+part+'" ContentType="'+mime+'.worksheet+xml"/>');
  }
  zip.file('xl/styles.xml',styles.build());
  zip.file('xl/workbook.xml','<workbook xmlns="'+main+'" xmlns:r="'+rel+'"><sheets>'+tabs.join('')+'</sheets><definedNames>'+names.join('')+'</definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
  zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="'+pack+'/relationships">'+rels.join('')+relationship('styles','styles','styles.xml')+'</Relationships>');
  zip.file('_rels/.rels','<Relationships xmlns="'+pack+'/relationships">'+relationship('book','officeDocument','xl/workbook.xml')+'</Relationships>');
  zip.file('[Content_Types].xml','<Types xmlns="'+pack+'/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="'+mime+'.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="'+mime+'.styles+xml"/>'+types.join('')+'</Types>');
  return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:mime+'.sheet'});
}

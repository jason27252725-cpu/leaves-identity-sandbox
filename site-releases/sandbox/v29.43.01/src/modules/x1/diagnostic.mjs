export const stageNames={
  inspect:'讀取工作簿',audit:'顯示核對結果',explain:'說明所選項目',preview:'產生差異預覽',
  confirm:'確認差異',commit:'核對並寫入修正',apply:'驗證寫入結果',undo:'復原修正',cancelled:'已取消',error:'未完成',
  report:'讀取工時條件',reportResult:'收到工時結果'
};
const traceKinds = new Set(['資料查詢','伺服器 SOP','模型回覆','模型回答','判讀與回答','整理摘要','報表條件','x1 核對','x1 報表']);
const number=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:undefined;
export const safeTraceId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export const safeTraceCode=value=>typeof value==='string'&&/^[A-Z][A-Z_0-9]{1,60}$/.test(value)?value:undefined;
export function diagnosticStep(event) {
  const {stage,code,id,revision,counts={}}=event||{};
  if(!Object.hasOwn(stageNames,stage)||!safeTraceId(id))return null;
  const step={stage,revision:number(Number(revision),1e9),code:safeTraceCode(code)};
  if(typeof event.engineVersion==='string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(event.engineVersion))step.engineVersion=event.engineVersion;
  for(const key of ['offset','items','sourceCount','sopRevision','lines','requests','projects','changes','selectedIndex']){
    const v=number(counts?.[key],1e6);if(v!==undefined)step[key]=v;
  }
  if(Array.isArray(counts?.sourceLines)){
    const lines=[...new Set(counts.sourceLines.filter(line=>Number.isSafeInteger(line)&&line>0&&line<=1e6))].slice(0,24);
    if(lines.length)step.sourceLines=lines;
  }
  return step;
}
export function safeGatewayTrace(trace) {
  if(!trace || typeof trace!=='object')return null;
  const events=[];
  for(const raw of (Array.isArray(trace.events)?trace.events:[]).slice(0,60)) {
    if(!raw || !traceKinds.has(raw.kind))continue;
    const event={kind:raw.kind};
    for(const key of ['ms','tokens','headersMs','http','matched','shown','revision','candidates','injected','duration']){
      const v=number(raw[key],1e9);if(v!==undefined)event[key]=v;
    }
    if(typeof raw.model==='string'&&/^[a-z0-9_./:-]{1,100}$/i.test(raw.model))event.model=raw.model;
    if(safeTraceCode(raw.error))event.error=raw.error;
    events.push(event);
  }
  return {events,modelCalls:number(trace.modelCalls,1000),queries:number(trace.queries,1000)};
}

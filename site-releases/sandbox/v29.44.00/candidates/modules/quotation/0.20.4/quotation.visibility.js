// One outbound-data policy shared by chat, audit and assistant edits.
export function hiddenSheet(model,sheet){const meta=model?.workbook?.Workbook?.Sheets||[];return !!(meta.find(x=>x.name===sheet.name)?.Hidden||(!meta.some(x=>x.name)&&meta[sheet.index]?.Hidden));}
export const internalSheet=sheet=>/(成本|內部|廠商|毛利|利潤|cost|vendor|profit|margin)/i.test(sheet.displayName||sheet.name||'');
export function customerSheets(model){return(model?.sheets||[]).filter(s=>!hiddenSheet(model,s)&&!internalSheet(s));}
export function contextSheets(model,{accessRole='member',query=''}={}){const allowInternal=['owner','admin'].includes(accessRole)&&/(內部|廠商|成本|實際數量|追加減|毛利|利潤)/.test(query);return(model?.sheets||[]).filter(s=>!hiddenSheet(model,s)&&(!internalSheet(s)||allowInternal));}
export function visibleContextModel(model,options={}){
 const sheets=contextSheets(model,options).map(s=>['owner','admin'].includes(options.accessRole)?s:{...s,hiddenRows:new Set([...s.hiddenRows,...(s.revealedRows||[])])}),names=new Set(sheets.map(s=>s.name)),activeSheet=names.has(model.activeSheet)?model.activeSheet:sheets[0]?.name||'';
 return{...model,sheets,activeSheet,sheetNames:sheets.map(s=>s.name),audit:null};
}

export function visiblePosition(sheet, range, row, col) {
  return !!range && Number.isInteger(row) && Number.isInteger(col) &&
    row >= range.s.r && row <= range.e.r && col >= range.s.c && col <= range.e.c &&
    !sheet.hiddenRows.has(row) && !sheet.hiddenCols.has(col);
}

export function exactSheet(sheets, name) {
  const exact = sheets.find(s => s.name === name);
  if (exact) return exact;
  const matches = sheets.filter(s => s.displayName === name);
  return matches.length === 1 ? matches[0] : null;
}

export function isCustomerColumn(sheet,col) {
  return !sheet.hiddenCols.has(col) && !sheet.internalCols?.has(col);
}
export function isCustomerPosition(sheet,row,col) {
  return isCustomerColumn(sheet,col) && visiblePosition(sheet,sheet.customerRange || sheet.range,row,col);
}

import Papa from 'papaparse';
import {LIMITS,checkFile,fail,textFromBytes} from './validation.js';
export const DATA_POLICY='UTF-8; comma-separated CSV; unique non-empty headers; consistent CSV row lengths. JSON uses flat object arrays, first-seen column order, and empty cells for null or missing values. Numbers and booleans become text. CSV values remain strings. Spreadsheet formulas are preserved: open untrusted CSV as text, not as a spreadsheet.';
function sized(text) {if(new TextEncoder().encode(text).length>LIMITS.outputBytes)fail('The converted data exceeds the output limit.');return text;}
export function csvTextToJson(text) {
  if(!text.trim())fail('The CSV is empty.');
  const parsed=Papa.parse(text.replace(/^\uFEFF/,''),{delimiter:',',skipEmptyLines:false,dynamicTyping:false});
  if(parsed.errors.length)fail(`Malformed CSV: ${parsed.errors[0].message}`);
  const rows=parsed.data;
  if(/[\r\n]$/.test(text)&&rows.at(-1)?.length===1&&rows.at(-1)[0]==='')rows.pop();
  const headers=rows.shift();
  if(!headers?.length||headers.length>LIMITS.columns||headers.some(x=>!x.trim())||new Set(headers).size!==headers.length)fail('CSV headers must be non-empty and unique (up to 200 columns).');
  if(rows.length>LIMITS.rows)fail('The CSV exceeds 10,000 data rows.');
  if(rows.some(row=>row.length!==headers.length))fail('Every CSV row must have the same number of cells as the header.');
  const records=rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]])));
  return {text:sized(JSON.stringify(records,null,2)+'\n'),count:records.length,mime:'application/json',extension:'json'};
}
export function jsonTextToCsv(text) {
  let records;try {records=JSON.parse(text.replace(/^\uFEFF/,''));}catch {fail('This file contains malformed JSON.');}
  if(!Array.isArray(records)||!records.length)fail('Choose a non-empty JSON array of flat objects.');
  if(records.length>LIMITS.rows)fail('The JSON exceeds 10,000 records.');
  const columns=[];const seen=new Set();
  for(const row of records) {
    if(!row||typeof row!=='object'||Array.isArray(row))fail('Every JSON record must be a flat object.');
    for(const [key,value] of Object.entries(row)) {
      if(!key.trim())fail('JSON column names must be non-empty.');
      if(value!==null&&typeof value==='object')fail('Nested objects and arrays are not supported.');
      if(!seen.has(key)){seen.add(key);columns.push(key);}
      if(columns.length>LIMITS.columns)fail('The JSON exceeds 200 columns.');
    }
  }
  if(!columns.length)fail('The JSON objects contain no columns.');
  const rows=records.map(row=>columns.map(k=>!Object.hasOwn(row,k)||row[k]==null?'':String(row[k])));
  const csv=Papa.unparse({fields:columns,data:rows},{delimiter:',',newline:'\r\n',escapeFormulae:false});
  return {text:sized(csv+'\r\n'),count:records.length,mime:'text/csv;charset=utf-8',extension:'csv'};
}
export async function convertData(file,output) {
  checkFile(file,LIMITS.dataBytes);const text=textFromBytes(new Uint8Array(await file.arrayBuffer()));
  const result=output==='json'?csvTextToJson(text):output==='csv'?jsonTextToCsv(text):fail('Choose CSV or JSON output.');
  return {...result,blob:new Blob([result.text],{type:result.mime})};
}

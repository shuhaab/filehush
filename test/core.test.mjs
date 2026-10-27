import test from 'node:test';import assert from 'node:assert/strict';import {zipSync,strToU8} from 'fflate';
import {csvTextToJson,jsonTextToCsv} from '../src/data.js';
import {inspectImage,inspectZip,outputName,checkDimensions,qualityValue,textFromBytes,LIMITS} from '../src/validation.js';
test('CSV preserves strings, Unicode, quotes, newlines and dangerous object keys',()=>{
  const r=csvTextToJson('\uFEFFid,name,__proto__,note\r\n001,"Zoë, Ada",safe,"a\n""b"""\r\n');
  assert.deepEqual(JSON.parse(r.text),[{id:'001',name:'Zoë, Ada',['__proto__']:'safe',note:'a\n"b"'}]);assert.equal(r.count,1);
});
test('CSV strict headers and row lengths',()=>{
  for(const text of ['a,a\n1,2','a,\n1,2','a,b\n1','a,b\n"unterminated',''])assert.throws(()=>csvTextToJson(text));
  assert.equal(csvTextToJson('a,b\n').text,'[]\n');assert.deepEqual(JSON.parse(csvTextToJson('a,b\n,\n').text),[{a:'',b:''}]);
});
test('JSON columns, scalar/null/missing mapping and formula preservation',()=>{
  const r=jsonTextToCsv('[{"id":"001","a":null,"f":"=1+1"},{"id":2,"b":true}]');
  assert.equal(r.text,'id,a,f,b\r\n001,,=1+1,\r\n2,,,true\r\n');
  assert.deepEqual(JSON.parse(csvTextToJson(r.text).text)[0],{id:'001',a:'',f:'=1+1',b:''});
});
test('JSON missing columns never read inherited JavaScript properties',()=>{
  const csv=jsonTextToCsv('[{"id":"1","constructor":"own","toString":"label","__proto__":"value"},{"id":"2"}]').text;
  assert.equal(csv,'id,constructor,toString,__proto__\r\n1,own,label,value\r\n2,,,\r\n');
});
test('JSON rejects unsupported shapes and malformed text',()=>{
  for(const s of ['[]','{}','[null]','[[]]','[{"x":{}}]','[{"x":[]}]','[{}]','[{" ":1}]','broken'])assert.throws(()=>jsonTextToCsv(s));
  assert.throws(()=>jsonTextToCsv(JSON.stringify(Array.from({length:LIMITS.rows+1},()=>({a:'x'})))));
});
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
test('PNG signature/dimensions and animation/truncation rejection',()=>{
  assert.deepEqual(inspectImage(png),{mime:'image/png',width:1,height:1});
  const animated=new Uint8Array(png.length+20);animated.set(png.subarray(0,33));new DataView(animated.buffer).setUint32(33,8);animated.set(strToU8('acTL'),37);animated.set(png.subarray(33),53);
  assert.throws(()=>inspectImage(animated),/Animated/);assert.throws(()=>inspectImage(png.subarray(0,40)));assert.throws(()=>inspectImage(strToU8('<svg/>')));
});
test('WebP animation flags and malformed chunks are rejected',()=>{
  const b=new Uint8Array(30);b.set(strToU8('RIFF'));new DataView(b.buffer).setUint32(4,22,true);b.set(strToU8('WEBPVP8X'),8);new DataView(b.buffer).setUint32(16,10,true);b[20]=2;
  assert.throws(()=>inspectImage(b),/Animated/);b[20]=0;assert.equal(inspectImage(b).width,1);b[4]=0;assert.throws(()=>inspectImage(b));
});
test('dimension, encoding, quality and filename boundaries',()=>{
  assert.throws(()=>checkDimensions(8193,1));assert.throws(()=>checkDimensions(4000,4000));assert.throws(()=>qualityValue(NaN));assert.throws(()=>qualityValue(1.1));
  assert.throws(()=>textFromBytes(new Uint8Array([255,254])));assert.equal(outputName('../evil<name>.png','jpg'),'.._evil_name_.jpg');
});
function docxZip(extra={}){return zipSync({'[Content_Types].xml':strToU8('<Types/>'),'_rels/.rels':strToU8('<Relationships/>'),'word/document.xml':strToU8('<document/>'),...extra});}
test('DOCX ZIP directory is bounded and validates package paths',()=>{
  assert.equal(inspectZip(docxZip()).size,3);assert.throws(()=>inspectZip(new Uint8Array(30)));
  assert.throws(()=>inspectZip(docxZip({'../evil.xml':strToU8('bad')})),/path/);
  assert.throws(()=>inspectZip(docxZip({'bomb.bin':new Uint8Array(1_000_000)})),/oversized/);
  const malformed=docxZip();new DataView(malformed.buffer).setUint32(malformed.length-6,0,true);assert.throws(()=>inspectZip(malformed));
});

import {Inflate} from 'fflate';
import {renderAsync} from 'docx-preview';
import {Document,Paragraph,TextRun,Packer} from 'docx';
import {LIMITS,checkFile,inspectZip,inspectImage,textFromBytes,fail} from './validation.js';
import {openPdf,pdfjs} from './pdf.js';
export const DOCX_SUPPORT='PDF to DOCX supports simple horizontal text and blank pages. Graphics, images, annotations, forms, rotated text, and ambiguous layouts are rejected. No OCR. Output is editable with approximate line and page layout.';
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function validateDocxPackage(bytes) {
  const directory=inspectZip(bytes);const entries=Object.create(null);let actual=0;
  for(const [name,entry] of directory) {
    const data=new Uint8Array(entry.raw);let written=0;
    const accept=chunk=>{written+=chunk.length;actual+=chunk.length;if(written>entry.raw||actual>LIMITS.zipBytes)fail('DOCX decompression exceeded its declared limits.');data.set(chunk,written-chunk.length);};
    if(entry.method===0)accept(bytes.subarray(entry.offset,entry.offset+entry.compressed));
    else {
      const inflater=new Inflate(accept);
      for(let p=0;p<entry.compressed;p+=1024)inflater.push(bytes.subarray(entry.offset+p,entry.offset+Math.min(entry.compressed,p+1024)),p+1024>=entry.compressed);
    }
    if(written!==entry.raw||crc32(data)!==entry.crc)fail('The DOCX contains corrupt ZIP data.');
    entries[name]=data;
  }
  for(const [name,data] of Object.entries(entries)) {
    const expected=directory.get(name);
    if(!expected||data.length!==expected.raw||actual>LIMITS.zipBytes)fail('DOCX decompression exceeded its declared limits.');
    if(/(?:vbaProject|embeddings\/|activeX\/|altChunk|\.html?$|\.mht$)/i.test(name))fail('This DOCX contains unsupported embedded or active content.');
    if(/^word\/media\//i.test(name)&&!name.endsWith('/')) {
      if(!/\.(png|jpe?g)$/i.test(name)||!['image/png','image/jpeg'].includes(inspectImage(data).mime))fail('Only embedded still JPG/PNG document images are supported.');
    }
    if(/\.(xml|rels)$/i.test(name)) {
      const xml=textFromBytes(data);
      if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('Document entities are not supported.');
      const parsed=new DOMParser().parseFromString(xml,'application/xml');
      if(parsed.getElementsByTagName('parsererror').length)fail('This DOCX contains malformed XML.');
      for(const el of parsed.getElementsByTagName('*')) {
        if(['altChunk','object','oleObject','control','pict'].includes(el.localName))fail('This DOCX contains unsupported embedded content or legacy drawings.');
        if(['Default','Override'].includes(el.localName)) {
          const contentType=(el.getAttribute('ContentType')||'').toLowerCase();
          if(/macroenabled|vba|oleobject|activex/.test(contentType))fail('Unsupported DOCX content type.');
          const part=el.getAttribute('PartName')||el.getAttribute('Extension')||'';
          if(/(?:\.|^)png$/i.test(part)&&contentType!=='image/png'||/(?:\.|^)jpe?g$/i.test(part)&&contentType!=='image/jpeg')fail('Unsupported embedded image content type.');
        }
        if(el.localName==='Relationship') {
          const target=el.getAttribute('Target')||'';
          if((el.getAttribute('TargetMode')||'').toLowerCase()==='external'||/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target))fail('This DOCX references external resources or links. Remove external relationships before converting.');
        }
      }
    }
  }
  return entries;
}
let printPreparation;
export function prepareDocxPreview(host) {
  if(printPreparation)return printPreparation;
  printPreparation=(async()=>{
    const frame=document.createElement('iframe');frame.title='Document preview for printing';frame.className='document-frame';frame.setAttribute('sandbox','allow-same-origin allow-modals');
    const loaded=new Promise((resolve,reject)=>{frame.addEventListener('load',resolve,{once:true});frame.addEventListener('error',()=>reject(new Error('Document preview could not open.')),{once:true});});
    frame.src='./print.html';host.append(frame);await loaded;
    if(!frame.contentDocument?.getElementById('document'))fail('This browser cannot open the isolated document preview.');
    return frame;
  })();
  return printPreparation;
}
function clearPrintContent(frame) {
  frame.contentDocument?.getElementById('document')?.replaceChildren();
  const styles=frame.contentDocument?.getElementById('document-styles');if(styles)styles.textContent='';
}
export async function renderDocxForPrint(file,host,active=()=>true) {
  checkFile(file,LIMITS.docxBytes);const bytes=new Uint8Array(await file.arrayBuffer());validateDocxPackage(bytes);
  if(!active())fail('Conversion was cleared.');
  const frame=await prepareDocxPreview(host);const doc=frame.contentDocument;
  clearPrintContent(frame);
  try {
    await renderAsync(bytes,doc.getElementById('document'),doc.getElementById('document-styles'),{renderAltChunks:false,ignoreFonts:true,useBase64URL:true,breakPages:true,ignoreLastRenderedPageBreak:false,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,experimental:false});
    if(!active()){clearPrintContent(frame);fail('Conversion was cleared.');}
    for(const element of doc.querySelectorAll('a'))element.removeAttribute('href');
    if(doc.querySelectorAll('section.docx').length>LIMITS.pages)fail('The DOCX preview exceeds 40 explicit pages.');
    return {count:doc.querySelectorAll('section.docx').length,print(){if(!frame.isConnected)fail('Preview was cleared.');frame.contentWindow.focus();frame.contentWindow.print();},dispose(){clearPrintContent(frame);}};
  }catch(error){clearPrintContent(frame);throw error;}
}
const unsupportedOps=new Set(Object.entries(pdfjs.OPS).filter(([name])=>/^(paint|fill|eoFill|stroke|closeFill|closeStroke|closeEOFill|shading|rawFill|constructPath|beginGroup|beginAnnotation|clip|eoClip|setGState|setFillTransparent|setStrokeTransparent)/.test(name)).map(([,code])=>code));
export function reconstructTextPage(content,ops,annotations,rotation=0) {
  if(rotation!==0)fail('rotated page');
  if(annotations.length)fail('annotations or links');
  if(ops.fnArray.some(op=>unsupportedOps.has(op)))fail('graphics, images or complex painting');
  for(let i=0;i<ops.fnArray.length;i++)if(ops.fnArray[i]===pdfjs.OPS.setTextRenderingMode&&ops.argsArray[i][0]!==0)fail('nonstandard or invisible text');
  const items=content.items.filter(item=>'str'in item&&item.str.length);
  const painted=ops.fnArray.some(op=>[pdfjs.OPS.showText,pdfjs.OPS.showSpacedText,pdfjs.OPS.nextLineShowText,pdfjs.OPS.nextLineSetSpacingShowText].includes(op));
  if(!items.length){if(painted)fail('text could not be extracted');return [];}
  let lastY=Infinity,lastX=-Infinity,lastEnd=0,line=null;const lines=[];
  for(const item of items) {
    const [a,b,c,d,x,y]=item.transform;
    if(![a,b,c,d,x,y,item.width,item.height].every(Number.isFinite)||item.dir!=='ltr'||a<=0||d<=0||Math.abs(b)>0.01||Math.abs(c)>0.01)fail('vertical, RTL or transformed text');
    if(/[\uFFFD\u0000-\u0008\u000b\u000c\u000e-\u001f\uE000-\uF8FF]/u.test(item.str))fail('unreliable character mapping');
    const size=Math.abs(d);
    if(!item.str.trim()&&item.width>Math.max(36,size*4))fail('ambiguous columns or wide text gaps');
    if(y>lastY+2)fail('ambiguous reading order or columns');
    if(!line||Math.abs(lastY-y)>Math.max(2,size*.25)) {
      line={runs:[],x,y};lines.push(line);lastX=-Infinity;lastEnd=x;
    }
    if(x<lastX-1||x-lastEnd>Math.max(36,size*4))fail('ambiguous columns or positioned text');
    if(lines.length>1&&Math.abs(x-lines[0].x)>180&&line.runs.length===0)fail('ambiguous indentation or columns');
    const font=content.styles[item.fontName]||{};
    line.runs.push({text:(line.runs.length&&x-lastEnd>size*.15?' ':'')+item.str,size:Math.max(8,Math.min(72,size)),bold:/bold/i.test(font.fontFamily||''),italics:/italic/i.test(font.fontFamily||'')});
    lastY=y;lastX=x;lastEnd=x+item.width;
  }
  return lines;
}
export async function pdfToDocx(file,active=()=>true) {
  const opened=await openPdf(file);const pages=[],rejected=[];let characters=0;
  try {
    const fields=await opened.doc.getFieldObjects();if(fields&&Object.keys(fields).length)fail('PDF forms are not supported for editable DOCX conversion.');
    const attachments=await opened.doc.getAttachments();if(attachments&&Object.keys(attachments).length)fail('PDFs with embedded attachments are not supported for DOCX conversion.');
    const optional=await opened.doc.getOptionalContentConfig();if(Array.from(optional).length)fail('PDFs with optional content layers are not supported for DOCX conversion.');
    for(let n=1;n<=opened.doc.numPages;n++) {
      if(!active())fail('Conversion was cleared.');
      const page=await opened.doc.getPage(n);
      try {
        const content=await page.getTextContent({disableNormalization:false});const ops=await page.getOperatorList();const annotations=await page.getAnnotations();
        const lines=reconstructTextPage(content,ops,annotations,page.rotate);characters+=lines.reduce((sum,line)=>sum+line.runs.reduce((s,r)=>s+r.text.length,0),0);
        if(characters>LIMITS.text)fail('The PDF exceeds the 500,000 character limit.');
        pages.push(lines);
      }catch(error){rejected.push(`Page ${n}: ${error.message}`);}finally{page.cleanup();}
    }
    if(rejected.length)fail(`No DOCX was created. Unsupported content: ${rejected.join('; ')}. ${DOCX_SUPPORT}`);
    const sections=pages.map(lines=>({properties:{page:{size:{width:11906,height:16838},margin:{top:680,bottom:680,left:680,right:680}}},children:lines.length?lines.map(line=>new Paragraph({spacing:{after:0},children:line.runs.map(run=>new TextRun({text:run.text,size:Math.round(run.size*2),bold:run.bold,italics:run.italics}))})): [new Paragraph('')]}));
    const blob=await Packer.toBlob(new Document({creator:'FileHush',title:'Converted document',sections}));
    if(blob.size>LIMITS.outputBytes)fail('The generated DOCX exceeds 50 MiB.');
    return {blob:new Blob([blob],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),extension:'docx',count:pages.length};
  }finally{await opened.dispose();}
}

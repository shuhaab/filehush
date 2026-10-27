import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import {PDFDocument,PageSizes} from 'pdf-lib';
import {LIMITS,MiB,checkFile,checkDimensions,fail} from './validation.js';
import {decodeImage,canvasBlob,IMAGE_MIMES,DEFAULT_QUALITY} from './images.js';
const resources=new Map();let preparation,sharedWorker;
export function preparePdf() {
  return preparation??=(async()=>{
    const response=await fetch('./vendor/assets.json',{credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)fail('PDF support assets could not load. Reconnect and reload the page.');
    const paths=await response.json();
    // Fixed build-generated paths only; never derive resource requests from file contents.
    for(let i=0;i<paths.length;i+=8)await Promise.all(paths.slice(i,i+8).map(async path=>{
      if(!/^vendor\/(cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(path))fail('Invalid PDF support manifest.');
      const url=new URL(path,document.baseURI).href;const res=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer'});
      if(!res.ok)fail('A PDF support asset could not load. Reconnect and reload.');resources.set(url,new Uint8Array(await res.arrayBuffer()));
    }));
    sharedWorker=new pdfjs.PDFWorker({port:new Worker(new URL('./vendor/pdf.worker.min.mjs',document.baseURI),{type:'module'})});
    await sharedWorker.promise;
  })();
}
class MemoryBinaryDataFactory {
  constructor(options){this.options=options;}
  async fetch({kind,filename}) {
    const url=this.options[kind]+filename;const bytes=resources.get(url);
    if(!bytes)fail('This PDF needs an unavailable support asset. No external resource was requested.');
    return bytes.slice();
  }
}
export async function openPdf(file) {
  checkFile(file,LIMITS.pdfBytes);
  const data=new Uint8Array(await file.arrayBuffer());
  if(!new TextDecoder('latin1').decode(data.subarray(0,1024)).includes('%PDF-'))fail('The file contents are not a PDF.');
  await preparePdf();
  const task=pdfjs.getDocument({data,worker:sharedWorker,stopAtErrors:true,useWorkerFetch:false,BinaryDataFactory:MemoryBinaryDataFactory,cMapUrl:new URL('./vendor/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',document.baseURI).href,wasmUrl:new URL('./vendor/wasm/',document.baseURI).href,enableXfa:false,disableAutoFetch:true,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,canvasMaxAreaInBytes:48*MiB,verbosity:0});
  // Password prompting is intentionally unsupported; reject instead of retaining credentials.
  task.onPassword=()=>{task.destroy();};
  try {
    const doc=await task.promise;
    if(doc.numPages<1||doc.numPages>LIMITS.pages){await task.destroy();fail('PDFs must contain between 1 and 40 pages.');}
    return {doc,dispose:()=>task.destroy()};
  }catch(error){await task.destroy().catch(()=>{});fail(error.name==='PasswordException'||/password|destroyed/i.test(error.message)?'Password-protected PDFs are not supported. Choose an unlocked copy.':`This PDF could not be read. ${error.message}`);}
}
export async function pdfPageCount(file) {const opened=await openPdf(file);try{return opened.doc.numPages;}finally{await opened.dispose();}}
export async function imagesToPdf(files,active=()=>true) {
  if(!files.length||files.length>LIMITS.images)fail('Choose between 1 and 12 JPG/PNG images.');
  if(files.reduce((n,f)=>n+f.size,0)>LIMITS.combinedBytes)fail('Combined images exceed 30 MiB.');
  const pdf=await PDFDocument.create();
  for(const file of files) {
    if(!active())fail('Conversion was cleared.');
    const decoded=await decodeImage(file,['image/jpeg','image/png']);const canvas=document.createElement('canvas');
    try {
      canvas.width=decoded.width;canvas.height=decoded.height;canvas.getContext('2d').drawImage(decoded.image,0,0);
      const normalized=await canvasBlob(canvas,'image/png');const image=await pdf.embedPng(await normalized.arrayBuffer());
      const [short,long]=PageSizes.A4;const landscape=decoded.width>decoded.height;const w=landscape?long:short,h=landscape?short:long,margin=12*72/25.4;
      const scale=Math.min((w-margin*2)/decoded.width,(h-margin*2)/decoded.height);const width=decoded.width*scale,height=decoded.height*scale;
      pdf.addPage([w,h]).drawImage(image,{x:(w-width)/2,y:(h-height)/2,width,height});
    }finally{decoded.dispose();canvas.width=canvas.height=0;}
    await new Promise(r=>setTimeout(r,0));
  }
  const bytes=await pdf.save();if(bytes.length>LIMITS.outputBytes)fail('The generated PDF exceeds 50 MiB.');
  return {blob:new Blob([bytes],{type:'application/pdf'}),extension:'pdf',count:files.length};
}
export async function pdfToImages(file,pages,output,quality=DEFAULT_QUALITY,active=()=>true) {
  if(!['jpg','png'].includes(output))fail('Choose JPG or PNG output.');
  if(!pages.length||new Set(pages).size!==pages.length)fail('Select at least one PDF page, without duplicates.');
  const opened=await openPdf(file);const results=[];let total=0;
  try {
    if(pages.some(n=>!Number.isInteger(n)||n<1||n>opened.doc.numPages))fail('The selected PDF page is invalid.');
    for(const number of [...pages].sort((a,b)=>a-b)) {
      if(!active())fail('Conversion was cleared.');
      const page=await opened.doc.getPage(number);const canvas=document.createElement('canvas');
      try {
        const viewport=page.getViewport({scale:2});const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height);checkDimensions(width,height,LIMITS.renderPixels);
        canvas.width=width;canvas.height=height;
        await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)',annotationMode:pdfjs.AnnotationMode.ENABLE}).promise;
        const blob=await canvasBlob(canvas,IMAGE_MIMES[output],quality);total+=blob.size;
        if(total>LIMITS.outputBytes)fail('Selected page images exceed 50 MiB. Export fewer pages.');
        results.push({blob,extension:output,page:number,width,height});
      }finally{canvas.width=canvas.height=0;page.cleanup();}
    }
    return results;
  }finally{await opened.dispose();}
}
export {pdfjs};

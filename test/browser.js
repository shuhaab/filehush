import {convertImage,decodeImage,canvasBlob,imageCapabilities} from '../src/images.js';
import {convertData} from '../src/data.js';
import {preparePdf,openPdf,imagesToPdf,pdfToImages} from '../src/pdf.js';
import {renderDocxForPrint,pdfToDocx,validateDocxPackage} from '../src/documents.js';
import {inspectImage,inspectZip,MiB} from '../src/validation.js';
import {unzipSync,zipSync,strToU8} from 'fflate';
import {Document,Paragraph,ImageRun,Table,TableRow,TableCell,Packer} from 'docx';
const $=id=>document.getElementById(id);
const assert=(condition,message='Assertion failed')=>{if(!condition)throw new Error(message);};
async function rejects(fn,pattern){try{await fn();}catch(error){if(pattern&&!pattern.test(error.message))throw error;return;}throw new Error('Expected rejection');}
const fixtureCache=new Map();async function fixture(name){if(fixtureCache.has(name))return fixtureCache.get(name);const res=await fetch(`./fixtures/${name}`);const file=new File([await res.arrayBuffer()],name);fixtureCache.set(name,file);return file;}
const requests=[],violations=[];const originalFetch=window.fetch.bind(window);window.fetch=async(...args)=>{requests.push(String(args[0]));return originalFetch(...args);};
window.addEventListener('securitypolicyviolation',e=>violations.push(`${e.effectiveDirective}: ${e.blockedURI}`));
window.addEventListener('error',e=>{$('summary').textContent=`Uncaught error: ${e.message}`;});
window.addEventListener('unhandledrejection',e=>{$('summary').textContent=`Unhandled rejection: ${e.reason?.message||e.reason}`;});
let passed=0,failed=0,offlineImage;
async function check(name,fn){const item=document.createElement('li');item.textContent=`Running: ${name}`;$('checks').append(item);try{await fn();passed++;item.textContent=`PASS — ${name}`;}catch(error){failed++;item.textContent=`FAIL — ${name}: ${error.message}`;console.error(name,error);}$('summary').textContent=`${passed} passed, ${failed} failed; running…`;}
$('run').addEventListener('click',async()=>{
  $('run').disabled=true;$('checks').replaceChildren();requests.length=0;violations.length=0;passed=failed=0;
  $('summary').textContent='Browser: '+navigator.userAgent;
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const ctx=canvas.getContext('2d');ctx.clearRect(0,0,160,100);ctx.fillStyle='#e00000';ctx.fillRect(20,20,80,50);
  const png=new File([await canvasBlob(canvas,'image/png')],'private-distinctive-name-☃.png');offlineImage=png;
  await check('Native image matrix, orientation dimensions and actual output MIME',async()=>{
    const caps=await imageCapabilities();assert(caps.png&&caps.jpg,'Baseline encoders unavailable');
    for(const output of ['jpg','webp'].filter(x=>caps[x])){
      const result=await convertImage(png,output);assert(result.blob.type===`image/${output==='jpg'?'jpeg':output}`);assert(result.width===160&&result.height===100);
      for(const target of ['png','jpg','webp'].filter(x=>caps[x]&&x!==output)){const back=await convertImage(new File([result.blob],`test.${output}`),target);assert(back.width===160);}
    }
  });
  await check('EXIF-rotated JPEG stays upright',async()=>{
    const jpeg=await canvasBlob(canvas,'image/jpeg');const original=new Uint8Array(await jpeg.arrayBuffer());const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);const rotated=new Uint8Array(original.length+exif.length);rotated.set(original.subarray(0,2));rotated.set(exif,2);rotated.set(original.subarray(2),2+exif.length);const result=await convertImage(new File([rotated],'rotated.jpg'),'png');assert(result.width===100&&result.height===160,'EXIF orientation was lost or applied twice');
  });
  await check('JPEG transparency is white',async()=>{
    const jpg=await convertImage(png,'jpg');const decoded=await decodeImage(new File([jpg.blob],'transparent.jpg'));const c=document.createElement('canvas');c.width=160;c.height=100;c.getContext('2d').drawImage(decoded.image,0,0);const pixel=c.getContext('2d').getImageData(0,0,1,1).data;assert(pixel[0]>245&&pixel[1]>245&&pixel[2]>245);decoded.dispose();c.width=c.height=0;
  });
  await check('Unsupported, malformed, huge and animated inputs fail',async()=>{
    await rejects(()=>convertImage(new File(['not an image'],'renamed.png'),'jpg'));
    await rejects(()=>convertImage(new File([new Uint8Array(11*MiB)],'huge.jpg'),'png'));
    const bytes=new Uint8Array(await png.arrayBuffer());const apng=new Uint8Array(bytes.length+20);apng.set(bytes.subarray(0,33));new DataView(apng.buffer).setUint32(33,8);apng.set(strToU8('acTL'),37);apng.set(bytes.subarray(33),53);
    await rejects(()=>convertImage(new File([apng],'animated.png'),'jpg'),/Animated/);
    await rejects(()=>convertImage(png,'png'),/different output/);
  });
  await check('Two-megapixel image conversion meets the provisional desktop target',async()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=1250;const context=c.getContext('2d');const gradient=context.createLinearGradient(0,0,1600,1250);gradient.addColorStop(0,'#241549');gradient.addColorStop(1,'#c9ffe0');context.fillStyle=gradient;context.fillRect(0,0,1600,1250);context.fillStyle='#fff';context.font='32px sans-serif';for(let y=50;y<1250;y+=55)context.fillText('FileHush quality fixture — details and text 0012345',40,y);const file=new File([await canvasBlob(c,'image/png')],'two-megapixel.png');const timings=[];for(const output of ['jpg','webp']){if(!(await imageCapabilities())[output])continue;for(let i=0;i<3;i++){const start=performance.now();const result=await convertImage(file,output);const elapsed=performance.now()-start;assert(result.width===1600&&elapsed<3000,'Provisional 3-second target exceeded');timings.push(`${output} ${Math.round(elapsed)} ms / ${result.blob.size} bytes`);}}c.width=c.height=0;$('performance').textContent='Desktop 2MP fixture: '+timings.join('; ');
  });
  await check('Data conversion preserves strings and rejects nesting',async()=>{
    const json=await convertData(await fixture('records.csv'),'json');assert(JSON.parse(await json.blob.text())[0].id==='001');
    const csv=await convertData(await fixture('records.json'),'csv');assert((await csv.blob.text()).includes('001,true'));
    await rejects(async()=>convertData(await fixture('nested.json'),'csv'),/Nested/);
  });
  await check('PDF bundled resources and reusable worker load',preparePdf);
  await check('Images to PDF uses ordered A4 pages and proportional placement',async()=>{
    const portrait=document.createElement('canvas');portrait.width=100;portrait.height=160;portrait.getContext('2d').fillRect(0,0,100,160);
    const p=new File([await canvasBlob(portrait,'image/png')],'portrait.png');
    const result=await imagesToPdf([png,p]);assert(result.count===2&&result.blob.type==='application/pdf');
    const opened=await openPdf(new File([result.blob],'combined.pdf'));try{assert(opened.doc.numPages===2);const first=await opened.doc.getPage(1),second=await opened.doc.getPage(2);assert(first.view[2]>first.view[3]);assert(second.view[2]<second.view[3]);}finally{await opened.dispose();}portrait.width=portrait.height=0;
  });
  await check('PDF selection exports correct pages, dimensions and formats',async()=>{
    for(const output of ['jpg','png']){const results=await pdfToImages(await fixture('simple.pdf'),[3,1],output);assert(results.length===2&&results[0].page===1&&results[1].page===3);assert(results[0].width===600&&results[0].height===800);assert(results[0].blob.type===`image/${output==='jpg'?'jpeg':'png'}`);}
    await rejects(async()=>pdfToImages(await fixture('simple.pdf'),[],'png'),/Select/);await rejects(async()=>pdfToImages(await fixture('simple.pdf'),[99],'png'),/invalid/);
    await rejects(async()=>pdfToImages(await fixture('huge-page.pdf'),[1],'png'),/dimensions/);
    await rejects(async()=>openPdf(await fixture('malformed.pdf')),/not a PDF/);
    await rejects(async()=>openPdf(await fixture('encrypted.pdf')),/Password-protected/);
  });
  await check('PDF graphics remain valid for raster export',async()=>{const results=await pdfToImages(await fixture('graphics.pdf'),[1],'png');assert(results.length===1);});
  await check('PDF to DOCX produces editable text and retains blank pages',async()=>{
    const result=await pdfToDocx(await fixture('simple.pdf'));assert(result.count===3);const parts=unzipSync(new Uint8Array(await result.blob.arrayBuffer()));const xml=new TextDecoder().decode(parts['word/document.xml']);assert(xml.includes('FileHush editable text')&&xml.includes('Last page'));assert((xml.match(/<w:sectPr/g)||[]).length===3);validateDocxPackage(new Uint8Array(await result.blob.arrayBuffer()));
  });
  await check('Scanned pages export as images and reject editable conversion',async()=>{
    const scan=await imagesToPdf([png]);const scanned=new File([scan.blob],'scan.pdf');const images=await pdfToImages(scanned,[1],'png');assert(images.length===1);await rejects(()=>pdfToDocx(scanned),/Page 1/);
  });
  await check('PDF to DOCX rejects graphics, columns and annotations without partial output',async()=>{
    for(const name of ['graphics.pdf','columns.pdf','linked.pdf']){try{await rejects(async()=>pdfToDocx(await fixture(name)),/Unsupported content/);}catch(error){throw new Error(name+': '+error.message);}}
  });
  await check('DOCX package rejects external references and compression bombs',async()=>{
    for(const name of ['external.docx','bomb.docx'])await rejects(async()=>validateDocxPackage(new Uint8Array(await(await fixture(name)).arrayBuffer())),/external|oversized/i);
    const valid=new Uint8Array(await(await fixture('simple.docx')).arrayBuffer());const corrupt=valid.slice();corrupt[inspectZip(valid).get('word/document.xml').offset+2]^=255;await rejects(()=>validateDocxPackage(corrupt));
    const badImage=unzipSync(valid);badImage['word/media/evil.png']=strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>');await rejects(()=>validateDocxPackage(zipSync(badImage)),/supported image/);
    const entries=unzipSync(valid);entries['word/altChunk.html']=strToU8('<script>bad</script>');await rejects(()=>validateDocxPackage(zipSync(entries)),/embedded|active/);
  });
  await check('DOCX preview is isolated, contains text, and cleans up',async()=>{
    const handle=await renderDocxForPrint(await fixture('simple.docx'),$('preview'));const frame=$('preview').querySelector('iframe');assert(frame.sandbox.contains('allow-same-origin')&&!frame.sandbox.contains('allow-scripts'));assert(frame.contentDocument.body.textContent.includes('FileHush preview'));assert(!frame.contentDocument.querySelector('script'));assert(typeof handle.print==='function');handle.dispose();assert(!$('preview').querySelector('iframe')?.contentDocument?.getElementById('document')?.textContent);
  });
  await check('DOCX tables and embedded still images render locally',async()=>{
    const image=new ImageRun({type:'png',data:new Uint8Array(await png.arrayBuffer()),transformation:{width:160,height:100}});const doc=new Document({sections:[{children:[new Paragraph('Table and image'),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('First cell')]}),new TableCell({children:[new Paragraph('Second cell')]})]})]}),new Paragraph({children:[image]})]}]});const file=new File([await Packer.toBlob(doc)],'table-image.docx');const handle=await renderDocxForPrint(file,$('preview'));const preview=$('preview').querySelector('iframe').contentDocument;assert(preview.querySelector('table'));const img=preview.querySelector('img');assert(img&&img.src.startsWith('data:image/png'));await img.decode();assert(img.naturalWidth===160);handle.dispose();
  });
  await check('Invalidated jobs do not publish and cleanup works',async()=>{
    await rejects(()=>imagesToPdf([png],()=>false),/cleared/);await rejects(async()=>pdfToDocx(await fixture('simple.pdf'),()=>false),/cleared/);
    await rejects(async()=>renderDocxForPrint(await fixture('simple.docx'),$('preview'),()=>false),/cleared/);assert(!$('preview').querySelector('iframe')?.contentDocument?.getElementById('document')?.textContent);
  });
  await check('Warm conversions perform no resource requests after preload',async()=>{
    const file=await fixture('simple.pdf');const before=requests.length;await pdfToImages(file,[1],'png');await pdfToDocx(file);await convertImage(png,'jpg');assert(requests.length===before,'Unexpected lazy resource fetch');
  });
  await check('Network and storage privacy boundaries',async()=>{
    assert(requests.every(url=>{const u=new URL(url,location.href);return u.origin===location.origin&&!u.search&&!u.hash&&!u.href.includes('private-distinctive');}),'Unexpected request destination');
    assert(localStorage.length===0&&sessionStorage.length===0,'Unexpected storage');assert(document.cookie==='','Unexpected cookie');
    if(indexedDB.databases)assert((await indexedDB.databases()).length===0,'Unexpected IndexedDB');
    if(window.caches)assert((await caches.keys()).length===0,'Unexpected app cache');
    assert(violations.length===0,`Unexpected CSP violations: ${violations.join(', ')}`);
  });
  canvas.width=canvas.height=0;$('network').textContent=`${requests.length} fixed local fixture/support requests; ${violations.length} CSP violations.\n`+requests.slice(0,5).join('\n')+'\n… fixed support files omitted';$('summary').textContent=`Complete: ${passed} passed, ${failed} failed.`;$('run').disabled=false;$('offline').disabled=failed>0;
});
$('offline').addEventListener('click',async()=>{
  $('offline').disabled=true;const before=requests.length;const started=performance.now();
  await check('All converter families work with local server disconnected',async()=>{
    await convertImage(offlineImage,'jpg');await imagesToPdf([offlineImage]);await pdfToImages(fixtureCache.get('simple.pdf'),[1],'png');await convertData(fixtureCache.get('records.csv'),'json');await convertData(fixtureCache.get('records.json'),'csv');await pdfToDocx(fixtureCache.get('simple.pdf'));const handle=await renderDocxForPrint(fixtureCache.get('simple.docx'),$('preview'));handle.dispose();assert(requests.length===before,'Unexpected offline request');
  });
  $('summary').textContent=`Complete: ${passed} passed, ${failed} failed. Offline check took ${Math.round(performance.now()-started)} ms. Browser: ${navigator.userAgent}`;$('offline').disabled=false;
});

import './app.css';
import {LIMITS,MiB,checkFile,inspectImage,textFromBytes,outputName,fail} from './validation.js';
import {imageCapabilities,convertImage,DEFAULT_QUALITY} from './images.js';
import {convertData,DATA_POLICY} from './data.js';
import {preparePdf,pdfPageCount,imagesToPdf,pdfToImages} from './pdf.js';
import {prepareDocxPreview,renderDocxForPrint,pdfToDocx,DOCX_SUPPORT} from './documents.js';
const $=id=>document.getElementById(id);
const tools={
  image:{title:'Image converter',badges:['IMG','↔','IMG'],description:'Switch between JPG, PNG and WebP.',action:'Convert image',link:'Convert an image',accept:'.jpg,.jpeg,.png,.webp',hint:'JPG, PNG or WebP · Still images only',outputs:['jpg','png','webp'],note:'JPG and WebP can lose detail. Transparent areas become white in JPG. Color profiles and metadata may change.',details:'One still image, up to 10 MiB, 12 megapixels and 8,192 pixels per side. Animated PNG/WebP, GIF, SVG and same-format recompression are not supported. Quality 92 is the initial high-quality setting; encoder results vary by browser.'},
  makepdf:{title:'Images to PDF',badges:['IMG','→','PDF'],description:'Combine JPG or PNG images into one PDF.',action:'Create PDF',link:'Create a PDF',accept:'.jpg,.jpeg,.png',hint:'JPG or PNG · Up to 12 images',outputs:['pdf'],note:'One image per A4 page, in the order shown. Orientation follows each image. 12 mm margins; proportions are preserved.',details:'Up to 12 JPG/PNG images, 10 MiB each and 30 MiB combined. Each image: 12 megapixels and 8,192 pixels per side. Output limit: 50 MiB. Use Move up / Move down to change page order.'},
  readpdf:{title:'PDF to images',badges:['PDF','→','IMG'],description:'Export selected PDF pages as JPG or PNG images.',action:'Convert PDF',link:'Convert a PDF',accept:'.pdf',hint:'PDF · One file at a time',outputs:['jpg','png'],note:'All pages are selected initially. Export at 144 DPI with a white background. Download each page individually.',details:'PDF up to 15 MiB and 40 pages. Each output: up to 12 megapixels and 8,192 pixels per side. Total outputs: 50 MiB. Password-protected PDFs are rejected. Scanned pages can be exported. No ZIP or automatic sequence of downloads.'},
  data:{title:'CSV ↔ JSON',badges:['CSV','↔','JSON'],description:'Change your data format on your device.',action:'Convert data',link:'Convert data',accept:'.csv,.json',hint:'UTF-8 CSV or JSON · One file at a time',outputs:['json','csv'],note:'CSV values remain strings, including leading zeros. Nested objects and arrays are rejected.',details:DATA_POLICY+' Input: 5 MiB; up to 10,000 records and 200 columns; output: 50 MiB. A UTF-8 BOM is accepted; output has no BOM. CSV output uses CRLF. Header-only CSV becomes []; an empty JSON array cannot provide CSV headers and is rejected. JSON type round-tripping is not guaranteed.'},
  docxtopdf:{title:'DOCX to PDF',badges:['DOCX','→','PDF'],description:'Preview your document, then use browser Print / Save as PDF.',action:'Preview document',link:'Preview a DOCX',accept:'.docx',hint:'DOCX · One file at a time',outputs:['pdf'],note:'Fonts, pagination and layout may differ from Word. Review the preview, then choose a local PDF destination in your browser’s print dialog where available.',details:'DOCX up to 8 MiB, expanded package up to 30 MiB and 600 entries. Up to 40 explicit preview pages; browser pagination may add pages. Embedded JPG/PNG images only. External relationships (including external links), active/embedded content, and legacy drawings are rejected. Embedded fonts are ignored. No automatic PDF download; FileHush cannot confirm a print-dialog save.'},
  pdftodocx:{title:'PDF to DOCX',badges:['PDF','→','DOCX'],description:'Turn supported PDF text into an editable Word document.',action:'Convert to DOCX',link:'Convert to DOCX',accept:'.pdf',hint:'Simple text-based PDF · One file at a time',outputs:['docx'],note:DOCX_SUPPORT,details:'PDF up to 15 MiB, 40 pages and 500,000 extracted characters. Output up to 50 MiB. Unsupported pages block the entire conversion and are identified. Blank pages are preserved. Complex layouts, columns, unusual fonts and unreliable character mapping may be rejected. Password-protected PDFs, embedded attachments and optional content layers are unsupported.'}
};
let current='',files=[],inputMime='',pageCount=0,selectedPages=new Set(),results=[],preview=null,operation=0,busy=false,capabilities={},pdfReady=false,pdfError='',docxReady=false,docxError='';
function bytes(n){return n<MiB?`${(n/1024).toFixed(1)} KiB`:`${(n/MiB).toFixed(2)} MiB`;}
function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
const badgeSvg='<svg viewBox="0 0 24 26" aria-hidden="true"><path d="M5 2h9l5 5v17H5zM14 2v6h5M8 13h8M8 17h8"/></svg>';
for(const [id,tool] of Object.entries(tools)) {
  const link=element('a',undefined,'toolcard');link.href=`#${id}`;const pair=element('span',undefined,'pair');pair.setAttribute('aria-hidden','true');
  for(let i=0;i<3;i++){const part=element('span',undefined,i===1?'direction':'file-badge');if(i!==1)part.innerHTML=badgeSvg;part.append(element('span',tool.badges[i]));pair.append(part);}
  link.append(pair,element('h3',tool.title),element('p',tool.description,'muted'),element('span',`${tool.link} →`,'cardlink'));$('tools').append(link);
}
function disposeResults(){for(const result of results)if(result.url)URL.revokeObjectURL(result.url);results=[];preview?.dispose();preview=null;$('downloads').replaceChildren();$('result').hidden=true;$('document-preview').hidden=true;}
function invalidate(){operation++;disposeResults();$('file').removeAttribute('aria-invalid');$('file').removeAttribute('aria-describedby');$('error').hidden=true;$('error').textContent='';$('status').textContent=busy?'Finishing the previous operation…':'';}
function report(error){$('error').textContent=error.message||'This conversion could not finish. Try a smaller or supported file.';$('error').hidden=false;$('file').setAttribute('aria-invalid','true');$('file').setAttribute('aria-describedby','error');}
function updateControls(){
  $('progress').hidden=!busy;const t=tools[current];if(!t)return;
  const available=!!$('output').value;
  const valid=files.length>0&&available&&(current!=='readpdf'||selectedPages.size>0);
  const waiting=(['readpdf','pdftodocx'].includes(current)&&!pdfReady)||(current==='docxtopdf'&&!docxReady);
  $('convert').disabled=busy||!valid||waiting;
  $('convert').textContent=busy?'Working…':current==='data'?`Convert to ${$('output').value.toUpperCase()}`:t.action;
  $('choose').disabled=$('replace').disabled=busy||waiting;
  $('blocked').textContent=busy?'One job at a time. You can clear the current job.':waiting?(current==='docxtopdf'?(docxError||'Preparing isolated document preview…'):(pdfError||'Loading bundled PDF tools…')):!available?'This browser has no supported output encoder for this input.':!files.length?'Choose a file to continue.':current==='readpdf'&&!selectedPages.size?'Select at least one page.':'';
  $('advanced').hidden=!['jpg','webp'].includes($('output').value)||!['image','readpdf'].includes(current);
}
function renderFiles(){
  $('drop').hidden=files.length>0;$('selection').hidden=!files.length;$('files').replaceChildren();
  files.forEach((file,index)=>{
    const li=element('li',undefined,'file');li.append(element('strong',file.name),element('p',`${bytes(file.size)}${current==='makepdf'?` · Page ${index+1}`:''}`,'muted'));
    if(current==='makepdf') {
      const order=element('div',undefined,'file-order');for(const [label,offset]of[['Move up',-1],['Move down',1]]){
        const button=element('button',label,'small-button');button.type='button';button.disabled=busy||index+offset<0||index+offset>=files.length;button.setAttribute('aria-label',`${label}: ${file.name}`);
        button.addEventListener('click',()=>{invalidate();const target=index+offset;[files[index],files[target]]=[files[target],files[index]];renderFiles();updateControls();const moved=$('files').children[target]?.querySelector('button:not(:disabled)');moved?.focus();});order.append(button);
      }li.append(order);
    }$('files').append(li);
  });
}
function renderPages(){
  $('page-options').hidden=current!=='readpdf'||!pageCount;$('pages').replaceChildren();
  for(let i=1;i<=pageCount;i++){const label=element('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=String(i);checkbox.checked=selectedPages.has(i);checkbox.addEventListener('change',()=>{invalidate();checkbox.checked?selectedPages.add(i):selectedPages.delete(i);updateControls();});label.append(checkbox,document.createTextNode(`Page ${i}`));$('pages').append(label);}
}
function outputOptions(){
  let options=tools[current].outputs;
  if(current==='image') options=options.filter(x=>capabilities[x]&&({jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[x]!==inputMime));
  if(current==='readpdf')options=options.filter(x=>capabilities[x]);
  if(current==='data'&&inputMime)options=[inputMime==='json'?'csv':'json'];
  const old=$('output').value;$('output').replaceChildren(...options.map(ext=>{const option=element('option',ext.toUpperCase());option.value=ext;return option;}));
  if(options.includes(old))$('output').value=old;
  $('format-field').hidden=options.length<=1;$('fixed-output').hidden=options.length!==1;$('fixed-label').textContent=options[0]?.toUpperCase()||'';
}
async function selectFiles(list){
  if(busy)return;invalidate();files=[];inputMime='';pageCount=0;selectedPages.clear();renderPages();
  const id=operation,tool=current;let detectedMime='';const chosen=Array.from(list);if(!chosen.length){renderFiles();updateControls();return;}
  busy=true;$('status').textContent='Validating files…';updateControls();
  try {
    if(tool!=='makepdf'&&chosen.length!==1)fail('Choose one file at a time for this tool.');
    if(tool==='makepdf'&&(chosen.length>LIMITS.images||chosen.reduce((sum,f)=>sum+f.size,0)>LIMITS.combinedBytes))fail('Choose up to 12 images, totalling at most 30 MiB.');
    if(['image','makepdf'].includes(tool)) {
      for(const file of chosen){checkFile(file,LIMITS.imageBytes);const info=inspectImage(new Uint8Array(await file.arrayBuffer()));if(tool==='makepdf'&&info.mime==='image/webp')fail('Images to PDF accepts JPG or PNG only.');detectedMime=info.mime;}
    }else if(tool==='data'){
      checkFile(chosen[0],LIMITS.dataBytes);const text=textFromBytes(new Uint8Array(await chosen[0].arrayBuffer()));detectedMime=/\.csv$/i.test(chosen[0].name)?'csv':/\.json$/i.test(chosen[0].name)||/^[\s\uFEFF]*[\[{]/.test(text)?'json':'csv';
    }else if(tool==='docxtopdf'){checkFile(chosen[0],LIMITS.docxBytes);}
    else {checkFile(chosen[0],LIMITS.pdfBytes);const count=await pdfPageCount(chosen[0]);if(id===operation){pageCount=count;selectedPages=new Set(Array.from({length:count},(_,i)=>i+1));}}
    if(id!==operation||tool!==current)return;
    files=chosen;inputMime=detectedMime;outputOptions();renderPages();$('status').textContent='Files ready. Choose output and convert.';$('file').removeAttribute('aria-invalid');$('file').removeAttribute('aria-describedby');
  }catch(error){if(id===operation)report(error);}finally{busy=false;if(id!==operation&&/finishing/i.test($('status').textContent))$('status').textContent='Previous operation discarded.';renderFiles();updateControls();}
}
function showResults(converted){
  results=converted.map(result=>({...result,url:URL.createObjectURL(result.blob)}));
  $('result-summary').replaceChildren(element('h3','Ready to download'),element('p',`${results.length>1?`${results.length} page images · `:''}${bytes(results.reduce((n,r)=>n+r.blob.size,0))}${results[0].count!==undefined?` · ${results[0].count} ${current==='data'?'records':'pages'}`:''}${results[0].width?` · ${results[0].width} × ${results[0].height} px`:''}`,'muted'));
  $('downloads').replaceChildren();for(const result of results){const link=element('a',result.page?`Download page ${result.page} (${bytes(result.blob.size)})`:`Download ${result.extension.toUpperCase()}`,'download');link.href=result.url;link.download=outputName(files[0].name,result.page?`page-${result.page}.${result.extension}`:result.extension);link.addEventListener('click',()=>{$('status').textContent='Download started. Your browser manages saving the file.';});$('downloads').append(link);}
  $('result').hidden=false;
}
async function convert(){
  if(busy||$('convert').disabled)return;invalidate();const id=operation,tool=current,input=files.slice(),output=$('output').value,quality=Number($('quality').value)/100,pages=[...selectedPages];const active=()=>id===operation&&tool===current;
  busy=true;updateControls();renderFiles();$('status').textContent=tool==='docxtopdf'?'Preparing document preview…':'Converting on your device…';
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try {
    let result;
    if(tool==='image')result=[await convertImage(input[0],output,quality)];
    else if(tool==='makepdf')result=[await imagesToPdf(input,active)];
    else if(tool==='readpdf')result=await pdfToImages(input[0],pages,output,quality,active);
    else if(tool==='data')result=[await convertData(input[0],output)];
    else if(tool==='pdftodocx')result=[await pdfToDocx(input[0],active)];
    else if(tool==='docxtopdf') {
      const handle=await renderDocxForPrint(input[0],$('document-preview'),active);
      if(!active()){handle.dispose();return;}preview=handle;$('document-preview').hidden=false;
      $('result-summary').replaceChildren(element('h3','Preview ready'),element('p','Review the layout below. Choose a local PDF save destination in the print dialog where available. FileHush cannot confirm that you saved a PDF.','muted'));
      const button=element('button','Print / Save as PDF','primary');button.type='button';button.addEventListener('click',()=>{try{preview.print();$('status').textContent='Print dialog requested. Choose Save as PDF if your browser provides it.';}catch(error){report(error);}});$('downloads').replaceChildren(button);$('result').hidden=false;
    }
    if(!active())return;if(result)showResults(result);$('status').textContent=tool==='docxtopdf'?'Document preview is ready.':'Conversion finished. Download your result explicitly.';
  }catch(error){if(active()){disposeResults();report(error);$('status').textContent='Conversion stopped. Your original file is unchanged.';}}
  finally{busy=false;if(id!==operation&&/finishing/i.test($('status').textContent))$('status').textContent='Previous operation discarded.';renderFiles();updateControls();}
}
function route(){
  const key=location.hash.slice(1);invalidate();files=[];inputMime='';pageCount=0;selectedPages.clear();$('file').value='';current=tools[key]?key:'';
  $('home').hidden=!!current;$('tool-screen').hidden=!current;
  document.title=current?`${tools[current].title} — FileHush`:'FileHush — Private file conversion';
  if(!current){renderFiles();renderPages();$('main').focus({preventScroll:true});return;}
  const t=tools[current];$('tool-heading').textContent=$('converter-heading').textContent=t.title;$('tool-description').textContent=t.description;$('output-note').textContent=t.note;$('details').replaceChildren(element('p',t.details));$('accepted').textContent=t.hint;$('file').accept=t.accept;$('file').multiple=current==='makepdf';$('choose').textContent=current==='makepdf'?'Choose files':'Choose file';$('input-heading').lastChild.textContent=current==='makepdf'?' Choose images':' Choose a file';$('quality').value=String(DEFAULT_QUALITY*100);$('quality-value').textContent=String(DEFAULT_QUALITY*100);$('advanced').open=false;
  outputOptions();renderFiles();renderPages();updateControls();$('tool-heading').focus({preventScroll:true});window.scrollTo(0,0);
  if(current==='docxtopdf'&&!docxReady)prepareDocxPreview($('document-preview')).then(()=>{docxReady=true;updateControls();}).catch(()=>{docxError='Document preview could not load. Reconnect and reload the page.';updateControls();});
  if(['readpdf','pdftodocx'].includes(current)&&!pdfReady)preparePdf().then(()=>{pdfReady=true;updateControls();}).catch(()=>{pdfError='PDF tools could not load. Reconnect and reload the page.';updateControls();});
}
document.querySelector('.skip').addEventListener('click',event=>{event.preventDefault();$('main').focus();});
$('choose').addEventListener('click',()=>$('file').click());$('replace').addEventListener('click',()=>$('file').click());$('file').addEventListener('change',()=>{selectFiles($('file').files);$('file').value='';});
$('clear').addEventListener('click',()=>{invalidate();files=[];inputMime='';pageCount=0;selectedPages.clear();outputOptions();renderFiles();renderPages();updateControls();$('status').textContent=busy?'Cleared. Finishing and discarding the previous operation…':'Cleared.';$('choose').focus();});
$('convert').addEventListener('click',convert);$('output').addEventListener('change',()=>{invalidate();updateControls();});$('quality').addEventListener('input',()=>{$('quality-value').textContent=$('quality').value;invalidate();updateControls();});
for(const [id,all]of[['all-pages',true],['no-pages',false]])$(id).addEventListener('click',()=>{invalidate();selectedPages=all?new Set(Array.from({length:pageCount},(_,i)=>i+1)):new Set();renderPages();updateControls();});
$('drop').addEventListener('dragover',event=>{event.preventDefault();if(!busy)$('drop').classList.add('dragging');});$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('dragging'));$('drop').addEventListener('drop',event=>{event.preventDefault();$('drop').classList.remove('dragging');selectFiles(event.dataTransfer.files);});
window.addEventListener('dragover',event=>event.preventDefault());window.addEventListener('drop',event=>event.preventDefault());
$('privacy-toggle').addEventListener('click',()=>{$('privacy').hidden=!$('privacy').hidden;$('privacy-toggle').setAttribute('aria-expanded',String(!$('privacy').hidden));});
window.addEventListener('hashchange',route);window.addEventListener('pagehide',()=>{operation++;disposeResults();files=[];inputMime='';pageCount=0;selectedPages.clear();renderFiles();renderPages();});
window.addEventListener('pageshow',event=>{if(event.persisted)route();});
capabilities=await imageCapabilities();route();

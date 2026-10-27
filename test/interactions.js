import axe from 'axe-core';
import {canvasBlob} from '../src/images.js';
import {openPdf} from '../src/pdf.js';
const $=id=>document.getElementById(id);
const panel=document.createElement('section');panel.setAttribute('aria-label','Development verification');panel.innerHTML='<h2>UI verification</h2><button id="run-ui" type="button">Run UI and accessibility checks</button><p id="ui-summary" role="status">Ready.</p><ol id="ui-checks"></ol>';document.querySelector('main').append(panel);
const assert=(value,message='Assertion failed')=>{if(!value)throw new Error(message);};
async function waitFor(fn,description){const start=performance.now();while(!fn()){if(performance.now()-start>20000)throw new Error(`Timed out: ${description}`);await new Promise(r=>setTimeout(r,30));}}
async function route(name){location.hash=name;await waitFor(()=>$('tool-heading').textContent===({image:'Image converter',makepdf:'Images to PDF',readpdf:'PDF to images',data:'CSV ↔ JSON',docxtopdf:'DOCX to PDF',pdftodocx:'PDF to DOCX'}[name]),'route');await waitFor(()=>!$('choose').disabled,'job slot');}
async function fixture(name){return new File([await(await fetch(`./fixtures/${name}`)).arrayBuffer()],name);}
async function select(files){const dt=new DataTransfer();files.forEach(f=>dt.items.add(f));$('file').files=dt.files;$('file').dispatchEvent(new Event('change',{bubbles:true}));await waitFor(()=>!$('choose').disabled,'validation');}
async function convert(){assert(!$('convert').disabled,'Convert should be enabled');$('convert').click();await waitFor(()=>!$('choose').disabled,'conversion');assert($('error').hidden,$('error').textContent);assert(!$('result').hidden,'Result should be visible');}
async function a11y(){const result=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});assert(result.violations.length===0,result.violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`).join('; '));return result.passes.length;}
let passed=0,failed=0;
async function check(name,fn){const li=document.createElement('li');li.textContent=`Running: ${name}`;$('ui-checks').append(li);try{await fn();passed++;li.textContent=`PASS — ${name}`;}catch(error){failed++;li.textContent=`FAIL — ${name}: ${error.message}`;console.error(error);}$('ui-summary').textContent=`${passed} passed, ${failed} failed; running…`;}
$('run-ui').addEventListener('click',async()=>{
  $('run-ui').disabled=true;$('ui-checks').replaceChildren();passed=failed=0;
  const canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;canvas.getContext('2d').fillRect(0,0,120,80);const landscape=new File([await canvasBlob(canvas,'image/png')],'landscape.png');canvas.width=80;canvas.height=120;canvas.getContext('2d').fillRect(0,0,80,120);const portrait=new File([await canvasBlob(canvas,'image/png')],'portrait.png');canvas.width=canvas.height=0;
  await check('Hub has six accessible tools and privacy disclosure',async()=>{location.hash='';await waitFor(()=>!$('home').hidden,'home');assert($('tools').querySelectorAll('a').length===6);$('privacy-toggle').click();assert(!$('privacy').hidden&&$('privacy-toggle').getAttribute('aria-expanded')==='true');await a11y();$('privacy-toggle').click();});
  await check('Image flow, download Blob, advanced settings and clear',async()=>{
    await route('image');assert(!$('advanced').open);await select([landscape]);assert(!Array.from($('output').options).some(o=>o.value==='png'),'Same-format output shown');await convert();const link=$('downloads').querySelector('a');const response=await fetch(link.href);assert((await response.blob()).size>0&&/\.(jpg|webp)$/.test(link.download));await a11y();
    document.querySelector('.skip').click();assert(!$('result').hidden&&location.hash==='#image','Skip link discarded current work');const oldURL=link.href;$('advanced').open=true;assert(!$('result').hidden,'Opening settings invalidated results');$('quality').value='80';$('quality').dispatchEvent(new Event('input'));assert($('result').hidden,'Quality change did not invalidate');let revoked=false;try{await fetch(oldURL);}catch{revoked=true;}assert(revoked,'Old Blob URL was not revoked');$('clear').click();assert(!$('drop').hidden&&$('convert').disabled);await a11y();
  });
  await check('Clearing an active conversion discards stale output and holds the slot',async()=>{
    await select([landscape]);$('convert').click();$('clear').click();assert($('choose').disabled,'Conversion slot released before work settled');await waitFor(()=>!$('choose').disabled,'stale work settles');assert($('result').hidden&&!$('drop').hidden);
  });
  await check('Replacing files, malformed inputs and filename injection are safe',async()=>{
    await select([new File(['<svg/>'],'pretend.png')]);assert(!$('error').hidden&&$('convert').disabled);await select([new File([landscape],'<img src=x onerror=alert(1)>.png')]);assert(!$('files').querySelector('img'),'Filename became markup');await convert();await select([portrait]);assert($('result').hidden);assert($('files').textContent.includes('portrait.png'));
  });
  await check('CSV and JSON UI paths and nested-data error recovery',async()=>{
    await route('data');await select([await fixture('records.csv')]);assert($('output').value==='json');await convert();const json=await(await fetch($('downloads').querySelector('a').href)).json();assert(json[0].id==='001');await a11y();
    await select([await fixture('nested.json')]);$('convert').click();await waitFor(()=>!$('choose').disabled,'nested rejection');assert(!$('error').hidden&&$('result').hidden);await select([await fixture('records.json')]);assert($('output').value==='csv');await convert();
  });
  await check('CSV headers beginning with brackets are not mistaken for JSON',async()=>{
    await route('data');await select([new File(['[id],value\n001,kept\n'],'bracket-headers.csv')]);assert($('output').value==='json','CSV was mistaken for JSON');await convert();const records=await(await fetch($('downloads').querySelector('a').href)).json();assert(records[0]['[id]']==='001'&&records[0].value==='kept');await select([new File(['id,value\n'],'headers-only.csv')]);await convert();assert($('result-summary').textContent.includes('0 records'),'Zero record count was omitted');
  });
  await check('Image order controls affect generated PDF order',async()=>{
    await route('makepdf');await select([landscape,portrait]);$('files').firstElementChild.querySelectorAll('button')[1].click();assert($('files').firstElementChild.textContent.includes('portrait.png'));await convert();const blob=await(await fetch($('downloads').querySelector('a').href)).blob();const opened=await openPdf(new File([blob],'ordered.pdf'));try{const page=await opened.doc.getPage(1);assert(page.view[2]<page.view[3]);}finally{await opened.dispose();}await a11y();
  });
  await check('PDF page selection defaults, empty selection and individual download names',async()=>{
    await route('readpdf');await select([await fixture('simple.pdf')]);assert($('pages').querySelectorAll('input:checked').length===3);$('no-pages').click();assert($('convert').disabled);$('pages').querySelectorAll('input')[2].click();await convert();const links=$('downloads').querySelectorAll('a');assert(links.length===1&&links[0].download.includes('page-3'));await a11y();$('all-pages').click();assert($('result').hidden&&$('pages').querySelectorAll('input:checked').length===3);
  });
  await check('DOCX preview and print action accurately replace PDF download',async()=>{
    await route('docxtopdf');await select([await fixture('simple.docx')]);assert($('convert').textContent==='Preview document');await convert();assert($('downloads').querySelector('button').textContent==='Print / Save as PDF');assert(!$('downloads').querySelector('a'));assert($('document-preview').querySelector('iframe').contentDocument.body.textContent.includes('FileHush preview'));await a11y();$('clear').click();assert($('document-preview').hidden&&!$('document-preview').querySelector('iframe').contentDocument.getElementById('document').textContent);
  });
  await check('PDF to DOCX success and page-specific unsupported-content rejection',async()=>{
    await route('pdftodocx');await select([await fixture('simple.pdf')]);await convert();assert($('downloads').querySelector('a').download.endsWith('.docx'));await a11y();await select([await fixture('graphics.pdf')]);$('convert').click();await waitFor(()=>!$('choose').disabled,'PDF rejection');assert($('error').textContent.includes('Page 1')&&$('result').hidden);await a11y();
  });
  await check('All tools navigation clears selected files and results',async()=>{document.querySelector('.back').click();await waitFor(()=>!$('home').hidden,'back navigation');assert($('result').hidden&&$('files').children.length===0);});
  $('ui-summary').textContent=`Complete: ${passed} passed, ${failed} failed.`;$('run-ui').disabled=false;
});

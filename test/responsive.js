const $=id=>document.getElementById(id);const assert=(value,message)=>{if(!value)throw new Error(message);};
async function waitFor(fn){const start=performance.now();while(!fn()){if(performance.now()-start>10000)throw new Error('Layout did not become ready');await new Promise(r=>setTimeout(r,20));}}
$('run').addEventListener('click',async()=>{
 $('run').disabled=true;$('checks').replaceChildren();$('frames').replaceChildren();let passed=0,failed=0;
 for(const width of [320,375,650,1024]) {
  const frame=document.createElement('iframe');frame.title=`${width}px FileHush preview`;frame.width=width;frame.height=850;frame.src='./responsive-app.html';const load=new Promise(r=>frame.addEventListener('load',r,{once:true}));$('frames').append(frame);await load;
  const doc=frame.contentDocument,w=frame.contentWindow;
  async function check(name,fn){const li=document.createElement('li');$('checks').append(li);try{await fn();passed++;li.textContent=`PASS — ${width}px: ${name}`;}catch(error){failed++;li.textContent=`FAIL — ${width}px: ${name}: ${error.message}`;}}
  const fits=()=>assert(doc.documentElement.scrollWidth<=w.innerWidth+1,`Horizontal overflow: ${doc.documentElement.scrollWidth} > ${w.innerWidth}`);
  await waitFor(()=>doc.getElementById('tools').children.length===6);
  await check('hub reflows without horizontal scrolling',async()=>{fits();for(const link of doc.querySelectorAll('.toolcard'))assert(link.getBoundingClientRect().height>=44,'Small card touch target');});
  await check('six tool screens reflow',async()=>{for(const tool of ['image','makepdf','readpdf','data','docxtopdf','pdftodocx']){w.location.hash=tool;await waitFor(()=>doc.title.startsWith({image:'Image converter',makepdf:'Images to PDF',readpdf:'PDF to images',data:'CSV',docxtopdf:'DOCX to PDF',pdftodocx:'PDF to DOCX'}[tool]));fits();}});
  await check('long filenames and 200% text fit',async()=>{
    w.location.hash='data';await waitFor(()=>doc.title.startsWith('CSV'));await waitFor(()=>!doc.getElementById('choose').disabled);const dt=new w.DataTransfer();dt.items.add(new File(['a,b\n1,2\n'],'long-file-name-'.repeat(20)+'.csv'));const input=doc.getElementById('file');input.files=dt.files;input.dispatchEvent(new w.Event('change',{bubbles:true}));await waitFor(()=>!doc.getElementById('choose').disabled);fits();doc.documentElement.style.fontSize='32px';fits();doc.documentElement.style.fontSize='';
  });
 }
 $('summary').textContent=`Complete: ${passed} passed, ${failed} failed.`;$('run').disabled=false;
});

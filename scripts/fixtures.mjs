import {PDFDocument,StandardFonts,rgb,PDFName,PDFString} from 'pdf-lib';import {Document,Paragraph,TextRun,Packer} from 'docx';import {mkdir,writeFile} from 'node:fs/promises';import {zipSync,unzipSync,strToU8} from 'fflate';
await mkdir('test/fixtures',{recursive:true});
const save=(name,data)=>writeFile(`test/fixtures/${name}`,data);
const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
for(let n=1;n<=3;n++){const page=pdf.addPage([300,400]);if(n!==2){page.drawText(n===1?'FileHush editable text':'Last page',{x:30,y:350,size:14,font});page.drawText(n===1?'A second line, preserved.':'End of document.',{x:30,y:320,size:12,font});}}
await save('simple.pdf',await pdf.save());
const graphics=await PDFDocument.create();graphics.addPage([300,400]).drawText('Text with graphics',{x:30,y:350,size:14,font:await graphics.embedFont(StandardFonts.Helvetica)});graphics.getPage(0).drawRectangle({x:30,y:20,width:100,height:100,color:rgb(1,0,0)});await save('graphics.pdf',await graphics.save());
const columns=await PDFDocument.create();const cp=columns.addPage([600,400]);cp.drawText('Left column',{x:30,y:350,size:12});cp.drawText('Right column',{x:350,y:350,size:12});await save('columns.pdf',await columns.save());
const linked=await PDFDocument.create();const lp=linked.addPage([300,400]);lp.drawText('Link',{x:30,y:350,size:12});const ann=linked.context.obj({Type:'Annot',Subtype:'Link',Rect:[30,340,100,360],A:{Type:'Action',S:'URI',URI:PDFString.of('https://example.invalid/never-request')}});lp.node.set(PDFName.of('Annots'),linked.context.obj([linked.context.register(ann)]));await save('linked.pdf',await linked.save());
const big=await PDFDocument.create();big.addPage([10000,10000]);await save('huge-page.pdf',await big.save());
const doc=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new TextRun({text:'FileHush preview',bold:true})]}),new Paragraph('Text stays local. Unicode: café.'),new Paragraph('Print this document using the browser dialog.')]}]}));await save('simple.docx',doc);
const external=unzipSync(doc);external['word/_rels/document.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/never-request" TargetMode="External"/></Relationships>');await save('external.docx',zipSync(external));
const bomb=unzipSync(doc);bomb['word/media/bomb.png']=new Uint8Array(1_000_000);await save('bomb.docx',zipSync(bomb));
await save('records.csv','id,name,note\r\n001,"Zoë, Ada","line 1\nline 2"\r\n002,Ben,=1+1\r\n');
await save('records.json',JSON.stringify([{id:'001',active:true,missing:null},{id:2,note:'hello'}]));
await save('nested.json','[{"value":{"nested":true}}]');
await save('malformed.pdf','not a PDF');
console.log('Fixtures generated.');

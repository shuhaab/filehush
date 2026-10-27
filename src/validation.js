export const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({imageBytes:10*MiB,pixels:12_000_000,side:8192,images:12,combinedBytes:30*MiB,pdfBytes:15*MiB,pages:40,renderPixels:12_000_000,outputBytes:50*MiB,dataBytes:5*MiB,rows:10_000,columns:200,docxBytes:8*MiB,zipBytes:30*MiB,zipEntries:600,text:500_000});
export function fail(message) { throw new Error(message); }
export function checkFile(file, max) {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) fail('Choose a non-empty file.');
  if (file.size > max) fail(`This file exceeds the ${Math.round(max/MiB)} MiB limit.`);
}
export function checkDimensions(width,height,max=LIMITS.pixels) {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMITS.side||height>LIMITS.side||width*height>max) fail('Image dimensions exceed the limit (12 megapixels; 8,192 pixels per side).');
}
const ascii=(b,a,z)=>String.fromCharCode(...b.subarray(a,z));
export function inspectImage(b) {
  const v = new DataView(b.buffer,b.byteOffset,b.byteLength);
  let mime,width,height;
  if (b.length>=24 && ascii(b,0,8)==='\x89PNG\r\n\x1a\n') {
    mime='image/png'; let p=8, ended=false, seenHeader=false;
    while(p+12<=b.length) {
      const n=v.getUint32(p), type=ascii(b,p+4,p+8);
      if(n>b.length-p-12) fail('The PNG is truncated or malformed.');
      if(!seenHeader && (type!=='IHDR'||n!==13)) fail('The PNG header is invalid.');
      if(type==='IHDR') { if(seenHeader) fail('The PNG has duplicate headers.'); seenHeader=true; width=v.getUint32(p+8);height=v.getUint32(p+12); }
      if(['acTL','fcTL','fdAT'].includes(type)) fail('Animated PNG images are not supported. Choose a still image.');
      p+=n+12;
      if(type==='IEND') { if(n!==0||p!==b.length) fail('The PNG end marker is invalid.'); ended=true;break; }
    }
    if(!ended) fail('The PNG is truncated or malformed.');
  } else if(b.length>=12 && ascii(b,0,4)==='RIFF' && ascii(b,8,12)==='WEBP') {
    mime='image/webp'; if(v.getUint32(4,true)+8!==b.length) fail('The WebP container is malformed.');
    let p=12;
    while(p+8<=b.length) {
      const type=ascii(b,p,p+4),n=v.getUint32(p+4,true),d=p+8;
      if(n>b.length-d) fail('The WebP is truncated.');
      if(type==='ANIM'||type==='ANMF'||(type==='VP8X'&&n>=1&&(b[d]&2))) fail('Animated WebP images are not supported. Choose a still image.');
      if(type==='VP8X'&&n===10) {width=1+b[d+4]+(b[d+5]<<8)+(b[d+6]<<16);height=1+b[d+7]+(b[d+8]<<8)+(b[d+9]<<16);}
      if(type==='VP8 '&&n>=10 && ascii(b,d+3,d+6)==='\x9d\x01\x2a') {width=v.getUint16(d+6,true)&16383;height=v.getUint16(d+8,true)&16383;}
      if(type==='VP8L'&&n>=5&&b[d]===0x2f) {const bits=v.getUint32(d+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
      p=d+n+(n%2);
    }
    if(p!==b.length||!width) fail('The WebP structure is invalid.');
  } else if(b.length>=4&&b[0]===255&&b[1]===216) {
    mime='image/jpeg';let p=2;
    while(p+3<b.length) {
      if(b[p++]!==255) fail('The JPEG header is malformed.');
      while(b[p]===255)p++;
      const marker=b[p++];
      if(marker===0xda||marker===0xd9)break;
      if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
      if(p+2>b.length)break;
      const n=v.getUint16(p);if(n<2||p+n>b.length)fail('The JPEG is truncated.');
      if([0xc0,0xc1,0xc2].includes(marker)) {if(n<8)fail('The JPEG frame is invalid.');height=v.getUint16(p+3);width=v.getUint16(p+5);break;}
      p+=n;
    }
    if(!width)fail('This JPEG encoding is unsupported or malformed.');
  } else fail('Choose a still JPG, PNG or WebP image. The file contents do not match a supported image.');
  checkDimensions(width,height);return {mime,width,height};
}
export function outputName(name,extension) {
  const base=String(name).replace(/\.[^.]*$/,'').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'converted';
  return `${base}.${extension}`;
}
export function qualityValue(q) { if(!Number.isFinite(q)||q<0.1||q>1)fail('Choose an image quality between 10 and 100.');return q; }
export function textFromBytes(bytes) {
  try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('This file is not valid UTF-8 text.'); }
}
// ZIP central-directory preflight happens before any decompression.
export function inspectZip(bytes) {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--) if(v.getUint32(p,true)===0x06054b50 && p+22+v.getUint16(p+20,true)===bytes.length){end=p;break;}
  if(end<0)fail('This DOCX is not a valid ZIP package.');
  const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),start=v.getUint32(end+16,true);
  if(v.getUint16(end+4,true)||v.getUint16(end+6,true)||count!==v.getUint16(end+8,true)||!count||count>LIMITS.zipEntries||start+size!==end)fail('Unsupported or excessive DOCX ZIP structure.');
  let p=start,total=0;const entries=new Map();
  for(let i=0;i<count;i++) {
    if(p+46>end||v.getUint32(p,true)!==0x02014b50)fail('Malformed DOCX ZIP directory.');
    const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),compressed=v.getUint32(p+20,true),raw=v.getUint32(p+24,true),n=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
    if(p+46+n+extra+comment>end)fail('Truncated DOCX ZIP directory.');
    const name=textFromBytes(bytes.subarray(p+46,p+46+n));
    if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>x==='..'||x==='.')||/[\x00-\x1f]/.test(name)||entries.has(name))fail('Unsafe or duplicate DOCX package path.');
    if(flags&1||![0,8].includes(method)||raw>8*MiB||raw>Math.max(1,compressed)*250||local+30>start||v.getUint32(local,true)!==0x04034b50)fail('Encrypted, oversized or unsupported DOCX entry.');
    if(v.getUint16(local+8,true)!==method||(v.getUint16(local+6,true)&1))fail('Inconsistent DOCX ZIP compression or encryption flags.');
    const localN=v.getUint16(local+26,true),localExtra=v.getUint16(local+28,true);
    if(textFromBytes(bytes.subarray(local+30,local+30+localN))!==name||local+30+localN+localExtra+compressed>start)fail('Inconsistent DOCX ZIP entry.');
    total+=raw;if(total>LIMITS.zipBytes)fail('The expanded DOCX exceeds 30 MiB.');
    entries.set(name,{raw,compressed,method,offset:local+30+localN+localExtra,crc:v.getUint32(p+16,true)});p+=46+n+extra+comment;
  }
  if(p!==end||!entries.has('[Content_Types].xml')||!entries.has('word/document.xml')||!entries.has('_rels/.rels'))fail('This file is not a supported DOCX document.');
  return entries;
}

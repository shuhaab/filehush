import {LIMITS,checkFile,inspectImage,checkDimensions,qualityValue,fail} from './validation.js';
export const IMAGE_MIMES={jpg:'image/jpeg',png:'image/png',webp:'image/webp'};
export const DEFAULT_QUALITY=0.92;
export async function canvasBlob(canvas,mime,quality=DEFAULT_QUALITY) {
  qualityValue(quality);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,mime,quality));
  if(!blob||blob.type!==mime)fail('This browser cannot encode the requested format. Choose another output.');
  if(blob.size>LIMITS.outputBytes)fail('The output exceeds the 50 MiB limit.');
  return blob;
}
export async function imageCapabilities() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
  const entries=await Promise.all(Object.entries(IMAGE_MIMES).map(async([ext,mime])=>{try{await canvasBlob(canvas,mime);return [ext,true];}catch{return [ext,false];}}));
  canvas.width=canvas.height=0;return Object.fromEntries(entries);
}
export async function decodeImage(file,allowed=Object.values(IMAGE_MIMES)) {
  checkFile(file,LIMITS.imageBytes);const bytes=new Uint8Array(await file.arrayBuffer());const info=inspectImage(bytes);
  if(!allowed.includes(info.mime))fail('Choose a JPG or PNG image for this tool.');
  const url=URL.createObjectURL(new Blob([bytes],{type:info.mime}));const image=new Image();
  try {
    image.src=url;await image.decode();checkDimensions(image.naturalWidth,image.naturalHeight);
    return {image,...info,width:image.naturalWidth,height:image.naturalHeight,dispose(){image.src='';URL.revokeObjectURL(url);}};
  } catch(error){image.src='';URL.revokeObjectURL(url);throw new Error(`This image could not be decoded. ${error.message}`);}
}
export async function convertImage(file,output,quality=DEFAULT_QUALITY) {
  const mime=IMAGE_MIMES[output];if(!mime)fail('Choose a supported image output.');qualityValue(quality);
  const decoded=await decodeImage(file);const canvas=document.createElement('canvas');
  try {
    if(decoded.mime===mime)fail('Choose a different output format; same-format recompression is not supported.');
    canvas.width=decoded.width;canvas.height=decoded.height;const ctx=canvas.getContext('2d');if(!ctx)fail('Canvas is unavailable in this browser.');
    if(output==='jpg'){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
    ctx.drawImage(decoded.image,0,0);
    return {blob:await canvasBlob(canvas,mime,quality),extension:output,width:canvas.width,height:canvas.height};
  } finally{decoded.dispose();canvas.width=canvas.height=0;}
}

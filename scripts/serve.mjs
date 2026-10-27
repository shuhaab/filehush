import http from 'node:http';import {readFile,stat} from 'node:fs/promises';import {resolve,extname,sep} from 'node:path';import {headersFor} from './policy.mjs';
const root=resolve('dist');const port=Number(process.env.PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.pdf':'application/pdf','.wasm':'application/wasm','.bcmap':'application/octet-stream','.pfb':'application/octet-stream','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');let path;try{path=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headersFor(path),'Allow':'GET, HEAD'}).end();return;}
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+sep)||path.split('/').some(p=>p.startsWith('.'))){res.writeHead(403,headersFor(path)).end();return;}
  try{if(!(await stat(file)).isFile())throw new Error();const data=await readFile(file);res.writeHead(200,{...headersFor(path),'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404,headersFor(path)).end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));

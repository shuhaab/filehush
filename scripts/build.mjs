import {build} from 'esbuild';
import {cp,mkdir,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {appPolicy,printPolicy,workerPolicy} from './policy.mjs';
await rm('dist',{recursive:true,force:true});await mkdir('dist/vendor',{recursive:true});
await build({entryPoints:['src/app.js'],bundle:true,outdir:'dist',format:'esm',target:['chrome120','firefox120','safari17'],minify:true,legalComments:'eof',metafile:true}).then(async r=>{
  let firstParty=0;for(const [path,info]of Object.entries(r.metafile.inputs))if(!path.includes('node_modules'))firstParty+=info.bytes;
  console.log('First-party source bytes:',firstParty);
});
await cp('index.html','dist/index.html');await cp('public','dist',{recursive:true});
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs','dist/vendor/pdf.worker.min.mjs');
const assets=[];
for(const dir of ['cmaps','standard_fonts','wasm']) {
  await mkdir(`dist/vendor/${dir}`,{recursive:true});
  for(const name of await readdir(`node_modules/pdfjs-dist/${dir}`)) {
    if(name.startsWith('LICENSE'))continue;
    if(dir==='wasm'&&!name.endsWith('.wasm'))continue;
    if(name.startsWith('quickjs'))continue;
    await cp(`node_modules/pdfjs-dist/${dir}/${name}`,`dist/vendor/${dir}/${name}`);assets.push(`vendor/${dir}/${name}`);
  }
}
await writeFile('dist/vendor/assets.json',JSON.stringify(assets));
const packages=JSON.parse(await readFile('package.json','utf8')).dependencies;
let licenseText='FileHush locally bundled dependencies\n\n';
for(const [name,version]of Object.entries(packages)) {
  const pkg=JSON.parse(await readFile(`node_modules/${name}/package.json`,'utf8'));
  licenseText+=`${name} ${version} — ${pkg.license||'see package'}\n`;
}
// Preserve notices from every shipped transitive dependency, not just direct packages.
for(const name of await readdir('node_modules')) {
  if(name.startsWith('.')||name==='@esbuild'||name==='esbuild')continue;
  const folders=name.startsWith('@')?(await readdir(`node_modules/${name}`)).map(x=>`${name}/${x}`):[name];
  for(const folder of folders) {
    for(const filename of await readdir(`node_modules/${folder}`).catch(()=>[]))if(/^licen[sc]e|^notice/i.test(filename)) {
      const text=await readFile(`node_modules/${folder}/${filename}`,'utf8').catch(()=>null);if(text)licenseText+=`\n===== ${folder}/${filename} =====\n${text}\n`;
    }
  }
}
for(const dir of ['cmaps','standard_fonts','wasm'])for(const name of await readdir(`node_modules/pdfjs-dist/${dir}`))if(name.startsWith('LICENSE'))licenseText+=`\n===== PDF.js ${dir}/${name} =====\n${await readFile(`node_modules/pdfjs-dist/${dir}/${name}`,'utf8')}\n`;
await writeFile('dist/THIRD_PARTY_LICENSES.txt',licenseText);
const common="  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Cross-Origin-Resource-Policy: same-origin\n";
await writeFile('dist/_headers',`/*\n  Content-Security-Policy: ${appPolicy}\n${common}/print.html\n  ! Content-Security-Policy\n  Content-Security-Policy: ${printPolicy}\n/vendor/pdf.worker.min.mjs\n  ! Content-Security-Policy\n  Content-Security-Policy: ${workerPolicy}\n`);
const js=await readFile('dist/app.js'),css=await readFile('dist/app.css');console.log(`App JS gzip: ${gzipSync(js).length} bytes (includes libraries); CSS gzip: ${gzipSync(css).length} bytes; PDF support files: ${assets.length}`);
if(process.argv.includes('--qa')) {
  await build({entryPoints:['test/browser.js'],bundle:true,outfile:'dist/qa.js',format:'esm',target:'es2022',sourcemap:true});
  await build({entryPoints:['test/interactions.js'],bundle:true,outfile:'dist/interactions.js',format:'esm',target:'es2022'});
  await writeFile('dist/interactions.html',(await readFile('index.html','utf8')).replace('</head>','<script type="module" src="./interactions.js"></script></head>'));
  await build({entryPoints:['test/security.js'],bundle:true,outfile:'dist/security.js',format:'esm',target:'es2022'});
  await cp('test/security.html','dist/security.html');
  await cp('index.html','dist/responsive-app.html');
  await build({entryPoints:['test/responsive.js'],bundle:true,outfile:'dist/responsive.js',format:'esm',target:'es2022'});
  await cp('test/responsive.html','dist/responsive.html');
  await cp('test/qa.html','dist/qa.html');await cp('test/fixtures','dist/fixtures',{recursive:true});
}

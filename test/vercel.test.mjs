import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appPolicy,printPolicy,workerPolicy,headersFor} from '../scripts/policy.mjs';
const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
function matchingHeaders(path) {
  return config.headers.filter(rule=>rule.source.includes('(')?new RegExp(`^${rule.source}$`).test(path):rule.source===path).flatMap(rule=>rule.headers);
}
test('Vercel serves only the built static site and preserves HTML paths',()=>{
  assert.equal(config.framework,null);
  assert.equal(config.buildCommand,'npm run build');
  assert.equal(config.outputDirectory,'dist');
  assert.equal(config.cleanUrls,false);
  for(const property of ['rewrites','routes','functions'])assert.equal(config[property],undefined);
});
test('Vercel paths receive exactly one appropriate CSP and common security headers',()=>{
  const cases=[
    ['/',appPolicy],['/index.html',appPolicy],['/app.js',appPolicy],['/app.css',appPolicy],
    ['/print.html',printPolicy],['/print.css',appPolicy],
    ['/vendor/pdf.worker.min.mjs',workerPolicy],
    ['/vendor/wasm/openjpeg.wasm',appPolicy],['/vendor/cmaps/78-EUC-H.bcmap',appPolicy],
    ['/vendor/standard_fonts/LiberationSans-Regular.ttf',appPolicy],
    ['/missing',appPolicy],['/printXhtml',appPolicy],['/vendor/pdfXworkerXminXmjs',appPolicy],
    ['/nested/print.html',appPolicy],['/print.html/extra',appPolicy],['/vendor/pdf.worker.min.mjs/extra',appPolicy]
  ];
  for(const [path,policy] of cases) {
    const headers=matchingHeaders(path);
    const csp=headers.filter(header=>header.key.toLowerCase()==='content-security-policy');
    assert.equal(csp.length,1,`${path}: expected one CSP, avoiding conflicting policies`);
    assert.equal(csp[0].value,policy,path);
    const expected=headersFor('/');
    for(const key of ['X-Content-Type-Options','Referrer-Policy','Permissions-Policy','Cross-Origin-Resource-Policy'])assert.deepEqual(headers.filter(h=>h.key===key),[{key,value:expected[key]}],`${path}: ${key}`);
  }
});

import assert from 'node:assert/strict';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {release} from '../dist/firmware-catalog.mjs';
import {initialImages} from '../dist/initial-catalog.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const expected = ['.nojekyll', 'app.mjs', 'index.html', 'serial.mjs', 'record-export.mjs', 'setup.mjs', 'wizard.mjs', 'receiver-code.txt', 'receiver-manifest.json', 'style.css','firmware-catalog.mjs','firmware-policy.mjs','firmware-update.mjs','flash-adapter.mjs','firmware/s3-0.8.3.mjs','firmware/LICENSES.txt','flasher/esptool.mjs','flasher/LICENSES.txt','initial-catalog.mjs','initial-install.mjs','firmware/bootloader-0.8.3.mjs','firmware/partitions-0.8.3.mjs'];
async function inventory(dir,prefix=''){
 const all=[];for(const name of await readdir(dir)){const entry=path.join(dir,name),stat=await lstat(entry);assert(!stat.isSymbolicLink(),'No published symlinks');if(stat.isDirectory())all.push(...await inventory(entry,prefix+name+'/'));else{assert(stat.isFile());all.push(prefix+name);}}return all;
}
assert.deepEqual((await inventory(directory)).sort(), expected.toSorted(), 'Unexpected published file');
const files = {};
for (const name of expected) {
  const entry = path.join(directory, name);
  assert((await lstat(entry)).isFile(), 'Published assets must be regular files');
  files[name] = await readFile(entry, 'utf8');
}

const html = files['index.html'];
assert(html.includes("connect-src 'none'"), 'Network requests must stay disabled');
assert(html.includes("form-action 'none'"), 'Credentials must not be submitted to a server');
assert(!/\son\w+\s*=/i.test(html), 'Inline event handlers are not allowed');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, 'Use only the local application script');
assert(/\bsrc="app\.mjs\?v=0\.7\.0"/.test(scripts[0][1]) && !scripts[0][2].trim(), 'Remote or inline script');
assert(/href="style\.css\?v=0\.7\.0"/.test(html), 'Use the local stylesheet');
assert(!/<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:\/|https?:|\/\/)/i.test(html), 'Assets must work below the GitHub project path');
const external = new Set(['https://sheets.google.com/create','https://script.google.com/home','https://developers.google.com/apps-script/guides/web']);
for(const match of html.matchAll(/<a\b[^>]*href="(https?:[^\"]+)"[^>]*>/g)){
  assert(external.has(match[1]), 'Unreviewed external navigation');
  assert(match[0].includes('target="_blank"')&&match[0].includes('rel="noopener noreferrer"'), 'External link must not expose page context');
}

const javascript = expected.filter(f=>f.endsWith('.mjs')).map(f=>files[f]).join('\n');
assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(javascript), 'USB settings must not use a network transport');
assert(!/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(javascript), 'Do not persist credentials in browser storage');
const encoded=/^export default `([A-Za-z0-9+/=\n]+)`;$/m.exec(files['firmware/s3-0.8.3.mjs']);assert(encoded,'Unexpected firmware module');
const image=Buffer.from(encoded[1],'base64');assert.equal(image.length,release.bytes);assert.equal(image[0],0xe9);assert.equal(image.readUInt16LE(12),9);
assert.equal(createHash('sha256').update(image).digest('hex'),release.sha256,'Generic application image changed');
assert.equal(createHash('sha256').update(files['flasher/esptool.mjs']).digest('hex'),'c6ccfa23e5ded4e2ccf6704472f3304be224ad2b81a60d5bcee3a2c296fcffab','Reviewed flasher changed');
for(const [i,name] of ['bootloader','partitions'].entries()){
 const encoded=/^export default `([A-Za-z0-9+/=\n]+)`;$/m.exec(files[`firmware/${name}-0.8.3.mjs`]);assert(encoded);const bytes=Buffer.from(encoded[1],'base64');assert.equal(bytes.length,initialImages[i].bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),initialImages[i].sha256);
}
// The pinned public firmware hashes is not a device token. Binary/vendor modules
// are pinned above; human-authored code still receives all secret checks.
const payload = expected.filter(name=>!name.startsWith('flasher/')&&!name.startsWith('firmware/')).map(name=>files[name]).join('\n');
const sanitized=initialImages.reduce((text,image)=>text.replaceAll(image.sha256,'PUBLIC_FIRMWARE_SHA256'),payload);
const forbidden = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /["'][a-f0-9]{64}["']/i,
  /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/,
  /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/,
];
for (const pattern of forbidden) assert(!pattern.test(sanitized), 'Private deployment data in public assets');
assert.equal(JSON.parse(files['receiver-manifest.json']).runtimeVersion,'V8');
console.log('Public assets: 22 reviewed local files, pinned generic app/flasher, no fetch/CDN/data transport or embedded credentials.');

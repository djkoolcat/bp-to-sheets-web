import assert from 'node:assert/strict';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const expected = ['.nojekyll', 'app.mjs', 'index.html', 'serial.mjs', 'record-export.mjs', 'setup.mjs', 'wizard.mjs', 'receiver-code.txt', 'receiver-manifest.json', 'style.css'];
assert.deepEqual((await readdir(directory)).sort(), expected.toSorted(), 'Unexpected published file');
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
assert(/\bsrc="app\.mjs"/.test(scripts[0][1]) && !scripts[0][2].trim(), 'Remote or inline script');
assert(/href="style\.css"/.test(html), 'Use the local stylesheet');
assert(!/<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:\/|https?:|\/\/)/i.test(html), 'Assets must work below the GitHub project path');
const external = new Set(['https://sheets.google.com/create','https://script.google.com/home','https://developers.google.com/apps-script/guides/web']);
for(const match of html.matchAll(/<a\b[^>]*href="(https?:[^\"]+)"[^>]*>/g)){
  assert(external.has(match[1]), 'Unreviewed external navigation');
  assert(match[0].includes('target="_blank"')&&match[0].includes('rel="noopener noreferrer"'), 'External link must not expose page context');
}

const javascript = expected.filter(f=>f.endsWith('.mjs')).map(f=>files[f]).join('\n');
assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(javascript), 'USB settings must not use a network transport');
assert(!/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(javascript), 'Do not persist credentials in browser storage');
const payload = Object.values(files).join('\n');
const forbidden = [
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /["'][a-f0-9]{64}["']/i,
  /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/,
  /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/,
];
for (const pattern of forbidden) assert(!pattern.test(payload), 'Private deployment data in public assets');
assert.equal(JSON.parse(files['receiver-manifest.json']).runtimeVersion,'V8');
console.log('Public assets: 10 reviewed local files, no network data transport or embedded credentials. Google links are explicit navigation only.');

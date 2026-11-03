import assert from 'node:assert/strict';
import {lstat, readdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const expected = ['.nojekyll', 'app.mjs', 'index.html', 'serial.mjs', 'style.css'];
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
assert(!/(?:src|href)=["'](?:\/|https?:|\/\/)/i.test(html), 'Assets must work below the GitHub project path');

const javascript = files['app.mjs'] + '\n' + files['serial.mjs'];
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
console.log('Public assets: 5 local files, project-relative paths, no network settings transport or embedded credentials.');

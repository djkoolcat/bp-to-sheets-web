// Publish generic source only. Never read a user's script properties or tokens.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../apps-script/',import.meta.url),dist=new URL('../dist/',import.meta.url);
const code=await readFile(new URL('Code.gs',root),'utf8');
await writeFile(new URL('receiver-code.txt',dist),code);
await writeFile(new URL('receiver-manifest.json',dist),await readFile(new URL('appsscript.json',root),'utf8'));
await writeFile(new URL('receiver-source.mjs',dist),'// Generic Apps Script source for clipboard copying; contains no deployment values.\nexport const receiverSource='+JSON.stringify(code)+';\n');
console.log('Prepared canonical receiver download, clipboard module and manifest.');

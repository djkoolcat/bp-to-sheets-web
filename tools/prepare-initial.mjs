import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {initialImages} from '../dist/initial-catalog.mjs';
import path from 'node:path';
if(process.argv.length!==3)throw Error('Pass the verified generic build directory, never a device backup.');
for(const [i,suffix] of ['bootloader','partitions'].entries()){
 const data=await readFile(path.join(process.argv[2],`s3-lcd154.ino.${suffix}.bin`)),expected=initialImages[i];
 if(data.length!==expected.bytes||createHash('sha256').update(data).digest('hex')!==expected.sha256)throw Error('Initial image does not match the verified release.');
 await writeFile(new URL(`../dist/firmware/${suffix}-0.8.3.mjs`,import.meta.url),'// Generic build output only; never a provisioned device backup.\nexport default `'+data.toString('base64').match(/.{1,32}/g).join('\n')+'`;\n');
}
console.log('Pinned generic bootloader and partition modules prepared. No NVS or device data.');

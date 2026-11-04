import {release,loadReleaseImage} from './firmware-catalog.mjs?v=0.8.0';
export const initialImages=Object.freeze([
 Object.freeze({name:'bootloader',address:0,bytes:15104,sha256:'2a71d69b471e20c2bac7fb469f3c6a807b3ebee780e348e5889db0da849ca363'}),
 Object.freeze({name:'partitions',address:0x8000,bytes:3072,sha256:'ceba6807acd079092a41a02373aca644f8e0e4a0c2f1903eb5829fa4c5f6d8e6'}),
 Object.freeze({name:'application',address:release.address,bytes:release.bytes,sha256:release.sha256}),
]);
export async function loadInitialImages(){return [(await import('./firmware/bootloader-0.8.3.mjs')).default,(await import('./firmware/partitions-0.8.3.mjs')).default,await loadReleaseImage()];}

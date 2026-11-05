// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-1.0.2',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:2001968,imageChip:9,sha256:'dcaccbaaa142ec02281feadca2536fdd88509dcd8da00a99d9cf7b2e73b500a9',date:'2026-11-06'});
export async function loadReleaseImage(){return (await import('./firmware/s3-1.0.2.mjs')).default;}

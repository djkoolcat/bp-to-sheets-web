// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-0.8.3',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:1871776,imageChip:9,sha256:'92553326c791697b23c78ea98002e82456738f41386cf011f7848320affdc5a9',date:'2026-11-04'});
export async function loadReleaseImage(){return (await import('./firmware/s3-0.8.3.mjs')).default;}

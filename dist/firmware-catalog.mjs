// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-0.9.1',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:1913040,imageChip:9,sha256:'e59e5054a5fe5f326a75b9e40be4bb7e377055c8448d3515d0c99ac5d473eeb2',date:'2026-11-04'});
export async function loadReleaseImage(){return (await import('./firmware/s3-0.9.1.mjs')).default;}

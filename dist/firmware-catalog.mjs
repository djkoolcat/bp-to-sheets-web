// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-1.0.1',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:2002016,imageChip:9,sha256:'5f4fda11085f6a4145f01f66ffb7570680289816d3814c8bb2d231f33fe895de',date:'2026-11-06'});
export async function loadReleaseImage(){return (await import('./firmware/s3-1.0.1.mjs')).default;}

// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-1.0.0',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:1992608,imageChip:9,sha256:'b29f2da216107569f7002d4196160354b99506a919066328c42cc9cbf2b405f3',date:'2026-11-04'});
export async function loadReleaseImage(){return (await import('./firmware/s3-1.0.0.mjs')).default;}

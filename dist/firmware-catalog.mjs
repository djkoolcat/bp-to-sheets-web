// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-0.9.2',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:1992464,imageChip:9,sha256:'9cde8dc47ecbc6e23cd45025b2267dfab0ba6c761892abd6d6d2ab42cb3331b3',date:'2026-11-04'});
export async function loadReleaseImage(){return (await import('./firmware/s3-0.9.2.mjs')).default;}

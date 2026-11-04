// Generic application image, never read from a provisioned board or NVS.
export const release=Object.freeze({schemaVersion:1,chip:'esp32s3',boardId:'waveshare-s3-lcd154',version:'hem-0.9.0',address:0x10000,partitionSize:0x600000,flashSize:0x1000000,bytes:1875840,imageChip:9,sha256:'42243ea82adeafc96eaa8ed68c91bbe204ac12912145a1f84b16933f21aac7e5',date:'2026-11-04'});
export async function loadReleaseImage(){return (await import('./firmware/s3-0.9.0.mjs')).default;}

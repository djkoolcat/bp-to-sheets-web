import {hex,bridgeFromMac,verifyPartitions} from './firmware-policy.mjs?v=0.7.1';
// Native USB has a small receive buffer. Keep each stub read packet bounded
// and acknowledge it before requesting the next; never read NVS or logs.
export async function readPartitionTable(loader,transport,md5,{validate=true}={}){
 const words=new Uint32Array([0x8000,0xc00,256,1]);
 const command=new Uint8Array(16),view=new DataView(command.buffer);
 words.forEach((word,i)=>view.setUint32(i*4,word,true));
 if(await loader.checkCommand('read partition table',loader.ESP_READ_FLASH,command)!==0)throw Error('partition_layout');
 const table=new Uint8Array(0xc00);let received=0;
 while(received<table.length){
  const packet=await transport.read(5000);
  if(!(packet instanceof Uint8Array)||!packet.length||packet.length>256||received+packet.length>table.length)throw Error('partition_checksum');
  table.set(packet,received);received+=packet.length;
  const ack=new Uint8Array(4);new DataView(ack.buffer).setUint32(0,received,true);await transport.write(ack);
 }
 const digest=await transport.read(5000);
 if(!(digest instanceof Uint8Array)||digest.length!==16||hex(digest)!==hex(md5(table)))throw Error('partition_checksum');
 if(validate)verifyPartitions(table,md5);return table;
}
export async function createFlasher(port,implementation=null){
 const {ESPLoader,Transport,md5}=implementation||await import('./flasher/esptool.mjs');
 const transport=new Transport(port,false);transport.trace=()=>{};
 const terminal={clean(){},write(){},writeLine(){}};
 const loader=new ESPLoader({transport,baudrate:115200,romBaudrate:115200,terminal,debugLogging:false,enableTracing:false,resetConstructors:{hardReset:t=>({async reset(){
  // Explicitly assert then release reset; a release-only sequence leaves the
  // native USB stub running after a failed preflight or a successful write.
  await t.setDTR(false);await t.setRTS(true);await new Promise(r=>setTimeout(r,100));await t.setRTS(false);
 }})}});
 async function identity(){
  if(loader.chip?.CHIP_NAME!=='ESP32-S3')throw Error('unsupported_board');
  const security=await loader.getSecurityInfo();
  if(loader.secureDownloadMode||!security?.parsedFlags||security.parsedFlags.SECURE_BOOT_EN||security.parsedFlags.SECURE_DOWNLOAD_ENABLE||security.flashCryptCnt!==0)throw Error('secure_board_unsupported');
  return {chip:'esp32s3',bridgeId:bridgeFromMac(await loader.chip.readMac(loader)),flashSize:await loader.detectFlashSize()};
 }
 return {
  async connect(){
   await loader.main();
   return identity();
  },
  identity,
  async partitionTable(){return readPartitionTable(loader,transport,md5,{validate:false});},
  async partitions(){
   await readPartitionTable(loader,transport,md5);return true;
  },
  async protectedHashes(){
   const hashes=[];
   for(const [address,size] of [[0x9000,0x6000],[0x610000,0x10000]]){
    const hash=String(await loader.flashMd5sum(address,size)).toLowerCase();
    if(!/^[a-f0-9]{32}$/.test(hash))throw Error('preservation_failed');hashes.push(hash);
   }return hashes;
  },
  async write(image,progress){
   await loader.writeFlash({fileArray:[{address:0x10000,data:image}],flashMode:'keep',flashFreq:'keep',flashSize:'keep',eraseAll:false,compress:true,calculateMD5Hash:data=>hex(md5(data)),reportProgress:(_i,written,total)=>progress(Math.floor(written*100/total))});
  },
  async matchesInitial(files){for(const f of files)if(String(await loader.flashMd5sum(f.address,f.data.length)).toLowerCase()!==hex(md5(f.data)))return false;return true;},
  async writeInitial(files,progress){
   // Exact three sector-aligned ranges only. Never erase all or accept addresses from UI.
   if(files.length!==3||files.some((f,i)=>f.address!==[0,0x8000,0x10000][i]||!(f.data instanceof Uint8Array))||files[0].data.length!==15104||files[1].data.length!==0xc00||files[2].data.length!==1871776)throw Error('firmware_image');
   const total=files.reduce((n,f)=>n+f.data.length,0);let done=0,last=-1;
   await loader.writeFlash({fileArray:files,flashMode:'keep',flashFreq:'keep',flashSize:'keep',eraseAll:false,compress:true,calculateMD5Hash:data=>hex(md5(data)),reportProgress:(i,written)=>{if(i!==last){done=files.slice(0,i).reduce((n,f)=>n+f.data.length,0);last=i;}progress(Math.min(100,Math.floor((done+written)*100/total)));}});
  },
  async reset(){await loader.after('hard_reset');},
  async close(){try{await transport.disconnect();}catch{}},
 };
}

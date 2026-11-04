import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {release,loadReleaseImage} from '../dist/firmware-catalog.mjs';
import {compareVersion,compatible,verifyImage,bridgeFromMac,verifyPartitions,verifySettings,verifyRecords} from '../dist/firmware-policy.mjs';
import {FirmwareUpdate} from '../dist/firmware-update.mjs';
import {md5} from '../dist/flasher/esptool.mjs';
const board={chip:'esp32s3',boardId:'waveshare-s3-lcd154',appPartitionSize:0x600000,flashSize:0x1000000,bridgeId:'esp32-060504030201',meterId:'synthetic',firmwareVersion:'hem-0.7.0',queueReady:true,remembered:3,pending:1,configured:true,hasSavedToken:true,hasSavedPassword:true,hasPairingKey:false,autoEnabled:true,meterModel:'microlife-b4bt',targetAddress:'01:02:03:04:05:06',sheetLinkSupported:true,sheetUrl:'synthetic-tab-1',sheetUserLinksSupported:true,sheetUserUrls:['synthetic-tab-1','synthetic-tab-2'],wifiSsid:'synthetic-network',receiverUrl:'synthetic-endpoint'};
const later={...board,firmwareVersion:release.version,pending:0};
function table(change=()=>{}){
 const b=new Uint8Array(0xc00);b.fill(255);const d=new DataView(b.buffer);
 const rows=[[1,2,0x9000,0x6000,'nvs'],[1,1,0xf000,0x1000,'phy_init'],[0,0,0x10000,0x600000,'factory'],[1,0x40,0x610000,0x10000,'hem-log']];
 rows.forEach(([type,sub,start,size,label],i)=>{const p=i*32;b.fill(0,p,p+32);d.setUint16(p,0x50aa,true);b[p+2]=type;b[p+3]=sub;d.setUint32(p+4,start,true);d.setUint32(p+8,size,true);b.set(new TextEncoder().encode(label),p+12);});
 change(b,d);b.fill(255,128,144);d.setUint16(128,0xebeb,true);b.set(md5(b.subarray(0,128)),144);return b;
}
test('Release checks bind chip, exact image hash, version ordering and physical MAC identity',async()=>{
 assert(compatible(board,release));assert(!compatible({...board,chip:'esp32c3'},release));assert(!compatible({...board,boardId:'generic'},release));
 assert.equal(compareVersion('hem-0.10.0','hem-0.8.3'),1);assert.equal(compareVersion('hem-0.8.3','hem-0.8.3'),0);
 assert.equal(bridgeFromMac('01:02:03:04:05:06'),board.bridgeId);
 const encoded=await loadReleaseImage(),bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));await verifyImage(bytes,release);
 const damaged=bytes.slice();damaged[1000]^=1;await assert.rejects(verifyImage(damaged,release),/firmware_hash/);
 const wrong=bytes.slice();wrong[12]=5;await assert.rejects(verifyImage(wrong,release),/firmware_image/);
});
test('Partition MD5 is checked in addition to exact NVS/app/log boundaries and labels',()=>{
 assert(verifyPartitions(table(),md5));const bad=table();bad[17]^=1;assert.throws(()=>verifyPartitions(bad,md5),/checksum/);
 for(const mutate of [(_b,d)=>d.setUint32(8,0x5000,true),(_b,d)=>d.setUint32(72,0x610000,true),(_b,d)=>d.setUint32(100,0x600000,true),(b)=>b[64+3]=0x10,(_b,d)=>d.setUint32(28,1,true)])assert.throws(()=>verifyPartitions(table(mutate),md5),/partition_layout/);
});
test('Preservation rejects lost history, changed secrets/configuration and ACK regression',()=>{
 verifySettings(board,later,release);for(const change of [{remembered:2},{meterId:'other'},{hasSavedToken:false},{wifiSsid:'other'},{sheetUserUrls:['wrong','tabs']}])assert.throws(()=>verifySettings(board,{...later,...change},release),/preservation_failed/);
 const row={recordId:'synthetic-id',systolic:123,userSlot:1,acknowledged:false};verifyRecords({rows:[row]},{rows:[{...row,acknowledged:true}]});
 for(const rows of [[],[{...row,systolic:124}],[row,row]])assert.throws(()=>verifyRecords({rows:[row]},{rows}),/preservation_failed/);
 assert.throws(()=>verifyRecords({rows:[{...row,acknowledged:true}]},{rows:[row]}),/preservation_failed/);
});
function harness({identity=board.bridgeId,writeError=false,changedProtected=false,disconnected=false,after=later,loadImage=loadReleaseImage}={}){
 const calls=[],port={getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};let enabled=true,reads=0,hashReads=0,failWrite=writeError,missing=disconnected;
 const connection={port,get enabled(){return enabled;},async read(){return board;},async close(){enabled=false;calls.push('close');},async attach(){calls.push('attach');if(missing)throw Error('usb_disconnected');enabled=true;return after;}};
 const client={async request(op){assert.equal(op,'hold');calls.push('hold');return board;}};
 const makeFlasher=async()=>({async connect(){calls.push('loader');return {chip:'esp32s3',bridgeId:identity,flashSize:'16MB'};},async partitions(){calls.push('partitions');},async protectedHashes(){return ['nvs',changedProtected&&++hashReads>1?'changed':'log'];},async write(){calls.push('write');if(failWrite){failWrite=false;throw Error('interrupted');}},async reset(){calls.push('reset');},async close(){calls.push('flasher-close');}});
 const update=new FirmwareUpdate({connection,client,getPorts:async()=>[port],makeFlasher,loadImage,wait:async()=>{},attempts:2});
 return {update,calls,port,restore:()=>{missing=false;}};
}
test('Update holds the application, verifies loader identity/partitions, writes once and checks preservation',async()=>{
 const h=harness();assert.equal((await h.update.start(board)).firmwareVersion,release.version);
 assert(h.calls.indexOf('hold')<h.calls.indexOf('loader'));assert(h.calls.indexOf('partitions')<h.calls.indexOf('write'));assert.equal(h.calls.filter(x=>x==='write').length,1);assert.equal(h.update.stage,'complete');assert(!h.update.recoverable);
});
test('Bad firmware/foreign loader cannot write; same and newer versions require deliberate reinstall/refusal',async()=>{
 const bad=harness({loadImage:async()=>btoa('wrong file')});await assert.rejects(bad.update.start(board));assert(!bad.calls.includes('hold'));assert(!bad.calls.includes('write'));
 const foreign=harness({identity:'esp32-000000000002'});await assert.rejects(foreign.update.start(board),/board_changed/);assert(!foreign.calls.includes('write'));
 await assert.rejects(harness().update.start(later),/firmware_not_newer/);await assert.rejects(harness().update.start({...later,firmwareVersion:'hem-1.0.0'},{reinstall:true}),/firmware_not_newer/);
});
test('An interrupted write never retries itself; manual retry writes the same checked image',async()=>{
 const h=harness({writeError:true});await assert.rejects(h.update.start(board),/interrupted/);assert.equal(h.calls.filter(x=>x==='write').length,1);assert(h.update.recoverable);
 await h.update.retry(h.port);assert.equal(h.calls.filter(x=>x==='write').length,2);assert.equal(h.update.stage,'complete');
});
test('A lost reconnect retries verification only, never reflashes an already verified image',async()=>{
 const h=harness({disconnected:true});await assert.rejects(h.update.start(board),/firmware_reconnect/);assert(h.update.verified);h.restore();await h.update.retry(h.port);assert.equal(h.calls.filter(x=>x==='write').length,1);
});
test('Changed protected-region hashes or settings can never report completion',async()=>{
 const protectedChange=harness({changedProtected:true});await assert.rejects(protectedChange.update.start(board),/preservation_failed/);assert.notEqual(protectedChange.update.stage,'complete');
 const settingChange=harness({after:{...later,hasSavedToken:false}});await assert.rejects(settingChange.update.start(board),/preservation_failed/);assert.notEqual(settingChange.update.stage,'complete');
});

test('Native USB partition read uses small acknowledged packets and consumes final digest',async()=>{
 const {readPartitionTable}=await import('../dist/flash-adapter.mjs');const bytes=table(),packets=[];let sent=0;
 for(let offset=0;offset<bytes.length;offset+=256)packets.push(bytes.slice(offset,offset+256));packets.push(md5(bytes));
 const loader={ESP_READ_FLASH:0xd2,async checkCommand(_name,op,payload){assert.equal(op,0xd2);assert.deepEqual([...new Uint32Array(payload.buffer)],[0x8000,0xc00,256,1]);return 0;}};
 const transport={async read(timeout){assert.equal(timeout,5000);return packets.shift();},async write(ack){sent+=256;assert.equal(new DataView(ack.buffer).getUint32(0,true),sent);}};
 assert.deepEqual(await readPartitionTable(loader,transport,md5),bytes);assert.equal(sent,0xc00);assert.equal(packets.length,0);
});

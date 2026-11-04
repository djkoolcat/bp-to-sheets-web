import {test} from 'node:test';
import assert from 'node:assert/strict';
import {release} from '../dist/firmware-catalog.mjs';
import {FactoryReset,confirmReset,verifyReset} from '../dist/factory-reset.mjs';
import {blankProtectedHashes} from '../dist/initial-install.mjs';
import {createFlasher,validateUserDataFiles} from '../dist/flash-adapter.mjs';
const board={chip:'esp32s3',boardId:release.boardId,appPartitionSize:release.partitionSize,flashSize:release.flashSize,bridgeId:'esp32-000000000001',meterId:'synthetic',session:'a'.repeat(32),firmwareVersion:'hem-1.0.0',queueReady:true,remembered:4,pending:1,configured:true,hasSavedPassword:true,hasSavedToken:true,hasPairingKey:true,autoEnabled:true,meterModel:'microlife-b4bt',targetAddress:'01:02:03:04:05:06',sheetUrl:'synthetic',sheetUserUrls:['synthetic-a','synthetic-b']};
const empty={...board,meterId:'new-default',remembered:0,pending:0,configured:false,hasSavedPassword:false,hasSavedToken:false,hasPairingKey:false,autoEnabled:false,meterModel:'omron-hem7155t',targetAddress:'',sheetUrl:'',sheetUserUrls:['','']};
const consent={confirmation:board.bridgeId,acknowledgeLoss:true};
function harness({foreign=false,interrupted=false,lostAck=false,disconnected=false,firmwareChanged=false,after=empty,changedCounts=false}={}){
 const calls=[],port={getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};let cleared=false,firmwareReads=0,drop=disconnected;
 const connection={port,enabled:true,async read(){return changedCounts?{...board,remembered:5}:board;},async close(){this.enabled=false;calls.push('close');},async attach(){if(drop)throw Error('usb_disconnected');this.enabled=true;return after;}};
 const client={async request(operation){assert.equal(operation,'hold');calls.push('hold');return board;}};
 const makeFlasher=async()=>({async connect(){calls.push('loader');return {chip:'esp32s3',bridgeId:foreign?'esp32-000000000002':board.bridgeId,flashSize:'16MB'};},async partitions(){calls.push('partitions');},async firmwareHashes(){calls.push('firmware-hash');return [firmwareChanged&&++firmwareReads>1?'changed':'app','boot','partitions','phy'];},async protectedHashes(){return cleared?[...blankProtectedHashes]:['saved-nvs','saved-log'];},async clearUserData(){calls.push('erase');if(interrupted){interrupted=false;throw Error('interrupted');}cleared=true;if(lostAck){lostAck=false;throw Error('lost_ack');}},async reset(){calls.push('reset');},async close(){calls.push('loader-close');}});
 return {reset:new FactoryReset({connection,client,getPorts:async()=>[port],makeFlasher,wait:async()=>{},attempts:2}),calls,port,restore(){drop=false;}};
}
test('Factory reset requires explicit matching board ID, deletion acknowledgement and 1.0 firmware',async()=>{
 for(const fields of [{},{...consent,confirmation:'other'},{...consent,acknowledgeLoss:false}])assert.throws(()=>confirmReset(board,fields),/reset_confirmation/);
 assert.throws(()=>confirmReset({...board,firmwareVersion:'hem-0.9.2'},consent),/reset_update_required/);
 const h=harness();await assert.rejects(h.reset.start(board,{}),/reset_confirmation/);assert.deepEqual(h.calls,[]);
 const changed=harness({changedCounts:true});await assert.rejects(changed.reset.start(board,consent),/snapshot_changed/);assert(!changed.calls.includes('hold'));
});
test('Reset pauses only after consent, checks exact hardware and partitions, verifies firmware hashes and empty data',async()=>{
 const h=harness();assert.equal((await h.reset.start(board,consent)).firmwareVersion,board.firmwareVersion);
 assert(h.calls.indexOf('hold')<h.calls.indexOf('loader'));assert(h.calls.indexOf('partitions')<h.calls.indexOf('erase'));assert(h.calls.indexOf('firmware-hash')<h.calls.indexOf('erase'));assert.equal(h.calls.filter(v=>v==='erase').length,1);assert.equal(h.reset.stage,'complete');
 const foreign=harness({foreign:true});await assert.rejects(foreign.reset.start(board,consent),/board_changed/);assert(!foreign.calls.includes('erase'));
});
test('No reset retry is automatic; every partial erase retry requires renewed consent',async()=>{
 const h=harness({interrupted:true});await assert.rejects(h.reset.start(board,consent),/interrupted/);assert(h.reset.recoverable);assert.equal(h.calls.filter(v=>v==='erase').length,1);
 await assert.rejects(h.reset.retry(h.port,{}),/reset_confirmation/);assert.equal(h.calls.filter(v=>v==='erase').length,1);
 await h.reset.retry(h.port,consent);assert.equal(h.calls.filter(v=>v==='erase').length,2);
});
test('A lost erase acknowledgement or reconnect only verifies the cleared state without erasing twice',async()=>{
 for(const options of [{lostAck:true},{disconnected:true}]){
  const h=harness(options);await assert.rejects(h.reset.start(board,consent));assert.equal(h.calls.filter(v=>v==='erase').length,1);h.restore();
  await h.reset.retry(h.port,consent);assert.equal(h.calls.filter(v=>v==='erase').length,1);assert.equal(h.reset.stage,'complete');
 }
});
test('Changed firmware or residual settings can never be reported as a successful reset',async()=>{
 const h=harness({firmwareChanged:true});await assert.rejects(h.reset.start(board,consent),/preservation_failed/);assert.notEqual(h.reset.stage,'complete');
 for(const changes of [{hasPairingKey:true},{remembered:1},{pending:1},{hasSavedToken:true},{firmwareVersion:'hem-0.9.2'},{sheetUserUrls:['old','old']},{targetAddress:'01:02:03:04:05:06'}])assert.throws(()=>verifyReset(board,{...empty,...changes}),/reset_not_empty/);
 assert.throws(()=>verifyReset(board,{...empty,bridgeId:'esp32-000000000002'}),/board_changed/);
});
test('Real reset adapter writes only blank NVS and log sectors; app, bootloader, partition table and PHY are absent',async()=>{
 let observed;
 class Loader{async writeFlash(options){observed={eraseAll:options.eraseAll,files:options.fileArray.map(f=>({address:f.address,data:f.data.slice()}))};}}
 class Transport{async disconnect(){}}
 const flasher=await createFlasher({}, {ESPLoader:Loader,Transport,md5:()=>new Uint8Array(16)});
 await flasher.clearUserData(()=>{});assert.equal(observed.eraseAll,false);
 assert.deepEqual(observed.files.map(f=>[f.address,f.data.length]),[[0x9000,0x6000],[0x610000,0x10000]]);
 validateUserDataFiles(observed.files);
 for(const files of [[{address:0x10000,data:new Uint8Array(0x6000).fill(255)},observed.files[1]],[{...observed.files[0],data:new Uint8Array(0x6000)},observed.files[1]],observed.files.slice(0,1)])assert.throws(()=>validateUserDataFiles(files),/reset_regions/);
});

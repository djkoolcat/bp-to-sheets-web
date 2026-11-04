import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InitialInstall,blankProtectedHashes,requireEmptyState,verifiedInitialFiles,verifyFreshBoard} from '../dist/initial-install.mjs';
import {initialImages,loadInitialImages} from '../dist/initial-catalog.mjs';
import {release} from '../dist/firmware-catalog.mjs';
import {createFlasher} from '../dist/flash-adapter.mjs';
import {md5} from '../dist/flasher/esptool.mjs';
const chip={chip:'esp32s3',flashSize:'16MB',bridgeId:'esp32-060504030201'};
const fresh={...chip,flashSize:0x1000000,boardId:release.boardId,firmwareVersion:release.version,appPartitionSize:0x600000,queueReady:true,remembered:0,pending:0,configured:false,hasSavedPassword:false,hasSavedToken:false,hasPairingKey:false,autoEnabled:false,sheetUrl:'',sheetUserUrls:['','']};
const blank=()=>new Uint8Array(0xc00).fill(255);
function existing(){const b=blank();b[0]=0xaa;b[1]=0x50;b.fill(0,12,28);b.set(new TextEncoder().encode('hem-log'),12);return b;}
const confirmed={confirmed:true,model:true};
function harness({boardChip=chip,table=blank(),hashes=blankProtectedHashes,failWrite=false,failReconnect=false,after=fresh,matches=false,loadImages=loadInitialImages}={}){
 const calls=[],port={getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};let current=boardChip,missing=failReconnect,writeFail=failWrite,match=matches,protectedReads=0;
 const connection={enabled:false,async attach(){calls.push('attach');if(missing)throw Error('usb_disconnected');this.enabled=true;return after;},async close(){this.enabled=false;calls.push('app-close');}};
 const makeFlasher=async()=>({async connect(){calls.push('loader');return current;},async identity(){calls.push('identity');return current;},async partitionTable(){calls.push('table');return table;},async protectedHashes(){calls.push('hash');protectedReads++;return typeof hashes==='function'?hashes(protectedReads):hashes;},async matchesInitial(){calls.push('image-check');return match;},async writeInitial(files){calls.push('write');assert.deepEqual(files.map(f=>f.address),[0,0x8000,0x10000]);if(writeFail){writeFail=false;throw Error('usb_disconnected');}},async reset(){calls.push('reset');},async close(){calls.push('close');}});
 const install=new InitialInstall({connection,getPorts:async()=>[port],makeFlasher,loadImages,attempts:2,wait:async()=>{}});
 return {install,calls,port,connection,swap:()=>{current={...chip,bridgeId:'esp32-000000000001'};},restore:()=>{missing=false;},imagesMatch:()=>{match=true;}};
}
test('Initial release contains only pinned generic bootloader, partitions and application',async()=>{
 const files=await verifiedInitialFiles();assert.deepEqual(files.map(f=>f.address),[0,0x8000,0x10000]);assert.deepEqual(files.map(f=>f.data.length),initialImages.map(f=>f.bytes));
 const encoded=await loadInitialImages();encoded[0]=btoa('corrupted');await assert.rejects(verifiedInitialFiles(async()=>encoded),/firmware_hash/);
});
test('Existing BP partition or any initialized NVS/log prevents initial writes; blank stock demo storage may pass',()=>{
 requireEmptyState(blank(),blankProtectedHashes);assert.throws(()=>requireEmptyState(existing(),blankProtectedHashes),/initial_existing_installation/);
 for(let i=0;i<2;i++){const hashes=[...blankProtectedHashes];hashes[i]='nonempty';assert.throws(()=>requireEmptyState(blank(),hashes),/initial_has_data/);}
});
test('Inspection is read-only and needs model/new-board confirmation; install needs separate confirmation',async()=>{
 const h=harness();await assert.rejects(h.install.inspect(h.port),/initial_confirmation/);assert.deepEqual(h.calls,[]);
 await h.install.inspect(h.port,confirmed);assert(!h.calls.includes('write'));assert.equal(h.install.stage,'ready');
 await assert.rejects(h.install.install(),/initial_confirmation/);assert(!h.calls.includes('write'));await h.install.cancel();assert.equal(h.install.stage,'cancelled');assert(h.calls.includes('reset'));
});
test('Wrong chip, flash size, retained storage, existing install and broken images stop before any write',async()=>{
 for(const opts of [{boardChip:{...chip,chip:'esp32c3'}},{boardChip:{...chip,flashSize:'8MB'}},{table:existing()},{hashes:['nonempty','nonempty']},{loadImages:async()=>[]}]){
  const h=harness(opts);await assert.rejects(h.install.inspect(h.port,confirmed));assert(!h.calls.includes('write'));assert(!h.install.active);
 }
 const connected=harness();connected.connection.enabled=true;await assert.rejects(connected.install.inspect(connected.port,confirmed),/initial_disconnect_first/);
});
test('The physical board is rechecked after review and cannot be swapped before installation',async()=>{
 const h=harness();await h.install.inspect(h.port,confirmed);h.swap();await assert.rejects(h.install.install({confirmed:true}),/board_changed/);assert(!h.calls.includes('write'));assert(!h.install.active);
});
test('Initial install writes once, verifies protected storage, reboots and only accepts a fresh same-board application',async()=>{
 const h=harness();await h.install.inspect(h.port,confirmed);assert.equal((await h.install.install({confirmed:true})).remembered,0);assert.equal(h.calls.filter(c=>c==='write').length,1);assert.equal(h.install.stage,'complete');assert(!h.install.active);
 for(const change of [{bridgeId:'esp32-000000000001'},{remembered:1},{pending:1},{hasSavedToken:true},{hasPairingKey:true},{configured:true},{autoEnabled:true},{sheetUrl:'saved'}])assert.throws(()=>verifyFreshBoard({...fresh,...change},chip.bridgeId));
});
test('Interrupted initial writes require a manual same-board retry; completed images after a replug are checked without another write',async()=>{
 const h=harness({failWrite:true});await h.install.inspect(h.port,confirmed);await assert.rejects(h.install.install({confirmed:true}),/usb_disconnected/);assert(h.install.recoverable);assert.equal(h.calls.filter(c=>c==='write').length,1);await assert.rejects(h.install.cancel(),/recovery/);
 h.imagesMatch();await h.install.retry(h.port);assert.equal(h.calls.filter(c=>c==='write').length,1);assert.equal(h.install.stage,'complete');
 const partial=harness({failWrite:true});await partial.install.inspect(partial.port,confirmed);await assert.rejects(partial.install.install({confirmed:true}));await partial.install.retry(partial.port);assert.equal(partial.calls.filter(c=>c==='write').length,2);
});
test('Reconnection-only recovery never reflashes and a different retry board never receives writes',async()=>{
 const h=harness({failReconnect:true});await h.install.inspect(h.port,confirmed);await assert.rejects(h.install.install({confirmed:true}),/firmware_reconnect/);assert(h.install.verified);h.restore();await h.install.retry(h.port);assert.equal(h.calls.filter(c=>c==='write').length,1);
 const wrong=harness({failWrite:true});await wrong.install.inspect(wrong.port,confirmed);await assert.rejects(wrong.install.install({confirmed:true}));wrong.swap();await assert.rejects(wrong.install.retry(wrong.port),/board_changed/);assert.equal(wrong.calls.filter(c=>c==='write').length,1);
});
test('Actual adapter emits exactly the three reviewed file ranges, MD5 validation and no full erase',async()=>{
 let options;class Loader{constructor(){}async writeFlash(o){options=o;}}class Transport{constructor(){}}
 const flasher=await createFlasher({}, {ESPLoader:Loader,Transport,md5});const files=await verifiedInitialFiles();await flasher.writeInitial(files,()=>{});
 assert.equal(options.eraseAll,false);assert.equal(options.flashMode,'keep');assert.deepEqual(options.fileArray.map(f=>f.address),[0,0x8000,0x10000]);assert.equal(options.calculateMD5Hash(files[0].data).length,32);
 for(const f of files){const end=Math.ceil((f.address+f.data.length)/0x1000)*0x1000;assert(!((f.address<0xf000&&end>0x9000)||(f.address<0x620000&&end>0x610000)));}
 await assert.rejects(flasher.writeInitial([{...files[0],address:0x9000},...files.slice(1)],()=>{}),/firmware_image/);
});

test('Storage appearing after review blocks writing; a post-write integrity failure cannot be retried as success',async()=>{
 const changed=harness({hashes:n=>n===1?blankProtectedHashes:['changed','changed']});await changed.install.inspect(changed.port,confirmed);await assert.rejects(changed.install.install({confirmed:true}),/initial_has_data/);assert(!changed.calls.includes('write'));
 const corrupt=harness({hashes:n=>n<3?blankProtectedHashes:['changed','changed']});await corrupt.install.inspect(corrupt.port,confirmed);await assert.rejects(corrupt.install.install({confirmed:true}),/preservation_failed/);assert(corrupt.install.fatal);await assert.rejects(corrupt.install.retry(corrupt.port),/initial_recovery_required/);assert.equal(corrupt.calls.filter(c=>c==='write').length,1);
});

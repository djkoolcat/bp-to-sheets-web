import {release} from './firmware-catalog.mjs?v=1.0.0';
import {initialImages,loadInitialImages} from './initial-catalog.mjs?v=1.0.0';
import {hex,compatible,verifyPartitions} from './firmware-policy.mjs?v=1.0.0';
import {createFlasher} from './flash-adapter.mjs?v=1.0.0';
import {md5} from './flasher/esptool.mjs';
const fail=code=>{throw Error(code);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const blankProtectedHashes=Object.freeze([0x6000,0x10000].map(size=>hex(md5(new Uint8Array(size).fill(255)))));
export function requireEmptyState(table,hashes,{retry=false}={}){
 if(!(table instanceof Uint8Array)||table.length!==0xc00)fail('partition_layout');
 // The project's dedicated log partition identifies an existing installation even if its NVS is blank.
 if(!retry)for(let at=0;at+32<=table.length;at+=32){
  if(table[at]===0xaa&&table[at+1]===0x50&&new TextDecoder().decode(table.subarray(at+12,at+28)).split('\0')[0]==='hem-log')fail('initial_existing_installation');
 }
 if(JSON.stringify(hashes)!==JSON.stringify(blankProtectedHashes))fail('initial_has_data');
}
export async function verifiedInitialFiles(load=loadInitialImages){
 const encoded=await load();if(!Array.isArray(encoded)||encoded.length!==3)fail('firmware_image');const files=[];
 for(let i=0;i<3;i++){
  let data;try{data=Uint8Array.from(atob(encoded[i]),c=>c.charCodeAt(0));}catch{fail('firmware_image');}
  const expected=initialImages[i];
  if(data.length!==expected.bytes||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))!==expected.sha256)fail('firmware_hash');
  if(i===1)verifyPartitions(data,md5);else if(data[0]!==0xe9||new DataView(data.buffer).getUint16(12,true)!==9)fail('firmware_image');
  files.push({address:expected.address,data});
 }return files;
}
export function verifyFreshBoard(after,bridgeId){
 if(after.bridgeId!==bridgeId)fail('board_changed');
 if(!compatible(after,release)||after.firmwareVersion!==release.version||!after.queueReady||after.remembered!==0||after.pending!==0||after.configured||after.hasSavedPassword||after.hasSavedToken||after.hasPairingKey||after.autoEnabled||after.sheetUrl||after.sheetUserUrls?.some(Boolean))fail('initial_not_fresh');
 return after;
}
export class InitialInstall{
 constructor({connection,getPorts,makeFlasher=createFlasher,loadImages=loadInitialImages,progress=()=>{},wait=sleep,attempts=30}){
  Object.assign(this,{connection,getPorts,makeFlasher,loadImages,progress,wait,attempts});this.stage='idle';this.before=null;this.inspection=null;this.started=false;this.verified=false;this.fatal=false;
 }
 get active(){return !['idle','blocked','cancelled','complete'].includes(this.stage);}
 get recoverable(){return this.started&&!this.fatal&&this.stage!=='complete';}
 clearFiles(){for(const f of this.files||[])f.data.fill(0);this.files=null;}
 async releaseLoader(reset=false){if(this.flasher){try{if(reset)await this.flasher.reset();}finally{await this.flasher.close();this.flasher=null;}}}
 async inspect(port,{confirmed=false,model=false}={}){
  if(this.active||this.connection.enabled)fail('initial_disconnect_first');
  if(!confirmed||!model)fail('initial_confirmation');
  this.stage='checking';this.started=false;this.verified=false;this.fatal=false;this.before=null;this.inspection=null;this.port=port;this.progress('설치 파일 확인',0);
  try{
   this.files=await verifiedInitialFiles(this.loadImages);this.flasher=await this.makeFlasher(port);
   this.progress('새 보드 확인',0);const chip=await this.flasher.connect();this.checkChip(chip);
   const table=await this.flasher.partitionTable(),hashes=await this.flasher.protectedHashes();
   this.inspection={...chip,settingsEmpty:hashes[0]===blankProtectedHashes[0],logEmpty:hashes[1]===blankProtectedHashes[1]};requireEmptyState(table,hashes);
   this.before=chip;this.stage='ready';this.progress('빈 설정·기록 영역 확인 · 설치 준비됨',0);return chip;
  }catch(e){try{await this.releaseLoader(true);}catch{}this.clearFiles();this.stage='blocked';throw e;}
 }
 checkChip(chip){if(chip?.chip!=='esp32s3'||chip.flashSize!=='16MB'||!/^esp32-[a-f0-9]{12}$/.test(chip.bridgeId))fail('unsupported_board');}
 async cancel(){
  if(this.started)fail('initial_recovery_required');
  try{await this.releaseLoader(true);}finally{this.clearFiles();this.before=null;this.stage='cancelled';this.progress('설치 취소 · 기록하지 않음',0);}
 }
 async install({confirmed=false}={}){
  if(this.stage!=='ready'||!this.flasher||!confirmed)fail('initial_confirmation');
  try{return await this.writeAndReconnect(false);}catch(e){if(['preservation_failed','initial_not_fresh'].includes(e.message))this.fatal=true;if(this.started)this.stage='interrupted';else{try{await this.releaseLoader(true);}catch{}this.clearFiles();this.stage='blocked';}throw e;}
 }
 async writeAndReconnect(retry){
  const chip=await this.flasher.identity();this.checkChip(chip);if(chip.bridgeId!==this.before.bridgeId)fail('board_changed');
  const table=await this.flasher.partitionTable(),hashes=await this.flasher.protectedHashes();requireEmptyState(table,hashes,{retry});
  this.started=true;this.stage='writing';this.progress('처음 설치 중',0);
  try{
   await this.flasher.writeInitial(this.files,p=>this.progress('처음 설치 중',p));
   if(JSON.stringify(await this.flasher.protectedHashes())!==JSON.stringify(hashes))fail('preservation_failed');
   this.verified=true;this.progress('새 펌웨어 시작·확인',100);await this.releaseLoader(true);
  }catch(e){try{await this.releaseLoader(false);}catch{}throw e;}
  return this.reconnect();
 }
 async reconnect(selected=null){
  this.stage='reconnecting';this.progress('새 펌웨어 시작·확인',100);
  for(let n=0;n<this.attempts;n++){
   await this.wait(1000);const ports=await this.getPorts(),info=this.port.getInfo?.();
   const matches=selected?[selected]:ports.includes(this.port)?[this.port]:ports.filter(p=>{const i=p.getInfo?.();return i&&info&&i.usbVendorId===info.usbVendorId&&i.usbProductId===info.usbProductId;});
   if(matches.length!==1)continue;
   try{const after=verifyFreshBoard(await this.connection.attach(matches[0]),this.before.bridgeId);this.clearFiles();this.stage='complete';this.progress('처음 설치 완료 · 설정을 시작하세요',100);return after;}
   catch(e){await this.connection.close();if(['board_changed','initial_not_fresh','unsupported_board','invalid_usb_reply'].includes(e.message))throw e;}
  }fail('firmware_reconnect');
 }
 async retry(port){
  if(!this.recoverable)fail('initial_recovery_required');
  await this.connection.close();
  try{
   if(this.verified)return await this.reconnect(port);
   this.port=port;this.flasher=await this.makeFlasher(port);const chip=await this.flasher.connect();this.checkChip(chip);if(chip.bridgeId!==this.before.bridgeId)fail('board_changed');
   // A cable replug may have booted a fully written app before its ACK arrived.
   // Verify the exact three images in place instead of rewriting initialized NVS.
   if(await this.flasher.matchesInitial(this.files)){this.verified=true;await this.releaseLoader(true);return await this.reconnect();}
   return await this.writeAndReconnect(true);
  }catch(e){if(['preservation_failed','initial_not_fresh'].includes(e.message))this.fatal=true;try{await this.releaseLoader(e.message==='board_changed');}catch{}this.stage='interrupted';throw e;}
 }
}

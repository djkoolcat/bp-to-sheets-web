import {release} from './firmware-catalog.mjs?v=1.0.2';
import {compatible,compareVersion} from './firmware-policy.mjs?v=1.0.2';
import {blankProtectedHashes} from './initial-install.mjs?v=1.0.2';
import {createFlasher} from './flash-adapter.mjs?v=1.0.2';
const fail=code=>{throw Error(code);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function resetSupported(board){return compatible(board,release)&&compareVersion(board.firmwareVersion,'hem-1.0.0')>=0;}
export function confirmReset(board,{confirmation='',acknowledgeLoss=false}={}){
 if(!resetSupported(board)||!board.queueReady)fail('reset_update_required');
 if(confirmation.trim()!==board.bridgeId||acknowledgeLoss!==true)fail('reset_confirmation');
}
export function verifyReset(before,after){
 if(after.bridgeId!==before.bridgeId)fail('board_changed');
 if(!compatible(after,release)||after.firmwareVersion!==before.firmwareVersion||!after.queueReady||after.remembered!==0||after.pending!==0||after.configured||after.hasSavedPassword||after.hasSavedToken||after.hasPairingKey||after.autoEnabled||after.sheetUrl||after.sheetUserUrls?.some(Boolean)||after.targetAddress||(after.meterModel&&after.meterModel!=='omron-hem7155t'))fail('reset_not_empty');
 return after;
}
export class FactoryReset{
 constructor({connection,client,getPorts,makeFlasher=createFlasher,progress=()=>{},wait=sleep,attempts=30}){
  Object.assign(this,{connection,client,getPorts,makeFlasher,progress,wait,attempts});this.stage='idle';this.before=null;this.started=false;this.verified=false;
 }
 get active(){return !['idle','interrupted','complete'].includes(this.stage);}
 get recoverable(){return this.started&&this.stage!=='complete';}
 async start(board,confirmation){
  if(this.active||this.recoverable)fail('reset_recovery_pending');confirmReset(board,confirmation);
  const fresh=await this.connection.read('info');
  if(fresh.bridgeId!==board.bridgeId||fresh.meterId!==board.meterId||fresh.session!==board.session)fail('board_changed');
  if(fresh.remembered!==board.remembered||fresh.pending!==board.pending)fail('snapshot_changed');
  confirmReset(fresh,confirmation);this.before=fresh;this.port=this.connection.port;this.started=false;this.verified=false;this.firmwareHashes=null;this.stage='preparing';
  try{
   this.progress('자동 수신·전송 중지 확인',0);await this.client.request('hold',fresh,{},35000);
   const held=await this.connection.read('info');
   if(held.bridgeId!==fresh.bridgeId||held.meterId!==fresh.meterId||held.session!==fresh.session||held.remembered!==fresh.remembered||held.pending!==fresh.pending)fail('snapshot_changed');
   await this.connection.close();return await this.erase();
  }catch(error){this.stage='interrupted';throw error;}
 }
 async erase(){
  const flasher=await this.makeFlasher(this.port);
  try{
   this.progress('보드·펌웨어 확인',0);const chip=await flasher.connect();
   if(chip.bridgeId!==this.before.bridgeId)fail('board_changed');
   if(chip.chip!==release.chip||chip.flashSize!=='16MB')fail('unsupported_board');
   await flasher.partitions();const hashes=await flasher.firmwareHashes();
   if(this.firmwareHashes&&JSON.stringify(hashes)!==JSON.stringify(this.firmwareHashes))fail('preservation_failed');
   this.firmwareHashes=hashes;
   // A completed erase with a lost acknowledgement needs no second erase.
   if(JSON.stringify(await flasher.protectedHashes())!==JSON.stringify(blankProtectedHashes)){
    this.started=true;this.stage='erasing';this.progress('보드 사용자 데이터 초기화 중',0);
    await flasher.clearUserData(percent=>this.progress('보드 사용자 데이터 초기화 중',percent));
   }
   if(JSON.stringify(await flasher.protectedHashes())!==JSON.stringify(blankProtectedHashes)||JSON.stringify(await flasher.firmwareHashes())!==JSON.stringify(this.firmwareHashes))fail('preservation_failed');
   this.started=true;this.verified=true;await flasher.reset();
  }catch(error){if(!this.started)try{await flasher.reset();}catch{}throw error;}
  finally{await flasher.close();}
  return await this.reconnect();
 }
 async reconnect(selected=null){
  this.stage='reconnecting';this.progress('재연결·초기화 결과 확인',100);
  for(let n=0;n<this.attempts;n++){
   await this.wait(1000);const ports=await this.getPorts(),info=this.port.getInfo?.();
   const matches=selected?[selected]:ports.includes(this.port)?[this.port]:ports.filter(p=>{const value=p.getInfo?.();return value&&info&&value.usbVendorId===info.usbVendorId&&value.usbProductId===info.usbProductId;});
   if(matches.length!==1)continue;
   try{const after=verifyReset(this.before,await this.connection.attach(matches[0]));this.stage='complete';this.progress('초기화 완료 · 펌웨어 유지 확인',100);return after;}
   catch(error){await this.connection.close();if(['board_changed','reset_not_empty','unsupported_board','invalid_usb_reply'].includes(error.message))throw error;}
  }fail('firmware_reconnect');
 }
 async retry(port,confirmation){
  if(!this.recoverable)fail('reset_no_recovery');confirmReset(this.before,confirmation);
  await this.connection.close();this.port=port;
  try{return this.verified?await this.reconnect(port):await this.erase();}
  catch(error){this.stage='interrupted';throw error;}
 }
}

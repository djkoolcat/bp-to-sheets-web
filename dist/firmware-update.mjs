import {release,loadReleaseImage} from './firmware-catalog.mjs?v=0.7.2';
import {compatible,compareVersion,verifyImage,verifySettings,verifyRecords} from './firmware-policy.mjs?v=0.7.2';
import {collectRecords} from './record-export.mjs?v=0.7.2';
import {createFlasher} from './flash-adapter.mjs?v=0.7.2';
const fail=code=>{throw Error(code);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class FirmwareUpdate{
 constructor({connection,client,getPorts,progress=()=>{},makeFlasher=createFlasher,loadImage=loadReleaseImage,wait=sleep,attempts=30}){
  Object.assign(this,{connection,client,getPorts,progress,makeFlasher,loadImage,wait,attempts});this.stage='idle';this.before=null;this.records=null;this.verified=false;
 }
 get recoverable(){return !!this.before&&this.stage!=='complete';}
 async start(board,{reinstall=false}={}){
  if(this.recoverable)fail('firmware_recovery_pending');
  if(!compatible(board,release)||!board.queueReady)fail('unsupported_board');
  const comparison=compareVersion(board.firmwareVersion,release.version);if(comparison>0||(!comparison&&!reinstall))fail('firmware_not_newer');
  this.before=null;this.records=null;this.verified=false;this.stage='prepare';this.progress('파일 확인',0);
  const encoded=await this.loadImage();let image;
  try{image=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{fail('firmware_image');}
  this.image=await verifyImage(image,release);
  // Import the local flasher before holding the board; no CDN or fetch.
  this.flasher=await this.makeFlasher(this.connection.port);
  const fresh=await this.connection.read('info');if(fresh.bridgeId!==board.bridgeId||fresh.meterId!==board.meterId)fail('board_changed');
  this.progress('기록 보관 확인',0);
  await this.client.request('hold',fresh,{},35000);
  this.before=await this.connection.read('info');this.port=this.connection.port;
  try{
   if(this.before.recordsExportVersion===1)this.records=await collectRecords({info:()=>this.connection.read('info'),page:(f,b)=>this.client.request('records',b,f)});
   await this.connection.close();await this.flash(this.flasher);return await this.reconnect();
  }catch(e){if(this.connection.enabled)await this.connection.close();throw e;}
 }
 async flash(flasher){
  this.stage='loader';this.progress('보드 확인',0);let wrote=false;
  try{
   const chip=await flasher.connect();if(chip.chip!==release.chip||chip.bridgeId!==this.before.bridgeId)fail('board_changed');if(chip.flashSize!=='16MB')fail('partition_layout');
   this.progress('저장 영역 확인',0);await flasher.partitions();const protectedBefore=await flasher.protectedHashes();
   this.stage='writing';this.progress('업데이트 중',0);wrote=true;
   await flasher.write(this.image,p=>this.progress('업데이트 중',p));
   const protectedAfter=await flasher.protectedHashes();if(JSON.stringify(protectedAfter)!==JSON.stringify(protectedBefore))fail('preservation_failed');
   this.verified=true;this.stage='reconnecting';this.progress('재연결·보존 확인',100);await flasher.reset();
  }catch(e){if(!wrote)try{await flasher.reset();}catch{}throw e;}
  finally{await flasher.close();}
 }
 async reconnect(selectedPort=null){
  this.stage='reconnecting';this.progress('재연결·보존 확인',100);
  let after;
  for(let attempt=0;attempt<this.attempts;++attempt){
   await this.wait(1000);const ports=await this.getPorts();
   const info=this.port?.getInfo?.(),matches=selectedPort?[selectedPort]:ports.includes(this.port)?[this.port]:ports.filter(p=>{const i=p.getInfo?.();return i&&info&&i.usbVendorId===info.usbVendorId&&i.usbProductId===info.usbProductId;});
   if(matches.length!==1)continue;
   try{
    after=await this.connection.attach(matches[0]);
    if(after.bridgeId!==this.before.bridgeId||after.meterId!==this.before.meterId)fail('board_changed');
    verifySettings(this.before,after,release);
    if(this.records){
     const rows=await collectRecords({info:()=>this.connection.read('info'),page:(f,b)=>this.client.request('records',b,f)});verifyRecords(this.records,rows);
    }
    this.stage='complete';this.records=null;this.image?.fill(0);this.image=null;this.progress('업데이트 완료',100);return after;
   }catch(e){await this.connection.close();if(['board_changed','preservation_failed','unsupported_board','invalid_usb_reply'].includes(e.message))throw e;}
  }fail('firmware_reconnect');
 }
 async retry(port){
  if(!this.recoverable)fail('firmware_no_recovery');
  if(this.connection.enabled)await this.connection.close();
  if(this.verified)return await this.reconnect(port);
  this.port=port;const flasher=await this.makeFlasher(port);await this.flash(flasher);return await this.reconnect();
 }
}

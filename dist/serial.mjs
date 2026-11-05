import {validateSetup} from './omron-setup.mjs?v=1.0.2';
import {sheetUrl,userSheetUrls} from './setup.mjs?v=1.0.2';
const encoder=new TextEncoder();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const fail=code=>{throw Error(code);};
export const profiles={esp32c3:{id:'esp32c3-mono',app:0x300000,flash:0x400000},esp32s3:{id:'waveshare-s3-lcd154',app:0x600000,flash:0x1000000}};
export function reply(d,id,operation){
 if(!d||d.schemaVersion!==1||!['bp-to-sheets-hem7155t','bp-to-sheets-microlife-b4bt'].includes(d.product)||d.requestId!==id||d.operation!==operation||
  !/^esp32-[a-f0-9]{12}$/.test(d.bridgeId)||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(d.meterId)||
  !/^[a-f0-9]{32}$/.test(d.session)||typeof d.firmwareVersion!=='string'||d.firmwareVersion.length>32||!/^hem-\d+\.\d+\.\d+$/.test(d.firmwareVersion))fail('invalid_usb_reply');
 meterInfo(d);validateSetup(d);
 const p=profiles[d.chip];if(!p)fail('unsupported_board');
 if((d.chip==='esp32s3'||d.boardId!==undefined)&&d.boardId!==p.id)fail('unsupported_board');
 if((d.chip==='esp32s3'||d.appPartitionSize!==undefined)&&d.appPartitionSize!==p.app)fail('unsupported_board');
 if((d.chip==='esp32s3'||d.flashSize!==undefined)&&d.flashSize!==p.flash)fail('unsupported_board');
 if(d.sheetLinkSupported!==undefined&&typeof d.sheetLinkSupported!=='boolean')fail('invalid_usb_reply');
 if(d.sheetLinkSupported&&(typeof d.sheetUrl!=='string'||(d.sheetUrl!==''&&sheetUrl(d.sheetUrl)!==d.sheetUrl)))fail('invalid_usb_reply');
 if(d.sheetUserLinksSupported!==undefined&&typeof d.sheetUserLinksSupported!=='boolean')fail('invalid_usb_reply');
 if(d.sheetUserLinksSupported){
  if(d.chip!=='esp32s3'||!d.sheetLinkSupported||!Array.isArray(d.sheetUserUrls)||d.sheetUserUrls.length!==2||d.sheetUserUrls[0]!==d.sheetUrl||d.sheetUserUrls.some(u=>typeof u!=='string'||(u!==''&&sheetUrl(u)!==u)))fail('invalid_usb_reply');
  if(d.sheetUserUrls[1]){try{userSheetUrls(d.sheetUserUrls);}catch{fail('invalid_usb_reply');}}
 }
 for(const k of ['ok','queueReady','hasPairingKey','autoEnabled','configured','hasSavedPassword','hasSavedToken','clockReady','sending'])if(typeof d[k]!=='boolean')fail('invalid_usb_reply');
 if(!Number.isInteger(d.pending)||d.pending<0||d.pending>128||!Number.isInteger(d.remembered)||d.remembered<d.pending||d.remembered>128||!Number.isInteger(d.wifiStatus))fail('invalid_usb_reply');
 if(!d.ok)fail(typeof d.error==='string'&&/^[a-z0-9_-]{1,80}$/.test(d.error)?d.error:'usb_rejected');
 return d;
}
export function settings(v,b){
 const ssid=v.ssid||b.wifiSsid||'',password=v.password||'',endpoint=(v.endpoint||b.receiverUrl||'').trim(),token=(v.token||'').trim();
 if(!ssid||encoder.encode(ssid).length>32||/[\r\n\0]/.test(ssid))fail('invalid_ssid');
 const keepPassword=!password&&b.hasSavedPassword,keepToken=!token&&b.hasSavedToken;
 if(!keepPassword&&(encoder.encode(password).length<8||encoder.encode(password).length>63))fail('invalid_password');
 if(!keepToken&&!/^[a-f0-9]{64}$/.test(token))fail('invalid_token');
 try{const u=new URL(endpoint);if(endpoint.length>256||u.protocol!=='https:'||u.hostname!=='script.google.com'||u.port||u.username||u.password||u.search||u.hash||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname))fail('invalid_endpoint');}catch{fail('invalid_endpoint');}
 return {ssid,password,endpoint,token,keepPassword,keepToken};
}
export function preserved(a,b){return b.queueReady&&a.chip===b.chip&&a.bridgeId===b.bridgeId&&a.meterId===b.meterId&&b.remembered>=a.remembered&&['hasPairingKey','autoEnabled'].every(k=>a[k]===b[k])&&(!a.sheetLinkSupported||(b.sheetLinkSupported&&a.sheetUrl===b.sheetUrl))&&(!a.sheetUserLinksSupported||(b.sheetUserLinksSupported&&JSON.stringify(a.sheetUserUrls)===JSON.stringify(b.sheetUserUrls)));}
export function event(d){
 if(!d||!Number.isInteger(d.code)||d.code<1||d.code>17)return null;
 for(const k of ['seq','boot','uptimeMs','epoch','a','b'])if(!Number.isInteger(d[k]))return null;
 if(d.seq<1||d.seq>0xffffffff||d.boot<0||d.boot>65535||d.uptimeMs<0||d.uptimeMs>0xffffffff||d.epoch<0||d.epoch>0xffffffff||Math.abs(d.a)>0x7fffffff||Math.abs(d.b)>0x7fffffff)return null;
 const value={};for(const k of ['seq','boot','uptimeMs','epoch','code','a','b'])value[k]=d[k];return value;
}
export function eventText(e){
 const names=['','보드 시작','Wi-Fi 연결','Wi-Fi 연결 대기','시각 동기화','혈압계 감지','기록 수신 시작','기록 수신 완료','기록 수신 실패','기록 보관','Google 전송 시작','Google 저장 확인','Google 전송 확인 대기','설정 저장','업데이트 준비','Wi-Fi 단절 시험','Wi-Fi 복구','로그 누락'];
 const detail=e.code===9?`대기 ${e.a}건 · 보관 ${e.b}건`:e.code===11?`저장 확인 ${e.a}건 · 대기 ${e.b}건`:e.code===12?`대기 ${e.b}건 유지`:e.code===7?`${e.b}회 읽기 검증 완료`:'';
 return [names[e.code]||'동작',detail];
}
export class SerialClient{
 constructor({onEvent=()=>{},onDisconnect=()=>{}}={}){this.onEvent=onEvent;this.onDisconnect=onDisconnect;this.chain=Promise.resolve();this.buffer='';this.closing=false;this.generation=0;}
 async open(port){
  await this.close();this.port=port;this.closing=false;
  try{
   await port.open({baudRate:115200,bufferSize:16384,flowControl:'none'});
   if(port.setSignals)await port.setSignals({dataTerminalReady:true,requestToSend:false});
   this.reader=port.readable.getReader();this.writer=port.writable.getWriter();this.readTask=this.read();
   return await this.request('info');
  }catch(e){await this.close();throw e;}
 }
 async read(){
  const decoder=new TextDecoder();
  try{while(!this.closing){const {done,value}=await this.reader.read();if(done)break;this.consume(decoder.decode(value,{stream:true}));}}
  catch{}finally{
   this.reader?.releaseLock();this.reader=null;
   if(!this.closing){this.reject('usb_disconnected');this.onDisconnect();}
  }
 }
 consume(text){
  this.buffer+=text;if(this.buffer.length>16384){this.buffer='';this.reject('invalid_usb_reply');return;}
  let at;while((at=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,at).replace(/\r$/,'');this.buffer=this.buffer.slice(at+1);
   if(line.startsWith('BPLOG ')){try{const d=JSON.parse(line.slice(6)),e=d.schemaVersion===1?event(d):null;if(e)this.onEvent(e);}catch{}continue;}
   if(!line.startsWith('BPUSB_REPLY ')||!this.pending)continue;
   let d;try{d=JSON.parse(line.slice(12));}catch{continue;}
   if(d.requestId!==this.pending.id)continue;
   try{reply(d,this.pending.id,this.pending.op);const p=this.pending;this.pending=null;clearTimeout(p.timer);p.resolve(d);}
   catch(e){this.reject(/^[a-z0-9_-]{1,80}$/.test(e.message)?e.message:'invalid_usb_reply');}
  }
 }
 reject(code){if(this.pending){const p=this.pending;this.pending=null;clearTimeout(p.timer);p.reject(Error(code));}}
 request(op,board=null,fields={},timeout=12000){
  const generation=this.generation;
  const run=async()=>{
   if(!this.writer||this.closing||generation!==this.generation)fail('usb_disconnected');
   if(!['info','configure','test','logs','sheet-link','records','meter-model','meter-target','audio','hold','omron-setup'].includes(op))fail('invalid_operation');
   const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
   const payload={schemaVersion:1,requestId:id,operation:op,...fields};if(board){payload.bridgeId=board.bridgeId;payload.session=board.session;}
   const bytes=encoder.encode('BPUSB '+JSON.stringify(payload)+'\n');if(bytes.length>1500)fail('invalid_configuration');
   const response=new Promise((resolve,reject)=>{this.pending={id,op,resolve,reject,timer:setTimeout(()=>this.reject('usb_timeout'),timeout)};});
   const writer=this.writer;
   this.writing=(async()=>{try{for(let at=0;at<bytes.length;at+=64){if(this.closing||generation!==this.generation||this.pending?.id!==id)fail('usb_disconnected');await writer.write(bytes.subarray(at,at+64));await wait(5);}}catch{this.reject('usb_disconnected');}finally{bytes.fill(0);}})();
   return response;
  };
  const result=this.chain.then(run);this.chain=result.catch(()=>{});return result;
 }
 async close(){
  ++this.generation;this.closing=true;this.reject('usb_disconnected');await this.writing?.catch(()=>{});
  try{await this.reader?.cancel();}catch{}await this.readTask?.catch(()=>{});this.readTask=null;
  try{this.writer?.releaseLock();}catch{}this.writer=null;
  try{await this.port?.close();}catch{}this.port=null;this.buffer='';
 }
}

// Only a previously granted port may be reopened automatically. Every reconnect
// verifies both device and meter identity; writes are never replayed.
export class Connection{
 constructor(client,{getPorts=async()=>[]}={}){this.client=client;this.getPorts=getPorts;this.enabled=false;this.expected=null;this.generation=0;this.recoveries=0;}
 verify(d){if(this.expected&&['bridgeId','meterId','chip','boardId'].some(k=>d[k]!==this.expected[k]))fail('board_changed');return d;}
 async attach(port){await this.close();this.enabled=true;this.port=port;try{const d=await this.client.open(port);this.expected=d;return d;}catch(e){await this.close();throw e;}}
 async recover(){
  if(!this.enabled||!this.port)fail('usb_disconnected');
  const generation=this.generation;await this.client.close();
  const granted=await this.getPorts(),info=this.port.getInfo?.();
  const matches=granted.includes(this.port)?[this.port]:granted.filter(p=>{const a=p.getInfo?.();return a&&info&&a.usbVendorId===info.usbVendorId&&a.usbProductId===info.usbProductId;});
  if(matches.length!==1)fail('port_missing');if(!this.enabled||generation!==this.generation)fail('usb_disconnected');
  let d;try{d=this.verify(await this.client.open(matches[0]));}catch(e){await this.client.close();if(e.message==='board_changed')this.enabled=false;throw e;}
  if(!this.enabled||generation!==this.generation){await this.client.close();fail('usb_disconnected');}
  this.port=matches[0];++this.recoveries;return d;
 }
 async read(operation,fields={},timeout=6000){
  if(!['info','logs'].includes(operation))fail('invalid_operation');if(!this.enabled)fail('usb_disconnected');
  try{return this.verify(await this.client.request(operation,null,fields,timeout));}
  catch(e){if(!['usb_timeout','usb_disconnected'].includes(e.message))throw e;
   const fresh=await this.recover();return operation==='info'?fresh:this.verify(await this.client.request(operation,null,fields,timeout));}
 }
 async close(){this.enabled=false;++this.generation;await this.client.close();}
}

export function meterInfo(d){
 const micro=d.product==='bp-to-sheets-microlife-b4bt';
 if(micro&&(d.chip!=='esp32s3'||d.meterModel!=='microlife-b4bt'||d.pairingRequired!==false))fail('invalid_usb_reply');
 if(d.meterModelSwitchSupported!==undefined){
  if(d.chip!=='esp32s3'||d.meterModelSwitchSupported!==true||!['omron-hem7155t','microlife-b4bt'].includes(d.meterModel)||typeof d.pairingRequired!=='boolean'||micro!==(d.meterModel==='microlife-b4bt'))fail('invalid_usb_reply');
  if(typeof d.targetAddress!=='string'||(d.targetAddress&&!/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/.test(d.targetAddress)))fail('invalid_usb_reply');
  if(!Array.isArray(d.meterCandidates)||d.meterCandidates.length>8)fail('invalid_usb_reply');
  const ids=new Set();for(const t of d.meterCandidates){if(!t||!/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/.test(t.address)||ids.has(t.address)||typeof t.name!=='string'||t.name.length>40||!Number.isInteger(t.rssi)||t.rssi>0||t.rssi< -127)fail('invalid_usb_reply');ids.add(t.address);}
 }
 if(d.audioSupported!==undefined&&(d.chip!=='esp32s3'||d.audioSupported!==true||typeof d.audioReady!=='boolean'||!Number.isInteger(d.audioVolume)||d.audioVolume<0||d.audioVolume>60))fail('invalid_usb_reply');
 return d;
}

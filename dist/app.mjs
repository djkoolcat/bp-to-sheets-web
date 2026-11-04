import {createOmronSetup,setupAction,errors as omronErrors} from './omron-setup.mjs?v=0.8.0';
import {SerialClient,Connection,settings,preserved,event,eventText} from './serial.mjs?v=0.8.0';
import {collectRecords,csvBytes,xlsxBytes,fileName} from './record-export.mjs?v=0.8.0';
import {createWizard} from './wizard.mjs?v=0.8.0';
import {userSheetUrls,linksPreserved} from './setup.mjs?v=0.8.0';
import {release} from './firmware-catalog.mjs?v=0.8.0';
import {compatible,compareVersion} from './firmware-policy.mjs?v=0.8.0';
import {FirmwareUpdate} from './firmware-update.mjs?v=0.8.0';
import {InitialInstall} from './initial-install.mjs?v=0.8.0';
const $=id=>document.getElementById(id);
let board=null,connected=false,busy=false,dirty=false,polling=false,connection,wizard,updater,installer,omron;
const seen=new Set();
const messages={invalid_ssid:'Wi-Fi 이름은 1~32바이트로 입력하세요.',invalid_password:'Wi-Fi 비밀번호는 8~63바이트로 입력하세요.',invalid_token:'Google에 등록한 64자리 소문자 토큰을 입력하세요.',invalid_endpoint:'Google Apps Script의 HTTPS /exec 주소를 입력하세요.',usb_timeout:'보드 응답을 확인하지 못했습니다. 설정 저장 결과는 재연결 후 확인하세요.',usb_disconnected:'USB 연결이 끊겼습니다. 보드를 다시 선택해 주세요.',unsupported_board:'이 설정 화면에서 지원하는 보드가 아닙니다.',invalid_usb_reply:'보드 응답을 확인할 수 없습니다. 다른 USB 장치를 선택했는지 확인하세요.',session_changed:'보드가 재시작했습니다. 다시 연결해 주세요.',busy:'보드 작업이 끝난 뒤 다시 시도하세요.',device_busy_timeout:'혈압계 통신이 끝난 뒤 보드를 다시 연결해 주세요.',preservation_failed:'저장 후 기존 기록·설정 확인이 필요합니다. 초기화하지 마세요.',invalid_configuration:'입력값을 확인하세요.',queue_not_ready:'보드 기록 저장소 확인이 필요합니다. 초기화하지 마세요.'};
Object.assign(messages,{export_update_required:'기록 내보내기는 S3 hem-0.7.0 이상에서 지원합니다. 펌웨어를 먼저 업데이트하세요.',invalid_export_reply:'기록 응답을 끝까지 확인하지 못해 파일을 만들지 않았습니다.',snapshot_changed:'읽는 동안 기록이나 전송 상태가 바뀌었습니다. 잠시 후 다시 저장해 주세요.',export_session_changed:'보드가 재시작하거나 바뀌었습니다. 다시 연결해 주세요.'});
Object.assign(messages,{invalid_sheet_tabs:'같은 시트의 서로 다른 사용자 탭 주소 두 개를 입력하세요. 각 주소에 gid가 필요합니다.',invalid_sheet_url:'Google 시트 주소를 확인하세요.',wrong_sheet:'1단계에서 선택한 시트와 다른 파일입니다. 사용자 탭의 주소를 다시 확인하세요.',sheet_link_commit_failed:'보드에서 링크 저장을 확인하지 못했습니다. 다시 읽어 확인한 뒤 필요하면 직접 저장하세요.'});
Object.assign(messages,{firmware_manifest:'배포 정보가 올바르지 않습니다. 업데이트하지 않았습니다.',firmware_image:'보드에 맞는 펌웨어 파일인지 확인할 수 없습니다.',firmware_hash:'펌웨어 파일 검증에 실패했습니다. 페이지를 새로 열어 다시 확인하세요.',partition_layout:'확인된 S3 LCD 메모리 구성과 다릅니다. 기록하지 않았습니다.',partition_checksum:'보드 메모리 구성을 정확히 읽지 못했습니다. 기록하지 않았습니다.',secure_board_unsupported:'보드의 보안 설정이 이 업데이트 방식과 다릅니다. 기록하지 않았습니다.',board_changed:'연결된 보드가 바뀌었습니다. 원래 보드를 다시 선택하세요.',firmware_not_newer:'같거나 더 최신인 버전입니다. 이전 버전으로 내리지 않습니다.',firmware_reconnect:'기록은 끝났지만 재연결 확인이 남았습니다. 아래에서 USB를 다시 선택하세요.'});
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function error(e){notice(e.name==='NotFoundError'?'USB 장치 선택을 취소했습니다.':e.name==='SecurityError'||e.name==='NotAllowedError'?'USB 권한을 허용하고 데스크톱 Chrome·Edge의 새 탭에서 다시 열어주세요.':omronErrors[e.message]||messages[e.message]||'요청을 완료하지 못했습니다. USB 연결과 입력값을 확인해 주세요.',true);}
function controls(){
 const locked=busy||!!installer?.active||!!omron?.active();
 for(const id of ['export-user','export-csv','export-xlsx'])$(id).disabled=locked||!connected||!board?.queueReady||board?.recordsExportVersion!==1;
 $('export-help').textContent=!connected?'USB 보드를 연결하면 기록을 파일로 저장할 수 있습니다.':board.recordsExportVersion!==1?'기록 내보내기는 S3 hem-0.7.0 이상에서 지원합니다. 아래에서 펌웨어를 업데이트하세요.':'보드에 남아 있는 최근 최대 128건입니다. 내려받아도 보드 기록과 전송 대기 상태는 그대로입니다.';
 $('connect').disabled=locked||connected||!supported;$('disconnect').disabled=locked||!connection?.enabled;
 $('fields').disabled=locked||!connected||!board?.queueReady;
 $('test').disabled=locked||!connected||!board?.configured||dirty;
 $('history').disabled=locked||!connected||!Number.isInteger(board?.logNewestSeq);
 meterControls();firmwareControls();initialControls();wizard?.render();omron?.render();
}
function firmwareControls(){
 const locked=busy||!!installer?.active||!!omron?.active();
 $('firmware-current').textContent=connected?board.firmwareVersion:'USB 연결 후 표시';$('firmware-latest').textContent=release.version;
 const supported=connected&&compatible(board,release),comparison=supported?compareVersion(board.firmwareVersion,release.version):null;
 $('firmware-reinstall-row').hidden=comparison!==0;
 $('firmware-reinstall').disabled=locked||!supported;
 $('firmware-start').disabled=locked||!supported||dirty||!board.queueReady||comparison>0||comparison===0&&!$('firmware-reinstall').checked||!!updater?.recoverable;
 $('firmware-retry').hidden=!updater?.recoverable;$('firmware-retry').disabled=locked;
 $('firmware-retry').textContent=updater?.verified?'USB 다시 선택 · 보존 확인':'USB 다시 선택 · 업데이트 재시도';
 $('firmware-help').textContent=!connected?'USB 보드를 연결하면 현재 버전과 최신 버전을 비교합니다.':!supported?'웹 업데이트는 Waveshare S3 LCD 1.54 비터치 보드용입니다. 기존 C3 설정 기능은 그대로 사용할 수 있습니다.':dirty?'입력 중인 Wi-Fi·토큰 설정을 먼저 저장하거나 지워주세요.':comparison>0?'현재 보드가 배포본보다 새롭습니다. 이전 버전으로 내리지 않습니다.':comparison===0?'최신 버전입니다. 필요한 경우 같은 버전을 다시 설치할 수 있습니다.':'새 버전이 있습니다. 기존 기록·설정·혈압계 연결 키를 보존하며 업데이트합니다.';
}
function state(d){
 board=d;wizard?.observe(d);$('pending').textContent=d.pending;$('remembered').textContent=d.remembered;$('version').textContent=d.firmwareVersion;
 $('model').textContent=(d.chip==='esp32s3'?'Waveshare S3 LCD 1.54':'ESP32-C3')+' · '+(d.meterModel==='microlife-b4bt'?'Microlife BP B4 BT':'HEM-7155T');
 $('wifi').textContent=d.wifiStatus===3?'연결됨':d.error==='wifi_test_offline'?'단절 시험 중':'연결 대기';
 $('cloud').textContent=d.sending?'전송 중':d.result==='confirmed'?(d.lastOperation==='test'?'연결 시험 통과':'저장 확인 완료'):d.error?'확인 대기 · 기록 보존':d.configured?'자동 전송 대기':'설정 필요';
 $('automatic').textContent=d.autoEnabled?'켜짐':d.pairingRequired===false?'수신 대상 선택 필요':d.hasPairingKey?'꺼짐':'혈압계 등록 필요';
 if(!dirty){$('ssid').value=typeof d.wifiSsid==='string'?d.wifiSsid:'';$('endpoint').value=typeof d.receiverUrl==='string'?d.receiverUrl:'';}
 $('password').placeholder=d.hasSavedPassword?'비워두면 저장된 비밀번호 유지':'Wi-Fi 비밀번호';
 $('token').placeholder=d.hasSavedToken?'비워두면 저장된 토큰 유지':'Google에 등록한 64자리 토큰';controls();
}
function addEvent(e){
 const key=[e.boot,e.uptimeMs,e.code,e.a,e.b].join(':');if(seen.has(key))return;seen.add(key);while(seen.size>100)seen.delete(seen.values().next().value);
 $('events').querySelector('.empty')?.remove();const li=document.createElement('li'),time=document.createElement('time'),text=document.createElement('span');
 time.textContent=e.epoch?new Date(e.epoch*1000).toLocaleTimeString('ko-KR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'}):'+'+Math.floor(e.uptimeMs/1000)+'초';
 text.textContent=eventText(e).filter(Boolean).join(' · ');li.append(time,text);$('events').prepend(li);while($('events').children.length>80)$('events').lastChild.remove();
}
const client=new SerialClient({onEvent:e=>{addEvent(e);if(connected)wizard?.event(e);},onDisconnect:()=>{connected=false;$('badge').textContent=connection?.enabled?'USB 재연결 중':'USB 연결 해제';$('badge').classList.remove('online');$('usb').textContent='마지막 확인 정보';controls();}});
connection=new Connection(client,{getPorts:()=>navigator.serial.getPorts()});
updater=new FirmwareUpdate({connection,client,getPorts:()=>navigator.serial.getPorts(),progress:(stage,percent)=>{$('firmware-progress').hidden=false;$('firmware-progress').value=percent;$('firmware-status').textContent=stage+(stage==='업데이트 중'?` · ${percent}%`:'');}});
installer=new InitialInstall({connection,getPorts:()=>navigator.serial.getPorts(),progress:(stage,percent)=>{$('initial-progress').hidden=false;$('initial-progress').value=percent;$('initial-status').textContent=stage+(stage==='처음 설치 중'?` · ${percent}%`:'');initialControls();}});
const supported=isSecureContext&&'serial'in navigator;$('unsupported').hidden=supported;
async function work(run){if(busy||installer?.active)return;busy=true;controls();try{while(polling)await new Promise(r=>setTimeout(r,20));await run();}catch(e){error(e);}finally{busy=false;controls();}}
wizard=createWizard({getState:()=>({board,connected,busy:busy||!!installer?.active||!!omron?.active(),dirty}),tokenChanged:()=>{dirty=true;controls();},test:()=>runTest(),refresh:()=>work(async()=>{state(await connection.read('info'));notice('보드의 현재 등록 상태와 저장 정보를 다시 읽었습니다.');}),notice});
omron=createOmronSetup({getState:()=>({board,connected,busy:busy||!!installer?.active,dirty}),run:(action,address,confirmed)=>work(async()=>{
 const before=await connection.read('info');if(before.bridgeId!==board.bridgeId||before.meterId!==board.meterId)throw Error('board_changed');
 const fields=setupAction(before,action,address,confirmed);
 // A missing ACK is never retried. Polling subsequently reads the outcome.
 state(await client.request('omron-setup',before,fields));
 notice(action==='restart'?'보드를 재시작합니다. 같은 보드의 USB 재연결을 기다립니다.':'요청을 보냈습니다. 아래 등록 진행 상태를 확인하세요. 요청은 자동 반복하지 않습니다.');
})});
controls();
$('firmware-reinstall').onchange=firmwareControls;
async function updateFirmware(retry=false){return work(async()=>{
 try{
  $('firmware-status').classList.remove('error');
  let after;
  if(retry){const port=await navigator.serial.requestPort({filters:[{usbVendorId:0x303a},{usbVendorId:0x1a86},{usbVendorId:0x10c4},{usbVendorId:0x0403}]});after=await updater.retry(port);}
  else{if(dirty)throw Error('invalid_configuration');after=await updater.start(board,{reinstall:$('firmware-reinstall').checked});}
  connected=true;state(after);$('firmware-reinstall').checked=false;$('badge').textContent='USB 연결됨';$('badge').classList.add('online');$('usb').textContent='연결됨';
  $('firmware-status').textContent='업데이트 완료 · 기록·설정 보존 확인';notice('최신 펌웨어와 기존 기록·설정 보존을 확인했습니다. 보드의 자동 수신은 계속됩니다.');
 }catch(e){
  connected=connection.enabled&&!!client.writer;
  $('firmware-status').textContent=messages[e.message]||'업데이트 확인이 중단됐습니다. 페이지를 유지하고 USB 연결을 다시 선택하세요.';$('firmware-status').classList.add('error');throw e;
 }
});}
$('firmware-start').onclick=()=>updateFirmware();$('firmware-retry').onclick=()=>updateFirmware(true);
window.addEventListener('beforeunload',e=>{if(updater?.recoverable||installer?.active){e.preventDefault();e.returnValue='';}});
$('connect').onclick=()=>work(async()=>{
 const port=await navigator.serial.requestPort({filters:[{usbVendorId:0x303a},{usbVendorId:0x1a86},{usbVendorId:0x10c4},{usbVendorId:0x0403}]});
 notice('보드 버전과 기록 보관 상태를 확인하고 있습니다…');const d=await connection.attach(port);board=d;connected=true;dirty=false;seen.clear();$('events').replaceChildren();
 $('badge').textContent='USB 연결됨';$('badge').classList.add('online');$('usb').textContent='연결됨';state(d);notice('보드를 확인했습니다. 기존 설정을 유지하거나 Wi-Fi·시트 설정을 저장하세요.');
});
$('disconnect').onclick=()=>work(async()=>{await connection.close();connected=false;$('badge').textContent='USB 연결 전';$('badge').classList.remove('online');$('usb').textContent='마지막 확인 정보';notice('연결을 해제했습니다. 보드의 자동 수신과 전송은 계속됩니다.');});
for(const id of ['ssid','password','endpoint','token'])$(id).addEventListener('input',()=>{dirty=true;wizard.settingsChanged();controls();});
$('settings').onsubmit=e=>{e.preventDefault();void work(async()=>{
 if(!wizard.maySave())return;
 const before=await connection.read('info');if(before.bridgeId!==board.bridgeId||before.meterId!==board.meterId)throw Error('unsupported_board');
 const fields=settings({ssid:$('ssid').value,password:$('password').value,endpoint:$('endpoint').value,token:$('token').value},before);
 notice('설정을 USB로 저장하고 확인하고 있습니다…');
 try{const after=await client.request('configure',before,fields,35000);if(!preserved(before,after)||!after.configured||!after.hasSavedPassword||!after.hasSavedToken)throw Error('preservation_failed');
  $('password').value='';$('token').value='';wizard.configured();dirty=false;state(after);await client.close();connected=false;$('badge').textContent='USB 재연결 중';$('badge').classList.remove('online');$('usb').textContent='재시작 후 자동 재연결';notice('설정 저장을 확인했습니다. 같은 보드의 재연결을 기다립니다.');
 }finally{fields.password='';fields.token='';}
});};
async function runTest(){return work(async()=>{const d=await connection.read('info');if(d.bridgeId!==board.bridgeId||d.meterId!==board.meterId)throw Error('unsupported_board');wizard.startTest();try{state(await client.request('test',d));notice('Google 연결 시험을 요청했습니다. 실제 확인 응답을 기다립니다.');}catch(e){wizard.testFailed();throw e;}});}
$('test').onclick=runTest;
$('sheet-links').onsubmit=e=>{e.preventDefault();void work(async()=>{
 const before=await connection.read('info');if(before.bridgeId!==board.bridgeId||before.meterId!==board.meterId||!before.sheetUserLinksSupported)throw Error('unsupported_board');
 const urls=userSheetUrls([$('sheet-user-1').value,$('sheet-user-2').value],wizard.expectedSheet());
 notice('사용자 링크와 LCD QR 주소를 보드에 저장하고 확인하고 있습니다…');
 const after=await client.request('sheet-link',before,{sheetUrl:urls[0],sheetUserUrls:urls},35000);
 if(!linksPreserved(before,after,urls))throw Error('preservation_failed');
 state(after);wizard.linksSaved();notice('두 사용자 링크·LCD QR 주소 저장을 보드 응답으로 확인했습니다. 각 사용자 시트를 열어 탭 이름을 대조하세요.');
});};
async function recentHistory(){let after=Math.max(0,board.logNewestSeq-32);for(let page=0;page<4;page++){
 const d=await connection.read('logs',{after,limit:8});if(d.bridgeId!==board.bridgeId||d.meterId!==board.meterId)throw Error('unsupported_board');
 for(const raw of d.events||[]){const e=event(raw);if(e)addEvent(e);}if(!d.logHasMore)break;if(!Number.isInteger(d.logNextSeq)||d.logNextSeq<=after)throw Error('invalid_usb_reply');after=d.logNextSeq;
}}
$('history').onclick=()=>work(async()=>{await recentHistory();notice('보드에 보관된 최근 동작을 읽었습니다.');});
for(const format of ['csv','xlsx'])$('export-'+format).onclick=()=>work(async()=>{
 const user=Number($('export-user').value);$('export-status').textContent='보드의 보관 기록을 읽고 있습니다…';
 try{
  const data=await collectRecords({user,info:()=>connection.read('info'),page:(fields,before)=>client.request('records',before,fields),progress:(n,total)=>{$('export-status').textContent=`기록 읽는 중 · ${n} / ${total}건`;}});
  const bytes=format==='csv'?csvBytes(data):xlsxBytes(data),blob=new Blob([bytes],{type:format==='csv'?'text/csv;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=fileName(format,user);document.body.append(link);
  try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  $('export-status').textContent=`${data.rows.length}건의 ${format==='csv'?'CSV':'엑셀'} 파일 다운로드를 요청했습니다. 브라우저의 다운로드 목록에서 확인하세요.`;
  notice('기록 파일을 이 PC에 내려받습니다. 보드의 기록·설정은 유지됩니다.');
 }catch(e){
  const changed=['snapshot_changed','export_session_changed','session_changed'].includes(e.message);
  $('export-status').textContent=changed?'읽는 동안 기록이나 보드 연결 상태가 바뀌었습니다. 파일을 만들지 않았습니다. 잠시 후 다시 눌러주세요.':'기록을 끝까지 확인하지 못해 파일을 만들지 않았습니다. USB 연결을 확인하고 다시 눌러주세요.';
  notice($('export-status').textContent,true);
 }
});
setInterval(async()=>{
 if(!connection.enabled||!board||busy||installer?.active||polling)return;polling=true;
 const wasConnected=connected,recoveries=connection.recoveries;
 try{const d=await connection.read('info');connected=true;$('badge').textContent='USB 연결됨';$('badge').classList.add('online');$('usb').textContent='연결됨';state(d);if(!wasConnected||connection.recoveries!==recoveries){await recentHistory();notice('같은 보드에 다시 연결해 상태와 최근 로그를 확인했습니다.');}}
 catch(e){connected=false;$('badge').classList.remove('online');$('usb').textContent='마지막 확인 정보';
  if(['board_changed','unsupported_board','invalid_usb_reply'].includes(e.message)){await connection.close();$('badge').textContent='보드 다시 선택';error(e);}
  else{$('badge').textContent='USB 재연결 중';notice('케이블이 연결되면 같은 보드의 상태와 로그 표시를 다시 시작합니다.');}controls();
 }finally{polling=false;}
},3000);
window.addEventListener('pagehide',()=>{$('password').value='';$('token').value='';void connection.close();});

var audioDirty=false,modelDraft=false;
function meterControls(){
 const locked=busy||!!installer?.active||!!omron?.active();
 const b=board,enabled=connected&&b?.meterModelSwitchSupported===true&&!locked&&!dirty;
 for(const id of ['meter-model','meter-confirm'])$(id).disabled=!enabled;
 if(!modelDraft&&document.activeElement!==$('meter-model')&&!$('meter-confirm').checked)$('meter-model').value=b?.meterModel||'omron-hem7155t';
 $('apply-model').disabled=!enabled||!$('meter-confirm').checked||b.pending!==0||$('meter-model').value===b.meterModel;
 $('meter-help').textContent=!connected?'S3 보드를 USB로 연결하세요.':!b.meterModelSwitchSupported?'이 기능은 S3 hem-0.8.0 이상에서 지원합니다.':b.pending?'미전송 기록을 먼저 Google에 저장한 뒤 전환할 수 있습니다.':dirty?'입력 중인 Wi-Fi·토큰 설정을 먼저 저장하세요.':'기록과 시트 링크는 혈압계 종류마다 보관합니다. 전환 후 USB 보드를 다시 선택하고 Google 등록도 확인하세요.';
 const micro=b?.meterModel==='microlife-b4bt';$('micro-target').hidden=!micro;
 const select=$('meter-target'),previous=select.value;
 const targets=[...(b?.meterCandidates||[])];if(b?.targetAddress&&!targets.some(t=>t.address===b.targetAddress))targets.unshift({address:b.targetAddress,name:'저장된 기기'});
 select.replaceChildren(...targets.map(t=>{const o=document.createElement('option');o.value=t.address;o.textContent=[t.name||'BP B4 BT',t.address,t.rssi===undefined?'':t.rssi+' dBm'].filter(Boolean).join(' · ');return o;}));
 if(targets.some(t=>t.address===previous))select.value=previous;else if(b?.targetAddress)select.value=b.targetAddress;
 select.disabled=!enabled;$('target-confirm').disabled=!enabled;
 $('apply-target').disabled=!enabled||!micro||!select.value||!$('target-confirm').checked||b.pending!==0||(b.remembered>0&&select.value!==b.targetAddress);
 for(const id of ['audio-volume','save-audio','test-audio'])$(id).disabled=locked||!connected||!b?.audioSupported;
 if(!audioDirty&&b?.audioSupported)$('audio-volume').value=String(b.audioVolume);
 $('audio-help').textContent=b?.audioSupported&&!b.audioReady?'스피커 초기화를 확인하지 못했습니다. 기록 수신·전송은 계속됩니다.':'BLE 연결 시 짧은 비프, 시트 저장과 보드의 확인 보관이 끝나면 두 음의 차임입니다. 시험 버튼은 기록을 전송하지 않습니다.';
}
$('meter-model').addEventListener('change',()=>{modelDraft=true;});
for(const id of ['meter-model','meter-confirm','target-confirm','meter-target'])$(id).addEventListener('change',meterControls);
$('audio-volume').onchange=()=>{audioDirty=true;};
async function modelAction(operation,fields){return work(async()=>{
 const before=await connection.read('info');
 if(before.pending||dirty||!before.queueReady)throw Error('pending_records');
 const after=await client.request(operation,before,fields,35000);if(after.bridgeId!==before.bridgeId||after.meterId!==before.meterId)throw Error('preservation_failed');
 await connection.close();connected=false;board=null;modelDraft=false;$('meter-confirm').checked=false;$('target-confirm').checked=false;
 $('badge').textContent='USB 보드 다시 선택';$('badge').classList.remove('online');$('usb').textContent='재시작 중';
 notice('저장을 확인했습니다. 재시작 후 ‘USB 보드 선택’을 다시 누르세요. 종류를 바꾸면 별도 보관 기록·시트 링크를 표시하며 Google 기기 등록도 확인해야 합니다.');
});}
$('apply-model').onclick=()=>modelAction('meter-model',{model:$('meter-model').value,confirm:'CONFIRM-METER-MODEL-CHANGE'});
$('apply-target').onclick=()=>modelAction('meter-target',{address:$('meter-target').value,confirm:'CONFIRM-OWN-B4-BT'});
for(const [id,test] of [['save-audio',false],['test-audio',true]])$(id).onclick=()=>work(async()=>{
 const before=await connection.read('info');const after=await client.request('audio',before,{volume:Number($('audio-volume').value),test});
 if(!preserved(before,after))throw Error('preservation_failed');audioDirty=false;state(after);notice(test?'음량을 저장하고 비프·차임 시험을 요청했습니다.':'알림 음량을 저장했습니다.');
});

const initialMessages={initial_confirmation:'보드 모델과 새 보드 확인란을 먼저 확인하세요.',initial_disconnect_first:'현재 웹 USB 연결을 해제한 뒤 새 보드만 연결하세요.',initial_existing_installation:'기존 BP to Sheets가 감지됐습니다. 처음 설치하지 않았습니다. USB 보드 선택으로 연결한 뒤 업데이트를 이용하세요.',initial_has_data:'설정·기록 영역이 비어 있지 않습니다. 보존을 위해 설치하지 않았습니다. 출고 데모 보드도 이 경우 강제로 지우지 않습니다.',initial_not_fresh:'설치 후 새 보드 상태 확인이 필요합니다. 초기화하거나 다시 기록하지 마세요.',initial_recovery_required:'이 페이지를 유지하고 같은 USB 보드를 다시 선택하세요.'};
function initialControls(){
 if(!installer)return;
 const ready=installer.stage==='ready',locked=busy||installer.active;
 for(const id of ['initial-model','initial-empty'])$(id).disabled=locked;
 $('initial-inspect').disabled=busy||connected||connection?.enabled||dirty||installer.active||updater?.recoverable||!supported||!$('initial-model').checked||!$('initial-empty').checked;
 $('initial-ready').hidden=!ready;$('initial-start').disabled=busy||!ready||!$('initial-confirm').checked;$('initial-confirm').disabled=busy||!ready;
 $('initial-cancel').hidden=!ready;$('initial-cancel').disabled=busy;
 $('initial-retry').hidden=busy||!installer.recoverable;$('initial-retry').disabled=busy;
 $('initial-setup').hidden=installer.stage!=='complete';$('initial-setup').disabled=busy;
 $('initial-inspection').hidden=!installer.inspection;
 if(installer.inspection){$('initial-inspection-board').textContent=installer.inspection.bridgeId;$('initial-inspection-settings').textContent=installer.inspection.settingsEmpty?'비어 있음':'비어 있지 않음 · 초기화하지 않음';$('initial-inspection-log').textContent=installer.inspection.logEmpty?'비어 있음':'비어 있지 않음 · 초기화하지 않음';}
 $('initial-version').textContent=release.version;$('initial-board').textContent=installer.before?.bridgeId||'—';
 const phaseHelp={checking:'설치 파일과 새 보드를 검사하고 있습니다. 아직 기록하지 않았습니다.',ready:'선택한 보드 ID를 확인하고 아래 설치 확인란을 선택하세요. 아직 기록하지 않았습니다.',writing:'새 보드에 설치하고 있습니다. USB 케이블과 이 페이지를 유지하세요.',reconnecting:'설치 파일 기록이 끝났습니다. 재시작한 보드의 버전과 초기 상태를 확인합니다.',interrupted:'설치 확인이 중단됐습니다. 이 페이지를 유지하고 안내를 확인하세요.',complete:'새 보드의 설치와 초기 상태를 확인했습니다. 설정 마법사로 계속하세요.'};
 $('initial-help').textContent=phaseHelp[installer.stage]||(connected||connection?.enabled?'현재 USB 연결을 해제한 뒤, 사용 중인 보드는 분리하고 새 보드만 연결하세요.':dirty?'입력 중인 설정을 먼저 저장하거나 지워주세요.':'새 보드만 연결하세요. 확인 단계에서는 플래시에 기록하지 않습니다.');
}
async function initialWork(run){
 if(busy)return;busy=true;controls();
 try{while(polling)await new Promise(r=>setTimeout(r,20));$('initial-status').classList.remove('error');await run();}
 catch(e){const text=initialMessages[e.message]||messages[e.message]||'처음 설치 확인이 중단됐습니다. 페이지를 유지하고 USB 연결을 확인하세요.';$('initial-status').textContent=text;$('initial-status').classList.add('error');notice(e.name==='NotFoundError'?'USB 장치 선택을 취소했습니다.':text,true);}
 finally{busy=false;controls();}
}
async function initialPort(){return navigator.serial.requestPort({filters:[{usbVendorId:0x303a},{usbVendorId:0x1a86},{usbVendorId:0x10c4},{usbVendorId:0x0403}]});}
function initialComplete(d){connected=true;dirty=false;seen.clear();$('events').replaceChildren();state(d);$('badge').textContent='USB 연결됨';$('badge').classList.add('online');$('usb').textContent='연결됨';notice('새 보드의 첫 설치와 빈 기록·미설정 상태를 확인했습니다. 설정 마법사에서 시트·Wi-Fi·혈압계를 연결하세요.');}
for(const id of ['initial-model','initial-empty','initial-confirm'])$(id).onchange=initialControls;
$('initial-inspect').onclick=()=>initialWork(async()=>{const port=await initialPort();$('initial-confirm').checked=false;await installer.inspect(port,{confirmed:$('initial-empty').checked,model:$('initial-model').checked});});
$('initial-start').onclick=()=>initialWork(async()=>initialComplete(await installer.install({confirmed:$('initial-confirm').checked})));
$('initial-cancel').onclick=()=>initialWork(()=>installer.cancel());
$('initial-retry').onclick=()=>initialWork(async()=>initialComplete(await installer.retry(await initialPort())));
$('initial-setup').onclick=()=>{wizard.openBoard();$('wizard').scrollIntoView({block:'start'});};
for(const a of document.querySelectorAll('.initial-link'))a.addEventListener('click',()=>{$('initial-panel').open=true;});

if(location.hash==='#initial-card')$('initial-panel').open=true;

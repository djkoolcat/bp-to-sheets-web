import {SerialClient,Connection,settings,preserved,event,eventText} from './serial.mjs';
import {collectRecords,csvBytes,xlsxBytes,fileName} from './record-export.mjs';
import {createWizard} from './wizard.mjs';
import {userSheetUrls,linksPreserved} from './setup.mjs';
const $=id=>document.getElementById(id);
let board=null,connected=false,busy=false,dirty=false,polling=false,connection,wizard;
const seen=new Set();
const messages={invalid_ssid:'Wi-Fi 이름은 1~32바이트로 입력하세요.',invalid_password:'Wi-Fi 비밀번호는 8~63바이트로 입력하세요.',invalid_token:'Google에 등록한 64자리 소문자 토큰을 입력하세요.',invalid_endpoint:'Google Apps Script의 HTTPS /exec 주소를 입력하세요.',usb_timeout:'보드 응답을 확인하지 못했습니다. 설정 저장 결과는 재연결 후 확인하세요.',usb_disconnected:'USB 연결이 끊겼습니다. 보드를 다시 선택해 주세요.',unsupported_board:'이 설정 화면에서 지원하는 보드가 아닙니다.',invalid_usb_reply:'보드 응답을 확인할 수 없습니다. 다른 USB 장치를 선택했는지 확인하세요.',session_changed:'보드가 재시작했습니다. 다시 연결해 주세요.',busy:'보드 작업이 끝난 뒤 다시 시도하세요.',device_busy_timeout:'혈압계 통신이 끝난 뒤 보드를 다시 연결해 주세요.',preservation_failed:'저장 후 기존 기록·설정 확인이 필요합니다. 초기화하지 마세요.',invalid_configuration:'입력값을 확인하세요.',queue_not_ready:'보드 기록 저장소 확인이 필요합니다. 초기화하지 마세요.'};
Object.assign(messages,{export_update_required:'기록 내보내기는 S3 hem-0.7.0 이상에서 지원합니다. 펌웨어를 먼저 업데이트하세요.',invalid_export_reply:'기록 응답을 끝까지 확인하지 못해 파일을 만들지 않았습니다.',snapshot_changed:'읽는 동안 기록이나 전송 상태가 바뀌었습니다. 잠시 후 다시 저장해 주세요.',export_session_changed:'보드가 재시작하거나 바뀌었습니다. 다시 연결해 주세요.'});
Object.assign(messages,{invalid_sheet_tabs:'같은 시트의 서로 다른 사용자 탭 주소 두 개를 입력하세요. 각 주소에 gid가 필요합니다.',invalid_sheet_url:'Google 시트 주소를 확인하세요.',wrong_sheet:'1단계에서 선택한 시트와 다른 파일입니다. 사용자 탭의 주소를 다시 확인하세요.',sheet_link_commit_failed:'보드에서 링크 저장을 확인하지 못했습니다. 다시 읽어 확인한 뒤 필요하면 직접 저장하세요.'});
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function error(e){notice(e.name==='NotFoundError'?'USB 장치 선택을 취소했습니다.':e.name==='SecurityError'||e.name==='NotAllowedError'?'USB 권한을 허용하고 데스크톱 Chrome·Edge의 새 탭에서 다시 열어주세요.':messages[e.message]||'요청을 완료하지 못했습니다. USB 연결과 입력값을 확인해 주세요.',true);}
function controls(){
 for(const id of ['export-user','export-csv','export-xlsx'])$(id).disabled=busy||!connected||!board?.queueReady||board?.recordsExportVersion!==1;
 $('export-help').textContent=!connected?'USB 보드를 연결하면 기록을 파일로 저장할 수 있습니다.':board.recordsExportVersion!==1?'기록 내보내기는 S3 hem-0.7.0 이상에서 지원합니다. 설치형 앱으로 먼저 업데이트하세요.':'보드에 남아 있는 최근 최대 128건입니다. 내려받아도 보드 기록과 전송 대기 상태는 그대로입니다.';
 $('connect').disabled=busy||connected||!supported;$('disconnect').disabled=busy||!connection?.enabled;
 $('fields').disabled=busy||!connected||!board?.queueReady;
 $('test').disabled=busy||!connected||!board?.configured||dirty;
 $('history').disabled=busy||!connected||!Number.isInteger(board?.logNewestSeq);
 wizard?.render();
}
function state(d){
 board=d;wizard?.observe(d);$('pending').textContent=d.pending;$('remembered').textContent=d.remembered;$('version').textContent=d.firmwareVersion;
 $('model').textContent=d.chip==='esp32s3'?'Waveshare S3 LCD 1.54 · HEM-7155T':'ESP32-C3 · HEM-7155T';
 $('wifi').textContent=d.wifiStatus===3?'연결됨':d.error==='wifi_test_offline'?'단절 시험 중':'연결 대기';
 $('cloud').textContent=d.sending?'전송 중':d.result==='confirmed'?(d.lastOperation==='test'?'연결 시험 통과':'저장 확인 완료'):d.error?'확인 대기 · 기록 보존':d.configured?'자동 전송 대기':'설정 필요';
 $('automatic').textContent=d.autoEnabled?'켜짐':d.hasPairingKey?'꺼짐':'혈압계 등록 필요';
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
const supported=isSecureContext&&'serial'in navigator;$('unsupported').hidden=supported;
async function work(run){if(busy)return;busy=true;controls();try{while(polling)await new Promise(r=>setTimeout(r,20));await run();}catch(e){error(e);}finally{busy=false;controls();}}
wizard=createWizard({getState:()=>({board,connected,busy,dirty}),tokenChanged:()=>{dirty=true;controls();},test:()=>runTest(),refresh:()=>work(async()=>{state(await connection.read('info'));notice('보드의 현재 등록 상태와 저장 정보를 다시 읽었습니다.');}),notice});
controls();
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
 if(!connection.enabled||!board||busy||polling)return;polling=true;
 const wasConnected=connected,recoveries=connection.recoveries;
 try{const d=await connection.read('info');connected=true;$('badge').textContent='USB 연결됨';$('badge').classList.add('online');$('usb').textContent='연결됨';state(d);if(!wasConnected||connection.recoveries!==recoveries){await recentHistory();notice('같은 보드에 다시 연결해 상태와 최근 로그를 확인했습니다.');}}
 catch(e){connected=false;$('badge').classList.remove('online');$('usb').textContent='마지막 확인 정보';
  if(['board_changed','unsupported_board','invalid_usb_reply'].includes(e.message)){await connection.close();$('badge').textContent='보드 다시 선택';error(e);}
  else{$('badge').textContent='USB 재연결 중';notice('케이블이 연결되면 같은 보드의 상태와 로그 표시를 다시 시작합니다.');}controls();
 }finally{polling=false;}
},3000);
window.addEventListener('pagehide',()=>{$('password').value='';$('token').value='';void connection.close();});

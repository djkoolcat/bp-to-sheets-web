import {receiverSource} from './receiver-source.mjs?v=1.0.0';
import {googleRegistration,googleReceipt} from './google-setup.mjs?v=1.0.0';
import {SetupProgress,sheetUrl,sheetId,userSheetUrls,sheetBrowserUrl,newToken,deviceProperties,sheetFormula,pairingStatus} from './setup.mjs?v=1.0.0';
const $=id=>document.getElementById(id);
const titles=['내 시트 준비','USB 보드 확인','기기 토큰 발급·등록','Wi-Fi·Google 연결','혈압계 등록·수신 확인','사용자별 시트 링크·LCD QR'];
const short=['시트 준비','보드 확인','토큰 등록','Wi-Fi 연결','혈압계 연결','시트 링크·QR'];
const errors={invalid_setup_result:'이번에 복사한 등록 값에 대한 Google 준비 결과인지 확인하세요. 다른 보드·시트 또는 이전 결과는 사용할 수 없습니다.',invalid_sheet_url:'Google 시트의 전체 주소를 입력하세요.',invalid_token:'64자리 소문자 토큰을 입력하거나 새로 만들어 주세요.',invalid_devices:'기존 DEVICES_JSON 전체가 올바른 JSON인지 확인하세요.',device_already_registered:'같은 보드 ID가 이미 있습니다. 기존 값을 유지하거나 교체 확인란을 직접 선택하세요.',devices_too_large:'Google 속성 값의 크기 한도를 넘었습니다. 등록 목록을 확인하세요.',random_unavailable:'안전한 난수를 만들 수 없습니다. 최신 Chrome·Edge에서 HTTPS 주소로 여세요.'};
export function createWizard({getState,tokenChanged,test,refresh,notice}){
 const progress=new SetupProgress();let step=1,active=true,linkDirty=false,copied='',testAt=0,timeout=false,setupId='',googleCard='',receiptVerified=false;
 const identity=()=>{const b=getState().board;return b?[b.bridgeId,b.meterId].join('|'):'';};
 const hint=(text='')=>{$('wizard-notice').textContent=text;};
 const stopped=()=>getState().busy;
 function fail(error){hint(errors[error.message]||'입력값과 USB 연결을 확인하세요.');}
 function invalidate(){setupId='';googleCard='';receiptVerified=false;$('google-result').value='';$('google-result-status').textContent='Google에서 준비를 마친 뒤 결과를 붙여넣으세요.';copied='';$('registration-confirmed').checked=false;progress.invalidateRegistration();render();}
 function wipe(){
  $('token').value='';$('token').type='password';$('toggle-token').textContent='토큰 보기';$('toggle-token').setAttribute('aria-pressed','false');
  $('password').value='';$('existing-devices').value='';$('rotate-token').checked=false;$('replace-device').checked=false;$('devices-reviewed').checked=false;invalidate();
 }
 function mount(){
  for(const [card,slot] of [['connect-card','connect'],['network-card','network'],['links-card','links']])$(''+(active?'wizard-':'manage-')+slot+'-slot').append($(card));
  $(active?'wizard-token-slot':'manage-token-slot').append($('token-entry'));
  $(active?'wizard-status-slot':'manage-status-slot').prepend($('status-card'));
  $('wizard').hidden=!active;$('management').hidden=active;$('wizard-status-slot').hidden=!active;
  $('mode-wizard').setAttribute('aria-pressed',String(active));$('mode-manage').setAttribute('aria-pressed',String(!active));
 }
 function mode(value){if(stopped())return;active=value;mount();hint();render();}
 function show(n){if(stopped())return;step=n;hint();for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=Number(panel.dataset.panel)!==step;
  $('wizard-title').textContent=titles[step-1];$('wizard-counter').textContent=`처음 설정 · ${step} / 6`;
  for(const b of document.querySelectorAll('[data-step]')){b.removeAttribute('aria-current');if(Number(b.dataset.step)===step)b.setAttribute('aria-current','step');}
  render();$('wizard-title').focus({preventScroll:true});$('wizard').scrollIntoView({behavior:'instant',block:'start'});
 }
 function tokenValue(){return $('token').value.trim();}
 function registrationValue(){const {board}=getState();return deviceProperties($('existing-devices').value,board,tokenValue(),$('replace-device').checked);}
 async function copy(value,message){
  try{if(!navigator.clipboard?.writeText)throw Error('clipboard_unavailable');await navigator.clipboard.writeText(value);hint(message);return true;}
  catch{hint('클립보드 복사가 허용되지 않았습니다. 브라우저 주소창 옆 사이트 권한에서 클립보드를 허용한 뒤 다시 눌러주세요.');return false;}
 }
 function render(){
  const {board:b,connected,busy,dirty}=getState(),ready=connected&&b?.queueReady,replace=$('setup-purpose').value==='replace',keep=Boolean(b?.hasSavedToken&&$('keep-token').checked);
  $('wizard-back').disabled=busy||step===1;$('wizard-next').disabled=busy;$('wizard-next').textContent=step===6?'설정·기록 관리로':`다음 · ${short[step]}`;
  for(const id of ['mode-wizard','mode-manage'])$(id).disabled=busy;for(const el of document.querySelectorAll('[data-step]'))el.disabled=busy;
  for(const id of ['setup-sheet','sheet-confirmed','setup-purpose','existing-devices','replace-device','devices-reviewed','keep-token','rotate-token','registration-confirmed','clear-registration'])$(id).disabled=busy;
  const sid=sheetId($('setup-sheet').value);$('spreadsheet-id').textContent=sid||'시트 주소를 입력하세요';$('property-sheet-id').textContent=sid||'1단계 시트 ID';$('copy-sheet-id').disabled=!sid||busy;
  $('wizard-board-id').textContent=b?.bridgeId||'USB 연결 후 표시';$('wizard-meter-id').textContent=b?.meterId||'USB 연결 후 표시';$('wizard-records').textContent=b?`보관 ${b.remembered}건 · 대기 ${b.pending}건${connected?'':' · 마지막 확인'}`:'USB 연결 후 표시';
  $('replacement-help').hidden=!replace;$('keep-token-row').hidden=!b?.hasSavedToken;$('token-saved-help').hidden=!b?.hasSavedToken;$('new-token-area').hidden=keep;$('rotate-row').hidden=!b?.hasSavedToken;
  const tokenAllowed=ready&&!replace&&(!b.hasSavedToken||$('rotate-token').checked);
  $('generate-token').disabled=busy||!tokenAllowed;$('token').disabled=busy||!ready||(active&&(keep||!tokenAllowed));$('toggle-token').disabled=$('token').disabled;
  $('copy-devices').disabled=busy||!ready||replace||!sid||!$('devices-reviewed').checked||!/^[a-f0-9]{64}$/.test(tokenValue());
  $('copy-google-registration').disabled=busy||!ready||replace||!sid||!/^[a-f0-9]{64}$/.test(tokenValue());$('google-result').disabled=busy||!googleCard;$('apply-google-result').disabled=busy||!googleCard;$('copy-receiver-code').disabled=busy;
  $('registration-confirmed').disabled=busy||!copied&&!receiptVerified;$('wizard-test').disabled=busy||!connected||!b?.configured||dirty||progress.testPending;$('wizard-refresh').disabled=busy||!connected;
  const checklist=progress.checklist(b,connected),labels={pending:'확인 전',user:'직접 확인',board:'보드 확인',saved:'저장 정보 있음'};
  if(linkDirty)checklist[5]='pending';
  for(let i=0;i<6;i++){$('progress-'+(i+1)).textContent=labels[checklist[i]];document.querySelector(`[data-step="${i+1}"]`).classList.toggle('verified',checklist[i]==='board');}
  $('wizard-test-status').textContent=progress.test===identity()&&connected?'Google 확인 응답을 받았습니다. 연결 시험을 통과했습니다.':progress.testPending?'Google 응답을 기다립니다. USB 연결을 유지하세요.':timeout?'이번 연결 시험을 확인하지 못했습니다. Wi-Fi·Google 등록 상태를 확인하고 직접 다시 시험하세요.':b?.error==='wifi_disconnected'||b?.wifiStatus!==3?'Wi-Fi 연결 후 시험하세요. 미전송 기록은 보드에 유지됩니다.':'보드 저장·재연결 후 Google 연결 시험을 누르세요.';
  const pair=pairingStatus(connected?b:null),pairText={disconnected:'USB를 연결하면 등록 상태를 읽습니다.',needs_registration:'혈압계 연결 키가 없습니다. 최초 등록 절차가 필요합니다.',needs_auto_target:'연결 키는 저장돼 있지만 자동 수신이 꺼져 있습니다. 자동 대상 등록을 확인하세요.',saved_registration:'연결 키와 자동 수신 대상이 저장돼 있습니다. 실제 수신은 아래 절차로 확인하세요.'};
  $('pairing-status').textContent=b?.pairingRequired===false?(b.autoEnabled?'Microlife 자동 수신 대상이 저장돼 있습니다. 새 측정 없이 전송을 켜서 수신을 확인하세요.':'아래 혈압계 선택 카드에서 검색된 본인 BP B4 BT를 등록하세요. 인증 키 등록은 필요하지 않습니다.'):pairText[pair];$('pairing-initial').hidden=b?.pairingRequired===false;$('pairing-existing').hidden=pair!=='saved_registration'||b?.pairingRequired===false;$('pairing-received').textContent=progress.received?'이번 USB 연결에서 기록 수신 완료 동작을 확인했습니다.':'이번 USB 연결에서 기록 수신은 아직 확인하지 않았습니다.';
  const linksReady=ready&&b?.sheetUserLinksSupported===true;
  $('link-fields').disabled=busy||!linksReady||(active&&replace);
  if(!linkDirty){for(let i=1;i<=2;i++)$('sheet-user-'+i).value=b?.sheetUserUrls?.[i-1]||'';}
  $('links-status').textContent=!connected?'S3 LCD 보드를 연결하면 저장된 링크를 읽습니다.':!b.sheetUserLinksSupported?'사용자별 LCD QR 설정은 지원 펌웨어를 설치한 S3 LCD 보드에서 가능합니다.':linkDirty?'입력한 링크는 아직 보드에 저장하지 않았습니다.':'보드에 저장된 링크를 표시합니다. 각 탭을 열어 사용자 이름을 대조하세요.';
  // Viewing links always use ACK/readback values, never an unsaved draft.
  for(let i=1;i<=2;i++){const a=$('open-sheet-'+i),url=sheetBrowserUrl(b?.sheetUserUrls?.[i-1]||'');a.hidden=!connected||!url;a.removeAttribute('href');if(connected&&url)a.href=url;}
  $('setup-checklist').replaceChildren(...short.map((title,i)=>{const li=document.createElement('li'),name=document.createElement('span'),badge=document.createElement('span');name.textContent=title;badge.textContent=labels[checklist[i]];badge.className=checklist[i]==='board'?'confirmed':checklist[i]==='user'?'user':'';li.append(name,badge);return li;}));
  const required=checklist.slice(0,5),all=required.every(v=>v==='board'||v==='user');$('setup-summary').textContent=all?'시트 등록·Google 연결 시험·실제 수신을 확인했습니다. LCD QR은 각 사용자 탭이 맞는지 휴대폰에서 마지막으로 확인하세요.':'아직 확인하지 않은 단계가 있습니다. 저장된 키만으로 수신 성공으로 표시하지 않습니다. 필요한 단계는 나중에 이어서 확인할 수 있습니다.';
 }
 function observe(d){
  const old=progress.identity,changed=progress.observe(d);
  if(!old||changed){wipe();$('keep-token').checked=d.hasSavedToken;$('setup-purpose').value=d.hasPairingKey?'keep':'first';linkDirty=false;testAt=0;timeout=false;
   if(changed){$('setup-sheet').value='';$('sheet-confirmed').checked=false;notice('다른 보드가 연결되어 이전 토큰·마법사 확인 상태를 지웠습니다. 새 보드 정보를 확인하세요.');}
   if(!$('setup-sheet').value&&sheetUrl(d.sheetUserUrls?.[0]||'')){$('setup-sheet').value=d.sheetUserUrls[0];progress.setSheet(d.sheetUserUrls[0]);}
  }
  if(progress.testPending&&Date.now()-testAt>90000){progress.testPending=false;timeout=true;}
  render();
 }
 function maySave(){
  if(!active)return true;
  if($('setup-purpose').value==='replace'){hint('보드 교체는 기존 관리 ID 이전을 먼저 확인하세요.');return false;}
  const {board}=getState(),keep=Boolean(board?.hasSavedToken&&!tokenValue());
  if(!progress.canSave(tokenValue(),keep)){hint('1단계의 시트 확인과 3단계의 Google 기기 등록 확인을 먼저 마쳐주세요.');return false;}
  return true;
 }
 function next(){
  if(step===1){try{progress.setSheet($('setup-sheet').value);}catch(e){fail(e);return;}if(!$('sheet-confirmed').checked){hint('시트 공유 설정을 직접 확인하고 확인란을 선택하세요.');return;}progress.sheetConfirmed=true;}
  if(step===2){if(!getState().connected){hint('USB 보드를 먼저 선택하세요.');return;}if($('setup-purpose').value==='replace'){hint('기존 혈압계 관리 ID 이전이 필요합니다. 보드 교체 안내를 확인하세요.');return;}}
  if(step===3){if(!$('setup-sheet').value||!progress.sheetConfirmed){hint('1단계 시트 확인부터 마쳐주세요.');return;}const {board,connected}=getState();if(!connected){hint('2단계에서 USB 보드를 연결하세요.');return;}
   if(board.hasSavedToken&&$('keep-token').checked)progress.confirmRegistration('',true);
   else if(!progress.registration||progress.registration!==tokenValue()){hint('토큰을 Google에 등록한 뒤 확인란을 선택하세요.');return;}}
  if(step===4&&(!getState().connected||getState().dirty||!progress.test||progress.test!==identity())){hint('설정을 저장하고 재연결한 뒤 Google 연결 시험 통과를 확인하세요. 뒤 단계 안내는 위 단계 이름을 눌러 볼 수 있습니다.');return;}
  if(step===6){mode(false);return;}show(step+1);
 }
 $('mode-wizard').onclick=()=>mode(true);$('mode-manage').onclick=()=>mode(false);
 for(const b of document.querySelectorAll('[data-step]'))b.onclick=()=>show(Number(b.dataset.step));
 $('wizard-back').onclick=()=>show(step-1);$('wizard-next').onclick=next;
 $('setup-sheet').addEventListener('input',()=>{progress.sheetConfirmed=false;$('sheet-confirmed').checked=false;invalidate();});
 $('sheet-confirmed').onchange=()=>{try{progress.setSheet($('setup-sheet').value);progress.sheetConfirmed=$('sheet-confirmed').checked;render();}catch(e){$('sheet-confirmed').checked=false;fail(e);}};
 $('setup-purpose').onchange=()=>{invalidate();};
 $('copy-receiver-code').onclick=()=>copy(receiverSource,'수신기 코드를 복사했습니다. 시트의 확장 프로그램 → Apps Script에서 Code.gs 전체를 교체하고 저장하세요. 토큰은 코드에 넣지 않습니다.');
 $('copy-google-registration').onclick=async()=>{try{if(!setupId)setupId=newToken().slice(0,32);const value=googleRegistration(getState().board,tokenValue(),setupId);if(await copy(value,'Google 설정용 등록 값을 복사했습니다. Google 시트의 BP to Sheets → 처음 설정 창에 붙여넣으세요.')){googleCard=value;copied='';receiptVerified=false;progress.invalidateRegistration();$('registration-confirmed').checked=false;$('google-result').value='';$('google-result-status').textContent='Google 설정 창의 준비 결과를 아래에 붙여넣으세요. 결과에는 토큰이 없습니다.';render();}}catch(e){fail(e);}};
 $('google-result').addEventListener('input',()=>{receiptVerified=false;progress.invalidateRegistration();$('registration-confirmed').checked=false;render();});
 $('apply-google-result').onclick=()=>{try{const urls=googleReceipt($('google-result').value,{board:getState().board,setupId,sheet:progress.sheet||$('setup-sheet').value});if(googleCard!==googleRegistration(getState().board,tokenValue(),setupId))throw Error('invalid_setup_result');receiptVerified=true;for(let i=0;i<2;i++)$('sheet-user-'+(i+1)).value=urls[i];linkDirty=true;$('google-result').value='';$('google-result-status').textContent='이 보드·시트의 준비 결과를 확인했습니다. 아래 Google 등록 확인란을 선택하세요. 사용자별 링크는 6단계에서 USB로 저장합니다. 실제 Google 연결은 4단계에서 시험합니다.';render();}catch(e){receiptVerified=false;$('registration-confirmed').checked=false;progress.invalidateRegistration();fail(e);}};
 $('copy-sheet-id').onclick=()=>copy(sheetId($('setup-sheet').value),'시트 ID를 복사했습니다. Google 스크립트 속성에 붙여넣으세요.');
 $('generate-token').onclick=()=>{try{$('token').value=newToken();tokenChanged();invalidate();hint('새 토큰을 만들었습니다. Google 등록 값을 복사해 Google에 먼저 저장하세요.');}catch(e){fail(e);}};
 $('keep-token').onchange=()=>{if($('keep-token').checked){$('token').value='';tokenChanged();}invalidate();};
 $('rotate-token').onchange=()=>{if(!$('rotate-token').checked){$('token').value='';tokenChanged();}invalidate();};
 $('token').addEventListener('input',invalidate);
 for(const id of ['existing-devices','replace-device','devices-reviewed'])$(id).addEventListener(id==='existing-devices'?'input':'change',invalidate);
 $('copy-devices').onclick=async()=>{try{const value=registrationValue();if(await copy(value,'등록 값을 복사했습니다. Google의 DEVICES_JSON 값에 붙여넣고 저장하세요.')){copied=value;$('copy-registration-status').textContent='등록 값을 복사했습니다. Google에 저장한 뒤 아래 확인란을 선택하세요.';render();}}catch(e){fail(e);}};
 $('registration-confirmed').onchange=()=>{try{if($('registration-confirmed').checked&&(copied&&copied===registrationValue()||receiptVerified&&googleCard===googleRegistration(getState().board,tokenValue(),setupId)))progress.confirmRegistration(tokenValue(),false);else progress.invalidateRegistration();render();}catch(e){fail(e);}};
 $('clear-registration').onclick=()=>{wipe();tokenChanged();hint('이 페이지에 입력한 비밀 값을 지웠습니다. 보드와 Google 값은 바꾸지 않았습니다.');};
 $('toggle-token').onclick=()=>{const show=$('token').type==='password';$('token').type=show?'text':'password';$('toggle-token').textContent=show?'토큰 숨기기':'토큰 보기';$('toggle-token').setAttribute('aria-pressed',String(show));};
 $('wizard-test').onclick=test;$('wizard-refresh').onclick=refresh;
 for(let i=1;i<=2;i++){$('sheet-user-'+i).addEventListener('input',()=>{linkDirty=true;render();});$('copy-formula-'+i).onclick=()=>copy(sheetFormula(i),`사용자 ${i} 탭의 A2에 붙여넣으세요.`);}
 window.addEventListener('pagehide',()=>{wipe();progress.reset();});
 mount();render();
 return {openBoard:()=>{mode(true);show(2);},render,observe,maySave,settingsChanged:()=>progress.settingsChanged(),active:()=>active,expectedSheet:()=>active?progress.sheet:'',linksSaved:()=>{linkDirty=false;render();},startTest:()=>{progress.startTest();testAt=Date.now();timeout=false;},testFailed:()=>{progress.testPending=false;timeout=true;render();},event:e=>{progress.event(e);render();},configured:()=>{setupId='';googleCard='';receiptVerified=false;$('google-result').value='';progress.test='';progress.testPending=false;progress.registration='saved';copied='';$('existing-devices').value='';$('registration-confirmed').checked=false;$('keep-token').checked=true;$('token').type='password';$('toggle-token').textContent='토큰 보기';$('toggle-token').setAttribute('aria-pressed','false');},clear:wipe};
}

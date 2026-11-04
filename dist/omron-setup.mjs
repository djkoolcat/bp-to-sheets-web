// Registration actions are explicit USB writes. Reconnection only reads state.
export const phases=['idle','scanning','scanned','connecting','preparing_key','registering','reading','saving_target','complete','failed'];
export const errors={omron_not_ready:'보드와 기록 저장소가 준비된 뒤 다시 확인하세요.',busy:'보드 작업이 끝난 뒤 다시 눌러주세요.',omron_already_automatic:'이미 자동 수신이 켜져 있습니다. 키를 다시 등록할 필요가 없습니다.',omron_restart_required:'USB 케이블을 뺐다가 다시 연결한 뒤 검색하세요. 키와 기록은 유지됩니다.',omron_stale_selection:'검색 결과가 만료됐습니다. 혈압계 전송 표시를 켜고 다시 검색하세요.',omron_confirmation_required:'본인 혈압계와 키 등록 영향을 확인한 뒤 확인란을 선택하세요.',omron_existing_records:'기존 기록이 있는 보드는 이 최초 등록 절차로 대상을 바꾸지 않습니다. 기록을 지우지 말고 관리 ID 이전을 먼저 확인하세요.',omron_missing_key:'저장된 연결 키가 없습니다. 새 키 등록 절차를 선택하세요.',omron_model_not_verified:'HEM-7155T 모델을 확인하지 못했습니다. 원본에 쓰지 않았습니다. 보드를 재시작하고 혈압계 P 표시를 다시 켜세요.',omron_key_store_failed:'보드 내부 키 저장을 확인하지 못했습니다. 초기화하지 말고 보드를 재시작하세요.',omron_enrollment_unconfirmed:'키 등록 응답을 확인하지 못했습니다. 같은 보드 키를 유지합니다. 보드를 재시작한 뒤 P 표시와 등록 동의를 다시 확인하세요.',omron_read_unconfirmed:'두 사용자 기록 또는 원본 유지 검증을 마치지 못했습니다. 자동 대상은 저장하지 않았습니다. 보드를 재시작한 뒤 저장 키로 수신을 다시 시험하세요.',omron_target_save_failed:'기록은 보관했지만 자동 대상 저장을 확인하지 못했습니다. 초기화하지 말고 설정을 점검하세요.'};
export const running=p=>['scanning','connecting','preparing_key','registering','reading','saving_target'].includes(p);
export function validateSetup(d){
 if(d.omronSetupSupported===undefined)return;
 if(typeof d.omronSetupSupported!=='boolean'||d.chip!=='esp32s3')throw Error('invalid_usb_reply');
 if(!d.omronSetupSupported){if(d.meterModel!=='microlife-b4bt')throw Error('invalid_usb_reply');return;}
 const s=d.omronSetup;
 if(d.meterModel!=='omron-hem7155t'||!s||!phases.includes(s.phase)||!Number.isInteger(s.scan)||s.scan<0||s.scan>0xffffffff||typeof s.error!=='string'||s.error!==''&&!Object.hasOwn(errors,s.error)||!Array.isArray(s.candidates)||s.candidates.length>8)throw Error('invalid_usb_reply');
 const seen=new Set();for(const t of s.candidates){if(!t||typeof t.address!=='string'||!/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/.test(t.address)||seen.has(t.address)||typeof t.name!=='string'||t.name.length>39||!Number.isInteger(t.rssi)||t.rssi< -127||t.rssi>0)throw Error('invalid_usb_reply');seen.add(t.address);}
 if(s.phase!=='scanned'&&s.candidates.length)throw Error('invalid_usb_reply');
}
export function setupAction(b,action,address='',confirmed=false){
 validateSetup(b);
 if(!b.omronSetupSupported||!b.queueReady)throw Error('omron_not_ready');
 if(action==='restart'){if(b.omronSetup.phase!=='failed'||b.autoEnabled)throw Error('omron_not_ready');return {action};}
 if(b.autoEnabled)throw Error('omron_already_automatic');
 if(running(b.omronSetup.phase))throw Error('busy');
 if(action==='scan')return {action};
 if(!['register','receive'].includes(action))throw Error('invalid_operation');
 if(b.remembered)throw Error('omron_existing_records');
 if(b.omronSetup.phase!=='scanned'||!b.omronSetup.candidates.some(t=>t.address===address))throw Error('omron_stale_selection');
 if(action==='register'&&!confirmed)throw Error('omron_confirmation_required');
 if(action==='receive'&&!b.hasPairingKey)throw Error('omron_missing_key');
 return {action,address,scan:b.omronSetup.scan,...(action==='register'?{confirm:'CONFIRM-PAIRING-KEY-CHANGE'}:{})};
}
export function createOmronSetup({getState,run}){
 const $=id=>document.getElementById(id);let selection='',identity='',scan=-1;
 const statusText={idle:'혈압계를 끈 상태에서 Bluetooth 버튼으로 P 표시를 켜고 검색하세요.',scanning:'가까운 혈압계를 검색 중입니다. 약 10초 기다려주세요.',scanned:'본인 혈압계를 선택하세요. 기기 이름만으로 모델을 확정하지 않으며 연결 후 HEM-7155T를 다시 검증합니다.',connecting:'선택한 혈압계에 연결하고 모델을 확인합니다.',preparing_key:'보드 내부에 새 연결 키를 준비합니다. 키는 USB로 보내지 않습니다.',registering:'동의한 연결 키를 혈압계에 등록하고 응답을 확인합니다.',reading:'두 사용자 기록을 두 번 읽고 원본 인덱스·새 기록 카운터와 종료 응답을 검증합니다.',saving_target:'읽기 검증을 통과했습니다. 자동 수신 대상을 저장합니다.',complete:'등록·두 사용자 읽기·자동 대상 저장을 확인했습니다. 보드 재시작 후 Google 저장 확인은 전송 대기 건수로 확인하세요.'};
 function render(){
  const {board:b,connected,busy,dirty}=getState(),s=connected?b?.omronSetup:null,enabled=connected&&b?.omronSetupSupported===true,locked=busy||dirty||running(s?.phase);
  $('omron-web').hidden=b?.meterModel==='microlife-b4bt';
  const next=b?[b.bridgeId,b.session].join('|'):'';
  if(next!==identity||scan!==s?.scan){identity=next;scan=s?.scan;selection='';$('omron-confirm').checked=false;}
  const select=$('omron-target');if(document.activeElement===select)selection=select.value;
  select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='본인 기기를 선택하세요';select.append(blank);
  for(const t of s?.candidates||[]){const o=document.createElement('option');o.value=t.address;o.textContent=`${t.name||'이름 없음'} · ${t.address} · ${t.rssi} dBm`;select.append(o);}
  select.value=selection;select.disabled=locked||!enabled||s?.phase!=='scanned'||b?.autoEnabled;
  $('omron-progress').textContent=!connected?'USB 보드를 연결하세요.':!enabled?'웹 등록은 S3 hem-0.9.0 이상이 필요합니다. 펌웨어를 먼저 업데이트하세요.':s?.error?errors[s.error]:s?.phase==='complete'?statusText.complete:b.autoEnabled?'저장된 키와 자동 수신 대상이 있습니다. 재등록 없이 혈압계 전송을 켜서 수신을 확인하세요.':s?.phase==='failed'?'작업이 중단됐습니다. 설정을 지우지 말고 보드를 재시작하세요.':statusText[s?.phase]||'';
  $('omron-scan').disabled=locked||!enabled||b?.autoEnabled||s?.phase==='failed'||s?.phase==='complete';
  $('omron-confirm').disabled=locked||!enabled||b?.autoEnabled||b?.remembered>0;
  const selected=s?.phase==='scanned'&&s.candidates.some(t=>t.address===selection);
  $('omron-register').disabled=locked||!enabled||b?.autoEnabled||b?.remembered>0||!selected||!$('omron-confirm').checked;
  $('omron-receive').hidden=!b?.hasPairingKey||b?.autoEnabled;
  $('omron-receive').disabled=locked||!enabled||b?.remembered>0||!selected;
  $('omron-restart').hidden=s?.phase!=='failed';$('omron-restart').disabled=busy||!enabled||b?.autoEnabled;
  $('omron-record-warning').hidden=!enabled||!b?.remembered||b?.autoEnabled;
 }
 selectEvents();function selectEvents(){for(const id of ['omron-target','omron-confirm'])$(id).addEventListener('change',()=>{selection=$('omron-target').value;render();});for(const [id,action] of [['omron-scan','scan'],['omron-register','register'],['omron-receive','receive'],['omron-restart','restart']])$(id).onclick=()=>run(action,selection,$('omron-confirm').checked);}
 return {render,active:()=>running(getState().connected?getState().board?.omronSetup?.phase:null)};
}

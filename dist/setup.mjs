// Setup values live only in the current page. No Google credentials are read.
const fail=code=>{throw Error(code);};
export function sheetUrl(value){
 if(typeof value!=='string'||value.length>512)return '';
 try{
  const u=new URL(value.trim());
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||u.port||u.username||u.password)return '';
  const m=u.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,128})(?:\/(?:edit|view|preview))?\/?$/);
  if(!m)return '';
  const hash=new URLSearchParams(u.hash.slice(1)),a=hash.getAll('gid'),b=u.searchParams.getAll('gid');
  if(a.length>1||b.length>1||(a.length&&b.length&&a[0]!==b[0]))return '';
  const gid=a[0]??b[0];
  if(gid!==undefined&&(!/^(0|[1-9]\d{0,9})$/.test(gid)||Number(gid)>0xffffffff))return '';
  const out='https://docs.google.com/spreadsheets/d/'+m[1]+'/edit'+(gid===undefined?'':'#gid='+gid);
  return out.length<192?out:''; // Same capacity as the LCD firmware.
 }catch{return '';}
}
export function sheetId(value){const u=sheetUrl(value);return u?u.split('/')[5]:'';}
export function userSheetUrls(value,expectedSheet=''){
 if(!Array.isArray(value)||value.length!==2)fail('invalid_sheet_tabs');
 const urls=value.map(sheetUrl);
 if(urls.some(u=>!u.includes('#gid='))||urls[0]===urls[1]||sheetId(urls[0])!==sheetId(urls[1]))fail('invalid_sheet_tabs');
 if(expectedSheet&&sheetId(urls[0])!==sheetId(expectedSheet))fail('wrong_sheet');
 return urls;
}
export function sheetBrowserUrl(value){
 const url=sheetUrl(value),tab=url.indexOf('#gid=');
 return tab<0?url:url.slice(0,tab)+'?gid='+url.slice(tab+5)+url.slice(tab);
}
export function newToken(random=globalThis.crypto){
 if(!random?.getRandomValues)fail('random_unavailable');
 const bytes=random.getRandomValues(new Uint8Array(32));
 const value=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');bytes.fill(0);return value;
}
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function deviceProperties(existing,board,token,replace=false){
 if(!/^esp32-[a-f0-9]{12}$/.test(board?.bridgeId)||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(board?.meterId))fail('invalid_usb_reply');
 if(!/^[a-f0-9]{64}$/.test(token))fail('invalid_token');
 if(typeof existing!=='string'||existing.length>9000)fail('invalid_devices');
 let devices;try{devices=JSON.parse(existing.trim()||'{}');}catch{fail('invalid_devices');}
 if(!plain(devices))fail('invalid_devices');
 for(const [id,d] of Object.entries(devices)){
  if(!/^esp32-[a-f0-9]{12}$/.test(id)||!plain(d)||!/^([a-f0-9]{64})$/.test(d.token)||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(d.meterId))fail('invalid_devices');
 }
 const old=devices[board.bridgeId];
 if(old&&(old.token!==token||old.meterId!==board.meterId)&&!replace)fail('device_already_registered');
 devices[board.bridgeId]={...old,token,meterId:board.meterId};
 const value=JSON.stringify(devices);if(new TextEncoder().encode(value).length>9000)fail('devices_too_large');return value;
}
export function linksPreserved(before,after,urls){
 return after.queueReady&&['chip','boardId','bridgeId','meterId','session','hasPairingKey','autoEnabled','configured','hasSavedPassword','hasSavedToken'].every(k=>before[k]===after[k])&&after.remembered>=before.remembered&&after.sheetUserLinksSupported===true&&JSON.stringify(after.sheetUserUrls)===JSON.stringify(urls)&&after.sheetUrl===urls[0];
}
export function sheetFormula(user){
 if(user!==1&&user!==2)fail('invalid_user');
 return `=IFNA(FILTER('혈압기록'!A2:H,ARRAYFORMULA(TO_TEXT('혈압기록'!F2:F))="${user}"),"")`;
}
export function pairingStatus(board){
 if(!board)return 'disconnected';
 if(!board.hasPairingKey)return 'needs_registration';
 return board.autoEnabled?'saved_registration':'needs_auto_target';
}
// Progress describes evidence, not navigation. A saved key alone never proves
// this session has communicated with the cuff; a test ACK only queues a test.
export class SetupProgress{
 constructor(){this.identity='';this.reset();}
 reset(){this.sheet='';this.sheetConfirmed=false;this.registration='';this.saved='';this.test='';this.testPending=false;this.observedTestStart=false;this.received=false;}
 observe(board){
  const identity=board?[board.bridgeId,board.meterId].join('|'):'';
  const changed=Boolean(this.identity&&identity&&identity!==this.identity);
  if(changed)this.reset();if(identity)this.identity=identity;
  if(this.testPending&&board){
   if(board.lastOperation==='test'&&board.result!=='confirmed')this.observedTestStart=true;
   if(this.observedTestStart&&board.lastOperation==='test'&&board.result==='confirmed'&&!board.error){this.test=this.identity;this.testPending=false;}
   if(board.lastOperation==='test'&&(board.result==='failed'||(board.error&&!board.sending))){this.testPending=false;this.test='';}
  }
  return changed;
 }
 setSheet(value){const url=sheetUrl(value);if(!url)fail('invalid_sheet_url');if(sheetId(url)!==sheetId(this.sheet)){this.registration='';this.test='';this.sheetConfirmed=false;}this.sheet=url;}
 confirmRegistration(token,keep){this.registration=keep?'saved':token;this.settingsChanged();}
 settingsChanged(){this.test='';this.testPending=false;}
 invalidateRegistration(){this.registration='';this.test='';this.testPending=false;}
 canSave(token,keep){return Boolean(this.sheetConfirmed&&this.registration&&(keep?this.registration==='saved':this.registration===token));}
 startTest(){this.test='';this.testPending=true;this.observedTestStart=false;}
 event(e){if(e.code===7)this.received=true;}
 checklist(board,connected){
  const links=connected&&board?.sheetUserLinksSupported&&board?.sheetUserUrls?.length===2&&board.sheetUserUrls.every(Boolean)&&(!this.sheet||sheetId(this.sheet)===sheetId(board.sheetUserUrls[0]));
  return [this.sheetConfirmed?'user':'pending',connected?'board':'pending',this.registration?'user':'pending',connected&&board?.configured&&this.test===this.identity?'board':'pending',connected&&this.received?'board':pairingStatus(board)==='saved_registration'?'saved':'pending',links?'board':'pending'];
 }
}

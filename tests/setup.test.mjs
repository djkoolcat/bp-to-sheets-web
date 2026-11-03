import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SetupProgress,sheetUrl,sheetId,userSheetUrls,sheetBrowserUrl,newToken,deviceProperties,linksPreserved,sheetFormula,pairingStatus} from '../dist/setup.mjs';
import {reply,preserved} from '../dist/serial.mjs';
import {createWizard} from '../dist/wizard.mjs';
const base='https://docs.google.com/spreadsheets/d/'+'S'.repeat(24)+'/edit';
const urls=[base+'#gid=0',base+'#gid=12'];
const board={schemaVersion:1,product:'bp-to-sheets-hem7155t',requestId:'test',operation:'info',ok:true,chip:'esp32s3',boardId:'waveshare-s3-lcd154',appPartitionSize:0x600000,flashSize:0x1000000,firmwareVersion:'hem-0.7.0',bridgeId:'esp32-000000000001',meterId:'hem-synthetic',session:'a'.repeat(32),queueReady:true,configured:true,hasSavedPassword:true,hasSavedToken:true,hasPairingKey:true,autoEnabled:true,pending:0,remembered:17,wifiStatus:3,clockReady:true,sending:false,sheetLinkSupported:true,sheetUrl:urls[0],sheetUserLinksSupported:true,sheetUserUrls:urls,lastOperation:'test',result:'confirmed',error:''};
const token='ab'.repeat(32);

test('Sheet URLs retain only the trusted file and tab, including tab zero',()=>{
 assert.equal(sheetUrl(base+'?gid=0&tracking=ignored#gid=0'),urls[0]);
 assert.equal(sheetId(urls[1]),'S'.repeat(24));
 assert.equal(sheetBrowserUrl(urls[1]),base+'?gid=12#gid=12');
 assert.equal(sheetUrl(' '+base+'/ '),base);
 for(const value of [base+'?gid=1#gid=2',base+'?gid=1&gid=2',base+'#gid=01',base+'#gid=4294967296',base+'#gid=abc',base.replace('docs.google.com','docs.google.com.evil.invalid'),base.replace('https:','http:'),base.replace('docs.google.com','user:secret@docs.google.com'),base+'/export',base.replace('S'.repeat(24),'S'.repeat(129))])assert.equal(sheetUrl(value),'');
});
test('Both QR targets must be different tabs in the selected spreadsheet',()=>{
 assert.deepEqual(userSheetUrls(urls,base),urls);
 for(const pair of [[base,urls[1]],[urls[0],urls[0]],[urls[0],urls[1].replace('S'.repeat(24),'T'.repeat(24))]])assert.throws(()=>userSheetUrls(pair),/invalid_sheet_tabs/);
 assert.throws(()=>userSheetUrls(urls,base.replace('S'.repeat(24),'T'.repeat(24))),/wrong_sheet/);
});
test('Token creation requests 32 random bytes and clears the source buffer',()=>{
 let source;const value=newToken({getRandomValues(bytes){assert.equal(bytes.length,32);source=bytes;bytes.forEach((_,i)=>bytes[i]=i+1);return bytes;}});
 assert.match(value,/^[a-f0-9]{64}$/);assert.equal(value.slice(0,8),'01020304');assert(source.every(v=>v===0));
 assert.notEqual(newToken(),newToken());assert.throws(()=>newToken({}),/random_unavailable/);
});
test('Google JSON merge preserves other devices and refuses implicit replacement',()=>{
 const other='esp32-000000000002',old={token:'cd'.repeat(32),meterId:'another-meter',label:'existing metadata'};
 const value=JSON.parse(deviceProperties(JSON.stringify({[other]:old}),board,token));
 assert.deepEqual(value[other],old);assert.deepEqual(value[board.bridgeId],{token,meterId:board.meterId});
 assert.throws(()=>deviceProperties(JSON.stringify({[board.bridgeId]:old}),board,token),/device_already_registered/);
 const replaced=JSON.parse(deviceProperties(JSON.stringify({[board.bridgeId]:old,[other]:old}),board,token,true));
 assert.equal(replaced[board.bridgeId].label,old.label);assert.equal(replaced[board.bridgeId].token,token);assert.deepEqual(replaced[other],old);
});
test('Malformed properties never expose pasted secrets in error text',()=>{
 for(const value of ['[1]','null','not-json',JSON.stringify({bad:{token,meterId:'x'}}),JSON.stringify({'esp32-000000000002':{token:'secret',meterId:'x'}}),' '.repeat(9001)])assert.throws(()=>deviceProperties(value,board,token),e=>e.message==='invalid_devices');
 assert.throws(()=>deviceProperties('',{...board,meterId:'../../bad'},token),/invalid_usb_reply/);
 assert.throws(()=>deviceProperties('',board,'a'.repeat(63)),/invalid_token/);
});
test('Sheet link ACK must preserve identity, settings, key, history and both targets',()=>{
 assert(linksPreserved(board,{...board,remembered:18,pending:1},urls));
 for(const change of [{sheetUserUrls:[urls[1],urls[0]]},{sheetUrl:urls[1]},{session:'b'.repeat(32)},{meterId:'changed'},{remembered:16},{hasPairingKey:false},{autoEnabled:false},{configured:false},{hasSavedToken:false}])assert(!linksPreserved(board,{...board,...change},urls));
 assert(preserved(board,board));assert(!preserved(board,{...board,sheetUrl:urls[1]}));assert(!preserved(board,{...board,sheetUserUrls:[urls[1],urls[0]]}));
});
test('USB reply validation rejects forged or malformed sheet capabilities',()=>{
 assert.equal(reply(board,'test','info'),board);
 for(const change of [{sheetUserLinksSupported:'yes'},{sheetUrl:base+'?gid=0'},{sheetUserUrls:[urls[0],urls[0]]},{sheetUserUrls:[urls[0],'javascript:alert(1)']},{sheetUserUrls:[urls[0],urls[1].replace('S'.repeat(24),'T'.repeat(24))]},{sheetLinkSupported:false}])assert.throws(()=>reply({...board,...change},'test','info'),/invalid_usb_reply/);
 assert.equal(reply({...board,sheetUrl:'',sheetUserUrls:['','']},'test','info').sheetUrl,'');
});
test('Setup never converts a saved key or an old successful test to fresh evidence',()=>{
 const p=new SetupProgress();p.observe(board);assert.equal(p.checklist(board,true)[4],'saved');assert.equal(p.checklist(board,true)[3],'pending');
 p.startTest();p.observe(board);assert.equal(p.test,'');
 p.observe({...board,result:'idle'});assert.equal(p.test,'');p.observe(board);assert.equal(p.test,p.identity);
 p.event({code:7});assert.equal(p.checklist(board,true)[4],'board');assert.equal(p.checklist(board,false)[3],'pending');
});
test('Changed board clears registrations, test evidence and cuff receipt',()=>{
 const p=new SetupProgress();p.observe(board);p.setSheet(base);p.sheetConfirmed=true;p.confirmRegistration(token,false);p.event({code:7});
 assert(p.canSave(token,false));assert(!p.canSave('ef'.repeat(32),false));assert(!p.canSave('',true));
 assert.equal(p.observe({...board,bridgeId:'esp32-000000000002'}),true);assert.equal(p.registration,'');assert.equal(p.sheet,'');assert(!p.received);assert(!p.sheetConfirmed);
});
test('Token edits and sheet changes invalidate Google confirmation and test results',()=>{
 const p=new SetupProgress();p.observe(board);p.setSheet(base);p.sheetConfirmed=true;p.confirmRegistration('',true);assert(p.canSave('',true));
 p.invalidateRegistration();assert(!p.canSave('',true));p.confirmRegistration(token,false);p.test='old';p.setSheet(base.replace('S'.repeat(24),'T'.repeat(24)));assert(!p.canSave(token,false));assert.equal(p.test,'');assert(!p.sheetConfirmed);
 p.test='old';p.settingsChanged();assert.equal(p.test,'');assert(!p.testPending);
});
test('Initial registration and auto target are explicitly different states',()=>{
 assert.equal(pairingStatus(null),'disconnected');assert.equal(pairingStatus({...board,hasPairingKey:false}),'needs_registration');assert.equal(pairingStatus({...board,autoEnabled:false}),'needs_auto_target');assert.equal(pairingStatus(board),'saved_registration');
 assert.match(sheetFormula(1),/TO_TEXT/);assert.match(sheetFormula(2),/="2"/);assert.throws(()=>sheetFormula(0),/invalid_user/);
});
test('Published receiver downloads equal the canonical source when it is present',async()=>{
 for(const [asset,original] of [['receiver-code.txt','Code.gs'],['receiver-manifest.json','appsscript.json']]){
  let source;try{source=await readFile(new URL('../../apps-script/'+original,import.meta.url),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  assert.equal(await readFile(new URL('../dist/'+asset,import.meta.url),'utf8'),source);
 }
});

// A small DOM harness drives the real guide handlers without USB access,
// browser permission changes, Google requests or live credentials.
test('Operator flow binds Google confirmation to the token and clears it for a different board',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 class Element{
  constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.dataset={};this.listeners={};this.attrs={};this.classList={toggle(){}};}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  prepend(node){node.parent=this;this.children.unshift(node);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,f){this.listeners[k]=f;}
  focus(){}scrollIntoView(){}
 }
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const nav=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{step:String(i+1)}}));
 const panels=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{panel:String(i+1)}}));
 const old=Object.fromEntries(['document','window','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let copied='',changes=0,session={board:null,connected:false,busy:false,dirty:false};
 const byId=id=>elements.get(id);
 const document={getElementById:byId,createElement:()=>new Element(),querySelectorAll:s=>s==='[data-step]'?nav:panels,querySelector:s=>nav[Number(s.match(/\d+/)[0])-1]};
 Object.defineProperties(globalThis,{document:{value:document,configurable:true},window:{value:{addEventListener(){}},configurable:true},navigator:{value:{clipboard:{writeText:async v=>{copied=v;}}},configurable:true}});
 try{
  const wizard=createWizard({getState:()=>session,tokenChanged:()=>{changes++;session.dirty=true;},test(){},refresh(){},notice(){}});
  byId('wizard-next').onclick();assert.match(byId('wizard-notice').textContent,/시트/);assert(byId('generate-token').disabled);
  byId('setup-sheet').value=base;byId('sheet-confirmed').checked=true;byId('sheet-confirmed').onchange();byId('wizard-next').onclick();
  byId('wizard-next').onclick();assert.match(byId('wizard-notice').textContent,/USB/);
  session.board={...board,configured:false,hasSavedToken:false,hasPairingKey:false,autoEnabled:false,sheetUrl:'',sheetUserUrls:['',''],remembered:0};session.connected=true;wizard.observe(session.board);
  byId('wizard-next').onclick();byId('generate-token').onclick();assert.equal(changes,1);assert.match(byId('token').value,/^[a-f0-9]{64}$/);
  byId('devices-reviewed').checked=true;byId('devices-reviewed').listeners.change();
  await byId('copy-devices').onclick();assert.equal(JSON.parse(copied)[board.bridgeId].meterId,board.meterId);assert.equal(wizard.maySave(),false);
  byId('registration-confirmed').checked=true;byId('registration-confirmed').onchange();assert(wizard.maySave());
  byId('token').value='ef'.repeat(32);byId('token').listeners.input();assert.equal(wizard.maySave(),false);assert.equal(byId('registration-confirmed').checked,false);
  session.board={...board,bridgeId:'esp32-000000000003'};wizard.observe(session.board);
  assert.equal(byId('token').value,'');assert.equal(byId('existing-devices').value,'');assert.equal(byId('sheet-confirmed').checked,false);assert.equal(wizard.maySave(),false);
  byId('mode-manage').onclick();assert.equal(byId('token-entry').parent,byId('manage-token-slot'));assert.equal(byId('links-card').parent,byId('manage-links-slot'));assert(wizard.maySave());
  byId('mode-wizard').onclick();assert.equal(byId('token-entry').parent,byId('wizard-token-slot'));assert.equal(wizard.maySave(),false);
 }finally{for(const [k,descriptor] of Object.entries(old))if(descriptor)Object.defineProperty(globalThis,k,descriptor);else delete globalThis[k];}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {googleRegistration,googleReceipt} from '../dist/google-setup.mjs';
import {receiverSource} from '../dist/receiver-source.mjs';
import {createWizard} from '../dist/wizard.mjs';
const id='S'.repeat(24),sheet='https://docs.google.com/spreadsheets/d/'+id+'/edit',urls=[sheet+'#gid=1',sheet+'#gid=2'];
const board={bridgeId:'esp32-000000000001',meterId:'hem-synthetic',hasSavedToken:false,hasPairingKey:false,autoEnabled:false,configured:false,queueReady:true,remembered:0,pending:0,sheetUserLinksSupported:true,sheetUserUrls:['',''],wifiStatus:3};
const token='ab'.repeat(32),setupId='cd'.repeat(16);
const receipt=(change={})=>JSON.stringify({schemaVersion:1,kind:'bp-to-sheets-google-setup',setupId,spreadsheetId:id,bridgeId:board.bridgeId,meterId:board.meterId,sheetUserUrls:urls,...change});
test('Google registration copies only one validated board and a fresh setup identifier',()=>{
 assert.deepEqual(JSON.parse(googleRegistration(board,token,setupId)),{schemaVersion:1,bridgeId:board.bridgeId,meterId:board.meterId,token,setupId});
 for(const args of [[board,'secret',setupId],[{...board,bridgeId:'foreign'},token,setupId],[board,token,'old']])assert.throws(()=>googleRegistration(...args));
});
test('Receipt binds exactly this board, managed ID, sheet and attempt; never takes a token',()=>{
 const context={board,setupId,sheet};assert.deepEqual(googleReceipt(receipt(),context),urls);
 for(const change of [{bridgeId:'esp32-000000000002'},{meterId:'other'},{setupId:'ef'.repeat(16)},{spreadsheetId:'T'.repeat(24)},{sheetUserUrls:[urls[0],urls[0]]},{sheetUserUrls:[urls[0],urls[1].replace(id,'T'.repeat(24))]},{token},{extra:'anything'}])assert.throws(()=>googleReceipt(receipt(change),context),e=>e.message==='invalid_setup_result'&&!e.message.includes(token));
 for(const text of ['invalid secret',receipt()+' '.repeat(2048),'null'])assert.throws(()=>googleReceipt(text,context),/invalid_setup_result/);
 assert.throws(()=>googleReceipt(receipt(),{...context,setupId:''}),/invalid_setup_result/);
});
test('Clipboard source equals downloadable generic receiver and canonical source when available',async()=>{
 assert.equal(receiverSource,await readFile(new URL('../dist/receiver-code.txt',import.meta.url),'utf8'));
 try{assert.equal(receiverSource,await readFile(new URL('../../apps-script/Code.gs',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 assert.match(receiverSource,/function configureReceiver\(/);assert.match(receiverSource,/function setupReceiver\(/);
});
test('Recommended wizard imports links as unsaved drafts and requires explicit Google confirmation; edits invalidate evidence',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 class Element{constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.dataset={};this.listeners={};this.attrs={};this.classList={toggle(){}};}append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}prepend(n){n.parent=this;this.children.unshift(n);}replaceChildren(...nodes){this.children=[];this.append(...nodes);}setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this.attrs[k];}addEventListener(k,f){this.listeners[k]=f;}focus(){}scrollIntoView(){}}
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()])),get=id=>elements.get(id);
 const nav=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{step:String(i+1)}})),panels=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{panel:String(i+1)}}));
 const old=Object.fromEntries(['document','window','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let copied='',session={board,connected:true,busy:false,dirty:false};
 Object.defineProperties(globalThis,{document:{configurable:true,value:{getElementById:get,createElement:()=>new Element(),querySelectorAll:s=>s==='[data-step]'?nav:panels,querySelector:s=>nav[Number(s.match(/\d+/)[0])-1]}},window:{configurable:true,value:{addEventListener(){}}},navigator:{configurable:true,value:{clipboard:{writeText:async v=>{copied=v;}}}}});
 try{
 const wizard=createWizard({getState:()=>session,tokenChanged:()=>{},test(){},refresh(){},notice(){}});wizard.observe(board);
 get('setup-sheet').value=sheet;get('sheet-confirmed').checked=true;get('sheet-confirmed').onchange();get('generate-token').onclick();
 await get('copy-google-registration').onclick();const card=JSON.parse(copied);assert.equal(card.bridgeId,board.bridgeId);assert(!get('google-result').disabled);assert(!wizard.maySave());
 get('google-result').value=receipt({setupId:card.setupId});get('apply-google-result').onclick();assert.equal(get('sheet-user-1').value,urls[0]);assert.equal(get('sheet-user-2').value,urls[1]);assert(!wizard.maySave());assert(!get('registration-confirmed').disabled);assert.equal(get('progress-6').textContent,'확인 전');
 get('registration-confirmed').checked=true;get('registration-confirmed').onchange();assert(wizard.maySave());assert.equal(get('progress-3').textContent,'직접 확인');assert.equal(get('progress-4').textContent,'확인 전');
 get('setup-sheet').value=sheet.replace(id,'T'.repeat(24));get('setup-sheet').listeners.input();assert(!wizard.maySave());assert(get('registration-confirmed').disabled);assert(get('google-result').disabled);
 session.board={...board,bridgeId:'esp32-000000000002'};wizard.observe(session.board);assert.equal(get('token').value,'');assert.equal(get('google-result').value,'');
 }finally{for(const [k,d] of Object.entries(old))if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];}
});

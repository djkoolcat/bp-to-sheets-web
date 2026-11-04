import test from 'node:test';
import assert from 'node:assert/strict';
import {setupAction,validateSetup,running,createOmronSetup} from '../dist/omron-setup.mjs';
const address='00:11:22:33:44:55';
const board={chip:'esp32s3',bridgeId:'esp32-000000000001',session:'ab'.repeat(16),meterModel:'omron-hem7155t',omronSetupSupported:true,queueReady:true,remembered:0,hasPairingKey:false,autoEnabled:false,omronSetup:{phase:'scanned',error:'',scan:4,candidates:[{address,name:'Synthetic cuff',rssi:-45}]}};
test('Registration requires explicit consent and a candidate from this scan; keys are never sent',()=>{
 assert.throws(()=>setupAction(board,'register',address),/confirmation_required/);
 const action=setupAction(board,'register',address,true);assert.deepEqual(action,{action:'register',address,scan:4,confirm:'CONFIRM-PAIRING-KEY-CHANGE'});assert(!('key'in action));
 assert.throws(()=>setupAction(board,'register','00:11:22:33:44:66',true),/stale_selection/);
 assert.throws(()=>setupAction({...board,omronSetup:{...board.omronSetup,phase:'idle',candidates:[]}},'register',address,true),/stale_selection/);
});
test('Existing automatic targets and retained history cannot be re-enrolled or reassigned',()=>{
 for(const action of ['scan','register','receive'])assert.throws(()=>setupAction({...board,autoEnabled:true},action,address,true),/already_automatic/);
 for(const action of ['register','receive'])assert.throws(()=>setupAction({...board,remembered:1,hasPairingKey:true},action,address,true),/existing_records/);
 assert.throws(()=>setupAction(board,'receive',address),/missing_key/);
 assert.deepEqual(setupAction({...board,hasPairingKey:true},'receive',address),{action:'receive',address,scan:4});
});
test('Forged capabilities and discovery data fail before a USB write',()=>{
 validateSetup(board);validateSetup({});
 for(const b of [{...board,chip:'esp32c3'},{...board,meterModel:'microlife-b4bt'},{...board,omronSetup:{...board.omronSetup,phase:'erase'}},{...board,omronSetup:{...board.omronSetup,error:'private token'}},{...board,omronSetup:{...board.omronSetup,candidates:Array(9).fill(board.omronSetup.candidates[0])}},{...board,omronSetup:{...board.omronSetup,candidates:[{address,name:'x',rssi:10}]}}])assert.throws(()=>validateSetup(b),/invalid_usb_reply/);
});
test('Busy jobs cannot restart or replay registration; restart is separate from enrollment',()=>{
 assert(running('registering'));assert(!running('complete'));
 assert.throws(()=>setupAction({...board,omronSetup:{phase:'registering',error:'',scan:4,candidates:[]}},'register',address,true),/busy/);
 assert.throws(()=>setupAction(board,'restart'),/not_ready/);
 assert.deepEqual(setupAction({...board,omronSetup:{phase:'failed',error:'omron_enrollment_unconfirmed',scan:4,candidates:[]}},'restart'),{action:'restart'});
});
test('UI clears consent and candidate selection when the board session or scan changes',()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,children:[],addEventListener(){},replaceChildren(){this.children=[];},append(n){this.children.push(n);}});return nodes.get(id);};
 const previous=globalThis.document;globalThis.document={getElementById:node,createElement:()=>({}),activeElement:null};let state={board,connected:true,busy:false,dirty:false},calls=[];
 try{
 const ui=createOmronSetup({getState:()=>state,run:(...args)=>calls.push(args)});ui.render();assert(node('omron-register').disabled);
 node('omron-confirm').checked=true;state={...state,board:{...board,session:'cd'.repeat(16)}};ui.render();assert(!node('omron-confirm').checked);assert(node('omron-register').disabled);
 state={...state,board:{...board,autoEnabled:true,hasPairingKey:true}};ui.render();assert(node('omron-scan').disabled);assert(node('omron-register').disabled);assert.match(node('omron-progress').textContent,/재등록 없이/);assert.equal(calls.length,0);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

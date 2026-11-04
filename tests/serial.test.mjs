import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SerialClient,reply,settings,event,preserved} from '../dist/serial.mjs';
const base={schemaVersion:1,product:'bp-to-sheets-hem7155t',chip:'esp32s3',boardId:'waveshare-s3-lcd154',appPartitionSize:0x600000,flashSize:0x1000000,firmwareVersion:'hem-0.6.3',bridgeId:'esp32-000000000001',meterId:'hem-synthetic',session:'a'.repeat(32),queueReady:true,hasPairingKey:true,autoEnabled:true,configured:true,hasSavedPassword:true,hasSavedToken:true,clockReady:true,sending:false,pending:1,remembered:15,wifiStatus:3,wifiSsid:'테스트망',receiverUrl:'https://script.google.com/macros/s/synthetic/exec',error:'',ok:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Port{
 constructor({drop='',mutate=d=>d}={}){this.drop=drop;this.mutate=mutate;this.received=[];this.opened=false;this.text='';}
 async open(){this.opened=true;this.readable=new ReadableStream({start:c=>{this.incoming=c;}});this.writable=new WritableStream({write:bytes=>{this.text+=new TextDecoder().decode(bytes);let at;while((at=this.text.indexOf('\n'))>=0){const line=this.text.slice(0,at);this.text=this.text.slice(at+1);const p=JSON.parse(line.slice(6));this.received.push(p);if(p.operation===this.drop)continue;this.emit('RECORD private-clinical-diagnostic\nBPUSB_REPLY '+JSON.stringify({...base,requestId:'unsolicited',operation:p.operation})+'\n');this.emit('BPUSB_REPLY '+JSON.stringify(this.mutate({...base,requestId:p.requestId,operation:p.operation}))+'\n');}}});}
 emit(text){const bytes=new TextEncoder().encode(text);for(let at=0;at<bytes.length;at+=7)this.incoming.enqueue(bytes.slice(at,at+7));}
 async setSignals(v){this.signals=v;}
 async close(){this.opened=false;}
}
test('Unsupported hardware and malformed identities never pass the handshake',()=>{
 const d={...base,requestId:'id',operation:'info'};assert.equal(reply(d,'id','info'),d);
 for(const change of [{chip:'esp32c6'},{boardId:'generic'},{appPartitionSize:0x300000},{requestId:'other'},{session:'bad'},{pending:16},{meterId:'../../private'},{hasSavedToken:'yes'}])assert.throws(()=>reply({...d,...change},'id','info'));
});
test('Saved credentials stay blank; invalid endpoint, token and UTF-8 size fail before a write',()=>{
 const d=settings({ssid:'',password:'',endpoint:'',token:''},base);assert(d.keepPassword&&d.keepToken);assert.equal(d.password,'');assert.equal(d.token,'');
 for(const v of [{ssid:'가'.repeat(11)},{password:'short'},{token:'UPPERCASE'},{endpoint:'https://script.google.com.evil.invalid/macros/s/x/exec'},{endpoint:'https://script.google.com/macros/s/x/exec?token=secret'}])assert.throws(()=>settings(v,base));
});
test('Real stream framing keeps split Korean UTF-8 intact and ignores raw/unsolicited frames',async()=>{
 const p=new Port(),events=[],c=new SerialClient({onEvent:e=>events.push(e)});
 try{const d=await c.open(p);assert.equal(d.wifiSsid,'테스트망');assert.deepEqual(p.signals,{dataTerminalReady:true,requestToSend:false});assert.equal(events.length,0);const [a,b]=await Promise.all([c.request('info'),c.request('info')]);assert.equal(a.remembered,15);assert.equal(b.pending,1);assert.equal(p.received.length,3);}finally{await c.close();}assert(!p.opened);
});
test('Unknown device is closed without a configuration write',async()=>{
 const p=new Port({mutate:d=>({...d,chip:'esp32c6'})}),c=new SerialClient();await assert.rejects(c.open(p),/unsupported_board/);assert(!p.opened);assert.equal(p.received.length,1);
});
test('Configuration acknowledgement loss times out without a blind write retry',async()=>{
 const p=new Port({drop:'configure'}),c=new SerialClient();try{const d=await c.open(p);await assert.rejects(c.request('configure',d,{ssid:'synthetic'},150),/usb_timeout/);assert.equal(p.received.filter(x=>x.operation==='configure').length,1);}finally{await c.close();}
});
test('Closing a disconnected session rejects the pending request and releases the port',async()=>{
 const p=new Port({drop:'test'}),c=new SerialClient();const d=await c.open(p);const pending=c.request('test',d);await sleep(40);const closing=c.close();await assert.rejects(pending,/usb_disconnected/);await closing;assert(!p.opened);
});
test('Only the update hold is allowed; erase, arbitrary flash and fault commands stay unavailable',async()=>{
 const p=new Port(),c=new SerialClient();try{const d=await c.open(p);for(const op of ['erase','flash','resume','ack-loss-test','wifi-test-offline','register-key'])await assert.rejects(c.request(op),/invalid_operation/);await c.request('hold',d);assert.equal(p.received.length,2);assert.equal(p.received[1].operation,'hold');}finally{await c.close();}
});
test('Logs contain only bounded operation metadata and preservation retains identity/history',()=>{
 const e=event({seq:1,boot:1,uptimeMs:100,epoch:0,code:9,a:1,b:15,token:'synthetic-secret',systolic:123});assert(e);assert(!('token'in e));assert(!('systolic'in e));assert.equal(event({...e,code:99}),null);assert(preserved(base,{...base,remembered:16}));assert(!preserved(base,{...base,hasPairingKey:false}));assert(!preserved(base,{...base,meterId:'different'}));
});

test('Previously granted ports reconnect after a dropped read and reject a different board',async()=>{
 const {Connection}=await import('../dist/serial.mjs');const p=new Port(),client=new SerialClient(),connection=new Connection(client,{getPorts:async()=>[p]});
 try{await connection.attach(p);p.drop='logs';const pending=connection.read('logs',{after:0,limit:8},60);setTimeout(()=>p.drop='',30);await pending;assert.equal(connection.recoveries,1);
  p.drop='info';const bad=connection.read('info',{},60);setTimeout(()=>{p.drop='';p.mutate=d=>({...d,bridgeId:'esp32-000000000002'});},30);await assert.rejects(bad,/board_changed/);assert(!connection.enabled);assert(!p.opened);
 }finally{await connection.close();}
});
test('Reconnect cannot request a new grant, replay a write, or reopen after explicit disconnect',async()=>{
 const {Connection}=await import('../dist/serial.mjs');const p=new Port(),client=new SerialClient(),connection=new Connection(client,{getPorts:async()=>[]});
 try{await connection.attach(p);await assert.rejects(connection.read('configure'),/invalid_operation/);p.drop='info';await assert.rejects(connection.read('info',{},60),/port_missing/);assert.equal(p.received.filter(r=>r.operation==='configure').length,0);
  await connection.close();await assert.rejects(connection.read('info',{},60),/usb_disconnected/);assert(!p.opened);
 }finally{await connection.close();}
});

test('Sheet link acknowledgement loss is never replayed as another write',async()=>{
 const p=new Port({drop:'sheet-link'}),client=new SerialClient();
 try{const d=await client.open(p);await assert.rejects(client.request('sheet-link',d,{sheetUrl:'synthetic'},100),/usb_timeout/);assert.equal(p.received.filter(v=>v.operation==='sheet-link').length,1);await client.request('info');assert.equal(p.received.filter(v=>v.operation==='sheet-link').length,1);}
 finally{await client.close();}
});

test('Microlife capability is S3-only; bounded discovery and volume fields reject forged replies',()=>{
 const d={...base,requestId:'id',operation:'info',product:'bp-to-sheets-microlife-b4bt',meterModel:'microlife-b4bt',meterModelSwitchSupported:true,pairingRequired:false,targetAddress:'',meterCandidates:[],audioSupported:true,audioReady:true,audioVolume:25};
 assert.equal(reply(d,'id','info'),d);
 for(const changes of [{chip:'esp32c3'},{meterModel:'omron-hem7155t'},{pairingRequired:true},{audioVolume:100},{targetAddress:'bad'},{meterCandidates:Array(9).fill({})}])assert.throws(()=>reply({...d,...changes},'id','info'));
});

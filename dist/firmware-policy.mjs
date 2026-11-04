const fail=code=>{throw Error(code);};
export const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export function compareVersion(a,b){
 const parts=v=>{const m=/^hem-(\d+)\.(\d+)\.(\d+)$/.exec(v);if(!m)fail('firmware_manifest');return m.slice(1).map(Number);};
 const x=parts(a),y=parts(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;
}
export function compatible(board,r){
 return !!board&&r.schemaVersion===1&&board.chip==='esp32s3'&&board.boardId===r.boardId&&board.appPartitionSize===r.partitionSize&&board.flashSize===r.flashSize&&r.chip==='esp32s3'&&r.address===0x10000&&r.partitionSize===0x600000&&r.flashSize===0x1000000&&r.imageChip===9;
}
export async function verifyImage(bytes,r,digest=(data)=>crypto.subtle.digest('SHA-256',data)){
 if(!(bytes instanceof Uint8Array)||bytes.length!==r.bytes||bytes.length<24||bytes.length%4||bytes.length>r.partitionSize||bytes[0]!==0xe9||new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(12,true)!==r.imageChip)fail('firmware_image');
 if(!/^[a-f0-9]{64}$/.test(r.sha256)||hex(new Uint8Array(await digest(bytes)))!==r.sha256)fail('firmware_hash');
 return bytes;
}
export function bridgeFromMac(mac){if(!/^[a-f0-9]{2}(:[a-f0-9]{2}){5}$/i.test(mac))fail('board_changed');return 'esp32-'+mac.toLowerCase().split(':').reverse().join('');}
export function verifyPartitions(table,md5){
 if(!(table instanceof Uint8Array)||table.length!==0xc00)fail('partition_layout');
 const d=new DataView(table.buffer,table.byteOffset,table.byteLength),regions=[];let checked=false;
 const expected=[{start:0x9000,size:0x6000,type:1,sub:2,label:'nvs'},{start:0xf000,size:0x1000,type:1,sub:1,label:'phy_init'},{start:0x10000,size:0x600000,type:0,sub:0,label:'factory'},{start:0x610000,size:0x10000,type:1,sub:0x40,label:'hem-log'}];
 for(let off=0;off+32<=table.length;off+=32){
  const magic=d.getUint16(off,true);if(magic===0xffff)break;
  if(magic===0xebeb){if(hex(md5(table.subarray(0,off)))!==hex(table.subarray(off+16,off+32)))fail('partition_checksum');checked=true;break;}
  if(magic!==0x50aa)fail('partition_layout');
  const type=table[off+2],sub=table[off+3],start=d.getUint32(off+4,true),size=d.getUint32(off+8,true),label=new TextDecoder().decode(table.subarray(off+12,off+28)).split('\0')[0];
  if(!size||d.getUint32(off+28,true)!==0||regions.some(r=>start<r.end&&start+size>r.start))fail('partition_layout');
  if(!expected.some(r=>r.start===start&&r.size===size&&r.type===type&&r.sub===sub&&r.label===label))fail('partition_layout');
  regions.push({start,end:start+size});
 }
 if(!checked||regions.length!==4)fail('partition_layout');return true;
}
export function verifySettings(before,after,r){
 if(!compatible(after,r)||!after.queueReady||after.firmwareVersion!==r.version||after.remembered<before.remembered)fail('preservation_failed');
 for(const key of ['bridgeId','meterId','meterModel','targetAddress','hasPairingKey','autoEnabled','configured','hasSavedPassword','hasSavedToken','wifiSsid','receiverUrl'])if(before[key]!==undefined&&before[key]!==after[key])fail('preservation_failed');
 if(before.sheetLinkSupported&&before.sheetUrl!==after.sheetUrl)fail('preservation_failed');
 if(before.sheetUserLinksSupported&&JSON.stringify(before.sheetUserUrls)!==JSON.stringify(after.sheetUserUrls))fail('preservation_failed');
}
export function verifyRecords(before,after){
 const seen=new Map(after.rows.map(r=>[r.recordId,r]));if(seen.size!==after.rows.length)fail('preservation_failed');
 for(const r of before.rows){const other=seen.get(r.recordId);if(!other)fail('preservation_failed');
  for(const key of Object.keys(r))if(key==='acknowledged'){if(r[key]&&!other[key])fail('preservation_failed');}else if(r[key]!==other[key])fail('preservation_failed');
 }
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {collectRecords,csvBytes,xlsxBytes,fileName} from '../dist/record-export.mjs';
// All rows below are synthetic protocol fixtures, not personal measurements.
const meterId='synthetic-meter',snapshot='c'.repeat(64);
const row=(n,user=1)=>({recordId:`hem1:${meterId}:${user}:${n.toString(16).padStart(64,'0')}`,measuredAt:'2026-01-02T03:04+09:00',systolic:120,diastolic:80,pulse:70,userSlot:user,flags:0,acknowledged:n%2===0});
function source(rows,mutate=d=>d){
 const base={bridgeId:'esp32-000000000001',meterId,chip:'esp32s3',boardId:'waveshare-s3-lcd154',session:'a'.repeat(32),firmwareVersion:'hem-0.7.0',recordsExportVersion:1,recordCapacity:128,queueReady:true,remembered:rows.length,pending:rows.filter(r=>!r.acknowledged).length};
 const requests=[];
 return {base,requests,info:async()=>({...base}),page:async(fields,before)=>{
  assert.equal(before.session,base.session);requests.push({...fields});const records=rows.slice(fields.offset,fields.offset+fields.limit);
  return mutate({...base,exportSnapshot:snapshot,exportOffset:fields.offset,exportTotal:rows.length,exportNext:fields.offset+records.length,records},requests.length);
 }};
}
test('Pages collect both users, verify a final snapshot and filter without changing source data',async()=>{
 const rows=Array.from({length:9},(_,n)=>row(n,n%2+1)),before=structuredClone(rows),s=source(rows),progress=[];
 const data=await collectRecords({...s,user:2,progress:(n,total)=>progress.push([n,total])});
 assert.equal(data.rows.length,4);assert(data.rows.every(r=>r.userSlot===2));assert.equal(data.total,9);
 assert.deepEqual(s.requests.map(r=>r.offset),[0,4,8,9]);assert(s.requests.every(r=>r.limit===4));
 assert.equal(s.requests[0].snapshot,'');assert(s.requests.slice(1).every(r=>r.snapshot===snapshot));
 assert.deepEqual(progress,[[4,9],[8,9],[9,9]]);assert.deepEqual(rows,before);
});
test('Partial reads, ACK changes, reboot and duplicate IDs cannot produce a completed export',async()=>{
 const rows=Array.from({length:6},(_,n)=>row(n,n%2+1));
 for(const mutate of [
  (d,n)=>n===2?{...d,exportSnapshot:'d'.repeat(64)}:d,
  (d,n)=>n===3?{...d,exportSnapshot:'d'.repeat(64)}:d,
  (d,n)=>n===2?{...d,session:'b'.repeat(32)}:d,
  (d,n)=>n===2?{...d,meterId:'other-meter'}:d,
  d=>({...d,exportNext:99}),
  d=>({...d,records:d.records.slice(1)}),
  d=>({...d,pending:0})
 ])await assert.rejects(collectRecords(source(rows,mutate)),/snapshot_changed|export_session_changed|invalid_export_reply/);
 await assert.rejects(collectRecords(source([row(0),row(0)])),/invalid_export_reply/);
 const disconnected=source(rows);disconnected.page=async()=>{throw Error('usb_disconnected');};await assert.rejects(collectRecords(disconnected),/usb_disconnected/);
});
test('Unsupported firmware and invalid records stop before saving; empty and full capacity are valid',async()=>{
 const old=source([]);old.base.recordsExportVersion=undefined;await assert.rejects(collectRecords(old),/export_update_required/);assert.equal(old.requests.length,0);
 for(const changed of [{measuredAt:'2026-02-30T03:04+09:00'},{measuredAt:'2026-01-02T03:04:99+09:00'},{measuredAt:'2026-01-02T03:04Z'},{userSlot:3},{recordId:'=formula'},{systolic:80},{pulse:0},{flags:4},{acknowledged:'yes'}])await assert.rejects(collectRecords(source([{...row(0),...changed}])),/invalid_export_reply/);
 const empty=await collectRecords(source([]));assert.equal(empty.rows.length,0);
 const full=await collectRecords(source(Array.from({length:128},(_,n)=>row(n,n%2+1))));assert.equal(full.rows.length,128);
 const csv=new TextDecoder().decode(csvBytes(full));assert.equal(csv.trim().split('\r\n').length,129);
});
test('CSV preserves Korean, IDs, known time precision and empty receipt times, without secrets',async()=>{
 const raw={...row(1),password:'must-not-export',token:'must-not-export',raw:'must-not-export'},data=await collectRecords(source([raw]));
 const bytes=csvBytes(data);assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);
 const text=new TextDecoder().decode(bytes);assert(text.startsWith('"측정 일시","수축기"'));assert(text.includes('"2026-01-02T03:04+09:00",120,80,70'));
 assert(text.includes('1,"","hem1:synthetic-meter:1:'));assert(text.includes('"전송 대기",0\r\n'));
 assert(!text.includes('must-not-export'));assert.equal(data.rows[0].raw,undefined);
 assert.throws(()=>csvBytes({...data,rows:[]}));
});
test('Excel is a valid CRC-checked OPC package with typed dates/numbers, user tabs and no formulas or external links',async()=>{
 const data=await collectRecords(source([row(0),{...row(1,2),measuredAt:'2026-01-02T03:04:05+09:00'}]));
 const bytes=xlsxBytes(data);assert.deepEqual([...bytes.slice(0,4)],[80,75,3,4]);
 const verify=String.raw`
import io,sys,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None
n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
w=E.fromstring(z.read('xl/workbook.xml'));assert [s.attrib['name'] for s in w.find('s:sheets',n)]==['사용자 1','사용자 2','전체 기록','내보내기 안내']
for name in z.namelist():
 root=E.fromstring(z.read(name))
 assert not root.findall('.//s:f',n)
 assert b'TargetMode="External"' not in z.read(name)
root=E.fromstring(z.read('xl/worksheets/sheet3.xml'));rows=root.findall('s:sheetData/s:row',n);assert len(rows)==3
cells={c.attrib['r']:c for r in rows for c in r}
assert cells['B2'].find('s:v',n).text=='120' and cells['B2'].attrib.get('t') is None
assert cells['A2'].attrib['s']=='2' and cells['A3'].attrib['s']=='3'
assert abs(float(cells['A2'].find('s:v',n).text)-46024.12777777778)<0.00000001
assert cells['G2'].find('s:is',n) is None and cells['G2'].find('s:v',n) is None
assert root.find('s:sheetViews/s:sheetView/s:pane',n).attrib['state']=='frozen'
assert root.find('s:autoFilter',n).attrib['ref']=='A1:J3'
print('XLSX CRC, XML, dates, numbers, tab rows and no external links: PASS')
`;
 const p=spawnSync('python3',['-c',verify],{input:bytes,encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert(p.stdout.includes('PASS'));
 const single=await collectRecords({...source([row(0),row(1,2)]),user:2});assert.equal(single.rows.length,1);assert(xlsxBytes(single).length>0);
});
test('File names contain only a scope and export date; extension and user are validated',()=>{
 const now=new Date(2026,0,2,3,4);assert.equal(fileName('xlsx',2,now),'bp-records-user2-20260102.xlsx');
 assert.equal(fileName('csv',0,now),'bp-records-all-20260102.csv');
 assert.throws(()=>fileName('html',0,now));assert.throws(()=>fileName('csv','../private',now));
});

// Browser/desktop shared, local-only export. No storage, network or diagnostics.
const encode=text=>new TextEncoder().encode(text);
const fail=code=>{throw Error(code);};
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const identity=d=>[d.bridgeId,d.meterId,d.chip,d.boardId,d.session].join('|');
export const columns=['측정 일시','수축기','이완기','맥박','혈압계 식별자','사용자 슬롯','수신 일시','recordId','보드 전송 상태','flags'];

function calendar(value){
 const m=typeof value==='string'&&value.match(/^((?:20\d{2}|2100))-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?\+09:00$/);
 if(!m)fail('invalid_export_reply');
 const [year,month,day,hour,minute,second]=m.slice(1).map(v=>v===undefined?0:Number(v));
 const date=new Date(Date.UTC(year,month-1,day,hour,minute,second));
 if(year>2100||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||hour>23||minute>59||second>59)fail('invalid_export_reply');
 return {serial:date.getTime()/86400000+25569,seconds:m[6]!==undefined};
}
function checkedRow(r,meterId){
 if(!r||!integer(r.userSlot,1,2)||typeof r.recordId!=='string'||
  typeof r.acknowledged!=='boolean')fail('invalid_export_reply');
 const micro=r.recordId.startsWith('b4v2:');
 if(micro){
  calendar(r.measuredAt);
  const stamp=r.measuredAt.slice(0,16).replace(/[-T:]/g,'');
  if(r.recordId!==`b4v2:${meterId}:${r.userSlot}:${stamp}:${r.systolic}:${r.diastolic}:${r.pulse}`||
   !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}\+09:00$/.test(r.measuredAt)||
   !integer(r.systolic,60,255)||!integer(r.diastolic,40,200)||!integer(r.pulse,20,250)||!integer(r.flags,0,65535))fail('invalid_export_reply');
 }else if(!new RegExp('^hem1:'+meterId+':'+r.userSlot+':[a-f0-9]{64}$').test(r.recordId)||
  Number(r.measuredAt?.slice(0,4))>2063||!integer(r.systolic,25,250)||!integer(r.diastolic,1,249)||!integer(r.pulse,1,255)||!integer(r.flags,0,3))fail('invalid_export_reply');
 if(r.systolic<=r.diastolic)fail('invalid_export_reply');
 calendar(r.measuredAt);
 const out={};for(const k of ['recordId','measuredAt','systolic','diastolic','pulse','userSlot','flags','acknowledged'])out[k]=r[k];return out;
}
function checked(data){
 if(!data||!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(data.meterId)||!integer(data.user,0,2)||
  !integer(data.total,0,128)||!integer(data.pending,0,data.total)||!Array.isArray(data.rows)||data.rows.length>data.total||(!data.user&&data.rows.length!==data.total))fail('invalid_export_reply');
 const seen=new Set(),rows=data.rows.map(r=>checkedRow(r,data.meterId));
 for(const r of rows){if(seen.has(r.recordId)||(data.user&&r.userSlot!==data.user))fail('invalid_export_reply');seen.add(r.recordId);}
 return {...data,rows};
}

export async function collectRecords({info,page,user=0,progress=()=>{}}){
 if(!integer(user,0,2))fail('invalid_export_request');
 const before=await info();
 if(before.recordsExportVersion!==1||before.recordCapacity!==128)fail('export_update_required');
 if(!before.queueReady)fail('queue_not_ready');
 if(!integer(before.remembered,0,128)||!integer(before.pending,0,before.remembered)||
  !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(before.meterId))fail('invalid_export_reply');
 const rows=[],seen=new Set();let offset=0,snapshot='';
 const fetchPage=async()=>{
  const d=await page({offset,limit:4,snapshot},before);
  if(identity(d)!==identity(before))fail('export_session_changed');
  if(!/^[a-f0-9]{64}$/.test(d.exportSnapshot)||snapshot&&d.exportSnapshot!==snapshot)fail('snapshot_changed');
  if(d.exportTotal!==before.remembered||d.exportOffset!==offset||d.pending!==before.pending||
   !Array.isArray(d.records)||d.records.length!==Math.min(4,before.remembered-offset)||
   d.exportNext!==offset+d.records.length)fail('invalid_export_reply');
  snapshot=d.exportSnapshot;return d;
 };
 do{
  const d=await fetchPage();
  for(const raw of d.records){const r=checkedRow(raw,before.meterId);if(seen.has(r.recordId))fail('invalid_export_reply');seen.add(r.recordId);rows.push(r);}
  offset=d.exportNext;progress(offset,before.remembered);
 }while(offset<before.remembered);
 // Recheck the same snapshot after the final data page, including ACK changes.
 const end=await page({offset,limit:4,snapshot},before);
 if(identity(end)!==identity(before))fail('export_session_changed');
 if(end.exportSnapshot!==snapshot)fail('snapshot_changed');
 if(end.exportTotal!==offset||end.exportOffset!==offset||end.exportNext!==offset||
  end.pending!==before.pending||!Array.isArray(end.records)||end.records.length)fail('invalid_export_reply');
 if(rows.filter(r=>!r.acknowledged).length!==before.pending)fail('invalid_export_reply');
 rows.sort((a,b)=>Date.parse(a.measuredAt)-Date.parse(b.measuredAt)||a.userSlot-b.userSlot||a.recordId.localeCompare(b.recordId));
 return checked({meterId:before.meterId,user,total:rows.length,pending:before.pending,
  firmware:before.firmwareVersion,rows:rows.filter(r=>!user||r.userSlot===user)});
}

function values(row,meterId){return [row.measuredAt,row.systolic,row.diastolic,row.pulse,meterId,row.userSlot,'',row.recordId,row.acknowledged?'시트 저장 확인':'전송 대기',row.flags];}
function csvCell(value){
 if(typeof value==='number')return String(value);
 let text=String(value);if(/^[\s\uFEFF]*[=+@-]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
}
export function csvBytes(input){
 const data=checked(input),table=[columns,...data.rows.map(r=>values(r,data.meterId))];
 return encode('\uFEFF'+table.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n');
}

const xml=text=>String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const namespace='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function cell(reference,value,style=0){
 if(value==='')return `<c r="${reference}" s="${style}"/>`;
 return typeof value==='number'?`<c r="${reference}" s="${style}"><v>${value}</v></c>`:`<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function worksheet(rows,meterId){
 const widths=[25,12,12,12,36,14,25,102,20,10];
 let body='<row r="1" ht="28" customHeight="1">'+columns.map((v,i)=>cell(String.fromCharCode(65+i)+'1',v,1)).join('')+'</row>';
 for(let n=0;n<rows.length;n++){
  const vals=values(rows[n],meterId),date=calendar(rows[n].measuredAt);vals[0]=date.serial;
  body+=`<row r="${n+2}" ht="24" customHeight="1">`+vals.map((v,i)=>cell(String.fromCharCode(65+i)+(n+2),v,i===0?(date.seconds?3:2):0)).join('')+'</row>';
 }
 return declaration+`<worksheet xmlns="${namespace}"><dimension ref="A1:J${rows.length+1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>`+widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')+`</cols><sheetData>${body}</sheetData><autoFilter ref="A1:J${rows.length+1}"/></worksheet>`;
}
function notes(data){
 const rows=[['항목','안내'],['파일 범위',`보드 보관 ${data.total}건 중 ${data.user?'사용자 '+data.user:'두 사용자 전체'} ${data.rows.length}건`],
 ['보관 한도','최근 최대 128건의 보드 보관분입니다. 혈압계·Google 시트의 전체 이력과 다를 수 있습니다.'],
 ['측정 일시','혈압계 원본 값을 기존 펌웨어의 +09:00 기준으로 표시합니다. 초를 모르면 분까지만 표시합니다.'],
 ['수신 일시','보드에 별도로 저장되지 않아 빈칸입니다. 파일 생성 시각으로 채우지 않습니다.'],
 ['보드 전송 상태','시트 저장 확인: 서버 확인을 보드에 보존함. 전송 대기: 서버에 이미 있을 수도 있으며 보드가 확인을 기다리는 상태.'],
 ['flags','오므론: bit 0 움직임, bit 1 불규칙 맥파. Microlife: 원본 16비트 값이며 비트 의미를 추정하지 않습니다.'],
 ['데이터 보존','읽기 전용 내보내기입니다. 기록·설정·전송 대기 상태와 혈압계 시간/카운터를 바꾸지 않습니다.'],
 ['포함하지 않는 정보','Wi-Fi 비밀번호, 기기 토큰, 혈압계 인증 키, 수신 URL, 원시 통신 데이터'],
 ['펌웨어',data.firmware||'']];
 return declaration+`<worksheet xmlns="${namespace}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="25" customWidth="1"/><col min="2" max="2" width="125" customWidth="1"/></cols><sheetData>`+rows.map((row,n)=>`<row r="${n+1}" ht="30" customHeight="1">`+row.map((v,i)=>cell(String.fromCharCode(65+i)+(n+1),v,n?4:1)).join('')+'</row>').join('')+'</sheetData></worksheet>';
}
const styles=declaration+`<styleSheet xmlns="${namespace}"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts><fonts count="2"><font><sz val="12"/><color rgb="FF183C3B"/><name val="맑은 고딕"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF146B5C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// Small uncompressed OPC ZIP; avoids remote scripts and third-party runtimes.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zip(files){
 const local=[],central=[];let offset=0;
 for(const [name,text] of files){
  const path=encode(name),body=encode(text),crc=crc32(body),header=new Uint8Array(30+path.length),h=new DataView(header.buffer);
  h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,body.length,true);h.setUint32(22,body.length,true);h.setUint16(26,path.length,true);header.set(path,30);
  const directory=new Uint8Array(46+path.length),c=new DataView(directory.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);directory.set(path,46);
  local.push(header,body);central.push(directory);offset+=header.length+body.length;
 }
 const size=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
 const out=new Uint8Array(offset+size+22);let at=0;for(const part of [...local,...central,end]){out.set(part,at);at+=part.length;}return out;
}
export function xlsxBytes(input){
 const data=checked(input),sheets=data.user?[{name:'사용자 '+data.user,rows:data.rows}]:[1,2].map(user=>({name:'사용자 '+user,rows:data.rows.filter(r=>r.userSlot===user)})).concat({name:'전체 기록',rows:data.rows});
 const entries=sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,worksheet(s.rows,data.meterId)]);sheets.push({name:'내보내기 안내'});entries.push([`xl/worksheets/sheet${sheets.length}.xml`,notes(data)]);
 const rel='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 entries.push(['[Content_Types].xml',declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>']);
 entries.push(['_rels/.rels',declaration+`<Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
 entries.push(['xl/workbook.xml',declaration+`<workbook xmlns="${namespace}" xmlns:r="${office}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>`+sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>']);
 entries.push(['xl/_rels/workbook.xml.rels',declaration+`<Relationships xmlns="${rel}">`+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${office}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId99" Type="${office}/styles" Target="styles.xml"/></Relationships>`]);
 entries.push(['xl/styles.xml',styles]);return zip(entries);
}
export function fileName(format,user=0,now=new Date()){
 if(!['csv','xlsx'].includes(format)||!integer(user,0,2)||Number.isNaN(now.getTime()))fail('invalid_export_request');
 const stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('');return `bp-records-${user?'user'+user:'all'}-${stamp}.${format}`;
}

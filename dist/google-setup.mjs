import {deviceProperties,sheetId,userSheetUrls} from './setup.mjs?v=1.0.0';
const fail=code=>{throw Error(code);};
export function googleRegistration(board,token,setupId){
 deviceProperties('',board,token); // Reuse strict board/managed-ID/token checks.
 if(!/^[a-f0-9]{32}$/.test(setupId))fail('invalid_setup_result');
 return JSON.stringify({schemaVersion:1,bridgeId:board.bridgeId,meterId:board.meterId,token,setupId});
}
export function googleReceipt(text,{board,setupId,sheet}){
 if(typeof text!=='string'||text.length>2048||!setupId||!sheetId(sheet))fail('invalid_setup_result');
 let r;try{r=JSON.parse(text);}catch{fail('invalid_setup_result');}
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='bridgeId,kind,meterId,schemaVersion,setupId,sheetUserUrls,spreadsheetId'||r.schemaVersion!==1||r.kind!=='bp-to-sheets-google-setup'||r.setupId!==setupId||r.bridgeId!==board?.bridgeId||r.meterId!==board?.meterId||r.spreadsheetId!==sheetId(sheet))fail('invalid_setup_result');
 let urls;try{urls=userSheetUrls(r.sheetUserUrls,sheet);}catch{fail('invalid_setup_result');}
 if(urls.some(u=>sheetId(u)!==r.spreadsheetId))fail('invalid_setup_result');
 return urls;
}

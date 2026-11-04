import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('The complete web app starts with reset disabled and never asks for USB or deletes data on load',async()=>{
 const html=await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
 class Element{
  constructor(){this.value='';this.textContent='';this.checked=false;this.disabled=false;this.hidden=false;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classList={toggle(){},add(){},remove(){}};}
  append(...nodes){this.children.push(...nodes);}prepend(node){this.children.unshift(node);}replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attrs[key]=value;}removeAttribute(key){delete this.attrs[key];}addEventListener(event,fn){this.listeners[event]=fn;}
  focus(){}scrollIntoView(){}querySelector(){return null;}
 }
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const nav=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{step:String(i+1)}}));
 const panels=Array.from({length:6},(_,i)=>Object.assign(new Element(),{dataset:{panel:String(i+1)}}));
 let usbRequests=0;const keys=['document','window','navigator','isSecureContext','setInterval','location'];
 const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{
  document:{configurable:true,value:{getElementById(id){assert(elements.has(id),`Missing UI element: ${id}`);return elements.get(id);},createElement:()=>new Element(),querySelectorAll:selector=>selector==='[data-step]'?nav:selector==='[data-panel]'?panels:[],querySelector:selector=>nav[Number(selector.match(/\d+/)[0])-1]}},
  window:{configurable:true,value:{addEventListener(){}}},navigator:{configurable:true,value:{serial:{async requestPort(){usbRequests++;throw Error('No USB allowed');},async getPorts(){usbRequests++;return [];}}}},
  isSecureContext:{configurable:true,value:true},setInterval:{configurable:true,value:()=>0},location:{configurable:true,value:{hash:''}}
 });
 try{
  await import('../dist/app.mjs');
  assert(elements.get('reset-start').disabled);assert(elements.get('reset-retry').hidden);assert.equal(elements.get('reset-loss').checked,false);
  assert.equal(elements.get('reset-confirmation').value,'');assert.equal(usbRequests,0);
  await elements.get('reset-start').onclick();assert.equal(usbRequests,0);assert(elements.get('reset-start').disabled);
 }finally{for(const key of keys)if(saved[key])Object.defineProperty(globalThis,key,saved[key]);else delete globalThis[key];}
});

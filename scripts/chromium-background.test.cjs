const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const ports=[];const messages=[];const badges=[],titles=[];let resolveReply;
const listener=()=>({listeners:[],addListener(fn){this.listeners.push(fn)}});
const chrome={runtime:{connectNative(){const p={sent:[],onDisconnect:listener(),onMessage:listener(),postMessage(m){this.sent.push(m)}};ports.push(p);return p;},onMessage:listener()},
 tabs:{sendMessage(...args){messages.push(args);return new Promise(r=>resolveReply=r)},onRemoved:listener(),onUpdated:listener()},
 action:{onClicked:listener(),setTitle(value){titles.push(value);return Promise.resolve()},setBadgeText(value){badges.push(value);return Promise.resolve()}},scripting:{}};
const context=vm.createContext({chrome,setTimeout,console});
vm.runInContext(fs.readFileSync('integrations/chromium/background.js','utf8'),context);
(async()=>{
 vm.runInContext("connect(); ready=true; routes.set('old-token',{documentId:'old-document',tabId:5,browserDocumentId:'browser-doc'});",context);
 const pending=ports[0].onMessage.listeners[0]({protocol:1,type:'append',token:'old-token',documentId:'old-document'});
 ports[0].onDisconnect.listeners[0]();
 vm.runInContext('connect(); ready=true;',context);
 resolveReply({protocol:1,type:'receipt',token:'old-token',documentId:'old-document',outcome:'applied'});
 await pending;
 assert.equal(ports[1].sent.some(m=>m.type==='receipt'), false, 'late receipt must stay in its original native connection generation');
 ports[0].onDisconnect.listeners[0]();
 assert.equal(vm.runInContext('native !== null', context), true, 'old disconnect cannot clear a new native port');
 vm.runInContext("tabs.set(8,'document'); routes.set('new-token',{documentId:'document',tabId:8});",context);
 chrome.tabs.onUpdated.listeners[0](8,{status:'loading'});
 assert.equal(badges.at(-1).text,''); assert.equal(titles.at(-1).title,'Enable VOCO in this tab');
 assert.equal(vm.runInContext('tabs.has(8) || routes.has(\'new-token\')',context),false);
 vm.runInContext("tabs.set(9,'doc');",context); ports[1].onDisconnect.listeners[0]();
 assert.equal(badges.at(-1).tabId,9); assert.equal(badges.at(-1).text,'');
 vm.runInContext("connect(); ready=true; tabs.set(10,'doc10'); tabs.set(11,'doc11'); routes.set('token10',{tabId:10,documentId:'doc10'});",context);
 const disable=vm.runInContext('enableTab({id:10})',context);
 resolveReply({documentId:'doc10',stopToken:'token10'}); await disable;
 assert.equal(vm.runInContext('tabs.has(10)',context),false); assert.equal(vm.runInContext('tabs.has(11)',context),true);
 assert.equal(ports[2].sent.filter(m=>m.type==='stop').length,1); assert.equal(ports[2].sent.find(m=>m.type==='stop').token,'token10');
 const beforeRevoke=messages.length;
 const revoke=ports[2].onMessage.listeners[0]({protocol:1,type:'revoke',token:'token11',documentId:'doc11'});
 await revoke; assert.equal(messages.length,beforeRevoke); // No route: never dispatch elsewhere.
 vm.runInContext("routes.set('token11',{tabId:11,documentId:'doc11',browserDocumentId:'browser11'});",context);
 const routedRevoke=ports[2].onMessage.listeners[0]({protocol:1,type:'revoke',token:'token11',documentId:'doc11'});
 assert.equal(messages.at(-1)[0],11); assert.equal(messages.at(-1)[1].type,'revoke'); assert.equal(messages.at(-1)[2].documentId,'browser11');
 resolveReply({}); await routedRevoke;
 console.log('Chromium background reconnect regression passed');
})();

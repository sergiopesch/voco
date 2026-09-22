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
 assert.equal(ports[1].sent.at(-2).type,'invalidate', 'navigation revokes insertion without waiting for the content script');
 assert.equal(ports[1].sent.at(-2).token,'new-token');
 assert.equal(ports[1].sent.at(-2).documentId,'document');
 assert.equal(ports[1].sent.at(-1).type,'stop', 'navigation stops the tab recording');
 assert.equal(ports[1].sent.at(-1).token,'new-token');
 assert.equal(badges.at(-1).text,''); assert.equal(titles.at(-1).title,'Enable VOCO in this tab');
 assert.equal(vm.runInContext('tabs.has(8) || routes.has(\'new-token\')',context),false);
 vm.runInContext("tabs.set(12,'document12'); routes.set('closed-token',{documentId:'document12',tabId:12});",context);
 chrome.tabs.onRemoved.listeners[0](12);
 assert.equal(ports[1].sent.at(-2).type,'invalidate', 'tab close revokes insertion without a content reply');
 assert.equal(ports[1].sent.at(-2).token,'closed-token');
 assert.equal(ports[1].sent.at(-1).type,'stop', 'tab close stops the tab recording');
 assert.equal(ports[1].sent.at(-1).token,'closed-token');
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

function enableFixture() {
 const injections=[], arms=[], sent=[], port={sent:[],onDisconnect:listener(),onMessage:listener(),postMessage(m){this.sent.push(m)}};
 const fixtureChrome={runtime:{connectNative:()=>port,onMessage:listener()},
  tabs:{sendMessage(tabId,message){sent.push({tabId,message});return message.type==='arm'?new Promise(resolve=>arms.push(resolve)):Promise.resolve({});},onRemoved:listener(),onUpdated:listener()},
  action:{onClicked:listener(),setTitle:()=>Promise.resolve(),setBadgeText:()=>Promise.resolve()},
  scripting:{executeScript:()=>new Promise(resolve=>injections.push(resolve))}};
 const state=vm.createContext({chrome:fixtureChrome,setTimeout,console});
 vm.runInContext(fs.readFileSync('integrations/chromium/background.js','utf8'),state);
 vm.runInContext('connect(); ready=true;',state);
 return {state,port,injections,arms,sent,chrome:fixtureChrome,enable:()=>fixtureChrome.action.onClicked.listeners[0]({id:20})};
}
(async()=>{
 {
  const f=enableFixture(), pending=f.enable();
  f.chrome.tabs.onUpdated.listeners[0](20,{status:'loading'});
  f.injections[0]([]); await pending;
  assert.equal(f.arms.length,0,'navigation during script injection must not arm the replacement page');
  assert.equal(vm.runInContext('tabs.has(20) || pendingTabs.has(20)',f.state),false);
 }
 {
  const f=enableFixture(), pending=f.enable();
  f.injections[0]([]); await new Promise(setImmediate);
  assert.equal(f.arms.length,1);
  f.port.onDisconnect.listeners[0]();
  assert.equal(f.sent.at(-1).message.type,'disarm','disconnect disarms tabs whose authorization is still pending');
  f.arms[0]({documentId:'a'.repeat(48)}); await pending;
  assert.equal(vm.runInContext('tabs.has(20) || pendingTabs.has(20)',f.state),false,'late arm must not revive disconnected authorization');
 }
 {
  const f=enableFixture(), first=f.enable();
  await f.enable();
  const replacement=f.enable();
  f.injections[0]([]); await first;
  assert.equal(f.arms.length,0,'cancelled enable attempt cannot arm a newer attempt');
  assert.equal(vm.runInContext('pendingTabs.has(20)',f.state),true,'old cleanup preserves a newer attempt');
  f.injections[1]([]); await new Promise(setImmediate);
  f.arms[0]({documentId:'b'.repeat(48)}); await replacement;
  assert.equal(vm.runInContext('tabs.get(20)',f.state),'b'.repeat(48));
  assert.equal(vm.runInContext('pendingTabs.has(20)',f.state),false);
 }
 console.log('Chromium pending enable lifecycle regressions passed');
})();

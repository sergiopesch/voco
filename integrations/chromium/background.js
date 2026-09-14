const HOST = 'com.voco.exact_field';
let native = null, ready = false;
const tabs = new Map(), routes = new Map();
function clearBadge(tabId) {
  chrome.action.setBadgeText({tabId, text: ''}).catch(() => {});
  chrome.action.setTitle({tabId, title: 'Enable VOCO in this tab'}).catch(() => {});
}
function disconnect() {
  ready = false; native = null;
  for (const tabId of tabs.keys()) {
    chrome.tabs.sendMessage(tabId, {type: 'disarm'}).catch(() => {});
    clearBadge(tabId);
  }
  tabs.clear(); routes.clear();
}
function connect() {
  if (native) return;
  const port = chrome.runtime.connectNative(HOST);
  native = port;
  port.onDisconnect.addListener(() => { if (native === port) disconnect(); });
  port.onMessage.addListener(async message => {
    if (native !== port || message.protocol !== 1) return;
    if (message.type === 'ready') { ready = message.capabilities?.includes('plain-text-atomic-v1') === true; return; }
    const route = routes.get(message.token);
    if (!route || route.documentId !== message.documentId || !['claim', 'append', 'query', 'revoke', 'cancel'].includes(message.type)) return;
    try {
      const receipt = await chrome.tabs.sendMessage(route.tabId, message, {documentId: route.browserDocumentId});
      if (receipt?.type === 'receipt' && native === port && ready) port.postMessage(receipt);
    } catch (_) {
      if (native === port && ready) port.postMessage({protocol: 1, type: 'invalidate', token: message.token, documentId: message.documentId, reason: 'disconnected'});
    }
  });
  native.postMessage({protocol: 1, type: 'hello', client: 'chromium', capabilities: ['plain-text-atomic-v1']});
}
async function enableTab(tab) {
  if (!tab.id || tab.incognito) return;
  if (tabs.has(tab.id)) {
    const port = native;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {type: 'disarm'});
      const route = routes.get(response?.stopToken);
      if (port && native === port && ready && route?.tabId === tab.id && route.documentId === response.documentId) {
        port.postMessage({protocol: 1, type: 'stop', token: response.stopToken, documentId: route.documentId});
      }
    } catch (_) { /* A navigated document is already unavailable. */ }
    invalidateTab(tab.id); return;
  }
  connect();
  for (let attempts = 0; attempts < 20 && native && !ready; attempts++) await new Promise(resolve => setTimeout(resolve, 50));
  if (!ready) { chrome.action.setTitle({tabId: tab.id, title: 'Open VOCO and enable its browser integration first'}); return; }
  try {
    await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content.js']});
    const response = await chrome.tabs.sendMessage(tab.id, {type: 'arm'});
    tabs.set(tab.id, response.documentId);
    chrome.action.setTitle({tabId: tab.id, title: 'VOCO enabled: Alt+Shift+V to dictate; click to disable this tab'});
    chrome.action.setBadgeText({tabId: tab.id, text: 'ON'});
  } catch (_) { chrome.action.setTitle({tabId: tab.id, title: 'VOCO cannot access this page'}); }
}
chrome.action.onClicked.addListener(enableTab);
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!ready || !native || sender.frameId !== 0 || sender.tab?.incognito || !sender.documentId || tabs.get(sender.tab?.id) !== message.documentId || message.protocol !== 1) return;
  if (!/^[a-f0-9]{48}$/.test(message.token || '') || !/^[a-f0-9]{48}$/.test(message.documentId || '')) return;
  if (message.type === 'trigger') {
    for (const [token, route] of routes) if (Date.now() - route.created > 660_000) routes.delete(token);
    if (routes.size >= 1000) return;
    routes.set(message.token, {created: Date.now(), tabId: sender.tab.id, browserDocumentId: sender.documentId, documentId: message.documentId});
    native.postMessage({protocol: 1, type: 'trigger', token: message.token, documentId: message.documentId, mode: 'dictation'});
  } else if (['stop', 'invalidate'].includes(message.type)) {
    const route = routes.get(message.token);
    if (route?.tabId !== sender.tab.id || route.browserDocumentId !== sender.documentId) return;
    native.postMessage({protocol: 1, type: message.type, token: message.token, documentId: message.documentId,
      ...(message.type === 'invalidate' ? {reason: 'ownership-lost'} : {})});
  }
});
function invalidateTab(tabId) {
  tabs.delete(tabId);
  clearBadge(tabId);
  for (const [token, route] of routes) if (route.tabId === tabId) {
    if (ready && native) native.postMessage({protocol: 1, type: 'invalidate', token, documentId: route.documentId, reason: 'disconnected'});
    routes.delete(token);
  }
}
chrome.tabs.onRemoved.addListener(invalidateTab);
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabs.has(tabId) && (change.status === 'loading' || typeof change.url === 'string')) {
    chrome.tabs.sendMessage(tabId, {type: 'disarm'}).catch(() => {});
    invalidateTab(tabId);
  }
});

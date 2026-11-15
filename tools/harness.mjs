// 把打包结果装进一个与宿主同构的沙箱页里，供本机检查（CSP、sandbox、内联脚本都和客户端一致）。
// 握手照抄 src/plugins/PluginPage.tsx：frame.ready → render → rendered → init，请求由父页回答。
// node tools/harness.mjs [dark|light]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginDocument } from '../sdk/protocol.mjs';
import { capabilities } from '../sdk/contract.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'dist');
const source = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const bundlePath = path.join(dist, `app.nous.file-reader-${source.version}.nous-plugin.json`);
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));

const HOST_VERSION = '1.3.2';
const PLATFORM = 'windows-x64';
const PERMISSIONS = bundle.manifest.permissions;
const profile = capabilities(PLATFORM, HOST_VERSION, PERMISSIONS);

let html = pluginDocument(bundle, 'harness');
const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";
html = html.replace(/<head>/i, '<head>' + csp);

const theme = process.argv[2] === 'light' ? 'light' : 'dark';

const context = {
  view: 'reader',
  navigation: bundle.manifest.navigation || [],
  pluginId: bundle.manifest.id,
  theme: theme,
  locale: 'zh-CN',
  capabilities: PERMISSIONS,
  ...profile,
  hostApi: profile.api,
  api: bundle.manifest.api,
  pluginApi: bundle.manifest.api,
};

const page = `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head><meta charset="utf-8"><link rel="icon" href="data:,"><title>检查台 · ${bundle.manifest.name}</title>
<style>html,body{margin:0;height:100%;background:#0a0a0a}iframe{border:0;width:100%;height:100%;display:block}</style></head>
<body><iframe id="plugin" sandbox="allow-scripts allow-forms" src="frame.html"></iframe>
<script>
const PROTOCOL = 'nous.plugin/1';
const NONCE = 'harness';
const CONTEXT = ${JSON.stringify(context)};
const frame = document.getElementById('plugin');
const send = (message) => frame.contentWindow.postMessage(message, '*');
let html = '';
let framed = false;
const render = () => send({ protocol: PROTOCOL, kind: 'render', nonce: NONCE, html: html });
fetch('document.html', { cache: 'no-store' }).then((r) => r.text()).then((text) => {
  html = text;
  if (framed) render();
}).catch((e) => console.error('harness: 读取文档失败', e));
// 宿主 storage 是键值表，读回来的是当初写进去的值本身；这里用 localStorage 兜住，刷新页面也还在
// （file:// 下 localStorage 不可用时退回内存表，那种情况下跨刷新就靠页面不重载）。
const memory = new Map();
const backing = (() => {
  try { localStorage.setItem('harness:probe', '1'); localStorage.removeItem('harness:probe'); return localStorage; }
  catch (e) { return null; }
})();
const store = {
  key: (k) => 'harness:' + k,
  has: (k) => (backing ? backing.getItem(store.key(k)) !== null : memory.has(k)),
  get: (k) => {
    if (!backing) return memory.has(k) ? memory.get(k) : null;
    const raw = backing.getItem(store.key(k));
    return raw === null ? null : JSON.parse(raw);
  },
  set: (k, v) => { if (backing) backing.setItem(store.key(k), JSON.stringify(v)); else memory.set(k, v); },
  remove: (k) => { if (backing) backing.removeItem(store.key(k)); else memory.delete(k); },
};
addEventListener('message', function (event) {
  const value = event.data;
  if (event.source !== frame.contentWindow || !value || typeof value !== 'object') return;
  if (value.protocol !== PROTOCOL) return;
  if (value.kind === 'frame.ready') { framed = true; if (html) render(); return; }
  if (value.nonce !== NONCE) return;
  if (value.kind === 'rendered') { send({ protocol: PROTOCOL, kind: 'init', nonce: NONCE, context: CONTEXT }); return; }
  if (value.kind !== 'request') return;
  const reply = (result) => send({ protocol: PROTOCOL, nonce: NONCE, kind: 'result', id: value.id, value: result });
  const fail = (code, message) => send({ protocol: PROTOCOL, nonce: NONCE, kind: 'result', id: value.id, error: { code: code, message: message } });
  const params = value.params || {};
  if (value.method === 'clipboard.write') { window.__clip = params.text; window.__clipLen = (params.text || '').length; reply({ ok: true }); return; }
  if (value.method === 'storage.get') { reply(store.has(params.key) ? store.get(params.key) : null); return; }
  if (value.method === 'storage.set') { store.set(params.key, params.value); reply({ ok: true }); return; }
  if (value.method === 'storage.remove') { store.remove(params.key); reply({ ok: true }); return; }
  if (value.method === 'external.open') { window.__opened = params.url; reply({ ok: true }); return; }
  if (value.method === 'host.info') { reply({ platform: '${PLATFORM}', version: '${HOST_VERSION}', api: '${profile.api}', locale: 'zh-CN', theme: '${theme}' }); return; }
  if (value.method === 'host.capabilities') { reply(CONTEXT); return; }
  fail('E_METHOD_NOT_FOUND', 'harness: ' + value.method);
});
</script>
</body></html>`;

const frame = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>frame</title></head><body>
<script>
addEventListener('message', function receive(event) {
  const value = event.data;
  if (event.source !== parent || !value || value.protocol !== 'nous.plugin/1' || value.kind !== 'render' || typeof value.html !== 'string') return;
  removeEventListener('message', receive);
  const nonce = value.nonce;
  document.open(); document.write(value.html); document.close();
  parent.postMessage({ protocol: 'nous.plugin/1', kind: 'rendered', nonce: nonce }, '*');
});
parent.postMessage({ protocol: 'nous.plugin/1', kind: 'frame.ready' }, '*');
</script></body></html>`;

await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, 'document.html'), html);
await writeFile(path.join(dist, 'harness.html'), page);
await writeFile(path.join(dist, 'frame.html'), frame);
console.log(JSON.stringify({ harness: path.join(dist, 'harness.html'), theme: theme, documentBytes: html.length, methods: Object.keys(profile.methods).length }));

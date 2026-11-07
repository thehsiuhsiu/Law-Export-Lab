/* 資料：線上模式（GitHub Pages 上的 data/）、上傳模式（使用者拖進來的 zip）、瀏覽器裡保存的設定 */
"use strict";
/* ============================== 資料狀態 ============================== */
// mode：'online' = 讀 GitHub Pages 上的 data/；'local' = 使用者自己上傳 zip
const S = { mode: null, meta: new Map(), raw: new Map(), names: [], sources: {}, version: '', generated: '' };
function dataDateText(){
  const parts = Object.entries(S.sources).filter(([,v]) => v).map(([k,v]) => (Object.keys(S.sources).length > 1 ? k + ' ' : '') + fmtDate(v));
  return parts.join('、');
}

/* ---- IndexedDB：files（上傳的 zip）、kv（法規清單）、laws（看過的法規全文） ---- */
const DB_NAME = 'law-export-lab';
let dbPromise = null;
function idb(){
  if(!dbPromise) dbPromise = new Promise((res, rej) => {
    try{
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        if(!db.objectStoreNames.contains('files')) db.createObjectStore('files', {keyPath:'name'});
        if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if(!db.objectStoreNames.contains('laws')) db.createObjectStore('laws', {keyPath:'id'});
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  });
  return dbPromise;
}
async function idbReq(storeName, mode, fn){
  try{
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(storeName, mode); const st = tx.objectStore(storeName);
      const r = fn(st); let out;
      if(r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }catch(e){ return undefined; }
}
const kvGet = k => idbReq('kv', 'readonly', st => st.get(k));
const kvPut = (k, v) => idbReq('kv', 'readwrite', st => st.put(v, k));
const lawGet = id => idbReq('laws', 'readonly', st => st.get(id));
const lawPut = rec => idbReq('laws', 'readwrite', st => st.put(rec));
const lawDel = id => idbReq('laws', 'readwrite', st => st.delete(id));
const lawKeys = () => idbReq('laws', 'readonly', st => st.getAllKeys());
const filesAll = () => idbReq('files', 'readonly', st => st.getAll());
const filesPut = rec => idbReq('files', 'readwrite', st => st.put(rec));
async function clearAll(){ for(const s of ['files','kv','laws']) await idbReq(s, 'readwrite', st => st.clear()); }

/* ============================== 線上模式（GitHub Pages） ============================== */
async function fetchJson(url){
  const r = await fetch(url, {cache: 'no-store'});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
function applyIndex(idx){
  S.meta.clear(); resolveCache = null;
  for(const l of idx.laws) S.meta.set(l.n, {name:l.n, level:l.lv, modified:l.m, abandon:l.ab, id:l.id, h:l.h});
  S.sources = idx.sources || {}; S.version = idx.version; S.generated = idx.generated || '';
}
// 打開網頁時：先讀很小的 version.json，版本不同才下載新清單，再只重抓「看過且有修正」的法規
async function checkOnline(isManual){
  let ver = null;
  try{ ver = await fetchJson('data/version.json?t=' + Date.now()); }catch(e){}
  const cached = await kvGet('index');
  if(!ver && !cached) return false;          // 沒有線上資料，也沒有存過 → 改用上傳模式
  S.mode = 'online';
  if(cached && !S.meta.size) applyIndex(cached);
  if(!ver){
    banner(`目前連不上資料來源，先使用這台電腦上次保存的資料（資料日期 ${escHtml(dataDateText())}）。`, 'warn');
    return true;
  }
  if(cached && cached.version === ver.version){
    if(isManual) banner(`已經是最新資料（資料日期 ${escHtml(dataDateText())}）。`, 'ok');
    return true;
  }
  if(cached) banner('發現新的法規資料，正在下載…');
  const idx = await fetchJson('data/index.json?v=' + ver.version);
  const oldMeta = cached ? new Map(cached.laws.map(l => [l.n, l])) : null;
  await kvPut('index', idx);
  applyIndex(idx);
  // 重抓瀏覽器裡存過、但內容有變動的法規
  const byId = new Map(idx.laws.map(l => [l.id, l]));
  const updatedSeen = [];
  for(const id of (await lawKeys()) || []){
    const rec = await lawGet(id); const now = byId.get(id);
    if(!now){ await lawDel(id); continue; }
    if(rec && rec.h !== now.h){
      try{ await downloadLaw(now.n); updatedSeen.push(now); }catch(e){}
    }
  }
  if(oldMeta){
    const changed = idx.laws.filter(l => { const o = oldMeta.get(l.n); return !o || o.h !== l.h; });
    let msg = `法規資料已更新（資料日期 ${escHtml(dataDateText())}），共 ${changed.length} 部法規有變動。`;
    if(updatedSeen.length){
      msg += '<br>你看過的法規已更新：' + updatedSeen.slice(0, 8).map(l =>
        `<b>${escHtml(l.n)}</b>${l.m ? `（修正日期 ${escHtml(fmtDate(l.m))}）` : ''}`).join('、') +
        (updatedSeen.length > 8 ? ` 等 ${updatedSeen.length} 部` : '');
    }
    banner(msg, 'ok');
    if(currentName && updatedSeen.some(l => l.n === currentName)) openLaw(currentName, true);
  }
  return true;
}
async function downloadLaw(name){
  const m = S.meta.get(name);
  const raw = await fetchJson(`data/laws/${m.id}.json?v=${m.h}`);
  await lawPut({id: m.id, h: m.h, raw});
  return raw;
}
// 取得法規全文：上傳模式直接用；線上模式先看快取，版本不同才下載
async function getRaw(name){
  if(S.raw.has(name)) return S.raw.get(name);
  const m = S.meta.get(name); if(!m) return null;
  const rec = await lawGet(m.id);
  if(rec && rec.h === m.h) return rec.raw;
  try{ return await downloadLaw(name); }
  catch(e){ if(rec){ toast('連不上資料來源，顯示上次保存的版本'); return rec.raw; } throw e; }
}

/* ============================== 上傳模式（備用） ============================== */
function registerRaw(law){
  resolveCache = null;
  S.raw.set(law.LawName, law);
  S.meta.set(law.LawName, {name: law.LawName, level: law.LawLevel || '', modified: law.LawModifiedDate || '', abandon: law.LawAbandonNote || ''});
}
function addLawsFromJson(text, kind){
  const data = JSON.parse(text.replace(/^﻿/, ''));
  if(data.UpdateDate) S.sources[kind] = data.UpdateDate;
  let n = 0;
  for(const law of (data.Laws || [])){ if(law && law.LawName){ registerRaw(law); n++; } }
  return n;
}
function addLawsFromXml(text, kind){
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  if(doc.querySelector('parsererror')) throw new Error('XML 格式無法解析');
  const get = (el, tag) => { const x = el.getElementsByTagName(tag)[0]; return x ? x.textContent : ''; };
  const root = doc.documentElement;
  const up = root.getAttribute('UpdateDate') || get(root, 'UpdateDate');
  if(up) S.sources[kind] = up;
  let n = 0;
  for(const lawEl of doc.getElementsByTagName('Law')){
    const name = get(lawEl, 'LawName'); if(!name) continue;
    const articles = [];
    for(const ar of lawEl.getElementsByTagName('Article')){
      articles.push({ArticleType: get(ar,'ArticleType'), ArticleNo: get(ar,'ArticleNo'),
        ArticleContent: get(ar,'ArticleContent') || get(ar,'ArticleConctent')}); // 法務部 XML 拼字為 ArticleConctent
    }
    registerRaw({LawName:name, LawLevel:get(lawEl,'LawLevel'), LawModifiedDate:get(lawEl,'LawModifiedDate'),
      LawAbandonNote:get(lawEl,'LawAbandonNote'), LawURL:get(lawEl,'LawURL'), LawHistories:get(lawEl,'LawHistories'), LawArticles:articles});
    n++;
  }
  return n;
}
async function ingestBuffer(name, buf){
  const kind = /order/i.test(name) ? '命令' : '法律';
  const isZip = new Uint8Array(buf.slice(0,2)).join(',') === '80,75'; // "PK"
  if(!isZip){
    const text = new TextDecoder('utf-8').decode(buf);
    return text.trimStart().replace(/^﻿/,'').startsWith('<') ? addLawsFromXml(text, kind) : addLawsFromJson(text, kind);
  }
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.values(zip.files).filter(f => !f.dir && /\.(json|xml)$/i.test(f.name));
  if(!entries.length) throw new Error(`「${name}」裡面找不到 JSON 或 XML 檔`);
  let n = 0;
  for(const f of entries){
    setStatus(`正在解析 ${f.name}…（檔案很大，請稍候）`);
    await new Promise(r => setTimeout(r, 30));
    const text = await f.async('string');
    const k = /order/i.test(f.name) ? '命令' : kind;
    n += /\.json$/i.test(f.name) ? addLawsFromJson(text, k) : addLawsFromXml(text, k);
  }
  return n;
}
async function handleFiles(fileList){
  const files = [...fileList]; if(!files.length) return;
  let total = 0, saved = true;
  try{
    if(S.mode === 'online'){ S.mode = 'local'; S.meta.clear(); S.raw.clear(); S.sources = {}; }
    S.mode = 'local';
    for(const f of files){
      setStatus(`正在讀取 ${f.name}…`);
      const buf = await f.arrayBuffer();
      const n = await ingestBuffer(f.name, buf.slice(0));
      if(!n) throw new Error(`「${f.name}」裡面沒有找到法規資料`);
      total += n;
      saved = (await filesPut({name: f.name, buf, saved: Date.now()})) !== undefined || saved;
    }
    setStatus(`載入完成，共 ${total} 部法規。`);
    banner(null);
    onDataReady();
  }catch(e){ console.error(e); setStatus('載入失敗：' + (e.message || e), true); }
}
async function loadLocalCached(){
  const rows = await filesAll();
  if(!rows || !rows.length) return false;
  setStatus('正在讀取上次保存的法規資料…');
  try{
    S.mode = 'local';
    for(const r of rows) await ingestBuffer(r.name, r.buf);
    return true;
  }catch(e){ setStatus('上次保存的資料無法讀取，請重新載入。', true); await idbReq('files','readwrite',st=>st.clear()); return false; }
}

/* ============================== 使用者設定（存在這台電腦的瀏覽器） ============================== */
function lsGet(key, def){ try{ const v = localStorage.getItem('law-export-lab:' + key); return v == null ? def : JSON.parse(v); }catch(e){ return def; } }
function lsSet(key, v){ try{ localStorage.setItem('law-export-lab:' + key, JSON.stringify(v)); }catch(e){} }

// 我的法規：要放進 Obsidian 的法規
function myLaws(){ return lsGet('myLaws', []); }
function isMyLaw(name){ return myLaws().includes(name); }
function toggleMyLaw(name){
  const list = myLaws(); const i = list.indexOf(name);
  if(i >= 0) list.splice(i, 1); else list.push(name);
  lsSet('myLaws', list); return i < 0;
}
// 上次同步到 Obsidian 時的版本（用來提示「有新資料可同步」）
function lawVersion(name){ const m = S.meta.get(name); return m ? (m.h || m.modified || '') : ''; }
function syncedVersions(){ return lsGet('synced', {}); }
function markSynced(name){ const s = syncedVersions(); s[name] = lawVersion(name); lsSet('synced', s); }
function lawsNeedingSync(){
  const s = syncedVersions();
  return myLaws().filter(n => S.meta.has(n) && s[n] && s[n] !== lawVersion(n));
}

// 簡稱：內建＋使用者自訂（自訂優先；自訂為空字串代表取消內建簡稱）
function customShort(){ return lsGet('shortNames', {}); }
let shortCache = null;
function shortMap(){
  if(!shortCache){
    shortCache = {...BUILTIN_SHORT, ...customShort()};
    for(const k of Object.keys(shortCache)) if(!shortCache[k]) delete shortCache[k];
  }
  return shortCache;
}
function setCustomShort(obj){ lsSet('shortNames', obj); shortCache = null; resolveCache = null; }
function shortOf(name){ return shortMap()[name] || ''; }
// 名稱 → 全名（認得全名與簡稱；資料裡沒有的法規回傳 null）
let resolveCache = null;
function resolveLawName(n){
  if(!resolveCache){
    resolveCache = new Map();
    for(const [full, short] of Object.entries(shortMap())) if(S.meta.has(full)) resolveCache.set(short, full);
  }
  if(S.meta.has(n)) return n;
  return resolveCache.get(n) || null;
}
function dataDateOf(L){ return S.sources[L.level === '法律' ? '法律' : '命令'] || Object.values(S.sources)[0] || ''; }
function exportEnv(){ return {resolve: resolveLawName, shortOf, dataDate: dataDateOf}; }

// Obsidian 資料夾（瀏覽器記得這個資料夾，但每次使用都要再按一次允許）
const vaultGet = () => kvGet('vault');
const vaultPut = h => kvPut('vault', h);

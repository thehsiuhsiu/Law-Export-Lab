/* 畫面：法規清單、閱讀、條文引用、背誦模式、匯出選單、同步、手機抽屜 */
"use strict";
const $ = s => document.querySelector(s);

/* ============================== 小元件 ============================== */
let toastTimer;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function setStatus(msg, err){ const s = $('#status'); s.textContent = msg; s.classList.toggle('err', !!err); }
function banner(html, kind){
  const b = $('#banner');
  if(!html){ b.hidden = true; $('#main').classList.remove('has-banner'); return; }
  $('#bannerText').innerHTML = html; b.className = 'banner' + (kind ? ' ' + kind : ''); b.hidden = false;
  $('#main').classList.add('has-banner');
  document.documentElement.style.setProperty('--bannerh', b.offsetHeight + 'px');
}
function appendBanner(html){
  const b = $('#banner');
  if(b.hidden) banner(html, 'ok'); else { $('#bannerText').insertAdjacentHTML('beforeend', '<br>' + html); document.documentElement.style.setProperty('--bannerh', b.offsetHeight + 'px'); }
}
$('#bannerX').onclick = () => banner(null);
function modal(title, html){
  $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').hidden = false;
}
function closeModal(){ $('#modal').hidden = true; }
$('#modalX').onclick = closeModal;
$('#modal').addEventListener('click', e => { if(e.target.id === 'modal') closeModal(); });
// 下拉選單
function closeMenus(except){ document.querySelectorAll('.menu').forEach(m => { if(m !== except) m.hidden = true; }); }
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-menu]');
  if(btn){ const m = document.getElementById(btn.dataset.menu); closeMenus(m); m.hidden = !m.hidden; e.stopPropagation(); return; }
  if(!e.target.closest('.menu')) closeMenus();
});
// 手機抽屜
function openDrawer(which){ document.body.classList.remove('side-open', 'toc-open'); if(which) document.body.classList.add(which + '-open'); }
$('#backdrop').onclick = () => openDrawer(null);
$('#closeSide').onclick = () => openDrawer(null);
document.addEventListener('click', e => { if(e.target.closest('[data-open-side]')) openDrawer('side'); });
const isNarrow = () => matchMedia('(max-width:860px)').matches;
function todayStr(){ const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; }

/* ============================== 字體大小 ============================== */
let fontSize = lsGet('fs', 16);
function applyFont(){ document.documentElement.style.setProperty('--fs', fontSize + 'px'); }
function bumpFont(d){ fontSize = Math.min(24, Math.max(13, fontSize + d)); lsSet('fs', fontSize); applyFont(); }
applyFont();

/* ============================== 法規清單 ============================== */
const canSync = () => typeof window.showDirectoryPicker === 'function' && window.top === window;
function onDataReady(){
  S.names = [...S.meta.keys()].sort((a,b)=>a.length-b.length || a.localeCompare(b,'zh-Hant'));
  $('#q').disabled = false;
  renderInfo();
  renderResults();
  if(!currentName){
    const last = lsGet('last', null);
    const start = (last && S.meta.has(last)) ? last : (S.meta.has('中華民國刑法') ? '中華民國刑法' : null);
    if(start) openLaw(start); else showEmpty();
  }
  const need = lawsNeedingSync();
  if(need.length && canSync()){
    appendBanner(`我的法規有 ${need.length} 部有新資料：${need.slice(0,5).map(escHtml).join('、')}${need.length > 5 ? ' 等' : ''}` +
      ` <button class="btn small" data-sync-all>同步到 Obsidian</button>`);
  }
}
function renderInfo(){
  const info = $('#datainfo'); info.hidden = false;
  const date = dataDateText();
  if(S.mode === 'online'){
    info.innerHTML = `共 ${S.meta.size} 部法規` + (date ? `<br>資料日期：${escHtml(date)}` : '') + `<br>每天自動從法務部更新` +
      `<div class="row"><button class="btn small" id="recheck">檢查更新</button><button class="btn small" id="shortBtn">簡稱設定</button><button class="btn small" id="clear">清除快取</button></div>`;
    $('#recheck').onclick = async e => { e.target.disabled = true; try{ await checkOnline(true); renderInfo(); renderResults(); }finally{ e.target.disabled = false; } };
  }else{
    info.innerHTML = `已載入 ${S.meta.size} 部法規` + (date ? `<br>資料日期：${escHtml(date)}` : '') +
      `<div class="row"><button class="btn small" id="reload">更新資料</button><button class="btn small" id="shortBtn">簡稱設定</button><button class="btn small" id="clear">清除資料</button></div>`;
    $('#reload').onclick = () => { showEmpty(); openDrawer(null); };
  }
  $('#shortBtn').onclick = showShortSettings;
  $('#clear').onclick = async () => { await clearAll(); lsSet('last', null); location.reload(); };
}
function lawItemHtml(n, q){
  const m = S.meta.get(n);
  const gone = m.abandon ? '<span class="tag gone">已廢止</span>' : '';
  const lv = m.level ? `<span class="tag">${escHtml(m.level)}</span>` : '';
  const sh = shortOf(n) ? `<span class="tag">${escHtml(shortOf(n))}</span>` : '';
  const label = q ? escHtml(n).replace(new RegExp(escRe(escHtml(q)),'g'), x=>`<mark>${x}</mark>`) : escHtml(n);
  return `<button class="law-item${n===currentName?' active':''}" data-name="${escHtml(n)}">${label}${sh}${lv}${gone}` +
    (m.modified ? `<span class="meta">修正日期 ${escHtml(fmtDate(m.modified))}</span>` : '') + `</button>`;
}
function renderResults(){
  const q = $('#q').value.trim().replace(/\s+/g,'');
  const box = $('#results');
  if(!S.names.length){ box.innerHTML = '<div class="hint">尚未載入法規資料。</div>'; return; }
  if(!q){
    const mine = myLaws().filter(n => S.meta.has(n));
    const need = new Set(lawsNeedingSync());
    let html = `<div class="sec">我的法規（${mine.length}）</div>`;
    html += mine.length ? mine.map(n => lawItemHtml(n).replace('</button>', need.has(n) ? '<span class="tag new">有新資料</span></button>' : '</button>')).join('')
                        : '<div class="hint">打開一部法規後按「☆ 我的法規」加入，就能一次同步到 Obsidian。</div>';
    html += vaultBoxHtml();
    html += `<div class="sec">全部法規（${S.names.length}）</div><div class="hint">輸入名稱或簡稱搜尋，例如「刑法」「道交條例」。</div>`;
    box.innerHTML = html;
    return;
  }
  // 簡稱也能搜尋
  const viaShort = resolveLawName(q);
  let list = S.names.filter(n => n.includes(q) || shortOf(n).includes(q));
  list.sort((a,b)=> (b===viaShort)-(a===viaShort) || (b===q)-(a===q) || (b.startsWith(q))-(a.startsWith(q)) || a.length-b.length);
  const shown = list.slice(0, 150);
  box.innerHTML = shown.length ? shown.map(n => lawItemHtml(n, q)).join('') +
    (list.length > shown.length ? `<div class="hint">還有 ${list.length - shown.length} 筆，請輸入更多字。</div>` : '')
    : `<div class="hint">找不到「${escHtml(q)}」。</div>`;
}
function vaultBoxHtml(){
  if(!canSync()) return `<div class="vault">同步到 Obsidian 需要在<b>電腦版 Chrome 或 Edge</b>開啟這個網頁。手機上可以閱讀、下載 Obsidian 檔案。</div>`;
  return `<div class="vault"><b>Obsidian 同步</b><div id="vaultName" class="count">${vaultLabel}</div>` +
    `<div class="row"><button class="btn small primary" data-sync-all ${myLaws().length ? '' : 'disabled'}>同步我的法規</button><button class="btn small" id="pickVault">${vaultLabel.startsWith('資料夾') ? '更換資料夾' : '選擇資料夾'}</button></div></div>`;
}
let vaultLabel = '尚未選擇 Obsidian 資料夾';
async function refreshVaultLabel(){ const h = await vaultGet(); vaultLabel = h ? `資料夾：${h.name}` : '尚未選擇 Obsidian 資料夾'; }

/* ============================== 閱讀畫面 ============================== */
let currentName = null, currentLaw = null, openSeq = 0, findQ = '';
let recite = 'off';   // off | whole | num
function showEmpty(){
  $('#empty').hidden = false; $('#lawview').hidden = true;
  const online = S.mode === 'online';
  $('#emptyTitle').textContent = online ? '法規查閱與匯出' : '先載入法務部的法規資料';
  $('#emptyLocal').hidden = online; $('#emptyOnline').hidden = !online;
}
async function openLaw(name, keepScroll){
  if(!S.meta.has(name)) return false;
  const seq = ++openSeq;
  currentName = name;
  document.querySelectorAll('.law-item').forEach(b => b.classList.toggle('active', b.dataset.name === name));
  openDrawer(null);
  const v = $('#lawview');
  const scroll = $('#main').scrollTop;
  if(!keepScroll){ $('#empty').hidden = true; v.hidden = false; v.innerHTML = `<div class="empty"><div class="hint">正在載入 ${escHtml(name)}…</div></div>`; }
  let raw;
  try{ raw = await getRaw(name); }
  catch(e){ if(seq === openSeq) v.innerHTML = `<div class="empty"><div class="status err">無法載入「${escHtml(name)}」，請確認網路後再試一次。</div></div>`; return false; }
  if(seq !== openSeq) return false;
  currentLaw = buildLaw(raw);
  lsSet('last', name);
  $('#empty').hidden = true; v.hidden = false;
  renderLawView();
  $('#main').scrollTop = keepScroll ? scroll : 0;
  return true;
}
function renderLawView(){
  const L = currentLaw, v = $('#lawview');
  const short = shortOf(L.name);
  const metaBits = [short && `簡稱 ${short}`, L.level, L.modified && ('修正日期 ' + fmtDate(L.modified)), `${L.articleCount} 條`].filter(Boolean);
  const date = dataDateText();
  const mine = isMyLaw(L.name);
  const reciteLabel = {off:'背誦', whole:'背誦：遮整條', num:'背誦：遮數字'}[recite];
  v.innerHTML = `
    <div class="lawhead" id="lawhead">
      <div class="titlerow">
        <button class="btn mobile-only" data-open-side title="法規清單">☰</button>
        <h2>${escHtml(L.name)}${L.abandon ? ' <span class="tag gone">已廢止</span>' : ''}</h2>
        <button class="btn ${mine ? 'on' : ''}" id="star" title="加入後可一次同步到 Obsidian">${mine ? '★' : '☆'} 我的法規</button>
      </div>
      <div class="meta">${escHtml(metaBits.join('　·　'))}${L.histories.length ? `　·　<a id="showHist">修正沿革（${L.histories.length}）</a>` : ''}</div>
      <div class="toolbar">
        <button class="btn mobile-only" id="openToc">目錄</button>
        <input id="find" class="field" type="search" placeholder="搜尋條文內容" autocomplete="off" value="${escHtml(findQ)}">
        <input id="jump" class="field jump" type="text" placeholder="跳到第幾條" autocomplete="off">
        <span id="count" class="count"></span>
        <span class="spacer"></span>
        <div class="dd"><button class="btn ${recite !== 'off' ? 'on' : ''}" data-menu="reciteMenu">${reciteLabel} ▾</button>
          <div class="menu" id="reciteMenu" hidden>
            <button data-recite="off" class="${recite==='off'?'cur':''}">一般閱讀</button>
            <button data-recite="whole" class="${recite==='whole'?'cur':''}">遮住整條<small>點一下翻開一項</small></button>
            <button data-recite="num" class="${recite==='num'?'cur':''}">遮住數字<small>刑度、金額、期間等，點一下顯示</small></button>
            ${recite !== 'off' ? '<hr><button data-recite="again">全部重新遮住</button>' : ''}
          </div></div>
        <button class="btn" data-font="-1" title="字小一點">A−</button><button class="btn" data-font="1" title="字大一點">A＋</button>
        <div class="dd right"><button class="btn primary" data-menu="exportMenu">匯出 ▾</button>
          <div class="menu" id="exportMenu" hidden>
            ${canSync() ? `<button data-export="sync">同步這部到 Obsidian<small>寫進 Obsidian 資料夾，保留你的筆記</small></button><hr>` : ''}
            <button data-export="obsidian">Obsidian（一條一檔 zip）<small>每條一個檔案，可以寫條筆記</small></button>
            <button data-export="md">Markdown（整部一檔）<small>只供閱讀，不保留筆記</small></button>
            <button data-export="word">Word</button>
          </div></div>
      </div>
      ${recite !== 'off' ? `<div class="recite-tip">${recite === 'whole' ? '條文已遮住：點一下翻開一項，或按條號旁的「翻開」。' : '數字已遮住：點一下灰色方塊顯示。'}</div>` : ''}
    </div>
    <div class="body">
      <nav class="toc" id="toc"><div class="tochead">目錄<button class="x" id="closeToc">×</button></div>${tocHtml(L)}</nav>
      <div class="content" id="content"></div>
    </div>
    <div class="foot">資料來源：法務部全國法規資料庫${date ? `（資料日期 ${escHtml(date)}）` : ''}，依政府資料開放授權條款第 1 版釋出。條文以全國法規資料庫公告為準。${L.url ? ` <a href="${escHtml(L.url)}" target="_blank" rel="noopener">在全國法規資料庫查看</a>` : ''}</div>`;
  renderContent();
  const head = $('#lawhead');
  const setH = () => document.documentElement.style.setProperty('--headh', (head.offsetHeight + ($('#banner').hidden ? 0 : $('#banner').offsetHeight)) + 'px');
  setH(); new ResizeObserver(setH).observe(head);
  let t; $('#find').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { findQ = e.target.value.trim(); renderContent(); }, 150); });
  $('#jump').addEventListener('keydown', e => { if(e.key === 'Enter'){ jumpTo(e.target.value); e.target.blur(); } });
  $('#star').onclick = () => { const on = toggleMyLaw(L.name); toast(on ? `已加入我的法規：${L.name}` : `已從我的法規移除：${L.name}`); renderLawView(); renderResults(); };
  if($('#showHist')) $('#showHist').onclick = () => modal(`${L.name}　修正沿革`, `<ol>${L.histories.map(h => `<li>${escHtml(h)}</li>`).join('')}</ol>`);
  $('#openToc').onclick = () => openDrawer('toc');
  $('#closeToc').onclick = () => openDrawer(null);
  $('#toc').addEventListener('click', e => {
    const a = e.target.closest('a[data-target]'); if(!a) return;
    e.preventDefault();
    if(findQ){ findQ = ''; $('#find').value = ''; renderContent(); }
    openDrawer(null);
    const el = document.getElementById(a.dataset.target); if(el) el.scrollIntoView({block:'start'});
  });
}
function tocHtml(L){
  const hs = L.items.filter(i => i.kind === 'h');
  if(!hs.length) return '<div class="hint">本法規沒有編章節。</div>';
  return hs.map(h => `<a href="#" class="l${h.rel}" data-target="${h.id}">${escHtml(h.title)}</a>`).join('');
}
// 一行條文 → HTML：條文引用變連結、背誦模式遮數字、搜尋字醒目標示
function lineHtml(text, no, re){
  const hl = s => re ? escHtml(s).replace(re, m => `<mark>${m}</mark>`) : escHtml(s);
  return parseRefs(text, {law: currentLaw.name, no, ...(neighborsOf(currentLaw).get(no) || {}), resolve: resolveLawName}).map(seg => {
    if(seg.law) return `<a class="ref" href="#" data-law="${escHtml(seg.law)}" data-no="${escHtml(seg.no)}"${seg.p ? ` data-p="${seg.p}"` : ''} title="${escHtml(seg.law === currentLaw.name ? seg.no : seg.law + seg.no)}${seg.p ? `第${seg.p}項` : ''}">${hl(seg.t)}</a>`;
    if(recite !== 'num') return hl(seg.t);
    return splitCloze(seg.t).map(c => c.cloze ? `<span class="cz">${hl(c.t)}</span>` : hl(c.t)).join('');
  }).join('');
}
function renderContent(){
  const L = currentLaw, box = $('#content'), q = findQ;
  const re = q ? new RegExp(escRe(escHtml(q)), 'g') : null;
  let html = '', hits = 0;
  for(const it of L.items){
    if(it.kind === 'h'){ if(!q) html += `<h3 class="h l${it.rel}" id="${it.id}">${escHtml(it.title)}</h3>`; continue; }
    if(q && !it.text.includes(q) && !it.no.includes(q.replace(/\s+/g,''))) continue;
    hits++;
    const paras = splitParagraphs(it.text);
    const body = paras.map((p, i) => `<div class="para" id="${it.id}-p${i + 1}"><span class="pn">${i + 1}</span><div class="pb">` +
      p.map(l => `<div class="ln ${l.kind}"${l.lab ? ` style="padding-left:${l.lab}em;text-indent:-${l.lab}em"` : ''}>${lineHtml(l.text, it.no, re)}</div>`).join('') + '</div></div>').join('');
    const acts = (recite === 'whole' ? `<button class="btn small" data-reveal="${it.id}">翻開</button>` : '') + `<button class="btn small copy" data-copy="${it.id}">複製</button>`;
    html += `<article class="art" id="${it.id}"><div class="no"><span>${escHtml(it.no)}</span><span class="acts">${acts}</span></div>` +
      `<div class="txt${paras.length > 1 ? ' multi' : ''}${recite === 'whole' ? ' veil' : ''}">${body}</div></article>`;
  }
  box.innerHTML = html || `<div class="hint">沒有條文包含「${escHtml(q)}」。</div>`;
  $('#count').textContent = q ? `找到 ${hits} 條` : '';
}
function flash(el){ el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
function scrollToArticle(no, p){
  const it = currentLaw.articles.find(i => i.no === no);
  if(!it){ toast(`${currentLaw.name}找不到${no}`); return false; }
  if(findQ){ findQ = ''; $('#find').value = ''; renderContent(); }
  const el = (p && document.getElementById(`${it.id}-p${p}`)) || document.getElementById(it.id);
  el.scrollIntoView({block: p ? 'center' : 'start'});
  flash(el);
  return true;
}
function jumpTo(v){
  const s = String(v||'').replace(/\s+/g,'').replace(/之/g,'-').replace(/^第/,'').replace(/條$/,'');
  if(!s) return;
  const n = s.split('-').map(x => /^\d+$/.test(x) ? x : String(cnToInt(x))).join('-');
  scrollToArticle(`第${n}條`);
}
async function goToRef(law, no, p){
  if(law !== currentName){ if(!(await openLaw(law))) return; }
  scrollToArticle(no, p);
}

/* ---- 內容區的點擊：引用、背誦、複製 ---- */
document.addEventListener('click', async e => {
  const veilPara = e.target.closest('.veil .para:not(.open)'); if(veilPara){ e.preventDefault(); veilPara.classList.add('open'); return; }
  const ref = e.target.closest('a.ref');
  if(ref){ e.preventDefault(); goToRef(ref.dataset.law, ref.dataset.no, ref.dataset.p ? +ref.dataset.p : null); return; }
  const cz = e.target.closest('.cz'); if(cz){ cz.classList.toggle('open'); return; }
  const rv = e.target.closest('[data-reveal]');
  if(rv){ const art = document.getElementById(rv.dataset.reveal); const paras = art.querySelectorAll('.para');
    const allOpen = [...paras].every(p => p.classList.contains('open')); paras.forEach(p => p.classList.toggle('open', !allOpen)); rv.textContent = allOpen ? '翻開' : '遮住'; return; }
  const rc = e.target.closest('[data-recite]');
  if(rc){ closeMenus(); const m = rc.dataset.recite; if(m !== 'again') recite = m; const y = $('#main').scrollTop; renderLawView(); $('#main').scrollTop = y; return; }
  const ft = e.target.closest('[data-font]'); if(ft){ bumpFont(+ft.dataset.font); return; }
  const ex = e.target.closest('[data-export]'); if(ex){ closeMenus(); doExport(ex.dataset.export); return; }
  if(e.target.closest('[data-sync-all]')){ doSync(myLaws().filter(n => S.meta.has(n))); return; }
  if(e.target.closest('#pickVault')){ pickVault(); return; }
  const cp = e.target.closest('[data-copy]');
  if(cp && currentLaw){
    const it = currentLaw.items.find(i => i.id === cp.dataset.copy); if(!it) return;
    const text = `${currentLaw.name}${it.no}\n${it.text}`;
    try{ await navigator.clipboard.writeText(text); toast('已複製 ' + it.no); }
    catch(err){
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try{ ok = document.execCommand('copy'); }catch(_){}
      ta.remove(); toast(ok ? '已複製 ' + it.no : '這個環境不允許自動複製，請直接選取文字');
    }
  }
});

/* ============================== 匯出 ============================== */
const downloadsReady = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
async function saveFile(filename, blob){
  const dl = await downloadsReady;
  if(dl){
    try{ await dl.save({filename, data: blob}); toast('已下載 ' + filename); }
    catch(e){ if(e && e.code !== 'declined') toast('無法下載：' + (e.message || e.code || e)); }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('已下載 ' + filename);
}
async function doExport(kind){
  const L = currentLaw, env = exportEnv(), base = safeFileName(L.name);
  try{
    if(kind === 'word') await saveFile(base + '.docx', await buildDocxBlob(L, env));
    else if(kind === 'md') await saveFile(base + '.md', new Blob([buildSingleMarkdown(L, env)], {type:'text/markdown;charset=utf-8'}));
    else if(kind === 'obsidian') await saveFile(base + '（Obsidian）.zip', await buildObsidianZip(L, env));
    else if(kind === 'sync'){ if(!isMyLaw(L.name)){ toggleMyLaw(L.name); renderLawView(); renderResults(); } await doSync([L.name]); }
  }catch(e){ console.error(e); toast('匯出失敗：' + (e.message || e)); }
}

/* ============================== 同步到 Obsidian ============================== */
async function pickVault(){
  try{
    const h = await window.showDirectoryPicker({id: 'obsidian-vault', mode: 'readwrite'});
    await vaultPut(h); await refreshVaultLabel(); renderResults();
    toast(`已選擇資料夾：${h.name}（法規會放在「${h.name}/法規/」）`);
    return h;
  }catch(e){ if(e.name !== 'AbortError') toast('無法使用這個資料夾：' + e.message); return null; }
}
async function getVault(){
  let h = await vaultGet();
  if(h){
    try{
      let p = await h.queryPermission({mode: 'readwrite'});
      if(p !== 'granted') p = await h.requestPermission({mode: 'readwrite'});
      if(p === 'granted') return h;
    }catch(e){}
  }
  modal('選擇 Obsidian 資料夾', '<p>請在接下來的視窗選擇你的 <b>Obsidian 資料夾（vault）</b>，並按「允許」讓網頁編輯檔案。</p><p class="count">網頁只會寫入這個資料夾底下的「法規」資料夾，不會動到其他檔案。</p><p><button class="btn primary" id="pickNow">選擇資料夾</button></p>');
  return await new Promise(res => { $('#pickNow').onclick = async () => { const v = await pickVault(); closeModal(); res(v); }; $('#modalX').addEventListener('click', () => res(null), {once: true}); });
}
let syncing = false;
async function doSync(names){
  if(!canSync()){ toast('同步需要在電腦版 Chrome 或 Edge 開啟這個網頁'); return; }
  if(syncing || !names.length) return;
  const root = await getVault(); if(!root) return;
  syncing = true;
  modal('同步到 Obsidian', '<div id="syncMsg">準備中…</div><div class="bar"><i id="syncBar"></i></div><div id="syncSum"></div>');
  const results = [], env = exportEnv(), today = todayStr();
  try{
    for(let k = 0; k < names.length; k++){
      const name = names[k];
      $('#syncMsg').textContent = `（${k + 1}/${names.length}）${name}：讀取條文…`;
      const L = buildLaw(await getRaw(name));
      const r = await syncLawToFolder(root, L, env, today, (i, n) => {
        $('#syncMsg').textContent = `（${k + 1}/${names.length}）${name}：${i}/${n} 條`;
        $('#syncBar').style.width = `${((k + i / n) / names.length) * 100}%`;
      });
      markSynced(name); results.push(r);
      $('#syncSum').insertAdjacentHTML('beforeend', syncSummaryHtml(r));
    }
    $('#syncBar').style.width = '100%';
    $('#syncMsg').innerHTML = `完成！檔案在 Obsidian 資料夾的「<b>${escHtml(root.name)}/法規/</b>」。`;
    banner(null); renderResults();
  }catch(e){
    console.error(e);
    $('#syncMsg').innerHTML = `<span class="status err">同步失敗：${escHtml(e.message || String(e))}</span>`;
  }finally{ syncing = false; }
}
function syncSummaryHtml(r){
  const bits = [];
  if(r.created) bits.push(`新增 ${r.created} 個檔案`);
  if(r.amended.length) bits.push(`<b>${r.amended.length} 條有修正</b>（舊條文已保留）：${r.amended.slice(0, 15).map(escHtml).join('、')}${r.amended.length > 15 ? ' 等' : ''}`);
  if(r.refreshed) bits.push(`更新 ${r.refreshed} 個檔案的導覽或屬性`);
  if(r.adopted) bits.push(`${r.adopted} 個你自己建立的檔案加上了條文區塊`);
  if(r.unchanged) bits.push(`${r.unchanged} 個檔案沒有變動`);
  if(r.missing.length) bits.push(`這些條已不在法規中（檔案沒有刪除）：${r.missing.slice(0, 10).map(escHtml).join('、')}${r.missing.length > 10 ? ' 等' : ''}`);
  return `<div class="sum"><b>${escHtml(r.law)}</b>${bits.join('<br>')}</div>`;
}

/* ============================== 簡稱設定 ============================== */
function showShortSettings(){
  const custom = customShort();
  const text = Object.entries(custom).map(([k, v]) => `${k}=${v}`).join('\n');
  modal('簡稱設定', `
    <p>一行一筆，格式為「<b>全名=簡稱</b>」。要取消內建的簡稱，寫「全名=」就好。</p>
    <textarea id="shortText" placeholder="例如：\n警察法=警察法\n公路法=公路法">${escHtml(text)}</textarea>
    <p><button class="btn primary" id="shortSave">儲存</button></p>
    <details><summary>內建簡稱（${Object.keys(BUILTIN_SHORT).length} 部）</summary>${Object.entries(BUILTIN_SHORT).map(([k, v]) => `${escHtml(k)}＝${escHtml(v)}`).join('<br>')}</details>`);
  $('#shortSave').onclick = () => {
    const obj = {};
    for(const line of $('#shortText').value.split('\n')){
      const m = line.split(/[=＝]/); if(m.length === 2 && m[0].trim()) obj[m[0].trim()] = m[1].trim();
    }
    setCustomShort(obj); closeModal(); toast('已儲存簡稱'); renderResults(); if(currentLaw) renderLawView();
  };
}

/* ============================== 啟動 ============================== */
$('#q').addEventListener('input', renderResults);
$('#results').addEventListener('click', e => { const b = e.target.closest('.law-item'); if(b) openLaw(b.dataset.name); });
$('#file').addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
const drop = $('#drop');
['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
document.addEventListener('keydown', e => { if(e.key === 'Escape'){ closeModal(); closeMenus(); openDrawer(null); } });
(async () => {
  await refreshVaultLabel();
  let ok = false;
  try{ ok = await checkOnline(false); }catch(e){ console.error(e); ok = S.meta.size > 0; if(ok) banner('檢查更新時發生錯誤，先使用已保存的資料。', 'warn'); }
  if(!ok) ok = await loadLocalCached();
  if(ok) onDataReady(); else { $('#q').placeholder = '請先載入法規資料'; showEmpty(); }
})();

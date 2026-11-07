/* 同步到 Obsidian 資料夾：只更新條文區塊，保留條筆記；條文有修正時把舊條文留在可收合的區塊。
 * 合併邏輯是純函式（可單獨測試）；寫檔用瀏覽器的資料夾存取功能（電腦版 Chrome / Edge）。
 * 標記格式的決定見 docs/adr/0001-sync-into-obsidian-folder.md
 */
"use strict";

var OWNED_KEYS_REPLACE = ['法規', '條號', '編章節', '修正日期', '資料日期', '法規類別', '已廢止', '條數'];
var OWNED_KEYS_UNION = ['aliases', 'tags'];

// 拆出 frontmatter：回傳 {entries:[{key, lines}], rest}
function splitFrontmatter(text){
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if(!m) return {entries: [], rest: text};
  const entries = [];
  for(const line of m[1].split('\n')){
    const k = line.match(/^([^\s:#][^:]*):(.*)$/);
    if(k) entries.push({key: k[1].trim(), lines: [line]});
    else if(entries.length) entries[entries.length - 1].lines.push(line);
    else entries.push({key: '', lines: [line]});
  }
  return {entries, rest: text.slice(m[0].length)};
}
function listValues(entry){
  if(!entry) return [];
  const first = entry.lines[0].replace(/^[^:]*:/, '').trim();
  if(first.startsWith('[')) return first.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  if(first) return [first.replace(/^["']|["']$/g, '')];
  return entry.lines.slice(1).map(l => l.match(/^\s*-\s*(.*)$/)).filter(Boolean).map(m => m[1].trim().replace(/^["']|["']$/g, ''));
}
// 合併屬性：我們的欄位換成新值，aliases / tags 取聯集，使用者自己加的欄位保留
function mergeProps(oldText, props){
  const {entries} = splitFrontmatter(oldText || '');
  const byKey = new Map(entries.map(e => [e.key, e]));
  const merged = {...props};
  for(const k of OWNED_KEYS_UNION){
    const union = [...new Set([...(props[k] || []), ...listValues(byKey.get(k))])];
    merged[k] = union;
  }
  const lines = yamlBlock(merged);
  for(const e of entries){
    if(OWNED_KEYS_REPLACE.includes(e.key) || OWNED_KEYS_UNION.includes(e.key) || e.key in props) continue;
    lines.push(...e.lines);
  }
  // 內容相同（只是順序不同，例如使用者把自己的欄位放在中間）就保留原本的寫法，避免無意義的改寫
  const norm = ls => splitFrontmatter(['---', ...ls, '---', ''].join('\n')).entries
    .map(e => e.key + '\u0000' + (OWNED_KEYS_UNION.includes(e.key) ? listValues(e).sort().join('|') : e.lines.join('\n')))
    .sort().join('\n');
  const oldLines = entries.flatMap(e => e.lines);
  if(entries.length && norm(oldLines) === norm(lines)) return oldLines;
  return lines;
}

var START_RE = /^%% (條文|總覽)開始 (v\d+)(?: ([0-9a-f]{8}))?[^\n]*%%$/m;
var END_RE = { '條文': /^%% 條文結束 %%$/m, '總覽': /^%% 總覽結束 %%$/m };

// 找出舊檔裡的區塊：{before, block, after, hash, kind}
function findBlock(rest, kind){
  const s = rest.match(START_RE);
  if(!s || s[1] !== kind) return null;
  const startIdx = s.index;
  const tail = rest.slice(startIdx);
  const e = tail.match(END_RE[kind]);
  if(!e) return null;
  const endIdx = startIdx + e.index + e[0].length;
  return {before: rest.slice(0, startIdx), block: rest.slice(startIdx, endIdx), after: rest.slice(endIdx), hash: s[3] || null};
}
// 舊區塊的條文本體（標題、導覽列之後），去掉區塊代碼，給「修正前條文」用
function oldBodyFromBlock(block){
  const lines = block.split('\n');
  const body = lines.slice(4, -1);   // 0 標記、1 標題、2 導覽、3 空行、…、最後是結束標記
  return body.map(l => l.replace(/\s\^[\w-]+$/, '').replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1'));
}

/**
 * 合併一個條文檔。
 * oldText：資料夾裡現有的內容（沒有檔案時 null）
 * gen：genArticleFile 的結果；today：'2026/11/07'；modified：法規修正日期
 * 回傳 {text, status: 'new'|'same'|'refreshed'|'amended'|'adopted'}
 *   refreshed：條文沒變，只更新導覽或屬性；amended：條文有修正；adopted：舊檔沒有標記，加上條文區塊
 */
function mergeArticleFile(oldText, gen, today, modified){
  if(oldText == null) return {text: freshFile(gen, true), status: 'new'};
  oldText = oldText.replace(/\r\n/g, '\n');
  const {rest} = splitFrontmatter(oldText);
  const fm = ['---', ...mergeProps(oldText, gen.props), '---'].join('\n');
  const found = findBlock(rest, '條文');
  let text, status;
  if(!found){
    text = `${fm}\n${gen.block}\n\n${rest.replace(/^\n+/, '')}`;
    status = 'adopted';
  }else if(found.hash && found.hash !== gen.hash){
    const old = oldBodyFromBlock(found.block);
    const note = `修正前條文（${today} 同步時發現修改${modified ? `；法規修正日期 ${fmtDate(modified)}` : ''}）`;
    const callout = ['', '', `> [!note]- ${note}`, ...old.map(l => '> ' + l)].join('\n');
    text = `${fm}\n${found.before.replace(/^\n+/, '')}${gen.block}${callout}${found.after}`;
    status = 'amended';
  }else{
    text = `${fm}\n${found.before.replace(/^\n+/, '')}${gen.block}${found.after}`;
    status = 'refreshed';
  }
  if(text === oldText) status = 'same';
  return {text, status};
}
function mergeOverviewFile(oldText, gen){
  if(oldText == null) return {text: freshFile(gen, true), status: 'new'};
  oldText = oldText.replace(/\r\n/g, '\n');
  const {rest} = splitFrontmatter(oldText);
  const fm = ['---', ...mergeProps(oldText, gen.props), '---'].join('\n');
  const found = findBlock(rest, '總覽');
  const text = found ? `${fm}\n${found.before.replace(/^\n+/, '')}${gen.block}${found.after}`
                     : `${fm}\n${gen.block}\n\n${rest.replace(/^\n+/, '')}`;
  return {text, status: text === oldText ? 'same' : found ? 'refreshed' : 'adopted'};
}

/* ============================== 寫入資料夾 ============================== */
async function readText(dir, name){
  try{ const fh = await dir.getFileHandle(name); return await (await fh.getFile()).text(); }
  catch(e){ if(e && (e.name === 'NotFoundError' || e.name === 'TypeError')) return null; throw e; }
}
async function writeText(dir, name, text){
  const fh = await dir.getFileHandle(name, {create: true});
  const w = await fh.createWritable(); await w.write(text); await w.close();
}

/**
 * 把一部法規同步進 root/法規/<法規名稱>/。
 * 回傳 {law, created, refreshed, amended:[條號], adopted, unchanged, missing:[檔名]}
 */
async function syncLawToFolder(root, L, env, today, onProgress){
  const base = await root.getDirectoryHandle('法規', {create: true});
  const dir = await base.getDirectoryHandle(safeFileName(L.name), {create: true});
  const r = {law: L.name, created: 0, refreshed: 0, amended: [], adopted: 0, unchanged: 0, missing: []};
  const count = s => { if(s === 'new') r.created++; else if(s === 'refreshed') r.refreshed++; else if(s === 'adopted') r.adopted++; else if(s === 'same') r.unchanged++; };
  const ov = genOverviewFile(L, env);
  const ovm = mergeOverviewFile(await readText(dir, ov.name), ov);
  if(ovm.status !== 'same') await writeText(dir, ov.name, ovm.text);
  count(ovm.status);
  const expected = new Set([ov.name]);
  for(let i = 0; i < L.articles.length; i++){
    const it = L.articles[i];
    const g = genArticleFile(L, it, i, env);
    expected.add(g.name);
    const m = mergeArticleFile(await readText(dir, g.name), g, today, L.modified);
    if(m.status !== 'same') await writeText(dir, g.name, m.text);
    if(m.status === 'amended') r.amended.push(it.no); else count(m.status);
    if(onProgress && i % 25 === 0) onProgress(i + 1, L.articles.length);
  }
  // 資料夾裡有、但法規已經沒有的條（不刪除，只回報）
  const prefix = safeFileName(L.name) + '第';
  for await (const [name, h] of dir.entries()){
    if(h.kind === 'file' && name.startsWith(prefix) && name.endsWith('.md') && !expected.has(name)) r.missing.push(name.replace(/\.md$/, ''));
  }
  return r;
}

if(typeof module !== 'undefined') module.exports = {
  splitFrontmatter, mergeProps, mergeArticleFile, mergeOverviewFile, oldBodyFromBlock, syncLawToFolder
};

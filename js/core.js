/* 法規查閱與匯出：共用的解析工具（網頁與測試都會載入，不碰畫面） */
"use strict";

/* ============================== 字串工具 ============================== */
var escHtml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
var escXml = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))
                           .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
var escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 「20240731」「2026/10/30 上午 12:00:00」→「2024/07/31」「2026/10/30」
function fmtDate(d){ d = String(d||'').trim().split(/\s+/)[0]; return /^\d{8}$/.test(d) ? `${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6)}` : d; }
// 給 Obsidian 屬性用的 ISO 日期：2024-07-31
function isoDate(d){
  const t = fmtDate(d); const m = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}` : t;
}
// 簡單雜湊（FNV-1a），用來判斷條文有沒有變
function hashText(s){
  let h = 0x811c9dc5;
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
function safeFileName(name){ return String(name).replace(/[\\/:*?"<>|#^[\]]/g, '_').trim(); }

/* ============================== 國字數字 ============================== */
var CN_DIGIT = {零:0, 〇:0, 一:1, 二:2, 兩:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9};
var CN_UNIT = {十:10, 百:100, 千:1000};
function cnToInt(s){
  s = String(s);
  if(/^\d+$/.test(s)) return parseInt(s, 10);
  let total = 0, num = 0;
  for(const ch of s){
    if(ch in CN_DIGIT) num = CN_DIGIT[ch];
    else if(ch in CN_UNIT){ total += (num || 1) * CN_UNIT[ch]; num = 0; }
    else return NaN;
  }
  return total + num;
}

/* ============================== 法規結構 ============================== */
// 統一條號：「第 1 條」「1」→「第1條」
function normalizeArticleNo(no){
  const t = String(no||'').replace(/\s+/g,'');
  if(!t) return '';
  if(t.startsWith('第') && t.endsWith('條')) return t;
  return t.endsWith('條') ? t : `第${t}條`;
}
var HEAD_RE = /^第\s*([一二三四五六七八九十百千零〇\d]+)\s*(編|章|節|款|目)\s*(.*)$/;
var UNIT_LEVEL = {編:1, 章:2, 節:3, 款:4, 目:5};
function parseHeading(text){
  const t = String(text||'').trim().replace(/\s+/g,' ');
  const m = t.match(HEAD_RE);
  if(m) return {level: UNIT_LEVEL[m[2]], title: (`第${m[1]}${m[2]} ` + m[3].trim()).trim()};
  for(const u of ['編','章','節','款','目']) if(t.includes(u)) return {level: UNIT_LEVEL[u], title: t};
  return {level: 2, title: t};
}
function cleanContent(c){ return String(c||'').replace(/\r\n?/g,'\n').replace(/\n{2,}/g,'\n').replace(/\s+$/,''); }

// 原始資料 → {name, level, modified, abandon, url, histories, items:[...]}
// 條：{kind:'a', no:'第10條', text, id, path:[所屬編章節標題]}
function buildLaw(raw){
  const items = [], heads = [];
  let hi = 0, ai = 0;
  for(const a of (raw.LawArticles || [])){
    const type = (a.ArticleType||'').trim();
    if(type === 'C'){
      const h = parseHeading(a.ArticleContent);
      if(!h.title) continue;
      const it = {kind:'h', lv:h.level, title:h.title, id:'h'+(++hi)};
      items.push(it); heads.push(it);
    }else if(type === 'A' && (a.ArticleNo||'').trim()){
      items.push({kind:'a', no: normalizeArticleNo(a.ArticleNo), text: cleanContent(a.ArticleContent) || '（無內容）', id:'a'+(++ai)});
    }
  }
  const minLv = heads.length ? Math.min(...heads.map(h=>h.lv)) : 1;
  for(const h of heads) h.rel = Math.min(h.lv - minLv + 1, 5);
  // 每條記下所屬的編章節
  const stack = [];
  for(const it of items){
    if(it.kind === 'h'){ while(stack.length && stack[stack.length-1].rel >= it.rel) stack.pop(); stack.push(it); }
    else it.path = stack.map(h => h.title);
  }
  return {
    name: raw.LawName, level: raw.LawLevel || '', modified: raw.LawModifiedDate || '',
    abandon: raw.LawAbandonNote || '', url: raw.LawURL || '', histories: parseHistories(raw.LawHistories),
    items, articles: items.filter(i => i.kind === 'a'), articleCount: ai
  };
}

// 把一條拆成「項」：沒有款目編號的行是新的一項；「一、」是款、「（一）」是目，歸在上一項
var KUAN_RE = /^[一二三四五六七八九十百]+、/;
var MU_RE = /^[（(][一二三四五六七八九十百]+[）)]/;
function splitParagraphs(text){
  const paras = [];
  for(const raw of String(text).split('\n')){
    const t = raw.replace(/^[\s　]+/, '');
    if(!t) continue;
    const mk = t.match(KUAN_RE), mm = mk ? null : t.match(MU_RE);
    const kind = mk ? 'k' : mm ? 'm' : 'p';
    const lab = (mk || mm || [''])[0].length;  // 「十四、」=3 字，懸掛縮排依字數調整
    if(kind === 'p' || !paras.length) paras.push([]);
    paras[paras.length - 1].push({kind, text: t, lab});
  }
  return paras.length ? paras : [[{kind:'p', text: String(text), lab: 0}]];
}

// 修正沿革：法務部的格式是「1.中華民國…」「2.…」，續行以空白開頭
function parseHistories(text){
  const lines = String(text||'').replace(/\r\n?/g,'\n').split('\n').map(l => l.replace(/\s+$/,'')).filter(l => l.trim());
  const out = [];
  for(const l of lines){
    const m = l.match(/^\s*(\d+)\s*[.．、]\s*(.*)$/);
    if(m || !out.length) out.push(m ? m[2] : l.trim());
    else out[out.length - 1] += '\n' + l.trim();
  }
  return out;
}

/* ============================== 簡稱 ============================== */
// 內建警察常用法規簡稱（使用者可在網頁上增修）
var BUILTIN_SHORT = {
  '中華民國憲法':'憲法', '中華民國刑法':'刑法', '刑事訴訟法':'刑訴法', '刑事妥速審判法':'速審法',
  '道路交通管理處罰條例':'道交條例', '道路交通安全規則':'道安規則',
  '違反道路交通管理事件統一裁罰基準及處理細則':'道交處理細則',
  '社會秩序維護法':'社維法', '警察職權行使法':'警職法', '警械使用條例':'警械條例', '警察勤務條例':'勤務條例',
  '毒品危害防制條例':'毒品條例', '槍砲彈藥刀械管制條例':'槍砲條例', '組織犯罪防制條例':'組犯條例',
  '洗錢防制法':'洗防法', '詐欺犯罪危害防制條例':'詐欺條例', '通訊保障及監察法':'通保法',
  '家庭暴力防治法':'家暴法', '性騷擾防治法':'性騷法', '性侵害犯罪防治法':'性侵法', '跟蹤騷擾防制法':'跟騷法',
  '兒童及少年性剝削防制條例':'兒少性剝削條例', '兒童及少年福利與權益保障法':'兒少權法', '少年事件處理法':'少事法',
  '個人資料保護法':'個資法', '行政程序法':'行程法', '行政罰法':'行罰法', '行政執行法':'行執法',
  '集會遊行法':'集遊法', '入出國及移民法':'移民法', '國家賠償法':'國賠法', '犯罪被害人權益保障法':'犯保法'
};
// 「全名=簡稱」一行一筆
function parseShortText(text){
  const out = {};
  for(const line of String(text||'').split('\n')){
    const m = line.split(/[=＝]/);
    if(m.length === 2 && m[0].trim() && m[1].trim()) out[m[0].trim()] = m[1].trim();
  }
  return out;
}

/* ============================== 條文引用 ============================== */
var NUM = '[一二三四五六七八九十百千零〇\\d]+';
var REF_RE = new RegExp(
  `第(${NUM})條(?:之(${NUM}))?(?:第(${NUM})項)?(?:第${NUM}款)?(?:第${NUM}目)?` +   // 第四十七條之一第二項第三款
  `|第(${NUM})項(?:第${NUM}款)?(?:第${NUM}目)?`, 'g');                              // 第五項第一款（同一條）
var SELF_WORDS = ['本法','本條例','本細則','本辦法','本規則','本準則','本標準','本通則','本規程','本綱要','本要點'];
// 條號 → 網頁與檔案共用的寫法：「第47條」「第2-1條」
function refArticleNo(main, sub){ return `第${cnToInt(main)}${sub ? '-' + cnToInt(sub) : ''}條`; }

/**
 * 把一行條文切成文字與引用。
 * ctx = {law: 目前法規全名, no: 目前條號, resolve: name => 全名或 null（認得全名與簡稱）}
 * 回傳 [{t:'文字'}, {t:'刑法第四十七條第一項', law:'中華民國刑法', no:'第47條', p:1}, ...]
 * 「前項」「前條」這類相對說法不處理。
 */
function parseRefs(line, ctx){
  const out = []; let last = 0, prev = null;
  REF_RE.lastIndex = 0;
  let m;
  while((m = REF_RE.exec(line))){
    let start = m.index, law = ctx.law, no, p = null;
    const gap = line.slice(prev ? prev.end : 0, start);
    const joined = prev && /^[、，及或與至和暨並以]{0,2}$/.test(gap);
    if(m[1]){                                   // 有條號
      no = refArticleNo(m[1], m[2]);
      if(m[3]) p = cnToInt(m[3]);
      // 往前找法規名稱（全名或簡稱），取最長的
      let found = null;
      for(let L = Math.min(40, start - last); L >= 2; L--){
        const cand = line.slice(start - L, start);
        if(SELF_WORDS.includes(cand)){ found = {name: ctx.law, len: L}; break; }
        const full = ctx.resolve(cand);
        if(full){ found = {name: full, len: L}; break; }
      }
      if(found){ law = found.name; start -= found.len; }
      else if(joined) law = prev.law;           // 「刑法第一條、第二條」：沿用前一個法規
    }else{                                      // 只有項次
      p = cnToInt(m[4]);
      if(joined){ law = prev.law; no = prev.no; }   // 「第四十七條第一項、第二項」
      else no = ctx.no;                              // 「第五項第一款」：同一條
    }
    if(!no || !law) continue;
    if(start > last) out.push({t: line.slice(last, start)});
    const ref = {t: line.slice(start, m.index + m[0].length), law, no, p, end: m.index + m[0].length};
    out.push(ref); prev = ref; last = ref.end;
  }
  if(last < line.length) out.push({t: line.slice(last)});
  return out;
}

/* ============================== 背誦模式：要遮的數字 ============================== */
var CN_NUM = '[一二三四五六七八九十百千萬億零〇兩\\d]+';
var CLOZE_RE = new RegExp(
  `(?:新臺幣)?${CN_NUM}(?:元)` +
  `|${CN_NUM}分之${CN_NUM}` +
  `|(?<![第之])${CN_NUM}(?:年|個月|月|日|星期|小時|分鐘|歲|倍)`, 'g');
// 回傳 [{t, cloze:true|false}]
function splitCloze(text){
  const out = []; let last = 0, m;
  CLOZE_RE.lastIndex = 0;
  while((m = CLOZE_RE.exec(text))){
    if(m.index > last) out.push({t: text.slice(last, m.index), cloze: false});
    out.push({t: m[0], cloze: true}); last = m.index + m[0].length;
  }
  if(last < text.length) out.push({t: text.slice(last), cloze: false});
  return out;
}

if(typeof module !== 'undefined') module.exports = {
  escHtml, escXml, fmtDate, isoDate, hashText, safeFileName, cnToInt, normalizeArticleNo, parseHeading,
  buildLaw, splitParagraphs, parseHistories, BUILTIN_SHORT, parseShortText, parseRefs, refArticleNo, splitCloze
};

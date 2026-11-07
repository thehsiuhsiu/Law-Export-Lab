/* 匯出：Obsidian（一條一檔／一部一檔）與 Word。只產生文字與檔案內容，不碰畫面。
 * env = {resolve(name)→全名|null, shortOf(全名)→簡稱|'', dataDate(法規)→'2026/10/30'}
 */
"use strict";

/* ============================== Obsidian 共用 ============================== */
var MARK_VERSION = 'v1';   // 條文區塊標記格式版本（見 docs/adr/0001）
function articleFileName(law, no){ return safeFileName(`${law}${no}`); }
function blockId(n){ return `p${n}`; }
function tagOf(law){ return '法規/' + String(law).replace(/[^\p{L}\p{N}_\-/]/gu, '_'); }

// 一行條文 → Markdown，條文引用變成 Obsidian 連結
// mode 'file'：一條一檔（連到 [[法規第N條#^pX]]）；'single'：一部一檔（同法規連到本檔區塊）
function mdLine(text, law, no, env, mode, nb){
  return parseRefs(text, {law, no, ...(nb || {}), resolve: env.resolve}).map(seg => {
    if(!seg.law) return seg.t;
    const label = seg.t.replace(/[|\]]/g, '');
    if(mode === 'single' && seg.law === law){
      const target = seg.p ? `#^${singleBlockId(seg.no, seg.p)}` : `#${seg.no}`;
      return `[[${target}|${label}]]`;
    }
    const file = articleFileName(seg.law, seg.no);
    if(mode === 'file' && seg.law === law && seg.no === no) return seg.p ? `[[#^${blockId(seg.p)}|${label}]]` : label;
    return `[[${file}${seg.p ? '#^' + blockId(seg.p) : ''}|${label}]]`;
  }).join('');
}
function singleBlockId(no, p){ return 'a' + String(no).replace(/[第條]/g, '') + '-p' + p; }

// 條文本體（項次用有序清單，每項結尾加區塊代碼，讓「第X條第Y項」能直接連到該項）
function articleBodyLines(it, law, env, mode, nb){
  const paras = splitParagraphs(it.text), multi = paras.length > 1, out = [];
  paras.forEach((p, i) => {
    const id = mode === 'single' ? singleBlockId(it.no, i + 1) : blockId(i + 1);
    p.forEach((l, j) => {
      const text = (l.kind === 'm' ? '　' : '') + mdLine(l.text, law, it.no, env, mode, nb);
      let line = !multi ? text : j === 0 ? `${i + 1}. ${text}` : ' '.repeat(`${i + 1}. `.length) + text;
      if(j === p.length - 1) line += ` ^${id}`;
      out.push(line);
    });
  });
  return out;
}

/* ---- 屬性（frontmatter） ---- */
function yamlStr(v){ return /^[\w\-.\/一-鿿]+$/.test(v) && !/^\d/.test(v) ? v : JSON.stringify(v); }
function yamlBlock(obj){
  const out = [];
  for(const [k, v] of Object.entries(obj)){
    if(v === undefined || v === null || v === '') continue;
    if(Array.isArray(v)){ if(!v.length) continue; out.push(`${k}:`); for(const x of v) out.push(`  - ${yamlStr(x)}`); }
    else out.push(`${k}: ${typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? yamlStr(v) : v}`);
  }
  return out;
}
function articleProps(L, it, env){
  const short = env.shortOf(L.name);
  return {
    '法規': `[[${L.name}]]`, '條號': it.no, '編章節': it.path || [],
    '修正日期': isoDate(L.modified), '資料日期': isoDate(env.dataDate(L)),
    aliases: short ? [`${short}${it.no}`] : [], tags: [tagOf(L.name)]
  };
}
function overviewProps(L, env){
  const short = env.shortOf(L.name);
  return {
    '法規類別': L.level, '修正日期': isoDate(L.modified), '資料日期': isoDate(env.dataDate(L)),
    '已廢止': L.abandon ? true : undefined, '條數': L.articleCount,
    aliases: short ? [short] : [], tags: [tagOf(L.name)]
  };
}

/* ---- 一條一檔：條文檔 ---- */
// 回傳 {name, props, block, hash, body}；block 是條文開始到條文結束（含標記）
function genArticleFile(L, it, idx, env){
  const prev = L.articles[idx - 1], next = L.articles[idx + 1];
  const nav = [
    prev ? `[[${articleFileName(L.name, prev.no)}|‹ ${prev.no}]]` : '',
    `[[${safeFileName(L.name)}|${L.name}]]`,
    next ? `[[${articleFileName(L.name, next.no)}|${next.no} ›]]` : ''
  ].filter(Boolean).join('　｜　');
  const body = articleBodyLines(it, L.name, env, 'file', neighborsOf(L).get(it.no));
  const hash = hashText(it.text);
  const block = [
    `%% 條文開始 ${MARK_VERSION} ${hash}：同步時只會更新到「條文結束」為止，筆記請寫在下面 %%`,
    // 結束標記前要空一行，否則 Obsidian 會把標記併進最後一段，最後一個區塊代碼（^pN）就會露出來
    `# ${L.name}${it.no}`, nav, '', ...body, '', '%% 條文結束 %%'
  ].join('\n');
  return {name: articleFileName(L.name, it.no) + '.md', props: articleProps(L, it, env), block, hash, body};
}

/* ---- 一條一檔：法規總覽 ---- */
function genOverviewFile(L, env){
  const lines = [`%% 總覽開始 ${MARK_VERSION}：同步時只會更新到「總覽結束」為止 %%`, `# ${L.name}`, ''];
  const src = ['資料來源：法務部全國法規資料庫'];
  if(L.modified) src.push('修正日期 ' + fmtDate(L.modified));
  if(env.dataDate(L)) src.push('資料日期 ' + fmtDate(env.dataDate(L)));
  lines.push('> ' + src.join('｜'), '', '## 目錄', '');
  for(const it of L.items){
    if(it.kind === 'h') lines.push('', `${'#'.repeat(Math.min(it.rel + 2, 6))} ${it.title}`, '');
    else{
      const first = splitParagraphs(it.text)[0][0].text;
      const brief = first.length > 28 ? first.slice(0, 28) + '…' : first;
      lines.push(`- [[${articleFileName(L.name, it.no)}|${it.no}]]　${brief.replace(/[[\]]/g, '')}`);
    }
  }
  if(L.histories.length){
    lines.push('', '## 修正沿革', '');
    L.histories.forEach((h, i) => lines.push(`${i + 1}. ` + h.split('\n').join('\n   ')));
  }
  lines.push('', '%% 總覽結束 %%');
  return {name: safeFileName(L.name) + '.md', props: overviewProps(L, env), block: lines.join('\n').replace(/\n{3,}/g, '\n\n')};
}

// 全新的檔案內容
function freshFile(gen, withNotes){
  return ['---', ...yamlBlock(gen.props), '---', gen.block, '', ...(withNotes ? ['## 筆記', '', ''] : [])].join('\n');
}

/* ---- 一部一檔（只供下載閱讀） ---- */
function buildSingleMarkdown(L, env){
  const out = ['---', ...yamlBlock(overviewProps(L, env)), '---', `# ${L.name}`, ''];
  const src = ['資料來源：法務部全國法規資料庫'];
  if(L.modified) src.push('修正日期 ' + fmtDate(L.modified));
  if(env.dataDate(L)) src.push('資料日期 ' + fmtDate(env.dataDate(L)));
  out.push('> ' + src.join('｜'), '');
  const hs = L.items.filter(i => i.kind === 'h');
  if(hs.length){
    out.push('## 目錄', '');
    for(const h of hs) out.push(`${'  '.repeat(h.rel - 1)}- [[#${h.title}|${h.title}]]`);
    out.push('');
  }
  const depth = hs.length ? Math.max(...hs.map(h => h.rel)) : 0;
  for(const it of L.items){
    if(it.kind === 'h') out.push('', `${'#'.repeat(Math.min(it.rel + 1, 6))} ${it.title}`, '');
    else out.push(`${'#'.repeat(Math.min(depth + 2, 6))} ${it.no}`, ...articleBodyLines(it, L.name, env, 'single', neighborsOf(L).get(it.no)), '');
  }
  if(L.histories.length){
    out.push('', '## 修正沿革', '');
    L.histories.forEach((h, i) => out.push(`${i + 1}. ` + h.split('\n').join('\n   ')));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ---- 一條一檔 zip（沒有同步時用；全新檔案） ---- */
async function buildObsidianZip(L, env){
  const zip = new JSZip(); const dir = zip.folder(safeFileName(L.name));
  const ov = genOverviewFile(L, env);
  dir.file(ov.name, freshFile(ov, true));
  L.articles.forEach((it, i) => { const g = genArticleFile(L, it, i, env); dir.file(g.name, freshFile(g, true)); });
  return zip.generateAsync({type:'blob', compression:'DEFLATE'});
}

/* ============================== Word ============================== */
var FONT_BODY = 'JF OPEN 粉圓 2.1';
var FONT_HEAD = 'LINE SEED TW_OTF Bold';
var TEXT_W = 11906 - 1152 * 2, NUM_W = 420;  // A4 版心寬、項次欄寬（twips）
function rFonts(f){ return `<w:rFonts w:ascii="${escXml(f)}" w:hAnsi="${escXml(f)}" w:eastAsia="${escXml(f)}" w:cs="${escXml(f)}"/>`; }
function runXml(text, rpr){
  const parts = String(text).split('\n');
  return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}` +
    parts.map((p, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${escXml(p)}</w:t>`).join('') + '</w:r>';
}
function sourceLine(L, env){
  const src = ['資料來源：法務部全國法規資料庫'];
  if(L.modified) src.push('修正日期 ' + fmtDate(L.modified));
  const d = env.dataDate(L); if(d) src.push('資料日期 ' + fmtDate(d));
  return src;
}
function buildDocxParts(L, env){
  const body = [];
  const P = (inner, ppr) => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  body.push(P(runXml(L.name), '<w:pStyle w:val="Title"/>'));
  body.push(P(runXml(sourceLine(L, env).join('　'), '<w:color w:val="777777"/><w:sz w:val="18"/>'), '<w:jc w:val="center"/><w:spacing w:after="240"/>'));
  const hs = L.items.filter(i => i.kind === 'h');
  if(hs.length){
    body.push(P(runXml('目錄'), '<w:pStyle w:val="TOCHeading"/>'));
    hs.forEach((h, i) => {
      const link = `<w:hyperlink w:anchor="law_h${i+1}" w:history="1">` +
        runXml(h.title, '<w:color w:val="1F4E9A"/><w:u w:val="single"/>') + '</w:hyperlink>';
      body.push(P(link, `<w:spacing w:after="40"/><w:ind w:left="${(h.rel - 1) * 480}"/>`));
    });
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }
  let hIdx = 0;
  const lineXml = (l, last) => {
    // 懸掛寬度 = 編號字數（「十四、」3 字、「（一）」3 字）；目再往內縮 2 字（12pt 一字 = 240）
    const hang = (l.lab || 0) * 240;
    const ind = l.kind === 'k' ? `<w:ind w:left="${hang}" w:hanging="${hang}"/>`
              : l.kind === 'm' ? `<w:ind w:left="${480 + hang}" w:hanging="${hang}"/>` : '';
    return P(runXml(l.text), `<w:pStyle w:val="${last ? 'ArticleLast' : 'ArticleLine'}"/>${ind}`);
  };
  for(const it of L.items){
    if(it.kind === 'h'){
      hIdx++;
      body.push(`<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(it.rel, 3)}"/></w:pPr>` +
        `<w:bookmarkStart w:id="${hIdx}" w:name="law_h${hIdx}"/>${runXml(it.title)}<w:bookmarkEnd w:id="${hIdx}"/></w:p>`);
      continue;
    }
    body.push(P(runXml(it.no, rFonts(FONT_HEAD) + '<w:b/>'), '<w:pStyle w:val="ArticleNo"/>'));
    const paras = splitParagraphs(it.text);
    if(paras.length === 1){ paras[0].forEach((l, j) => body.push(lineXml(l, j === paras[0].length - 1))); continue; }
    // 兩項以上：用無框線表格，左欄放項次、右欄放條文，避免 Word 擠壓定位點造成縮排錯位
    const rows = paras.map((p, i) => {
      const lastRow = i === paras.length - 1;
      const numCell = `<w:tc><w:tcPr><w:tcW w:w="${NUM_W}" w:type="dxa"/></w:tcPr>` +
        P(runXml(String(i + 1), '<w:i/><w:color w:val="808080"/>'),
          `<w:pStyle w:val="${lastRow ? 'ArticleLast' : 'ArticleLine'}"/><w:jc w:val="right"/><w:ind w:right="120"/>`) + '</w:tc>';
      const textCell = `<w:tc><w:tcPr><w:tcW w:w="${TEXT_W - NUM_W}" w:type="dxa"/>` +
        '<w:tcBorders><w:left w:val="single" w:sz="8" w:space="0" w:color="D9D9D9"/></w:tcBorders>' +
        '<w:tcMar><w:left w:w="140" w:type="dxa"/></w:tcMar></w:tcPr>' +
        p.map((l, j) => lineXml(l, lastRow && j === p.length - 1)).join('') + '</w:tc>';
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${numCell}${textCell}</w:tr>`;
    }).join('');
    body.push('<w:tbl><w:tblPr>' + `<w:tblW w:w="${TEXT_W}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
      '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      `<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid><w:gridCol w:w="${NUM_W}"/><w:gridCol w:w="${TEXT_W - NUM_W}"/></w:tblGrid>${rows}</w:tbl>`);
  }
  if(L.histories.length){
    body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    body.push(P(runXml('修正沿革'), '<w:pStyle w:val="Heading1"/>'));
    L.histories.forEach((h, i) => body.push(P(runXml(`${i + 1}. ${h}`), '<w:pStyle w:val="ArticleLine"/><w:ind w:left="480" w:hanging="480"/><w:spacing w:after="80"/>')));
  }
  const sect = '<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1152" w:right="1152" w:bottom="1152" w:left="1152" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const hStyle = (id, name, lvl, sz) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="160"/><w:jc w:val="center"/><w:outlineLvl w:val="${lvl}"/></w:pPr>` +
    `<w:rPr>${rFonts(FONT_HEAD)}<w:b/><w:bCs/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return {
    '[Content_Types].xml': X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'docProps/core.xml': X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escXml(L.name)}</dc:title><dc:creator>法規查閱與匯出</dc:creator></cp:coreProperties>`,
    'word/_rels/document.xml.rels': X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    'word/document.xml': X + `<w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`,
    'word/styles.xml': X + `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${rFonts(FONT_BODY)}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr><w:rPr>${rFonts(FONT_HEAD)}<w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="240" w:after="160"/></w:pPr><w:rPr>${rFonts(FONT_HEAD)}<w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
${hStyle('Heading1','heading 1',0,32)}
${hStyle('Heading2','heading 2',1,28)}
${hStyle('Heading3','heading 3',2,24)}
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ArticleNo"><w:name w:val="條號"/><w:basedOn w:val="Normal"/><w:next w:val="ArticleLine"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ArticleLine"><w:name w:val="條文"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ArticleLast"><w:name w:val="條文（末行）"/><w:basedOn w:val="ArticleLine"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="240"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`,
    'word/footer1.xml': X + `<w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`
  };
}
async function buildDocxBlob(L, env){
  const zip = new JSZip();
  for(const [path, xml] of Object.entries(buildDocxParts(L, env))) zip.file(path, xml);
  return zip.generateAsync({type:'blob', compression:'DEFLATE',
    mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

if(typeof module !== 'undefined') module.exports = {
  MARK_VERSION, articleFileName, genArticleFile, genOverviewFile, freshFile, yamlBlock, buildSingleMarkdown, buildDocxParts, mdLine
};

const assert = require('assert'), fs = require('fs'), vm = require('vm');
const ctx = vm.createContext({console, TextEncoder}); 
for(const f of ['core','export','sync']) vm.runInContext(fs.readFileSync(require('path').join(__dirname, `../js/${f}.js`),'utf8').replace(/if\(typeof module[\s\S]*$/,''), ctx);
// mock directory handle
class FH{ constructor(d,n){this.d=d;this.n=n;this.kind='file';} async getFile(){ const t=this.d.files.get(this.n); return {text: async()=>t}; } async createWritable(){ const self=this; return {write: async t=>{self.d.files.set(self.n,t); self.d.writes.push(self.n);}, close: async()=>{}}; } }
class DH{ constructor(){this.files=new Map();this.dirs=new Map();this.kind='directory';this.writes=[];}
  async getDirectoryHandle(n,o={}){ if(!this.dirs.has(n)){ if(!o.create){const e=new Error('nf');e.name='NotFoundError';throw e;} this.dirs.set(n,new DH()); } return this.dirs.get(n); }
  async getFileHandle(n,o={}){ if(!this.files.has(n)){ if(!o.create){const e=new Error('nf');e.name='NotFoundError';throw e;} this.files.set(n,''); } return new FH(this,n); }
  async *entries(){ for(const n of this.files.keys()) yield [n,{kind:'file'}]; } }
const raw = (a10, extra=[] , drop=false) => ({LawName:'中華民國刑法', LawLevel:'法律', LawModifiedDate:'20250101', LawHistories:'1.制定\r\n2.修正',
  LawArticles:[{ArticleType:'C',ArticleContent:'第 一 編 總則'},{ArticleType:'C',ArticleContent:'第 一 章 法例'},
   {ArticleType:'A',ArticleNo:'第 9 條',ArticleContent:'第九條內容，依第十條第二項。'},
   {ArticleType:'A',ArticleNo:'第 10 條',ArticleContent:a10}, ...extra,
   ...(drop?[]:[{ArticleType:'A',ArticleNo:'第 11 條',ArticleContent:'第十一條，見刑事訴訟法第二百五十二條。'}])]});
const env = {resolve: n => ({'中華民國刑法':'中華民國刑法','刑法':'中華民國刑法','刑事訴訟法':'刑事訴訟法'})[n]||null, shortOf: n => n==='中華民國刑法'?'刑法':'', dataDate: () => '2026/10/30 上午 12:00:00'};
(async () => {
  ctx.env = env; ctx.raw = raw;
  const root = new DH(); ctx.root = root;
  const run = async (r, today) => { ctx.r = r; ctx.today = today; return await vm.runInContext('syncLawToFolder(root, buildLaw(r), env, today)', ctx); };
  let res = await run(raw('稱以上者。\n稱公務員者，謂下列人員：\n一、甲。\n二、乙。'), '2026/11/07');
  console.log('1', JSON.stringify(res));
  const dir = root.dirs.get('法規').dirs.get('中華民國刑法');
  const f10 = '中華民國刑法第10條.md';
  console.log('---- 第10條（新建）\n' + dir.files.get(f10));
  console.log('---- 第11條\n' + dir.files.get('中華民國刑法第11條.md'));
  // 使用者加筆記與自訂屬性、別名
  let t = dir.files.get(f10).replace('## 筆記\n', '## 筆記\n我的筆記：公務員定義很重要。\n').replace('tags:', '重要度: 高\ntags:').replace('  - 刑法第10條', '  - 刑法第10條\n  - 公務員定義');
  dir.files.set(f10, t); dir.writes.length = 0;
  res = await run(raw('稱以上者。\n稱公務員者，謂下列人員：\n一、甲。\n二、乙。'), '2026/11/08');
  console.log('2 same', JSON.stringify(res), 'writes', dir.writes);
  assert.equal(dir.writes.length, 0);
  res = await run(raw('稱以上、以下者。\n稱公務員者，謂下列人員：\n一、甲。\n二、乙。'), '2026/11/09');
  console.log('3 amended', JSON.stringify(res));
  console.log('---- 第10條（修正後）\n' + dir.files.get(f10));
  const s = dir.files.get(f10); assert(s.includes('我的筆記：公務員定義很重要。')); assert(s.includes('重要度: 高')); assert(s.includes('公務員定義')); assert(s.includes('> [!note]- 修正前條文'));
  res = await run(raw('稱以上、以下者。\n稱公務員者，謂下列人員：\n一、甲。\n二、乙。', [{ArticleType:'A',ArticleNo:'第 10-1 條',ArticleContent:'新增條。'}], true), '2026/11/10');
  console.log('4 insert+drop', JSON.stringify(res));
  console.log('---- 總覽\n' + dir.files.get('中華民國刑法.md'));
    // 結束標記前有空行，最後一個 ^p 才不會在閱讀模式露出；修正前條文不含空行
  assert(/\^p2\n\n%% 條文結束 %%/.test(dir.files.get(f10)));
  assert(!/> \n/.test(dir.files.get(f10).split('[!note]')[1].split('## 筆記')[0]));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });

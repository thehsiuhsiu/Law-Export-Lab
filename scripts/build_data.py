"""
從法務部全國法規資料庫下載法規資料，拆成網頁用的小檔案。

輸出（以 data/ 為例）：
  data/version.json        很小，網頁每次打開都先讀這個檔比對版本
  data/index.json          全部法規的名稱、修正日期、檔案代號
  data/laws/<代號>.json     一部法規一個檔

用法：
  python scripts/build_data.py _site/data                 # 從法務部下載
  python scripts/build_data.py _site/data --zip a.zip ...  # 用本機 zip 測試

資料來源：法務部全國法規資料庫，依政府資料開放授權條款第 1 版釋出。
"""
import argparse
import hashlib
import io
import json
import sys
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from pathlib import Path

SOURCES = [
    ("法律", "https://law.moj.gov.tw/api/Ch/Law/json"),
    ("命令", "https://law.moj.gov.tw/api/Ch/Order/json"),
]
MIN_LAWS = {"法律": 500, "命令": 1000}  # 筆數太少代表下載有問題，就不要部署
REQUEST_TIMEOUT = 300


def download(url):
    import requests
    import urllib3
    last_error = None
    for attempt in range(1, 4):
        try:
            try:
                res = requests.get(url, timeout=REQUEST_TIMEOUT)
            except requests.exceptions.SSLError:
                # 法務部網站的憑證鏈有時不完整，原本的程式也是用 verify=False
                urllib3.disable_warnings()
                res = requests.get(url, timeout=REQUEST_TIMEOUT, verify=False)
            res.raise_for_status()
            return res.content
        except Exception as e:  # noqa: BLE001
            last_error = e
            print(f"  第 {attempt} 次下載失敗：{e}")
            time.sleep(10 * attempt)
    raise RuntimeError(f"下載失敗：{url}（{last_error}）")


def _text(elem, tag):
    child = elem.find(tag)
    return child.text if child is not None and child.text else ""


def parse_payload(name, raw):
    """回傳 (UpdateDate, [law, ...])；支援 JSON 與 XML。"""
    if name.lower().endswith(".json"):
        data = json.loads(raw.decode("utf-8-sig"))
        return data.get("UpdateDate", ""), data.get("Laws", [])
    root = ET.fromstring(raw)
    update = root.get("UpdateDate") or _text(root, "UpdateDate")
    laws = []
    for law in root.iter("Law"):
        articles = []
        arts = law.find("LawArticles")
        for a in (arts.findall("Article") if arts is not None else []):
            articles.append({
                "ArticleType": _text(a, "ArticleType"),
                "ArticleNo": _text(a, "ArticleNo"),
                # 法務部 XML 的拼字是 ArticleConctent
                "ArticleContent": _text(a, "ArticleContent") or _text(a, "ArticleConctent"),
            })
        laws.append({
            "LawLevel": _text(law, "LawLevel"), "LawName": _text(law, "LawName"),
            "LawURL": _text(law, "LawURL"), "LawModifiedDate": _text(law, "LawModifiedDate"),
            "LawAbandonNote": _text(law, "LawAbandonNote"), "LawHistories": _text(law, "LawHistories"),
            "LawArticles": articles,
        })
    return update, laws


def parse_zip(content):
    z = zipfile.ZipFile(io.BytesIO(content))
    update, laws = "", []
    for name in z.namelist():
        if name.lower().endswith((".json", ".xml")):
            u, ls = parse_payload(name, z.read(name))
            update = update or u
            laws.extend(ls)
    return update, laws


KEEP = ("LawLevel", "LawName", "LawURL", "LawModifiedDate", "LawAbandonNote", "LawHistories")


def slim(law):
    """只留網頁需要的欄位，縮小檔案。"""
    out = {k: law.get(k, "") or "" for k in KEEP}
    out["LawArticles"] = [
        {"ArticleType": a.get("ArticleType", ""), "ArticleNo": a.get("ArticleNo", ""),
         "ArticleContent": a.get("ArticleContent", "")}
        for a in (law.get("LawArticles") or [])
    ]
    return out


def sha(data, n):
    return hashlib.sha1(data).hexdigest()[:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir")
    ap.add_argument("--zip", nargs="*", help="測試用：直接讀本機 zip（檔名含 Order 視為命令）")
    args = ap.parse_args()

    collected = []  # (kind, update, laws)
    if args.zip:
        for path in args.zip:
            kind = "命令" if "order" in Path(path).name.lower() else "法律"
            update, laws = parse_zip(Path(path).read_bytes())
            collected.append((kind, update, laws))
    else:
        for kind, url in SOURCES:
            print(f"下載{kind}資料：{url}")
            update, laws = parse_zip(download(url))
            print(f"  {len(laws)} 筆，資料日期 {update}")
            if len(laws) < MIN_LAWS[kind]:
                raise SystemExit(f"{kind}只有 {len(laws)} 筆，少於 {MIN_LAWS[kind]}，判斷為下載異常，停止部署。")
            collected.append((kind, update, laws))

    out = Path(args.out_dir)
    (out / "laws").mkdir(parents=True, exist_ok=True)
    sources, entries, seen = {}, [], set()
    for kind, update, laws in collected:
        sources[kind] = update
        for law in laws:
            name = (law.get("LawName") or "").strip()
            if not name or name in seen:
                continue
            seen.add(name)
            body = json.dumps(slim(law), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            law_id = sha(name.encode("utf-8"), 16)
            (out / "laws" / f"{law_id}.json").write_bytes(body)
            entries.append({
                "n": name, "lv": law.get("LawLevel", "") or kind,
                "m": law.get("LawModifiedDate", "") or "",
                "ab": law.get("LawAbandonNote", "") or "",
                "id": law_id, "h": sha(body, 12),
            })
    entries.sort(key=lambda e: e["n"])
    # 版本只看內容，資料沒變動時版本號也不變，網頁就不會重新下載
    version = sha(json.dumps([entries, sources], ensure_ascii=False, sort_keys=True).encode("utf-8"), 12)
    now = datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    index = {"version": version, "sources": sources, "generated": now, "laws": entries}
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out / "version.json").write_text(json.dumps(
        {"version": version, "sources": sources, "generated": now, "count": len(entries)},
        ensure_ascii=False), encoding="utf-8")
    print(f"完成：{len(entries)} 部法規，版本 {version}")


if __name__ == "__main__":
    sys.exit(main())

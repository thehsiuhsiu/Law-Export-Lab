# 法規查閱與匯出（Law-Export-Lab）

在瀏覽器查閱全國法規資料庫的法律與命令，並匯出成 Word（.docx）或 Markdown（.md，適合 Obsidian）。

## 功能

- 搜尋法規名稱，網頁上直接閱讀條文；有編章節目錄、條文內容搜尋、跳到指定條號，每一條都可以一鍵複製
- 下載 Word：有目錄（點了會跳到該編章節）、標題層級（Word 導覽窗格可用）、A4 版面、頁碼
- 下載 Markdown：目錄使用 Obsidian 的 `[[#標題]]` 連結
- **自動更新**：GitHub Actions 每天從法務部抓一次資料。使用者打開網頁時，網頁會先比對一個很小的版本檔，有新資料才下載，而且只重抓有修正的法規，並顯示「已更新」提示
- 看過的法規會存在瀏覽器裡，連不上網路時仍可閱讀上次保存的版本
- 備用模式：也可以把法務部下載的 zip 檔拖進網頁使用

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 網頁本體（所有功能都在這個檔案裡） |
| `vendor/jszip.min.js` | 讀取 zip、產生 Word 檔用的套件 |
| `scripts/build_data.py` | 下載法務部資料，拆成一部法規一個檔案 |
| `.github/workflows/update-data.yml` | 每天臺灣時間 03:17 執行上面的程式並部署網頁 |

法規資料不放在 repo 裡，每次部署時才從法務部下載，所以 repo 很小。

## 第一次設定

1. 到 repo 的 **Settings → Pages**，把 **Source** 改成 **GitHub Actions**
2. 到 **Actions** 頁面，選「更新法規資料並部署網頁」→ **Run workflow**
3. 完成後，網址會是 `https://thehsiuhsiu.github.io/Law-Export-Lab/`

## 注意

- 如果 repo 連續 60 天沒有任何更新，GitHub 會自動暫停每天的排程，並寄信通知。這時到 Actions 頁面按 **Enable workflow** 就能恢復。
- 法務部的資料下載如果失敗，或筆數明顯不對，這次就不會部署，網頁會繼續使用上一版資料。

## 資料來源

法務部全國法規資料庫，依[政府資料開放授權條款第 1 版](https://data.gov.tw/license)釋出。條文以全國法規資料庫公告為準。

# Phase 8B：GitHub Pages 部署準備

> 歷史階段紀錄（Historical）：以下保留當時的測試數、Commit、Run ID、部署與開關狀態，不代表目前 production；2026/10/29 正式狀態以 [README](../README.md) 為準。

2026-10-20：Repository https://github.com/Duke11111/dailyinfo 已公開，main 基線 `399edd1`。Pages 尚未部署，預定網址 https://Duke11111.github.io/dailyinfo/ 不是已上線驗收結果。Repository Actions 仍 disabled，兩個 DATA 開關未設定。本階段只修改本機公開版，未 Commit、Push、建立 Pages、執行雲端 workflow 或設定 Secrets。

## 子路徑與離線驗收

Vite 預設 base `/dailyinfo/`。JSON 服務使用 `import.meta.env.BASE_URL`，Vite 重寫 HTML 的 favicon／JS／CSS，Leaflet CSS 圖片由 Vite 打包。行政區 JSON 直接編入模組；沒有外部字型。Hash Router 的 `#/overview`、`#/weather`、`#/stocks`、`#/news`、`#/earthquakes`、`#/settings` 都在同一 index.html 後切換，不需 Pages rewrite。

Open-Meteo 天氣／AQI 與 OSM 圖磚維持既有 HTTPS 外部網址；本機驗收不呼叫這些 API。正式來源的 CORS／可用性仍受提供者影響，包括原有 TWSE 歷史查詢限制。localStorage 結構完全保留；公開網站與本機是不同 origin，瀏覽器不會自動搬移既有偏好／自選股／收藏。

```powershell
npm.cmd test
npm.cmd run build -- --base=/dailyinfo/
npm.cmd run verify -- --dist
npm.cmd run preview -- --port 4173 --strictPort
```

本機網址 http://127.0.0.1:4173/dailyinfo/ 。verify 只讀快照、驗證 schema／日期、公開檔案及 dist 的秘密／私人路徑／個人 webmail 格式、HTML／CSS 資源與五份 JSON 的子路徑及原檔一致性，不讀 .env.local、不更新來源。未知秘密的精確值無法在不讀取秘密的情況下逐一比對；不宣稱能辨識所有私人資料。截圖沿用既有隱私稽核成果。

## 獨立手動部署

`.github/workflows/pages-manual.yml` 只有 workflow_dispatch，只允許預設分支。Node 24、npm ci --ignore-scripts、完整測試、子路徑建置、離線驗證成功後才上傳 dist。build 只有 contents:read；deploy 才有 pages:write／id-token:write，使用 github-pages environment。沒有 Secrets、資料更新、push／schedule 觸發器。官方四個 Actions 的固定 SHA 已再次查證，見 ACTIONS_PINS.md。

資料 workflow 同樣只有 workflow_dispatch，仍需 DATA_AUTOMATION_ENABLED=true 才能更新；DATA_PUBLISH_ENABLED 未設定就不會從資料流程發布網站。Pages 首次發布不應設定這兩個開關。

## 下一次授權後的最小操作順序（本階段不執行）

1. Actions 維持停用，審閱並 Commit／Push 本機 Phase 8B 變更，先讓遠端 main 的兩個 workflow 都只剩手動觸發。不要先啟用目前仍帶 schedule 的遠端舊檔。
2. 再確認遠端 workflow、Secrets／Variables 及 SHA；兩個 DATA 開關保持未設定／false。不需新增任何 Secret。
3. 取得部署授權後，啟用 Repository Actions；Pages 的 Settings → Pages → Source 選 GitHub Actions。確認 github-pages environment 只允許 main；必要時設定人工審閱。
4. 只手動執行「DailyInfo Pages (manual only)」的 main 分支。驗證 build、deploy 成功及正式網址、資源、Hash 頁面與真實快照日期。不要執行 data update workflow。
5. 停止後續部署：停用 pages-manual workflow 或整個 Repository Actions，取消尚未完成的部署。已發布網站會繼續提供最後版本；若需下線，另行授權使用 Pages 的 Unpublish site，不要把停用 Actions 誤稱為網站下線。

## Phase 8D 才能恢復排程

先取得資料更新授權，確認來源規範／免費額度、CWA Secret、checkpoint 初始化與更新失敗保留舊快照。才在 data-update.yml 的 on 下恢復 schedule（原 cron：`17 1,4,7,10,13,16,19,22 * * *`，UTC），先重新評估頻率，修改對應測試、審查及 Push。手動驗證更新後才開 DATA_AUTOMATION_ENABLED；資料發布另需 DATA_PUBLISH_ENABLED 與目標授權。首次 Pages 部署不包含這些操作。

官方參考：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

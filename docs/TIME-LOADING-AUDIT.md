# 日期、時間與資料載入稽核

本機驗證日期：2026-10-25（Asia/Taipei）。基準 Commit：36bc081a61c82d80b2a832d4e6dedd2dab234b05。
所有修正保留於隔離分支 `fix/taipei-time-swr`；未提交、推送、部署或修改雲端設定。

## 查得的根因與證據

- 正式站 quotes.json 的 tradeDate 為 2026-10-21，fetchedAt 為 2026-10-22T05:16:45.604Z；同期唯讀 TWSE 回應 Date=1151022，解析為 2026-10-22，共 1,383 筆。
- 這是已發布快照落後於目前來源，不能用「今天」或下載時間改寫交易日。既有排程可能因延遲、週末或 source_delayed 未更新；僅憑這次來源查詢，不能斷言當時 API 已提供同樣資料。
- 使用既有 Origin 請求標頭與不加該標頭，當次都取得 10/22；未證實該標頭是原因。
- 既有首頁各摘要已獨立載入，沒有證據顯示最慢 API 阻塞全頁。主要問題為：天氣重新載入時移除可用舊資料；股票、新聞、地震快照僅記憶體快取，重整後重新等待；股票跨月歷史查詢及五分類 RSS 逐筆等待。
- 原程式多處已有 Taipei 日期處理及日期驗證，不能宣稱所有日期錯誤都來自 UTC。本次收斂共用工具，並補足持久快取與防倒退。

## 時間規則

- `src/lib/time.js` 統一「現在」、台灣日期、顯示、日期位移與 elapsed time 判斷。不依賴作業系統、瀏覽器或 Runner 的本地時區。
- timestamp 必須有 Z 或明確 offset。ISO Z 保存的是同一個真實時間點，不直接截字串當台灣日期；保留此格式可維持既有 Schema、Checksum 及 Checkpoint 相容性。
- Open-Meteo 請求指定 Asia/Taipei，無 offset 的官方當地時間經驗證後補 +08:00；今日預報按日期尋找，不假定第一筆就是今天。
- 新聞 RSS 的帶時區時間正規化為時間點；CWA 無 offset 的官方當地時間以 +08:00 解讀，明確 Z 仍按 UTC 解讀；最後統一用 Taipei 顯示。來源專屬嚴格格式檢查保留。
- `tradeDate` 是既有資料模型的 tradingDate，只取官方成交日期。`fetchedAt` 是取得資料時間；新 `updatedAt` 僅由統一更新入口在內容實際變動、驗證完成後產生。舊快照沒有 updatedAt 時顯示「來源未提供」，不冒充新資料。
- 超過 24 小時以 now-fetchedAt 計算，與日期字串跨日無關。週末、休市不補造股價；歷史圖表不超過已驗證 tradeDate。
- GitHub Actions 不必更改 Runner 時區：更新腳本與 due 判斷共用 Taipei 工具，寫入明確 ISO 時間點。Cron、安全閘門、Manifest、Checkpoint v2 及 status v1 格式均未改動。

## 新載入流程

1. 首頁四個模組獨立啟動；先驗證並同步讀取各自持久快取，立即顯示真實資料日期與擷取時間。
2. 快取 TTL 已到才背景更新；按鈕可明確重新讀取。更新中不清空既有內容；失敗保留最後有效資料及錯誤提示。
3. 股票、新聞、地震先讀已發布靜態 JSON；不讓每位訪客直接抓全市場資料。較舊來源日期、fetchedAt 或已知 updatedAt 不能覆蓋較新記錄。
4. 同來源待完成請求共用；天氣保留行政區隔離、請求取消及世代檢查。損壞快取不清空、不覆寫，不動既有使用者地區、收藏、自選及行程。
5. 股票跨月歷史與五分類 RSS 改平行請求。CWA 授權請求仍依序執行，第一筆失敗立即停止，避免在授權失敗後繼續請求；不為平行化犧牲安全測試。

TTL 集中於 `src/services/cache-policy.js`：天氣 15 分鐘；新聞／地震 5 分鐘；股票已發布快照平時 30 分鐘，盤後落後或快照超過 24 小時改 5 分鐘；股票目錄 24 小時；歷史資料 30 分鐘；AQI 快取 5 分鐘、前景刷新 30 分鐘。
持久記錄超過 7 天強制視為需要刷新，但仍保留有效舊資料作為明確標示的 fallback。
互動 API 與來源更新 HTTP 請求上限 8 秒。天氣僅對來源日期錯誤保留原有最多兩次嘗試，網路錯誤不自動重試。Guard／控制面請求及整體子程序期限不冒充頁面 API timeout。

## 實測

隔離 Chrome，localhost Vite 開發模式，瀏覽器時區 America/Los_Angeles；不使用使用者原有 localStorage。下列為單次觀察，含開發模式模組成本，不是 Production SLA。

| 項目 | 結果 |
|---|---|
| 冷啟動股票／新聞／地震可見 | 約 530 ms |
| 冷啟動天氣可見 | 約 1,427 ms |
| 暖快取四卡可見 | 約 151 ms |
| page-init | 9.1 ms |
| 天氣真實 HTTP duration | 1,109 ms |
| 本機股票／新聞／地震 JSON HTTP duration | 7／6／5 ms |
| 股票／新聞／地震 loader（含解析與回呼） | 209.5／211.6／215.4 ms |
| 天氣 loader | 1,120.4 ms |
| 卡片 render／cache-render | 約 0.1～2.4 ms |
| 模擬天氣等待 6 秒 | 舊天氣保留，新聞更新可獨立完成 |
| 模擬天氣回應晚於 timeout | 約 8,067 ms 停止等待，保留舊天氣與逾時提示 |

另一次 Node 唯讀真實網路樣本：TWSE 333 ms，正式站 quotes/news/earthquakes JSON 583／275／254 ms。這不是瀏覽器 CORS 或正式站完整 cold start 量測。
驗證過程也遇過天氣、AQI 及即時星座網路失敗；沒有掩蓋失敗或用假資料替代。無快取且來源不可用時仍只能顯示錯誤，不可能保證即時資料必然成功。

本機 Chrome 使用本次真實 TWSE 回應，僅透過隔離測試 transport 提供給本機卡片：顯示「最近交易日：2026-10-22」，隨後收到原本 10/21 JSON 時拒絕倒退，仍保留 10/22。未改寫正式或本機 public/data。
390px 視窗沒有頁面水平溢出，七日預報仍為七筆。瀏覽器位於洛杉磯時區，首頁日期仍正確顯示台灣 2026-10-25。

開發量測透過固定名稱 Performance measures 提供，不列印使用者資料、網址或回應本文；Production 關閉。
詳細量測與測試輸出僅放在忽略的 .cache，不能提交瀏覽器暫存檔。

## 驗收與限制

- 完整 Vitest：59 個檔案，931／931 通過（原 911 加 20 個測試）。
- 覆蓋台灣午夜、UTC 跨日、10/21→10/22、週末／無交易資料、23h59m／24h01m、快取損壞／quota、請求去重、獨立載入、跨 tab 防倒退、舊天氣 fallback 及平行歷史請求。
- Production Build 成功；公開產物、隱私、快照與部署離線檢查成功。
- 依賴及 lockfile 未變更。npm audit 仍回報既有 Vitest／@vitest/mocker 兩個 moderate 開發依賴項目，未擅自升級或宣稱依賴漏洞為零。
- 正式資料、Workflow、Cron、發布 Guard、使用者儲存格式及其他工作樹不變；沒有外部資料更新或部署。
- 正式站目前仍可能顯示 10/21；本機修復不等同已取得／發布新的雲端行情。要讓正式站更新，需要另行授權提交與受 Guard 保護的雲端驗證／發布，不能直接改日期或覆蓋快照。

## 修改檔案（45 檔）

- docs/TIME-LOADING-AUDIT.md
- scripts/automation-state.mjs
- scripts/check-regions.mjs
- scripts/import-stocks.mjs
- scripts/lib/checkpoint-policy.mjs
- scripts/lib/cwa-earthquake.mjs
- scripts/lib/data-automation.mjs
- scripts/lib/horoscope-import.mjs
- scripts/lib/news-rss.mjs
- scripts/lib/source-schedule.mjs
- scripts/lib/update-state.mjs
- scripts/lib/update-summary.mjs
- scripts/update-earthquakes.mjs
- scripts/update-news.mjs
- scripts/update-quotes.mjs
- src/components/air-quality.js
- src/components/horoscope.js
- src/components/today-agenda.js
- src/components/weather.js
- src/lib/earthquake-format.js
- src/lib/format.js
- src/lib/time.js
- src/lib/timing.js
- src/main.js
- src/pages/earthquakes.js
- src/pages/news.js
- src/pages/overview.js
- src/pages/stocks.js
- src/services/air-quality.js
- src/services/auto-refresh.js
- src/services/cache-policy.js
- src/services/calendar-events.js
- src/services/earthquakes.js
- src/services/horoscope-live.js
- src/services/horoscope.js
- src/services/news.js
- src/services/quotes.js
- src/services/snapshot-store.js
- src/services/stock-catalog.js
- src/services/stock-history.js
- src/services/weather-session.js
- src/services/weather.js
- tests/auto-refresh.test.js
- tests/swr-loading.test.js
- tests/time-policy.test.js

# 臺灣銀行牌告匯率來源與使用方式

## 官方 HTML 備援（本機實作，未提交／未雲端驗收）

本節為最新設計；下列 Phase 8D-1.x 記錄保留為歷史。遵守本次禁止外部請求的限制，僅檢視既有來源紀錄、解析程式與公開快照，沒有重新連線查核官方條款或目前頁面結構。HTML 固定測試樣本為清楚標示的合成資料，不是擷取的真實銀行回應；不能據此宣稱 GitHub Runner 已可成功取得官方 HTML。

重用原有 HTML 幣別／四類報價解析。updateExchange 的 allowHtmlFallback 預設 false；既有 update-exchange CLI 明確傳入 true。只有 CSV 端點成功回應但 MIME 恰為 text/html 時，才另外 GET 固定的官方牌告頁 EXCHANGE_SOURCE；絕不解析 CSV 端點的 HTML 本文。CSV 正常時仍逐幣逐欄與官方 HTML 核對，不因 CSV 格式錯誤、價格不一致、403、429、redirect、逾時或其他 MIME 而退到 HTML。每輪仍最多兩個一般 GET、無重試／代理／繞過限制，UTF-8、HTTP、逾時與大小限制不變。

HTML-only 必須有完整 HTML 文件外框、官方標題、唯一牌告時間及唯一匯率表；表頭的幣別、現金／即期欄群與銀行買入／賣出順序、每列四個唯一欄位、19 種固定幣別及名稱皆需符合。缺列、重複列／欄、未知幣別、空白值、異常數值、買入大於賣出、錯誤／防護頁、頁面轉址、無效或未來日期均拒絕。明確的 -／--／零佔位保留為 null，不填造數字；全無報價的幣別拒絕。官方結構或幣別清單改動會停止更新，需另行審查，不能自行放寬。

新快照 evidence 明示 mode=html-only、reason=csv_text_html、validation=official-table-19-v1 及 htmlSha256，不產生 csvSha256，也不能夾帶假 CSV 證據。downloadUrl 仍是既有官方下載參考，並不代表該次取得 CSV。匯率頁顯示未進行 CSV 交叉核對。原有雙來源 evidence、version=1 與前端讀取保持相容，Checkpoint 仍驗證五份資料、schema、checksum 與來源日期；失敗仍保留舊快照並以原有白名單數字 exit status 回報。

相比雙格式核對，HTML-only 能驗證來源端點、結構、完整性、值域、時間及舊檔日期不倒退，但無法獨立驗出結構正確且看似合理的官方 HTML 誤值。HTML SHA-256 僅代表此次內容摘要，並非銀行數位簽章、真實性證明或另一份獨立資料。此限制必須隨快照如實記錄。

後續另行授權後，先確認 schedule 關閉、發布 false、部署目標未設定，審查並只提交本次檔案；以一次 source=exchange、initialize_state=false、publish_current=false 的 main 手動 Run 驗收。CSV 一次 GET；若遇已知 text/html，才請求官方 HTML 一次。核對 updated／unchanged／failed、安全錯誤碼、19 幣別、四種報價、牌告時間、HTML-only evidence 與新 checkpoint；比較其他四份快照及正式站雜湊不變。不重新初始化、不重試、不部署。若官方 HTML 仍是防護頁或未符合結構，停止並回報，不能宣稱已修復連線問題。

## Phase 8D-1.3：端點／MIME 精準診斷（本機未提交）

只在 MIME 不符時回報固定代碼，例如 `unexpected_content_type_csv_text_plain`、`unexpected_content_type_html_application_json`。`csv`／`html` 是程式內固定端點標籤，不是伺服器網址。MIME 僅分類為 text/plain、text/html、text/csv、application/octet-stream、application/json、missing、other；參數、任意型別及伺服器文字不進入代碼。

14 種端點／MIME 組合追加於既有 exit status 表尾（85–98），舊代碼 64–84 不變，原 checkpoint 的 `unexpected_content_type` 仍相容。CLI、統一入口及 checkpoint 沿用數字狀態與白名單，不解析／轉印子程序原始輸出。

本階段沒有放寬接受條件：CSV 仍只接受 text/csv，牌告頁仍只接受 text/html；不符便停止、不讀本文、不覆寫舊資料。HTTP、編碼、CSV／HTML 核對、日期及原子寫入規則不變。只以 Mock 測試，不請求銀行、不 Commit／Push 或執行 Actions。後續另行授權上傳後，原則上只需一次 exchange-only（initialize_state=false、publish_current=false）取得真實分類，再決定是否有合理的 MIME 相容性調整，不能先接受未知資料。

本機驗收：`npm.cmd test -- tests/exchange-update.test.js tests/exchange.test.js tests/data-automation.test.js`，3 檔、95/95 通過；涵蓋兩端點、全部 MIME 分類、大小寫／參數去識別、異常本文不讀取、舊快照位元組保留、數字子程序傳遞與 checkpoint 相容性。未重跑全套或建置，公開資料及 workflow 未變。

## Phase 8D-1.1：安全診斷（本機未提交）

首次雲端 Run `39371257503` 僅留下 exchange 的 `update_failed`；子程序與統一入口原先都丟棄細節，不能事後判定銀行故障、封鎖、CSV／HTML 競態或解析問題。本階段不請求銀行、不重新觸發 Actions，只用 Mock 驗證診斷。

新增白名單代碼：`network_error`、`dns_error`、`tls_error`、`connection_error`、`request_timeout`、`http_403`、`http_429`、`http_5xx`、`http_error`、`redirect_error`、`unexpected_content_type`、`encoding_error`、`response_too_large`、`csv_format_error`、`quote_time_error`、`csv_html_mismatch`、`parse_error`、`date_regression`、`previous_snapshot_invalid`、`filesystem_error`，以及未知情況的 `update_failed`。

匯率子程序只以 64 起算的固定數字 exit status 傳遞代碼；統一入口不讀取／轉印子程序輸出來決定代碼。非白名單或其他來源仍回到既有通用錯誤。CLI 只輸出固定句型與固定代碼，JSDOM parser console 也隔離，不轉印原始錯誤、HTTP 本文、Cookie、Location 或標頭。Redirect 採 manual 後直接拒絕所有 3xx，不會跟隨或繞過限制。UTF-8 解碼出現替代字元或不支援的 charset 會拒絕，不猜測轉碼。

保留 CSV／HTML 逐幣逐欄核對、牌告時間與日期倒退驗證、舊快照驗證和同目錄暫存後 rename。checkpoint 的 exchange 失敗狀態可保存新代碼，原 `update_failed` 格式仍可恢復，其他四個來源不接受匯率專用代碼。

後續須另行授權：審查、Commit／Push 本機修正後，只執行一次 exchange-only workflow（main、source=exchange、initialize_state=false、publish_current=false）。該更新腳本最多兩次官方 GET（CSV 一次、HTML 一次；前者失敗則不發第二次），無重試；發布保持關閉，不設定排程。先說明並取得真實請求授權，才執行；本階段未進行這些動作。

查核日期：2026/10/20。本次使用臺灣銀行官方下載與官方牌告網頁，不使用中間市場或其他銀行資料。

## 官方來源及授權

- 牌告頁：<https://rate.bot.com.tw/xrt?Lang=zh-TW>。
- 頁面明示的官方 CSV 下載：<https://rate.bot.com.tw/xrt/flcsv/0/day>；另有純文字下載，但本專案沒有使用。
- [政府網站資料開放宣告](https://www.bot.com.tw/tw/footer/related-links/open-data-statement)實際載入後載明，網站資料在著作權範圍採用[政府資料開放授權條款第 1 版](https://data.gov.tw/license)，可無償利用並須註明出處，不表示銀行背書；商標、標誌及特別聲明的第三方素材不在一般授權內。本專案僅整理文字及數值，不使用銀行標誌。
- [引用本行資訊說明](https://www.bot.com.tw/tw/footer/related-links/copyright-notice)要求標明臺灣銀行來源，不得收取資料查詢費等營利利用，不能未經同意用作銀行網路行銷；如使用框架連結應另開視窗。本專案為免費課堂展示、無交易／營利行銷，以一般另開分頁來源連結呈現，不嵌入銀行頁面。
- 官方政策正文由前端載入，首次純 HTML／搜尋結果沒有完整條文，因此另以 Chrome 實際閱讀兩頁正文；沒有將空白政策頁當成授權證明。
- `robots.txt` 明列允許 `/xrt*`。一般 Node.js 請求官方 CSV 與 HTML 成功 HTTP 200，未繞過限制、登入、驗證或付費。官方未在本次查核資料中承諾固定請求配額，本專案不假設無限存取；只在維護者執行指令時取得兩個資源，不自動重試或輪詢。

## 格式、時間及缺值

官方 CSV 以 UTF-8 文字回傳，欄位包含「幣別、匯率、現金、即期、遠期…、匯率、現金、即期、遠期…」；同列買入與賣出分開。只取現金／即期的買入／賣出四欄，不把遠期欄位當作即期。

CSV 本身沒有銀行牌告時間。更新腳本先下載 CSV，再讀官方 HTML，按幣別逐一核對四個數值及完整幣別範圍，全部一致後才採用網頁的「牌價最新掛牌時間」。若下載期間報價變動導致不一致，立即停止並保留舊快照，請維護者稍後手動重試；不無限嘗試。非營業時間頁面標題可能使用前一營業日，不拿標題日期或檔案下載／HTTP 日期充當牌告時間。

CSV 的 `0.00000` 在無報價欄位是佔位值，與 HTML 的 `-` 比對後轉為 `null`，前端顯示「未提供」。不拿其他現金／即期／買賣欄位替代，也不將零匯率拿來換算。驗證 ISO 幣別、數值精度／範圍、買入不高於賣出、日期、來源網址及重複幣別，保存兩份來源文字的 SHA-256 作為查核依據，不保存原 HTML 或遠期資料。

## 本次真實快照

銀行牌告：**2026/10/20 00:42（臺灣）**。快照擷取：**2026/10/20 00:57:45.688（臺灣）**。共 **19 種**：USD、HKD、GBP、AUD、CAD、SGD、CHF、JPY、ZAR、SEK、NZD、THB、PHP、IDR、EUR、KRW、VND、MYR、CNY。

報價基準皆為每 1 單位外幣折合的新臺幣：

| 幣別 | 現金買入 | 現金賣出 | 即期買入 | 即期賣出 |
| --- | ---: | ---: | ---: | ---: |
| USD | 32.045 | 32.715 | 32.37 | 32.52 |
| JPY | 0.1955 | 0.2083 | 0.2023 | 0.2073 |
| EUR | 35.57 | 36.91 | 36.085 | 36.685 |
| KRW | 0.02261 | 0.02651 | 未提供 | 未提供 |

這是實際牌告快照，非成交保證、即時中間價或價格預測。所有來源有的幣別均可查詢，未提供的報價欄位保留缺值。

## 換算公式與精度

- 外幣換新臺幣：金額 × 對應現金／即期的銀行買入價。
- 新臺幣換外幣：金額 ÷ 對應現金／即期的銀行賣出價。
- 不取買賣平均價。以 BigInt 定點運算處理金額與最多五位小數的原始報價，結果四捨五入至六位小數，不套用未提供的銀行結算／現鈔最小單位規則。
- 金額可為零及小數，最多六位小數、上限一兆；負數、空白、非數字、指數格式、逗號及超限輸入顯示錯誤，不自動變成零。缺報價時即使金額為零也不能假裝可以換算。
- 結果明示「依牌告匯率估算」，不考慮未提供的手續費或其他交易成本，非匯款／交易服務。

## 更新及公開網站

```powershell
npm.cmd run update:exchange
```

每次最多兩個一般官方 HTTP 請求，各有 20 秒逾時，無自動重試。先驗證新資料及既有快照，再寫入同資料夾暫存檔並原子替換 `public/data/exchange.json`；失敗、格式不符、既有資料損壞或時間倒退均拒絕覆寫有效舊資料。

更新後重新建置／發布 `dist/`。瀏覽器只讀網站自己的 JSON，五分鐘記憶體快取、十秒手動重讀間隔，共用單次進行中請求，不向銀行逐幣或逐輸入要求資料。網頁重讀不是更新官方牌告；教師查看已發布快照無須帳號或金鑰。牌告或快照擷取超過 24 小時顯示可能過期，假日也照實列時間。前端沒有寫入或清除 localStorage。

# DailyInfo 每日資訊整合平台

Phase 8F 已完成並發布 Chart.js 股票五日走勢：沿用 TWSE 歷史服務，僅顯示行情快照交易日以前最近五筆有效收盤價；支援價格提示、主題、字級與手機版。使用免費 MIT Chart.js 4.5.1，授權保留於 public/licenses。

Phase 8H-2C 已完成並發布免費 [個人行事曆](docs/CALENDAR.md)：繁中月曆、月份切換、新增／編輯／確認刪除行程、全天與跨日時間、五色及獨立 localStorage 保存；首頁顯示臺灣日期的今日行程（最多五筆，可點擊查看），支援全站主題及字級；不提供同步或提醒。

Phase 8G-D2 已提交／推送三時段排程與有限補跑改造（`d315796`），D3 手動雲端更新 Run `39727082746` 成功，其資料後續納入單次核准發布。依使用者確認 D4 一次性 schedule 未觸發、臨時開關已清理；D5 自動發布尚未完成雲端驗收。長期排程與自動發布尚未啟用。四來源更新、獨立發布授權、Checkpoint v2 相容性、Artifact 防護與維護方式見 [自動更新文件](docs/AUTOMATIC-UPDATES.md)。正式 UI 已於 Phase 9B-6 單次部署。

D5-Guard 已在 `test/d5-integration` 整合至 `ee30aed`，仍僅為尚未推送的本機候選版：[正式資料防倒退與部署互斥](docs/PUBLISH-GUARD.md)。`DATA_SCHEDULE_MODE` 必須明確選擇 d4 或 continuous，未設定就拒絕排程；更新授權與發布授權分離。首次基線機制已實作：只接受明確手動核准的 Deployment／五份 SHA-256、有限期限與 approval digest；初次發布不更新資料，仍須完整 Guard。雲端接軌與自動發布均未執行，需另外授權。

## Phase 8H-1：最終繳交範圍

保留天氣／AQI、股票自選與盤後行情、新聞收藏、地震地圖、每日星座及全站設定。已停止開發的匯率功能不包含於目前 UI、更新入口或公開資料。四來源遷移與匯率移除已正式發布，舊五來源 Checkpoint 先完整驗證再遷移；詳見 [自動化說明](docs/AUTOMATION.md) 與 [驗收紀錄](VALIDATION.md)。本機備份分支 backup/pre-remove-exchange-20261020 可還原移除前版本。

> Repository 已公開：[Duke11111/dailyinfo](https://github.com/Duke11111/dailyinfo)，首次提交 `399edd1`，不含原始 Git 歷史。[正式網站](https://duke11111.github.io/dailyinfo/) 已上線，Actions 已支援經授權的手動更新／部署；長期自動化仍關閉。歷史準備文件：[Pages 安全部署說明](docs/PAGES.md) · [公開準備與身分狀態](docs/PUBLIC_CANDIDATE.md) · [Actions SHA 查證](docs/ACTIONS_PINS.md)。

期中專案，展示日期 **2026/10/30**。DailyInfo 每日資訊整合平台提供天氣／AQI、股票、新聞、地震、星座與個人行事曆。UI 精修與首頁獨立天氣地區已完成 Phase 9B-6 單次發布。介面不以內部開發階段或未制定的發布版本號作為展示標示。正式發布前的資料保護流程見 [發布前檢查](docs/PRE-RELEASE.md)。

使用 Vite、Vanilla JavaScript ES Modules、HTML5、CSS3 與 Vitest。繁體中文介面，無資料庫及登入功能。

## 本地啟動

### Phase 6D：資料自動更新準備

已新增統一入口 `npm.cmd run update:data`、指定來源 `npm.cmd run update:data -- --sources=quotes,news` 及驗證 `npm.cmd run verify:data`。`--scheduled` 是 Workflow 專用的到期檢查入口，需完整的事件、模式與授權 context，直接在本機無設定執行會拒絕。各來源隔離執行、驗證後才替換；失敗保留舊快照，內容未變不重複發布。天氣與 AQI 維持原有前端查詢。

資料更新工作流程保留手動入口與預設關閉的三時段 schedule，更新、排程、自動發布授權分離。既有 CWA Repository Secret 僅供地震更新使用，前端不需金鑰。實際雲端開關及最新有效 Checkpoint 須操作前重新確認。[目前自動更新狀態](docs/AUTOMATIC-UPDATES.md)；[Phase 8B 說明](docs/PAGES.md) 為歷史部署準備紀錄。舊基線 `7fed01f` 僅為開發紀錄，不在公開 Git 歷史內。

建議 Node.js 24 LTS。本次環境：Node.js 24.19.0、npm 11.17.0。

```powershell
npm.cmd ci
npm.cmd run dev -- --port 5173 --strictPort
```

開啟 <http://127.0.0.1:5173/dailyinfo/>。Windows PowerShell 使用 `npm.cmd` 可避免修改執行原則或 PATH。開發伺服器只綁定本機。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run preview
node scripts/check-weather.mjs
```

Vite 預設 base 為 `/dailyinfo/`；`preview` 網址為 <http://127.0.0.1:4173/dailyinfo/>。建置輸出為 `dist/`，不可直接以 `file://` 開啟 ES Modules。離線部署驗收：`npm.cmd run build -- --base=/dailyinfo/`，再執行 `npm.cmd run verify -- --dist`；不呼叫外部更新 API。

## Phase 6A：空氣品質與 US AQI

- 沿用 22 縣市、368 鄉鎮市區與既有地區儲存，依同一代表座標查詢 Open-Meteo Air Quality API；臺灣指定 CAMS 全球模式，不增加 API Key、行政區資料或第三方依賴。
- 天氣頁顯示**美國 AQI（US AQI）**、分級文字及色條、PM2.5／PM10（µg/m³）、模式有效時間、API 擷取時間、網頁讀取時間與五分鐘快取期限。這是**模式估計／預報，非臺灣環境部測站實測值**，約 45 km 網格也不代表每個行政區都有獨立測站。
- 顯示有效時段起 24 小時的來源 AQI 預報折線及可展開時間／數值；缺值或缺時段斷線，不補點。綜合 US AQI 直接採 API，不由目前 PM 濃度自行計算。
- 首頁在原天氣卡片內加入精簡 AQI／分級／PM2.5 及完整來源、時間資訊，保留七日天氣摘要，不新增整排卡片。天氣、AQI 及其他模組錯誤彼此隔離。
- 同地區的進行中請求共用，首頁與天氣頁共用短期記憶體快取；切換地區取消舊請求並防止舊回應覆蓋。快取未到期時切換頁面會明示讀取快取；「重新查詢空氣品質 API」會重新查 API，天氣原按鈕仍只更新天氣。
- 更新失敗只可保留同地區舊資料，明示失敗及原時間；快取過期、有效時間距今超過六小時均提示。無輪詢、不寫入或清除既有 localStorage。

免費服務限非商業用途及官方請求額度，課堂展示屬教學使用；頁面提供 Open-Meteo、CAMS、US AQI 與授權來源。官方規則、分級邊界、解析／快取規則及三地真實查核紀錄見 [data-sources/air-quality.md](data-sources/air-quality.md)。查核紀錄僅供驗收，不當作離線即時資料。

新增：`src/services/air-quality.js`、`src/components/air-quality.js`、`src/air-quality.css`、三個 AQI 測試檔及 `tests/fixtures/air-quality.js`、來源文件與查核 JSON、驗收截圖。修改入口整合、首頁天氣卡片、版本及 README／VALIDATION；未修改既有天氣 API、七日預報 Grid／圖示、行政區資料或其他模組。

## Phase 5.1：市場熱門與股票探索

- 股票搜尋留空時，預設顯示**成交量排行榜**，可切換**漲幅排行榜**或**常見關注**；輸入關鍵字回到原有搜尋結果，清空後恢復探索分類。商品類型篩選同時套用於搜尋與三類探索。
- 排行僅取既有目錄與 TWSE 行情快照共同涵蓋、交易日一致且收盤價／成交量有效的前十名；成交量單位為**股，非張、非成交金額**。漲幅另排除無成交、特殊狀態及無法可靠計算的數值；同值以代號排序，榜單可能含零／負漲跌幅，並非完整臺股排行或投資建議。
- 常見關注固定代號為 2330、2317、2454、2303、2881、0050，名稱與類型只採用現有目錄，價格與量額只採用真實快照。不是搜尋人氣排行；未提供行情時顯示「暫無行情」。
- 點探索表格名稱沿用原有股票詳情及按需歷史走勢，加入按鈕使用既有自選群組及重複防護；沒有第二套收藏／群組儲存，也沒有新增依賴或改動更新腳本。
- 首頁選取群組為空時，顯示最多四檔具有有效收盤價的常見關注、交易日與兩個股票入口；已有自選股時維持原本摘要。股票目錄僅在需要空群組摘要時讀取，失敗可單獨重試；不影響其他首頁卡片。
- 此版本沿用 **2026/10/16** 盤後快照，擷取時間為 **2026/10/19 20:11:46（臺灣）**。重新讀取網站不代表交易所已更新行情。

本階段新增 `src/services/stock-exploration.js`、`tests/stock-exploration.test.js`、`tests/stock-exploration-page.test.js` 及驗收截圖；修改股票頁、首頁股票摘要、`src/stocks.css`、首頁測試、入口版本標示、兩份套件版本檔及 README／VALIDATION。其他 API、資料快照與使用者儲存結構未變更。

## Phase 5：四合一每日總覽

首頁 `#/overview` 沿用既有服務、快取、全站外觀及個人資料格式，沒有新增依賴。

- **天氣**：首頁以「變更地區」小型對話框設定一個常用行政區，按「儲存我的地區」才保存，七日預報與 AQI 使用相同地區。首次使用預設臺北市大安區並提示尚未儲存；無法儲存會保留舊選擇。首頁 key 為 `dailyinfo.overview.weather.region.v1`，僅存經官方清單驗證的 `{ id }`，不信任儲存座標；完整天氣頁繼續用 `dailyinfo.region.v1` 自由查詢，兩者互不改寫。天氣／AQI 狀態與請求取消各自獨立，依行政區共用有效快取，前景更新仍為天氣 15 分鐘、AQI 30 分鐘，保留來源及實際取得時間。
- **股票**：預設讀取上次選取的自選群組，顯示前五檔收盤價、帶正負號的漲跌額／幅及最近交易日；可切換首頁摘要群組，不改寫原本群組排序或選擇。空群組提供新增入口，缺值顯示暫無行情。
- **新聞**：依發布時間排序的最新五則中央社新聞，附分類、發布時間、來源與安全原文連結；完整頁的搜尋、分類及收藏維持原樣。
- **地震**：最新三筆官方紀錄，分列規模與最大觀測震度；點位置直接進入該筆詳情與震央定位，無預測／預警功能。
- 各卡片獨立載入、失敗提示及重試；保留最後有效快照，超過 24 小時提示可能過期。顯示來源、擷取時間與網頁讀取時間；**重新讀取快照不會更新外部 API**。既有服務共用請求與五分鐘快取。
- 兩欄桌面版、較窄視窗單欄，保留深藍導覽列，支援所有模式、五種強調色及三種字級。不改寫四個模組的核心功能或任何 localStorage 結構。

期中介紹、建議展示流程、資料更新方式、另一台電腦啟動及公開部署步驟見 [docs/DEMO.md](docs/DEMO.md)。僅提供部署說明，本次未公開發布或推送。

本階段新增 `src/pages/overview.js`、`src/overview.css`、`tests/overview.test.js`、`docs/DEMO.md` 與 `docs/screenshots/phase5-overview.png`；修改 `src/main.js`、`src/router.js`、`src/pages/earthquakes.js`、`tests/navigation.test.js`、`package.json`、`package-lock.json`、`README.md` 與 `VALIDATION.md`。地震頁的變更只加入首頁事件連結處理，未重寫既有查詢或地圖。

## Phase 4：臺灣地震資訊與震央地圖

入口：<http://127.0.0.1:4173/#/earthquakes>。資料來自中央氣象署官方 **E-A0015-001 顯著有感**與 **E-A0016-001 小區域有感**報告，公開快照不需要訪客帳號或金鑰。

- 每頁 8 筆、依發生時間由新到舊，顯示位置、規模、深度、最大觀測震度、分類及官方原文。規模與震度分開呈現；缺值顯示「未提供」。
- 地區／觀測縣市關鍵字（支援台／臺及空白分隔關鍵字）、規模上下限、臺灣日期起訖與兩類報告可同時篩選，支援清除、無結果及錯誤條件提示。搜尋僅限當前快照，不是完整歷史資料庫。
- Leaflet 1.9.4＋OpenStreetMap 底圖：標記半徑依規模、實線／虛線區分類型；可平移、縮放與回到臺灣。點標記會開啟摘要及詳情，選列表會定位震央。地圖顯示全部篩選結果，分頁只影響表格。
- 詳情保留精確到秒的發生時間、官方報告時間與快照擷取時間，顯示經緯度、規模類型及官方提供的各縣市觀測震度；不由規模推算震度，不把未提供的縣市當作零震度。
- 載入、資料異常、無資料、網路失敗及超過 24 小時的快照提示；地圖或部分底圖失敗仍保留列表／篩選／詳情。支援原有模式、五種強調色及字級，不讀寫使用者的群組／收藏資料。

本次真實快照為 **32 筆（兩類各 16 筆）**，發生時間涵蓋 **2026/08/13 03:54:22 至 2026/10/17 11:13:19**；擷取於 **2026/10/19 23:22:52**，以上均為臺灣時間。最近事件日期不是擷取日期，不宣稱為即時地震或預警。

### 安全更新方式

沿用使用者既有 `.env.local` 的 `CWA_API_KEY`，僅本機 Node 更新腳本透過 `scripts/lib/cwa-env.mjs` 讀取。採官方支援的 HTTP Authorization 標頭，不把金鑰放入網址；禁止輸出原始 HTTP 錯誤或回應中的授權資訊，不儲存原始回應。沒有新增前端環境變數或後端。

```powershell
npm.cmd run update:earthquakes  # 本機更新：每類一次、每次 20 秒逾時；驗證後原子替換公開快照
npm.cmd run build              # dist 包含不含金鑰的地震快照與地圖程式
npm.cmd run preview -- --port 4173 --strictPort
```

一般 build 不呼叫氣象署。更新失敗、任一類無資料或格式異常、既有快照損壞、快照時間倒退時不覆寫舊檔；沒有無限重試或排程。網站「重新讀取地震快照」只讀已發布 JSON，共用 5 分鐘快取、10 秒手動讀取間隔與 12 秒逾時，不會代替維護者更新官方 API。正式網站更新仍需本機腳本 → build → 發布；老師瀏覽已發布快照不需金鑰。

來源依政府資料開放授權條款第 1 版標示；底圖保留 OpenStreetMap 著作權及 Leaflet 標示。底圖需連網且無可用性保證，不做離線預抓或繞過快取。來源格式、去重規則、資料涵蓋與地圖政策詳見 [data-sources/earthquakes.md](data-sources/earthquakes.md)。

新增檔案：`src/services/earthquakes.js`、`src/pages/earthquakes.js`、`src/components/earthquake-map.js`、`src/lib/earthquake-format.js`、`src/earthquakes.css`、`scripts/update-earthquakes.mjs`、`scripts/lib/cwa-earthquake.mjs`、`public/data/earthquakes.json`、`public/licenses/leaflet.txt`、`data-sources/earthquakes.md`、五個地震測試檔與 `tests/fixtures/earthquakes.js`。入口／路由／首頁狀態、路由測試、套件版本及文件同步更新。新增的唯一套件是 Leaflet，地圖模組按需載入。

## 保留的 Phase 3：新聞資訊系統

入口：<http://127.0.0.1:4173/#/news>（正式建置預覽）或開發中的 `5173/#/news`。

- 全部、科技、財經、國際、生活、社會六種分類選項；依標題及 RSS 前言搜尋關鍵字，支援台／臺、空白分隔的多關鍵字、清空及查無結果提示。
- 新聞卡片呈現完整 RSS 標題、前言、中央通訊社來源、分類、發布時間與擷取時間；保留原有發稿訊頭，不抓取全文或圖片。原文連結開啟新分頁。
- 發布時間由新到舊／由舊到新排序，每頁 12 則，可翻閱全部符合結果。跨分類同文合併，保留全部所屬分類。
- 收藏／取消收藏、「只看收藏」；保存當時的 RSS 文字、日期及原文連結，文章退出最新 RSS 後仍可查看。收藏提示原文可能更新，並依保留資料日期呈現。
- 載入、空白、錯誤、超過 24 小時的快照過期提示；更新失敗保留已讀新聞與收藏。主題模式、強調色與字級沿用全站設定。

### 新聞來源與更新

使用[中央社官方 RSS](https://www.cna.com.tw/about/rss.aspx)列出的五個分類，依其個人／非營利組織之非商業用途規範使用，標示「中央通訊社」並保留訊頭；不是政府開放資料授權，也未取得商業轉載或標章授權。中央社可變更規範或停止服務。來源、欄位、安全驗證與限制詳見 [data-sources/news.md](data-sources/news.md)。

本次真實匯入於 **2026/10/19 21:04（臺灣時間）**，五類各 20 則，100 個分類項目去重後 **95 則新聞**；這是有限的近期 RSS 清單，不是新聞全文或歷史搜尋資料庫。

```powershell
npm.cmd run update:news  # 維護者：五個官方 RSS 各讀一次，全部驗證成功後更新 public/data/news.json
npm.cmd run build       # 包含新聞快照的正式產物
npm.cmd run preview -- --port 4173 --strictPort
```

RSS 實測未提供瀏覽器跨來源允許標頭，使用 Node 更新腳本與同來源 JSON 快照，正式建置不依賴開發代理。一般 build 不連線抓新聞；要更新正式網站，需維護者執行更新腳本、build 並發布。UI「重新讀取快照」只讀取網站已發布資料，不代表外部 RSS 已更新。共用 5 分鐘記憶體快取、10 秒手動讀取間隔、12 秒網頁請求逾時；更新腳本每類 15 秒逾時，無重試循環或背景排程。

收藏以 `dailyinfo.news.favorites.v1` 獨立保存，格式與外部連結會重新驗證；儲存失敗／容量不足時維持之前的清單，顯示操作未保存。損壞內容保留原始字串並鎖定編輯，可在修復瀏覽器儲存內容後按「重新讀取收藏」；本階段未提供備份匯入或損壞資料重設 UI。禁止儲存時仍可瀏覽新聞。不同網址來源（如 5173 與 4173）各自保存收藏，無跨裝置或多分頁衝突合併。

新增檔案：`scripts/update-news.mjs`、`scripts/lib/news-rss.mjs`、`src/services/news.js`、`src/services/news-favorites.js`、`src/pages/news.js`、`src/news.css`、`public/data/news.json`、`data-sources/news.md`、`tests/news.test.js`、`tests/news-favorites.test.js`、`tests/news-page.test.js`、`tests/fixtures/news.js` 及驗收截圖。修改入口／路由／首頁狀態標示、既有路由測試、套件版本／更新指令及 README／VALIDATION。重用既有 jsdom 作為維護腳本的 XML 解析器，沒有新增依賴，jsdom 不會打包到前端。

## 保留的 Phase 2B：真實盤後行情

- 自選股顯示收盤價、帶正負號的漲跌額／幅、成交量（股）與交易日期；上漲紅色、下跌綠色。依收盤價、漲跌幅、成交量降冪排序，缺值置後，切回自訂順序仍保留原始排列。
- 點擊股票名稱開啟詳細資訊：開、高、低、收、漲跌、成交量、成交金額、來源及擷取時間。無成交或缺失價格不轉成 0；無行情顯示「暫無行情」。
- 按需讀取近一個月官方歷史日收盤價，以原生 SVG 繪圖及文字清單呈現。非交易日不補值，缺值斷線；日期截至盤後快照交易日，避免混入較晚價格。歷史來源不可用時顯示錯誤，不使用模擬數據。
- 盤後來源為 [TWSE STOCK_DAY_ALL](https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL)，採免費政府資料開放授權。現有快照為 **1,380 筆、交易日 2026/10/16**，擷取時間 **2026/10/19 20:11（臺灣時間）**。這不是即時股價，也不保證已反映當日交易；搜尋範圍仍為下列 1,368 筆主檔，不擅自擴大搜尋商品種類。
- 實測全市場端點沒有瀏覽器 CORS 允許標頭，因此採可用於正式建置的同來源靜態快照。詳細來源、授權、限制、歷史端點及數值處理見 [data-sources/quotes.md](data-sources/quotes.md)。

### 更新盤後資料

```powershell
npm.cmd run update:quotes  # 維護者下載一次全市場行情，驗證後原子更新 public/data/quotes.json
npm.cmd run build          # 將快照複製到 dist/；部署時需發布新的建置
npm.cmd run preview -- --port 4173 --strictPort
```

一般建置不呼叫證交所。更新腳本失敗、資料格式異常或交易日倒退時保留舊快照並以非零結束。網站「重新整理行情」只重新讀取已發布快照，不能從靜態網站啟動 Node 腳本；維護者未更新及發布時，按鈕不會取得新交易日。畫面分開標示交易日、來源擷取時間與網頁讀取時間，過日資料明確提示可能休市或尚未更新。

全市場結果共用單一請求，快取 5 分鐘；手動讀取間隔至少 10 秒，併發讀取共用請求，12 秒逾時。歷史資料按代號／月份快取 30 分鐘，通常兩個月份請求、跨二月時最多三個，無持續背景更新。行情失敗保留最後有效快照與全部自選群組。

Phase 2A 的 `dailyinfo.watchlists.v1` 結構與儲存服務未變動，不需要遷移。新增行情排序僅作用於本次畫面，不改寫已保存的自訂順序。不同通訊協定、主機或連接埠屬不同 localStorage 來源；5173 與 4173 的清單各自獨立，並非資料被刪除。

新增：`src/services/quotes.js`、`src/services/stock-history.js`、`src/components/quote-details.js`、`src/quotes.css`、`scripts/update-quotes.mjs`、`public/data/quotes.json`、`data-sources/quotes.md`、三個行情測試檔及 `tests/fixtures/quotes.js`。修改股票頁、入口樣式／版本標示、相關既有測試、套件版本與指令、README、VALIDATION；沒有新增依賴。

## 保留的 Phase 2A：股票搜尋與多群組自選股

入口：<http://127.0.0.1:5173/#/stocks>。桌面版為本階段主要目標，維持既有響應式網站，不新增 App、PWA、登入、後端或資料庫。

- 搜尋代號、簡稱、完整公司／基金名稱，支援台／臺；可篩選股票／ETF、清空、查看無結果提示，結果每頁 20 筆並可翻閱全部符合項目。
- 多群組新增、重新命名、切換、刪除（必須確認）、上下調整群組順序；新群組立即顯示。名稱 1–40 字，禁止空白、控制字元或重複名稱，不設小型群組數量上限。
- 同群組禁止重複加入，同股票可出現在不同群組。可移除、上下排列，或透過移轉視窗複製／移動到另一群組；若目標已有相同股票，拒絕整個移轉，來源不變。
- 依股票代號、名稱或自訂順序排序。代號／名稱排序不改寫原始自訂順序；切回自訂順序即可上下移動股票。
- 表格包含代號、名稱與類型；行情欄位已於 Phase 2B 接上真實盤後資料。
- 外觀沿用全站 CSS 變數與 rem，支援所有模式、五色與三種字級。

### 股票資料來源

採 TWSE OpenAPI [上市公司基本資料](https://data.gov.tw/dataset/18419)及[基金基本資料彙總表](https://data.gov.tw/dataset/157399)。本次匯入為 **1,096 筆上市公司＋272 筆上市 ETF＝1,368 筆**，資料出表日 **2026/10/18**，2026/10/19 18:56 臺灣時間取得。不是即時行情，且不包含上櫃／興櫃、上櫃 ETF、權證、特別股或海外股票的完整主檔。

正式資料無需金鑰；因實測 CORS 標頭不允許直接跨來源讀取，網站使用同來源靜態快照。來源、授權、筆數、雜湊、更新頻率、請求限制檢查與更新方式見 [data-sources/stocks.md](data-sources/stocks.md)。

```powershell
npm.cmd run import:stocks  # 維護用，向兩個正式基本資料端點各取一次並更新快照
```

一般建置不會重新下載。來源失敗會保留既有快照；網站搜尋失敗不會刪除自選群組。使用者需留意 UI 顯示的出表日期與匯入日期，新上市／更名需維護更新才反映。

### 自選清單儲存及安全

- 儲存在 `dailyinfo.watchlists.v1`：版本、群組 ID／名稱、群組陣列順序、股票代號／名稱／類型及陣列順序、最後群組、排序模式。未儲存行情資料。
- 每次操作先驗證及嘗試儲存，成功才更新畫面及記憶體。權限失敗或容量不足會顯示錯誤，維持之前資料；可下載 JSON 備份。瀏覽器實際容量各異，不保證無限儲存。
- 損壞內容不自動覆寫：鎖定編輯、保留原始字串，提供下載原始備份、重新讀取及經確認後重設。
- 使用者名稱及搜尋內容一律透過 DOM `textContent`／`value` 呈現，未插入使用者 HTML。靜態目錄亦驗證來源網址、日期、分類及數量。
- 本機單分頁使用為主，沒有跨裝置同步；不保證同時開啟多個分頁編輯時的衝突合併。備份可下載，本階段尚無備份匯入介面。

### Phase 2A 檔案變更

| 類別 | 檔案 |
| --- | --- |
| 新增資料及來源說明 | `public/data/stocks.json`、`data-sources/stocks.md` |
| 新增匯入及服務 | `scripts/import-stocks.mjs`、`src/services/stock-catalog.js`、`src/services/watchlists.js` |
| 新增 UI | `src/pages/stocks.js`、`src/stocks.css` |
| 新增測試 | `tests/watchlists.test.js`、`tests/stock-catalog.test.js`、`tests/stocks-page.test.js`、`tests/fixtures/stock-catalog.js` |
| 新增畫面證據 | `docs/screenshots/phase2a-desktop.png`（瀏覽器驗收操作畫面，非固定示範資料） |
| 修改 | `src/main.js`、`src/router.js`、`tests/navigation.test.js`、`.gitignore`、`package.json`、`package-lock.json`、`README.md`、`VALIDATION.md` |

沒有新增套件。`package.json` 只增加匯入指令及版本號，鎖定檔更新版本號。

## 保留的 Phase 1.5 功能

- 新增「設定」頁：淺色、深色、跟隨系統；森林綠、海洋藍、暮光紫、玫瑰紅、琥珀棕五色；小（12px 根字級）、標準（14px）、大（18px）三種文字尺寸。
- 設定透過 CSS 語意變數與 rem 套用到全部六頁、側欄、按鈕、資訊卡及預報文字。預設仍是淺色主畫面、深色側欄、森林綠與標準字級。
- 使用原生 radio、select、搜尋結果按鈕，可用 Tab、方向鍵、空白鍵與 Enter 操作。手機導覽採兩列，文字放大時元件可換行，七日預報在卡片內橫向捲動。
- 天氣查詢涵蓋 **22 縣市、368 鄉鎮市區**，包含澎湖、金門、連江。預設臺北市大安區；縣市改變後必須重新選擇鄉鎮市區，按「查詢天氣」才套用。
- 地名搜尋支援台／臺、縣市、鄉鎮市區或完整地名。相同區名列出完整縣市以供辨識。最多顯示前 20 筆並提示縮小關鍵字；無結果時明確顯示查無地區。只輸入文字不會直接查詢天氣。
- 地區與外觀分別保存於 `dailyinfo.region.v1`、`dailyinfo.settings.v1`。只接受已知地區 ID 及限定字串設定；不信任儲存的經緯度。損壞 JSON、未知值回復預設；瀏覽器禁止寫入時顯示僅本次有效的提示。
- 切換地區會取消舊請求並以請求序號阻止過期結果覆蓋新地區。更新天氣不會清除正在輸入的地名搜尋。

### 行政區來源、座標與授權

原始來源為[內政部國土測繪中心鄉鎮市區界線](https://data.gov.tw/dataset/7441)，採[政府資料開放授權條款第 1 版](https://data.gov.tw/license)。本專案標示來源並加工產生代表點，非官方背書。

界線採用 [Geodata 的 GeoJSON 轉製發行版](https://geo.maderaojen.me/) `2026-07-04.1`，其標示原始圖資為 `1140318`、EPSG:4326。完整下載網址、SHA-256、授權與方法記錄在 `data-sources/regions-provenance.json`；建置腳本以固定雜湊檢查來源，來源變動時會停止而非直接採用。

`scripts/build-regions.mjs` 從每區最大面積的多邊形陸塊取 31 條水平掃描線的最寬內部區間中點，保留小數六位後再次檢查是否在區界內。**368 個代表點皆通過區界內檢查**。這些點不是測站、區公所、人口中心或官方行政中心；幅員廣大、山區及多島行政區的一個點無法代表每個地方的天氣，多島行政區使用最大陸塊。

另以官方 `ListCounty` / `ListTown1` 核對 22 縣市及全部 368 筆代碼與名稱，三個指定驗收地區再以官方 `TownVillagePointQuery1` 反查座標歸屬；結果在 `data-sources/regions-live-check.json`。不含村里、道路或郵遞區號專用名稱；東沙／南沙不列為額外鄉鎮，不能用不存在的行政區冒充結果。

行政區資料隨程式離線打包，網站執行時只對 Open-Meteo 發出天氣請求，不需行政區 API、帳號、金鑰、後端或額外套件。資料是有版本的快照，不會自動跟隨行政區改制；更新時需重新生成及核對。

```powershell
node scripts/build-regions.mjs   # 下載固定版本界線，產生並驗證代表點
node scripts/check-regions.mjs   # 向官方清單及三個代表點反查，更新驗證紀錄
node scripts/check-weather.mjs   # 三個指定地區的真實天氣查詢，更新驗證紀錄
```

後兩個檢查需要連網；失敗時以非零結束碼回報，不使用測試假資料補齊結果。一般安裝、測試與建置不需重新下載行政區資料。

## 保留的 Phase 1 功能

- 首頁總覽，以及天氣、股票、新聞、地震四個模組頁；Hash 路由支援直接連結與瀏覽器上一頁／下一頁。
- 深色側欄、資訊卡片、桌面與手機版面；小螢幕七日預報可水平捲動。
- 所選行政區天氣：目前氣溫、相對濕度、目前天氣狀態、今日最高降雨機率及七日高低溫、天氣、降雨機率。
- 載入中、12 秒逾時、網路／HTTP 失敗、資料異常、手動重新整理及防止重複請求。
- 天氣來源連結、資料有效時間與取得時間，皆以臺灣時間顯示。
- 語意導覽、目前頁面標記、鍵盤焦點樣式、跳至主要內容連結、減少動畫偏好。
- 四個資訊模組均已串接：天氣模式預報、股票盤後快照、新聞 RSS 及官方地震報告，均標示來源與資料時間。

## 天氣來源與限制

來源：[Open-Meteo Forecast API](https://open-meteo.com/en/docs)，採用無金鑰的免費非商業用途服務。本專案不含 API Key、Token 或付費服務。

座標取自所選行政區的驗證代表點，預設臺北市大安區 `25.030179, 121.539770`，時區 `Asia/Taipei`。依官方欄位使用 `current.temperature_2m`、`current.relative_humidity_2m`、`current.weather_code` 與 `daily` 預報。

目前天氣是天氣模式估算，非測站即時觀測；降雨機率是 **每日最高預報值**，不是目前降雨量或當下機率。UI 將數值四捨五入為整數。來源缺少降雨機率時顯示 `—`；必要欄位或單位異常時顯示錯誤，不以假資料替補。

每次開啟頁面會取資料；切換模組共用同一次結果；按重新整理取得新資料。不做背景自動更新、離線快取或過時資料展示。需連網，API 故障、限流或瀏覽器網路限制可能使請求失敗。

## Phase 1 基礎架構

```text
dailyinfo/
├── .gitignore                    # 忽略依賴、建置、環境變數及日誌
├── README.md                     # 使用說明與檔案清單
├── VALIDATION.md                 # 本次實際驗收結果與限制
├── index.html                    # HTML 入口
├── package.json                  # 本地依賴與 npm 指令
├── package-lock.json             # 鎖定依賴版本
├── public/
│   └── favicon.svg               # 專案圖示
├── src/
│   ├── main.js                   # 應用入口、狀態與版面
│   ├── router.js                 # 五個頁面的路由
│   ├── styles.css                # 響應式樣式
│   ├── components/weather.js     # 天氣元件與狀態畫面
│   ├── services/weather.js       # API、資料驗證與 WMO 代碼解析
│   ├── pages/placeholder.js      # 尚未串接的模組頁
│   └── lib/
│       ├── format.js             # 數字、日期與時區格式化
│       └── icons.js              # 共用 SVG 圖示
├── scripts/check-weather.mjs     # 真實 API 連線驗證
└── tests/
    ├── weather.test.js           # 解析、錯誤、逾時測試
    └── navigation.test.js        # 路由、實際 DOM 切換、重新整理測試
```

另產生 `node_modules/`、`dist/` 與 `.git/`；前兩者已忽略，非應提交的原始碼。

測試資料只存在 `tests/`，不會匯入產品程式。`scripts/check-weather.mjs` 直接呼叫真實 API，失敗時回傳非零結束碼，與模擬測試分開。

## Git 與安全範圍

本專案獨立 Git 儲存庫位於 `dailyinfo/.git`，分支 `main`。Phase 1 基線 **`b3f2e98`**、Phase 1.5 **`b52eca5`**、Phase 2A **`329ca3f`**、Phase 2B **`1db256e`**。Phase 4 前排除敏感檔案，將 Phase 3、七日排版及天氣圖示修復建立本地基線 **`eb001a3`**；Phase 5 前將已完成的 Phase 4 建立本地基線 **`44abf3a`**。Phase 5 已建立本地基線 **`8ce561a`**；Phase 5.1 已建立本地基線 **`e577ba1`**；Phase 6A 已建立本地基線 **`7837083`**；Phase 6B 變更保留於工作目錄供驗收，未推送遠端。`.env.local` 保持忽略與未追蹤；未修改 NoteNest、全域環境或 PATH。

前端打包內容可由使用者查看，未來需要金鑰的服務必須透過安全後端代理，不能放入 `VITE_*` 或前端程式。環境變數檔預設忽略。

## 尚未實作

- 股票即時行情、複雜 K 線圖、地震預測／預警／推播（本專案不提供）。
- 登入、資料庫、通知及自動更新。
- GitHub 遠端、CI/CD 與公開部署。

以上不屬於本次 Phase 6B；完成後停止，等待使用者驗收，不開發下一階段。股票、新聞與地震快照需維護者更新及重新發布，未實作排程更新、後端或公開部署。

## Phase 1.5 檔案變更

| 類別 | 檔案 |
| --- | --- |
| 新增設定 | `src/services/settings.js`、`src/pages/settings.js`、`src/preferences.css` |
| 新增行政區與選擇器 | `src/data/regions.json`、`src/services/regions.js`、`src/components/region-picker.js` |
| 新增共用工具 | `src/lib/storage.js`、`src/lib/html.js` |
| 新增資料來源及檢查 | `scripts/build-regions.mjs`、`scripts/check-regions.mjs`、`data-sources/regions-provenance.json`、`data-sources/regions-live-check.json`、`data-sources/weather-live-check.json` |
| 新增測試 | `tests/settings.test.js`、`tests/regions.test.js`、`tests/app.test.js` |
| 調整既有實作 | `src/main.js`、`src/router.js`、`src/styles.css`、`src/components/weather.js`、`src/services/weather.js`、`src/lib/icons.js`、`src/lib/format.js`、`scripts/check-weather.mjs` |
| 調整既有測試與文件 | `tests/navigation.test.js`、`tests/weather.test.js`、`README.md`、`VALIDATION.md` |
| 僅版本號更新 | `package.json`、`package-lock.json`，沒有新增依賴 |

實際測試與未完成的畫面驗證見 [VALIDATION.md](VALIDATION.md)。
# Phase 6C：每日星座運勢

首頁四大卡片上方新增十二星座每日運勢。首次可選擇並儲存或略過；永久 `defaultSign` 與暫時 `viewSign` 分開，切換不會自動儲存，支援回到我的星座及主動設為預設。重新整理／重新開啟還原永久設定，不要求生日或個資。

使用 FreeHoroscopeAPI 免費 API 的真實英文原文，保留來源署名；未確認翻譯權限所以不翻譯、不產生分數。2026-10-20 十二星座均取得同日內容，擷取時間為臺灣 09:25:44。來源未定義時區；只有原始日期符合臺灣今天才標示今日，舊資料明確顯示日期。僅供娛樂參考。

更新：`npm.cmd run update:horoscope`，再 `npm.cmd run build`。網站重新讀取只讀已發布快照／五分鐘快取，不更新外部 API。失敗保留有效舊檔，不影響其他資訊卡片及 localStorage。[資料來源與限制](data-sources/horoscope.md)。Phase 6B 穩定基線：`5fc43b6`。

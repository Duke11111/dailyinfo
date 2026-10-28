# 臺灣盤後行情來源與處理

## 全市場盤後快照

- 正式端點：<https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL>
- 官方資料集：[盤後資訊 > 個股日成交資訊](https://data.gov.tw/dataset/11549)，提供單位為臺灣證券交易所，標示每日更新、免費及[政府資料開放授權條款第 1 版](https://data.gov.tw/license)。本專案註明來源並加工，不代表官方背書；免費公開盤後資料不等於即時交易行情授權。
- 2026/10/19 實測 HTTP 200，帶 `Origin: http://127.0.0.1:5173` 時沒有 `Access-Control-Allow-Origin`、Cache-Control 或明確 rate-limit 數值。未找到此公開端點的固定發佈時刻或數字配額承諾，不推測無限請求或當日一定發布。
- 實際 JSON 為陣列，欄位 Date、Code、Name、TradeVolume、TradeValue、OpeningPrice、HighestPrice、LowestPrice、ClosingPrice、Change、Transaction。此批 1,380 個唯一代號、Date=1151016（2026-10-16），含 2330、2454、0050，來源取得時間為 2026-10-19T12:11:46.944Z。完整 raw SHA-256 與來源回應標頭記在快照。
- 此端點包含部分不在既有搜尋主檔的商品；網站僅將行情依代號套用既有主檔與使用者清單，搜尋仍限 1,096 上市公司＋272 上市 ETF，不宣稱提供上櫃／興櫃或所有證券種類。某代號未出現在行情時保留自選項目並標示暫無行情。

`npm.cmd run update:quotes` 保留 STOCK_DAY_ALL 為 primary，使用官方 [FMTQIK 每日市場成交資訊](https://www.twse.com.tw/zh/trading/historical/fmtqik.html) 的歷史日期，並接受完整、日期一致的官方 [MI_INDEX 每日收盤行情](https://www.twse.com.tw/zh/trading/historical/mi-index.html) 作為獨立已發布證據。FMTQIK 並非唯一最新日期來源；它落後時不能擋住較新的有效 MI_INDEX。不使用第三方行情，不以「今天是平日」推定一定有行情。

查詢範例（日期只作格式示例，程式不寫死日期）：

- 市場交易日：`https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=20261028`
- 日期專屬盤後：`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&type=ALLBUT0999&date=20261027`

每次 primary 與本月 FMTQIK 各一次。若 FMTQIK 尚未涵蓋可採用的最新時段，由最近可能已收盤的平日往回查日期專屬 MI_INDEX，最多七個日曆日（至多五個平日）；遇到第一份完整有效報表就停止，並重用該回應，不再重抓。只有官方明確「沒有符合條件的資料」才往前查；HTTP／Schema 錯誤立即拒絕本輪。跨月最多額外查前月 FMTQIK 一次，必要時查已知歷史交易日一次；整輪最壞上限九次 GET，每個日期至多一次，每次 8 秒逾時、4 MiB 上限。沒有完整查核較新日期時，不把過舊日曆宣稱為最新。正常市場資料同步時只需兩次，FMTQIK 落後但當日 MI_INDEX 有效時三次；不重試、不使用代理。

HTTP、JSON MIME、UTF-8、欄位、官方標題、日期、代號唯一性、至少 1,000 筆及 2330／2454／0050 完整性均驗證。MI_INDEX 嚴格對應成交股數／筆數／金額與 OHLC、漲跌符號；只接受實測官方符號標記，任意 HTML 一律拒絕。空表、日期不符、欄位不完整都不能證明已發布；錯誤時保留原檔。

臺灣 17:17 前排除當日資料，即使官方市場與個股報表已先發布；17:17 後才可採用官方已發布的當日資料。日期由有效官方市場回應列，或 MI_INDEX 頂層日期、查詢日期、同日表格標題與完整行情共同證明，不由下載時間推算。日期證據取已驗證的較新者；同一 tradeDate 的有效候選再比較 fetchedAt。primary 比已證明日期更新但沒有有效獨立證據時停止，絕不退回較舊來源蓋過它。

快照維持 version 1，舊 primary 快照仍相容。fallback 的 source 如實標示 MI_INDEX；`evidence` 保存實際方法、固定官方資料網址、已發布與可採用交易日、檢查時間，以及資料／市場回應 SHA-256。MI_INDEX 獨立證明較新日期時，額外保存 `dateProof` 的日期、實際查詢 URL、SHA-256、fetchedAt，fallback 的 proof 必須綁定該份資料 digest 與擷取時間。跨月檢查會分別保存本月 publication 與前月 market digest；沒有偽造雙來源逐價交叉核對。本機 2026/10/28 研究已實際驗證 10/27、10/28 的各 1,386 筆官方 MI_INDEX，這不是 GitHub Runner 的雲端驗收證據。

同日兩個官方格式仍有原生差異：部分無成交商品在 primary 的量額／筆數為空字串，MI_INDEX 則明列 0；部分 MI_INDEX 的 X 特殊參考狀態在 primary 只給 Change=0。各來源如實保留：空值不補零，官方明列的 0 不改成缺值，X 的漲跌與百分比為 null。不能宣稱兩份原始檔所有欄位完全一致，亦不能為了「一致」而造值。

先驗證全部資料，再按 tradeDate、fetchedAt 防倒退比較後原子替換目標檔。失敗、既有檔損壞、不同日期或倒退皆拒絕覆寫。automation 對新取得的官方日期證據判斷 source_delayed：週末或休市日即使今天沒有交易，已取得最近已發布交易日仍是 ok。不變的內容不改寫原快照 fetchedAt；status v1 與 Checkpoint v2 保留。發布仍須原本的 Build、Verify、Checkpoint 與 Publish Guard，排程／Cloudflare 不變。

網頁共用一次全市場讀取、快取 5 分鐘、手動刷新至少間隔 10 秒、12 秒逾時，不逐檔查全市場、不持續輪詢。按鈕讀取網站已發布快照，不會直接要求交易所產生更新。標示最近有效交易日、來源擷取時間、網頁讀取時間；舊資料提示可能休市、來源未發布或網站未更新，不推論休市原因。

## 數值與日期

- 民國七碼或斜線日期轉西元，檢查真實日曆日期；本端點拒絕混合日期、未來日期及週末交易日。
- 價格以元、成交量以股、成交金額以元顯示，量額與筆數必須為非負安全整數；數字接受合法千分位、全形／Unicode 正負號。缺值、無成交零價格呈現暫無行情，不直接當作價格 0。高低價矛盾、負價格及非數值拒絕採用。
- 漲跌幅＝漲跌額 ÷（收盤價 − 漲跌額）×100%；分母必須有效且大於 0。來源 X 等特殊參考狀態保留說明、漲跌額／幅留空，不捏造數值；不提供還原權息或投資報酬率。
- 更新失敗保留先前有效資料；拒絕較舊交易日或同日較早來源擷取時間覆蓋。行情狀態與自選 localStorage 完全分離。

## 按需歷史收盤價

官方說明頁：<https://www.twse.com.tw/zh/trading/historical/stock-day.html>（可查詢自 2010/01/04 起資料）。公開月資料端點例：<https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=20261001&stockNo=2330>。

實測 HTTP 200，`Access-Control-Allow-Origin: *`；每月回傳 stat、fields、data，日期為民國斜線格式。網站僅使用此官方個股日成交的真實收盤價；按下詳細資訊中的按鈕才請求，以快照交易日往前 30 個日曆日為範圍，通常兩個月份、跨二月時最多三個，按代號／月份共用請求與 30 分鐘快取（最多保留 60 份月份快取）。沒有登入、金鑰或付費服務。Phase 8F 使用按需載入的 Chart.js 4.5.1，僅註冊折線、座標軸及 tooltip 所需元件，不使用日期轉接套件或遠端圖表服務。

Phase 8F 從有效歷史資料選取最近五筆，按交易日期升序顯示；非交易日、無效或缺失價格不補點、不補價，不推算休市日。僅取得一至四筆時顯示實際筆數，一筆只顯示點；零筆顯示資料不足。保留日期／價格文字清單與來源擷取時間。

單月失敗顯示不完整警告；有最後有效的同股票／月份快取時保留原價格及原擷取時間並明示非最新，無快取且全部失敗時顯示錯誤。不把快取讀取時間冒充資料取得時間；重新讀取失敗也不清除已顯示的圖表。快取僅存在當次網站記憶體，重新開啟後未必有可用舊資料。

歷史端點可能早於全市場端點發布更新，因此截去超過快照交易日的點，避免詳情與走勢混用日期。歷史資料為另一個瀏覽器跨來源請求，若來源更改 CORS、限流或不可用，圖表可失敗，盤後靜態行情及自選群組仍可使用。30 個日曆日內不足五筆時不另增查詢範圍。

圖表以分類軸使用官方交易日期（不經瀏覽器時區換算），價格單位為新臺幣元。切換股票、重新繪圖、關閉或離開頁面會銷毀圖表及主題觀察器。主題與字級沿用全站 CSS 變數，不新增使用者資料儲存。

免費授權：Chart.js 4.5.1 與相依 @kurkle/color 0.3.4 均為 MIT；已核對官方 [Chart.js 授權](https://github.com/chartjs/Chart.js/blob/master/LICENSE.md)、npm metadata 與安裝套件 LICENSE，完整授權保留在 public/licenses/chartjs-MIT.txt、public/licenses/kurkle-color-MIT.txt。

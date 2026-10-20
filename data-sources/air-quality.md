# Open-Meteo 空氣品質來源與使用方式

查核日期：2026/10/20。官方文件：<https://open-meteo.com/en/docs/air-quality-api>；免費 API 使用條款：<https://open-meteo.com/en/terms>。

## API 與資料意義

使用 `https://air-quality-api.open-meteo.com/v1/air-quality`，查詢既有行政區代表座標，指定 `current=us_aqi,pm2_5,pm10`、`hourly=us_aqi`、`forecast_hours=24`、`timezone=Asia/Taipei`、`domains=cams_global`。不需要 API Key，沒有建立第二套行政區資料。

臺灣取 CAMS 全球大氣成分模式，原始全球模式約 0.4°／45 km 網格、三小時解析度，Open-Meteo API 提供逐時輸出；這不代表有逐時測站觀測或每小時重新運算模式。鄰近行政區可能落在相同網格；API 回傳網格中心不必等於查詢代表點。原始全球資料集：<https://ads.atmosphere.copernicus.eu/datasets/cams-global-atmospheric-composition-forecasts>。

目前回應欄位為 `current.time`、`current.us_aqi`、`current.pm2_5`、`current.pm10`，以及 `hourly.time[]`、`hourly.us_aqi[]`。驗證 Asia/Taipei、UTC+8、時間、來源網格、單位及非負有限數值；PM 單位原文為 `μg/m³`，介面以等義 `µg/m³` 呈現。缺值保留未提供，零濃度保留為零。無效主要欄位顯示資料錯誤；選用趨勢異常僅停用趨勢，不移除有效目前數值。

US AQI 使用 API 提供的綜合指數，不由即時 PM 濃度自行重算。Open-Meteo 的 PM 指數使用此前 24 小時移動平均，因此目前 PM2.5 濃度與綜合 AQI 不應直接套表互推。趨勢只顯示來源提供、落在有效時間所在小時起 24 小時內的逐時值；缺時段／null 斷線，不補點或補值，提供可展開的精確時間／數值清單。

## 分級與標示

依 [美國 AirNow US AQI 分級](https://www.airnow.gov/aqi/aqi-basics/)：0–50 良好、51–100 普通、101–150 對敏感族群不健康、151–200 不健康、201–300 非常不健康、301 以上危害；不將超過 500 的值當成缺值。API 若提供小數，保留原數值分級（大於前一級上界進入下一級），不先四捨五入改變等級。介面文字與顏色並用，明確寫「美國 AQI（US AQI）」，不冒充臺灣環境部測站 AQI 或實測值。

## 快取、更新與錯誤

同一應用程式的天氣頁及首頁共用一個 AQI session；按原行政區 ID 及經驗證座標查詢，五分鐘記憶體快取（最多 12 個地區）、同地區進行中請求共用，不用 localStorage、不輪詢。切換地區會取消舊請求並以序號保護，網路忽略取消時也不能覆蓋新選擇。

分開顯示有效時間、API 擷取時間、網頁讀取時間與快取到期時間。切換頁面可讀快取，明示未查詢 API；「重新查詢空氣品質 API」強制發出新查詢，不受五分鐘快取阻擋。天氣原有重新整理只更新天氣，AQI 使用自己的明確按鈕。更新失敗可保留同地區先前資料並標明不是本次新取得，不能將其他地區舊值移用；快取過期或有效時間距今逾六小時會於渲染時提示，此六小時是介面時效提醒，不是官方模式發布週期。沒有常駐監控或自動更新排程。

## 免費使用與署名

官方免費服務僅供非商業使用，教學內容屬官方列出的適用例子；有廣告、訂閱或商業用途時必須重新評估授權。官方限制為每日少於 10,000 次、每小時 5,000 次、每分鐘 600 次，可能依 IP／應用程式限流，沒有保證可用性。本專案沒有購買或註冊付費服務。

資料依 CC BY 4.0 標示來源，介面連結 Open-Meteo、CAMS 全球資料集與美國 AQI 分級，並保留官方要求的 [CAMS 提供者署名連結](https://confluence.ecmwf.int/spaces/CKB/pages/202173092/CAMS+Regional+European+air+quality+analysis+and+forecast+data+documentation)。該提供者頁的歐洲 ENSEMBLE 說明不代表本專案臺灣使用歐洲網格；臺灣實際指定 `cams_global`。

Open-Meteo 所列 CAMS ENSEMBLE 署名包括 METEO FRANCE、Ineris、Aarhus University、MET Norway、Jülich IEK、IEP-NRI、KNMI、TNO、SMHI、FMI、ENEA、BSC 與 Copernicus Atmosphere Monitoring Service（CAMS）Atmosphere Data Store。資料經本專案驗證、分級及視覺化，非來源機構背書。

## 實際連線紀錄

首個帶本機 Origin 的查詢 HTTP 200，`Access-Control-Allow-Origin: *`。三地區均取得目前三欄及 24 個逐時 AQI：

| 地區 | 有效時間（臺灣） | US AQI | PM2.5 µg/m³ | PM10 µg/m³ |
| --- | --- | --- | --- | --- |
| 臺北市大安區 | 2026/10/20 00:00 | 45 | 8.1 | 10 |
| 苗栗縣竹南鎮 | 2026/10/20 00:00 | 65 | 17.6 | 21.7 |
| 高雄市左營區 | 2026/10/20 00:00 | 123 | 86.4 | 87.8 |

API 擷取於 2026/10/20 00:36:52–53（臺灣）；實際座標、URL、時間及 24 點資料保存在 [air-quality-live-check.json](air-quality-live-check.json)。這是開發查核證據，不是網站離線備用快照；網站仍直接呼叫 API，不拿這份紀錄冒充最新資料。

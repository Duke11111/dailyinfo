# 每日星座運勢資料來源（2026-10-20 查核）

- 官方首頁／使用條款：https://freehoroscopeapi.com/#usage-terms
- OpenAPI 1.1.0：https://www.freehoroscopeapi.com/openapi.json
- GET `https://freehoroscopeapi.com/api/v1/get-horoscope/daily?sign=aries`，十二星座各一次。無帳號、金鑰、費用或背景排程。
- 官方文件允許附署名的商業及非商業 API 與回應使用。畫面提供可見的 `Powered by FreeHoroscopeAPI` 連結。未找到明確翻譯／改作授權，因此保留英文原文，不發布自行翻譯內容。這不是自行推定的開源內容授權。
- 實際欄位：`data.date`、`period`、`sign`、`horoscope`。沒有評分、星級或愛情／財運等分類；網站不補造。
- 官方文件說明日期是提供者的閱讀日期標籤，不保證新鮮度；沒有 timezone、date/day 選擇參數。每日資料不宣稱為臺灣時區專屬內容。
- 2026-10-20 實測十二星座全部取得日期 `2026-10-20`，快照擷取 `2026-10-20T01:25:44.343Z`（臺灣 09:25:44）。英文內容未翻譯，JSON 為真實 API 回應整理，測試資料只存在測試檔。

## 更新與日期保護

`npm.cmd run update:horoscope`，完成後重新 `npm.cmd run build` 才能把新快照納入正式發布。

使用兩個有界 worker，各星座一次 GET、15 秒逾時、不重試。驗證完整十二星座、每日類型、代碼、文字長度及有效日期。全部日期必須一致且符合更新開始時的 Asia/Taipei 日期；跨午夜、非當日、任一錯誤、舊檔損壞或時間倒退皆拒絕覆蓋。先寫暫存檔再原子替換最後有效快照。

網站只讀 `/data/horoscope.json`，共用五分鐘快取與進行中的請求。重新讀取按鈕可能重用五分鐘快取，不呼叫外部 API；讀取時間與擷取時間分開顯示。來源日期與臺灣今天不符會標示非今日資料，絕不修改日期冒充今日運勢。公開部署不需要金鑰。

## 個人化與圖示

僅 `dailyinfo.horoscope.v1` 保存 `{version:1, defaultSign}`。使用者按儲存或設為預設才寫入；`viewSign` 僅存在頁面記憶體。略過不寫入，重新進入首頁還原永久預設。損壞設定與容量錯誤顯示提示，不刪除其他設定或資料。

十二星座使用 Unicode 星座符號與裝置字型繪製，不下載第三方圖片或 SVG，沒有外部圖示素材授權依賴。星座運勢僅供娛樂參考。

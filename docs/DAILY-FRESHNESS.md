# 當日資料即時性修復（2026-10-24，本機隔離候選）

基準 `f325e0a92e8f6f2e77ccb5680fdbd77eddfd44ae`。未 Commit、Push、部署或變更雲端設定。

下列第一階段研究紀錄保留；第二階段已完成首頁接線，最新行為與結果見本文末段，不能將舊的「尚未接線」視為目前本機狀態。

## 天氣實際根因與修復

- Open-Meteo 已設定 Asia/Taipei、每日七筆，但舊版僅驗證日期形狀，未確認真實日曆、連續性或當日資料。
- 首頁與完整天氣頁以索引 0 取得「今日」高低溫、降雨及今天標示，可能誤標昨天。
- 15 分鐘記憶體快取不會因臺灣午夜而失效；原自動更新也只考慮時間間隔，回到前景不一定立即更新跨日資料。
- 現改為按臺灣今日日期尋找每日資料；API 的目前天氣時間也必須為臺灣當日，取得時間與來源時間分開。HTTP 使用 no-store，來源仍為原 Open-Meteo。
- 快取須同時符合日期及 15 分鐘期限。日期不符最多額外請求一次（總計兩次）；連線／格式錯誤不立即重試。失敗清楚顯示，後續仍受既有 15 分鐘自動更新節流，沒有緊密重試迴圈。
- 已有成功資料跨日後，前景更新可提前於 15 分鐘執行；背景不請求，離開時清除原計時器。兩個地區 session、進行中請求合併與取消機制保留。
- 每張預報卡依真實日期標示今天；來源實際時間、每日日期範圍及擷取時間仍可見。若渲染舊狀態則顯示非當日警告，不把第一列當今天。

## 原星座 API 的瀏覽器驗證

使用本機已安裝的 Chrome 155、headless 模式、獨立測試 profile，從真實 `https://duke11111.github.io` origin 執行正常 fetch；沒有停用 CORS、no-cors、憑證忽略、Proxy 或安全繞過。瀏覽器連接器無可用分頁且逾時，故使用 Chrome 原生 DevTools Protocol 測試。不是 Node fetch 的 CORS 推論。

十二星座（aries 到 pisces）各一次請求，全部 HTTP 200、Response.type=cors、period=daily、sign 正確、來源日期 **2026-10-24**；Chrome Console 未記錄 CORS 錯誤。只記錄狀態、日期、sign 與文字長度，未將本次運勢內容寫入正式 JSON。此結果僅證明本次可用，不是永久 CORS 或每日準時更新保證。

原來源可直接支援本階段需求，因此沒有增加替代資料供應商。

- 官方文件：https://freehoroscopeapi.com/docs
- 使用條件：https://freehoroscopeapi.com/#usage-terms
- 官方目前允許免費、免 Key、附署名使用 API 與回應；必須保留可見的 Powered by FreeHoroscopeAPI 連結。
- 無明確繁中翻譯／改作許可，本階段只保留英文原文。API 日期沒有臺灣時區保證，必須自己與 Asia/Taipei 比對；不推算、翻譯或補造當日內容。

## 隔離即時服務，未接到正式首頁

新增 `createLiveHoroscopeStore`，未修改原 horoscopeStore、mountHoroscope、偏好 Key 或快照更新器，也不會因 app 啟動而呼叫它。

- 先驗證原十二星座 JSON 基線；基線已有今日所選星座就不呼叫外部 API。
- 基線非今日時，最多一次 GET 原官方所選星座端點，正常 cors、omit credentials、no-store、redirect error、12 秒逾時。
- 驗證 MIME、回應可讀性、長度、sign、period、有效日期、英文文字與請求前後的臺灣日期；跨午夜回應拒絕。
- 只接受當日資料；五分鐘記憶體快取，進行中同星座請求合併。失敗五分鐘節流，不自動重試；不寫 localStorage、不回傳任意錯誤本文。
- 失敗回傳原基線、真實日期與固定錯誤代碼。沒有有效基線時明確失敗。瀏覽器 TypeError 單獨無法區分 CORS 與網路，使用 cors_or_network_error，不虛稱必定是 CORS。
- `mode=live` 的 fetchedAt 是本次 API 取得時間；`mode=snapshot` 保留原快照 fetchedAt。未製造星等或分類。

下一階段需另行核准 UI 接線與文案：顯示 live／snapshot 模式、來源日期、真正取得時間、失敗與舊資料提示，保留安全 textContent、原文連結、署名、展開閱讀與 defaultSign/viewSign。再做瀏覽器互動驗收；提交及發布需另行授權。

Actions、Checkpoint v2、release-manifest、Publish Guard、正式 JSON、Dependencies 與所有 GitHub Variables 本階段均未修改。

## 本機驗收結果

- 56 檔、893／893 Vitest 通過（原 852 項全數保留，新增 41 項）。舊天氣整合測試只固定時鐘並補齊資料形狀，原有行為斷言保留。
- Production Build（74 modules）、`npm.cmd run verify -- --dist`（五份 JSON、隱私、子路徑）及 git diff --check 通過。
- 本機 Chrome 155 實際讀取 Open-Meteo：首頁及天氣頁七筆日期均為 2026-10-24～10-30，今天標記為 10/24；來源有效 15:00、實際擷取 15:01，兩者分開呈現。390px 無水平溢出，隔離 profile 的 localStorage keys 為空。
- Chrome 測試 profile 置於專案外的專用暫存目錄，避免 Vitest 掃到瀏覽器附帶的測試檔；未改動 Vitest 掃描規則或略過專案測試。
- 即時星座仍是隔離服務，未接線到首頁，不能宣稱正式網站已具備直接讀取即時運勢功能。真正早晨／供應商跨日更新時間仍沒有 SLA，當日回應不可用時只能如實顯示舊日期或不可用狀態。

## 第二階段：首頁整合（本機候選）

- 首頁預設使用共用 liveHoroscopeStore。只取得目前 viewSign，切換與回到預設時才查對應星座；defaultSign 仍只在明確儲存後改變。十二星座、原文連結、可見署名、英文與展開／收合均保留。
- 當日即時資料優先於快照，即使快照已有今日資料也不取代首次即時查詢。有效即時快取在五分鐘內重用，真正 fetchedAt 不變；快照讀取獨立進行，不拖慢成功的 API 回應。API 失敗時保留原 JSON 日期與擷取時間。
- 五分鐘失敗冷卻，HTTP 429、HTTP 錯誤、CORS／網路、十二秒逾時、格式與日期錯誤皆有安全提示。瀏覽器 TypeError 無法單獨斷定 CORS，仍使用合併的連線／CORS 訊息。不讀取 Cookie／Token，不向第三方傳送使用者行程或地區資料。
- 同星座進行中請求合併；消費者可個別取消，沒有其他消費者才中止實際請求。切換與離頁使用 AbortController、generation 檢查防止舊回應覆蓋；取消不寫失敗冷卻。
- 沒有新增定期輪詢。每個掛載卡片只維持一個臺灣午夜檢查計時器，以及回前景事件；背景不新發請求，返回前景、重新進首頁時重查日期與快取資格。離頁清除計時器與事件。
- 每次繪圖重新比較 Asia/Taipei 日期，fallback 非當日警告不在折疊文字內。所有外部文字都以 textContent 顯示。
- 原 893 項測試保留；第一階段「今日基線不發即時請求」案例依本次新優先順序改為要求發一次即時請求，沒有移除案例。新增 18 項整合／服務驗證，最終 57 檔、911／911 通過。Build（75 modules）、公開安全檢查與 git diff --check 通過。
- 真實 Chrome：十二星座均顯示來源日期 2026-10-24 的即時資料；首次僅選中星座一請求，依序看完十二星座共十二請求，回看牡羊座仍十二請求。模擬瀏覽器位於 America/Los_Angeles，卡片仍以臺灣日期標示；390px 無水平溢出、首頁天氣有七筆且今天正確，隔離 localStorage 未新增 Key。
- 受控瀏覽器 Mock 與真實來源結果分開記錄；Mock 合成內容只存在隔離頁面記憶體與測試，不會寫入正式 JSON、快照或 Manifest。
- 本階段相對第一階段修改：src/components/horoscope.js、src/services/horoscope-live.js、tests/horoscope-live.test.js、tests/horoscope-ui.test.js、tests/overview.test.js、新增 tests/horoscope-integrated.test.js、data-sources/horoscope.md、本文。

具備後續安全提交的本機條件；正式發布仍需另行授權，屆時必須使用有效且核准的 Checkpoint 與 Publish Guard 流程，不使用本機較舊 JSON 覆蓋正式資料，也不能因本機測試通過就宣稱雲端已更新。

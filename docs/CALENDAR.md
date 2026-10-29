# 個人行事曆（Phase 8H-2C，本機未部署）

> 2026/10/29 現況：目前行事曆、CRUD、localStorage 與首頁今日行程已正式部署。 現況彙整見 [README](../README.md)；下方階段狀態依原紀錄保留。

入口：側邊導覽「行事曆」，路由 `#/calendar`。繁體中文月視圖提供上個月、下個月、今天，日期依 Asia/Taipei 判斷；不依賴外部日曆服務。

首頁「今日行程」直接透過相同儲存服務唯讀取得資料，依實際開始日期／時間排序，最多顯示五筆，其餘可前往行事曆。包含全天與跨日行程；有時間的行程以排他結束時間判斷，恰好午夜結束不列入隔日，零長度行程仍列於開始日。顯示原有標題、時間及顏色，不建立第二份行程資料。返回首頁重新讀取最新內容；保持首頁不離開時不另設輪詢。

摘要連結 `#/calendar?event=識別碼` 會定位行程開始月份並開啟原有編輯／查看視窗，無效或已刪除識別碼顯示提示。空狀態入口 `#/calendar?new=today` 開啟今日新增表單，只有主動儲存才寫入。損壞或無法存取資料顯示錯誤，不當成空行程，也不清空原始資料。

使用 FullCalendar Standard 6.1.22 的 `@fullcalendar/core`、`@fullcalendar/daygrid`、`@fullcalendar/interaction`；必要相依 Preact 同樣為 MIT。只在進入頁面時載入月曆程式，離開時銷毀實例，不增加常駐刷新。

沿用 DailyInfo 的深淺模式、五種主題色與三種字級；小螢幕工具列換行，日期維持七欄。

點日期或「新增行程」開啟表單；點既有行程可查看／編輯，刪除須在同一視窗再次確認。支援五色、全天與有時間的跨日行程，結束不可早於開始。全天結束日期包含所選當日，轉成 FullCalendar 排他結束日；時間為臺灣牆上時間，不做瀏覽器時區換算。日期範圍 1900–2199，標題限 120 字，不接受控制字元。

獨立 localStorage key：`dailyinfo.calendar.events.v1`，結構 `{ version: 1, events: [{ id, title, startDate, endDate, allDay, startTime, endTime, color }] }`。全天時間欄位為 null；一般時間為 HH:mm，顏色為固定白名單。載入驗證版本、唯一 ID、內容、日期、時間與顏色；資料損壞或存取被禁止時鎖定編輯，不覆寫原始資料。

成功寫入後才更新月曆；額度不足或存取失敗會保留表單與舊資料。保存前重讀並比對載入時內容，拒絕覆寫其他分頁修改；需重新開啟此頁載入新版本。容量限制為一百萬字元及最多一萬筆，超過即拒絕保存，不刪除行程。

行程文字以安全 DOM textContent 呈現，無 HTML 執行；只存在目前瀏覽器與目前網站 origin，不送至資料更新 API、Checkpoint、GitHub 或第三方。清除瀏覽器資料可能永久遺失行程；沒有跨裝置同步、週期、提醒、Google OAuth/API、後端、帳號或付費功能。

授權核對（2026/10/20）：官方 [Standard MIT 說明](https://fullcalendar.io/license)，並核對 npm metadata 與安裝套件的 LICENSE。沒有安裝 Premium、Scheduler 或任何付費插件，不需 license key、訂閱或試用。

公開散佈保留完整授權：`public/licenses/fullcalendar-MIT.txt`（core/daygrid 同一著作權聲明）與 `public/licenses/preact-MIT.txt`。Vite 建置會保留這兩份文字檔；原本地圖與各資料來源署名不變。

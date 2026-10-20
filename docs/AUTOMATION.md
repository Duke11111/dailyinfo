# Phase 6D：資料更新與發布操作說明

> Phase 8B 現況：Repository 已公開，Actions 整體停用，Pages 未部署。本機 `data-update.yml` 已移除 schedule，只保留手動入口；下面頻率與啟用方式屬未來 Phase 8D 的待授權方案，不代表目前有排程。首次網站部署改用獨立 [Pages 手動流程](PAGES.md)，不開資料更新開關或設定 Secrets。

## 現況與建議方案

已備妥「GitHub Actions + 免費靜態網站」流程，**目前沒有啟用排程、設定 Secrets、推送或部署**。預設兩道開關都關閉。待使用者決定平台並授權後才啟用；現有本機網站仍照常運作。

建議免費方案是公開 repository 搭配 GitHub Pages（需另行同意公開程式碼與現有公開資料）。GitHub Free 的 Pages 適用公開 repository；私人 repository 的 Pages 需要符合其他方案資格，不能假設免費，也不會自行升級。若希望程式碼保留私人，應先決定其他免費靜態託管平台，再更換發布 job；其 API Token／額度需另行評估，不在本階段開通。

## 更新時程（Asia/Taipei）

| 來源 | 初始建議頻率 | 理由與限制 |
| --- | --- | --- |
| 股票 | 週一至週五 18:17，當日一次 | 晚於程式的 17:00 門檻；不推測假日行事曆，休市或尚未發布時保留最後有效交易日，不稱即時行情。若官方延後，需手動重跑。 |
| 新聞 | 每 3 小時 | 每輪五個官方 RSS，各一次；不抓全文。每天最多 40 次 RSS 請求。 |
| 地震 | 每 3 小時 | 兩種官方報告各一次，每天最多 16 次；不是地震預警，無分鐘級即時保證。啟用前確認自己的 CWA 帳號額度。 |
| 外幣 | 週一至週五 15:17，當日一次 | 官方 CSV 與網頁各一次，保留銀行牌告時間；不冒稱最新成交匯率。 |
| 星座 | 每天 09:17，當日一次 | 十二星座各一次、兩個 worker；留出 UTC 換日時間。來源日期不符合臺灣今天會拒絕更新，當天可手動再試，不無限重試。 |
| 天氣／AQI | 現有前端查詢及快取 | 不加入排程、不變更現有服務。 |

統一 UTC cron：`17 1,4,7,10,13,16,19,22 * * *`，臺灣依序為 09:17、12:17、15:17、18:17、21:17、00:17、03:17、06:17。避開整點。Node 以臺灣時間判斷來源是否到期；排程延遲後仍可執行當日合適的工作。新聞／地震另設 150 分鐘間隔，避免手動重跑後立即重複請求。每日來源在合適時段嘗試一次，失敗留待下次日程或手動觸發；早於門檻的手動更新不會阻止當日盤後更新。

這是低頻、保守的展示用初始設定，不是來源承諾的更新 SLA。各來源與授權仍沿用 `data-sources/` 紀錄；資料提供者或 GitHub runner IP 可能限制存取，失敗時不繞過、不無限重試。

## 本地入口與保護

```powershell
npm.cmd run update:data
npm.cmd run update:data -- --sources=quotes,exchange
npm.cmd run update:data -- --scheduled
npm.cmd run verify:data
npm.cmd run build
npm.cmd run verify:data -- --dist
```

第一個指令明確更新全部來源（含使用既有安全機制的地震腳本），`--sources` 只接受五個固定代碼。`--scheduled` 依時區及上次嘗試時間挑選來源。原本各項 `update:*` 指令仍可使用，預設輸出路徑不變；不要同時執行直接更新與統一更新指令。

統一入口不重寫來源解析器：每個既有 Node 腳本以 `DAILYINFO_DATA_DIR` 寫入專案 `.cache/data-updates/run-*` 的獨立暫存目錄，先帶入對應舊快照。整個 child process 有 210 秒期限；stdout、stderr 與原始例外均不轉印。只要某來源失敗或產出異常，就捨棄其候選檔，繼續其他來源。

候選資料再經既有 schema 驗證、禁止秘密欄位／常見密鑰格式與已提供 CWA secret 精確字串檢查、未來日期與日期倒退檢查。星座必須是臺灣當日資料。舊快照損壞會拒絕覆寫，留待人工檢查。

有實質變更才原子替換對應公開 JSON。忽略單純 `fetchedAt`、原始 hash、HTTP headers 及匯率 evidence 的變動；真正內容、交易日期、牌告時間、運勢日期仍會觸發更新。內容沒變時，公開快照擷取時間保留原值；最新「檢查成功時間」另記於安全狀態，不假裝重新發布。網站依原介面顯示實際資料日期及快照擷取時間，瀏覽器刷新只讀已發布檔案／既有快取。

`.cache/data-updates/status.json` 保存各來源的 attemptedAt、lastSuccessAt、updated/unchanged/failed 與固定錯誤代碼；`report.json` 保存本輪結果，不含原始錯誤、外部完整回應或金鑰。兩檔不進 Git、不進前端／正式建置。成功 exit 0、部分來源失敗 exit 2、入口／鎖／狀態異常 exit 1。Actions 對 exit 2 顯示 warning 並可發布其他有效資料；所有公開快照仍須驗證通過。

本機 `lock` 與 Actions concurrency 阻止統一入口重疊，已執行的工作不會被新排程取消。異常中止若留下 `.cache/data-updates/lock`，先確認沒有 Node 更新程序，再人工移除該空目錄；不自動清除可能仍有效的鎖。

## 雲端持久化與失敗恢復

GitHub runner 每次是乾淨環境，不能只依賴 checkout 的舊 JSON。流程會還原同 repository、預設分支、同工作流程、schedule/workflow_dispatch 成功執行留下的 `dailyinfo-data-state` artifact；其五份 JSON、狀態與 SHA-256 manifest 全部驗證後才使用。手動提交的更新資料若比 artifact 新，優先保留 repository 較新資料。

找不到、過期、格式異常或 checksum 不符時停止，不自動退回未知舊狀態。首次啟動才在手動觸發勾 `initialize_state`，明確接受 repository 的已驗證快照當基線。若中斷超過七天造成 artifact 過期，應先從最後發布版本或可信備份恢復，人工檢查日期後才重新初始化。

每輪只保存指定公開快照與安全狀態，不上傳 `.env.local`、整個工作區或原始日誌。candidate artifact 留 1 天，正式 checkpoint 留 7 天。只在更新、測試／建置，以及已啟用的部署成功後才推進正式 checkpoint；失敗保留之前發布版本及 checkpoint，後續可再試，不把失敗候選當成已發布基線。

同內容且相同程式 commit 的排程只更新檢查狀態，不重建／部署。程式 commit 改變需要重建；首次啟用發布或恢復發布時，手動勾 `publish_current` 可重建相同內容。這是明確的一次性操作，不是每輪強制發布。

## 取得授權後的啟用步驟（本階段未執行）

1. 決定 repository 可見性與正式託管平台；審查目前 Git 變更及排程後，由使用者授權推送工作流程至預設分支。不要公開 `.env.local`。
2. 在 GitHub repository 的 Actions Secrets 設定 `CWA_API_KEY`。使用者直接在 GitHub 輸入，不貼到聊天。只提供給 Node 更新及秘密檢查步驟；build/deploy 的環境不帶此 key。CI 直接使用 process environment，缺 key 時只停用當輪地震更新，絕不建立 `.env.local`。
3. 確認免費額度、Artifact 儲存與**超額停止使用**設定；不要啟用付費 runner 或放寬預算。先設定 Variables `DATA_AUTOMATION_ENABLED=true`，其餘發布開關保持未設定／false。
4. 手動執行 `DailyInfo data update`：source=all、首次勾 initialize_state。檢查安全 summary、五份資料日期、候選網站 artifact。若有來源失敗，先確認原因；不把成功建置誤當作所有來源皆成功。
5. 若選 GitHub Pages：Settings → Pages 的 Source 設為 GitHub Actions，設定 `github-pages` environment 的預設分支限制，可加人工審查；確認所有資料授權與公開內容。
6. 使用者授權發布後才設定 `DATA_DEPLOY_TARGET=pages`、`DATA_PUBLISH_ENABLED=true`，手動勾 publish_current 執行首次發布。準備好的 Pages job 才會取得 `pages:write`、`id-token:write`。更新 job 只有 `contents:read`／`actions:read`，不需要 PAT 或 contents:write；不提交自動資料到 Git、不執行 git push。
7. 驗證正式網址、來源日期、導覽與下個排程。若選其他平台，保持 Pages 開關關閉，需另接最小權限發布 adapter 並驗收。

停用：`DATA_AUTOMATION_ENABLED=false` 停止更新工作；`DATA_PUBLISH_ENABLED=false` 僅停止對外發布；也可直接停用 workflow。已發布的靜態網站會繼續提供最後有效資料。

## GitHub 免費額度與限制（2026-10-20 查核）

- [官方 Actions 計費](https://docs.github.com/en/billing/concepts/product-billing/github-actions)：公開 repository 的標準 GitHub-hosted runner 分鐘免費；私人 repository 依帳戶方案使用共享額度。GitHub Free 為每月 2,000 分鐘、Artifact 500 MB，與帳戶其他專案／Packages 共用，不是本專案獨享；大型 runner 不屬免費方案。
- [方案額度](https://docs.github.com/en/billing/reference/product-usage-included)：超額可能計費，須設定超額停止使用；本階段沒有變更帳戶預算／付款設定，不能保證使用者現有帳戶的其他用量。
- 本設定每天 8 輪，30 天約 240 輪。若更新、checkpoint、已啟用部署合計平均 3–5 分鐘／輪，估約 720–1,200 分鐘／月；這是估算，尚無雲端實測。失敗、手動執行、其他 workflow 也會占額度，須依實際 Usage 降低頻率。五份現有快照約 596 kB，短期 artifact 保留可減少儲存，不假設免費儲存無限。
- [官方排程限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)：預設 UTC，最短五分鐘；只執行預設分支，繁忙時會延遲甚至丟棄，公開 repository 60 天無活動會停用排程。它不提供準時或即時更新保證。
- [Pages 方案](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[部署權限](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：本階段僅準備安全、預設不啟用的 Pages job，沒有改公開可見性、設定 Secrets、實際執行 Actions 或部署網站。

## 已驗證與未驗證邊界

已驗證本機統一入口的真實股票請求：交易日仍為 2026-10-19，內容相同回報 unchanged，原公開檔案不改寫。其他來源獨立成功／失敗、舊檔保護、日期、互斥、秘密攔截、checkpoint checksum／較新資料保留及工作流程安全條件透過自動化測試驗證。本階段未重複對其他外部來源發送實際請求，也未讀取本機真實 CWA Key。

尚未在 GitHub runner 實測排程、跨輪 artifact REST 還原、environment 審查或 Pages 發布；需平台決定及授權後驗收。工作流程檔案通過本地結構／安全契約測試，不宣稱已在雲端成功執行。本候選版本已將六個官方 Actions 固定為實際查證的完整 commit SHA，詳見 [ACTIONS_PINS.md](ACTIONS_PINS.md)。

# 正式發布防倒退與部署互斥（D5-Guard，本機待驗收）

本機準備，未 Push、執行 Actions 或部署。沒有新增服務、套件、Secrets、預算或付費方案；本次完整驗收後僅依授權建立本機整合 Commit。

本次已在 `test/d5-integration` 將此 Guard 接到 `ee30aed` 的 D4 程式：兩條正式部署路徑同用下述防護；`DATA_SCHEDULE_MODE=d4` 永不部署，`continuous` 才可在獨立完整授權與真實新資料條件下自動發布。未設定模式不啟動排程。原 `dailyinfo-d5-prep` 修改完整保留；首次 Manifest 接軌已有嚴格本機實作，實際雲端執行仍需另行核准。

## 兩條路徑共用一個鎖

`data-update.yml` 與 `pages-manual.yml` 的 workflow-level concurrency 均為 `dailyinfo-production`、`cancel-in-progress: false`。鎖涵蓋還原／建置、正式資料比對、上傳、deploy 與 checkpoint；不把鎖只放在最後 deploy job，避免兩個流程先各自比對後交錯發布。代價是不發布的更新也會與部署串行。

GitHub concurrency 不保證 FIFO，新的 pending run 可能取代既有 pending run；這不是重試機制，也不代表每次排程都會執行。不得因未觸發或被取代就宣稱驗收成功。

手動 Pages 不再是繞過途徑：除了手動 main 觸發，必須總發布開關=true、目標=pages，且通過同一份 guard、完整測試、Build、安全與 Artifact 額度檢查。沒有資料更新或還原的備援分支；Repository JSON 較舊就停止，不會偷偷換資料。

## 基線與 Manifest

新增 `scripts/publish-guard.mjs` 是明確的 CI 入口；單元測試只使用可注入的 Mock，不執行入口、不連網。

1. 使用唯讀 GitHub API 取得 `github-pages` 環境最新 deployment。最新狀態必須 success；pending、失敗、inactive、未知狀態及 API 錯誤均停止，不能往前找一個綠色紀錄頂替。
2. 依部署狀態的固定 GitHub Actions log_url，核對來源 Run 的 main、Commit、Run ID、attempt、受允許的 Workflow、事件、completed/success，並另確認 deploy job 確實 success。不是單看 Workflow 綠色。
3. 從固定正式 HTTPS 網址讀取 `release-manifest.json`。Manifest v1 綁定 repository／commit／runId／runAttempt，含五份資料各自的 SHA-256、有效來源日期及 fetchedAt。不得包含 status、內部候選狀態、金鑰或使用者資料。
4. Manifest 必須吻合 API 最新成功部署。五份正式 JSON 各自通過 Schema、隱私及真實日期驗證，並與 Manifest 雜湊及時間完全相符。動態資料沿用既有驗證器，股票目錄使用既有 catalog 驗證器。
5. 候選 dist 的五份資料亦獨立驗證：四份動態資料的來源日期與 fetchedAt 均不可倒退；同擷取時間卻異內容視為證據不足而拒絕。新聞新資料與未變股票可以合法共同發布，部分來源失敗時仍只使用先前有效快照。
6. 股票目錄 SHA-256 必須相同。目錄異動一律停止，需另外提出程式／資料審查與經授權的基線更新方案；目前沒有寬鬆的自動核准欄位，不能當成行情更新發布。
7. 再讀一次 GitHub 部署基線及網站 Manifest，任何改變均停止。只有全部通過才在 dist 產生新 Manifest，再執行既有安全掃描並上傳 Pages Artifact；不修改 public/data。

API 僅新增 `deployments: read`，不新增寫入權限。公開 HTTP 請求不帶 GitHub Token、Cookie 或 CWA Key，使用固定 HTTPS 來源、no-store、隨機快取鍵、拒絕 redirect、12 秒逾時、4 MiB 回應上限與嚴格 UTF-8。沒有自動重試；CLI 錯誤只顯示固定拒絕訊息，不轉印原始 API／HTTP 回應。

CDN 的 no-store 與隨機鍵只是降低快取機會，**本身不是證明**。真正的拒絕條件是 Manifest 不符合 API 的最新部署，或任一 JSON 不符合 Manifest。即使收到舊 Manifest／混合 CDN 版本，也不放行。Manifest 自身不可取代 Checkpoint v2 的 SHA-256、Schema、來源與期限驗證。

新 Manifest 隨已驗證的 Pages Artifact 一起發布，不增加獨立持久 Artifact。部署失敗不推進正式 Checkpoint，前次網站 Manifest 仍是 API 可證明成功的版本；API 最新紀錄若變成失敗則停止後續發布，等待人工確認，不自動回退或重試。

## 首次接軌：需要明確手動核准的可信基線

2026/10/22 臺灣時間 22:14 的唯讀查核：正式 `release-manifest.json` 為 HTTP 404。部署 `7248868617`、來源成功 Run `39757223565` attempt 1、Commit `0471d5a64afaea5af87384c1763b566d36cdef64` 與實際成功 deploy job 均經 API 驗證。下載當次 Pages Artifact `12416491719` 與 Checkpoint `12416865318` 在記憶體驗證兩份壓縮檔 digest；Pages tar 五份 JSON 均與正式 HTTP 原始位元組 SHA-256 一致，四份動態資料亦與 v2 Checkpoint 的 Manifest、Checksum、Schema、來源日期相符。未修改正式 JSON 或既有 Artifact。

`data-sources/release-baseline.json` 保存該次證據、五份 hashes／來源日期／fetchedAt、Deployment／Run／Commit／attempt 及兩份 Artifact digest。有效期限綁定核准 Checkpoint 的 **2026/10/29 17:41:22（臺灣時間）**，不是永久最新狀態。它是需經人工審查與 Commit 的信任根，不是程式在雲端臨時讀網頁後自行核准；若正式部署或任一位元組不同就停止。

未來第一次接軌必須另行明確核准以下操作，本階段不執行：

1. 核准推送最終新 Commit；重新檢查免費額度、US$0／Usage blocked、無並行／舊版部署、原部署／資料／有效 Checkpoint 與回復依據。
2. 保持 `DATA_AUTOMATION_ENABLED=true`、`DATA_SCHEDULE_ENABLED=false`、`DATA_AUTO_PUBLISH_ENABLED` 未設定；僅短期核准 `DATA_FREE_USAGE_CONFIRMED=true`、`DATA_PUBLISH_ENABLED=true`、`DATA_DEPLOY_TARGET=pages`。目前程式不會自動設定這些變數。
3. 只手動執行 data-update.yml/main 一次，`source=checkpoint`、`checkpoint_run=39757223565`、`initialize_state=false`、`publish_current=true`，另明確指定 `initialize_manifest=true` 與 `baseline_approval=sha256:f83594416e570875811e72bedbe5c1033b42e1d5aa5e39697e8b9af1f1f47b20`。雲端操作前必須重新核對該核准紀錄是否仍有效，不自行替換較新 Run。
4. `baseline_approval` 是 `JSON.stringify(JSON.parse(file))` 的 SHA-256，因此 Windows CRLF／排版空白不影響授權值；不等同直接 Get-FileHash 原始檔案。內容改動須重新人工核准 digest。
5. 來源更新前的獨立 authorization step 先拒絕排程、其他分支／Workflow、run_attempt>1、錯誤／缺少 digest、非 checkpoint、重新初始化、缺少發布或免費授權。沒有自動重試、PAT 或新 Token 權限。
6. 正常完整測試、Build、安全掃描及原 Checkpoint 驗證仍執行；Guard 只在精確 HTTP 404 時使用核准檔形成初始基線。403／429／5xx、網路失敗、HTML 或損壞的既有 Manifest 均不能初始化。
7. 重新確認正式部署與五份 JSON 仍吻合核准檔；初次候選資料必須與核准五份資料完全同位元組，不可夾帶來源更新或較舊 Repository JSON。再次查核部署、確認 Manifest 仍是 404 後，才在 dist 產生綁定新 Run／Commit 的正式 Manifest，並執行上傳前安全掃描。共用 production lock 全程保留。
8. 實際發布成功後核對新 Manifest、部署及五份 JSON，恢復 `DATA_PUBLISH_ENABLED=false`、刪除 `DATA_DEPLOY_TARGET` 與短期免費確認，排程／自動發布保持關閉。不自動恢復或啟用長期模式。

初始化一旦成功，正式 Deployment 已改變且 Manifest 已存在，原核准初始化不能重放；正常後續發布仍驗證正式 Manifest／最新成功部署、來源時間及候選資料，不能回到初始化分支。部署失敗不推進成功 Checkpoint；若原部署已改變、期限已過或 CDN 不一致，保留阻擋，重新取得人工核准，不能停用 Guard。上述 Artifact digest 是本次驗證證據；來源 Artifact 自然到期不代表重新授權，也不會由程式自動重建核准檔。

## 剩餘競態與安全操作條件

- 同群組能保護這兩份**新版** Workflow，但不能鎖住管理員、外部部署程式或舊版 Workflow 的重新執行。正式採用前必須確認沒有這些執行／排隊項目，並在驗收期間禁止從其他路徑部署。若不能確保，就不得開始發布。
- 基線第二次查核到實際 deploy 之間沒有 GitHub 提供的資料版本 compare-and-swap；任意具權限操作仍可能插入。管理員可修改 Workflow／資料本身，也不在此保護的信任邊界內。不能宣稱跨所有外部操作完全無競態或防惡意管理員。
- 未知 API 形狀、缺少 log_url／environment_url、API 與 CDN 尚未收斂、限流或故障時均停止，不放寬規則；需一次受控雲端驗收確認真實 API 形狀，不能只憑 Mock 宣稱已完成雲端驗證。
- GitHub Pages 的 CDN 切換本身不保證所有地點同時更新；本機預檢不宣稱發布後全世界立即一致。發布後仍需查核 API、Manifest 與五份 JSON，資料不一致就停止後續操作並回報，不自行重試部署。

官方規格參考：[Deployment API](https://docs.github.com/en/rest/deployments/deployments)、[Deployment statuses API](https://docs.github.com/en/rest/deployments/statuses)。安全閘門、免費額度與 Checkpoint 規則見 [自動更新說明](AUTOMATIC-UPDATES.md)。

# DailyInfo 外部 hourly scheduler（本機範例，尚未啟用）

本範例不建立帳號、Token 或雲端資源。Worker 預設 `ENABLED=false`、`FREE_USAGE_CONFIRMED=false`，不傳送請求。沒有新增依賴、KV、Durable Objects、付費服務或 CWA key。請先核准 GitHub 程式上線，再另行核准 Worker 部署及啟用。

## 架構與時區

Cloudflare Cron → 固定 GitHub dispatch URL / `ref=main` / `external_schedule=true` → 原本的 production concurrency → 免費用量檢查 → 最新成功 Checkpoint 還原 → `core --scheduled` → latest-valid-wins → 有有效新內容才測試、Build、驗證 → 完整發布授權 + Publish Guard → Pages → Checkpoint。

- Cloudflare UTC cron：`17 0-15 * * *`，臺灣每日 08:17～23:17，共 16 個預定 tick。
- Worker 不傳送「今天」、行情日期或 fetchedAt。GitHub 使用**實際執行時刻**，沿用 Asia/Taipei 共用時間工具判斷 due；夜間延遲至 00:00～07:59 不補造更新。
- 新聞、地震：同小時去重及 45 分鐘冷卻。股票：臺灣平日 17:00 後，當日成功後不重抓；官方休市/延遲仍保留真實交易日。星座：09:00 後，只接受當日。天氣仍由前端即時 API 提供。
- Worker 只送一次 POST，8 秒逾時，不跟隨 redirect，不讀取或記錄回應本文。超時可能已送達，記為 `dispatch_unconfirmed`，不得自動重送。
- Worker 拒絕超過 15 分鐘、未到時刻、錯誤 cron 或夜間的 delivery。此限制是 Worker 本次送出資格，**不是 GitHub Runner 開始時限**。
- 收到 HTTP 200/204 只表示 dispatch accepted，不表示 update/deploy/Checkpoint 成功。GitHub event 仍是 `workflow_dispatch`，須核對 `external_schedule=true`，不能標示為原生 `schedule`。

## GitHub input 與授權

新增 boolean `external_schedule`，預設 false。一般手動更新、checkpoint-only 發布與初始化保留原有行為。

外部 tick 僅接受 `source=core`，以下全部固定：

```json
{
  "ref": "main",
  "inputs": {
    "external_schedule": true,
    "source": "core",
    "initialize_state": false,
    "initialize_manifest": false,
    "publish_current": false,
    "checkpoint_run": "",
    "baseline_approval": ""
  }
}
```

外部 tick 需要 main、Public repository、run attempt=1、`DATA_AUTOMATION_ENABLED=true`、`DATA_SCHEDULE_ENABLED=true`、`DATA_SCHEDULE_MODE=continuous`、`DATA_FREE_USAGE_CONFIRMED=true`。YAML job admission 與 Node 驗證各自檢查；Node 在 GitHub/資料 API 操作前檢查。

外部 tick 的發布使用**自動發布**政策，不能套用一般手動授權。必須有 `DATA_CHANGED=true`，並且 `DATA_AUTO_PUBLISH_ENABLED=true`、`DATA_PUBLISH_ENABLED=true`、`DATA_DEPLOY_TARGET=pages` 及既有免費/排程授權均符合。未變動時，即使 CODE_CHANGED 或 FORCE_BUILD，也不 Build、不 Deploy；不變更有效快照的 fetchedAt。仍可保存 status v1 的嘗試紀錄與 Checkpoint v2（沿用 7 天）。

## GitHub 原生 schedule fallback 與去重邊界

本機修改**保留原生 hourly cron 完全不變**，不更動正式設定。兩種入口共享 `dailyinfo-production`、`cancel-in-progress=false`。第一個成功完成的 Run 保存同小時 attemptedAt，後一個還原其 Checkpoint 後會跳過該來源；沒有資料變動不會重複部署。測試涵蓋兩種先後順序及還原後去重。

這不是跨服務的 exactly-once 保證：若第一次在 Checkpoint 保存前取消、更新/建置/部署失敗，下一次會還原較早 status，可能重新請求來源。既有 concurrency 也只保證同時一個執行中、一個等待中；更多等待項目可能被 GitHub 取代。Publish Guard 仍以正式 Manifest、防倒退與來源證據阻擋不安全發布。不可聲稱失敗後也已永久領用，或 Worker 保證一小時內完成。

以減少空 Run 與 Artifact 為優先的後續建議：Worker 通過一次受控驗收後，再另案將原生 fallback 縮成 UTC `17 2,9,14 * * *`（臺灣 10:17、17:17、22:17），仍與 hourly tick 共用同小時狀態。**目前未實作或套用此縮減**；不能只改 YAML，必須同步擴充 schedule-mode 的 allowlist、將 fallback 正規化至既有 hourly due rules，並補測後再核准。

保留兩個 hourly 入口時：名義上最多 32 個 Run/日（各 16；人工操作與平台重送不在此估算內），即使去重仍有 Runner/Checkpoint 成本。Checkpoint 約 224 份/7 天，另外加一日 candidate；沿用 180 MiB 儲存上限、24 MiB 預留與每次上傳大小限制。這不是全帳號額度證明，超限/未知必須停止；不得為了續跑刪除有效備份或提高預算。

## Token 與免費條件（設定當天須重新人工確認）

- 只使用 Workers **Free**，不要選 Workers Paid、試用付費方案、綁卡或開啟超額計費。官方目前列出 Free 100,000 次請求/日、每次 10ms CPU；本例名義 16 次 scheduled invocation/日、每次一個 GitHub subrequest，不代表整個帳號都在額度內。
- GitHub 保持 Public、標準 ubuntu-latest；沿用 US$0 / Usage blocked、帳號共用儲存額度人工確認及程式 Artifact guard。不修改 Billing 或權限保護。若條款/免費條件無法確認，停止啟用。
- 後續手動建立 **fine-grained PAT**，只選 `Duke11111/dailyinfo`，Repository permissions 只需 **Actions: Read and write**（Metadata read 為 GitHub 自動提供）。不需 Contents write、Secrets、Administration 或帳務權限。設定有限有效期限，定期人工更換。
- GitHub 的 Actions write 無法細分成「僅能觸發這一支 workflow」：Token 外洩仍可能操作該 repo 的其他 Actions，不能宣稱只有 dispatch 權限。固定 URL、沒有公開 HTTP 觸發入口、禁用 preview 與最小 repository 範圍降低曝露。
- 僅將 Token 存為 Cloudflare encrypted Secret `GITHUB_TOKEN`。這不是 GitHub Runner 自動提供的同名 Token；不可複製 CWA key 或提交 `.env`、`.dev.vars`、Token、截圖或登入資料。新增 ignore 規則覆蓋 `.dev.vars.*` 與 `.env.*`。

## 後續人工設定流程（本次均未執行）

1. 審核本分支，另行核准 Commit/整合/Push。先確認 GitHub main 已包含 `external_schedule` 及所有安全測試；正式資料/Manifest 不初始化。
2. 人工核對 Cloudflare Workers Free 與帳號共用額度、GitHub US$0 封鎖。使用者自行建立免費 Cloudflare 帳號；若要求付費/綁卡則停止。
3. 人工建立上述 repo 限定 Token。不要貼到聊天、檔案或 GitHub Repository Variables。
4. Cloudflare 控制台建立 module Worker，貼上 `worker.mjs`；只保留 scheduled handler，關閉 workers.dev、preview URLs 與所有 HTTP routes/custom domains。先維持 `ENABLED=false`。
5. 在 Worker Settings 的 Secrets 加入加密的 `GITHUB_TOKEN`；加入文字變數 `FREE_USAGE_CONFIRMED=true`（確認 Free 後）、`ENABLED=false`。不授予其他綁定。Cron Triggers 設 `17 0-15 * * *`（UTC）。本機 `wrangler.toml` 是等效設定範例，沒有安裝 Wrangler 或執行部署。
6. 取得獨立啟用授權後，再設 `ENABLED=true`。首次受控驗收建議 GitHub 發布總開關維持 false，只驗證自然 Cloudflare tick、due、來源結果、Checkpoint 與 deploy skipped；需要另行授權才能更改 GitHub 開關。
7. 有新資料的 Run 才會執行完整測試、Build、verify。核對四來源摘要、Checkpoint v2、Schema/SHA-256 與原有正式網站未變，不能只看綠燈。未發生 tick/dispatch rejected/Runner 排隊都不能算 PASS，不自動重試。
8. 後續再取得自動發布授權，確認 Manifest 與正式資料基線後開啟既有發布閘門。首次真正自動發布完成後，核對新 Deployment、Manifest、五份 JSON；不能將 accepted 當成發布成功。

停用外部觸發：Worker `ENABLED=false` 或移除 Cron；停用全部 scheduled 更新：GitHub `DATA_SCHEDULE_ENABLED=false`；只停用自動發布：`DATA_PUBLISH_ENABLED=false`。以上均需主動操作與讀回確認，不會自動失效；已排隊/執行的 Run 要另行查看，不能假設關閉變數就會撤銷現有 Job。

Cloudflare cron 不經 GitHub 原生 scheduler，但 workflow_dispatch 仍受 GitHub Actions 排隊、可用性及免費額度影響。兩者都沒有本專案可保證的準點或一小時完成 SLA。

## 官方依據

- [Cloudflare Cron（UTC）](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers Free 定價與限制](https://developers.cloudflare.com/workers/platform/pricing/)
- [GitHub workflow dispatch 與 Actions write 權限](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)

本機測試使用 Vitest Mock 與合成 Fixture，不呼叫 GitHub、Cloudflare 或資料來源。

# D4 一次性排程驗收（本機準備，未啟用）

原始基準 main：`0471d5a64afaea5af87384c1763b566d36cdef64`。D4 初版 `709b95069064268f6a3eda12e93ecbc6a04fc865` 已推送；本次 Runner 權限修正只在隔離分支 `test/d4-one-shot-acceptance` 處理，未啟用雲端驗收，未修改 D5 worktree。

## 有限授權，不需要人在 20:43 守候

本 D5 整合候選版需另明確選擇 `DATA_SCHEDULE_MODE=d4` 才啟用以下一次性路徑。`continuous` 模式不讀取 D4 日期與指定 Checkpoint；模式未設定即拒絕排程。所有設定仍需另行核准，本機整合不會修改雲端。D4 核准 SHA 必須是最終整合後實際執行的新 Commit，不可沿用本機基準 SHA。

保留原三個 Cron，D4 模式只允許 `43 12 * * *`（臺灣 20:43）啟動來源更新。上午、補救時段及缺少一次性設定時，整個更新 Job skipped。手動更新／checkpoint-only 原有政策保留，並不自動取得 D4 授權。

未來另經核准後才可設定 `DATA_D4_ONCE` JSON。它必須包含 version=1、`id=d4-YYYYMMDD-evening`、經核准的**新程式 Commit 完整 SHA**、當天 `target=YYYY-MM-DDT20:43:00+08:00`、同日 `deadline=YYYY-MM-DDT21:30:00+08:00`、已核准 Checkpoint 的 runId／artifactId／commit／GitHub digest、正式 deploymentId，以及五份已核准公開 JSON 的 SHA-256（published 的鍵為 stocks／quotes／news／earthquakes／horoscope）。未提供完整證據、設定錯誤或日期不符就停止。不是在程式內寫死今天，以免提交延遲後誤測另一天；每次換日期都需使用者重新明確授權。

既有 automation=true、schedule=true、free-usage-confirmed=true 閘門仍全數必要。總發布必須 false，AUTO_PUBLISH 與 DEPLOY_TARGET 必須未設定。啟用前仍須人工確認公開 Repository、免費標準 Runner、帳號共用額度及 US$0／Usage blocked；免費確認變數是人工預檢證據，不是假裝程式能讀取全帳號 Billing。沒有權限擴充或變更預算的路徑。

## 一次性與截止

六個開關均來自 Workflow 既有 `vars` context 傳入的環境變數；admission 及最終 acceptance 使用同一嚴格檢查。必要值必須是精確字串，選用值只接受未提供或 GitHub 對未設定值產生的空字串，不接受字串 `false`、空白或其他型別作為「未設定」。Runner 不呼叫 `actions/variables`，不需要 PAT 或新增 Token 權限。這些值是執行環境中的 context 快照，不能保證反映管理員在執行期間的即時修改；最終 Job 即使重新取得 context，也不能宣稱是 Variables 即時重讀。部署 ID 與五份公開資料仍另行透過唯讀 API／HTTP 核對。

1. 只有真正 schedule、main、核准 Commit、run_attempt=1 才可領用。Workflow 歷史與 claim Artifact 任一顯示已嘗試（包括失敗）即拒絕；查詢失敗、分頁超出邊界或資料不可信亦拒絕。
2. 領用前確認正式部署 ID／成功狀態及五份 JSON 的 Schema、SHA-256 與核准基線一致；不把網站單次讀取當成新的授權基線。
3. 使用既有 update concurrency 串行，先上傳七天的極小 `d4-日期-evening-claim` Artifact，成功後才還原指定 Checkpoint、呼叫來源更新。claim 上傳失敗亦不能更新。歷史 Run 是第二道防線，不依賴 Artifact 立即可見；同時有兩個符合時段的 Run 時保守拒絕。
4. 只接受 20:43 至 **21:10** 的實際開始時間，為 21:30 截止預留二十分鐘。正式基線 HTTP/API 檢查後、Checkpoint 還原後及第一個來源真正呼叫前均重驗 21:10，避免前置 I/O 拖過窗口。每來源啟動前及候選接受前重新檢查截止，子程序逾時取原 210 秒與剩餘時限的較小值；不接受逾時回傳的候選。若 GitHub 排隊使最終驗收晚於 21:30，即使先前 Job 成功仍為 FAIL。
5. 每來源仍只有一次原有更新腳本呼叫；內部原本必要的有限 GET 不改變。無自動重試、初始化、修改發布開關或切換資料來源。

**截止不是 Variables 自動關閉。**本程式沒有 Variables 寫入權限或命令。即使變數暫未人工清除，當日 claim／Run 歷史及永久失效的指定日期仍會拒絕後續來源更新。GitHub 仍可能在之後建立晚間 Run，啟動免費 Runner 做短暫拒絕檢查；不能宣稱連這些 Run 都完全消失。驗收後應人工 schedule=false，刪除 FREE_USAGE_CONFIRMED 與 DATA_D4_ONCE，維持發布關閉。

## 自動驗收報告

update 原有錯誤隔離與 Schema／Checksum／來源日期防護保留。額外保存不超過 32 KiB 的 before/report 證據一天，不放入正式 Checkpoint。四來源 Checkpoint 仍 v2、status 仍 v1、六個檔案、七天期限；不修改任何既有已核准 Artifact。

最後新增 `d4-acceptance` Job：update success、deploy skipped、checkpoint success 才可驗證新 Checkpoint。以原有 restoreState 驗證所有檔案 Manifest／SHA-256／Schema／Commit，並逐一比對來源摘要與最終資料。updated 必須確有內容改變；unchanged 必須保留原位元組；skipped 必須符合還原前 status 的 isDue；failed 一律不能 PASS。合法股票 source_delayed 可通過驗收，但清楚保留真實交易日，不能說已取得今日行情。

完整 PASS 必須在截止前完成，且正式 deploymentId、五份 JSON 雜湊符合核准基線、執行 context 的所有安全開關通過檢查。Summary 列出事件、截止、Job、來源日期、最近成功時間、補跑資格、Checkpoint ID／期限與各項 PASS／FAIL。測試／建置或原有安全檢查失敗會使 update 失敗，因此不能 PASS；沒有新內容且程式未變時，原有 build 省略政策仍保留，不虛稱未執行的測試已通過。

只要最終驗收 FAIL，整個 Run failure，新 Artifact 即使存在也不會被「只信任成功 Run」的還原政策選中；上一個有效 Checkpoint 不變。取消或平台故障若讓最後 Job 本身未執行，不能保證產生 Summary，也不能判 PASS。

**GitHub 完全漏觸發就沒有程式可寫 Summary。**結果只能是「未執行／證據不足」，不是 PASS。本次不新增外部監控、第二個監控排程或付費服務來製造保證。使用者可事後查看 Run／Summary，無須在 20:43 手動監看；漏觸發後不自動改測另一時段。

GitHub 的排隊、取消及 Runner 終止時間不提供精確牆鐘保證：21:30 是來源更新與 PASS 的程式安全界線，並非保證所有平台 Job 在該秒停止。晚到的驗收 Job 只能 FAIL。跨 Run 防重複依賴 GitHub 保存的 Run 歷史及 claim Artifact；更新前取消仍留下歷史，更新後取消則另有已成功上傳的 claim。不得手動刪除兩者後宣稱一次性保護仍成立。

`expectedSha` 是將本次修改提交後的新 Workflow 執行 Commit；`checkpoint.commit` 則是舊 Checkpoint 的來源 Commit，兩者獨立驗證。把前者仍設為基準 `0471d5a` 會安全拒絕新 HEAD，不能以更改舊 Checkpoint Commit 的方式修正。

## 費用與權限

僅標準 ubuntu-latest，沒有新套件或服務。沿用 180 MiB Repository 上限與 24 MiB 上傳預留；新增 claim 數百位元組、evidence 上限 32 KiB，在既有預留內。下載及驗證只用 actions:read／contents:read；正式基線額外 deployments:read，沒有 actions:write、Variables、Secrets 或帳務寫入。GitHub 官方說明公開儲存庫標準 Runner 免費，但 Artifact／Packages 共用額度仍需人工核對：[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

本分支暫時禁止所有 schedule 部署，不能直接當作 D5／長期自動化版本。未來整合 D5 必須另行審查一次性模式與長期模式的分離，不得直接移除閘門。

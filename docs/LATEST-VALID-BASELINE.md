# 最新有效資料基線

## 選擇規則

所有候選必須先通過各來源的 Schema、時間與公開資料安全驗證，再比較：

| 來源 | 第一順位 | 同來源日期時第二順位 |
|---|---|---|
| quotes | 官方 tradeDate | fetchedAt |
| news | 最新文章 publishedAt | fetchedAt |
| earthquakes | 最新事件 originTime | fetchedAt |
| horoscope | 十二星座一致的來源日期 | fetchedAt |

來源日期較新時，即使擷取時間較早，仍是較新的資料；來源日期較舊時，不能靠重新下載取得較晚的 fetchedAt 而反勝。
pageReadAt 只表示頁面讀取，不參與資料新舊或 TTL 計算。
stocks.json 是經程式審核的股票基本目錄，不是行情，這次不重新匯入或擅自改名單。

## 新 worktree／本機啟動

本修正版本提供 `npm run restore:baseline`，並在 `npm run dev`、`npm run build` 前執行。

1. 唯讀查詢既有 Repository 的最新成功 main 資料更新流程及未過期 Artifact。
2. 核對 Run、checkpoint job、來源 Commit、Artifact ZIP SHA-256。
3. 嚴格限制 ZIP 檔名、數量與大小；重新使用既有 Manifest v2、原始位元組 checksum、Schema 及日期驗證。
4. 完整驗證後，逐來源與本機比較；只接受較新的資料，不將較舊 Checkpoint 蓋回本機。
5. 與資料更新器共用本機 lock；不重新初始化狀態，也不改寫雲端 Checkpoint。

若網路不可用，只能重新驗證未過期的已下載 ZIP 後使用上次可信基線，並明確警告「未確認線上最新」。
若是新的 worktree、沒有可信基線，預設停止啟動／建置；不默默使用舊 Git JSON。
必要的離線 fallback 必須明確執行 `node scripts/restore-local-baseline.mjs --allow-git-fallback`；它仍會驗證 Schema，且不宣稱資料最新。Artifact 驗證失敗不走這個繞道。

CI 不執行這個本機 hook：既有 Workflow 已自行還原經核准 Checkpoint，仍由原 Publish Guard 控制發布。
本機下載只讀 GitHub；不觸發 Workflow、寫入 Variables、部署或要求額外 Token 權限。

目前修正尚未提交。從舊 Commit 建立的 worktree 不會自動包含新 hook；必須先採用含本修正的程式版本，不能宣稱所有舊版本已自動取得此能力。

## 瀏覽器快取

- 新程式／建置攜帶各來源的已驗證基線日期與 fetchedAt。
- 快取雖在 TTL 內，但落後於該基線時，先顯示可用舊資料，再背景讀取新 snapshot，不能被舊 localStorage 長時間遮住。
- 新 snapshot 可替換舊 cache；較舊回應不能覆蓋較新的 cache。
- 讀取時也比較其他分頁寫入的有效快取；損壞儲存資料仍不覆寫、不清空。
- 天氣維持原即時 API、行政區隔離與持久快取；星座維持原即時 API 與快照 fallback。

## 2026-10-25 本次採用資料（臺灣時間）

| 來源 | 有效來源日期／時間 | fetchedAt | 採用依據 |
|---|---|---|---|
| 股票 | 2026-10-22 | 2026-10-25 15:16:58 | 本次 TWSE 真實回應，1,383 筆 |
| 新聞 | 最新文章 2026-10-25 13:16:50 | 2026-10-25 15:17:32 | 本次中央社五類 RSS 完整驗證 |
| 地震 | 最新事件 2026-10-24 09:25:57 | 2026-10-24 15:33:45 | 最新成功 Checkpoint |
| 星座 | 2026-10-25 | 2026-10-25 15:16:59 | 本次十二星座官方當日回應 |

Checkpoint：Run 40100820390，Artifact 12562528436，來源 Commit 36bc081a61c82d80b2a832d4e6dedd2dab234b05。
Artifact digest：`sha256:2c03faabeeffcd6b3c3eb4a91f01a2f569c0867397dceafea15e42303a49dfb4`；到期 2026-10-31 22:04:09（臺灣時間）。

隔離 worktree 沒有可用 CWA 金鑰，本次未讀取其他專案秘密檔案，也未呼叫需授權的 CWA API。因此地震只能宣稱「最新成功 Checkpoint 中的有效資料」，不能宣稱是官方此刻最新事件。
靜態股票目錄保留經審核的 1,368 筆，原匯入時間 2026-10-19 18:56:36，不冒充最新上市名單。

## 證據與驗收

- 原 Git main 的行情日期為 10/19、新聞 10/19、地震事件 10/17、星座 10/20；建立 worktree 時僅還原 Git，自然會帶入這些較舊資料。
- 本機官方較新的資料沒有被建置前還原的舊 Checkpoint 覆蓋。
- Production Chrome 隔離測試：以 TTL 尚有效的舊 Git JSON 預填 localStorage，四來源各只請求一次本機 snapshot，全部升級至新基線。
- 完整測試 950／950 通過，涵蓋四來源防倒退、舊 cache、新 snapshot、新 worktree baseline、失效候選停止，以及離線 ZIP 過期／checksum 錯誤。
- Production Build、公開產物安全檢查通過。無新增套件或付費服務。
- 原始測試、下載與比較證據保留於忽略的 `.cache`，不可提交其中的暫存檔。

本次只修改隔離 worktree；沒有 Commit、Push、部署、雲端設定修改或雲端工作流程執行。

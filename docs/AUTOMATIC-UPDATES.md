# 零付費自動更新準備（Phase 8G-A，未啟用）

2026/10/20 唯讀確認：main 為 6571a1f，Phase 8H-1C 尚未發布。
正式 Pages 仍為先前部署版本；不得以本機開發完成當作已上線。
最新四來源 Checkpoint 的到期時間為 2026/10/27 21:01:18（臺灣）。
以下工作流程修改僅在本機，尚未 Commit、Push、執行或啟用。

## 來源與時間

- 單一 cron `17 * * * *`：每小時 UTC 第 17 分鐘，臺灣亦為每小時第 17 分鐘。
- 只執行 `core --scheduled`：quotes、news、earthquakes、horoscope。
- 新聞與地震距上次嘗試至少 60 分鐘，失敗也計入，避免連續重試。
- 股票臺灣週一至週五 17:00 後每日嘗試一次；星座每日 09:00 後一次。
- 未內建會過期的假日表：平日休市或尚未公布時，驗證官方最後有效交易日，沒有變化就 unchanged，不偽造新日期。同日不再重試每日來源。
- GitHub 排程可能延遲、漏跑；相鄰實際執行少於 60 分鐘時，本輪新聞／地震會 skipped，可能要等下一小時。不是即時 SLA。
- 不請求臺灣銀行，不增加資料來源或更新 API。

## 授權與發布

排程 update job 必須 automation=true、schedule=true、free-usage-confirmed=true，且為 main；任一未設定即不啟動 runner。

| Repository Variable | 用途 | 目前雲端 |
| --- | --- | --- |
| DATA_AUTOMATION_ENABLED | 既有總更新開關 | true |
| DATA_SCHEDULE_ENABLED | 排程授權 | 未設定 |
| DATA_FREE_USAGE_CONFIRMED | 啟用前重新確認免費條款、帳號共用儲存額度與零預算封鎖 | 未設定 |
| DATA_AUTO_PUBLISH_ENABLED | 使用者另行授權長期排程發布 | 未設定 |
| DATA_PUBLISH_ENABLED | 所有資料發布總開關 | false |
| DATA_DEPLOY_TARGET | 僅支援 pages | 未設定 |

自動發布需上述發布開關、Pages 目標、免費確認，以及本輪真的有 validated updated 資料；只有程式碼變化或 force-build 不足以自動發布。
手動更新不受排程開關影響；即使長期自動發布已啟用，手動 Workflow 也必須明確指定 publish_current=true 才能發布。
checkpoint-only 仍須指定已核准的 checkpoint_run，沿用原有精確還原與安全核准。
每次發布前沿用完整測試、建置、公開產物掃描與最小權限。單一來源失敗時保留有效舊值，其他成功來源可以獨立更新；不清除資料。
更新／建置失敗不推進 Checkpoint；部署失敗亦不推進，保留上一輪成功版本，停止並等待人工檢查，不自行部署重試。

## Checkpoint 與儲存防護

- v2 四來源格式、Manifest、SHA-256、來源日期、舊版遷移與秘密資訊掃描均沿用。
- 每輪成功後保存新 dailyinfo-data-state，期限 7 天；candidate 1 天。
- 排程不產生 site-preview；手動預覽及必要 Pages Artifact 僅 1 天。
- 每輪還原最近成功 main 流程且未過期的有效 Checkpoint。沒有有效備份就停止，排程絕不初始化。
- 來源請求前及上傳前，唯讀分頁計算本儲存庫所有 Artifact；未知格式、無法取得用量、超過 10 頁或用量加 24 MiB 預留超過 180 MiB 時拒絕。
- 單份 Checkpoint 未壓縮上限 1 MiB，dist 上限 8 MiB；超限停止，不刪備份、不提高額度。
- 此限制是保守的儲存庫防線，不能代表帳號內其他專案／Packages／過去累積計費用量。必須保持帳號 Actions、Packages 的 US$0／Usage blocked，並在啟用前人工確認共用額度；不能只依本機估算宣稱永久免費保證。
- 目前四份資料合計約 0.56 MiB；加入 status/manifest 保守估算每份 0.6 MiB。每小時 7 天有 168 份 checkpoint，加 24 份 candidate 約 115 MiB（未計壓縮）。Pages Artifact 以實際大小估算，最多 24 份／日；實際佔用依壓縮、更新頻率與其他手動操作變化。到保守上限會停止更新，並非自動清理。

## 網站開啟期間

僅目前掛載頁面且在前景時輪詢：天氣 15 分鐘、AQI 30 分鐘；新聞與地震（包含首頁摘要）每 5 分鐘重讀已發布 JSON。
檢查計時器每分鐘檢查一次，回到前景立即檢查是否到期；每項同時只允許一個自動請求，失敗按原間隔節流。
頁面卸載時清除計時器與監聽；沿用原載入器的錯誤、舊快照防護、選取地區、篩選、收藏、自選及主題。來源與擷取日期原樣顯示，重讀舊 JSON 不代表外部來源更新。
純前端無法跨所有使用者／分頁保證總 API 額度；未加入帳號、付費配額或伺服器。Open-Meteo 免費非商業服務有流量限制，429／連線失敗會正常顯示，不切換付費。

## 下一階段最小安全啟用順序（需另行授權）

1. 先完成 8H-1C 四來源正式發布，確認公開版已移除匯率。
2. 重新確認官方免費條款、帳號共用儲存空間、US$0／Usage blocked 及有效 Checkpoint；無法確認就停止。
3. 經授權只提交／推送本機準備，再用一次不發布的手動 core 驗收所有保護。
4. 另經授權標記免費確認，短期開啟 schedule；先保持所有發布開關關閉，驗收一次真正 schedule，立即關閉 schedule。
5. 另取得長期自動發布授權後，才設定自動發布專用開關、總發布開關、pages 目標及排程。不得更改任何預算、付款方式、Secrets 或 Runner 等級。
6. 停止方式：先關 DATA_SCHEDULE_ENABLED／DATA_AUTO_PUBLISH_ENABLED，再關 DATA_PUBLISH_ENABLED、移除 DATA_DEPLOY_TARGET。既有網站與有效備份保留。

來源條款（2026/10/20 檢查）：
- [GitHub Actions 計費與免費標準 Public Runner、500 MB 共用儲存空間](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Open-Meteo 免費非商業使用條件及限制](https://open-meteo.com/en/terms)
- 其他來源維持 data-sources/ 既有授權、來源標示與免費服務限制，本階段沒有新增供應商。

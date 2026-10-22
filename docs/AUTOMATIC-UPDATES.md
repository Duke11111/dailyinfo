# 零付費自動更新準備（Phase 8G-D1，本機改造，未啟用）

2026/10/22 基線：main 為 ab82abb，正式 Pages 已完成新版 UI 單次部署。核准部署 Run 39721908929 產生的 Checkpoint 到期為 2026/10/29 12:22:14（臺灣）；這是當時驗收結果，下一次雲端操作前須重查。
以下三時段排程與補跑改造僅存在本機，未 Commit、Push、執行或啟用，不代表長期自動更新已開始。

## 來源與時間

- UTC `37 2 * * *` → 臺灣 10:37：新聞、地震、星座。
- UTC `43 12 * * *` → 臺灣 20:43：新聞、地震、週一至週五股票，以及上午未成功的星座。
- UTC `47 14 * * *` → 臺灣 22:47：只補救當日應更新而尚未成功的來源；全部成功則全數 skipped。
- 只執行 `core --scheduled`：quotes、news、earthquakes、horoscope。
- `lastSuccessAt`、`attemptedAt`、來源狀態、臺灣日期與本次 cron 一起判斷。每來源每時段最多嘗試一次，失敗也占用該時段；不在同時段無限重試。四來源最多各三次，股票只有晚上兩次。兩次嘗試至少相隔 60 分鐘；延遲到相鄰時段且冷卻未滿時跳過，不新增排程。
- 新聞／地震：早上成功仍可於晚上檢查；晚上成功後補救時段跳過。沒有新地震可為 `unchanged / ok`，`lastSuccessAt` 推進，但 JSON 的原事件時間與 fetchedAt 不變。
- 股票：早上不執行，正常檢查只安排週一至週五晚上，且必須晚於 17:00；驗證當日資料成功後當日不再重複。官方仍只有前一交易日，標示 `source_delayed`，不推進「當期成功時間」，可於 22:47 再檢查一次。較新且有效的前一交易日資料可改善舊快照，但不冒充今日收盤；日期或擷取時間倒退仍為 `validation_failed` 並保留原檔。
- 未內建會過期的假日表：無法單憑舊交易日區分「休市」或「尚未公布」，摘要如實顯示來源日期及 `source_delayed`，不捏造當日價格、不錯稱 schema 異常。
- 星座：正常時段均在 09:00 之後；上午失敗或來源仍是昨天可於晚上、補救時段重查。昨日內容不覆寫有效快照，不標示今日；真正的日期倒退與資料格式錯誤仍拒絕。當日成功後跳過後續時段。
- `github.event.schedule` 透過 SCHEDULE_CRON 傳入，僅接受上述固定 cron；延遲的早上事件不變成晚間事件，使用實際臺灣日期與時間判斷。跨到次日、但早於該 cron 的當日時段會 skipped，不假裝補做前一天。未知 cron 在來源請求前停止。手動更新仍需人工明確執行，獨立於排程到期判斷。
- 不請求臺灣銀行，不增加資料來源或更新 API。

## 狀態與安全摘要

Checkpoint 仍為 v2、六個檔案，完整驗證 Manifest、SHA-256、來源 Commit、Schema、日期、有效期限後才還原；不自動重新初始化。status.json 仍是 version 1，欄位不變；新驗證器接受既有三種 code，並只對 quotes／horoscope 接受固定 `source_delayed`。既有舊四來源與五來源遷移測試保留；沒有重寫既有 Artifact。新增狀態不保證能被舊版程式接受，回復舊程式需使用該版本原本核准的 Checkpoint，不混用新狀態。

來源摘要逐一列出 updated／unchanged／skipped／failed、固定 code、最近成功檢查、有效來源日期、快照擷取時間、跳過或下次補跑原因與資格時間。下次時間只代表政策資格，不保證 GitHub 準時觸發。日期保留日期；其他時間標為 UTC，可加 8 小時轉臺灣時間。摘要使用白名單及標準日期，不輸出子程序原始 stdout／stderr、Body、URL、Token 或任意錯誤文字。

Workflow 觸發、來源成功與正式 deploy 是不同結果：即使部分來源失敗，其他有效資料可保留並續存 Checkpoint；必須檢查來源表格與分開的 update／deploy／checkpoint 摘要，不能只看綠色 Run。

## 漏觸發、備份到期與低維護

- GitHub 的 schedule 可能延遲甚至漏掉，公開儲存庫 60 天沒有活動可能自動停用排程；無法提供永久無人維護或準點 SLA。[官方說明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- 在 GitHub 個人通知設定中自行訂閱工作流程失敗通知；不用付費監控、外部排程或為保活而自動 Commit。未觸發流程不會有通知；隔離的來源失敗亦可能只產生 warning 而 Run 整體成功，因此每週一次看四來源摘要、各來源最後成功時間與 Checkpoint 到期，並在交件前／預定批改期間做一次檢查。不能只看 Run 顏色或備份建立時間。
- 每個安全完成的流程續存七天 Checkpoint，21 份循環備份約 2.1 MiB（依目前每份約 0.1 MiB 估計，實際以 API 為準）；候選／預覽產物維持一天。Repository 的 180 MiB 上限、24 MiB 預留及每次上傳尺寸檢查不變，仍須帳號共用額度與 US$0 封鎖；不新增付費依賴、儲存或額外監控 Workflow。
- Checkpoint 剩不到 48 小時而近期沒有成功 Run：先保持發布關閉，經授權且費用確認後，最多一次手動 core 更新續存；檢查失敗原因，不反覆重跑。已過期則 fail closed，停止並由使用者核准有效備份的復原方案，不自動初始化或刪除舊備份。
- 若 60 天停用：使用者先檢查費用、開關及有效備份，再依 GitHub 官方流程人工恢復；本階段不啟用。原網站仍顯示最後一次已發布的真實日期與過期警告。
- 降至三時段後，每月約 90 個 Run；每個 Run 最多一次各來源腳本，最壞補救情況每日最多 11 次腳本呼叫（股票 2、其他各 3），不是每支腳本只有一個 HTTP GET。來源內既有必要請求量不變、沒有新增自動重試。Runner 仍使用公開儲存庫免費標準 ubuntu-latest。

## 授權與發布

排程 update job 必須 automation=true、schedule=true、free-usage-confirmed=true，且為 main；任一未設定即不啟動 runner。

| Repository Variable | 用途 | 目前雲端 |
| --- | --- | --- |
| DATA_AUTOMATION_ENABLED | 既有總更新開關 | true |
| DATA_SCHEDULE_ENABLED | 排程授權 | false（本機改造未操作雲端） |
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

1. 保留目前已發布網站與有效 Checkpoint；審閱本次 8G-D1 改造及既有單次發布紀錄，不重新初始化備份。
2. 重新確認官方免費條款、帳號共用儲存空間、US$0／Usage blocked 及有效 Checkpoint；無法確認就停止。
3. 經授權只提交／推送本機準備，再用一次不發布的手動 core 驗收所有保護。
4. 另經授權標記免費確認，短期開啟 schedule；先保持所有發布開關關閉，驗收一次真正 schedule，立即關閉 schedule。
5. 另取得長期自動發布授權後，才設定自動發布專用開關、總發布開關、pages 目標及排程。不得更改任何預算、付款方式、Secrets 或 Runner 等級。
6. 停止方式：先關 DATA_SCHEDULE_ENABLED／DATA_AUTO_PUBLISH_ENABLED，再關 DATA_PUBLISH_ENABLED、移除 DATA_DEPLOY_TARGET。既有網站與有效備份保留。

來源條款（2026/10/20 檢查）：
- [GitHub Actions 計費與免費標準 Public Runner、500 MB 共用儲存空間](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Open-Meteo 免費非商業使用條件及限制](https://open-meteo.com/en/terms)
- 其他來源維持 data-sources/ 既有授權、來源標示與免費服務限制，本階段沒有新增供應商。

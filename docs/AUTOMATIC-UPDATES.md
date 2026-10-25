# 零付費自動更新與發布驗收狀態

2026/10/25 更新：下方「來源與時間」描述基於正式 main `882c87e` 的 hourly 本機候選，尚未 Commit／Push；早期 D4／D5 段落是歷史驗收紀錄，不代表目前雲端開關。此次未查改 Variables、Secrets 或 Billing，未執行任何雲端 Workflow。

2026/10/22 驗收紀錄（依已確認的階段結果，不代表即時雲端查詢）：

- Phase 8G-D2 已 Commit／Push，程式基線為 `d315796e08febc3dd6e61400a302977123f72c17`。
- Phase 8G-D3 手動雲端更新成功：[Run 39727082746](https://github.com/Duke11111/dailyinfo/actions/runs/39727082746)。update／checkpoint 成功，deploy skipped。其資料後續已納入單次核准發布，不能再把「尚未發布」當作目前狀態。
- 當時核准的 Checkpoint Artifact 為 `12403845950`，到期為 **2026/10/29 13:17:14（臺灣時間）**。這是當時的驗收快照，並非永久最新狀態；下次雲端操作必須重查來源 Run、期限、Schema 與 SHA-256。
- 依使用者本次確認，D4 一次性 schedule 未觸發，測試變數已清理，不能視為排程 PASS；D5 自動發布仍未完成雲端驗收。
- 長期排程與自動發布仍未啟用。本次 D5-Prep 僅在隔離 worktree 執行離線測試，不改變任何雲端設定。

## 本次 D5 整合的版本界線

整合 worktree 為 `dailyinfo-d5-integration`、分支 `test/d5-integration`，從 `ee30aed725e29c1ed530585d1fbe19b212338f9a` 建立。原 D5-Prep／Guard 的未提交成果、D4 與正式 main worktree 均保留。本文及程式是本機候選版，本次核准驗收後只建立本機 Commit，沒有推送或啟用雲端。

新增必要的 `DATA_SCHEDULE_MODE`，未設定／未知值均拒絕排程，不能因只開啟總排程開關就意外進入長期模式：

- `d4`：僅晚間 20:43，必須有有效 `DATA_D4_ONCE`；保留指定 Commit、Checkpoint、claim、21:10 最晚啟動及 21:30 截止，無論自動發布開關如何都不部署。
- `continuous`：候選版使用下述單一 hourly cron、四來源 `isDue` 與失敗隔離；刻意不讀取 D4 指定日期及 Checkpoint。過期甚至格式不合法的殘留 `DATA_D4_ONCE` 不會介入，但仍建議清理。
- 手動更新／checkpoint-only 保持獨立，不需要 schedule mode。手動發布仍需要明確 `publish_current` 及既有發布授權，不能繼承自動發布授權。

Workflow gate 與來源啟動前的 Node 驗證皆檢查模式與更新授權；排程 `run_attempt` 必須為 1，不允許以重新執行原 schedule 取代新授權。同一 Workflow 與手動 Pages 共用整段 `dailyinfo-production` 互斥；每來源同一時段不重複、成功後按原規則跳過、失敗只在下一個合格時段補跑。這不是跨所有平台取消／外部操作的 exactly-once 保證：若 Run 在狀態續存前被取消，後續合格排程仍可能再次查詢來源，不能宣稱上一次已成功。

## 來源與時間

本次僅在 `dailyinfo-hourly-schedule`／`fix/hourly-continuous-schedule` 修改與離線測試。雲端三個既有時段及開關均未改動；以下候選須另行授權提交與套用。

- 唯一 UTC cron：`17 0-15 * * *` → 臺灣每日 08:17、09:17，直到 23:17，共 16 個預定事件。選擇第 17 分鐘，避開整點常見尖峰；不新增重疊 Workflow 或外部排程平台。
- GitHub cron 範圍內每個時段的 `event.schedule` 都是同一個字串。真正 due 判斷採執行當下 Asia/Taipei 日期與小時，不以原始名義時段冒充當前資料；延遲到 08:00 前或次日凌晨便安全 skipped。
- 多個延遲事件擠在同一實際臺灣小時，每來源最多嘗試一次；所有失敗也記錄 attemptedAt。跨小時仍保留 45 分鐘冷卻，容許正常相鄰時段些微抖動，不會因不足原本 60 分鐘而頻繁多跳一小時。
- 這提供每小時一次的新機會，不能消除 GitHub 全體排程延遲／漏觸發：若全部事件都延遲 4～5 小時，仍可能延遲，不能保證一小時 SLA。16 是每日預定數，不是人工觸發、跨日延遲事件或外部操作的硬上限。
- 舊 D4 核准／截止驗證保持獨立；新 cron 不含 D4 的 `43 12 * * *`。舊三時段只保留給歷史相容函式／測試，不再被 continuous Workflow admission 接受。
- 只執行 `core --scheduled`：quotes、news、earthquakes、horoscope。
- 新聞／地震：每個合格小時檢查一次；來源內容未變為 `unchanged / ok`，不改事件／文章原日期，不把檢查時間寫成 fetchedAt。只有真正通過驗證的資料內容變動才令 DATA_CHANGED=true；單一來源失敗仍保留其他有效快照。
- 股票：只於實際臺灣週一至週五 17:00 後檢查，預定機會為 17:17～23:17，最多七次。當日有效行情成功後當天跳過；失敗或來源延遲可在下一合格小時補跑，不會同一個小時重試。tradeDate 始終來自官方資料，較舊資料拒絕覆蓋；即使 fetchedAt 較新也不能倒退交易日。
- 未內建會過期的假日表：無法單憑舊交易日區分「休市」或「尚未公布」，摘要如實顯示來源日期及 `source_delayed`，不捏造當日價格、不錯稱 schema 異常。
- 星座：實際臺灣 09:00 後才檢查，正常 09:17 起取得當日十二星座後即跳過當天後續事件；失敗或昨日資料可在後續合格小時補跑，最多十五個機會，無單次 Run 內的自動重試，不接受昨天或未來日期冒充今天。
- `github.event.schedule` 透過 SCHEDULE_CRON 傳入，Workflow 與 Node 雙層只接受上述 hourly continuous cron；未知 cron 在來源請求前停止。手動更新仍獨立於排程到期判斷。天氣仍只由前端 API 取得，不加入 snapshot 工作。
- 不請求臺灣銀行，不增加資料來源或更新 API。

## 狀態與安全摘要

Checkpoint 仍為 v2、六個檔案，Manifest、SHA-256、來源 Commit、Schema、日期與期限驗證不變，不自動重新初始化。status.json 仍為 v1，attemptedSlot 白名單新增固定值 hourly；舊 morning／evening／recovery 及缺少欄位的狀態均可讀取，新策略依 attemptedAt 的實際小時去重。舊版具日期／checksum 防護的 Checkpoint 遷移測試保留。既有 Source Summary 理由與錯誤碼不增加任意伺服器文字。

來源摘要逐一列出 updated／unchanged／skipped／failed、固定 code、最近成功檢查、有效來源日期、快照擷取時間、跳過或下次補跑原因與資格時間。下次時間只代表政策資格，不保證 GitHub 準時觸發。日期保留日期；其他時間標為 UTC，可加 8 小時轉臺灣時間。摘要使用白名單及標準日期，不輸出子程序原始 stdout／stderr、Body、URL、Token 或任意錯誤文字。

Workflow 觸發、來源成功與正式 deploy 是不同結果：即使部分來源失敗，其他有效資料可保留並續存 Checkpoint；必須檢查來源表格與分開的 update／deploy／checkpoint 摘要，不能只看綠色 Run。

## 漏觸發、備份到期與低維護

- GitHub 的 schedule 可能延遲甚至漏掉，公開儲存庫 60 天沒有活動可能自動停用排程；無法提供永久無人維護或準點 SLA。[官方說明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- 在 GitHub 個人通知設定中自行訂閱工作流程失敗通知；不用付費監控、外部排程或為保活而自動 Commit。未觸發流程不會有通知；隔離的來源失敗亦可能只產生 warning 而 Run 整體成功，因此每週一次看四來源摘要、各來源最後成功時間與 Checkpoint 到期，並在交件前／預定批改期間做一次檢查。不能只看 Run 顏色或備份建立時間。
- 每個安全完成的流程續存七天 Checkpoint；每天 16 次約保留 112 份，按目前每份約 0.1 MiB 估計約 11 MiB，加上當日候選及真正發布的 Pages 產物。沒有新資料時仍續存備份以免七天到期，但不 Build／不 Deploy。候選／預覽產物維持一天；排程不產生手動專用 site-preview。180 MiB 上限、24 MiB 預留及上傳前尺寸檢查均不變；真的接近上限就停止，不刪備份或提高額度。仍須保留帳號共享額度與 US$0／Usage blocked 保護。
- Checkpoint 剩不到 48 小時而近期沒有成功 Run：先保持發布關閉，經授權且費用確認後，最多一次手動 core 更新續存；檢查失敗原因，不反覆重跑。已過期則 fail closed，停止並由使用者核准有效備份的復原方案，不自動初始化或刪除舊備份。
- 若 60 天停用：使用者先檢查費用、開關及有效備份，再依 GitHub 官方流程人工恢復；本階段不啟用。原網站仍顯示最後一次已發布的真實日期與過期警告。
- 每 30 天約 480 個預定 Run；來源腳本最壞機會為新聞 16、地震 16、股票 7（平日）、星座 15，成功的每日來源會提前停止後續請求。正常星座只需一次十二星座擷取；每支腳本仍有各自必要 GET 數量（如五類 RSS、兩份 CWA）。Runner 沿用公開儲存庫標準 ubuntu-latest，不改免費或帳務設定。

排程的 releaseDecision 僅以 DATA_CHANGED 決定是否建置：CODE_CHANGED／FORCE_BUILD 不能使無新資料的 schedule 執行 Build 或 Deploy。手動 CI、checkpoint-only、明確 publish_current 授權仍沿用原本政策。所有 Publish Guard、防倒退、共用 production concurrency、最小權限與獨立發布開關保留。

## 授權與發布

排程 update job 必須公開儲存庫、main、automation=true、schedule=true、free-usage-confirmed=true，並明確選擇上述模式；任一必要條件未設定即不執行更新。Node 另以精確字串檢查，避免 GitHub 表達式大小寫寬鬆比較造成來源請求。

| Repository Variable | 用途 | 目前雲端 |
| --- | --- | --- |
| DATA_AUTOMATION_ENABLED | 既有總更新開關 | true |
| DATA_SCHEDULE_ENABLED | 排程授權 | false（已知安全基線；本次未操作雲端） |
| DATA_SCHEDULE_MODE | d4 一次性或 continuous 長期模式，須獨立明確選擇 | 未設定（本機不操作雲端） |
| DATA_FREE_USAGE_CONFIRMED | 啟用前重新確認免費條款、帳號共用儲存額度與零預算封鎖 | 未設定 |
| DATA_AUTO_PUBLISH_ENABLED | 使用者另行授權長期排程發布 | 未設定 |
| DATA_PUBLISH_ENABLED | 所有資料發布總開關 | false |
| DATA_DEPLOY_TARGET | 僅支援 pages | 未設定 |

上表是階段驗收時的已知狀態，不是本機文件讀取時即時查詢的結果。
自動發布必須 continuous 模式、上述更新及發布開關、Pages 目標、免費確認，以及本輪真的有 validated updated 資料；只有程式碼變化或 force-build 不足以自動發布。D4 模式的 decision 與 deploy Job 各自禁止自動發布。
手動更新不受排程開關影響；即使長期自動發布已啟用，手動 Workflow 也必須明確指定 publish_current=true 才能發布。
checkpoint-only 仍須指定已核准的 checkpoint_run，沿用原有精確還原與安全核准。
每次發布前沿用完整測試、建置、公開產物掃描與最小權限。單一來源失敗時保留有效舊值，其他成功來源可以獨立更新；不清除資料。
更新／建置失敗不推進 Checkpoint；部署失敗亦不推進，保留上一輪成功版本，停止並等待人工檢查，不自行部署重試。

## Checkpoint 與儲存防護

- v2 四來源格式、Manifest、SHA-256、來源日期、舊版遷移與秘密資訊掃描均沿用。
- 每輪成功後保存新 dailyinfo-data-state，期限 7 天；candidate 1 天。
- 排程不產生 site-preview；手動預覽及必要 Pages Artifact 僅 1 天。
- 每輪還原最近成功 main 流程且未過期的有效 Checkpoint。沒有有效備份就停止，排程絕不初始化。
- 排程與手動還原均須有合法來源 Commit SHA，並與 Manifest Commit 完全一致；不能因為不是 checkpoint-only 就省略來源 Commit 驗證。
- 來源請求前及上傳前，唯讀分頁計算本儲存庫所有 Artifact；未知格式、無法取得用量、超過 10 頁或用量加 24 MiB 預留超過 180 MiB 時拒絕。
- 單份 Checkpoint 未壓縮上限 1 MiB，dist 上限 8 MiB；超限停止，不刪備份、不提高額度。
- 此限制是保守的儲存庫防線，不能代表帳號內其他專案／Packages／過去累積計費用量。必須保持帳號 Actions、Packages 的 US$0／Usage blocked，並在啟用前人工確認共用額度；不能只依本機估算宣稱永久免費保證。
- 以四份資料合計約 0.56 MiB、每份狀態保守估算 0.6 MiB：每日三輪、七天 21 份 checkpoint，加一天 3 份 candidate 約 14.4 MiB（未計壓縮，不含手動操作及 Pages Artifact）。Pages Artifact 以實際大小估算，計畫排程最多 3 份／日；到保守上限停止更新，不自動清理或提高額度。

## D5 本機模擬與雲端驗收界線

隔離測試使用固定時鐘、合成四來源 Fixture、獨立暫存目錄及禁止網路的 Mock。測試串接實際更新／發布決策與 Workflow job 條件，涵蓋新資料、無變更、延遲股票、部分失敗、獨立授權、Checkpoint 完整性、資料倒退及失敗後禁止推進 Checkpoint。這不等於實際執行 GitHub Runner 或 Pages 部署。

既有還原政策可保護 Repository 中較新的快照不被一般舊 Checkpoint 覆蓋；更新器亦拒絕相對於還原基線的來源日期與 fetchedAt 倒退。D5-Guard 本機版本另外加入 [正式發布基線防護](PUBLISH-GUARD.md)：兩條部署 Workflow 共用整段流程互斥，發布前比對 GitHub 最新成功部署、公開 Manifest 與五份 JSON，驗證 SHA-256、Schema、有效日期與 fetchedAt。任何無法確認的基線或倒退均停止；沒有用舊 JSON 或重新初始化繞過的路徑。

目前仍不能直接啟用自動發布：正式站 Manifest 404 已於本次唯讀確認，核准 Deployment 的 Pages Artifact、Checkpoint 與五份正式 JSON 已逐一驗證。首次基線初始化已實作，僅限額外明確手動核准的 checkpoint-only 發布、固定核准檔／digest、有限期限及完全相同的五份資料；不存在「缺檔就自動信任」的路徑。兩條新版 Workflow 的鎖也不能約束舊版重新執行、外部部署或管理員；存在這些未受控部署途徑時必須停止。精確操作與恢復開關見 PUBLISH-GUARD.md；本次只有唯讀外部證據查核，未啟用雲端發布。

## 網站開啟期間

僅目前掛載頁面且在前景時輪詢：天氣 15 分鐘、AQI 30 分鐘；新聞與地震（包含首頁摘要）每 5 分鐘重讀已發布 JSON。
檢查計時器每分鐘檢查一次，回到前景立即檢查是否到期；每項同時只允許一個自動請求，失敗按原間隔節流。
頁面卸載時清除計時器與監聽；沿用原載入器的錯誤、舊快照防護、選取地區、篩選、收藏、自選及主題。來源與擷取日期原樣顯示，重讀舊 JSON 不代表外部來源更新。
純前端無法跨所有使用者／分頁保證總 API 額度；未加入帳號、付費配額或伺服器。Open-Meteo 免費非商業服務有流量限制，429／連線失敗會正常顯示，不切換付費。

## 下一階段最小安全啟用順序（需另行授權）

1. 保留目前已發布網站與有效 Checkpoint；審閱已提交的 D2、已通過的 D3 與本機 D5-Prep 修正，不重新初始化備份。
2. 重新確認官方免費條款、帳號共用儲存空間、US$0／Usage blocked 及有效 Checkpoint；無法確認就停止。
3. D4 未觸發仍是未驗收，不能把 D3 當成 schedule 證據。若要重做 D4 必須另核准日期、最終新 SHA 與完整基線，模式選 d4，結束後關閉排程並清理臨時變數。
4. 本次只核准本機 Commit，推送仍需另行授權。再依 PUBLISH-GUARD.md 額外核准一次首次 Manifest 接軌：指定 initialize_manifest=true、核准 digest 與固定 checkpoint_run，保持排程關閉；不能暫停 guard 或換資料。接軌後再以新 SHA／有效備份／免費額度及回復依據規劃受控 continuous schedule 驗收；發布須另行明確授權，不能把本機整合或更新授權視為發布授權。僅開啟核准開關，結束後恢復安全狀態，不自行重試。
5. D5 短期驗收不代表長期授權。另取得長期自動發布授權並處理上述正式網站基線風險後，才可規劃長期啟用；不得更改任何預算、付款方式、Secrets 或 Runner 等級。
6. 停止方式：先關 DATA_SCHEDULE_ENABLED／DATA_AUTO_PUBLISH_ENABLED，再關 DATA_PUBLISH_ENABLED、移除 DATA_DEPLOY_TARGET。既有網站與有效備份保留。

來源條款（2026/10/20 檢查）：
- [GitHub Actions 計費與免費標準 Public Runner、500 MB 共用儲存空間](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Open-Meteo 免費非商業使用條件及限制](https://open-meteo.com/en/terms)
- 其他來源維持 data-sources/ 既有授權、來源標示與免費服務限制，本階段沒有新增供應商。

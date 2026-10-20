# DailyInfo 四來源資料更新與發布

只管理 quotes、news、earthquakes、horoscope。all 與 core 都選擇這四個來源；個別來源仍可手動選擇。stocks.json 是獨立靜態目錄，不屬於更新 Checkpoint。天氣與 AQI 保留前端 API／快取。移除前的完整版本保存在本機分支 backup/pre-remove-exchange-20261020，沒有推送或重寫歷史。

## 更新與安全開關

- npm.cmd run update:data 更新四個來源；--sources=core --scheduled 保留各來源 isDue，手動選擇不受到期時間限制。
- 新聞／地震至少間隔 60 分鐘；股票臺灣平日 17:00 後；星座每日 09:00 後。同日每日來源不重複嘗試，含失敗。
- 保留來源獨立錯誤處理、舊檔保護、秘密及格式驗證、鎖、原子寫入。子程序 stdout／stderr 不轉印。
- 本機工作流程保留 workflow_dispatch，單一 schedule 改為每小時第 17 分鐘；尚未推送或啟用。
- 更新須 DATA_AUTOMATION_ENABLED=true 及預設分支。排程另須 main、DATA_SCHEDULE_ENABLED=true、DATA_FREE_USAGE_CONFIRMED=true；未設定／false 跳過整個 job，不取得 runner，手動流程不受排程開關限制。
- 排程只執行 core --scheduled，INITIALIZE_STATE 固定 false。
- Pages 發布須 DATA_PUBLISH_ENABLED=true、DATA_DEPLOY_TARGET=pages。手動另須 publish_current=true；排程另須真的有新資料、DATA_AUTO_PUBLISH_ENABLED=true 及免費確認。關閉發布不阻止有效 checkpoint 保存。
- checkpoint-only 仍須 main 手動、核准最新有效 checkpoint_run、initialize_state=false、publish_current=true 及明確發布開關；不執行來源腳本。
- 更新成功且 deploy 成功或 skipped 才保存 checkpoint；部署失敗不推進狀態。
- 固定 Actions SHA、Node 24、標準 ubuntu-latest、最小權限與 github-pages 分支限制不變。CWA_API_KEY 只透過原 Node 環境使用，不進前端或公開資料。不得變更 US$0 費用保護。

## Checkpoint v2 與舊 v1 遷移

Artifact 用量停止條件、前景刷新、費用估算及尚未啟用的部署順序見 [零付費自動更新準備](AUTOMATIC-UPDATES.md)。

新 Manifest version=2，精確包含四份 JSON 與 status.json 的 SHA-256；加 manifest 共六個檔案。持久 Artifact 保留七天，候選一日。只還原成功同 repository、預設分支的 data-update 流程，拒絕過期或不符核准 Run 的狀態，不自動初始化。

舊五來源 v1 必須有原七個檔案及完全對應的 Manifest keys。先檢查一般檔案、全部 checksum、秘密、commit 來源、所有 Schema 與時間；以 scripts/lib/legacy-checkpoint.mjs 的凍結唯讀驗證檢查退役快照與狀態白名單。任一失敗，在寫入前停止。全部驗證後才排除退役檔案／狀態、還原其餘四份；舊 archive 不修改，下一次 export 產生 v2，不能用新 export 覆寫舊目錄。

唯讀相容層沒有網路、更新、換算或 UI，不打包進瀏覽器；只保留驗證舊檔所需欄位和來源識別。普通還原繼續保留 main 較新有效資料，exact 模式精確還原核准的四份內容，均不跳過 checksum 或 schema。

## 後續另行授權的雲端驗收

保持 schedule 與 publish 關閉，審查提交必要變更並確認有效舊 checkpoint。只執行一次手動 core、initialize_state=false、publish_current=false，核對 v1 完整驗證、v2 保存、四來源個別結果、deploy skipped 及正式站雜湊不變。失敗不改成初始化、不重試。正式發布與持續排程仍需各自授權。

網站重讀只讀已發布快照，不等於外部 API 更新；來源日期與擷取時間照實顯示。排程可能延遲或漏跑，不保證準時。Runner 與 Artifact 用量須依使用者現有費用保護核對，不假設儲存無限。

# D4 一次性自動驗收：本機報告

日期：2026/10/22。本機分支 `test/d4-one-shot-acceptance`，由 main `0471d5a64afaea5af87384c1763b566d36cdef64` 建立；所有變更尚未提交或啟用。

| 項目 | 本機結果 |
| --- | --- |
| 一次性驗收測試 | 46 項通過 |
| 本次邊界修正相關測試 | 3 檔、91／91 通過 |
| 完整 Vitest | 51 檔、722／722 通過 |
| Production Build | 通過，74 modules |
| 公開產物隱私、五份 JSON 與子路徑檢查 | 通過 |
| actionlint v1.7.12 | 通過；未配置 ShellCheck，使用 -shellcheck= |
| Git diff 空白／敏感內容及受保護檔案檢查 | 通過 |
| 真正 GitHub schedule／API 形狀／Summary／Artifact 上傳 | 尚未執行，不能宣稱雲端 PASS |

離線測試涵蓋正確時段、提早／延遲／逾時／隔日、錯誤事件／Commit／分支、缺少免費或更新授權、發布開關誤啟、重跑 attempt、已有 claim／失敗或完成的 Run、漏觸發沒有證據、指定 Checkpoint 不符、來源更新／延遲／合理跳過／失敗、日期與 Checksum 不符、Checkpoint 過期、非預期部署、正式資料變更、逾時回傳及禁止第二個來源啟動。CLI 無效設定以子程序測試確認不洩漏原始錯誤，網路呼叫被禁止。

最終稽核額外覆蓋新執行 Commit 與舊 Checkpoint Commit 分離、取消 Run 的持久拒絕、claim 不可見時的歷史防線、前置 I/O 跨過 21:10、第一個來源的實際啟動時限，以及真實本機子程序的 deadline 終止。未呼叫外部來源。GitHub 無法保證準時排程或所有 Job 在 21:30 精確結束；晚到／漏觸發不會 PASS，Variables 不會被自動修改。

通過的合成樣本為新聞 updated/ok、股票 unchanged/source_delayed、地震 unchanged/ok、星座 skipped/not_due，並完成有效 v2 Checkpoint 與 deploy skipped 的模擬核對。這些僅為固定 Fixture，**不是今晚實際來源更新結果**。失敗樣本均輸出或判定 FAIL；沒有以 Workflow 綠色取代來源驗證。

原 main 與 D5 分支未修改。正式 JSON、股票目錄、行政區、既有 Checkpoint、UI、套件及鎖檔未變。未執行外部資料更新、Commit／Push、Actions、部署或任何 Variables／Secrets／帳務操作。

啟用前仍需另行核准提交／推送與一次性設定，使用新 Commit 完整 SHA、最新核准 Checkpoint 及正式基線，重新人工核對 US$0／Usage blocked 與共享額度。原本必須有人持續監看的 D4 授權不會自動轉移到這套尚未上線的程式。日期到期後停止來源更新，不代表 Variables 已自動清除；漏觸發時是「無執行證據」，不是 PASS。操作細節與限制見 [D4 一次性設計](D4-ONE-SHOT.md)。

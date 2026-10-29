# 本機公開候選版本

> 歷史階段紀錄（Historical）：以下保留當時的測試數、Commit、Run ID、部署與開關狀態，不代表目前 production；2026/10/29 正式狀態以 [README](../README.md) 為準。

目前狀態（Phase 8B）：已於 Phase 8A 公開至 https://github.com/Duke11111/dailyinfo ，main 為全新根提交 `399edd1`。Actions 整體停用、Pages 未部署、資料更新未啟用。以下保留候選版建立時的歷史過程；部署準備見 [PAGES.md](PAGES.md)，本階段變更尚未 Commit／Push。

此版本由完整工作樹匯出，包含 Phase 6D 自動更新架構；沒有複製原始 Git 歷史、環境檔、依賴、快取、使用者資料或舊建置產物。原始開發專案及其歷史保留不變。

本目錄使用全新 Git repository。使用者已從 GitHub Settings → Emails 確認實際 noreply Email，並明確授權以 Duke11111 身分建立乾淨首次本地提交。只在本 repository 設定 `user.name`／`user.email` 與 `user.useConfigOnly=true`，不變更全域 Git 身分，不自行組合或猜測地址。提交身分使用使用者確認的 GitHub noreply，不含原始私人 Email。

`VALIDATION.md` 的舊階段紀錄只作為經隱私清理的開發參考；其中舊 commit 識別碼不代表本候選版本繼承該 Git 歷史。`<project-root>` 是相對工作目錄占位符，不含個人使用者名稱或私人絕對路徑。公開候選驗證結果另列於該文件最前方。

原有來源、授權、真實資料日期與快照皆保留；本次沒有呼叫任何外部資料更新 API。既有測試中的虛構授權字串／拒絕網址案例屬負面測試，不是真實憑證，不應刪除而破壞安全回歸測試。

Secrets 必須留在個人環境檔或未來經授權設定的 GitHub Secrets，不能放進 `VITE_*`、前端、公開 JSON 或 Git。`.gitignore` 已補強常見私鑰／憑證／認證檔名；`.env.example`、正常程式、測試及必要快照保持可追蹤。另有公開目錄秘密檔案攔截，避免誤放檔案後被 Vite 原樣複製。

六個官方 Actions 均固定至實際查證的完整 SHA，見 [ACTIONS_PINS.md](ACTIONS_PINS.md)。原先自動更新與發布開關仍關閉，未設定任何遠端、Secrets 或公開網站。

本機依賴由 `npm.cmd ci --ignore-scripts --no-audit --no-fund` 安裝，不從原始專案複製 `node_modules`。測試與建置不更新外部資料。noreply 身分已由使用者確認，完整測試及建置通過後建立乾淨首次本地 Commit；正式公開前仍需驗收及另外授權推送／部署，並決定平台與權限。目前不是已發布網站。

# GitHub Actions 完整 SHA 查證紀錄

查證日期：2026-10-20。僅對 `github.com/actions/` 官方 repository 執行唯讀 `git ls-remote`，查詢對應主版本標籤及 annotated tag 的 peeled ref；未建立遠端、推送或執行 Actions。以下為查證當時實際回傳的完整 commit SHA，沒有自行推測。

| 官方 Action | 查證標籤 | 固定 Commit |
| --- | --- | --- |
| actions/checkout | v4 | [11d5960a326750d5838078e36cf38b85af677262](https://github.com/actions/checkout/commit/11d5960a326750d5838078e36cf38b85af677262) |
| actions/setup-node | v4 | [49933ea5288caeca8642d1e84afbd3f7d6820020](https://github.com/actions/setup-node/commit/49933ea5288caeca8642d1e84afbd3f7d6820020) |
| actions/upload-artifact | v4 | [ea165f8d65b6e75b540449e92b4886f43607fa02](https://github.com/actions/upload-artifact/commit/ea165f8d65b6e75b540449e92b4886f43607fa02) |
| actions/download-artifact | v4 | [d3f86a106a0bac45b974a628896c90dbdf5c8093](https://github.com/actions/download-artifact/commit/d3f86a106a0bac45b974a628896c90dbdf5c8093) |
| actions/upload-pages-artifact | v3 | [56afc609e74202658d3ffba0e8f6dda462b719fa](https://github.com/actions/upload-pages-artifact/commit/56afc609e74202658d3ffba0e8f6dda462b719fa) |
| actions/deploy-pages | v4 | [d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e](https://github.com/actions/deploy-pages/commit/d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e) |

主版本標籤日後可能移動，候選工作流程仍只執行上述固定版本。升級時應重新查證官方 ref、審閱差異與測試，不以盲目自動升級取代審查。固定 SHA 不代表永遠無漏洞。

最小權限維持：更新 job `contents:read`／`actions:read`；可選 Pages job 才有 `pages:write`／`id-token:write`，checkpoint job 為 `actions:read`。沒有 `contents:write`、PAT 或 git push。CWA key 僅更新與驗證步驟可見，且 Node 子程序只對地震腳本繼承該 key；其他資料來源不繼承。建置與部署步驟不含 CWA key。

Phase 8B（2026-10-20）再次以官方 repository `git ls-remote` 查證 checkout v4、setup-node v4、upload-pages-artifact v3、deploy-pages v4，結果與上表完全相同；獨立 `pages-manual.yml` 重用這四個完整 SHA。build job 僅 contents:read，deploy job 才有 pages:write／id-token:write；兩者都不使用 Secrets，不執行資料更新。

Repository 已公開，Actions 仍整體停用；`DATA_AUTOMATION_ENABLED`／`DATA_PUBLISH_ENABLED` 均未設定。Phase 8B 本機版本移除資料 schedule，Pages 僅手動觸發。尚未 Commit／Push 這些準備、未部署網站；真正啟用前仍需另外授權。

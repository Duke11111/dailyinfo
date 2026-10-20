# 中央通訊社 RSS 新聞來源

2026/10/19 查核：[中央社官方 RSS 與使用規範](https://www.cna.com.tw/about/rss.aspx)。允許個人、非營利組織之非商業用途，引用處需標示「中央通訊社」，不可任意移除 RSS 的發稿訊頭，不可擷取全文；標章需另外授權。中央社保留變更條件及要求停用權利。本專案是非商業期中專案，僅保存 RSS 標題、原有前言、文章網址、發布時間及必要來源／分類／擷取紀錄；沒有擷取全文、使用標章或載入首圖。未聲稱取得商業轉載授權，亦非政府資料開放授權。

| 分類 | 官方列出的 RSS |
| --- | --- |
| 科技 | https://feeds.feedburner.com/rsscna/technology |
| 財經（官方產經證券） | https://feeds.feedburner.com/rsscna/finance |
| 國際 | https://feeds.feedburner.com/rsscna/intworld |
| 生活 | https://feeds.feedburner.com/rsscna/lifehealth |
| 社會 | https://feeds.feedburner.com/rsscna/social |

五類實測皆 HTTP 200、text/xml、RSS 2.0；未回傳 Access-Control-Allow-Origin，採 Node 更新腳本，網站只讀同來源 JSON。每類當次 20 項，合計 100 項，按原文 URL 合併後 95 則，跨分類新聞保留全部分類。快照完成時間 2026-10-19T13:04:33.674Z（臺灣 21:04），最新發布時間 2026-10-19T12:41:01.000Z（臺灣 20:41）。每類擷取時間、項目數與原始 XML 的 SHA-256 記錄於 `public/data/news.json`。不是全部歷史新聞，也不承諾 RSS 更新間隔或即時性；官方未在 RSS 使用頁提供固定數字請求配額。

`npm.cmd run update:news` 對固定五個 HTTPS RSS 各請求一次，不抓取文章頁或圖片；每次 15 秒逾時，拒絕重新導向、非 XML、超大內容、DOCTYPE／ENTITY、無效 RSS 根節點／版本／頻道、重複必要欄位、未知分類、非法日期及不允許的原文連結。以既有 jsdom DOMParser 解析 XML／前言 HTML，不啟用 script 或遠端資源，移除 script／style 等非文字內容，保留前言文字與中央社訊頭，不自行刪節或生成摘要。

只接受 HTTPS `www.cna.com.tw/news/<分類>/<12位數字>.aspx` 原文網址，拒絕帳密、非預期連接埠、查詢參數、片段及其他主機，所有 UI 透過 textContent／DOM 屬性呈現。若官方日後改用其他路徑，更新會明確失敗，需重新查核後調整白名單，不能放寬成任意網址。外連以新分頁開啟並設定 noopener／noreferrer。

所有分類成功且驗證後才原子替換快照。任一分類失敗或空白、既有快照損壞、擷取時間倒退皆不覆寫原檔並回傳非零結束碼；腳本不存取使用者 localStorage。一般 build 不請求 RSS，直接複製快照到 dist；更新正式網站需要重新更新、建置及發布。

網站共用請求、快取 5 分鐘、手動讀取冷卻 10 秒、12 秒逾時，拒絕較舊快照覆蓋目前內容。網頁「重新讀取快照」只讀取已發布檔案；發布時間、RSS 擷取時間與網頁讀取時間分開顯示。快照超過 24 小時顯示可能過期，這是產品提示門檻，不是來源即時性保證。

收藏另存當時的安全 RSS 文字與時間；不因新聞退出近期清單或更新失敗刪除，原文更正／下架需以中央社網站為準。無帳號、金鑰、付費 API、後端或常駐背景監控。未開始地震資訊或其他階段。

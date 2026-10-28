import { isoInstant, nowMs } from '../lib/time.js';
import { loadStockCatalog, searchStocks, STOCK_TYPES } from '../services/stock-catalog.js';
import { loadWatchlists, persistWatchlists, updateWatchlists, emptyWatchlists, sortedStocks, SORTS } from '../services/watchlists.js';
import { formatTime } from '../lib/format.js';
import { quoteStore, quoteSourceDetails, QUOTE_SORTS, sortByQuote, taipeiDate } from '../services/quotes.js';
import { quoteNumber, signedQuote, quoteDirection, openQuoteDetails } from '../components/quote-details.js';
import { explorationEntries, EXPLORATION_MODES } from '../services/stock-exploration.js';

// Dynamic labels, search terms and stored names enter the DOM only as text.
function element(tag, text = '', className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function button(text, action, { disabled = false, label = text, className = 'stock-button' } = {}) {
  const node = element('button', text, className); node.type = 'button'; node.disabled = disabled;
  node.setAttribute('aria-label', label); node.addEventListener('click', action); return node;
}
function select(options, value, label) {
  const node = document.createElement('select'); node.setAttribute('aria-label', label);
  options.forEach(([key, text]) => node.add(new Option(text, key))); node.value = value; return node;
}
function field(label, input) { const node = element('label', label, 'stock-field'); node.append(input); return node; }

export function mountStocks(host, { quotes = quoteStore } = {}) {
  let loaded = loadWatchlists(), data = loaded.data;
  let catalog = loadStockCatalog.peek?.() ?? null, catalogError = '', loading = !catalog, catalogIndex = new Map(catalog?.stocks.map(s => [s.code, s]) ?? []);
  let query = '', type = 'all', page = 0, alive = true, request = 0, controller;
  let snapshot = quotes.peek(), quoteIndex = new Map(snapshot?.quotes.map(q => [q.code, q]) ?? []), quoteLoading = false, quoteError = '', quoteReadAt = null, quoteCached = false, quoteSort = null;
  let quoteRequest = 0;
  let explorationMode = 'volume';
  const PAGE_SIZE = 20;
  host.innerHTML = `<div class="stocks-page"><div class="stock-intro"><span class="badge">AFTER-MARKET WORKSPACE</span><span>盤後收盤行情與自選清單 · 非即時股價</span></div>
    <p id="stocks-notice" class="stock-notice" role="status" aria-live="polite"></p><div id="stock-recovery"></div>
    <section class="card quote-summary" aria-label="盤後行情更新"><div id="quote-status" role="status"></div><button type="button" class="stock-button" id="quote-refresh">重新整理行情</button><p class="stock-help">重新整理會讀取網站最新發布的盤後快照；不會直接向交易所要求即時股價。全市場共用資料，記憶體快取 5 分鐘，手動更新間隔至少 10 秒。</p></section>
    <section class="card stock-search-card" aria-labelledby="stock-search-title"><div class="section-heading"><div><span class="eyebrow">FIND YOUR NEXT WATCH</span><h2 id="stock-search-title">搜尋股票與 ETF</h2></div><span class="badge" id="stock-catalog-count">讀取目錄中</span></div>
    <div class="stock-search-bar"><label class="stock-field">股票代號或公司名稱<input id="stock-search" type="search" maxlength="80" placeholder="輸入代號或名稱，例如 2330、台積電" autocomplete="off"></label><label class="stock-field">商品類型<select id="stock-type"><option value="all">全部商品</option><option value="stock">上市股票</option><option value="etf">上市 ETF</option></select></label><button class="stock-button" id="stock-clear" type="button">清空搜尋</button></div>
    <div id="stock-search-results" aria-live="polite"></div><div id="stock-sources" class="stock-sources"></div></section>
    <section class="card watchlist-card" aria-labelledby="watchlist-title"><div id="watchlist-content"></div></section>
    <dialog class="stock-dialog" id="stock-dialog" aria-labelledby="stock-dialog-title"></dialog></div>`;
  const find = selector => host.querySelector(selector);
  const notice = (text, error = false) => { find('#stocks-notice').textContent = text; find('#stocks-notice').classList.toggle('stock-error', error); };
  const active = () => data.groups.find(g => g.id === data.activeId);
  function commit(action, message) {
    if (loaded.locked) { notice('請先處理儲存問題，原始資料未變更。', true); return false; }
    try {
      const next = persistWatchlists(updateWatchlists(data, action));
      data = next; notice(message); renderWatchlist(); renderSearch(); return true;
    } catch (error) { notice(error.message, true); renderWatchlist(); renderSearch(); return false; }
  }
  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const link = element('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderRecovery() {
    const container = find('#stock-recovery'); container.replaceChildren();
    if (!loaded.locked) return;
    const panel = element('section', '', 'stock-recovery card');
    panel.append(element('p', loaded.problem));
    if (loaded.raw !== null) panel.append(button('下載原始備份', () => download(loaded.raw, 'dailyinfo-watchlists-recovery.json')));
    panel.append(button('重新讀取儲存資料', () => {
      loaded = loadWatchlists(); data = loaded.data; renderRecovery(); renderWatchlist(); renderSearch();
      notice(loaded.locked ? loaded.problem : '已重新讀取自選資料。', loaded.locked);
    }));
    panel.append(button('重設自選資料', () => showDialog('重設自選資料？', form => {
      form.append(element('p', '這會覆寫本瀏覽器原有的自選股資料。建議先下載原始備份。'));
      return () => {
        try { data = persistWatchlists(emptyWatchlists()); loaded = { data, locked: false, raw: null, problem: '' }; renderRecovery(); renderWatchlist(); renderSearch(); notice('自選資料已重設。'); return true; }
        catch (error) { notice(error.message, true); return false; }
      };
    }, '確認重設'), { className: 'stock-button danger' }));
    container.append(panel);
  }
  function showDialog(title, build, submitText = '儲存') {
    const dialog = find('#stock-dialog');
    const previousFocus = document.activeElement;
    dialog.replaceChildren();
    const form = element('form'); const heading = element('h2', title); heading.id = 'stock-dialog-title'; form.append(heading);
    const submitAction = build(form);
    const errorText = element('p', '', 'stock-error'); errorText.setAttribute('role', 'alert'); form.append(errorText);
    const controls = element('div', '', 'stock-dialog-actions');
    controls.append(button('取消', () => dialog.close()));
    const submit = element('button', submitText, 'primary'); submit.type = 'submit'; controls.append(submit); form.append(controls);
    form.addEventListener('submit', event => {
      event.preventDefault();
      try { if (submitAction()) dialog.close(); else errorText.textContent = find('#stocks-notice').textContent; }
      catch (error) { errorText.textContent = error.message; }
    });
    dialog.append(form);
    dialog.onclose = () => { if (previousFocus?.isConnected) previousFocus.focus(); else find('#new-stock-group')?.focus(); };
    dialog.showModal();
  }
  function editGroup(group = null) {
    showDialog(group ? '重新命名群組' : '建立自選群組', form => {
      const input = element('input'); input.type = 'text'; input.required = true; input.maxLength = 80; input.autofocus = true;
      input.value = group?.name ?? ''; input.placeholder = '例如：科技股、ETF、長期投資';
      form.append(field('群組名稱（1–40 字）', input));
      return () => commit({ type: group ? 'rename' : 'create', groupId: group?.id, name: input.value }, group ? '群組名稱已更新。' : '新群組已建立。');
    }, group ? '儲存名稱' : '建立群組');
  }
  function transfer(stock, group) {
    showDialog(`移轉 ${stock.code} ${stock.name}`, form => {
      const target = select(data.groups.filter(g => g.id !== group.id).map(g => [g.id, g.name]), '', '目標群組');
      if (target.options.length) target.selectedIndex = 0;
      const method = select([['copy', '複製：保留來源群組'], ['move', '移動：從來源群組移除']], 'copy', '移轉方式');
      form.append(field('目標群組', target), field('移轉方式', method));
      return () => commit({ type: method.value, groupId: group.id, targetId: target.value, code: stock.code }, '股票已移轉至指定群組。');
    }, '確認移轉');
  }
  function renderWatchlist() {
    const container = find('#watchlist-content'); container.replaceChildren(); const group = active();
    const heading = element('div', '', 'stock-watch-heading');
    const title = element('h2', group ? group.name : '自選股群組'); title.id = 'watchlist-title';
    const newGroup = button('＋ 新增群組', () => editGroup(), { disabled: loaded.locked, className: 'primary' }); newGroup.id = 'new-stock-group';
    heading.append(title, newGroup); container.append(heading);
    const chips = element('div', '', 'stock-group-tabs'); chips.setAttribute('aria-label', '自選股群組');
    data.groups.forEach(g => {
      const tab = button(`${g.name} · ${g.stocks.length}`, () => commit({ type: 'select', groupId: g.id }, `已切換至「${g.name}」。`), { disabled: loaded.locked });
      tab.setAttribute('aria-pressed', String(g.id === data.activeId)); tab.dataset.groupId = g.id; chips.append(tab);
    }); container.append(chips);
    const tools = element('div', '', 'stock-tools');
    const sorting = select([...Object.entries(SORTS), ...Object.entries(QUOTE_SORTS)], quoteSort ?? data.sort, '股票排序'); sorting.disabled = loaded.locked;
    sorting.addEventListener('change', () => {
      if (Object.hasOwn(QUOTE_SORTS, sorting.value)) { quoteSort = sorting.value; renderWatchlist(); }
      else { quoteSort = null; commit({ type: 'sort', sort: sorting.value }, '排序方式已更新。'); }
    });
    tools.append(field('股票排序', sorting));
    if (group) {
      tools.append(button('重新命名', () => editGroup(group), { disabled: loaded.locked }));
      tools.append(button('刪除群組', () => showDialog('刪除自選群組？', form => {
        form.append(element('p', `確定刪除「${group.name}」及其中 ${group.stocks.length} 檔股票？其他群組會保留。`));
        return () => commit({ type: 'delete', groupId: group.id }, '群組已刪除，其他群組未變更。');
      }, '確認刪除'), { disabled: loaded.locked, className: 'stock-button danger' }));
    }
    tools.append(button('下載自選備份', () => download(JSON.stringify(data, null, 2), 'dailyinfo-watchlists.json'), { disabled: loaded.locked }));
    container.append(tools);
    if (data.groups.length > 1) {
      const details = element('details', '', 'stock-group-manager'); details.append(element('summary', '調整群組順序'));
      data.groups.forEach((g, i) => {
        const row = element('div', '', 'stock-group-order'); row.append(element('span', g.name));
        row.append(button('↑', () => { if (commit({ type: 'reorderGroup', groupId: g.id, direction: -1 }, '群組順序已更新。')) find('details').open = true; }, { label: `上移群組 ${g.name}`, disabled: loaded.locked || i === 0 }));
        row.append(button('↓', () => { if (commit({ type: 'reorderGroup', groupId: g.id, direction: 1 }, '群組順序已更新。')) find('details').open = true; }, { label: `下移群組 ${g.name}`, disabled: loaded.locked || i === data.groups.length - 1 }));
        details.append(row);
      }); container.append(details);
    }
    if (!group || group.stocks.length === 0) {
      const empty = element('div', '', 'stock-empty');
      empty.append(element('h3', group ? '這個群組還沒有股票' : '建立你的第一個自選群組'), element('p', '使用上方搜尋列找到上市股票或 ETF，再加入目前的群組。'));
      empty.append(button(group ? '搜尋並加入股票' : '新增群組', () => group ? find('#stock-search').focus() : editGroup(), { disabled: loaded.locked })); container.append(empty);
    } else {
      const scroller = element('div', '', 'stock-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('aria-label', '自選股表格，可水平捲動');
      const table = element('table', '', 'stock-table'); const caption = element('caption', `${group.name} · ${group.stocks.length} 檔關注商品 · ${snapshot ? snapshot.tradeDate + ' 盤後快照' : '暫無行情'}；成交量單位：股，非張。`); table.append(caption);
      const thead = element('thead'), tr = element('tr');
      ['股票代號', '股票名稱', '商品類型', '收盤價', '漲跌額', '漲跌幅', '成交量（股）', '交易日期', '管理'].forEach(title => { const th = element('th', title); th.scope = 'col'; tr.append(th); }); thead.append(tr); table.append(thead);
      const tbody = element('tbody');
      const displayedStocks = sortedStocks(group, data.sort, catalogIndex);
      (quoteSort ? sortByQuote(displayedStocks, quoteSort, quoteIndex) : displayedStocks).forEach((stock, i) => {
        const row = element('tr'); row.dataset.code = stock.code;
        const name = element('td', '', 'stock-name');
        const quote = quoteIndex.get(stock.code);
        name.append(button(stock.name, () => openQuoteDetails(host, stock, quote, snapshot), { label: `查看 ${stock.code} ${stock.name} 詳細資訊`, className: 'stock-detail-link' }));
        if (catalog && !catalogIndex.has(stock.code)) name.append(element('small', '快照未收錄，保留原自選資料'));
        row.append(element('td', stock.code, 'stock-code'), name, element('td', STOCK_TYPES[stock.type]));
        row.append(element('td', quoteNumber(quote?.close), quote?.close == null ? 'stock-unavailable' : 'quote-value'),
          element('td', signedQuote(quote?.change), quoteDirection(quote?.change)),
          element('td', signedQuote(quote?.percent, '%'), quoteDirection(quote?.percent)),
          element('td', quoteNumber(quote?.volume, true), 'quote-value'), element('td', quote?.date ?? '暫無行情', 'quote-date'));
        const actions = element('td', '', 'stock-row-actions');
        actions.append(button('↑', () => commit({ type: 'reorderStock', code: stock.code, direction: -1 }, '股票順序已更新。'), { disabled: loaded.locked || quoteSort !== null || data.sort !== 'custom' || i === 0, label: `上移股票 ${stock.code}` }));
        actions.append(button('↓', () => commit({ type: 'reorderStock', code: stock.code, direction: 1 }, '股票順序已更新。'), { disabled: loaded.locked || quoteSort !== null || data.sort !== 'custom' || i === group.stocks.length - 1, label: `下移股票 ${stock.code}` }));
        actions.append(button('移轉', () => transfer(stock, group), { disabled: loaded.locked || data.groups.length < 2, label: `複製或移動 ${stock.code}` }));
        actions.append(button('移除', () => commit({ type: 'remove', code: stock.code }, `已從目前群組移除 ${stock.code}。`), { disabled: loaded.locked, label: `移除股票 ${stock.code}`, className: 'stock-button danger' }));
        row.append(actions); tbody.append(row);
      }); table.append(tbody); scroller.append(table); container.append(scroller);
    }
    container.append(element('p', '點選股票名稱查看詳細資訊。價格、漲跌幅、成交量排序僅套用本次頁面，不改寫已保存的自訂順序；缺值排在最後。', 'stock-help'));
  }
  function renderSearch() {
    const container = find('#stock-search-results'); container.replaceChildren();
    if (loading) { container.append(element('p', '正在讀取正式股票目錄…', 'stock-help')); return; }
    if (catalogError) {
      const error = element('div', '', 'stock-search-error'); error.setAttribute('role', 'alert');
      error.append(element('p', catalogError), button('重新載入目錄', retrieveCatalog)); container.append(error); return;
    }
    if (!query.trim()) { renderExploration(container); return; }
    let matches;
    try { matches = searchStocks(catalog.stocks, query, type); }
    catch (error) { const p = element('p', error.message, 'stock-error'); p.setAttribute('role', 'alert'); container.append(p); return; }
    if (!matches.length) { container.append(element('p', '查無符合的股票。僅支援此快照收錄的上市股票與上市 ETF，不含上櫃、興櫃或海外股票。', 'stock-help')); return; }
    page = Math.max(0, Math.min(page, Math.ceil(matches.length / PAGE_SIZE) - 1));
    container.append(element('p', `找到 ${matches.length} 筆 · 第 ${page + 1} / ${Math.ceil(matches.length / PAGE_SIZE)} 頁 · 加入目前群組：${active()?.name ?? '請先建立群組'}`, 'stock-help'));
    const results = element('ul', '', 'stock-results');
    matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).forEach(stock => {
      const row = element('li');
      const details = button('', () => openQuoteDetails(host, stock, quoteIndex.get(stock.code), snapshot), { label: `查看 ${stock.code} ${stock.name} 詳細資訊`, className: 'stock-detail-link stock-result-link' });
      details.append(element('strong', stock.code, 'stock-code'), element('span', stock.name, 'stock-result-name'));
      row.append(details, element('span', STOCK_TYPES[stock.type], 'badge'));
      const exists = active()?.stocks.some(s => s.code === stock.code);
      row.append(button(exists ? '已加入' : '＋ 加入', () => commit({ type: 'add', stock }, `${stock.code} 已加入「${active().name}」。`), { disabled: loaded.locked || !active() || exists, label: `${exists ? '已加入' : '加入'} ${stock.name}（${stock.code}）` })); results.append(row);
    }); container.append(results);
    if (matches.length > PAGE_SIZE) {
      const pagination = element('div', '', 'stock-pagination');
      pagination.append(button('上一頁', () => { page--; renderSearch(); }, { disabled: page === 0 }), button('下一頁', () => { page++; renderSearch(); }, { disabled: (page + 1) * PAGE_SIZE >= matches.length })); container.append(pagination);
    }
  }
  function renderExploration(container) {
    const section = element('section', '', 'stock-exploration'); section.setAttribute('aria-labelledby', 'stock-exploration-title');
    const heading = element('h3', '市場熱門與股票探索'); heading.id = 'stock-exploration-title'; section.append(heading);
    const tabs = element('div', '', 'stock-exploration-tabs'); tabs.setAttribute('aria-label', '股票探索分類');
    Object.entries(EXPLORATION_MODES).forEach(([key, label]) => {
      const tab = button(label, () => { explorationMode = key; renderSearch(); find(`[data-exploration-mode="${key}"]`).focus(); });
      tab.dataset.explorationMode = key; tab.setAttribute('aria-pressed', String(explorationMode === key)); tabs.append(tab);
    }); section.append(tabs);
    section.append(element('p', snapshot ? `交易日：${snapshot.tradeDate} · TWSE 官方盤後快照 · 擷取：${formatTime(snapshot.fetchedAt)}（臺灣時間）` : '尚無有效行情快照。', 'stock-help'));
    section.append(element('p', '排行僅限目前目錄與行情快照共同收錄、符合商品類型的有效商品，非全臺股完整排行、非即時人氣。成交量單位：股，非張、非成交金額。常見關注為固定快速瀏覽清單，並非搜尋人氣排行。', 'stock-help'));
    if (quoteLoading) section.append(element('p', '正在讀取盤後行情…', 'stock-help'));
    if (quoteError) { const error = element('p', quoteError, 'stock-error'); error.setAttribute('role', 'alert'); section.append(error); }
    const entries = explorationEntries(catalog, snapshot, { mode: explorationMode, type });
    if (!entries.length) section.append(element('p', explorationMode === 'common' ? '目前目錄沒有符合商品類型的常見關注商品。' : '目前沒有符合條件的可信排行資料；需要有效收盤價及正成交量，漲幅另需可可靠計算的漲跌幅。', 'stock-help'));
    else {
      const scroller = element('div', '', 'stock-table-scroll'); scroller.tabIndex = 0; scroller.setAttribute('aria-label', '股票探索表格，可水平捲動');
      const table = element('table', '', 'stock-table stock-exploration-table'); table.append(element('caption', `${EXPLORATION_MODES[explorationMode]} · ${entries.length} 筆${explorationMode === 'gain' ? ' · 依漲跌幅由高到低，可能包含零或負值' : ''}`));
      const head = element('thead'), row = element('tr');
      ['順序', '股票代號／名稱', '商品類型', '收盤價', '漲跌額', '漲跌幅', '成交量（股）', '自選群組'].forEach(text => { const th = element('th', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
      const body = element('tbody'); entries.forEach(({ stock, quote }, index) => {
        const tr = element('tr'); tr.dataset.code = stock.code; const name = element('td');
        name.append(button(`${stock.code} ${stock.name}`, () => openQuoteDetails(host, stock, quote, snapshot), { label: `查看 ${stock.code} ${stock.name} 詳細資訊`, className: 'stock-detail-link' }));
        const exists = active()?.stocks.some(item => item.code === stock.code), add = element('td');
        add.append(button(exists ? '已加入' : '＋ 加入', () => commit({ type: 'add', stock }, `${stock.code} 已加入「${active().name}」。`), { disabled: loaded.locked || !active() || exists, label: `${exists ? '已加入' : '加入'} ${stock.name}（${stock.code}）` }));
        tr.append(element('td', String(index + 1)), name, element('td', STOCK_TYPES[stock.type]), element('td', quoteNumber(quote?.close), 'quote-value'), element('td', signedQuote(quote?.change), quoteDirection(quote?.change)), element('td', signedQuote(quote?.percent, '%'), quoteDirection(quote?.percent)), element('td', quoteNumber(quote?.volume, true), 'quote-value'), add); body.append(tr);
      }); table.append(body); scroller.append(table); section.append(scroller);
    }
    container.append(section);
  }
  function renderSources() {
    const container = find('#stock-sources'); container.replaceChildren();
    find('#stock-catalog-count').textContent = catalog ? `${catalog.stocks.length.toLocaleString('zh-TW')} 筆正式基本資料` : loading ? '讀取目錄中' : '目錄未載入';
    if (!catalog) return;
    container.append(element('p', `靜態資料快照 · 匯入時間：${formatTime(catalog.fetchedAt)}（臺灣時間）。非即時行情；不會自動同步最新上市／下市名單。`));
    catalog.sources.forEach(source => {
      const p = element('p'), link = element('a', `TWSE ${source.label}`); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      p.append(link, document.createTextNode(` · ${source.count} 筆 · 出表日期：${source.issuedDates.join('、')}`)); container.append(p);
    });
    const p = element('p', '政府資料開放授權條款第 1 版；僅取代號、名稱與商品分類，不提供即時或歷史價格。'); container.append(p);
  }
  async function retrieveCatalog() {
    controller?.abort(); controller = new AbortController(); const id = ++request; loading = true; catalogError = ''; renderSearch();
    try {
      const result = await loadStockCatalog({ signal: controller.signal });
      if (!alive || id !== request) return;
      catalog = result; catalogIndex = new Map(result.stocks.map(s => [s.code, s]));
    } catch (error) { if (!alive || id !== request) return; catalogError = error.message; }
    finally { if (alive && id === request) { loading = false; renderSearch(); renderSources(); renderWatchlist(); } }
  }
  function renderQuoteStatus() {
    const status = find('#quote-status'); status.replaceChildren();
    status.append(element('strong', snapshot ? `交易日期 ${snapshot.tradeDate} · 盤後快照` : '盤後行情尚未載入'));
    if (snapshot) {
      status.append(element('p', `來源：${quoteSourceDetails(snapshot).label} · 來源擷取時間：${formatTime(snapshot.fetchedAt)}（臺灣時間）`, 'stock-help'));
      if (snapshot.tradeDate < taipeiDate(isoInstant())) status.append(element('p', '非當日行情：可能為休市、來源尚未發布或網站尚未更新；以標示交易日為準。', 'stock-help'));
    }
    if (quoteReadAt) status.append(element('p', `網頁讀取時間：${formatTime(quoteReadAt)}${quoteCached ? ' · 使用共用快取' : ''}`, 'stock-help'));
    if (quoteLoading) status.append(element('p', '正在讀取行情…'));
    if (quoteError) { const error = element('p', `${quoteError}${snapshot ? ' 目前保留上次有效行情。' : ''}`, 'stock-error'); error.setAttribute('role', 'alert'); status.append(error); }
    find('#quote-refresh').disabled = quoteLoading;
  }
  async function retrieveQuotes(force = false) {
    const id = ++quoteRequest; quoteLoading = true; quoteError = ''; renderQuoteStatus();
    try {
      const result = await quotes.load({ force });
      if (!alive || id !== quoteRequest) return;
      snapshot = result.data; quoteReadAt = result.pageReadAt ?? nowMs(); quoteCached = result.cached;
      quoteIndex = new Map(snapshot.quotes.map(q => [q.code, q]));
    } catch (error) { if (alive && id === quoteRequest) quoteError = error.message; }
    finally { if (alive && id === quoteRequest) { quoteLoading = false; renderQuoteStatus(); renderWatchlist(); renderSearch(); } }
  }
  find('#quote-refresh').addEventListener('click', () => retrieveQuotes(true));
  find('#stock-search').addEventListener('input', event => { query = event.target.value; page = 0; renderSearch(); });
  find('#stock-type').addEventListener('change', event => { type = event.target.value; page = 0; renderSearch(); });
  find('#stock-clear').addEventListener('click', () => { query = ''; page = 0; find('#stock-search').value = ''; renderSearch(); find('#stock-search').focus(); });
  renderRecovery(); renderWatchlist(); retrieveCatalog(); retrieveQuotes();
  return () => { alive = false; request++; quoteRequest++; controller?.abort(); host.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); };
}

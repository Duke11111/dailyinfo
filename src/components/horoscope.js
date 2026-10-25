import { nowMs } from '../lib/time.js';
import { formatTaipei } from '../lib/time.js';
import { SIGNS, HOROSCOPE_SOURCE, loadDefaultSign, saveDefaultSign, taipeiDate, readingUrl, validSign } from '../services/horoscope.js';
import { liveHoroscopeStore } from '../services/horoscope-live.js';
const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
export function mountHoroscope(host, { store = liveHoroscopeStore, storage, now = nowMs } = {}) {
  let alive = true, generation = 0, snapshot, readAt, loading = false, error = '', problem = '', mode = 'snapshot';
  let controller, requestSign, requestDay, pending, midnightTimer;
  const saved = loadDefaultSign(storage);
  let defaultSign = saved.defaultSign, viewSign = defaultSign ?? 'aries', skipped = false, expanded = false;
  const card = el('section', '', 'card horoscope-card'); card.setAttribute('aria-label', '每日星座運勢'); host.replaceChildren(card);
  function action(text, handler) { const button = el('button', text, 'overview-refresh'); button.type = 'button'; button.addEventListener('click', handler); return button; }
  function persist() {
    try { saveDefaultSign(viewSign, storage); defaultSign = viewSign; saved.problem = ''; error = ''; }
    catch (failure) { error = failure.message; }
    render();
  }
  function render() {
    if (!alive) return;
    const keepSelectFocus = card.contains(document.activeElement) && document.activeElement.matches('select');
    const sign = SIGNS.find(item => item.code === viewSign), today = taipeiDate(now());
    card.replaceChildren(); card.setAttribute('aria-busy', String(loading));
    const controls = el('div', '', 'horoscope-controls'), heading = el('div');
    heading.append(el('span', 'DAILY HOROSCOPE / 娛樂參考', 'eyebrow'), el('h2', `${sign.symbol} ${sign.name} · 每日運勢`));
    controls.append(heading);
    const label = el('label', '查看星座'), select = el('select'); select.setAttribute('aria-label', '查看星座');
    SIGNS.forEach(item => select.add(new Option(`${item.symbol} ${item.name}`, item.code))); select.value = viewSign;
    select.addEventListener('change', () => { if (validSign(select.value)) { viewSign = select.value; expanded = false; load(); } }); label.append(select); controls.append(label);
    const actions = el('div', '', 'horoscope-actions');
    if (!defaultSign) {
      actions.append(action('儲存我的星座', persist));
      if (!skipped) actions.append(action('略過設定', () => { skipped = true; render(); }));
    } else {
      const back = action('回到我的星座', () => { viewSign = defaultSign; expanded = false; load(); }); back.disabled = viewSign === defaultSign;
      const save = action('設為預設星座', persist); save.disabled = viewSign === defaultSign; actions.append(back, save);
    }
    controls.append(actions); card.append(controls);
    card.append(el('p', defaultSign ? `我的預設：${SIGNS.find(item => item.code === defaultSign).name} · 目前查看：${sign.name}（暫時切換不會更改預設）` : skipped ? '已略過設定，可自由瀏覽；不會儲存暫時查看的星座。' : '第一次使用：選擇星座後按「儲存我的星座」，或略過設定。', 'horoscope-meta'));
    if (saved.problem || error || problem) { const alert = el('p', error || saved.problem || problem, 'overview-error'); alert.setAttribute('role', 'alert'); card.append(alert); }
    const body = el('div'); body.setAttribute('role', 'status');
    const reading = snapshot?.readings.find(item => item.sign === viewSign);
    if (loading) body.append(el('p', '正在檢查所選星座的當日運勢…'));
    if (reading) {
      const current = reading.date === today;
      body.append(el('strong', `${current ? '今日運勢' : '非今日資料，請勿視為今日運勢'} · 來源日期 ${reading.date} · 臺灣今天 ${today}`));
      const text = el('p', reading.text, 'horoscope-reading'); text.lang = 'en'; text.id = `horoscope-reading-${viewSign}`;
      const toggle = action('', () => { expanded = !expanded; updatePreview(); });
      toggle.setAttribute('aria-controls', text.id);
      function updatePreview() {
        text.classList.toggle('is-collapsed', !expanded);
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? '收合運勢' : '展開完整運勢';
      }
      updatePreview(); body.append(text, toggle);
      body.append(el('p', `${mode === 'live' ? '即時 API 取得' : '快照擷取'}：${formatTaipei(snapshot.fetchedAt, { seconds: true })} · 網頁讀取：${formatTaipei(readAt, { seconds: true })}（臺灣時間）`, 'horoscope-meta'));
    } else if (!loading) body.append(el('p', '目前沒有可用的運勢資料；其他每日資訊仍可正常使用。'));
    card.append(body);
    const footer = el('div', '', 'horoscope-meta'), source = el('a', 'Powered by FreeHoroscopeAPI'); source.href = HOROSCOPE_SOURCE; source.target = '_blank'; source.rel = 'noopener noreferrer';
    const original = el('a', '原始 API 內容'); original.href = readingUrl(viewSign); original.target = '_blank'; original.rel = 'noopener noreferrer';
    footer.append(source, ' · ', original, el('p', '星座運勢僅供娛樂參考。英文原文；來源未提供時區、分數或分類。僅比對來源日期與臺灣日期，非臺灣時區專屬內容。優先查詢所選星座，使用五分鐘記憶體快取及失敗冷卻；失敗時保留已發布快照的實際日期。'));
    const refresh = action('重新取得運勢', () => load()); refresh.disabled = loading; card.append(footer, refresh);
    if (keepSelectFocus) select.focus({ preventScroll: true });
  }
  const messages = {
    cors_or_network_error: '即時運勢連線或 CORS 失敗，改用已發布快照。', live_http_error: '即時運勢服務暫時失敗，改用已發布快照。',
    live_rate_limited: '即時運勢請求受限（429），冷卻期間改用已發布快照。', live_timeout: '即時運勢連線逾時，改用已發布快照。',
    live_data_invalid: '即時運勢格式異常，改用已發布快照。', live_date_mismatch: '即時運勢日期不符臺灣今天，改用已發布快照。',
  };
  function load() {
    if (!alive || document.visibilityState === 'hidden') { render(); return Promise.resolve(); }
    if (loading && requestSign === viewSign && requestDay === taipeiDate(now())) return pending;
    const token = ++generation; controller?.abort(); controller = new AbortController();
    requestSign = viewSign; requestDay = taipeiDate(now()); loading = true; error = ''; problem = ''; render();
    pending = (async () => {
      try {
        const result = await store.load(requestSign, { signal: controller.signal });
        if (alive && token === generation) {
          snapshot = result.reading ? { fetchedAt: result.fetchedAt, readings: [result.reading] } : result.data;
          readAt = result.readAt; mode = result.mode ?? 'snapshot'; problem = result.problem ? messages[result.problem] || '即時運勢不可用，改用已發布快照。' : '';
        }
      } catch (failure) { if (alive && token === generation && failure.name !== 'AbortError') error = `${messages[failure.message] || failure.message || '運勢讀取失敗'}；預設星座保留。`; }
      finally { if (alive && token === generation) { loading = false; render(); } }
    })();
    return pending;
  }
  function planMidnight() {
    clearTimeout(midnightTimer);
    const next = Date.parse(`${taipeiDate(now())}T00:00:00+08:00`) + 86400000;
    midnightTimer = setTimeout(() => { if (alive) { load(); planMidnight(); } }, Math.max(1, next - now() + 1));
  }
  const foreground = () => { if (document.visibilityState !== 'hidden') { load(); planMidnight(); } };
  document.addEventListener('visibilitychange', foreground); planMidnight();
  load();
  return () => { alive = false; generation++; controller?.abort(); clearTimeout(midnightTimer); document.removeEventListener('visibilitychange', foreground); };
}

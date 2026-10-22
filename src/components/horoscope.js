import { SIGNS, HOROSCOPE_SOURCE, loadDefaultSign, saveDefaultSign, horoscopeStore, taipeiDate, readingUrl, validSign } from '../services/horoscope.js';
const el = (tag, text = '', cls = '') => { const node = document.createElement(tag); node.textContent = text; node.className = cls; return node; };
export function mountHoroscope(host, { store = horoscopeStore, storage, now = Date.now } = {}) {
  let alive = true, generation = 0, snapshot, readAt, loading = false, error = '';
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
    const sign = SIGNS.find(item => item.code === viewSign), today = taipeiDate(now());
    card.replaceChildren(); card.setAttribute('aria-busy', String(loading));
    const controls = el('div', '', 'horoscope-controls'), heading = el('div');
    heading.append(el('span', 'DAILY HOROSCOPE / 娛樂參考', 'eyebrow'), el('h2', `${sign.symbol} ${sign.name} · 每日運勢`));
    controls.append(heading);
    const label = el('label', '查看星座'), select = el('select'); select.setAttribute('aria-label', '查看星座');
    SIGNS.forEach(item => select.add(new Option(`${item.symbol} ${item.name}`, item.code))); select.value = viewSign;
    select.addEventListener('change', () => { if (validSign(select.value)) { viewSign = select.value; expanded = false; } render(); }); label.append(select); controls.append(label);
    const actions = el('div', '', 'horoscope-actions');
    if (!defaultSign) {
      actions.append(action('儲存我的星座', persist));
      if (!skipped) actions.append(action('略過設定', () => { skipped = true; render(); }));
    } else {
      const back = action('回到我的星座', () => { viewSign = defaultSign; expanded = false; render(); }); back.disabled = viewSign === defaultSign;
      const save = action('設為預設星座', persist); save.disabled = viewSign === defaultSign; actions.append(back, save);
    }
    controls.append(actions); card.append(controls);
    card.append(el('p', defaultSign ? `我的預設：${SIGNS.find(item => item.code === defaultSign).name} · 目前查看：${sign.name}（暫時切換不會更改預設）` : skipped ? '已略過設定，可自由瀏覽；不會儲存暫時查看的星座。' : '第一次使用：選擇星座後按「儲存我的星座」，或略過設定。', 'horoscope-meta'));
    if (saved.problem || error) { const alert = el('p', error || saved.problem, 'overview-error'); alert.setAttribute('role', 'alert'); card.append(alert); }
    const body = el('div'); body.setAttribute('role', 'status');
    const reading = snapshot?.readings.find(item => item.sign === viewSign);
    if (loading) body.append(el('p', '正在讀取已發布的運勢快照…'));
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
      body.append(el('p', `快照擷取：${new Date(snapshot.fetchedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })} · 網頁讀取：${new Date(readAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}（臺灣時間）`, 'horoscope-meta'));
    } else if (!loading) body.append(el('p', '目前沒有可用的運勢資料；其他每日資訊仍可正常使用。'));
    card.append(body);
    const footer = el('div', '', 'horoscope-meta'), source = el('a', 'Powered by FreeHoroscopeAPI'); source.href = HOROSCOPE_SOURCE; source.target = '_blank'; source.rel = 'noopener noreferrer';
    const original = el('a', '原始 API 內容'); original.href = readingUrl(viewSign); original.target = '_blank'; original.rel = 'noopener noreferrer';
    footer.append(source, ' · ', original, el('p', '星座運勢僅供娛樂參考。英文原文；來源未提供時區、分數或分類。僅比對來源日期與臺灣日期，非臺灣時區專屬內容。網頁重新讀取不會更新外部 API。'));
    card.append(footer, action('重新讀取運勢快照', () => load()));
  }
  async function load() {
    const token = ++generation; loading = true; error = ''; render();
    try { const result = await store.load(); if (alive && token === generation) { snapshot = result.data; readAt = result.readAt; } }
    catch (failure) { if (alive && token === generation) error = `${failure.message || '運勢讀取失敗'}；預設星座保留。`; }
    finally { if (alive && token === generation) { loading = false; render(); } }
  }
  load();
  return () => { alive = false; generation++; };
}

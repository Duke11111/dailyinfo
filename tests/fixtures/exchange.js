// Synthetic bank-rate fixtures for tests only; production uses the official download.
import { EXCHANGE_SOURCE, EXCHANGE_CSV, EXCHANGE_LICENSE, CURRENCY_NAMES } from '../../src/services/exchange.js';
export const exchangeCaptured = '2026-10-19T17:00:00.000Z';
export const exchangeFixture = () => ({ version: 1, source: '臺灣銀行', sourceUrl: EXCHANGE_SOURCE, downloadUrl: EXCHANGE_CSV, licenseUrl: EXCHANGE_LICENSE, base: 'TWD', unit: 1, quotedAt: '2026-10-20T00:42:00+08:00', fetchedAt: exchangeCaptured, rates: [
  { code: 'USD', name: '美金', cash: { buy: 32, sell: 33 }, spot: { buy: 32.1, sell: 32.5 } },
  { code: 'JPY', name: '日圓', cash: { buy: .2, sell: .21 }, spot: { buy: .201, sell: .209 } },
  { code: 'EUR', name: '歐元', cash: { buy: 35, sell: 37 }, spot: { buy: 36, sell: 36.5 } },
  { code: 'KRW', name: '韓元', cash: { buy: .02, sell: .03 }, spot: { buy: null, sell: null } },
] });
export function exchangeCsv(data = exchangeFixture()) {
  const head = ['幣別', '匯率', '現金', '即期', '遠期10天', '遠期30天', '遠期60天', '遠期90天', '遠期120天', '遠期150天', '遠期180天', '匯率', '現金', '即期', '遠期10天', '遠期30天', '遠期60天', '遠期90天', '遠期120天', '遠期150天', '遠期180天'];
  const number = value => value === null ? '0.00000' : value.toFixed(5);
  return '\uFEFF' + [head.join(','), ...data.rates.map(rate => [rate.code, '本行買入', number(rate.cash.buy), number(rate.spot.buy), ...Array(7).fill('0.00000'), '本行賣出', number(rate.cash.sell), number(rate.spot.sell), ...Array(7).fill('0.00000'), ''].join(','))].join('\r\n');
}
export function exchangeHtml(data = exchangeFixture()) {
  return `<html><body><span>牌價最新掛牌時間：${data.quotedAt.slice(0, 16).replaceAll('-', '/').replace('T', ' ')}</span><table><tbody>${data.rates.map(rate => `<tr><td><div class="hidden-phone">${rate.name} (${rate.code})</div></td>${[['本行現金買入', rate.cash.buy], ['本行現金賣出', rate.cash.sell], ['本行即期買入', rate.spot.buy], ['本行即期賣出', rate.spot.sell]].map(([key, value]) => `<td data-table="${key}">${value === null ? '-' : value}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
// Fixed synthetic 19-currency structural fixture; never a captured live bank page.
export function fullExchangeFixture() {
  return { ...exchangeFixture(), rates: Object.entries(CURRENCY_NAMES).map(([code, name], i) => ({ code, name,
    cash: { buy: i + 1, sell: i + 2 }, spot: { buy: code === 'KRW' ? null : i + 1.1, sell: code === 'KRW' ? null : i + 1.2 } })) };
}
export function fullExchangeHtml(data = fullExchangeFixture()) {
  return exchangeHtml(data).replace('<html><body>', '<!DOCTYPE html><html><head><title>臺灣銀行牌告匯率</title></head><body><h1>臺灣銀行牌告匯率</h1>')
    .replace('<table><tbody>', '<table class="table"><thead><tr><th rowspan="2">幣別</th><th colspan="2">現金匯率</th><th colspan="2">即期匯率</th></tr><tr><th>本行買入</th><th>本行賣出</th><th>本行買入</th><th>本行賣出</th></tr></thead><tbody>');
}
// Same column structure as the verified official close page/TXT; synthetic prices only.
export const closeCaptured = '2026-10-20T09:30:00.000Z';
export const closeFixture = () => ({ ...fullExchangeFixture(), quotedAt: '2026-10-20T16:01:00+08:00', fetchedAt: closeCaptured });
export function closeHtml(data = closeFixture()) {
  return fullExchangeHtml(data).replace('<h1>臺灣銀行牌告匯率</h1>', '<h1>歷史匯率收盤價</h1>')
    .replace('<span>牌價最新掛牌時間：', '<p class="text-info">掛牌時間：').replace('</span>', '</p>')
    .replace('</body>', `<a href="/xrt/fltxt/0/${data.quotedAt.slice(0, 10)}">下載文字檔</a></body>`);
}
export function closeTxt(data = closeFixture()) {
  return exchangeCsv(data).trim().split(/\r?\n/).map(line => line.replace(/^\uFEFF/, '').replace(/,$/, '').split(',').join('   ')).join('\r\n');
}

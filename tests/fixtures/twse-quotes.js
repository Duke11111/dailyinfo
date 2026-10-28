// Synthetic whole-market rows using the officially observed FMTQIK/MI_INDEX field layout.
export const marketFields = ['日期', '成交股數', '成交金額', '成交筆數', '發行量加權股價指數', '漲跌點數'];
export const miFields = ['證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差', '最後揭示買價', '最後揭示買量', '最後揭示賣價', '最後揭示賣量', '本益比'];
export const roc = day => `${Number(day.slice(0, 4)) - 1911}/${day.slice(5, 7)}/${day.slice(8)}`;
export function marketFixture(request, days) {
  return { stat: 'OK', date: request.replaceAll('-', ''), title: `${Number(request.slice(0, 4)) - 1911}年${request.slice(5, 7)}月市場成交資訊`,
    fields: [...marketFields], data: days.map(day => [roc(day), '1,000,000', '100,000,000', '10,000', '30,000.00', '-10.00']) };
}
export function primaryFixture(day) {
  return ['2330', '2454', '0050', ...Array.from({ length: 997 }, (_, i) => String(1000 + i))].map(code => ({
    Code: code, Name: '合成測試證券 ' + code, Date: day.replaceAll('-', ''), OpeningPrice: '100.00', HighestPrice: '110.00', LowestPrice: '90.00',
    ClosingPrice: '101.00', Change: '1.00', TradeVolume: '1,000', TradeValue: '101,000', Transaction: '10',
  }));
}
export function miFixture(day) {
  return { stat: 'OK', date: day.replaceAll('-', ''), type: 'ALLBUT0999', params: { date: day.replaceAll('-', ''), type: 'ALLBUT0999' },
    tables: [{ title: `${roc(day).replace('/', '年').replace('/', '月')}日 每日收盤行情(全部(不含權證、牛熊證、可展延牛熊證))`, fields: [...miFields],
      data: primaryFixture(day).map(r => [r.Code, r.Name, r.TradeVolume, r.Transaction, r.TradeValue, r.OpeningPrice, r.HighestPrice, r.LowestPrice,
        r.ClosingPrice, '<p style= color:red>+</p>', r.Change, '100.00', '10', '101.00', '10', '20.00']) }] };
}

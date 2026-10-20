// Explicit fixture for tests only; production uses the TWSE snapshot.
export const catalogFixture = () => ({ version: 1, fetchedAt: '2026-10-19T10:00:00Z', sources: [
  { label: '上市公司基本資料', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L', count: 2, issuedDates: ['2026-10-18'] },
  { label: '基金基本資料彙總表', url: 'https://openapi.twse.com.tw/v1/opendata/t187ap47_L', count: 1, issuedDates: ['2026-10-18'] },
], stocks: [
  { code: '2330', name: '台積電', fullName: '台灣積體電路製造股份有限公司', type: 'stock' },
  { code: '2317', name: '鴻海', fullName: '鴻海精密工業股份有限公司', type: 'stock' },
  { code: '0050', name: '元大台灣50', fullName: '元大台灣卓越50證券投資信託基金', type: 'etf' },
] });

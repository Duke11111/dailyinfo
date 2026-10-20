// Test fixtures only; the production snapshot is imported from TWSE.
import { parseQuoteRows } from '../../src/services/quotes.js';
export const quoteRows = () => [
  { Date: '1151016', Code: '2330', Name: '台積電', OpeningPrice: '2,430.00', HighestPrice: '2,445.00', LowestPrice: '2,420.00', ClosingPrice: '2,420.00', Change: '-20.0000', TradeVolume: '43,046,982', TradeValue: '104,583,063,462', Transaction: '400499' },
  { Date: '1151016', Code: '2454', Name: '聯發科', OpeningPrice: '4275.00', HighestPrice: '4360.00', LowestPrice: '4240.00', ClosingPrice: '4250.00', Change: '+85.0000', TradeVolume: '8683336', TradeValue: '37261292080', Transaction: '66530' },
  { Date: '1151016', Code: '0050', Name: '元大台灣50', OpeningPrice: '109.45', HighestPrice: '109.70', LowestPrice: '108.90', ClosingPrice: '109.00', Change: '0.1000', TradeVolume: '122160698', TradeValue: '13346650893', Transaction: '159639' },
];
export const quoteFixture = () => parseQuoteRows(quoteRows(), '2026-10-19T12:11:00Z');

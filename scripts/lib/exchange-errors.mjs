// Numeric child exit statuses are the only diagnostic IPC. Never parse child output.
export const EXCHANGE_MIME_CLASSES = Object.freeze(['text/plain', 'text/html', 'text/csv', 'application/octet-stream', 'application/json', 'missing', 'other']);
const mimeCode = (endpoint, mime) => `unexpected_content_type_${endpoint}_${mime.replace(/[\/-]/g, '_')}`;
export function classifyExchangeMime(header) {
  const type = typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '';
  if (!type) return 'missing';
  return EXCHANGE_MIME_CLASSES.slice(0, 5).includes(type) ? type : 'other';
}
export function exchangeMimeFailureCode(endpoint, header) {
  return ['csv', 'html'].includes(endpoint) ? mimeCode(endpoint, classifyExchangeMime(header)) : 'unexpected_content_type';
}
export const EXCHANGE_ERROR_CODES = Object.freeze([
  'network_error', 'dns_error', 'tls_error', 'connection_error', 'request_timeout',
  'http_403', 'http_429', 'http_5xx', 'http_error', 'redirect_error',
  'unexpected_content_type', 'encoding_error', 'response_too_large',
  'csv_format_error', 'quote_time_error', 'csv_html_mismatch', 'parse_error',
  'date_regression', 'previous_snapshot_invalid', 'filesystem_error', 'update_failed',
  // Append only: keep every existing exit status/checkpoint code compatible.
  ...['csv', 'html'].flatMap(endpoint => EXCHANGE_MIME_CLASSES.map(mime => mimeCode(endpoint, mime))),
]);
export class ExchangeUpdateError extends Error {
  constructor(code, message = code) {
    super(message);
    this.safeCode = EXCHANGE_ERROR_CODES.includes(code) ? code : 'update_failed';
  }
}
export const exchangeErrorCode = error => error instanceof ExchangeUpdateError && EXCHANGE_ERROR_CODES.includes(error.safeCode) ? error.safeCode : 'update_failed';
export const exchangeExitStatus = error => 64 + EXCHANGE_ERROR_CODES.indexOf(exchangeErrorCode(error));
export const exchangeCodeFromExitStatus = status => Number.isInteger(status) ? EXCHANGE_ERROR_CODES[status - 64] ?? 'update_failed' : 'update_failed';
export function exchangeNetworkError(error) {
  const values = [error, error?.cause];
  if (values.some(e => ['TimeoutError', 'AbortError'].includes(e?.name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(e?.code))) return new ExchangeUpdateError('request_timeout');
  if (values.some(e => ['ENOTFOUND', 'EAI_AGAIN'].includes(e?.code))) return new ExchangeUpdateError('dns_error');
  if (values.some(e => typeof e?.code === 'string' && (/^(?:ERR_TLS_|ERR_SSL_)/.test(e.code) || ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code)))) return new ExchangeUpdateError('tls_error');
  if (values.some(e => ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].includes(e?.code))) return new ExchangeUpdateError('connection_error');
  return new ExchangeUpdateError('network_error');
}

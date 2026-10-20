import { afterEach, it, expect, vi } from 'vitest';
import { getCwaApiKey } from '../scripts/lib/cwa-env.mjs';
afterEach(() => vi.unstubAllEnvs());
it('accepts CI secret from process environment without requiring .env.local', () => { vi.stubEnv('CI', 'true'); vi.stubEnv('CWA_API_KEY', ' test-only-key '); expect(getCwaApiKey()).toBe('test-only-key'); });
it('missing CI secret fails with controlled error without trying a local file', () => { vi.stubEnv('CI', 'true'); vi.stubEnv('CWA_API_KEY', ''); expect(() => getCwaApiKey()).toThrow('缺少 CWA_API_KEY'); });

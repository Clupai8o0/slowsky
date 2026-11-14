import { describe, expect, it, vi } from 'vitest';
import { createHandlers as createServerHandlers, memoryStore, pickStore, upstashStore, type InsightDeps, type LimitStore } from '../api/insight';
import { checkNote, factSheet, fetchInsight, insightEnabled, insightStatus, validateFacts, type InsightFacts } from '../src/lib/insight';
import { SYSTEM_PROMPT } from '../src/lib/insight-prompt';
import { TARGETS } from '../src/lib/targets';

const facts: InsightFacts = { targetId: 'custom', ra: 12.34567, dec: -38, lambdaUm: 4.27, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }], lightCurve: { points: [{ mjd: 61000, relative: 1, snr: 20 }, { mjd: 61010, relative: 0.8, snr: 10 }], refScatter: [0.02, 0.03], dropped: 2 }, difference: { peakSigma: -3.4 }, motion: { arcsec: 2.3, days: 10 }, snapshot: true };
const lines = ['Target: a position typed in by the visitor.', 'Position: RA 12.3457 deg, Dec -38.0000 deg.', 'Wavelength: 4.270 micron.', 'Visits: 2. Frames in each visit: 3, 4. Time from first to last visit: 10.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.80.', 'Largest change from the median brightness: 11 percent brighter.', 'Lowest signal-to-noise among the points: 10.', 'Reference stars: 2. Scatter of each: 2.0, 3.0 percent.', 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: 3.4 sigma, fainter in the later visit.', 'Shift in position: 2.3 arcsec over 10.0 days.', 'Frames came from: the baked snapshot.'];
const note = 'What this shows: The value is 4.27. It is at -38 degrees.\nHow far to trust it: More data helps.';
function createHandlers(deps: Pick<InsightDeps, 'apiKey' | 'model' | 'complete' | 'now'> & Partial<InsightDeps>)
{
    return createServerHandlers({ store: memoryStore(), local: memoryStore(), passcode: undefined, open: true, maxPerUserDay: 20, maxPerDay: 300, maxPerHour: 120, ...deps });
}
function request(value: unknown, headers: Record<string, string> = {}): Request
{
    return new Request('https://example.test/api/insight', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
describe('round two regressions', () => {
    it('refunds correct guesses and counts wrong guesses through a single counter', async () => {
        let now = 0;
        const store = memoryStore();
        const keys: string[] = [];
        const tracked = { ...store, hit: async (key: string, window: number, time: number) => { keys.push(key); return store.hit(key, window, time); } };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store: tracked, local: memoryStore(), now: () => now, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
        const headers = { 'x-real-ip': 'round-two', 'x-insight-passcode': 'secret' };
        for (let i = 0; i < 100; i++) { now += 3000; expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(200); }
        for (let i = 0; i < 100; i++) { now += 3000; expect((await handler.POST(request({ facts: { ...facts, ra: 23 } }, headers))).status).toBe(200); }
        expect(await store.count(keys.find((k) => k.startsWith('try:'))!, 900000, now)).toBe(0);
    });
    it('rejects unsupported number forms and preserves listed quantities', () => {
        const bad = ['½', 'Ⅻ', '①', '²', '5e3', '3/4', '2-5', '3rd', 'halved', 'doubling', 'quadrupled', 'threefold', 'hundreds', 'quarter', 'zero', '6 light years'];
        for (const value of bad) {
            expect(checkNote(`Value ${value}. Safe sentence. Another safe sentence.`, ['Value 6.']).dropped, value).toBe(1);
        }
        expect(checkNote('Double-check the second visit. It returns about every 6 months. There are fewer than 3 visits. SPHEREx has 6 detectors. The scatter is 1.2 percent.', ['Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(0);
        expect(SYSTEM_PROMPT).toContain('about every 6 months');
        expect(SYSTEM_PROMPT).toContain('fewer than 3 visits');
        expect(SYSTEM_PROMPT).toContain('Write every number in digits');
        expect(SYSTEM_PROMPT).not.toMatch(/\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|dozen|half|twice|double|triple|quarter)\b/i);
    });
    it('reports a busy service to the browser', async () => {
        for (const status of [429, 503]) {
            const fetcher = vi.fn(async () => Response.json({ error: 'busy' }, { status, headers: { 'Retry-After': '12' } })) as typeof fetch;
            expect(await insightStatus({ fetcher })).toEqual({ enabled: true, locked: false, unlocked: false, busy: true, retryAfter: 12 });
        }
        await expect(fetchInsight({ ...facts, ra: 77 }, { fetcher: vi.fn(async () => Response.json({ error: 'busy' }, { status: 503 })) as typeof fetch })).rejects.toMatchObject({ code: 'busy' });
    });
    it('fails closed on a half-configured store', async () => {
        const store = pickStore({ UPSTASH_REDIS_REST_URL: 'https://redis.test' });
        await expect(store.hit('key', 1000, 0)).rejects.toThrow();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const complete = vi.fn();
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', store, now: () => 0, complete });
            expect((await handler.POST(request({ facts: { ...facts, ra: 17.777 } }))).status).toBe(503);
            expect(complete).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('Insight limit store unavailable');
        } finally { warn.mockRestore(); }
    });
    it('keeps unauthenticated GET and invalid POSTs away from both stores', async () => {
        const store = memoryStore(), local = memoryStore();
        const sharedHit = vi.spyOn(store, 'hit'), sharedCount = vi.spyOn(store, 'count'), localHit = vi.spyOn(local, 'hit');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, local, now: () => 0, complete: vi.fn() });
        for (let i = 0; i < 100; i++) { expect((await handler.GET(new Request('https://example.test'))).status).toBe(200); }
        for (const req of [request({ facts }, { 'content-type': 'text/plain' }), new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), request({ facts: { ...facts, ra: 999 } })]) {
            expect((await handler.POST(req)).status).toBe(400);
        }
        expect(sharedHit).not.toHaveBeenCalled(); expect(sharedCount).not.toHaveBeenCalled(); expect(localHit).not.toHaveBeenCalled();
        expect((await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'secret' } }))).status).toBe(200);
    });
    it('brakes locally before the shared store', async () => {
        const store = memoryStore();
        const hit = vi.spyOn(store, 'hit');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, now: () => 0, complete: vi.fn() });
        const replies = await Promise.all(Array.from({ length: 50 }, () => handler.POST(request({ facts }, { 'x-insight-passcode': 'wrong' }))));
        expect(replies.filter((r) => r.status === 401)).toHaveLength(30);
        expect(replies.filter((r) => r.status === 429)).toHaveLength(20);
        expect(hit).toHaveBeenCalledTimes(40);
    });
    it('returns exactly 30 wrong guesses for a serial flood', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: vi.fn() });
        const replies: number[] = [];
        for (let i = 0; i < 200; i++) { replies.push((await handler.POST(request({ facts }, { 'x-insight-passcode': 'wrong' }))).status); }
        expect(replies.filter((status) => status === 401)).toHaveLength(30);
        expect(replies.filter((status) => status === 429)).toHaveLength(170);
    });
    it('counts GET guesses and preserves the window until it expires', async () => {
        let now = 0;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => now, complete: vi.fn() });
        const wrong = () => handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'wrong' } }));
        for (let i = 0; i < 30; i++) { expect((await wrong()).status).toBe(200); }
        now = 14 * 60000; expect((await wrong()).status).toBe(429);
        now = 16 * 60000; expect((await wrong()).status).toBe(200);
    });
    it.each(['global-hour', 'global-day'])('refunds the visitor after %s refuses', async (global) => {
        const store = memoryStore();
        await store.hit(global, global === 'global-hour' ? 3600000 : 86400000, 0);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', store, now: () => 0, maxPerHour: global === 'global-hour' ? 1 : 100, maxPerDay: global === 'global-day' ? 1 : 100, complete: vi.fn() });
        for (let i = 0; i < 5; i++) { expect((await handler.POST(request({ facts: { ...facts, ra: 40 + i } }))).status).toBe(429); }
        expect(await (await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': '' } }))).json()).toMatchObject({ remaining: 20 });
    });
    it('retains blocked guesses and global limits while bounding and sweeping memory', async () => {
        const store = memoryStore();
        for (let i = 0; i < 31; i++) { await store.hit('try:blocked', 900000, 0); }
        await store.hit('global-day', 86400000, 0);
        for (let i = 0; i < 25000; i++) { await store.hit(`try:${i}`, 900000, 0); }
        expect(await store.count('try:blocked', 900000, 0)).toBe(31);
        expect(await store.count('global-day', 86400000, 0)).toBe(1);
        expect(store.size()).toBeLessThanOrEqual(40002);
        await store.hit('try:new', 900000, 900000);
        expect(store.size()).toBeLessThan(10);
    });
    it('uses a keyed address and supports complete or absent store configuration', async () => {
        expect(await pickStore({}).hit('key', 1000, 0)).toBe(1);
        expect(pickStore({ UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' })).toBeDefined();
        const keys: string[] = [];
        for (const apiKey of ['key-a', 'key-b']) {
            const store = memoryStore();
            const hit = vi.spyOn(store, 'hit').mockImplementation(async (key) => { keys.push(key); return 1; });
            const handler = createHandlers({ apiKey, model: 'fake', passcode: 'secret', store, now: () => 0, complete: vi.fn() });
            await handler.GET(new Request('https://example.test', { headers: { 'x-real-ip': '192.0.2.77', 'x-insight-passcode': 'wrong' } }));
            hit.mockRestore();
        }
        expect(keys[0]).not.toBe(keys[1]); expect(keys.every((key) => !key.includes('192.0.2.77'))).toBe(true);
    });
    it('rejects a bad expiry and sends DECR for a refund', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ result: 1 }, { result: 0 }])).mockResolvedValueOnce(Response.json({ result: 0 }));
        const store = upstashStore('https://redis.test', 'token', fetcher);
        await expect(store.hit('key', 1000, 0)).rejects.toThrow();
        await store.refund('key', 1000, 0);
        expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(['DECR', 'key:0']);
    });
    it('drops a sentence cut after a possible decimal point', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'First sentence. Second sentence. Brightness is 4.', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 72.123 } }))).json()).toMatchObject({ text: 'First sentence. Second sentence.' });
        const fragment = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'First sentence. Second sentence. Brightness is 4. unfinished', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await fragment.POST(request({ facts: { ...facts, ra: 72.124 } }))).json()).toMatchObject({ text: 'First sentence. Second sentence.' });
    });
    it.each(['halve', 'halved', 'halves', 'halving', 'doubled', 'doubles', 'doubling', 'tripled', 'triples', 'tripling', 'quadruple', 'quadrupled', 'quadruples', 'quadrupling', 'twofold', 'hundreds', 'thousands', 'millions', 'billions', 'dozens', 'quarter', 'quarters', 'zero'])('drops number word %s', (word) => {
        expect(checkNote(`It is ${word}. Safe sentence. Another safe sentence.`, []).dropped).toBe(1);
    });
    it.each(['light-year', 'light-years', 'light year', 'light years', 'ly', 'pc', 'parsec', 'parsecs', 'kpc', 'AU', 'km', 'kelvin', 'K', 'year', 'years', 'yr', 'yrs', 'Myr', 'Gyr', 'mag', 'magnitude', 'magnitudes', 'Jy', 'mJy', 'solar', 'Jupiter'])('drops unsupported unit %s', (unit) => {
        expect(checkNote(`It is 6 ${unit} away. Safe sentence. Another safe sentence.`, ['Count: 6.']).dropped).toBe(1);
    });
    it.each(['0.75', '5', '1.083', '1.875', '3.05', '3.3', '4.05', '4.27', '4.67', '102', '6.2', '6', '3'])('requires context for constant %s', (value) => {
        expect(checkNote(`The value is ${value}. Safe sentence. Another safe sentence.`, []).dropped).toBe(1);
    });
    it('does not attach a sheet count to a fabricated percent', () => {
        expect(checkNote('The change is 12 percent. Safe sentence. Another safe sentence.', ['Count: 12.']).dropped).toBe(1);
        expect(checkNote('The scatter is 1.2, 1.8 and 2.5 percent. Another safe sentence.', ['Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(0);
    });
    it('does not evict a browser cache entry on a failed request', async () => {
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        for (let i = 0; i < 50; i++) { await fetchInsight({ ...facts, ra: 200 + i / 100 }, { fetcher }); }
        await expect(fetchInsight({ ...facts, ra: 201 }, { fetcher: vi.fn(async () => new Response('', { status: 500 })) as typeof fetch })).rejects.toMatchObject({ code: 'failed' });
        expect((await fetchInsight({ ...facts, ra: 200 }, { fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(50);
    });
});
describe('insight access and allowances', () => {
    it.each([false, true])('bounds parallel guesses, delayed store: %s', async (delayed) => {
        const inner = memoryStore();
        const store: LimitStore = delayed ? {
            hit: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.hit(...args); },
            count: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.count(...args); },
            refund: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.refund(...args); },
        } : inner;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0, passcode: 'secret', store });
        const send = () => handler.POST(request({ facts }, { 'x-real-ip': 'guess-parallel', 'x-insight-passcode': 'bad' }));
        const replies = await Promise.all(Array.from({ length: 200 }, send));
        expect(replies.filter((r) => r.status === 401).length).toBe(30);
        expect(replies.every((r) => r.status === 401 || r.status === 429)).toBe(true);
        const serial = createHandlers({ apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0, passcode: 'secret' });
        for (let i = 0; i < 30; i++) { expect((await serial.POST(request({ facts }, { 'x-insight-passcode': 'bad' }))).status).toBe(401); }
        expect((await serial.POST(request({ facts }, { 'x-insight-passcode': 'bad' }))).status).toBe(429);
    });
    it('charges shared counters only after visitor counters pass under concurrency', async () => {
        const complete = vi.fn(async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }));
        const inner = memoryStore();
        const store: LimitStore = { hit: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.hit(...args); }, count: async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return inner.count(...args); }, refund: async (...args) => inner.refund(...args) };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 18000000, passcode: 'secret', maxPerHour: 7, maxPerDay: 7, store });
        const replies = await Promise.all(Array.from({ length: 300 }, (_, i) => handler.POST(request({ facts: { ...facts, ra: i / 10 } }, { 'x-real-ip': 'parallel-right', 'x-insight-passcode': 'secret' }))));
        expect(replies.filter((r) => r.status === 200).length).toBeLessThanOrEqual(6);
        expect(complete.mock.calls.length).toBeLessThanOrEqual(6);
        expect((await handler.POST(request({ facts: { ...facts, ra: 80 } }, { 'x-real-ip': 'another-visitor', 'x-insight-passcode': 'secret' }))).status).toBe(200);
    });
    it('fails closed on store errors without leaking details', async () => {
        const complete = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret');
        try {
            const store = { hit: async () => { throw new Error('secret'); }, count: async () => { throw new Error('secret'); }, refund: async () => { throw new Error('secret'); } };
            const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, store });
            const response = await handler.POST(request({ facts: { ...facts, ra: 81 } }));
            expect(response.status).toBe(503);
            expect(await response.json()).toEqual({ error: 'busy' });
            expect(response.headers.get('retry-after')).toBe('60');
            expect(complete).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith('Insight limit store unavailable');
        } finally { warn.mockRestore(); vi.unstubAllEnvs(); }
    });
    it.each([
        ['user-minute:', 7, false], ['user-day:', 21, true], ['global-hour', 121, false], ['global-day', 301, true],
    ])('stops after the %s counter exceeds its limit', async (key, count, daily) => {
        const touched: string[] = [];
        const complete = vi.fn();
        const store: LimitStore = { hit: async (name) => { touched.push(name); return name.startsWith(key) ? count : 1; }, count: async () => 0, refund: async () => {} };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, store });
        const response = await handler.POST(request({ facts: { ...facts, ra: 90 } }));
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({ error: 'busy', ...(daily ? { reason: 'daily' } : {}) });
        expect(touched.at(-1)).toMatch(new RegExp(`^${key}`));
        expect(complete).not.toHaveBeenCalled();
    });
    it('keeps note counters usable after 25000 distinct guessers', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => 0, passcode: 'secret' });
        for (let i = 0; i < 25000; i++) {
            const response = await handler.POST(request({ facts }, { 'x-real-ip': `visitor-${i}`, 'x-insight-passcode': 'bad' }));
            expect(response.status).toBe(401);
        }
        const response = await handler.POST(request({ facts: { ...facts, ra: 82 } }, { 'x-real-ip': 'known', 'x-insight-passcode': 'secret' }));
        expect(response.status).toBe(200);
    }, 60000);
    it('groups IPv6 by /64 and IPv4 mapped addresses by IPv4', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => 0, maxPerUserDay: 1 });
        const send = (ip: string, ra: number) => handler.POST(request({ facts: { ...facts, ra } }, { 'x-real-ip': ip }));
        expect((await send('2001:db8:1:2:aaaa::1', 83)).status).toBe(200);
        expect((await send('2001:db8:1:2:bbbb::9', 84)).status).toBe(429);
        expect((await send('2001:db8:1:3::1', 85)).status).toBe(200);
        expect((await send('::ffff:1.2.3.4', 86)).status).toBe(200);
        expect((await send('1.2.3.4', 87)).status).toBe(429);
    });
    it('reports whether access is locked', async () => {
        const base = { apiKey: 'key', model: 'fake', complete: vi.fn(), now: () => 0 };
        expect(await (await createHandlers({ ...base, passcode: 'secret' }).GET(new Request('https://example.test'))).json()).toMatchObject({ locked: true });
        expect(await (await createHandlers({ ...base, open: true }).GET(new Request('https://example.test'))).json()).toMatchObject({ locked: false });
    });
    it('fails closed, locks guesses, and unlocks after the window', async () => {
        let now = 0;
        const complete = vi.fn(async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }));
        const base = { apiKey: 'key', model: 'fake', complete, now: () => now };
        expect(await (await createHandlers({ ...base, open: false }).GET(new Request('https://example.test'))).json()).toEqual({ enabled: false, locked: false, unlocked: false, model: 'fake' });
        expect((await (await createHandlers(base).GET(new Request('https://example.test'))).json()).enabled).toBe(true);
        const handler = createHandlers({ ...base, passcode: 'secret' });
        const headers = { 'x-real-ip': '192.0.2.40' };
        expect((await handler.POST(request({ facts }, headers))).status).toBe(401);
        for (let i = 0; i < 29; i++) {
            expect((await handler.POST(request({ facts }, { ...headers, 'x-insight-passcode': 'wrong' }))).status).toBe(401);
        }
        expect(complete).not.toHaveBeenCalled();
        const locked = await handler.POST(request({ facts }, { ...headers, 'x-insight-passcode': 'secret' }));
        expect(locked.status).toBe(429);
        expect(locked.headers.get('retry-after')).toBe('900');
        expect((await handler.POST(request({ facts: { ...facts, ra: 300 } }, { 'x-real-ip': '192.0.2.41', 'x-insight-passcode': 'secret' }))).status).toBe(200);
        now += 900000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 301 } }, { ...headers, 'x-insight-passcode': 'secret' }))).status).toBe(200);
    });
    it('counts new answers per visitor and day, without charging refusals or cache hits', async () => {
        let now = 0;
        const keys: string[] = [];
        const inner = memoryStore();
        const store = { hit: async (k: string, w: number, n: number) => { keys.push(k); return inner.hit(k, w, n); }, count: async (k: string, w: number, n: number) => { keys.push(k); return inner.count(k, w, n); }, refund: inner.refund };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => now, passcode: 'secret', store, maxPerUserDay: 3 });
        const headers = { 'x-real-ip': '192.0.2.42', 'x-insight-passcode': 'secret' };
        for (let i = 0; i < 3; i++) {
            expect(await (await handler.POST(request({ facts: { ...facts, ra: 310 + i } }, headers))).json()).toMatchObject({ remaining: 2 - i, cached: false });
        }
        const refused = await handler.POST(request({ facts: { ...facts, ra: 313 } }, headers));
        expect(await refused.json()).toEqual({ error: 'busy', reason: 'daily' });
        const userDayKey = keys.find((key) => key.startsWith('user-day:'))!;
        expect(await inner.count(userDayKey, 86400000, now)).toBe(4);
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 310 } }, headers))).json()).toMatchObject({ cached: true });
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ remaining: 0, unlocked: true });
        const wrong = await (await handler.GET(new Request('https://example.test', { headers: { ...headers, 'x-insight-passcode': 'bad' } }))).json();
        expect(wrong).toMatchObject({ unlocked: false });
        expect(wrong).not.toHaveProperty('remaining');
        for (let i = 0; i < 29; i++) {
            await handler.GET(new Request('https://example.test', { headers: { ...headers, 'x-insight-passcode': 'bad' } }));
        }
        expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(429);
        expect(keys.every((k) => !k.includes('192.0.2.42'))).toBe(true);
        expect((await handler.POST(request({ facts: { ...facts, ra: 313 } }, { ...headers, 'x-real-ip': '192.0.2.43' }))).status).toBe(200);
        now += 86400000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 314 } }, headers))).status).toBe(200);
    });
    it('expires fixed windows and uses x-real-ip before the forwarded address', async () => {
        const store = memoryStore();
        expect(await store.hit('a', 1000, 999)).toBe(1);
        expect(await store.count('a', 1000, 1000)).toBe(0);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => 400000000, store, maxPerUserDay: 1 });
        const headers = { 'x-real-ip': 'real', 'x-forwarded-for': 'forwarded-a, proxy' };
        expect((await handler.POST(request({ facts: { ...facts, ra: 340 } }, headers))).status).toBe(200);
        expect((await handler.POST(request({ facts: { ...facts, ra: 341 } }, { ...headers, 'x-forwarded-for': 'forwarded-b' }))).status).toBe(429);
    });
    it('enforces the global daily cap', async () => {
        const base = { apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => 180000000, maxPerDay: 2 };
        const handler = createHandlers(base);
        for (let i = 0; i < 3; i++) {
            expect((await handler.POST(request({ facts: { ...facts, ra: 320 + i } }, { 'x-real-ip': `test-${i}` }))).status).toBe(i < 2 ? 200 : 429);
        }
    });
    it('uses the Upstash REST protocol and rejects failures', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json([{ result: 4 }, { result: 1 }])).mockResolvedValueOnce(Response.json({ result: null })).mockResolvedValueOnce(new Response('', { status: 500 }));
        const store = upstashStore('https://redis.test/', 'token', fetcher);
        expect(await store.hit('key', 1000, 2500)).toBe(4);
        expect(fetcher.mock.calls[0]![0]).toBe('https://redis.test/pipeline');
        expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual([['INCR', 'key:2'], ['PEXPIRE', 'key:2', '2000']]);
        expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer token');
        expect(await store.count('key', 1000, 2500)).toBe(0);
        await expect(store.count('key', 1000, 2500)).rejects.toThrow();
    });
    it('sends browser passcodes only in headers and reports errors', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ enabled: true, locked: true, unlocked: true })).mockResolvedValueOnce(Response.json({ error: 'locked' }, { status: 401 })).mockResolvedValueOnce(Response.json({ error: 'busy', reason: 'daily' }, { status: 429, headers: { 'Retry-After': '12' } }));
        expect((await insightStatus({ passcode: 'secret', fetcher })).unlocked).toBe(true);
        expect(fetcher.mock.calls[0]![1].headers['X-Insight-Passcode']).toBe('secret');
        await expect(fetchInsight({ ...facts, ra: 330 }, { passcode: 'secret', fetcher })).rejects.toMatchObject({ code: 'locked' });
        expect(fetcher.mock.calls[1]![1].body).not.toContain('secret');
        await expect(fetchInsight({ ...facts, ra: 331 }, { fetcher })).rejects.toMatchObject({ code: 'busy', retryAfter: 12, reason: 'daily' });
        expect(fetcher.mock.calls[2]![1].headers).not.toHaveProperty('X-Insight-Passcode');
        expect(await insightStatus({ fetcher: vi.fn(async () => { throw new Error(); }) as typeof fetch })).toEqual({ enabled: false, locked: false, unlocked: false });
    });
});
describe('insight facts and guard', () => {
    it.each(['Value １０.', 'Value .5.', 'There are twenty frames.', 'Value 10 percent.', 'Value 10 times.', 'Value 10x.', 'Value 10×.', 'Value 10 sigma.', 'Value 10σ.', 'Value 10%.'])('drops unsupported numeric form: %s', (bad) => {
        expect(checkNote(`${bad} Safe sentence. Another safe sentence.`, ['Value 10 days.', 'Value 0.5.'])).toEqual({ text: 'Safe sentence. Another safe sentence.', dropped: 1 });
    });
    it('keeps matching units, pronouns, and allowed constants', () => {
        expect(checkNote('The star dimmed by 10 percent. No one frame stands out. Helium is at 1.083 micron.', ['Change: 10 percent.'])).toEqual({ text: 'The star dimmed by 10 percent. No one frame stands out. Helium is at 1.083 micron.', dropped: 0 });
    });
    it('validates clean copies and rejects invalid shapes and values', () => {
        expect(validateFacts(facts)).toEqual(facts);
        for (const bad of [null, { ...facts, extra: 1 }, { ...facts, lightCurve: { ...facts.lightCurve, extra: 1 } }, { ...facts, targetId: 'unknown' }, { ...facts, ra: 400 }, { ...facts, ra: NaN }, { ...facts, visits: Array(13).fill(facts.visits[0]) }, { ...facts, lightCurve: { ...facts.lightCurve, points: Array(61).fill(facts.lightCurve!.points[0]) } }, { ...facts, dec: '1' }]) {
            expect(() => validateFacts(bad)).toThrow();
        }
    });
    it('formats every fact and handles optional data', () => {
        expect(factSheet(facts)).toEqual(lines);
        const { lightCurve: _lc, difference: _d, motion: _m, ...simple } = facts;
        expect(factSheet(simple)).toHaveLength(5);
        expect(factSheet({ ...simple, targetId: TARGETS[0]!.id })[0]).toBe(`Target: ${TARGETS[0]!.name}.`);
        expect(factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, points: [...facts.lightCurve!.points].reverse() } })).toEqual(lines);
        expect(factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, refScatter: [] } })).toContain('Reference stars: none, so the brightness change has no control.');
        const zero = factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, points: [{ mjd: 61000, relative: 0, snr: 1 }] } });
        expect(zero.some((line) => line.startsWith('Largest change'))).toBe(false);
    });
    it('removes unverified sentences and requires two survivors', () => {
        expect(checkNote(note, lines)).toEqual({ text: note, dropped: 0 });
        expect(checkNote('Label: Value 0.85 is real. Invented 9999. Discovery happened. More follows.', ['Value 0.85.'])).toEqual({ text: 'Label: Value 0.85 is real. More follows.', dropped: 2 });
        expect(checkNote('Made up 9999: First sentence. Second sentence.\nSafe: Third sentence. Fourth sentence.', [])).toEqual({ text: 'Safe: Third sentence. Fourth sentence.', dropped: 2 });
        expect(() => checkNote('One sentence. Invented 9999.', [])).toThrowError(expect.objectContaining({ code: 'unverified' }));
    });
});
describe('insight handler', () => {
    it('drops a truncated final fragment', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'First sentence. Second sentence. Unfinished value 1.083', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect(await (await handler.POST(request({ facts: { ...facts, ra: 88 } }))).json()).toMatchObject({ text: 'First sentence. Second sentence.' });
        const empty = createHandlers({ apiKey: 'key', model: 'fake', now: () => 0, complete: async () => ({ text: 'Unfinished value 1.083', refused: false, model: 'fake', stopReason: 'max_tokens' }) });
        expect((await empty.POST(request({ facts: { ...facts, ra: 91 } }))).status).toBe(422);
    });
    it('checks access and input, filters and caches results', async () => {
        const complete = vi.fn(async (_s: string, _u: string, _signal: AbortSignal) => ({ text: note, refused: false, model: 'fake' }));
        const off = createHandlers({ apiKey: undefined, model: 'fake', complete, now: () => 0 });
        expect(await (await off.GET(new Request('https://example.test'))).json()).toMatchObject({ enabled: false });
        expect((await off.POST(request({ facts }))).status).toBe(503);
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0 });
        expect((await handler.POST(request({ facts }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
        expect((await handler.POST(request({ facts }, { origin: 'https://elsewhere.test' }))).status).toBe(403);
        expect((await handler.POST(request({ facts }, { 'content-type': 'text/plain' }))).status).toBe(400);
        expect((await handler.POST(request({ facts, pad: 'x'.repeat(5000) }))).status).toBe(413);
        expect((await handler.POST(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '5000' }, body: '{}' }))).status).toBe(413);
        expect((await handler.POST(new Request('https://example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
        const response = await handler.POST(request({ facts }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ text: note, dropped: 0, model: 'fake', cached: false, remaining: 19 });
        for (const line of lines) { expect(complete.mock.calls[0]![1]).toContain(line); }
        expect((await handler.POST(request({ facts }))).status).toBe(200);
        expect(complete).toHaveBeenCalledTimes(1);
    });
    it('enforces per-client limits and recovers after a minute', async () => {
        let now = 100000;
        const complete = vi.fn(async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }));
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => now });
        for (let i = 0; i < 6; i++) { expect((await handler.POST(request({ facts: { ...facts, ra: 100 + i } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200); }
        const limited = await handler.POST(request({ facts: { ...facts, ra: 106 } }, { 'x-forwarded-for': 'limit-test' }));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBeTruthy();
        now += 61000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 106 } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200);
    });
    it('does not expose errors and rejects refusals and unverifiable notes', async () => {
        for (const [result, status, code] of [[{ text: '', refused: true, model: 'fake' }, 502, 'no_note'], [new Error('sk-secret upstream text'), 502, 'failed'], [{ text: 'Value 9999. Value 8888.', refused: false, model: 'fake' }, 422, 'unverified']] as const) {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 1000000, complete: async () => { if (result instanceof Error) { throw result; } return result; } });
            const response = await handler.POST(request({ facts: { ...facts, ra: code === 'no_note' ? 230 : code === 'failed' ? 231 : 232 } }, { 'x-forwarded-for': code }));
            expect(response.status).toBe(status);
            const body = await response.text();
            expect(body).toContain(code);
            expect(body).not.toContain('sk-secret');
        }
    });
    it('enforces the hourly cap and lets cached answers through', async () => {
        vi.stubEnv('INSIGHT_MAX_PER_HOUR', '1');
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', maxPerHour: 1, now: () => 5000000, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
            const first = { ...facts, ra: 250 };
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-a' }))).status).toBe(200);
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-b' }))).status).toBe(200);
            const limited = await handler.POST(request({ facts: { ...facts, ra: 251 } }, { 'x-forwarded-for': 'hourly-b' }));
            expect(limited.status).toBe(429);
            expect(limited.headers.get('retry-after')).toBe('2200');
        } finally { vi.unstubAllEnvs(); }
    });
    it('aborts a completion which does not settle', async () => {
        vi.useFakeTimers();
        try {
            let signal: AbortSignal | undefined;
            const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 9000000, complete: async (_system, _user, s) => { signal = s; return new Promise(() => {}); } });
            const pending = handler.POST(request({ facts: { ...facts, ra: 260 } }));
            await vi.waitFor(() => expect(signal).toBeDefined());
            await vi.advanceTimersByTimeAsync(25000);
            expect((await pending).status).toBe(502);
            expect(signal?.aborted).toBe(true);
        } finally { vi.useRealTimers(); }
    });
});
describe('browser client', () => {
    it('caches notes even when a passcode is sent', async () => {
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        const input = { ...facts, ra: 89 };
        await fetchInsight(input, { passcode: 'secret', fetcher });
        expect((await fetchInsight(input, { passcode: 'secret', fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('handles availability and caches notes', async () => {
        expect(await insightEnabled(vi.fn(async () => new Response('', { status: 500 })) as typeof fetch)).toBe(false);
        expect(await insightEnabled(vi.fn(async () => { throw new Error(); }) as typeof fetch)).toBe(false);
        expect(await insightEnabled(vi.fn(async () => Response.json({ enabled: true })) as typeof fetch)).toBe(true);
        const fetcher = vi.fn(async () => Response.json({ text: note, model: 'fake', dropped: 0 })) as unknown as typeof fetch;
        expect((await fetchInsight(facts, { fetcher })).cached).toBe(false);
        expect((await fetchInsight(facts, { fetcher })).cached).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it('rethrows an abort', async () => {
        const controller = new AbortController();
        controller.abort();
        const abort = new DOMException('aborted', 'AbortError');
        await expect(fetchInsight({ ...facts, ra: 280 }, { signal: controller.signal, fetcher: vi.fn(async () => { throw abort; }) as typeof fetch })).rejects.toBe(abort);
    });
    it.each([[503, 'off'], [400, 'invalid'], [413, 'invalid'], [429, 'busy'], [422, 'unverified'], [500, 'failed']] as const)('maps status %i', async (status, code) => {
        await expect(fetchInsight({ ...facts, ra: status / 10 }, { fetcher: vi.fn(async () => new Response('', { status })) as typeof fetch })).rejects.toMatchObject({ code });
    });
});

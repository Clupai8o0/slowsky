import { describe, expect, it, vi } from 'vitest';
import { GET as serverGET, createHandlers as createServerHandlers, memoryStore, networkAddress, pickStore, storeMissing, upstashStore, type InsightDeps, type LimitStore } from '../api/insight';
import { checkNote, factSheet, fetchInsight, insightEnabled, insightStatus, validateFacts, type InsightFacts } from '../src/lib/insight';
import { SYSTEM_PROMPT } from '../src/lib/insight-prompt';
import { TARGETS } from '../src/lib/targets';

const facts: InsightFacts = { targetId: 'custom', ra: 12.34567, dec: -38, lambdaUm: 4.27, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }], lightCurve: { points: [{ mjd: 61000, relative: 1, snr: 20 }, { mjd: 61010, relative: 0.8, snr: 10 }], refScatter: [0.02, 0.03], dropped: 2 }, difference: { peakSigma: -3.4 }, motion: { arcsec: 2.3, days: 10 }, snapshot: true };
const lines = ['Target: a position typed in by the visitor.', 'Position: RA 12.3457 deg, Dec -38.0000 deg.', 'Wavelength: 4.270 micron.', 'Visits: 2. Frames in each visit: 3, 4. Time from first to last visit: 10.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.80.', 'Lowest signal-to-noise among the points: 10. This counts sky noise only, so the real uncertainty is larger.', 'Reference stars: 2 with available scatter. Scatter of each: 2.0, 3.0 percent.', 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.', 'Shift in position: 2.3 arcsec over 10.0 days.', 'Frames came from: a saved copy.'];

describe('honest fact sheet', () => {
    const withPoints = (points: { mjd: number; relative: number; snr: number }[]) => ({ ...facts, lightCurve: { ...facts.lightCurve!, points } });
    it('uses printed precision at the bounds', () => {
        // The lowest signal-to-noise is rounded down, so the sheet never shows it better than it is.
        for (const [snr, shown] of [[1, '1'], [1.5, '1'], [1.99, '1'], [99.5, '99'], [100, '100'], [100.4, '100'],
            [100.99, '100'], [101, 'more than 100']] as const) {
            expect(factSheet(withPoints([{ mjd: 61000, relative: 1, snr }])).join(' ')).toContain(`points: ${shown}.`);
        }
        for (const [peakSigma, shown] of [[100, '100.0 sigma'], [100.04, '100.0 sigma'], [5, '5.0 sigma'], [0.04, 'no change above the noise']] as const) {
            expect(factSheet({ ...facts, difference: { peakSigma } }).join(' ')).toContain(shown);
        }
        expect(factSheet({ ...facts, difference: { peakSigma: 5 } }).join(' ')).toContain('A bright star');
        const pts = [1, 1, 1.0051].map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 }));
        expect(factSheet(withPoints(pts))).toContain('Largest change from the median brightness: 1 percent above it.');
    });
    it('omits the span for a single visit', () => {
        expect(factSheet({ ...facts, visits: [facts.visits[0]!] }).join(' ')).not.toContain('Time from first to last visit');
    });
    it('computes change using only the displayed points', () => {
        const sheet = factSheet(withPoints([0.8, 1, 1.2, 20].map((relative, i) => ({ mjd: 61000 + i, relative, snr: i === 3 ? 0.9 : 10 }))));
        expect(sheet.join(' ')).toContain('0.80, 1.00, 1.20. Points too faint');
        expect(sheet).toContain('Largest change from the median brightness: 20 percent either side.');
    });
    it('bounds signal-to-noise and checks the printed bound', () => {
        const sheet = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 3582 }]));
        expect(sheet).toContain('Lowest signal-to-noise among the points: more than 100. This counts sky noise only, so the real uncertainty is larger.');
        expect(checkNote('The signal-to-noise is more than 100. Safe sentence. Another safe sentence.', sheet).dropped).toBe(0);
        expect(checkNote('The signal-to-noise is 3582. Safe sentence. Another safe sentence.', sheet).dropped).toBe(1);
        for (const snr of [-0.01, 0, 0.99]) {
            expect(factSheet(withPoints([{ mjd: 61000, relative: 1, snr }])).join(' ')).toContain('points: below 1.');
        }
    });
    it('reports equal deviations, negligible changes, and excludes weak points', () => {
        const pair = [{ mjd: 61000, relative: 0.8, snr: 10 }, { mjd: 61001, relative: 1.2, snr: 10 }];
        expect(factSheet(withPoints(pair)).some((line) => line.startsWith('Largest change'))).toBe(false);
        expect(factSheet(withPoints([...pair, { mjd: 61002, relative: 1, snr: 10 }]))).toContain('Largest change from the median brightness: 20 percent either side.');
        expect(factSheet(withPoints([{ ...pair[0]!, relative: 0.999 }, { ...pair[1]!, relative: 1.001 }, { mjd: 61002, relative: 1, snr: 10 }]))).toContain('Largest change from the median brightness: less than 1 percent.');
        const weak = factSheet(withPoints([...pair, { mjd: 61002, relative: 20, snr: 0.9 }]));
        expect(weak).toContain('Brightness relative to the reference stars, in time order: 0.80, 1.20. Points too faint to measure are left out.');
        expect(weak.some((line) => line.startsWith('Largest change'))).toBe(false);
        const one = factSheet(withPoints([pair[0]!, { ...pair[1]!, snr: 0 }]));
        expect(one.some((line) => /^(Brightness relative|Largest change)/.test(line))).toBe(false);
    });
    it('names the direction of a one-sided change and treats printed ties as ties', () => {
        const pts = (rel: number[]) => withPoints(rel.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })));
        expect(factSheet(pts([1, 1, 0.5]))).toContain('Largest change from the median brightness: 50 percent below it.');
        expect(factSheet(pts([1, 1, 1.5]))).toContain('Largest change from the median brightness: 50 percent above it.');
        expect(factSheet(pts([0.8124, 1, 1.1877]))).toContain('Largest change from the median brightness: 19 percent either side.');
        expect(factSheet(pts([0.9, 1, 1.1004]))).toContain('Largest change from the median brightness: 10 percent either side.');
        for (const values of [[1.3, 1, 1], [1, 1, 1.3], [1, 1, 0.77], [0.81, 1, 1.19]]) {
            expect(factSheet(pts(values)).find((line) => line.startsWith('Largest change'))).not.toMatch(/brighter|dimmer/);
        }
        for (const [values, expected] of [[[1.3, 1, 1], '30 percent above it'], [[1, 1, 0.77], '23 percent below it'], [[0.81, 1, 1.19], '19 percent either side']] as const) {
            const sheet = factSheet(pts([...values]));
            expect(sheet).toContain(`Largest change from the median brightness: ${expected}.`);
            expect(checkNote(`The largest change from the median brightness was ${expected}. Safe sentence. Another safe sentence.`, sheet).dropped).toBe(0);
        }
    });
    it('adds the misalignment caution whenever the printed value is 5.0 or more', () => {
        expect(factSheet({ ...facts, difference: { peakSigma: 4.96 } }).join(' ')).toContain('5.0 sigma, brighter there in the later visit. A bright star');
        expect(factSheet({ ...facts, difference: { peakSigma: 4.94 } }).join(' ')).not.toContain('A bright star');
    });
    it('keeps the direction of a printed bound', () => {
        const pad = 'Safe sentence. Another safe sentence.';
        const big = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 3582 }]));
        expect(checkNote(`The signal-to-noise is above 100. ${pad}`, big).dropped).toBe(0);
        expect(checkNote(`The signal-to-noise is 100. ${pad}`, big).dropped).toBe(1);
        expect(checkNote(`The signal-to-noise is less than 100. ${pad}`, big).dropped).toBe(1);
        const low = factSheet(withPoints([{ mjd: 61000, relative: 1, snr: 0.4 }]));
        expect(checkNote(`The signal-to-noise is below 1. ${pad}`, low).dropped).toBe(0);
        expect(checkNote(`The signal-to-noise is 1. ${pad}`, low).dropped).toBe(1);
        const small = factSheet(withPoints([{ mjd: 61000, relative: 0.999, snr: 50 }, { mjd: 61001, relative: 1.001, snr: 50 }, { mjd: 61002, relative: 1, snr: 50 }]));
        expect(checkNote(`The largest change from the median was less than 1 percent. ${pad}`, small).dropped).toBe(0);
        expect(checkNote(`The brightness changed by more than 1 percent. ${pad}`, small).dropped).toBe(1);
        expect(checkNote(`The brightness changed by 1 percent. ${pad}`, small).dropped).toBe(1);
        const frames = factSheet({ ...facts, visits: [{ mjd: 61000, frames: 500 }, { mjd: 61010, frames: 7 }] });
        expect(checkNote(`The first visit had at least 500 frames. ${pad}`, frames).dropped).toBe(0);
        expect(checkNote(`The first visit had 500 frames. ${pad}`, frames).dropped).toBe(1);
        expect(checkNote(`The second visit had 7 frames. ${pad}`, frames).dropped).toBe(0);
        const twelve = factSheet({ ...facts, visits: Array.from({ length: 12 }, (_, i) => ({ mjd: 61000 + 20 * i, frames: 2 })) });
        expect(twelve[3]).toMatch(/^Visits: at least 12\. /);
        expect(checkNote(`SPHEREx came back on at least 12 visits. ${pad}`, twelve).dropped).toBe(0);
        expect(checkNote(`SPHEREx came back on 12 visits. ${pad}`, twelve).dropped).toBe(1);
    });
    it('describes the strongest difference pixel with bounds and context', () => {
        expect(factSheet({ ...facts, difference: { peakSigma: -3.4 } })).toContain('Difference image at the target: strongest pixel 3.4 sigma, fainter there in the later visit.');
        expect(factSheet({ ...facts, difference: { peakSigma: 0.01 } })).toContain('Difference image at the target: no change above the noise.');
        expect(factSheet({ ...facts, difference: { peakSigma: 101 } })).toContain('Difference image at the target: strongest pixel more than 100 sigma, brighter there in the later visit. A bright star leaves marks this strong from a tiny misalignment, and a star that moved leaves a bright side and a dark side.');
    });
    it('reports a rounded zero shift and a saved copy', () => {
        const sheet = factSheet({ ...facts, motion: { arcsec: 0.01, days: 10 } });
        expect(sheet).toContain('Shift in position: none measured over 10.0 days.');
        expect(sheet).toContain('Frames came from: a saved copy.');
    });
    it('uses the shown visit count when checking past ordinal claims', () => {
        const sheet = factSheet(facts);
        expect(checkNote('The third visit was brighter. Safe sentence. Another safe sentence.', sheet).dropped).toBe(1);
    });
    it('omits non-finite scatter values', () => {
        const sheet = factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, refScatter: [NaN, 0.02] } });
        expect(sheet.join(' ')).not.toContain('NaN');
        expect(sheet).toContain('Reference stars: 1 with available scatter. Scatter of each: 2.0 percent.');
    });
});
const note = 'What this shows: The wavelength is 4.270 micron. The position is -38.0000 degrees.\nHow far to trust it: More data helps.';
function createHandlers(deps: Pick<InsightDeps, 'apiKey' | 'model' | 'complete' | 'now'> & Partial<InsightDeps>)
{
    return createServerHandlers({ store: memoryStore(), local: memoryStore(), passcode: undefined, open: true, maxPerUserDay: 20, maxPerDay: 300, maxPerHour: 120, ...deps });
}
function request(value: unknown, headers: Record<string, string> = {}): Request
{
    return new Request('https://example.test/api/insight', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
describe('round four corpus', () => {
    const sheet = ["Target: Barnard's Star.", 'Position: RA 269.4521 deg, Dec 4.6934 deg.', 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Lowest signal-to-noise among the points: 48.', 'Reference stars: 3. Scatter of each: 1.2, 1.8, 2.5 percent.', 'Frames left out because their wavelength did not match: 0.', 'Difference image at the target: 3.4 sigma, brighter in the later visit.', 'Shift in position: 10.4 arcsec over 182.5 days.', "Frames came from: NASA's live archive."];
    const good = ["Barnard's Star was seen in 3 visits spread over 182.5 days.", 'The visits hold 14, 12 and 16 frames.', 'Its brightness relative to the reference stars went from 1.00 to 0.97 and then 1.12.', 'The largest change from the median brightness is 12 percent above it.', 'The 3 reference stars scatter by 1.2, 1.8 and 2.5 percent, so the 12 percent change stands out.', 'The lowest signal-to-noise among the points is 48.', 'The difference image shows 3.4 sigma at the target, brighter in the later visit.', 'The star shifted 10.4 arcsec over 182.5 days.', 'The frames were taken at 4.270 micron, close to the carbon dioxide ice feature at 4.27 micron.', 'Its position is RA 269.4521 deg, Dec 4.6934 deg.', 'SPHEREx pixels are about 6.2 arcsec wide, so a 10.4 arcsec shift is larger than one pixel.', 'With only 3 visits, the trend is thinly sampled.', 'The 12 percent brightening is larger than the 2.5 percent scatter of the least steady reference star.', 'A shift of 10.4″ in 182.5 days and a 3.4σ difference both point the same way.', 'Compare the frames at 4.270 µm with a second wavelength in Slowsky.', 'This is a candidate change, and CO2 ice absorbs near this wavelength.'];
    const bad = ['SPHEREx returns about every 6 months, so a later visit would test it.', 'The reference stars scatter by 12 percent.', 'The star moved 10.4 arcmin.', 'The star moved 10.4 milliarcsec.', 'The frames were taken at 4.270 nm.', 'Its position is RA 269.4521 hours.', 'It moved 10.4 arcsec per day.', 'It moved 10.4 arcsec a day.', 'It moved 10.4 arcsec/day.', 'Its position is RA 269.4521 deg, Dec -4.6934 deg.', '12 of the 14 frames were left out.', '1 in 3 frames was sharp.', 'The fourth visit was the brightest.', 'It brightened by a factor of 12.', 'The change is an order of magnitude larger than the scatter.', 'The visit was on 14 March.', 'The star is at 48 °C.', 'It lies 182.5 trillion kilometres away.', 'The star is 48 light-years away.', 'The signal-to-noise reached 48 percent.', 'The 3 visits each lasted 3.4 days.', 'The scatter is 2.5 sigma.', 'It brightened 1.12 times.', 'The star moved 16 arcsec.', 'The difference is 12 sigma.', 'There were 48 visits.', 'The brightness fell to 0.97 percent.', 'The wavelength is 3.4 micron.', 'It was 3/W2/12 brighter.', 'It is half as bright.', 'The star is 1 of a kind.'];
    const unsafeMedian = ['The 3 reference stars scatter by 1.2, 1.8 and 2.5 percent, so the 12 percent change stands out.', 'The 12 percent brightening is larger than the 2.5 percent scatter of the least steady reference star.'];
    it.each(good.filter((sentence) => !unsafeMedian.includes(sentence)))('keeps %s', (sentence) => { expect(checkNote(`${sentence} Plain sentence.`, sheet).dropped).toBe(0); });
    it.each([...bad, ...unsafeMedian])('drops %s', (sentence) => { expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, sheet).dropped).toBe(1); });
    it('derives and recognizes the actual WISE short name', () => {
        const wise = factSheet({ ...facts, targetId: 'wise0855' });
        expect(wise[0]).toBe('Target: WISE J085510.83-071442.5, also written WISE 0855-0714.');
        for (const sentence of ['WISE 0855−0714 is faint here.', 'WISE J0855-0714 shows no clear change.', 'WISE 0855 is a cold brown dwarf, which is background and not measured here.', 'WISE J085510.83-071442.5 sits near the centre.']) { expect(checkNote(`${sentence} Plain sentence.`, wise).dropped, sentence).toBe(0); }
        for (const sentence of ['WISE 0855−0714 moved 0855 arcsec.', 'It is 0714 days old.', 'Its neighbour WISE 1049−5319 is brighter.']) { expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, wise).dropped, sentence).toBe(1); }
    });
    it('keeps decimal precision and context attached to each fact', () => {
        for (const sentence of ['Brightness was 1.', 'The scatter is 12 percent.', 'The change was -12 percent.', 'The position is 4.6934 degrees per day.']) {
            expect(checkNote(`${sentence} Plain sentence. Another plain sentence.`, sheet).dropped, sentence).toBe(1);
        }
        expect(checkNote('Brightness was 1.0. Plain sentence.', sheet).dropped).toBe(0);
    });
});
describe('round four access', () => {
    it('never lets wrong guesses lock out the correct code', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
        const headers = { 'x-real-ip': 'r4', 'x-insight-passcode': 'wrong' };
        for (let i = 0; i < 30; i++) { expect((await handler.POST(request({ facts }, headers))).status).toBe(401); }
        const blocked = await handler.POST(request({ facts }, headers));
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(900);
        headers['x-insight-passcode'] = 'secret';
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ unlocked: true });
        expect((await handler.POST(request({ facts: { ...facts, ra: 21.123 } }, headers))).status).toBe(200);
    });
    it('isolates wrong guesses from the shared store and the right-code brake', async () => {
        let now = 0;
        const store = memoryStore();
        const hit = vi.spyOn(store, 'hit'), count = vi.spyOn(store, 'count'), refund = vi.spyOn(store, 'refund');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', store, now: () => now, complete: vi.fn() });
        const headers = { 'x-real-ip': 'r4-flood', 'x-insight-passcode': 'wrong' };
        for (let i = 0; i < 1000; i++) {
            const response = i % 2 ? await handler.POST(request({ facts }, headers)) : await handler.GET(new Request('https://example.test', { headers }));
            if (i < 30) { expect(response.status).toBe(i % 2 ? 401 : 200); }
        }
        expect(hit).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled(); expect(refund).not.toHaveBeenCalled();
        headers['x-insight-passcode'] = 'x'.repeat(300);
        now = 900000;
        expect(await (await handler.GET(new Request('https://example.test', { headers }))).json()).toMatchObject({ unlocked: false });
        headers['x-insight-passcode'] = 'wrong';
        for (let i = 0; i < 200; i++) { await handler.POST(request({ facts }, headers)); }
        headers['x-insight-passcode'] = 'secret';
        for (let i = 0; i < 120; i++) { expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(200); }
        count.mockClear();
        const blocked = await handler.GET(new Request('https://example.test', { headers }));
        expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('60');
        expect(hit).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled(); expect(refund).not.toHaveBeenCalled();
        now = 1800000; headers['x-insight-passcode'] = 'wrong';
        expect((await handler.POST(request({ facts }, headers))).status).toBe(401);
    });
    it('lets correct requests through after wrong guesses', async () => {
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => 0, complete: vi.fn() });
        const send = (code: string) => handler.GET(new Request('https://example.test', { headers: { 'x-real-ip': 'r4-parallel', 'x-insight-passcode': code } }));
        for (let i = 0; i < 60; i++) { await send('bad'); }
        for (let i = 0; i < 30; i++) { expect(await (await send('secret')).json()).toMatchObject({ unlocked: true }); }
    });
    it('returns 503 when the local counter fails', async () => {
        const local: LimitStore = { hit: async () => { throw new Error('unavailable'); }, count: async () => 0, refund: async () => {} };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete: vi.fn() });
            for (const code of ['wrong', 'secret']) { expect((await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': code } }))).status).toBe(503); }
        } finally { warn.mockRestore(); }
    });
});
describe('round three regressions', () => {
    const complete = async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' });
    const right = { 'x-insight-passcode': 'secret', 'x-real-ip': 'round-three' };
    it('accommodates a shared venue and does not brake cached open traffic', async () => {
        const local = memoryStore();
        const localHit = vi.spyOn(local, 'hit');
        const locked = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete });
        expect((await locked.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200);
        for (let i = 0; i < 30; i++) {
            expect((await locked.GET(new Request('https://example.test', { headers: right }))).status).toBe(200);
            expect((await locked.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200);
        }
        const openLocal = memoryStore();
        const openHit = vi.spyOn(openLocal, 'hit');
        const open = createHandlers({ apiKey: 'key', model: 'fake', local: openLocal, now: () => 0, complete });
        for (let i = 0; i < 200; i++) { expect((await open.GET(new Request('https://example.test', { headers: right }))).status).toBe(200); }
        expect(openHit).not.toHaveBeenCalled();
        for (let i = 0; i < 200; i++) { expect((await open.POST(request({ facts: { ...facts, ra: 72 } }, right))).status).toBe(200); }
        expect(openHit).not.toHaveBeenCalled();
        expect(localHit).toHaveBeenCalledTimes(61);
    });
    it('deletes a negative refund and checks every store configuration', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: -1 })).mockResolvedValueOnce(Response.json({ result: 1 }));
        await upstashStore('https://redis.test', 'token', fetcher).refund('try:id', 1000, 2000);
        expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(['DEL', 'try:id:2']);
        for (const env of [{ UPSTASH_REDIS_REST_TOKEN: 'token' }, { KV_REST_API_URL: 'https://redis.test' }, { KV_REST_API_TOKEN: 'token' }]) {
            await expect(pickStore(env).hit('x', 1000, 0)).rejects.toThrow();
        }
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([{ result: 1 }, { result: 1 }]));
        try {
            await pickStore({ KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 'token' }).hit('x', 1000, 0);
            expect(fetchSpy.mock.calls[0]![0]).toBe('https://kv.test/pipeline');
        } finally { fetchSpy.mockRestore(); }
    });
    it('evicts the oldest entry when all entries are protected', async () => {
        const store = memoryStore();
        for (let i = 0; i < 20000; i++) { await store.hit(`try:${i}`, 900000, 0); await store.hit(`try:${i}`, 900000, 0); }
        await store.hit('try:new', 900000, 0);
        expect(await store.count('try:0', 900000, 0)).toBe(0);
        expect(store.size()).toBeLessThanOrEqual(20002);
    });
    it('defaults to forty notes per visitor per day', async () => {
        vi.stubEnv('ANTHROPIC_API_KEY', 'round-three-default');
        vi.stubEnv('INSIGHT_OPEN', '1');
        vi.stubEnv('INSIGHT_PASSCODE', '');
        vi.stubEnv('INSIGHT_MAX_PER_USER_DAY', '');
        try {
            const response = await serverGET(new Request('https://example.test', { headers: { 'x-insight-passcode': '' } }));
            expect(await response.json()).toMatchObject({ remaining: 40 });
        } finally { vi.unstubAllEnvs(); }
    });
    it('keeps "a third visit", ties hyphenated units and strips names only as whole words', () => {
        const sheet = ['Target: WISE 0855−0714.', 'Visits: 3. Frames: 14. Time from first to last visit: 182.5 days.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Difference image: 3.4 sigma.'];
        const pad = 'Safe sentence. Another safe sentence.';
        const kept = ['A third visit would settle it.', 'Over the 182.5-day span it moved.', 'A 3.4-sigma change shows.', 'WISE 0855-0714 is faint here.', 'WISE 0855–0714 is faint here.'];
        for (const sentence of kept) { expect(checkNote(`${sentence} ${pad}`, sheet).dropped, sentence).toBe(0); }
        const dropped = ['It moved over a 10.4-day span.', 'A 182.5-sigma change shows.', 'It fell by a third.', 'It is one-third as bright.', 'It lost a third of its light.', 'It is a fifth fainter.'];
        for (const sentence of dropped) { expect(checkNote(`${sentence} ${pad}`, sheet).dropped, sentence).toBe(1); }
        // A short name, or the short first part of one, must not be cut out of the middle of other words.
        for (const name of ['A-1', 'al', 'hal-1']) {
            expect(checkNote(`It is half as bright. ${pad}`, [`Target: ${name}.`, 'Visits: 3.']).dropped, name).toBe(1);
        }
        expect(checkNote(`Half-1 is steady. ${pad}`, ['Target: Half-1.', 'Visits: 3.']).dropped).toBe(0);
    });
    it('checks units and preserves names and catalogue tokens', () => {
        const sheet = ['Target: WISE 0855−0714.', 'Visits: 3. Frames: 14.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Difference image: 3.4 sigma.'];
        const bad = ['It moved 182.5 arcsec over 10.4 days.', 'It moved 5.1 arcsec per year.', 'The feature sits at 14 micron.', 'It is 3.4 standard deviations brighter.', 'It is 6 lightyears away.', 'Over a 2-year baseline it moved.', "It has a third of the Sun's mass.", 'It weighs 14 Msun.', 'It weighs 3 Earth masses.', 'There are 4 visits.'];
        // The sigma example must be unsupported on this sheet.
        const unsupportedSigma = [...sheet.filter((line) => !line.startsWith('Difference')), 'Measured value: 3.4.'];
        for (const sentence of bad) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, unsupportedSigma).dropped, sentence).toBe(1); }
        const good = ['WISE 0855−0714 is faint here.', 'WISE 0855 stays near the noise.', 'Check the Gaia DR3 position.', 'Carbon dioxide (CO2) ice absorbs near 4.27 micron.', 'Compare with 2MASS.', 'Worth double-checking against the second visit.', 'The third visit is the outlier.', 'The shift is 10.4 arcseconds over 182.5 days.', 'A 3.4 standard deviations change.', 'The pixels are 6.2 arcseconds wide.'];
        for (const sentence of good) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(0); }
        for (const fraction of ['one third', 'a fifth', 'one fifth', 'a tenth', 'one tenth', 'thirds', 'fifths', 'tenths']) { expect(checkNote(`It is ${fraction} brighter. Safe sentence. Another safe sentence.`, sheet).dropped, fraction).toBe(1); }
    });
    it('pairs unit aliases and lists while rejecting mismatches and unsupported hyphenated units', () => {
        const sheet = ['Target: Example.', 'Visits: 4. Frames: 8.', 'Wavelength: 1.2, 1.4 and 1.6 micron.', 'Shift in position: 10.4 arcsec over 182.5 days.', 'Position: 14 deg.', 'Signal: 3.4 sigma.'];
        const good = ['At 1.2, 1.4 and 1.6 µm it changes.', 'The shift is 10.4 arcseconds over 182.5 day.', 'Position is 14 degrees.', 'The signal is 3.4 standard deviations.', 'There are 4 visits.'];
        const bad = ['There are 3 visits.', 'At 1.2 and 8 µm it changes.', 'Position is 8 degrees.', 'There are 8 visits.', 'It is 6-light-year distant.', 'It is 8-km away.', 'It is 8-Mjup.', 'It is 8-Rsun.', 'It is 8-Lsun.', 'It is 8 masses.'];
        for (const sentence of good) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(0); }
        for (const sentence of bad) { expect(checkNote(`${sentence} Safe sentence. Another safe sentence.`, sheet).dropped, sentence).toBe(1); }
    });
    it('returns the one-minute retry for the local brake in both handlers', async () => {
        const local = { ...memoryStore(), hit: async () => 121 };
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', local, now: () => 0, complete });
        for (const response of [await handler.GET(new Request('https://example.test', { headers: right })), await handler.POST(request({ facts }, right))]) {
            expect(response.status).toBe(429);
            expect(response.headers.get('retry-after')).toBe('60');
            expect(await response.json()).toEqual({ error: 'busy' });
        }
    });
});
describe('round two regressions', () => {
    it('rejects unsupported number forms and preserves listed quantities', () => {
        const bad = ['½', 'Ⅻ', '①', '²', '5e3', '3/4', '2-5', '3rd', 'halved', 'doubling', 'quadrupled', 'threefold', 'hundreds', 'quarter', 'zero', '6 light years'];
        for (const value of bad) {
            expect(checkNote(`Value ${value}. Safe sentence. Another safe sentence.`, ['Value 6.']).dropped, value).toBe(1);
        }
        expect(checkNote('Double-check the second visit. There are fewer than 3 visits. SPHEREx has 6 detectors. The scatter is 1.2 percent.', ['Scatter: 1.2, 1.8, 2.5 percent.']).dropped).toBe(0);
        expect(SYSTEM_PROMPT).not.toContain('about every 6 months');
        expect(SYSTEM_PROMPT).toContain('fewer than 3 visits');
        expect(SYSTEM_PROMPT).toContain('Write every number in digits');
        expect(SYSTEM_PROMPT).not.toMatch(/\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|dozen|half|halve|twice|double|triple|quadruple|quarter|\w+-fold)\b/i);
        expect(SYSTEM_PROMPT).toContain('exactly 3 short paragraphs');
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
        const replies = await Promise.all(Array.from({ length: 130 }, () => handler.POST(request({ facts }, { 'x-insight-passcode': 'wrong' }))));
        expect(replies.filter((r) => r.status === 401)).toHaveLength(30);
        expect(replies.filter((r) => r.status === 429)).toHaveLength(100);
        expect(hit).not.toHaveBeenCalled();
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
        expect(store.size()).toBeLessThanOrEqual(20002);
        await store.hit('try:new', 900000, 900000);
        expect(store.size()).toBeLessThan(10);
    });
    it('uses a keyed address and supports complete or absent store configuration', async () => {
        expect(await pickStore({}).hit('key', 1000, 0)).toBe(1);
        expect(pickStore({ UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 'token' })).toBeDefined();
        const keys: string[] = [];
        for (const apiKey of ['key-a', 'key-b']) {
            const local = memoryStore();
            const hit = vi.spyOn(local, 'hit').mockImplementation(async (key) => { keys.push(key); return 1; });
            const handler = createHandlers({ apiKey, model: 'fake', passcode: 'secret', local, now: () => 0, complete: vi.fn() });
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
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 18000000, passcode: 'secret', maxPerHour: 21, maxPerDay: 21, store });
        const replies = await Promise.all(Array.from({ length: 300 }, (_, i) => handler.POST(request({ facts: { ...facts, ra: i / 10 } }, { 'x-real-ip': 'parallel-right', 'x-insight-passcode': 'secret' }))));
        expect(replies.filter((r) => r.status === 200).length).toBeLessThanOrEqual(20);
        expect(complete.mock.calls.length).toBeLessThanOrEqual(20);
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
        ['user-minute:', 21, false], ['user-day:', 21, true], ['global-hour', 121, false], ['global-day', 301, true],
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
    it('groups IPv6 by /56 and IPv4 mapped addresses by IPv4', async () => {
        expect(networkAddress('2001:db8:1:1201::1')).toBe('2001:db8:1:1200/56');
        expect(networkAddress('2001:db8:1:12ff::2')).toBe(networkAddress('2001:db8:1:1201::1'));
        expect(networkAddress('2001:db8:1:1300::1')).not.toBe(networkAddress('2001:db8:1:1201::1'));
        expect(networkAddress('::ffff:1.2.3.4')).toBe('1.2.3.4');
        expect(networkAddress('not::an::address')).toBe('not::an::address');
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }), now: () => 0, maxPerUserDay: 1 });
        const send = (ip: string, ra: number) => handler.POST(request({ facts: { ...facts, ra } }, { 'x-real-ip': ip }));
        expect((await send('2001:db8:1:1201:aaaa::1', 83)).status).toBe(200);
        expect((await send('2001:db8:1:12ff:bbbb::9', 84)).status).toBe(429);
        expect((await send('2001:db8:1:1300::1', 85)).status).toBe(200);
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
        const locked = await handler.POST(request({ facts }, { ...headers, 'x-insight-passcode': 'wrong' }));
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
        expect((await handler.GET(new Request('https://example.test', { headers }))).status).toBe(200);
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
        expect(checkNote('The star dimmed by 10 percent. No one frame stands out. Helium is at 1.083 micron.', ['Largest change: 10 percent.'])).toEqual({ text: 'The star dimmed by 10 percent. No one frame stands out. Helium is at 1.083 micron.', dropped: 0 });
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
        expect(factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, refScatter: [] } })).toContain('Reference stars: scatter unavailable.');
        const zero = factSheet({ ...facts, lightCurve: { ...facts.lightCurve!, points: [{ mjd: 61000, relative: 0, snr: 1 }] } });
        expect(zero.some((line) => line.startsWith('Largest change'))).toBe(false);
    });
    it('removes unverified sentences and requires two survivors', () => {
        expect(checkNote(note, lines)).toEqual({ text: note, dropped: 0 });
        expect(checkNote('Label: Value 0.85 is real. Invented 9999. Discovery happened. More follows.', ['Value: 0.85.'])).toEqual({ text: 'Label: Value 0.85 is real. More follows.', dropped: 2 });
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
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => now, maxPerUserDay: 40 });
        for (let i = 0; i < 20; i++) { expect((await handler.POST(request({ facts: { ...facts, ra: 100 + i } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200); }
        const limited = await handler.POST(request({ facts: { ...facts, ra: 120 } }, { 'x-forwarded-for': 'limit-test' }));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBeTruthy();
        now += 61000;
        expect((await handler.POST(request({ facts: { ...facts, ra: 120 } }, { 'x-forwarded-for': 'limit-test' }))).status).toBe(200);
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

// Sentences a second reviewer (Grok 4.7) got past round 3. Each must fail without the rule that now drops it.
describe('checkNote: names and words used as numbers', () => {
    const pad = 'Safe sentence. Another safe sentence.';
    const barnard = ["Target: Barnard's Star.", 'Position: RA 269.4521 deg, Dec 4.6934 deg.', 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const wise = factSheet({ targetId: 'wise0855', ra: 133.7953, dec: -7.2451, lambdaUm: 4.67, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }, { mjd: 61180, frames: 5 }], motion: { arcsec: 4.1, days: 180 }, snapshot: false });
    function dropped(sentence: string, sheet: string[]): number { return checkNote(`${sentence} ${pad}`, sheet).dropped; }

    it.each([
        'It moved WISE J085510.83 arcsec.', 'The change is WISE J085510.83 percent.', 'It shifted WISE 0855 arcsec.', 'The shift is J085510.83 arcsec.',
        'It moved 0855 arcsec.', 'It shifted 4.1 arcsec over 0855 days.', 'It differs by 2MASS sigma.', 'The excess is W2 percent.', 'It differs by DR3 days.',
        'The rise is WISE J085510.83-fold.', 'The gap is DR2 months.',
    ])('drops a name or catalogue token standing in for a number: %s', (sentence) => {
        expect(dropped(sentence, wise)).toBe(1);
    });
    it.each([
        'WISE J085510.83-071442.5 shifted 4.1 arcsec over 180.0 days.', 'WISE 0855-0714 is a cold brown dwarf.', 'J085510.83-071442.5 is faint here.',
        'WISE J0855-0714 was seen in 3 visits.', 'WISE 0855 is known to be very cold.', 'Check Gaia DR2 for the same star.', 'Gaia DR3 lists no star here.',
        'The W2 band of WISE is close to 4.67 micron.', 'Water, CO2 and CH4 absorb in this range.',
    ])('keeps a name used as a name: %s', (sentence) => {
        expect(dropped(sentence, wise)).toBe(0);
    });
    it.each([
        'It fell by a third between visits.', 'It fell by a third over 182.5 days.', 'It is a sixth as bright.', 'It dimmed by a seventh.', 'It lost one eighth of its light.',
        'It rose by two ninths.', 'The motion is 10.4 mas.', 'The motion is 10.4 arcmin.', 'The span is 182.5 hours.', 'The span is 16 months.', 'There are 5 frames at 4.270 micron.',
    ])('drops a fraction in words or a unit the sheet never uses: %s', (sentence) => {
        expect(dropped(sentence, barnard)).toBe(1);
    });
    it.each(['In the third visit it was brighter.', 'A third visit shows it brighter again.', "Barnard's Star shifted 10.4 arcsec over 182.5 days."])('keeps: %s', (sentence) => {
        expect(dropped(sentence, barnard)).toBe(0);
    });
});

describe('checkNote: round five', () => {
    const sheet = ["Target: Barnard's Star.", 'Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16. Time from first to last visit: 182.5 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Reference stars: 3.', 'Frames left out because their wavelength did not match: 3.', 'Difference image at the target: 1 sigma, brighter.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        "Barnard's Star moves about 10.4 arcsec in a year.", 'It shifts 10.4 arcsec annually.', 'That is 10.4 arcsec per annum.',
        'The brightening began 6 months before the first visit.', 'The visits were 3 weeks apart.',
        'At this signal-to-noise the error is a couple of percent.', 'It moved a few arcsec.', 'The scatter is several sigma.', 'The span is a handful of days.', 'Some microns are brighter.', 'Many degrees separate them.', 'Dozens of standard deviations were measured.',
        'It moved one arcsec.', 'The brightness changed one percent.', 'The wavelength is one micron.', 'The position is one degree.', 'The span is one day.',
        'It is the fourth-closest star to the Sun.', 'It is the second brightest star.', 'It changed by a hundredth.', 'It changed by two ten-thousandths.',
        'See <b>this</b> result.', 'See https://example.test for details.', 'See www.example.test for details.',
        'It is an M4 red dwarf.', 'It is a T8 object.', 'It is an L5.5 dwarf.', 'It is an M4V star.',
        'The star was observed in 12 visits.', 'There were 16 visits in all.', 'Only 3 frames passed the wavelength match.', 'The star appears in only 3 frames.',
        'The fourth visit was brighter.', 'SPHEREx has 102 detectors.',
    ])('drops %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'A rise from 0.97 to 1.12 is the main change.',
        'The visits held 14, 12 and 16 frames per visit.', 'A fourth visit would show whether the brightening holds.',
        'SPHEREx sees 102 colours, so try another wavelength.', 'SPHEREx has 6 detectors.',
        'The difference image shows one sigma.', 'The difference image shows one standard deviation.',
        'One can see the star.', 'No one knows.', 'One of the visits is brighter.',
        '3 frames were left out.',
    ])('keeps %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(0);
    });
    it.each([
        ['The difference image shows one sigma.', 'Difference image: 1 sigma.'],
        ['The difference image shows one standard deviation.', 'Difference image: 1 sigma.'],
        ['The change is one percent.', 'Largest change: 1 percent.'],
        ['The shift is one arcsec.', 'Shift in position: 1 arcsec.'],
        ['The wavelength is one micron.', 'Wavelength: 1 micron.'],
        ['The position is one degree.', 'Position: 1 deg.'],
        ['The shift spans one day.', 'Shift in position: 1 days.'],
    ])('checks one against the matching fact: %s', (sentence, line) => {
        expect(checkNote(`${sentence} ${pad}`, [line]).dropped).toBe(0);
        expect(checkNote(`${sentence} ${pad}`, []).dropped).toBe(1);
    });
    it('allows a spectral token belonging to the target name', () => {
        expect(checkNote(`M4V is the target. ${pad}`, ['Target: M4V.']).dropped).toBe(0);
    });
    it.each([
        [{ VERCEL_ENV: 'production' }, true],
        [{ VERCEL_ENV: 'preview', UPSTASH_REDIS_REST_URL: 'url' }, true],
        [{ VERCEL_ENV: 'preview', KV_REST_API_URL: 'url', KV_REST_API_TOKEN: 'token' }, false],
        [{ VERCEL_ENV: 'development' }, false],
    ])('checks shared store configuration %j', (env, missing) => {
        expect(storeMissing(env)).toBe(missing);
    });
    it('turns both handlers off before accessing any store', async () => {
        const store = { hit: vi.fn(), count: vi.fn(), refund: vi.fn() } as unknown as LimitStore;
        const complete = vi.fn();
        const handler = createHandlers({ apiKey: 'key', model: 'fake', complete, now: () => 0, passcode: 'secret', store, local: store, storeMissing: true });
        expect(await (await handler.GET(new Request('https://example.test', { headers: { 'x-insight-passcode': 'secret' } }))).json()).toEqual({ enabled: false, locked: false, unlocked: false, model: 'fake' });
        const response = await handler.POST(request({ facts }, { 'x-insight-passcode': 'secret' }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'off' });
        expect(store.hit).not.toHaveBeenCalled(); expect(store.count).not.toHaveBeenCalled(); expect(store.refund).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    });
    it('limits uncached correct requests per minute', async () => {
        let now = 120000;
        const handler = createHandlers({ apiKey: 'key', model: 'fake', passcode: 'secret', now: () => now, maxPerUserDay: 40, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
        const send = (ra: number) => handler.POST(request({ facts: { ...facts, ra } }, { 'x-real-ip': 'round-five-minute', 'x-insight-passcode': 'secret' }));
        for (let i = 0; i < 20; i++) { expect((await send(200 + i)).status).toBe(200); }
        const limited = await send(220);
        expect(limited.status).toBe(429); expect(limited.headers.get('Retry-After')).toBeTruthy();
        now += 60000;
        expect((await send(220)).status).toBe(200);
    });
});

describe('checkNote: round six', () => {
    const sheet = ['Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Difference image at the target: 3.4 sigma.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        'It moves 10.4 arcsec per yr.', 'It moves 10.4 arcsec a yr.', 'The difference is a one-sigma bump.',
        'The reference stars are steady to about a percent.', 'It shifted about an arcsecond more than predicted.',
        'The star shows up in 3 of its frames.', 'A fourth visit showed it brighter.', 'It is a K0III giant.',
        'The error is a couple of per cent.',
    ])('drops unsupported: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'The frames were taken in the 4.270 micron band.', 'Water ice absorbs near the 3.05 micron band.',
        'The 4.270 micron images show the star.', 'A 3.4 sigma point at the target is brighter in the later visit.',
        'SPHEREx has 102 spectral channels.',
        'The second-brightest reading was 1.00.', 'There are fewer than 3 visits.', 'There are fewer than three visits.',
        'A fourth visit might show it brighter.',
    ])('keeps supported: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(0);
    });
    it('checks rank against the readings and requires a future cue for visits', () => {
        for (const sentence of ['The second-brightest reading was 0.97.', 'The fourth-brightest reading was 1.00.', 'A fourth visit showed it brighter.']) {
            expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
        }
        expect(checkNote(`The difference is a one-sigma bump. ${pad}`, ['Difference image: 1 sigma.']).dropped).toBe(0);
        expect(checkNote(`The shift is an arcsecond. ${pad}`, ['Shift in position: 1 arcsec.']).dropped).toBe(0);
        expect(checkNote(`The change is a percent. ${pad}`, ['Largest change: 1 percent.']).dropped).toBe(0);
    });
    it('does not use a visit count as a frame count through a possessive', () => {
        expect(checkNote(`The visit shows the star in 3 of its frames. ${pad}`, ['Visits: 3.']).dropped).toBe(1);
    });
    it.each([
        [{ VERCEL: '1' }, true], [{ VERCEL: '1', VERCEL_ENV: 'development' }, false],
        [{ VERCEL: '1', KV_REST_API_URL: 'url', KV_REST_API_TOKEN: 'token' }, false], [{}, false],
    ])('detects missing store on Vercel: %j', (env, missing) => {
        expect(storeMissing(env)).toBe(missing);
    });
});

describe('checkNote: round seven', () => {
    const sheet = ['Wavelength: 4.270 micron.', 'Visits: 3. Frames in each visit: 14, 12, 16.', 'Brightness relative to the reference stars, in time order: 1.00, 0.97, 1.12.', 'Largest change from the median brightness: 12 percent above it.', 'Reference stars: 3.', 'Frames left out: 3.', 'Difference image at the target: 3.4 sigma.', 'Shift in position: 10.4 arcsec over 182.5 days.'];
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        'The visits span about a year.', 'RW Aur faded by about a magnitude.', 'RW Aur fades by a full magnitude in its dimming events.',
        'The visits were a few months apart.', 'The 12 percent rise came a fortnight after the first visit.',
        'eps Indi B shifted 10.4 arcsec over 182.5 days, a week shorter than expected.',
        'Between the visits, 3 full months passed.', 'The 3 visits span decades.', 'The frames were taken minutes apart.',
        'It dims every few hours.', 'The visits were in october.',
    ])('drops a time unit other than days, or a magnitude: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        'The fourth visit was brighter, which could mean a flare.', 'Later on, the star faded and the fourth visit was brighter.',
        'Across the frames, the star was seen in 12 high-cadence visits.', 'The frames were compared with 12 references.',
        'The frames use 16 comparisons.', 'The upper limit is 12 percent.', 'The error is 12 percent upon inspection.',
    ])('drops a number beside the wrong word: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        '3 of the frames were left out.',
        'A later fourth visit could test it.', 'A fourth visit would show whether the brightening holds.',
        'It would help if a fourth visit were taken.', 'One more visit would help.',
        'There are 3 reference stars.', 'Each of the 3 visits has 14, 12 and 16 frames.', 'The shift may be real.',
    ])('keeps: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(0);
    });
    it('drops the former candidate paraphrase under the closed median form', () => {
        expect(checkNote(`With a degree of caution, call it a candidate change from the median of 12 percent. ${pad}`, sheet).dropped).toBe(1);
    });
    it.each(["The star's light went up by 12 percent.", 'The brightness was 12 per cent higher.', 'In one visit the star was 12 percent brighter.', 'The brightness went up by 12 percent.', 'The star is 12 percent brighter in the third visit.'])('drops a median distance described as a time change: %s', (sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
});

describe('checkNote: median distance', () => {
    const makeSheet = (values: number[]) => factSheet({ ...facts, lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })), refScatter: [0.012, 0.02], dropped: 0 } });
    const flat = makeSheet([1, 1.004, 1]);
    const above = makeSheet([1.3, 1, 1]);
    const below = makeSheet([1, 1, 0.77]);
    const either = makeSheet([0.81, 1, 1.19]);
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        [flat, 'The reference star scatter is below 1 percent.'],
        [flat, 'The noise is below 1 percent.'],
        [flat, 'Each frame is accurate to below 1 percent.'],
        [above, 'The reference stars scatter 30 percent above normal.'],
        [flat, 'The comparison scatter is below 1 percent.'],
        [above, 'The noise is 30 percent above normal.'],
        [above, 'The star got 30 percent brighter.'],
        [above, 'The largest change from the median brightness is 30 percent below it.'],
        [above, 'The star faded by 30 percent.'],
        [below, 'It is 23 percent above the median at its largest.'],
        [either, 'The largest change from the median is 19 percent above it.'],
        [flat, 'The largest change from the median is below 1 percent.'],
    ])('drops unsupported %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        [above, 'The largest change from the median brightness is 30 percent above it.'],
        [below, 'The largest change from the median is 23 percent below it.'],
        [either, 'The largest change from the median is 19 percent either side.'],
        [flat, 'The largest change from the median brightness is less than 1 percent.'],
        [above, 'The brightness went from 1.30 to 1.00.'],
    ])('keeps supported %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).text).toBe(`${sentence} ${pad}`);
    });
    it.each(['got', 'became', 'grew', 'rose', 'rise', 'rising', 'risen', 'climbed', 'increased', 'brightened', 'gained', 'fell', 'fall', 'falling', 'dropped', 'faded', 'fading', 'dimmed', 'decreased', 'declined', 'lost', 'went'])('drops a median distance with the time word %s', (word) => {
        expect(checkNote(`The median brightness ${word} by 30 percent. ${pad}`, above).dropped).toBe(1);
    });
    it('does not apply the median rule to a number supported by another sheet line', () => {
        const shared = [...above, 'Scatter of each: 30 percent.'];
        const sentence = 'The reference scatter is 30 percent.';
        expect(checkNote(`${sentence} ${pad}`, shared).text).toBe(`${sentence} ${pad}`);
    });
});

describe('checkNote: round eight', () => {
    const makeSheet = (values: number[], refScatter = [0.012, 0.02]) => factSheet({ ...facts, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61182.5, frames: 4 }], lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i, relative, snr: 10 })), refScatter, dropped: 0 } });
    const above = makeSheet([1.3, 1, 1]);
    const below = makeSheet([0.77, 1, 1]);
    const dip = makeSheet([1, 0.7, 1]);
    const either = makeSheet([0.81, 1, 1.19]);
    const flat = makeSheet([1, 1.004, 1]);
    const pad = 'Safe sentence. Another safe sentence.';
    it.each([
        [above, 'The brightness in the third visit is 30 percent above the median.'],
        [above, 'The brightness surged 30 percent above the median.'],
        [above, 'The brightness is now 30 percent above the median.'],
        [above, 'The star jumped 30 percent above the median.'],
        [above, 'The brightness dipped 30 percent from the median.'],
        [below, 'The brightness dims to 23 percent below the median.'],
        [dip, 'By the last visit the brightness was 30 percent below the median.'],
    ])('D1 drops time claim: %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it.each([
        [either, 'The reference stars sit 19 percent either side of the median.'],
        [above, 'The difference image shows the target 30 percent above the median.'],
        [flat, "The reference stars' brightness varies by less than 1 percent around the median."],
        [below, 'The noise is 23 percent below the median.'],
        [above, 'The reference stars scatter 30 percent above the median.'],
    ])('D2 drops another subject: %s %s', (sheet, sentence) => {
        expect(checkNote(`${sentence} ${pad}`, sheet).dropped).toBe(1);
    });
    it('D2 drops a distant reference to scatter under the closed form', () => {
        const sentence = 'The largest change from the median is 30 percent above it, far more than the 1.2 and 2.0 percent scatter of the reference stars.';
        expect(checkNote(`${sentence} ${pad}`, above).dropped).toBe(1);
    });
    it('D3 distinguishes elapsed time from direction', () => {
        const sentence = 'Over 182.5 days, the largest change from the median brightness is 23 percent below it.';
        expect(checkNote(`${sentence} ${pad}`, below).dropped).toBe(1);
        expect(checkNote(`It is 23 percent over the median at its largest. ${pad}`, below).dropped).toBe(1);
    });
    it('D4 does not use scatter to support a brightness change', () => {
        const shared = [...above, 'Scatter of each: 1.2, 30 percent.'];
        expect(checkNote(`Compared with the reference stars, the target faded by 30 percent. ${pad}`, shared).dropped).toBe(1);
        const sentence = 'The 2 reference stars scatter by 1.2 and 2.0 percent.';
        expect(checkNote(`${sentence} ${pad}`, above).text).toBe(`${sentence} ${pad}`);
    });
    it('C1 does not accept above normal as a largest-change context', () => {
        const sentence = 'The median is irrelevant to an unrelated reading which is 30 percent above normal.';
        expect(checkNote(`${sentence} ${pad}`, above).dropped).toBe(1);
    });
});

describe('checkNote: round nine closed forms', () => {
    const sheets = {
        above: ['Largest change from the median brightness: 1 percent above it.'],
        below: ['Largest change from the median brightness: 1 percent below it.'],
        either: ['Largest change from the median brightness: 1 percent either side.'],
        less: ['Largest change from the median brightness: less than 1 percent.'],
    };
    const pad = 'Safe sentence. Another safe sentence.';
    const check = (sentence: string, sheet: string[]) => checkNote(`${sentence} ${pad}`, sheet).dropped;
    const referents = ['it', 'the median', 'its median'];
    for (const start of ['The', 'Its']) {
        for (const possessive of ['the', 'its']) {
            for (const brightness of ['', ' brightness']) {
                for (const verb of ['is', 'was']) {
                    const prefix = `${start} largest change from ${possessive} median${brightness} ${verb}`;
                    for (const [direction, endings] of Object.entries({
                        above: referents.map((ref) => `1 percent above ${ref}`),
                        below: referents.map((ref) => `1 percent below ${ref}`),
                        either: ['1 percent either side', ...referents.map((ref) => `1 percent either side of ${ref}`)],
                        less: ['less than 1 percent', ...referents.map((ref) => `less than 1 percent from ${ref}`)],
                    })) {
                        for (const ending of endings) {
                            const sentence = `${prefix} ${ending}.`;
                            it(`matches only ${direction}: ${sentence}`, () => {
                                for (const [sheetDirection, sheet] of Object.entries(sheets)) {
                                    expect(check(sentence, sheet), sheetDirection).toBe(sheetDirection === direction ? 0 : 1);
                                }
                            });
                        }
                    }
                }
            }
        }
    }
    it('accepts case, whitespace and an omitted final full stop', () => {
        expect(checkNote(`  ITS LARGEST CHANGE FROM ITS MEDIAN WAS 1 PERCENT ABOVE IT  \n${pad}`, sheets.above).dropped).toBe(0);
    });
    it('rejects a different printed number and noncanonical number spelling', () => {
        for (const number of ['2', '01', '1.0']) {
            expect(check(`The largest change from the median is ${number} percent above it.`, sheets.above), number).toBe(1);
        }
    });
    it('rejects leading, trailing, subject and joined clauses', () => {
        for (const sentence of [
            'For this target, the largest change from the median brightness is 1 percent above the median.',
            'The largest change from the median brightness is 1 percent above the median, far more than the scatter.',
            "The sky background's largest change from the median brightness is 1 percent above the median.",
            'The largest change from the median is 1 percent above it and the largest change from the median is 1 percent above it.',
        ]) { expect(check(sentence, sheets.above), sentence).toBe(1); }
    });
    it('does not restrict independently supported frame and signal-to-noise numbers', () => {
        const shared = [...sheets.above, 'Visits: 2. Frames in each visit: 30, 31.', 'Lowest signal-to-noise among the points: 30.'];
        for (const sentence of ['The first visit had 30 frames.', 'The signal-to-noise is 30.']) {
            expect(check(sentence, shared), sentence).toBe(0);
        }
    });
    const scatter = ['Reference stars: 2 with available scatter. Scatter of each: 1.2, 2.0, 30 percent.'];
    it('accepts reference scatter sentences and stationary verbs', () => {
        for (const sentence of ['The 2 reference stars scatter by 1.2 and 2.0 percent.', 'The reference stars have a scatter of 1.2 and 2.0 percent.', 'The 2 reference stars remain steady with a scatter of 1.2 and 2.0 percent.']) {
            expect(check(sentence, scatter), sentence).toBe(0);
        }
    });
    it('requires both scatter and reference across the whole sentence', () => {
        for (const sentence of ['The reference stars have 2.0 percent.', 'The scatter is 2.0 percent.', 'The target and reference stars scatter by 2.0 percent.']) {
            expect(check(sentence, scatter), sentence).toBe(1);
        }
    });
    it('rejects every scatter bound immediately before the number', () => {
        for (const bound of ['below', 'under', 'above', 'over', 'less than', 'more than', 'at least', 'at most', 'up to']) {
            expect(check(`The reference star scatter is ${bound} 2.0 percent.`, scatter), bound).toBe(1);
        }
    });
    it('rejects scatter change and comparison terms anywhere in the sentence', () => {
        for (const word of ['faded', 'brighter', 'fainter', 'dimmer', 'higher', 'lower', 'changed', 'varied', 'fluctuated', 'peaked', 'differed', 'now']) {
            expect(check(`The reference stars scatter by 2.0 percent and ${word}.`, scatter), word).toBe(1);
        }
    });
    it('rejects reviewer scatter claims even when the verb is outside the word window', () => {
        for (const sentence of ['The reference star scatter is below 2.0 percent.', 'Compared with the reference stars, the target is 30 percent brighter.', 'Compared with the reference stars, the target is 30 percent fainter.', 'Compared with the reference stars, the target changed by 30 percent.', 'Compared with the reference stars, the target varied by 30 percent.', 'The target faded when measured against the steady reference stars by 30 percent.', 'Compared with the reference stars, the target by 30 percent in brightness faded.', 'Compared with the reference stars, the target swelled by 2.0 percent.', 'The target faded, and against the reference stars that change came to 2.0 percent.', 'Against the reference stars, the target is 1.2 percent brighter now.']) {
            expect(check(sentence, scatter), sentence).toBe(1);
        }
    });
    it('rejects the reviewers’ quoted median claims and wrong directions', () => {
        const sheet = ['Largest change from the median brightness: 30 percent above it.'];
        for (const sentence of [
            'The brightness swelled to 30 percent above the median.', 'The brightness is down 30 percent from the median.',
            'The readings sit 30 percent either side of the median.', 'The minimum brightness is 30 percent less than the median.',
            'The largest change from the median brightness is 30 percent down from it.', 'The lowest brightness is 30 percent short of the median.',
            'The brightness is 30 percent under median.', 'The largest change from the median brightness is 30 percent in the reference stars.',
            'The largest change from the median brightness is 30 percent due to noise.', 'The largest change from the median brightness is 30 percent across the frames.',
            'Between epochs, the brightness varied by 30 percent from the median.', 'At the beginning, the brightness was 30 percent above the median.',
            'The brightness peaked at 30 percent above the median during the middle epoch.', 'The sky background brightness is 30 percent above the median.',
            "The sky background's largest change from the median brightness is 30 percent above the median.",
            'The uncertainty in brightness is 30 percent of the median.', 'A nearby companion star is 30 percent brighter than the median.',
            'The largest change from the median is 30 percent above it, far more than the 1.2 and 2.0 percent scatter of the reference stars.',
        ]) { expect(check(sentence, sheet), sentence).toBe(1); }
        expect(check('It exceeds the median by 23 percent.', ['Largest change from the median brightness: 23 percent below it.'])).toBe(1);
        expect(check('The brightness waned to 23 percent below the median.', ['Largest change from the median brightness: 23 percent below it.'])).toBe(1);
        expect(check('The sky background sits 19 percent either side of the median.', ['Largest change from the median brightness: 19 percent either side.'])).toBe(1);
    });
    it('keeps three prompt-shaped notes for rising, falling and flat sheets', () => {
        for (const [values, median] of [[[1, 1, 1.3], '30 percent above the median'], [[1.3, 1, 1], '30 percent above the median'], [[1, 1, 1], 'less than 1 percent from the median']] as const) {
            const sheet = factSheet({ ...facts, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }, { mjd: 61020, frames: 5 }], lightCurve: { points: values.map((relative, i) => ({ mjd: 61000 + i * 10, relative, snr: 10 })), refScatter: [0.012, 0.02], dropped: 0 } });
            const note = `Across 3 visits the brightness was ${values.map((n) => n.toFixed(2)).join(', ')}. The largest change from the median brightness is ${median}. The 2 reference stars scatter by 1.2 and 2.0 percent.`;
            expect(checkNote(note, sheet).dropped).toBeLessThanOrEqual(1);
        }
    });
});

import { describe, expect, it, vi } from 'vitest';
import { createHandlers } from '../api/insight';
import { checkNote, factSheet, fetchInsight, insightEnabled, validateFacts, type InsightFacts } from '../src/lib/insight';
import { TARGETS } from '../src/lib/targets';

const facts: InsightFacts = { targetId: 'custom', ra: 12.34567, dec: -38, lambdaUm: 4.27, visits: [{ mjd: 61000, frames: 3 }, { mjd: 61010, frames: 4 }], lightCurve: { points: [{ mjd: 61000, relative: 1, snr: 20 }, { mjd: 61010, relative: 0.8, snr: 10 }], refScatter: [0.02, 0.03], dropped: 2 }, difference: { peakSigma: -3.4 }, motion: { arcsec: 2.3, days: 10 }, snapshot: true };
const lines = ['Target: a position typed in by the visitor.', 'Position: RA 12.3457 deg, Dec -38.0000 deg.', 'Wavelength: 4.270 micron.', 'Visits: 2. Frames in each visit: 3, 4. Time from first to last visit: 10.0 days.', 'Brightness relative to the reference stars, in time order: 1.00, 0.80.', 'Largest change from the median brightness: 11 percent brighter.', 'Lowest signal-to-noise among the points: 10.', 'Reference stars: 2. Scatter of each: 2.0, 3.0 percent.', 'Frames left out because their wavelength did not match: 2.', 'Difference image at the target: 3.4 sigma, fainter in the later visit.', 'Shift in position: 2.3 arcsec over 10.0 days.', 'Frames came from: the baked snapshot.'];
const note = 'What this shows: The value is 4.27. It is at -38 degrees.\nHow far to trust it: More data helps.';
function request(value: unknown, headers: Record<string, string> = {}): Request
{
    return new Request('https://example.test/api/insight', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) });
}
describe('insight facts and guard', () => {
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
        expect(await response.json()).toEqual({ text: note, dropped: 0, model: 'fake' });
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
            const handler = createHandlers({ apiKey: 'key', model: 'fake', now: () => 5000000, complete: async () => ({ text: 'First sentence. Second sentence.', refused: false, model: 'fake' }) });
            const first = { ...facts, ra: 250 };
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-a' }))).status).toBe(200);
            expect((await handler.POST(request({ facts: first }, { 'x-forwarded-for': 'hourly-b' }))).status).toBe(200);
            const limited = await handler.POST(request({ facts: { ...facts, ra: 251 } }, { 'x-forwarded-for': 'hourly-b' }));
            expect(limited.status).toBe(429);
            expect(limited.headers.get('retry-after')).toBe('3600');
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

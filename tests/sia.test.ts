import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/sia/rwaur_dr1.xml?raw';
import { buildUpstreamUrl, GET, OPTIONS, parseParams } from '../api/sia';
import { rowToFrame } from '../src/lib/sia';

const valid = 'POS=CIRCLE+76.956+30.401+0.01';
const req = (query = valid) => new Request(`https://example.test/api/sia?${query}`);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('SIA proxy', () => {
    it('parses and reconstructs allowlisted parameters', () => {
        const parsed = parseParams(new URLSearchParams(`${valid}&COLLECTION=spherex_dr1&BAND=0.000001+0.000002&TIME=60001+60002&MAXREC=23`));
        const url = buildUpstreamUrl(parsed);
        expect(url.origin + url.pathname).toBe('https://irsa.ipac.caltech.edu/SIA');
        expect([...url.searchParams.entries()]).toEqual([['COLLECTION', 'spherex_dr1'], ['POS', 'CIRCLE 76.956 30.401 0.01'], ['BAND', '0.000001 0.000002'], ['TIME', '60001 60002'], ['MAXREC', '23'], ['RESPONSEFORMAT', 'VOTABLE']]);
        expect(parseParams(new URLSearchParams(valid)).collections).toHaveLength(4);
    });
    it.each(['', 'POS=CIRCLE+1+2+2', 'POS=CIRCLE+1+2+0.1&POS=CIRCLE+1+2+0.1', `${valid}&COLLECTION=spherex_qr2`, 'POS=CIRCLE+1+2+3&COLLECTION=spherex_qr2', `${valid}&OTHER=x`, `${valid}&BAND=NaN`, `${valid}&TIME=70001+70002`, `${valid}&MAXREC=1.5`])('rejects bad input %s', async (query) => {
        const response = await GET(req(query));
        expect(response.status).toBe(400);
        expect(await response.json()).toHaveProperty('error');
    });
    it('returns upstream XML with cache and CORS headers', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<VOTABLE/>'));
        const response = await GET(req());
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('<VOTABLE/>');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect(response.headers.get('cache-control')).toContain('s-maxage=3600');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(OPTIONS().status).toBe(204);
    });
    it('handles upstream errors and oversize bodies', async () => {
        const mock = vi.spyOn(globalThis, 'fetch');
        mock.mockResolvedValueOnce(new Response('', { status: 500 })).mockResolvedValueOnce(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
        expect((await GET(req())).status).toBe(502);
        expect((await GET(req())).status).toBe(502);
    });
    it('times out upstream', async () => {
        vi.useFakeTimers();
        vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        const pending = GET(req());
        await vi.advanceTimersByTimeAsync(25000);
        expect((await pending).status).toBe(504);
    });
});

describe('SIA rows', () => {
    it('maps real fixture columns and refuses unsafe rows', () => {
        const xml = fixture;
        const names = [...xml.matchAll(/<[^>]*FIELD\b[^>]*name="([^"]+)"/g)].map((match) => match[1]);
        const first = xml.match(/<[^>]*TR>([\s\S]*?)<\/[^>]*TR>/)?.[1] ?? '';
        const cells = [...first.matchAll(/<[^>]*TD\s*\/>|<[^>]*TD>([\s\S]*?)<\/[^>]*TD>/g)].map((match) => match[1] ?? '');
        const row = Object.fromEntries(names.map((name, index) => [name, cells[index] ?? '']));
        const frame = rowToFrame(row);
        expect(frame).toMatchObject({ collection: 'spherex_dr1', release: 'dr1', detector: 1, lambdaMin: 0.7455, tMin: 60919.419647 });
        expect(frame?.url).toContain('irsa.ipac.caltech.edu');
        expect(rowToFrame({ ...row, obs_collection: 'spherex_qr2' })).toBeNull();
        expect(rowToFrame({ ...row, access_url: 'https://evil.test/file' })).toBeNull();
        expect(rowToFrame({ ...row, access_url: 'http://irsa.ipac.caltech.edu/file' })).toBeNull();
    });
    it.todo('searches and parses, filters, deduplicates and sorts frames');
});

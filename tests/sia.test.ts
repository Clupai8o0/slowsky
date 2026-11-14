import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/sia/rwaur_dr1.xml?raw';
import { buildUpstreamUrl, GET, OPTIONS, parseParams } from '../api/sia';
import { parseSiaXml, queryStatus, rowToFrame, searchFrames } from '../src/lib/sia';

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
    it.each(['HTTP error', 'declared size', 'streamed size'])('cancels and aborts an upstream rejected for %s', async reason => {
        const cancel = vi.fn();
        const body = new ReadableStream<Uint8Array>({
            start(controller)
            {
                controller.enqueue(new Uint8Array(reason === 'streamed size' ? 8 * 1024 * 1024 + 1 : 1));
            },
            cancel,
        });
        const upstream = new Response(body, {
            status: reason === 'HTTP error' ? 500 : 200,
            headers: reason === 'declared size' ? { 'Content-Length': String(8 * 1024 * 1024 + 1) } : {},
        });
        let signal: AbortSignal | null | undefined;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
            signal = init?.signal;
            return upstream;
        });
        expect((await GET(req())).status).toBe(502);
        expect(cancel).toHaveBeenCalledOnce();
        expect(signal?.aborted).toBe(true);
    });
    it('aborts when cancelling a rejected upstream body fails', async () => {
        const cancel = vi.fn(async () => { throw new Error('Cannot cancel'); });
        const upstream = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 500 });
        let signal: AbortSignal | null | undefined;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
            signal = init?.signal;
            return upstream;
        });
        const response = await GET(req());
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'Invalid upstream response' });
        expect(cancel).toHaveBeenCalledOnce();
        expect(signal?.aborted).toBe(true);
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
        expect(frame?.url).toMatch(/^https:\/\/nasa-irsa-spherex\.s3\.us-east-1\.amazonaws\.com\/.+\.fits$/);
        expect(frame?.obsId).toBe(`${row.obs_id}D1`);
        expect(frame?.irsaUrl).toBe(row.access_url);
        expect(frame?.estSizeBytes).toBe(Number(row.access_estsize) * 1024);
        expect(rowToFrame({ ...row, obs_collection: 'spherex_qr2' })).toBeNull();
        const aws = (bucket: string, key: string, region = 'us-east-1') => JSON.stringify({ aws: { bucket_name: bucket, key, region } });
        expect(rowToFrame({ ...row, cloud_access: aws('evil', 'a.fits') })).toBeNull();
        expect(rowToFrame({ ...row, cloud_access: aws('nasa-irsa-spherex', 'a.txt') })).toBeNull();
        expect(rowToFrame({ ...row, cloud_access: aws('nasa-irsa-spherex', 'a/../b.fits') })).toBeNull();
        expect(rowToFrame({ ...row, cloud_access: aws('nasa-irsa-spherex', 'a.fits', 'eu-west-1') })).toBeNull();
        expect(rowToFrame({ ...row, cloud_access: '' })).toBeNull();
        expect(rowToFrame({ ...row, cloud_access: 'not json' })).toBeNull();
    });
    const mockFetch = () => vi.fn(async () => new Response(fixture)) as unknown as typeof fetch;
    const q = { center: { ra: 76.956, dec: 30.401 }, radiusDeg: 0.01 };
    it('searches, keeps all detectors, filters, de-duplicates and sorts', async () => {
        const rows = parseSiaXml(fixture).map(rowToFrame).filter((f) => f !== null);
        const fetcher = mockFetch();
        const frames = await searchFrames(q, undefined, fetcher);
        expect(fetch).not.toBe(fetcher);
        expect(frames.length).toBe(new Set(rows.map((f) => f.obsId)).size);
        expect(new Set(frames.map((f) => f.obsId)).size).toBe(frames.length);
        expect(frames.map((f) => f.tMin)).toEqual([...frames.map((f) => f.tMin)].sort((a, b) => a - b));
        expect(vi.mocked(fetcher).mock.calls[0]![0]).toMatch(/^\/api\/sia\?POS=CIRCLE/);
        const d = frames[0]!.detector;
        const only = await searchFrames({ ...q, detector: d }, undefined, mockFetch());
        expect(only.length).toBeGreaterThan(0);
        expect(only.every((f) => f.detector === d)).toBe(true);
        expect(new Set(frames.map((f) => f.detector)).size).toBeGreaterThan(1);
        const trs = fixture.match(/<[^>]*TR>[\s\S]*?<\/[^>]*TR>/g) ?? [];
        expect(trs.length).toBeGreaterThan(0);
        const dup = fixture.replace(trs[trs.length - 1]!, trs[trs.length - 1]! + trs.join(''));
        expect(parseSiaXml(dup).length).toBe(parseSiaXml(fixture).length * 2);
        const deduped = await searchFrames(q, undefined, vi.fn(async () => new Response(dup)) as unknown as typeof fetch);
        expect(deduped.length).toBe(frames.length);
    });
    it('sends MAXREC and surfaces QUERY_STATUS ERROR and OVERFLOW', async () => {
        const fetcher = mockFetch();
        await searchFrames(q, undefined, fetcher);
        expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toContain('MAXREC=2000');
        for (const status of ['OVERFLOW', 'ERROR']) {
            const xml = fixture.replace(/<(\w*:?)RESOURCE\b([^>]*)>/, `<$1RESOURCE$2><$1INFO name="QUERY_STATUS" value="${status}"/>`);
            expect(queryStatus(xml)?.status).toBe(status);
            await expect(searchFrames(q, undefined, vi.fn(async () => new Response(xml)) as unknown as typeof fetch)).rejects.toThrow(status);
        }
        expect(queryStatus(fixture)?.status).not.toMatch(/ERROR|OVERFLOW/);
    });
    it('rejects a trailing QUERY_STATUS OVERFLOW after an OK fixture', async () => {
        const xml = fixture.replace('</ns0:TABLE>', '</ns0:TABLE><INFO name="QUERY_STATUS" value="OVERFLOW"/>');
        expect(queryStatus(xml)?.status).toBe('OVERFLOW');
        const fetcher: typeof fetch = async () => new Response(xml);
        await expect(searchFrames(q, undefined, fetcher)).rejects.toThrow('QUERY_STATUS=OVERFLOW');
    });
    it.each([
        ['OK', 'OVERFLOW', 'ERROR'],
        ['OK', 'ERROR', 'OVERFLOW'],
    ])('gives ERROR priority for QUERY_STATUS sequence %s, %s, %s', (...statuses) => {
        const xml = statuses.map(status => `<INFO name="QUERY_STATUS" value="${status}"/>`).join('');
        expect(queryStatus(xml)?.status).toBe('ERROR');
    });
    it('keeps rows sharing an obs_id but differing in detector', () => {
        const row = parseSiaXml(fixture)[0]!;
        const a = rowToFrame({ ...row, energy_bandpassname: 'SPHEREx-D1' });
        const b = rowToFrame({ ...row, energy_bandpassname: 'SPHEREx-D2' });
        expect(a?.obsId).not.toBe(b?.obsId);
    });
    it('throws on a failed search', async () => {
        await expect(searchFrames(q, undefined, vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch)).rejects.toThrow();
    });
});

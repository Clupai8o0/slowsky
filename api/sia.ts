const COLLECTIONS = ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'];
const LIMIT = 8 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff' };

export interface SiaParams {
    collections: string[];
    pos: [number, number, number];
    band?: number[];
    time?: number[];
    maxrec: number;
}

function numbers(value: string, minCount: number, maxCount: number, min: number, max: number): number[]
{
    const parts = value.trim().split(/\s+/);
    if (parts.length < minCount || parts.length > maxCount || parts.some((part) => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(part))) {
        throw new Error('Invalid numeric parameter');
    }
    const result = parts.map(Number);
    if (result.some((n) => !Number.isFinite(n) || n < min || n > max) || (result.length === 2 && result[0]! > result[1]!)) {
        throw new Error('Numeric parameter out of range');
    }
    return result;
}

export function parseParams(query: URLSearchParams): SiaParams
{
    for (const key of query.keys()) {
        if (!['COLLECTION', 'POS', 'BAND', 'TIME', 'MAXREC'].includes(key)) {
            throw new Error('Unknown parameter');
        }
    }
    for (const key of ['POS', 'BAND', 'TIME', 'MAXREC']) {
        if (query.getAll(key).length > 1) {
            throw new Error(`Repeated ${key}`);
        }
    }
    const collections = query.getAll('COLLECTION');
    if (collections.length > 4 || collections.some((c) => !COLLECTIONS.includes(c))) {
        throw new Error('Invalid collection');
    }
    const match = query.get('POS')?.trim().match(/^CIRCLE\s+(\S+)\s+(\S+)\s+(\S+)$/);
    if (!match) {
        throw new Error('Invalid POS');
    }
    const ra = numbers(match[1]!, 1, 1, 0, 360)[0]!;
    const dec = numbers(match[2]!, 1, 1, -90, 90)[0]!;
    const radius = numbers(match[3]!, 1, 1, 0, 1)[0]!;
    if (radius === 0) {
        throw new Error('Invalid radius');
    }
    const band = query.has('BAND') ? numbers(query.get('BAND')!, 1, 2, 0.5e-6, 6e-6) : undefined;
    const time = query.has('TIME') ? numbers(query.get('TIME')!, 2, 2, 60000, 70000) : undefined;
    const maxrec = query.has('MAXREC') ? numbers(query.get('MAXREC')!, 1, 1, 1, 2000)[0]! : 1000;
    if (!Number.isInteger(maxrec)) {
        throw new Error('Invalid MAXREC');
    }
    return { collections: collections.length ? collections : [...COLLECTIONS], pos: [ra, dec, radius], band, time, maxrec };
}

export function buildUpstreamUrl(params: SiaParams): URL
{
    const url = new URL('https://irsa.ipac.caltech.edu/SIA');
    for (const collection of params.collections) {
        url.searchParams.append('COLLECTION', collection);
    }
    url.searchParams.set('POS', `CIRCLE ${params.pos.join(' ')}`);
    if (params.band) {
        url.searchParams.set('BAND', params.band.join(' '));
    }
    if (params.time) {
        url.searchParams.set('TIME', params.time.join(' '));
    }
    url.searchParams.set('MAXREC', String(params.maxrec));
    url.searchParams.set('RESPONSEFORMAT', 'VOTABLE');
    return url;
}

function error(status: number, message: string): Response
{
    return new Response(JSON.stringify({ error: message }), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export function OPTIONS(): Response
{
    return new Response(null, { status: 204, headers: cors });
}

export async function GET(request: Request): Promise<Response>
{
    if (request.method !== 'GET') {
        return error(405, 'Method not allowed');
    }
    let params: SiaParams;
    try {
        params = parseParams(new URL(request.url).searchParams);
    } catch (err) {
        return error(400, err instanceof Error ? err.message : 'Invalid request');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const response = await fetch(buildUpstreamUrl(params), { signal: controller.signal });
        if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) {
            try {
                await response.body?.cancel();
            } catch {
                // Still reject the response when upstream cancellation fails.
            }
            return error(502, 'Invalid upstream response');
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                size += value.length;
                if (size > LIMIT) {
                    await reader.cancel();
                    return error(502, 'Upstream response too large');
                }
                chunks.push(value);
            }
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
        }
        const xml = new TextDecoder('utf-8').decode(body);
        if (!/<([A-Za-z_][\w.-]*:)?VOTABLE\b/.test(xml)) {
            return error(502, 'Upstream reply was not a VOTable');
        }
        const hasError = /<([A-Za-z_][\w.-]*:)?INFO\b(?=[^>]*\sname\s*=\s*["']QUERY_STATUS["'])(?=[^>]*\svalue\s*=\s*["']ERROR["'])/i.test(xml);
        return new Response(body, { headers: { ...cors, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': hasError ? 'no-store' : 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
    } catch {
        return error(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'Upstream timeout' : 'Upstream failure');
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

const COLLECTIONS = ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'];
const LIMIT = 8 * 1024 * 1024;
export const RETRY_DELAYS_MS = Object.freeze([500, 1500] as const);
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

// Attributes up to the end of a tag; a quoted value may hold '>'.
const TAG_ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const XML_TAG = new RegExp(`<(/?)([A-Za-z_][\\w:.-]*)(${TAG_ATTRS})>|<!DOCTYPE(?:[^>"'[]|"[^"]*"|'[^']*'|\\[[^\\]]*\\])*>`, 'g');
const INFO_TAG = new RegExp(`<([A-Za-z_][\\w.-]*:)?INFO\\b${TAG_ATTRS}>`, 'gi');

// True when the document is one VOTABLE element (IRSA writes an ns0: prefix on every tag) and every element in it
// closes in order, so an HTML page or a reply cut short is never cached as a frame list. Comments, CDATA and
// processing instructions are removed first, and one left open means the reply was cut. Entities and attribute
// syntax are not checked.
export function isVotable(xml: string): boolean
{
    const bare = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, ' ');
    if (/<!--|<!\[CDATA\[|<\?/.test(bare)) {
        return false;
    }
    const open: string[] = [];
    let seenRoot = false;
    let closed = false;
    let pos = 0;
    const textOk = (text: string): boolean => !text.includes('<') && (open.length > 0 || !text.trim());
    for (const m of bare.matchAll(XML_TAG)) {
        if (!textOk(bare.slice(pos, m.index))) {
            return false;
        }
        pos = m.index + m[0].length;
        if (m[2] === undefined) {
            if (seenRoot) {
                return false;
            }
            continue;
        }
        const name = m[2];
        if (closed) {
            return false;
        }
        if (m[1] === '/') {
            if (open.pop() !== name) {
                return false;
            }
            closed = open.length === 0;
            continue;
        }
        if (!seenRoot) {
            if (name.replace(/^[^:]*:/, '') !== 'VOTABLE') {
                return false;
            }
            seenRoot = true;
        }
        if (m[3]!.endsWith('/')) {
            closed = open.length === 0;
        } else {
            open.push(name);
        }
    }
    return closed && textOk(bare.slice(pos));
}

// Character and the five predefined entity references, as an XML parser reads them in attribute values.
function decodeEntities(value: string): string
{
    const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    return value.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (whole, ref: string) => {
        if (ref[0] === '#') {
            const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return named[ref.toLowerCase()] ?? whole;
    });
}

// True when an INFO tag says QUERY_STATUS=ERROR. Attributes are read in order, so text inside a quoted value
// is never taken for another attribute.
export function queryFailed(xml: string): boolean
{
    for (const [tag] of xml.matchAll(INFO_TAG)) {
        const attrs = new Map<string, string>();
        for (const m of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attrs.set(m[1]!.toLowerCase(), decodeEntities(m[2] ?? m[3] ?? ''));
        }
        if (attrs.get('name')?.toUpperCase() === 'QUERY_STATUS' && attrs.get('value')?.toUpperCase() === 'ERROR') {
            return true;
        }
    }
    return false;
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
        let response: Response | undefined;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
            try {
                response = await fetch(buildUpstreamUrl(params), { signal: controller.signal });
            } catch (err) {
                if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError') || attempt === RETRY_DELAYS_MS.length) {
                    throw err;
                }
            }
            if (response) {
                const oversized = Number(response.headers.get('content-length')) > LIMIT;
                if (response.ok && !oversized) {
                    break;
                }
                try {
                    await response.body?.cancel();
                } catch {
                    // Still reject the response when upstream cancellation fails.
                }
                if (controller.signal.aborted) {
                    throw new Error('Upstream timeout');
                }
                if (oversized || ![502, 503, 504].includes(response.status) || attempt === RETRY_DELAYS_MS.length) {
                    return error(502, 'Invalid upstream response');
                }
                response = undefined;
            }
            await new Promise<void>((resolve, reject) => {
                if (controller.signal.aborted) {
                    reject(new Error('Upstream timeout'));
                    return;
                }
                const onAbort = () => {
                    clearTimeout(wait);
                    reject(new Error('Upstream timeout'));
                };
                const wait = setTimeout(() => {
                    controller.signal.removeEventListener('abort', onAbort);
                    resolve();
                }, RETRY_DELAYS_MS[attempt]);
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
        }
        if (!response || controller.signal.aborted) {
            throw new Error('Upstream failure');
        }
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (controller.signal.aborted) {
                    throw new Error('Upstream timeout');
                }
                if (done) {
                    break;
                }
                size += value.length;
                if (size > LIMIT) {
                    await reader.cancel();
                    if (controller.signal.aborted) {
                        throw new Error('Upstream timeout');
                    }
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
        if (!isVotable(xml)) {
            return error(502, 'Upstream reply was not a VOTable');
        }
        const hasError = queryFailed(xml);
        return new Response(body, { headers: { ...cors, 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': hasError ? 'no-store' : 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' } });
    } catch {
        return error(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'Upstream timeout' : 'Upstream failure');
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

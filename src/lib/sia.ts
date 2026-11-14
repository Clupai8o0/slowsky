import type { Detector, FrameQuery, FrameRecord } from './types';
import { parseRegion } from './footprint';
import { parseVotable, type VoRow } from './votable';

export const ALLOWED_COLLECTIONS = ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'] as const;
const BUCKET = 'nasa-irsa-spherex';

function cloudUrl(raw: string): string | null
{
    try {
        const aws = (JSON.parse(raw) as { aws?: { bucket_name?: unknown; key?: unknown; region?: unknown } }).aws;
        const region = aws?.region === undefined ? 'us-east-1' : aws.region;
        if (!aws || aws.bucket_name !== BUCKET || typeof aws.key !== 'string' || typeof region !== 'string') {
            return null;
        }
        if (!aws.key.endsWith('.fits') || aws.key.includes('..') || aws.key.startsWith('/') || !/^[a-z0-9-]+$/.test(region)) {
            return null;
        }
        if (region !== 'us-east-1') {
            return null;
        }
        return `https://${BUCKET}.s3.${region}.amazonaws.com/${aws.key.split('/').map(encodeURIComponent).join('/')}`;
    } catch {
        return null;
    }
}

// IRSA writes the VOTable with an ns0: prefix on every tag, which votable.ts does not match, so strip prefixes first.
export function parseSiaXml(xml: string): VoRow[]
{
    return parseVotable(xml.replace(/(<\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z])/g, '$1'));
}

// Reads every QUERY_STATUS INFO. ERROR wins over OVERFLOW when MAXREC cut the list.
export function queryStatus(xml: string): { status: string; message: string } | null
{
    let result: { status: string; message: string } | null = null;
    const doc = xml.replace(/(<\/?)[A-Za-z_][\w.-]*:(?=[A-Za-z])/g, '$1');
    for (const [tag] of doc.matchAll(/<INFO\b[^>]*\bname="QUERY_STATUS"[^>]*>/gi)) {
        const value = tag.match(/\bvalue="([^"]*)"/i)?.[1] ?? '';
        const status = { status: value.toUpperCase(), message: value };
        if (status.status === 'ERROR') {
            return status;
        }
        if (!result || status.status === 'OVERFLOW') {
            result = status;
        }
    }
    return result;
}

export const SIA_MAXREC = 2000;

// Every frame on a detector has the same em_min..em_max (measured from SIA rows, µm):
// D1 0.746-1.117, D3 1.630-2.435, D4 2.403-3.847, D6 4.412-5.010; D2 and D5 sit between.
// A BAND at a value only one detector covers keeps busy fields (the ecliptic poles,
// where the deep-field collections add thousands of rows) under MAXREC.
export const DETECTOR_BAND_UM: Record<Detector, number> = { 1: 0.93, 2: 1.37, 3: 2.03, 4: 3.12, 5: 4.12, 6: 4.71 };

// SPHEREx launched on 11 March 2025 (MJD 60745); no frame starts before this.
const MISSION_START_MJD = 60740;
// When one query still overflows, it is retried as this many time windows.
export const SIA_TIME_SPLITS = 4;

// A frame list. truncated is true when MAXREC cut at least one query, so some frames are missing.
export type FrameList = FrameRecord[] & { truncated?: boolean };

function mjdNow(): number
{
    return Date.now() / 86_400_000 + 40587;
}

async function queryOnce(q: FrameQuery, signal: AbortSignal | undefined, fetcher: typeof fetch): Promise<{ rows: VoRow[]; overflow: boolean }>
{
    const params = new URLSearchParams({ POS: `CIRCLE ${q.center.ra} ${q.center.dec} ${q.radiusDeg}` });
    params.set('MAXREC', String(SIA_MAXREC));
    if (q.lambda !== undefined) {
        params.set('BAND', String(q.lambda * 1e-6));
    } else if (q.detector) {
        params.set('BAND', String(DETECTOR_BAND_UM[q.detector] * 1e-6));
    }
    if (q.timeRange) {
        params.set('TIME', q.timeRange.join(' '));
    }
    const response = await fetcher(`/api/sia?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`SIA request failed (${response.status})`);
    }
    const xml = await response.text();
    // A 200 reply that is not a VOTable (a host's own HTML page, a maintenance notice) is a failure, not an empty sky.
    if (!/<(?:[\w.-]+:)?VOTABLE[\s>/]/i.test(xml)) {
        throw new Error('SIA reply was not a frame list (VOTable)');
    }
    const status = queryStatus(xml);
    if (status?.status === 'ERROR') {
        throw new Error('SIA query failed (QUERY_STATUS=ERROR)');
    }
    return { rows: parseSiaXml(xml), overflow: status?.status === 'OVERFLOW' };
}

// Splits [t0, t1] into n equal windows.
export function timeWindows(t0: number, t1: number, n: number): [number, number][]
{
    const step = (t1 - t0) / n;
    return Array.from({ length: n }, (_, i): [number, number] => [t0 + i * step, i === n - 1 ? t1 : t0 + (i + 1) * step]);
}

// Finds frames covering q.center. When MAXREC cuts the answer (OVERFLOW), the query is
// retried once as SIA_TIME_SPLITS time windows, so the frames still spread over the
// whole mission; a window that overflows again marks the list truncated instead of failing.
export async function searchFrames(q: FrameQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<FrameList>
{
    const first = await queryOnce(q, signal, fetcher);
    const rows = [...first.rows];
    let truncated = false;
    if (first.overflow) {
        const [t0, t1] = q.timeRange ?? [MISSION_START_MJD, Math.ceil(mjdNow()) + 1];
        const parts = await Promise.all(timeWindows(t0, t1, SIA_TIME_SPLITS).map((timeRange) => queryOnce({ ...q, timeRange }, signal, fetcher)));
        for (const part of parts) {
            rows.push(...part.rows);
            truncated ||= part.overflow;
        }
    }
    const frames = new Map<string, FrameRecord>();
    for (const row of rows) {
        const frame = rowToFrame(row);
        if (frame && (!q.detector || frame.detector === q.detector) && !frames.has(frame.obsId)) {
            frames.set(frame.obsId, frame);
        }
    }
    const list: FrameList = [...frames.values()].sort((a, b) => a.tMin - b.tMin);
    if (truncated) {
        list.truncated = true;
    }
    return list;
}

export function rowToFrame(row: VoRow): FrameRecord | null
{
    const collection = row.obs_collection ?? '';
    if (!ALLOWED_COLLECTIONS.some((item) => item === collection)) {
        return null;
    }
    const url = cloudUrl(row.cloud_access ?? '');
    if (!url) {
        return null;
    }
    const detector = Number(row.energy_bandpassname?.match(/^SPHEREx-D([1-6])$/i)?.[1] ?? row.obs_id?.match(/D([1-6])$/i)?.[1]);
    const numeric = (key: string): number => row[key]?.trim() ? Number(row[key]) : NaN;
    const tMin = numeric('t_min');
    const tMax = numeric('t_max');
    const lambdaMin = numeric('em_min') * 1e6;
    const lambdaMax = numeric('em_max') * 1e6;
    if (!row.obs_id || !Number.isInteger(detector) || detector < 1 || detector > 6 || ![tMin, tMax, lambdaMin, lambdaMax].every(Number.isFinite)) {
        return null;
    }
    const frame: FrameRecord = { obsId: `${row.obs_id}D${detector}`, collection, release: collection.includes('qr3') ? 'qr3' : 'dr1', detector: detector as Detector, url, tMin, tMax, lambdaMin, lambdaMax };
    if (row.access_url) {
        frame.irsaUrl = row.access_url;
    }
    const ra = numeric('s_ra');
    const dec = numeric('s_dec');
    if (Number.isFinite(ra) && Number.isFinite(dec)) {
        frame.center = { ra, dec };
    }
    const footprint = parseRegion(row.s_region);
    if (footprint) {
        frame.footprint = footprint;
    }
    const size = numeric('access_estsize');
    if (Number.isFinite(size) && size >= 0) {
        frame.estSizeBytes = size * 1024;
    }
    return frame;
}

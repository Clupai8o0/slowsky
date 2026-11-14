import type { Detector, FrameQuery, FrameRecord } from './types';
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

export async function searchFrames(q: FrameQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<FrameRecord[]>
{
    const params = new URLSearchParams({ POS: `CIRCLE ${q.center.ra} ${q.center.dec} ${q.radiusDeg}` });
    if (q.lambda !== undefined) {
        params.set('BAND', String(q.lambda * 1e-6));
    }
    if (q.timeRange) {
        params.set('TIME', q.timeRange.join(' '));
    }
    const response = await fetcher(`/api/sia?${params}`, { signal });
    if (!response.ok) {
        throw new Error(`SIA request failed (${response.status})`);
    }
    const frames = new Map<string, FrameRecord>();
    for (const row of parseSiaXml(await response.text())) {
        const frame = rowToFrame(row);
        if (frame && (!q.detector || frame.detector === q.detector) && !frames.has(frame.obsId)) {
            frames.set(frame.obsId, frame);
        }
    }
    return [...frames.values()].sort((a, b) => a.tMin - b.tMin);
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
    const size = numeric('access_estsize');
    if (Number.isFinite(size) && size >= 0) {
        frame.estSizeBytes = size * 1024;
    }
    return frame;
}

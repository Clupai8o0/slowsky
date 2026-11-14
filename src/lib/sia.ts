import type { Detector, FrameQuery, FrameRecord } from './types';
import { parseVotable, type VoRow } from './votable';

export const ALLOWED_COLLECTIONS = ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'] as const;
const HOSTS = ['nasa-irsa-spherex.s3.us-east-1.amazonaws.com', 'nasa-irsa-spherex.s3.amazonaws.com', 'irsa.ipac.caltech.edu'];

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
    for (const row of parseVotable(await response.text())) {
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
    const accessUrl = row.access_url ?? '';
    if (!ALLOWED_COLLECTIONS.some((item) => item === collection)) {
        return null;
    }
    try {
        const url = new URL(accessUrl);
        if (url.protocol !== 'https:' || !HOSTS.includes(url.hostname) || url.username || url.password || url.port) {
            return null;
        }
    } catch {
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
    const frame: FrameRecord = { obsId: row.obs_id, collection, release: collection.includes('qr3') ? 'qr3' : 'dr1', detector: detector as Detector, url: accessUrl, tMin, tMax, lambdaMin, lambdaMax };
    const ra = numeric('s_ra');
    const dec = numeric('s_dec');
    if (Number.isFinite(ra) && Number.isFinite(dec)) {
        frame.center = { ra, dec };
    }
    const size = numeric('access_estsize');
    if (Number.isFinite(size) && size >= 0) {
        frame.sizeBytes = size * 1024;
    }
    return frame;
}

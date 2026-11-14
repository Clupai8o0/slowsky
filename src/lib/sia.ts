// Lane: SIA (Codex). Browser side of the /api/sia passthrough.
import type { FrameQuery, FrameRecord } from './types';
import type { VoRow } from './votable';
import { NotImplemented } from './notimpl';

// Collections the app may use. QR2 is never allowed (different calibration).
export const ALLOWED_COLLECTIONS = ['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep'] as const;

export async function searchFrames(q: FrameQuery, signal?: AbortSignal): Promise<FrameRecord[]>
{
    void signal;
    throw new NotImplemented(`searchFrames(${q.center.ra},${q.center.dec})`);
}

// One SIA row to a FrameRecord. Returns null for rows outside ALLOWED_COLLECTIONS
// or without an https S3 access_url.
export function rowToFrame(row: VoRow): FrameRecord | null
{
    throw new NotImplemented(`rowToFrame(${Object.keys(row).length} fields)`);
}

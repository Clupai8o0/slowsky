// End to end on real data: IRSA SIA (called directly, as /api/sia would) -> S3 range reads ->
// WCS -> wavelength lock -> regrid. Run with LIVE=1; needs the network.
import { describe, expect, it } from 'vitest';
import { createLiveSource } from '../../src/lib/source';
import { parseVotable } from '../../src/lib/votable';
import { rowToFrame } from '../../src/lib/sia';
import { positionAt, targetById } from '../../src/lib/targets';
import { gridSkyToPix } from '../../src/lib/regrid';
import type { FrameQuery, FrameRecord, Target } from '../../src/lib/types';

const LIVE = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

async function directSearch(q: FrameQuery, signal?: AbortSignal): Promise<FrameRecord[]>
{
    const params = new URLSearchParams();
    for (const c of ['spherex_dr1', 'spherex_qr3']) {
        params.append('COLLECTION', c);
    }
    params.set('POS', `CIRCLE ${q.center.ra} ${q.center.dec} ${q.radiusDeg}`);
    params.set('RESPONSEFORMAT', 'VOTABLE');
    params.set('MAXREC', '2000');
    const res = await fetch(`https://irsa.ipac.caltech.edu/SIA?${params}`, { signal });
    expect(res.status).toBe(200);
    const rows = parseVotable(await res.text());
    return rows.map(rowToFrame).filter((f): f is FrameRecord => f !== null && (!q.detector || f.detector === q.detector));
}

describe.skipIf(!LIVE)('live source on real SPHEREx data', () => {
    it('RW Aur, detector 1: real frames, one per visit, target on the track', async () => {
        const target = targetById('rwaur') as Target;
        const center = positionAt(target.astrometry, 61000);
        const source = createLiveSource({ search: directSearch, maxHeaders: 24 });
        const t0 = Date.now();
        const res = await source.load({ center, fovDeg: 0.05, detector: 1, target: 'rwaur' });
        const secs = (Date.now() - t0) / 1000;
        console.log(`live: ${res.frames.length} frames at ${res.lambda.toFixed(3)} µm in ${secs.toFixed(1)} s`, res.notes);
        expect(res.frames.length).toBeGreaterThan(1);
        for (const f of res.frames) {
            expect(f.frame.frame.url).toMatch(/^https:\/\/nasa-irsa-spherex\.s3\./);
            const finite = Array.from(f.frame.data).filter(Number.isFinite).length;
            expect(finite / f.frame.data.length).toBeGreaterThan(0.9);
        }
        // RW Aur is bright in the near infrared: the brightest pixel near the track point is the star.
        const g = res.grid;
        for (let k = 0; k < res.frames.length; k++) {
            const data = res.frames[k]!.frame.data;
            const p = res.track![k]!.pix;
            let best = -Infinity;
            let bx = 0;
            let by = 0;
            for (let y = Math.max(0, Math.round(p.y) - 20); y <= Math.min(g.height - 1, Math.round(p.y) + 20); y++) {
                for (let x = Math.max(0, Math.round(p.x) - 20); x <= Math.min(g.width - 1, Math.round(p.x) + 20); x++) {
                    const v = data[y * g.width + x] as number;
                    if (v > best) {
                        best = v;
                        bx = x;
                        by = y;
                    }
                }
            }
            // within 1.5 SPHEREx pixels (grid pixels are pixelArcsec each)
            expect(Math.hypot(bx - p.x, by - p.y) * g.pixelArcsec).toBeLessThan(1.5 * 6.15);
        }
        expect(gridSkyToPix(g, center).x).toBeCloseTo((g.width - 1) / 2, 6);
    }, 180_000);
});

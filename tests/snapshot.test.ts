import { describe, expect, it } from 'vitest';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { readFileSync, statSync } from 'node:fs';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { join } from 'node:path';
import targets from '../src/data/targets.json';

declare const process: { cwd(): string };

describe('offline snapshots', () => {
    it('contains consistent frames and Gaia catalogues for every target', () => {
        const root = join(process.cwd(), 'public/snapshot');
        const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
        let total = 0;
        for (const target of targets) {
            const dir = join(root, target.id);
            const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
            const gaia = JSON.parse(readFileSync(join(dir, 'gaia.json'), 'utf8'));
            expect(index.target.id).toBe(target.id);
            expect(index.frames.length).toBeGreaterThan(0);
            expect(gaia.credit).toBe('ESA/Gaia/DPAC, CC BY-NC 3.0 IGO');
            const visits = new Set(index.frames.map((f: { record: { obsId: string } }) => f.record.obsId.split('_').slice(0, 3).join('_')));
            expect(visits.size).toBeGreaterThan(Math.min(index.frames.length, 24) / 2);
            let previous = -Infinity;
            for (const frame of index.frames) {
                expect(['spherex_dr1', 'spherex_dr1_deep', 'spherex_qr3', 'spherex_qr3_deep']).toContain(frame.record.collection);
                expect(frame.record.tMin).toBeGreaterThanOrEqual(previous);
                previous = frame.record.tMin;
                expect(frame.record.estSizeBytes).toBeGreaterThan(0);
                expect(frame.record.sizeBytes).toBeUndefined();
                const size = statSync(join(dir, frame.file)).size;
                expect(size).toBe(3 * 112 * 112 * 4);
                total += size;
                const h = frame.imageHeader;
                const a = target.astrometry;
                const years = (frame.record.tMin - 51544.5) / 365.25 + 2000 - a.epochJyear;
                const dec = (a.dec + a.pmDec * years / 3600000) * Math.PI / 180;
                const ra = (a.ra + a.pmRa * years / (3600000 * Math.cos(a.dec * Math.PI / 180))) * Math.PI / 180;
                const ra0 = h.CRVAL1 * Math.PI / 180;
                const dec0 = h.CRVAL2 * Math.PI / 180;
                const denom = Math.sin(dec) * Math.sin(dec0) + Math.cos(dec) * Math.cos(dec0) * Math.cos(ra - ra0);
                const xi = Math.cos(dec) * Math.sin(ra - ra0) / denom * 180 / Math.PI;
                const eta = (Math.sin(dec) * Math.cos(dec0) - Math.cos(dec) * Math.sin(dec0) * Math.cos(ra - ra0)) / denom * 180 / Math.PI;
                const c11 = h.CD1_1 ?? h.CDELT1 * h.PC1_1;
                const c12 = h.CD1_2 ?? h.CDELT1 * h.PC1_2;
                const c21 = h.CD2_1 ?? h.CDELT2 * h.PC2_1;
                const c22 = h.CD2_2 ?? h.CDELT2 * h.PC2_2;
                const det = c11 * c22 - c12 * c21;
                const x = (xi * c22 - eta * c12) / det + h.CRPIX1 - 1;
                const y = (eta * c11 - xi * c21) / det + h.CRPIX2 - 1;
                expect(x).toBeGreaterThanOrEqual(frame.box.x0 - 2);
                expect(x).toBeLessThan(frame.box.x1 + 2);
                expect(y).toBeGreaterThanOrEqual(frame.box.y0 - 2);
                expect(y).toBeLessThan(frame.box.y1 + 2);
            }
            expect(manifest.targets.find((entry: { id: string }) => entry.id === target.id).frameCount).toBe(index.frames.length);
        }
        expect(manifest.totalBytes).toBe(total);
        expect(total).toBeLessThan(30_000_000);
    });
});

import { expect, it } from 'vitest';
import { aperture, RESAMPLE_NOISE_FACTOR } from '../src/lib/photometry';
import { gridForView, regridNorthUp } from '../src/lib/regrid';
import type { Cutout, FitsHeader, FrameRecord, WcsParams } from '../src/lib/types';
import { makeWcs } from '../src/lib/wcs';
import { apertureFor } from '../src/ui/measure';

const header: FitsHeader = { cards: new Map(), history: [], get: () => undefined, num: () => 0 };

function measure(minScreenPx: number): number
{
    let seed = 12345;
    const random = (): number => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed + 0.5) / 4294967296;
    };
    const center = { ra: 10, dec: 20 };
    const grid = gridForView(center, 0.1, minScreenPx, 4001);
    const scale = RESAMPLE_NOISE_FACTOR * Math.max(1, 6.15 / grid.pixelArcsec);
    const sums: number[] = [];
    const noises: number[] = [];
    for (let trial = 0; trial < 250; trial++) {
        const theta = random() * 2 * Math.PI;
        const s = 6.15 / 3600;
        const params: WcsParams = {
            crpix: [50 + random(), 50 + random()], crval: [center.ra, center.dec],
            cd: [[-s * Math.cos(theta), s * Math.sin(theta)], [s * Math.sin(theta), s * Math.cos(theta)]],
            naxis: [100, 100],
        };
        const image = new Float32Array(10000);
        for (let i = 0; i < image.length; i++) {
            image[i] = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
        }
        const cut: Cutout = { frame: {} as FrameRecord, box: { x0: 0, y0: 0, x1: 100, y1: 100 }, width: 100, height: 100, image, wcs: params, header };
        const data = regridNorthUp(cut, makeWcs(params), grid);
        const at = { x: (grid.width - 1) / 2, y: (grid.height - 1) / 2 };
        const result = aperture(data, grid.width, grid.height, at, { ...apertureFor(grid), noiseScale: scale });
        expect(result.valid).toBe(true);
        sums.push(result.sum);
        noises.push(Math.abs(result.sum / result.snr));
    }
    const mean = sums.reduce((a, b) => a + b, 0) / sums.length;
    const sd = Math.sqrt(sums.reduce((a, b) => a + (b - mean) ** 2, 0) / (sums.length - 1));
    noises.sort((a, b) => a - b);
    return sd / ((noises[124]! + noises[125]!) / 2);
}

it.each([1, 2, 4])('calibrates resampling noise on grid %i', (m) => {
    const ratio = measure(m);
    console.log(`grid ${m}: true scatter / reported noise = ${ratio.toFixed(3)}`);
    // Other seeds and 2000 trials stayed between 0.92 and 1.02 (review, 14 Nov 2026).
    expect(ratio).toBeGreaterThanOrEqual(0.88);
    expect(ratio).toBeLessThanOrEqual(1.06);
}, 20000);

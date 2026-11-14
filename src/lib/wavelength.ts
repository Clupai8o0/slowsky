// Lane: WCS. WCS-WAVE lookup and the wavelength lock.
import type { FrameRecord, PixelCoord, WaveGrid, WaveSample } from './types';

// Index and fraction of the cell holding v on an ascending axis, clamped to the grid.
function locate(axis: number[], v: number): [number, number]
{
    const n = axis.length;
    if (n < 2 || v <= at(axis, 0)) {
        return [0, 0];
    }
    if (v >= at(axis, n - 1)) {
        return [n - 2, 1];
    }
    let i = 0;
    while (i < n - 2 && v >= at(axis, i + 1)) {
        i++;
    }
    return [i, (v - at(axis, i)) / (at(axis, i + 1) - at(axis, i))];
}

function at(a: number[], i: number): number
{
    return a[i] as number;
}

function bilinear(g: number[][], ix: number, iy: number, fx: number, fy: number): number
{
    const r0 = g[iy] as number[];
    const r1 = g[iy + 1] as number[];
    const top = at(r0, ix) * (1 - fx) + at(r0, ix + 1) * fx;
    const bot = at(r1, ix) * (1 - fx) + at(r1, ix + 1) * fx;
    return top * (1 - fy) + bot * fy;
}

// Bilinear lookup in the 9x9 grid, matching astropy's -TAB result.
export function sampleWave(grid: WaveGrid, p: PixelCoord): WaveSample
{
    const [ix, fx] = locate(grid.xs, p.x);
    const [iy, fy] = locate(grid.ys, p.y);
    return {
        lambda: bilinear(grid.lambda, ix, iy, fx, fy),
        bandwidth: bilinear(grid.bandwidth, ix, iy, fx, fy),
    };
}

// A visit is a run of frames on one detector within maxGapDays of each other.
export function groupVisits(frames: FrameRecord[], maxGapDays: number): FrameRecord[][]
{
    const byDetector = new Map<number, FrameRecord[]>();
    for (const f of frames) {
        const list = byDetector.get(f.detector);
        if (list) {
            list.push(f);
        } else {
            byDetector.set(f.detector, [f]);
        }
    }
    const visits: FrameRecord[][] = [];
    for (const det of [...byDetector.keys()].sort((a, b) => a - b)) {
        const sorted = [...(byDetector.get(det) as FrameRecord[])].sort((a, b) => a.tMin - b.tMin);
        let current: FrameRecord[] = [];
        for (const f of sorted) {
            const prev = current[current.length - 1];
            if (prev && f.tMin - prev.tMin > maxGapDays) {
                visits.push(current);
                current = [];
            }
            current.push(f);
        }
        if (current.length > 0) {
            visits.push(current);
        }
    }
    return visits;
}

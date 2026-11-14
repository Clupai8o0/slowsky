// A simulated sky behind the real SkySource interface, for building the UI before the live
// source lands and for ?demo=1. It is NOT SPHEREx data; the page labels it "simulated" on screen.
import type { SkyRequest, SkyResult, SkySource, GaiaStar, TrackPoint } from '../lib/source';
import type { FrameRecord, OutputGrid, PlayerFrame, RegriddedFrame } from '../lib/types';
import type { LockedFrame } from '../lib/lock';
import { COPY, DETECTORS, type TargetKind } from './copy';
import { gridPixToSky } from '../lib/regrid';

const PIXEL_ARCSEC = 6.15;
const VISIT_DATES = ['2025-04-12', '2025-10-09', '2026-04-11', '2026-10-08'];
const MJD_UNIX0 = 40587;

function rng(seed: number): () => number
{
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash(s: string): number
{
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return h >>> 0;
}

function gauss(r: () => number): number
{
    return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

function mjdOf(date: string): number
{
    return Date.parse(`${date}T00:00:00Z`) / 86400000 + MJD_UNIX0;
}

// How bright the target is at a wavelength, relative to its normal brightness.
function targetFlux(kind: TargetKind | 'field', lambda: number): number
{
    if (kind === 'spectrum') {
        const methane = Math.exp(-(((lambda - 3.3) / 0.25) ** 2));
        const water = Math.exp(-(((lambda - 1.4) / 0.12) ** 2)) + Math.exp(-(((lambda - 2.7) / 0.2) ** 2));
        return 1.6 * (1 - 0.85 * methane - 0.6 * water);
    }
    if (kind === 'cold') {
        return lambda > 4.4 ? 2.2 : 0.05;
    }
    return 1;
}

function delay(ms: number, signal?: AbortSignal): Promise<void>
{
    return new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

export function createDemoSource(): SkySource
{
    return {
        async load(req: SkyRequest): Promise<SkyResult>
        {
            const band = DETECTORS[req.detector - 1] ?? [0.75, 1.09];
            const range: [number, number] = [band[0] + 0.02, band[1] - 0.02];
            const lambda = Math.min(Math.max(req.lambda ?? (range[0] + range[1]) / 2, range[0]), range[1]);
            const kind: TargetKind | 'field' = req.target ? COPY[req.target].kind : 'field';

            const total = VISIT_DATES.length;
            for (const stage of ['search', 'headers', 'pixels', 'regrid'] as const) {
                for (let i = 0; i < total; i++) {
                    req.onProgress?.({ stage, done: i, total });
                    await delay(stage === 'pixels' ? 70 : 30, req.signal);
                }
            }

            let side = Math.ceil(req.fovDeg * 3600 / PIXEL_ARCSEC);
            if (side % 2 === 0) {
                side += 1;
            }
            side = Math.min(side, 301);
            const grid: OutputGrid = {
                center: req.center,
                fovDeg: req.fovDeg,
                pixelArcsec: req.fovDeg * 3600 / side,
                width: side,
                height: side,
            };
            const N = side;
            const c = (N - 1) / 2;
            const seed = hash(`${req.target ?? ''}|${req.center.ra.toFixed(3)}|${req.center.dec.toFixed(3)}`);
            const R = rng(seed);

            const field: { x: number; y: number; f: number; col: number }[] = [];
            const count = Math.round(N * N * 0.012);
            for (let i = 0; i < count; i++) {
                const u = R();
                const s = { x: R() * N, y: R() * N, f: 0.3 * Math.exp(u * u * u * 8), col: R() * 2 - 1 };
                if (Math.hypot(s.x - c, s.y - c) > 4) {
                    field.push(s);
                }
            }

            const frames: PlayerFrame[] = [];
            const locked: LockedFrame[] = [];
            const track: TrackPoint[] = [];
            const sigma = 0.9;
            for (let k = 0; k < total; k++) {
                const date = VISIT_DATES[k] as string;
                const mjd = mjdOf(date);
                const years = k * 0.5;
                const lam = lambda + (R() - 0.5) * 0.012;
                const img = new Float32Array(N * N);
                const nr = rng(seed + 101 * (k + 1));
                for (let i = 0; i < img.length; i++) {
                    img[i] = 0.05 + 0.012 * gauss(nr);
                }
                const paint = (x: number, y: number, f: number) => {
                    const r = Math.ceil(sigma * 4);
                    for (let yy = Math.max(0, Math.floor(y) - r); yy <= Math.min(N - 1, Math.floor(y) + r); yy++) {
                        for (let xx = Math.max(0, Math.floor(x) - r); xx <= Math.min(N - 1, Math.floor(x) + r); xx++) {
                            const d2 = (xx - x) ** 2 + (yy - y) ** 2;
                            img[yy * N + xx] = (img[yy * N + xx] as number) + f * Math.exp(-d2 / (2 * sigma * sigma));
                        }
                    }
                };
                for (const s of field) {
                    paint(s.x, s.y, s.f * (1 + 0.25 * s.col * (lam - 2.5) / 2.5));
                }
                let tx = c;
                let ty = c;
                if (kind === 'mover') {
                    tx = c - 0.25 * years;
                    ty = c - 1.7 * years;
                } else if (kind === 'spectrum') {
                    tx = c + 0.9 * years;
                    ty = c - 0.5 * years;
                }
                if (kind !== 'field') {
                    const base = kind === 'saturated' ? 400 : kind === 'variable' ? 30 * (1 + 0.35 * k) : 60;
                    paint(tx, ty, base * targetFlux(kind, lam));
                    if (kind === 'cold') {
                        paint(c + 1.2, c - 0.4, lam < 4.4 ? 14 : 2);
                    }
                    if (kind === 'saturated') {
                        for (let i = 0; i < img.length; i++) {
                            img[i] = Math.min(img[i] as number, 150);
                        }
                    }
                    track.push({ mjd, ra: req.center.ra, dec: req.center.dec, pix: { x: tx, y: ty } });
                }
                const record: FrameRecord = {
                    obsId: `SIMULATED_${k + 1}D${req.detector}`,
                    collection: 'spherex_dr1',
                    release: 'dr1',
                    detector: req.detector,
                    url: '',
                    tMin: mjd,
                    tMax: mjd + 0.002,
                    lambdaMin: band[0],
                    lambdaMax: band[1],
                };
                const frame: RegriddedFrame = {
                    frame: record,
                    grid,
                    data: img,
                    lambdaAtCenter: lam,
                    bandwidthAtCenter: lam / 41,
                };
                frames.push({ frame, label: `${date} · ${lam.toFixed(3)} µm` });
                locked.push({ frame: record, lambda: lam, dLambda: lam - lambda });
            }

            const stars: GaiaStar[] = field
                .filter((s) => s.f > 30)
                // Rings are placed from RA and Dec at each frame's date, so each simulated star needs its own.
                .map((s, i) => ({
                    sourceId: `sim-${i}`,
                    ...gridPixToSky(grid, { x: s.x, y: s.y }),
                    g: 14,
                    epochJyear: 2016,
                    pix: { x: s.x, y: s.y },
                }));

            return {
                source: 'snapshot',
                grid,
                frames,
                locked,
                lambda,
                lambdaRange: range,
                stars,
                track: track.length ? track : undefined,
                credits: ['Simulated sky for testing the page. Not real data.'],
                notes: [],
            };
        },
    };
}

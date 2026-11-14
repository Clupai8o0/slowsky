// Lane: parsers (Haiku). The view as a shareable link.
import type { Detector, TargetId, ViewState } from './types';

const TARGET_IDS: readonly TargetId[] = ['barnard', 'rwaur', 'epsindb', 'wise0855', 'rdra'];
const FOV_RANGE: [number, number] = [0.05, 2];
const DET_RANGE: [number, number] = [1, 6];
const LAMBDA_RANGE: [number, number] = [0.7, 5.1];
const DEFAULT_FOV = 0.25;
const DEFAULT_DETECTOR: Detector = 1;

// Short, readable keys: ra, dec, fov, det, lam, t, f.
export function encodeView(v: ViewState): string
{
    // Wrap RA into [0, 360) after rounding, so "360.00000" never reaches the link.
    const ra = Number((((v.center.ra % 360) + 360) % 360).toFixed(5)) % 360;
    const params = new URLSearchParams();
    params.set('ra', ra.toFixed(5));
    params.set('dec', v.center.dec.toFixed(5));
    params.set('fov', v.fovDeg.toFixed(3));
    params.set('det', String(v.detector));
    if (v.lambda !== undefined) {
        params.set('lam', v.lambda.toFixed(4));
    }
    if (v.target !== undefined) {
        params.set('t', v.target);
    }
    if (v.frame !== undefined) {
        params.set('f', v.frame);
    }
    return params.toString();
}

// Returns null when the link has no usable position; bad values are dropped, not guessed.
export function decodeView(search: string): ViewState | null
{
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const ra = readNumber(params, 'ra');
    const dec = readNumber(params, 'dec');
    if (ra === undefined || dec === undefined || ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
        return null;
    }
    const view: ViewState = {
        center: { ra, dec },
        fovDeg: inRange(readNumber(params, 'fov'), FOV_RANGE) ?? DEFAULT_FOV,
        detector: readDetector(params),
    };
    const lambda = inRange(readNumber(params, 'lam'), LAMBDA_RANGE);
    if (lambda !== undefined) {
        view.lambda = lambda;
    }
    const target = TARGET_IDS.find((id) => id === params.get('t'));
    if (target !== undefined) {
        view.target = target;
    }
    const frame = params.get('f');
    if (frame !== null && /^[A-Za-z0-9_]+$/.test(frame)) {
        view.frame = frame;
    }
    return view;
}

function readNumber(params: URLSearchParams, key: string): number | undefined
{
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') {
        return undefined;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}

function inRange(n: number | undefined, [lo, hi]: [number, number]): number | undefined
{
    return n !== undefined && n >= lo && n <= hi ? n : undefined;
}

function readDetector(params: URLSearchParams): Detector
{
    const n = readNumber(params, 'det');
    if (n === undefined || !Number.isInteger(n) || n < DET_RANGE[0] || n > DET_RANGE[1]) {
        return DEFAULT_DETECTOR;
    }
    return n as Detector;
}

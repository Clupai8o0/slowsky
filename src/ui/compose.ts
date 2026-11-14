// Colour for difference images: a robust noise floor and a blue/orange ramp.
// The stacking and subtraction themselves live in src/lib/stack.ts.

export interface DiffScale {
    floor: number; // changes smaller than this are shown black (about 2.5 sigma of the noise)
    limit: number; // full colour at and above this
}

// Colour scale for a difference image. Noise from a robust sigma (median absolute value),
// so pure noise stays dark and only real changes light up.
export function diffScale(data: Float32Array): DiffScale
{
    const vals: number[] = [];
    const stride = Math.max(1, Math.floor(data.length / 100000));
    for (let i = 0; i < data.length; i += stride) {
        const v = data[i] as number;
        if (Number.isFinite(v)) {
            vals.push(Math.abs(v));
        }
    }
    if (!vals.length) {
        return { floor: 0, limit: 1 };
    }
    vals.sort((a, b) => a - b);
    const sigma = 1.4826 * (vals[Math.floor(0.5 * (vals.length - 1))] as number);
    const top = vals[Math.floor(0.999 * (vals.length - 1))] as number;
    const floor = 2.5 * sigma;
    return { floor, limit: Math.max(top, 12 * sigma, floor + 1e-6) };
}

const NEG = [92, 150, 240];
const POS = [243, 152, 58];

// Blue for "was there then" (negative), orange for "is there now" (positive), black for no change.
// Blue and orange stay distinct for the common kinds of colour blindness.
export function renderDiverging(data: Float32Array, scale: DiffScale, out: Uint8ClampedArray): void
{
    const span = scale.limit - scale.floor;
    for (let i = 0; i < data.length; i++) {
        const v = data[i] as number;
        const o = i * 4;
        if (!Number.isFinite(v)) {
            out[o] = 0;
            out[o + 1] = 0;
            out[o + 2] = 0;
            out[o + 3] = 0;
            continue;
        }
        const u = Math.sqrt(Math.max(0, Math.min(1, (Math.abs(v) - scale.floor) / span)));
        const c = v >= 0 ? POS : NEG;
        out[o] = u * (c[0] as number);
        out[o + 1] = u * (c[1] as number);
        out[o + 2] = u * (c[2] as number);
        out[o + 3] = 255;
    }
}

// A star too bright for the detector comes back as blank (NaN) pixels in its core, which renderRgba
// leaves see-through, so a black hole sits in a white star. Paint each such hole white when it is
// enclosed (it does not touch the image edge), small, and ringed mostly by near-white pixels.
// Returns how many holes were filled.
export function fillCores(data: Float32Array, width: number, height: number, px: Uint8ClampedArray, bright = 200): number
{
    const n = width * height;
    if (data.length !== n || px.length !== n * 4) {
        return 0;
    }
    const maxHole = Math.max(4, Math.floor(n * 0.02));
    const seen = new Uint8Array(n);
    const hole: number[] = [];
    let filled = 0;
    for (let s = 0; s < n; s++) {
        if (seen[s] || !Number.isNaN(data[s] as number)) {
            continue;
        }
        hole.length = 0;
        let edge = false;
        let rim = 0;
        let lit = 0;
        const stack = [s];
        seen[s] = 1;
        while (stack.length) {
            const i = stack.pop() as number;
            hole.push(i);
            const x = i % width;
            const y = (i - x) / width;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                edge = true;
            }
            const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
            for (const j of next) {
                if (j < 0 || seen[j] === 1) {
                    continue;
                }
                if (Number.isNaN(data[j] as number)) {
                    seen[j] = 1;
                    stack.push(j);
                } else {
                    rim++;
                    if ((px[j * 4] as number) >= bright) {
                        lit++;
                    }
                }
            }
        }
        if (edge || hole.length > maxHole || rim === 0 || lit < rim * 0.6) {
            continue;
        }
        for (const i of hole) {
            px[i * 4] = 255;
            px[i * 4 + 1] = 255;
            px[i * 4 + 2] = 255;
            px[i * 4 + 3] = 255;
        }
        filled++;
    }
    return filled;
}

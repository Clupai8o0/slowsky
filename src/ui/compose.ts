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

// A star too bright for the detector comes back as blank (NaN or infinite) pixels in its core, which
// renderRgba leaves see-through, so a black hole sits in a white star. Paint each such hole white when it
// is small, ringed mostly by near-white pixels, and clear of any other blank area: a pocket that touches
// the canvas border, or sits within 2 px of another blank area (a tilted detector edge, a gap), is no-data,
// not a saturated core. Holes are 8-connected so diagonal steps along an edge join it. Returns how many holes were filled.
export function fillCores(data: Float32Array, width: number, height: number, px: Uint8ClampedArray, bright = 200): number
{
    const n = width * height;
    if (data.length !== n || px.length !== n * 4) {
        return 0;
    }
    const blank = (i: number): boolean => !Number.isFinite(data[i] as number);
    const maxHole = Math.max(4, Math.floor(n * 0.02));
    const id = new Int32Array(n); // 0 = not visited, else hole number
    let filled = 0;
    let holeNo = 0;
    for (let s = 0; s < n; s++) {
        if (id[s] !== 0 || !blank(s)) {
            continue;
        }
        holeNo++;
        const hole: number[] = [];
        const stack = [s];
        id[s] = holeNo;
        let edge = false;
        while (stack.length) {
            const i = stack.pop() as number;
            hole.push(i);
            const x = i % width;
            const y = (i - x) / width;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
                edge = true;
            }
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        continue;
                    }
                    const j = ny * width + nx;
                    if (id[j] === 0 && blank(j)) {
                        id[j] = holeNo;
                        stack.push(j);
                    }
                }
            }
        }
        if (edge || hole.length > maxHole) {
            continue;
        }
        // Ring: the 4-neighbours that hold data. Nearby: any other blank pixel within 2 px means no-data.
        let rim = 0;
        let lit = 0;
        let nearOther = false;
        for (const i of hole) {
            const x = i % width;
            const y = (i - x) / width;
            for (let dy = -2; dy <= 2 && !nearOther; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        continue;
                    }
                    const j = ny * width + nx;
                    if (blank(j) && id[j] !== holeNo) {
                        nearOther = true;
                        break;
                    }
                    if (Math.abs(dx) + Math.abs(dy) === 1 && !blank(j)) {
                        rim++;
                        if ((px[j * 4] as number) >= bright) {
                            lit++;
                        }
                    }
                }
            }
            if (nearOther) {
                break;
            }
        }
        if (nearOther || rim === 0 || lit < rim * 0.6) {
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

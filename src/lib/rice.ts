export class RiceError extends Error {}

// Fresh bitstream implementation of the FITS tile convention, section 6.1:
// https://fits.gsfc.nasa.gov/registry/tilecompression/tilecompression2.3.pdf
// Rice splitting / fundamental sequence: CCSDS 121.0-B-3, sections 3.2-3.3.
// The FITS framing stores a seed, then nPixels differences (the first is zero).
// Selector 0 means zero differences; 1..fsMax mean fs = selector-1 low bits;
// fsMax+1 escapes to full-width mapped differences. All fields are MSB first.
export function riceDecode(bytes: Uint8Array, nPixels: number,
    opts: { blockSize: number; bytePix: 1 | 2 | 4 }): Int32Array
{
    if (!Number.isSafeInteger(nPixels) || nPixels < 0 || nPixels > 0x7fffffff
        || !Number.isSafeInteger(opts.blockSize) || opts.blockSize < 1
        || ![1, 2, 4].includes(opts.bytePix)) {
        throw new RiceError('Invalid RICE_1 pixel count or parameters');
    }
    let output: Int32Array;
    try {
        output = new Int32Array(nPixels);
    } catch {
        throw new RiceError('RICE_1 output is too large');
    }
    if (nPixels === 0) {
        if (bytes.length !== 0) {
            throw new RiceError('Over-long RICE_1 input');
        }
        return output;
    }
    let position = 0;
    function read(count: number): number
    {
        if (position + count > bytes.length * 8) {
            throw new RiceError('Truncated RICE_1 input');
        }
        let value = 0;
        while (count > 0) {
            const available = 8 - position % 8;
            const take = Math.min(count, available);
            const part = (bytes[Math.floor(position / 8)]! >> (available - take)) & (2 ** take - 1);
            value = value * 2 ** take + part;
            position += take;
            count -= take;
        }
        return value;
    }
    const pixelBits = opts.bytePix * 8;
    const selectorBits = opts.bytePix === 1 ? 3 : opts.bytePix === 2 ? 4 : 5;
    const fsMax = opts.bytePix === 1 ? 6 : opts.bytePix === 2 ? 14 : 25;
    const maxMapped = 2 ** pixelBits - 1;
    let previous = read(pixelBits);
    function restore(mapped: number): number
    {
        const half = Math.floor(mapped / 2);
        const delta = mapped % 2 === 0 ? half : -half - 1;
        previous = (previous + delta) | 0;
        if (opts.bytePix === 1) {
            previous &= 255;
        } else if (opts.bytePix === 2) {
            previous = (previous << 16) >> 16;
        }
        return previous;
    }
    for (let first = 0; first < nPixels; first += opts.blockSize) {
        const selector = read(selectorBits);
        if (selector > fsMax + 1) {
            throw new RiceError(`Unsupported RICE_1 selector ${selector}`);
        }
        const last = Math.min(nPixels, first + opts.blockSize);
        const fs = selector - 1;
        for (let i = first; i < last; i++) {
            let mapped = 0;
            if (selector === fsMax + 1) {
                mapped = read(pixelBits);
            } else if (selector !== 0) {
                let quotient = 0;
                const limit = Math.floor(maxMapped / 2 ** fs);
                while (read(1) === 0) {
                    quotient++;
                    if (quotient > limit) {
                        throw new RiceError('RICE_1 difference exceeds pixel width');
                    }
                }
                mapped = quotient * 2 ** fs + read(fs);
                if (mapped > maxMapped) {
                    throw new RiceError('RICE_1 difference exceeds pixel width');
                }
            }
            output[i] = restore(mapped);
        }
    }
    if (Math.ceil(position / 8) !== bytes.length) {
        throw new RiceError('Over-long RICE_1 input');
    }
    const padding = bytes.length * 8 - position;
    if (read(padding) !== 0) {
        throw new RiceError('Nonzero RICE_1 padding');
    }
    return output;
}

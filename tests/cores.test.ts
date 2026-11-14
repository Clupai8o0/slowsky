import { describe, expect, it } from 'vitest';
import { fillCores } from '../src/ui/compose';

function scene(w: number, h: number, nan: number[], brightAround: boolean): { data: Float32Array; px: Uint8ClampedArray }
{
    const data = new Float32Array(w * h).fill(1);
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const g = brightAround ? 250 : 20;
        px[i * 4] = g;
        px[i * 4 + 1] = g;
        px[i * 4 + 2] = g;
        px[i * 4 + 3] = 255;
    }
    for (const i of nan) {
        data[i] = NaN;
        px[i * 4] = 0;
        px[i * 4 + 1] = 0;
        px[i * 4 + 2] = 0;
        px[i * 4 + 3] = 0;
    }
    return { data, px };
}

describe('fillCores', () => {
    it('paints an enclosed blank core inside a bright star white', () => {
        const { data, px } = scene(5, 5, [12, 13], true);
        expect(fillCores(data, 5, 5, px)).toBe(1);
        expect(Array.from(px.slice(12 * 4, 12 * 4 + 4))).toEqual([255, 255, 255, 255]);
        expect(Array.from(px.slice(13 * 4, 13 * 4 + 4))).toEqual([255, 255, 255, 255]);
    });

    it('leaves a blank pixel in dark sky alone', () => {
        const { data, px } = scene(5, 5, [12], false);
        expect(fillCores(data, 5, 5, px)).toBe(0);
        expect(px[12 * 4 + 3]).toBe(0);
    });

    it('leaves blank areas that touch the edge (outside the footprint) alone', () => {
        const { data, px } = scene(5, 5, [0, 1, 5], true);
        expect(fillCores(data, 5, 5, px)).toBe(0);
        expect(px[3]).toBe(0);
    });

    it('leaves large holes alone', () => {
        const nan: number[] = [];
        for (let y = 5; y < 25; y++) {
            for (let x = 5; x < 25; x++) {
                nan.push(y * 30 + x);
            }
        }
        const { data, px } = scene(30, 30, nan, true);
        expect(fillCores(data, 30, 30, px)).toBe(0);
    });

    it('treats infinite pixels as blank too', () => {
        const { data, px } = scene(5, 5, [12], true);
        data[12] = Infinity;
        expect(fillCores(data, 5, 5, px)).toBe(1);
        expect(px[12 * 4 + 3]).toBe(255);
    });

    it('leaves a pocket next to a blank detector edge alone', () => {
        // A blank band down the left (no data off a tilted detector) and a 1-pixel pocket 2 px from it.
        const nan: number[] = [];
        for (let y = 0; y < 9; y++) {
            nan.push(y * 9);
        }
        nan.push(4 * 9 + 2);
        const { data, px } = scene(9, 9, nan, true);
        expect(fillCores(data, 9, 9, px)).toBe(0);
        expect(px[(4 * 9 + 2) * 4 + 3]).toBe(0);
    });

    it('joins diagonal steps into one blank area', () => {
        // A diagonal staircase that reaches the border is edge, not a core.
        const { data, px } = scene(7, 7, [0, 8, 16, 24], true);
        expect(fillCores(data, 7, 7, px)).toBe(0);
    });

    it('ignores mismatched sizes', () => {
        expect(fillCores(new Float32Array(4), 3, 3, new Uint8ClampedArray(36))).toBe(0);
    });
});

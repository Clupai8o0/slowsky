import { describe, expect, it, vi } from 'vitest';
import { HaloError, haloCurve, type HaloCurve, type HaloCurvePoint } from '../src/lib/halo';
import { gridPixToSky } from '../src/lib/regrid';
import type { GaiaStar, SkyResult, TrackPoint } from '../src/lib/source';
import type { FrameRecord, OutputGrid, PixelCoord, RegriddedFrame } from '../src/lib/types';
import { haloFor, haloHtml, type HaloView } from '../src/ui/halo-view';
import { frameMjd } from '../src/ui/measure';
import { renderHalo, type SlotView } from '../src/ui/slots';

const N = 160;
const grid: OutputGrid = { center: { ra: 10, dec: 20 }, fovDeg: (N * 1.5) / 3600, pixelArcsec: 1.5, width: N, height: N };
const MJD0 = 61000;
const TARGET = { x: 80, y: 80 };
const REFS = [{ x: 30, y: 30 }, { x: 130, y: 30 }, { x: 30, y: 130 }, { x: 130, y: 130 }];

// A bright star whose middle (r < 3 px) has no value, with a wide glow, four steady stars and a little noise.
function frame(k: number, glow: number, blankCore = true): RegriddedFrame
{
    let seed = 12345 + k;
    const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648 - 0.5;
    };
    const data = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const r2 = (x - TARGET.x) ** 2 + (y - TARGET.y) ** 2;
            let v = 10 + rand() + glow * Math.exp(-r2 / (2 * 10 * 10));
            for (const s of REFS) {
                v += 2000 * Math.exp(-((x - s.x) ** 2 + (y - s.y) ** 2) / (2 * 2 * 2));
            }
            data[y * N + x] = blankCore && r2 < 9 ? NaN : v;
        }
    }
    const rec = {
        obsId: `F${k}`, collection: 'spherex_dr1', release: 'DR1', detector: 1, url: '', tMin: MJD0 + k * 100, tMax: MJD0 + k * 100 + 0.01,
        lambdaMin: 0.75, lambdaMax: 1.1,
    } as unknown as FrameRecord;
    return { frame: rec, grid, data, lambdaAtCenter: 0.9, bandwidthAtCenter: 0.01 };
}

function star(id: string, at: PixelCoord, g: number): GaiaStar
{
    const c = gridPixToSky(grid, at);
    return { sourceId: id, ra: c.ra, dec: c.dec, g, epochJyear: 2016, pmRa: 0, pmDec: 0, pix: at };
}

function result(glows: number[], blankCore = true): SkyResult
{
    // Out of date order on purpose: the panel must not rely on it.
    const frames = glows.map((g, k) => frame(k, g, blankCore)).reverse();
    const track: TrackPoint[] = frames.map((f) => ({ mjd: frameMjd(f), ...grid.center, pix: TARGET }));
    return {
        source: 'live', grid, frames: frames.map((f) => ({ frame: f, label: '' })),
        locked: frames.map(() => ({ lambda: 0.9, dLambda: 0 })) as unknown as SkyResult['locked'],
        lambda: 0.9, stars: REFS.map((at, i) => star(`r${i}`, at, 11 + i)), credits: [], notes: [], track,
    };
}

const BANNED = /\b(changed|discover\w*|detected|confirm\w*|proves?)\b/i;

function point(mjd: number, over: Partial<HaloCurvePoint> = {}): HaloCurvePoint
{
    return {
        mjd, lambda: 0.9, target: { valid: true, sum: 100, noise: 1, snr: 100 } as HaloCurvePoint['target'], refSum: 1000,
        ratio: 0.1, relative: 1, valid: true, relativeNoise: 0.02, positionNoise: 0.5, caveats: [], ...over,
    };
}

// Halo round 10 fields; `as HaloCurve` keeps the stand-in valid with the module before and after them.
const R10 = { refSpread: [0.01, 0.01], refExcess: [0.5, 0.5], refBlind: 0.04, note: '', caveat: '', drawable: true, reason: '' };

function fake(points: HaloCurvePoint[], dropped = 0, extra: Partial<typeof R10> = {}): (...a: Parameters<typeof haloCurve>) => HaloCurve
{
    return (frames, target) => {
        // Ask for the target in date order, as the module does, so the panel can map points back to frames.
        frames.map((f, i) => ({ f, i })).sort((a, b) => a.f.frame.tMin - b.f.frame.tMin).forEach(({ f, i }) => {
            (target as (f: RegriddedFrame, i: number) => PixelCoord)(f, i);
        });
        return { points, dropped, refScatter: [0.01, 0.01, 0.01, 0.01], lambda: 0.9, ...R10, ...extra } as HaloCurve;
    };
}

const ring = () => ({ ringIn: 10, ringOut: 20, margin: 2, maxRadius: 12 }); // margin: halo round 10

describe('haloFor', () => {
    it('measures the ring with the real module and maps each look back to its frame', () => {
        const r = result([4000, 5000, 6000]);
        const h = haloFor(r)!;
        expect(h.kind).toBe('curve');
        expect(h.points).toHaveLength(3);
        expect(h.points.map((p) => p.mjd)).toEqual([...h.points.map((p) => p.mjd)].sort((a, b) => a - b));
        for (const p of h.points) {
            expect(frameMjd(r.frames[p.k]!.frame)).toBeCloseTo(p.mjd, 6);
            expect(Number.isFinite(p.err) && p.err > 0).toBe(true);
        }
        // Brighter glow, brighter ring: the earliest look (glow 4000) is lowest, the latest (6000) highest.
        expect(h.points[0]!.relative).toBeLessThan(h.points[2]!.relative);
        expect(h.ringIn).toBeGreaterThan(0);
        expect(h.ringOut).toBeGreaterThan(h.ringIn);
        expect(h.refs).toBeGreaterThanOrEqual(2);
    });

    it('stays out of the way when the centre is not blank', () => {
        expect(haloFor(result([4000, 5000, 6000], false))).toBeNull();
    });

    it('draws only valid looks with a finite error bar, and keeps every look\'s caveats with its date', () => {
        const r = result([5000, 5000, 5000]);
        const [a, b, c] = [MJD0 + 0.005, MJD0 + 100.005, MJD0 + 200.005];
        const h = haloFor(r, {
            ring,
            curve: fake([
                point(a, { caveats: ['Ring brightness is sensitive to the catalogue position.'] }),
                point(b, { valid: false, ratio: NaN, relative: NaN, relativeNoise: NaN, caveats: ['Position uncertainty cannot be measured.'] }),
                point(c, { relative: 1.1, caveats: ['Ring brightness is sensitive to the catalogue position.'] }),
            ]),
        })!;
        expect(h.kind).toBe('table');
        expect(h.points.map((p) => p.mjd)).toEqual([a, c]);
        expect(h.looks).toBe(3);
        expect(h.caveats).toEqual([
            { text: 'Ring brightness is sensitive to the catalogue position.', mjds: [a, c] },
            { text: 'Position uncertainty cannot be measured.', mjds: [b] },
        ]);
    });

    it('gives a table, not a line, under three looks, and says so with the visit count', () => {
        const r = result([5000, 5000]);
        const bad = { valid: false, relative: NaN, relativeNoise: NaN };
        const h = haloFor(r, { ring, curve: fake([point(MJD0, { lambda: 0.82 }), point(MJD0 + 3, { lambda: 0.84, relative: 1.06 })]) })!;
        expect(h.kind).toBe('table');
        const html = haloHtml(h, 'R Draconis', -1);
        expect(html).toContain('could be measured in 2 of 2 looks, taken on 1 visit. A curve is drawn only from looks on at least 3 visits, all within 0.005 µm of colour; these looks do not meet that, so each reading is listed instead.');
        expect(html).toContain('<table');
        expect(html).toMatch(/<button type="button" class="sk-halo-k" data-k="\d+" aria-label="Show the look of [^"]+">/);
        expect(html).not.toContain('<svg');
        expect(html).toContain('0.820 µm');
        expect(html).toContain('+6.0% ± 2.0%');
        expect(html).toContain('from 0.820 to 0.840 µm; looks at slightly different colours can read differently for that reason alone.');
        const none = haloFor(r, { ring, curve: fake([point(MJD0, bad), point(MJD0 + 100, bad)]) })!;
        expect(none.kind).toBe('none');
        expect(haloHtml(none, 'R Draconis', -1)).toContain('could be measured in 0 of 2 looks. A curve is drawn only');
    });

    it('handles one reading, float edges of the colour span, chained visits and repeated caveat dates', () => {
        const r = result([5000, 5000, 5000]);
        const bad = { valid: false, relative: NaN, relativeNoise: NaN };
        const c = 'Ring brightness is sensitive to the catalogue position.';
        const one = haloFor(r, { ring, curve: fake([point(MJD0, { caveats: [c] }), point(MJD0 + 0.3, { ...bad, caveats: [c] }), point(MJD0 + 100, bad)]) })!;
        const html1 = haloHtml(one, 'R Draconis', -1);
        expect(html1).toContain('one reading, nothing to compare (noise ± 2.0%)');
        expect(html1).toContain('so the one reading is listed instead.');
        expect(html1).toMatch(/^<p class="sk-body mute">Near 0\.90 µm, /);
        expect(html1).not.toContain('+0.0%');
        expect(html1.match(/\d+ \w+ \d{4}(, \d+ \w+ \d{4})*: Ring brightness/)![0].split(',').length).toBe(1);
        const edge = haloFor(r, { ring, curve: fake([point(MJD0, { lambda: 1 }), point(MJD0 + 8, { lambda: 1.005 })]) })!;
        expect(haloHtml(edge, 'R Draconis', -1)).toContain('from 1.000 to 1.005 µm');
        const chain = haloFor(r, { ring, curve: fake([point(MJD0), point(MJD0 + 8), point(MJD0 + 16)]) })!;
        expect(haloHtml({ ...chain, kind: 'table' }, 'R Draconis', -1)).toContain('taken on 1 visit');
    });

    it('draws a line only from 3 or more visits inside one 0.005 µm colour window', () => {
        const r = result([5000, 5000, 5000]);
        const at = (lams: number[], gaps = 100) => haloFor(r, { ring, curve: fake(lams.map((l, i) => point(MJD0 + i * gaps, { lambda: l }))) })!.kind;
        expect(at([0.9396, 0.9420, 0.9446])).toBe('curve');
        expect(at([0.92, 0.93, 0.94])).toBe('table'); // three visits, but 0.02 µm apart
        expect(at([0.9, 0.9, 0.9], 3)).toBe('table'); // one colour, but one visit
        expect(at([0.9, 0.9, 0.9, 0.9, 0.9], 9)).toBe('table'); // looks 9 days apart chain into one visit, as elsewhere on the page
        expect(haloHtml(haloFor(r, { ring, curve: fake([point(MJD0, { lambda: 0.92 }), point(MJD0 + 100, { lambda: 0.93 }),
            point(MJD0 + 200, { lambda: 0.94 })]) })!, 'R Draconis', -1)).toContain('taken on 3 visits. A curve is drawn only');
    });

    it('names catalogued stars whose light falls in the ring', () => {
        const r = result([5000, 5000, 5000]);
        r.stars.push(star('inring', { x: TARGET.x + 15, y: TARGET.y }, 14.24), star('far', { x: TARGET.x, y: TARGET.y + 40 }, 12));
        const h = haloFor(r, { ring, curve: fake([point(MJD0), point(MJD0 + 100), point(MJD0 + 200)]) })!;
        expect(h.ringStars).toEqual([14.24]);
        expect(haloHtml(h, 'R Draconis', -1)).toContain('A catalogued Gaia star (G 14.2) sits in or at the edge of the ring, so some of its light is in every reading.');
    });

    it('drops comparison stars whose own sky ring reaches the halo ring, and hides with fewer than two left', () => {
        const r = result([5000, 5000, 5000]);
        const curve = vi.fn(fake([point(MJD0), point(MJD0 + 100), point(MJD0 + 200)]));
        // REFS sit about 71 px from the target: a ring out to 60 px leaves no room for their own sky ring.
        expect(haloFor(r, { ring: () => ({ ringIn: 10, ringOut: 60, margin: 2, maxRadius: 12 }), curve })).toBeNull();
        expect(curve).not.toHaveBeenCalled();
        expect(haloFor(r, { ring, curve })!.refs).toBeGreaterThanOrEqual(2);
        // Four bright stars too close and two fainter ones far enough out: the fainter two are used.
        const near = [{ x: 120, y: 80 }, { x: 40, y: 80 }, { x: 80, y: 120 }, { x: 80, y: 40 }]; // 40 px out: past the default cut, inside 20 + sky ring
        const r2 = result([5000, 5000, 5000]);
        r2.stars = [...near.map((at, i) => star(`n${i}`, at, 9.5 + i * 0.1)), star('f0', REFS[0]!, 14), star('f1', REFS[3]!, 14.5)];
        const h2 = haloFor(r2, { ring: () => ({ ringIn: 5, ringOut: 20, margin: 2, maxRadius: 12 }), curve })!;
        expect(h2.refs).toBe(2);
    });

    it('asks for a wider field when the ring does not fit, and hides on other module errors', () => {
        const r = result([5000, 5000]);
        const noFit = () => {
            throw new HaloError('The ring does not fit in the picture: use a wider view');
        };
        expect(haloFor(r, { ring: noFit })!.kind).toBe('nofit');
        const other = () => {
            throw new HaloError('A blank area reaches the ring in every frame');
        };
        expect(haloFor(r, { ring: other })).toBeNull();
        const bad = () => {
            throw new HaloError('At least one reference star is required');
        };
        expect(haloFor(r, { ring, curve: bad })).toBeNull();
    });
});

describe('haloHtml', () => {
    const view: HaloView = {
        kind: 'curve', lambda: 0.912, ringIn: 15.04, ringOut: 33.5, refs: 3, looks: 3, dropped: 1,
        points: [{ mjd: MJD0, k: 2, lambda: 0.912, relative: 0.95, err: 0.02 }, { mjd: MJD0 + 90, k: 1, lambda: 0.912, relative: 1, err: 0.02 },
            { mjd: MJD0 + 180, k: 0, lambda: 0.912, relative: 1.05, err: 0.03 }],
        caveats: [{ text: 'Ring <b>sensitive</b>', mjds: [MJD0] }], ringStars: [],
    };

    it('says what was measured, marks the look on screen, and escapes module text', () => {
        const html = haloHtml(view, 'R Draconis', 0);
        expect(html).toContain('At 0.91 µm: the light in a ring 15″ to 34″ from R Draconis’s centre');
        expect(html).toContain('measured against 3 nearby comparison stars from Gaia');
        expect(html).toContain('1 frame was too far off this colour.');
        expect(html).not.toContain('could not be measured');
        expect(html).not.toContain('different colours');
        expect(html).toContain('class="on" data-k="0"');
        expect(html).toContain('class="" data-k="2"');
        expect(html).toContain('Ring &lt;b&gt;sensitive&lt;/b&gt;');
        expect(html).not.toMatch(BANNED);
        expect(html).not.toMatch(/border-radius|999px/);
    });

    it('never claims more than was measured, in any state', () => {
        for (const kind of ['curve', 'table', 'none', 'nofit'] as const) {
            expect(haloHtml({ ...view, kind }, 'R Draconis', -1)).not.toMatch(BANNED);
        }
        expect(haloHtml({ ...view, kind: 'nofit' }, 'R Draconis', -1)).toContain('Choose a wider field');
    });
});

describe('renderHalo', () => {
    const box = () => ({ innerHTML: '' }) as unknown as HTMLElement;
    const v = (r: SkyResult, over: Partial<SlotView> = {}): SlotView => ({ result: r, targetId: 'rdra', index: 0, mode: 'blink', source: 'live', ...over });

    it('measures once per result and only rewrites the panel when it changes', () => {
        const r = result([5000, 5000, 5000]);
        const curve = vi.fn(fake([point(MJD0 + 0.005), point(MJD0 + 100.005, { relative: 1.1 }), point(MJD0 + 200.005)]));
        const b = box();
        expect(renderHalo(b, v(r), { ring, curve })).toBe(true);
        const first = b.innerHTML;
        expect(first).toContain('R Draconis’s centre');
        expect(renderHalo(b, v(r), { ring, curve })).toBe(true);
        expect(renderHalo(b, v(r, { index: 1 }), { ring, curve })).toBe(true);
        expect(curve.mock.calls.length).toBeLessThanOrEqual(2); // one measure, at most one more after dropping a star
        expect(b.innerHTML).not.toBe(first);
    });

    it('shows nothing on the simulated sky, or for a target whose card does not say its centre is too bright', () => {
        const r = result([5000, 5000, 5000]);
        const curve = vi.fn(fake([point(MJD0 + 0.005), point(MJD0 + 100.005), point(MJD0 + 200.005)]));
        expect(renderHalo(box(), v(r, { source: 'demo' }), { ring, curve })).toBe(false);
        for (const targetId of ['barnard', 'rwaur', undefined]) {
            expect(renderHalo(box(), v(r, { targetId }), { ring, curve })).toBe(false);
        }
        expect(curve).not.toHaveBeenCalled();
    });
});

describe('halo round 10', () => {
    const three = () => [point(MJD0), point(MJD0 + 100, { relative: 1.04 }), point(MJD0 + 200)];

    it('draws no line when the module says it cannot, and prints its reason, caveat and note', () => {
        const r = result([5000, 5000, 5000]);
        const caveat = 'The comparison stars do not hold steady against each other (they differ by more than their noise allows), so these readings may be off.';
        const h = haloFor(r, { ring, curve: fake(three(), 0, { drawable: false, reason: 'The comparison stars do not hold steady against each other', caveat }) })!;
        expect(h.kind).toBe('table');
        const html = haloHtml(h, 'R Draconis', -1);
        expect(html).toContain('No curve is drawn: the comparison stars do not hold steady against each other. Each reading is listed below.');
        expect(html).not.toContain('these looks do not meet that');
        expect(html).toContain(`<p class="sk-body mute">${caveat}</p>`);
        expect(html).not.toContain('<svg');
        expect(html).not.toMatch(BANNED);
    });

    it('keeps the table under a drawn line and prints the module note', () => {
        const r = result([5000, 5000, 5000]);
        const note = 'A change in one comparison star could shift these readings by up to about 4% without being caught here.';
        const h = haloFor(r, { ring, curve: fake(three(), 0, { note }) })!;
        expect(h.kind).toBe('curve');
        const html = haloHtml(h, 'R Draconis', -1);
        expect(html).toContain('<svg');
        expect(html).toContain('<table class="sk-halo-t">');
        expect(html).toContain(`<p class="sk-body mute">${note}</p>`);
        expect(html.indexOf('</svg>')).toBeLessThan(html.indexOf('<table'));
    });

    it('a module that says nothing new leaves the old wording', () => {
        const r = result([5000, 5000, 5000]);
        const h = haloFor(r, { ring, curve: fake([point(MJD0), point(MJD0 + 100)]) })!;
        expect(h.kind).toBe('table');
        expect(haloHtml(h, 'R Draconis', -1)).toContain('these looks do not meet that');
    });
});

describe('halo round 10, review', () => {
    it('gives the panel rule too when the module reason is not the only block, and copes with a blank reason', () => {
        const r = result([5000, 5000, 5000]);
        const spread = [point(MJD0, { lambda: 0.9 }), point(MJD0 + 100, { lambda: 0.91 }), point(MJD0 + 200, { lambda: 0.92 })];
        const both = haloHtml(haloFor(r, { ring, curve: fake(spread, 0, { drawable: false, reason: 'The blank middle is larger in 1 look than the ring allows' }) })!, 'R Draconis', -1);
        expect(both).toContain('No curve is drawn: the blank middle is larger in 1 look than the ring allows. A curve is drawn only from looks on at least 3 visits, all within 0.005 µm of colour; these looks do not meet that either. Each reading is listed below.');
        const blank = haloHtml(haloFor(r, { ring, curve: fake(three(), 0, { drawable: false, reason: ' ' }) })!, 'R Draconis', -1);
        expect(blank).toContain('taken on 3 visits. No curve is drawn. Each reading is listed below.');
        expect(blank).not.toContain('do not meet that');
    });

    const three = () => [point(MJD0), point(MJD0 + 100, { relative: 1.04 }), point(MJD0 + 200)];
});

describe('halo round 11 view', () => {
    const three = () => [point(MJD0), point(MJD0 + 100, { relative: 1.04 }), point(MJD0 + 200)];
    const agree = 'The comparison stars were checked against each other in every look and agree within their noise.';

    it('names a comparison star the panel left out before the module\'s check', () => {
        const r = result([5000, 5000, 5000]);
        let first = -1;
        const base = fake(three(), 0, { note: agree });
        const curve: typeof haloCurve = (frames, target, refs, opts) => {
            first = first < 0 ? refs.length : first;
            const lc = base(frames, target, refs, opts);
            // The first comparison star scatters far more than the rest only while all of them are measured.
            return { ...lc, refScatter: refs.map((_, i) => (i === 0 && refs.length === first ? 1 : 0.01)) };
        };
        const h = haloFor(r, { ring, curve })!;
        expect(first).toBeGreaterThan(2);
        expect(h.leftOut).toBe(1);
        expect(h.refs).toBe(first - 1);
        const html = haloHtml(h, 'R Draconis', -1);
        const out = '<p class="sk-body mute">One comparison star was left out because its readings scattered far more from look to look than the other comparison stars’ did.</p>';
        expect(html).toContain(`${out}<p class="sk-body mute">${agree}</p>`);
        expect(html).not.toMatch(BANNED);
    });

    it('says nothing about left-out stars when none were', () => {
        const h = haloFor(result([5000, 5000, 5000]), { ring, curve: fake(three(), 0, { note: agree }) })!;
        expect(h.leftOut).toBe(0);
        expect(haloHtml(h, 'R Draconis', -1)).not.toContain('left out');
    });

    it('hides the module note when it gives a reason against a curve, and keeps its caveat', () => {
        const caveat = 'The blank middle is larger in 1 look than the ring, so these readings may be off.';
        const h = haloFor(result([5000, 5000, 5000]), { ring, curve: fake(three(), 0,
            { drawable: false, reason: 'The blank middle is larger in 1 look than the ring allows', caveat, note: agree }) })!;
        const html = haloHtml(h, 'R Draconis', -1);
        expect(html).toContain('No curve is drawn: the blank middle');
        expect(html).toContain(`<p class="sk-body mute">${caveat}</p>`);
        expect(html).not.toContain('agree');
    });
});

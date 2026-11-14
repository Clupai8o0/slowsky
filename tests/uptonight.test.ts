import { describe, expect, it } from 'vitest';
import fixture from './fixtures/uptonight-astropy.json';
import { altAz, MELBOURNE, upTonight, type UpTonight } from '../src/lib/uptonight';
import { upTonightText } from '../src/ui/uptonight-view';

const ms = (s: string) => new Date(s).getTime();
const circle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
const get = (id: string, now = '2026-11-15T02:00:00Z') => fixture.cases.find((c) => c.id === id && c.now === now)!;
const solve = (c: typeof fixture.cases[number]) => upTonight(c.ra, c.dec, new Date(c.now))!;

describe('astropy fixture', () => {
    it.each(fixture.cases)('matches astropy: $id at $now', (c) => {
            const r = solve(c);
            expect(r, c.id).not.toBeNull();
            expect(Math.abs(+r.darkStart - ms(c.darkStart)), c.id).toBeLessThanOrEqual(90000);
            expect(Math.abs(+r.darkEnd - ms(c.darkEnd)), c.id).toBeLessThanOrEqual(90000);
            expect(Math.abs(r.bestAltDeg - c.bestAltDeg), c.id).toBeLessThanOrEqual(0.25);
            expect(r.inside).toBe(c.inside);
            expect(Math.abs(+r.from - ms(c.from))).toBeLessThanOrEqual(90000);
            if (c.id !== 'south-pole') {
                const target = c.bestAtStart ? +r.from : c.bestAtEnd ? +r.darkEnd : ms(c.best);
                expect(Math.abs(+r.best - target), c.id).toBeLessThanOrEqual(c.bestAtStart || c.bestAtEnd ? 90000 : 180000);
            }
            if (c.bestAltDeg <= 85) {
                expect(circle(r.bestAzDeg, c.bestAzDeg), c.id).toBeLessThanOrEqual(1);
            }
            expect(+r.best).toBeGreaterThanOrEqual(+r.from - 1000);
            expect(+r.best).toBeLessThanOrEqual(+r.darkEnd + 1000);
            if (c.inside && c.bestAtStart && c.altAfter10 < c.bestAltDeg - 0.05) {
                expect(r.sinking, c.id).toBe(true);
            }
            if (!c.inside || !c.bestAtStart) {
                expect(r.sinking, c.id).toBe(false);
            }
            expect(r.bestAltDeg).toBeLessThanOrEqual(r.maxAltDeg + 0.05);
            const p = altAz(c.ra, c.dec, r.best);
            expect(p.altDeg).toBeCloseTo(r.bestAltDeg, 9);
            expect(p.azDeg).toBeCloseTo(r.bestAzDeg, 9);
            expect(+r.darkEnd - +r.darkStart).toBeGreaterThan(6 * 3600000);
            expect(+r.darkEnd - +r.darkStart).toBeLessThan(13 * 3600000);
            expect(Math.abs(r.maxAltDeg - c.dayMaxAltDeg), c.id).toBeLessThanOrEqual(0.25);
    });
    it('retains an ongoing window and advances after it', () => {
        const c = get('barnard');
        const r = solve(c);
        const inside = new Date((+r.darkStart + +r.darkEnd) / 2);
        const during = upTonight(c.ra, c.dec, inside)!;
        expect(+during.darkStart).toBeLessThan(+inside);
        expect(Math.abs(+during.darkStart - +r.darkStart)).toBeLessThan(1000);
        const next = upTonight(c.ra, c.dec, new Date(+r.darkEnd + 60000))!;
        expect(+next.darkStart).toBeGreaterThan(+r.darkEnd);
    });
});

describe('sentences', () => {
    const base: UpTonight = { darkStart: new Date('2026-11-14T09:00:00Z'), from: new Date('2026-11-14T09:00:00Z'), darkEnd: new Date('2026-11-14T18:30:00Z'), best: new Date('2026-11-14T10:14:00Z'), bestAltDeg: 15, bestAzDeg: 0, maxAltDeg: 20, inside: false, sinking: false };
    const note = 'Times are Melbourne time. Dark means the Sun is more than 12° below the horizon, here from 20:00 to 05:30. This says where the spot is in the sky, not whether anything can be seen there.';
    const cases: [string, Partial<UpTonight>, string, string][] = [
        ['never rises', { maxAltDeg: -2 }, 'This spot never rises above the horizon from Melbourne.', ''],
        ['below', { bestAltDeg: -2 }, 'Tonight from Melbourne: below the horizon while it is dark.', note],
        ['horizon', { bestAltDeg: -0.4 }, 'Tonight from Melbourne: highest in the dark at 21:14, near the horizon, facing north.', note],
        ['horizon sinking', { bestAltDeg: 0, inside: true, sinking: true }, 'For the rest of the night from Melbourne: near the horizon now, and lower after that, facing north.', note],
        ['low', { bestAltDeg: 5 }, 'Tonight from Melbourne: very low, at most about 5° above the horizon, at 21:14, facing north.', note],
        ['low sinking', { bestAltDeg: 5, inside: true, sinking: true }, 'For the rest of the night from Melbourne: very low, about 5° above the horizon now, and lower after that, facing north.', note],
        ['high', {}, 'Tonight from Melbourne: highest in the dark at 21:14, about 15° above the horizon, facing north.', note],
        ['high sinking', { inside: true, sinking: true }, 'For the rest of the night from Melbourne: about 15° above the horizon now, and lower after that, facing north.', note],
        ['overhead', { bestAltDeg: 85 }, 'Tonight from Melbourne: highest in the dark at 21:14, about 85° above the horizon, almost overhead.', note],
        ['overhead sinking', { bestAltDeg: 85, inside: true, sinking: true }, 'For the rest of the night from Melbourne: about 85° above the horizon now, almost overhead, and lower after that.', note],
    ];
    it.each(cases)('prints %s exactly', (_name, changes, line, expectedNote) => {
        const text = upTonightText({ ...base, ...changes })!;
        expect(text).toEqual({ line, note: expectedNote });
        expect(text.line).not.toMatch(/visible|can be seen/i);
        expect(text.note.replace('not whether anything can be seen there', '')).not.toMatch(/visible|can be seen/i);
    });
    it('handles null, horizon tolerance and rounded branch boundaries', () => {
        expect(upTonightText(null)).toBeNull();
        expect(upTonightText({ ...base, maxAltDeg: -0.5, bestAltDeg: -0.4 })!.line).toBe('Tonight from Melbourne: highest in the dark at 21:14, near the horizon, facing north.');
        expect(upTonightText({ ...base, bestAltDeg: 79.6 })!.line).toBe('Tonight from Melbourne: highest in the dark at 21:14, about 80° above the horizon, almost overhead.');
        expect(upTonightText({ ...base, bestAltDeg: 9.6 })!.line).toBe('Tonight from Melbourne: highest in the dark at 21:14, about 10° above the horizon, facing north.');
        expect(upTonightText({ ...base, bestAltDeg: -0.4 })!.line).not.toContain('-0');
        expect(upTonightText({ ...base, bestAltDeg: -2, inside: true })!.line).toBe('For the rest of the night from Melbourne: below the horizon while it is dark.');
    });
    it('clamps rounded times within the remaining window', () => {
        const end = new Date('2026-11-14T18:12:59.400Z');
        expect(upTonightText({ ...base, darkEnd: end, best: end })!.line).toContain('at 05:12');
        const from = new Date('2026-11-14T16:00:20Z');
        expect(upTonightText({ ...base, from, best: from, inside: true })!.line).toContain('at 03:01');
        expect(upTonightText({ ...base, from: new Date('2026-11-14T18:12:30Z'), darkEnd: end, best: end })!.line).toContain('at 05:12');
    });
    it('describes the real sinking case as now', () => {
        const r = upTonight(348.5, -39.58, new Date('2026-11-14T16:00:00Z'))!;
        const text = upTonightText(r)!;
        expect(text.line).toContain('now, and lower after that');
        expect(text.line).not.toContain('21:14');
    });
    it('says "now" for a spot going down in the last minutes of the dark, never "highest"', () => {
        const first = upTonight(331.04414658852124, -56.782844195116105, new Date('2026-11-15T16:00:00Z'))!;
        for (const left of [61000, 90000, 9 * 60000]) {
            const r = upTonight(331.04414658852124, -56.782844195116105, new Date(+first.darkEnd - left))!;
            expect(r.inside, String(left)).toBe(true);
            expect(r.sinking, String(left)).toBe(true);
            const line = upTonightText(r)!.line;
            expect(line, String(left)).toContain('now, and lower after that');
            expect(line, String(left)).not.toContain('highest');
        }
    });
    it('speaks about the next dark when under a minute of this one is left', () => {
        const first = upTonight(331.04414658852124, -56.782844195116105, new Date('2026-11-15T16:00:00Z'))!;
        const next = upTonight(331.04414658852124, -56.782844195116105, new Date(+first.darkEnd + 60000))!;
        for (const left of [5000, 30000, 59000]) {
            const r = upTonight(331.04414658852124, -56.782844195116105, new Date(+first.darkEnd - left))!;
            expect(r.inside, String(left)).toBe(false);
            expect(r.sinking, String(left)).toBe(false);
            expect(Math.abs(+r.darkStart - +next.darkStart), String(left)).toBeLessThan(1000);
            expect(+r.darkStart, String(left)).toBeGreaterThan(+first.darkEnd);
            expect(upTonightText(r)!.line, String(left)).toMatch(/^Tonight from Melbourne: /);
        }
    });
    it('never prints a clock minute outside what is left of the dark', () => {
        const night = upTonight(0, -70, new Date('2026-11-15T16:00:00Z'))!;
        for (let ra = 0; ra < 360; ra += 15) {
            for (const dec of [-89.9, -70, -40, -10, 20]) {
                for (const left of [61000, 75000, 119000, 5 * 60000]) {
                    const now = +night.darkEnd - left;
                    const r = upTonight(ra, dec, new Date(now))!;
                    expect(r.inside).toBe(true);
                    expect(Math.ceil(+r.from / 60000) * 60000, `${ra} ${dec} ${left}`).toBeLessThanOrEqual(Math.floor(+r.darkEnd / 60000) * 60000);
                    const at = upTonightText(r)!.line.match(/ at (\d\d):(\d\d)/);
                    if (at) {
                        const printed = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
                        const minutes = [];
                        for (let m = Math.ceil(now / 60000) * 60000; m <= +r.darkEnd; m += 60000) { minutes.push(printed.format(new Date(m))); }
                        expect(minutes, `${ra} ${dec} ${left}`).toContain(`${at[1]}:${at[2]}`);
                    }
                }
            }
        }
    });
    it('calls a spot sinking when it goes down through the last minutes towards its lowest point', () => {
        const night = upTonight(0, -70, new Date('2026-11-15T16:00:00Z'))!;
        let found = 0;
        for (let ra = 0; ra < 360; ra += 0.25) {
            const now = +night.darkEnd - 90000;
            const here = altAz(ra, -70, new Date(now)).altDeg;
            const end = altAz(ra, -70, night.darkEnd).altDeg;
            const after = altAz(ra, -70, new Date(+night.darkEnd + 240000)).altDeg;
            if (end < here - 1e-6 && after > end) {
                found++;
                const r = upTonight(ra, -70, new Date(now))!;
                expect(r.sinking, String(ra)).toBe(true);
                expect(upTonightText(r)!.line, String(ra)).toContain('now, and lower after that');
            }
        }
        expect(found).toBeGreaterThan(0);
    });
    it('"now, and lower after that" holds for every later minute, also for a spot that dips and comes part of the way back', () => {
        const night = upTonight(0, -70, new Date('2026-11-15T16:00:00Z'))!;
        let said = 0;
        for (let ra = 0; ra < 360; ra += 7.5) {
            for (const dec of [-89.5, -80, -70, -60, -53, -20, 10]) {
                for (const left of [39 * 60000, 3 * 3600000]) {
                    const now = new Date(+night.darkEnd - left);
                    const r = upTonight(ra, dec, now)!;
                    const line = upTonightText(r)!.line;
                    const here = altAz(ra, dec, now).altDeg;
                    let later = -Infinity;
                    for (let at = +now + 60000; at <= +r.darkEnd; at += 60000) {
                        later = Math.max(later, altAz(ra, dec, new Date(at)).altDeg);
                    }
                    if (line.includes('lower after that')) {
                        said++;
                        expect(later, `${ra} ${dec} ${left}`).toBeLessThan(here);
                    } else if (line.includes('highest in the dark')) {
                        expect(later, `${ra} ${dec} ${left}`).toBeGreaterThan(here - 1e-6);
                    }
                }
            }
        }
        expect(said).toBeGreaterThan(100);
    });
    it('prints the dark hours in the note, start rounded up and end rounded down', () => {
        const text = upTonightText({ ...base, darkStart: new Date('2026-11-14T09:00:20Z'), darkEnd: new Date('2026-11-14T18:29:59Z') })!;
        expect(text.note).toContain('here from 20:01 to 05:29.');
        const real = upTonight(76.95652603458333, 30.401438173888888, new Date('2026-11-15T18:30:00Z'))!;
        const said = upTonightText(real)!;
        expect(said.line).toMatch(/^Tonight from Melbourne: highest in the dark at 02:4\d/);
        expect(said.note).toMatch(/here from 21:1\d to 04:5\d\./);
    });
    it('formats daylight saving, directions and rounded zero', () => {
        expect(upTonightText(base)!.line).toContain('21:14');
        expect(upTonightText({ ...base, from: new Date('2026-06-21T06:00:00Z'), darkEnd: new Date('2026-06-21T08:00:00Z'), best: new Date('2026-06-21T07:00:00Z') })!.line).toContain('17:00');
        const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north'];
        for (let i = 0; i < 8; i++) {
            expect(upTonightText({ ...base, bestAzDeg: 22.4 + i * 45 })!.line).toContain(`facing ${dirs[i]}.`);
            expect(upTonightText({ ...base, bestAzDeg: 22.6 + i * 45 })!.line).toContain(`facing ${dirs[i + 1]}.`);
        }
        expect(upTonightText({ ...base, bestAltDeg: -0 })!.line).toContain('near the horizon');
        expect(upTonightText({ ...base, bestAltDeg: 15 })!.line).not.toContain('very low');
    });
});

describe('invalid inputs and invariants', () => {
    it('rejects invalid inputs and handles wrapped RA and polar observers', () => {
        const date = new Date('2026-12-21T00:00:00Z');
        for (const [ra, dec, d] of [[NaN, 0, date], [Infinity, 0, date], [0, 91, date], [0, 0, new Date(NaN)]] as const) {
            expect(upTonight(ra, dec, d)).toBeNull();
        }
        expect(upTonight(360.5, 0, date)).toEqual(upTonight(0.5, 0, date));
        expect(upTonight(0, 0, date, { ...MELBOURNE, latDeg: 89 })).toBeNull();
        const south = upTonight(0, 0, new Date('2026-06-21T00:00:00Z'), { ...MELBOURNE, latDeg: -89 });
        if (south) {
            expect(Object.values(south).every((x) => typeof x === 'boolean' || Number.isFinite(x instanceof Date ? +x : x))).toBe(true);
        }
    });
    it('keeps 300 seeded positions finite and internally consistent', () => {
        let seed = 1789;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
        for (let i = 0; i < 300; i++) {
            const ra = random() * 720 - 180;
            const dec = random() * 180 - 90;
            const date = new Date(Date.UTC(2026, 0, 1) + random() * 365 * 86400000);
            const r = upTonight(ra, dec, date)!;
            expect(r).not.toBeNull();
            expect(Object.values(r).every((x) => typeof x === 'boolean' || Number.isFinite(x instanceof Date ? +x : x))).toBe(true);
            expect(+r.best).toBeGreaterThanOrEqual(+r.from);
            expect(+r.best).toBeLessThanOrEqual(+r.darkEnd);
            expect(r.bestAltDeg).toBeLessThanOrEqual(r.maxAltDeg + 0.05);
            expect(altAz(ra, dec, r.best)).toEqual({ altDeg: r.bestAltDeg, azDeg: r.bestAzDeg });
        }
    });
});

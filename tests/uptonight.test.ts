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
            const edge = Math.abs(ms(c.best) - ms(c.darkStart)) < Math.abs(ms(c.best) - ms(c.darkEnd)) ? r.darkStart : r.darkEnd;
            expect(Math.abs(+r.best - (c.bestAtEdge ? +edge : ms(c.best))), c.id).toBeLessThanOrEqual(c.bestAtEdge ? 90000 : 180000);
            if (c.bestAltDeg < 85) {
                expect(circle(r.bestAzDeg, c.bestAzDeg), c.id).toBeLessThanOrEqual(1);
            }
            expect(+r.best).toBeGreaterThanOrEqual(+r.darkStart);
            expect(+r.best).toBeLessThanOrEqual(+r.darkEnd);
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
    it('prints each fixture category with the expected time', () => {
        const cases: [string, RegExp][] = [
            ['rdra', /^This spot never rises above the horizon from Melbourne\.$/],
            ['grazes-north', /^Tonight from Melbourne: below the horizon while it is dark\.$/],
            ['barnard', /^Tonight from Melbourne: very low, at most about \d+° above the horizon, at \d\d:\d\d, facing [a-z-]+\.$/],
            ['rwaur', /^Tonight from Melbourne: highest in the dark at \d\d:\d\d, about \d+° above the horizon, facing [a-z-]+\.$/],
            ['overhead', /^Tonight from Melbourne: highest in the dark at \d\d:\d\d, about \d+° above the horizon, almost overhead\.$/],
        ];
        for (const [id, pattern] of cases) {
            const c = get(id);
            const text = upTonightText(solve(c))!;
            expect(text.line, id).toMatch(pattern);
            expect(text.line).not.toMatch(/visible|telescope|see it|observable/i);
            expect(text.note).toBe(id === 'rdra' ? '' : 'Times are Melbourne time. Dark means the Sun is more than 12° below the horizon. This says where the spot is in the sky, not whether anything can be seen there.');
            const time = text.line.match(/(\d\d):(\d\d)/);
            if (time) {
                const ref = new Intl.DateTimeFormat('en-GB', { timeZone: MELBOURNE.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(c.best));
                const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
                const delta = Math.abs(minutes(time[0]) - minutes(ref));
                expect(Math.min(delta, 1440 - delta)).toBeLessThanOrEqual(3);
            }
        }
        expect(upTonightText(null)).toBeNull();
    });
    it('formats daylight saving, directions and rounded zero', () => {
        const base: UpTonight = { darkStart: new Date(), darkEnd: new Date(), best: new Date('2026-11-15T10:14:00Z'), bestAltDeg: 15, bestAzDeg: 0, maxAltDeg: 20 };
        expect(upTonightText(base)!.line).toContain('21:14');
        expect(upTonightText({ ...base, best: new Date('2026-06-21T07:00:00Z') })!.line).toContain('17:00');
        const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north'];
        for (let i = 0; i < 8; i++) {
            expect(upTonightText({ ...base, bestAzDeg: 22.4 + i * 45 })!.line).toContain(`facing ${dirs[i]}.`);
            expect(upTonightText({ ...base, bestAzDeg: 22.6 + i * 45 })!.line).toContain(`facing ${dirs[i + 1]}.`);
        }
        expect(upTonightText({ ...base, bestAltDeg: -0 })!.line).toContain('about 0°');
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
            expect(Object.values(south).every((x) => Number.isFinite(x instanceof Date ? +x : x))).toBe(true);
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
            expect(Object.values(r).every((x) => Number.isFinite(x instanceof Date ? +x : x))).toBe(true);
            expect(+r.best).toBeGreaterThanOrEqual(+r.darkStart);
            expect(+r.best).toBeLessThanOrEqual(+r.darkEnd);
            expect(r.bestAltDeg).toBeLessThanOrEqual(r.maxAltDeg + 0.05);
            expect(altAz(ra, dec, r.best)).toEqual({ altDeg: r.bestAltDeg, azDeg: r.bestAzDeg });
        }
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDec, formatRa, parseCoords, resolveName, separationDeg } from '../src/lib/coords';

const RW_AUR = { ra: 76.95625, dec: 30.4014 };

describe('parseCoords', () => {
    it('accepts a doubled-apostrophe arcsecond marker', () => {
        expect(parseCoords("12h30m +20d30'00''")).toEqual({ ra: 187.5, dec: 20.5 });
    });

    it('reads decimal degrees in several spellings', () => {
        expect(parseCoords('76.956 30.401')).toEqual({ ra: 76.956, dec: 30.401 });
        expect(parseCoords('76.956, +30.401')).toEqual({ ra: 76.956, dec: 30.401 });
        expect(parseCoords('76.956d 30.401d')).toEqual({ ra: 76.956, dec: 30.401 });
    });

    it('reads sexagesimal with letters, colons and spaces (RA in hours)', () => {
        const a = parseCoords('05h07m49.5s +30d24m05s');
        const b = parseCoords('05:07:49.5 +30:24:05');
        const c = parseCoords('05 07 49.5 +30 24 05');
        for (const got of [a, b, c]) {
            expect(got?.ra).toBeCloseTo(RW_AUR.ra, 4);
            expect(got?.dec).toBeCloseTo(RW_AUR.dec, 4);
        }
    });

    it('preserves explicit RA hour markers', () => {
        expect(parseCoords('12h +20d')).toEqual({ ra: 180, dec: 20 });
        expect(parseCoords('12H +20d')).toEqual({ ra: 180, dec: 20 });
        expect(parseCoords('30m +20d')).toEqual({ ra: 7.5, dec: 20 });
        expect(parseCoords('30s +20d')).toEqual({ ra: 0.125, dec: 20 });
        expect(parseCoords('24h +20d')).toBeNull();
    });

    it('preserves explicit RA degree markers', () => {
        for (const ra of ['12d30m', '12°30′', "12d30'", '12d30m00s', '12°30′00″']) {
            expect(parseCoords(`${ra} +20d`), ra).toEqual({ ra: 12.5, dec: 20 });
        }
        expect(parseCoords('180d30m +20d')).toEqual({ ra: 180.5, dec: 20 });
        expect(parseCoords('360d00m +20d')).toBeNull();
    });

    it('always interprets Dec markers as degrees', () => {
        expect(parseCoords('12h +20d30m')).toEqual({ ra: 180, dec: 20.5 });
        expect(parseCoords('12h -20°30′')).toEqual({ ra: 180, dec: -20.5 });
        expect(parseCoords('180 +30m')).toEqual({ ra: 180, dec: 0.5 });
    });

    it('rejects RA with mixed hour and degree markers', () => {
        for (const ra of ['12h30d', '12d30h', '12h30°', '12h30′', '12h30\'']) {
            expect(parseCoords(`${ra} +20d`), ra).toBeNull();
        }
    });

    it('gives a negative Dec for -00 degrees', () => {
        const got = parseCoords('05 07 49.5 -00 30 00');
        expect(got?.dec).toBeCloseTo(-0.5, 9);
    });

    it('accepts a Unicode minus', () => {
        expect(parseCoords('76.956 −30.4')).toEqual({ ra: 76.956, dec: -30.4 });
    });

    it('accepts the formatted output of formatRa and formatDec', () => {
        const got = parseCoords(`${formatRa(RW_AUR.ra)} ${formatDec(RW_AUR.dec)}`);
        expect(got?.ra).toBeCloseTo(RW_AUR.ra, 3);
        expect(got?.dec).toBeCloseTo(RW_AUR.dec, 3);
    });

    it('returns null for text that is not a coordinate', () => {
        for (const bad of ['', 'hello', 'RW Aur', '76.956', '76.956 30.4 1.2', '400 10', '76 91', '-200 10',
            '05 60 00 +10 00 00', '24 00 00 +10 00 00', '95 00 00 +10 00 00', '05 07 49.5 +30 60 00',
            '10 00 00 +90 00 01', '1e5 2']) {
            expect(parseCoords(bad), bad).toBeNull();
        }
    });
});

describe('formatRa and formatDec', () => {
    it('formats RA as hours, minutes and seconds', () => {
        expect(formatRa(RW_AUR.ra)).toBe('05h07m49.50s');
        expect(formatRa(0)).toBe('00h00m00.00s');
    });

    it('formats Dec with sign, degrees, arcminutes and arcseconds', () => {
        expect(formatDec(RW_AUR.dec)).toBe('+30°24′05.0″');
        expect(formatDec(-0.5)).toBe('-00°30′00.0″');
        expect(formatDec(0)).toBe('+00°00′00.0″');
    });
});

describe('separationDeg', () => {
    it('is zero for the same point', () => {
        expect(separationDeg(RW_AUR, RW_AUR)).toBe(0);
    });

    it('gives right angles between the pole and the equator', () => {
        expect(separationDeg({ ra: 0, dec: 0 }, { ra: 0, dec: 90 })).toBeCloseTo(90, 9);
        expect(separationDeg({ ra: 0, dec: 0 }, { ra: 90, dec: 0 })).toBeCloseTo(90, 9);
    });
});

describe('resolveName', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    interface SentRequest {
        url: string;
        init: RequestInit;
    }

    function mockSimbad(data: unknown[][]): SentRequest[] {
        const sent: SentRequest[] = [];
        const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
            sent.push({ url, init });
            return new Response(JSON.stringify({
                metadata: [
                    { name: 'main_id' },
                    { name: 'ra' },
                    { name: 'dec' },
                    { name: 'pmra' },
                    { name: 'pmdec' },
                ],
                data,
            }));
        });
        vi.stubGlobal('fetch', fetchMock);
        return sent;
    }

    function sentParams(sent: SentRequest[]): URLSearchParams {
        return new URLSearchParams(String(sent[0]?.init.body));
    }

    it('posts one ADQL query to the CfA mirror and maps the row', async () => {
        const sent = mockSimbad([['V* RW Aur', 76.95652, 30.40144, 7.23, -20.33]]);
        const got = await resolveName('RW Aur');
        expect(sent).toHaveLength(1);
        expect(sent[0]?.url).toBe('https://simbad.cfa.harvard.edu/simbad/sim-tap/sync');
        expect(sent[0]?.init.method).toBe('POST');
        expect(sentParams(sent).get('LANG')).toBe('ADQL');
        expect(sentParams(sent).get('QUERY')).toContain("ident.id IN ('RW Aur', 'V* RW Aur', '* RW Aur', 'NAME RW Aur')");
        expect(got).toEqual({ ra: 76.95652, dec: 30.40144, epochJyear: 2000.0, pmRa: 7.23, pmDec: -20.33 });
    });

    it('collapses whitespace and escapes single quotes in the name', async () => {
        const sent = mockSimbad([['NAME Barnard\'s Star', 269.45, 4.69, -798.6, 10328.1]]);
        await resolveName("  Barnard's   Star ");
        const query = sentParams(sent).get('QUERY') ?? '';
        expect(query).toContain("'NAME Barnard''s Star'");
        expect(query).not.toContain('  ');
    });

    it('uses zero proper motion when SIMBAD has none', async () => {
        mockSimbad([['Name X', 10, 20, null, null]]);
        const got = await resolveName('X');
        expect(got.pmRa).toBe(0);
        expect(got.pmDec).toBe(0);
    });

    it('throws when the name is not found or the mirror fails', async () => {
        mockSimbad([]);
        await expect(resolveName('Nothing Here')).rejects.toThrow('not in SIMBAD');
        vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
        await expect(resolveName('Vega')).rejects.toThrow('HTTP 400');
        await expect(resolveName('   ')).rejects.toThrow('Enter an object name');
    });
});

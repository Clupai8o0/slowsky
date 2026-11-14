export interface Observer { name: string; latDeg: number; lonDeg: number; timeZone: string }
export const MELBOURNE: Observer = { name: 'Melbourne', latDeg: -37.814, lonDeg: 144.963, timeZone: 'Australia/Melbourne' };
export const DARK_SUN_ALT_DEG = -12;
export interface UpTonight {
    darkStart: Date;
    darkEnd: Date;
    best: Date;
    bestAltDeg: number;
    bestAzDeg: number;
    maxAltDeg: number;
}

const RAD = Math.PI / 180;
const DAY = 86400000;
const wrap = (n: number) => ((n % 360) + 360) % 360;
const julian = (time: number) => time / DAY + 2440587.5;

// The Sun's position from a short series: mean longitude, anomaly, equation of centre and two small corrections.
// Good to a small fraction of a degree; checked against astropy 8.0.2 in tests/uptonight.test.ts.
export function sunRaDec(date: Date): { raDeg: number; decDeg: number }
{
    const t = (julian(+date) - 2451545) / 36525;
    const meanLongitude = wrap(280.46646 + t * (36000.76983 + 0.0003032 * t));
    const anomaly = wrap(357.52911 + t * (35999.05029 - 0.0001537 * t)) * RAD;
    const center = (1.914602 - t * (0.004817 + 0.000014 * t)) * Math.sin(anomaly)
        + (0.019993 - 0.000101 * t) * Math.sin(2 * anomaly) + 0.000289 * Math.sin(3 * anomaly);
    const omega = (125.04 - 1934.136 * t) * RAD;
    const longitude = (meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
    const obliquity = (23.439291 - 0.0130042 * t + 0.00256 * Math.cos(omega)) * RAD;
    return { raDeg: wrap(Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude)) / RAD),
        decDeg: Math.asin(Math.sin(obliquity) * Math.sin(longitude)) / RAD };
}

// Turns a J2000 position into the position of the date (precession only; no nutation, aberration or refraction).
// Checked against astropy 8.0.2 in tests/uptonight.test.ts.
function precess(raDeg: number, decDeg: number, time: number): { raDeg: number; decDeg: number }
{
    const t = (julian(time) - 2451545) / 36525;
    const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) / 3600 * RAD;
    const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) / 3600 * RAD;
    const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) / 3600 * RAD;
    const ra = wrap(raDeg) * RAD;
    const dec = decDeg * RAD;
    const a = Math.cos(dec) * Math.sin(ra + zeta);
    const b = Math.cos(theta) * Math.cos(dec) * Math.cos(ra + zeta) - Math.sin(theta) * Math.sin(dec);
    const c = Math.sin(theta) * Math.cos(dec) * Math.cos(ra + zeta) + Math.cos(theta) * Math.sin(dec);
    return { raDeg: wrap((Math.atan2(a, b) + z) / RAD), decDeg: Math.asin(Math.max(-1, Math.min(1, c))) / RAD };
}

// Altitude and direction from the sidereal time at Greenwich, with UTC used as UT1 (they differ by under a second).
function horizontal(raDeg: number, decDeg: number, time: number, observer: Observer): { altDeg: number; azDeg: number }
{
    const jd = julian(time);
    const t = (jd - 2451545) / 36525;
    const sidereal = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t ** 3 / 38710000;
    const hour = wrap(sidereal + observer.lonDeg - raDeg) * RAD;
    const dec = decDeg * RAD;
    const lat = observer.latDeg * RAD;
    const east = -Math.cos(dec) * Math.sin(hour);
    const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(hour) * Math.sin(lat);
    const up = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(hour) * Math.cos(lat);
    return { altDeg: Math.asin(Math.max(-1, Math.min(1, up))) / RAD, azDeg: wrap(Math.atan2(east, north) / RAD) };
}

export function altAz(raDeg: number, decDeg: number, date: Date, observer: Observer = MELBOURNE): { altDeg: number; azDeg: number }
{
    const p = precess(raDeg, decDeg, +date);
    return horizontal(p.raDeg, p.decDeg, +date, observer);
}

export function upTonight(raDeg: number, decDeg: number, now: Date, observer: Observer = MELBOURNE): UpTonight | null
{
    const time = +now;
    if (![raDeg, decDeg, time, observer.latDeg, observer.lonDeg].every(Number.isFinite)
        || Math.abs(decDeg) > 90 || Math.abs(observer.latDeg) > 90) {
        return null;
    }
    const sunAltitude = (at: number) => {
        const sun = sunRaDec(new Date(at));
        return horizontal(sun.raDeg, sun.decDeg, at, observer).altDeg - DARK_SUN_ALT_DEG;
    };
    // An ongoing stretch must have started within the same 48-hour search limit.
    const step = 60000;
    const searchLimit = 370 * DAY;
    const crossing = (loTime: number, hiTime: number, loDark: boolean) => {
        let lo = loTime;
        let hi = hiTime;
        while (hi - lo > 500) {
            const mid = (lo + hi) / 2;
            if ((sunAltitude(mid) < 0) === loDark) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return (lo + hi) / 2;
    };
    let start: number | null = null;
    let end: number | null = null;
    if (sunAltitude(time) < 0) {
        for (let at = time - step; at >= time - 48 * 3600000; at -= step) {
            if (sunAltitude(at) >= 0) {
                start = crossing(at, at + step, false);
                break;
            }
        }
    } else {
        for (let at = time + step; at <= time + 48 * 3600000; at += step) {
            if (sunAltitude(at) < 0) {
                start = crossing(at - step, at, false);
                break;
            }
        }
    }
    if (start === null) {
        return null;
    }
    const darkFrom = Math.max(time, start + 500);
    for (let at = darkFrom + step; at <= darkFrom + searchLimit; at += step) {
        if (sunAltitude(at) >= 0) {
            end = crossing(at - step, at, true);
            break;
        }
    }
    if (end === null) {
        return null;
    }
    const altitude = (at: number) => altAz(raDeg, decDeg, new Date(at), observer).altDeg;
    let best = start;
    let bestAltitude = altitude(start);
    const consider = (at: number) => {
        const value = altitude(at);
        if (value > bestAltitude) {
            best = at;
            bestAltitude = value;
        }
    };
    // Bracket all local maxima, including windows with a transit near either edge.
    const sampleStep = 600000;
    for (let a = start; a < end; a += sampleStep) {
        const b = Math.min(a + sampleStep, end);
        consider(b);
        let lo = a;
        let hi = b;
        while (hi - lo > 1000) {
            const m1 = lo + (hi - lo) / 3;
            const m2 = hi - (hi - lo) / 3;
            if (altitude(m1) < altitude(m2)) {
                lo = m1;
            } else {
                hi = m2;
            }
        }
        consider((lo + hi) / 2);
    }
    const bestDate = new Date(best);
    const position = altAz(raDeg, decDeg, bestDate, observer);
    const dateDec = precess(raDeg, decDeg, +bestDate).decDeg;
    const maxAltDeg = 90 - Math.abs(observer.latDeg - dateDec);
    if (![start, end, +bestDate, position.altDeg, position.azDeg, maxAltDeg].every(Number.isFinite)) {
        return null;
    }
    return { darkStart: new Date(start), darkEnd: new Date(end), best: bestDate,
        bestAltDeg: position.altDeg, bestAzDeg: position.azDeg, maxAltDeg };
}

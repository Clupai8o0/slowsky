export interface Cited<T> {
    value: T;
    unit: string;
    source: string;
    kind: 'published' | 'read-from-figure' | 'derived';
}

const orbit = 'https://arxiv.org/abs/2108.09868';
const mission = 'https://arxiv.org/abs/2511.02985';
const ps1 = 'https://arxiv.org/abs/2401.17977';
const ztf = 'https://arxiv.org/abs/2110.13117';
const des = 'https://arxiv.org/abs/2203.07642';
const luhman = 'https://doi.org/10.1088/2041-8205/786/2/L18';
const wise = 'https://irsa.ipac.caltech.edu/data/WISE/docs/release/All-Sky/expsup/sec4_4h.html';
const earth = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html';
const diameter = 'https://doi.org/10.1088/0004-637X/741/2/68';
const inverseFourth = 'https://arxiv.org/abs/2506.12854';

export const P9 = {
    mass: { value: 6.2, unit: 'Earth masses', source: `Brown & Batygin 2021, abstract, ${orbit}; -1.3/+2.2 Earth masses`, kind: 'published' },
    massUncertainty: { value: [-1.3, 2.2], unit: 'Earth masses', source: `Brown & Batygin 2021, abstract, ${orbit}`, kind: 'published' },
    semiMajorAxis: { value: 380, unit: 'AU', source: `Brown & Batygin 2021, abstract, ${orbit}; -80/+140 AU`, kind: 'published' },
    semiMajorAxisUncertainty: { value: [-80, 140], unit: 'AU', source: `Brown & Batygin 2021, abstract, ${orbit}`, kind: 'published' },
    albedo: { value: [0.2, 0.75] as [number, number], unit: 'geometric albedo', source: `Brown & Batygin 2021, section 5, ${orbit}`, kind: 'published' },
    massRadiusRule: { value: 'radius / Earth radius = mass / (3 Earth masses)', unit: 'ratio', source: `Brown & Batygin 2021, section 5, ${orbit}; assumed for 4–20 Earth masses`, kind: 'published' },
    earthRadius: { value: 6371, unit: 'km', source: `NASA Earth Fact Sheet, volumetric mean radius, ${earth}`, kind: 'published' },
    diameterMagnitudeConstant: { value: 1329, unit: 'km', source: `Masiero et al. 2011, section 1, ${diameter}`, kind: 'published' },
    percentileCurveExtents: { value: [18, 23] as [number, number], unit: 'approximate R mag', source: `Brown & Batygin 2021, arXiv:2108.09868v2, Figure 9, ${orbit}; approximate outer extents of conditional 16th and 84th percentile curves read by eye across right ascension, not global percentiles`, kind: 'read-from-figure' },
    envelope: { value: [17, 25.5] as [number, number], unit: 'approximate R mag', source: `Brown & Batygin 2021, arXiv:2108.09868v2, Figure 9, ${orbit}; approximate plotted colored extent read by eye, not a hard bound`, kind: 'read-from-figure' },
} satisfies Record<string, Cited<unknown>>;

const depthSource = `Bock et al. 2025, abstract and Figure 19 caption, ${mission}; 5 sigma point source, per spectral channel, 4 observations per channel at the median sky, Galactic plane excluded`;
const makeDepth = (wavelength: [number, number], depth: [number, number]) => ({
    wavelength: { value: wavelength, unit: 'µm', source: depthSource, kind: 'published' as const },
    fourObservations: { value: depth, unit: 'AB mag; 4 observations per channel', source: depthSource, kind: 'published' as const },
    oneObservation: { value: [depth[0] - 0.75, depth[1] - 0.75] as [number, number], unit: 'AB mag; one observation per channel (derived: 4-observation depth minus 0.75 mag)', source: `${depthSource}; estimate: 4-observation depth - 2.5 log10(sqrt(4)), approximated by 0.75 mag`, kind: 'derived' as const },
});

export const SPHEREX_DEPTH = [makeDepth([0.75, 3.8], [19.5, 19.9]), makeDepth([3.8, 5], [17.8, 18.8])] as const;

export const SURVEYS: readonly { name: string; band: string; limit: Cited<number> }[] = [
    { name: 'Pan-STARRS1', band: 'g', limit: { value: 22, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'r', limit: { value: 21.8, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'i', limit: { value: 21.5, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'z', limit: { value: 20.9, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'y', limit: { value: 19.7, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'ZTF', band: 'V', limit: { value: 20.5, unit: 'mag; approximate 95% detection efficiency', source: `Brown & Batygin 2022, abstract, ${ztf}`, kind: 'published' } },
    { name: 'DES', band: 'r', limit: { value: 23.8, unit: 'mag; typical limiting magnitude (r)', source: `Belyakov et al. 2022, section I, ${des}`, kind: 'published' } },
];

export const EXCLUDED_FRACTION: Cited<number> = { value: 0.78, unit: "fraction of the synthetic reference population (assumes the 2021 paper's radius and albedo range)", source: `Brown, Holman & Batygin 2024, abstract, sections 5 and 6, ${ps1}`, kind: 'published' };

export const PS1_HALF_COMPLETE: Cited<number> = { value: 21.5, unit: 'V mag; 50% completion depth', source: `Brown, Holman & Batygin 2024, abstract, ${ps1}`, kind: 'published' };
export const REMAINING = {
    distanceAu: { value: { value: 550, lower: -180, upper: 250 }, unit: 'AU; current distance', source: `Brown, Holman & Batygin 2024, section 6, ${ps1}; remaining reference population`, kind: 'published' },
    vMag: { value: { value: 22, lower: -1.4, upper: 1.1 }, unit: 'V mag', source: `Brown, Holman & Batygin 2024, section 6, ${ps1}; remaining reference population`, kind: 'published' },
} satisfies Record<string, Cited<unknown>>;

const w2Vega = { value: 13.89, unit: 'Vega mag', source: `Luhman 2014, Table 1, ${luhman}`, kind: 'published' as const };
const w2Offset = { value: 3.339, unit: 'AB minus Vega mag', source: `WISE Explanatory Supplement, section IV.4.h, Table 3, ${wise}`, kind: 'published' as const };

export const WISE0855 = {
    w2Vega,
    w2Error: { value: 0.05, unit: 'mag', source: `Luhman 2014, Table 1, ${luhman}`, kind: 'published' },
    w2Offset,
    w2AB: { value: w2Vega.value + w2Offset.value, unit: 'AB mag', source: `Luhman 2014, Table 1, ${luhman}; WISE Explanatory Supplement Table 3, ${wise}; W2 Vega plus AB offset`, kind: 'derived' },
    bandMicrometres: { value: 4.6, unit: 'µm', source: `WISE Explanatory Supplement, section IV.4.h, Table 8, ${wise}; W2 nominal wavelength`, kind: 'published' },
} satisfies Record<string, Cited<unknown>>;

export const TEXT = {
    stackGain: 'stacking frames goes deeper for a source that stays put; the gain is not measured here, and shift-and-stack for a moving source is not tested',
    bandNote: "Rows are in different bands (optical R and V, survey g, r, i, z and y, SPHEREx AB per channel, WISE W2) on one axis with no colour correction, so compare them only roughly. Only the model row is this repo's own estimate (reflected sunlight, V band); the others come from the papers listed, with the one-observation SPHEREx depth and the WISE 0855 AB value worked out here from published numbers, and the Planet Nine ranges read by eye from Figure 9 of Brown & Batygin 2021.",
    caveat: 'An estimate only: the one-observation depth assumes four equal independent observations. The model assumes the object is seen at opposition, fully lit.',
    wiseNote: "W2 is a broadband average and WISE 0855's spectrum changes steeply across 3.8 to 5 µm, so its brightness in one SPHEREx channel can differ from W2.",
};

function roundMarginPair(a: number, b: number): [number, number]
{
    const first = Math.round(a * 100) / 100 + 0;
    const second = Math.round(b * 100) / 100 + 0;
    return first <= second ? [first, second] : [second, first];
}

/**
 * Apparent magnitude minus depth, in magnitudes (WISE 0855 W2 AB magnitude minus SPHEREx 3.8–5 µm depth:
 * negative means WISE 0855 is brighter than that depth), rounded to 2 decimals in ascending order.
 */
export function wise0855Margin(): { fourObservations: [number, number]; oneObservation: [number, number] }
{
    const depth = SPHEREX_DEPTH[1];
    const mag = WISE0855.w2AB.value;
    return {
        fourObservations: roundMarginPair(mag - depth.fourObservations.value[0], mag - depth.fourObservations.value[1]),
        oneObservation: roundMarginPair(mag - depth.oneObservation.value[0], mag - depth.oneObservation.value[1]),
    };
}

export function modelExample(): { vMag: number; label: string }
{
    const distance = P9.semiMajorAxis.value;
    const albedo = (P9.albedo.value[0] + P9.albedo.value[1]) / 2;
    return { vMag: apparentMag(P9.mass.value, albedo, distance), label: `model, V band, if it were at ${distance} AU (its fitted semi-major axis, not its likely current distance), with albedo ${albedo}, the middle of the published range` };
}

function positive(value: number): void
{
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError('Expected a finite positive value');
    }
}

export function radiusKm(massEarth: number): number
{
    positive(massEarth);
    return massEarth / 3 * P9.earthRadius.value;
}

// The diameter/albedo relation is a V-band relation; apparentMag is a V-band estimate.
export function absoluteMag(radius: number, albedo: number): number
{
    positive(radius);
    positive(albedo);
    if (albedo > 1) {
        throw new RangeError('Albedo must be at most one');
    }
    return 5 * (Math.log10(P9.diameterMagnitudeConstant.value) - Math.log10(2) - Math.log10(radius) - Math.log10(albedo) / 2);
}

function oppositionDistanceModulus(distanceAu: number): number
{
    positive(distanceAu);
    if (distanceAu <= 1) {
        throw new RangeError('Heliocentric distance must exceed one AU');
    }
    return 5 * (Math.log10(distanceAu) + Math.log10(distanceAu - 1));
}

/**
 * V-band apparent magnitude from reflected sunlight for an object seen at opposition, fully lit
 * (Earth between it and the Sun, full phase).
 */
export function apparentMag(massEarth: number, albedo: number, distanceAu: number): number
{
    const modulus = oppositionDistanceModulus(distanceAu);
    return absoluteMag(radiusKm(massEarth), albedo) + modulus;
}

// Opposition geometry uses distance * (distance - 1 AU); far from the Sun this tends to the
// inverse-fourth-power law (Chen et al. 2025, abstract, https://arxiv.org/abs/2506.12854).
// The exact zero-phase two-distance relation is in Belyakov et al. 2022, eq. 3: https://arxiv.org/abs/2203.07642
export function magChangeWithDistance(fromAu: number, toAu: number): number
{
    const fromModulus = oppositionDistanceModulus(fromAu);
    const toModulus = oppositionDistanceModulus(toAu);
    return toModulus - fromModulus;
}

export function references(): { key: string; text: string; url: string }[]
{
    return [
        { key: 'orbit', text: 'Brown & Batygin 2021, The Orbit of Planet Nine', url: orbit },
        { key: 'mission', text: 'Bock et al. 2025, The SPHEREx Satellite Mission', url: mission },
        { key: 'ps1', text: 'Brown, Holman & Batygin 2024, Pan-STARRS1 search', url: ps1 },
        { key: 'ztf', text: 'Brown & Batygin 2022, ZTF search, AJ 163, 102, doi:10.3847/1538-3881/ac32dd', url: ztf },
        { key: 'des', text: 'Belyakov et al. 2022, DES limits', url: des },
        { key: 'luhman', text: 'Luhman 2014, WISE 0855 photometry', url: luhman },
        { key: 'wise', text: 'WISE All-Sky Explanatory Supplement, photometric calibration', url: wise },
        { key: 'earth', text: 'NASA Earth Fact Sheet', url: earth },
        { key: 'diameter', text: 'Masiero et al. 2011, asteroid albedo and diameter relation', url: diameter },
        { key: 'inverse-fourth', text: 'Chen et al. 2025, far-infrared search (cited only for the distance scaling)', url: inverseFourth },
    ];
}

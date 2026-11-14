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
    albedo: { value: [0.2, 0.75], unit: 'geometric albedo', source: `Brown & Batygin 2021, section V, ${orbit}`, kind: 'published' },
    massRadiusRule: { value: 'radius / Earth radius = mass / (3 Earth masses)', unit: 'ratio', source: `Brown & Batygin 2021, section V, ${orbit}; assumed for 4–20 Earth masses`, kind: 'published' },
    earthRadius: { value: 6371, unit: 'km', source: `NASA Earth Fact Sheet, volumetric mean radius, ${earth}`, kind: 'published' },
    diameterMagnitudeConstant: { value: 1329, unit: 'km', source: `Masiero et al. 2011, section 1, ${diameter}`, kind: 'published' },
    percentileCurveExtents: { value: [18, 23] as [number, number], unit: 'approximate R mag', source: `Brown & Batygin 2021, Figure 9, ${orbit}; approximate outer extents of conditional 16th and 84th percentile curves read by eye across right ascension, not global percentiles`, kind: 'read-from-figure' },
    envelope: { value: [17, 25.5] as [number, number], unit: 'approximate R mag', source: `Brown & Batygin 2021, Figure 9, ${orbit}; approximate plotted colored extent read by eye, not a hard bound`, kind: 'read-from-figure' },
} satisfies Record<string, Cited<unknown>>;

const depthSource = `Bock et al. 2025, abstract and Figure 19, ${mission}; 5 sigma per spectral channel, four observations, median sky outside Galactic plane`;
const makeDepth = (wavelength: [number, number], depth: [number, number]) => ({
    wavelength: { value: wavelength, unit: 'µm', source: depthSource, kind: 'published' as const },
    fourPass: { value: depth, unit: 'AB mag', source: depthSource, kind: 'published' as const },
    singleFrame: { value: [depth[0] - 0.75, depth[1] - 0.75] as [number, number], unit: 'AB mag; derived (4-pass minus 0.75 mag)', source: `${depthSource}; estimate: four-pass depth - 2.5 log10(sqrt(4)), approximated by 0.75 mag`, kind: 'derived' as const },
});

export const SPHEREX_DEPTH = [makeDepth([0.75, 3.8], [19.5, 19.9]), makeDepth([3.8, 5], [17.8, 18.8])] as const;

export const SURVEYS: readonly { name: string; band: string; limit: Cited<number> }[] = [
    { name: 'Pan-STARRS1', band: 'g', limit: { value: 22, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'r', limit: { value: 21.8, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'i', limit: { value: 21.5, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'z', limit: { value: 20.9, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'Pan-STARRS1', band: 'y', limit: { value: 19.7, unit: 'mag; approximate single-epoch depth', source: `Brown, Holman & Batygin 2024, section II, ${ps1}`, kind: 'published' } },
    { name: 'ZTF', band: 'V', limit: { value: 20.5, unit: 'mag; approximate 95% search efficiency', source: `Brown & Batygin 2021, abstract, ${ztf}`, kind: 'published' } },
    { name: 'DES', band: 'r', limit: { value: 23.8, unit: 'mag; typical single-visit depth', source: `Belyakov et al. 2022, section I, ${des}`, kind: 'published' } },
];

export const EXCLUDED_FRACTION: Cited<number> = { value: 0.78, unit: 'fraction of the modeled reference population', source: `Brown, Holman & Batygin 2024, sections IV–V, ${ps1}`, kind: 'published' };

export const WISE0855 = {
    w2Vega: { value: 13.89, unit: 'Vega mag', source: `Luhman 2014, Table 1, ${luhman}; uncertainty 0.05 mag`, kind: 'published' },
    w2Offset: { value: 3.339, unit: 'AB minus Vega mag', source: `WISE Explanatory Supplement, section IV.4.h, Table 3, ${wise}`, kind: 'published' },
    w2AB: { value: 13.89 + 3.339, unit: 'AB mag', source: `Luhman 2014, Table 1, ${luhman}; WISE Explanatory Supplement Table 3, ${wise}; W2 Vega + 3.339`, kind: 'derived' },
    bandMicrometres: { value: 4.6, unit: 'µm', source: `WISE Explanatory Supplement, section IV.4.h, Table 8, ${wise}; W2 nominal wavelength`, kind: 'published' },
} satisfies Record<string, Cited<unknown>>;

export const TEXT = {
    stackGain: 'about 1.3 mag (estimate from co-adding a fixed source; shift-and-stack not tested)',
    bandNote: 'optical R; fainter still in SPHEREx bands (methane), so a best case for SPHEREx',
    caveat: 'An estimate only: the one-frame depth assumes four equal independent observations; R, V, W2 and SPHEREx bands are not interchangeable. Methane absorption varies with wavelength, so the band note is a hypothesis, not a verified brightness comparison.',
};

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

export function apparentMag(massEarth: number, albedo: number, distanceAu: number): number
{
    positive(distanceAu);
    if (distanceAu <= 1) {
        throw new RangeError('Heliocentric distance must exceed one AU');
    }
    return absoluteMag(radiusKm(massEarth), albedo) + 5 * (Math.log10(distanceAu) + Math.log10(distanceAu - 1));
}

// At large distances both Sun-object and observer-object distances scale with distance.
// Chen et al. 2025, abstract, https://arxiv.org/abs/2506.12854 states the inverse-fourth approximation.
// The exact zero-phase two-distance relation is in Belyakov et al. 2022, eq. 2: https://arxiv.org/abs/2203.07642
export function magChangeWithDistance(fromAu: number, toAu: number): number
{
    positive(fromAu);
    positive(toAu);
    if (fromAu <= 1 || toAu <= 1) {
        throw new RangeError('Heliocentric distances must exceed one AU');
    }
    return 10 * (Math.log10(toAu) - Math.log10(fromAu));
}

export function references(): { key: string; text: string; url: string }[]
{
    return [
        { key: 'orbit', text: 'Brown & Batygin 2021, The Orbit of Planet Nine', url: orbit },
        { key: 'mission', text: 'Bock et al. 2025, The SPHEREx Satellite Mission', url: mission },
        { key: 'ps1', text: 'Brown, Holman & Batygin 2024, Pan-STARRS1 search', url: ps1 },
        { key: 'ztf', text: 'Brown & Batygin 2021, ZTF search', url: ztf },
        { key: 'des', text: 'Belyakov et al. 2022, DES limits', url: des },
        { key: 'luhman', text: 'Luhman 2014, WISE 0855 photometry', url: luhman },
        { key: 'wise', text: 'WISE All-Sky Explanatory Supplement, photometric calibration', url: wise },
        { key: 'earth', text: 'NASA Earth Fact Sheet', url: earth },
        { key: 'diameter', text: 'Masiero et al. 2011, asteroid albedo and diameter relation', url: diameter },
        { key: 'inverse-fourth', text: 'Chen et al. 2025, far-infrared search', url: inverseFourth },
    ];
}

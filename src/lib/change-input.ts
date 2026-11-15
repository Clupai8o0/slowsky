// Turns what the sky source returns (frames of several visits plus Gaia stars) into the input of the change
// finder: one stacked image per chosen visit, and every catalogue star placed on the grid at each visit's date
// with its Gaia source_id, so both entries of one star share an id. Pure, no DOM, so it runs in a Worker.
// Not wired into the page yet.

import { compareVisits, type ChangeOptions, type VisitChangeResult, type StarPix, type VisitImage } from './changes';
import { gridSkyToPix } from './regrid';
import type { GaiaStar, SkyResult } from './source';
import { groupByVisit, stackVisit } from './stack';
import { positionAt } from './targets';
import type { OutputGrid, RegriddedFrame } from './types';

export class ChangeInputError extends Error
{
    constructor(message: string)
    {
        super(message);
        this.name = 'ChangeInputError';
    }
}

export interface ChangeInputOptions {
    earlier?: number; // visit index, default 0 (the first)
    later?: number; // visit index, default the last
    gapDays?: number; // frames further apart start a new visit (default 10, as the source)
    marginArcsec?: number; // keep stars this far outside the grid (default 30)
}

export interface ChangeInput {
    earlier: VisitImage;
    later: VisitImage;
    stars: StarPix[];
    visits: number; // how many visits the frames split into
    notes: string[];
}

// Middle of a visit: halfway between its first frame's start and its last frame's end, in MJD.
function middle(visit: RegriddedFrame[]): number
{
    const start = Math.min(...visit.map((f) => f.frame.tMin));
    const end = Math.max(...visit.map((f) => f.frame.tMax));
    return (start + end) / 2;
}

function image(visit: RegriddedFrame[]): VisitImage
{
    const stack = stackVisit(visit);
    const lambda = visit.reduce((sum, f) => sum + f.lambdaAtCenter, 0) / visit.length;
    const first = visit[0]?.lambdaGrid;
    let lambdaGrid: VisitImage['lambdaGrid'];
    if (first && visit.every(f => f.lambdaGrid && f.lambdaGrid.nx === first.nx && f.lambdaGrid.ny === first.ny
        && f.lambdaGrid.values.length === first.nx * first.ny)) {
        const values = new Float32Array(first.nx * first.ny);
        for (let i = 0; i < values.length; i++) {
            const finite = visit.map(f => f.lambdaGrid!.values[i]!).filter(Number.isFinite);
            values[i] = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN;
        }
        lambdaGrid = { nx: first.nx, ny: first.ny, values };
    }
    return {
        data: stack.data, lambda, mjd: middle(visit),
        obsIds: visit.slice().sort((a, b) => a.frame.tMin - b.frame.tMin).map((f) => f.frame.obsId),
        ...(stack.variance ? { variance: stack.variance } : {}),
        ...(lambdaGrid ? { lambdaGrid } : {}),
    };
}

function placed(stars: GaiaStar[], grid: OutputGrid, mjd: number, margin: number, visit: 'earlier' | 'later'): StarPix[]
{
    const out: StarPix[] = [];
    for (const s of stars) {
        const sky = positionAt({
            ra: s.ra, dec: s.dec, epochJyear: s.epochJyear, pmRa: s.pmRa ?? 0, pmDec: s.pmDec ?? 0,
            ...(s.parallax !== undefined ? { parallax: s.parallax } : {}),
        }, mjd);
        const pix = gridSkyToPix(grid, sky);
        if (Number.isFinite(pix.x) && Number.isFinite(pix.y)
            && pix.x >= -margin && pix.y >= -margin && pix.x <= grid.width - 1 + margin && pix.y <= grid.height - 1 + margin) {
            const motion = gridSkyToPix(grid, positionAt({ ra: s.ra, dec: s.dec, epochJyear: s.epochJyear,
                pmRa: s.pmRa ?? 0, pmDec: s.pmDec ?? 0 }, mjd));
            const properMotion = (Number.isFinite(s.pmRa) && s.pmRa !== 0) || (Number.isFinite(s.pmDec) && s.pmDec !== 0);
            out.push({ x: pix.x, y: pix.y, id: s.sourceId, visit, properMotion, motionX: motion.x, motionY: motion.y });
        }
    }
    return out;
}

export function changeInput(result: SkyResult, opts: ChangeInputOptions = {}): ChangeInput
{
    const visits = groupByVisit(result.frames.map((entry) => entry.frame), opts.gapDays ?? 10);
    if (visits.length < 2) {
        throw new ChangeInputError(`Change finding needs two visits; these frames make ${visits.length}.`);
    }
    const a = opts.earlier ?? 0, b = opts.later ?? visits.length - 1;
    for (const index of [a, b]) {
        if (!Number.isInteger(index) || index < 0 || index >= visits.length) {
            throw new ChangeInputError(`Visit ${index} does not exist; there are ${visits.length}.`);
        }
    }
    if (a >= b) {
        throw new ChangeInputError('The earlier visit must come before the later one.');
    }
    const earlier = image(visits[a]!), later = image(visits[b]!);
    const margin = (opts.marginArcsec ?? 30) / result.grid.pixelArcsec;
    // Two entries per star, one at each visit's date, sharing the Gaia source_id: a star that moves on the sky
    // (proper motion) stays one star to the change finder.
    const stars = [...placed(result.stars, result.grid, earlier.mjd, margin, 'earlier'),
        ...placed(result.stars, result.grid, later.mjd, margin, 'later')];
    const notes: string[] = [];
    const untimed = result.frames.filter(({ frame }) => !Number.isFinite((frame.frame.tMin + frame.frame.tMax) / 2)).length;
    if (untimed > 0) {
        notes.push(`${untimed} ${untimed === 1 ? 'frame' : 'frames'} without a time ${untimed === 1 ? 'was' : 'were'} left out.`);
    }
    if (result.stars.length === 0) {
        notes.push('No catalogue stars for this view: every spot is listed without a catalogue match.');
    }
    if (!earlier.variance || !later.variance) {
        notes.push('No error maps for at least one visit; noise is estimated from the difference image.');
    }
    return { earlier, later, stars, visits: visits.length, notes };
}

export function findChanges(result: SkyResult, opts: ChangeInputOptions = {}, changeOpts?: ChangeOptions): VisitChangeResult
{
    const input = changeInput(result, opts);
    const cover = result.starCover;
    const center = cover ? gridSkyToPix(result.grid, cover.center) : undefined;
    const starCover = cover && center ? { ...center, radiusPix: cover.radiusDeg * 3600 / result.grid.pixelArcsec } : undefined;
    const found = compareVisits(input.earlier, input.later, result.grid, input.stars,
        { ...changeOpts, ...(changeOpts?.starCover ? {} : starCover ? { starCover } : {}) });
    const noiseReported = found.notes.some((note) => /noise from the difference image/i.test(note));
    found.notes.push(...input.notes.filter((note) => !((noiseReported || !Number.isFinite(found.sigma)) && note.startsWith('No error maps'))
        && !(!Number.isFinite(found.sigma) && note.startsWith('No catalogue stars for this view:'))));
    if (cover?.cut) {
        found.notes.push(`The Gaia star list for this view was cut to its ${cover.kept ?? result.stars.length} brightest stars, so a fainter catalogue star can be missing from it.`);
    }
    return found;
}

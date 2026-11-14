// Wavelength lock (Opus glue). Each SPHEREx visit sees a field through a different part of the
// linear variable filter, so the same star has a different wavelength in each frame. Comparing
// brightness across frames is only fair at one wavelength: per visit, keep the frame whose
// wavelength at the target is nearest the chosen one, and show how far off it is.
import type { FrameRecord } from './types';

export interface LockedFrame {
    frame: FrameRecord;
    lambda: number; // µm at the target in this frame
    dLambda: number; // lambda - chosen, µm
}

export interface LockOptions {
    // Drop a visit whose nearest frame is further than this from the chosen wavelength (µm).
    maxDelta?: number;
}

// visits: frames grouped by visit (see groupVisits). lambdaOf gives the wavelength at the target
// in one frame (from its WCS-WAVE grid), or undefined when unknown or the target is off the detector.
// Returns one frame per visit at most, sorted by time.
export function lockWavelength(
    visits: FrameRecord[][],
    lambdaOf: (f: FrameRecord) => number | undefined,
    chosen: number,
    opts: LockOptions = {},
): LockedFrame[]
{
    if (!Number.isFinite(chosen)) {
        throw new Error(`lockWavelength: chosen wavelength ${chosen} is not a number`);
    }
    const maxDelta = opts.maxDelta ?? Infinity;
    const out: LockedFrame[] = [];
    for (const visit of visits) {
        let best: LockedFrame | undefined;
        for (const frame of visit) {
            const lambda = lambdaOf(frame);
            if (lambda === undefined || !Number.isFinite(lambda)) {
                continue;
            }
            const dLambda = lambda - chosen;
            if (!best || Math.abs(dLambda) < Math.abs(best.dLambda)
                || (Math.abs(dLambda) === Math.abs(best.dLambda) && frame.tMin < best.frame.tMin)) {
                best = { frame, lambda, dLambda };
            }
        }
        if (best && Math.abs(best.dLambda) <= maxDelta) {
            out.push(best);
        }
    }
    return out.sort((a, b) => a.frame.tMin - b.frame.tMin);
}

// The wavelengths a target can be locked to: the range every visit can reach.
// Returns [lo, hi] in µm, or undefined when the visits share no wavelength.
export function commonRange(
    visits: FrameRecord[][],
    lambdaOf: (f: FrameRecord) => number | undefined,
): [number, number] | undefined
{
    let lo = -Infinity;
    let hi = Infinity;
    let seen = 0;
    for (const visit of visits) {
        let vlo = Infinity;
        let vhi = -Infinity;
        for (const frame of visit) {
            const lambda = lambdaOf(frame);
            if (lambda === undefined || !Number.isFinite(lambda)) {
                continue;
            }
            vlo = Math.min(vlo, lambda);
            vhi = Math.max(vhi, lambda);
        }
        if (vlo > vhi) {
            continue;
        }
        seen++;
        lo = Math.max(lo, vlo);
        hi = Math.min(hi, vhi);
    }
    if (seen === 0 || lo > hi) {
        return undefined;
    }
    return [lo, hi];
}

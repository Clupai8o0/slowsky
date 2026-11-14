import { changeInput } from './change-input';
import { classify, stampFor, type Classification, type ClassifierModel } from './classify';
import type { VisitChangeResult } from './changes';
import type { SkyResult } from './source';

export function hintsFor(result: SkyResult, found: VisitChangeResult,
    candidates: readonly { x?: number; y?: number }[], model: ClassifierModel): Classification[]
{
    const declined = (): Classification => ({ kind: 'declined', reason: 'stamp unavailable' });
    try {
        const input = changeInput(result);
        const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
        if (!same(input.earlier.obsIds, found.visits.earlier.obsIds)
            || !same(input.later.obsIds, found.visits.later.obsIds)) {
            return candidates.map(declined);
        }
        return candidates.map((candidate) => {
            const stamp = stampFor(input.earlier.data, input.later.data, result.grid,
                { x: candidate.x ?? NaN, y: candidate.y ?? NaN }, found.sigma);
            return stamp ? classify(model, stamp) : declined();
        });
    } catch {
        return candidates.map(declined);
    }
}

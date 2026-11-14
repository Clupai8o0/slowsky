// Error maps (the archive's VARIANCE plane) for only the frames the change finder compares, read after the view
// has loaded so the rest of the stack never pays for them. The regrid follows src/lib/source.ts: the same
// detector box and grid, NaN wherever the frame's own picture is NaN (regridVariance's rule) or the map is not valid.
import { regridVariance } from '../lib/regrid';
import type { Cutout, FitsHeader, RangeReader, RegriddedFrame } from '../lib/types';

export async function readVariance(frame: RegriddedFrame, deps: { reader: RangeReader; signal: AbortSignal }): Promise<Float32Array | null>
{
    const context = frame.context;
    if (!context) {
        return null;
    }
    try {
        const box = context.box;
        const width = box.x1 - box.x0;
        const height = box.y1 - box.y0;
        const index = await deps.reader.index(context.url, deps.signal);
        const variance = await deps.reader.readFloat32(index, 'VARIANCE', box, deps.signal);
        if (variance.length !== width * height) {
            return null;
        }
        // regridVariance takes its NaN mask from the image; the frame's regridded picture already carries that
        // mask on the output grid, so a blank image stands in and the picture's NaNs are copied over after.
        const cutout: Cutout = { frame: frame.frame, box, width, height, image: new Float32Array(width * height), variance,
            wcs: context.wcs.params, header: {} as FitsHeader };
        const out = regridVariance(cutout, context.wcs, frame.grid);
        if (!out || out.length !== frame.data.length) {
            return null;
        }
        let valid = false;
        for (let i = 0; i < out.length; i++) {
            if (Number.isNaN(frame.data[i]!)) {
                out[i] = NaN;
            } else if (Number.isFinite(out[i]!) && out[i]! > 0) {
                valid = true;
            }
        }
        // A map with no finite, positive pixel is no map (as in source.ts).
        return valid ? out : null;
    } catch {
        return null;
    }
}

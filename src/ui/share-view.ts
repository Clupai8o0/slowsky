import { renderRgba } from '../lib/player';
import { AI_CREDIT, SIMULATED_CREDIT, layoutShareCard, pngWithText, releaseCredits, shareCardText, type ShareCardInput } from '../lib/sharecard';
import type { SkyResult } from '../lib/source';
import type { Stretch } from '../lib/types';
import { diffScale, fillCores, renderDiverging } from './compose';
import { combineVisits, visitImage, type Visit } from './subtract';

interface ShareViewInput {
    card: ShareCardInput;
    result: SkyResult;
    a: Visit;
    b: Visit;
    stretch: Stretch;
    filename: string;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D
{
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas unavailable');
    }
    return ctx;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob>
{
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG unavailable')), 'image/png'));
}

export async function saveShareCard(input: ShareViewInput, toast: (message: string) => void): Promise<void>
{
    try {
        const text = shareCardText(input.card);
        const layout = layoutShareCard(1600, text.labels, [text.title, text.details, ...text.credits]);
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        const ctx = canvasContext(canvas);
        ctx.fillStyle = '#101015';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = `${layout.fontSize}px monospace`;
        ctx.textBaseline = 'top';
        const drawLines = (lines: string[], x: number, y: number, width: number) => lines.forEach((line, i) => ctx.fillText(line, x, y + i * layout.lineHeight, width));
        drawLines(layout.headingLines, layout.heading.x, layout.heading.y, layout.heading.width);
        drawLines(layout.bandLines, layout.band.x, layout.band.y, layout.band.width);
        const a = visitImage(input.result, input.a), b = visitImage(input.result, input.b);
        const diff = combineVisits(a, b, 'diff');
        const { width, height } = input.result.grid;
        const pixels = document.createElement('canvas');
        pixels.width = width;
        pixels.height = height;
        const pixelCtx = canvasContext(pixels);
        for (const [i, data] of [a, b, diff].entries()) {
            const image = pixelCtx.createImageData(width, height);
            if (i === 2) {
                renderDiverging(data, diffScale(diff), image.data);
            } else {
                renderRgba(data, input.stretch, image.data);
                fillCores(data, width, height, image.data);
            }
            pixelCtx.clearRect(0, 0, width, height);
            pixelCtx.putImageData(image, 0, 0);
            const panel = layout.panels[i]!, label = layout.labels[i]!;
            drawLines(layout.labelLines[i]!, label.x, label.y, label.width);
            ctx.fillStyle = '#000';
            ctx.fillRect(panel.x, panel.y, panel.width, panel.height);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(pixels, panel.x, panel.y, panel.width, panel.height);
            ctx.fillStyle = '#fff';
        }
        const blob = await canvasBlob(canvas);
        const png = pngWithText(new Uint8Array(await blob.arrayBuffer()), [
            { key: 'Software', text: 'Slowsky' },
            { key: 'Comment', text: [AI_CREDIT, ...(input.card.simulated ? [SIMULATED_CREDIT] : releaseCredits(input.card.releases))].join('\n') },
            { key: 'Source', text: input.card.url },
        ]);
        const file = new File([new Uint8Array(png)], input.filename, { type: 'image/png' });
        const payload = { files: [file], title: text.title };
        if (navigator.canShare?.(payload)) {
            try {
                await navigator.share(payload);
                return;
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    return;
                }
            }
        }
        const url = URL.createObjectURL(file);
        try {
            const link = document.createElement('a');
            link.href = url;
            link.download = input.filename;
            link.click();
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    } catch {
        toast('The picture could not be shared or saved.');
    }
}

import { EXCLUDED_FRACTION, modelExample, P9, PS1_HALF_COMPLETE, references, REMAINING, SPHEREX_DEPTH, SURVEYS, TEXT, WISE0855 } from './planetx';

export interface ChartMark {
    kind: 'range' | 'point' | 'tick';
    from: number;
    to: number;
    low?: number;
    high?: number;
    text: string;
    source: string;
    style: 'solid' | 'light' | 'outline';
}

export interface ChartRow {
    id: string;
    label: string;
    band: string;
    marks: ChartMark[];
}

export const AXIS = { min: 16, max: 26, step: 2 };

export function planetxRows(): ChartRow[]
{
    const range = (value: { value: [number, number]; source: string }, text: string, style: ChartMark['style']): ChartMark => {
        const [from, to] = value.value;
        return { kind: 'range', from, to, text, source: value.source, style };
    };
    const point = (value: number, text: string, source: string, style: ChartMark['style'] = 'solid'): ChartMark => ({
        kind: 'point', from: value, to: value, text, source, style,
    });
    const depth = (key: 'fourObservations' | 'oneObservation', style: ChartMark['style']): ChartMark[] => SPHEREX_DEPTH.map(entry => {
        const [start, end] = entry.wavelength.value;
        return range(entry[key], `${start}–${end} µm`, style);
    });
    const remaining = REMAINING.vMag.value;
    const model = modelExample();
    return [
        { id: 'p9-predicted', label: 'Planet Nine, predicted', band: P9.envelope.unit, marks: [range(P9.envelope, 'Published envelope', 'light'), range(P9.percentileCurveExtents, 'Percentile-curve extents', 'solid')] },
        { id: 'p9-remaining', label: 'Not yet ruled out', band: REMAINING.vMag.unit, marks: [{ ...point(remaining.value, 'Remaining estimate', REMAINING.vMag.source), low: remaining.value + remaining.lower, high: remaining.value + remaining.upper }] },
        { id: 'model', label: "This repo's model, one example", band: 'V band', marks: [point(model.vMag, `model, at ${P9.semiMajorAxis.value} AU`, `${model.label}; computed in this repo from the published mass, albedo range and semi-major axis`, 'outline')] },
        { id: 'searches', label: 'Optical searches already done', band: 'Multiple optical bands', marks: [...SURVEYS.map(survey => ({ ...point(survey.limit.value, `${survey.name} ${survey.band}`, survey.limit.source), kind: 'tick' as const })), { ...point(PS1_HALF_COMPLETE.value, `PS1 search half complete, ${PS1_HALF_COMPLETE.unit.split(';')[0]}`, PS1_HALF_COMPLETE.source), kind: 'tick' as const }] },
        { id: 'spherex-4', label: 'SPHEREx depth, 4 observations per channel', band: 'AB, per channel', marks: depth('fourObservations', 'solid') },
        { id: 'spherex-1', label: 'SPHEREx depth, one observation (derived)', band: 'AB, per channel', marks: depth('oneObservation', 'outline') },
        { id: 'wise0855', label: `WISE 0855 at ${WISE0855.bandMicrometres.value} µm, a real cold neighbour`, band: 'W2, AB', marks: [point(WISE0855.w2AB.value, 'WISE 0855', WISE0855.w2AB.source)] },
    ];
}

export function magToX(mag: number, plotLeft: number, plotWidth: number): number
{
    return plotLeft + (mag - AXIS.min) / (AXIS.max - AXIS.min) * plotWidth;
}

function escapeText(value: string): string
{
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function sentence(value: string): string
{
    const text = value.charAt(0).toUpperCase() + value.slice(1);
    return text.endsWith('.') ? text : `${text}.`;
}

function markValue(mark: ChartMark): string
{
    const format = (value: number, decimals: number): string => String(Number(value.toFixed(decimals)));
    const value = mark.kind === 'range' ? `${format(mark.from, 2)}–${format(mark.to, 2)}` : format(mark.from, 1);
    const uncertainty = mark.low !== undefined && mark.high !== undefined ? ` (${format(mark.low, 2)}–${format(mark.high, 2)})` : '';
    return `${value}${uncertainty}`;
}

export function planetxChartText(): { title: string; caption: string; notes: string[]; references: ReturnType<typeof references> }
{
    return {
        title: 'How faint would Planet Nine be, and how deep do the searches go?',
        caption: 'The rows are in different bands, so their numbers are not interchangeable. This is an estimate from published numbers, not a search result.',
        notes: [TEXT.bandNote, TEXT.caveat, TEXT.wiseNote, TEXT.stackGain, modelExample().label, `Optical searches have ruled out about ${Math.round(EXCLUDED_FRACTION.value * 100)}% of the synthetic reference population`].map(sentence),
        references: references(),
    };
}

export function planetxChartSvg(opts: { width?: number } = {}): string
{
    const requestedWidth = opts.width ?? 720;
    const width = typeof requestedWidth === 'number' && Number.isFinite(requestedWidth) && requestedWidth >= 320 ? requestedWidth : 320;
    const left = Math.min(230, Math.round(width * 0.42));
    const right = 20;
    const plotWidth = width - left - right;
    const rows = planetxRows();
    const colors = ['var(--gold, #ffc861)', 'var(--gold, #ffc861)', 'var(--gold, #ffc861)', 'var(--ink2, #c2c8d3)', 'var(--neg, #5c96f0)', 'var(--neg, #5c96f0)', 'var(--pos, #f3983a)'];
    const ink = 'var(--ink, #eef1f6)';
    const mute = 'var(--mute, #9aa1b1)';
    const xFor = (mag: number): number => magToX(mag, left, plotWidth);
    let y = 20;
    const groups: string[] = [];
    rows.forEach((row, rowIndex) => {
        const labelY = y + 13;
        const words = row.label.split(' ');
        const lines: string[] = [];
        for (const word of words) {
            const last = lines.length - 1;
            if (last < 0 || `${lines[last]} ${word}`.length * 7 > left - 18) {
                lines.push(word);
            } else {
                lines[last] += ` ${word}`;
            }
        }
        const bandY = labelY + lines.length * 15;
        const sortedMarks = row.marks.map((mark, index) => ({ mark, index }));
        if (row.id === 'searches') {
            sortedMarks.sort((a, b) => a.mark.from - b.mark.from || a.index - b.index);
        }
        let markY = y + (row.marks[0]?.kind === 'range' ? 30 : 23);
        if (row.id === 'searches') {
            markY = bandY + 13;
        } else if (row.marks[0]?.kind === 'point') {
            const mark = row.marks[0];
            const rightEdge = xFor(mark.high ?? mark.from) + (mark.high === undefined ? 4 : 0);
            if (rightEdge + 8 + mark.text.length * 6.6 > width && xFor(mark.low ?? mark.from) - 12 - mark.text.length * 6.6 < left) {
                markY = bandY + 12;
            }
        }
        const rowLabels = lines.map((line, index) => `<text x="8" y="${labelY + index * 15}" fill="${ink}" font-size="13">${escapeText(line)}</text>`).join('');
        groups.push(`<g data-row="${row.id}">${rowLabels}<text x="8" y="${bandY}" fill="${mute}" font-size="11">${escapeText(row.band)}</text>`);
        const above: { x: number; width: number }[] = [];
        sortedMarks.forEach(({ mark, index }, lineIndex) => {
            const x = xFor(mark.from);
            const end = xFor(mark.to);
            const currentY = markY + (mark.kind === 'tick' ? lineIndex * 15 : 0);
            const color = colors[rowIndex];
            const paint = mark.style === 'outline' ? `fill="none" stroke="${color}" stroke-width="1.5"` : `fill="${color}"${mark.style === 'light' ? ' fill-opacity="0.28"' : ''}`;
            let shape = '';
            if (mark.kind === 'range') {
                shape = `<rect x="${x}" y="${currentY - 4}" width="${end - x}" height="8" rx="2" ${paint}/>`;
            } else if (mark.kind === 'tick') {
                shape = `<rect x="${x - 1}" y="${currentY - 5}" width="2" height="10" ${paint}/>`;
            } else {
                shape = `<circle cx="${x}" cy="${currentY}" r="4" ${paint}/>`;
            }
            const whisker = mark.low !== undefined && mark.high !== undefined ? `<line x1="${xFor(mark.low)}" y1="${currentY}" x2="${xFor(mark.high)}" y2="${currentY}" stroke="${color}"/>` : '';
            const textWidth = mark.text.length * 6.6;
            let textX: number;
            let textY: number;
            let anchor = '';
            let baseline = '';
            if (mark.kind === 'range') {
                textX = Math.max(0, Math.min(width - textWidth, x));
                const below = row.id === 'p9-predicted' ? index === 0 : above.some(other => textX < other.x + other.width + 6 && textX + textWidth + 6 > other.x);
                textY = currentY + (below ? 16 : -8);
                if (!below) {
                    above.push({ x: textX, width: textWidth });
                }
            } else {
                const rightEdge = mark.kind === 'tick' ? x + 1 : xFor(mark.high ?? mark.from) + (mark.high === undefined ? 4 : 0);
                const leftEdge = mark.kind === 'tick' ? x - 1 : xFor(mark.low ?? mark.from) - (mark.low === undefined ? 4 : 0);
                const gap = mark.kind === 'tick' ? 6 : 8;
                const flip = rightEdge + gap + textWidth > width;
                textX = flip ? leftEdge - gap : rightEdge + gap;
                textY = currentY;
                anchor = flip ? ' text-anchor="end"' : '';
                baseline = ' dominant-baseline="middle"';
            }
            const mono = /^\d/.test(mark.text) ? ' font-family="var(--mono, ui-monospace, monospace)"' : '';
            const survey = row.id === 'searches' ? ' data-survey-label="true"' : '';
            groups.push(`<g data-mark="${row.id}" data-index="${index}"><title>${escapeText(`${markValue(mark)}; ${mark.source}`)}</title>${whisker}${shape}<text${survey} x="${textX}" y="${textY}"${anchor}${baseline} fill="${color}" font-size="11"${mono}>${escapeText(mark.text)}</text></g>`);
        });
        groups.push('</g>');
        const marksBottom = markY + (row.id === 'searches' ? (row.marks.length - 1) * 15 + 6 : row.marks[0]?.kind === 'range' ? 16 : 6);
        y = Math.max(y + 46, marksBottom + 10, bandY + 10);
    });
    const axisY = y + 5;
    const footerLines: string[] = [];
    for (const word of 'apparent magnitude (fainter to the right; each row in its own band)'.split(' ')) {
        const last = footerLines.length - 1;
        if (last < 0 || `${footerLines[last]} ${word}`.length * 6.6 > width - 16) {
            footerLines.push(word);
        } else {
            footerLines[last] += ` ${word}`;
        }
    }
    const height = axisY + 35 + footerLines.length * 13;
    const ticks: string[] = [];
    const grid: string[] = [];
    for (let mag = AXIS.min; mag <= AXIS.max; mag += AXIS.step) {
        const x = xFor(mag);
        grid.push(`<line data-grid="true" x1="${x}" y1="20" x2="${x}" y2="${axisY}" stroke="${mute}" stroke-opacity="0.14"/>`);
        ticks.push(`<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="${mute}"/><text x="${x}" y="${axisY + 18}" text-anchor="middle" fill="${mute}" font-size="11" font-family="var(--mono, ui-monospace, monospace)">${mag}</text>`);
    }
    const description = rows.map(row => `${row.label} (${row.band}): ${row.marks.map(mark => `${mark.text} ${markValue(mark)}`).join('; ')}.`).join(' ');
    const footer = footerLines.map((line, index) => `<text x="${width / 2}" y="${axisY + 43 + index * 13}" text-anchor="middle" fill="${mute}" font-size="10">${escapeText(line)}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="planetx-title planetx-desc" viewBox="0 0 ${width} ${height}"><title id="planetx-title">Planet Nine brightness and survey depths</title><desc id="planetx-desc">${escapeText(description)}</desc>${grid.join('')}${groups.join('')}<line x1="${left}" y1="${axisY}" x2="${width - right}" y2="${axisY}" stroke="${mute}"/>${ticks.join('')}${footer}</svg>`;
}

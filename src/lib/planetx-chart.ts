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
    return [
        { id: 'p9-predicted', label: 'Planet Nine, predicted', band: P9.envelope.unit, marks: [range(P9.envelope, 'Published envelope', 'light'), range(P9.percentileCurveExtents, 'Percentile-curve extents', 'solid')] },
        { id: 'p9-remaining', label: 'Not yet ruled out', band: REMAINING.vMag.unit, marks: [{ ...point(remaining.value, 'Remaining estimate', REMAINING.vMag.source), low: remaining.value + remaining.lower, high: remaining.value + remaining.upper }] },
        { id: 'model', label: "This repo's model, one example", band: 'V band', marks: [point(modelExample().vMag, `model, at ${P9.semiMajorAxis.value} AU`, P9.semiMajorAxis.source, 'outline')] },
        { id: 'searches', label: 'Optical searches already done', band: 'Multiple optical bands', marks: [...SURVEYS.map(survey => ({ ...point(survey.limit.value, `${survey.name} ${survey.band}`, survey.limit.source), kind: 'tick' as const })), { ...point(PS1_HALF_COMPLETE.value, 'PS1 search half complete', PS1_HALF_COMPLETE.source), kind: 'tick' as const }] },
        { id: 'spherex-4', label: 'SPHEREx depth, 4 observations per channel', band: 'AB, per channel', marks: depth('fourObservations', 'solid') },
        { id: 'spherex-1', label: 'SPHEREx depth, one observation (derived)', band: 'AB, per channel', marks: depth('oneObservation', 'outline') },
        { id: 'wise0855', label: 'WISE 0855 at 4.6 µm, a real cold neighbour', band: 'W2, AB', marks: [point(WISE0855.w2AB.value, 'WISE 0855', WISE0855.w2AB.source)] },
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

export function planetxChartText(): { title: string; caption: string; notes: string[]; references: ReturnType<typeof references> }
{
    return {
        title: 'How faint would Planet Nine be, and how deep do the searches go?',
        caption: 'The rows are in different bands and cannot be compared to better than roughly a magnitude. This is an estimate from published numbers, not a search result.',
        notes: [TEXT.bandNote, TEXT.caveat, TEXT.wiseNote, TEXT.stackGain, modelExample().label, `Optical searches have ruled out about ${EXCLUDED_FRACTION.value * 10 ** AXIS.step}% of the published reference population`].map(sentence),
        references: references(),
    };
}

interface PlacedLabel {
    x: number;
    width: number;
    lane: number;
}

export function planetxChartSvg(opts: { width?: number } = {}): string
{
    const width = opts.width ?? 720;
    const left = 230;
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
        const placed: PlacedLabel[] = [];
        const labels = row.marks.map(mark => {
            const textWidth = mark.text.length * 6.6;
            const x = Math.max(left, Math.min(width - textWidth - 3, xFor(mark.from)));
            let lane = 0;
            while (placed.some(other => other.lane === lane && x < other.x + other.width + 4 && x + textWidth + 4 > other.x)) {
                lane++;
            }
            const label = { x, width: textWidth, lane };
            placed.push(label);
            return label;
        });
        const lanes = Math.max(...labels.map(label => label.lane)) + 1;
        const markY = y + Math.max(32, lanes * 14 + 8);
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
        const rowLabels = lines.map((line, index) => `<text x="8" y="${labelY + index * 15}" fill="${ink}" font-size="13">${escapeText(line)}</text>`).join('');
        groups.push(`<g data-row="${row.id}">${rowLabels}<text x="8" y="${labelY + lines.length * 15}" fill="${mute}" font-size="11">${escapeText(row.band)}</text>`);
        row.marks.forEach((mark, index) => {
            const x = xFor(mark.from);
            const end = xFor(mark.to);
            const color = colors[rowIndex];
            const value = mark.kind === 'range' ? `${mark.from.toFixed(1)}–${mark.to.toFixed(1)}` : mark.from.toFixed(1);
            const uncertainty = mark.low !== undefined && mark.high !== undefined ? ` (${mark.low.toFixed(1)}–${mark.high.toFixed(1)})` : '';
            const paint = mark.style === 'outline' ? `fill="none" stroke="${color}" stroke-width="1.5"` : `fill="${color}"${mark.style === 'light' ? ' fill-opacity="0.28"' : ''}`;
            let shape = '';
            if (mark.kind === 'range') {
                shape = `<rect x="${x}" y="${markY - 4}" width="${end - x}" height="8" rx="2" ${paint}/>`;
            } else if (mark.kind === 'tick') {
                shape = `<rect x="${x - 1}" y="${markY - 6}" width="2" height="12" ${paint}/>`;
            } else {
                shape = `<circle cx="${x}" cy="${markY}" r="4" ${paint}/>`;
            }
            const whisker = mark.low !== undefined && mark.high !== undefined ? `<line x1="${xFor(mark.low)}" y1="${markY}" x2="${xFor(mark.high)}" y2="${markY}" stroke="${color}"/>` : '';
            const label = labels[index]!;
            const survey = row.id === 'searches' ? ' data-survey-label="true"' : '';
            groups.push(`<g data-mark="${row.id}" data-index="${index}"><title>${escapeText(`${value}${uncertainty}; ${mark.source}`)}</title>${whisker}${shape}<text${survey} x="${label.x}" y="${markY - 10 - label.lane * 14}" fill="${color}" font-size="11">${escapeText(mark.text)}</text></g>`);
        });
        groups.push('</g>');
        y = Math.max(markY + 25, labelY + lines.length * 15 + 22);
    });
    const axisY = y + 5;
    const height = axisY + 48;
    const ticks: string[] = [];
    for (let mag = AXIS.min; mag <= AXIS.max; mag += AXIS.step) {
        const x = xFor(mag);
        ticks.push(`<line x1="${x}" y1="${axisY}" x2="${x}" y2="${axisY + 5}" stroke="${mute}"/><text x="${x}" y="${axisY + 18}" text-anchor="middle" fill="${mute}" font-size="11">${mag}</text>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="planetx-title planetx-desc" viewBox="0 0 ${width} ${height}" style="font-family: var(--mono, ui-monospace, monospace)"><title id="planetx-title">Planet Nine brightness and survey depths</title><desc id="planetx-desc">Estimated Planet Nine brightness, optical search limits, SPHEREx depths and the brightness of a nearby cold object. Rows use different bands.</desc>${groups.join('')}<line x1="${left}" y1="${axisY}" x2="${width - right}" y2="${axisY}" stroke="${mute}"/>${ticks.join('')}<text x="${width / 2}" y="${height - 5}" text-anchor="middle" fill="${mute}" font-size="10">apparent magnitude (fainter to the right; each row in its own band)</text></svg>`;
}

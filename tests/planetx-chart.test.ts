import { describe, expect, it } from 'vitest';
import { AXIS, magToX, planetxChartSvg, planetxChartText, planetxRows } from '../src/lib/planetx-chart';
import { EXCLUDED_FRACTION, modelExample, P9, PS1_HALF_COMPLETE, references, REMAINING, SPHEREX_DEPTH, SURVEYS, TEXT, WISE0855 } from '../src/lib/planetx';

describe('Planet Nine depth chart', () => {
    it('uses the published data and keeps all values on the axis', () => {
        const rows = planetxRows();
        expect(rows.map(row => row.id)).toEqual(['p9-predicted', 'p9-remaining', 'model', 'searches', 'spherex-4', 'spherex-1', 'wise0855']);
        expect(rows[0]!.marks.map(mark => [mark.from, mark.to, mark.source])).toEqual([P9.envelope, P9.percentileCurveExtents].map(value => [...value.value, value.source]));
        expect(rows[1]!.marks[0]).toMatchObject({ from: REMAINING.vMag.value.value, to: REMAINING.vMag.value.value, low: REMAINING.vMag.value.value + REMAINING.vMag.value.lower, high: REMAINING.vMag.value.value + REMAINING.vMag.value.upper, source: REMAINING.vMag.source });
        expect(rows[2]!.marks[0]!.from).toBe(modelExample().vMag);
        expect(rows[3]!.marks.map(mark => [mark.from, mark.source])).toEqual([...SURVEYS.map(survey => [survey.limit.value, survey.limit.source]), [PS1_HALF_COMPLETE.value, PS1_HALF_COMPLETE.source]]);
        for (const [index, key] of [[4, 'fourObservations'], [5, 'oneObservation']] as const) {
            expect(rows[index]!.marks.map(mark => [mark.from, mark.to, mark.source])).toEqual(SPHEREX_DEPTH.map(depth => [...depth[key].value, depth[key].source]));
        }
        expect(rows[6]!.marks[0]!.from).toBe(WISE0855.w2AB.value);
        for (const mark of rows.flatMap(row => row.marks)) {
            for (const value of [mark.from, mark.to, mark.low ?? mark.from, mark.high ?? mark.to]) {
                expect(value).toBeGreaterThanOrEqual(AXIS.min);
                expect(value).toBeLessThanOrEqual(AXIS.max);
            }
        }
    });

    it('provides sourced, qualified explanatory text', () => {
        const text = planetxChartText();
        expect(text.caption).toMatch(/estimate/i);
        expect(text.references).toEqual(references());
        expect(text.references.find(ref => ref.key === 'orbit-v2')).toBeUndefined();
        const refIndexByUrl = new Map(text.references.map((ref, index) => [ref.url, index + 1]));
        for (const mark of planetxRows().flatMap(row => row.marks)) {
            for (const url of mark.source.match(/https?:\/\/[^\s;]+/g) ?? []) {
                const refNumber = refIndexByUrl.get(url);
                expect(refNumber).toBeDefined();
                expect(refNumber).toBeGreaterThanOrEqual(1);
                expect(refNumber).toBeLessThanOrEqual(text.references.length);
            }
        }
        expect(text.notes.filter(note => /one axis/i.test(note))).toHaveLength(1);
        expect(text.notes.join(' ')).toContain(`${Math.round(EXCLUDED_FRACTION.value * 100)}%`);
        expect(text.notes.join(' ').toLowerCase()).toContain(TEXT.bandNote.toLowerCase());
        expect(JSON.stringify(text)).not.toMatch(/\b(discover|confirm|detect)\b/i);
        expect(text.caption).not.toMatch(/magnitude/i);
        expect(text.notes.join(' ')).toContain('synthetic reference population');
    });

    it('describes every mark with the same values as its tooltip', () => {
        const rows = planetxRows();
        const model = rows.find(row => row.id === 'model')!.marks[0]!;
        expect(model.source).toContain(modelExample().label);
        expect(model.source).not.toMatch(/[-+]\d+\s*\/\s*[-+]\d+|\b\d{4}\b/);
        expect(rows.find(row => row.id === 'searches')!.marks.at(-1)!.text).toMatch(/V mag$/);
        expect(rows.find(row => row.id === 'wise0855')!.label).toContain(String(WISE0855.bandMicrometres.value));
        const svg = planetxChartSvg();
        const desc = svg.match(/<desc id="planetx-desc">(.*?)<\/desc>/)![1]!;
        for (const row of rows) {
            expect(desc).toContain(`${row.label} (${row.band}):`);
            for (const mark of row.marks) {
                const title = [...svg.matchAll(/<g data-mark="([^"]+)" data-index="(\d+)"><title>(.*?)<\/title>/g)]
                    .find(match => match[1] === row.id && row.marks[Number(match[2])] === mark)![3]!;
                expect(desc).toContain(`${mark.text} ${title.split(';')[0]}`);
            }
        }
        expect(svg).toContain('<title>18.75–19.15;');
        expect(svg).toContain('<title>17.23;');
        expect(svg).toContain('<title>20.12;');
        expect(svg).not.toContain('<title>17.2;');
        expect(svg).not.toContain('<title>20.1;');
    });

    it('clamps far-left range labels to the plot left edge so they never sit over row names', () => {
        for (const width of [320, 720]) {
            const left = Math.min(230, Math.round(width * 0.42));
            const svg = planetxChartSvg({
                width,
                rows: [
                    {
                        id: 'far-left',
                        label: 'Far-left range row',
                        band: 'V mag',
                        marks: [
                            { kind: 'range', from: AXIS.min - 0.5, to: AXIS.min + 1, text: 'Far-left range', source: P9.envelope.source, style: 'solid' },
                        ],
                    },
                ],
            });
            const markText = svg.match(/<g data-mark="far-left" data-index="0">[\s\S]*?<text\b([^>]*)>Far-left range<\/text><\/g>/);
            expect(markText).not.toBeNull();
            const labelX = Number(markText![1]!.match(/\bx="([\d.]+)"/)![1]);
            expect(labelX).toBe(left);
        }
        const narrowLeft = Math.min(230, Math.round(320 * 0.42));
        const wideLabelSvg = planetxChartSvg({
            width: 320,
            rows: [
                {
                    id: 'far-left-wide',
                    label: 'Far-left wide label',
                    band: 'V mag',
                    marks: [
                        { kind: 'range', from: AXIS.min, to: AXIS.min + 2, text: 'Wide range label at axis start', source: P9.envelope.source, style: 'solid' },
                    ],
                },
            ],
        });
        const wideMarkText = wideLabelSvg.match(/<g data-mark="far-left-wide" data-index="0">[\s\S]*?<text\b([^>]*)>Wide range label at axis start<\/text><\/g>/);
        expect(wideMarkText).not.toBeNull();
        expect(Number(wideMarkText![1]!.match(/\bx="([\d.]+)"/)![1])).toBe(narrowLeft);
    });

    it('normalizes invalid and undersized widths', () => {
        const expected = planetxChartSvg({ width: 320 });
        for (const width of [0, NaN, 'nope' as never]) {
            expect(planetxChartSvg({ width })).toBe(expected);
            expect(planetxChartSvg({ width })).not.toContain('NaN');
        }
    });

    it.each([320, 480, 720, 1080, 1600])('renders valid accessible geometry at %i pixels', width => {
        const svg = planetxChartSvg({ width });
        const stack: string[] = [];
        for (const match of svg.matchAll(/<\/?([\w-]+)\b[^>]*>/g)) {
            if (match[0].startsWith('</')) {
                expect(stack.pop()).toBe(match[1]);
            } else if (!match[0].endsWith('/>')) {
                stack.push(match[1]!);
            }
        }
        expect(stack).toEqual([]);
        expect(svg).toMatch(/^<svg\b[^>]*viewBox=/);
        expect(svg).toContain('role="img"');
        expect(svg).toContain('<title');
        expect(svg).toContain('<desc');
        const height = Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
        for (const match of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
            const attrs = match[1]!;
            const x = Number(attrs.match(/\bx="([\d.]+)"/)![1]);
            const y = Number(attrs.match(/\by="([\d.]+)"/)![1]);
            const size = Number(attrs.match(/font-size="([\d.]+)"/)![1]);
            const textWidth = match[2]!.replace(/&(?:amp|lt|gt|quot);/g, 'x').length * 6.6;
            const start = attrs.includes('text-anchor="middle"') ? x - textWidth / 2 : attrs.includes('text-anchor="end"') ? x - textWidth : x;
            const middle = attrs.includes('dominant-baseline="middle"');
            expect(start).toBeGreaterThanOrEqual(0);
            expect(start + textWidth).toBeLessThanOrEqual(width);
            expect(y - (middle ? size / 2 : size)).toBeGreaterThanOrEqual(0);
            expect(y + (middle ? size / 2 : 0)).toBeLessThanOrEqual(height);
        }
        expect(svg).not.toMatch(/\b(discover|confirm|detect)\b/i);
        for (const match of svg.matchAll(/\brx="([\d.]+)"/g)) {
            expect(Number(match[1])).toBeLessThanOrEqual(2);
        }
        for (const match of svg.matchAll(/<circle\b[^>]*\br="([\d.]+)"/g)) {
            expect(Number(match[1])).toBeLessThanOrEqual(5);
        }
        expect([...svg.matchAll(/<line\b/g)]).toHaveLength(2 * ((AXIS.max - AXIS.min) / AXIS.step + 1) + 2);
        expect(svg).not.toMatch(/<path\b/);
        expect(magToX(AXIS.min, 230, width - 250)).toBe(230);
        expect(magToX(AXIS.max, 230, width - 250)).toBe(width - 20);
        expect(magToX((AXIS.min + AXIS.max) / 2, 230, width - 250)).toBeCloseTo((230 + width - 20) / 2);
        const left = Math.min(230, Math.round(width * 0.42));
        const marks = [...svg.matchAll(/<g data-mark="([^"]+)" data-index="(\d+)"[^>]*>([\s\S]*?)<\/g>/g)];
        expect(marks).toHaveLength(planetxRows().flatMap(row => row.marks).length);
        for (const match of marks) {
            const mark = planetxRows().find(row => row.id === match[1])!.marks[Number(match[2])]!;
            const position = match[3]!.match(/<(?:rect|circle)\b[^>]*\b(?:x|cx)="([\d.]+)"/);
            expect(position).not.toBeNull();
            const actual = Number(position![1]) + (mark.kind === 'tick' ? 1 : 0);
            expect(actual).toBeCloseTo(magToX(mark.from, left, width - left - 20), 2);
            expect(match[3]).toContain('<title>');
            if (mark.kind === 'range') {
                const rectWidth = Number(match[3]!.match(/\bwidth="([\d.]+)"/)![1]);
                expect(actual + rectWidth).toBeCloseTo(magToX(mark.to, left, width - left - 20), 2);
            }
            if (mark.kind === 'tick') {
                expect(match[3]).toMatch(/\bwidth="2"/);
            }
        }
        const surveys = marks.filter(mark => mark[1] === 'searches');
        expect(surveys).toHaveLength(SURVEYS.length + 1);
        const magnitudes = surveys.map(mark => planetxRows()[3]!.marks[Number(mark[2])]!.from);
        expect(magnitudes).toEqual([...magnitudes].sort((a, b) => a - b));
        expect(surveys.map(mark => Number(mark[2]))).toEqual(planetxRows()[3]!.marks.map((mark, index) => ({ mark, index })).sort((a, b) => a.mark.from - b.mark.from || a.index - b.index).map(item => item.index));
        const surveyYs = surveys.map(mark => {
            const tickY = Number(mark[3]!.match(/<rect[^>]* y="([\d.]+)"/)![1]) + 5;
            const labelY = Number(mark[3]!.match(/<text[^>]* y="([\d.]+)"/)![1]);
            expect(labelY).toBe(tickY);
            return labelY;
        });
        expect(new Set(surveyYs).size).toBe(surveys.length);
        for (let i = 1; i < surveyYs.length; i++) {
            expect(surveyYs[i]! - surveyYs[i - 1]!).toBe(15);
        }
        for (const row of planetxRows()) {
            const rowStart = svg.indexOf(`<g data-row="${row.id}">`);
            const nextRow = svg.indexOf('<g data-row=', rowStart + 1);
            const section = svg.slice(rowStart, nextRow < 0 ? svg.indexOf('</g>', svg.lastIndexOf('<g data-mark=')) + 4 : nextRow);
            const boxes = [...section.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map(match => {
                const attrs = match[1]!;
                const x = Number(attrs.match(/\bx="([\d.]+)"/)![1]);
                const y = Number(attrs.match(/\by="([\d.]+)"/)![1]);
                const size = Number(attrs.match(/font-size="([\d.]+)"/)![1]);
                const textWidth = match[2]!.replace(/&(?:amp|lt|gt|quot);/g, 'x').length * 6.6;
                const start = attrs.includes('text-anchor="end"') ? x - textWidth : x;
                const middle = attrs.includes('dominant-baseline="middle"');
                return { start, end: start + textWidth, top: middle ? y - size / 2 : y - size, bottom: middle ? y + size / 2 : y };
            });
            for (const [i, box] of boxes.entries()) {
                expect(box.start).toBeGreaterThanOrEqual(0);
                expect(box.end).toBeLessThanOrEqual(width);
                for (const other of boxes.slice(i + 1)) {
                    expect(box.end <= other.start || other.end <= box.start || box.bottom <= other.top || other.bottom <= box.top).toBe(true);
                }
            }
        }
        const predicted = marks.filter(mark => mark[1] === 'p9-predicted');
        for (const mark of predicted) {
            const barY = Number(mark[3]!.match(/<rect[^>]* y="([\d.]+)"/)![1]) + 4;
            const labelY = Number(mark[3]!.match(/<text[^>]* y="([\d.]+)"/)![1]);
            expect(labelY).toBe(barY + (Number(mark[2]) === 0 ? 16 : -8));
        }
        for (const mark of marks.filter(item => item[1]!.startsWith('spherex-'))) {
            expect(mark[3]).toContain('font-family="var(--mono, ui-monospace, monospace)"');
            const barY = Number(mark[3]!.match(/<rect[^>]* y="([\d.]+)"/)![1]) + 4;
            const labelY = Number(mark[3]!.match(/<text[^>]* y="([\d.]+)"/)![1]);
            expect([barY - 8, barY + 16]).toContain(labelY);
        }
        for (const mark of marks.filter(item => ['p9-remaining', 'model', 'wise0855'].includes(item[1]!))) {
            const body = mark[3]!;
            const circleX = Number(body.match(/<circle[^>]* cx="([\d.]+)"/)![1]);
            const circleY = Number(body.match(/<circle[^>]* cy="([\d.]+)"/)![1]);
            const attrs = body.match(/<text([^>]*)>/)![1]!;
            const labelX = Number(attrs.match(/\bx="([\d.]+)"/)![1]);
            expect(Number(attrs.match(/\by="([\d.]+)"/)![1])).toBe(circleY);
            const whisker = body.match(/<line[^>]* x1="([\d.]+)"[^>]* x2="([\d.]+)"/);
            const minX = whisker ? Number(whisker[1]) : circleX - 4;
            const maxX = whisker ? Number(whisker[2]) : circleX + 4;
            expect(attrs.includes('text-anchor="end"') ? labelX <= minX - 8 : labelX >= maxX + 8).toBe(true);
        }
        expect(svg.match(/^<svg[^>]*>/)![0]).not.toContain('font-family');
        const grid = [...svg.matchAll(/<line\b[^>]*data-grid="true"[^>]*\/>/g)];
        expect(grid).toHaveLength((AXIS.max - AXIS.min) / AXIS.step + 1);
        expect(grid.length).toBeLessThanOrEqual(6);
        for (const line of grid) {
            expect(line[0]).toContain('stroke="var(--mute, #9aa1b1)" stroke-opacity="0.14"');
        }
        expect([...svg.matchAll(/<text[^>]*font-family="var\(--mono, ui-monospace, monospace\)"[^>]*>(\d+)<\/text>/g)]).toHaveLength(grid.length);
    });
});

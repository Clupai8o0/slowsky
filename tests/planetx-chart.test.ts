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
        expect(text.notes.join(' ')).toContain(`${EXCLUDED_FRACTION.value * 100}%`);
        expect(text.notes.join(' ').toLowerCase()).toContain(TEXT.bandNote.toLowerCase());
        expect(JSON.stringify(text)).not.toMatch(/\b(discover|confirm|detect)\b/i);
    });

    it.each([480, 720, 1080])('renders valid accessible geometry at %i pixels', width => {
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
        expect(svg).not.toMatch(/\b(discover|confirm|detect)\b/i);
        for (const match of svg.matchAll(/\brx="([\d.]+)"/g)) {
            expect(Number(match[1])).toBeLessThanOrEqual(2);
        }
        for (const match of svg.matchAll(/<circle\b[^>]*\br="([\d.]+)"/g)) {
            expect(Number(match[1])).toBeLessThanOrEqual(5);
        }
        expect([...svg.matchAll(/<line\b/g)]).toHaveLength((AXIS.max - AXIS.min) / AXIS.step + 3);
        expect(svg).not.toMatch(/<path\b/);
        expect(magToX(AXIS.min, 230, width - 250)).toBe(230);
        expect(magToX(AXIS.max, 230, width - 250)).toBe(width - 20);
        expect(magToX((AXIS.min + AXIS.max) / 2, 230, width - 250)).toBeCloseTo((230 + width - 20) / 2);
        const marks = [...svg.matchAll(/<g data-mark="([^"]+)" data-index="(\d+)"[^>]*>([\s\S]*?)<\/g>/g)];
        expect(marks).toHaveLength(planetxRows().flatMap(row => row.marks).length);
        for (const match of marks) {
            const mark = planetxRows().find(row => row.id === match[1])!.marks[Number(match[2])]!;
            const position = match[3]!.match(/<(?:rect|circle)\b[^>]*\b(?:x|cx)="([\d.]+)"/);
            expect(position).not.toBeNull();
            const actual = Number(position![1]) + (mark.kind === 'tick' ? 1 : 0);
            expect(actual).toBeCloseTo(magToX(mark.from, 230, width - 250), 2);
            expect(match[3]).toContain('<title>');
            if (mark.kind === 'range') {
                const rectWidth = Number(match[3]!.match(/\bwidth="([\d.]+)"/)![1]);
                expect(actual + rectWidth).toBeCloseTo(magToX(mark.to, 230, width - 250), 2);
            }
            if (mark.kind === 'tick') {
                expect(match[3]).toMatch(/\bwidth="2"/);
            }
        }
        const labels = [...svg.matchAll(/<text data-survey-label="true" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]), width: match[3]!.replace(/&amp;/g, '&').length * 6.6 }));
        expect(labels).toHaveLength(SURVEYS.length + 1);
        for (let i = 0; i < labels.length; i++) {
            const first = labels[i]!;
            expect(first.x).toBeGreaterThanOrEqual(0);
            expect(first.x + first.width).toBeLessThanOrEqual(width);
            for (let j = i + 1; j < labels.length; j++) {
                const second = labels[j]!;
                if (first.y === second.y) {
                    expect(first.x + first.width <= second.x || second.x + second.width <= first.x).toBe(true);
                }
            }
        }
    });
});

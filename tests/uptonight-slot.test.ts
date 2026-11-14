import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURES, featuresFrom } from '../src/ui/slots';
import { mountUpTonight, upTonightHtml, UP_TONIGHT_LABEL } from '../src/ui/uptonight-slot';
import { upTonight } from '../src/lib/uptonight';
import { upTonightText } from '../src/ui/uptonight-view';

const RW_AUR = { ra: 76.95652603458333, dec: 30.401438173888888 };
const EPS_IND = { ra: 331.04414658852124, dec: -56.782844195116105 };
const box = () => ({ hidden: true, innerHTML: '' }) as HTMLElement;

describe('Tonight\'s sky slot', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('is switched off by default, and a preview build can switch it on', () => {
        expect(DEFAULT_FEATURES.upTonight).toBe(false);
        expect(featuresFrom('upTonight').upTonight).toBe(true);
    });

    it('off: the box stays hidden and empty and no timer is started', () => {
        const el = box();
        const slot = mountUpTonight(el, { enabled: false, now: () => new Date('2026-11-15T02:00:00Z') });
        slot.update(RW_AUR);
        expect(el.hidden).toBe(true);
        expect(el.innerHTML).toBe('');
        expect(vi.getTimerCount()).toBe(0);
        slot.stop();
    });

    it('on: prints the label, the module\'s own line and its note, and nothing else', () => {
        const now = new Date('2026-11-15T02:00:00Z');
        const el = box();
        const slot = mountUpTonight(el, { enabled: true, now: () => now });
        slot.update(RW_AUR);
        const text = upTonightText(upTonight(RW_AUR.ra, RW_AUR.dec, now))!;
        expect(text.line).toMatch(/^Tonight from Melbourne: highest in the dark at 02:5\d, about 22° above the horizon, facing north\.$/);
        expect(el.hidden).toBe(false);
        expect(el.innerHTML).toBe(`<span class="sk-sub">${UP_TONIGHT_LABEL}</span> ${text.line} <small>${text.note}</small>`);
        expect(el.innerHTML).not.toMatch(/visible|can be seen with|telescope|binocular|naked eye/i);
        slot.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('works the line out again every minute, so "now" does not go stale on an open page', () => {
        // eps Ind B from Melbourne on 15 Nov: going down all evening. At 21:30 it is "highest now"; an hour later the
        // line must give the new height, not the old one.
        let now = new Date('2026-11-15T10:30:00Z');
        const el = box();
        const slot = mountUpTonight(el, { enabled: true, now: () => now });
        slot.update(EPS_IND);
        const first = el.innerHTML;
        expect(first).toContain('From Melbourne, until the dark ends: highest now, about 65° above the horizon');
        now = new Date('2026-11-15T11:30:00Z');
        slot.update(EPS_IND); // same spot: nothing is worked out again until the minute tick
        expect(el.innerHTML).toBe(first);
        vi.advanceTimersByTime(60000);
        expect(el.innerHTML).not.toBe(first);
        expect(el.innerHTML).toBe(upTonightHtml(EPS_IND, now));
        expect(el.innerHTML).toContain('highest now, about ');
        slot.stop();
    });

    it('follows the spot on screen and hides when there is no position or no answer', () => {
        const now = new Date('2026-11-15T02:00:00Z');
        const el = box();
        const slot = mountUpTonight(el, { enabled: true, now: () => now });
        slot.update(RW_AUR);
        const first = el.innerHTML;
        slot.update(EPS_IND);
        expect(el.innerHTML).not.toBe(first);
        expect(el.innerHTML).toBe(upTonightHtml(EPS_IND, now));
        slot.update(null);
        expect(el.hidden).toBe(true);
        expect(el.innerHTML).toBe('');
        slot.update({ ra: NaN, dec: 0 });
        expect(el.hidden).toBe(true);
        expect(el.innerHTML).toBe('');
        slot.update({ ra: 40, dec: 60 });
        expect(el.hidden).toBe(false);
        expect(el.innerHTML).toBe(`<span class="sk-sub">${UP_TONIGHT_LABEL}</span> This spot never rises above the horizon from Melbourne.`);
        slot.stop();
    });

    it('starts one timer however many times the page renders', () => {
        const el = box();
        const slot = mountUpTonight(el, { enabled: true, now: () => new Date('2026-11-15T02:00:00Z') });
        for (let i = 0; i < 20; i++) {
            slot.update(i % 2 ? RW_AUR : EPS_IND);
        }
        expect(vi.getTimerCount()).toBe(1);
        slot.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});

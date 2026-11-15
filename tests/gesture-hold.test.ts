import { describe, expect, it } from 'vitest';
import { createHoldCompare, type HoldView } from '../src/ui/gesture-hold';
import { DEFAULT_FEATURES, featuresFrom } from '../src/ui/slots';

const HOLD_TEXT = 'Showing the first frame. Let go to go back.';

function createFakeHoldView(init?: { canHold?: boolean; token?: unknown; index?: number })
{
    const state = {
        canHold: init?.canHold ?? true,
        token: init && 'token' in init ? init.token : { id: 1 },
        index: init?.index ?? 2,
    };
    const shown: number[] = [];
    const said: string[] = [];
    const events: string[] = [];
    let pauses = 0;

    const view: HoldView = {
        canHold: () => state.canHold,
        token: () => state.token,
        index: () => state.index,
        put: (index: number) => {
            state.index = index;
            events.push(`put:${index}`);
        },
        show: (index: number) => {
            state.index = index;
            shown.push(index);
            events.push(`show:${index}`);
        },
        pause: () => {
            pauses += 1;
            events.push(`pause@${state.index}`);
        },
        say: (text: string) => {
            said.push(text);
            events.push(`say:${text}`);
        },
    };

    return {
        view,
        state,
        shown,
        said,
        events,
        pauses: () => pauses,
    };
}

describe('gestures feature switch', () => {
    it('is switched off by default, and a preview build can switch it on', () => {
        expect(DEFAULT_FEATURES.gestures).toBe(false);
        expect(featuresFrom('gestures').gestures).toBe(true);
    });
});

describe('createHoldCompare', () => {
    it('pauses on the real frame, shows frame 0, and announces the hold on start', () => {
        const fake = createFakeHoldView({ index: 2 });
        const hold = createHoldCompare(fake.view);

        expect(hold.active()).toBe(false);
        hold.start();

        expect(hold.active()).toBe(true);
        expect(fake.state.index).toBe(0);
        expect(fake.pauses()).toBe(1);
        expect(fake.shown).toEqual([0]);
        expect(fake.said).toEqual([HOLD_TEXT]);
        expect(fake.events).toEqual([
            'pause@2',
            'show:0',
            `say:${HOLD_TEXT}`,
        ]);
    });

    it('does nothing when started on frame 0', () => {
        const fake = createFakeHoldView({ index: 0 });
        const hold = createHoldCompare(fake.view);

        hold.start();

        expect(hold.active()).toBe(false);
        expect(fake.pauses()).toBe(0);
        expect(fake.shown).toEqual([]);
        expect(fake.said).toEqual([]);
        expect(fake.events).toEqual([]);
    });

    it('does nothing when canHold() is false on start', () => {
        const fake = createFakeHoldView({ canHold: false, index: 3 });
        const hold = createHoldCompare(fake.view);

        hold.start();

        expect(hold.active()).toBe(false);
        expect(fake.state.index).toBe(3);
        expect(fake.pauses()).toBe(0);
        expect(fake.shown).toEqual([]);
        expect(fake.said).toEqual([]);
    });

    it('restores the remembered index without clearing the redraw announcement, then stays inactive', () => {
        const fake = createFakeHoldView({ index: 3 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        fake.events.length = 0;

        hold.end();

        expect(hold.active()).toBe(false);
        expect(fake.state.index).toBe(3);
        expect(fake.pauses()).toBe(1);
        expect(fake.shown).toEqual([0, 3]);
        expect(fake.said).toEqual([HOLD_TEXT]);
        expect(fake.events).toEqual(['show:3']);

        hold.end();
        expect(fake.events).toEqual(['show:3']);
    });

    it('does not restore on end after the token changed', () => {
        const fake = createFakeHoldView({ token: { result: 'a' }, index: 2 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        fake.state.token = { result: 'b' };
        fake.events.length = 0;

        hold.end();

        expect(hold.active()).toBe(false);
        expect(fake.shown).toEqual([0]);
        expect(fake.said).toEqual([HOLD_TEXT, '']);
        expect(fake.events).toEqual(['say:']);
    });

    it('does not restore on end after the index moved off 0', () => {
        const fake = createFakeHoldView({ index: 2 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        fake.state.index = 1;
        fake.events.length = 0;

        hold.end();

        expect(hold.active()).toBe(false);
        expect(fake.state.index).toBe(1);
        expect(fake.shown).toEqual([0]);
        expect(fake.events).toEqual(['say:']);
    });

    it('restores on end when canHold() turned false', () => {
        const fake = createFakeHoldView({ index: 4 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        fake.state.canHold = false;

        hold.end();

        expect(hold.active()).toBe(false);
        expect(fake.shown).toEqual([0, 4]);
        expect(fake.said).toEqual([HOLD_TEXT]);
    });

    it('exposes the real index only during a hold and forgets it on end or cancel', () => {
        const fake = createFakeHoldView({ index: 3 });
        const hold = createHoldCompare(fake.view);
        expect(hold.heldIndex()).toBeNull();
        hold.start();
        expect(hold.heldIndex()).toBe(3);
        hold.end();
        expect(hold.heldIndex()).toBeNull();
        hold.start();
        expect(hold.heldIndex()).toBe(3);
        hold.cancel();
        expect(hold.heldIndex()).toBeNull();
    });

    it('clears the hold before restoring so redraw sees the real index', () => {
        const fake = createFakeHoldView({ index: 3 });
        const hold = createHoldCompare(fake.view);
        const activeDuringShow: boolean[] = [];
        const show = fake.view.show;
        fake.view.show = (index) => {
            activeDuringShow.push(hold.active());
            show(index);
        };
        hold.start();
        hold.end();
        expect(activeDuringShow).toEqual([true, false]);
    });

    it('puts the real index back and clears the announcement on cancel; a following end does nothing', () => {
        const fake = createFakeHoldView({ index: 2 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        expect(hold.active()).toBe(true);
        fake.events.length = 0;

        hold.cancel();
        expect(hold.active()).toBe(false);
        expect(fake.shown).toEqual([0]);
        expect(fake.state.index).toBe(2);
        expect(fake.events).toEqual(['put:2', 'say:']);

        hold.end();
        expect(hold.active()).toBe(false);
        expect(fake.shown).toEqual([0]);
        expect(fake.events).toEqual(['put:2', 'say:']);
    });

    it.each(['token', 'index'] as const)('clears the announcement without putting when %s changed', (changed) => {
        const fake = createFakeHoldView({ index: 2 });
        const hold = createHoldCompare(fake.view);
        hold.start();
        if (changed === 'token') {
            fake.state.token = {};
        } else {
            fake.state.index = 1;
        }
        fake.events.length = 0;

        hold.cancel();

        expect(fake.events).toEqual(['say:']);
        expect(hold.active()).toBe(false);
    });

    it('does nothing when cancel is called without a hold', () => {
        const fake = createFakeHoldView();
        createHoldCompare(fake.view).cancel();
        expect(fake.events).toEqual([]);
    });

    it('keeps the first remembered index when start is called again while active', () => {
        const fake = createFakeHoldView({ index: 3 });
        const hold = createHoldCompare(fake.view);

        hold.start();
        fake.state.index = 2;
        hold.start();

        expect(hold.active()).toBe(true);
        expect(fake.pauses()).toBe(1);
        expect(fake.shown).toEqual([0]);
        expect(fake.said).toEqual([HOLD_TEXT]);

        fake.state.index = 0;
        hold.end();
        expect(fake.state.index).toBe(3);
        expect(fake.shown).toEqual([0, 3]);
    });

    it('does nothing when end is called without start', () => {
        const fake = createFakeHoldView({ index: 0 });
        const hold = createHoldCompare(fake.view);

        hold.end();

        expect(hold.active()).toBe(false);
        expect(fake.pauses()).toBe(0);
        expect(fake.shown).toEqual([]);
        expect(fake.said).toEqual([]);
    });
});

import { describe, expect, it } from 'vitest';
import {
    attachGestures,
    createGestures,
    GESTURE_DEFAULTS,
    type GestureHandlers,
    type GestureTarget,
    type PointerSample,
} from '../src/ui/gestures';

function sample(
    kind: PointerSample['kind'],
    x: number,
    y: number,
    t: number,
    over: Partial<PointerSample> = {},
): PointerSample
{
    return { id: 1, x, y, t, kind, primary: true, ...over };
}

interface FakePointerEvent {
    pointerId: number;
    clientX: number;
    clientY: number;
    timeStamp: number;
    isPrimary: boolean;
    pointerType: string;
    preventDefault(): void;
}

function pointerEvent(
    x: number,
    y: number,
    t: number,
    over: Partial<Omit<FakePointerEvent, 'preventDefault'>> = {},
): FakePointerEvent
{
    return {
        pointerId: 1,
        clientX: x,
        clientY: y,
        timeStamp: t,
        isPrimary: true,
        pointerType: 'touch',
        ...over,
        preventDefault(): void
        {
            throw new Error('preventDefault must not be called');
        },
    };
}

function createFakeTarget(initialStyle?: { touchAction?: string })
{
    const listeners = new Map<string, Set<(event: any) => void>>();
    const passiveFlags: Array<boolean | undefined> = [];

    const target: GestureTarget = {
        ...(initialStyle !== undefined ? { style: initialStyle } : {}),
        addEventListener(type: string, listener: (event: any) => void, options?: { passive?: boolean }): void
        {
            passiveFlags.push(options?.passive);
            let group = listeners.get(type);
            if (!group) {
                group = new Set();
                listeners.set(type, group);
            }
            group.add(listener);
        },
        removeEventListener(type: string, listener: (event: any) => void): void
        {
            const group = listeners.get(type);
            if (group) {
                group.delete(listener);
                if (group.size === 0) {
                    listeners.delete(type);
                }
            }
        },
    };

    function emit(type: string, event: FakePointerEvent): void
    {
        const group = listeners.get(type);
        if (!group) {
            return;
        }
        for (const listener of [...group]) {
            listener(event);
        }
    }

    function listenerCount(): number
    {
        let count = 0;
        for (const group of listeners.values()) {
            count += group.size;
        }
        return count;
    }

    return { target, emit, listenerCount, passiveFlags };
}

function createFakeTimers()
{
    const active = new Map<number, { fn: () => void; ms: number }>();
    const scheduled: Array<{ id: number; ms: number }> = [];
    const cleared: unknown[] = [];
    let nextId = 0; // Starts at 0 to verify falsy handles are still cleared.

    function setTimer(fn: () => void, ms: number): unknown
    {
        const id = nextId++;
        active.set(id, { fn, ms });
        scheduled.push({ id, ms });
        return id;
    }

    function clearTimer(handle: unknown): void
    {
        cleared.push(handle);
        if (typeof handle === 'number') {
            active.delete(handle);
        }
    }

    function fireAll(): void
    {
        for (const [id, entry] of [...active.entries()]) {
            active.delete(id);
            entry.fn();
        }
    }

    return { setTimer, clearTimer, active, scheduled, cleared, fireAll };
}

function recordHandlers(): { log: string[]; handlers: GestureHandlers }
{
    const log: string[] = [];
    const handlers: GestureHandlers = {
        prev(): void
        {
            log.push('prev');
        },
        next(): void
        {
            log.push('next');
        },
        holdStart(): void
        {
            log.push('hold-start');
        },
        holdEnd(): void
        {
            log.push('hold-end');
        },
    };
    return { log, handlers };
}

describe('createGestures state machine', () => {
    it('exports expected defaults and honours custom options', () => {
        expect(GESTURE_DEFAULTS).toEqual({
            swipeMinPx: 40,
            swipeMaxMs: 600,
            holdMs: 350,
            slopPx: 10,
        });

        const custom = createGestures({ swipeMinPx: 20, swipeMaxMs: 150, holdMs: 200, slopPx: 4 });
        expect(custom.feed(sample('down', 50, 50, 10))).toEqual([]);
        expect(custom.holdDueAt()).toBe(210);
        expect(custom.feed(sample('up', 30, 50, 160))).toEqual(['next']);
    });

    it('steps next on swipe left and prev on swipe right', () => {
        const g = createGestures();

        expect(g.feed(sample('down', 200, 100, 0))).toEqual([]);
        expect(g.feed(sample('move', 140, 105, 80))).toEqual([]);
        expect(g.feed(sample('up', 120, 105, 150))).toEqual(['next']);

        expect(g.feed(sample('down', 120, 100, 200))).toEqual([]);
        expect(g.feed(sample('move', 175, 95, 260))).toEqual([]);
        expect(g.feed(sample('up', 210, 95, 320))).toEqual(['prev']);
    });

    it('ignores gestures that are too short, too slow, or mostly vertical', () => {
        const g = createGestures();

        // Too short: 39 px (< 40 px)
        g.feed(sample('down', 100, 100, 0));
        expect(g.feed(sample('up', 61, 100, 120))).toEqual([]);

        // Too slow: 601 ms (> 600 ms)
        g.feed(sample('down', 100, 100, 0));
        expect(g.feed(sample('up', 20, 100, 601))).toEqual([]);

        // Mostly vertical: |dx| = 50, |dy| = 40 (50 <= 1.5 * 40)
        g.feed(sample('down', 100, 100, 0));
        expect(g.feed(sample('up', 50, 140, 200))).toEqual([]);

        // Purely vertical scroll motion
        g.feed(sample('down', 100, 100, 0));
        expect(g.feed(sample('up', 100, 220, 150))).toEqual([]);
    });

    it('handles exact thresholds: 40 px steps, 600 ms steps, and exact 1.5 ratio does not step', () => {
        const g = createGestures();

        // Exact 40 px horizontal distance ("at least swipeMinPx") -> steps
        g.feed(sample('down', 100, 50, 0));
        expect(g.feed(sample('up', 60, 50, 200))).toEqual(['next']);
        g.feed(sample('down', 100, 50, 300));
        expect(g.feed(sample('up', 140, 50, 500))).toEqual(['prev']);

        // Exact 600 ms duration ("at most swipeMaxMs") -> steps
        g.feed(sample('down', 100, 50, 1000));
        expect(g.feed(sample('up', 50, 50, 1600))).toEqual(['next']);

        // Exact 1.5 horizontal-to-vertical ratio (|dx| = 60, |dy| = 40 -> 60 === 1.5 * 40):
        // rule requires strictly "larger than 1.5 times the vertical move", so exact 1.5 gives nothing.
        g.feed(sample('down', 100, 100, 2000));
        expect(g.feed(sample('up', 40, 140, 2200))).toEqual([]);

        // Just above the 1.5 ratio (|dx| = 61, |dy| = 40 -> 61 > 60) -> steps
        g.feed(sample('down', 100, 100, 2500));
        expect(g.feed(sample('up', 39, 140, 2700))).toEqual(['next']);
    });

    it('starts a hold at holdMs and ends on up or cancel without ever swiping', () => {
        const g = createGestures();

        expect(g.holdDueAt()).toBeNull();
        expect(g.feed(sample('down', 100, 100, 50))).toEqual([]);
        expect(g.holdDueAt()).toBe(400);

        // Jitter at exact slop boundary (distance sqrt(6^2 + 8^2) = 10 <= 10) keeps hold pending
        expect(g.feed(sample('move', 106, 108, 150))).toEqual([]);
        expect(g.holdDueAt()).toBe(400);

        // Before holdMs: nothing due yet
        expect(g.tick(399)).toEqual([]);
        expect(g.holdDueAt()).toBe(400);

        // At holdMs: hold starts and holdDueAt clears
        expect(g.tick(400)).toEqual(['hold-start']);
        expect(g.holdDueAt()).toBeNull();
        expect(g.tick(500)).toEqual([]);

        // Far, fast horizontal move after hold-start still ends the hold with no swipe
        expect(g.feed(sample('move', 10, 100, 450))).toEqual([]);
        expect(g.feed(sample('up', 10, 100, 500))).toEqual(['hold-end']);

        // Hold also ends cleanly on cancel
        g.feed(sample('down', 100, 100, 1000));
        expect(g.tick(1350)).toEqual(['hold-start']);
        expect(g.feed(sample('cancel', 100, 100, 1400))).toEqual(['hold-end']);
    });

    it('cancels a pending hold when moving past slopPx before holdMs', () => {
        const g = createGestures();

        g.feed(sample('down', 100, 100, 0));
        expect(g.holdDueAt()).toBe(350);

        // Move 10.5 px away (> 10 px slop) before 350 ms
        expect(g.feed(sample('move', 110.5, 100, 100))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();

        // Moving back to the origin does not revive the cancelled hold
        expect(g.feed(sample('move', 100, 100, 150))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();
        expect(g.tick(350)).toEqual([]);
        expect(g.feed(sample('up', 100, 100, 400))).toEqual([]);
    });

    it('cancels a swipe and ends an active hold when a second pointer goes down', () => {
        const g = createGestures();

        // Pinch during a swipe: cancels pending hold and prevents swipe; ignores all pointers until every finger is up
        g.feed(sample('down', 200, 100, 0, { id: 1, primary: true }));
        expect(g.holdDueAt()).toBe(350);
        expect(g.feed(sample('down', 240, 100, 40, { id: 2, primary: false }))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();
        expect(g.feed(sample('move', 100, 100, 100, { id: 1, primary: true }))).toEqual([]);
        expect(g.feed(sample('up', 100, 100, 150, { id: 1, primary: true }))).toEqual([]);

        // Finger 2 is still down, so a new finger touch is ignored until finger 2 lifts
        expect(g.feed(sample('down', 200, 100, 170, { id: 3, primary: true }))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();
        expect(g.feed(sample('up', 100, 100, 220, { id: 3, primary: true }))).toEqual([]);
        expect(g.feed(sample('up', 240, 100, 240, { id: 2, primary: false }))).toEqual([]);

        // Now all pointers are up; next primary pointer works again
        g.feed(sample('down', 200, 100, 300, { id: 4, primary: true }));
        expect(g.feed(sample('up', 140, 100, 420, { id: 4, primary: true }))).toEqual(['next']);

        // Pinch during an active hold: immediately emits hold-end once
        g.feed(sample('down', 100, 100, 500, { id: 5, primary: true }));
        expect(g.tick(850)).toEqual(['hold-start']);
        expect(g.feed(sample('down', 160, 100, 900, { id: 6, primary: false }))).toEqual(['hold-end']);
        expect(g.feed(sample('up', 20, 100, 950, { id: 5, primary: true }))).toEqual([]);
        expect(g.feed(sample('up', 160, 100, 960, { id: 6, primary: false }))).toEqual([]);
    });

    it('ignores non-primary down when idle and stray non-down samples from other pointer ids', () => {
        const g = createGestures();

        expect(g.feed(sample('down', 100, 100, 0, { id: 2, primary: false }))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();
        expect(g.feed(sample('up', 40, 100, 100, { id: 2, primary: false }))).toEqual([]);

        g.feed(sample('down', 150, 100, 200, { id: 1, primary: true }));
        expect(g.feed(sample('move', 10, 10, 220, { id: 2, primary: false }))).toEqual([]);
        expect(g.feed(sample('up', 10, 10, 240, { id: 2, primary: false }))).toEqual([]);
        expect(g.feed(sample('cancel', 10, 10, 250, { id: 2, primary: false }))).toEqual([]);
        expect(g.holdDueAt()).toBe(550);
        expect(g.feed(sample('up', 90, 100, 350, { id: 1, primary: true }))).toEqual(['next']);
    });

    it('never steps on cancel', () => {
        const g = createGestures();

        g.feed(sample('down', 200, 100, 0));
        g.feed(sample('move', 120, 100, 100));
        expect(g.feed(sample('cancel', 120, 100, 120))).toEqual([]);
        expect(g.holdDueAt()).toBeNull();
    });

    it('ignores samples and ticks with non-finite numbers', () => {
        const g = createGestures();

        for (const bad of [
            sample('down', NaN, 100, 0),
            sample('down', 100, Infinity, 0),
            sample('down', 100, 100, -Infinity),
            sample('down', 100, 100, 0, { id: NaN }),
        ]) {
            expect(g.feed(bad)).toEqual([]);
            expect(g.holdDueAt()).toBeNull();
        }

        // Mid-gesture non-finite samples and ticks do not disturb the tracked gesture
        g.feed(sample('down', 150, 100, 10));
        expect(g.feed(sample('move', NaN, 100, 50))).toEqual([]);
        expect(g.feed(sample('up', 80, 100, Infinity))).toEqual([]);
        expect(g.tick(NaN)).toEqual([]);
        expect(g.tick(Infinity)).toEqual([]);
        expect(g.holdDueAt()).toBe(360);
        expect(g.feed(sample('up', 90, 100, 200))).toEqual(['next']);
    });

    it('ends an active hold once on reset and leaves holdDueAt null when idle', () => {
        const g = createGestures();

        expect(g.reset()).toEqual([]);
        expect(g.holdDueAt()).toBeNull();

        // Reset while hold is only pending
        g.feed(sample('down', 100, 100, 0));
        expect(g.holdDueAt()).toBe(350);
        expect(g.reset()).toEqual([]);
        expect(g.holdDueAt()).toBeNull();

        // Reset while hold is active ends it once
        g.feed(sample('down', 100, 100, 500));
        expect(g.tick(850)).toEqual(['hold-start']);
        expect(g.reset()).toEqual(['hold-end']);
        expect(g.reset()).toEqual([]);
        expect(g.feed(sample('up', 40, 100, 900))).toEqual([]);
    });
});

describe('attachGestures binder', () => {
    it('fires swipe and hold handlers from pointer events without calling preventDefault', () => {
        const { target, emit, passiveFlags } = createFakeTarget({ touchAction: '' });
        const timers = createFakeTimers();
        const { log, handlers } = recordHandlers();

        const detach = attachGestures(target, handlers, {
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        expect(passiveFlags.every(flag => flag === true)).toBe(true);

        // Swipe left -> next
        emit('pointerdown', pointerEvent(200, 100, 10));
        expect(timers.active.size).toBe(1);
        emit('pointermove', pointerEvent(205, 100, 30)); // Within slop: still single timer
        expect(timers.scheduled).toHaveLength(1);
        emit('pointerup', pointerEvent(140, 100, 120));
        expect(log).toEqual(['next']);
        expect(timers.active.size).toBe(0);

        // Swipe right with pen -> prev
        emit('pointerdown', pointerEvent(100, 100, 200, { pointerType: 'pen' }));
        emit('pointerup', pointerEvent(160, 100, 320, { pointerType: 'pen' }));
        expect(log).toEqual(['next', 'prev']);

        // Press and hold -> holdStart, then lostpointercapture -> holdEnd
        emit('pointerdown', pointerEvent(100, 100, 500));
        timers.fireAll();
        expect(log).toEqual(['next', 'prev', 'hold-start']);
        emit('lostpointercapture', pointerEvent(100, 100, 900));
        expect(log).toEqual(['next', 'prev', 'hold-start', 'hold-end']);

        detach();
    });

    it('ignores mouse pointers completely', () => {
        const { target, emit } = createFakeTarget({ touchAction: '' });
        const timers = createFakeTimers();
        const { log, handlers } = recordHandlers();

        const detach = attachGestures(target, handlers, {
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        emit('pointerdown', pointerEvent(200, 100, 0, { pointerType: 'mouse' }));
        emit('pointermove', pointerEvent(120, 100, 50, { pointerType: 'mouse' }));
        emit('pointerup', pointerEvent(120, 100, 100, { pointerType: 'mouse' }));

        expect(timers.scheduled).toHaveLength(0);
        expect(log).toEqual([]);

        detach();
    });

    it('sets touchAction to pan-y and restores the previous value on detach', () => {
        const existing = createFakeTarget({ touchAction: 'manipulation' });
        const { handlers } = recordHandlers();

        const detachExisting = attachGestures(existing.target, handlers);
        expect(existing.target.style?.touchAction).toBe('pan-y');
        detachExisting();
        expect(existing.target.style?.touchAction).toBe('manipulation');

        const emptyStyle: { touchAction?: string } = {};
        const fresh = createFakeTarget(emptyStyle);
        const detachFresh = attachGestures(fresh.target, handlers);
        expect(emptyStyle.touchAction).toBe('pan-y');
        detachFresh();
        expect('touchAction' in emptyStyle).toBe(false);

        const styleless = createFakeTarget();
        const detachStyleless = attachGestures(styleless.target, handlers);
        detachStyleless();
    });

    it('clears the hold timer on up, on cancel, on slop exit, and on detach, leaving no listeners after detach', () => {
        const { target, emit, listenerCount } = createFakeTarget({ touchAction: '' });
        const timers = createFakeTimers();
        const { log, handlers } = recordHandlers();

        const detach = attachGestures(target, handlers, {
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });
        expect(listenerCount()).toBe(5);

        // Cleared on pointerup (handle 0)
        emit('pointerdown', pointerEvent(100, 100, 0));
        expect(timers.active.size).toBe(1);
        emit('pointerup', pointerEvent(100, 100, 50));
        expect(timers.active.size).toBe(0);
        expect(timers.cleared).toEqual([0]);

        // Cleared on pointercancel (handle 1)
        emit('pointerdown', pointerEvent(100, 100, 100));
        expect(timers.active.size).toBe(1);
        emit('pointercancel', pointerEvent(100, 100, 140));
        expect(timers.active.size).toBe(0);
        expect(timers.cleared).toEqual([0, 1]);

        // Cleared when moving past slop (handle 2)
        emit('pointerdown', pointerEvent(100, 100, 200));
        expect(timers.active.size).toBe(1);
        emit('pointermove', pointerEvent(125, 100, 230));
        expect(timers.active.size).toBe(0);
        expect(timers.cleared).toEqual([0, 1, 2]);
        emit('pointerup', pointerEvent(125, 100, 260));

        // Cleared on detach while pending (handle 3)
        emit('pointerdown', pointerEvent(100, 100, 300));
        expect(timers.active.size).toBe(1);
        detach();
        expect(timers.active.size).toBe(0);
        expect(timers.cleared).toEqual([0, 1, 2, 3]);
        expect(listenerCount()).toBe(0);

        // Events after detach do nothing
        emit('pointerdown', pointerEvent(200, 100, 400));
        emit('pointerup', pointerEvent(100, 100, 500));
        expect(log).toEqual([]);
    });

    it('ends an active hold once when detached mid-hold', () => {
        const { target, emit, listenerCount } = createFakeTarget({ touchAction: 'none' });
        const timers = createFakeTimers();
        const { log, handlers } = recordHandlers();

        const detach = attachGestures(target, handlers, {
            setTimer: timers.setTimer,
            clearTimer: timers.clearTimer,
        });

        emit('pointerdown', pointerEvent(100, 100, 0));
        timers.fireAll();
        expect(log).toEqual(['hold-start']);

        detach();
        expect(log).toEqual(['hold-start', 'hold-end']);
        expect(listenerCount()).toBe(0);
        expect(target.style?.touchAction).toBe('none');

        // Calling detach again is a no-op
        detach();
        expect(log).toEqual(['hold-start', 'hold-end']);
    });
});

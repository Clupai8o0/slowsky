// Touch and pen gestures for stepping frames (horizontal swipe) and comparing with the first frame (press-and-hold).
export type GestureAction = 'prev' | 'next' | 'hold-start' | 'hold-end';

export interface PointerSample {
    id: number;
    x: number;
    y: number;
    t: number;
    kind: 'down' | 'move' | 'up' | 'cancel';
    primary: boolean;
}

export interface GestureOptions {
    swipeMinPx?: number;
    swipeMaxMs?: number;
    holdMs?: number;
    slopPx?: number;
}

export const GESTURE_DEFAULTS: Required<GestureOptions> = {
    swipeMinPx: 40,
    swipeMaxMs: 600,
    holdMs: 350,
    slopPx: 10,
};

interface TrackedPointer {
    id: number;
    startX: number;
    startY: number;
    startT: number;
    hold: 'pending' | 'cancelled' | 'active';
}

export function createGestures(opts?: GestureOptions): {
    feed(sample: PointerSample): GestureAction[];
    tick(t: number): GestureAction[];
    holdDueAt(): number | null;
    isIdle(): boolean;
    reset(): GestureAction[];
}
{
    const swipeMinPx = opts?.swipeMinPx ?? GESTURE_DEFAULTS.swipeMinPx;
    const swipeMaxMs = opts?.swipeMaxMs ?? GESTURE_DEFAULTS.swipeMaxMs;
    const holdMs = opts?.holdMs ?? GESTURE_DEFAULTS.holdMs;
    const slopPx = opts?.slopPx ?? GESTURE_DEFAULTS.slopPx;

    const downIds = new Set<number>();
    let tracked: TrackedPointer | null = null;

    function feed(sample: PointerSample): GestureAction[]
    {
        if (!Number.isFinite(sample.id) || !Number.isFinite(sample.x)
            || !Number.isFinite(sample.y) || !Number.isFinite(sample.t)) {
            return [];
        }

        if (tracked === null) {
            // After a multi-pointer pinch cancels a gesture, ignore everything until every finger lifts.
            if (downIds.size > 0) {
                if (sample.kind === 'down') {
                    downIds.add(sample.id);
                } else if (sample.kind === 'up' || sample.kind === 'cancel') {
                    downIds.delete(sample.id);
                }
                return [];
            }
            if (sample.kind === 'down' && sample.primary) {
                downIds.add(sample.id);
                tracked = {
                    id: sample.id,
                    startX: sample.x,
                    startY: sample.y,
                    startT: sample.t,
                    hold: 'pending',
                };
            }
            return [];
        }

        if (sample.id !== tracked.id) {
            if (sample.kind === 'down') {
                downIds.add(sample.id);
                const wasHolding = tracked.hold === 'active';
                tracked = null;
                return wasHolding ? ['hold-end'] : [];
            }
            return [];
        }

        if (sample.kind === 'down') {
            return [];
        }

        if (sample.kind === 'move') {
            if (tracked.hold === 'pending'
                && Math.hypot(sample.x - tracked.startX, sample.y - tracked.startY) > slopPx) {
                tracked.hold = 'cancelled';
            }
            return [];
        }

        const finished = tracked;
        tracked = null;
        downIds.delete(sample.id);

        if (finished.hold === 'active') {
            return ['hold-end'];
        }
        if (sample.kind === 'cancel') {
            return [];
        }

        const dx = sample.x - finished.startX;
        const dy = sample.y - finished.startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        const dt = sample.t - finished.startT;

        // Horizontal move must be strictly > 1.5x vertical so diagonal drags stay with page scroll.
        if (absDx >= swipeMinPx && absDx > 1.5 * absDy && dt >= 0 && dt <= swipeMaxMs) {
            return [dx < 0 ? 'next' : 'prev'];
        }
        return [];
    }

    function tick(t: number): GestureAction[]
    {
        if (!Number.isFinite(t) || !tracked || tracked.hold !== 'pending') {
            return [];
        }
        if (t < tracked.startT + holdMs) {
            return [];
        }
        tracked.hold = 'active';
        return ['hold-start'];
    }

    function holdDueAt(): number | null
    {
        if (!tracked || tracked.hold !== 'pending') {
            return null;
        }
        return tracked.startT + holdMs;
    }

    function reset(): GestureAction[]
    {
        const wasHolding = tracked?.hold === 'active';
        tracked = null;
        downIds.clear();
        return wasHolding ? ['hold-end'] : [];
    }

    return { feed, tick, holdDueAt, isIdle: () => downIds.size === 0, reset };
}

export interface GestureHandlers {
    prev(): void;
    next(): void;
    holdStart(): void;
    holdEnd(): void;
}

export interface GestureTarget {
    addEventListener(type: string, listener: (event: any) => void, options?: { passive?: boolean; capture?: boolean }): void;
    removeEventListener(type: string, listener: (event: any) => void, options?: { capture?: boolean }): void;
    style?: { touchAction?: string };
    ownerDocument?: GestureTarget | null;
    setPointerCapture?(pointerId: number): void;
}

interface PointerEventLike {
    pointerId?: unknown;
    clientX?: unknown;
    clientY?: unknown;
    timeStamp?: unknown;
    isPrimary?: unknown;
    pointerType?: unknown;
}

const EVENT_KINDS: ReadonlyArray<readonly [string, PointerSample['kind']]> = [
    ['pointerdown', 'down'],
    ['pointermove', 'move'],
    ['pointerup', 'up'],
    ['pointercancel', 'cancel'],
    ['lostpointercapture', 'cancel'],
];

export function attachGestures(target: GestureTarget, handlers: GestureHandlers, opts?: GestureOptions & {
    touchAction?: string;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    root?: GestureTarget;
}): () => void
{
    const machine = createGestures(opts);
    const setTimer = opts?.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
    const clearTimer = opts?.clearTimer ?? ((handle: unknown): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

    const style = target.style;
    const hadTouchAction = style ? 'touchAction' in style : false;
    const prevTouchAction = style?.touchAction;
    if (style) {
        style.touchAction = opts?.touchAction ?? 'pan-y';
    }

    let detached = false;
    let hasTimer = false;
    let timerHandle: unknown = undefined;
    let scheduledDue: number | null = null;
    let timerGen = 0;
    const root = opts?.root ?? target.ownerDocument;
    const seenAtRoot = new WeakSet<object>();
    let rootListening = false;

    function dispatch(actions: GestureAction[]): void
    {
        for (const action of actions) {
            if (action === 'prev') {
                handlers.prev();
            } else if (action === 'next') {
                handlers.next();
            } else if (action === 'hold-start') {
                handlers.holdStart();
            } else {
                handlers.holdEnd();
            }
        }
    }

    function stopTimer(): void
    {
        if (hasTimer) {
            const handle = timerHandle;
            hasTimer = false;
            timerHandle = undefined;
            scheduledDue = null;
            timerGen++;
            clearTimer(handle);
        }
    }

    function onTimer(expectedGen: number, due: number): void
    {
        if (detached || !hasTimer || expectedGen !== timerGen) {
            return;
        }
        hasTimer = false;
        timerHandle = undefined;
        scheduledDue = null;
        dispatch(machine.tick(due));
    }

    function syncTimer(now: number): void
    {
        const due = machine.holdDueAt();
        if (due === null) {
            stopTimer();
            return;
        }
        if (hasTimer && scheduledDue === due) {
            return;
        }
        stopTimer();
        const myGen = ++timerGen;
        hasTimer = true;
        scheduledDue = due;
        const handle = setTimer(() => {
            onTimer(myGen, due);
        }, Math.max(0, due - now));
        if (hasTimer && timerGen === myGen) {
            timerHandle = handle;
        }
    }

    function handleEvent(kind: PointerSample['kind'], event: PointerEventLike | null | undefined): void
    {
        if (detached || !event || event.pointerType === 'mouse') {
            return;
        }
        const sample: PointerSample = {
            id: typeof event.pointerId === 'number' ? event.pointerId : NaN,
            x: typeof event.clientX === 'number' ? event.clientX : NaN,
            y: typeof event.clientY === 'number' ? event.clientY : NaN,
            t: typeof event.timeStamp === 'number' ? event.timeStamp : NaN,
            kind,
            primary: event.isPrimary === true,
        };
        const wasIdle = machine.isIdle();
        const actions = machine.feed(sample);
        if (wasIdle && !machine.isIdle()) {
            addRootListeners();
            try {
                target.setPointerCapture?.(sample.id);
            } catch {
                // Capture is optional; root listeners still follow the pointer.
            }
        } else if (!wasIdle && machine.isIdle()) {
            removeRootListeners();
        }
        syncTimer(sample.t);
        dispatch(actions);
    }

    const listeners: Array<readonly [string, (event: PointerEventLike | null | undefined) => void]> = [];
    const rootListeners: Array<readonly [string, (event: PointerEventLike | null | undefined) => void]> = [];
    for (const [type, kind] of EVENT_KINDS) {
        const listener = (event: PointerEventLike | null | undefined): void => {
            if (event && seenAtRoot.has(event)) {
                seenAtRoot.delete(event);
                return;
            }
            handleEvent(kind, event);
        };
        listeners.push([type, listener]);
        target.addEventListener(type, listener, { passive: true });
        rootListeners.push([type, (event): void => {
            if (event) {
                seenAtRoot.add(event);
            }
            handleEvent(kind, event);
        }]);
    }

    function addRootListeners(): void
    {
        if (!root || root === target || rootListening) {
            return;
        }
        rootListening = true;
        for (const [type, listener] of rootListeners) {
root.addEventListener(type, listener, { passive: true, capture: true });
        }
    }

    function removeRootListeners(): void
    {
        if (!root || !rootListening) {
            return;
        }
        rootListening = false;
        for (const [type, listener] of rootListeners) {
            root.removeEventListener(type, listener, { capture: true });
        }
    }

    function detach(): void
    {
        if (detached) {
            return;
        }
        detached = true;
        removeRootListeners();
        for (const [type, listener] of listeners) {
            target.removeEventListener(type, listener);
        }
        stopTimer();
        if (style) {
            if (hadTouchAction) {
                style.touchAction = prevTouchAction;
            } else {
                delete style.touchAction;
            }
        }
        dispatch(machine.reset());
    }

    return detach;
}

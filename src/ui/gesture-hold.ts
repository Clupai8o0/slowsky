export const HOLD_LINE = 'Showing the first frame. Let go to go back.';

export interface HoldView {
    canHold(): boolean;
    token(): unknown;
    index(): number;
    put(index: number): void;
    show(index: number): void;
    pause(): void;
    say(text: string): void;
}

export function createHoldCompare(view: HoldView): {
    start(): void;
    end(): void;
    cancel(): void;
    active(): boolean;
    heldIndex(): number | null;
}
{
    let held: { index: number; token: unknown } | null = null;

    function start(): void
    {
        if (held !== null) {
            return;
        }
        const index = view.index();
        if (!view.canHold() || index <= 0) {
            return;
        }
        held = { index, token: view.token() };
        // Pause before swapping to frame 0 so any URL sync on pause keeps the real frame; announce last so redraws do not overwrite it.
        view.pause();
        view.show(0);
        view.say(HOLD_LINE);
    }

    function end(): void
    {
        if (held === null) {
            return;
        }
        const prev = held;
        held = null;
        // Restore only if the same view still shows the temporary frame.
        if (view.token() === prev.token && view.index() === 0) {
            view.show(prev.index);
        } else {
            view.say('');
        }
    }

    function cancel(): void
    {
        if (held === null) {
            return;
        }
        const prev = held;
        held = null;
        // The caller will draw or choose its own frame after cancellation.
        if (view.token() === prev.token && view.index() === 0) {
            view.put(prev.index);
        }
        view.say('');
    }

    function active(): boolean
    {
        return held !== null;
    }

    function heldIndex(): number | null
    {
        return held?.index ?? null;
    }

    return { start, end, cancel, active, heldIndex };
}

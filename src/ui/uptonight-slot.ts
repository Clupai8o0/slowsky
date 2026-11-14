// "Tonight's sky" line under the sky map (FEATURES.upTonight): when the spot on screen is highest in tonight's dark
// hours from Melbourne, how high and facing where. Off: the box stays hidden and empty, and no timer runs.
// On: the line is worked out again every minute and when the tab is shown again, so "now" and the clock times do
// not go stale on a page left open. Nothing is asked of the visitor and nothing is stored or sent.

import { upTonight } from '../lib/uptonight';
import { upTonightText } from './uptonight-view';

export interface UpTonightSlot { update(center: { ra: number; dec: number } | null): void; stop(): void }
export interface UpTonightDeps { enabled: boolean; now?: () => Date; everyMs?: number }

export const UP_TONIGHT_LABEL = 'Tonight’s sky.';
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function upTonightHtml(center: { ra: number; dec: number } | null, now: Date): string
{
    const text = center ? upTonightText(upTonight(center.ra, center.dec, now)) : null;
    if (!text) {
        return '';
    }
    return `<span class="sk-sub">${UP_TONIGHT_LABEL}</span> ${esc(text.line)}${text.note ? ` <small>${esc(text.note)}</small>` : ''}`;
}

export function mountUpTonight(box: HTMLElement, deps: UpTonightDeps): UpTonightSlot
{
    let center: { ra: number; dec: number } | null = null;
    let shown: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const render = () => {
        let html = '';
        try {
            html = upTonightHtml(center, (deps.now ?? (() => new Date()))());
        } catch {
            html = '';
        }
        if (html !== shown) {
            shown = html;
            box.innerHTML = html;
            box.hidden = !html;
        }
    };
    const onShow = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
            render();
        }
    };
    return {
        update(next)
        {
            if (!deps.enabled) {
                return;
            }
            const same = next === null ? center === null : center !== null && next.ra === center.ra && next.dec === center.dec;
            center = next ? { ra: next.ra, dec: next.dec } : null;
            if (!same || shown === undefined) {
                render();
            }
            if (timer === undefined) {
                timer = setInterval(render, deps.everyMs ?? 60000);
                if (typeof document !== 'undefined') {
                    document.addEventListener('visibilitychange', onShow);
                }
            }
        },
        stop()
        {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
                if (typeof document !== 'undefined') {
                    document.removeEventListener('visibilitychange', onShow);
                }
            }
        },
    };
}

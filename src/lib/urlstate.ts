// Lane: parsers (Haiku). The view as a shareable link.
import type { ViewState } from './types';
import { NotImplemented } from './notimpl';

// Short, readable keys: ra, dec, fov, det, lam, t, f.
export function encodeView(v: ViewState): string
{
    throw new NotImplemented(`encodeView(${v.center.ra})`);
}

// Returns null when the link has no usable position; bad values are dropped, not guessed.
export function decodeView(search: string): ViewState | null
{
    throw new NotImplemented(`decodeView(${search})`);
}

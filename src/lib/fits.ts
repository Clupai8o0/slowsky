// Lane: S3 reader (Codex Sol). FITS headers and HTTP range reads from S3.
import type { FitsHeader, RangeReader } from './types';
import { NotImplemented } from './notimpl';

// Parses 2880-byte FITS header blocks up to END.
export function parseHeader(bytes: Uint8Array): FitsHeader
{
    throw new NotImplemented(`parseHeader(${bytes.length} bytes)`);
}

export interface RangeReaderOptions {
    fetch?: typeof fetch; // injectable for tests
    maxParallel?: number; // parallel range requests per file
    maxBytes?: number; // hard cap per read; abort above it
}

export function createRangeReader(opts: RangeReaderOptions = {}): RangeReader
{
    throw new NotImplemented(`createRangeReader(${JSON.stringify(Object.keys(opts))})`);
}

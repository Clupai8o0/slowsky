// @ts-expect-error Node built-in is available in Vitest; no browser dependency.
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createRangeReader } from '../../src/lib/fits';
import frame from '../fixtures/frame/frame1.json';
import reference from '../fixtures/frame/frame1.box.json';

const live = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === '1';

function fixtureUrl(): string
{
    if (new URL(frame.url).hostname.startsWith('nasa-irsa-spherex.s3.')) {
        return frame.url;
    }
    // The fixture retains an IRSA access_url. Resolve only the matching SIA row,
    // using cloud_access rather than constructing a key from an observation ID.
    const xml: string = readFileSync(new URL('../fixtures/frame/sia_rwaur.xml', import.meta.url), 'utf8');
    const fields = [...xml.matchAll(/<FIELD\b[^>]*name="([^"]+)"[^>]*>/g)].map(match => match[1]);
    const cloudColumn = fields.indexOf('cloud_access');
    const filename = frame.url.split('/').pop()!;
    for (const row of xml.matchAll(/<TR>([\s\S]*?)<\/TR>/g)) {
        const cells = [...row[1]!.matchAll(/<TD(?:\s[^>]*)?>([\s\S]*?)<\/TD>/g)].map(match => match[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'"));
        const cloud = cells[cloudColumn];
        if (cloud && cells.some(cell => cell.includes(filename))) {
            const aws: { bucket_name: string; key: string; region: string } = JSON.parse(cloud).aws;
            if (aws.bucket_name !== 'nasa-irsa-spherex') {
                throw new Error('Unexpected SIA bucket');
            }
            return `https://${aws.bucket_name}.s3.${aws.region}.amazonaws.com/${aws.key}`;
        }
    }
    throw new Error('No matching cloud_access row for frame1');
}

it.skipIf(!live)('matches real S3 HDU offsets, IMAGE bytes and IMAGE/ZODI sums', async () => {
    const reader = createRangeReader();
    const index = await reader.index(fixtureUrl());
    expect(index.sizeBytes).toBe(frame.sizeBytes);
    expect(index.hdus.map(({ header: _header, ...hdu }) => hdu)).toEqual(frame.hdus);
    const image = await reader.readFloat32(index, 'IMAGE', reference.box);
    const bytes = new Uint8Array(image.buffer);
    const expected: Uint8Array = readFileSync(new URL('../fixtures/frame/frame1.box.image.f32', import.meta.url));
    expect(bytes).toEqual(new Uint8Array(expected));
    for (const name of ['IMAGE', 'ZODI'] as const) {
        const pixels = name === 'IMAGE' ? image : await reader.readFloat32(index, name, reference.box);
        const sum = pixels.reduce((total, value) => total + value, 0);
        expect(Math.abs(sum - reference[name].sum) / Math.abs(reference[name].sum)).toBeLessThan(1e-3);
    }
}, 120_000);

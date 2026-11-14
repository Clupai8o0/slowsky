import { describe, expect, it } from 'vitest';
import { NotImplemented } from '../src/lib/notimpl';
import { GET } from '../api/sia';

describe('scaffold', () => {
    it('stubs say what is missing', () => {
        expect(new NotImplemented('x').message).toBe('x is not built yet');
    });

    it('sia GET rejects a bad query with 400 and CORS', async () => {
        const r = await GET(new Request('https://example.test/api/sia'));
        expect(r.status).toBe(400);
        expect(r.headers.get('access-control-allow-origin')).toBe('*');
    });
});

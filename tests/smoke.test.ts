import { describe, expect, it } from 'vitest';
import { NotImplemented } from '../src/lib/notimpl';
import { GET } from '../api/sia';

describe('scaffold', () => {
    it('stubs say what is missing', () => {
        expect(new NotImplemented('x').message).toBe('x is not built yet');
    });

    it('sia stub answers 501 with CORS', async () => {
        const r = GET(new Request('https://example.test/api/sia'));
        expect(r.status).toBe(501);
        expect(r.headers.get('access-control-allow-origin')).toBe('*');
    });
});

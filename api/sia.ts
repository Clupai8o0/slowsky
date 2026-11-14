// Lane: SIA (Codex). One allowlisted passthrough to IRSA's SIA service, which has no CORS.
// Allowed: COLLECTION in spherex_dr1, spherex_dr1_deep, spherex_qr3, spherex_qr3_deep (never qr2),
// POS=CIRCLE ra dec r with r <= 1 deg, optional BAND and TIME, RESPONSEFORMAT=VOTABLE.
// Replies with Access-Control-Allow-Origin: * and an explicit Cache-Control.
export function GET(request: Request): Response
{
    void request;
    return new Response(JSON.stringify({ error: 'not built yet' }), {
        status: 501,
        headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
        },
    });
}

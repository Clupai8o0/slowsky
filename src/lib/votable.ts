// Lane: parsers (Haiku). Minimal VOTable TABLEDATA reader for SIA replies.
// Hand-written on purpose: no DOMParser, so it runs in a Web Worker and in Node tests.

export interface VoRow {
    [field: string]: string; // FIELD name (lower case) -> cell text, '' when empty
}

const NAMED_ENTITIES = new Map<string, string>([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
]);

// Throws with the server's INFO text when the reply is an error document.
export function parseVotable(xml: string): VoRow[]
{
    const doc = xml.replace(/<!--[\s\S]*?-->/g, '');
    checkQueryStatus(doc);
    if (/<BINARY2?(?=[\s/>])/i.test(doc)) {
        throw new Error('unsupported serialisation: VOTable BINARY/BINARY2 (request TABLEDATA)');
    }
    const fields = fieldNames(doc);
    const table = /<TABLEDATA\b[^>]*?(?:\/>|>([\s\S]*?)<\/TABLEDATA\s*>)/i.exec(doc);
    const body = table?.[1];
    if (body === undefined) {
        return [];
    }
    const rows: VoRow[] = [];
    for (const tr of body.matchAll(/<TR\b[^>]*?(?:\/>|>([\s\S]*?)<\/TR\s*>)/gi)) {
        const cells = cellsOf(tr[1] ?? '');
        const row: VoRow = {};
        fields.forEach((name, i) => {
            row[name] = cells[i] ?? '';
        });
        rows.push(row);
    }
    return rows;
}

function checkQueryStatus(doc: string): void
{
    for (const m of doc.matchAll(/<INFO\b([^>]*?)(?:\/>|>([\s\S]*?)<\/INFO\s*>)/gi)) {
        const attrs = attributes(m[1] ?? '');
        const name = (attrs.get('name') ?? '').toUpperCase();
        const value = (attrs.get('value') ?? '').toUpperCase();
        if (name === 'QUERY_STATUS' && value === 'ERROR') {
            const text = cellText(m[2] ?? '');
            throw new Error(text || 'VOTable reply reports QUERY_STATUS ERROR');
        }
    }
}

function fieldNames(doc: string): string[]
{
    const names: string[] = [];
    for (const m of doc.matchAll(/<FIELD\b([^>]*?)\/?>/gi)) {
        names.push((attributes(m[1] ?? '').get('name') ?? '').toLowerCase());
    }
    return names;
}

function cellsOf(inner: string): string[]
{
    const cells: string[] = [];
    for (const td of inner.matchAll(/<TD\b[^>]*?(?:\/>|>([\s\S]*?)<\/TD\s*>)/gi)) {
        cells.push(cellText(td[1] ?? ''));
    }
    return cells;
}

// Text of one cell: entities decoded outside CDATA, CDATA taken as written, outer whitespace trimmed.
function cellText(raw: string): string
{
    const pieces = raw.split(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    let out = '';
    for (let i = 0; i < pieces.length; i += 1) {
        const piece = pieces[i] ?? '';
        out += i % 2 === 1 ? piece : decodeEntities(piece);
    }
    return out.trim();
}

function attributes(source: string): Map<string, string>
{
    const out = new Map<string, string>();
    for (const m of source.matchAll(/([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        out.set((m[1] ?? '').toLowerCase(), decodeEntities(m[2] ?? m[3] ?? ''));
    }
    return out;
}

function decodeEntities(text: string): string
{
    return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, decodeEntity);
}

function decodeEntity(whole: string, body: string): string
{
    if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
            return whole;
        }
        return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES.get(body) ?? whole;
}

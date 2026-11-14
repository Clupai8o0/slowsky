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
// Quoted attribute values may contain '>' (e.g. name="flux>limit"), so tag bodies are matched quote-aware.
const TAG_ATTRS = `((?:"[^"]*"|'[^']*'|[^>"'])*)`;
const CDATA_MARK = /(\d+)/g;

export function parseVotable(xml: string): VoRow[]
{
    // CDATA is lifted out first, so comment markers, tag names and entities inside it stay literal.
    const cdata: string[] = [];
    const noCdata = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_whole, text: string) => {
        cdata.push(text);
        return `${cdata.length - 1}`;
    });
    const doc = noCdata.replace(/<!--[\s\S]*?-->/g, '');
    checkQueryStatus(doc, cdata);
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
        const cells = cellsOf(tr[1] ?? '', cdata);
        const row: VoRow = {};
        fields.forEach((name, i) => {
            row[name] = cells[i] ?? '';
        });
        rows.push(row);
    }
    return rows;
}

function checkQueryStatus(doc: string, cdata: string[]): void
{
    for (const m of doc.matchAll(new RegExp(`<INFO\\b${TAG_ATTRS}(?:\\/>|>([\\s\\S]*?)<\\/INFO\\s*>)`, 'gi'))) {
        const attrs = attributes(m[1] ?? '');
        const name = (attrs.get('name') ?? '').toUpperCase();
        const value = (attrs.get('value') ?? '').toUpperCase();
        if (name === 'QUERY_STATUS' && value === 'ERROR') {
            const text = cellText(m[2] ?? '', cdata);
            throw new Error(text || 'VOTable reply reports QUERY_STATUS ERROR');
        }
    }
}

function fieldNames(doc: string): string[]
{
    const names: string[] = [];
    for (const m of doc.matchAll(new RegExp(`<FIELD\\b${TAG_ATTRS}\\/?>`, 'gi'))) {
        names.push((attributes(m[1] ?? '').get('name') ?? '').toLowerCase());
    }
    return names;
}

function cellsOf(inner: string, cdata: string[]): string[]
{
    const cells: string[] = [];
    for (const td of inner.matchAll(/<TD\b[^>]*?(?:\/>|>([\s\S]*?)<\/TD\s*>)/gi)) {
        cells.push(cellText(td[1] ?? '', cdata));
    }
    return cells;
}

// Text of one cell: entities decoded, CDATA sections put back as written, outer whitespace trimmed.
function cellText(raw: string, cdata: string[]): string
{
    const decoded = decodeEntities(raw);
    return decoded.replace(CDATA_MARK, (_whole, index: string) => cdata[Number(index)] ?? '').trim();
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

// Lane: parsers (Haiku). Minimal VOTable TABLEDATA reader for SIA replies.
import { NotImplemented } from './notimpl';

export interface VoRow {
    [field: string]: string; // FIELD name (lower case) -> cell text, '' when empty
}

// Throws with the server's INFO text when the reply is an error document.
export function parseVotable(xml: string): VoRow[]
{
    throw new NotImplemented(`parseVotable(${xml.length} chars)`);
}

import { describe, expect, it } from 'vitest';
import { parseVotable } from '../src/lib/votable';

const SAMPLE = `<?xml version="1.0"?>
<!-- SIA reply -->
<VOTABLE version='1.3'>
  <RESOURCE type="results">
    <INFO name="QUERY_STATUS" value="OK"/>
    <TABLE name="results">
      <FIELD name="OBS_ID" datatype="char" arraysize="*"/>
      <FIELD name='Access_URL' datatype="char" arraysize="*"></FIELD>
      <FIELD name="t_min" datatype="double"/>
      <DATA>
        <TABLEDATA>
          <TR>
            <TD>2025W19_1B_0241_1D1</TD>
            <TD>https://nasa-irsa-spherex.s3.amazonaws.com/a.fits?x=1&amp;y=2</TD>
            <TD>  60000.5  </TD>
          </TR>
          <TR>
            <TD><![CDATA[a < b & c]]></TD>
            <TD/>
            <TD></TD>
          </TR>
        </TABLEDATA>
      </DATA>
    </TABLE>
  </RESOURCE>
</VOTABLE>`;

describe('parseVotable', () => {
    it('maps TABLEDATA rows to lower-case FIELD names in order', () => {
        const rows = parseVotable(SAMPLE);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({
            obs_id: '2025W19_1B_0241_1D1',
            access_url: 'https://nasa-irsa-spherex.s3.amazonaws.com/a.fits?x=1&y=2',
            t_min: '60000.5',
        });
    });

    it('gives empty strings for empty and self-closing cells', () => {
        const rows = parseVotable(SAMPLE);
        expect(rows[1]).toEqual({ obs_id: 'a < b & c', access_url: '', t_min: '' });
    });

    it('decodes numeric entities and keeps CDATA text as written', () => {
        const xml = `<VOTABLE><RESOURCE><TABLE>
            <FIELD name="v"/>
            <DATA><TABLEDATA>
                <TR><TD>&#65;&#x42;&lt;&gt;&quot;&apos;</TD></TR>
                <TR><TD><![CDATA[&amp; stays]]></TD></TR>
            </TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>`;
        const rows = parseVotable(xml);
        expect(rows[0]?.v).toBe(`AB<>"'`);
        expect(rows[1]?.v).toBe('&amp; stays');
    });

    it('throws the server text when QUERY_STATUS is ERROR', () => {
        const xml = `<VOTABLE><RESOURCE>
            <INFO name="QUERY_STATUS" value="ERROR">Bad POS value &amp; more</INFO>
        </RESOURCE></VOTABLE>`;
        expect(() => parseVotable(xml)).toThrow('Bad POS value & more');
    });

    it('throws a clear error for BINARY and BINARY2 serialisations', () => {
        const binary = '<VOTABLE><RESOURCE><TABLE><FIELD name="a"/><DATA><BINARY><STREAM>x</STREAM></BINARY>'
            + '</DATA></TABLE></RESOURCE></VOTABLE>';
        const binary2 = '<VOTABLE><RESOURCE><TABLE><DATA><BINARY2><STREAM/></BINARY2></DATA></TABLE></RESOURCE>'
            + '</VOTABLE>';
        expect(() => parseVotable(binary)).toThrow('unsupported serialisation');
        expect(() => parseVotable(binary2)).toThrow('unsupported serialisation');
    });

    it('returns no rows for a reply with no table', () => {
        expect(parseVotable('<VOTABLE><RESOURCE/></VOTABLE>')).toEqual([]);
        expect(parseVotable('<TABLEDATA/>')).toEqual([]);
    });
});

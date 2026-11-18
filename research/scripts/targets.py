"""Resolve targets via SIMBAD TAP and write data/targets.json."""
import json, io, urllib.request, urllib.parse, csv, time
OUT = "~/Documents/projects/spaceapps-melbourne-2026/research/data/targets.json"
# slug -> list of SIMBAD identifiers to try
T = {
 "wise0855": ["WISE J085510.83-071442.5", "WISE 0855-0714"],
 "barnard": ["* Bernard's star", "GJ 699"],
 "luhman16": ["WISE J104915.57-531906.1", "Luhman 16"],
 "epsindib": ["* eps Ind Ba", "eps Ind B"],
 "kapteyn": ["* Kapteyn's star", "GJ 191"],
 "teegarden": ["Teegarden's star", "SO J025300.5+165258"],
 "groombridge1830": ["* Groombridge 1830", "HD 103095"],
 "rwaur": ["V* RW Aur", "RW Aur", "HD 240975"],
 "rdra": ["V* R Dra", "R Dra", "HD 160524"],
}
def q(adql):
    d = urllib.parse.urlencode({"REQUEST":"doQuery","LANG":"ADQL","FORMAT":"csv","QUERY":adql}).encode()
    r = urllib.request.urlopen("https://simbad.cfa.harvard.edu/simbad/sim-tap/sync", d, timeout=60)
    return list(csv.DictReader(io.StringIO(r.read().decode())))
out = {}
for slug, ids in T.items():
    for ident in ids:
        ident_q = ident.replace("'", "''")
        try:
            rows = q(f"SELECT main_id, ra, dec, pmra, pmdec, plx_value, rvz_radvel FROM basic JOIN ident ON oidref=oid WHERE id='{ident_q}'")
        except Exception as e:
            print('ERR', ident, e); rows = []
        time.sleep(0.5)
        if rows:
            r = rows[0]; r["query_id"] = ident; out[slug] = r; print(slug, r); break
    else:
        print("MISSING", slug)
json.dump(out, open(OUT, "w"), indent=1)

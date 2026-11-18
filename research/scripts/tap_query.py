"""Step 2: TAP images per target (D1-D6, all collections) -> data/tap/<target>.csv"""
import sys, csv, time, os
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
T = load_targets()
only = sys.argv[1:] or list(T)
for slug in only:
    t = T[slug]
    c = position_at(t, 61041.0)  # ~2026.0, middle of public window; footprints are degrees wide
    ra, dec = c.ra.deg, c.dec.deg
    out = f"{DATA}/tap/{slug}.csv"
    if os.path.exists(out) and os.path.getsize(out) > 100:
        print("skip", slug); continue
    q = (f"SELECT p.obsid, p.energy_bandpassname AS detector, p.time_bounds_lower AS mjd_start, p.time_bounds_upper AS mjd_end, "
         f"a.uri, a.contentlength, p.quality_flag, p.pt, p.energy_bounds_lower, p.energy_bounds_upper "
         f"FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
         f"WHERE 1 = CONTAINS(POINT('ICRS', {ra:.6f}, {dec:.6f}), p.poly) AND a.producttype = 'science' "
         f"ORDER BY p.time_bounds_lower")
    rows = tap(q)
    for r in rows:
        r["collection"] = collection_of(r["uri"])
        r["obs_id"] = r["uri"].rsplit("/", 1)[1].split("_spx_")[0].replace("level2_", "")
        px, py = decode_pt(r["pt"]); r["centre_ra"] = px; r["centre_dec"] = py
    cols = ["obs_id", "detector", "collection", "mjd_start", "mjd_end", "centre_ra", "centre_dec", "quality_flag", "contentlength", "uri"]
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, cols, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    print(slug, len(rows), "rows", flush=True)
    time.sleep(2)

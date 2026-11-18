"""Print epoch tables per target from data/tap/*.csv; write data/epochs.json"""
import sys, csv, json
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
from astropy.time import Time
T = load_targets(); res = {}
for slug in T:
    rows = list(csv.DictReader(open(f"{DATA}/tap/{slug}.csv")))
    for r in rows:
        r["mjd"] = float(r["mjd_start"])
    lab = cluster_epochs(np.array([r["mjd"] for r in rows]))
    print(f"\n## {slug}  ({len(rows)} images; collections: {sorted(set(r['collection'] for r in rows))})")
    print("| epoch | dates (UTC) | collection | " + " | ".join(f"D{i}" for i in range(1, 7)) + " |")
    print("|---|---|---|" + "---|" * 6)
    ep = []
    for k in sorted(set(lab)):
        rr = [r for r, l in zip(rows, lab) if l == k]
        m = [r["mjd"] for r in rr]
        d0, d1 = Time(min(m), format="mjd").iso[:10], Time(max(m), format="mjd").iso[:10]
        cnt = [sum(1 for r in rr if r["detector"] == f"SPHEREx-D{i}") for i in range(1, 7)]
        cols = sorted(set(r["collection"] for r in rr))
        print(f"| {k+1} | {d0}..{d1} | {','.join(cols)} | " + " | ".join(map(str, cnt)) + " |")
        ep.append({"epoch": int(k)+1, "start": d0, "end": d1, "counts": [int(c) for c in cnt], "collections": cols})
    res[slug] = ep
json.dump(res, open(f"{DATA}/epochs.json", "w"), indent=1)

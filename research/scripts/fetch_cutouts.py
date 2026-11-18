"""Step 3: download 0.1 deg SPHEREx cutouts (resumable, sequential, polite to IRSA).

Plan: every target, D1, one frame per epoch (centre closest to the target).
      wise0855 only: also D2-D6 one frame per epoch, every D1 dither of its first epoch, and every D6 dither of every epoch
      (co-add). barnard: also D5, D6 one frame per epoch.
Needs data/targets.json (scripts/targets.py) and data/tap/*.csv (scripts/tap_query.py).
Usage: .venv/bin/python scripts/fetch_cutouts.py [--size 0.1] [--max 150] [--dry-run] [target ...]
"""
import sys, os, csv, json, time, argparse
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
from astropy.io import fits
from astropy.time import Time

ap = argparse.ArgumentParser()
ap.add_argument("targets", nargs="*")
ap.add_argument("--size", type=float, default=0.1)
ap.add_argument("--max", type=int, default=150, help="cap on actual downloads this run")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--sleep", type=float, default=1.5)
a = ap.parse_args()

T = load_targets()
BASE = "https://irsa.ipac.caltech.edu/"

def build_plan(slug):
    rows = list(csv.DictReader(open(f"{DATA}/tap/{slug}.csv")))
    for r in rows:
        r["mjd"] = 0.5 * (float(r["mjd_start"]) + float(r["mjd_end"]))
        r["det"] = r["detector"].replace("SPHEREx-", "")
    lab = cluster_epochs([r["mjd"] for r in rows])
    for r, l in zip(rows, lab):
        r["epoch"] = int(l) + 1
    for r in rows:
        c = position_at(T[slug], r["mjd"])
        dra = (float(r["centre_ra"]) - c.ra.deg) * np.cos(np.radians(c.dec.deg))
        r["sep"] = float(np.hypot(dra, float(r["centre_dec"]) - c.dec.deg))
    plan = []
    # WISE 0855 is a Y dwarf, only detectable at >3.9 um (D6, D5): there we take every D6 dither for co-adding.
    # Barnard's Star saturates in D1-D4 (brighter than ~11.5 AB), so it also gets D5/D6.
    dets = ["D1"] + (["D2", "D3", "D4", "D5", "D6"] if slug == "wise0855" else []) + (["D5", "D6"] if slug == "barnard" else [])
    for det in dets:
        for ep in sorted(set(r["epoch"] for r in rows)):
            rr = [r for r in rows if r["det"] == det and r["epoch"] == ep]
            if not rr:
                continue
            pick = [min(rr, key=lambda r: r["sep"])]
            if slug == "wise0855" and det == "D1" and ep == min(r["epoch"] for r in rows):
                pick = sorted(rr, key=lambda r: r["mjd"])  # whole intra-visit sequence
            if slug == "wise0855" and det == "D6":
                pick = sorted(rr, key=lambda r: r["mjd"])  # all dithers, for the co-add
            for r in pick:
                plan.append(r)
    items = []
    for r in plan:
        ep_rows = [x for x in rows if x["epoch"] == r["epoch"]]
        ep_date = Time(min(x["mjd"] for x in ep_rows), format="mjd").iso[:10].replace("-", "")
        c = position_at(T[slug], r["mjd"])
        fn = f"{ep_date}_{r['det']}_{r['obs_id']}.fits"
        url = BASE + r["uri"] + f"?center={c.ra.deg:.6f},{c.dec.deg:.6f}d&size={a.size}"
        items.append(dict(target=slug, epoch=r["epoch"], epochdate=ep_date, detector=r["det"], obs_id=r["obs_id"],
                          collection=r["collection"], mjd_tap=r["mjd"], center_ra=c.ra.deg, center_dec=c.dec.deg,
                          url=url, path=f"{DATA}/cutouts/{slug}/{fn}", sep_deg=r["sep"]))
    return items

def valid(path):
    try:
        with fits.open(path) as h:
            return "IMAGE" in h and h["IMAGE"].data is not None and h["IMAGE"].data.size > 0
    except Exception:
        return False

plan = []
for slug in (a.targets or list(T)):
    plan += build_plan(slug)
json.dump(plan, open(f"{DATA}/download_plan.json", "w"), indent=1)
print(f"plan: {len(plan)} cutouts; already valid: {sum(valid(p['path']) for p in plan if os.path.exists(p['path']))}")
if a.dry_run:
    sys.exit(0)

done = 0
log = open(f"{DATA}/download_log.jsonl", "a")
for it in plan:
    if os.path.exists(it["path"]) and valid(it["path"]):
        continue
    if done >= a.max:
        print("cap reached"); break
    os.makedirs(os.path.dirname(it["path"]), exist_ok=True)
    s503, t0 = STATS["http503"], time.time()
    try:
        raw = http_get(it["url"], timeout=240)
    except Exception as e:
        print("FAILED", it["path"], e, flush=True)
        log.write(json.dumps(dict(path=it["path"], ok=False, err=str(e))) + "\n"); log.flush()
        continue
    tmp = it["path"] + ".part"
    open(tmp, "wb").write(raw)
    if not valid(tmp):
        print("INVALID FITS", it["path"], len(raw), flush=True)
        os.rename(tmp, it["path"] + ".bad"); continue
    os.rename(tmp, it["path"])
    done += 1
    dt = time.time() - t0
    log.write(json.dumps(dict(path=it["path"], ok=True, bytes=len(raw), seconds=round(dt, 2),
                              http503=STATS["http503"] - s503)) + "\n"); log.flush()
    print(f"[{done}] {os.path.basename(it['path'])} {len(raw)/1e6:.2f} MB {dt:.1f}s 503s={STATS['http503']-s503}", flush=True)
    if done == 1 and len(raw) > 10e6:
        print("NOTE: first cutout >10 MB at size", a.size, "- stopping; consider --size 0.08"); break
    time.sleep(a.sleep)
print("run summary:", STATS, "downloaded", done)

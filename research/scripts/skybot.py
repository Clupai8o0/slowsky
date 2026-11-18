"""Step 6 (bonus): SkyBoT cone search around the first WISE 0855 D1 cutout. Writes data/skybot_wise0855.json"""
import sys, json
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
from astropy.io import fits
import glob
f = sorted(glob.glob(f"{DATA}/cutouts/wise0855/*_D1_*.fits"))[0]
h = fits.open(f)["IMAGE"].header
mjd = float(h["MJD-AVG"]); t = load_targets()["wise0855"]
c = position_at(t, mjd)
q = dict(ra=f"{c.ra.deg:.6f}", dec=f"{c.dec.deg:.6f}", rd="0.1", ep=f"{mjd + 2400000.5:.5f}", mime="json", output="basic", loc="500")
url = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php?" + "&".join(f"-{k}={v}" for k, v in q.items())
print(url)
raw = http_get(url, timeout=120).decode()
print(raw[:1500])
open(f"{DATA}/skybot_wise0855.json", "w").write(json.dumps(dict(file=f, query=q, url=url, response=raw)))

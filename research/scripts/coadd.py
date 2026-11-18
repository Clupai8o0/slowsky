"""WISE 0855 D6 (and D5 if present in plan): per-epoch co-add of all downloaded dithers on one common WCS.
Each frame: background-subtract (median), reproject to the common north-up grid, then nanmedian and nanmean.
Outputs data/coadd/wise0855_<det>_ep<k>.fits, previews/coadd/*.png, previews/wise0855_<det>_coadd_blink(.gif|_marked.gif).
Run after analyze.py (it adds a 'coadds' key to manifest.json)."""
import warnings; warnings.filterwarnings("ignore")
import sys, os, json
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
from astropy.io import fits
from astropy.wcs import WCS
from reproject import reproject_interp
from PIL import Image, ImageDraw
import collections

man = json.load(open(f"{DATA}/manifest.json"))
T = load_targets()
PIX = 6.15 / 3600; UP = 8
os.makedirs(f"{DATA}/coadd", exist_ok=True); os.makedirs(f"{DATA}/previews/coadd", exist_ok=True)
out_info = {}
for det in ["D6", "D5"]:
    fr = [m for m in man["files"] if m["target"] == "wise0855" and m["detector"] == det]
    eps = collections.defaultdict(list)
    for m in fr:
        eps[m["epoch"]].append(m)
    eps = {k: v for k, v in eps.items() if len(v) >= 2}   # co-add only where several dithers exist
    if len(eps) < 1:
        continue
    # common grid: centred on the mean target position across all epochs
    allm = [m for v in eps.values() for m in v]
    ras = np.array([m["target_ra"] for m in allm]); decs = np.array([m["target_dec"] for m in allm])
    ra0, dec0 = (ras.min() + ras.max()) / 2, (decs.min() + decs.max()) / 2
    span = max((ras.max() - ras.min()) * np.cos(np.radians(dec0)), decs.max() - decs.min())
    n = int(np.ceil((0.1 + span) / PIX)) + 2
    wc = WCS(naxis=2); wc.wcs.ctype = ["RA---TAN", "DEC--TAN"]; wc.wcs.crval = [ra0, dec0]
    wc.wcs.crpix = [n / 2 + .5, n / 2 + .5]; wc.wcs.cdelt = [-PIX, PIX]
    res = {}
    for k, v in sorted(eps.items()):
        stack = []
        for m in v:
            with fits.open(os.path.join(DATA, m["file"])) as h:
                a = h["IMAGE"].data.astype(float)
                a = a - np.nanmedian(a)
                arr, fp = reproject_interp((a, WCS(h["IMAGE"].header, h)), wc, shape_out=(n, n))
            arr[fp < 0.5] = np.nan
            stack.append(arr)
        st = np.array(stack)
        med = np.nanmedian(st, axis=0); mean = np.nanmean(st, axis=0)
        mjd = float(np.mean([m["mjd"] for m in v]))
        c = position_at(T["wise0855"], mjd)
        px, py = [float(z) for z in wc.world_to_pixel(c)]
        hdr = wc.to_header(); hdr["NFRAMES"] = len(v); hdr["MJD-AVG"] = mjd; hdr["DETECTOR"] = det
        fits.HDUList([fits.PrimaryHDU(), fits.ImageHDU(med.astype(np.float32), hdr, name="MEDIAN"),
                      fits.ImageHDU(mean.astype(np.float32), hdr, name="MEAN")]).writeto(f"{DATA}/coadd/wise0855_{det}_ep{k}.fits", overwrite=True)
        res[k] = dict(med=med, n=len(v), mjd=mjd, px=(px, py), date=Time(mjd, format="mjd").iso[:10],
                      wl=[m["wavelength_um"] for m in v])
    pool = np.concatenate([r["med"][np.isfinite(r["med"])] for r in res.values()])
    lo, hi = np.percentile(pool, 1), np.percentile(pool, 99.7)
    def render(a, lab, mark=None):
        z = np.arcsinh((np.clip(a, lo, hi) - lo) / (hi - lo) * 10) / np.arcsinh(10)
        im = Image.fromarray((np.nan_to_num(z) * 255).astype(np.uint8)[::-1], "L").resize((a.shape[1] * UP, a.shape[0] * UP), Image.BICUBIC).convert("RGB")
        d = ImageDraw.Draw(im); d.rectangle([0, 0, im.width, 14], fill=(0, 0, 0)); d.text((3, 1), lab, fill=(255, 255, 0))
        if mark:
            x, y = (mark[0] + .5) * UP, (a.shape[0] - mark[1] - .5) * UP; r = 3 * UP
            d.ellipse([x - r, y - r, x + r, y + r], outline=(0, 255, 0))
        return im
    ims, imsm = [], []
    for k, r in sorted(res.items()):
        lab = f"wise0855 {det} coadd ep{k} {r['date']} n={r['n']}"
        a, b = render(r["med"], lab), render(r["med"], lab, r["px"])
        a.save(f"{DATA}/previews/coadd/wise0855_{det}_ep{k}.png"); b.save(f"{DATA}/previews/coadd/wise0855_{det}_ep{k}_marked.png")
        ims.append(a); imsm.append(b)
        # crude detection check: peak in a 5x5 window around predicted position vs robust sigma of the whole image
        x, y = int(round(r["px"][0])), int(round(r["px"][1]))
        win = r["med"][max(y-2, 0):y+3, max(x-2, 0):x+3]
        sig = 1.4826 * np.nanmedian(np.abs(r["med"] - np.nanmedian(r["med"])))
        r["peak_sigma"] = float(np.nanmax(win) / sig)
        out_info.setdefault(det, {})[k] = dict(n=r["n"], date=r["date"], peak_in_5x5_over_robust_sigma=r["peak_sigma"],
                                           wavelength_range_um=[min(r["wl"]), max(r["wl"])], target_pixel=r["px"], grid=[n, n])
    if len(ims) >= 2:
        for lst, suf in ((ims, ""), (imsm, "_marked")):
            lst[0].save(f"{DATA}/previews/wise0855_{det}_coadd_blink{suf}.gif", save_all=True, append_images=lst[1:], duration=1000, loop=0)
man["coadds"] = out_info
json.dump(man, open(f"{DATA}/manifest.json", "w"), indent=1, default=float)
print(json.dumps(out_info, indent=1))

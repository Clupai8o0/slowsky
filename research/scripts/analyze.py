"""Step 4: per-cutout metadata, PNG previews, reprojected blink GIFs, manifest.json.
import warnings; warnings.filterwarnings("ignore")
Reads data/download_plan.json and data/cutouts/. Safe to rerun (overwrites previews)."""
import sys, os, json, glob, collections
sys.path.insert(0, "~/Documents/projects/spaceapps-melbourne-2026/research/scripts")
from common import *
from astropy.io import fits
from astropy.wcs import WCS
from astropy.time import Time
from reproject import reproject_interp
from PIL import Image, ImageDraw
import matplotlib
matplotlib.use("Agg")
from matplotlib import cm

T = load_targets()
plan = json.load(open(f"{DATA}/download_plan.json"))
PIX = 6.15 / 3600.0   # deg/pixel for the common grid
UP = 8                # preview upscale
os.makedirs(f"{DATA}/previews", exist_ok=True)

def sky_pa(w):
    """Position angle of the detector +y axis, degrees east of north (via WCS)."""
    x0, y0 = w.pixel_shape[0] / 2, w.pixel_shape[1] / 2
    c0 = w.pixel_to_world(x0, y0); c1 = w.pixel_to_world(x0, y0 + 5)
    return float(c0.position_angle(c1).deg)

logs = {}
for l in open(f"{DATA}/download_log.jsonl"):
    d = json.loads(l)
    if d.get("ok"):
        logs[d["path"]] = d

meta = []
for it in plan:
    if not os.path.exists(it["path"]):
        continue
    with fits.open(it["path"]) as h:
        hd = h["IMAGE"].header
        img = h["IMAGE"].data.astype(float); flg = h["FLAGS"].data
        mjd = float(hd["MJD-AVG"])
        w = WCS(hd, h)
        c = position_at(T[it["target"]], mjd)
        x, y = [float(v) for v in w.world_to_pixel(c)]
        try:
            ws = WCS(hd, fobj=h, key="W"); ws.sip = None
            wl, bw = ws.pixel_to_world(x, y)
            wl_um = float(wl.to("um").value); bw_um = float(bw.to("um").value)
        except Exception as e:
            wl_um = bw_um = None
        pa = sky_pa(w)
        ny, nx = img.shape
        inside = bool(0 <= x < nx and 0 <= y < ny)
        good = img[np.isfinite(img)]
        xi, yi = int(round(x)), int(round(y))
        win = img[max(yi - 2, 0):yi + 3, max(xi - 2, 0):xi + 3]
        med_all = float(np.nanmedian(img)); sig = float(1.4826 * np.nanmedian(np.abs(img - med_all)))
        tw = dict(nan_pixels_in_5x5=int(np.isnan(win).sum()), peak_minus_median=(float(np.nanmax(win) - med_all) if np.isfinite(win).any() else None),
                  robust_sigma=sig, peak_snr=(float((np.nanmax(win) - med_all) / sig) if np.isfinite(win).any() else None),
                  nan_pixels_total=int(np.isnan(img).sum()))
        m = dict(it)
        m["target_window"] = tw
        m.update(date_obs=hd["DATE-OBS"], mjd=mjd, target_ra=c.ra.deg, target_dec=c.dec.deg,
                 target_pixel=[x, y], target_in_image=inside, wavelength_um=wl_um, bandwidth_um=bw_um,
                 pos_angle_deg=pa, shape=[ny, nx],
                 stats=dict(min=float(good.min()), p1=float(np.percentile(good, 1)), median=float(np.median(good)),
                            p99=float(np.percentile(good, 99)), max=float(good.max()), std=float(good.std()),
                            nan_frac=float(1 - good.size / img.size), flagged_frac=float((flg != 0).mean()),
                            overflow_flag_pixels=int(((flg & 2) != 0).sum())),
                 bytes=os.path.getsize(it["path"]), file=os.path.relpath(it["path"], DATA))
        if it["path"] in logs:
            m["download_seconds"] = logs[it["path"]]["seconds"]; m["http503_retries"] = logs[it["path"]]["http503"]
        meta.append(m)
        m["_img"] = img
    m["is_rep"] = False
groups = collections.defaultdict(list)
for m in meta:
    groups[(m["target"], m["detector"])].append(m)
for g in groups.values():
    for ep in set(m["epoch"] for m in g):
        min([m for m in g if m["epoch"] == ep], key=lambda m: m["sep_deg"])["is_rep"] = True

def to_u8(a, lo, hi):
    z = np.arcsinh((np.clip(a, lo, hi) - lo) / (hi - lo) * 10) / np.arcsinh(10)
    return (np.nan_to_num(z) * 255).astype(np.uint8)

def render(a, lo, hi, label, mark=None):
    im = Image.fromarray(to_u8(a, lo, hi)[::-1], "L").resize((a.shape[1] * UP, a.shape[0] * UP), Image.BICUBIC).convert("RGB")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 14], fill=(0, 0, 0)); d.text((3, 1), label, fill=(255, 255, 0))
    if mark is not None:
        px, py = (mark[0] + 0.5) * UP, (a.shape[0] - mark[1] - 0.5) * UP
        r = 3 * UP
        d.ellipse([px - r, py - r, px + r, py + r], outline=(0, 255, 0), width=1)
    return im

def scale_for(frames):
    pool = np.concatenate([f[np.isfinite(f)] for f in frames])
    return float(np.percentile(pool, 1)), float(np.percentile(pool, 99.7))

def save_gif(path, ims, dur=1000):
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=dur, loop=0)

def common_wcs(frames_meta):
    ras = np.array([m["target_ra"] for m in frames_meta]); decs = np.array([m["target_dec"] for m in frames_meta])
    ra0, dec0 = (ras.min() + ras.max()) / 2, (decs.min() + decs.max()) / 2
    span = max((ras.max() - ras.min()) * np.cos(np.radians(dec0)), decs.max() - decs.min())
    n = int(np.ceil((0.1 + span) / PIX)) + 2
    w = WCS(naxis=2); w.wcs.ctype = ["RA---TAN", "DEC--TAN"]; w.wcs.crval = [ra0, dec0]
    w.wcs.crpix = [n / 2 + 0.5, n / 2 + 0.5]; w.wcs.cdelt = [-PIX, PIX]
    return w, (n, n)

summary = {}
for (slug, det), g in sorted(groups.items()):
    g.sort(key=lambda m: m["mjd"])
    os.makedirs(f"{DATA}/previews/{slug}", exist_ok=True)
    lo, hi = scale_for([m["_img"] for m in g])
    for m in g:
        lab = f"{slug} {det} {m['date_obs'][:10]} {m['wavelength_um']:.3f}um" if m["wavelength_um"] else f"{slug} {det} {m['date_obs'][:10]}"
        base = f"{DATA}/previews/{slug}/{os.path.basename(m['path'])[:-5]}"
        render(m["_img"], lo, hi, lab).save(base + ".png")
        render(m["_img"], lo, hi, lab, mark=m["target_pixel"]).save(base + "_marked.png")
        m["preview"] = os.path.relpath(base + ".png", DATA)
    # reprojected blink of one rep frame per epoch, plus intra-visit sequence if >1 frame in epoch 1
    for tag, sel in (("blink", [m for m in g if m["is_rep"]]),
                     ("ep1_dithers_blink", [m for m in g if m["epoch"] == min(x["epoch"] for x in g)] if slug == "wise0855" and det == "D1" else [])):
        if len(sel) < 2:
            continue
        wc, shp = common_wcs(sel)
        rep = []
        for m in sel:
            with fits.open(m["path"]) as h:
                arr, fp = reproject_interp((h["IMAGE"].data, WCS(h["IMAGE"].header, h)), wc, shape_out=shp)
            arr[fp < 0.5] = np.nan
            rep.append(arr)
            m.setdefault("reproj_valid_frac", {})[tag] = float(np.isfinite(arr).mean())
        lo2, hi2 = scale_for(rep)
        ims, imsm = [], []
        for m, arr in zip(sel, rep):
            lab = f"{slug} {det} {m['date_obs'][:16]} {m['wavelength_um']:.3f}um" if m["wavelength_um"] else f"{slug} {det} {m['date_obs'][:16]}"
            px, py = [float(v) for v in wc.world_to_pixel(SkyCoord(m["target_ra"] * u.deg, m["target_dec"] * u.deg))]
            ims.append(render(arr, lo2, hi2, lab)); imsm.append(render(arr, lo2, hi2, lab, mark=(px, py)))
        out = f"{DATA}/previews/{slug}_{det}_{tag}"
        save_gif(out + ".gif", ims); save_gif(out + "_marked.gif", imsm)
        summary[f"{slug}_{det}_{tag}"] = dict(frames=len(sel), grid=list(shp), dates=[m["date_obs"][:10] for m in sel])


# 12-month pairs: frames ~one year apart (same orientation, similar wavelength). Best pair = smallest |dlambda|.
for (slug, det), g in sorted(groups.items()):
    best = None
    for i, a_ in enumerate(g):
        for b_ in g[i + 1:]:
            dt = b_["mjd"] - a_["mjd"]
            if 330 <= dt <= 400 and a_["wavelength_um"] and b_["wavelength_um"]:
                dl = abs(a_["wavelength_um"] - b_["wavelength_um"])
                if best is None or dl < best[0]:
                    best = (dl, a_, b_)
    if best is None:
        continue
    dl, a_, b_ = best
    sel = [a_, b_]
    wc, shp = common_wcs(sel)
    rep = []
    for m in sel:
        with fits.open(os.path.join(DATA, m["file"])) as h:
            arr, fp = reproject_interp((h["IMAGE"].data, WCS(h["IMAGE"].header, h)), wc, shape_out=shp)
        arr[fp < 0.5] = np.nan; rep.append(arr)
    lo2, hi2 = scale_for(rep)
    ims, imsm = [], []
    for m, arr in zip(sel, rep):
        lab = f"{slug} {det} {m['date_obs'][:16]} {m['wavelength_um']:.3f}um"
        px, py = [float(v) for v in wc.world_to_pixel(SkyCoord(m["target_ra"] * u.deg, m["target_dec"] * u.deg))]
        ims.append(render(arr, lo2, hi2, lab)); imsm.append(render(arr, lo2, hi2, lab, mark=(px, py)))
    out = f"{DATA}/previews/{slug}_{det}_12mo_pair"
    save_gif(out + ".gif", ims); save_gif(out + "_marked.gif", imsm)
    summary[f"{slug}_{det}_12mo_pair"] = dict(frames=[a_["file"], b_["file"]], dlambda_um=dl,
        pa_deg=[a_["pos_angle_deg"], b_["pos_angle_deg"]], days_apart=b_["mjd"] - a_["mjd"], grid=list(shp))

for m in meta:
    m.pop("_img", None); m.pop("path", None)
manifest = dict(generated=Time.now().iso, pixel_scale_common_grid_arcsec=PIX * 3600, files=meta, gifs=summary)
json.dump(manifest, open(f"{DATA}/manifest.json", "w"), indent=1, default=float)
print("manifest:", len(meta), "files;", len(summary), "gifs")

"""Render one real SPHEREx frame per visit for each saved target, north-up, centred on the target (mockup images only)."""
import json, sys, numpy as np, warnings
warnings.filterwarnings('ignore')
from PIL import Image
from astropy.io import fits
from astropy.wcs import WCS
from reproject import reproject_interp
from datetime import datetime, timedelta
SNAP, D = sys.argv[1], sys.argv[2]
def mjd(m): return datetime(1858, 11, 17) + timedelta(days=m)
N = 240; SCALE = 1.5 / 3600
out = {}
for t in ['barnard', 'rwaur', 'epsindb', 'wise0855', 'rdra']:
    idx = json.load(open(f'{SNAP}/{t}/index.json')); a0 = idx['target']['astrometry']
    dt = 2026.0 - a0['epochJyear']
    ra = a0['ra'] + a0['pmRa'] * dt / 3.6e6 / np.cos(np.radians(a0['dec'])); dec = a0['dec'] + a0['pmDec'] * dt / 3.6e6
    tw = WCS(naxis=2); tw.wcs.ctype = ['RA---TAN', 'DEC--TAN']; tw.wcs.crval = [ra, dec]
    tw.wcs.crpix = [N / 2 + .5, N / 2 + .5]; tw.wcs.cdelt = [-SCALE, SCALE]
    visits = []
    for f in idx['frames']:
        m = f['record']['tMin']
        if not visits or m - visits[-1][-1]['record']['tMin'] > 10:
            visits.append([f])
        else:
            visits[-1].append(f)
    picks = [v[len(v) // 2] for v in visits]
    arrs = []
    for f in picks:
        b = f['box']; w = b['x1'] - b['x0']; h = b['y1'] - b['y0']
        a = np.fromfile(f"{SNAP}/{t}/{f['file']}", dtype='<f4').reshape(3, h, w)
        hd = fits.Header()
        for k, v in f['imageHeader'].items():
            try:
                hd[k] = v
            except Exception:
                pass
        hd['NAXIS'] = 2; hd['NAXIS1'] = w; hd['NAXIS2'] = h; hd['CRPIX1'] -= b['x0']; hd['CRPIX2'] -= b['y0']
        r, _ = reproject_interp((a[0] - a[1], WCS(hd, relax=True)), tw, shape_out=(N, N))
        arrs.append(r)
    allv = np.concatenate([x[np.isfinite(x)] for x in arrs])
    lo, hi = np.percentile(allv, 8), np.percentile(allv, 99.7)
    meta = []
    for i, (f, img) in enumerate(zip(picks, arrs)):
        img = np.where(np.isfinite(img), img, hi)  # display only: blank (saturated) pixels drawn white, as the app does
        x = np.clip((img - lo) / (hi - lo), 0, 1); y = np.arcsinh(x * 40) / np.arcsinh(40)
        Image.fromarray((y * 255).astype('uint8')).resize((480, 480), Image.LANCZOS).save(f'{D}/{t}-{i}.png')
        meta.append({'file': f'{t}-{i}.png', 'date': mjd(f['record']['tMin']).strftime('%d %b %Y'),
                     'obsId': f['record']['obsId'], 'frames': len(visits[i])})
    out[t] = {'name': idx['target']['name'], 'visits': meta}
json.dump(out, open(f'{D}/frames.json', 'w'), indent=1)
print('ok')

"""Shared helpers: polite HTTP with backoff, target positions, epoch clustering."""
import json, time, struct, subprocess, io, csv, urllib.request, urllib.parse, urllib.error
import numpy as np
import astropy.units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time

ROOT = "~/Documents/projects/spaceapps-melbourne-2026/research"
DATA = f"{ROOT}/data"
STATS = {"http503": 0, "retries": 0, "requests": 0}

def http_get(url, data=None, timeout=180, tries=6, binary=False):
    """GET/POST with exponential backoff on 503/timeouts. Returns bytes."""
    delay = 4.0
    for i in range(tries):
        STATS["requests"] += 1
        try:
            if data is not None:
                data_b = urllib.parse.urlencode(data).encode()
            else:
                data_b = None
            req = urllib.request.Request(url, data=data_b, headers={"User-Agent": "spaceapps-spike/0.1"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (503, 502, 504, 429):
                STATS["http503"] += 1
            elif e.code == 404:
                raise
            err = f"HTTP {e.code}"
        except Exception as e:
            err = repr(e)
        STATS["retries"] += 1
        print(f"  retry {i+1}/{tries} after {err}; sleeping {delay:.0f}s", flush=True)
        time.sleep(delay)
        delay = min(delay * 2, 120)
    raise RuntimeError(f"failed after {tries} tries: {url[:120]}")

def tap(adql):
    raw = http_get("https://irsa.ipac.caltech.edu/TAP/sync", data={"FORMAT": "csv", "QUERY": adql}).decode()
    return list(csv.DictReader(io.StringIO(raw)))

def load_targets():
    return json.load(open(f"{DATA}/targets.json"))

def position_at(t, mjd):
    """ICRS SkyCoord of target dict t at an MJD, with proper motion and parallax applied from J2000."""
    c = SkyCoord(ra=float(t["ra"]) * u.deg, dec=float(t["dec"]) * u.deg,
                 pm_ra_cosdec=float(t["pmra"] or 0) * u.mas / u.yr, pm_dec=float(t["pmdec"] or 0) * u.mas / u.yr,
                 distance=(1000.0 / float(t["plx_value"])) * u.pc if t.get("plx_value") and float(t["plx_value"]) > 0.5 else 1 * u.kpc,
                 radial_velocity=0 * u.km / u.s, frame="icrs", obstime=Time(2000.0, format="jyear"))
    return c.apply_space_motion(new_obstime=Time(mjd, format="mjd"))

def decode_pt(hexstr):
    b = bytes.fromhex(hexstr)
    x, y = struct.unpack("<dd", b[9:25])
    return x, y

def cluster_epochs(mjds, gap=30.0, max_span=120.0, bin_days=40.0):
    """Epochs = runs separated by >gap days. A run longer than max_span (continuous coverage, e.g. near
    the ecliptic poles) is split into bin_days bins so that variability can still be sampled."""
    mjds = np.asarray(mjds, float)
    order = np.argsort(mjds)
    labels = np.zeros(len(mjds), int)
    k = 0
    for j in range(1, len(order)):
        if mjds[order[j]] - mjds[order[j - 1]] > gap:
            k += 1
        labels[order[j]] = k
    out = np.zeros(len(mjds), int); n = 0
    for k in sorted(set(labels)):
        idx = np.where(labels == k)[0]
        m = mjds[idx]
        if m.max() - m.min() > max_span:
            b = np.floor((m - m.min()) / bin_days).astype(int)
            for bb in sorted(set(b)):
                out[idx[b == bb]] = n; n += 1
        else:
            out[idx] = n; n += 1
    return out

def collection_of(uri):
    # ibe/data/spherex/qr2/level2/...  ; deep variants carry "deep" somewhere in the path
    parts = uri.split("/")
    qr = parts[3] if len(parts) > 3 else "?"
    return qr + ("_deep" if "deep" in uri.lower() else "")

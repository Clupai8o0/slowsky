#!/usr/bin/env python3
"""Reference values for src/lib/uptonight.ts, computed with astropy (no refraction, no network).

Run: python scripts/uptonight_fixture.py > tests/fixtures/uptonight-astropy.json
For each sky position and each "now", it finds the dark window (Sun more than 12 degrees below the horizon) that
ends after "now", then the highest point of the position inside that window, as seen from Melbourne.
Written with AI help (Claude); the numbers come from astropy, not from a model.
"""
import json
import sys

import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord, get_sun
from astropy.time import Time
from astropy.utils import iers

iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = 'warn'

LAT, LON = -37.814, 144.963
DARK = -12.0
SITE = EarthLocation(lat=LAT * u.deg, lon=LON * u.deg, height=0 * u.m)

SPOTS = [
    ('barnard', 269.4520769586187, 4.693364966576667),
    ('rwaur', 76.95652603458333, 30.401438173888888),
    ('epsindb', 331.04414658852124, -56.782844195116105),
    ('wise0855', 133.81890825, -7.247048000000001),
    ('rdra', 248.16761083295, 66.75497941722),
    ('overhead', 20.0, -37.8),
    ('south-pole', 100.0, -89.0),
    ('never-sets', 200.0, -60.0),
    ('grazes-north', 300.0, 50.0),
    ('just-never', 40.0, 53.5),
    ('equator-0h', 0.5, 0.0),
    ('equator-12h', 180.0, 0.0),
    ('mid-south', 150.0, -25.0),
    ('mid-north', 330.0, 20.0),
]
NOWS = [
    '2026-11-15T02:00:00Z', '2026-11-15T12:00:00Z', '2026-11-15T19:30:00Z', '2026-06-21T05:00:00Z',
    '2026-12-21T13:30:00Z', '2026-04-04T10:00:00Z', '2026-10-03T15:00:00Z', '2027-02-10T00:00:00Z',
]


def crossing(t0, t1, a0, a1):
    """Linear interpolation of the time where the Sun's altitude crosses DARK between two samples."""
    f = (DARK - a0) / (a1 - a0)
    return t0 + (t1 - t0) * f


def iso(t):
    return Time(t, format='jd', scale='utc').strftime('%Y-%m-%dT%H:%M:%SZ')


def main():
    cases = []
    for now_iso in NOWS:
        now = Time(now_iso.replace('Z', ''), scale='utc')
        minutes = np.arange(-18 * 60, 32 * 60 + 1)
        times = now + minutes * u.min
        frame = AltAz(obstime=times, location=SITE, pressure=0 * u.hPa)
        with np.errstate(all='ignore'):
            sun = get_sun(times).transform_to(frame).alt.deg
        dark = sun < DARK
        jd = times.utc.jd
        start = end = None
        i = 1
        while i < len(dark):
            if dark[i] and not dark[i - 1]:
                s = crossing(jd[i - 1], jd[i], sun[i - 1], sun[i])
                j = i
                while j < len(dark) and dark[j]:
                    j += 1
                if j == len(dark):
                    break
                e = crossing(jd[j - 1], jd[j], sun[j - 1], sun[j])
                if e > now.utc.jd:
                    start, end = s, e
                    break
                i = j
            i += 1
        if start is None:
            sys.exit(f'no dark window for {now_iso}')
        inside = (jd >= start) & (jd <= end)
        idx = np.where(inside)[0]
        # One full sidereal day from the start of the dark window, on its own grid: the search grid above
        # stops 32 h after "now" and can end before the spot's highest point.
        day_times = Time(start, format='jd', scale='utc') + np.arange(0, 1437) * u.min
        day_frame = AltAz(obstime=day_times, location=SITE, pressure=0 * u.hPa)
        for name, ra, dec in SPOTS:
            spot = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame='icrs')
            altaz = spot.transform_to(frame)
            alt, az = altaz.alt.deg, altaz.az.deg
            best = idx[np.argmax(alt[idx])]
            cases.append({
                'id': name, 'ra': ra, 'dec': dec, 'now': now_iso,
                'darkStart': iso(start), 'darkEnd': iso(end),
                'best': iso(jd[best]), 'bestAltDeg': round(float(alt[best]), 3), 'bestAzDeg': round(float(az[best]), 2),
                'bestAtEdge': bool(best == idx[0] or best == idx[-1]),
                'dayMaxAltDeg': round(float(spot.transform_to(day_frame).alt.deg.max()), 3),
            })
    json.dump({'observer': {'name': 'Melbourne', 'latDeg': LAT, 'lonDeg': LON, 'timeZone': 'Australia/Melbourne'},
               'darkSunAltDeg': DARK, 'refraction': False, 'source': 'astropy ' + __import__('astropy').__version__,
               'cases': cases}, sys.stdout, indent=1)


if __name__ == '__main__':
    main()

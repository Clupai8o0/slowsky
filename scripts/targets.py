#!/usr/bin/env python3
"""Fetch SIMBAD astrometry and produce Astropy reference positions."""
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
import astropy.units as u
from astropy.coordinates import SkyCoord, Distance
from astropy.table import Table
from astropy.time import Time

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [('barnard', "Barnard's Star", "Barnard's star", 1), ('rwaur', 'RW Aur', 'RW Aur', 1), ('epsindb', 'eps Indi B', 'eps Indi B', 3), ('wise0855', 'WISE J085510.83-071442.5', 'WISE J085510.83-071442.5', 6), ('rdra', 'R Dra', 'R Dra', 1)]

def main():
    targets = []
    references = {}
    now = datetime.now(timezone.utc).isoformat()
    for ident, name, query_name, detector in TARGETS:
        escaped = query_name.replace("'", "''")
        query = ("SELECT TOP 1 b.ra,b.dec,b.pmra,b.pmdec,b.plx_value,b.rvz_radvel "
                 "FROM basic AS b JOIN ident AS i ON b.oid=i.oidref "
                 f"WHERE i.id='{escaped}'")
        response = requests.get('https://simbad.cfa.harvard.edu/simbad/sim-tap/sync', params={'request': 'doQuery', 'lang': 'adql', 'format': 'votable', 'query': query}, timeout=90)
        response.raise_for_status()
        table = Table.read(io.BytesIO(response.content), format='votable')
        if len(table) != 1:
            raise RuntimeError(f'{query_name}: {len(table)} results')
        row = table[0]
        astrometry = {'ra': float(row['ra']), 'dec': float(row['dec']), 'epochJyear': 2000.0, 'pmRa': float(row['pmra']), 'pmDec': float(row['pmdec'])}
        for field, key in [('plx_value', 'parallax'), ('rvz_radvel', 'radialVelocity')]:
            if not bool(getattr(row[field], 'mask', False)):
                astrometry[key] = float(row[field])
        args = dict(ra=astrometry['ra'] * u.deg, dec=astrometry['dec'] * u.deg, pm_ra_cosdec=astrometry['pmRa'] * u.mas/u.yr, pm_dec=astrometry['pmDec'] * u.mas/u.yr, obstime=Time(2000.0, format='jyear'), frame='icrs')
        if astrometry.get('parallax', 0) > 0:
            args['distance'] = Distance(parallax=astrometry['parallax'] * u.mas)
            if 'radialVelocity' in astrometry:
                args['radial_velocity'] = astrometry['radialVelocity'] * u.km/u.s
        coord = SkyCoord(**args)
        references[ident] = [{'mjd': mjd, 'ra': float((p := coord.apply_space_motion(new_obstime=Time(mjd, format='mjd'))).ra.deg), 'dec': float(p.dec.deg)} for mjd in (60800, 61000, 61300)]
        targets.append({'id': ident, 'name': name, 'astrometry': astrometry, 'source': f'SIMBAD (CfA mirror) via scripts/targets.py {now}', 'detector': detector})
        print(f'Fetched {query_name}: {astrometry}', flush=True)
    (ROOT/'src/data/targets.json').write_text(json.dumps(targets, indent=4) + '\n')
    (ROOT/'tests/fixtures/frame/targets_astropy.json').write_text(json.dumps(references, indent=4) + '\n')

if __name__ == '__main__':
    main()

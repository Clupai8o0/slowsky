import { DARK_SUN_ALT_DEG, MELBOURNE, type Observer, type UpTonight } from '../lib/uptonight';

export function upTonightText(r: UpTonight | null, observer: Observer = MELBOURNE): { line: string; note: string } | null
{
    if (r === null) {
        return null;
    }
    // Air bends light by about half a degree near the horizon, which these sums leave out.
    if (r.maxAltDeg < -1) {
        return { line: `This spot never rises above the horizon from ${observer.name}.`, note: '' };
    }
    const clock = new Intl.DateTimeFormat('en-GB', { timeZone: observer.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    // The dark hours are printed so a time after midnight is read as part of this night: the start is rounded up and
    // the end down, so both printed minutes are dark.
    const darkFrom = clock.format(new Date(Math.ceil(+r.darkStart / 60000) * 60000));
    const darkTo = clock.format(new Date(Math.floor(+r.darkEnd / 60000) * 60000));
    const note = `Times are ${observer.name} time. Dark means the Sun is more than ${Math.abs(DARK_SUN_ALT_DEG)}° below the horizon, here from ${darkFrom} to ${darkTo}. This says where the spot is in the sky, not whether anything can be seen there.`;
    // Inside the dark the line speaks only about what is left of it, and says so: the note below prints the whole
    // dark, and the spot may have stood higher earlier in it.
    const prefix = r.inside ? `From ${observer.name}, until the dark ends` : `Tonight from ${observer.name}`;
    const highest = r.inside ? 'highest' : 'highest in the dark';
    if (r.bestAltDeg < -1) {
        return { line: r.inside ? `${prefix}: below the horizon.` : `${prefix}: below the horizon while it is dark.`, note };
    }
    const earliest = Math.ceil(+r.from / 60000) * 60000;
    const latest = Math.floor(+r.darkEnd / 60000) * 60000;
    const rounded = Math.round(+r.best / 60000) * 60000;
    const bounded = earliest > latest ? latest : Math.max(earliest, Math.min(latest, rounded));
    const time = clock.format(new Date(bounded));
    const altitude = Math.round(r.bestAltDeg) || 0;
    const directions = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const direction = directions[Math.floor((((r.bestAzDeg % 360) + 360) % 360 + 22.5) / 45) % 8];
    // One form for every height: when the spot is highest in the stretch the line speaks about, how high, and where.
    const when = r.inside && r.bestNow ? 'now' : `at ${time}`;
    if (r.bestAltDeg < 1) {
        return { line: `${prefix}: ${highest} ${when}, near the horizon, facing ${direction}.`, note };
    }
    if (altitude < 10) {
        return { line: `${prefix}: ${highest} ${when}, very low, about ${altitude}° above the horizon, facing ${direction}.`, note };
    }
    if (altitude < 80) {
        return { line: `${prefix}: ${highest} ${when}, about ${altitude}° above the horizon, facing ${direction}.`, note };
    }
    return { line: `${prefix}: ${highest} ${when}, about ${altitude}° above the horizon, almost overhead.`, note };
}

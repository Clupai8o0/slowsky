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
    const note = `Times are ${observer.name} time. Dark means the Sun is more than ${Math.abs(DARK_SUN_ALT_DEG)}° below the horizon. This says where the spot is in the sky, not whether anything can be seen there.`;
    const prefix = r.inside ? `For the rest of tonight from ${observer.name}` : `Tonight from ${observer.name}`;
    if (r.bestAltDeg < -1) {
        return { line: `${prefix}: below the horizon while it is dark.`, note };
    }
    const earliest = Math.ceil(+r.from / 60000) * 60000;
    const latest = Math.floor(+r.darkEnd / 60000) * 60000;
    const rounded = Math.round(+r.best / 60000) * 60000;
    const bounded = earliest > latest ? latest : Math.max(earliest, Math.min(latest, rounded));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: observer.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date(bounded));
    const altitude = Math.round(r.bestAltDeg) || 0;
    const directions = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const direction = directions[Math.floor((((r.bestAzDeg % 360) + 360) % 360 + 22.5) / 45) % 8];
    if (r.bestAltDeg < 1) {
        return { line: r.sinking
            ? `${prefix}: at the horizon now and getting lower, facing ${direction}.`
            : `${prefix}: at the horizon at best, at ${time}, facing ${direction}.`, note };
    }
    if (altitude < 10) {
        return { line: r.sinking
            ? `${prefix}: very low, about ${altitude}° above the horizon now and getting lower, facing ${direction}.`
            : `${prefix}: very low, at most about ${altitude}° above the horizon, at ${time}, facing ${direction}.`, note };
    }
    if (altitude < 80) {
        return { line: r.sinking
            ? `${prefix}: about ${altitude}° above the horizon now and getting lower, facing ${direction}.`
            : `${prefix}: highest in the dark at ${time}, about ${altitude}° above the horizon, facing ${direction}.`, note };
    }
    return { line: r.sinking
        ? `${prefix}: about ${altitude}° above the horizon now, almost overhead, and getting lower.`
        : `${prefix}: highest in the dark at ${time}, about ${altitude}° above the horizon, almost overhead.`, note };
}

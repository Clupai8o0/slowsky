import { DARK_SUN_ALT_DEG, MELBOURNE, type Observer, type UpTonight } from '../lib/uptonight';

export function upTonightText(r: UpTonight | null, observer: Observer = MELBOURNE): { line: string; note: string } | null
{
    if (r === null) {
        return null;
    }
    if (r.maxAltDeg < 0) {
        return { line: `This spot never rises above the horizon from ${observer.name}.`, note: '' };
    }
    const note = `Times are ${observer.name} time. Dark means the Sun is more than ${Math.abs(DARK_SUN_ALT_DEG)}° below the horizon. This says where the spot is in the sky, not whether anything can be seen there.`;
    if (r.bestAltDeg < 0) {
        return { line: `Tonight from ${observer.name}: below the horizon while it is dark.`, note };
    }
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: observer.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date(Math.round(+r.best / 60000) * 60000));
    const altitude = Math.round(r.bestAltDeg) || 0;
    const directions = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
    const direction = directions[Math.floor((((r.bestAzDeg % 360) + 360) % 360 + 22.5) / 45) % 8];
    if (r.bestAltDeg < 10) {
        return { line: `Tonight from ${observer.name}: very low, at most about ${altitude}° above the horizon, at ${time}, facing ${direction}.`, note };
    }
    if (r.bestAltDeg < 80) {
        return { line: `Tonight from ${observer.name}: highest in the dark at ${time}, about ${altitude}° above the horizon, facing ${direction}.`, note };
    }
    return { line: `Tonight from ${observer.name}: highest in the dark at ${time}, about ${altitude}° above the horizon, almost overhead.`, note };
}

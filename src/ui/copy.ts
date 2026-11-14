// Words on screen for the five official targets. Plain language for teachers and citizen scientists.
// No measured numbers here: every number on a card comes from code or bakes in this repo.
import type { TargetId } from '../lib/types';

export type TargetKind = 'mover' | 'variable' | 'spectrum' | 'cold' | 'saturated';

export interface TargetCopy {
    display: string; // name on the button
    short: string; // one line under the name in the target list
    kind: TargetKind;
    headline: string;
    show: string; // what to look for
    not: string; // what this view cannot tell you
}

export const ORDER: TargetId[] = ['barnard', 'rwaur', 'epsindb', 'wise0855', 'rdra'];

export const COPY: Record<TargetId, TargetCopy> = {
    barnard: {
        display: 'Barnard’s Star',
        short: 'Moves fastest across our sky',
        kind: 'mover',
        headline: 'Barnard’s Star, walking north',
        show: 'The fastest-moving star in our sky. Gold rings mark where its measured motion puts it on each date. Watch it step from ring to ring.',
        not: 'Its centre may be too bright for the camera, so treat its position with care.',
    },
    rwaur: {
        display: 'RW Aurigae',
        short: 'Changes its brightness',
        kind: 'variable',
        headline: 'RW Aurigae, changing its light',
        show: 'A young star. Compare it with its neighbours: the curve measures it against them, look by look.',
        not: 'Frames are matched closely in colour to keep colour shifts small. The band shows how much the comparison stars wobble, so a change inside it may be noise.',
    },
    epsindb: {
        display: 'Epsilon Indi B',
        short: 'Fades at some colours',
        kind: 'spectrum',
        headline: 'Epsilon Indi B, missing colours',
        show: 'Two brown dwarfs, too cold to be stars. Change the colour: they fade where methane and water soak up light.',
        not: 'No brightness curve is drawn for it here. Blinking shows how it moves; it does not test whether its brightness changes.',
    },
    wise0855: {
        display: 'WISE 0855−0714',
        short: 'The coldest brown dwarf known',
        kind: 'cold',
        headline: 'WISE 0855, the coldest neighbour',
        show: 'The coldest brown dwarf known. It gives almost no light at short colours: slide to the longest colours, where earlier telescopes found it brightest.',
        not: 'The notes on its colours come from earlier telescopes. Any brightness curve shown is measured from these frames.',
    },
    rdra: {
        display: 'R Draconis',
        short: 'Too bright to measure',
        kind: 'saturated',
        headline: 'R Draconis, too bright to measure',
        show: 'A giant star that swells and shrinks. Look at the glow around it, not the centre.',
        not: 'Its centre is too bright for the camera in every frame, so the centre cannot be measured.',
    },
};

export const CUSTOM_COPY = {
    headline: 'A patch of sky you chose',
    show: 'SPHEREx looks at this spot, matched closely in colour, in date order. Blinking shows movement or changes big enough to stand out from the noise.',
    not: 'Nothing is known about this spot here. A change can be noise, a satellite trail or a camera artefact.',
};

export const MODE_HINT = {
    blink: 'Blink flips between dates. Anything that moves or changes jumps out.',
    stack: 'Stack averages every frame. Faint things appear; moving things smear.',
    diff: 'Subtract: last look minus first. Blue was there then, orange is there now.',
} as const;

export const STAGE_TEXT = {
    search: 'Asking NASA’s archive for every look at this spot',
    headers: 'Reading the files',
    pixels: 'Fetching the pixels',
    regrid: 'Lining the frames up',
} as const;

// Nominal wavelength coverage of SPHEREx's six detectors, µm (instrument description).
export const DETECTORS: [number, number][] = [
    [0.75, 1.09], [1.10, 1.62], [1.63, 2.41], [2.42, 3.82], [3.83, 4.41], [4.42, 5.00],
];

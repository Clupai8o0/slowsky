// Words on screen for the five official targets. Plain language for teachers and citizen scientists.
// No measured numbers here: every number on a card comes from code or bakes in this repo.
import type { TargetId } from '../lib/types';

export type TargetKind = 'mover' | 'variable' | 'spectrum' | 'cold' | 'saturated';

export interface TargetCopy {
    display: string; // name on the button
    kind: TargetKind;
    headline: string;
    show: string; // what to look for
    not: string; // what this view cannot tell you
}

export const ORDER: TargetId[] = ['barnard', 'rwaur', 'epsindb', 'wise0855', 'rdra'];

export const COPY: Record<TargetId, TargetCopy> = {
    barnard: {
        display: 'Barnard’s Star',
        kind: 'mover',
        headline: 'Barnard’s Star, walking north',
        show: 'The fastest-moving star in our sky. Gold rings mark where ESA’s Gaia says it should be on each date. Watch it step from ring to ring.',
        not: 'Its centre is too bright for the camera, so its position here is rough, to about one pixel.',
    },
    rwaur: {
        display: 'RW Aurigae',
        kind: 'variable',
        headline: 'RW Aurigae, changing its light',
        show: 'A young star still wrapped in dust. Compare it with its neighbours: they hold steady, it does not.',
        not: 'Every frame is matched to one colour, so a change here is brightness, not colour.',
    },
    epsindb: {
        display: 'Epsilon Indi B',
        kind: 'spectrum',
        headline: 'Epsilon Indi B, missing colours',
        show: 'Two brown dwarfs, too cold to be stars. Change the colour: they fade where methane and water soak up light.',
        not: 'It has no known change in brightness, so blinking it shows movement, not flicker.',
    },
    wise0855: {
        display: 'WISE 0855−0714',
        kind: 'cold',
        headline: 'WISE 0855, the coldest neighbour',
        show: 'The coldest brown dwarf known. At short colours the light at this spot is a background star. At the longest colours, WISE 0855 takes over.',
        not: 'Its newest visit is not public yet.',
    },
    rdra: {
        display: 'R Draconis',
        kind: 'saturated',
        headline: 'R Draconis, too bright to measure',
        show: 'A giant star that swells and shrinks. Look at the glow around it, not the centre.',
        not: 'Its centre is too bright for the camera in every frame, so the centre cannot be measured.',
    },
};

export const CUSTOM_COPY = {
    headline: 'A patch of sky you chose',
    show: 'Every SPHEREx look at this spot, matched to one colour, in date order. Anything that moves or changes will jump out when it blinks.',
    not: 'Nothing is known about this spot here. A change can be noise, a satellite trail or a camera artefact.',
};

export const MODE_HINT = {
    blink: 'Blink flips between dates. Anything that moves or changes jumps out.',
    stack: 'Stack averages every frame. Faint things appear; moving things smear.',
    diff: 'Subtract takes the last look minus the first. Blue was there then, orange is there now.',
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

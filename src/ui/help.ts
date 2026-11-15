// Plain-language help for a visitor with no astronomy background (Sam, 15 Nov 2026).
// One line per control ("what am I looking at?") and a short gloss for each technical word the page prints.
// This file holds words only, no layout, so any page layout can print them.
// Every sentence was checked against this repo's code and against a primary source: SOURCES.md, "Help text".
// The wording was drafted with an AI tool (Claude Fable 5.2), then corrected after two fact-checks: Claude Opus 5.5
// (with web access, against the sources and this repo's code) and Gemini Argon (as a zero-knowledge reader).

export type ControlId = 'target' | 'blink' | 'stack' | 'subtract' | 'colour' | 'field' | 'gaia' | 'flags' | 'falseColour'
    | 'epoch' | 'changes' | 'spectrum' | 'aiNote';

export const HELP_TITLE = 'What am I looking at?';

export const HELP_INTRO = 'Small patches of sky, photographed by NASA’s SPHEREx space telescope on different dates. '
    + 'Flip between the dates to look for spots that moved or changed brightness. Any change the page finds by itself '
    + 'is a candidate to look at again, not a finding.';

export interface ControlHelp { name: string; line: string }

export const CONTROL_HELP: Readonly<Record<ControlId, ControlHelp>> = Object.freeze({
    target: { name: 'Choose a target', line: 'Picks the patch of sky to look at: one of the listed targets, or any star name or sky position you type in.' },
    blink: { name: 'Blink', line: 'Flips through the pictures in date order when you press play or the arrows. A spot that moved seems to jump; a spot that changed brightness seems to flicker.' },
    stack: { name: 'Stack', line: 'Averages all the pictures into one. Faint, steady things get clearer; anything that moved is blurred or split into fainter copies.' },
    subtract: { name: 'Subtract', line: 'Takes an earlier visit away from a later one, so what stayed the same cancels out. Blue marks more light earlier, orange more light later. The A + B button adds the two visits instead.' },
    colour: { name: 'Change the colour', line: 'Picks which colour of light to show. SPHEREx photographs the sky in 102 colours, from just past the reddest light eyes can see out into the infrared.' },
    field: { name: 'Field', line: 'Sets how wide a patch of sky the picture covers.' },
    gaia: { name: 'Brightest Gaia stars', line: 'Rings the brightest stars in the picture that the Gaia space telescope has already measured. A spot with no ring can still be a known star.' },
    flags: { name: 'Flagged pixels', line: 'Marks pixels that the SPHEREx data files themselves flag for a problem, such as a cosmic-ray hit (a fast particle from space striking the camera). A change seen there may come from the camera, not the sky.' },
    falseColour: { name: 'False colour', line: 'Paints two infrared colours as one picture. The colours are chosen for the screen: it is for looking, not measuring.' },
    epoch: { name: 'Older picture', line: 'Lets you flip between the SPHEREx picture and a picture of the same patch of sky taken between 1997 and 2001. A star that moved sits in a different place. The two cameras differ, so not every difference is a real change.' },
    changes: { name: 'Candidate changes', line: 'Lists spots where two visits differ. Each is a candidate only: it can be a real change, noise (random speckle in the picture), a satellite trail or a camera fault.' },
    spectrum: { name: 'Spectrum', line: 'A chart of how bright the spot at the centre of the view is in each of SPHEREx’s 102 colours, read from its all-sky map.' },
    aiNote: { name: 'AI note', line: 'A short description of this view, written by an AI language model from numbers this page measured. It carries the model’s name and can be wrong.' },
});

export type TermId = 'um' | 'snr' | 'catalogueStar' | 'gaia' | 'twomass' | 'arcsec' | 'infrared' | 'frame' | 'pixel' | 'noise' | 'candidate';

// `find`: the text that, when it is on screen, means the term is in use. `short`: one line for beside the panel
// where the word first appears. `long`: the entry in the guide.
export interface Term { term: string; find: string; short: string; long: string }

export const GLOSSARY: Readonly<Record<TermId, Term>> = Object.freeze({
    um: {
        term: 'µm',
        find: 'µm',
        short: 'µm = micrometre, one thousandth of a millimetre. It measures the length of a light wave (its wavelength), which sets its colour.',
        long: 'Micrometre (also called a micron): one thousandth of a millimetre. Here it measures the length of a light wave (its wavelength), which sets its colour. Eyes see light from about 0.4 to 0.7 µm. SPHEREx photographs 0.75 to 5.0 µm, from just past the reddest light eyes can see out into the infrared.',
    },
    snr: {
        term: 'S/N',
        find: 'S/N',
        short: 'S/N = signal-to-noise: how many times bigger the change is than the noise (random speckle) expected at that spot.',
        long: 'Signal-to-noise: how many times bigger a change is than the noise (random speckle) expected at that spot. A higher figure is less likely to be noise alone, but it is not proof: beside a bright star it can read too high. Figures above 50 show as "S/N > 50".',
    },
    catalogueStar: {
        term: 'catalogue star',
        find: 'catalogue star',
        short: 'Catalogue star = a star already in Gaia’s list of stars (its catalogue), with a measured position.',
        long: 'A star already in a list of stars (a catalogue; here, Gaia’s), with a measured position and, for most stars, a measured motion too. A change at or beside one may be that star’s own light rather than something new.',
    },
    gaia: {
        term: 'Gaia',
        find: 'Gaia',
        short: 'Gaia = a European Space Agency space telescope that measured the positions of more than a billion stars.',
        long: 'A space telescope of the European Space Agency (ESA) that measured the positions, motions and brightness of more than a billion stars. This page uses the third version of its star list, called Gaia DR3.',
    },
    twomass: {
        term: '2MASS',
        find: '2MASS',
        short: '2MASS = a project that photographed the whole sky in infrared light between 1997 and 2001.',
        long: 'The Two Micron All Sky Survey: a project that photographed the whole sky in infrared light between 1997 and 2001, with two telescopes on the ground, one in Arizona and one in Chile. Its picture is the "Older picture" here.',
    },
    arcsec: {
        term: '″',
        find: '″',
        short: '″ = arcsecond, a very small angle on the sky: 1/3600 of a degree. One SPHEREx pixel is about 6″ wide.',
        long: 'Arcsecond: a very small angle on the sky, 1/3600 of a degree. The full Moon is about half a degree, or roughly 1,800″, across. One SPHEREx pixel (one of the small squares that make up its pictures) is about 6″ wide.',
    },
    infrared: {
        term: 'infrared',
        find: 'infrared',
        short: 'Infrared = light with longer waves than red light, which eyes cannot see.',
        long: 'Light with longer waves than red light, which eyes cannot see. Cool objects such as brown dwarfs (sometimes called failed stars: they never get hot enough to shine the way stars do) give off most of their light as infrared.',
    },
    frame: {
        term: 'frame',
        find: 'Frame',
        short: 'Frame = one single picture from SPHEREx, from one exposure of about two minutes.',
        long: 'One single picture from SPHEREx, from one exposure of about two minutes.',
    },
    pixel: {
        term: 'pixel',
        find: 'pixel',
        short: 'Pixel = one of the small squares that make up a picture.',
        long: 'One of the small squares that make up a digital picture. One SPHEREx pixel covers about 6″ of sky.',
    },
    noise: {
        term: 'noise',
        find: 'noise',
        short: 'Noise = random speckle in a picture. It can look like a faint spot.',
        long: 'Random speckle in a picture. It can look like a faint spot, which is why a change has to stand well clear of it.',
    },
    candidate: {
        term: 'candidate',
        find: 'candidate',
        short: 'Candidate = something worth a second look. It is not confirmed and may be noise or a camera fault.',
        long: 'Something worth a second look. It has not been confirmed, and it may turn out to be noise or a camera fault.',
    },
});

// The glossary in the order the guide prints it.
export const TERM_ORDER: readonly TermId[] = ['frame', 'pixel', 'infrared', 'um', 'arcsec', 'gaia', 'catalogueStar', 'twomass', 'noise', 'snr', 'candidate'];

export const AI_LINE = 'The code, the wording and the icon of this site were made with AI tools. '
    + 'What each tool made, and the model used, is in the project’s source list.';
export const AI_LINK = 'https://github.com/Clupai8o0/slowsky/blob/main/SOURCES.md#ai-generated-content';

// node panels.test.mjs: checks the ports in panels.js against values the product's own TS code produced
// (panels.vectors.json, made by /tmp/panels-build/build.ts at the product commit in its header). No dependencies.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const dir = new URL('.', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const sandbox = { console, Intl, Date, Math, JSON };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['frames.js', 'copy.js', 'help.js', 'paneldata.js', 'cometdata.js', 'panels.js']) {
    vm.runInContext(read(f), sandbox, { filename: f });
}
const T = sandbox.SlowskyPanels._test;
const V = JSON.parse(read('panels.vectors.json'));
let passed = 0;
let failed = 0;

function check(name, fn)
{
    try {
        fn();
        passed++;
    } catch (e) {
        failed++;
        console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n').slice(0, 6).join('\n  '));
    }
}

const plainJson = (v) => JSON.parse(JSON.stringify(v));

// upTonight and its sentence, 5 targets x 3 times.
V.upTonight.forEach((u) => {
    check('upTonight ' + u.id + ' ' + u.now, () => {
        const r = T.upTonight(u.ra, u.dec, new Date(u.now));
        if (u.r === null) {
            assert.equal(r, null);
            return;
        }
        for (const k of Object.keys(u.r)) {
            const got = r[k] instanceof Date ? +r[k] : r[k];
            if (typeof u.r[k] === 'number') {
                assert.ok(Math.abs(got - u.r[k]) < 1e-6 * Math.max(1, Math.abs(u.r[k])), k + ': ' + got + ' vs ' + u.r[k]);
            } else {
                assert.equal(got, u.r[k], k);
            }
        }
        assert.deepEqual(plainJson(T.upTonightText(r)), u.text);
    });
});

check('planetx rows', () => assert.deepEqual(plainJson(T.planetxRows()), V.planetx.rows));
check('planetx text', () => assert.deepEqual(plainJson(T.planetxChartText()), V.planetx.text));
check('planetx model', () => assert.deepEqual(plainJson(T.modelExample()), V.planetx.model));
check('planetx apparentMag(6.2, 0.475, 380)', () => assert.ok(Math.abs(T.apparentMag(6.2, 0.475, 380) - V.planetx.mag6at380) < 1e-12));
check('planetx magToX(22, 134, 166)', () => assert.ok(Math.abs(T.magToX(22, 134, 166) - V.planetx.x22) < 1e-9));

const doc = T.parseComet(sandbox.COMET_3I_ATLAS);
check('comet parses', () => assert.ok(doc && doc.frames.length > 1));
check('comet caption', () => assert.deepEqual(plainJson(T.cometCaption(doc)), V.comet.caption));
check('comet points', () => assert.deepEqual(plainJson(T.cometPoints(doc)), V.comet.points));
check('comet scale', () => {
    const s = T.sharedScale(doc);
    assert.ok(Math.abs(s.lo - V.comet.scale.lo) < 1e-9 && Math.abs(s.hi - V.comet.scale.hi) < 1e-9, JSON.stringify(s));
});
check('comet groups', () => assert.deepEqual(plainJson(T.timeGroups(doc).map((g) => g.length)), V.comet.groups));
check('COMET_BANNED', () => {
    assert.ok(T.COMET_BANNED.test('a discovery') && T.COMET_BANNED.test('was detected') && T.COMET_BANNED.test('this proves it'));
    assert.ok(!T.COMET_BANNED.test('candidates') && !T.COMET_BANNED.test('the SPHEREx team reports'));
    V.comet.caption.forEach((s) => assert.ok(!T.COMET_BANNED.test(s), 'caption has a banned word: ' + s));
});

// Halo panel words: the product's haloHtml with tags stripped, against haloText blocks plus the table header.
function strip(html)
{
    return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

for (const id of Object.keys(sandbox.COPY)) {
    check('halo text ' + id, () => {
        const want = strip((V[id] && V[id].haloHtml) || '');
        const h = sandbox.PANEL_DATA.targets[id].halo;
        if (!h) {
            assert.equal(want, '');
            return;
        }
        const parts = [];
        T.haloText(h, sandbox.COPY[id].display).forEach((b) => {
            if (b.p) {
                parts.push(b.p);
            } else if (b.table) {
                parts.push('Light in the ring, each look', 'Look', 'Colour', 'Ring light vs the median of these looks');
                b.table.forEach((r) => parts.push(...r));
            } else if (b.notes) {
                parts.push(...b.notes);
            }
        });
        assert.equal(parts.join(' ').replace(/\s+/g, ' ').trim(), want);
    });
}

check('modelName', () => {
    assert.equal(T.modelName('claude-opus-5-5'), 'Claude Opus 5.5');
    assert.equal(T.modelName('claude-sonnet-4-20250514'), 'Claude Sonnet 4');
    assert.equal(T.modelName('gpt-6'), 'Claude');
    assert.equal(T.modelName(undefined), 'Claude');
});
check('motion text (Barnard, catalogue proper motion)', () => {
    const t = sandbox.FRAMES.barnard;
    assert.match(T.motionText(t.pmRa, t.pmDec), /^10\.\d″ a year, north$/);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

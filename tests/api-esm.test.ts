import { describe, expect, it } from 'vitest';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
// @ts-expect-error Node types are not included in the browser TypeScript configuration.
import { dirname, join, relative, resolve } from 'node:path';

declare const process: { cwd(): string };

// The host runs each api/*.ts file as a native ES module. Node then needs the file extension on every
// relative import and a type attribute on every JSON import. Without them the build still passes and the
// function fails on its first call ("Cannot find module"), which no other test here would notice.

const ROOT: string = process.cwd();
const STATEMENT = /(?:^|\n)[ \t]*(import|export)\b([^;'"]*?)(?:from\s*)?'(\.{1,2}\/[^']+)'([^;\n]*)/g;

interface Problem {
    file: string;
    specifier: string;
    why: string;
}

function valueImports(source: string): { specifier: string; tail: string }[]
{
    const found: { specifier: string; tail: string }[] = [];
    for (const match of source.matchAll(STATEMENT)) {
        const clause = match[2] ?? '';
        const specifier = match[3] ?? '';
        const tail = match[4] ?? '';
        if (/^\s*type\b/.test(clause)) {
            continue; // type-only imports are erased before the code runs
        }
        found.push({ specifier, tail });
    }
    return found;
}

function check(entry: string): { problems: Problem[]; seen: string[] }
{
    const problems: Problem[] = [];
    const seen = new Set<string>();
    const queue: string[] = [resolve(ROOT, entry)];
    while (queue.length) {
        const file = queue.pop() as string;
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        const shown: string = relative(ROOT, file);
        for (const { specifier, tail } of valueImports(readFileSync(file, 'utf8') as string)) {
            if (specifier.endsWith('.json')) {
                if (!/with\s*\{\s*type:\s*'json'\s*\}/.test(tail)) {
                    problems.push({ file: shown, specifier, why: 'JSON import with no type attribute' });
                }
                continue;
            }
            if (!specifier.endsWith('.js')) {
                problems.push({ file: shown, specifier, why: 'relative import with no .js extension' });
                continue;
            }
            const target: string = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
            if (!existsSync(target)) {
                problems.push({ file: shown, specifier, why: 'no matching .ts file' });
                continue;
            }
            queue.push(target);
        }
    }
    return { problems, seen: [...seen].map((file): string => relative(ROOT, file)) };
}

describe('server functions load as native ES modules', () => {
    const names: string[] = readdirSync(join(ROOT, 'api'));
    const entries = names.filter((name) => name.endsWith('.ts')).map((name) => `api/${name}`);

    it('finds the server functions', () => {
        expect(entries).toContain('api/insight.ts');
        expect(entries).toContain('api/sia.ts');
    });

    it('every server function and everything it imports use full file names', () => {
        for (const entry of entries) {
            expect(check(entry).problems, entry).toEqual([]);
        }
    });

    it('follows the AI note function down to the target list', () => {
        const { seen } = check('api/insight.ts');
        expect(seen).toEqual(expect.arrayContaining(['api/insight.ts', 'src/lib/insight.ts', 'src/lib/insight-prompt.ts', 'src/lib/targets.ts']));
    });

    it('reads import statements the way the check needs', () => {
        const source = [
            "import a from './a';",
            "import type { B } from './b';",
            "import {",
            "    c,",
            "    type D,",
            "} from '../c.js';",
            "export { e } from './e.js';",
            "import data from './data.json' with { type: 'json' };",
            "import './side.js';",
            "import pkg from 'some-package';",
        ].join('\n');
        expect(valueImports(source)).toEqual([
            { specifier: './a', tail: '' },
            { specifier: '../c.js', tail: '' },
            { specifier: './e.js', tail: '' },
            { specifier: './data.json', tail: " with { type: 'json' }" },
            { specifier: './side.js', tail: '' },
        ]);
    });
});

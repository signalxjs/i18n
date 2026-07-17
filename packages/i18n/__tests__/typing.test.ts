/**
 * Compile-time enforcement test: generate the Schema `.d.ts` from a fixture, then
 * run tsgo over `typecheck/consumer.ts` (which consumes the built `.d.ts`, like a
 * real consumer). tsgo exits 0 only if every `@ts-expect-error` produced a real
 * error and nothing else did — i.e. the generated types genuinely reject unknown
 * keys / namespaces / locales.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest, generateDts, type CatalogEntry } from '../src/manifest.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..'); // packages/i18n

const entries: CatalogEntry[] = [
    { locale: 'en', namespace: 'cart', catalog: { title: 'Cart', hi: 'Hi {name}', items: { one: '# item', other: '# items' } } },
    { locale: 'sv', namespace: 'cart', catalog: { title: 'Kundvagn', hi: 'Hej {name}', items: { one: '# vara', other: '# varor' } } }
];

function run(cmd: string): { ok: boolean; output: string } {
    try {
        execSync(cmd, { cwd: pkgRoot, stdio: 'pipe', encoding: 'utf-8' });
        return { ok: true, output: '' };
    } catch (err) {
        const e = err as { stdout?: string; stderr?: string };
        return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
}

describe('generated types enforce keys/namespaces/locales at compile time', () => {
    it('compiles the fixture — every @ts-expect-error is a real error', () => {
        // Build the package so the fixture type-checks against the shipped .d.ts.
        const build = run('pnpm run build');
        expect(build.ok, build.output).toBe(true);

        writeFileSync(join(pkgRoot, 'typecheck', 'i18n.gen.d.ts'), generateDts(buildManifest(entries, 'en')), 'utf-8');

        const check = run('pnpm exec tsgo --noEmit -p typecheck/tsconfig.json');
        // On failure `output` shows the regression (an unused @ts-expect-error
        // means an invalid usage became valid).
        expect(check.output).toBe('');
        expect(check.ok).toBe(true);
    }, 120_000);
});

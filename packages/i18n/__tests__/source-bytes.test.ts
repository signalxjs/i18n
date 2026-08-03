/**
 * The control-byte gate, at the source end.
 *
 * `<T>`'s cache key once contained a LITERAL U+0000 (issue #53). Node parsed the
 * published bundle fine; PrimJS — the QuickJS derivative lynx runs its background
 * bundle on — stopped tokenizing at the raw byte, so every lynx app importing
 * `@sigx/i18n` died with `SyntaxError: unexpected end of string` before any of its
 * own code ran. Nothing in the toolchain noticed: the byte is invisible in an
 * editor, absent from a diff, and makes `git grep` treat the file as binary.
 *
 * `scripts/check-control-bytes.mjs` also runs over `dist/` at the end of the
 * package build — that is the artifact that actually shipped broken. This test is
 * the fast half of the same guard: it asserts on SOURCE, so it needs no build step
 * and fails at the place the regression is introduced, matching the convention in
 * `edge-clean.test.ts`. Both halves call the same function, so there is one
 * detector rather than two that can drift.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findControlBytes } from '../../../scripts/check-control-bytes.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A fixture written byte-wise: typing the raw byte here is the bug under test. */
const NUL = String.fromCharCode(0);
/** The same delimiter written as an escape (backslash-u0000), built char-wise. */
const ESCAPE = String.fromCharCode(92) + 'u0000';

async function inTempDir(files: Record<string, string>, fn: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'sigx-i18n-bytes-'));
    try {
        for (const [name, text] of Object.entries(files)) {
            await writeFile(join(dir, name), text, 'utf-8');
        }
        await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

describe('control bytes', () => {
    it('keeps raw control bytes out of every source file', async () => {
        const { findings, files, missing } = await findControlBytes(['src'], { cwd: PKG });
        expect(missing).toEqual([]);
        // The walk must reach the module that regressed, and the package at
        // large — a walk that covered nothing would report the same clean result.
        expect(files).toContain(join('src', 'component.tsx'));
        expect(files).toContain(join('src', 'store.ts'));
        expect(files.length).toBeGreaterThan(10);
        // Mapped to `file:line:column` so a failure names the byte, not just a count.
        expect(findings.map((f) => `${f.file}:${f.line}:${f.column}`)).toEqual([]);
    });

    it('reports a raw NUL, so the check above is not vacuous', async () => {
        // Guards the guard: a detector that never fires makes the test above pass
        // for a source tree that is about to kill every lynx bundle.
        await inTempDir({ 'bad.ts': `const pair = \`\${ns}${NUL}\${locale}\`;\n` }, async (dir) => {
            const { findings } = await findControlBytes(['.'], { cwd: dir });
            expect(findings).toHaveLength(1);
            expect(findings[0]).toMatchObject({ file: 'bad.ts', byte: 0, line: 1 });
            // The offending line is echoed with the byte made visible (U+2400
            // NUL SYMBOL), since printing it raw would reproduce the invisibility.
            expect(findings[0].source).toContain('␀');
        });
    });

    it('accepts the escape, which is the fix the offender should have used', async () => {
        // `store.ts`'s `KEY_SEP` uses a NUL delimiter deliberately and correctly.
        // A gate that rejected the escape too would push people back to the raw byte.
        await inTempDir({ 'good.ts': `const KEY_SEP = '${ESCAPE}';\n` }, async (dir) => {
            const { findings, files } = await findControlBytes(['.'], { cwd: dir });
            expect(files).toEqual(['good.ts']);
            expect(findings).toEqual([]);
        });
    });

    it('fails loudly when a path does not exist, instead of passing on nothing', async () => {
        const { missing, files } = await findControlBytes(['does-not-exist'], { cwd: PKG });
        expect(missing).toEqual(['does-not-exist']);
        expect(files).toEqual([]);
    });
});

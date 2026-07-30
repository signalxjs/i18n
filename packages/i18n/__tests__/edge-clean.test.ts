/**
 * The edge-cleanliness gate, mirroring core's `test:edge`.
 *
 * The deploy adapters' bundled server builds (workerd, Deno, the vercel/netlify
 * function outputs) forbid `node:` specifiers. Everything an app can reach at
 * RUNTIME must therefore be free of them — the whole point of splitting the fs
 * loader out into `@sigx/i18n/server/node`.
 *
 * This asserts on SOURCE rather than `dist/`, so it runs without a build step
 * and pins the invariant at the place a regression would be introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Modules allowed to import `node:` — build tooling and the explicit fs entry. */
const NODE_ALLOWED = new Set(['server-node.ts', 'vite.ts', 'manifest.ts']);

const NODE_IMPORT = /\b(?:from|import)\s*\(?\s*['"]node:[^'"]+['"]/;

async function sourceFiles(dir: string, base = dir): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await sourceFiles(full, base)));
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

describe('edge cleanliness', () => {
    it('keeps `node:` imports out of every runtime module', async () => {
        const offenders: string[] = [];
        for (const file of await sourceFiles(SRC)) {
            const name = file.slice(SRC.length + 1).split(/[\\/]/).join('/');
            if (NODE_ALLOWED.has(name)) continue;
            if (NODE_IMPORT.test(await readFile(file, 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toEqual([]);
    });

    it('reaches the fs loader only through @sigx/i18n/server/node', async () => {
        // If any universal module imported `server-node.js`, `node:fs` would be
        // pulled back into the graph transitively and the check above would pass
        // while the bundle still broke. Catches all three forms — `from '…'`,
        // the bare side-effect `import '…'`, and dynamic `import('…')`.
        const referencesLoader = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"][^'"]*\/server-node\.js['"]/;
        const importers: string[] = [];
        for (const file of await sourceFiles(SRC)) {
            const name = file.slice(SRC.length + 1).split(/[\\/]/).join('/');
            if (name === 'server-node.ts') continue;
            if (referencesLoader.test(await readFile(file, 'utf-8'))) importers.push(name);
        }
        expect(importers).toEqual([]);
    });

    it('the loader-reference pattern catches side-effect and dynamic imports', () => {
        // Guards the guard: a typo'd regexp would make the test above vacuous.
        const referencesLoader = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"][^'"]*\/server-node\.js['"]/;
        expect(referencesLoader.test(`import { loadCatalogs } from './server-node.js';`)).toBe(true);
        expect(referencesLoader.test(`import './server-node.js';`)).toBe(true);
        expect(referencesLoader.test(`const m = await import('./server-node.js');`)).toBe(true);
        expect(referencesLoader.test(`export * from './server-node.js';`)).toBe(true);
        expect(referencesLoader.test(`import { translate } from './translate.js';`)).toBe(false);
    });

    // ── The server entry is sigx-free ────────────────────────────────────────
    // `@sigx/i18n/server` promises "no store, no signals, no app" so it runs in a
    // mailer worker with nothing else wired up. Until now that was only an
    // accident of the import graph. It became load-bearing when the server
    // started sharing the client's translator: `createTranslator` lives in
    // `translator.ts` precisely so that `server.ts` can reach it without
    // `accessor.ts`, which imports the store at value level.

    /**
     * Resolve a `./x.js` specifier to its source file, trying both extensions —
     * `component.tsx` is a real module in this package, and resolving only `.ts`
     * would let the walk below skip it in silence, which is the one way a guard
     * like this fails: a false negative that looks exactly like a pass.
     */
    async function readSource(base: string): Promise<{ name: string; text: string } | null> {
        for (const ext of ['.ts', '.tsx']) {
            try {
                return { name: base + ext, text: await readFile(join(SRC, base + ext), 'utf-8') };
            } catch {
                /* try the next extension */
            }
        }
        return null;
    }

    /**
     * Follow relative `./x.js` imports from an entry, returning the whole source
     * graph plus anything that could NOT be resolved — the caller asserts the
     * latter is empty, so an unresolvable import fails loudly instead of
     * quietly shrinking the graph under test.
     */
    async function graphFrom(entry: string): Promise<{ files: string[]; unresolved: string[] }> {
        const seen = new Set<string>();
        const unresolved: string[] = [];
        const queue = [entry.replace(/\.tsx?$/, '')];
        while (queue.length) {
            const base = queue.pop() as string;
            if (seen.has(base)) continue;
            seen.add(base);
            const src = await readSource(base);
            if (!src) {
                unresolved.push(base);
                continue;
            }
            for (const m of src.text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.\/[^'"]+)\.js['"]/g)) {
                queue.push(m[1].slice(2));
            }
        }
        const files: string[] = [];
        for (const base of seen) {
            const src = await readSource(base);
            if (src) files.push(src.name);
        }
        return { files, unresolved };
    }

    const SIGX_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](?:@sigx\/[^'"]+|sigx(?:\/[^'"]*)?)['"]/;

    it('keeps the whole @sigx/i18n/server graph free of sigx', async () => {
        const { files, unresolved } = await graphFrom('server.ts');
        // Every relative import must have resolved, or the graph under test is
        // smaller than the real one and the assertion below is worth less.
        expect(unresolved).toEqual([]);
        // Sanity: the walk must actually reach the shared translator, or the
        // assertion below proves nothing.
        expect(files).toContain('translator.ts');
        expect(files).toContain('translate.ts');

        const offenders: string[] = [];
        for (const name of files) {
            if (SIGX_IMPORT.test(await readFile(join(SRC, name), 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toEqual([]);
    });

    it('the sigx-import pattern is not vacuous', () => {
        // Guards the guard, like the loader pattern above.
        expect(SIGX_IMPORT.test(`import { defineStore } from '@sigx/store';`)).toBe(true);
        expect(SIGX_IMPORT.test(`import { computed } from '@sigx/reactivity';`)).toBe(true);
        expect(SIGX_IMPORT.test(`import { defineInjectable } from '@sigx/runtime-core';`)).toBe(true);
        expect(SIGX_IMPORT.test(`import { component } from 'sigx';`)).toBe(true);
        expect(SIGX_IMPORT.test(`import type { Plugin } from '@sigx/vite';`)).toBe(true);
        expect(SIGX_IMPORT.test(`const s = await import('@sigx/store');`)).toBe(true);
        expect(SIGX_IMPORT.test(`import { translate } from './translate.js';`)).toBe(false);
        expect(SIGX_IMPORT.test(`import type { Params } from './types.js';`)).toBe(false);
    });

    it('proves the graph walk would catch a store import (accessor.ts does have one)', async () => {
        // The client accessor legitimately imports the store; if the walk from
        // `server.ts` ever reaches it, the invariant above must fail. Asserting
        // the walk from `accessor.ts` DOES find sigx pins that the detector and
        // the traversal actually work together.
        const { files, unresolved } = await graphFrom('accessor.ts');
        expect(unresolved).toEqual([]);
        expect(files).toContain('store.ts');
        const offenders: string[] = [];
        for (const name of files) {
            if (SIGX_IMPORT.test(await readFile(join(SRC, name), 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toContain('store.ts');
    });

    it('resolves .tsx modules, so the walk cannot skip one in silence', async () => {
        // `component.tsx` is the package's only .tsx source, and it imports the
        // sigx tier (`@sigx/runtime-core`). A walk that resolved `./component.js`
        // to `component.ts` only would drop it — and a dropped module cannot be
        // reported as an offender, which is a false PASS. Walking from the root
        // entry must find it, and must see its import.
        const { files, unresolved } = await graphFrom('index.ts');
        expect(unresolved).toEqual([]);
        expect(files).toContain('component.tsx');

        const offenders: string[] = [];
        for (const name of files) {
            if (SIGX_IMPORT.test(await readFile(join(SRC, name), 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toContain('component.tsx');
    });

    // ── The core entry never reaches for the `sigx` umbrella ─────────────────
    // `@sigx/i18n` (the root entry) claims renderer-agnosticism: `<T>` "touches no
    // DOM API, so it works on any sigx renderer unchanged". The `sigx` umbrella is
    // the DOM meta-package — its entry is `import '@sigx/runtime-dom/platform'`,
    // and `@sigx/runtime-dom` declares `global { namespace JSX { IntrinsicElements
    // … } }`. So a single `sigx` specifier anywhere in this entry's graph types
    // every JSX element in EVERY consumer against the DOM intrinsics, breaking
    // lynx/terminal apps wholesale — and at runtime builds `<T>` with the DOM JSX
    // factory instead of the host's. Renderer-neutral homes exist for all of it
    // (`@sigx/runtime-core`, `@sigx/reactivity`, `@sigx/store`). See issue #47.

    /** A bare `sigx` / `sigx/...` specifier — the umbrella, not the `@sigx/*` tier. */
    const UMBRELLA_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]sigx(?:\/[^'"]*)?['"]/;

    it('keeps the whole core @sigx/i18n graph free of the sigx umbrella', async () => {
        const { files, unresolved } = await graphFrom('index.ts');
        expect(unresolved).toEqual([]);
        // Sanity: the walk must reach the modules that would plausibly regress,
        // or the assertion below proves nothing.
        expect(files).toContain('component.tsx');
        expect(files).toContain('store.ts');

        const offenders: string[] = [];
        for (const name of files) {
            if (UMBRELLA_IMPORT.test(await readFile(join(SRC, name), 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toEqual([]);
    });

    it('the umbrella pattern is not vacuous, and does not fire on the @sigx/* tier', () => {
        // Guards the guard. The `@sigx/…` cases are the ones that matter: a
        // pattern that flagged them would make the test above fail permanently
        // and get "fixed" by deleting it.
        expect(UMBRELLA_IMPORT.test(`import { component } from 'sigx';`)).toBe(true);
        expect(UMBRELLA_IMPORT.test(`import { jsx } from 'sigx/jsx-runtime';`)).toBe(true);
        expect(UMBRELLA_IMPORT.test(`import 'sigx';`)).toBe(true);
        expect(UMBRELLA_IMPORT.test(`const s = await import('sigx/internals');`)).toBe(true);
        expect(UMBRELLA_IMPORT.test(`import { component } from '@sigx/runtime-core';`)).toBe(false);
        expect(UMBRELLA_IMPORT.test(`import { computed } from '@sigx/reactivity';`)).toBe(false);
        expect(UMBRELLA_IMPORT.test(`import { defineStore } from '@sigx/store';`)).toBe(false);
        expect(UMBRELLA_IMPORT.test(`import { persist } from '@sigx/store/persist';`)).toBe(false);
    });

    it('builds JSX with the renderer-neutral factory, not the umbrella', async () => {
        // The `jsx()` import is injected by the compiler, so it is invisible to the
        // source walk above — the umbrella can come back through configuration
        // alone, with no import to grep for. Both spellings have to be pinned: the
        // tsconfig one governs `tsgo --emitDeclarationOnly`, the vite.config one
        // governs what lands in `dist/index.js`.
        const PKG = join(SRC, '..');
        const tsconfig = await readFile(join(PKG, 'tsconfig.json'), 'utf-8');
        expect(JSON.parse(tsconfig).compilerOptions.jsxImportSource).toBe('@sigx/runtime-core');

        // `defineLibConfig` DEFAULTS `importSource` to `'sigx'`, so this must be
        // set explicitly — dropping the line is the regression, not just editing it.
        const viteConfig = await readFile(join(PKG, 'vite.config.ts'), 'utf-8');
        expect(viteConfig).toMatch(/importSource:\s*'@sigx\/runtime-core'/);
    });
});

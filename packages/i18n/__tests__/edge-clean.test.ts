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

    /** Follow relative `./x.js` imports from an entry, returning the whole source graph. */
    async function graphFrom(entry: string): Promise<string[]> {
        const seen = new Set<string>();
        const queue = [entry];
        while (queue.length) {
            const name = queue.pop() as string;
            if (seen.has(name)) continue;
            seen.add(name);
            let text: string;
            try {
                text = await readFile(join(SRC, name), 'utf-8');
            } catch {
                continue; // .tsx or a path we cannot resolve — not part of this entry
            }
            for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.\/[^'"]+)\.js['"]/g)) {
                queue.push(`${m[1].slice(2)}.ts`);
            }
        }
        return [...seen];
    }

    const SIGX_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](?:@sigx\/[^'"]+|sigx(?:\/[^'"]*)?)['"]/;

    it('keeps the whole @sigx/i18n/server graph free of sigx', async () => {
        const graph = await graphFrom('server.ts');
        // Sanity: the walk must actually reach the shared translator, or the
        // assertion below proves nothing.
        expect(graph).toContain('translator.ts');
        expect(graph).toContain('translate.ts');

        const offenders: string[] = [];
        for (const name of graph) {
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
        const graph = await graphFrom('accessor.ts');
        expect(graph).toContain('store.ts');
        const offenders: string[] = [];
        for (const name of graph) {
            if (SIGX_IMPORT.test(await readFile(join(SRC, name), 'utf-8'))) offenders.push(name);
        }
        expect(offenders).toContain('store.ts');
    });
});

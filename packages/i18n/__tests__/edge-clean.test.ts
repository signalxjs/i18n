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
        // while the bundle still broke.
        const importers: string[] = [];
        for (const file of await sourceFiles(SRC)) {
            const name = file.slice(SRC.length + 1).split(/[\\/]/).join('/');
            if (name === 'server-node.ts') continue;
            if (/from\s+['"]\.\/server-node\.js['"]/.test(await readFile(file, 'utf-8'))) importers.push(name);
        }
        expect(importers).toEqual([]);
    });
});

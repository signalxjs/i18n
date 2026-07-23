#!/usr/bin/env node

/**
 * @sigx/i18n - Pre-publish pack smoke test
 *
 * Catches packaging bugs that lint/typecheck/test miss:
 *   - missing files in `files` array
 *   - broken `exports` map
 *   - dist/ produced by stale builds
 *
 * What it does:
 *   1. Build the package (delegates to `pnpm run build`).
 *   2. `pnpm pack` the package into a temp dir.
 *   3. Spin up a minimal scratch project with a file: dep on the tarball.
 *   4. `npm install` (pulls peer/runtime deps from the npm registry).
 *   5. `node` import-smoke the published entry point.
 *
 * Usage:
 *   node scripts/verify-pack.js
 *
 * No flags. Exits non-zero on any failure.
 */

import { execSync } from 'child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const PACKAGES = ['packages/i18n'];

const sandbox = join(tmpdir(), `sigx-i18n-verify-pack-${Date.now()}`);
const tarballDir = join(sandbox, 'tarballs');
const appDir = join(sandbox, 'app');

function run(cmd, opts = {}) {
    console.log(`$ ${cmd}${opts.cwd ? `  (in ${opts.cwd})` : ''}`);
    execSync(cmd, { stdio: 'inherit', ...opts });
}

function step(label) {
    console.log(`\n▶  ${label}`);
}

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * The `catalog:` entries from pnpm-workspace.yaml, as `{ name: range }`.
 *
 * Core deps are declared `"catalog:"` in the source manifests so they stay pinned
 * to one minor in one place. `pnpm pack` resolves those to the concrete range in
 * the PUBLISHED manifest, so the tarball is fine — but this script builds its
 * scratch app from the SOURCE manifest and installs it with `npm`, which has no
 * idea what `catalog:` means:
 *
 *   npm error code EUNSUPPORTEDPROTOCOL
 *   npm error Unsupported URL Type "catalog:": catalog:
 *
 * So resolve it the same way pnpm would. Parsed leniently — the entries are
 * simple `name: ^x.y.z` lines, quoted or bare.
 */
function readCatalog() {
    const text = readFileSync(join(rootDir, 'pnpm-workspace.yaml'), 'utf-8');
    const entry = /^\s+(["']?)([@a-zA-Z0-9._/-]+)\1\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/;
    const catalog = {};
    let inCatalog = false;
    for (const line of text.split('\n')) {
        if (/^(catalog|catalogs)\s*:/.test(line)) {
            inCatalog = true;
            continue;
        }
        if (inCatalog && line.trim() !== '' && /^\S/.test(line)) inCatalog = false;
        if (!inCatalog) continue;
        const m = entry.exec(line);
        if (m) catalog[m[2]] = m[3] ?? m[4] ?? m[5];
    }
    return catalog;
}

/** Resolve a possibly-`catalog:` specifier to a concrete range npm understands. */
function resolveSpec(name, spec, catalog) {
    if (spec !== 'catalog:') return spec;
    const range = catalog[name];
    if (!range) {
        throw new Error(
            `verify-pack: "${name}" is declared "catalog:" but has no entry in pnpm-workspace.yaml's catalog block.`,
        );
    }
    return range;
}

function packPackage(pkgPath) {
    const pkgFullPath = join(rootDir, pkgPath);
    const pkgJson = readJson(join(pkgFullPath, 'package.json'));
    run('pnpm pack --pack-destination ' + JSON.stringify(tarballDir), { cwd: pkgFullPath });
    const tarballs = readdirSync(tarballDir).filter((f) => f.endsWith('.tgz'));
    const safeName = pkgJson.name.replace('@', '').replace('/', '-');
    const match = tarballs.find((f) => f.startsWith(safeName));
    if (!match) {
        throw new Error(`Could not find tarball for ${pkgJson.name} in ${tarballDir}`);
    }
    return { name: pkgJson.name, version: pkgJson.version, tarball: join(tarballDir, match) };
}

function main() {
    step(`Sandbox: ${sandbox}`);
    mkdirSync(tarballDir, { recursive: true });
    mkdirSync(appDir, { recursive: true });

    step('Build package');
    run('pnpm run build', { cwd: rootDir });

    step('Pack publishable package');
    const packed = PACKAGES.map(packPackage);
    for (const p of packed) {
        console.log(`   📦 ${p.name}@${p.version}  →  ${p.tarball}`);
    }

    step('Create scratch app');
    const deps = Object.fromEntries(
        packed.map((p) => [p.name, `file:${p.tarball.replace(/\\/g, '/')}`])
    );
    // @sigx/i18n declares the sigx runtime tier + @sigx/store as (non-optional)
    // peers — satisfy them from npm so the import smoke can resolve.
    const peers = readJson(join(rootDir, 'packages/i18n/package.json')).peerDependencies;
    const catalog = readCatalog();
    for (const peer of ['@sigx/reactivity', '@sigx/runtime-core', '@sigx/store', 'sigx']) {
        deps[peer] = resolveSpec(peer, peers[peer], catalog);
    }
    const appPkg = {
        name: 'sigx-i18n-pack-smoke',
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: { smoke: 'node smoke.mjs' },
        dependencies: deps,
    };
    writeFileSync(join(appDir, 'package.json'), JSON.stringify(appPkg, null, 2));

    writeFileSync(
        join(appDir, 'smoke.mjs'),
        [
            "import * as i18n from '@sigx/i18n';",
            "if (!i18n || typeof i18n !== 'object') throw new Error('import returned non-object');",
            "const keys = Object.keys(i18n);",
            "if (keys.length === 0) throw new Error('@sigx/i18n exports no named bindings');",
            "console.log('\\u2713 @sigx/i18n named exports:', keys.join(', '));",
            '',
        ].join('\n')
    );

    step('Install scratch app (npm — to avoid pnpm workspace hoisting interference)');
    run('npm install --no-audit --no-fund --loglevel=error', { cwd: appDir });

    step('Run import smoke');
    run('npm run smoke --silent', { cwd: appDir });

    step('✅ Pack smoke test passed');
}

try {
    main();
} catch (err) {
    console.error('\n❌ Pack smoke test failed:', err.message);
    console.error(`   Sandbox preserved for inspection: ${sandbox}`);
    process.exitCode = 1;
    process.exit(1);
}

try {
    rmSync(sandbox, { recursive: true, force: true });
} catch {
    // ignore
}

#!/usr/bin/env node

/**
 * @sigx/i18n - Control-byte gate (CLI)
 *
 * Fails the build when raw C0 control bytes reach `dist/`. A NUL is the one that
 * motivated this (issue #53): `<T>`'s cache key was written with a LITERAL U+0000
 * pasted into the `.tsx` source instead of an escape, esbuild preserves
 * template-literal raw text, and the byte travelled verbatim into the published
 * `dist/index.js`. Node parses it fine; PrimJS — the QuickJS derivative lynx runs
 * its background bundle on — stops tokenizing at it, so every lynx app importing
 * `@sigx/i18n` died with `SyntaxError: unexpected end of string`.
 *
 * Wired into the package `build`, not just `verify:pack`: `release.yml` builds and
 * publishes without running the latter, so a check living only there would not
 * have stopped the release that shipped this. The detector itself is in
 * `lib/control-bytes.mjs`, shared with the vitest source guard.
 *
 * Usage:
 *   node scripts/check-control-bytes.mjs <path>...     # dirs or files
 *
 * Exits non-zero on any offender, and also when nothing could be scanned at all —
 * a guard that silently passes because its target moved is worse than no guard.
 */

import { findControlBytes } from './lib/control-bytes.mjs';

/** How many offenders to print before summarising the rest. */
const MAX_REPORTED = 20;

const paths = process.argv.slice(2);
if (paths.length === 0) {
    console.error('usage: node scripts/check-control-bytes.mjs <path>...');
    process.exit(2);
}

const { findings, files, missing } = await findControlBytes(paths);

for (const path of missing) {
    console.warn(`⚠  ${path} does not exist — skipped.`);
}
// Every path missing means nothing was checked. Pass in that state and the guard
// reports success for a build it never looked at.
if (missing.length === paths.length) {
    console.error(`\n❌ Nothing to scan: none of ${paths.join(', ')} exist.`);
    process.exit(1);
}

if (findings.length > 0) {
    console.error(`\n❌ ${findings.length} raw control byte${findings.length > 1 ? 's' : ''} found:\n`);
    // One mangled file can hold thousands of them; printing every one buries the
    // first (and the exit code) under its own output. The count above is the
    // total, so the truncation is never silent.
    for (const f of findings.slice(0, MAX_REPORTED)) {
        const hex = f.byte.toString(16).padStart(4, '0').toUpperCase();
        console.error(`   ${f.file}:${f.line}:${f.column}  U+${hex} (byte offset ${f.offset})`);
        console.error(`   │ ${f.source}`);
        console.error(`   │ ${' '.repeat(Math.max(0, f.column - 1))}^\n`);
    }
    if (findings.length > MAX_REPORTED) {
        console.error(`   … and ${findings.length - MAX_REPORTED} more.\n`);
    }
    console.error(
        '   Write the character as an escape (`\\u0000`) instead of pasting the raw\n' +
            '   byte. QuickJS-family engines — lynx/PrimJS — stop tokenizing at a raw\n' +
            '   NUL, so one of these kills the entire bundle. See issue #53.'
    );
    process.exit(1);
}

const n = files.length;
console.log(`✓ no raw control bytes in ${n} file${n === 1 ? '' : 's'} (${paths.join(', ')})`);

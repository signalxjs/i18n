/**
 * @sigx/i18n - Control-byte gate
 *
 * Rejects raw C0 control bytes in source and in build output. A NUL is the one
 * that motivated this (issue #53): `<T>`'s cache key was written with a LITERAL
 * U+0000 pasted into the `.tsx` source instead of an escape, and esbuild
 * preserves template-literal raw text — so the byte travelled verbatim into
 * `dist/index.js`. Node parses it fine. QuickJS-family engines do not: PrimJS
 * (what lynx runs its background bundle on) treats a raw NUL as end-of-string
 * while tokenizing, so the WHOLE app bundle failed to parse with
 * `SyntaxError: unexpected end of string`. No error boundary, no fallback.
 *
 * The byte is invisible in every editor and renders as nothing in a diff, and it
 * makes `git`/`grep` treat the file as binary — so nothing but a byte-level check
 * catches it. Escapes (`'\u0000'`, as `store.ts`'s `KEY_SEP` correctly spells it)
 * are 7-bit clean and always pass; only raw bytes are rejected.
 *
 * The detector lives here rather than in `check-control-bytes.mjs` so the vitest
 * source guard can import it: vite's SSR transform hoists its import shims to
 * line 1, which lands on top of that file's `#!/usr/bin/env node` and fails to
 * parse (`Invalid Character !`). A library module with no shebang imports
 * cleanly from both the CLI and a test — the same split `lib/core-deps.mjs` uses.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Tab, LF and CR are the control bytes that legitimately appear in text. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

/** C0 controls minus the three above, plus DEL. */
export const isControlByte = (b) => (b < 0x20 && !ALLOWED.has(b)) || b === 0x7f;

/**
 * Directories that are never ours to police, and file types where a "control
 * byte" is just data. Everything this repo ships under `src/` and `dist/` is
 * text, so the extension list stays short on purpose — an unknown extension is
 * scanned rather than skipped.
 */
const SKIP_DIRS = new Set(['node_modules', '.git']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|wasm|mp4|webm)$/i;

/** Every file under `path`, recursively; a file path yields just itself. */
async function filesUnder(path) {
    const info = await stat(path);
    if (!info.isDirectory()) return [path];
    const out = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = join(path, entry.name);
        if (entry.isDirectory()) out.push(...(await filesUnder(full)));
        else if (!BINARY_EXT.test(entry.name)) out.push(full);
    }
    return out;
}

/**
 * Locate an offending byte within its line. Byte offsets are what a scan
 * produces, but "line 80, column 30" is what a human needs to go fix it.
 *
 * Positions are counted in BYTES, not code points — off by a column on a line
 * with non-ASCII text before the offender, and worth it to keep the whole check
 * on `Buffer` rather than decoding files that are, by hypothesis, not valid text.
 */
function locate(buf, offset) {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
        if (buf[i] === 0x0a) {
            line++;
            lineStart = i + 1;
        }
    }
    let lineEnd = buf.indexOf(0x0a, offset);
    if (lineEnd === -1) lineEnd = buf.length;
    return { line, column: offset - lineStart + 1, lineStart, lineEnd };
}

/**
 * Report paths relative to `cwd`, except when that would climb out of it — a
 * `../../../../private/tmp/…` prefix is longer and harder to read than the
 * absolute path it is derived from.
 */
const display = (cwd, file) => {
    const rel = relative(cwd, file);
    return rel.startsWith('..') ? file : rel;
};

/** `\x00` → `␀` — the Unicode "control picture" for the byte, so it can be seen. */
const picture = (b) => (b === 0x7f ? '␡' : String.fromCodePoint(0x2400 + b));

/**
 * Scan `paths` (files or directories) for raw control bytes.
 *
 * Returns `{ findings, files, missing }`: one finding per offending byte, every
 * file actually read (`cwd`-relative), and any path that did not exist. The file
 * list is part of the contract so a caller can assert the walk reached what it
 * meant to check — a walk that quietly covers nothing reports the same clean
 * result as a walk that covers everything. Exported so the vitest source guard
 * runs THIS implementation rather than a second copy of it that can drift.
 */
export async function findControlBytes(paths, { cwd = process.cwd() } = {}) {
    const findings = [];
    const missing = [];
    const scanned = [];

    for (const path of paths) {
        const full = resolve(cwd, path);
        let files;
        try {
            files = await filesUnder(full);
        } catch (err) {
            if (err.code === 'ENOENT') {
                missing.push(path);
                continue;
            }
            throw err;
        }
        for (const file of files) {
            const buf = await readFile(file);
            scanned.push(display(cwd, file));
            // Fast path: nearly every file is clean, and a byte-by-byte walk of
            // a whole dist/ is wasted work. `buf.some` short-circuits, and the
            // detailed pass below only runs for a file that already failed.
            if (!buf.some(isControlByte)) continue;
            for (let i = 0; i < buf.length; i++) {
                if (!isControlByte(buf[i])) continue;
                const { line, column, lineStart, lineEnd } = locate(buf, i);
                findings.push({
                    file: display(cwd, file),
                    offset: i,
                    byte: buf[i],
                    line,
                    column,
                    source: buf
                        .subarray(lineStart, lineEnd)
                        .toString('utf-8')
                        .replace(/[\0-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => picture(c.charCodeAt(0)))
                });
            }
        }
    }
    return { findings, files: scanned, missing };
}

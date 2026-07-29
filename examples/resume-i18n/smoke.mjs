/**
 * End-to-end smoke over the PRODUCTION build — the honest tier: it asserts on
 * built artifacts and real HTTP responses, not on unit-test doubles.
 *
 *     pnpm build && pnpm smoke
 *
 * What it proves, in the order the claims appear in the README:
 *   1. the document is fully translated server-side, in each locale;
 *   2. the page references exactly ONE script — the resume loader;
 *   3. the locale switch is a real round trip: link → new language + cookie,
 *      and the cookie alone (no query param) keeps it;
 *   4. `Accept-Language` negotiates when nothing else says otherwise;
 *   5. a server function answers in the request's language;
 *   6. the `serverOnly` catalog is nowhere in the client build;
 *   7. nothing in the server build imports `node:` — the edge-safety claim.
 *
 * Not covered here: "only the loader EXECUTES on load" and the upgrade-on-write
 * ladder need JS-coverage instrumentation in a real browser; that machinery
 * lives in core's `examples/resume/smoke.mjs`. This file deliberately asserts
 * only what it can actually observe.
 */
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SMOKE_PORT) || 3199;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
const check = (name, ok, detail = '') => {
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
    if (!ok) failures++;
};

const get = async (path, headers = {}) => {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
    return { res, body: await res.text() };
};

/** Every file under `dir`, recursively. */
async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else out.push(full);
    }
    return out;
}

async function waitForServer(child, attempts = 60) {
    for (let i = 0; i < attempts; i++) {
        if (child.exitCode !== null) throw new Error('server exited before becoming ready');
        try {
            const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
            if (res.ok) return;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`server did not start on ${BASE}`);
}

const server = spawn(process.execPath, ['--conditions', 'production', 'server.mjs'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit']
});

try {
    await waitForServer(server);
    console.log(`\n[smoke] production server on ${BASE}\n`);

    // 1 — translated server-side, per locale
    const en = await get('/');
    check('English document is fully translated', en.body.includes('Localized resumability'));
    check('English number/date use the locale', en.body.includes('1,280 credits'));
    const sv = await get('/?lang=sv');
    check('Swedish document is fully translated', sv.body.includes('Lokaliserad återupptagbarhet'));
    check('Swedish number/date use the locale', /1[\s ]280 krediter/.test(sv.body));
    check(
        'no untranslated interpolation tokens leak into the HTML',
        !/\{(locale|credits|updated|count|name)\}/.test(en.body + sv.body)
    );

    // 2 — one script: the resume loader
    const scripts = [...en.body.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    check(`page references exactly one script (got ${scripts.length}: ${scripts.join(', ') || 'none'})`,
        scripts.length === 1);

    // 3 — the round-trip switch
    check('?lang=sv sets the locale cookie', (sv.res.headers.get('set-cookie') ?? '').includes('locale=sv'));
    const cookieOnly = await get('/', { Cookie: 'locale=sv' });
    check('the cookie alone keeps the page Swedish', cookieOnly.body.includes('Aktuellt språk: sv'));
    check('the EN link on a Swedish page carries lang=en', /href="[^"]*lang=en"/.test(sv.body));

    // 4 — header negotiation
    const header = await get('/', { 'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.5' });
    check('Accept-Language negotiates the locale', header.body.includes('Aktuellt språk: sv'));
    check('default request falls back to the master locale', en.body.includes('Current locale: en'));

    // 5 — localized server function
    const { serverFns } = await import(new URL('./dist/server/sigx-server-fns.js', import.meta.url).href);
    const symbol = Object.keys(serverFns).find((s) => s.startsWith('greet'));
    const callGreet = async (headers) => {
        const res = await fetch(`${BASE}/_sigx/fn/${symbol}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers },
            body: JSON.stringify({ args: ['Ada'] })
        });
        return (await res.json()).data ?? '';
    };
    check('server fn answers in English by default', (await callGreet({})).includes('Hello Ada'));
    check('server fn answers in Swedish for a Swedish request',
        (await callGreet({ Cookie: 'locale=sv' })).includes('Hej Ada'));

    // 6 — the serverOnly catalog never reaches the client
    const clientFiles = await walk(resolve(__dirname, 'dist/client'));
    const clientText = (await Promise.all(clientFiles.map((f) => readFile(f, 'utf-8').catch(() => '')))).join('');
    check('the serverOnly `mail` namespace is absent from the client build',
        !clientText.includes('translated on the server') && !clientText.includes('översattes'));

    // 7 — the server build is edge-clean
    const serverFiles = (await walk(resolve(__dirname, 'dist/server'))).filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const file of serverFiles) {
        if (/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]node:/.test(await readFile(file, 'utf-8'))) offenders.push(file);
    }
    check(`no \`node:\` imports in the server build (${serverFiles.length} files)`, offenders.length === 0,
        offenders.join('\n        '));
} finally {
    server.kill();
}

console.log(`\n[smoke] ${failures === 0 ? 'all checks passed' : `${failures} check(s) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);

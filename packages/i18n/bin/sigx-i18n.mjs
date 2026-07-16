#!/usr/bin/env node
/**
 * sigx-i18n — CI/scripting entry for the catalog completeness gate + type codegen.
 *
 *   sigx-i18n check  --dir src/locales --master en [--strict error|warn|off] [--targets '<json>'] [--ignore a,b]
 *   sigx-i18n types  --dir src/locales --master en --out src/i18n.gen.d.ts [--targets '<json>']
 *
 * `check` exits non-zero when catalogs are incomplete (for CI).
 */

import { runI18nCheck, writeI18nTypes, formatReport } from '../dist/vite.js';

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) out[key] = true;
            else out[key] = argv[++i];
        } else {
            out._.push(a);
        }
    }
    return out;
}

function buildOptions(args) {
    return {
        localesDir: args.dir ?? 'src/locales',
        masterLocale: args.master ?? 'en',
        strict: args.strict,
        targets: args.targets ? JSON.parse(args.targets) : undefined,
        ignoreMissing: args.ignore ? String(args.ignore).split(',') : undefined,
        ignoreLocales: args['ignore-locales'] ? String(args['ignore-locales']).split(',') : undefined,
        dtsOutFile: args.out
    };
}

const [command = 'check', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const options = buildOptions(args);

try {
    if (command === 'types') {
        const out = await writeI18nTypes(options);
        console.log(`[@sigx/i18n] wrote types → ${out}`);
    } else if (command === 'check') {
        const result = await runI18nCheck(options);
        console.log(formatReport(result));
        if (!result.ok) process.exit(1);
    } else {
        console.error(`Unknown command "${command}". Use "check" or "types".`);
        process.exit(2);
    }
} catch (err) {
    console.error(`[@sigx/i18n] ${err instanceof Error ? err.message : err}`);
    process.exit(2);
}

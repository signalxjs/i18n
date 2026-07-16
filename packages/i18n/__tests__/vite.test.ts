/** Tests for @sigx/i18n/vite — fs scan, build gate, and type emission. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runI18nCheck, writeI18nTypes, i18n } from '../src/vite.js';

let dir: string;

function write(rel: string, json: unknown): void {
    const parts = rel.split('/');
    const file = parts.pop() as string;
    const target = join(dir, ...parts);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, file), JSON.stringify(json), 'utf-8');
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sigx-i18n-vite-'));
    write('en/cart.json', { title: 'Cart', hi: 'Hi {name}' });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runI18nCheck', () => {
    it('passes when every locale is complete', async () => {
        write('sv/cart.json', { title: 'Kundvagn', hi: 'Hej {name}' });
        const r = await runI18nCheck({ localesDir: dir, masterLocale: 'en' });
        expect(r.ok).toBe(true);
    });

    it('fails when a locale is missing a master key', async () => {
        write('sv/cart.json', { title: 'Kundvagn' }); // missing `hi`
        const r = await runI18nCheck({ localesDir: dir, masterLocale: 'en' });
        expect(r.ok).toBe(false);
        expect(r.errors.map(p => `${p.locale}:${p.key}`)).toContain('sv:hi');
    });
});

describe('writeI18nTypes', () => {
    it('writes a .d.ts describing the catalog', async () => {
        write('sv/cart.json', { title: 'Kundvagn', hi: 'Hej {name}' });
        const out = join(dir, 'i18n.gen.d.ts');
        await writeI18nTypes({ localesDir: dir, masterLocale: 'en', dtsOutFile: out });
        expect(existsSync(out)).toBe(true);
        const content = readFileSync(out, 'utf-8');
        expect(content).toContain('locales: "en" | "sv";');
        expect(content).toContain('"hi": { "name": string | number };');
    });
});

describe('i18n() plugin build gate', () => {
    // Minimal Rollup plugin-context stand-in: `this.error` aborts the build.
    const ctx = {
        error(msg: string): never {
            throw new Error(typeof msg === 'string' ? msg : String(msg));
        }
    };
    const runBuildStart = (plugin: ReturnType<typeof i18n>) =>
        (plugin.buildStart as (this: typeof ctx) => Promise<void>).call(ctx);

    it('aborts the build when catalogs are incomplete', async () => {
        write('sv/cart.json', { title: 'Kundvagn' }); // missing `hi`
        const plugin = i18n({ localesDir: dir, masterLocale: 'en', dtsOutFile: join(dir, '..', 'gen.d.ts') });
        await expect(runBuildStart(plugin)).rejects.toThrow(/incomplete catalogs/);
    });

    it('passes and emits types when catalogs are complete', async () => {
        write('sv/cart.json', { title: 'Kundvagn', hi: 'Hej {name}' });
        const out = join(dir, '..', `gen-${Date.now()}.d.ts`);
        const plugin = i18n({ localesDir: dir, masterLocale: 'en', dtsOutFile: out });
        await expect(runBuildStart(plugin)).resolves.toBeUndefined();
        expect(existsSync(out)).toBe(true);
        rmSync(out, { force: true });
    });

    it('does not abort under strict:off', async () => {
        write('sv/cart.json', { title: 'Kundvagn' }); // missing `hi`
        const plugin = i18n({
            localesDir: dir,
            masterLocale: 'en',
            strict: 'off',
            generateTypes: false,
            dtsOutFile: join(dir, '..', 'gen.d.ts')
        });
        await expect(runBuildStart(plugin)).resolves.toBeUndefined();
    });
});

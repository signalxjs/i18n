import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { i18n } from '@sigx/i18n/vite';

export default defineConfig({
    plugins: [
        sigx(),
        // Demonstrates the two build-tool guarantees against this app's own
        // catalogs: typed keys (generated .d.ts) + the missing-translation build
        // gate. Delete a key from a non-`en` file and `vite build` will fail.
        i18n({
            localesDir: 'src/locales',
            masterLocale: 'en',
            targets: { app: { extends: 'common' }, marketing: { extends: 'common' }, common: {} },
            dtsOutFile: 'src/i18n.gen.d.ts'
        })
    ],
    oxc: {
        jsx: { runtime: 'automatic', importSource: 'sigx' }
    },
    server: { port: 5173, open: true }
});

import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { sigxResume } from '@sigx/vite/resume';
import { sigxServer } from '@sigx/vite/server';
import { i18n } from '@sigx/i18n/vite';

// The @sigx family is externalized from the dev-server module graph so the app,
// the request handler and resumePlugin() share one set of module instances —
// one module graph, so DI tokens line up (same posture as core's examples).
const SIGX_FAMILY = [
    'sigx',
    '@sigx/server-renderer',
    '@sigx/resume',
    '@sigx/server',
    '@sigx/runtime-core',
    '@sigx/runtime-dom',
    '@sigx/reactivity'
];

export default defineConfig(({ command }) => ({
    plugins: [
        sigx({ ssr: { entry: 'src/entry-server.tsx' } }),
        sigxResume(),
        sigxServer(),
        i18n({
            localesDir: 'src/locales',
            masterLocale: 'en',
            // `mail` never reaches the browser: it is dropped from
            // virtual:sigx-i18n/catalogs and IS virtual:sigx-i18n/server-catalogs.
            serverOnly: ['mail']
        })
    ],
    oxc: {
        jsx: { runtime: 'automatic', importSource: 'sigx' }
    },
    ...(command === 'serve' && { ssr: { external: SIGX_FAMILY } })
}));

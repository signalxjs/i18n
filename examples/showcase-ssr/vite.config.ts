import { defineConfig } from 'vite';
import sigx from '@sigx/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string, sub = 'dist/index.js') =>
    resolve(__dirname, 'node_modules', name, sub);

// DEV ONLY: pin every @sigx/* package (and its subpaths) to a single canonical
// copy in this app's node_modules. Under pnpm's symlinked layout the dev SSR
// module runner can otherwise resolve two copies of the same package, which
// splits DI-token identity — the app's `createI18n(...)` provide would then be
// invisible to the store resolved inside the renderer. Flat installs (npm/yarn)
// usually don't need this. The map is NOT applied to builds (see below).
const devAliases = {
    'sigx/jsx-runtime': pkg('sigx', 'dist/sigx.js'),
    'sigx/jsx-dev-runtime': pkg('sigx', 'dist/sigx.js'),
    'sigx/internals': pkg('sigx', 'dist/internals.js'),
    sigx: pkg('sigx', 'dist/sigx.js'),
    '@sigx/runtime-core/internals': pkg('@sigx/runtime-core', 'dist/internals.js'),
    '@sigx/runtime-core': pkg('@sigx/runtime-core'),
    '@sigx/runtime-dom/platform': pkg('@sigx/runtime-dom', 'dist/platform.js'),
    '@sigx/runtime-dom/internals': pkg('@sigx/runtime-dom', 'dist/internals.js'),
    '@sigx/runtime-dom': pkg('@sigx/runtime-dom'),
    '@sigx/reactivity/internals': pkg('@sigx/reactivity', 'dist/internals.js'),
    '@sigx/reactivity': pkg('@sigx/reactivity'),
    '@sigx/store/persist': pkg('@sigx/store', 'dist/persist.js'),
    '@sigx/store/ssr': pkg('@sigx/store', 'dist/ssr.js'),
    '@sigx/store': pkg('@sigx/store'),
    '@sigx/server-renderer/server': pkg('@sigx/server-renderer', 'dist/server/index.js'),
    '@sigx/server-renderer/client': pkg('@sigx/server-renderer', 'dist/client/index.js'),
    '@sigx/server-renderer/node': pkg('@sigx/server-renderer', 'dist/node.js'),
    '@sigx/server-renderer': pkg('@sigx/server-renderer')
};

export default defineConfig(({ command }) => ({
    plugins: [sigx({ ssr: { entry: 'src/entry-server.tsx' } })],
    oxc: {
        jsx: { runtime: 'automatic', importSource: 'sigx' }
    },
    ...(command === 'serve' && {
        resolve: { alias: devAliases },
        // Force the whole @sigx family (incl. the workspace-linked @sigx/i18n)
        // through Vite's aliased SSR graph so they share one runtime-core copy.
        ssr: { noExternal: ['sigx', /^@sigx\//] }
    })
}));

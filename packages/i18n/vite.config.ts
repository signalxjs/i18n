import { defineLibConfig } from '@sigx/vite/lib';

export default defineLibConfig({
    entry: {
        index: 'src/index.ts',
        server: 'src/server.ts',
        'server-node': 'src/server-node.ts',
        vite: 'src/vite.ts'
    },
    // Keep the whole sigx runtime tier, node builtins, and the vite/@sigx/vite
    // build-tool deps external so they are never inlined (single reactivity copy;
    // server/vite entries stay node-only and don't bloat the client bundles).
    // No `sigx` entry: the umbrella is the DOM meta-package and this bundle must
    // never reach for it — `/^@sigx\//` already covers everything we do import.
    external: [/^@sigx\//, /^node:/, 'vite'],
    jsx: true,
    // `defineLibConfig` defaults the JSX factory to `sigx`, which would emit
    // `import { jsx } from 'sigx/jsx-runtime'` into `dist/index.js` and drag the
    // DOM renderer into every consumer at RUNTIME. `<T>` is renderer-agnostic;
    // build it with the renderer-neutral factory (issue #47).
    importSource: '@sigx/runtime-core'
});

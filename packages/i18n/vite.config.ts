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
    external: [/^@sigx\//, /^node:/, 'sigx', 'sigx/jsx-runtime', 'sigx/jsx-dev-runtime', 'vite'],
    jsx: true
});

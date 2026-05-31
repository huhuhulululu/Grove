import { chmodSync } from 'node:fs'
import { defineConfig } from 'tsup'

/**
 * tsup build for the `sq` CLI binary.
 *
 * Why bundle: src/ uses extensionless, Bundler-style imports (tsconfig
 * moduleResolution: "Bundler") that plain `node` can't resolve. tsup bundles
 * the whole dependency graph from the single entry into one ESM file, so the
 * shipped `dist/cli/sq.js` runs under bare `node` with no loader/tsx.
 *
 * Output: dist/cli/sq.js — ESM, with a `#!/usr/bin/env node` shebang, marked
 * executable so it can be the package `bin`.
 *
 * ink/react (M3 TUI): tsup externalizes `dependencies` by DEFAULT, which would
 * leave `import ... from 'ink'/'react'` in the bundle and make `sq` depend on
 * node_modules being present. `noExternal` forces them (and React's jsx-runtime)
 * INTO the bundle so `node dist/cli/sq.js help` runs self-contained. zod stays
 * external (loaded from node_modules at runtime) per the original design.
 */
export default defineConfig({
  entry: { 'cli/sq': 'src/cli/sq.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle everything (resolve the extensionless internal imports); keep zod as
  // a real dependency so its package is loaded from node_modules at runtime.
  bundle: true,
  // zod loads from node_modules at runtime.
  external: ['zod'],
  // Pull ink + react into the bundle (they would otherwise be externalized as
  // dependencies). Regex matches react, react/jsx-runtime, ink, and ink's deps.
  noExternal: [/^react($|\/)/, /^ink($|\/)/],
  // react-devtools-core is an OPTIONAL, dev-only ink import
  // (ink/build/devtools.js, reached only under DEV=true and not installed).
  // Marking it `external` would leave a static `import 'react-devtools-core'`
  // that ESM resolves BEFORE any code runs — crashing even `sq help`. Instead,
  // resolve it to an empty in-memory stub so the bundle is self-contained and
  // the (never-taken) dev path no-ops.
  esbuildPlugins: [
    {
      name: 'stub-react-devtools-core',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default {}; export const connectToDevTools = () => {};',
          loader: 'js',
        }))
      },
    },
  ],
  // Shebang + a `require` shim: ink/react are CJS and esbuild leaves
  // `require("assert")` / `require("events")` (Node builtins) in the ESM bundle.
  // ESM has no global `require`, so without this the shim throws "Dynamic
  // require not supported" on startup. createRequire restores it.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __sqCreateRequire } from 'node:module';",
      'const require = __sqCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  clean: true,
  sourcemap: false,
  splitting: false,
  // tsup does not chmod output; the bin must be executable.
  onSuccess: async () => {
    chmodSync('dist/cli/sq.js', 0o755)
  },
})

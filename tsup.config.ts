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
 * ink/react/react-dom: externalized as regular dependencies (loaded from
 * node_modules at install time). zod is also external. Both are listed under
 * `dependencies` in package.json so npm installs them alongside the binary.
 * The react-devtools-core stub plugin below prevents the (never-taken) dev
 * code-path from crashing on import resolution.
 */
export default defineConfig({
  entry: { 'cli/sq': 'src/cli/sq.ts' },
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  // Bundle everything (resolve the extensionless internal imports); keep
  // dependencies external so they load from node_modules at runtime.
  bundle: true,
  external: ['zod', 'ink', 'react', 'react-dom', 'react/jsx-runtime'],
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
  // splitting: true lets esbuild emit the tui/app chunk as a separate file,
  // so non-tui commands (event, status, commit-hook, dashboard…) never load
  // Ink/React from node_modules. The hot path (sq event / commit-hook) pays
  // only for the lightweight main chunk; `sq tui` pays the Ink cost on demand.
  splitting: true,
  // tsup does not chmod output; the bin must be executable.
  onSuccess: async () => {
    chmodSync('dist/cli/sq.js', 0o755)
  },
})

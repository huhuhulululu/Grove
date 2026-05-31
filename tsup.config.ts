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
  external: ['zod'],
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  sourcemap: false,
  splitting: false,
  // tsup does not chmod output; the bin must be executable.
  onSuccess: async () => {
    chmodSync('dist/cli/sq.js', 0o755)
  },
})

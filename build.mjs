/**
 * dsh-offpeak-job build:
 *   - lib/index.js   Host ESM Cordis plugin
 *   - lib/client.js  Browser CJS with ModuleLoader handshake
 */
import { build } from 'esbuild'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, 'lib'), { recursive: true })
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(join(here, 'dsh.plugin.json'), 'utf8'))
if (pluginManifest.version !== pkg.version) {
  throw new Error(
    `dsh-offpeak-job build: package.json version (${pkg.version}) != dsh.plugin.json version (${pluginManifest.version})`,
  )
}

const clientBanner = {
  js: "window.__ModuleLoader__.load({ id: 'dsh-offpeak-job', factory: (require) => { var module = { exports: {} }; var exports = module.exports;",
}
const clientFooter = { js: 'return module.exports; } });' }

await build({
  entryPoints: [join(here, 'src/index.ts')],
  outfile: 'lib/index.js',
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  external: ['@deepseek-ai/*', 'node:*'],
  define: { __OPJ_VERSION__: JSON.stringify(pkg.version) },
})

await build({
  entryPoints: [join(here, 'src/client/index.tsx')],
  outfile: 'lib/client.js',
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'browser',
  format: 'cjs',
  target: ['es2022'],
  jsx: 'automatic',
  external: [
    '@deepseek-ai/*',
    'react',
    'react-dom',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'scheduler',
  ],
  banner: clientBanner,
  footer: clientFooter,
  define: { __OPJ_VERSION__: JSON.stringify(pkg.version) },
})

await build({
  entryPoints: [join(here, 'src/offpeak.ts')],
  outfile: 'lib/offpeak-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/job-notice.ts')],
  outfile: 'lib/job-notice-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/wait-state.ts')],
  outfile: 'lib/wait-state-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/approval-pending.ts')],
  outfile: 'lib/approval-pending-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/approval.ts')],
  outfile: 'lib/approval-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
  external: ['@deepseek-ai/*', 'node:*'],
})

await build({
  entryPoints: [join(here, 'src/approval-policy.ts')],
  outfile: 'lib/approval-policy-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/overview.ts')],
  outfile: 'lib/overview-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/store.ts')],
  outfile: 'lib/session-store-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

await build({
  entryPoints: [join(here, 'src/provider-store.ts')],
  outfile: 'lib/provider-store-test-entry.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  logLevel: 'silent',
})

console.log('[dsh-offpeak-job build] done: lib/index.js, lib/client.js')

#!/usr/bin/env node
// Prepara Storybook + tokens num projeto React/Vue existente. REDE-ZERO.
// Uso: node init.mjs --target <dir> [--dry-run]
// Detecta framework por package.json; nunca pergunta. Não instala pacotes.
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))          // .../storybook/scripts
const skillDir = resolve(here, '..')                          // .../storybook
const dsProfile = resolve(skillDir, '..', 'design-system', 'profiles', 'shadcn')

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const dry = argv.includes('--dry-run')
const target = resolve(arg('target', process.cwd()))
const pkgPath = join(target, 'package.json')
if (!existsSync(pkgPath)) {
  console.error(`init: sem package.json em ${target}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
// detecção por package.json — nenhuma pergunta ao operador
const framework = deps.next ? 'next' : deps.nuxt ? 'nuxt' : deps.react ? 'react' : deps.vue ? 'vue' : null
if (!framework) {
  console.error('init: framework não detectado (react/vue/next/nuxt) — instale a dependência e tente de novo')
  process.exit(1)
}
const vue = framework === 'vue' || framework === 'nuxt'
const sbFramework = vue ? '@storybook/vue3-vite' : framework === 'next' ? '@storybook/nextjs' : '@storybook/react-vite'
const created = []
const skipped = []

function put(rel, contentFn) {
  const abs = join(target, rel)
  if (existsSync(abs)) { skipped.push(rel); return }
  if (!dry) {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, contentFn())
  }
  created.push(rel)
}
function copyMissing(src, rel) {
  if (!existsSync(src)) return
  const abs = join(target, rel)
  if (existsSync(abs)) { skipped.push(rel); return }
  if (!dry) { mkdirSync(dirname(abs), { recursive: true }); cpSync(src, abs) }
  created.push(rel)
}
function copyTreeMissing(srcDir, relDir) {
  if (!existsSync(srcDir)) return
  for (const name of readdirSync(srcDir)) {
    const from = join(srcDir, name)
    if (statSync(from).isDirectory()) copyTreeMissing(from, join(relDir, name))
    else copyMissing(from, join(relDir, name))
  }
}

// DESIGN.md + tokens: template a adaptar no destino (nunca sobrescreve)
copyMissing(join(dsProfile, 'DESIGN.md'), 'DESIGN.md')
copyTreeMissing(join(dsProfile, 'tokens'), 'tokens')
for (const script of ['build-tokens.mjs', 'validate.mjs']) {
  copyMissing(join(skillDir, 'scripts', script), join('scripts', script))
}
copyMissing(join(skillDir, 'scripts', 'verify.sh'), join('scripts', 'verify.sh'))

const stories = vue ? '../src/**/*.stories.@(ts|tsx|vue)' : '../src/**/*.stories.@(ts|tsx)'
put('.storybook/main.ts', () => `import type { StorybookConfig } from '${sbFramework}'

const config: StorybookConfig = {
  framework: '${sbFramework}',
  stories: ['${stories}', '../src/**/*.mdx'],
  addons: ['@storybook/addon-a11y'],
  features: { componentsManifest: true },
  typescript: { reactDocgen: ${vue ? "false" : "'react-docgen-typescript'"} },
}
export default config
`)
put('.storybook/preview.ts', () => `import type { Preview } from '${sbFramework}'
${vue ? "import '../src/style.css'" : "import '../src/index.css'"}

const preview: Preview = {
  parameters: { controls: { expanded: true }, a11y: { test: 'error' } },
  tags: ['autodocs'],
}
export default preview
`)

const addScripts = {
  'tokens:build': 'node scripts/build-tokens.mjs',
  validate: 'node scripts/validate.mjs',
  verify: 'bash scripts/verify.sh',
  'storybook:build': 'storybook build',
}
const missingScripts = Object.entries(addScripts).filter(([k]) => !pkg.scripts?.[k])
if (missingScripts.length) {
  if (!dry) {
    pkg.scripts = pkg.scripts ?? {}
    for (const [k, v] of missingScripts) pkg.scripts[k] = v
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  }
  created.push('package.json scripts: ' + missingScripts.map(([k]) => k).join(', '))
} else skipped.push('package.json scripts')

const label = dry ? 'PLANO (dry-run)' : 'criados'
console.log(`storybook init → ${relative(process.cwd(), target) || '.'} · framework detectado: ${framework}`)
console.log(`\n${label} (${created.length}):`)
for (const f of created) console.log(`  + ${f}`)
if (skipped.length) {
  console.log(`\npreservados (${skipped.length}):`)
  for (const f of skipped) console.log(`  ~ ${f}`)
}
if (!dry) {
  console.log('\npróximo passo (fora do script, sem rede aqui):')
  console.log(`  npm i -D storybook ${sbFramework} @storybook/addon-a11y`)
}

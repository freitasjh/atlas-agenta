#!/usr/bin/env node
// Gera CSS a partir de tokens DTCG (formato $value/$type + aliases {a.b}). REDE-ZERO.
// Uso: node build-tokens.mjs [--target <dir>] [--profile shadcn|claude] [--dry-run]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const dry = argv.includes('--dry-run')
const target = resolve(arg('target', process.cwd()))
const tokensDir = join(target, 'tokens')

function flatten(obj, prefix = '') {
  const out = new Map()
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'meta' || v === null || typeof v !== 'object') continue
    const path = prefix ? `${prefix}.${k}` : k
    if ('$value' in v) out.set(path, { value: String(v.$value), type: v.$type })
    else for (const [ik, iv] of flatten(v, path)) out.set(ik, iv)
  }
  return out
}
const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
function resolveValue(value, pool, depth = 0) {
  if (depth > 10) throw new Error('alias circular em tokens')
  return value.replace(/\{([^}]+)\}/g, (m, ref) => {
    const hit = pool.get(ref)
    return hit ? resolveValue(hit.value, pool, depth + 1) : m
  })
}
const cssVar = (path) => '--' + path.replace(/\./g, '-')
function emit(pool, selector) {
  let css = `${selector} {\n`
  for (const [path, leaf] of pool) css += `  ${cssVar(path)}: ${resolveValue(leaf.value, pool)};\n`
  return css + '}\n\n'
}

// detecção do perfil sem perguntar
let profile = arg('profile', null)
if (!profile) {
  profile = existsSync(join(tokensDir, 'themes', 'dark.json')) ? 'shadcn'
    : existsSync(join(tokensDir, 'themes', 'claude.json')) ? 'claude' : 'shadcn'
}
if (!['shadcn', 'claude'].includes(profile)) {
  console.error(`build-tokens: perfil inválido ${profile}`)
  process.exit(1)
}
for (const f of ['base.json', 'semantic.json']) {
  if (!existsSync(join(tokensDir, f))) {
    console.error(`build-tokens: faltando tokens/${f} em ${target}`)
    process.exit(1)
  }
}
const base = flatten(load(join(tokensDir, 'base.json')))
const semantic = flatten(load(join(tokensDir, 'semantic.json')))
const root = new Map([...base, ...semantic])
let css = ''

if (profile === 'shadcn') {
  const darkPath = join(tokensDir, 'themes', 'dark.json')
  const dark = existsSync(darkPath) ? flatten(load(darkPath)) : new Map()
  css += emit(root, ':root')
  if (dark.size) css += emit(new Map([...root, ...dark]), '.dark')
  const map = ['background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
    'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
    'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
    'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring']
  css += '@theme inline {\n'
  for (const t of map) css += `  --color-${t}: var(--${t});\n`
  css += '}\n'
} else {
  css += emit(root, ':root')
  const themesDir = join(tokensDir, 'themes')
  if (existsSync(themesDir)) {
    for (const name of ['enterprise', 'liquid']) {
      const p = join(themesDir, `${name}.json`)
      if (existsSync(p)) css += emit(new Map([...root, ...flatten(load(p))]), `[data-theme="${name}"]`)
    }
  }
}

const outRel = profile === 'shadcn' ? 'src/tokens-shadcn.css' : 'src/tokens-generated.css'
const out = join(target, outRel)
if (dry) {
  console.log(`build-tokens: ${profile} → ${outRel} (${css.split('\n').length} linhas) [dry-run, nada escrito]`)
} else {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, css)
  console.log(`build-tokens: ${profile} → ${outRel}`)
}

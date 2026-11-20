#!/usr/bin/env node
// Auditoria estática de UI — SOMENTE LEITURA, REDE-ZERO.
// Uso: node validate.mjs [--target <dir>] [--dry-run]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const target = resolve(arg('target', process.cwd()))
const root = fileURLToPath(new URL('.', import.meta.url))
const dry = argv.includes('--dry-run')
const rel = (p) => relative(target, p)
let fails = 0
const flag = (kind, msg) => { if (kind === 'FAIL') fails++; console.log(`${kind} ${msg}`) }
if (dry) console.log(`validate: plano (dry-run) — auditoria somente leitura em ${target}`)

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) { if (e !== 'node_modules') walk(p, out) }
    else out.push(p)
  }
  return out
}
const srcFiles = walk(join(target, 'src')).filter((p) => /\.(ts|tsx|vue|css|scss)$/.test(p))

// 1. arquivos mínimos
for (const f of ['DESIGN.md', 'tokens/base.json', 'tokens/semantic.json', '.storybook/main.ts']) {
  if (!existsSync(join(target, f))) flag('FAIL', `ausente: ${f}`)
}

// 2. zero hex cru em componente (tokens/ e CSS gerado são fontes legítimas)
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
for (const p of srcFiles) {
  if (/tokens[-.]/.test(p) || /generated/.test(p)) continue
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (HEX.test(line)) flag('FAIL', `hex cru em componente: ${rel(p)}:${i + 1}`)
  })
}

// 3. matriz de estados nas stories (DESIGN-08 — 9 estados, incluindo `active`)
// Presença provada por ÂNCORA DE EXPORT: um comentário que menciona o estado
// não é story. `text.includes(s)` aceitava `// active` como cobertura.
const STATES = ['default', 'active', 'hover', 'focus', 'disabled', 'loading', 'error', 'empty', 'success']
const exportAnchor = (state) => new RegExp(`^[ \\t]*export\\s+const\\s+\\w*${state}\\w*`, 'im')
const stories = srcFiles.filter((p) => /\.stories\./.test(p))
if (!stories.length) {
  flag('WARN', 'nenhuma story encontrada — escreva as stories de estado antes da página')
} else {
  for (const p of stories) {
    const text = readFileSync(p, 'utf8')
    const missing = STATES.filter((s) => !exportAnchor(s).test(text))
    if (missing.length) flag('FAIL', `estados ausentes em ${rel(p)}: ${missing.join(', ')}`)
  }
}

// 4. i18n — literal visível em JSX/template fora de t()/$t()
let literals = 0
for (const p of srcFiles.filter((p) => /\.(tsx|vue)$/.test(p))) {
  readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
    if (/\bt\(|\$t\(|t\(/.test(line)) return
    if (/>[\p{L}][^<>{}]{2,}</u.test(line)) { literals++; if (literals <= 10) flag('WARN', `literal visível: ${rel(p)}:${i + 1}`) }
  })
}
if (literals > 10) flag('WARN', `... e mais ${literals - 10} literais visíveis`)

// 5. foco visível
const focusOk = srcFiles.some((p) => /focus-visible|:focus-visible/.test(readFileSync(p, 'utf8')))
if (!focusOk) flag('WARN', 'nenhum seletor focus-visible encontrado em src/')

if (!dry) console.log(fails ? `validate: FALHOU (${fails} achado(s) bloqueante(s))` : 'validate: OK')
else console.log(`validate: dry-run concluído (${fails} bloqueante(s))`)
if (fails) process.exitCode = 1

---
name: storybook
description: Storybook-first para UI — story por estado antes da página, build estático, screenshot review, interaction tests, adapters React/Vue. Ferramentas de browser são auxiliares, não gate.
license: MIT
---

# Storybook — story por estado antes da página

## 0. Regra de ouro

> Sem story, sem merge de componente novo. Escreva as stories **antes** da página que consome o componente.
> Story não é vitrine decorativa: é o contrato observável dos estados.

Fonte visual: `DESIGN.md` + tokens do destino (skill `design-system`). Nenhuma cor/fonte
hardcoded na story — use os tokens/classes gerados.

## 1. Matriz de estados obrigatória

Todo componente interativo cobre:

`default` · `active` · `hover` · `focus` · `disabled` · `loading` · `error` · `empty` · `success`

- Cada estado = uma story nomeada. Estados assíncronos usam `loaders`/`msw` ou mocks locais.
- `play function` para interaction tests: clicar, preencher, verificar aria e transição de estado.
- `parameters.a11y.test = 'error'` no preview; axe integrado no addon de acessibilidade.
- `tags: ['autodocs']` para documentação gerada a partir do contrato de props.

## 2. Adapters (detectados, nunca perguntados)

| Projeto | framework Storybook | extensão de story |
|---|---|---|
| React + Vite | `@storybook/react-vite` | `*.stories.tsx` |
| Next.js | `@storybook/nextjs` | `*.stories.tsx` |
| Vue 3 + Vite | `@storybook/vue3-vite` | `*.stories.ts` / `*.vue` |
| Nuxt | `@storybook/vue3-vite` | `*.stories.ts` |

`scripts/init.mjs` lê `package.json`, detecta o framework, copia `DESIGN.md` + tokens do
skill `design-system`, escreve `.storybook/main.ts`/`preview.ts` e adiciona scripts.
Respeita arquivos existentes (nunca sobrescreve). `--dry-run` mostra o plano; nada é escrito.
Instalação de pacotes fica ao operador (os scripts são rede-zero).

## 3. Scripts portados (`scripts/`)

- `init.mjs` — prepara projeto React/Vue; `--target`, `--dry-run`.
- `build-tokens.mjs` — DTCG (`$value`/`$type`, aliases) → CSS; detecta perfil por `tokens/themes/*`;
  `--target`, `--profile`, `--dry-run`.
- `validate.mjs` — auditoria **somente leitura**: arquivos mínimos, zero hex cru em componente,
  cobertura de estados nas stories, literal visível fora de i18n, presença de `focus-visible`.
  Reporta `arquivo:linha`; `--target`, `--dry-run`.
- `verify.sh` — gate local: tokens → validate → (testes/tipos/build se existirem no `package.json`).

## 4. Build estático e revisão visual

```sh
npm run storybook:build     # saída padrão: storybook-static/
node scripts/validate.mjs --target <dir>
```

Revisão de screenshot: abrir o build estático (ou o servidor local) com a ferramenta de browser
disponível — `browser` ou `chrome-devtools` (quando o MCP estiver registrado). Coletar:
snapshot, console sem `[ERROR]`/`[WARN]`, network sem 4xx/5xx, screenshot 1280×800 e 375×800.

> Ferramenta, não gate: ausência de MCP de browser **não** bloqueia o build. Registre como
> "revisão visual indisponível" e siga com validate + build estático.

## 5. Entregável por componente

- [ ] stories dos 9 estados (default/active/hover/focus/disabled/loading/error/empty/success), cada um com `export const <Estado>` — comentário não conta
- [ ] interaction test via `play` quando houver transição
- [ ] a11y sem erro; foco visível; alvo ≥44px no mobile
- [ ] tokens semânticos do destino (zero hex no componente)
- [ ] `validate.mjs` sem `FAIL` e `storybook:build` verde
- [ ] screenshot revisado quando houver browser disponível

## Referências

- Storybook frameworks/config — https://storybook.js.org/docs/get-started/frameworks/react-vite (consultado 2026-11-18)
- Interaction tests — https://storybook.js.org/docs/writing-tests/interaction-testing (consultado 2026-11-18)
- Implementação de referência: repo irmão `harness-frontend/scripts/{init,build-tokens,validate}.mjs`.

---
name: frontend-quality
description: Checklist de aceite de UI — zero hex em componente, tokens semânticos, estados completos, i18n sem literal, foco visível/alvo 44px, 375px e 1280px, anti-slop.
license: MIT
---

# Frontend Quality — checklist de entrega

Aplicar a **toda** mudança de UI antes de declarar pronta. Cada item não atendido
é achado com `arquivo:linha`; nada aqui inventa identidade visual (ver `design-system`).

## 1. Tokens

- [ ] Zero hex/rgb/hsl cru em componente (`.tsx`, `.ts`, `.vue`, `.css` de `src/`).
      Valores crus só em `tokens/*.json` do destino e no CSS gerado.
- [ ] Todo estilo vem de token semântico (`--background`, `--primary`, `--ring`, `--radius-*`…).
- [ ] Nenhum token novo criado sem `DESIGN.md` do destino atualizado e aprovação do
      `design-system-specialist`.
- [ ] CSS gerado por `build-tokens.mjs` está commitado e importado na entrada global.

## 2. Estados

- [ ] Componente interativo cobre os 9 estados canônicos: default, active, hover, focus, disabled, loading, error, empty, success (cada um com `export const` na story).
- [ ] Cada estado tem story (skill `storybook`) escrita antes da página consumidora.
- [ ] Tela de lista: filtro + tabela + loading/empty/error. Form: validação + erro inline.

## 3. i18n

- [ ] Nenhum literal visível em template/JSX/placeholder/aria-label/tooltip.
- [ ] Chaves prefixadas por módulo, resolvidas em `pt-BR` (default) e `en-US`.

## 4. Acessibilidade — WCAG 2.1 AA

- [ ] Foco visível em todo interativo (`:focus-visible`, sem `outline: none` sem substituto).
- [ ] Alvo de toque ≥44px no mobile; navegação por teclado completa; sem armadilha de foco.
- [ ] Contraste 4.5:1 texto / 3:1 UI; aria-labels quando não há texto visível.
- [ ] `aria-busy` no loading, `aria-invalid` no erro, `aria-disabled` no disabled.
- [ ] `prefers-reduced-motion` respeitado.

## 5. Responsivo

- [ ] Verificado em **375px** e **1280px**: sem overflow horizontal, sem conteúdo cortado,
      hierarquia preservada, navegação utilizável nos dois tamanhos.

## 6. Anti-slop (rejeitar)

- [ ] Sem grid simétrica genérica de 3 colunas usada como default.
- [ ] Sem gradiente roxo/azul néon, sem sombra escura densa, sem branco cru estéril como piso.
- [ ] Sem "cara de gerado por IA": espaçamento, tipo e cor deliberados e vindos do token ativo.
- [ ] Sem ícone fora do conjunto do eixo (`lucide-react` / `lucide-vue-next`).

## 7. Stack canônica (uma fonte)

- [ ] `http` de `@/lib/axios`; nunca axios instanciado no componente, nunca `fetch` cru.
- [ ] UI via shadcn do eixo; estado via Pinia (Vue) / Zustand ou Redux (React).
- [ ] Vue: `<script setup lang="ts">`. React: function components + hooks.
- [ ] Tests Vitest + happy-dom com ≥70% de cobertura no código novo.

## 8. Como auditar

```sh
node scripts/validate.mjs --target <destino>   # somente leitura, reporta arquivo:linha
bash scripts/verify.sh                          # tokens → validate → testes/tipos/build
```

Revisão visual com `browser`/`chrome-devtools` quando disponível: snapshot, console sem
`[ERROR]`/`[WARN]`, network sem 4xx/5xx, screenshots 375px e 1280px. Ferramenta auxiliar,
não gate — ausência de MCP é declarada, não silenciada.

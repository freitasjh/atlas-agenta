---
name: design-system
description: Contrato de design system — tokens → primitivos → blocos → telas, matriz de estados, composição, a11y WCAG 2.1 AA e anti-slop. Nenhum token inventado: lê DESIGN.md/tokens do destino.
license: MIT
---

# Design System — do token à tela

Skill de contrato para construir componentes reutilizáveis **sem inventar identidade visual**.
A fonte visual é sempre o `DESIGN.md` + `tokens/**` do **projeto de destino**.

## 0. Regra de ouro

> Nenhum hex, fonte, raio, sombra ou paleta nesta skill. Nenhum token criado por palpite.
> Se o destino não tem token para uma necessidade: pare, proponha ao `ux-designer`/
> `design-system-specialist`, registre como pendência — nunca escreva o valor cru no componente.

Antes de qualquer componente: leia `DESIGN.md`, `tokens/*.json` e os componentes existentes
do destino. `templates/DESIGN.md` e `profiles/*/` aqui são **templates a copiar/adaptar**,
não prescrição de marca.

## 1. Pipeline (ordem obrigatória)

1. **Tokens** — DTCG: `$value` + `$type`; aliases `{grupo.token}`; primitivos separados
   de semânticos; temas como overrides. Fonte: `tokens/*.json`.
2. **Primitivos** — Button, Input, Label, Badge, Card: consomem **somente tokens semânticos**.
3. **Blocos** — composições de primitivos (toolbar, form-group, data-table, nav).
4. **Telas** — páginas montadas por blocos. Nunca pule nível: tela não colore direto.

Gerar CSS com `scripts/build-tokens.mjs` (ver skill `storybook`), commitar o CSS gerado
e importá-lo na entrada global. Ver `templates/DESIGN.md` para o contrato completo.

## 2. Matriz de estados — contrato, não opcional

| default | hover | focus | active | disabled | loading | error | empty | success |
|---|---|---|---|---|---|---|---|---|

- focus: ring visível vindo de `--ring`, contraste ≥3:1.
- disabled: `aria-disabled`, sem ponteiro, contraste reduzido.
- loading: `aria-busy` + skeleton/spinner.
- error: `--destructive`, mensagem textual, `aria-invalid`.
- empty: placeholder + CTA. success: confirmação observável.

Cada estado tem **uma story antes da página** (skill `storybook`).

## 3. Composição

- Variantes nomeadas (`variant`, `size`) > booleanas combinatórias; CVA ou equivalente.
- Compound components para estruturas complexas (Card → Header/Body/Footer).
- Regras de aninhamento documentadas (ex.: botão dentro de botão, proibido).
- Evitar prop drilling profundo; context/provider quando necessário.
- Contrato de props/slots/events: ver skill `template-structure`.

## 4. Acessibilidade — WCAG 2.1 AA

- Contraste 4.5:1 texto, 3:1 UI; foco visível em todo interativo; navegação por teclado
  completa; sem armadilha de foco; focus trap + retorno em modal.
- Semântica nativa primeiro; ARIA só quando necessário; live regions para updates.
- Alvo de toque ≥44px no mobile; `prefers-reduced-motion` respeitado.
- Ver skill `frontend-quality` para checklist de entrega.

## 5. Anti-slop

Sem grid simétrica genérica de 3 colunas; sem gradiente roxo/azul néon; sem sombra
escura densa; sem branco cru estéril como piso; vidro só em chrome com fallback sólido;
sem "visual gerado por IA". Espaçamento, tipo e cor vêm dos tokens ativos.

## 6. Entregável

- `DESIGN.md` do destino atualizado (se o contrato mudou) com o destino do novo token;
- primitivo/bloco com contrato de props/slots/estados/variantes;
- stories dos 9 estados;
- auditoria: `node scripts/validate.mjs --target <destino>` + `frontend-quality`.

## Referências

- DTCG Design Tokens Format Module 2025.10 — https://www.designtokens.org/TR/2025.10/format/ (consultado 2026-11-18)
- Storybook CSF/frameworks — https://storybook.js.org/docs/get-started/frameworks/react-vite (consultado 2026-11-18)
- Implementação de referência: repo irmão `harness-frontend` (`DESIGN.md`, `profiles/*/tokens/**`).

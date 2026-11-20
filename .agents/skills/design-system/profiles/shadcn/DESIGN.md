# DESIGN.md — perfil shadcn (template a adaptar no destino)

> **Template.** Copie para `<destino>/DESIGN.md` e substitua pelos tokens reais do projeto.
> Os valores em `tokens/**` são ponto de partida ilustrativo, não identidade de marca.
> Fonte de verdade no destino: `tokens/*.json` (DTCG) + este arquivo já adaptado.

## Princípio

- Padrão shadcn (estilo `new-york`, base Radix via `radix-ui`). Componentes usam
  **apenas tokens semânticos**: `--background`, `--foreground`, `--card`,
  `--primary(-foreground)`, `--secondary`, `--muted`, `--accent`, `--destructive`,
  `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar-*`.
- Gerar CSS com `scripts/build-tokens.mjs` → `src/tokens-shadcn.css`
  (`:root` claro + `.dark` escuro + `@theme inline`).
- Modo escuro via classe `.dark` no `html`.

## Tokens

- Primitivos em `tokens/base.json`; semânticos em `tokens/semantic.json`;
  overrides escuros em `tokens/themes/dark.json`.
- Raio: `--radius` base + derivada `calc(var(--radius) * k)` (sm ×0.6, md ×0.8,
  lg ×1, xl ×1.4). O mapeamento de raio **nunca** vira utility — sobrescreveria
  a escala do tema ativo.

## Componentes

- `src/components/shadcn` (registry, cva + `cn`).
- Blocos oficiais entram pelo CLI (`add --dry-run` + `--diff`); não editar
  primitivas como se fossem design system próprio.
- Normalizar import emitido `from "cn"` → `from "@/lib/cn"` após cada `add`.

## Anti-slop / estados / a11y

Ver `templates/DESIGN.md` (matriz de estados + anti-slop). Todo componente interativo
cobre default, hover, focus, disabled, loading, error, empty, success; alvo ≥44px no
mobile; foco visível; contraste WCAG 2.1 AA.

## Gate

Após edição em `src/`: `bash scripts/verify.sh` (tokens → lint → tipos → testes → build).
Revisão visual: Storybook + `browser`/`chrome-devtools` quando disponível (ferramenta, não gate).

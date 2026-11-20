# DESIGN.md — perfil editorial (template a adaptar no destino)

> **Template.** Copie para `<destino>/DESIGN.md` e substitua pelos tokens reais do projeto.
> Os valores em `tokens/**` são ponto de partida ilustrativo, não identidade de marca.
> Fonte de verdade no destino: `tokens/*.json` (DTCG) + este arquivo já adaptado.

## Princípio

- Tema editorial humanista como default (`data-theme="claude"`), não sistema único.
- Componentes usam **somente tokens semânticos**: `--bg-page`, `--bg-soft`,
  `--bg-card`, `--ink-primary`, `--ink-body`, `--ink-muted`, `--action-primary`,
  `--action-primary-active`, `--border-hairline`, `--font-display`, `--font-body`,
  `--font-code`. Hex cru só em `tokens/`.
- Gerar CSS com `scripts/build-tokens.mjs` → `src/tokens-generated.css`;
  `src/index.css` consome vars, nunca hardcoded tema.

## Temas

| Tema | Uso | Piso / Ação |
|---|---|---|
| `claude` (default) | editorial humanista | creme / coral, serif display |
| `enterprise` | dashboards densos | superfície fria, azul, hierarquia por cor |
| `liquid` | superfícies escuras | realce translúcido, vidro só em chrome |

Troca por `data-theme="claude|enterprise|liquid"`. Valores reais em
`tokens/themes/*.json` — não replicar hex neste arquivo.

## Componentes

- `src/components/ui` (custom).
- Tipografia: display serif regular com tracking negativo; UI humanista; code monoespaçada.
- Composição: bento assimétrico editorial, ritmo alternado de superfícies.
- Elevação: 1 token de cor + 1 token de sombra.

## Anti-slop / estados / a11y

Ver `templates/DESIGN.md` (matriz de estados + anti-slop). Todo componente interativo
cobre default, hover, focus, disabled, loading, error, empty, success; alvo ≥44px no
mobile; foco visível; contraste WCAG 2.1 AA.

## Gate

Após edição em `src/`: `bash scripts/verify.sh` (tokens → lint → tipos → testes → build).
Revisão visual: Storybook + `browser`/`chrome-devtools` quando disponível (ferramenta, não gate).

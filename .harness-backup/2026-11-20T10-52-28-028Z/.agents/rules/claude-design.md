# DESIGN.md — Perfil Claude (Editorial)

> Contrato mandatório do projeto. Perfil ativo: **claude**.
> Gerado pelo Harness de Frontend. Fonte de verdade: `tokens/*.json` (DTCG).

## Princípio

- Claude Editorial é o tema default (`data-theme="claude"`), não sistema único.
- Componentes usam **apenas tokens semânticos** (`bg-canvas`, `text-ink`, `bg-brand-coral`, `border-hairline`).
- Hex cru só em `tokens/`. Gerar CSS via `npm run tokens:build` → `src/tokens-generated.css`.
- `src/index.css` consome vars, nunca hardcodes tema.

## Temas (claude)

| Tema | Uso | Piso / Ação |
|---|---|---|
| `claude` (default) | Editorial humanista | `#FAF9F5` / coral `#CC785C`, serif display |
| `enterprise` | Dashboards densos, estilo Carbon/Polaris | `#F8FAFC` / azul `#1D4ED8`, hierarquia por cor |
| `liquid` | Superfícies escuras, estilo Apple Liquid Glass | `#050505` / realce translúcido, vidro só em chrome |

Troca de tema via `data-theme="claude|enterprise|liquid"`.

## Tokens (perfil claude)

- Semânticos: `--bg-page`, `--bg-soft`, `--bg-card`, `--bg-dark`, `--bg-dark-elevated`,
  `--ink-primary`, `--ink-body`, `--ink-muted`, `--action-primary`, `--action-primary-active`,
  `--border-hairline`, `--font-display`, `--font-body`, `--font-code`.
- Raio fixo: `sm 8 / md 16 / lg 24 / xl 32`.
- Modos: `data-theme` (claude/enterprise/liquid).

## Componentes

- `src/components/claude/ui` (primitivas custom).
- `src/components/claude/navigation` (navegação e shell editorial: sidebar, topbar, footer, notification-center).
- Tipografia: display serif regular 400 tracking negativo; UI humanista; code JetBrains Mono.
- Composição: bento assimétrico editorial, ritmo alternado de superfícies, duplo bisel obrigatório.

## Anti-slop (obrigatório)

- Sem grelhas simétricas genéricas de 3 colunas.
- Sem gradientes roxos/azuis néon, sombras escuras densas, branco cru estéril como piso.
- Vidro só em chrome (nav, toolbar) com fallback sólido; conteúdo em superfície sólida.
- Touch target ≥44px mobile; respeitar `prefers-reduced-motion`.
- Elevação: 1 token cor + 1 token sombra.

## Gate

Após edição em `src/`: `bash scripts/verify.sh` (tokens → oxlint → tsc → tests → build).
Storybook MCP: `http://127.0.0.1:6006/mcp`. Nunca alucinar props.


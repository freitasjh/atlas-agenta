# Upgrade React 18 → 19 — Implementação

Branch: `chore/react-19` · Data: 2026-11-22 · Escopo: toda a app (`package.json`, `package-lock.json`).

## Versões antes/depois

| Pacote | Antes | Depois | Seção |
|---|---|---|---|
| `react` | 18.3.1 | 19.3.1 | dependencies |
| `react-dom` | 18.3.1 | 19.3.1 | dependencies |
| `@types/react` | 18.3.12 | 19.3.0 | devDependencies |
| `@types/react-dom` | 18.3.1 | 19.3.0 | devDependencies |
| `@testing-library/react` | 15.0.7 | 16.3.3 | devDependencies |
| `@testing-library/dom` | (transitivo 10.4.2) | 10.4.2 explícito | devDependencies |

Versões exatas mantidas (`--save-exact`), conforme estilo do projeto. Comandos:

```bash
npm install --save-exact react@19 react-dom@19
npm install --save-dev --save-exact @types/react@19 @types/react-dom@19 \
  @testing-library/react@16 @testing-library/dom@10
npm install
```

`npm ls react react-dom @types/react @types/react-dom`: árvore única e deduped — nenhuma ocorrência de 18.x. `package-lock.json` contém apenas `react@19.3.1`, `react-dom@19.3.1`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`.

Nenhuma dependência nova de primeiro nível além das listadas. O `npm install` também refrescou transitivas dentro das faixas já permitidas pelo lock: `@tanstack/react-store` 0.11.2 → 0.11.4 (hoisted), `@tanstack/store` 0.11.2 → 0.11.3; remoção de `@types/prop-types` e `loose-envify` (não mais usados por React 19 / tipos 19). Nenhuma versão de pacote de primeiro nível foi alterada fora da tabela acima.

## Libs ajustadas e razão

- **`@testing-library/react` 15.0.7 → 16.3.3**: peer `react: ^18.0.0` / `@types/react: ^18.0.0` (verificado em `package-lock.json`) conflita com React 19; v16 declara peer `react: ^18 || ^19` e `v16.1.0` adiciona suporte explícito a React 19.
- **`@testing-library/dom` 10.4.2 → devDep explícita**: a partir de v16 do RTL, `@testing-library/dom` virou peer dependency e precisa ser instalada explicitamente. Versão 10.4.2 já estava no lock (transitiva), sem alteração de versão.

Compatibilidade conferida via `peerDependencies` do lock — **nenhum bump necessário**: `react-router-dom@6.28.0` (`react >=16.8`), `@tanstack/react-query@5.59.20` (`^18 || ^19`), `recharts@3.10.1` (`^16.8||^17||^18||^19`), `sonner@1.7.0` (`^19`), `@storybook/react@10.6.8` (`^19`), `react-hook-form@7.53.2`, `next-themes@0.4.6`, `vaul@1.1.2`, `@dnd-kit/*`, `@tanstack/react-table@9.3.1`.

## Quebras corrigidas

**Nenhuma mudança de código-fonte foi necessária.** Auditoria prévia:

- APIs removidas no React 19 (`ReactDOM.render`, `hydrate`, `unmountComponentAtNode`, `findDOMNode`, string refs, `propTypes`, `defaultProps` em funções, legacy context, `createFactory`): nenhum uso em `src/`. Bootstrap já usa `createRoot` em `src/main.tsx:13`.
- `@types/react` 19: nenhum uso de `useRef()` sem argumento, namespace `JSX` global, tipos removidos (`ReactChild`, `ReactFragment`, `VFC`, etc.) ou `ReactElement["props"]` sem type argument. Único ponto tocado indiretamente: `MutableRefObject` em `src/app/agenda/AppointmentDrawer.tsx:188` — tipo apenas **deprecado** (ainda exportado), sem erro; mantido para evitar refatoração fora do escopo.
- `npm run typecheck` e `npm run build` passaram sem diagnósticos novos; nenhum arquivo `.ts/.tsx` alterado.

Efeito colateral positivo observado: as 3 mensagens `Function components cannot be given refs` presentes no console do baseline React 18 (Radix `Slot` → `Button` em popover/dropdown/kanban da landing) desapareceram no React 19 — compatível com `ref` como prop (React 19). Nenhuma ação de código tomada.

## Validação

### H1/H2 — comandos (baseline antes do bump: 240 arquivos / 1717 testes, 0 falhas)

| Comando | Resultado |
|---|---|
| `npm run typecheck` | exit 0, 0 erros |
| `npm run build` | exit 0, `✓ built in 13.14s` (apenas aviso pré-existente de chunk >500 kB) |
| `npm test` | exit 0 — **240 arquivos / 1717 testes passaram** (idêntico ao baseline) |

Arquivos de teste ou fontes não foram modificados; contagem preservada.

### H3/H4 — browser (chrome-devtools)

Servidor isolado `npx vite --port 5180 --strictPort --host 127.0.0.1`; servidor pré-existente na :5174 (PID 1195152, iniciado em 20/11) **não foi alterado nem encerrado** e serviu de baseline React 18.3.1 (confirmado via conteúdo do chunk Vite `react.js?v=07e805f1`).

- `/` (landing): renderiza íntegra; snapshot completo idêntico ao baseline (mesmos headings, KPIs, abas, FAQ, rodapé).
- `/login`: formulário renderiza; 0 mensagens de console error/warn.
- `/app`: redireciona para `/login` — guard preservado.
- `/termos`: renderiza; 0 erros.
- Console na raiz: apenas 2 entradas esperadas de infra local — `POST http://127.0.0.1:54321/auth/v1/token?grant_type=refresh_token [400]` e `AuthApiError: Invalid Refresh Token` (Supabase local não está rodando; mesma condição do baseline). Nenhum erro React 19.
- Network: todos os módulos locais 200; único 4xx é o refresh Supabase acima.

Screenshots (1440×900, `screenshots/`): `react18-baseline.png`, `react19-dark.png`, `react19-light-toggled.png`. Diff pixel a pixel:

| Comparação | Resultado |
|---|---|
| React 18 dark vs React 19 dark | bbox `(558,139)-(566,147)` — 52 px, **somente o ponto animado do badge "Novidade"**, delta máx. 24 |
| React 18 dark vs React 19 light (após toggle) | divergência esperada da troca de tema: ~1,295 M px (delta máx. por canal > 8; medição sobre as 3 PNGs commitadas), bbox full-page, delta máx. 240 — **não é regressão do upgrade**; baseline light do React 18 não foi capturado nesta rodada |

Ou seja: visual idêntico no dark fora da animação esperada; a comparação dark↔light não é paridade de upgrade (temas diferentes).

### H5

Porta :5180 encerrada via `lsof -ti :5180` → conferência do dono → `kill <PID>`. Abas abertas no chrome-devtools fechadas; aba pré-existente restaurada para `about:blank`. Nenhum `pkill -f`.

## Fontes consultadas (deepsearch)

Todas consultadas em **2026-11-22** via `websearch`:

- React 19 Upgrade Guide — APIs removidas, mudanças em `@types/react`, JSX namespace, `useRef` — https://react.dev/blog/2024/04/25/react-19-upgrade-guide (publicado 2024-04-25).
- React 19 release notes (`ref` como prop) — https://react.dev/blog/2024/12/05/react-19 (publicado 2024-12-05).
- `@testing-library/react` v16.1.0 — "Add support for React 19" — https://github.com/testing-library/react-testing-library/releases/tag/v16.1.0 (publicado 2024-12-05).
- `@testing-library/react` v16.0.0 — `@testing-library/dom` movido para peer dependency — https://github.com/testing-library/react-testing-library/releases/tag/v16.0.0 (publicado 2024-06-03).
- DefinitelyTyped PR #69022 — tipos React 19, codemods, `MutableRefObject` deprecado — https://github.com/DefinitelyTyped/DefinitelyTyped/pull/69022 (2024-12-05).

Peer dependencies locais extraídas de `package-lock.json` (fonte primária do repositório).

## Pendências para o orquestrador

- `code-reviewer` (H6): revisão do diff `package.json` + `package-lock.json` + este documento.
- `workflow-state.json`: registrar `code_review_status` / `harness_status` conforme o fluxo do harness — fora do escopo deste subagente.

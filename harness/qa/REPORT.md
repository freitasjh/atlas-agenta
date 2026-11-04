# QA visual e fechamento — ADR-14 (re-execução após D1/D2/D3/D5/D6)

- Data: 2026-11-01
- Repositório: `/home/joao/fusionlf/wsProjeto/atlas-agenda`
- Branch: `adr/password-rbac/14-qa-visual-e-fechamento` (HEAD `e17164d` + correções **não commitadas** na árvore de trabalho)
- Fonte: `.agents/tasks/dev-pipeline/adr/adr-14-qa-visual-e-fechamento.md` e PRD §8
- Artefatos: `harness/qa/` (`REPORT.md`, `screenshots/`, `<cenário>.json`, `d1-signup-<cenário>.json`,
  `trace-<cenário>.json`, `build-preview.json`, `tools/`)

> **Nota de escopo de escrita (gate).** O gate nega escrita do `qa-engineer` fora de `harness/`
> (`qa-scope-violation`, `gate.js` `isHarnessScoped` + `checkWriteAccess`). Por isso os artefatos
> desta re-execução vivem em `harness/qa/`; espelhar para `.agents/tasks/dev-pipeline/qa/` exige um
> papel com escrita liberada (o diretório é git-ignored). `harness.config.json` → `evidence.path` é
> `harness/`, portanto a evidência está no caminho declarado.

## 1. Ambiente e pré-condições

| Item | Valor |
|---|---|
| Supabase CLI | 2.121.0 (stack local Docker) |
| Node / Vite | v26.7.0 / 5.4.11 |
| Banco | `supabase db reset` por cenário — 54 migrations, zero erro (`no files matched pattern: supabase/seed.sql`) |
| Bootstrap | `bootstrap-super-admin` 201 `criado` (`ATLAS_ENV=local` + `BOOTSTRAP_SECRET` em env file 0600 fora do repo, removido no fim) |
| Edge Functions | `supabase functions serve --env-file <tmp>/functions.env` (todas as funções) |
| Frontend dev | `npm run dev` em `127.0.0.1:5174` (5173 segue do projeto `atlas-ecm`, não tocado) |
| Build de produção | `npm run build` + `vite preview` em `127.0.0.1:5175` |
| Admin de tenant | criado **pela UI** (`/cadastro`) em cada cenário — sem atalho por Edge Function |

## 2. Desvios de execução (declarados, não são defeitos)

1. **MCP `chrome-devtools` indisponível.** Mesmo bloqueio da primeira execução: o perfil
   compartilhado `~/.cache/chrome-devtools-mcp/chrome-profile` está em uso por outro projeto
   (`The browser is already running for ...`). Para não derrubar sessão alheia, a verificação usou
   **Chrome headless próprio por CDP** (`tools/cdp.mjs`), com recursos equivalentes:
   `Emulation.setDeviceMetricsOverride` (390×844 / 1280×800 + touch), tema por `localStorage` +
   classe `dark`, `Page.captureScreenshot`, `Runtime.consoleAPICalled` + `Log.entryAdded`,
   `Network.*`, `Tracing.*`, `Fetch.*` (401 e falha de rede determinísticas) e `Input.*` (Tab/Enter
   reais; no cadastro, ponteiro real para o Select do Radix).
2. **Item 7 (401).** Injetado na resposta (`Fetch.fulfillRequest`), não expirando a sessão real —
   expirar a sessão derruba o `RequireAuth` antes do formulário e testaria outro caminho.
3. **Item 8 (rede desligada).** `Fetch.failRequest` com `InternetDisconnected` — equivalente ao
   modo offline do DevTools.
4. **Instrumentação de console.** Além do coletor por item, um segundo observador acumulou console
   e log de todo o cenário (`consoleAll`), porque `resetConsole` entre itens esconderia aviso de
   carga inicial. Os `logErrors` de 3 entradas por cenário vêm dos testes negativos deliberados:
   401 injetado (item 7), `ERR_INTERNET_DISCONNECTED` (item 8) e 400 do login com senha antiga
   (item 11). Zero erro/aviso em carga e navegação normais.

## 3. Matriz dos 12 itens × 4 cenários

Cenários: **A** = 390×844 claro · **B** = 390×844 escuro · **C** = 1280×800 claro ·
**D** = 1280×800 escuro. Cada cenário rodou com reset + bootstrap + cadastro pela UI + roteiro
completo (12 itens + cold start).

| # | Item do PRD §8 | A | B | C | D | Evidência |
|---|---|---|---|---|---|---|
| 1 | Sem sessão, `/app/agenda` e `/admin/empresas` → `/login` | ✅ | ✅ | ✅ | ✅ | ambos `/login`; 0 falha de rede (favicon 200) |
| 2 | Login de `admin@neox.com.br` com a senha inicial cai em `/trocar-senha`, título "Crie sua nova senha", sem conteúdo de `/admin/empresas` | ✅ | ✅ | ✅ | ✅ | `title:true`, `badge:"Primeiro acesso"`, `adminContent:false` |
| 3 | Acesso direto a `/admin/empresas` e `/app/agenda` mantém `/trocar-senha` | ✅ | ✅ | ✅ | ✅ | `directAdmin`/`directApp` = `/trocar-senha` |
| 4 | Senha de 7 caracteres: erro no campo, `aria-invalid="true"`, foco no campo | ✅ | ✅ | ✅ | ✅ | `ariaInvalid:["true","false"]`, "A senha deve ter ao menos 8 caracteres.", `activeIsFirstPassword:true` |
| 5 | Senhas diferentes: "As senhas não coincidem." | ✅ | ✅ | ✅ | ✅ | mensagem no `FormMessage` do campo 2 |
| 6 | Dois cliques rápidos → **uma** requisição; botão `disabled` durante a chamada | ✅ | ✅ | ✅ | ✅ | 1 POST, `buttonDisabled:true`, "Salvando…", `role=status` |
| 7 | 401 → "Sua sessão expirou. Entre novamente." + link `/login` | ✅ | ✅ | ✅ | ✅ | POST `401`; alerta com link `href="/login"` |
| 8 | Rede desligada → texto genérico e botão reativado | ✅ | ✅ | ✅ | ✅ | "Não foi possível salvar a nova senha. Tente novamente." + `disabled:false` |
| 9 | Após 200 navega para `/admin/empresas` com sessão nova; voltar a `/trocar-senha` redireciona | ✅ | ✅ | ✅ | ✅ | `afterSave:/admin/empresas`, `revisit:/admin/empresas`; sessão de `POST /auth/v1/token?grant_type=password` 200 |
| 10 | `/admin` → `/admin/empresas` | ✅ | ✅ | ✅ | ✅ | `path:/admin/empresas` |
| 11 | Sair; senha inicial recusada; senha nova entra em `/admin/empresas` | ✅ | ✅ | ✅ | ✅ | "E-mail ou senha incorretos." e `/admin/empresas` na nova |
| 12 | Admin de empresa (criado pela UI) entra em `/app` sem passar por `/trocar-senha` | ✅ | ✅ | ✅ | ✅ | `path:/app`, claims `admin`, sem título de troca |
| — | Cold start de `/app/agenda` < 1,5 s e zero `/rest/v1/profiles` | ✅ | ✅ | ✅ | ✅ | LCP 240–256 ms, 0 requisição de profiles |

**Resultado: 48 de 48 verificações dos 12 itens passam** (12 × 4 cenários) **e 4 de 4 cold starts**
ficam abaixo de 1,5 s com zero `/rest/v1/profiles`. Nenhum item falha em nenhum cenário — os
defeitos D1, D2, D3, D5 e D6 da primeira execução estão fechados.

Screenshots do roteiro (8 por cenário, 32 no total): `<cenário>-0{1..8}-*.png`
(login, troca de senha, erro de senha curta, sessão expirada, rede offline, `/admin/empresas`,
`/app`, `/app/agenda`).

## 4. D1 — cadastro pela UI (fechado)

Rota `/cadastro` preenchida por ponteiro/teclado reais (nome, ramo via Select Radix, e-mail, senha,
confirmação), enviada por clique em "Criar conta". Em **4 de 4** cenários:

| Cenário | Destino | claims | Banco (tenant/profile/templates) |
|---|---|---|---|
| 390×844 claro | `/app` | `admin`, `tenant_id` UUID, flag `false` | 1 tenant `trial`/`clinica`, profile `admin`, 5 templates |
| 390×844 escuro | `/app` | idem | idem |
| 1280×800 claro | `/app` | idem | idem |
| 1280×800 escuro | `/app` | idem | idem |

Templates confirmados por SQL: `cobranca, comprovante, confirmacao, lembrete_d1, reagendar_retorno`
(5), `tenant_count = 1` em cada execução (nenhum tenant órfão/duplicado). Zero erro de console e
zero falha de rede no fluxo completo. Evidência: `d1-signup-<cenário>.json`,
`screenshots/<cenário>-d1-0{1,2,3}-*.png`, `d1-db-<cenário>.txt` (em `/tmp/opencode/atlas-qa`,
transcrito na tabela acima).

## 5. D2 — troca de senha 200 com sessão nova (fechado)

Em todos os cenários, depois do `POST change-password` 200:

- a mutation faz `signInWithPassword` (e-mail lido antes do invoke) → `POST /auth/v1/token?grant_type=password` **200**;
- a tela navega para `/admin/empresas` (`afterSave`), sem passar por `/login`;
- reabrir `/trocar-senha` redireciona para `/admin/empresas` (guard lê a claim nova);
- `/admin` continua levando a `/admin/empresas` e o logout/login com a senha nova funciona.

Evidência: `items["6"].afterPath`, `items["6"].authCalls`, `items["9"]` nos JSON de cenário.

## 6. D3 — console sem erros nem avisos (fechado)

- **Dev (4 cenários):** `consoleAll.consoleErrors = []`, `consoleAll.consoleWarnings = []`,
  `logWarnings = []`. Zero ocorrência de "React Router Future Flag Warning" em toda a navegação.
- **Produção (`vite preview`, bundle):** `consoleErrors = []`, `consoleWarnings = []`,
  `logErrors = []`, `logWarnings = []` na carga inicial e na navegação SPA para `/login`.
- `logErrors` de 3 entradas por cenário = somente os erros de rede **provocados de propósito**
  (401 do item 7, offline do item 8, 400 do login inválido do item 11).

Evidência: `technical.consoleAll` e `build-preview.json`.

## 7. D4 — contraste medido (mantido; aceito em P-09)

`getComputedStyle` nos pares da §6 de `analysis-frontend.md`, WCAG 2.2 AA. Valores idênticos entre
390 e 1280 no mesmo tema (mesmos tokens).

| Par | Claro | Mínimo | Escuro | Mínimo | Resultado |
|---|---|---|---|---|---|
| Texto `foreground` / `card` | 17,22 | 4,5 | 15,21 | 4,5 | ✅ |
| `muted-foreground` / `card` | 5,67 | 4,5 | 6,75 | 4,5 | ✅ |
| `primary-foreground` / botão `primary` | **3,23** | 4,5 | 7,19 | 4,5 | ❌ claro |
| Link do alerta (herda `destructive`) | 5,22 | 4,5 | **3,80** | 4,5 | ❌ escuro |
| Texto `destructive` sobre fundo do alerta | **4,45** | 4,5 | **3,51** | 4,5 | ❌ ambos |
| Borda `input` / `card` (1.4.11) | **1,41** | 3 | **1,35** | 3 | ❌ ambos |
| Anel `ring` / `background` | **2,69** | 3 | 9,93 | 3 | ❌ claro |
| Ícone/token `destructive` / `card` | 5,22 | 3 | 3,80 | 3 | ✅ |
| Texto `primary` / `card` | **3,34** | 4,5 | 6,86 | 4,5 | ❌ claro |

Os números batem com a coluna "Antes" da análise: **os tokens não mudaram**, como previsto em P-09.
Ficam 5 pares abaixo do mínimo no claro e 3 no escuro (`primary-foreground`, alerta texto e link,
borda de input; `ring` só no claro). Registrado para a demanda de tokens; **não bloqueia** esta
entrega por decisão do usuário (P-09).

## 8. D5 — favicon (fechado)

- Dev: `GET /favicon.svg` **200** na primeira carga dos 4 cenários; **zero** requisição 404.
- Produção: `GET /favicon.svg` **200**; `dist/favicon.svg` presente e `<link rel="icon">` no
  `index.html` do bundle.
- Nenhum `Failed to load resource` de favicon em nenhum cenário.

## 9. D6 — foco inicial (fechado)

`document.activeElement` ao montar `/trocar-senha` = `INPUT` `type=password` (primeiro campo) nos
4 cenários. O ref callback integra o foco da tela ao `ref` do react-hook-form, sem perder o foco
no erro de validação.

## 10. Itens técnicos da §8

### 10.1 Layout

| Medida | 390×844 (claro/escuro) | 1280×800 (claro/escuro) |
|---|---|---|
| Rolagem horizontal | **0 px** | **0 px** |
| Fonte dos campos | **16 px** | 14 px (`sm:text-sm`; exigência de 16 px é do recorte mobile) |
| Altura do botão "Salvar nova senha" | **44 px** | 40 px (`sm:h-10`) |
| Botão na largura do conteúdo do card | sim | não (`sm:w-auto`) |
| Card centralizado | sim | sim |
| Painéis laterais (`aside`/`nav`) | 0 / 0 | 0 / 0 |
| Tema aplicado | `html.dark` + `color-scheme:dark` | `html.dark` + `color-scheme:dark` |
| Labels associados / descrições ligadas | sim / sim | sim / sim |

### 10.2 Tabulação, Enter e foco visível

- **Foco inicial** no campo "Nova senha" (D6).
- **Tab** a partir dele: **Confirmar nova senha** → **Salvar nova senha** → **Sair** → (fim do
  documento) → skip-link "Pular para o conteúdo" (chrome global de acessibilidade).
- **Enter envia**: senha de 7 caracteres + Enter disparou validação (`aria-invalid="true"`,
  mensagem) nos 4 cenários.
- **Foco visível** em todos os controles medidos (inputs, botões, skip-link): anel
  `box-shadow: rgb(39,176,130) 0 0 0 4px` com offset.

### 10.3 Resposta de `change-password`

- POST → **200**, corpo **exatamente** `{"ok":true}`.
- Auditoria: `NovaSenha@2026` ausente, `AtlasAgenda@123` ausente, `service_role` ausente,
  `BOOTSTRAP_SECRET` ausente, `secret` ausente. Preflight `OPTIONS` 200, um único POST (item 6).

## 11. Cold start de `/app/agenda` (admin de tenant)

Cache desabilitado (`Network.setCacheDisabled`), trace por cenário.

| Cenário | FCP | DCL | **LCP** | `< 1,5 s` | `/rest/v1/profiles` |
|---|---|---|---|---|---|
| 390×844 claro | 196 ms | 119,5 ms | **248 ms** | ✅ | **0** |
| 390×844 escuro | 220 ms | 125,3 ms | **256 ms** | ✅ | **0** |
| 1280×800 claro | 192 ms | 116,6 ms | **240 ms** | ✅ | **0** |
| 1280×800 escuro | 208 ms | 115,7 ms | **240 ms** | ✅ | **0** |

Agenda renderizada nos quatro cenários. Nenhuma requisição a `/rest/v1/profiles` para identidade.

## 12. Greps

| Alvo | Resultado |
|---|---|
| `BOOTSTRAP_SECRET` em `dist/` | **0** |
| `AtlasAgenda@123` (senha provisória) em `dist/` | **0** |
| `NovaSenha@2026` em `dist/` | **0** |
| `service_role` / `SUPABASE_SERVICE_ROLE_KEY` em `dist/` | **0** / **0** |
| `BOOTSTRAP_ALLOW_NON_LOCAL` em `dist/` | **0** |
| `sb_secret_` (service key local) em `dist/` | **0** |
| `must_change_password` em `dist/` | **2 ocorrências, ambas o NOME da claim** (contrato do cliente, ADR-07) — esperado pela redação atualizada do item 7 |
| `hash` em `dist/` | 35 ocorrências, todas `location.hash`/`hashchange` do React Router e `detectSessionInUrl`; `password_hash`, `bcrypt`, `argon2`, `$2a$/$2b$`, `pbkdf2` = **0** |
| `from("profiles")` em `src/` | **0** |

## 13. Comandos de verificação (item 9 da decisão)

| Comando | Resultado |
|---|---|
| `npm run typecheck` (`tsc -b`) | ✅ exit 0 |
| `npm run build` | ✅ exit 0 — 3,32 s; aviso informativo de chunk >500 kB (`index-*.js` 868,63 kB) |
| `npm test` | ✅ 32 arquivos, **315 testes** (0 falha) |
| `npm run test:integration` | ✅ 8 arquivos, **59 testes** (34,19 s), stack gerenciado por PID |
| `supabase db reset` | ✅ 54 migrations, zero erro |

## 14. Defeitos

| ID | Estado | Defeito / evidência |
|---|---|---|
| **D1** | ✅ **fechado** | Cadastro pela UI cria tenant + profile `admin` + 5 templates e chega em `/app` (4/4 cenários). |
| **D2** | ✅ **fechado** | Após 200, sessão nova por `signInWithPassword` e navegação para `/admin/empresas` (4/4). |
| **D3** | ✅ **fechado** | Zero aviso de React Router em dev e no bundle de produção; zero erro de console. |
| **D4** | ⚠️ **mantido (aceito, P-09)** | 5 pares abaixo de WCAG AA no claro e 3 no escuro; tokens não alterados nesta entrega, por decisão do usuário. |
| **D5** | ✅ **fechado** | `/favicon.svg` 200, `dist/favicon.svg`, zero 404. |
| **D6** | ✅ **fechado** | Foco inicial no primeiro campo de senha. |
| **D7** | ✅ **fechado** | `.gitignore:37` cobre `.agents/tasks/dev-pipeline/qa/`. |
| **D8** | ✅ **fechado** | `adr/index.json`: `current=adr-14`, `qaPending=[]`, ADRs 01–13 `approved`, 14 `in-progress`. |
| **D9** | ✅ **fechado (doc)** | Item 7 da ADR-14 passou a declarar que o **nome** da claim em `dist/` é esperado. |

Sem defeitos novos de produto. Observações (não defeitos):

1. **Correções não commitadas.** A árvore de trabalho tem 8 arquivos modificados + 4 novos
   (`public/`, 3 testes) — o QA validou esse estado, não um commit. O critério 5 da ADR (branch +
   PR para `feat/adr-01-password-gate`) continua **pendente**: não há PR, e commit só com pedido
   do usuário.
2. **Avisos do React Router em testes unitários.** `vitest` imprime os avisos em stderr porque os
   testes montam `MemoryRouter`/`RouterProvider` próprios sem as `future` flags. Cosmético, fora do
   critério de console do navegador; nenhum efeito em runtime.
3. `logout?scope=global` aparece como `net::ERR_ABORTED` porque a navegação acontece antes de a
   requisição terminar (`onSettled`).
4. O cadastro (`/cadastro`) não foca o primeiro campo ao montar; o requisito de foco é da tela de
   troca de senha. Registrado caso a UX queira padronizar.
5. Chunk principal de 868 kB (aviso do Vite) é pré-existente e não é escopo desta ADR.

## 15. Encerramento de processos

Nenhum `pkill -f`. Encerramento por PID, com conferência de dono (`ps -o pid,args -p`):

| Processo | PID | Estado |
|---|---|---|
| `vite` dev (5174) | 2141734 | encerrado; porta livre |
| `vite preview` (5175) | 2186066 | encerrado; porta livre |
| `supabase functions serve` | wrapper 2141697 | encerrado pelo teardown da suíte de integração; container `supabase_edge_runtime_atlas-agenda` removido |
| Chrome headless do QA | por `--user-data-dir=/tmp/opencode/atlas-qa/*` | todos encerrados (`closeBrowser`); nenhum órfão |
| esbuild filhos | 2141879 / 2186092 | encerrados com os pais |
| Vite do `atlas-ecm` (5173) | 200183 | **não tocado** (outro projeto) |

O stack Supabase base (54321/54322/54323) já estava rodando antes desta tarefa e foi deixado como
encontrado.

## 16. Arquivos de evidência

- `screenshots/` — 46 PNGs: 8 passos × 4 cenários (32) + 3 passos do D1 × 4 (12) + 2 do preview.
- `<cenário>.json` — itens, console acumulado, rede, layout, tabulação, contraste, perf.
- `d1-signup-<cenário>.json` — cadastro pela UI, claims e destino.
- `trace-<cenário>.json` — trace do cold start.
- `build-preview.json` — console/favicon no bundle de produção.
- `tools/` — driver CDP (`cdp.mjs`), runner por cenário (`run-combo.mjs`), checagem do cadastro
  (`check-signup.mjs`), checagem do bundle (`check-build.mjs`) e wrapper (`run-scenario.sh`).

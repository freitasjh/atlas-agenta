# QA E2E — do cadastro da empresa ao painel do super admin

- Data: 2026-11-01
- Repositório: `/home/joao/fusionlf/wsProjeto/atlas-agenda`
- Branch/commit: `master` @ `345e0dc` (árvore de trabalho limpa; nenhum arquivo de aplicação alterado)
- Escopo de escrita: apenas `harness/qa/e2e/` (gate `qa-scope-violation`, `gate.js` `isHarnessScoped`)
- Executor: driver próprio por CDP (Chrome headless), porque o MCP `chrome-devtools` compartilha
  `~/.cache/chrome-devtools-mcp/chrome-profile`, em uso por outra sessão de outro projeto.
  Recursos equivalentes usados: `Page.*`, `Runtime.consoleAPICalled`, `Log.entryAdded`,
  `Network.*`, `Emulation.setDeviceMetricsOverride`, `Input.dispatchMouseEvent`,
  `Page.captureScreenshot`, `Network.setCacheDisabled`.

## 1. Ambiente

| Item | Valor |
|---|---|
| Supabase CLI | 2.121.0 (stack local Docker) |
| Postgres | `supabase_db_atlas-agenda` @ `127.0.0.1:54322` |
| Banco | `supabase db reset` — 54 migrations, zero erro (`no files matched pattern: supabase/seed.sql`) |
| Edge Functions | `supabase functions serve --env-file /tmp/opencode/atlas-e2e/functions.env` (8 funções), PID 2253079 |
| Frontend | `npm run dev -- --port 5174 --strictPort --host 127.0.0.1` (Vite 5.4.11), PID 2253515 |
| Porta 5173 | ocupada pelo projeto `atlas-ecm` (PID 200183) — **não tocada** |
| Chrome | Google Chrome 154.0.8037.57 headless, viewport 1280×800, cache desabilitado |
| Node | v26.7.0 |
| Segredos | `BOOTSTRAP_SECRET` gerado (32 bytes hex) em `/tmp/opencode/atlas-e2e/bootstrap.secret` (0600); `ATLAS_ENV=local`; nenhum valor versionado |

Contas do roteiro: `e2e.empresa@atlas.test` (empresa criada pela UI), `e2e.rival@atlas.test`
(segunda empresa, para o teste de isolamento), `admin@neox.com.br` (super admin via bootstrap).

## 2. Resultado passo a passo

| # | Passo | Resultado | Evidência |
|---|---|---|---|
| 1 | Cadastro em `/cadastro` (empresa nova, segmento Clínica) | ✅ | `/app`; claims `user_role=admin`, `tenant_id=0eb5efa8-…`, `must_change_password=false`; 1 tenant `trial/clinica`, profile `admin`, 5 templates; POST `signup-tenant` **201** |
| 2 | `/app/agenda`, `/app/clientes`, `/app/config` como admin do tenant | ✅ | H1 "Agenda", "Clientes", "Configurações"; nenhum painel de erro; todas as chamadas REST **200** |
| 3 | `/admin` com o admin da empresa | ✅ | Tela "Acesso restrito" + "Erro 403" (`AccessDenied`), nenhuma tabela de empresas |
| 4 | Bootstrap do super admin | ✅ | Segredo errado **401**, `GET` **405**, `POST` correto **201 `criado`**; profile `super_admin`/`tenant_id=null`; `app_metadata.must_change_password=true` |
| 5 | Login `admin@neox.com.br` com senha provisória | ✅ | `/trocar-senha`, título "Crie sua nova senha", badge "Primeiro acesso", 2 campos de senha, sem conteúdo de `/admin`; claims `user_role=super_admin`, `must_change_password=true` |
| 6 | Troca de senha pela UI | ✅ | `POST change-password` **200** + `POST /auth/v1/token` **200** (sessão nova) → `/admin/empresas`; claims com `must_change_password=false` |
| 7 | Painel: listar empresas e mudar status | ✅ | Lista mostra "Atlas QA E2E"; dialog "Alterar assinatura — Atlas QA E2E"; transições oferecidas `Ativo/Pendente/Cancelado`; `POST admin-subscription` **200**; toast "Assinatura atualizada."; badge muda para "Ativo"; dialog fecha; auditoria gravada |
| 8 | Logout e re-login com a senha nova | ✅ | Senha provisória recusada (`400 invalid_credentials`); login novo → `/admin/empresas`; `/admin` redireciona para `/admin/empresas`; lista renderiza |
| 9 | Admin da empresa re-logado | ✅ | `/app` → `/app/agenda` renderiza; `/admin` continua em 403 na UI; claims seguem `admin`, flag `false` |
| 10 | RLS: admin da empresa × super admin | ✅ | Empresa A vê só 1 tenant (o próprio); não lê o tenant rival (0 linhas); não vê o cliente do rival (0 linhas); `profiles` só do próprio tenant; `PATCH` no tenant rival afeta **0 linhas** (200); super admin vê **2** tenants |

Resultado: **10 de 10 passos aprovados** (86 asserções, zero falha).

## 3. Evidências de dados

### 3.1 Claims do JWT (lidas do `localStorage` da sessão real)

| Sessão | `user_role` | `tenant_id` | `must_change_password` |
|---|---|---|---|
| Cadastro da empresa (UI) | `admin` | `0eb5efa8-976f-47f6-abc6-a8fa3cc1b79f` | `false` |
| Super admin, senha provisória | `super_admin` | `null` | `true` |
| Super admin, senha definitiva | `super_admin` | `null` | `false` |
| Admin da empresa, após re-login | `admin` | `0eb5efa8-…` | `false` |

### 3.2 Banco (contraprova independente, `psql` no container)

```
 trade_name     | segment  | plan       | subscription_status | role        | sem_tenant | templates
----------------+----------+------------+---------------------+-------------+------------+-----------
 Atlas QA E2E   | clinica  | individual | ativo               | admin       | f          | 5
 Atlas QA Rival | barbearia| individual | trial               | admin       | f          | 5
 (super admin)  | —        | —          | —                   | super_admin | t          | —
```

- Templates da régua: `cobranca, comprovante, confirmacao, lembrete_d1, reagendar_retorno` (5 por tenant; 10 no total).
- `auth.users`: `admin@neox.com.br` com `raw_app_meta_data.must_change_password=false` após a troca;
  as duas contas de empresa não têm flag (não é caminho de primeiro acesso).
- Auditoria da mudança de status (1 linha): `tenant_id=0eb5efa8-…`, `trial → ativo`,
  `changed_by` preenchido, motivo `QA E2E: ativacao da empresa criada pela UI.`
- Nenhum tenant órfão/duplicado após o cadastro (`tenants` = 1 antes da segunda empresa do passo 10).

Comportamento observado (esperado): ao entrar em `/app` pela primeira vez, `useOnboardingSeed`
(`src/app/AppLayout.tsx:17`) cria 3 serviços padrão (`Consulta`, `Retorno`, `Avaliação inicial`) —
visível como 3 × `POST /rest/v1/services` **201** no passo 1.

## 4. Console e rede

### 4.1 Console

| Coletor | Resultado |
|---|---|
| `Runtime.consoleAPICalled` type=error | **0** |
| `Runtime.consoleAPICalled` type=warning | **0** |
| `Log.entryAdded` level=error | **0** |
| `Log.entryAdded` level=warning | **0** |

Nenhum aviso de React Router (as flags `future` estão ativas em `src/router.tsx` e
`src/main.tsx:15`). Só mensagens `debug`/`info` do Vite e do React DevTools.

### 4.2 Rede (2.102 requisições no total)

| Passo | Requisições | 4xx/5xx | Chamadas de API relevantes |
|---|---|---|---|
| 1 Cadastro | 251 | 0 | `signup-tenant` 201, `token` 200, `dashboard_*` 200, `services` 201×3 |
| 2 Páginas do tenant | 681 | 0 | `tenants/customers/professionals/services/combos/appointments` 200 |
| 3 `/admin` (UI 403) | 220 | 0 | `tenants` 200 (RLS devolve só o do usuário) |
| 4 Bootstrap | 0 (fora do browser) | — | 401 / 405 / 201 validados por HTTP direto |
| 5 Login provisório | 239 | 0 (1 aborto de logout) | `logout` 204 (ERR_ABORTED), `token` 200 |
| 6 Troca de senha | 6 | 0 | `change-password` 200, `token` 200 |
| 7 Mudar status | 4 | 0 | `admin-subscription` 200, `tenants` 200 |
| 8 Re-login super admin | 226 | 0 (1 aborto de logout) | `logout` 204, `token` 200, `tenants` 200×2 |
| 9 Admin da empresa | 475 | 0 (1 aborto de logout) | `token` 200, REST do tenant 200 |
| 10 RLS | 0 (fora do browser) | — | probes REST com JWT de cada ator |

Distribuição global: **2.095 × 200**, **4 × 201**, **3 × `net::ERR_ABORTED`**.

Os 3 abortos são o `POST /auth/v1/logout?scope=global`, que já chegou **204** no servidor: o
`SignOutButton` navega para `/login` dentro do `onSettled` (`src/components/SignOutButton.tsx:30`)
e a navegação cancela a leitura da resposta. Não é falha funcional (sessão encerrada, cache limpo,
redirecionamento correto) e é pré-existente (registrado na execução anterior da ADR-14).

## 5. Super admin — 403/200 por flag e por papel

| Chamada | Autor | Flag | HTTP | Corpo |
|---|---|---|---|---|
| `POST admin-subscription` (`set_status`) | admin da empresa | `false` | **403** | `Você não tem permissão para alterar o status de assinatura.` |
| `POST admin-subscription` (`set_status`) | super admin | **`true`** | **403** | `{code:"password_change_required"}` — antes de carregar o tenant |
| `POST admin-subscription` (`set_status`) | super admin (UI, após troca) | `false` | **200** | lista invalidada, badge "Ativo" na linha |

O gate é decidido no servidor (`supabase/functions/admin-subscription/handler.ts:143`,
`decideSubscriptionGate`), com `role` de `profiles` e a flag de `app_metadata`; o cliente não
envia papel nem credencial de tenant.

## 6. RLS (multi-tenant)

| Prova | Admin da empresa A | Super admin |
|---|---|---|
| `GET /rest/v1/tenants` | 1 linha (a própria) | 2 linhas (A + B) |
| `GET /rest/v1/tenants?id=eq.<tenant B>` | 0 linhas | — |
| `GET /rest/v1/customers` (B tem 1 cliente semeado) | 0 linhas | — |
| `GET /rest/v1/profiles` | só linhas do tenant A | — |
| `PATCH /rest/v1/tenants?id=eq.<tenant B>` (`trade_name`) | **0 linhas alteradas** (200) | — |

Confirma as policies `tenants_select_own` / `tenants_super_admin_select`
(`supabase/migrations/20250216091000_profiles_and_helpers.sql:88-100`) e o isolamento de
`customers` por `current_tenant_id()`.

## 7. Defeitos e observações

Nenhum defeito bloqueante ou de severidade alta/média encontrado no fluxo testado.

| ID | Severidade | Item | Referência |
|---|---|---|---|
| O1 | Baixa (pré-existente) | `POST /auth/v1/logout` aparece como `net::ERR_ABORTED` porque a navegação para `/login` ocorre antes da resposta ser lida; o servidor respondeu 204 (sessão encerrada). | `src/components/SignOutButton.tsx:30` |
| O2 | Informativa | `/cadastro` não foca o primeiro campo ao montar (a tela de troca de senha foca). Padronização de foco fica para UX. | `src/auth/CadastroPage.tsx` (sem `useEffect` de foco) |
| O3 | Informativa (automação) | O texto "Erro 403" é renderizado em caixa alta por CSS (`uppercase`), então `innerText` devolve "ERRO 403"; asserções precisam ser case-insensitive. Sem impacto de produto. | `src/components/AccessDenied.tsx:35` |
| O4 | Operacional | `supabase/config.toml` fixa `site_url = http://localhost:5173`. Nesta execução o front rodou em 5174 (5173 ocupada por outro projeto); links de e-mail (recuperação de senha) apontariam para 5173. Não afeta este cenário. | `supabase/config.toml:64` |
| O5 | Operacional | `supabase/functions/.env` versionado não traz `ATLAS_ENV`/`BOOTSTRAP_SECRET` — correto (segredos), mas o bootstrap só funciona com um env file externo ao repositório. | `supabase/functions/.env.example` |

Achados de execução (não defeitos): o botão "Sair" não existe na tela 403 (`AccessDenied`), então
sair do `/admin` negado exige voltar para a área do papel — comportamento coerente com o desenho,
apenas registrado para quem automatizar.

## 8. Artefatos

- `harness/qa/e2e/e2e-report.json` — 10 passos, asserções, detalhes, console e rede por passo.
- `harness/qa/e2e/screenshots/` — 14 PNGs 1280×800:
  `e2e-01-cadastro`, `02-cadastro-preenchido`, `03-app-dashboard`, `04-app-agenda`,
  `05-app-clientes`, `06-app-config`, `07-admin-403`, `08-trocar-senha`, `09-admin-empresas`,
  `10-mudar-status-dialog`, `11-status-atualizado`, `12-relogin-admin`, `13-empresa-app-agenda`,
  `14-empresa-admin-403`.
- `harness/qa/e2e/run-e2e.mjs` — driver do roteiro (reusa `harness/qa/tools/cdp.mjs`).

## 9. Reprodução

```sh
supabase db reset
supabase functions serve --env-file /tmp/opencode/atlas-e2e/functions.env   # ATLAS_ENV=local + BOOTSTRAP_SECRET
npm run dev -- --port 5174 --strictPort --host 127.0.0.1
QA_SERVICE_ROLE_KEY=<service_role local> node harness/qa/e2e/run-e2e.mjs
```

## 10. Encerramento de processos

Nenhum `pkill -f`. Encerramento por PID, com conferência de dono (`ps -o pid,args -p`):

| Processo | PID | Ação |
|---|---|---|
| `vite` dev (5174) | 2253515 | encerrado; porta 5174 livre |
| `supabase functions serve` | 2253079 (filho 2253089) | encerrado; container `supabase_edge_runtime_atlas-agenda` removido; `/functions/v1/*` volta a 503 (estado encontrado) |
| Chrome headless (porta 9711) | — | encerrado pelo driver (`SIGTERM`); porta 9711 livre; perfil em `/tmp/opencode/atlas-e2e/chrome-profile` |
| Vite do `atlas-ecm` (5173) | 200183 | **não tocado** (outro projeto) |

O stack Supabase base (54321/54322/54323) já estava em execução antes desta tarefa e foi deixado
como encontrado (apenas com os dados do roteiro, após `db reset`).

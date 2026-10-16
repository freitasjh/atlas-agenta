# PRD — Scaffold inicial do Atlas Agenda (recorte "b": esqueleto navegável)

Projeto: **atlas-agenda** · Pipeline: dev-pipeline · Documento: PRD (contrato da demanda)
Workdir: `/home/joao/fusionlf/wsProjeto/atlas-agenda` (greenfield; hoje só existe `.kiro/` e `.agents/`)
Fontes: `analysis-data.md`, `analysis-frontend.md`, e steerings `produto.md`, `dominio.md`, `stack.md`, `seguranca-multitenant.md`, `convencoes-codigo.md`.

> Este PRD descreve **o que** precisa existir e **como se prova** que ficou pronto. Não é a
> solução técnica detalhada — a decomposição em ADRs vem no planejamento, **após** a
> aprovação humana deste documento.

---

## 1. Problema e valor de negócio

O Atlas Agenda é um Micro-SaaS multi-tenant de agenda + cobrança via WhatsApp/PIX. Hoje o
repositório é greenfield: não existe aplicação onde as features de agenda, cobrança e
comunicação possam morar. Sem uma casca buildável e navegável, nenhuma fase seguinte do
roadmap tem fundação.

O que muda quando este recorte estiver pronto:

- **Destrava o roadmap técnico (Fase 1 / fundação).** Passa a existir uma SPA buildável e
  navegável, com as quatro áreas do produto (marketing, auth, app do tenant, admin) já
  separadas em rotas-casca.
- **Trava o custo de infra em ~zero** por ora: SPA estática + Supabase BaaS (sem servidor
  dedicado), alinhado ao objetivo de negócio "custo de infra próximo de zero".
- **Fixa as convenções desde o primeiro commit**: TypeScript estrito, pt-BR, dark mode por
  padrão, segredos só em env (só a anon key pública no cliente), acesso a dados centralizado
  em TanStack Query + cliente Supabase em `src/lib`. Corrigir essas decisões depois (ex.:
  segredo vazado no bundle, árvore de rotas reorganizada) custa muito mais caro.

Este recorte **não** entrega valor ao usuário final ainda (não há login nem telas reais);
entrega valor de **fundação de engenharia**: a plataforma passa a ser extensível de forma
disciplinada.

---

## 2. Escopo

### 2.1 Dados / Supabase

- **Nada de schema persistente neste recorte.** Nenhuma migration, tabela, coluna, tipo,
  índice ou política RLS é criada agora. `tenants`, `profiles` e demais entidades de domínio
  ficam para fase posterior.
- `supabase/migrations/` e `supabase/functions/` nascem **vazias** (apenas um placeholder
  tipo `.gitkeep` para versionar o diretório e sinalizar o ponto de extensão).
- Existe **superfície de segurança real mesmo sem dados**: a inicialização do cliente
  Supabase no bundle do navegador e o tratamento de segredos via env. Isso **entra** no
  escopo (ver seção 4) — o cliente Supabase em `src/lib` usa **exclusivamente** a anon key
  pública lida de `VITE_*`.

### 2.2 Frontend (entra)

- Projeto **Vite + React + TypeScript estrito** (`strict: true`, sem `any` implícito),
  buildável.
- **Tailwind CSS + shadcn/ui** configurados e funcionando (ao menos um componente shadcn
  renderizado como prova).
- **Árvore de pastas** conforme `stack.md`: `src/{app,admin,marketing,auth,components,lib,hooks,types}`
  e `supabase/{migrations,functions}` (estas duas vazias/placeholder).
- **React Router** com rotas-casca renderizando placeholders por área:
  - marketing: `/`, `/precos`, `/termos`
  - auth: `/login`, `/cadastro`, `/recuperar-senha`
  - app (tenant): `/app` (base fixada; a spec aceitava `/app` ou `/dashboard`), mais submódulos
    placeholder `/app/agenda`, `/app/clientes`, `/app/cobrancas`, `/app/config`
  - admin: `/admin`, mais `/admin/empresas` placeholder
  - rota curinga: **404 em pt-BR**
- **Cliente Supabase** em `src/lib`, inicializado com `VITE_SUPABASE_URL` e
  `VITE_SUPABASE_ANON_KEY` via env; validação de presença das variáveis na borda, com falha
  explícita e mensagem clara em pt-BR no console quando faltarem (sem quebrar a navegação das
  rotas-casca).
- `.env.example` versionado (só chaves `VITE_*`, sem valores reais); `.env` no `.gitignore`.
- **QueryClientProvider** (TanStack Query) montado no topo da aplicação.
- **Dark mode ativo por padrão** (com toggle de cortesia que persiste a escolha).
- **UI em pt-BR**, `<html lang="pt-BR">`, mobile-first.
- Dependências com **versões fixadas** (sem `^`/`~`) e **lockfile committado**.
- Stubs de guard nomeados (`RequireAuth`, `RequireRole`, `RequireActiveSubscription`) como
  **passthrough sem lógica de auth** — apenas a forma/contrato, para a fase de auth preencher
  sem reorganizar a árvore de rotas.

### 2.3 Fora de escopo (não entra neste recorte)

- Nenhuma migration/schema/RLS; nenhuma tabela ou política.
- Sem login funcional / sessão Supabase real.
- Sem RBAC efetivo — guards são stubs passthrough, sem lógica de auth.
- Sem leitura de `subscription_status`; sem tela de quitação (só citada no contrato do guard).
- Sem telas reais de negócio (agenda/clientes/cobranças são `PlaceholderPanel`).
- Sem Edge Functions; sem integração Asaas/Evolution.
- **Fora do MVP inteiro (Fase 3, não tocar):** link público de autoagendamento, taxa de
  reserva antecipada obrigatória, painel de métricas consolidadas.

---

## 3. Requisitos e critérios de aceite testáveis

Cada requisito com entrada → saída observável. Numeração herdada das análises (RF-SCAFF / CA).

### 3.1 Requisitos funcionais

| ID | Requisito | Entrada → saída observável |
|----|-----------|----------------------------|
| RF-SCAFF-01 | Projeto Vite+React+TS estrito buildável | `npm install && npm run build` → conclui sem erro e sem erro de tipo |
| RF-SCAFF-02 | Tailwind + shadcn/ui configurados | abrir a app → ao menos 1 componente shadcn renderiza com estilo aplicado |
| RF-SCAFF-03 | Árvore de pastas do stack.md | listar `src/` → `{app,admin,marketing,auth,components,lib,hooks,types}` existem; `supabase/{migrations,functions}` existem e vazias |
| RF-SCAFF-04 | React Router com rotas-casca das 4 áreas | navegar a cada rota → placeholder da área renderiza; URL inexistente → 404 pt-BR |
| RF-SCAFF-05 | Cliente Supabase (anon key via env) em `src/lib` | ler o código → client criado de `import.meta.env.VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, só anon key |
| RF-SCAFF-06 | `.env.example` versionado, `.env` ignorado | `.env.example` só com chaves `VITE_*` sem valor; `.gitignore` cobre `.env*` exceto `.env.example` |
| RF-SCAFF-07 | QueryClientProvider montado na raiz | runtime sem erro de contexto do TanStack Query; provider visível no código na raiz da árvore |
| RF-SCAFF-08 | Dark mode por padrão | app inicia com `<html class="dark">` |
| RF-SCAFF-09 | Textos de interface em pt-BR | todo texto visível de placeholder/404/labels em português do Brasil |
| RF-SCAFF-10 | Versões fixadas + lockfile | `package-lock.json` presente; dependências sem range (`^`/`~`) |

### 3.2 Requisitos não-funcionais

- **RNF-SCAFF-01 (Segredos):** o bundle do cliente só contém a anon key pública. Service
  role key, chave Asaas, token Evolution e segredos de webhook **nunca** entram no frontend
  nem em variável `VITE_*`.
- **RNF-SCAFF-02 (Git):** `.env`, chaves e segredos nunca committados; `.gitignore` cobre
  `.env*` exceto `.env.example`.
- **RNF-SCAFF-03 (Mobile-first):** layout estilizado para telas pequenas primeiro; em 375px
  nada estoura horizontalmente; em ≥768px a sidebar do `/app` fica fixa e no mobile vira
  `Sheet` acionado por botão de menu acessível.
- **RNF-SCAFF-04 (Acesso a dados):** sem `fetch` solto em `useEffect`; padrão TanStack Query
  + cliente Supabase em `src/lib` estabelecido já no scaffold (exemplo documentado/comentado
  em `src/hooks`).
- **RNF-SCAFF-05 (Reprodutibilidade):** `npm install && npm run build` conclui limpo em
  ambiente novo a partir do lockfile.
- **RNF-SCAFF-06 (Acessibilidade base):** foco visível em elementos focáveis, labels
  associados em inputs de placeholder, landmarks semânticas, `prefers-reduced-motion`
  respeitado, skip-link no layout raiz. (Validação completa com leitor de tela fica para QA
  manual.)

### 3.3 Critérios de aceite consolidados (gate de pronto)

1. **CA-01 — Build:** em clone limpo, `npm install` + `npm run build` conclui sem erro e sem
   warning de tipo (TS estrito).
2. **CA-02 — Dev server:** `npm run dev` sobe a SPA e ela carrega sem erro no console.
3. **CA-03 — Navegação marketing:** `/`, `/precos`, `/termos` renderizam placeholder sem erro
   no console.
4. **CA-04 — Navegação auth:** `/login`, `/cadastro`, `/recuperar-senha` renderizam
   placeholder sem erro no console.
5. **CA-05 — Navegação app:** `/app` e submódulos (`/app/agenda`, `/app/clientes`,
   `/app/cobrancas`, `/app/config`) renderizam placeholder sem erro no console.
6. **CA-06 — Navegação admin:** `/admin` e `/admin/empresas` renderizam placeholder sem erro
   no console.
7. **CA-07 — 404:** URL inexistente renderiza 404 em pt-BR.
8. **CA-08 — TanStack Query:** `QueryClientProvider` montado na raiz; sem erro de contexto em
   runtime.
9. **CA-09 — Cliente Supabase:** criado em `src/lib` a partir de `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY`; com `.env` ausente, a app **ainda navega** pelas rotas-casca e
   emite mensagem clara em pt-BR no console (não quebra de forma confusa).
10. **CA-10 — Dark mode:** app inicia em dark por padrão; fundo ardósia (não preto puro nem
    branco).
11. **CA-11 — pt-BR:** todo texto visível de placeholder está em português do Brasil;
    `<html lang="pt-BR">`.
12. **CA-12 — Árvore de pastas:** `src/{app,admin,marketing,auth,components,lib,hooks,types}`
    e `supabase/{migrations,functions}` (vazias/placeholder) existem.
13. **CA-13 — Segredos (segurança):** busca por `service_role`, chaves Asaas/Evolution ou
    qualquer segredo privilegiado **não retorna nada** no código versionado; `.env.example`
    só tem chaves `VITE_*` sem valores reais; `.env` está no `.gitignore`.
14. **CA-14 — Lockfile:** `package-lock.json` presente e versões fixadas.
15. **CA-15 — Sem dados/RLS (confirmação negativa):** `supabase/migrations/` não contém
    nenhum `.sql` de schema; nenhuma tabela/RLS criada.

---

## 4. Regras de fronteira que a demanda arrisca

Estas travas em sua maioria **não são implementadas agora** (não há dados), mas o scaffold
**não pode contradizê-las** e elas ficam registradas para quem materializar o backend. Os
itens que o scaffold efetivamente arrisca estão marcados **[ATIVO NO SCAFFOLD]**.

1. **Isolamento multi-tenant por RLS.** RLS habilitado em TODA tabela de domínio (fase
   posterior). Nenhuma tabela com dado de tenant sem política. — *herança; não há tabela
   agora.*
2. **`tenant_id` vem do JWT / `profiles`, nunca do cliente.** Políticas comparam a linha com
   o tenant do usuário autenticado (via `current_tenant_id()` `security definer`, fase
   posterior). **[ATIVO NO SCAFFOLD]** — nenhum guard ou código do cliente pode ler/enviar
   `tenant_id` como filtro; o isolamento é sempre do RLS. Os stubs de guard respeitam isso.
3. **Super admin cross-tenant** só por Edge Function com service role ou policy `super_admin`
   explícita e auditada — nunca pelo cliente comum. — *herança.*
4. **RBAC:** `admin` (tudo no tenant), `professional` (só a própria agenda via
   `professional_id`), `receptionist` (agendamentos de todos, **sem** ler `charges`/dados
   financeiros sensíveis). **[forma no scaffold]** — `RequireRole` existe como stub nomeado,
   sem lógica; a fase de auth preenche.
5. **Status de assinatura:** `bloqueado` redireciona para tela de quitação; `cancelado`
   suspende acesso/disparos. **[forma no scaffold]** — `RequireActiveSubscription` é stub
   passthrough; tela de quitação não é construída agora.
6. **Prevenção de conflito de agendamento (RF06):** constraint de exclusão `tstzrange` +
   `btree_gist` no banco e validação na app. — *herança; sem agenda real agora.*
7. **Webhooks (RNF04):** idempotência por `gateway_charge_id` + id do evento; verificação de
   autenticidade (assinatura/token) antes de processar; fila de retentativa para WhatsApp. —
   *herança; sem Edge Functions agora.*
8. **Segredos fora do cliente.** Service role, chave Asaas, token Evolution e segredos de
   webhook só em Edge Functions / env do Supabase. No cliente, **só** a anon key pública via
   `VITE_*`. **[ATIVO NO SCAFFOLD — risco principal]** — qualquer `VITE_*` é embutido no
   bundle público pelo Vite; a defesa é (a) nunca nomear segredo privilegiado como `VITE_*`,
   (b) `.gitignore` do `.env`, (c) o CA-13 (busca por segredos) no QA. O `.env.example` deve
   trazer comentário explícito sobre isso.
9. **LGPD:** `whatsapp_opt_in` antes de qualquer disparo; minimizar PII em logs. — *herança;
   sem disparo nem PII real agora.*

**Invariante e dono da enforcement:** "só anon key no cliente" é garantia de **processo /
revisão de código + `.gitignore`**, não de runtime — porque qualquer `VITE_*` vira público.

---

## 5. Perfis de acesso

Quem executa cada ação no produto (RBAC definido em `produto.md`/`seguranca-multitenant.md`).
**Neste recorte os perfis não têm enforcement** — ficam registrados como contrato que os
stubs de guard carregam para a fase de auth.

- **super_admin** — fundadores da plataforma; rotas `/admin` (empresas, assinaturas,
  instâncias WhatsApp, limites). Pode não ter `tenant_id`. Cross-tenant só por caminho
  auditado.
- **admin** (da empresa) — tudo dentro do próprio tenant (`/app`): serviços, preços, equipe,
  faturamento.
- **professional** — apenas a própria agenda (`professional_id` ligado ao seu `profile_id`).
- **receptionist** — agendamentos de todos os profissionais do tenant, **sem** acesso a
  `charges`/dados financeiros sensíveis.

No scaffold: `/admin` e `/app` já nascem em áreas separadas (`src/admin` vs `src/app`),
refletindo na estrutura o futuro isolamento tenant↔admin.

---

## 6. Enquadramento no roadmap e dependências

- **Fase 1 (fundação) — É ESTE RECORTE.** Scaffold navegável, convenções travadas, cliente
  Supabase e TanStack Query montados. Sem dados, sem auth real, sem RBAC real.
- **Dependências anteriores:** nenhuma — é o primeiro código da aplicação. Depende apenas das
  decisões já travadas nas steerings (stack, domínio, segurança, convenções), que este PRD
  respeita e não reabre.
- **Fase 2 (próximas, fora deste recorte):** migrations do domínio (começando por `tenants`,
  `profiles` e a função `current_tenant_id()`), RLS por tabela, Supabase Auth real, guards de
  RBAC e de status de assinatura com lógica, telas reais de agenda/clientes/cobranças.
- **Fase 3 (fora do MVP — não implementar sem pedido explícito):** link público de
  autoagendamento, taxa de reserva antecipada, painel de métricas consolidadas.

O scaffold deixa os pontos de extensão óbvios: `supabase/migrations` e `supabase/functions`
vazias, `src/lib` pronto para clientes Asaas/Evolution, `src/app` e `src/admin` separados.

---

## 7. Pontos levantados pelo usuário — nenhum descartado

Das mensagens do usuário (índices 1–12), cada ponto registrado como **decisão tomada** ou
**pergunta em aberto**:

1. **"Com base no que tem, já podemos fazer o esqueleto do sistema" (msg 1) +
   "pode iniciar" (6) + "1" / "A" / "aprovado" (9–12).** → **Decisão:** construir o
   scaffold navegável. É exatamente este recorte "b". ✔ endereçado.
2. **"não é atlas-cobranca e atlas-agenda" (msg 2) + "ajustar todos os pontos que ainda têm
   atlas-cobranca para atlas-agenda" (3).** → **Decisão:** o nome do produto/projeto é
   **Atlas Agenda**. O scaffold (package name, títulos, textos) usa "Atlas Agenda"; nenhuma
   referência a "atlas-cobranca". Critério de aceite implícito: nenhuma string "atlas-cobranca"
   no código versionado. ✔ incorporado.
3. **"seria 1 sim, 2 b" (msg 7).** → **Decisão:** recorte **"b" = esqueleto navegável**
   (confirmado como escopo deste PRD). ✔.
4. **"A base vai ser firebase, correto?" (msg 7).** → **Pergunta respondida / decisão já
   travada:** **não**. A base é **Supabase** (PostgreSQL + Auth + RLS + Edge Functions),
   conforme `stack.md`. Justificativa: RLS nativo é natural para multi-tenant por `tenant_id`.
   Decisão travada; não reabrir sem pedido explícito.
5. **"deixar com um custo mais low; se colocar postgres aí poderia ficar custoso nesse
   momento" (msg 8).** → **Decisão/esclarecimento:** o receio é com Postgres gerenciado
   dedicado. **Supabase entrega PostgreSQL dentro do modelo BaaS serverless de custo ~zero**
   no início (tier gratuito) + frontend estático (Vercel/Cloudflare Pages). Atende o objetivo
   "custo de infra próximo de zero". **Não afeta o scaffold** (nenhum banco é provisionado
   agora), mas fica registrado para não reabrir.

Nenhum ponto do usuário foi descartado.

---

## 8. Critério de aceite visual (frontend) — verificável via Chrome DevTools

1. `npm install` + `npm run build` concluem sem erro; `npm run dev` serve a SPA.
2. `<html>` inicia com classe `dark` e `lang="pt-BR"`; fundo é a ardósia escura
   (aprox. `#11151C`), não preto puro nem branco.
3. Navegar por `/`, `/precos`, `/termos`, `/login`, `/cadastro`, `/recuperar-senha`, `/app`,
   `/app/agenda`, `/app/clientes`, `/app/cobrancas`, `/app/config`, `/admin`,
   `/admin/empresas` renderiza a casca correta **sem erro no console**.
4. URL inexistente renderiza 404 em pt-BR.
5. Em 375px (mobile) a sidebar do `/app` vira `Sheet` acionado por botão de menu acessível;
   em ≥768px a sidebar fica fixa. Nada estoura horizontalmente (sem scroll-x).
6. Toggle de tema alterna dark/claro e persiste (localStorage); foco visível (anel de acento)
   ao tabular pelos controles do header.
7. Amostra de `StatusBadge` na casca da agenda mostra os seis status do domínio
   (`pendente`, `confirmado`, `em_atendimento`, `concluido`, `cancelado`, `nao_compareceu`)
   com cores distintas.
8. DevTools → Network: fontes carregam localmente (sem request externo a Google Fonts);
   **nenhuma requisição a Supabase dispara** no load do scaffold.
9. Todo texto visível em pt-BR (inclusive 404 e labels).

---

## 9. Notas para o planejamento (não são escopo — orientam a quebra em ADRs)

- Agrupar o scaffold de infra de build (Vite+TS+Tailwind+shadcn+lockfile) como fundação antes
  das rotas.
- O cliente Supabase com validação zod de env e o `QueryClient` em `src/lib` são uma unidade
  coesa.
- Roteamento + layouts + stubs de guard + placeholders formam a casca navegável.
- Design system (tokens de cor/tipografia, dark default, componentes shadcn, `StatusBadge`,
  `PlaceholderPanel`) sustenta todas as telas-casca.
- Tipos de domínio (`AppointmentStatus`, `SubscriptionStatus`, `Role`) em `src/types` são
  baratos e evitam strings mágicas nos badges/guards.

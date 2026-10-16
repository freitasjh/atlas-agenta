# Análise de Dados e Segurança — Scaffold inicial (recorte "b")

Projeto: **atlas-agenda** · Pipeline: dev-pipeline · Papel: Analisador de Dados e Segurança
Workdir: `/home/joao/fusionlf/wsProjeto/atlas-agenda` (greenfield; hoje só existe `.kiro`)

---

## 0. Veredito da superfície de dados/segurança

**Esta demanda NÃO cria superfície de dados nem schema persistente.** O recorte "b" é um
esqueleto navegável de frontend (SPA React + Vite + TS): árvore de pastas, roteamento com
rotas-casca/placeholders, Tailwind + shadcn/ui, provider do TanStack Query e um cliente
Supabase inicializado por env. Não há — e, por restrição explícita, **não pode haver** —
migration, tabela, política RLS, Edge Function, login funcional ou guard de RBAC com lógica
real.

Portanto, este documento:

1. Registra que **nenhum modelo de dados / migration / RLS é produzido agora** (seção 4).
2. Mesmo sem dados persistidos, existe **superfície de segurança real no scaffold**: o
   tratamento de segredos e a inicialização do cliente Supabase no bundle do navegador. Essa
   superfície é analisada e tem critérios de aceite testáveis (seções 2, 3 e 5).
3. Fixa as **fronteiras invioláveis** que o scaffold não pode violar e que as fases
   seguintes obrigatoriamente herdam (seção 6), para não reinventar decisões já travadas
   nas steering (`seguranca-multitenant.md`, `dominio.md`, `convencoes-codigo.md`).

> Observação de processo: as ferramentas MCP do brain (`brain_search`/`brain_store`) não
> estão disponíveis para este subagente de análise. Usei as steering de
> `/.kiro/steering/` (produto, domínio, stack, segurança-multitenant, convenções) como fonte
> da verdade. O registro de aprendizado no brain fica a cargo da orquestração ao término do
> run, conforme `brain-learning.md`.

---

## 1. Valor de negócio

- **Destrava todo o roadmap técnico.** Sem uma casca buildável e navegável, nenhuma feature
  de agenda, cobrança ou WhatsApp tem onde morar. É a Fase 1 (fundação) do produto.
- **Trava o custo de infra em ~zero** por ora: SPA estática + Supabase BaaS, sem servidor
  dedicado — alinhado ao objetivo de negócio "custo de infra próximo de zero".
- **Fixa as convenções desde o primeiro commit**: TS estrito, pt-BR, dark mode, segredos só
  em env, acesso a dados centralizado em TanStack Query + cliente Supabase em `src/lib`.
  Corrigir essas decisões depois (ex.: segredo vazado no bundle) custa muito mais caro.

---

## 2. Requisitos funcionais (verificáveis)

| ID | Requisito |
|----|-----------|
| RF-SCAFF-01 | Projeto **Vite + React + TypeScript estrito** (`strict: true`, sem `any` implícito) buildável. |
| RF-SCAFF-02 | **Tailwind CSS** e **shadcn/ui** configurados e funcionando (ao menos 1 componente shadcn renderizado como prova). |
| RF-SCAFF-03 | Árvore de pastas conforme `stack.md`: `src/{app,admin,marketing,auth,components,lib,hooks,types}` e `supabase/{migrations,functions}` **vazios** (apenas placeholder para versionar a pasta). |
| RF-SCAFF-04 | **React Router** com rotas-casca renderizando placeholders por área: marketing (`/`, `/precos`, `/termos`); auth (`/login`, `/cadastro`, `/recuperar-senha`); app (`/app` ou `/dashboard`); admin (`/admin`). |
| RF-SCAFF-05 | **Cliente Supabase** em `src/lib`, inicializado com `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` via env; **apenas anon key** no cliente. |
| RF-SCAFF-06 | `.env.example` versionado com as chaves `VITE_*` (sem valores reais); `.env` no `.gitignore`. |
| RF-SCAFF-07 | **QueryClientProvider** (TanStack Query) montado no topo da aplicação. |
| RF-SCAFF-08 | **Dark mode ativo por padrão**. |
| RF-SCAFF-09 | Textos de interface em **pt-BR**. |
| RF-SCAFF-10 | Dependências com **versões fixadas** e **lockfile committado**. |

---

## 3. Requisitos não-funcionais relevantes

- **RNF-SCAFF-01 (Segurança — segredos):** o bundle do cliente só pode conter a **anon key
  pública**. Service role key, chave Asaas, token Evolution e segredos de webhook **nunca**
  aparecem no código do frontend nem em variável `VITE_*`. (`seguranca-multitenant.md`)
- **RNF-SCAFF-02 (Segurança — git):** `.env`, chaves e segredos **nunca** committados;
  `.gitignore` cobre `.env*` exceto `.env.example`.
- **RNF-SCAFF-03 (Mobile-first):** layout estilizado para telas pequenas primeiro, depois
  breakpoints maiores. (`convencoes-codigo.md`, RNF02 da spec)
- **RNF-SCAFF-04 (Acesso a dados):** nada de `fetch` solto em `useEffect`; o padrão
  TanStack Query + cliente Supabase em `src/lib` fica estabelecido já no scaffold.
- **RNF-SCAFF-05 (Reprodutibilidade de build):** `npm install && npm run build` conclui
  limpo em ambiente novo a partir do lockfile.

---

## 4. Modelo de dados e migrations — **NÃO SE APLICA NESTE RECORTE**

Por decisão de escopo (recorte "b") e por restrição inviolável da tarefa:

- **Nenhuma migration** é criada em `supabase/migrations` neste scaffold.
- **Nenhuma tabela, coluna, tipo, índice ou política RLS** é definida agora.
- `tenants`, `profiles` e demais entidades de domínio ficam para **fase posterior**.
- `supabase/migrations/` e `supabase/functions/` nascem **vazias** (só um `.gitkeep` ou
  `README` placeholder para versionar o diretório), sinalizando o ponto de extensão.

O modelo de domínio completo (tenants, profiles, professionals, services, working_hours,
customers, appointments, charges, messages, whatsapp_instances), com dinheiro em `*_cents`
inteiro e tempo em `timestamptz` UTC, já está especificado em `dominio.md` e será
materializado em migrations numa fase dedicada do pipeline — **não aqui**.

---

## 5. Critérios de aceite (testáveis e numerados)

1. **CA-01 — Build:** em clone limpo, `npm install` seguido de `npm run build` conclui
   **sem erro** e sem warnings de tipo (TS estrito).
2. **CA-02 — Dev server:** `npm run dev` sobe a SPA e ela carrega sem erro no console.
3. **CA-03 — Navegação marketing:** acessar `/`, `/precos`, `/termos` renderiza placeholder
   de cada rota **sem erro no console**.
4. **CA-04 — Navegação auth:** acessar `/login`, `/cadastro`, `/recuperar-senha` renderiza
   placeholder de cada rota **sem erro no console**.
5. **CA-05 — Navegação app:** acessar `/app` (ou `/dashboard`) renderiza placeholder da área
   do tenant **sem erro no console**.
6. **CA-06 — Navegação admin:** acessar `/admin` renderiza placeholder da área do super admin
   **sem erro no console**.
7. **CA-07 — TanStack Query:** o `QueryClientProvider` está montado na raiz da árvore React
   (verificável no código e sem erro de contexto em runtime).
8. **CA-08 — Cliente Supabase:** o cliente é criado em `src/lib` a partir de
   `import.meta.env.VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`; com `.env` ausente, a app
   não quebra silenciosamente de forma confusa (mensagem/clareza — ver seção 7).
9. **CA-09 — Dark mode:** a aplicação inicia em dark mode por padrão.
10. **CA-10 — pt-BR:** todo texto visível de placeholder está em português do Brasil.
11. **CA-11 — Árvore de pastas:** existem `src/{app,admin,marketing,auth,components,lib,hooks,types}`
    e `supabase/{migrations,functions}` (estas duas vazias/placeholder).
12. **CA-12 — Segredos (segurança):** `grep` por `service_role`, chaves Asaas/Evolution ou
    qualquer segredo **não retorna nada** no código versionado; `.env.example` só tem chaves
    `VITE_*` sem valores reais; `.env` está no `.gitignore`.
13. **CA-13 — Lockfile:** o lockfile (`package-lock.json`) está presente e versões estão
    fixadas.
14. **CA-14 — Sem dados/RLS:** `supabase/migrations/` não contém nenhum `.sql` de schema;
    nenhuma tabela/RLS foi criada (confirmação negativa do escopo).

---

## 6. Fronteiras invioláveis (herdadas pelas fases seguintes)

Estas travas **não** são implementadas agora (não há dados), mas o scaffold **não pode
contradizê-las** e elas ficam registradas para quem for materializar o backend:

1. **RLS em TODA tabela de domínio.** Nenhuma tabela com dado de tenant sem política RLS.
2. **`tenant_id` vem do JWT/`profiles`**, via função `current_tenant_id()` (`security
   definer`), **nunca** de parâmetro enviado pelo cliente.
3. **Super admin cross-tenant** só por Edge Function com service role **ou** policy
   `super_admin` explícita e auditada — nunca pelo cliente comum.
4. **RBAC:** `admin` (tudo no tenant), `professional` (só a própria agenda via
   `professional_id`), `receptionist` (agendamentos de todos, **sem** ler `charges`/dados
   financeiros).
5. **Prevenção de conflito de agendamento (RF06):** constraint de exclusão `tstzrange` +
   `btree_gist` no banco **e** validação na app.
6. **Webhooks (RNF04):** idempotência por `gateway_charge_id` + id do evento; verificação de
   autenticidade (assinatura/token) antes de processar; fila de retentativa para WhatsApp.
7. **Segredos:** service role, chave Asaas, token Evolution e segredos de webhook só em
   Edge Functions / env do Supabase — **nunca** no bundle do cliente. No cliente, só a anon
   key pública via `VITE_*`.
8. **LGPD:** `whatsapp_opt_in` antes de qualquer disparo; minimizar PII em logs.

**Impacto direto no scaffold (o que PRECISA estar certo já):** itens 7 e 2. O cliente
Supabase inicializado agora deve usar exclusivamente `VITE_SUPABASE_ANON_KEY`, e nenhuma
variável de segredo privilegiado pode entrar no espaço `VITE_*` (tudo que começa com `VITE_`
é embutido no bundle público pelo Vite). O `.env.example` deve deixar isso explícito com um
comentário.

---

## 7. Validação de entrada e tratamento de erro (do que existe no scaffold)

A única "entrada externa" do scaffold são as variáveis de ambiente `VITE_*` lidas na
inicialização do cliente Supabase. Recomendação concreta para o design/implementação:

- **Validar presença** de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` na criação do
  cliente em `src/lib`. Regras: ambas obrigatórias, string não-vazia; `VITE_SUPABASE_URL`
  deve parecer URL.
- **Comportamento na falha:** se faltar variável, **falhar de forma explícita e cedo** com
  mensagem clara em pt-BR no console (ex.: "Configuração ausente: defina VITE_SUPABASE_URL e
  VITE_SUPABASE_ANON_KEY no arquivo .env — veja .env.example."), em vez de criar um cliente
  quebrado que só falha mais tarde com erro obscuro. Classificação: **fatal** para operações
  de dados, mas **não deve impedir** a navegação pelas rotas-casca (o scaffold tem que ser
  navegável mesmo sem `.env`, pois nenhuma rota faz chamada de dados ainda). Logar em nível
  de erro/aviso; não há dado sensível envolvido (anon key é pública).
- **Zod:** ainda não há formulário nem payload externo real; a validação com zod entra nas
  fases de auth/negócio. No scaffold, uma checagem simples das envs basta — não introduzir
  schema de domínio agora.

**Invariante e dono da enforcement:** a garantia "só anon key no cliente" é de **processo /
revisão de código + `.gitignore`**, não de runtime — porque qualquer `VITE_*` vira público.
Logo, a defesa real é (a) nunca nomear segredo privilegiado como `VITE_*` e (b) o CA-12
(grep por segredos) no QA.

---

## 8. Testabilidade

- **Verificável por build/estático:** CA-01, CA-07, CA-08, CA-11, CA-12, CA-13, CA-14
  (tipos, estrutura de arquivos, grep de segredos, presença de lockfile, ausência de
  migrations).
- **Verificável por integração/manual (dev server + navegador / Chrome DevTools MCP no QA):**
  CA-02 a CA-06 (navegação sem erro no console), CA-09 (dark mode por padrão), CA-10 (pt-BR).
- Não há lógica de dados para teste unitário neste recorte; a suíte de testes automatizados
  não é requisito do scaffold (convenção: testes só quando pedidos).

---

## 9. Enquadramento no roadmap de produto

- **Fase 1 (fundação) — É AQUI.** Scaffold navegável, convenções travadas, cliente Supabase
  e TanStack Query montados. Sem dados, sem auth real, sem RBAC real.
- **Fase 2 (próximas):** migrations do domínio (tenants, profiles e função
  `current_tenant_id()` primeiro), RLS por tabela, Auth real do Supabase, guards de RBAC e de
  status de assinatura, telas reais de agenda/clientes.
- **Fase 3 (fora do MVP):** link público de autoagendamento, taxa de reserva antecipada,
  painel de métricas consolidadas — **não implementar** salvo pedido explícito.

O scaffold deve deixar os pontos de extensão óbvios: `supabase/migrations` e
`supabase/functions` vazias, `src/lib` pronto para ganhar clientes Asaas/Evolution, `src/app`
e `src/admin` separados para o isolamento tenant↔admin que vem depois.

---

## 10. Pontos do usuário — nenhum descartado

O usuário escolheu o recorte "b" (esqueleto navegável) e, nas mensagens, levantou
**custo baixo de infra** (mensagens 7–8: "deixar com um custo mais low"; questionou Postgres
por receio de custo). Registro e resposta:

- A stack travada é **Supabase (PostgreSQL + Auth + RLS + Edge Functions)** no tier gratuito/
  serverless + frontend estático (Vercel/Cloudflare Pages). O "Postgres custoso" do receio do
  usuário se refere a Postgres gerenciado dedicado; **o Supabase cobre PostgreSQL dentro do
  modelo BaaS de custo ~zero** no início, atendendo o objetivo de negócio. A dúvida sobre
  Firebase (mensagem 7) já foi decidida a favor do Supabase nas steering (`stack.md`) — RLS
  nativo para multi-tenant é a justificativa; não reabrir sem pedido explícito.
- Esse ponto **não afeta o scaffold** (nenhum banco é provisionado agora), mas fica
  registrado para não reabrir a decisão.

Nenhum outro ponto do usuário foi descartado.

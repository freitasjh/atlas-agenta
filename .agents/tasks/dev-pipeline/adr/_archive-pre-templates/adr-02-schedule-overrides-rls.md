# ADR-02 — Tabela `schedule_overrides` (exceções por data) com RLS/RBAC

**Status:** proposto

## Contexto

O usuário pediu (mensagem 11.1, "os dois") que a agenda contemple **exceções por data** além da
vigência: folga/feriado (bloqueio total) e horário atípico (janela diferente da grade recorrente
num dia específico). Hoje não existe entidade para isso — a grade (`working_hours`) só modela a
recorrência semanal.

As análises (data §6.2/§6.3, frontend D1) e o PRD §2.1/§4 fixam a modelagem: **nova tabela de
domínio `schedule_overrides`**, multi-tenant, com RLS habilitado e RBAC **espelhando
`working_hours`** (padrão já existente na migration `20250217090000_operational_catalog.sql`):

- `tenant_id` nunca vem do cliente — `default current_tenant_id()`, FK para `tenants`, índice e
  policies USING + WITH CHECK ancoradas em `current_tenant_id()` (RNF-SEG-01/02).
- **SELECT** para qualquer papel do tenant (a recepção precisa ver disponibilidade para marcar).
- **WRITE admin** para qualquer profissional do tenant.
- **WRITE professional** só para o profissional cujo `profile_id = auth.uid()` (espelha
  `working_hours_write_own_professional`).
- **receptionist** sem policy de escrita → só leitura. **super_admin** sem caminho cross-tenant aqui.

Decisões de modelagem (data §6.2, aprovadas no PRD §2.1/§9 ponto 4):

- **Uma exceção por `(tenant_id, professional_id, override_date)`** (`unique`): evita ambiguidade de
  qual janela vale (AC-07).
- `is_closed bool` + janela única cobre os dois casos: fechado (folga/feriado, sem janela) ou aberto
  (janela atípica com break opcional). Paridade com `working_hours` (faixa única + break).
- Datas em `date` (dia de calendário no fuso do tenant), horas em `time` (`HH:MM`) — conversão para
  UTC só na geração de slots (ADR-05), `RNF-SEG-05`.
- CHECK de coerência que espelha `working_hours_window`/`working_hours_break_coherent`: fechado não
  tem janela; aberto exige `start_time < end_time` e break ambos-ou-nenhum dentro da janela.
- **"Feriado do tenant inteiro"** fica **fora do MVP** (PRD §2.3 / §9 ponto 4) — exceção é por
  profissional/data; não criar `tenant_holidays`.
- FK **composta** `(tenant_id, professional_id)` → `professionals (tenant_id, id)` fecha o buraco
  cross-tenant no schema (mesmo padrão de `working_hours`).

Migration nova, timestamp posterior a ADR-01, idempotente, sem segredos.

## Decisão

Criar a migration `supabase/migrations/20250221091000_schedule_overrides.sql` com:

- `create table if not exists schedule_overrides (...)` conforme §6.2 da análise de dados: `id`,
  `tenant_id` (default `current_tenant_id()`, FK `tenants on delete cascade`), `professional_id`,
  `override_date date not null`, `is_closed bool not null default false`, `start_time`/`end_time`/
  `break_start`/`break_end` (`time`, nulos quando fechado), `reason text` (≤ 200 chars, rótulo
  opcional não-PII), `created_at timestamptz default now()`.
- Constraints: FK composta `schedule_overrides_professional_fk`; `schedule_overrides_unique
  unique (tenant_id, professional_id, override_date)`; CHECK `schedule_overrides_window` (fechado
  sem janela / aberto com janela coerente e break dentro da janela).
- Índices: `schedule_overrides_tenant_id_idx (tenant_id)` e
  `schedule_overrides_tenant_professional_date_idx (tenant_id, professional_id, override_date)`.
- `alter table schedule_overrides enable row level security;`
- Policies (todas com `drop policy if exists` antes do `create`, idempotente):
  `schedule_overrides_select_same_tenant` (SELECT, `tenant_id = current_tenant_id()`);
  `schedule_overrides_write_admin` (ALL, admin); `schedule_overrides_write_own_professional`
  (ALL, professional com `exists` em `professionals` por `profile_id = auth.uid()`). Sem policy para
  receptionist (só leitura) nem super_admin.

Decisão de arquitetura durável (nova tabela de domínio + contrato RLS/RBAC); candidata a `docs/`
depois do run — não copiar agora.

## Consequências

- **Positivas:** exceções por data isoladas por tenant com o mesmo rigor de RLS/RBAC do catálogo; a
  geração de slots (ADR-05) tem o insumo de exceções pronto; `unique` evita ambiguidade.
- **Custos/limitações:** uma janela por dia (sem múltiplas faixas atípicas no mesmo dia, paridade com
  a grade); feriado do tenant inteiro fica para fase futura.
- **Risco controlado:** CHECK + `unique` + RLS no banco são a trava; zod (ADR-03) espelha mas não
  substitui.

### Escopo

Dados (apenas Supabase/migration).

### Arquivos / pastas afetados

- `supabase/migrations/20250221091000_schedule_overrides.sql` (novo).

### Critérios de aceite testáveis (desta ADR)

Via `supabase start`, sessões autenticadas de papéis/tenants distintos:

- **AC-01 (isolamento):** usuário do tenant A não lê nem escreve `schedule_overrides` do tenant B
  (select → 0 linhas; insert com `professional_id` de B → erro RLS).
- **AC-02 (tenant do servidor):** insert sem `tenant_id` grava com o tenant do JWT; tentar gravar com
  `tenant_id` de outro tenant é barrado pelo WITH CHECK.
- **AC-03 (admin):** `admin` cria/edita exceção de qualquer profissional do tenant.
- **AC-04 (professional):** `professional` cria/edita exceção **só** do profissional ligado ao seu
  `profile_id`; exceção de outro profissional é negada por RLS.
- **AC-05 (receptionist):** `receptionist` **lê** exceções e **não** grava (sem policy de escrita).
- **AC-06 (coerência):** `is_closed=true` com janela preenchida é rejeitado; `is_closed=false` sem
  janela, ou com break fora da janela, é rejeitado.
- **AC-07 (unicidade):** dois inserts para o mesmo `(professional_id, override_date)` falham no
  `unique`.
- **Re-apply / verificação:** `npx supabase db reset` aplica ADR-01 e ADR-02 em ordem sem erro;
  rodar a migration duas vezes não falha.

### Dependência

Depende de **ADR-01** apenas por ordem de timestamp (ambas são migrations novas na mesma leva).
Depende do schema aplicado: `professionals`/`tenants` e helpers `current_tenant_id()`/
`current_role_name()`. Não depende das colunas de ADR-01 em runtime, mas migra **depois** dela.

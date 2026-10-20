# Parecer de Revisão Independente A — ADR-02: Tabela `schedule_overrides` (exceções por data) com RLS/RBAC

**Revisor:** Independente A (code review, aderência a critérios, contraprova build/lint)  
**ADR:** adr-02-schedule-overrides-rls.md  
**Escopo:** Migrations SQL — `20250221090000_professionals_schedule_vigencia.sql` (ADR-01) e `20250221091000_schedule_overrides.sql` (ADR-02)  
**Status:** ✓ **APROVADO** — Nenhuma questão bloqueante identificada.

---

## Sumário

A ADR-02 propõe uma nova tabela de domínio `schedule_overrides` para modelar exceções por data (folga/feriado/horário atípico) na agenda de cada profissional. A implementação via duas migrations (ADR-01 estende `professionals`; ADR-02 cria a tabela nova) está **bem formada**: isolamento multi-tenant correto (`tenant_id not null default current_tenant_id()`, RLS habilitado, FK composta), RBAC espelhando `working_hours` (select any, write admin/own-professional, receptionist read-only), coerência de dados (CHECKs de janela, unicidade, idempotência) e nenhum segredo exposto. Migrations são idempotentes e não alterarão aplicadas. Build e typecheck passaram. A ADR satisfaz todos os critérios de aceite numerados (AC-01 a AC-07) e as regras de segurança (RNF-SEG-01..08).

---

## Detalhes

<details>
<summary>Issues (0)</summary>

Nenhum bloqueante. Aprovado para QA ao vivo.

</details>

### Isolamento multi-tenant (RNF-SEG-01, AC-01, AC-02)

A tabela `schedule_overrides` nasceu com `tenant_id uuid not null default current_tenant_id()`, FK para `tenants` em cascade, índice por tenant e RLS habilitado. A função helper `current_tenant_id()` (já existente, stages anteriores) garante que o tenant vem sempre do JWT (`profiles.tenant_id`), nunca do cliente. Nenhum caminho para fornecer `tenant_id` divergente — a coluna recebe o padrão e as policies (WITH CHECK) barram inserção de linha de outro tenant.

A FK composta `(tenant_id, professional_id) → (professionals.tenant_id, id)` é o padrão existente em `working_hours` (ADR-02 §6.2 menciona isso como deliberado). Fecha o buraco: um `professional_id` sozinho não garante isolamento; com `tenant_id` de chave composta, impede que um INSERT de um tenant referencie um profissional de outro tenant.

**Confirmado:** AC-01 (isolamento) e AC-02 (tenant_id do servidor) implementados corretamente.

### RBAC e controle de escrita (RNF-SEG-03, AC-03, AC-04, AC-05)

Quatro policies criadas (com `drop policy if exists` para idempotência):

1. **SELECT** — `schedule_overrides_select_same_tenant`: qualquer papel (`tenant_id = current_tenant_id()`). Recepção precisa ler disponibilidade para marcar; professor lê as próprias exceções; admin as de todos no tenant.

2. **WRITE admin** — `schedule_overrides_write_admin`: restringe a `current_role_name() = 'admin'`. Admin escreve exceção de qualquer profissional do tenant. USING + WITH CHECK ambos verificam tenant e papel, redundância intencional (defesa em profundidade).

3. **WRITE professional** — `schedule_overrides_write_own_professional`: restringe a papel professional E verifica `exists (select 1 from professionals p where p.id = schedule_overrides.professional_id and p.profile_id = auth.uid() and p.tenant_id = current_tenant_id())`. Garante que o professional só escreve exceção do profissional cujo `profile_id` é o dele (auth.uid()).

4. **receptionist** — sem policy de escrita → leitura apenas.

**AC-03, AC-04, AC-05 confirmados.** Padrão espelha `working_hours` (policy `working_hours_write_own_professional` usa a mesma cláusula de verif exists; ADR-01 conserva o mesmo pattern, sem nova policy porque os campos não mudam o RLS).

### Coerência de dados (AC-06, AC-07, AC-08)

**AC-06 — Coerência de janela:**
```sql
constraint schedule_overrides_window check (
  (
    is_closed = true
    and start_time is null and end_time is null
    and break_start is null and break_end is null
  )
  or (
    is_closed = false
    and start_time is not null and end_time is not null
    and start_time < end_time
    and (
      (break_start is null and break_end is null)
      or (
        break_start is not null and break_end is not null
        and start_time <= break_start
        and break_start < break_end
        and break_end <= end_time
      )
    )
  )
)
```
Espelha exatamente os CHECKs de `working_hours` (constraints `working_hours_window` e `working_hours_break_coherent`): fechado (XOR) sem janela; aberto com janela coerente (start < end) e break ambos-ou-nenhum dentro da janela. Valida a intenção da ADR §2, RF-AG-02.

**AC-07 — Unicidade:**
```sql
constraint schedule_overrides_unique unique (tenant_id, professional_id, override_date)
```
Uma exceção por profissional/data. Evita ambiguidade: se houvesse duas exceções para o mesmo (professional, data), qual janela valeria? A unicidade + tenant_id garante precisão.

**AC-08 — Coerência de vigência:** Aplica-se a ADR-01 (`professionals.slot_step_minutes`, `schedule_start_date`/`schedule_end_date`). ADR-01 implementa:
```sql
add constraint professionals_schedule_vigencia_coherent
check (
  schedule_start_date is null
  or schedule_end_date is null
  or schedule_start_date <= schedule_end_date
);
add column if not exists slot_step_minutes int not null default 30
  check (slot_step_minutes between 5 and 240);
```
Quando ambas as datas estão presentes, início ≤ fim. Passo-base entre 5 e 240 min. Correto.

**Confirmado:** AC-06, AC-07, AC-08.

### Datas, horas e fuso (RNF-SEG-05)

Decisão de design bem aplicada:
- `override_date` em `date` (dia de calendário no fuso do tenant, ex.: `2025-02-21` para `America/Sao_Paulo`), **não** `timestamptz`.
- `start_time`, `end_time`, `break_start`, `break_end` em `time` (`HH:MM`), **não** `timestamptz`.
- `created_at` em `timestamptz` (UTC, tracking de mutação).

A conversão de `(date, time)` + `tenants.timezone` para instante UTC (`timestamptz`) é delegada à camada de app/geração de slots (ADR-05, `src/lib/datetime.ts`). Essa estrutura evita ambiguidade em DST (uma data+hora no fuso do tenant pode ter dois instantes UTC em transição de horário de verão; o cálculo acontece na borda onde o fuso é conhecido).

**Confirmado:** RNF-SEG-05 (RFC 5545 para recorrência também segue esse padrão: datas em local, com timezone associado, conversão na ponta).

### Migrations: Idempotência e ordem (RNF-SEG-06)

**ADR-01** (`20250221090000_professionals_schedule_vigencia.sql`):
```sql
alter table professionals
  add column if not exists schedule_start_date date,
  add column if not exists schedule_end_date   date,
  add column if not exists slot_step_minutes    int not null default 30
    check (slot_step_minutes between 5 and 240);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'professionals_schedule_vigencia_coherent'
      and conrelid = 'professionals'::regclass
  ) then
    alter table professionals add constraint ...
  end if;
end $$;
```
**Idempotência:** `add column if not exists` reapply sem erro; constraint guarda `if not exists` no DO bloco (método padrão para constraints, que não têm `if not exists` nativo em SQL).

**ADR-02** (`20250221091000_schedule_overrides.sql`):
```sql
create table if not exists schedule_overrides (...)
create index if not exists schedule_overrides_tenant_id_idx ...
drop policy if exists schedule_overrides_select_same_tenant on schedule_overrides;
create policy schedule_overrides_select_same_tenant on schedule_overrides for select ...
```
**Idempotência:** `create table if not exists` reutiliza; índices `if not exists` reusam; `drop policy if exists` + `create policy` sem risco no re-apply.

**Ordem:** ADR-01 (20250221090000) altera `professionals` que já existe; ADR-02 (20250221091000) cria `schedule_overrides` que referencia `professionals`. Sem dependência circular.

**Confirmado:** RNF-SEG-06 (schema versionado, never edit applied, idempotente).

### Sem segredos (RNF-SEG-07)

Nenhuma chave de API, URL, token ou PII no SQL. O campo `reason` tem `check (reason is null or char_length(reason) between 1 and 200)` — rótulo opcional (ex.: "Feriado", "Reunião"), não dados pessoais. Recomendação: a app (ADR-03/04) validará zod para respeitar isso na borda, mas a trava é o CHECK.

**Confirmado:** RNF-SEG-07.

### Validação no cliente (RNF-SEG-08)

ADR-02 não inclui schemas zod (é dados; zod vem em ADR-03). A análise-data §9 recomenda validação zod refletindo CHECKs: vigência (datas ISO, início ≤ fim), exceção (`is_closed`, janela coerente, break ambos-ou-nenhum), `reason` ≤200 chars. O zod fica em ADR-03.

**Confirmado:** RNF-SEG-08 (responsabilidade mapeada corretamente à ADR-03).

### Modelos de dados e relações (dominio.md alignment)

- `schedule_overrides.tenant_id` FK `tenants.id` em cascade ✓
- `schedule_overrides.(tenant_id, professional_id)` FK composta `professionals.(tenant_id, id)` em cascade ✓
- `professionals.id` PK, `professionals.tenant_id` parte da FK composta ✓
- Sem alteração em `services`, `appointments`, `customers` ✓
- Sem materialização de slots (restrição dura da demanda) ✓

**Confirmado:** Alinhamento com dominio.md.

### Contraprova: Build e typecheck

- `npm run typecheck` (tsc -b) — **exit 0** ✓
- `npm run build` (vite build) — **exit 0** ✓

Nenhum `.sql` é verificado em tempo de build TS (corretto: SQL é verificado em tempo de apply pelo Postgres). As migrations são SQL puro, bem-formadas.

**Confirmado:** Build limpo.

### Fronteiras de segurança

| Fronteira | Regel | Status |
|-----------|-------|--------|
| **Isolamento multi-tenant (RLS)** | `tenant_id` sempre do JWT, RLS em toda tabela de domínio | ✓ `tenant_id default current_tenant_id()`, RLS enabled, FK composta |
| **RBAC** | `admin` tudo, `professional` próprio, `receptionist` read-only | ✓ 3 write-policies + 1 select-all, sem receptionist write |
| **Status de assinatura** | `bloqueado`/`cancelado` bloqueia escrita operacional | N/A (guard de `/app` já existente; ADR-02 herda) |
| **Não-sobreposição** | Constraint `appointments_no_overlap` inalterada | ✓ Não tocada |
| **Tempo em UTC** | `timestamptz` UTC, conversão fuso na borda | ✓ `date/time` local + `created_at timestamptz` |
| **Segredos** | Só `anon key` no cliente, service role em Edge | ✓ Nenhum segredo em SQL |
| **LGPD / PII** | `whatsapp_opt_in`, PII mínima em log | N/A (sem disparo em ADR-02; `reason` não-PII) |

Todas confirmadas ou N/A (herdadas).

### Documentação da ADR

A ADR-02.md em `adr-02-schedule-overrides-rls.md` está bem escrita: cabeçalho claro do contexto, decisões de modelagem bem explicadas (por que `is_closed` + faixa única), padrão de RLS espelhando `working_hours`, critérios de aceite numerados (AC-01..07), dependência com ADR-01, arquivos afetados mapeados. As migrations SQL têm comentários inline detalhados. Nada vago.

**Confirmado:** Documentação de qualidade.

---

## Observações

1. **Padrão coerente com working_hours:** As políticas e constraints espelham exatamente o padrão de `working_hours` (migration 20250217090000). Isso torna a superfície da API de dados previsível e testável.

2. **FK composta — defesa robusta:** A FK composta `(tenant_id, professional_id)` é uma decisão excelente que torna impossível (no schema) um professional_id de outro tenant vazar. Sem isso, teríamos de contar unicamente na RLS + WITH CHECK, que é defesa em software; uma constraint estrutural é mais forte.

3. **Idempotência bem aplicada:** O padrão de `drop policy if exists` antes de `create policy` é o correto para RLS (policies não têm `if not exists` nativo). O DO bloco para a constraint é engenharia defensiva sólida.

4. **Escopo bem demarcado:** ADR-02 é puramente dados. Frontend, validação zod, geração de slots, UI de calendário vêm em ADR-03..08. Nenhuma contaminação de camadas.

---

## Conclusão

ADR-02 está **bem formada**, **aprovada para QA ao vivo** e **pronta para prosseguimento às ADRs seguintes** (ADR-03 tipos/zod, ADR-04 hooks, ADR-05 gerador, ADR-06 UI).

Nenhuma questão bloqueante. Migrations são idempotentes, RLS/RBAC robusto, segurança e isolamento multi-tenant respeitados, convenções seguidas, build limpo.

**Veredito: APROVADO**

---

**Data:** 2025-02-21  
**Revisor:** Independente A

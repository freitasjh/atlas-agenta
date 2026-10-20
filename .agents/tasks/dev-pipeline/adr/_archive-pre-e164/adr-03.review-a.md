# Revisão Independente A — ADR-03 (Revisor: Revisor-A)

**Status:** ✅ **APROVADO SEM RESSALVAS**

**Data da revisão:** 2026-10-18  
**Escopo revisado:** Migration `supabase/migrations/20250220091000_messages.sql` (tabela `messages` com FKs compostas, índice de dedupe parcial, RLS/RBAC, write exclusivo de service role)

---

## Resumo Executivo

A migration cria a tabela `messages` conforme especificado na ADR-03 com implementação sólida de isolamento multi-tenant, integridade de dados e prevenção de corrupção de idempotência.

**Destaques positivos:**
- Schema está 100% em conformidade com o domínio e os critérios de segurança multi-tenant.
- FKs compostas `(tenant_id, id)` estão presentes e funcionando (validadas em teste de cross-tenant — rejeitam inserção de mensagem com cliente de outro tenant).
- Índice de dedupe único **parcial** (exclui `status='falha'`) está criado corretamente, resolvendo a concorrência e permitindo retry legítimo após bloqueio por opt-in.
- RLS com políticas restritivas: SELECT apenas por `tenant_id + papel` (admin/receptionist/professional), **zero policies de INSERT/UPDATE/DELETE** — trava que impede forjaria de envios ou pulo de opt-in/idempotência.
- Pré-requisito ADR-01 (`unique (tenant_id, id)` em `appointments`) foi aplicado corretamente na migration `20250220089000_appointments_tenant_unique.sql` e o alvo existe para a FK composta.
- Migrations são idempotentes (reutilizáveis em reset).
- Sem segredos no SQL; comentários abundantes e precisos explicam as decisões e as invariantes.

**Validações rodadas:**
- ✅ `npm run build` — limpo.
- ✅ `npm run typecheck` — limpo.
- ✅ Schema PostgreSQL intacto e funcional.
- ✅ RLS habilitado com políticas corretas.
- ✅ FKs compostas barram cross-tenant (teste: tentativa de inserir message do Tenant A com customer do Tenant B foi rejeitada pela constraint).
- ✅ Índices presentes e com cobertura correta.
- ✅ Sem segredos no bundle (`grep -r "VITE_.*secret"` retorna vazio).

---

## Critérios de Aceite Verificados

| Critério (da ADR-03) | Status | Evidência |
|---|---|---|
| **A1**: Reset limpo, idempotente, migrations em ordem | ✅ | Schema `messages` criado; `if not exists`, `drop policy if exists` presentes. |
| **A2**: RLS habilitado, índice em tenant_id, default current_tenant_id | ✅ | `pg_tables.rowsecurity='t'`, `messages_tenant_id_idx` existe, coluna `tenant_id` tem default. |
| **A3**: Inserir message com customer/appointment de outro tenant é rejeitado por FK | ✅ | Teste: FK composta rejeitou `(tenant_id=A, customer_id∈B)` com erro de constraint. |
| **A4**: Leitura isolada (usuário A não lê dados de B) | ✅ (por design) | Policy SELECT filtra por `tenant_id = current_tenant_id()`. RLS garantirá isolamento em runtime. |
| **A5**: Nenhum papel consegue INSERT direto em messages pelo cliente | ✅ | Zero policies de INSERT/UPDATE/DELETE em `messages`. Cliente só lê via SELECT policy. |
| **A6**: Índice único parcial `messages_dedupe_uidx` existe e cobre apenas status ∈ fila/enviado/entregue | ✅ | `pg_indexes`: `messages_dedupe_uidx on (tenant_id, dedupe_key) where status = ANY (...)` confirmado. |

---

## Análise Comportamental

### Isolamento Multi-Tenant (RNF03)

A tabela materializa o padrão travado nas fases anteriores:
- `tenant_id` com `default current_tenant_id()` (derive do JWT/profiles, nunca do cliente).
- FK composta `(tenant_id, customer_id)` força coerência no schema — uma `messages` só casa com customer do **mesmo** tenant.
- RLS policy de SELECT: `tenant_id = current_tenant_id() AND current_role_name() IN (...)` — duas camadas de filtragem (coluna + papel).
- Nenhuma policy de WRITE: cliente **nunca** insere/atualiza em `messages` diretamente.

**Confirmed**: qualquer tentativa de cross-tenant (forjar um registro com `tenant_id` falso ou customer de outro tenant) é negada no banco, não na UI.

### Idempotência de Envio (RNF04 parcial)

O índice único parcial `messages_dedupe_uidx` resolve a concorrência:

```sql
create unique index messages_dedupe_uidx on messages (tenant_id, dedupe_key)
where status in ('fila','enviado','entregue');
```

Semântica correta:
- Dois envios simultâneos do mesmo `(tenant_id, dedupe_key)` causarão violação única no banco — a **trava real** sob corrida.
- Exclusão de `status='falha'` permite que um disparo falho (ex.: `opt_in_ausente`) **não** trave uma tentativa legítima futura após o opt-in ser concedido.
- A composição da `dedupe_key` (`template || ':' || coalesce('a:' || appointment_id, 'c:' || customer_id)`) fica na Edge Function (ADR-04), não em SQL — mantém a lógica no servidor e o schema simples.

**Confirmed**: índice parcial é o padrão correto para idempotência com retry permitido.

### PII Mínima em Log (RNF03/LGPD)

Colunas que poderiam conter PII:
- `payload`: descrito como "texto renderizado/metadados, **sem telefone/PII em claro**". O vínculo ao destino é `customer_id` (FK); número lido de `customers` no servidor, não duplicado aqui.
- `failure_reason`: descrito como "técnico curto, **sem PII**".

O schema não força isso (é invariante de semântica/Edge Function), mas os comentários fixam a intencionalidade. O QA de ADR-04 (Edge Function) vai validar a implementação concreta.

**Confirmado em schema**: as colunas existem e os comentários declaram a restrição; enforcement fica na function.

### RBAC de Leitura (não-financeiro)

Policy de SELECT autoriza `admin`, `receptionist`, `professional` — não há recorte por profissional ou restrição de `receptionist` para "não ler financeiro":

```sql
where (
  tenant_id = current_tenant_id()
  and current_role_name() in ('admin','receptionist','professional')
)
```

Racional (da análise): `messages` é **log de comunicação**, não dado financeiro (como `charges`). Logo `receptionist` pode ler. Recorte por profissional é fase futura (não antecipado).

**Confirmado**: a política está correta para a fase. Super admin não tem caminho de leitura (esperado — fase futura).

### Convenções e Integridade

- **Inglês/snake_case/plural:** ✓ tabela `messages`, colunas `tenant_id`, `customer_id`, `provider_message_id`, `created_at`.
- **Timestamps UTC:** ✓ `created_at timestamptz not null default now()`.
- **Sem defaults inseguros:** ✓ `tenant_id default current_tenant_id()` é a função helper de Fase 2, nunca um valor literal.
- **Checks de enum:** ✓ `channel in ('whatsapp')`, `template in (...)`, `status in (...)`.
- **Comentários abundantes:** ✓ O SQL tem ~60 linhas de comentário explicando as decisões (pré-requisitos, idempotência, PII, RBAC, etc.).

---

## Testes Realizados

### Teste 1: Validação de Build e Typecheck
```bash
npm run typecheck  → Exit 0 ✅
npm run build      → Exit 0 ✅
```

### Teste 2: Schema PostgreSQL e Constraints
```bash
SELECT * FROM pg_tables WHERE tablename='messages' and schemaname='public'
→ rowsecurity = true ✅
→ indices presentes (5 índices) ✅
→ constraints presentes (3 FKs: customer_fk, appointment_fk, tenant_fkey) ✅
```

### Teste 3: Índice de Dedupe Parcial
```bash
SELECT indexdef FROM pg_indexes WHERE indexname='messages_dedupe_uidx'
→ CREATE UNIQUE INDEX messages_dedupe_uidx ON public.messages 
  USING btree (tenant_id, dedupe_key) 
  WHERE (status = ANY (ARRAY['fila'::text, 'enviado'::text, 'entregue'::text])) ✅
```

### Teste 4: FK Composta Barra Cross-Tenant
```sql
-- Criar dois tenants, customers, appointments
INSERT INTO tenants (...) VALUES (Tenant A, Tenant B)
INSERT INTO customers (...) VALUES (Customer A, Customer B)

-- Tentar inserir message do Tenant A com customer do Tenant B
INSERT INTO messages (tenant_id, customer_id, ...)
VALUES ('11111111...A', 'bbbbbbbb...B', ...)
→ ERROR: foreign key constraint "messages_customer_fk" violated
  Key (tenant_id, customer_id)=(11111111...A, bbbbbbbb...B) not present ✅
```

### Teste 5: Pré-requisito ADR-01 Aplicado
```bash
SELECT constraint_name FROM information_schema.table_constraints 
WHERE table_name='appointments' AND constraint_type='UNIQUE'
→ appointments_tenant_id_unique ✅
```

### Teste 6: Segredos Não Vazados
```bash
grep -r "VITE_.*secret\|VITE_.*key\|VITE_.*token" src/
→ [vazio] ✅
```

---

## Observações (não-bloqueantes, apenas contextuais)

1. **Dependência de ADR-04 para funcionalidade completa:** A migration cria o schema correto, mas o acesso real à tabela ocorre via Edge Function (ADR-04) que:
   - Grava em `messages` com `dedupe_key` composto.
   - Valida opt-in antes de disparar.
   - Trata a idempotência.
   
   A migration sozinha é **incompleta funcionalmente**, mas está **estruturalmente correta**. O QA da ADR-04 vai validar a integração.

2. **PII em payload é invariante de semântica:** Os comentários declaram "sem telefone em claro", mas o schema não força (nem poderia — é metadata livre). O QA da ADR-04 vai verificar que a Edge Function não loga PII. Isso não é falha da migration.

3. **Polling de status em `/app/config/whatsapp` (ADR-06):** A migration não precisa fazer nada; é responsabilidade do frontend. Registrado só para clareza.

---

## Aprovação

✅ **Aprovado**

A migration de ADR-03 está **pronta para merge**. Implementa corretamente:
- Isolamento multi-tenant com RLS + FKs compostas.
- Idempotência com índice único parcial.
- Ausência de policy de write cliente (trava de integridade).
- Convenções de schema (inglês, timestamps UTC, checks de enum).
- Idempotência de migration (re-apply seguro).

Nenhum defeito ou omissão bloqueia a aprovação. O contexto de ADR-04 (Edge Function) e ADR-05+ (frontend) dependerá deste schema estar correto — e está.

---

**Parecer assinado:** Revisor-A  
**Data:** 2026-10-18

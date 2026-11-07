# ADR-001 — Schema: ledger `appointment_payments`, `charges` gateway-only, unicidade, RLS/grants e backfill

- **Status**: todo
- **Data**: 2026-11-06
- **PRD**: cobranca-formas-pagamento (RF-01..RF-29; RNF-05, RNF-06, RNF-07, RNF-09, RNF-10)
- **Decisões cobertas**: D1, D2, D5, D6, D8, D9; ambiguidades §14 #5 (troco não persistido),
  #6 (máx. 1 PIX por atendimento), #11 (total zero), #12 (estorno lógico)
- **depende-de**: —
- **ADRs dependentes**: ADR-002, ADR-003, ADR-004, ADR-005

## Contexto

Hoje `charges` é a única estrutura financeira por atendimento e acumula dois papéis:
**cobrança PIX no Asaas** e **receita recebida**. O unique atual é global por `appointment_id`
(`charges_appointment_id_uidx`, `20250306100000_asaas_charges.sql:53`), a RLS é admin-only
(linhas 74-77) e a receita do painel lê `status='pago'`. Isso impede dinheiro/cartão/maquininha,
split, parcial e gorjeta, e mistura “a receber” com “recebido”.

O RESEARCH (Alternativa B) recomenda separar:

- `charges` = cobrança PIX do gateway (intenção/reserva; `pago` é estado do gateway).
- `appointment_payments` = ledger imutável do que foi **efetivamente recebido** (fonte única de
  receita).

Esta ADR congela o schema, as restrições, a RLS, os grants e o backfill. As regras de escrita
(RPC/Edge) ficam na ADR-002; a criação/cancelamento no gateway fica na ADR-003.

## Decisão

### 1. Nova tabela `public.appointment_payments` (ledger 1:N)

Uma linha = uma parcela recebida de um atendimento, com método, valor de serviço, gorjeta,
origem, chave de idempotência e estorno lógico. A tabela **não** guarda cobrança pendente, QR,
copia-e-cola, dados de cartão, troco ou valor entregue em dinheiro.

Regras semânticas:

- `amount_cents` é a parte **serviço** recebida; `tip_cents` é gorjeta explícita, separada.
- `source='manual'` para dinheiro/cartão/maquininha/baixa manual; `source='asaas'` para
  recebimento confirmado pelo gateway (webhook) e para o backfill.
- `idempotency_key` + `line_index` identificam a linha dentro de um lote de fechamento.
  Webhook e backfill usam `idempotency_key = null`.
- `charge_id` só existe em `pix_sistema` (recebimento vindo de cobrança do gateway). O unique
  por `charge_id` garante “um recebimento por cobrança”, inclusive contra webhook duplicado.
- `voided_at`/`voided_by`/`void_reason` são o **estorno lógico**: a linha permanece, sai das somas
  de receita e o saldo do atendimento volta a subir. Edição e exclusão são proibidas (sem grant;
  escrita só por RPC service role).
- `received_at` é o instante do **recebimento/lançamento** (caixa), não o da conclusão. Para
  lançamento posterior, é `now()`; para webhook, o instante do evento/`paid_at`; para backfill,
  `coalesce(charges.paid_at, charges.created_at)`.
- Total zero: nenhuma linha é aceita (`amount_cents > 0`); a conclusão sem pagamento é permitida
  e o settlement classifica como `quitado` com 0 linhas (ambiguidade #11, detalhada na ADR-002).

### 2. Unicidade e índices

- **Um PIX do sistema ativo por atendimento** (ambiguidade #6, revisada em 2026-11-06): expirado/cancelado pode ser reemitido na mesma linha; **pago nunca**. O unique
  global existente em `charges (appointment_id)` é substituído por um unique **parcial por
  tenant** em `(tenant_id, appointment_id) where appointment_id is not null`. Um segundo PIX no
  mesmo atendimento é rejeitado no banco, não só na aplicação. A única exceção é `appointment_id
  is null` (cobranças de assinatura, que não pertencem a atendimento).
  > O plano falava em unique parcial “de pendente”. Ele foi **substituído por este cap mais
  > forte**: com “no máximo 1 por atendimento, mesmo após paga”, um índice só de `pendente`
  > permitiria uma segunda cobrança após a primeira ser paga — exatamente o que o PRD veta.
- **Um recebimento por cobrança**: unique parcial `(tenant_id, charge_id) where charge_id is not
  null`. Impede que webhook + baixa manual + backfill criem duas linhas para a mesma cobrança.
- **Idempotência do lote**: unique parcial `(tenant_id, idempotency_key, line_index) where
  idempotency_key is not null`. Replay do mesmo lote não duplica; payload divergente na mesma
  chave é tratado na ADR-002 (`409 IDEMPOTENCY_CONFLICT`).
- **Fks compostas por tenant** exigem alvo único: `charges (tenant_id, id)` passa a ter unique
  próprio e `charges (tenant_id, id, appointment_id)` ganha unique para a FK do vínculo do
  ledger. A FK da cobrança é `(tenant_id, charge_id, appointment_id) → charges (tenant_id, id,
  appointment_id)`: a linha do ledger só aponta para cobrança **do próprio atendimento**. Com
  `charge_id` nulo a FK não é verificada (MATCH SIMPLE); cobrança com `appointment_id` nulo
  (assinatura) nunca casa. `profiles (tenant_id, id)` já possui
  `profiles_tenant_id_id_unique` na migration `20250307090000_profiles_active_audit_adr001.sql`
  (nada a criar; verificado no disco).
- **Consulta**: `(tenant_id, appointment_id)`; `(tenant_id, received_at) where voided_at is null`;
  `(tenant_id, method, received_at) where voided_at is null`; `(tenant_id, voided_at) where
  voided_at is not null` para conciliação/auditoria.
- `charges.idempotency_key uuid` + unique `(tenant_id, idempotency_key) where idempotency_key is
  not null` para o retry da criação de cobrança (ADR-003).

### 3. RLS e grants

- `alter table public.appointment_payments enable row level security`.
- **Uma** policy de `select`: admin do próprio tenant
  (`tenant_id = current_tenant_id() and current_role_name() = 'admin'`).
- **Nenhuma** policy de `insert`, `update` ou `delete`. Não existe caminho de escrita para
  `authenticated`/`anon`.
- `revoke all on table public.appointment_payments from anon, authenticated;`
  `grant select on table public.appointment_payments to authenticated;`
  `grant all on table public.appointment_payments to service_role;`
- `charges` mantém a policy admin-only existente e **não** ganha policy nova.
- Recepção e profissional **não** leem a tabela para varredura. Leem o settlement de **um**
  atendimento pela Edge `get-appointment-settlement` (ADR-002), que usa service role e valida
  papel/vínculo antes de responder.
- `tenant_id` da linha nunca vem do cliente: RPC recebe `p_tenant_id` do perfil autenticado
  resolvido na Edge; o default `current_tenant_id()` é defesa para inserts privilegiados que
  esqueçam o valor (falha em `not null` em vez de gravar tenant errado).

### 4. Backfill dos `charges` pagos

- Uma linha por cobrança `status='pago'` com `appointment_id` não nulo:
  `method='pix_sistema'`, `source='asaas'`, `amount_cents=charges.amount_cents`, `tip_cents=0`,
  `received_at=coalesce(paid_at, created_at)`, `received_by=null`, `charge_id=charges.id`.
- Idempotente por `not exists (select 1 ... where tenant_id = c.tenant_id and charge_id = c.id)`.
- Cobranças pagas **sem** `appointment_id` não entram; a migration emite `notice` com a contagem
  para relatório de conciliação.
- Não backfill de `pendente`, `expirado` ou `cancelado`.
- Não recalcular comissão; o trigger de comissão não é tocado.
- A migration valida contagem antes/depois: `linhas_faltantes` (antes) deve ser igual a
  `linhas_inseridas` (depois); divergência aborta a migration.

### 5. Atualização das regras de domínio

Na mesma entrega (ADR-005 detalha o texto):

- `.agents/rules/dominio.md` (e espelho `.kiro/steering/dominio.md`): remover “ao entrar em
  concluído: gera cobrança PIX + mensagem cobrança” e registrar que conclusão **não** cria PIX;
  PIX só por escolha, no valor da parcela, máximo 1 por atendimento.
- Registrar `appointment_payments` como fonte única de receita; `charges` como gateway-only;
  `pago + pendente + novo <= price_cents`; gorjeta fora da receita/comissão; comissão inalterada
  sobre `price_cents` no `concluido`.

## Interface congelada

### DDL resumido (nomes e semântica congelados)

```sql
-- 1) Alvos de FK composta por tenant.
create unique index if not exists charges_tenant_id_id_uidx
  on public.charges (tenant_id, id);
create unique index if not exists charges_tenant_id_id_appointment_uidx
  on public.charges (tenant_id, id, appointment_id);
-- profiles_tenant_id_id_unique já existe (20250307090000) — não recriar.

-- 2) Ledger.
create table if not exists public.appointment_payments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null default current_tenant_id()
                     references public.tenants (id) on delete cascade,
  appointment_id   uuid not null,
  charge_id        uuid,
  method           text not null check (method in (
                     'dinheiro','cartao_credito','cartao_debito',
                     'pix_sistema','pix_maquininha'
                   )),
  amount_cents     int  not null check (amount_cents > 0),
  tip_cents        int  not null default 0 check (tip_cents >= 0),
  source           text not null default 'manual'
                     check (source in ('manual','asaas')),
  idempotency_key  uuid,
  line_index       smallint not null default 0 check (line_index >= 0 and line_index < 50),
  received_at      timestamptz not null default now(),
  received_by      uuid,
  voided_at        timestamptz,
  voided_by        uuid,
  void_reason      text,
  created_at       timestamptz not null default now(),

  constraint appointment_payments_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict,
  constraint appointment_payments_charge_fk
    foreign key (tenant_id, charge_id, appointment_id)
    references public.charges (tenant_id, id, appointment_id) on delete restrict,
  constraint appointment_payments_received_by_fk
    foreign key (tenant_id, received_by)
    references public.profiles (tenant_id, id) on delete restrict,
  constraint appointment_payments_void_consistent check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null
     and void_reason is not null and length(btrim(void_reason)) > 0)
  )
);

-- 3) Unicidade.
create unique index if not exists appointment_payments_idem_uidx
  on public.appointment_payments (tenant_id, idempotency_key, line_index)
  where idempotency_key is not null;

create unique index if not exists appointment_payments_charge_uidx
  on public.appointment_payments (tenant_id, charge_id)
  where charge_id is not null;

-- 4) Cap de 1 PIX por atendimento (substitui o unique global antigo).
drop index if exists public.charges_appointment_id_uidx;
create unique index if not exists charges_tenant_appointment_uidx
  on public.charges (tenant_id, appointment_id)
  where appointment_id is not null;

-- 5) Retry de criação de cobrança.
alter table public.charges add column if not exists idempotency_key uuid;
create unique index if not exists charges_tenant_idem_uidx
  on public.charges (tenant_id, idempotency_key)
  where idempotency_key is not null;

-- 6) Índices de consulta.
create index if not exists appointment_payments_tenant_appointment_idx
  on public.appointment_payments (tenant_id, appointment_id, received_at);
create index if not exists appointment_payments_tenant_received_idx
  on public.appointment_payments (tenant_id, received_at)
  where voided_at is null;
create index if not exists appointment_payments_tenant_method_received_idx
  on public.appointment_payments (tenant_id, method, received_at)
  where voided_at is null;
create index if not exists appointment_payments_tenant_voided_idx
  on public.appointment_payments (tenant_id, voided_at)
  where voided_at is not null;
```

> **Nota de FK**: `on delete restrict` em `received_by`/`voided_by` é intencional. Perfis são
> desativados por `profiles.active` (soft delete); apagar perfil com histórico financeiro
> quebraria auditoria. Se um dia houver hard delete, a decisão precisa de nova ADR.

### Contrato de escrita (quem pode escrever)

| Caminho | Pode escrever? | Observação |
|---|---|---|
| `authenticated` direto na tabela | ❌ | sem grant de insert/update/delete; sem policy |
| `anon` | ❌ | `revoke all` |
| RPC `register_appointment_payments` (service role) | ✅ insert | ADR-002 |
| RPC `settle_charge_payment` (service role) | ✅ insert/update de `charges` | ADR-002/003 |
| RPC `void_appointment_payment` (service role) | ✅ update só de `voided_*` | ADR-002 |
| Backfill da migration | ✅ insert | owner da migration/`service_role` |

### Invariantes no banco (resumo testável)

1. `amount_cents > 0`; `tip_cents >= 0`; valores em centavos inteiros.
2. `method` e `source` restritos aos enums acima.
3. `voided_*` ou todos nulos, ou todos preenchidos com motivo não vazio.
4. Um `charge_id` aparece no máximo uma vez por tenant.
5. `(tenant_id, idempotency_key, line_index)` é único quando a chave existe.
6. `charges` tem no máximo uma linha por `(tenant_id, appointment_id)`.
7. FK composta impede atendimento/cobrança/perfil de outro tenant; a FK de 3 colunas impede
   também que a linha aponte para cobrança de **outro atendimento** do mesmo tenant
   (`charge_id` nulo é aceito; cobrança de assinatura não casa).
8. Nenhuma linha de `appointment_payments` sem `tenant_id`.

## Alternativas consideradas

- **Estender `charges`** (RESEARCH Alternativa A): descartada. Mistura gateway e receita,
  inviabiliza split limpo, exige afrouxar RLS admin-only e aumenta o risco de receita dupla.
- **Ledger + caixa/turno** (RESEARCH Alternativa C): descartada no v1 por estar fora do PRD §7.
- **Tabela de recebimentos sem `charge_id`**: descartada. Sem o vínculo não há como impedir
  webhook + baixa manual + backfill de contarem a mesma cobrança duas vezes.
- **Unique parcial só de `pendente` em `charges`**: descartada. Permitiria segunda cobrança
  depois de uma paga, contrariando a ambiguidade #6 aceita.
- **Persistir `cash_received_cents`/troco**: descartada no v1 (ambiguidade #5). O troco é
  calculado na UI e exibido no comprovante; o ledger guarda o valor efetivamente recebido de
  serviço e a gorjeta. Auditoria de “quanto o cliente entregou” não existe no v1 — declarado.

## Consequências

- A receita passa a ter uma fonte única; o painel e a comissão deixam de ler `charges.status='pago'`
  como receita (ADR-005).
- `charges` fica menor em responsabilidade: só cobrança PIX e estado do gateway.
- O backfill precisa rodar antes de o painel novo entrar em produção; sem ele, receita histórica
  desaparece da leitura nova. A migration valida contagem e aborta em divergência.
- O cap de 1 PIX **ativo** por atendimento é regra de produto do v1: cobrança expirada/cancelada
  é reemitida na mesma linha (`reopen_charge_for_reissue`, ADR-002), cancelando a anterior no
  gateway; após **paga**, nunca reemite. A UI deve explicar isso (ADR-004).
- `appointment_payments` cresce por parcela, não por atendimento; os índices por
  `(tenant_id, received_at)` sustentam os KPIs sem varrer a tabela inteira.
- O estorno lógico mantém a linha e exige que toda soma de receita filtre `voided_at is null`.
  Esquecer o filtro é o erro mais provável; os testes de RPC/painel devem cobri-lo.

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Backfill parcial/duplicado | receita histórica errada | `not exists` + validação de contagem antes/depois + `supabase db reset` 2× |
| Unique global removido e recriado errado | segunda cobrança PIX por atendimento | migration substitui por unique `(tenant_id, appointment_id)`; teste de integração tenta inserir a segunda e espera `23505` |
| FK composta sem alvo único | migration falha | criar `charges (tenant_id, id)` antes da tabela; `profiles` já tem unique |
| `tenant_id` default nulo sob service role | insert falha (fail-closed) | RPC sempre passa `p_tenant_id`; teste de RPC sem tenant espera erro |
| Grant de escrita esquecido | cliente grava receita | `revoke all` + `grant select`; teste `has_table_privilege` e tentativa de insert sob `authenticated` |
| Perfil hard-deleted | FK `restrict` bloqueia | soft delete é a regra; documentar que hard delete exige ADR |
| Soma de receita incluir estornada | número inflado | todos os agregados filtram `voided_at is null`; teste com linha estornada |

## Critérios de aceite

1. `supabase db reset` termina com exit 0 **duas vezes seguidas** (migration idempotente).
2. `appointment_payments` existe com todos os checks, FKs compostas, unique parciais e índices
   acima; `\d+` confere.
3. `charges` não tem mais o unique global por `appointment_id`; tem
   `charges_tenant_appointment_uidx` e `charges_tenant_idem_uidx`.
4. Inserir duas linhas para o mesmo `charge_id` no mesmo tenant falha com `23505`.
5. Inserir duas linhas com a mesma `(tenant_id, idempotency_key, line_index)` falha com `23505`;
   a mesma chave com `line_index` diferente passa.
6. Inserir `appointment_payments` referenciando atendimento de outro tenant falha por FK;
   referenciar cobrança de **outro atendimento** do mesmo tenant (ou cobrança de assinatura,
   com `appointment_id` nulo) também falha com `23503`.
7. Sob `authenticated` admin: `select` retorna linhas do próprio tenant e nenhuma de outro;
   `insert`/`update`/`delete` falham por falta de grant.
8. Sob `authenticated` receptionist/professional: `select` retorna 0 linhas (sem policy de
   leitura), mesmo com grant de `select`; a leitura operacional só existe pela Edge da ADR-002.
9. Backfill: para cada `charges.status='pago'` com `appointment_id`, existe exatamente uma linha
   em `appointment_payments` com `charge_id` igual; reexecutar não duplica; cobranças pagas sem
   atendimento não entram e a contagem é registrada.
10. `voided_*` inconsistente (ex.: `voided_at` sem `void_reason`) falha por check.
11. `.agents/rules/dominio.md` não afirma mais que concluir gera PIX; a regra descreve o ledger,
    o cap de 1 PIX, a gorjeta fora da receita/comissão e a comissão inalterada.
12. Nenhuma alteração fora de `supabase/migrations/**` e das regras citadas nesta ADR.

## Escopo desta decisão

**Dentro**: tabela, checks, FKs, unique/índices, RLS/grants, backfill, atualização de
`.agents/rules/dominio.md` e espelho.

**Fora**: RPCs e Edge Functions (ADR-002), `create-charge`/webhook (ADR-003), frontend (ADR-004),
painel/aba Recebimentos/RBAC final (ADR-005), SPEC/PLAN/TASKS, código de aplicação, branch/PR.

## Perguntas abertas

1. **Hard delete de perfil**: hoje a regra é soft delete (`profiles.active`). Se o produto passar
   a permitir hard delete, as FKs `received_by`/`voided_by` precisam de `on delete set null
   (received_by, voided_by)` (PG 15+) ou de uma tabela de snapshot do ator. Recomendação:
   manter `restrict` e soft delete no v1.
2. **Valor entregue em dinheiro**: aceito não persistir no v1 (ambiguidade #5). Se o dono pedir
   conferência de gaveta, isso é caixa/turno (PRD §7, fora do v1) e exige PRD próprio.
3. **Cobrança expirada/cancelada**: o cap de 1 PIX impede recriar. Recomendação: manter o cap no
   v1 e oferecer “registrar depois”/outra forma; reabrir só com decisão de produto.

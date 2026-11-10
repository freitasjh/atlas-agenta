# Análise de Dados e Segurança — PDV Walk-in / Venda de Balcão (Atlas Agenda)

> Papel: arquiteto backend/dados/segurança (dev-pipeline, step `analysis-data`).
> Escopo: análise sem código de feature. Fonte primária: código real lido em 2026-11-09.
> Contexto travado: barbearia + salão, service-only (sem produto/estoque), herança 100% das
> regras financeiras vigentes, ledger `appointment_payments` como fonte única de receita.

## 1. Conclusões executivas

1. **Recomendada: Opção 1R (híbrida)** — appointment real retratado como venda walk-in,
   com `origin='walk_in'` ortogonal ao `status` e `customer_id` nullable. Sem novo status,
   sem nova entidade, sem novo financeiro. Herda zero mudança de receita, comissão, Pix.
2. **Opção 2 pura (novo status `walk_in`) é pior que origin**: todo consumidor de `status`
   no repo filtra por valores fechados; novo status exige reabrir máquina de estados,
   `financial_summary`, RPCs de pagamento, `report_commissions`, agenda, testes.
3. **Opção 3 (nova entidade `sale/sale_items`) é incompatível** com a trava do produto
   ("não criar 2º financeiro") e com o schema vigente (`appointment_payments.appointment_id` é
   `NOT NULL`, `charges` é 1:1 por atendimento, `financial_summary` deriva tudo de
   `appointments` + ledger). Exigiria migração destrutiva do ledger e reescrita de 4 RPCs.
4. **Bloqueador real hoje é triplo, não só `customer_id`**:
   `appointments.customer_id NOT NULL` + `register_appointment_payments` só aceita
   `em_atendimento|concluido` + `reserve_appointment_charge` só aceita `concluido`.
   Qualquer venda walk-in precisa chegar a `concluido` antes (ou junto) do Pix do sistema.
5. **Cliente "balcão" anônimo por `customers` sintético é inviável**: `customers.phone NOT NULL`
   (8–20 chars, E.164 validado na app) + `name 1–120` + `whatsapp_opt_in`. Venda anônima
   exigiria telefone fictício — polui base, falsifica consentimento LGPD, quebra dedupe.
   A única via honesta é `customer_id NULL` + exibição "Cliente de balcão".

## 2. Invariantes vigentes (evidência no código real)

### 2.1 `appointments` — compromisso, não só agenda

- `20250219091000_appointments.sql:49-80`: `id uuid PK; tenant_id uuid NOT NULL default
  current_tenant_id(); customer_id uuid NOT NULL; professional_id uuid NOT NULL;
  service_id uuid NOT NULL (depois nullable via combo XOR); starts_at/ends_at timestamptz NOT
  NULL com ends_at > starts_at; price_cents int NOT NULL >= 0 (snapshot); status default
  'pendente' com CHECK em 6 valores`.
- FKs compostas por tenant (`(tenant_id, customer_id)->customers`,
  `(tenant_id, professional_id)->professionals`, `(tenant_id, service_id)->services`,
  `on delete restrict`). Coerência cross-tenant é do schema, não da UI.
- `20250226096000_appointments_combo.sql:56-69`: XOR `service_id` × `combo_id` (exatamente um).
  Walk-in service-only pode usar service avulso ou combo; preço continua `price_cents` snapshot.
- Tipos TS espelham o schema: `src/types/domain.ts:9-18` (6 status), `:257-271
  (Appointment com customer_id: string — não-null), `:286-299` join `customers/services/
  professionals/combos` já defensivo a `null` (compatível com cliente nulo após ajuste).

### 2.2 Exclusão de sobreposição (concorrência por profissional)

- `20250219092000_appointments_no_overlap.sql:42-49`: `exclude using gist (tenant_id with =,
  professional_id with =, tstzrange(starts_at, ends_at) with &&) where (status not in
  ('cancelado','nao_compareceu'))`. `concluido` ocupa o slot; cancelado libera.
- Walk-in `starts_at=now(), ends_at=now()+duration_minutes` compete com a agenda do profissional
  em tempo real. Dupla venda concorrente do mesmo profissional → `23P01 exclusion_violation`
  (mapeado pt-BR). Nada a mudar no schema; o PDV precisa tratar `23P01` como "profissional
  ocupado — escolher outro ou esperar", não como 500.

### 2.3 Máquina de estados (só UPDATE, não INSERT)

- `20250219093000_appointments_state_machine.sql:61-71` + `20250226092000_commission_on_conclude.sql:71-81`:
  `pendente → {confirmado, em_atendimento, cancelado, nao_compareceu}`;
  `confirmado → {em_atendimento, cancelado, nao_compareceu}`;
  `em_atendimento → {concluido, cancelado}`; finais imutáveis.
  Trigger é `BEFORE UPDATE OF status` — **INSERT nasce em qualquer status do CHECK sem passar
  pela guarda**. Walk-in pode nascer `em_atendimento` via INSERT direto (atalho legítimo,
  usado por seeds/fixtures) ou nascer `pendente` e caminhar `pendente→em_atendimento→concluido`
  em 2 UPDATEs. Nascer `concluido` é tecnicamente possível mas **proibido por regra de
  negócio**: pularia `confirmed_at` e, no INSERT, o trigger de comissão (que é no UPDATE) não
  dispararia — venda sem comissão. Nunca inserir `concluido` direto.
- `20261106131000_appointment_payments_api_rpcs.sql:193-199,331-339`:
  `register_appointment_payments` aceita só `em_atendimento|concluido`; em `em_atendimento` exige
  `p_close_appointment=true` e conclui no mesmo commit; em `concluido+close=true` sem replay →
  `PT409 APPOINTMENT_ALREADY_CONCLUDED`. Ou seja: PDV que paga+conclui em 1 clique já está
  desenhado — falta só o cadastro do appointment walk-in.

### 2.4 Comissão — snapshot imutável no `concluido`

- `20250226091000_appointment_commissions.sql:49-77`: `unique (tenant_id, appointment_id)`,
  `base_cents = appointments.price_cents`, `commission_pct numeric(5,2)`, `commission_cents int`,
  `calculated_at = conclusão`. Sem UPDATE/DELETE (imutável); `on delete cascade` com appointment.
- `20250226092000_commission_on_conclude.sql:98-109`: trigger `appointments_validate_transition`
  insere snapshot `round((base_cents * pct)/100.0)::int` half-up em `numeric` exato,
  `on conflict do nothing`, `left join + coalesce(pct,0)` — profissional sem taxa apura 0
  (nunca pula). Base é `price_cents` (preço da venda), **gorjeta fora** (tip nem existe aqui).
- Leitura: `20250226090000_professional_commissions.sql:71-86` —
  `appointment_commissions` admin tudo, professional só as próprias (`professional_id =
  professionals.profile_id = auth.uid()`), receptionist zero SELECT. `report_commissions`
  (`20250226093000_report_commissions_rpc.sql:45-75`) herda o RLS (security invoker).
  Walk-in que termina em `concluido` ganha comissão automaticamente — condição obrigatória da
  recomendação.

### 2.5 Ledger — fonte única, escrita só service_role

- `20261106120000_appointment_payments_ledger.sql:38-79`:
  `appointment_id uuid NOT NULL` + FK composta `(tenant_id, appointment_id)->appointments`;
  `method check 5 formas`; `amount_cents > 0`; `tip_cents >= 0` fora da receita de serviço;
  `source manual|asaas`; `charge_id` com FK de 3 colunas `(tenant_id, charge_id, appointment_id)
  -> charges`; `voided_at/by/reason` consistentes (void lógico, nunca DELETE/UPDATE de valor);
  `unique (tenant_id, charge_id)` parcial; `unique (tenant_id, idempotency_key, line_index)` parcial
  (`lote_signature md5` canônico em `20261106130000:20-35`).
- **Resposta direta à pergunta do pipeline**: sim, `appointment_id NOT NULL` bloqueia venda sem
  atendimento. Opção 3 só funcionaria tornando-o nullable, destrutivo para FK composta,
  `charges_tenant_appointment_uidx` e toda a leitura financeira.
- Gatilho "1 PIX por atendimento, para sempre": `20261106120000:110-113`
  `unique (tenant_id, appointment_id) where appointment_id is not null`, sem predicado de status.
  Pagamento via `settle_charge_payment` (`20261106131000:417-588`) é a única via de receita PIX
  (webhook ou manual-admin); `void_appointment_payment` (`:691-789`) só admin, motivo 1–500 chars.
- Leitura direta: `appointment_payments_select_tenant_admin` (só admin) + grants
  `revoke all from anon,authenticated` / `grant select to authenticated` / `service_role all`
  (`20261106120000:141-150`). Recepção/profissional leem só por Edge escopada
  (`get-appointment-settlement` → `loadSettlement` em `supabase/functions/_shared/payments.ts:110-244`,
  com `can_register / can_cancel_charge / can_void` calculados no servidor, nunca no cliente).
- `appointment_payment_summary` (`20261106130000:41-101`) é fonte única de
  `paid/tip/reserved/remaining/payment_status` (`sem_pagamento|parcial|quitado|aguardando_pix`).
  `agenda_payment_statuses` (`20261106143000`) expõe só o rótulo, sem valores/QR, recorte por
  profissional sem dono → vazio (anti-oracle).

### 2.6 `financial_summary` — cai de graça no walk-in

- `20261106144000_financial_summary.sql:42-119`: `received_*` = sum ledger `voided_at is null`
  por `received_at` no intervalo; `receivable` = snapshot `charges pendente + asaas_payment_id +
  não expiradas` (sem período); `open` = `price - paid - reserved` de `concluido` por `starts_at`;
  `by_method` 5 formas com zeros; `charges.status='pago'` nunca é receita; gorjeta separado.
  security invoker, só `admin` (`current_role_name() = 'admin'`, `PT403` senão), intervalo
  ≤366 dias. Hook `src/hooks/useFinancialSummary.ts:63-81` chama via `supabase.rpc` só quando
  `canViewFinancials && payments===true && timezone resolvido`.
- `FinanceiroPage.tsx:99-115`: gating UI duplo — `!payments` (fora salão/barbearia) → estado de
  ramo; `!canViewFinancials` → neutro. PDV walk-in quitado aparece em `received_*` no dia do
  `received_at`; walk-in parcial/concluído sem pagar aparece em `open` pela `starts_at` (hoje),
  sem nenhuma linha nova. Walk-in não pode inflar `receivable` sem passar por `charges`.
- Contrato TS congelado `src/types/payments.ts:107-120` espelha 1:1 o `jsonb_build_object`.
  **Nenhuma mudança** necessária no agregado se walk-in for appointment.

### 2.7 Edge Functions de pagamento (observado, sem editar)

- `get-appointment-settlement/handler.ts:34-66`: `resolveIdentity` admin|receptionist|professional,
  verifica posse do profissional, delega a `loadSettlement` (service_role). `register-appointment-
  payments/handler.ts:51-95,101-248`: valida `idempotency_key` obrigatório, chama RPC
  `register_appointment_payments`, depois `reserve_appointment_charge` + `attach_charge_gateway_data`
  (ou `reopen_charge_for_reissue` / gateway-claim `ensureSingleGatewayCreation`) quando
  `pix_amount>0`. Replay nunca reserva nem chama gateway. `cancel-charge`, `confirm-charge-manual`,
  `void-appointment-payment`, `create-charge` (referência cruzada `appointments.customer_id` em
  `register-appointment-payments/handler.ts:346-368` para `ensureAsaasCustomer`).
- `useAppointmentPayments.ts:173-283`: hooks TanStack Query com timeout 15 s, `networkMode:
  'always'`, invalidação de `appointment-settlement/appointments/charges/financial-summary/
  agenda-payment-flags` no sucesso e no erro com settlement concluído. PDV pode reaproveitar
  `useRegisterAppointmentPayments` / `useAppointmentSettlement` sem novo transporte.

### 2.8 RBAC vigente (trava real = RLS + RPC, UI = profundidade)

| Capacidade | admin | receptionist | professional | Fonte |
|---|---|---|---|---|
| Criar appointment (qualquer profissional) | sim | sim | só próprios | `appointments_write_staff` / `appointments_write_own_professional` |
| Ler appointment (qualquer profissional) | sim | sim | só próprios | `appointments_select_tenant` |
| Registrar lote manual + concluir | sim (qualquer) | sim (qualquer) | só próprio | `register_appointment_payments` (`PROFESSIONAL_NOT_OWNER`) |
| Reservar Pix sistema | sim | sim | só próprio, só `concluido` | `reserve_appointment_charge:152-181` |
| Cancelar cobrança pendente | sim | sim (force só admin) | não | `cancel_charge:624-631` |
| Baixa manual Pix / `settle source=manual` | sim único | não | não | `settle_charge_payment:455-457` |
| Estorno (`void`) | sim único | não | não | `void_appointment_payment:730` |
| Ver `appointment_payments` direto | sim | não | não (só settlement do próprio) | policy `appointment_payments_select_tenant_admin` |
| Ver `charges` / `financial_summary` / comissões (todas) | sim | não | não | `charges_select_tenant_admin`, `financial_summary` PT403, `appointment_commissions_select` |
| Ver própria comissão | sim | não | sim | mesma policy |
| Gerenciar catálogo / taxa % | sim | não | não | `services/professionals_*_write_admin`, `professional_commissions_write_admin` |

`usePermissions.ts:76-106` espelha isso na UI (`canRegisterPayments` triplo,
`canViewFinancials` só admin, `canVoidPayment` só admin, `canCancelCharge` admin+recepção).
`can_view_qr` no settlement: `hasPending && (isAdmin || status='em_atendimento')`
(`_shared/payments.ts:190-201`) — walk-in em `concluido` com Pix pendente só mostra QR para admin;
fluxo PDV precisa exibir QR **antes** de concluir ou ampliar `can_view_qr` para recepção em
`concluido` walk-in (decisão de produto, ver §8).

### 2.9 Segment gating é só UI

- `src/lib/segment-features.ts:62-77`: `payments=true` só salão/barbearia; clínica/legado `false`;
  `tenantResolved=false` → `payments=null` (nunca `false` durante load). Comentário explícito:
  "banco NÃO trava por segment — trava real é RLS `tenant_id/professional_id`".
- `tenants.segment` check `20250225090000` (`barbearia|clinica|salao|null`). Imperial do
  contexto travado (barbearia+salão) coincide com `payments=true`. Clínica/legado não veem o
  PDV na UI, mas RPCs SQL não negam por segment — qualquer gate de segmento no banco seria
  fronteira de segurança falsa (anti-padrão, já documentado em `professional_commissions`
  e `combos`). Gate server-side, se desejado, deve ser checagem de produto na Edge
  (ler `tenants.segment` do tenant e recusar PDV para clínica/legado), nunca policy RLS.

## 3. Opções avaliadas

### Opção 1 — Appointment real `starts_at=now()` + caminho rápido até `concluido`

**Desenho puro**: INSERT `appointments (customer_id, professional_id, service_id|combo_id,
starts_at=now(), ends_at=now()+duration, price_cents snapshot, status='em_atendimento')`,
depois `register_appointment_payments` com `close_appointment=true` (paga + conclui perseguindo
comissão) ou `reserve_appointment_charge` (Pix sistema após concluído).

- **Variante 1a — cadastro rápido de cliente** (exigir cliente válido): zero mudança de schema.
  Contra: funil é `customers{ name 1–120, phone 8–20 NOT NULL }` — atendimento de balcão sem
  coleta de telefone viola o schema; com coleta obrigatória vira fricção de caixa ("só o corte,
  sem cadastro" é o caso walk-in). PII coletada sem necessidade = risco LGPD.
  `register-appointment-payments/handler.ts:355-369` (`customer?.name ?? "Cliente"`) já tolera
  nome nulo, mas `customers.phone` não.
- **Variante 1b — cliente "balcão" anônimo por linha compartilhada**: 1 `customers` por tenant
  (`phone` placeholder). Contra: telefone é dado falso; WhatsApp dispararia para número fictício
  se fluxo não filtrar; histórico do cliente vira soma de todos os anônimos; `whatsapp_opt_in`
  mentiroso. Inaceitável.
- **Impacts**: RLS zero (policies já cobrem INSERT staff/profissional próprio); máquina de estados
  zero (nasce `em_atendimento`, sem transição forçada); comissão zero (trigger de `concluido`
  dispara); Pix zero (reserva exige `concluido`, já satisfied); receita zero (ledger/financeiro
  somam sem ajuste); idempotência a construir (ver §5); concorrência herdada (`23P01`).
- **Veredito**: variante pura não entrega venda anônima. Precisa do relaxamento mínimo da
  Opção 2 — daí **Opção 1R**.

### Opção 2 — Status/origem nova + relaxar `customer_id`

**Desenho puro A (novo status `walk_in`)**: adicionar 7º valor ao CHECK de `status` +
transições `*→walk_in→concluido`.

- **Contras**: `src/types/domain.ts:9-16`, badges, guards, `useAppointmentSettlement`
  (`settlementSchema` valida `z.enum(APPOINTMENT_STATUSES)`), `register/reserve` (`status in
  ('em_atendimento','concluido')` / `=concluido`), `financial_summary` (`status='concluido'`),
  `agenda_payment_statuses`, `report_commissions` (via `calculated_at`, ok), `no_overlap`
  (predicado `status not in ('cancelado','nao_compareceu')` — walk_in ocuparia, ok), trigger
  de comissão (exige `concluido`). Cada `status='concluido'` no repo vira missão de varredura.
  Semântica ruim: `walk_in` é **origem**, não ciclo de vida — confunde "o que aconteceu" com
  "como nasceu". Rejeitar.
- **Desenho B (origem ortogonal)**: coluna `origin` (`agendado | walk_in`) + `customer_id` nullable.
  É o **núcleo da recomendação**. `status` continua 6 valores. Origem não participa de transição,
  RLS, relatório ou pagamento — só filtra UI ("vendas de balcão") e autoriza `customer_id NULL`.
- **Impacts**: RLS zero; máquina de estados zero; comissão zero; Pix zero; receita zero;
  idempotência a construir; concorrência herdada. Schema: 1 coluna + 1 relaxamento + CHECK.
  **Recomendado na forma B**.

### Opção 3 — Nova entidade `sales/sale_items` fora de `appointments`

**Desenho**: `sales{ id, tenant_id, price_cents, professional_id, service_id, status }` +
`sale_items` + ledger reuso via `appointment_id NULLABLE` (ou `sale_id` nova FK).

- Reuso via `appointment_id NULLABLE`: exigiria `alter column appointment_id drop not null`,
  recriar FK composta 3 colunas (hoje `charges` referencia appointment), recriar únicos
  `(tenant_id, appointment_id)` / `(tenant_id, charge_id, appointment_id)`, reescrever
  `appointment_payment_summary`, `register/settle/cancel/void`, `financial_summary` (`open` hoje é
  `appointments concluido`; venda precisaria de branch), `agenda_payment_statuses`, `loadSettlement`,
  `report_commissions` (comissão hoje é 1:1 com appointment). Risco de receita dupla (ledger sem
  appointment some de `open` mas continua em `received`) — exatamente o que a trava do produto proíbe.
- Reuso via `sale_id` nova coluna no ledger: duplica todo o acoplamento acima + novo RLS/grants
  testados do zero. Custo de manutenção permanente: 2 fontes de "o que foi vendido".
- Sem entidade de venda, `price_cents` em `appointments` já é snapshot (P2) — PDV não precisa
  de `sale_items` para serviço único. Multi-serviço na venda é escopo futuro (fora v1, ver §8);
  se entrar, evolui como `appointment_services` ou 1 appointment por serviço, não como `sales`.
- **Veredito**: rejeitar. Viola contexto travado, multiplica risco financeiro, não traz benefício
  em v1 service-only.

## 4. Opção recomendada — 1R em detalhe

**`appointments` vira "compromisso ou venda de balcão"**: linha com `origin='walk_in'`,
`starts_at=now()`, `ends_at` derivado, `price_cents` snapshot, `customer_id NULL` quando anônima
(ou preenchido quando o cliente quiser cadastro rápido opcional), nasce `em_atendimento`,
paga via RPC existente e conclui no commit (`register_appointment_payments close_appointment=true`),
gerando comissão e habilitando Pix sistema. Quem quiser vender em 1 clique (Pix+d necessária)
usa o mesmo `idempotency_key` no lote.

**Trade-offs assumidos**:

- Anônimo sem PII: venda sem telefone/WhatsApp. Consequência: sem lembrete D-1, sem cobrança
  WhatsApp, sem ficha clínica — desejável em barbearia/salão service-only; clínica (ramo com
  ficha) não entra no v1 de qualquer forma.
- Slot bloqueado por `concluido`: walk-in ocupa o profissional por `duration_minutes`. Caixa
  sem "profissional livre" deve falhar `23P01` e orientar troca de profissional — comportamento
  correto para salão/barbearia, mas UX deve pré-checar agenda.
- Receita "caixa vs competência" herdada: `received_*` por `received_at` (caixa), `open` por
  `starts_at` (competência). Walk-in `starts_at=hoje` cai nos dois no mesmo dia — sem disputa.
- Auditoria: `audit_log payment_registered / appointment_concluded_without_payment` já existem;
  criar `walk_in_created` (action nova) fecha o rastro da venda sem PII.

## 5. Schema e migrations necessárias

**1 migration aditiva** (nomenclatura repo: `{YYYYMMDDHHMMSS}_walk_in_appointments.sql`,
próximo timestamp livre após `20261110000000`). Aditiva, idempotente, sem editar aplicada.

### 5.1 `appointments`

```sql
alter table public.appointments
  add column if not exists origin text not null default 'agendado'
  check (origin in ('agendado','walk_in'));
-- default 'agendado' preserva backfill + linhas existentes (nunca null)

alter table public.appointments
  alter column customer_id drop not null;
-- FK composta appointments_customer_fk MATCH SIMPLE: null não é checada (já vale para combo FK).

-- exactly-one-of: agendado exige cliente; walk_in pode ser anônimo
-- (check novo, bloco do $$ ... pg_constraint ... padrão do repo)
add constraint appointments_walk_in_customer_check check (
  (origin = 'agendado' and customer_id is not null)
  or (origin = 'walk_in')
);
```

- **Índices**: parcial `appointments_tenant_origin_starts_idx on (tenant_id, origin, starts_at)
  where origin='walk_in'` (lista de vendas, relatório balcão). Nenhum índice existente é dropado.
- **`appointments_tenant_id_customer_unique unique (tenant_id, id, customer_id)`**
  (`20250227090000`): com `customer_id NULL`, unicidade de NULL é não-distinta no PG
  (`NULL <> NULL`) — várias `NULL`s são permitidas, que é o comportamento desejado (sem unicidade
  entre anônimos). **Nada a mudar**, mas testes devem travar o comportamento.
- **`customers` intocado**: sem cliente sintético, sem `phone` placeholder.
- **`clinical_records` intocado**: FK `(tenant_id, appointment_id, customer_id)->appointments`
  não casa `NULL` — ficha clínica de venda anônima é impossível por construção, coerente
  (ficha exige cliente real; clínica nem habilita `payments`). Não há `clinical_records` em
  barbearia/salão no v1.
- **`messages`** segue exigindo cliente real para WhatsApp; walk-in anônimo simplesmente não
  entra na régua (sem telefone). Não há FK a relaxar.

### 5.2 Trigger / máquina de estados — **zero mudança**

`appointments_validate_transition` não é recriada. Walk-in valida pela mesma matriz
(`pendente→em_atendimento→concluido`). Venda "direta" nasce `em_atendimento` pelo INSERT
(trigger é só de UPDATE), depois conclui pelo UPDATE de `register_appointment_payments`.
Garantir no código que `origin` não entra em nenhuma cláusula do trigger.

### 5.3 Idempotência da criação (duplo clique / retry)

O lote de pagamento já é idempotente (`idempotency_key + lote_signature`), mas a **criação do
appointment não tem chave** — duplo clique criaria 2 vendas. Recomendado:

```sql
alter table public.appointments add column if not exists creation_idempotency_key uuid;
create unique index if not exists appointments_tenant_creation_idem_idx
  on public.appointments (tenant_id, creation_idempotency_key)
  where creation_idempotency_key is not null;
```

- Edge walk-in gera `crypto.randomUUID()` por clique de "Registrar venda" e reusa o mesmo valor
  em retry. Segunda chamada com a mesma chave devolve o appointment existente (lookup por
  `(tenant_id, creation_idempotency_key)`) em vez de inserir de novo.
- Alternativa sem coluna nova (PK de ida dupla / janela de 2 s): rejeitada — não resiste a retry
  de rede nem a 2 caixas.
- `p_close_appointment` já trata replay do lote; a coluna acima cobre só o INSERT.

### 5.4 RPC server-side `create_walk_in_appointment` (recomendado sobre INSERT via PostgREST)

PostgREST direto já permite o INSERT (RLS staff/profissional-próprio), mas fragmenta a venda em
INSERT + `register` (2 round-trips caem no meio). Recomendado **1 RPC `security invoker`**
(next to `register_appointment_payments`, execute só `service_role`, `search_path=public,pg_temp`,
erros `PT4xx`):

- Entradas: `p_tenant_id, p_actor_id, p_professional_id, p_service_id|p_combo_id (XOR),
  p_starts_at (default now()), p_customer_id NULL default, p_idempotency_key (creation), p_amounts`
  — ou, mais simples, só cria o appointment em `em_atendimento` e devolve `appointment_id`;
  o chamador chama `register_appointment_payments` existente na mesma Edge. 2 opções, trade-off:
  RPC única com pagamento embutido (atômica, mas grande) vs 2 chamadas (menor, janela de
  "venda criada sem pagar" que é estado legítimo `sem_pagamento`/`parcial`).
- **Recomendação**: 2 chamadas (create + register) — janela intermediária é estado de domínio
  válido (venda aberta), já coberto por `appointment_payment_summary`. RPC única funde
  responsabilidades e duplica o parsing do lote.
- Validações obrigatórias no RPC/Edge: ator ativo no tenant (admin|receptionist|professional);
  professional possui `active=true` e, se ator é professional, dono comprovado
  (`professionals.profile_id = auth.uid()`); service/combo `active=true` e do tenant;
  `price_cents` copiado do catálogo vigente (nunca aceito do cliente); `ends_at =
  starts_at + duration` (sum das durações se combo); `customer_id`, quando presente, do tenant;
  `starts_at` dentro da janela de hoje no fuso do tenant ou `now()` (sem agendar "walk-in futuro");
  `origin='walk_in'` gravado pelo servidor (nunca aceito do payload); audit `walk_in_created`.
- **Grants/RLS**: sem policy nova em `appointments`; ledger intocado (`revoke`/`grant` como hoje);
  `financial_summary`, `report_commissions`, `appointment_commissions` intocados.

### 5.5 O que NÃO mexer (e por quê)

- `appointment_payments` (nem `appointment_id`, nem grants, nem policies).
- `charges` (unique 1:1 por atendimento já cobre walk-in).
- `appointment_commissions` / `professional_commissions` (trigger já apura).
- `tenants.segment` / RLS por segment (nunca fronteira de segurança).
- `services/professionals/service_professionals` (validação de vínculo no server, sem CHECK novo).
- Backfill: `origin` default `'agendado'`; nenhuma linha existente muda. `db reset` 2× idempotente.

## 6. Regras RBAC por papel (walk-in)

Herança total das políticas vigentes; nenhum papel ganha visibilidade financeira nova.

| Ação | admin | receptionist | professional | Gate real |
|---|---|---|---|---|
| Abrir venda walk-in (criar appointment anônimo) | qualquer profissional do tenant | qualquer profissional do tenant | só para si | `appointments_write_staff` / `appointments_write_own_professional` + RPC dono |
| Registrar dinheiro/cartão/maquininha + concluir | qualquer | qualquer | só próprio | `register_appointment_payments` + `PROFESSIONAL_NOT_OWNER` |
| Reservar Pix sistema (após concluído) | qualquer | qualquer | só próprio | `reserve_appointment_charge` (`concluido` exigido) |
| Ver QR Pix pendente | sim | só em `em_atendimento` (hoje) — **decidir se recepção vê em `concluido` walk-in** | só em `em_atendimento` | `loadSettlement can_view_qr` |
| Cancelar cobrança | sim | sim (force só admin) | não | `cancel_charge` |
| Confirmar Pix manual | sim único | não | não | `settle_charge_payment source=manual` (só admin) |
| Estornar (`void`) | sim único, motivo | não | não | `void_appointment_payment` |
| Ver Financeiro / `financial_summary` | sim | não | não | `PT403` + `canViewFinancials` |
| Ver ledger direto | sim | não | não | `appointment_payments_select_tenant_admin` |
| Ver comissão (todas / próprias) | todas | nenhuma | próprias | `appointment_commissions_select` |
| Exibir "Cliente de balcão" | sim | sim | só próprio | nome `null` → rótulo UI (PII-free) |

- `origin` não é RBAC: recepção que vende não passa a ver financeiro; profissional que vende
  para si não vê financeiro dos outros. Sigilo é na LEITURA, nunca na escrita.
- `super_admin`: sem caminho cliente para walk-in (futura Edge service_role auditada, como hoje
  para `charges/ledger`).

## 7. Casos de borda

1. **Pagamento parcial / fechamento com confirmação**: herdado. Lote inferior ao `price_cents`
   conclui com `parcial` + `remaining>0` + `open>0`; lote zero + `close_appointment=true`
   conclui sem_payment (`appointment_concluded_without_payment`). PDV deve permitir vender
   "fiado de balcão" se produto quiser; por padrão, exigir pagamento integral no clique
   (UI), mas o banco aceita parcial (não decidir no banco).
2. **Estorno/void**: só admin, motivo obrigatório, linha permanece (`voided_at/by/reason`),
   receita cai, `open` sobe, `refund_required` quando há `charge_id`. Comissão snapshot **não**
   reverte (base é `price_cents`, não o pago) — coerente com regra vigente; documentar na UI
   ("estorno não recalcula comissão").
3. **Pix já reservado/pago**: `reserve` recusa duplicar (`PENDING_CHARGE_EXISTS` em valor
   divergente, reapresenta `pendente` existente, `CHARGE_NOT_PENDING` se `pago/cancelado` sem
   chave); `settle` idempotente por `(tenant_id, charge_id)`; webhook tardio de cobrança cancelada
   vira anomalia `charge_paid_after_cancel` sem receita. Walk-in herda tudo — sem exceção para
   "venda rápida".
4. **Profissional sem taxa cadastrada**: apura `commission_pct=0` (left join + coalesce). PDV não
   pode bloquear por falta de taxa; relatório mostra linha com 0, nunca pula.
5. **Serviço sem professional vinculado** (`service_professionals` sem par): hoje **nenhum CHECK
   no banco** amarra appointment a N:N (só FK ao service). PDV pode vender serviço que o
   profissional "não faz" se a UI não filtrar. Mitigação: Edge valida N:N vigente antes de criar
   (regra de produto), sem CHECK novo no banco; telefone de produto pode decidir bloquear ou
   alertar (ver §8).
6. **Serviço/combo inativo ou preço alterado**: snapshot `price_cents` no ato protege passado.
   Criação deve ler `services/combos active=true` no mesmo instante; taxa/preço mudados depois não
   reescrevem a venda.
7. **Tenant com feature desabilitada**: clínica/legado `payments=false` — PDV nem renderiza
   (UI). RPCs de pagamento seguem acessíveis por chamada direta (comportamento vigente para
   qualquer fechamento). Se produto exigir recusa server-side, Edge walk-in lê `tenants.segment`
   e devolve `SEGMENT_NOT_ENABLED` — nunca policy RLS por segment.
8. **Assinatura `bloqueado|cancelado`**: hoje só guard de UI (`RequireActiveSubscription`)
   redireciona; nenhum trigger DB bloqueia INSERT de appointment (a verificar no backoffice plan
   control). Walk-in herda o mesmo buraco; se o produto quiser bloqueio de escrita operacional,
   o gate é trigger / RPC (decisão produto, §8) — não mascarar como "PDV já bloqueia".
9. **Idempotência de duplo clique**: `creation_idempotency_key` (§5.3) + `lote_signature` já
   existente; `replayed:true` devolve settlement sem duplicar. Botão disabled + mesma chave em
   retry completam a defesa.
10. **Concorrência / slot ocupado**: `23P01` trata como "profissional ocupado"; `FOR UPDATE` no
    appointment em `register/reserve/settle` já serializa pagamento. Walk-in não cria corrida
    nova além da exclusão por profissional.
11. **Preço zero / valor divergente**: gratuidade (`price_cents=0`) conclui `quitado` com 0 linhas
    (`register` com array vazio + close). Preço fictício no payload é ignorado (snapshot do
    servidor). Override de preço com desconto não cabe em v1 (ver §8).
12. **Gorjeta**: `tip_cents` por linha, fora de receita/comissão, limitado na UI; Pix sistema não
    carrega tip (settle grava `tip 0`). PDV herda sem exceção.
13. **Fuso / janela**: `starts_at` em UTC, conversão só na UI (`tenants.timezone`). Relatório
    financeiro e `open` usam bordas UTC derivadas no cliente — walk-in de hoje fecha no dia
    local sem ajuste de banco.

## 8. Questões para o sintetizador PRD (decisões produto pendentes)

**P0 — bloqueiam escopo v1 (responder antes do SPEC)**:

1. Cliente anônimo permitido por padrão? (Recomendado sim — sem coleta de PII para corte/barba.)
2. Profissional é obrigatório na venda? (Recomendado sim — sem profissional não há comissão nem
   slot; venda "da casa sem executor" fica fora.)
3. AÇÃO do PDV = 1 serviço (ou 1 combo) por venda? Multi-serviço/fila está fora do v1
   (contexto travado). Se a venda precisar somar 2 serviços, o recomendado é 2 appointments
   walk-in ou combo fechado — mas isso muda `price_cents`/comissão por linha.
4. Desconto / override de preço no balcão? (Recomendado **não** em v1 — snapshot do catálogo;
   desconto vira estorno + nova venda ou `discount_cents` futuro fora da base de comissão.)
5. Quem opera o PDV? Recepção (recomendado sim, como no fechamento atual) + admin + profissional
   para si. Profissional vendendo para outro profissional: bloquear (`PROFESSIONAL_NOT_OWNER`).
6. QR Pix em `concluido` para recepção? Hoje `can_view_qr` só admin quando `concluido`.
   PDV que gera Pix **depois** de concluir precisa exibir QR para recepção — ampliar ou mostrar
   antes de concluir (decisão UX + segurança).
7. Pagamento integral obrigatório no ato, ou parcial/"a receber" permitido no PDV? (Banco
   permite parcial; UI pode exigir integral — decidir.)

**P1 — UI/UX e relatórios**:

8. Venda walk-in aparece na agenda do profissional (bloqueia slot) ou só no Financeiro?
   (Recomendado: aparece como `concluido` com badge "Balcão" — coerente com `open`/`received`.)
9. Filtro "vendas de balcão" no Financeiro (por `origin`) e exportação: sim em v1?
   (Recomendado: só visual no extrato, sem novo agregado.)
10. Fiscal (NFC-e/NF) entra depois; em v1, PDV emite comprovante interno (`audit_log`) sem
    documento fiscal. Confirmar fora de escopo.
11. Serviço sem vínculo N:N: bloquear, alertar ou ignorar? (Recomendado: filtrar na UI + validar
    na Edge com erro `SERVICE_NOT_OFFERED` — mas isso é regra nova, hoje inexistente.)
12. Recibo/comprovante WhatsApp para cliente anônimo: não (sem telefone). Para cliente cadastrado
    opcional: reaproveitar templates existentes.

## 9. Riscos e testes de integração necessários

### 9.1 Riscos

| # | Risco | Severidade | Mitigação |
|---|---|---|---|
| R1 | `customer_id NULL` quebra join/validator UI (`Appointment.customer_id: string`, zod `z.string()`, `loadSettlement`, agenda) | 🔴 Alto | Ajustar 1 tipo + fallback "Cliente de balcão"; `settlementSchema` já tolera `customer_name: null`; testes de agenda com `origin='walk_in'` |
| R2 | `clinical_records` / `messages` assumem cliente não-nulo (FK 3 colunas) | 🟡 Médio | Verificado: `NULL` não casa FK (MATCH SIMPLE) — walk-in anônimo não ganha ficha/mensagem por construção; teste de rejeição |
| R3 | Duplo clique cria 2 vendas | 🔴 Alto | `creation_idempotency_key` único parcial + replay |
| R4 | Preço fictício / taxa fictícia no payload | 🔴 Alto | Preço e taxa nunca vêm do cliente (snapshot servidor); teste de payload adulterado |
| R5 | `service_professionals` sem CHECK — venda de serviço que o profissional não faz | 🟡 Médio | Validação na Edge + decisão produto §8.11; sem CHECK novo (evitar migração destrutiva) |
| R6 | Gate de assinatura só na UI — tenant `bloqueado/cancelado` vendendo | 🟡 Médio | Herdado e documentado; se produto exigir, trigger/RPC de bloqueio (decisão §8) |
| R7 | Segment gate só na UI — clínica invocando API PDV | 🟢 Baixo | Edge lê `tenants.segment` e recusa com `SEGMENT_NOT_ENABLED` (nunca RLS) |
| R8 | `ends_at` walk-in colide com agenda real do profissional (salão lotado) | 🟢 Baixo | `23P01` como erro de UX "profissional ocupado"; pré-checagem de disponibilidade |
| R9 | Comissão de walk-in parcial: apura sobre `price_cents` integral mesmo com `parcial` | 🟢 Baixo | Herdado; UI informa "comissão sobre valor integral da venda" |

### 9.2 Testes de integração (vitest / banco real, padrão `tests/integration/`)

1. **RLS multi-tenant**: INSERT walk-in com `tenant_id` alheio negado (`42501`/RLS); SELECT cross-tenant
   vazio; `customer_id` de outro tenant rejeitado (FK composta / CHECK walk_in).
2. **Null cliente**: walk-in anônimo (`customer_id NULL`, `origin='walk_in'`) OK em `em_atendimento→concluido`;
   agendado sem cliente rejeitado (`23514`); `clinical_records` sobre walk-in anônimo rejeitado (FK 3 colunas).
3. **Máquina de estados**: `pendente→concluido` direto rejeitado; `em_atendimento→concluido` com comissão;
   `concluido` final imutável; INSERT `concluido` direto nascendo **não** gera comissão (teste de guarda de processo).
4. **Comissão**: snapshot `price_cents × pct` half-up exato; profissional sem taxa → 0; relatório
   `report_commissions` soma walk-in; gorjeta fora da base.
5. **Ledger/Pix**: walk-in pago em dinheiro → `quitado`, `received_*` no Financeiro; parcial → `open>0`;
   Pix sistema após concluído → 1 charge, replay idempotente, `settle` 1 linha, webhook tardio sem receita dupla;
   `void` só admin, receita cai, `open` sobe, comissão não reverte.
6. **Idempotência/concorrência**: mesmo `creation_idempotency_key` 2× → 1 appointment; mesmo
   `idempotency_key` de lote com assinatura divergente → `PT409`; 2 vendas simultâneas do mesmo
   profissional → 1 succeed + 1 `23P01`; `register` concorrente usa `FOR UPDATE` sem `amount_exceeds`.
7. **RBAC**: receptionist cria/vende/conclui mas não vê `financial_summary`/ledger/comissão;
   professional vende só para si (`PROFESSIONAL_NOT_OWNER` alheio); professional não estorna nem confirma manual;
   admin vê tudo do tenant, nada cross-tenant.
8. **Segmento/assinatura**: clínica/legado não veem PDV (UI), Edge recusa se configurada;
   `bloqueado/cancelado` comportamiento documentado conforme decisão §8 (registrar o buraco ou o bloqueio).
9. **Regressão**: `178+` testes existentes verdes após migration (combo XOR, unique `tenant_id,id,customer_id`,
   backfill ledger, webhook); `supabase db reset` 2× exit 0; fixtures de walk-in com `starts_at` variado
   (exclusion é global por profissional).

## 10. Checklist de qualidade (architect)

- [x] Viola alguma regra de `.agents/rules/**`? **Não** — `tenant_id` nunca do cliente,
      `*_cents` inteiro, `timestamptz` UTC, migration aditiva idempotente, FK composta, RLS em
      toda tabela de domínio, segment nunca em RLS, escrita financeira só service_role,
      sem segundo financeiro, sem código de feature.
- [x] Testabilidade: 1 migration + 2 Edge (create + register existente) + testes RLS/fluxo acima.
- [x] Segurança no design (Zero Trust): ator validado por `profiles`, dono comprovado por
      `profile_id=auth.uid()`, preço/taxa/origem/nascimento do servidor, auditoria sem PII.
- [x] Migração futura: `origin` extensível (sem novo status); multi-serviço evolui sem `sales`;
      desconto via `discount_cents` aditiva sem reescrever `price_cents` snapshot.

## 11. Resumo da recomendação

**Adotar Opção 1R**: `origin` + `customer_id` nullable, que é custo mínimo de schema e custo
zero de invariante financeira. Rejeitar novo status (explosão de consumidores) e nova entidade
(2º financeiro). Preço, comissão, Pix, receita e idempotência de lote são herdados; o único
ente novo é a idempotência de criação e 1 RPC de abertura atômica.

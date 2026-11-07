# ADR-005 — Relatórios financeiros admin, aba Recebimentos, RBAC final e atualização das regras de domínio/produto

- **Status**: todo
- **Data**: 2026-11-06
- **PRD**: cobranca-formas-pagamento (RF-20, RF-21, RF-24, RF-25, RF-28, RF-29; RNF-05, RNF-06,
  RNF-08, RNF-09, RNF-12)
- **Decisões cobertas**: D3, D4, D5, D6, D7, D8; ambiguidade §14 #9 (tenant legado sem segmento)
- **depende-de**: ADR-001, ADR-002
- **ADRs dependentes**: —

## Contexto

O ledger da ADR-001 e a API da ADR-002 permitem registrar e ler o settlement de **um**
atendimento. Falta a superfície do **admin**: receita por forma, gorjeta separada, “a receber”,
saldo em aberto e a aba “Recebimentos”. Falta também consolidar as capacidades e atualizar as
regras que ainda afirmam “ao concluir, gera cobrança PIX”.

Esta ADR fecha o escopo do painel/aba, a definição de receita × a receber × gorjeta, a matriz de
RBAC final, a flag de segmento `payments` e a atualização documental. Não cria relatório além do
que o PRD §7 permite.

## Decisão

### 1. Definições financeiras (fonte da verdade)

| Conceito | Definição | Fonte | Período |
|---|---|---|---|
| **Receita de serviço** | Soma de `appointment_payments.amount_cents` com `voided_at is null` | ledger | `received_at` no intervalo (caixa) |
| **Gorjeta** | Soma de `appointment_payments.tip_cents` com `voided_at is null` | ledger | `received_at` no intervalo |
| **Recebido total** | Receita de serviço + gorjeta (linha separada; nunca somar gorjeta na receita) | ledger | `received_at` no intervalo |
| **A receber** | Soma de `charges.amount_cents` com `status='pendente'`, `asaas_payment_id is not null` e `(expires_at is null or expires_at > now())` | `charges` | **snapshot** no momento da consulta; não é receita |
| **Em aberto** | Soma de `greatest(appointments.price_cents - paid - reserved, 0)` para atendimentos `concluido` | `appointments` + ledger + `charges` | `starts_at` no intervalo (data do serviço) |
| **Comissão** | `appointments.price_cents` no ato do `concluido` (não muda) | `appointment_commissions` | `concluido` (competência) |

Regras invioláveis:

1. **Nunca** ler `charges.status='pago'` como receita. `pago` é estado do gateway; o recebimento
   está no ledger (RF-25).
2. **Nunca** somar receita + “a receber” como se fosse receita. São colunas separadas.
3. **Nunca** somar gorjeta na receita de serviço nem na base de comissão.
4. `voided_at is not null` sai de **todas** as somas de receita/gorjeta/por forma; permanece no
   histórico.
5. “Em aberto” é indicador operacional do admin; não é receita nem “a receber” (não há cobrança
   necessariamente).
6. A comissão continua por competência (`price_cents` no `concluido`); o painel é caixa
   (`received_at`). A divergência é declarada, não “corrigida” no v1 (D8).

### 2. RPC `financial_summary`

```text
financial_summary(p_from timestamptz, p_to timestamptz) returns jsonb
```

- `security invoker`, `revoke execute from public, anon` e `grant execute to authenticated`.
- **Sem `p_tenant_id`**: o tenant vem de `current_tenant_id()`; o papel vem de
  `current_role_name()`. Não há parâmetro de tenant vindo do cliente (RF-29).
- Autorização: `current_role_name() = 'admin'`; qualquer outro → `PT403 FORBIDDEN`.
- `p_from`/`p_to` obrigatórios, `p_to > p_from`, intervalo máximo de 366 dias; senão
  `PT400 INVALID_PERIOD`.
- A leitura roda sob RLS de `appointment_payments` (admin), `charges` (admin), `appointments`
  (admin/recepção; aqui só admin) — não precisa de service role para um agregado de leitura.
- Retorno congelado:

```json
{
  "period": { "from": "...", "to": "..." },
  "received_service_cents": 125000,
  "received_tips_cents": 8500,
  "received_total_cents": 133500,
  "receivable_cents": 30000,
  "open_cents": 15000,
  "by_method": [
    { "method": "dinheiro", "amount_cents": 60000, "tip_cents": 2000, "count": 12 },
    { "method": "pix_sistema", "amount_cents": 30000, "tip_cents": 0, "count": 3 }
  ]
}
```

- `by_method` filtra `voided_at is null` e `received_at >= p_from and received_at < p_to`.
- `receivable_cents` é **snapshot** (não filtrado por período): uma cobrança pendente criada antes
  do período ainda é “a receber”. Se o produto quiser “a receber do período”, é campo novo em
  outra ADR.
- `open_cents` usa `starts_at` no intervalo (data do serviço) e só atendimentos `concluido`.
- Nenhum nome/telefone/documento no retorno agregado.

**Consulta base (resumo)**

```sql
-- receita/gorjeta por método
select method,
       sum(amount_cents)::int as amount_cents,
       sum(tip_cents)::int    as tip_cents,
       count(*)::int          as count
from public.appointment_payments
where tenant_id = current_tenant_id()
  and voided_at is null
  and received_at >= p_from and received_at < p_to
group by method;

-- a receber (snapshot)
select coalesce(sum(amount_cents), 0)::int
from public.charges
where tenant_id = current_tenant_id()
  and status = 'pendente'
  and asaas_payment_id is not null
  and (expires_at is null or expires_at > now());

-- em aberto (por atendimento concluído no período de serviço)
select coalesce(sum(greatest(a.price_cents - paid.paid_cents - reserved.reserved_cents, 0)), 0)::int
from public.appointments a
left join lateral (
  select coalesce(sum(p.amount_cents), 0)::int as paid_cents
  from public.appointment_payments p
  where p.tenant_id = a.tenant_id and p.appointment_id = a.id and p.voided_at is null
) paid on true
left join lateral (
  select coalesce(sum(c.amount_cents), 0)::int as reserved_cents
  from public.charges c
  where c.tenant_id = a.tenant_id and c.appointment_id = a.id
    and c.status = 'pendente' and c.asaas_payment_id is not null
    and (c.expires_at is null or c.expires_at > now())
) reserved on true
where a.tenant_id = current_tenant_id()
  and a.status = 'concluido'
  and a.starts_at >= p_from and a.starts_at < p_to;
```

- Índices da ADR-001 cobrem `(tenant_id, received_at)`, `(tenant_id, method, received_at)`,
  `(tenant_id, appointment_id)` e `(tenant_id, status)` de `charges`. O `LATERAL` é por
  atendimento; o período limita o conjunto.

### 3. Aba “Recebimentos” em Cobranças

- `CobrancasPage` ganha duas abas: **Cobranças PIX** (existente) e **Recebimentos** (nova).
- A aba só é renderizada para `canViewFinancials` (admin) **e** `payments` ligado; para recepção/
  profissional, não existe. A trava real é a RLS admin-only de `appointment_payments` (ADR-001).
- Colunas: data/hora do recebimento, cliente, método, valor de serviço, gorjeta, operador/origem,
  status (ativo/estornado), vínculo com cobrança (quando `pix_sistema`).
- Filtros: período (default mês corrente), método, status (ativos/estornados/todos). Paginação
  server-side (`range`), ordenação por `received_at desc`.
- Query direta sob RLS (`supabase.from("appointment_payments")...`), com embed de
  `appointments`/`customers`/`profiles` para evitar N+1. Não usar a Edge de settlement para
  listar (ela é de um atendimento).
- Estados obrigatórios: loading (skeleton), vazio (“Nenhum recebimento no período.”), erro com
  retry.
- Sem exportação, sem nota fiscal, sem envio por WhatsApp (PRD §7).

### 4. Painel financeiro admin

- `useFinancialSummary(from, to)` chama a RPC e renderiza:
  - cards: **Recebido (serviço)**, **Gorjeta**, **A receber**, **Em aberto**;
  - tabela/segmentos por método.
- O painel **não** inclui `charges.status='pago'` em nenhum card (RF-25).
- Sem gráfico novo obrigatório; se houver, é visual sobre os mesmos dados, sem outra fonte.
- Substitui qualquer leitura de receita baseada em `charges` pagas; se existir card antigo com
  essa leitura, ele é removido/ajustado nesta entrega (RNF-12).

### 5. RBAC final (capabilidades)

`usePermissions` (ADR-004) + RLS/Edge (ADR-001/002) formam a matriz abaixo. A UI é defesa em
profundidade; a trava real é o banco/Edge.

| Capacidade | Admin | Recepção | Profissional |
|---|---|---|---|
| `canRegisterPayments` | ✅ | ✅ | ✅ (próprio) |
| `canViewPaymentTotalsInClosing` | ✅ | ✅ (só no diálogo) | ✅ (próprio) |
| `canViewFinancials` | ✅ | ❌ | ❌ |
| `canViewOwnPayments` | ✅ | ❌ | ✅ (próprio) |
| `canCancelCharge` | ✅ | ✅ | ❌ |
| `canConfirmChargeManual` | ✅ | ❌ | ❌ |
| `canVoidPayment` | ✅ | ❌ | ❌ |
| `canViewCommission` | ✅ | ❌ | ✅ (própria) |

- Recepção: registra e cancela PIX; **não** vê histórico, período, KPI, total agregado, baixa
  manual, estorno ou QR após a conclusão.
- Profissional: registra/lê o próprio atendimento; não vê histórico de colegas, não cancela, não
  estorna, não faz baixa manual.
- Admin: tudo no tenant; sem caminho cross-tenant novo (super admin fora — PRD §4/§7).
- Nenhuma capability é derivada de `segment`; a flag de segmento é só UI (ver §6).

### 6. Flag de segmento `payments`

- `SegmentFeatures` ganha `payments: boolean`.
- `resolveFeatures`:
  - `salao` → `{ commission: false, combos: true, payments: true }`
  - `barbearia` → `{ commission: true, combos: false, payments: true }`
  - `clinica`, `null`, valor inválido → `{ commission: false, combos: false, payments: false }`
- A flag liga o diálogo de fechamento, a aba Recebimentos e o painel; **não** é fronteira de
  segurança (RLS/Edge continuam valendo).
- Tenant legado com `segment=null` fica **desligado** (ambiguidade #9): mantém o fluxo antigo até
  migração de segmento; não tratar como salão automaticamente.
- Testes de `resolveFeatures` atualizados para o novo campo; nenhuma feature existente muda de
  valor.

### 7. Atualização das regras de domínio/produto

**`.agents/rules/dominio.md`** (e espelho `.kiro/steering/dominio.md`):

- Remover a frase “Ao entrar concluído: gera cobrança PIX + mensagem cobrança”.
- Acrescentar:
  - `appointment_payments` é o ledger de recebimento (1:N por atendimento), fonte única de receita;
    `charges` é só cobrança PIX do gateway.
  - Métodos v1: `dinheiro`, `cartao_credito`, `cartao_debito`, `pix_sistema`, `pix_maquininha`.
  - Conclusão **não** cria PIX; PIX só por escolha, no valor da parcela, no máximo 1 por
    atendimento (mesmo após pago).
  - Estados de pagamento: `sem_pagamento`, `parcial`, `quitado`, `aguardando_pix`; total zero =
    `quitado` sem linhas.
  - `pago + reservado + novo <= price_cents`.
  - Gorjeta (`tip_cents`) fora da receita de serviço e da comissão; comissão continua sobre
    `price_cents` no `concluido`.
  - Estorno é lógico (`voided_*`), não apaga linha; correção = estorno + novo lançamento.
  - Receita = ledger por `received_at`; a receber = cobranças pendentes; nunca somar os dois.

**`.agents/rules/produto.md`**:

- Registrar as formas de pagamento do v1, o gating salão/barbearia, o parcial com confirmação e o
  saldo restrito ao admin, a gorjeta explícita e o PIX apenas por escolha.
- Reforçar que recepção registra sem ler faturamento e profissional só o próprio atendimento.

**`.agents/rules/seguranca-multitenant.md`**:

- Acrescentar que `appointment_payments` tem RLS admin-only, sem grant de escrita ao cliente, e
  que a leitura operacional é por Edge escopada a um atendimento.
- Reforçar que nenhum dado de cartão (PAN/CVV/bandeira/NSU) é armazenado; cartão/maquininha são
  declaração do operador.

**Não atualizar**: `.agents/rules/stack.md` (não muda stack), `db-migration-supabase.md` (as
regras existentes já cobrem a migration) e `harness.config.json` (comandos não mudam).

## Interface congelada

### RPC

```text
financial_summary(p_from timestamptz, p_to timestamptz) → jsonb
  security invoker
  revoke execute from public, anon
  grant execute to authenticated
  exige current_role_name() = 'admin'
```

### Hook

```ts
useFinancialSummary(from: string, to: string): UseQueryResult<FinancialSummary>
// queryKey: ["financial-summary", from, to]
// enabled: canViewFinancials && payments
```

### Aba Recebimentos (contrato de dados)

```ts
interface ReceivableRow {
  id: string;
  received_at: string;
  customer_name: string | null;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  source: "manual" | "asaas";
  operator_name: string | null; // received_by → profiles.full_name
  voided_at: string | null;
  void_reason: string | null;
  charge_id: string | null;
}
```

- Leitura direta sob RLS admin; sem Edge de lista.
- `operator_name` é PII operacional; não vai para log nem para exportação (não há exportação).

### Definições congeladas (não reinterpretar)

- `received_service_cents` **não** inclui gorjeta.
- `received_total_cents` = serviço + gorjeta, mas os cards mostram separados.
- `receivable_cents` é snapshot de cobranças pendentes não expiradas.
- `open_cents` é saldo de atendimentos concluídos por `starts_at`.
- `charges.status='pago'` nunca é receita.

## Alternativas consideradas

- **Painel lendo `charges` pagas** (status quo): descartada. Contaria PIX pago e ignoraria
  dinheiro/cartão; violaria RF-25.
- **Painel somando ledger + charges pagas**: descartada. Receita dupla (PRD §8).
- **Edge com service role para o resumo**: descartada. Um agregado de leitura admin não precisa
  de service role; RLS admin já recorta e evita ampliar privilégio.
- **RPC com `p_tenant_id`**: descartada. Abriria a porta para tenant do cliente; `current_tenant_id()`
  é a fonte segura (RF-29).
- **Aba Recebimentos via Edge de settlement**: descartada. A Edge é de um atendimento e não deve
  virar listagem/histórico.
- **Ligar `payments` para tenant legado (`segment=null`)**: descartada (ambiguidade #9). O legado
  não tem o fluxo validado; fica desligado até migração de segmento.
- **Incluir gorjeta na receita para “fechar o caixa”**: descartada. Gorjeta tem linha própria e
  não é receita de serviço/comissão (D6).

## Consequências

- O admin passa a ver receita real por forma e gorjeta separada; o “a receber” não infla a
  receita.
- A aba Recebimentos é admin-only por RLS; recepção/profissional não têm caminho de lista.
- O painel pode divergir da comissão (caixa × competência) — é uma limitação declarada, não um
  bug; a UI deve rotular “recebido no período” e “comissão por competência”.
- A flag `payments` desligada mantém clínica/legado no fluxo antigo; a dívida é explícita.
- As regras de domínio deixam de induzir “PIX automático ao concluir”; novos agentes/engenheiros
  não reintroduzem o comportamento antigo.
- Consultas de resumo dependem dos índices da ADR-001; períodos longos (> 366 dias) são
  rejeitados para proteger a UI.

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Receita dupla (ledger + charges pagas) | números inflados | painel lê só o ledger; `charges.pago` só em “a receber” quando pendente (não pago) |
| Gorjeta somada na receita | receita/comissão erradas | campos separados; testes com gorjeta > 0 |
| Estorno esquecido no filtro | receita inflada | todo agregado usa `voided_at is null`; teste com linha estornada |
| Recepção acessa a aba | vazamento | `canViewFinancials=false` + RLS admin-only; teste de RLS |
| `p_tenant_id` no cliente | cross-tenant | RPC sem parâmetro de tenant; `current_tenant_id()` |
| Período enorme | query lenta | limite de 366 dias + índices |
| Comissão × caixa | expectativa errada | rótulos explícitos; D8 declarado |
| Tenant legado ligado por engano | fluxo não validado | `payments=false` para `null`/clínica; teste de `resolveFeatures` |
| Regra antiga permanece | PIX automático reintroduzido | atualização de `dominio.md`/`produto.md` na mesma entrega; revisão no code review |

## Critérios de aceite

1. `financial_summary` existe, é `security invoker`, sem `p_tenant_id`, exige admin e rejeita
   período > 366 dias.
2. Admin vê receita de serviço, gorjeta, total, a receber, em aberto e por método;
   recepção/profissional recebem 403.
3. Um atendimento quitado em dinheiro + uma cobrança pendente: recebido = dinheiro; a receber =
   cobrança; receita **não** inclui a cobrança (RF-25).
4. Uma cobrança paga com recebimento no ledger é contada uma única vez, pelo ledger.
5. Linha estornada não aparece em nenhuma soma; aparece no histórico da aba Recebimentos.
6. Gorjeta aparece em linha própria e não altera receita de serviço nem comissão.
7. Aba Recebimentos só aparece para admin; query sob RLS não retorna linhas para recepção/
   profissional; filtros de período/método/status e paginação funcionam.
8. `resolveFeatures('salao')` e `('barbearia')` têm `payments=true`; `clinica`/`null` têm
   `payments=false`; `commission`/`combos` mantêm os valores anteriores.
9. `usePermissions` expõe as 7 capacidades e a matriz bate com a tabela; UI esconde ações, mas o
   teste de RLS/Edge prova a negação real.
10. `.agents/rules/dominio.md` e `.kiro/steering/dominio.md` não afirmam mais “ao concluir gera
    PIX”; descrevem o ledger, o cap de 1 PIX, gorjeta fora da receita/comissão e comissão
    inalterada.
11. `.agents/rules/produto.md` e `.agents/rules/seguranca-multitenant.md` refletem as formas,
    o RBAC e a ausência de dados de cartão.
12. Nenhuma leitura de `charges.status='pago'` como receita permanece no painel/aba.

## Escopo desta decisão

**Dentro**: definições financeiras, RPC de resumo, painel admin, aba Recebimentos, matriz de
capabilidades, flag `payments`, atualização de `dominio.md`/`produto.md`/`seguranca-multitenant.md`
e espelho de domínio.

**Fora**: schema/RLS/backfill (ADR-001), RPCs/Edge de escrita (ADR-002), `create-charge`/webhook
(ADR-003), componentes de captura/settlement (ADR-004), exportação/nota fiscal/WhatsApp, caixa/
turno, relatórios além do painel/aba, SPEC/PLAN/TASKS, código de aplicação, branch/PR.

## Perguntas abertas

1. **“A receber” periodizado**: esta ADR define snapshot (cobrança pendente agora). Se o dono
   quiser “a receber gerado no período”, é um campo adicional (`receivable_created_cents`), sem
   mudar a definição atual.
2. **Em aberto por competência**: usa `starts_at` (data do serviço). Se o negócio preferir a data
   de conclusão, é preciso persistir `concluded_at` em `appointments` (hoje não existe) — nova
   ADR, não um ajuste de query.
3. **Tenant legado**: fica desligado (ambiguidade #9). Migrar `segment` é iniciativa separada;
   não ligar `payments` por heurística.

# ADR-07 — Financeiro por unidade (`unit_id` derivado no ledger e em `charges`)

- **Status**: Aceito (design congelado)
- **PRD**: §7 (ledger), §6.4 RF-22/RF-23, R9, decisões Q2/Q3
- **UX-SPEC**: §5 financeiro (DRE com `UnitFilter`, Receber/Cobranças com coluna), W7
- **Depende de**: ADR-02 (coluna + derivação), ADR-03 (RLS), ADR-06 (RPCs de recorte)
- **Bloqueia**: ADR-11 (UI financeira), ADR-13 (nada de cache financeiro)
- **Escopo de escrita**: `supabase/migrations/`, `supabase/functions/`, `src/hooks/useFinancialSummary.ts`, `src/hooks/useReceivables.ts`, `src/hooks/useDre.ts`

## Contexto

`appointment_payments` é a SSoT de receita (ledger 1:N por atendimento); `charges` é
gateway-only ("a receber" = snapshot de pendentes). Regras invioláveis: receita e a receber
nunca se somam, estorno é lógico (`voided_at`), update de valor/delete proibidos, `tip_cents`
fora da receita/comissão. O PRD acrescenta recorte por unidade **sem mudar o ledger**.

O vetor de risco é o cliente enviar `unit_id` para "escolher" onde a receita cai (R9). Por
isso a unidade é **derivada do atendimento** e imutável — nunca digitada, nunca alterável por
edição posterior do atendimento.

## Decisão

### D1 — Derivação e imutabilidade

`appointment_payments.unit_id` é preenchido por trigger `BEFORE INSERT` a partir de
`appointments.unit_id`; qualquer valor enviado pelo cliente é ignorado. Trigger
`BEFORE UPDATE` rejeita mudança de `unit_id` (mesmo padrão de guard de coluna privilegiada).
`charges.unit_id` é derivado quando `appointment_id` não é nulo (cobrança de assinatura
permanece `null` = tenant-level) e também é imutável.

### D2 — Regra de receita preservada

- Receita continua `sum(amount_cents)` com `voided_at is null`, por `received_at` (regime de
  caixa); por unidade, é `group by unit_id`.
- "A receber" continua snapshot de `charges.status='pendente'` com `asaas_payment_id`, sem
  filtro de período; recorte por `unit_id` quando existir.
- Receita + a receber nunca se somam (nenhuma RPC/UI muda isso).
- `tip_cents` fica fora da receita de serviço e da base de comissão, em qualquer recorte.
- Estorno lógico não move a linha de unidade; ela permanece na unidade originalmente
  recebida, com `voided_at` preenchido (histórico correto).

### D3 — Transferência de atendimento não reescreve o passado

Quando um atendimento é transferido entre unidades (permitido com revalidação de conflito —
ADR-03/ADR-10):

- Linhas de ledger já gravadas **mantêm** `unit_id` da unidade em que o dinheiro foi
  recebido (imutável).
- Linhas novas após a transferência usam a unidade vigente do atendimento.
- O DRE por unidade mostra receita na unidade que recebeu; a UI do atendimento exibe o
  histórico por linha, não um total realocado.

Isso evita "mover dinheiro" retroativamente — princípio contábil, não conveniência de tela.

### D4 — Despesas e títulos (o que é derivado e o que é atribuído)

| Entidade | `unit_id` | Origem |
|---|---|---|
| `appointment_payments` | NOT NULL, imutável | derivado do atendimento |
| `charges` | nullable | derivado quando há atendimento |
| `receivables` (contas a receber) | nullable | derivado do atendimento/cobrança quando houver; avulso pode ser atribuído por admin |
| `payables` (contas a pagar) | nullable | atribuição opcional do admin na criação/edição (não derivável) |
| `statement_imports`/conciliação | nullable | atribuição explícita; default "Sem unidade" |

`null` = tenant-level e aparece no bucket **"Sem unidade"** do DRE/consolidado. **Não há
rateio** de despesa entre unidades na v1 (Q2/escopo): rateio cria regra de negócio nova e
alocação arbitrária. O total do DRE = Σ unidades + sem unidade.

### D5 — Bordas de escrita (Edge Functions)

`register-appointment-payments`, `create-charge`, `confirm-charge-manual`,
`get-appointment-settlement`, `export-ledger` passam a **ignorar** qualquer `unit_id` de
payload (validação zod rejeita o campo quando enviado por engano) e derivam via banco. A
leitura operacional da settlement continua escopada ao atendimento; o RLS de unidade é
redundante e não substitui o escopo por appointment.

### D6 — Export e relatórios

CSV/export contábil ganha coluna `unidade` (`short_name`), com aviso na UI de que o arquivo
contém a coluna. Export de ledger já é por período; passa a aceitar `p_unit_id` opcional.
Nenhuma mudança na regra de `voided_at`.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `appointment_payments.unit_id` | NOT NULL, derivado, imutável; rejeita valor do cliente |
| `charges.unit_id` | nullable; derivado com atendimento; imutável |
| `financial_summary(p_start, p_end, p_unit_id?)` | mesmos campos + `unit_id` no recorte; sem somar receita e a receber |
| `dre_by_unit(p_start, p_end, p_regime)` | `null` = "Sem unidade"; nunca rateio |
| `export-ledger` | aceita `p_unit_id` opcional; CSV com coluna `unidade` |
| Código de erro | `unit_id_not_allowed` quando payload de escrita tenta enviar unidade |

## Consequências

**Positivas**
- Recorte por unidade sem tocar na SSoT nem na regra de receita.
- Impossível "plantar" receita em outra unidade pelo cliente.
- Histórico contábil coerente após transferência de atendimento.

**Negativas / custos**
- Três colunas novas (`appointment_payments`, `charges`, receivables/payables) com guards.
- Despesa sem unidade vira bucket visível — exige comunicação de produto (não é bug).

**Riscos e mitigação**
- *Risco*: `unit_id` derivado no INSERT mas alterável por UPDATE. *Mitigação*: guard trigger +
  teste de update direto.
- *Risco*: DRE somar receita + a receber no mesmo bloco. *Mitigação*: testes existentes de
  invariante estendidos ao recorte por unidade.
- *Risco*: linha de ledger antiga ficar com unidade errada após transferência. *Mitigação*:
  imutabilidade + teste de transferência com recebimento antes/depois.
- *Risco*: export contábil divergir do DRE. *Mitigação*: mesma RPC/base para ambos.

## Escopo

**Entra**
- Derivação/guards, `unit_id` em receivables/payables, recorte em RPCs/export, Edge Functions
  rejeitando o campo, testes de invariantes.

**Não entra**
- Rateio de despesa, alteração da máquina de estados de pagamento, nova forma de pagamento,
  mover receita histórica entre unidades, preço por unidade, reconciliação automática por
  unidade.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20261221090000_finance_unit_derive.sql` | colunas + triggers + guards |
| `supabase/migrations/20261221091000_finance_unit_backfill.sql` | backfill a partir do atendimento |
| `supabase/migrations/20261221092000_receivables_payables_unit.sql` | colunas nullable + índices |
| `supabase/functions/register-appointment-payments/` | rejeitar `unit_id` |
| `supabase/functions/create-charge/`, `confirm-charge-manual/` | idem |
| `supabase/functions/export-ledger/` | `p_unit_id` + coluna |
| `src/hooks/useFinancialSummary.ts` | recorte |
| `src/hooks/useReceivables.ts`, `usePayables.ts` | recorte/atribuição |
| `src/hooks/useDre.ts` | por unidade + "Sem unidade" |

## Critérios de aceite (testáveis)

- [ ] Ledger gravado sem `unit_id` recebe o do atendimento; valor enviado pelo cliente é
      ignorado/rejeitado.
- [ ] `UPDATE appointment_payments SET unit_id=...` falha (imutável).
- [ ] Cobrança de assinatura (`appointment_id null`) permanece com `unit_id null`.
- [ ] Receita por unidade = Σ linhas `voided_at is null`; estorno não muda unidade e reduz a
      receita da unidade correta.
- [ ] `receita + a receber` nunca aparece somado; recorte por unidade mantém a separação.
- [ ] Transferência com recebimento antes e depois deixa linhas em duas unidades e o total
      por unidade reflete cada recebimento.
- [ ] DRE total = Σ unidades + "Sem unidade" (fixture com despesa sem unidade).
- [ ] Export CSV inclui coluna `unidade` e valor consistente com o DRE.
- [ ] `tip_cents` fora da receita em todos os recortes.

## Dependência / ordem

Depois de ADR-02 (coluna) e ADR-03 (policies). Antes de ADR-06 DRE por unidade e de ADR-11.

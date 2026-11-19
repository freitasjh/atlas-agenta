# ADR-07 — Contas a receber avulsas (cobrança PIX + recebimento + UI)

- **Status**: `proposed`
- **Depende de**: ADR-06 (sequência; paralelizável após ADR-01).
- **RFs**: RF-18, RF-19, RF-20, RF-21.

## Contexto

Receber tem duas naturezas que não podem se misturar: aba Atendimentos = ledger `appointment_payments` readonly (SSoT receita, sem CRUD); aba Avulsas = cobranças PIX fora do ledger com categoria própria no DRE. PRD fronteira: avulsa nunca entra no ledger; receita SSoT = ledger.

## Decisão

- `receivables`: `id, tenant_id, customer_id, descricao, categoria, vencimento_at, valor_cents, status (pendente|parcial|pago|cancelado), asaas_payment_id nullable, created_at`; unique `(tenant_id, asaas_payment_id)` quando não-nulo.
- `receivable_settlements`: `id, tenant_id, receivable_id FK composta, valor_cents, recebido_at, metodo, created_by`; sem update/delete; barra pago vs total = sum/total.
- Cobrança: Edge `create-receivable-charge` (PIX Asaas QR+copia e cola, idempotente por receivable); `Cobrar WhatsApp` só com opt-in (template fora janela); `Registrar recebimento` manual com auditoria.
- UI `/app/financeiro/receber`: tabs Atendimentos (readonly ledger via RPC existente `financial_summary`/lista, sem botões de escrita) + Avulsas (criar cobrança, tabela status + barra, ações cobrar/receber). Sem entitlement novo (usa base `payments` segmento) — declarado: avulsas são extensão do recebimento operacional, não capacidade gatable nova.

## Consequências

- Positivas: separa SSoT de avulso sem risco contábil; DRE futuro distingue categorias.
- Negativas: avulsa paga nunca migra para o ledger (decisão permanente, PRD domínio).

## Escopo

- Entra: migrations + RLS admin-only + Edge cobrança + webhook reuse + UI 2 tabs.
- Não entra: DRE (ADR-09), conciliação (ADR-08).

## Arquivos afetados

- `supabase/migrations/*_receivables.sql`
- `supabase/functions/create-receivable-charge/index.ts`
- `src/app/financeiro/receber/*`, `src/hooks/useReceivables.ts`

## Critérios de aceite (testáveis)

1. Aba Atendimentos sem nenhum botão de escrita; valores batem com `financial_summary`.
2. Criar avulsa → pendente; cobrar sem opt-in → bloqueado; com opt-in → PIX gerado + mensagem enfileirada.
3. Recebimento parcial atualiza barra; total → `pago`; replay webhook → sem duplicar settlement.
4. RLS cross 0; suite verde.

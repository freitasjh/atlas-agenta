# ADR-INDEX — cobranca-formas-pagamento

> Ledger 1:1 com `ADRs/**`: uma linha por ADR; a ordem é a de merge.
> **Teto de 5 ADRs/PRD:** exatamente 5, sem ADR de fase 2. Qualquer decisão nova que
> não caiba em um destes ADRs vira “Pergunta aberta” no ADR correspondente, não um 6º ADR.
> **Status:** ADR-001 `in-progress` (implementado e revisado, aguardando PR/merge humano); ADR-002..005 `todo`.
> **Contrato das colunas:** `order` inteiro ≥1 · `status` ∈ todo|in-progress|merged|dropped ·
> `depends_on` declarado (`—` quando não há) · `dir` = `ADRs/ADR-00N-{slug}/` ·
> `branch` = `adr/cobranca-formas-pagamento/{nn}-{slug}` · `merge` preenchido quando
> `status=merged` (aqui `—`, pois nenhum foi mergeado).

| order | id | title | status | depends_on | dir | branch | merge |
|---|---|---|---|---|---|---|---|
| 1 | ADR-001 | Schema: ledger `appointment_payments`, `charges` gateway-only, unicidade, RLS/grants e backfill | in-progress | — | ADRs/ADR-001-schema-ledger-recebimentos/ | adr/cobranca-formas-pagamento/01-schema-ledger-recebimentos | — |
| 2 | ADR-002 | API privilegiada: RPCs e Edge Functions de registro, settlement, cancelamento, baixa manual e estorno | todo | ADR-001 | ADRs/ADR-002-api-privilegiada-rpc-edges/ | adr/cobranca-formas-pagamento/02-api-privilegiada-rpc-edges | — |
| 3 | ADR-003 | PIX do sistema: `create-charge` por parcela, idempotência e webhook que cria recebimento sem dupla contagem | todo | ADR-001, ADR-002 | ADRs/ADR-003-pix-sistema-idempotente/ | adr/cobranca-formas-pagamento/03-pix-sistema-idempotente | — |
| 4 | ADR-004 | Frontend do fechamento: captura, settlement, comprovante, estados, i18n, a11y e hooks | todo | ADR-002, ADR-003 | ADRs/ADR-004-frontend-fechamento-pagamento/ | adr/cobranca-formas-pagamento/04-frontend-fechamento-pagamento | — |
| 5 | ADR-005 | Relatórios financeiros admin, aba Recebimentos, RBAC final e atualização das regras de domínio/produto | todo | ADR-001, ADR-002 | ADRs/ADR-005-relatorios-rbac-documentacao/ | adr/cobranca-formas-pagamento/05-relatorios-rbac-documentacao | — |

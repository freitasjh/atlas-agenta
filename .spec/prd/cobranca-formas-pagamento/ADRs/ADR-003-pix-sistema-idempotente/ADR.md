# ADR-003 — PIX do sistema: `create-charge` por parcela, idempotência e webhook que cria recebimento sem dupla contagem

- **Status**: in-progress (revisão 2026-11-06: fases 1–4 entregues pela ADR-001/ADR-002;
  **escopo remanescente = webhook + cutover/backfill**)
- **Data**: 2026-11-06 · **Revisão**: 2026-11-06 (reemissão de PIX expirado/cancelado; códigos
  alinhados à tabela congelada da ADR-002; estado de entrega por critério)
- **PRD**: cobranca-formas-pagamento (RF-05, RF-06, RF-14, RF-16, RF-17, RF-18, RF-19, RF-23,
  RF-27; RNF-07, RNF-08, RNF-11, RNF-12)
- **Decisões cobertas**: D9 (PIX só por escolha, valor da parcela, máx. 1 PIX **ativo** por
  atendimento); ambiguidade §14 #6 (revisada em 2026-11-06) e #3 (janela do QR, no que toca o
  ciclo da cobrança)
- **depende-de**: ADR-001, ADR-002
- **ADRs dependentes**: ADR-004

## Contexto

O fluxo original criava a cobrança PIX **automaticamente** ao concluir, pelo **valor cheio**
(`StatusChangeConfirm.tsx`), e o webhook fazia `update charges set status='pago'` direto
(`asaas-webhook/handler.ts`), sem criar recebimento. Esse desenho misturava intenção de cobrança
com receita e permitia dupla contagem (ledger + `charges.status='pago'`).

A ADR-001 separou `charges` (gateway) de `appointment_payments` (recebido) e entregou o backfill.
A ADR-002 entregou as RPCs (`register`, `settle`, `cancel`, `void`, `reserve`, `reopen`,
`release`, `claim`), as 5 Edge Functions novas e a extensão de `create-charge`.

Esta ADR congela o que **já foi entregue** por essas duas ADRs, corrige a decisão de reemissão e
define o **escopo remanescente**: a reescrita do `asaas-webhook` (dedupe durável, liquidação por
RPC, anomalias, sem rebaixamento de `pago`) e o **cutover com reexecução do backfill**.

## Estado de entrega (medido no código, 2026-11-06)

| Item | Dono | Estado | Evidência no repo |
|---|---|---|---|
| Ledger `appointment_payments`, uniques, RLS/grants, backfill | ADR-001 | ✅ entregue | `supabase/migrations/20261106120000_appointment_payments_ledger.sql` |
| `settle_charge_payment` (única via de receita PIX) | ADR-002 | ✅ entregue | `supabase/migrations/20261106131000_appointment_payments_api_rpcs.sql` |
| Reserva/reemissão/claim/attach/release | ADR-002 | ✅ entregue | `20261106130000_appointment_payments_api_helpers.sql`, `20261106132000_charges_gateway_claim.sql` |
| `create-charge` por parcela + `idempotency_key` + reemissão | ADR-002 | ✅ entregue | `supabase/functions/create-charge/handler.ts` |
| `cancel-charge`, `confirm-charge-manual`, `void-*`, `register-*`, `get-settlement` | ADR-002 | ✅ entregue | `supabase/functions/{cancel-charge,confirm-charge-manual,void-appointment-payment,register-appointment-payments,get-appointment-settlement}/` |
| Testes (integração + functions) | ADR-001/002 | ✅ 215 integração, 298 functions | `tests/integration/security/*`, `supabase/functions/*/handler.test.ts` |
| **`asaas-webhook`** (dedupe durável, `settle`, sem downgrade) | **ADR-003** | ⏳ **não iniciado** | `supabase/functions/asaas-webhook/handler.ts` ainda faz `update charges` |
| **Cutover/replay do backfill** | **ADR-003** | ⏳ **não iniciado** | — |

> Consequência de leitura: os critérios de aceite 1, 3, 4, 5, 6 e 7 estão **cobertos pela
> ADR-002**; o critério 2 está implementado na parte que cabia à ADR-002 (fallback de saldo) e a
> remoção do fallback é a fase 6; os critérios 8–14 e o 15 (cutover) são o objeto desta entrega.
> Ver “Critérios de aceite” com status por item.

## Decisão

### 1. `create-charge` — contrato herdado da ADR-002 + reemissão

**Dono do contrato: ADR-002** (`create-charge`, `reserve_appointment_charge`,
`reopen_charge_for_reissue`, `claim`/`attach`/`release`). Esta ADR **não** redefine o contrato;
registra apenas o que a decisão de reemissão acrescenta e o alinhamento dos códigos de erro.

Resumo do contrato em vigor (detalhe, erros e matriz de autorização na ADR-002):

- Body: `{ appointment_id, amount_cents?, idempotency_key? }`; `amount_cents` é a **parcela PIX**
  (não o total). Ausente (cliente antigo, RNF-11) ⇒ saldo restante; saldo 0 ⇒
  `409 AMOUNT_EXCEEDS_REMAINING`. Presente: inteiro > 0 (`400 INVALID_BODY` se ≤ 0) e
  `<= remaining_cents` (senão `409 AMOUNT_EXCEEDS_REMAINING`).
- `idempotency_key` ausente ⇒ uuid gerado na Edge (a proteção real nesse modo é o cap de 1 PIX);
  o fallback é removido na fase 6 do rollout.
- Tenant e ator vêm do JWT (`resolveIdentity`); `tenant_id` no corpo é **rejeitado** pelo
  `zod.strict`, não “ignorado”.
- Pré-condições: atendimento existe e está `concluido` (senão `404 APPOINTMENT_NOT_FOUND` /
  `409 APPOINTMENT_INVALID_STATE`); tenant com Asaas ativo (senão `422 ASAAS_NOT_CONFIGURED`).
- Reserva local primeiro (`charges` `pendente`, `asaas_payment_id=null`), claim de 180s, criação no
  gateway com `externalReference=charges.id`, `attach` com fencing; falha ⇒
  `release_charge_reservation` + `422 GATEWAY_ERROR`. O gateway nunca participa da transação.
- Resposta 200: `{ charge_id, amount_cents, pix_qr_code, pix_copy_paste, expires_at, reused,
  requested_amount_mismatch }`; `reused=true` quando reapresenta cobrança pendente existente.

Saldo (`paid + reserved + novo <= price`), unique por atendimento e atomicidade pertencem à
ADR-001/ADR-002. A decisão **de produto** que esta ADR mantém é a reemissão abaixo.

#### 1.1 Reemissão — “1 ativo por vez; `pago` nunca” (decisão de produto de 2026-11-06)

Regra: **no máximo uma cobrança PIX ativa por atendimento**. `expirado` e `cancelado` podem ser
reemitidos **na mesma linha** de `charges`; `pago` **nunca**.

Fluxo (implementado em `create-charge` + `reopen_charge_for_reissue`):

1. `reserve_appointment_charge` detecta `pendente` vencida, `expirado` ou `cancelado` e devolve
   `reissue=true`, `previous_charge_id` e `previous_asaas_payment_id`.
2. A Edge **cancela a cobrança anterior no Asaas** (`DELETE /payments/{id}`) quando há
   `previous_asaas_payment_id`. `404` do gateway é tratado como “já cancelada”. Falha de
   cancelamento ⇒ `422 GATEWAY_CANCEL_FAILED` e **nada** muda localmente.
3. `reopen_charge_for_reissue` reabre **a mesma linha** para `pendente`, limpa
   `asaas_payment_id`/QR/copia-e-cola/`idempotency_key`, audita `charge_reissued` e preserva
   `appointment_id`/`amount_cents`.
4. A Edge cria o novo PIX pelo mesmo `amount_cents`, associa o novo `asaas_payment_id` e devolve
   `reused=false`.

Invariantes da reemissão:

- Não existe segunda linha em `charges` para o mesmo atendimento (unique da ADR-001).
- Não existe código de erro `PIX_ALREADY_USED` nem “cobrança não recriável”: a recusa é
  `CHARGE_NOT_PENDING` (paga) ou `PENDING_CHARGE_EXISTS` (valor divergente na reemissão).
- A UI deve esconder “PIX do sistema” somente quando a cobrança estiver `pago`; para
  `expirado`/`cancelado`, oferece reemitir (ADR-004).
- O `asaas_payment_id` anterior é perdido da linha (o `reopen` limpa o campo). Evento tardio do
  PIX anterior cai em `charge_unknown_webhook` sem receita — ver risco R-06 e a conciliação por
  `externalReference = charges.id` no Asaas.

### 2. Webhook do Asaas — recebimento idempotente (**escopo remanescente desta ADR**)

O handler atual (`supabase/functions/asaas-webhook/handler.ts:72-86`) faz `update charges` direto
e não cria ledger. Ele será **substituído**; as RPCs entregues **não** mudam.

#### 2.1 Autenticação e parsing

- `verify_jwt = false` (`supabase/config.toml`): o Asaas não carrega JWT do Supabase.
- Header `asaas-access-token` obrigatório; ausente ⇒ `401`, nenhum efeito.
- Token esperado:
  - cobrança conhecida ⇒ `tenant_asaas_config.asaas_webhook_token` do **tenant da cobrança**;
  - tenant sem token ⇒ fallback `ASAAS_WEBHOOK_TOKEN` (env do servidor);
  - cobrança desconhecida ⇒ **somente** o global (não há tenant para resolver);
  - nenhum token configurado ⇒ `401` (fail-closed), nunca processar.
- Comparação em tempo constante (`constantTimeEqual`, `_shared/asaas.ts`).
- Corpo **não confiável**: JSON + zod tolerante a campos extras (`passthrough`). Exige
  `id` (id do evento), `event` (tipo) e, quando houver `payment`, `payment.id`. `payment` pode
  faltar (eventos não financeiros) ⇒ `200` no-op.
- `payment.value`, `payment.paymentDate`, `payment.confirmedDate` e
  `payment.externalReference` são lidos de forma **tolerante**: tipo inválido = ausente, nunca
  derruba o evento.
- Nada do payload é executado; `webhook_events.payload` permanece `{}` (sem PII, sem payload cru).

#### 2.2 Ordem de execução (obrigatória)

```text
1. OPTIONS → 200 | não-POST → 405
2. cria service client (falha ⇒ 500)
3. header de token presente (senão 401)
4. parse JSON + zod (senão 400)
5. payment.id ausente ⇒ 200 no-op
6. lookup charges por asaas_payment_id (unique global; nunca por externalReference)
7. valida token (tenant da charge || global) ⇒ 401 se inválido
8. insere webhook_events com processed_at = null  (dedupe durável)
9. dispatch do evento
10. marca processed_at = now(), status = 'processado'
11. log técnico + 200
```

O dedupe (passo 8) vem **depois** da autenticação (impede envenenar o dedupe com evento forjado) e
**antes** de qualquer efeito financeiro.

#### 2.3 Dedupe durável (corrige perda em falha)

- Chave: unique `(event_id, payment_id)` (`webhook_events_asaas_dedupe_uidx`).
- Inserir com `processed_at = null` **explícito**. O default atual da coluna é `now()`
  (`20250306100000_asaas_charges.sql:100`), o que faria um evento falho parecer processado; a
  migration desta ADR remove o default e o insert passa a declarar `null` sempre.
- Resultado da inserção:

| Situação | Ação |
|---|---|
| inseriu | processa |
| `23505` e `processed_at is not null` | `200` no-op (já processado) |
| `23505` e `processed_at is null` | **reprocessa** (a entrega anterior falhou). Concorrência de takeover é aceita porque `settle` é idempotente (unique por `charge_id`) |
| `23505` sem linha do par `(event_id, payment_id)`, mas com o mesmo `event_id` (índice legado `(source, external_event_id)`) | `200` no-op: a colisão é de dedupe, não takeover |
| `23505` sem nenhuma linha correspondente | **reprocessa** (conflito transitório; nada foi processado) |
| outro erro de insert | `500`, nada processado |

- Sucesso ⇒ `update webhook_events set processed_at = now(), status = 'processado'`.
- Falha em qualquer passo após o insert ⇒ `500`, `processed_at` permanece `null` (Asaas reenvia —
  at-least-once, F7).
- `processed_at` é a **única** fonte de verdade do dedupe; `status` (`recebido`/`processado`) é
  rótulo operacional.
- Cobrança desconhecida não gera linha em `webhook_events` (`tenant_id` é `not null`): responde
  `200` e audita `charge_unknown_webhook` com `tenant_id = null` (a policy de `audit_log` já
  permite leitura por super admin quando `tenant_id is null`).

#### 2.4 Eventos e ações

| Evento | Ação |
|---|---|
| `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` | `settle_charge_payment(p_tenant_id, charge_id, p_paid_at, 'asaas', null, event_id)`. A RPC cria o recebimento idempotente e marca `pago` só se ainda não estiver. |
| `PAYMENT_OVERDUE` | **Somente** `pendente → expirado` (`update ... .eq('status','pendente')`); audita `charge_expired`. Nunca toca `pago`/`cancelado`. |
| `PAYMENT_DELETED` | **Somente** `pendente → cancelado`; audita `charge_deleted_gateway`. Nunca toca `pago`. |
| evento contendo `REFUND` ou `CHARGEBACK` (`PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`, `PAYMENT_CHARGEBACK_DISPUTE`, `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`) | **Fora do v1**: nenhum efeito no ledger; audita `gateway_refund_out_of_scope`; `200`. |
| demais eventos | `200` no-op; `processed_at` marcado; nenhum estado alterado. |

`p_paid_at` = `payment.paymentDate` (fallback `payment.confirmedDate`, depois `null`; a RPC faz
`coalesce(..., now())`). Datas inválidas ⇒ `null`.

`PAYMENT_RECEIVED` em cobrança `expirado` **cria receita** (a RPC aceita `pendente` e `expirado`):
dinheiro real não é descartado; o atraso é conciliação, não erro (D-10 da ADR-002).

#### 2.5 Regras de ouro

1. **Nunca** `update charges set status='pago'` sem criar/garantir o recebimento. Quem faz os dois
   é `settle_charge_payment` (transação única). O webhook **não** escreve `pago`.
2. **Nunca** rebaixar `pago`. Toda transição de status do webhook é `pendente → expirado|cancelado`
   com filtro explícito.
3. **Cobrança cancelada** + evento de pagamento ⇒ a RPC grava `charge_paid_after_cancel`, **não**
   cria receita; o webhook responde `200` (para parar o retry) — PRD RF-17. O webhook **não**
   duplica a auditoria da RPC.
4. **Duplicata** com `processed_at` não nulo ⇒ `200` e **nenhum** dispatch (nem RPC, nem update).
5. **Valor**: a fonte é `charges.amount_cents`, nunca `payment.value`. Divergência ⇒ audita
   `payment_amount_mismatch` e **ainda assim** liquida pelo valor da cobrança.
6. **Baixa manual anterior** ⇒ a RPC encontra `pago` + recebimento e devolve `replayed=true`;
   `200`, sem segunda linha (PRD RF-18).
7. **Cobrança desconhecida** (`asaas_payment_id` não encontrado) ⇒ `200` + auditoria
   `charge_unknown_webhook` (`tenant_id = null`); não cria nada e **não** confia em
   `externalReference` do payload para gravar (ele pode ser registrado como
   `reported_external_reference`, apenas para conciliação).
8. **Falha** de RPC/update/insert ⇒ `500` e `processed_at = null`; Asaas reenvia.
9. Nenhum `4xx` para evento válido e autenticado: `4xx` só para corpo/rota/token inválidos.

#### 2.6 Anomalias (todas com resposta 200, nunca 5xx)

| `action` | Quando | `tenant_id` | Receita |
|---|---|---|---|
| `charge_paid_after_cancel` | `settle` devolve `anomaly` | da cobrança | não (auditada pela RPC) |
| `charge_invalid_amount` | `settle` devolve `anomaly` (`amount_cents <= 0`) | da cobrança | não (auditada pela RPC) |
| `charge_not_appointment` | `settle` devolve `PT409` | da cobrança | não |
| `payment_amount_mismatch` | `payment.value` ≠ `charges.amount_cents` | da cobrança | sim (valor da cobrança) |
| `gateway_refund_out_of_scope` | `REFUND`/`CHARGEBACK` | da cobrança | não |
| `charge_unknown_webhook` | lookup vazio | `null` | não |
| `charge_expired` | transição de overdue | da cobrança | não |
| `charge_deleted_gateway` | transição de deleted | da cobrança | não |

Metadados permitidos: `event_id`, `event_type`, `charge_id`, `payment_id`, `amount_cents`,
`payment_value_cents`, `source`. Proibido: payload cru, QR, copia-e-cola, token, nome, telefone,
documento.

#### 2.7 Logs

`logEvent("asaas_webhook", { event_id, event_type, tenant_id, charge_id, status, code })` —
whitelist de `_shared/http.ts`, estendida de forma **aditiva** com `event_id` e `event_type`
(identificadores opacos do gateway; sem PII). Nunca `JSON.stringify(body)`, QR, copia-e-cola ou
token. Evento desconhecido é logado como `event_type="outro"` (não ecoa string arbitrária do
payload).

### 3. Convivência PIX do sistema × formas manuais

- Pagamento manual é receita imediata no ledger (`source='manual'`).
- PIX do sistema **reserva** valor em `charges.status='pendente'` e só vira receita em
  `settle_charge_payment`.
- `paid_cents + reserved_cents + novo <= price_cents` é revalidado no RPC de registro (ADR-002) e
  no `create-charge`.
- Nunca somar `charges.status='pago'` com `appointment_payments`: a receita é só o ledger.

### 4. Rollout e cutover (RNF-11)

| Fase | Escopo | `create-charge` | Frontend | Webhook |
|---|---|---|---|---|
| 1–2 | entregue (ADR-002) | aceita `amount_cents` opcional; fallback = saldo restante; key opcional | novo diálogo envia valor e key | antigo (legado) |
| 3 | pendente (ADR-004) | idem | remove o disparo automático | antigo |
| **4 (esta entrega)** | **ADR-003** | idem (não muda) | indiferente — o webhook não depende da UI | **novo handler** + backfill reexecutado |
| 5 | pós-ADR-004 | idem | nenhum cliente antigo em circulação | novo |
| 6 | fechamento | `amount_cents`/`idempotency_key` obrigatórios; fallback removido | — | novo |

> As fases 3 (UI) e 4 (webhook) são independentes: o handler novo pode entrar antes de a UI parar
> de disparar o PIX automático. O que **não** pode é o webhook novo entrar sem o backfill (passos
> 1–3 abaixo).

**Cutover (ordem obrigatória):**

1. Aplicar as migrations desta ADR (dedupe durável + função de backfill).
2. Executar `select public.reconcile_appointment_payments_backfill();` e exigir
   `missing_after = 0` e `inserted = candidates` (idempotente; pode rodar N vezes).
   `skipped_invalid_amount` é reportado à parte: cobranças pagas com `amount_cents <= 0` não
   entram em `candidates` (só `amount_cents > 0`), não viram ledger e exigem conciliação manual.
3. Verificar `pagos_sem_ledger = 0` (consulta em SPEC §5.3).
4. Publicar o novo `asaas-webhook` (deploy único; não existe tráfego em paralelo).
5. Smoke de sandbox: `PAYMENT_RECEIVED` ⇒ 1 linha no ledger; reenvio do mesmo `id` ⇒ 200 sem
   segunda linha.
6. Monitorar por 24h: `charge_unknown_webhook`, `payment_amount_mismatch`,
   `gateway_refund_out_of_scope`, linhas com `processed_at is null` e `source='asaas'` mais
   antigas que 1h (eventos do WhatsApp não usam esse retry e ficam fora do índice/consulta).

**Rollback proibido depois do passo 4**: voltar o handler antigo rebaixaria a regra “nunca `pago`
sem recebimento”. Em incidente, desabilitar o webhook no Asaas, corrigir e reprocessar; o backfill
pode ser reexecutado a qualquer momento (idempotente).

## Interface congelada

### `create-charge` (contrato — entregue pela ADR-002)

```text
POST /functions/v1/create-charge
Authorization: Bearer <jwt>
{ appointment_id: uuid, amount_cents?: int, idempotency_key?: uuid }

200 { charge_id, amount_cents, pix_qr_code, pix_copy_paste, expires_at, reused,
      requested_amount_mismatch }
409 { code: "CHARGE_NOT_PENDING" | "AMOUNT_EXCEEDS_REMAINING" | "PENDING_CHARGE_EXISTS" |
            "APPOINTMENT_INVALID_STATE" | "IDEMPOTENCY_CONFLICT", message }
409 { code: "GATEWAY_IN_PROGRESS", message, retryable: true }
422 { code: "ASAAS_NOT_CONFIGURED" | "GATEWAY_ERROR" | "GATEWAY_CANCEL_FAILED", message }
```

> Os três códigos que a ADR-003 original inventava (`PIX_ALREADY_USED`,
> `NO_REMAINING_BALANCE`, `APPOINTMENT_NOT_CONCLUDED`) foram **substituídos** pelos códigos
> congelados da ADR-002 (`CHARGE_NOT_PENDING`, `AMOUNT_EXCEEDS_REMAINING`,
> `APPOINTMENT_INVALID_STATE`). Isso fecha a divergência D-09 apontada na SPEC da ADR-002 §9.3.

### `asaas-webhook` (contrato de efeito — escopo desta ADR)

```text
POST /functions/v1/asaas-webhook          (verify_jwt = false)
Header: asaas-access-token: <token do tenant | global>
Body: { id: string, event: string, payment?: { id: string, value?: number,
        paymentDate?: string, confirmedDate?: string, externalReference?: string, ... } }

Efeito:
  PAYMENT_RECEIVED|PAYMENT_CONFIRMED → settle_charge_payment (+1 linha idempotente) e pago
  PAYMENT_OVERDUE                    → pendente → expirado (nunca rebaixa pago)
  PAYMENT_DELETED                    → pendente → cancelado (nunca rebaixa pago)
  *REFUND* / *CHARGEBACK*            → anomalia gateway_refund_out_of_scope, sem ledger
  cancelada + pagamento              → anomalia charge_paid_after_cancel, sem receita
  valor divergente                   → anomalia payment_amount_mismatch + liquida pelo charge
  cobrança desconhecida              → anomalia charge_unknown_webhook, sem efeito

Resposta:
  200 { ok: true }            sucesso, no-op, duplicata ou anomalia
  400 { error: ... }          corpo/schema inválido
  401 { error: ... }          token ausente/inválido
  405 { error: ... }          método diferente de POST/OPTIONS
  500 { error: ... }          falha de processamento (processed_at continua null)
```

### Invariantes

1. No máximo 1 cobrança por `(tenant_id, appointment_id)` (unique da ADR-001).
2. No máximo 1 recebimento por `(tenant_id, charge_id)` (unique da ADR-001).
3. `charges.status='pago'` implica recebimento com `charge_id` (exceto legado ainda não
   backfilled, que o cutover zera). `pendente` sem `asaas_payment_id` é **reserva**, não cobrança
   com QR; `cancelado` sem `asaas_payment_id` é a marca durável de tentativa que falhou.
4. `appointment_payments` nunca nasce de `payment.value`; nasce de `charges.amount_cents`.
5. `pago` é terminal. `expirado`/`cancelado` só voltam a `pendente` pela **reemissão** (mesma
   linha, gateway anterior cancelado, auditoria `charge_reissued`).
6. Webhook repetido não altera somas; webhook tardio pós-cancelamento não cria receita.
7. Nenhuma escrita do webhook em `appointment_payments`; só `settle_charge_payment` escreve.
8. `processed_at` não nulo ⇒ nenhum efeito; `processed_at` nulo + falha ⇒ `500` e retry.

## Alternativas consideradas

- **Criar a cobrança no Asaas antes de gravar a linha local**: descartada. Um crash entre gateway
  e insert deixaria cobrança órfã sem chave local; a reserva local primeiro permite reconciliar
  por `externalReference`.
- **Gravar a linha local só depois do gateway** (comportamento antigo): descartada (origem da
  cobrança órfã e da duplicata no retry).
- **Unique parcial só de pendente**: descartada pela ambiguidade #6; o cap é único por
  atendimento, e a reemissão reusa a linha (não abre exceção ao unique).
- **Webhook fazendo `update` direto em `charges`**: descartada. Não cria o ledger, não é atômico
  com o recebimento e não trata cancelada.
- **Dedupe só em memória / com `processed_at` default `now()`**: descartada. O default faria um
  evento falho parecer processado e perderia o retry.
- **Confiar em `payment.value`/`externalReference` do payload**: descartada. O valor reservado é a
  fonte; o vínculo local é `asaas_payment_id`.
- **Dedupe com `source='evolution'` (valor atual)**: descartada nesta revisão. A coluna passa a
  aceitar `'asaas'` e o webhook grava `source='asaas'`; o dedupe do Asaas continua em
  `(event_id, payment_id)`, que independe de `source`.

## Consequências

- `create-charge` deixou de ser “uma cobrança por atendimento pelo preço cheio” e passou a ser
  “uma parcela PIX opcional, idempotente e validada contra o saldo” (ADR-002).
- `pago` nunca é recriado; `expirado`/`cancelado` são reemitidos na mesma linha, com cancelamento
  do PIX anterior no gateway. Não existe `PIX_ALREADY_USED`.
- O webhook deixa de ser um `update` simples e passa a chamar a RPC; o tempo de processamento
  aumenta, mas a transação é curta e o Asaas reenvia em falha.
- `webhook_events.processed_at` deixa de ter default; quem inserir sem a coluna grava `null` e
  será reprocessado — comportamento correto para at-least-once.
- O cutover exige uma janela de backfill: sem ela, cobranças pagas pelo handler antigo ficariam
  fora da receita nova.
- Eventos de refund/chargeback não alteram o ledger; ficam como anomalia (decisão explícita do
  v1).
- `charges` pode guardar uma linha reaproveitada por reemissão; o `asaas_payment_id` anterior não
  fica na linha nem na auditoria (o evento `charge_previous_cancelled` grava só
  `had_asaas_payment_id`). A referência de conciliação é `externalReference = charges.id` no Asaas
  (débito declarado, pergunta aberta 4).

## Riscos e mitigação

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R-01 | Duas cobranças no gateway no retry | cobrança órfã / cliente paga duas vezes | reserva local + unique + claim + consulta por `externalReference` |
| R-02 | Crash entre gateway e attach | linha sem QR | claim/attach com fencing; retry retoma por `externalReference` |
| R-03 | Webhook duplicado | receita dupla | `webhook_events` + unique por `charge_id` no `settle` |
| R-04 | Evento processado e resposta perdida | Asaas reenvia | duplicata com `processed_at` não nulo ⇒ 200 no-op |
| R-05 | Falha após inserir evento | perda do evento | insert com `processed_at=null`; 500; retry |
| R-06 | Evento do PIX **anterior** chega após a reemissão | pagamento real fora do ledger | o `asaas_payment_id` anterior saiu da linha; evento cai em `charge_unknown_webhook`; conciliar no Asaas por `externalReference = charges.id`. Débito declarado: a auditoria `charge_previous_cancelled` não guarda o id antigo |
| R-07 | `PAYMENT_OVERDUE` após pago | status rebaixado | update só a partir de `pendente` |
| R-08 | Pagamento após cancelamento | receita fantasma | RPC grava anomalia e não cria linha; 200 |
| R-09 | Valor do webhook diferente | receita errada | liquidar por `charges.amount_cents`; anomalia |
| R-10 | `payment.id` de outro ambiente (sandbox × produção) | cobrança errada | lookup global por `asaas_payment_id` (unique); token do tenant da cobrança; divergência de ambiente é conciliação, não escrita |
| R-11 | Cliente antigo ainda gera PIX automático | métrica de PIX indevido não cai | rollout em fases; remover fallback na fase 6 |
| R-12 | PII na descrição/log | LGPD | descrição genérica; log com whitelist; `webhook_events.payload` vazio |
| R-13 | Backfill roda antes de o handler novo subir e uma cobrança é paga no intervalo | receita faltando | reexecutar `reconcile_appointment_payments_backfill()` imediatamente antes do deploy e de novo após o smoke |
| R-14 | `charges.amount_cents = 0` em cobrança paga | ledger violaria `amount_cents > 0` | backfill conta como `skipped_invalid_amount` e não bloqueia o cutover; conciliação manual; `settle` devolve `charge_invalid_amount` |

## Critérios de aceite (com status em 2026-11-06)

| # | Critério | Status | Evidência / dono |
|---|---|---|---|
| 1 | `create-charge` cria pelo `amount_cents` explícito | ✅ coberto | ADR-002 (`reserve_appointment_charge`, `create-charge`) |
| 2 | Sem `amount_cents` usa saldo; sem saldo ⇒ 409; fase final torna obrigatório | 🟡 parcial | fallback entregue pela ADR-002; remoção = fase 6 (fora desta entrega) |
| 3 | Chamadas concorrentes não criam duas linhas | ✅ coberto | ADR-002 (unique + `FOR UPDATE` + claim) |
| 4 | Mesma `idempotency_key` não cria segunda cobrança | ✅ coberto | ADR-002 |
| 5 | Falha de gateway cancela reserva e retry não cria segunda | ✅ coberto | ADR-002 (`release_charge_reservation` + `reopen`/reemissão) |
| 6 | Atendimento não concluído ⇒ 409; tenant sem Asaas ⇒ 422 | ✅ coberto | ADR-002 (`APPOINTMENT_INVALID_STATE`, `ASAAS_NOT_CONFIGURED`) |
| 7 | Pendente existente reapresentada; `requested_amount_mismatch` correto | ✅ coberto | ADR-002 |
| 8 | `PAYMENT_RECEIVED` cria **uma** linha e marca `pago`; reenvio não duplica | ⏳ remanescente | esta ADR |
| 9 | Recebido após baixa manual não cria segunda linha (`replayed=true`) | ⏳ remanescente | esta ADR |
| 10 | Recebido em cobrança cancelada não cria receita e audita `charge_paid_after_cancel`; 200 | ⏳ remanescente | esta ADR |
| 11 | `PAYMENT_OVERDUE` só `pendente → expirado`; nunca rebaixa `pago` | ⏳ remanescente | esta ADR |
| 12 | Falha simulada deixa `processed_at=null` e retorna 500; reenvio processa | ⏳ remanescente | esta ADR |
| 13 | Nenhum caminho soma `charges.status='pago'` como receita | ⏳ remanescente (regressão) | esta ADR + ADR-005 |
| 14 | Logs/auditoria sem QR, copia-e-cola, payload cru, token ou PII | ⏳ remanescente | esta ADR |
| 15 | **Cutover**: `pagos_sem_ledger = 0`; backfill reexecutável sem duplicar | ⏳ remanescente (novo nesta revisão) | esta ADR |

## Escopo desta decisão (revisado em 2026-11-06)

**Já entregue (não reimplementar)**: DDL/RLS/backfill inicial (ADR-001); RPCs, 5 Edges,
`create-charge` estendida, reemissão, claim/fencing e testes (ADR-002).

**Dentro desta entrega**: reescrita de `supabase/functions/asaas-webhook/**`; migration de dedupe
durável de `webhook_events`; migration/função de backfill reexecutável de cutover; anomalias e
auditoria do webhook; logs sem PII; testes Deno + integração; runbook de cutover/monitoramento.

**Fora**: qualquer alteração nas RPCs entregues; `create-charge` (exceto correção de bug
comprovado); UI (ADR-004); painel/RBAC (ADR-005); estorno financeiro real no gateway;
parcelamento; adquirente; branch/PR.

## Perguntas abertas

1. **`event.id` ausente**: o Asaas envia `id` do evento em todos os webhooks? A decisão é exigir
   `id` (400 se ausente). Se o sandbox mostrar eventos sem `id`, a chave degrada para
   `event + payment.id` e dois eventos legítimos do mesmo tipo para o mesmo payment colapsariam —
   validar no sandbox antes do cutover.
2. **PIX órfão pago antes do attach** (R-02/R-06): a janela é pequena e o claim cancela o órfão,
   mas se o cliente pagar antes do cancelamento o dinheiro fica no Asaas sem ledger. Conciliação
   manual por `externalReference`; automação exige nova ADR.
3. **Eventos de refund/chargeback**: no v1 não alteram o ledger. Estorno automático é decisão de
   produto e nova ADR (PRD §7).
4. **Histórico do payment id na reemissão**: guardar o id anterior em `audit_log` (hoje só
   `had_asaas_payment_id`) melhoraria a conciliação do R-06. Não é feito nesta entrega para não
   tocar `create-charge`; candidato a débito.

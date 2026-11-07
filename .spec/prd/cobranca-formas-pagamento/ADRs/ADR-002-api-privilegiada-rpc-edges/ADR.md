# ADR-002 — API privilegiada: RPCs e Edge Functions de registro, settlement, cancelamento, baixa manual e estorno

- **Status**: todo
- **Data**: 2026-11-06
- **PRD**: cobranca-formas-pagamento (RF-07, RF-08, RF-11..RF-21, RF-26, RF-27, RF-29;
  RNF-01, RNF-04, RNF-07, RNF-08, RNF-10)
- **Decisões cobertas**: D2, D3, D4, D5, D9; ambiguidades §14 #1 (ato atômico concluir+registrar),
  #2 (saldo no diálogo), #3 (janela do QR), #4 (reuso da idempotency key), #12 (estorno lógico)
- **depende-de**: ADR-001
- **ADRs dependentes**: ADR-003, ADR-004, ADR-005

## Contexto

O schema da ADR-001 cria o ledger `appointment_payments`, mas **nenhum cliente escreve nele**.
Toda mutação precisa passar por caminho privilegiado (service role) que:

1. resolve a identidade no JWT e o vínculo (`profiles.tenant_id`, `profiles.role`);
2. valida o atendimento no tenant e, para profissional, que ele é o responsável;
3. trava o atendimento (`SELECT ... FOR UPDATE`) antes de calcular saldo;
4. grava o lote de forma atômica e idempotente;
5. audita sem PII;
6. devolve um contrato estável para o frontend.

Esta ADR congela as RPCs, as Edge Functions, os contratos JSON, os códigos de erro e a matriz de
autorização. `create-charge`/webhook ficam na ADR-003; a UI que consome estes contratos fica na
ADR-004.

## Decisão

### 1. RPCs (chamadas só pelo service role)

Todas as RPCs são `security invoker` (padrão), com `revoke execute ... from public, anon,
authenticated` e `grant execute ... to service_role`. Elas **não** usam `current_tenant_id()` nem
`auth.uid()` como fonte de autorização, porque o service role não carrega o JWT do usuário:
recebem `p_tenant_id` e `p_actor_id` **já resolvidos pela Edge** a partir do perfil autenticado.
Nenhum desses parâmetros vem do corpo do cliente.

#### 1.1 `register_appointment_payments`

```text
register_appointment_payments(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_appointment_id uuid,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_close_appointment boolean default true
) returns jsonb
```

**Pré-condições e validações**

1. `p_tenant_id`, `p_actor_id`, `p_appointment_id`, `p_idempotency_key` não nulos.
2. Ator existe em `profiles` com o mesmo `tenant_id`, `active = true` e
   `role ∈ {admin, receptionist, professional}`.
3. Se `professional`: `appointments.professional_id` = `professionals.id` do
   `professionals.profile_id = p_actor_id` no mesmo tenant. Caso contrário `PROFESSIONAL_NOT_OWNER`.
4. `SELECT ... FROM appointments WHERE tenant_id = p_tenant_id AND id = p_appointment_id
   FOR UPDATE`. Não encontrado → `APPOINTMENT_NOT_FOUND`.
5. Estado:
   - `em_atendimento` + `p_close_appointment = true` → permitido (fecha no mesmo ato).
   - `concluido` + `p_close_appointment = false` → permitido (registrar depois).
   - `concluido` + `p_close_appointment = true` → se a chave já tem linhas, é replay; senão
     `APPOINTMENT_ALREADY_CONCLUDED`.
   - Qualquer outro estado → `APPOINTMENT_INVALID_STATE`.
6. `p_payments` é array JSON com 0..10 itens. Cada item:
   - `method ∈ {dinheiro, cartao_credito, cartao_debito, pix_sistema, pix_maquininha}`;
   - `amount_cents` inteiro > 0; `tip_cents` inteiro ≥ 0 (default 0);
   - no máximo **um** item `pix_sistema`; itens `pix_sistema` **não** viram linha de recebimento
     (só intenção de cobrança — RF-05);
   - array vazio só é válido com `p_close_appointment = true` (concluir sem pagamento / total 0).
7. Saldo: `paid_cents + reserved_cents + manual_new_cents + pix_intent_cents <= price_cents`,
   onde:
   - `paid_cents` = soma de `amount_cents` das linhas não estornadas do atendimento;
   - `reserved_cents` = soma de `charges.amount_cents` com `status='pendente'` e
     `(expires_at is null or expires_at > now())`;
   - `manual_new_cents` = soma das linhas não-PIX do lote;
   - `pix_intent_cents` = valor do item `pix_sistema` do lote, **exceto** quando já existe cobrança
     pendente (aí `reserved_cents` já a contém e `pix_intent_cents = 0`).
   Excedeu → `AMOUNT_EXCEEDS_REMAINING`. Total zero com qualquer linha → mesmo erro.
8. Idempotência:
   - Se já existem linhas com `(tenant_id, p_idempotency_key)`, comparar quantidade, soma de
     `amount_cents`, soma de `tip_cents` e multiconjunto de `method` com o payload.
     Igual → devolver as linhas existentes com `replayed = true`; diferente →
     `IDEMPOTENCY_CONFLICT` (409). Nunca sobrescrever.
   - Inserção das linhas manuais com `line_index` = ordinal do array (0..n-1), **nunca** enviado
     pelo cliente, e `on conflict (tenant_id, idempotency_key, line_index) where idempotency_key is
     not null do nothing`.
9. Conclusão atômica: se `p_close_appointment = true` e o atendimento está `em_atendimento`,
   inserir as linhas e atualizar `appointments.status = 'concluido'` **na mesma transação**.
   O trigger de comissão existente roda nesse `UPDATE` (não é alterado). Falha em qualquer passo
   reverte linhas **e** status.
10. PIX: o RPC **não** cria linha de recebimento para `pix_sistema` e **não** chama o gateway.
    Devolve `pix_amount_cents` para a Edge criar a cobrança (ADR-003). Se já existe cobrança
    pendente, devolve o valor/ID dela e `pix_already_pending = true`.
11. Auditoria: uma linha `audit_log` por recebimento (`action='payment_registered'`) e uma
    `action='appointment_concluded_without_payment'` quando o lote é vazio e o atendimento é
    concluído. Metadados: `appointment_id`, `method`, `amount_cents`, `tip_cents`, `source`.
    Sem nome, telefone, documento, QR, copia-e-cola ou payload cru.

**Retorno (JSON congelado)**

```json
{
  "appointment_id": "uuid",
  "appointment_status": "concluido",
  "payments": [
    { "id": "uuid", "method": "dinheiro", "amount_cents": 6000, "tip_cents": 0, "source": "manual" }
  ],
  "total_paid_cents": 10000,
  "tip_cents": 500,
  "reserved_cents": 0,
  "remaining_cents": 0,
  "payment_status": "quitado",
  "pix_amount_cents": 0,
  "pix_already_pending": false,
  "replayed": false
}
```

`payment_status`:

| Condição (nesta ordem) | Valor |
|---|---|
| `price_cents = 0` e `paid_cents = 0` | `quitado` (total zero — ambiguidade #11) |
| `paid_cents >= price_cents` | `quitado` |
| existe cobrança pendente | `aguardando_pix` |
| `paid_cents = 0` | `sem_pagamento` |
| `0 < paid_cents < price_cents` | `parcial` |

> `aguardando_pix` tem precedência sobre `parcial`: se o restante está coberto por cobrança
> pendente, o estado mais informativo é “aguardando PIX”, não “parcial”. O valor `remaining_cents`
> continua sendo `max(price - paid - reserved, 0)`.

#### 1.2 `settle_charge_payment`

```text
settle_charge_payment(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_paid_at timestamptz,
  p_source text default 'asaas',      -- 'asaas' | 'manual'
  p_actor_id uuid default null,       -- null no webhook; ator na baixa manual
  p_event_id text default null        -- id do evento Asaas, só para auditoria
) returns jsonb
```

- `SELECT ... FROM charges WHERE tenant_id = p_tenant_id AND id = p_charge_id FOR UPDATE`.
- Não encontrada → `CHARGE_NOT_FOUND`.
- **`status='cancelado'`** → não cria recebimento; grava `audit_log`
  `action='charge_paid_after_cancel'` com `metadata={event_id, amount_cents}` e devolve
  `{ "ok": true, "anomaly": "charge_paid_after_cancel", "payment": null }`. O webhook responde
  200; a anomalia fica para conciliação (RF-17).
- `status='pago'` e já existe `appointment_payments` com `charge_id` → replay:
  devolve a linha existente, `replayed=true`, sem alterar nada.
- `status='pago'` sem linha (legado) → cria a linha (idempotente) e devolve.
- `charges.appointment_id` nulo (cobrança de assinatura) → `CHARGE_NOT_APPOINTMENT`; esta RPC
  só cria recebimento de atendimento.
- `status='pendente'` ou `'expirado'` → insere:
  `appointment_id = charges.appointment_id` (nunca vem do cliente), `method='pix_sistema'`,
  `amount_cents = charges.amount_cents`, `tip_cents=0`, `source=p_source`, `charge_id`,
  `received_at = coalesce(p_paid_at, now())`, `received_by = p_actor_id` (null no webhook),
  `idempotency_key=null`.
  `on conflict (tenant_id, charge_id) where charge_id is not null do nothing`.
- Atualiza `charges.status='pago'` e `paid_at = coalesce(paid_at, p_paid_at, now())` **somente**
  se o status não for `pago`. Nunca rebaixa `pago` (RF-17).
- Auditoria: `charge_paid` (asaas) ou `charge_paid_manual` (manual), com `event_id` quando houver.
- Retorno: `{ ok: true, payment: {...}, charge_status: "pago", replayed: bool, anomaly: null }`.

#### 1.3 `cancel_charge`

```text
cancel_charge(
  p_tenant_id uuid,
  p_charge_id uuid,
  p_actor_id uuid,
  p_force boolean default false,
  p_gateway_cancelled boolean default false
) returns jsonb
```

- A Edge `cancel-charge` chama o gateway **antes** e passa `p_gateway_cancelled=true` no sucesso.
- `p_force=true` só é aceito se o ator for `admin`; `force` de recepção → `FORBIDDEN`.
- Trava a cobrança. Não encontrada → `CHARGE_NOT_FOUND`.
- `status='cancelado'` → replay idempotente (`cancelled=true, replayed=true`).
- `status='pago'` → `CHARGE_NOT_PENDING` (não cancela receita paga; correção é estorno na ADR-001).
- `status='pendente'`:
  - se `p_gateway_cancelled=false` e `p_force=false` → `GATEWAY_CANCEL_FAILED` (nada muda);
  - se `p_gateway_cancelled=true` **ou** (`p_force=true` e admin) → `status='cancelado'`,
    auditoria `charge_cancelled` (ou `charge_cancelled_forced`), metadata com `force` e ator.
    Com `force`, o retorno inclui `gateway_divergence_risk: true`.
- Nunca apaga linha de `charges`; o histórico fica.

#### 1.4 `void_appointment_payment`

```text
void_appointment_payment(
  p_tenant_id uuid,
  p_payment_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
```

- Ator `admin` do tenant; qualquer outro → `FORBIDDEN`.
- `p_reason` obrigatório, `btrim` não vazio, ≤ 500 caracteres; senão `INVALID_BODY`.
  O motivo é armazenado no `audit_log` (necessário para auditoria), mas a UI orienta a não incluir
  nome/telefone/documento e o log técnico nunca ecoa o texto.
- Trava a linha. Não encontrada → `PAYMENT_NOT_FOUND`.
- Já estornada → replay `{ voided: true, replayed: true }`; não altera `voided_at`.
- `UPDATE ... SET voided_at=now(), voided_by=p_actor_id, void_reason=btrim(p_reason)`.
  **Nenhum** `DELETE`; nenhuma alteração de `amount_cents`/`tip_cents`/`method`.
- Se `charge_id` não nulo → `refund_required: true` no retorno (o dinheiro **não** volta pelo
  sistema; estorno financeiro no gateway está fora do v1 — PRD §7 e ambiguidade #12). O novo
  lançamento de correção é uma linha manual **sem** `charge_id` (a cobrança continua `paga` no
  gateway e o unique por `charge_id` preserva a conciliação); não se “reabre” o vínculo com a
  mesma cobrança.
- Auditoria `payment_voided` com `payment_id`, `charge_id`, `amount_cents`, `tip_cents`, `reason`.
- Recalcula e devolve o resumo do atendimento (mesmos campos de `payment_status`).

### 2. Edge Functions

Padrão comum a todas:

- `POST` JSON; `OPTIONS` CORS; `Authorization: Bearer <jwt>`; erro 401 se sessão inválida.
- `resolveIdentity(req, service)`: `auth.getUser(token)` → `profiles` (service role) →
  `{ userId, tenantId, role, active }`. `tenantId` e `role` **nunca** vêm do corpo.
- `zod` para o corpo; campos desconhecidos são rejeitados (`strict`).
- `tenant_id` do cliente é ignorado se enviado (não faz parte do schema).
- Erros estáveis: `{ "code": "CODE", "message": "texto pt-BR" }` + HTTP status. O frontend decide
  retry/UX pelo `code`, não pela mensagem.
- Logs técnicos: `{ event, tenant_id, actor_id, appointment_id, charge_id, payment_id, method,
  amount_cents, tip_cents, code }`. Nunca nome, telefone, documento, QR, copia-e-cola, payload cru
  ou token (RNF-08).
- Toda escrita chama a RPC correspondente com `p_tenant_id` e `p_actor_id` resolvidos; a Edge não
  faz `insert` direto em `appointment_payments`.

#### 2.1 `register-appointment-payments`

**Body**

```json
{
  "appointment_id": "uuid",
  "idempotency_key": "uuid",
  "close_appointment": true,
  "payments": [
    { "method": "dinheiro", "amount_cents": 6000, "tip_cents": 0 },
    { "method": "cartao_debito", "amount_cents": 4000, "tip_cents": 500 },
    { "method": "pix_sistema", "amount_cents": 3000 }
  ]
}
```

- `payments` pode ser `[]` quando `close_appointment=true` (concluir sem pagamento).
- `pix_sistema` é **intenção**, não recebimento. No máximo 1.
- A Edge valida o body, chama o RPC, e se `pix_amount_cents > 0` chama a criação de cobrança da
  ADR-003 com `amount_cents = pix_amount_cents` e a mesma `idempotency_key` do lote.
- Se a cobrança já existe pendente, devolve o QR existente (`pix_already_pending=true`), sem criar
  segunda.
- Se o gateway falhar, devolve **422** `GATEWAY_ERROR` com o settlement já persistido:
  `{ code, message, retryable: true, settlement: {...}, pix_amount_cents }`. A UI mantém o
  diálogo e oferece “Tentar de novo”/“Fechar sem o PIX” (ADR-004). Nenhuma linha de recebimento
  é criada para a parcela PIX.
- Resposta 200: `{ settlement: {...}, charge: { id, pix_qr_code, pix_copy_paste, expires_at } | null }`.
  Quando a cobrança é criada/reapresentada, a Edge devolve o `settlement` com
  `payment_status='aguardando_pix'` e `reserved_cents` atualizado (ou o cliente refetcha o
  settlement antes de exibir o comprovante); o RPC isolado ainda não conhece a cobrança criada
  depois dele.

#### 2.2 `get-appointment-settlement`

**Body**: `{ "appointment_id": "uuid" }`.

- Autorização:
  - `admin`: qualquer atendimento do tenant.
  - `receptionist`: qualquer atendimento do tenant (leitura **de um** atendimento; sem lista,
    período, total agregado ou histórico — RF-20).
  - `professional`: somente atendimento em que é o responsável (RF-21); caso contrário 403.
- Retorno:

```json
{
  "appointment": {
    "id": "uuid", "status": "em_atendimento",
    "starts_at": "2026-11-06T18:00:00Z",
    "customer_name": "...", "service_name": "...", "professional_name": "...",
    "total_cents": 10000
  },
  "payments": [
    { "id": "uuid", "method": "dinheiro", "amount_cents": 6000, "tip_cents": 0,
      "source": "manual", "received_at": "...", "voided_at": null, "void_reason": null }
  ],
  "pending_charges": [
    { "id": "uuid", "amount_cents": 3000, "expires_at": "...",
      "pix_qr_code": "...|null", "pix_copy_paste": "...|null" }
  ],
  "total_paid_cents": 6000,
  "tip_cents": 0,
  "reserved_cents": 3000,
  "remaining_cents": 1000,
  "payment_status": "aguardando_pix",
  "permissions": {
    "can_register": true, "can_cancel_charge": true, "can_confirm_manual": false,
    "can_void": false, "can_view_qr": true
  }
}
```

- **Saldo (#2)**: `remaining_cents` existe **somente** neste endpoint, para **um** atendimento.
  Não há endpoint de lista/período que devolva saldo para recepção/profissional. A UI só exibe o
  saldo dentro do diálogo de fechamento/registro; nunca em histórico, lista ou relatório.
- **QR (#3)**: `pix_qr_code`/`pix_copy_paste` só são preenchidos quando:
  - ator `admin` (sempre), **ou**
  - ator `receptionist` **e** existe cobrança `pendente` com `expires_at > now()` (pode reexibir
    após a conclusão — decisão de 2026-11-06), **ou**
  - ator `professional` (dono) **e** cobrança `pendente` não expirada.
  Cobrança `expirado`/`cancelado` nunca devolve QR; `can_view_qr=false` nesses casos (RF-26).
  A recepção continua sem lista/período/totais: o QR só aparece no settlement de **um** atendimento.
- `payments` inclui linhas estornadas com `voided_at`; `void_reason` só é devolvido ao admin
  (recepção/profissional recebem apenas `voided=true`). As somas ignoram estornadas.
- `permissions` é derivado no servidor (não confiar no cliente).

#### 2.3 `cancel-charge`

**Body**: `{ "charge_id": "uuid", "force": false }`.

- Papéis: `admin` e `receptionist`; `professional` → 403 (RF-19).
- Ordem: validar identidade/tenant → buscar charge → se pendente, cancelar no Asaas
  (endpoint de cancelamento de cobrança da API; validar no sandbox na TASKS) → se gateway OK,
  chamar `cancel_charge(..., p_gateway_cancelled=true)`.
- Se `charges.asaas_payment_id is null` (reserva de tentativa que falhou, sem cobrança no
  gateway), **não** chamar o Asaas; cancelar localmente com `p_gateway_cancelled=true`.
- Falha do gateway e `force=false` → 422 `GATEWAY_CANCEL_FAILED`, **nada** muda localmente.
- `force=true` só admin: cancela local mesmo com falha do gateway, retorna
  `gateway_divergence_risk=true` e audita `charge_cancelled_forced`.
- `charge` já cancelada → 200 `{ cancelled: true, replayed: true }`.
- `charge` paga → 409 `CHARGE_NOT_PENDING`.

#### 2.4 `confirm-charge-manual`

**Body**: `{ "charge_id": "uuid", "paid_at": "ISO-8601 (opcional)" }`.

- Papel: **admin** (RF-18). Recepção/profissional → 403.
- Chama `settle_charge_payment` com `p_source='manual'`, `p_actor_id` do admin e
  `p_paid_at = paid_at ?? now()`.
- Cobrança cancelada → 409 `CHARGE_CANCELLED` (não cria receita; anomalia não é gerada por baixa
  manual — o admin está ciente).
- Cobrança já paga → 200 com `replayed=true` (webhook posterior será no-op).
- Resposta: `{ settlement, payment, replayed }`.

#### 2.5 `void-appointment-payment`

**Body**: `{ "payment_id": "uuid", "reason": "texto" }`.

- Papel: **admin** (RF-13). Demais → 403.
- Chama `void_appointment_payment`; devolve `{ settlement, refund_required }`.
- `refund_required=true` quando a linha veio de cobrança paga no gateway: a UI mostra o aviso
  “o dinheiro não volta pelo sistema; conciliação manual no Asaas” (ambiguidade #12).
- Não chama o gateway.

### 3. Resolução de identidade e autorização

```text
JWT (Authorization) → auth.getUser → profiles (service role)
  → { userId, tenantId, role, active }
  → valida role permitido no endpoint
  → valida vínculo do atendimento (professional) ou tenant (admin/recepção)
  → chama RPC com p_tenant_id/p_actor_id
```

- `active=false` (PRD de gestão de usuários) → 403 `FORBIDDEN`.
- Nenhum endpoint aceita `tenant_id`, `role`, `actor_id` ou `professional_id` do corpo.
- Profissional: vínculo por `professionals.profile_id = auth.uid()`; não por nome/e-mail.
- Recepção: não recebe `payments` históricos agregados; o endpoint de settlement é o único caminho
  de leitura financeira e exige `appointment_id`.
- Super admin: **fora do escopo**; não há caminho cross-tenant novo.

### 4. Ato atômico concluir + registrar (ambiguidade #1)

O “ato atômico” é **local**, dentro de uma transação do Postgres:

```mermaid
sequenceDiagram
  participant UI as "PaymentCaptureDialog"
  participant Edge as "register-appointment-payments"
  participant RPC as "register_appointment_payments"
  participant DB as "Postgres"
  participant GW as "Asaas (opcional)"
  UI->>Edge: POST { appointment_id, idempotency_key, close:true, payments[] }
  Edge->>Edge: resolveIdentity + zod + autorização
  Edge->>RPC: p_tenant_id, p_actor_id, p_payments...
  RPC->>DB: BEGIN; SELECT appointment FOR UPDATE
  RPC->>DB: valida saldo e idempotência
  RPC->>DB: INSERT appointment_payments (linhas não-PIX)
  RPC->>DB: UPDATE appointments SET status='concluido' (se close)
  RPC->>DB: INSERT audit_log; COMMIT
  Edge-->>UI: settlement (sem PIX) / pix_amount_cents
  alt pix_amount_cents > 0
    Edge->>GW: cria cobrança da parcela PIX
    alt gateway OK
      Edge->>DB: INSERT charges pendente + QR
      Edge-->>UI: settlement + charge (QR)
    else gateway falha
      Edge-->>UI: 422 GATEWAY_ERROR (settlement já persistido)
    end
  end
```

- Se o `INSERT` de qualquer linha falhar, o `UPDATE` de status e a comissão são revertidos junto
  (`ROLLBACK`). Não existe “concluiu sem registrar” por falha local.
- O gateway é **externo** e não participa da transação. Por isso, a falha do gateway **não**
  reverte as linhas locais já gravadas: ela apenas impede a criação da cobrança PIX. O estado
  resultante é honesto: as formas que foram recebidas ficam registradas; a parcela PIX não vira
  receita e o atendimento fica `parcial`/`sem_pagamento`/`aguardando_pix` conforme o caso.
- Consequência de UX: “Concluir sem pagamento” depois de uma falha de gateway, quando já há
  linhas manuais, significa “fechar sem a parcela PIX” — a UI usa esse rótulo apenas quando não
  há nenhuma linha persistida; com linhas, usa “Fechar sem o PIX” (ADR-004). Não há estorno
  automático das linhas já recebidas.

### 5. Idempotência do lote (ambiguidade #4)

- A chave é um `uuid` gerado no cliente ao abrir o diálogo (`crypto.randomUUID()`).
- Enquanto o payload for **idêntico**, “Tentar de novo” reutiliza a mesma chave. Isso vale para
  falha de rede, timeout e `GATEWAY_ERROR` (quando as linhas locais já foram gravadas).
- A chave é **regenerada** quando:
  - o fechamento conclui com sucesso;
  - o operador edita qualquer linha **antes** de um commit local;
  - o admin estorna uma linha e o operador faz um novo lançamento deliberado.
- Mesma chave + payload diferente → `409 IDEMPOTENCY_CONFLICT`, nunca “aplicar por cima”.
- Replay devolve `200` com `replayed=true` e as linhas existentes (não 409 — RF-14).

### 6. Tabela de erros estáveis

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `INVALID_BODY` | JSON/schema inválido, campo desconhecido, motivo vazio |
| 400 | `INVALID_METHOD` | método fora do enum |
| 400 | `INVALID_AMOUNT` | valor não inteiro, ≤ 0, gorjeta < 0, > 10 linhas |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | chave ausente em endpoint de escrita |
| 401 | `UNAUTHENTICATED` | token ausente/inválido/expirado |
| 403 | `FORBIDDEN` | papel sem permissão ou `active=false` |
| 403 | `PROFESSIONAL_NOT_OWNER` | profissional em atendimento alheio |
| 404 | `APPOINTMENT_NOT_FOUND` | atendimento inexistente no tenant |
| 404 | `CHARGE_NOT_FOUND` | cobrança inexistente no tenant |
| 404 | `PAYMENT_NOT_FOUND` | recebimento inexistente no tenant |
| 409 | `APPOINTMENT_INVALID_STATE` | estado não permite a operação |
| 409 | `APPOINTMENT_ALREADY_CONCLUDED` | tentou concluir de novo sem replay |
| 409 | `AMOUNT_EXCEEDS_REMAINING` | `pago + reservado + novo > total` |
| 409 | `IDEMPOTENCY_CONFLICT` | mesma chave, payload diferente |
| 409 | `PENDING_CHARGE_EXISTS` | PIX pedido com valor diferente do pendente |
| 409 | `CHARGE_NOT_PENDING` | cancelar/baixar cobrança paga ou já final |
| 409 | `CHARGE_CANCELLED` | baixa manual em cobrança cancelada |
| 409 | `CHARGE_NOT_APPOINTMENT` | cobrança de assinatura sem atendimento |
| 422 | `ASAAS_NOT_CONFIGURED` | tenant sem config ativa |
| 422 | `GATEWAY_ERROR` | falha ao criar cobrança PIX |
| 422 | `GATEWAY_CANCEL_FAILED` | falha ao cancelar no gateway |
| 500 | `INTERNAL` | erro inesperado (log com `code`, sem PII) |

Mapeamento Postgres: a RPC levanta SQLSTATE customizado `PT400`/`PT403`/`PT404`/`PT409`/
`PT422`/`PT500` e `message = code`; a Edge converte para o HTTP correspondente. Erros de
constraint (`23505`, `23503`, `23514`) são traduzidos para o código de domínio mais próximo e
nunca vazam detalhe de SQL para o cliente.

## Interface congelada

### Assinaturas (não mudam sem nova ADR)

```text
register_appointment_payments(p_tenant_id uuid, p_actor_id uuid, p_appointment_id uuid,
  p_payments jsonb, p_idempotency_key uuid, p_close_appointment boolean default true) → jsonb
settle_charge_payment(p_tenant_id uuid, p_charge_id uuid, p_paid_at timestamptz,
  p_source text default 'asaas', p_actor_id uuid default null, p_event_id text default null) → jsonb
cancel_charge(p_tenant_id uuid, p_charge_id uuid, p_actor_id uuid,
  p_force boolean default false, p_gateway_cancelled boolean default false) → jsonb
void_appointment_payment(p_tenant_id uuid, p_payment_id uuid, p_actor_id uuid,
  p_reason text) → jsonb
```

### Endpoints (método, body, papéis)

| Endpoint | Método | Papéis | Body |
|---|---|---|---|
| `register-appointment-payments` | POST | admin, receptionist, professional (próprio) | `appointment_id`, `idempotency_key`, `close_appointment`, `payments[]` |
| `get-appointment-settlement` | POST | admin, receptionist, professional (próprio) | `appointment_id` |
| `cancel-charge` | POST | admin, receptionist | `charge_id`, `force?` |
| `confirm-charge-manual` | POST | admin | `charge_id`, `paid_at?` |
| `void-appointment-payment` | POST | admin | `payment_id`, `reason` |

### Matriz de autorização (fonte da verdade)

| Operação | Admin | Recepção | Profissional |
|---|---|---|---|
| Registrar pagamento | ✅ qualquer atendimento | ✅ qualquer atendimento | ✅ só o próprio |
| Ler settlement de 1 atendimento | ✅ | ✅ | ✅ só o próprio |
| Ver saldo no diálogo | ✅ | ✅ (só o atendimento aberto) | ✅ (só o próprio) |
| Ver QR/copia-e-cola | ✅ sempre | ✅ só com `status='em_atendimento'` | ✅ só o próprio e `em_atendimento` |
| Listar/histórico/período | ✅ (ADR-005) | ❌ | ❌ |
| Relatórios/KPIs | ✅ (ADR-005) | ❌ | ❌ |
| Baixa manual de PIX | ✅ | ❌ | ❌ |
| Cancelar cobrança pendente | ✅ | ✅ (auditado) | ❌ |
| Estornar recebimento | ✅ | ❌ | ❌ |
| Concluir sem pagamento | ✅ | ✅ | ✅ próprio |


## Adendo 2026-11-06 — leitura escopada de status de pagamento por atendimento

Motivo: o selo “Pagamento pendente” na agenda (ADR-004, decisão 1) precisa do status financeiro
de **vários** atendimentos. `charges`/`appointment_payments` são admin-only por RLS e
`APPOINTMENT_SELECT` não carrega status financeiro.

Decisão:
- Nova Edge `get-agenda-payment-statuses` (`POST`), papéis `admin`, `receptionist` e
  `professional` (só atendimentos próprios; recepção sem restrição de vínculo).
- Corpo `{ appointment_ids: string[] }` (1..200 uuid), `.strict()`; `tenant_id`/`role` recusados.
- Resposta `{ statuses: [{ appointment_id, payment_status }] }`, com
  `payment_status ∈ {sem_pagamento, parcial, quitado, aguardando_pix}`.
- **Nunca** devolve valores, gorjeta, saldo, linhas, QR ou histórico — só o rótulo de estado do
  atendimento que o ator já pode ver.
- Implementação: função SQL `agenda_payment_statuses(p_tenant_id, p_appointment_ids, p_professional_id)`
  `service_role` only, reutilizando as mesmas regras de `appointment_payment_summary`; Edge só
  resolve identidade, valida papel/vínculo e formata.
- Testes: RBAC (profissional só próprio), isolamento de tenant, lote >200 recusado, ausência de
  valores no payload, atendimento inexistente fora da resposta.

## Alternativas consideradas

- **Cliente escrevendo direto com RLS de insert por papel**: descartada. RLS não consegue validar
  “profissional só o próprio” + soma de saldo + idempotência + auditoria sem duplicar a regra em
  SQL de policy; e daria ao cliente um caminho de escrita financeira.
- **Edge fazendo `insert` direto, sem RPC**: descartada. A Edge não tem transação automática;
  pagamentos + status + comissão + auditoria precisam do mesmo commit.
- **RPC `security definer`**: desnecessária. Chamada só por service role; `security invoker`
  mantém o privilégio explícito e reduz a superfície.
- **Um endpoint por forma de pagamento**: descartada. Split exige lote; um endpoint por linha
  quebraria a atomicidade e a idempotência.
- **Deixar o frontend calcular o saldo e enviar `remaining_cents`**: descartada. O servidor é a
  fonte da verdade; o cliente só pré-preenche.
- **Reler QR por endpoint separado**: descartada no v1. O settlement já devolve QR quando o ator
  pode vê-lo; um endpoint extra ampliaria a superfície sem necessidade.

## Consequências

- O frontend passa a depender de códigos de erro estáveis; mensagens podem mudar sem quebrar a
  lógica de retry.
- A Edge `register-appointment-payments` é o **único** caminho de fechamento com pagamento; a
  mudança de status isolada deixa de ser usada para `concluido` quando a feature `payments` está
  ligada (ADR-004).
- O settlement é a única leitura financeira de recepção/profissional; qualquer tela que precise
  de histórico continua admin-only.
- O ator é sempre resolvido no servidor; um `tenant_id` no corpo é ignorado, não “validado”.
- A falha de gateway deixa o atendimento concluído com o que foi recebido. Isso é deliberado e
  precisa estar claro na UI e nos testes (não é uma transação distribuída).

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Duas recepções fechando ao mesmo tempo | saldo estourado / lote duplicado | `SELECT ... FOR UPDATE` no atendimento + unique de idempotência |
| Replay com payload diferente | receita divergente | comparação de quantidade/soma/métodos → `IDEMPOTENCY_CONFLICT` |
| Gateway falha após commit local | atendimento concluído sem PIX | retorno 422 com settlement; UI oferece retry/“fechar sem o PIX”; nenhuma linha PIX criada |
| Webhook e baixa manual simultâneos | receita dupla | `settle_charge_payment` trava a charge e usa unique por `charge_id` |
| Profissional lê atendimento alheio | violação de RBAC | Edge valida `professionals.profile_id`; RLS da tabela não dá leitura |
| Recepção usa settlement para montar relatório | vazamento financeiro | endpoint exige `appointment_id`; não há lista/período; logs de acesso |
| QR exposto após o ato | vazamento de cobrança | QR só para admin após `concluido`; não-admin recebe `null` |
| `force` de cancelamento diverge do gateway | cobrança ativa no Asaas | só admin, auditado, retorno `gateway_divergence_risk`; conciliação manual |
| Erro de SQL vaza detalhe | informação interna | Edge traduz para código de domínio; loga detalhe só no servidor |

## Critérios de aceite

1. As 4 RPCs existem com as assinaturas acima, `revoke` de `public/anon/authenticated` e
   `grant execute` só para `service_role`.
2. `register_appointment_payments` em `em_atendimento` com `close=true` grava linhas e muda status
   para `concluido` no mesmo commit; falha forçada em uma linha reverte status e comissão.
3. Replay do mesmo lote devolve `200 replayed=true` e não duplica; mesma chave com soma diferente
   devolve `409 IDEMPOTENCY_CONFLICT`.
4. Duas chamadas concorrentes no mesmo atendimento: no máximo uma passa; a outra recebe
   `AMOUNT_EXCEEDS_REMAINING` ou replay, nunca saldo estourado.
5. `payments=[]` + `close=true` conclui sem pagamento, grava auditoria e não cria cobrança.
6. Total zero: `payments=[]` conclui; qualquer linha positiva é rejeitada; settlement devolve
   `payment_status='quitado'` e `total_paid_cents=0`.
7. Profissional só registra/lê o próprio atendimento; tentativa em atendimento alheio → 403;
   leitura direta da tabela sob `authenticated` → 0 linhas.
8. Recepção lê settlement de um atendimento, mas `useCharges`/lista/relatório continua negado;
   QR só aparece com `status='em_atendimento'`.
9. `settle_charge_payment` em cobrança cancelada não cria recebimento e grava
   `charge_paid_after_cancel`; em cobrança paga é no-op idempotente.
10. `cancel_charge` com falha de gateway e `force=false` não altera o local; com `force=true`
    (admin) altera e audita o risco.
11. `void_appointment_payment` mantém a linha, preenche `voided_*`, remove das somas e devolve
    `refund_required` quando havia `charge_id`.
12. Nenhum log/audit contém nome, telefone, documento, QR, copia-e-cola, payload cru ou token.
13. Os endpoints não aceitam `tenant_id`/`role` do corpo; teste com tenant B tenta operar no A e
    recebe 404/403.

## Escopo desta decisão

**Dentro**: RPCs, Edge Functions, contratos JSON, erros, autorização, logs, atomicidade local,
idempotência do lote, leitura escopada do settlement, janela do QR e estorno lógico via API.

**Fora**: DDL/RLS/backfill (ADR-001), `create-charge`/webhook (ADR-003), componentes/hooks
(ADR-004), painel/aba Recebimentos/RBAC final (ADR-005), SPEC/PLAN/TASKS, código de aplicação,
branch/PR.

## Perguntas abertas

1. **Instante do recebimento no webhook**: usar `payment.paymentDate` (ou `confirmedDate` como
   fallback) em vez de `now()` da Edge. Recomendação: `coalesce(paymentDate, confirmedDate,
   now())`; validar o campo no sandbox do Asaas na TASKS. Não muda o contrato (continua
   `timestamptz`).
2. **Cancelamento no Asaas**: o endpoint exato (`DELETE /payments/{id}`) e o comportamento para
   cobrança já removida devem ser confirmados no sandbox. Recomendação: 404 do gateway para
   cobrança pendente local é tratado como “já cancelada”; qualquer outro erro mantém o local.
3. **Recepção registrando depois**: RF-12 diz “admin ou operador autorizado”. Esta ADR autoriza
   recepção a registrar em atendimento concluído via settlement, sem histórico. Se o produto
   quiser restringir a admin após a conclusão, é mudança de matriz (nova ADR), não de código.
4. **Baixa manual × PIX ainda pagável**: RF-18 exige que o webhook posterior seja no-op, mas não
   exige cancelar a cobrança no Asaas. Sem cancelar, o cliente ainda pode pagar o PIX depois da
   baixa manual e o dinheiro entra no Asaas sem novo recebimento local. Recomendação: na baixa
   manual, tentar cancelar a cobrança no gateway; se o cancelamento falhar (ex.: já pago),
   devolver `gateway_cancel_warning=true` e manter a conciliação manual. Como o PRD não exige o
   cancelamento, esta ADR **não** o torna obrigatório; a decisão fica registrada para o próximo
   ciclo.

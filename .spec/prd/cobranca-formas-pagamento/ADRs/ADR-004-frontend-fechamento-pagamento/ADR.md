# ADR-004 — Frontend do fechamento: captura, settlement, comprovante, estados, i18n, a11y e hooks

- **Status**: in-progress
- **Data**: 2026-11-06
- **PRD**: cobranca-formas-pagamento (RF-01..RF-12, RF-16, RF-18, RF-19, RF-22, RF-23, RF-26,
  RF-27; RNF-01..RNF-04, RNF-08, RNF-12)
- **Decisões cobertas**: D2, D3, D4, D5, D6, D7; ambiguidades §14 #2 (saldo no diálogo),
  #3 (janela do QR), #4 (retry/chave), #5 (troco), #8 (badge no detalhe), #10 (copy pt-BR)
- **depende-de**: ADR-002, ADR-003
- **ADRs dependentes**: —

## Decisões do gate humano (2026-11-06)

Ratificam o parecer do `ux-designer` e substituem os pontos abaixo do corpo original:

1. **Selo e ação no item da agenda no v1** (contraria a ambiguidade #8): `AgendaItem` e
   `AppointmentBlock` exibem “Pagamento pendente” (texto + ícone + `aria-label`) e ação
   “Pagamento” que abre o settlement; toggle “Pagamento pendente (N)” na barra de filtros.
2. **Chips são botões de ação** (`Adicionar <método>`), sem `aria-pressed`; “Registrar depois”
   fica **fora** da fileira de chips (escape no rodapé).
3. **Recepção pode reexibir o QR** de cobrança `pendente` não expirada depois da conclusão
   (ajusta RF-26/ADR-002). Sem lista, período ou totais.
4. **i18n = catálogo local tipado** `src/app/agenda/pagamentos/payments-messages.ts`
   (padrão `cadastro-messages.ts`), com chaves espelhando `payments.*`; sem dependência nova.
5. **`resolveFeatures` distingue “desligado” de “não resolvido”**: `payments: boolean | null`;
   “Concluir” fica bloqueado com “Carregando…” até resolver (evita cair no fluxo legado).
6. **Confirmações são etapas internas do mesmo `Dialog`** (parcial, registrar depois, descarte,
   saída com PIX, estorno) — nunca `Dialog` sobre `Dialog`.
7. **Tokens do repo** (jade/Space Grotesk/`--status-*`) são a fonte; “Pulse” não existe neste repo.
8. **Sem rota nova de detalhe**: entrada do settlement é o item da agenda.

## Contexto

O ponto de entrada atual é `StatusChangeConfirm`: ao concluir, ele chama `changeStatus` e depois
`createCharge` automaticamente (`src/app/agenda/StatusChangeConfirm.tsx:86-101`). Não existe
captura de forma, split, parcial, gorjeta ou comprovante; `CobrancasPage` só lista PIX.

Esta ADR congela a experiência do fechamento e o contrato dos componentes/hooks que consomem a
API da ADR-002/ADR-003. A regra de ouro: **o diálogo é operacional, não é relatório**. Ele mostra
o necessário para cobrar e registrar; histórico, período e totais agregados continuam admin
(ADR-005).

## Decisão

### 1. Fluxo de telas

```text
Agenda → “Concluir” (em_atendimento)
  └─ feature `payments` ligada?
       ├─ não (clínica/legado) → StatusChangeConfirm legado (sem mudança nesta entrega)
       └─ sim → PaymentCaptureDialog (modo "close")
                 ├─ formas manuais → registra + conclui no mesmo ato
                 ├─ PIX do sistema → registra as demais + cria cobrança da parcela
                 │                   → QR no próprio diálogo → aguardando
                 ├─ “Registrar depois” → registra lote vazio + conclui sem_pagamento
                 └─ gateway falha → diálogo permanece: “Tentar de novo” / “Fechar sem o PIX”

Detalhe do atendimento (concluído)
  ├─ badge “Pagamento pendente” (sem_pagamento/parcial)
  ├─ “Registrar pagamento” → PaymentCaptureDialog (modo "register")
  └─ AppointmentSettlementDialog (total, pago, pendente, linhas, cobranças; ações por papel)
```

- **Clínica/legado**: a feature `payments` é `false`; o fluxo antigo de conclusão é preservado
  para não regredir quem não tem a etapa de pagamento (RNF-12). O objetivo do PRD é o segmento
  salão/barbearia. A remoção global do PIX automático só acontece quando a clínica tiver fluxo
  próprio — fora deste PRD.
- **Salão/barbearia**: `StatusChangeConfirm` deixa de chamar `useCreateCharge` ao concluir. Para
  `to='concluido'`, abre `PaymentCaptureDialog` e **não** executa a mudança de status isolada;
  a conclusão é parte do lote da ADR-002.
- **Outras transições** (confirmar, cancelar, não compareceu): `StatusChangeConfirm` continua
  como hoje, com o aviso de comissão existente.
- **Badge**: “Pagamento pendente” no **detalhe** do atendimento no v1; indicador na lista da
  agenda fica para v2 (ambiguidade #8). Sem alteração de `APPOINTMENT_SELECT` no v1.

### 2. `PaymentCaptureDialog`

Componente único para fechar e registrar depois. Props congeladas:

```ts
type PaymentMethod =
  | "dinheiro" | "cartao_credito" | "cartao_debito"
  | "pix_sistema" | "pix_maquininha";

interface PaymentCaptureDialogProps {
  open: boolean;
  mode: "close" | "register";
  appointment: {
    id: string;
    customerName: string;
    serviceName: string;
    professionalName: string;
    totalCents: number;
    status: AppointmentStatus;
  };
  onOpenChange: (open: boolean) => void;
  onCompleted?: (settlement: AppointmentSettlement) => void;
}
```

**Estado interno**

```ts
interface PaymentLineDraft {
  key: string;                 // id local, não vai ao servidor
  method: PaymentMethod;
  amountCents: number;         // parte serviço
  tipCents: number;            // gorjeta explícita
  cashReceivedCents?: number;  // só dinheiro; NÃO persiste
}

type CapturePhase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "awaiting_pix"; charge: PixCharge }
  | { kind: "gateway_error"; settlement: AppointmentSettlement; pixAmountCents: number }
  | { kind: "success"; settlement: AppointmentSettlement; receipt: ReceiptData }
  | { kind: "error"; code: string };
```

**Regras de interação**

1. **Abertura**: carrega o settlement do atendimento (`get-appointment-settlement`) para saber
   total/pago/pendente. O total vem do snapshot `price_cents`; o cliente não o edita.
2. **Linhas**: selecionar um chip cria uma linha com o saldo restante; “Adicionar forma” cria
   outra. Valor editável (split/parcial). Remover linha permitido enquanto `editing`.
3. **Saldo**: `remaining = max(total - paid - reserved, 0)`. O diálogo mostra “Falta para quitar”
   a cada edição. O cálculo do cliente é **UX**; o servidor revalida.
4. **Dinheiro**: campo “Valor recebido” (opcional) calcula `troco = max(recebido - valor da linha,
   0)` em tempo real. Se `recebido < valor`, erro inline e o botão de confirmar fica bloqueado.
   O troco **não** é persistido (ambiguidade #5): o comprovante mostra o valor calculado na sessão;
   ao reabrir, o troco não é reconstruível (declarado).
5. **Gorjeta**: campo separado por linha, rótulo explícito “não entra na receita do serviço nem na
   comissão”. Não conta para quitar o total. Pode ser lançada junto de qualquer forma.
6. **Cartões/PIX da maquininha**: sem campos de cartão, bandeira, NSU ou adquirente. Checkbox
   “Confirmei na maquininha” obrigatório para habilitar o registro; a responsabilidade é do
   operador (PCI: o dado nunca entra no sistema).
7. **PIX do sistema**: no máximo uma linha. Ao confirmar, o endpoint cria a cobrança pela parcela
   e devolve o QR; o diálogo passa a `awaiting_pix` e mostra QR/copia-e-cola no mesmo diálogo,
   reusando a apresentação do `PixQrDialog` existente (sem duplicar o markup do QR).
   O recebimento **não** é dado como pago até o gateway confirmar; o polling atualiza o settlement
   a cada 5 s enquanto o diálogo estiver aberto (para ao fechar/sucesso).
8. **Registrar depois**: em `mode='close'`, botão secundário envia `payments: []` +
   `close_appointment: true`; o atendimento conclui com `sem_pagamento` e badge no detalhe.
9. **Confirmação**:
   - `mode='close'`: `close_appointment: true`. As linhas + status concluem no mesmo commit.
   - `mode='register'`: `close_appointment: false`; exige ≥1 linha; atendimento já concluído.
10. **Parcial**: se a soma de serviço < total e não há PIX pendente, abrir confirmação explícita
    (“O atendimento ficará com saldo em aberto. Confirmar?”) antes de enviar. Sem confirmação,
    nada é persistido.
11. **Excedente**: soma de serviço > total é bloqueada no cliente com mensagem que o adicional só
    pode ser gorjeta; o servidor também rejeita (`AMOUNT_EXCEEDS_REMAINING`).
12. **Erro de gateway**: mantém o diálogo, mostra `role="alert"`, oferece “Tentar de novo” e:
    - se nenhuma linha foi persistida: “Concluir sem pagamento”;
    - se já há linhas persistidas: “Fechar sem o PIX” (não estorna o que foi recebido).
    “Tentar de novo” primeiro refetcha o settlement: se o atendimento já está `concluido`, chama
    **somente** `useCreateCharge` com a mesma chave (as linhas/status já foram commitados); se
    ainda está `em_atendimento`, reenvia o lote com a mesma chave. Isso evita
    `APPOINTMENT_ALREADY_CONCLUDED` em um lote PIX-only cujo RPC já commitou.
13. **Chave de idempotência**: gerada ao abrir (`crypto.randomUUID()`), mantida em retry de
    payload idêntico, regenerada após sucesso, após edição antes do commit e após estorno
    deliberado (ambiguidade #4). Mesma chave + payload diferente → `IDEMPOTENCY_CONFLICT`: a UI
    regenera a chave e pede revisão, nunca reenvia por cima.
14. **Fechamento durante submit**: bloquear o “X”/ESC enquanto `submitting`; permitir fechar em
    `editing`/`gateway_error`/`success` com confirmação se houver linhas não persistidas.
15. **Sucesso**: mostra o comprovante no próprio diálogo; “Concluir” fecha e invalida as queries.

### 3. `AppointmentSettlementDialog`

```ts
interface AppointmentSettlementDialogProps {
  open: boolean;
  appointmentId: string;
  onOpenChange: (open: boolean) => void;
  onRegisterPayment?: () => void; // abre PaymentCaptureDialog em mode="register"
}
```

- Cabeçalho: cliente, serviço, profissional, data/hora, status.
- Blocos: **Total**, **Pago** (ledger não estornado), **Gorjeta**, **A receber/pendente**
  (cobranças pendentes), **Saldo** (quando aplicável).
- Linhas de recebimento: forma, valor, gorjeta, origem (`manual`/`asaas`), operador, data/hora,
  status (ativa/estornada com motivo).
- Cobranças pendentes: valor, expiração, “Reexibir QR” (se `permissions.can_view_qr`), “Cancelar
  PIX” (se `can_cancel_charge`). Se `pix_qr_code` for `null` (reserva de tentativa que falhou),
  mostrar “PIX não gerado” com “Tentar de novo”/“Cancelar PIX”, nunca um QR vazio.
- Ações por papel, sempre pelos flags do servidor:
  - admin: registrar, baixa manual de PIX, cancelar PIX, estornar, reexibir QR.
  - recepção: registrar, cancelar PIX; **sem** baixa manual, estorno, QR após a conclusão,
    histórico ou totais agregados.
  - profissional (próprio): registrar; sem cancelar/estornar/baixa manual; QR só no ato.
- Estorno: modal com motivo obrigatório (≤ 500), aviso de que o dinheiro **não** volta pelo
  sistema quando `refund_required=true`; confirmação explícita.
- Estados obrigatórios: `loading` (skeleton), `empty` (sem recebimentos), `error` (com retry).
- O diálogo não agrega outros atendimentos; não tem filtro de período.

### 4. Comprovante

`PaymentReceipt` (apresentacional, sem fetch) exibe:

- total do serviço, linhas por forma (serviço), gorjeta em linha própria, troco (somente se
  dinheiro e calculado na sessão), status (`quitado`/`parcial`/`sem_pagamento`/`aguardando_pix`),
  data/hora do lançamento, atendimento/cliente/serviço/profissional.
- Não exibe dados de cartão, QR, copia-e-cola, token ou ID interno de gateway.
- Formatação de moeda só na exibição (`Intl.NumberFormat("pt-BR", { style: "currency",
  currency: "BRL" })`); o estado interno é inteiro em centavos.

### 5. Hooks e cache

```ts
useRegisterAppointmentPayments(): UseMutationResult<RegisterPaymentsResponse, PaymentApiError, RegisterPaymentsInput>
useAppointmentSettlement(appointmentId: string, options?: { enabled?: boolean }): UseQueryResult<AppointmentSettlement>
useCancelCharge(): UseMutationResult<CancelChargeResponse, PaymentApiError, { chargeId: string; force?: boolean }>
useVoidAppointmentPayment(): UseMutationResult<VoidPaymentResponse, PaymentApiError, { paymentId: string; reason: string }>
useCreateCharge(): UseMutationResult<CreateChargeResponse, PaymentApiError, CreateChargeInput> // alterado
```

- `RegisterPaymentsInput` = `{ appointmentId, idempotencyKey, closeAppointment, payments: Array<{
  method, amountCents, tipCents }> }`. O hook converte camelCase → snake_case do contrato; o
  componente nunca monta JSON manualmente.
- `AppointmentSettlement` = o retorno de `get-appointment-settlement` (ADR-002), com
  `permissions` e `pendingCharges`.
- Query keys: `["appointment-settlement", appointmentId]`,
  `["appointments"]`, `["charges"]`, `["financial-summary"]` (ADR-005).
- Invalidação após sucesso/estorno/cancelamento/baixa: settlement do atendimento, lista de
  agendamentos, cobranças e resumo financeiro. **Não** refetch da agenda a cada tecla.
- `useCreateCharge` passa a exigir `amountCents`/`idempotencyKey` no fluxo novo; aceita o formato
  antigo apenas para o fallback de rollout (ADR-003).
- `usePermissions` ganha:

```ts
canRegisterPayments: boolean;      // admin | receptionist | professional
canViewFinancials: boolean;        // admin
canViewOwnPayments: boolean;       // professional
canCancelCharge: boolean;          // admin | receptionist
canConfirmChargeManual: boolean;   // admin
canVoidPayment: boolean;           // admin
canViewPaymentTotalsInClosing: boolean; // quem registra, somente no diálogo
```

- `useSegmentFeatures` passa a devolver `payments: boolean`; `resolveFeatures` liga para `salao` e
  `barbearia`, desliga para `clinica`/`null` (ADR-005).
- Erros: módulo `src/lib/payment-errors.ts` mapeia `code` → chave i18n + `retryable` + ação
  sugerida. Componentes nunca comparam mensagem de texto.

### 6. Estados visuais e copy pt-BR (congelada para revisão do `ux-designer`)

| Chave i18n | Texto pt-BR |
|---|---|
| `payments.dialog.title` | Fechar atendimento |
| `payments.dialog.subtitle` | Registre como o cliente pagou. |
| `payments.dialog.total` | Total do atendimento |
| `payments.dialog.remaining` | Falta para quitar |
| `payments.method.dinheiro` | Dinheiro |
| `payments.method.cartao_credito` | Cartão de crédito |
| `payments.method.cartao_debito` | Cartão de débito |
| `payments.method.pix_sistema` | PIX do sistema |
| `payments.method.pix_maquininha` | PIX da maquininha |
| `payments.actions.addMethod` | Adicionar forma |
| `payments.actions.registerLater` | Registrar depois |
| `payments.actions.retry` | Tentar de novo |
| `payments.actions.finishWithoutPix` | Fechar sem o PIX |
| `payments.actions.finishWithoutPayment` | Concluir sem pagamento |
| `payments.fields.cashReceived` | Valor recebido |
| `payments.fields.change` | Troco |
| `payments.fields.tip` | Gorjeta |
| `payments.fields.tipHint` | A gorjeta não entra na receita do serviço nem na comissão. |
| `payments.fields.cardConfirmed` | Confirmei na maquininha |
| `payments.status.sem_pagamento` | Sem pagamento |
| `payments.status.parcial` | Parcial |
| `payments.status.quitado` | Quitado |
| `payments.status.aguardando_pix` | Aguardando PIX |
| `payments.partial.warning` | O atendimento ficará com saldo em aberto. Confirmar? |
| `payments.error.exceeds` | O valor excede o que falta. O adicional só pode ser gorjeta. |
| `payments.error.gateway` | Não foi possível gerar o PIX. Tente de novo ou continue sem o PIX. |
| `payments.error.pendingExists` | Este atendimento já tem um PIX pendente. Reexiba o QR existente. |
| `payments.error.pixUsed` | O PIX deste atendimento já foi utilizado. Use outra forma ou registre depois. |
| `payments.error.idempotency` | Os dados mudaram desde a última tentativa. Revise e confirme de novo. |
| `payments.receipt.title` | Comprovante |
| `payments.receipt.paid` | Pago |
| `payments.receipt.methods` | Formas de pagamento |
| `payments.receipt.date` | Data e hora |
| `payments.badge.pending` | Pagamento pendente |
| `payments.void.title` | Estornar recebimento |
| `payments.void.reason` | Motivo do estorno |
| `payments.void.refundWarning` | O dinheiro não volta pelo sistema. A conciliação no Asaas é manual. |

- Proibido literal em componente, `placeholder`, `aria-label` ou `title` (RNF-03).
- O `ux-designer` revisa a copy; qualquer mudança é só no arquivo de mensagens, não no contrato.

### 7. Acessibilidade e responsividade (RNF-02/RNF-04)

- `Dialog` com `DialogTitle`/`DialogDescription`; foco inicial no primeiro campo; retorno de foco
  ao abridor; ESC fecha quando permitido; foco preso no diálogo.
- Totais e troco em `aria-live="polite"` para não interromper a digitação; erros em `role="alert"`.
- Todo campo com `<Label>` associado; chips com `aria-pressed`; status nunca só por cor.
- Alvos de toque ≥ 44×44 px; layout de uma coluna em 375 px e duas em ≥ 1024 px; o diálogo não
  excede a viewport (scroll interno); tabela de linhas vira cards no mobile.
- Teclado: Tab previsível, Enter confirma, Escape cancela (quando não está `submitting`).
- Contraste WCAG 2.1 AA; foco visível.

### 8. Performance (RNF-01)

- Abrir o diálogo dispara **uma** chamada de settlement; não recarrega a agenda.
- Cálculo de troco/saldo é local (números inteiros), sem requisição por tecla.
- Polling do PIX: 5 s, apenas com diálogo aberto e cobrança pendente; backoff para 10 s após 1 min;
  para ao fechar/sucesso. Sem polling global.
- Listas grandes (settlement) usam render simples; a aba Recebimentos (ADR-005) é paginada.
- `staleTime` do settlement: 0 enquanto o diálogo está aberto; cache curto ao fechar.

## Interface congelada

### Componentes e props (nomes e contratos)

```text
PaymentCaptureDialog({ open, mode, appointment, onOpenChange, onCompleted })
AppointmentSettlementDialog({ open, appointmentId, onOpenChange, onRegisterPayment? })
PaymentReceipt({ data })
PaymentMethodChip({ method, selected, onSelect, disabled? })
PaymentLineRow({ line, remainingCents, onChange, onRemove, disabled })
```

### Contratos de dados consumidos

- `get-appointment-settlement` (ADR-002): `appointment`, `payments`, `pending_charges`,
  `total_paid_cents`, `tip_cents`, `reserved_cents`, `remaining_cents`, `payment_status`,
  `permissions`.
- `register-appointment-payments` (ADR-002): `settlement`, `charge` (opcional).
- `cancel-charge`, `confirm-charge-manual`, `void-appointment-payment` (ADR-002).

### Regras de exibição do QR (ambiguidade #3)

| Ator | `em_atendimento` | `concluido` |
|---|---|---|
| admin | QR visível | QR visível |
| recepção | QR visível (ato) | QR **não** visível |
| profissional (próprio) | QR visível (ato) | QR **não** visível |

O servidor já devolve `null` fora da janela; a UI não tenta “contornar” com cache.

### Regras de troco (ambiguidade #5)

- `cashReceivedCents` e `changeCents` são estado local; não vão no body.
- O body envia só `amountCents` (serviço) e `tipCents`.
- O comprovante exibe o troco calculado na sessão; ao reabrir, não há troco persistido.
- A receita considera `amountCents`, nunca `cashReceivedCents`.

## Alternativas consideradas

- **Tela nova de fechamento**: descartada. O PRD exige um diálogo no fluxo da agenda; uma rota
  nova aumentaria atrito e o tempo de fechamento (meta ≤ 30 s).
- **Um diálogo para captura e outro para comprovante**: descartada no v1. O comprovante é uma
  etapa do mesmo diálogo; menos navegação e menos chance de perder o contexto.
- **Reusar `StatusChangeConfirm` inteiro**: descartada. Ele é uma confirmação genérica de status;
  misturar captura financeira nele quebraria as outras transições.
- **Deixar o frontend calcular e enviar o saldo**: descartada. O servidor é a fonte da verdade.
- **Persistir troco no ledger**: descartada no v1 (ambiguidade #5). Exigiria coluna e decisão de
  caixa; o PRD aceitou não persistir.
- **Mostrar QR para recepção após a conclusão**: descartada. Contraria RF-26 e a janela “no ato”
  (ambiguidade #3).

## Consequências

- `StatusChangeConfirm` fica menor e deixa de ser o ponto de cobrança; a conclusão com pagamento
  passa a ser um único fluxo.
- A recepção ganha um diálogo operacional com saldo, mas continua sem qualquer tela de histórico
  ou total agregado.
- O comprovante não é um documento fiscal; é um registro operacional (sem nota fiscal, PRD §7).
- O troco não persistido é uma limitação declarada; se o dono pedir conferência de gaveta, é
  caixa/turno (fora do v1).
- A copy fica centralizada em i18n; o `ux-designer` pode ajustar sem tocar em lógica.
- A feature `payments` desligada preserva o fluxo antigo da clínica; a dívida é explícita e
  limitada ao segmento fora do escopo.

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Duplo submit no botão | lote duplicado | botão desabilitado + idempotency key + replay 200 |
| Chave regenerada em retry | lote duplicado | chave mantida em `editing`/`gateway_error` com payload idêntico; regenerar só após edição/sucesso |
| Recepção vê saldo em histórico | violação D5 | saldo só no diálogo; endpoint não tem lista/período; teste de RBAC |
| QR exposto após conclusão | vazamento | servidor devolve `null`; UI esconde ação |
| Troco “sumir” ao reabrir | expectativa errada | comprovante da sessão; texto não promete persistência; ADR-001 declara |
| Gateway lento trava o diálogo | UX ruim | estado `submitting` com spinner; timeout e retry; não fecha sozinho |
| Literal solto | i18n quebrada | lint/review; todas as chaves na tabela |
| Mobile com tabela larga | overflow | linhas viram cards em < 768 px; diálogo com scroll interno |
| Foco preso errado | a11y | teste de teclado; `Dialog` do shadcn/Radix com foco gerenciado |

## Critérios de aceite

1. Em tenant `salao`/`barbearia`, concluir abre “Fechar atendimento” e **não** chama
   `create-charge` automaticamente; em `clinica`, o fluxo antigo permanece (regressão zero).
2. O diálogo oferece exatamente dinheiro, crédito, débito, PIX do sistema, PIX da maquininha e
   “Registrar depois” (RF-01).
3. Dinheiro 10000 com recebido 12000: registra 10000, mostra troco 2000, receita 10000; recebido
   9000 bloqueia o confirmar (RF-02).
4. Crédito/débito não exibem campo de troco; cartão acima do saldo é bloqueado (RF-03).
5. PIX maquininha não gera QR nem chama gateway (RF-04).
6. PIX do sistema de 3000 cria cobrança de 3000 (não 10000), mostra QR no diálogo e não registra
   receita até confirmação (RF-05).
7. Split 6000 dinheiro + 4000 débito gera duas linhas e settlement `quitado` (RF-07).
8. Parcial 4000 exige confirmação explícita; sem confirmar, nada é persistido; com confirmar,
   estado `parcial` (RF-08).
9. Gorjeta 500 com serviço 10000 mostra gorjeta separada, receita 10000 e comissão inalterada
   (RF-10/RF-24).
10. “Registrar depois” conclui com `sem_pagamento`, badge no detalhe e nenhuma cobrança (RF-11).
11. Falha de gateway mantém o diálogo, mostra erro em pt-BR, oferece retry/“fechar sem o PIX” e não
    registra receita da parcela PIX (RF-27).
12. Recepção não vê QR após a conclusão, não vê histórico/totais; profissional só vê o próprio
    atendimento (RF-20/RF-21/RF-26).
13. Total zero: diálogo mostra total/pago 0, não aceita linha positiva e permite concluir sem
    pagamento (RF-22).
14. Tenant sem Asaas: PIX do sistema indisponível com mensagem; dinheiro/cartão funcionam (RF-23).
15. Todos os textos visíveis vêm de `react-i18next`; nenhum literal em componente.
16. Navegação por teclado, foco visível, labels, `role=alert` e contraste AA em 375 px e 1280 px.
17. Nenhum campo de cartão/PAN/CVV/bandeira no componente ou no body.

## Escopo desta decisão

**Dentro**: fluxo de telas, componentes, props, estados, hooks, cache/invalidação, copy pt-BR,
a11y, mobile-first, comprovante, troco local, janela do QR na UI, feature flag `payments` no
frontend e alteração de `StatusChangeConfirm`.

**Fora**: schema/RLS/backfill (ADR-001), RPC/Edge (ADR-002), `create-charge`/webhook (ADR-003),
painel/aba Recebimentos/RBAC final (ADR-005), SPEC/PLAN/TASKS, código de aplicação, branch/PR.

## Perguntas abertas

1. **Troco persistido**: aceito não persistir no v1. Se o dono pedir comprovante com “valor
   entregue” recuperável, exige coluna e decisão de caixa (novo PRD/ADR).
2. **Badge na lista da agenda**: v1 apenas no detalhe (ambiguidade #8). Se o uso mostrar que a
   lista precisa do indicador, é evolução de UI, sem mudança de contrato.
3. **Profissional e QR**: esta ADR permite QR ao profissional responsável enquanto o atendimento
   está `em_atendimento` (ele pode ser quem fecha). Se o produto quiser restringir a admin/
   recepção, é ajuste de matriz na ADR-002, não de componente.
4. **Copy final**: a tabela acima é a proposta congelada; o `ux-designer` pode ajustar texto, mas
   não criar estado novo sem ADR.

# Análise de Produto — PDV walk-in / venda de balcão (Atlas Agenda)

| Campo | Valor |
|---|---|
| Tipo | Feature (novo fluxo de venda, sem mudança de regra financeira) |
| Ramo alvo | `salao` e `barbearia` (gating `payments === true`, igual ao fechamento atual) |
| Título sugerido | **PDV balcão** |
| Alternativas | `Venda rápida` · `Caixa expresso` |
| Premissa travada | Herda 100% das regras financeiras atuais; mesmo ledger `appointment_payments`; zero duplicação de receita |
| Status deste doc | Análise de produto (não é PRD; não aprova escopo sozinho) |

---

## 1. Por que esta análise

Hoje só existe **uma porta de venda**: o fechamento de um appointment já agendado
(`PaymentCaptureDialog`, modo `close`). Quem chega sem hora marcada — o walk-in de
porta de barbearia/salão — não tem caminho no sistema. O operador improvisa em
papel ou marca um horário fictício na agenda, o que polui a grade, quebra a
estatística de ocupação e atrasa o fechamento de caixa.

O PDV é a **segunda porta do mesmo checkout**: mesma tela de pagamento, mesma
regra de ledger, mesma comissão, mesma idempotência. A diferença é só a
**origem** do atendimento: criado na hora, sem horário marcado, no balcão.

---

## 2. O que o código real já dá de graça (base herdada — sem reescrever)

| Capacidade | Onde vive hoje | Reuso no PDV |
|---|---|---|
| Checkout de pagamento (formas, gorjeta por linha, troco, confirmação de maquininha, parcial/append, PIX do sistema máx. 1) | `src/app/agenda/pagamentos/PaymentCaptureDialog.tsx` + `PaymentLinesEditor.tsx` + `PaymentLineRow.tsx` + `payment-math.ts` | Reusar em modo "venda nova" sem criar um segundo editor |
| Settlement/estorno/cancelamento/QR | `AppointmentSettlementDialog.tsx` + Edge `register-appointment-payments` + `void-appointment-payment` + `cancel-charge` | J3 (venda de appointment existente) já existe aqui; PDV walk-in nasce dentro dele |
| Ledger imutável + idempotência + `received_by` (operador) | `appointment_payments` (`20261106120000_appointment_payments_ledger.sql`) | Zero duplicação: venda walk-in grava as mesmas linhas, com `received_by` = operador do balcão |
| Relatório financeiro por método/gorjeta/recebidos HTML | `FinanceiroPage.tsx` + RPC `financial_summary` (`20261106144000_financial_summary.sql`) | Base do fechamento de caixa (ver §5) |
| Histórico de recebimentos com filtro por método/situação (ativos/estornados) | `RecebimentosTab.tsx` | Base da lista "vendas do dia" no fechamento |
| Formulários RHF + zod, `MoneyInput`, modais shadcn, catálogo de mensagens pt-BR | `AppointmentFormDialog.tsx`, `CustomerFormDialog.tsx`, `payments-messages.ts` | PDV segue o mesmo padrão; sem `react-i18next` no repo — catálogo tipado pt-BR |
| RBAC de pagamento | `usePermissions.ts` + `settlement.permissions` (flag do servidor) | Venda: os 3 papéis. Totais agregados/fechamento: só admin. Estorno: só admin |

> Conclusão: o PDV **não inventa um checkout novo**. É um入口 de criação
> (appointment instantâneo) que cai no checkout existente. Todo o trabalho de
> produto está em: **(a)** criar o appointment sem horário marcado (e sem cliente
> ou sem profissional, ver §4); **(b)** dar um ponto de entrada no balcão;
> **(c)** fechar o caixa do dia.

---

## 3. Trave de banco que o produto precisa decidir (o ponto central da feature)

Três colunas de `appointments` são `NOT NULL` e o checkout as pressupõe:

| Coluna | Trave no banco | Impacto no PDV |
|---|---|---|
| `customer_id` | `uuid not null` + FK composta (`20250219091000_appointments.sql:52`) | **Walk-in sem cliente hoje é impossível.** Precisa decidir §4.1 |
| `professional_id` | `uuid not null` + chave da constraint de exclusão `appointments_no_overlap` | **Walk-in sem profissional hoje é impossível** sem migration (ver §4.2) |
| `service_id` XOR `combo_id` | CHECK exige exatamente um (`20250226096000_appointments_combo.sql`) + `price_cents` snapshot único | **Serviço múltiplo numa venda não cabe num appointment.** Precisa decidir §4.3 |

Além disso: appointment nasce `pendente` e exige a cadeia
`pendente → confirmado → em_atendimento → concluido` (trigger, final imutável);
comissão (barbearia) é apurada no trigger de `concluido` sobre `price_cents`;
gorjeta fica fora da comissão. O PDV **não pode** "pular" a máquina de estados
sem migration dedicada — o planejador precisa prever o atalho (criar já em
`em_atendimento` ou transicionar em sequência dentro da mesma operação).

---

## 4. Dados mínimos de cada venda (decisões de produto — uma por linha)

### 4.1 Cliente: **opcional** (opção "balcão / anônimo")

Recomendação v1: venda aceita **dois modos de cliente**.

- **Cliente identificado**: busca/cadastro inline (nome + WhatsApp opcional).
  Preenche o histórico, alimenta WhatsApp/lembretes e fidelização futura.
- **"Balcão / anônimo"**: o sistema cria (uma única vez, por tenant) um cliente
  sintético `"Cliente de balcão"` — sem telefone real, `whatsapp_opt_in = false`,
  nunca recebe disparo. Todas as vendas anônimas apontam para ele.

**Por quê:** `customer_id NOT NULL` + `customers.phone NOT NULL` impedem
"branco" sem migration. Cliente sintético = **zero migration** no modelo de
cliente, zero risco LGPD (sem PII, sem disparo). O operador não tecla nada na
venda rápida; se o cliente quiser, identifica em 1 campo opcional.

**Riscos assumidos:**

- Venda anônima não entra em histórico de cliente, não recebe lembrete D-1 nem
  WhatsApp de pós-atendimento — perda de retenção (ver §7).
- Agendamento (`appointments`) nunca nasce anônimo: se o anônimo quiser agendar
  depois, o operador cadastra o cliente na hora (converte o sintético? **não** —
  cria cliente novo e os appointments antigos ficam no sintético; aceitável v1).

**Fora v1:** permitir `customer_id` nulo via migration; fundir sintético com
cliente real depois; "cliente avulso" com nome digitado sem telefone.

### 4.2 Profissional: **obrigatório v1** (comportamento atual preservado)

Recomendação v1: **profissional obrigatório**, mesma regra de hoje.

**Por quê:**

- `professional_id NOT NULL` + a constraint de exclusão é **por profissional**:
  sem profissional, ou a venda não ocupe horário (risco de duas vendas no mesmo
  tempo na mesma cadeira), ou precisa de migration + nova lógica de ocupação.
- Comissão (barbearia) é apurada **por profissional** no `concluido`. Sem
  profissional, a comissão não tem dono — o dinheiro entra sem atribuição,
  quebrando o relatório de comissões.
- RLS de professional é por `professional_id`: sem profissional, o profissional
  nunca veria a venda que executou.

**Fora v1 (backlog):** "sem profissional atribuído" (ex.: venda de produto futuro,
ou serviço executado por quem não é profissional cadastrado). Exige: tornar
`professional_id` nullable, exceção na exclusão, regra de comissão "sem dono"
e recorte de RLS. É escopo de ADR próprio, não de MVP.

### 4.3 Serviço: **múltiplo v1 — várias linhas, um checkout**

Recomendação v1: a venda aceita **N serviços** (ex.: corte + barba), cada um
com seu snapshot de preço, total = soma. Profissional único por venda (escolhido
uma vez); serviços do mesmo profissional ou não — o operador escolhe serviços
do catálogo, o sistema não valida vínculo `service_professionals` na venda de
balcão (venda de balcão ≠ agendamento; a validação de vínculo fica só na agenda).

**Por quê:** um appointment carrega **um** `service_id` (XOR `combo_id`) e **um**
`price_cents`. Servir 2 serviços no mesmo appointment exigiria migration
(modelo "itens de venda") — estoura o MVP. Multiplicar appointments (um por
serviço, mesmo `starts_at`) é gambiarra visível na agenda e no relatório.
Solução de produto: **1 venda = 1 appointment** com `price_cents` = soma, e
`service_id` = **principal** (o de maior valor, só como referência de catálogo);
detalhe dos serviços numa nova modelagem de itens — ver decisão abaixo.

> ⚠️ Ponto que o planejador **não pode** adiar sem decisão explícita: como
> representar "corte + barba" num appointment com XOR `service_id`/`combo_id`?
> Opções (em ordem de preferência de produto):
>
> 1. **(Recomendada v1)** Novo `appointment_items` (linha: `appointment_id`,
>    `service_id`, `price_cents` snapshot). Migration aditiva, appointment segue
>    com `service_id` = principal e `price_cents` = soma. Relatório e comissão
>    continuam lendo `price_cents` — zero mudança de regra.
> 2. Appointment múltiplo (um por serviço, checkout único). Sem migration, mas
>    suja agenda/relatórios e multiplica comissões — rejeitada.
> 3. Adiar múltiplo: v1 só 1 serviço por venda, multi-serviço no backlog.
>    Menor valor de produto (balcão é justamente onde o cliente faz 2 serviços).

Se o planejador escolher a opção 1, a migration é aditiva e idempotente;
appointment antigo segue válido (sem itens, leitura usa `service_id`).

### 4.4 Campos da venda (resumo v1)

| Campo | Obrigatório? | Origem/valor |
|---|---|---|
| Serviço(s) | ✅ ≥1 do catálogo ativo | Snapshot de preço no ato (`price_cents`) |
| Profissional | ✅ 1 (catálogo ativo) | Trava `professional_id` |
| Cliente | ❌ (default: "Cliente de balcão") | Identificado = nome + WhatsApp opcional |
| `starts_at`/`ends_at` | automático | `agora` / `agora + duração do principal` (ocupa a cadeira; ver §7) |
| Total | automático | Soma dos serviços; preço nunca digitado na venda |
| Método(s) | ✅ via checkout existente | Linhas de `PaymentLinesEditor`; split simples permitido (parcial/append herdado) |
| Gorjeta | ❌ opcional, por linha | Regra atual: fora da receita de serviço e da comissão |
| Situação final | automático | `concluido` + linhas no ledger na mesma operação |

Split payment: **herda o parcial/append atual** (2 formas somando o total,
confirmação explícita do parcial — já existe em `validateDraft`/confirm_partial).
Split complexo (3+ formas, percentuais, desconto) = fora v1.

---

## 5. Mínimo viável de fechamento de caixa (v1)

O que já existe cobre metade: `FinanceiroPage` (por método, gorjetas, "a
receber", "em aberto") e `RecebimentosTab` (lista com estornados). O que falta
é o **recorte de fechamento do dia/turno** + o **contado** (gaveta física).

**Recomendação v1 — tela "Fechamento" (admin, dentro de Relatórios):**

1. **Período**: presets `hoje / ontem / personalizado` (default hoje, fuso do
   tenant) — reusa `PeriodFilter`/`period-presets`.
2. **Esperado por método**: as 5 formas com valor + contagem (reusa
   `by_method` da `financial_summary`, sem nova agregação).
3. **Gorjetas**: total do período (reusa `received_tips_cents`).
4. **Estornos do período**: contagem + valor + motivo (já existem na aba
   Recebimentos com filtro `situacao=estornados`; o fechamento só resume).
5. **Por operador**: agrupamento por `received_by` (o ledger **já grava** o
   operador — é só o `GROUP BY` que falta na tela).
6. **Esperado vs contado**: campo "contado" por método (default = esperado,
   operador ajusta, principalmente dinheiro) + diferença automática
   (contado − esperado). **Persistência v1: tabela nova `cash_closings`**
   (`tenant_id`, data, método, `expected_cents`, `counted_cents`, `closed_by`,
   `notes`, `created_at`) — **única tabela nova da feature**. Fechamento é
   feito quando o operador confirma (1 por método por dia — `unique`).
7. **Exportação**: **fora v1**. O fechamento é tela; exportação CSV/PDF é
   backlog (a aba Recebimentos hoje já é "sem exportação" por decisão).

**Por que o contado entra v1 (e não é backlog):** sem contar a gaveta, o
fechamento não fecha — "esperado" sozinho é só o relatório financeiro que já
existe (`FinanceiroPage`). O valor do PDV para o dono é saber se falta dinheiro.
O custo é uma tabela pequena e uma tela que reusa 80% do que existe. Limite do
MVP: contado só para `dinheiro` (cartão/PIX têm comprovante no sistema; contar
é conferência, não digitação).

**RBAC do fechamento:** só `admin` vê o fechamento (igual a `FinanceiroPage` e
à RLS admin-only do ledger). Recepção e profissional vendem no PDV e veem o
**comprovante da própria venda** (`PaymentReceipt`, já existe), nunca os totais
do dia — coerente com a regra atual de não expor faturamento a recepção.

---

## 6. Jornadas e pontos de entrada

### J1 — Walk-in com profissional atribuído (jornada principal v1, ~90% do uso)

**Fluxo:** botão **"Nova venda"** → serviço(s) → profissional → total →
método(s) → gorjeta opcional → **concluído** (comprovante).

**Ponto de entrada (recomendado):**

- **Primário:** item **"PDV"** na barra lateral (`AppSidebar.tsx`), ao lado de
  "Agenda", visível para os 3 papéis quando `payments === true` (mesmo gating
  do checkout). Rota `/app/pdv`. Ícone `Store` ou `ShoppingCart` (lucide).
- **Secundário (atalho):** botão "Nova venda" no cabeçalho da **Agenda**
  (`AgendaPage.tsx`, hoje tem o `+` de novo agendamento ao lado do toggle de
  view) — quem está operando o dia abre a venda sem sair da agenda.
- **Não entra** no Dashboard (polui a visão geral) nem nas Cobranças (admin-only,
  e PDV é operacional — recepção precisa vender).

**Layout da tela `/app/pdv`:** 2 colunas em desktop (esquerda: serviços +
profissional + cliente; direita: total + checkout = `PaymentCaptureDialog` em
modo "venda nova"). Mobile: passo único com os campos empilhados e o checkout
no rodapé. Sem Wizard de 3 passos — o balcão precisa de venda em <60s.

### J2 — Walk-in sem profissional atribuído

**Status v1: não implementado** (decisão §4.2). A tela de venda **exige**
profissional; o seletor vem pré-selecionado quando o operador é profissional
(mesmo padrão do `lockedProfessionalId` da agenda). Backlog em §8.

### J3 — Venda de appointment existente pelo PDV

**Status: já existe** (`PaymentCaptureDialog` modo `close` a partir da agenda).
O que o PDV adiciona é só **descoberta**: a tela `/app/pdv` ganha uma aba
**"A concluir hoje"** (appointments do dia em `em_atendimento`/`confirmado`
sem pagamento quitado), e cada linha reabre o checkout existente. Zero nova
regra de pagamento — é só um índice de entrada. Se o planejador quiser, a aba
pode entrar na v1.1 (não bloqueia o MVP).

---

## 7. Critérios de aceite mensuráveis (por jornada)

### J1 — venda walk-in

- [ ] Dado: operador com `canRegisterPayments` abre `/app/pdv`. Quando:
  seleciona 1 serviço + 1 profissional + 1 método (dinheiro) e confirma,
  então: venda registrada em ≤ **3 toques/campos** (serviço, profissional,
  método), total automático = `services.price_cents`, linhas gravadas no ledger
  com `received_by` = operador, appointment nasce `concluido`.
- [ ] Quando: venda com 2 serviços e gorjeta R$ 10 no dinheiro, então:
  `price_cents` = soma dos 2, `tip_cents` = 1000, comissão (barbearia) calculada
  só sobre os serviços (gorjeta fora), receita do período soma só o serviço.
- [ ] Quando: operador clica "Nova venda" 2x rápido (duplo clique / retry de
  rede), então: **uma única venda** (idempotência `idempotency_key` herdada —
  o ledger nunca duplica).
- [ ] Quando: venda sem cliente, então: grava no cliente sintético "Cliente de
  balcão", sem telefone, sem disparo de WhatsApp, sem erro de validação.
- [ ] Quando: profissional indisponível (sem horário / fora de expediente) —
  venda **não** valida jornada: o balcão vende mesmo fora do expediente
  (decisão: horário comercial não trava venda; bloqueia só agendamento).
- [ ] Tempo de venda: do clique em "Nova venda" à confirmação em ≤ **60 segundos**
  com 1 serviço (medível em QA; é o requisito de UX do balcão).
- [ ] Split herdado: 2 formas (R$ 30 cartão + R$ 20 dinheiro) fecham a venda
  somente com confirmação explícita do parcial; o saldo aberto aparece como
  "em aberto" no financeiro.

### J3 — concluir appointment existente

- [ ] Quando: appointment `em_atendimento` do dia com saldo aberto, então:
  aparece na aba "A concluir hoje" do PDV com nome, serviço e saldo.
- [ ] Quando: operador finaliza por essa aba, então: grava no **mesmo** ledger,
  estado final = `concluido`, e **não** cria appointment novo (zero duplicação
  de receita — a venda é do appointment existente, não de um walk-in gêmeo).

### Fechamento de caixa (v1)

- [ ] Quando: admin abre Fechamento com preset "hoje", então: vê esperado por
  método (5 formas), gorjetas, estornos (nº + valor) e agrupamento por operador,
  tudo com `received_at` no fuso do tenant.
- [ ] Quando: admin digita contado de dinheiro diferente do esperado, então:
  diferença exibida em tempo real; ao confirmar, persiste 1 linha em
  `cash_closings` por método/dia (duplo fechamento do mesmo dia é bloqueado).
- [ ] Quando: papel ≠ admin abre `/app/relatorios` ou `/app/pdv/fechamento`,
  então: sem acesso a totais (mesma barreira do `FinanceiroPage` hoje).
- [ ] Quando: uma venda do dia é estornada, então: some do esperado e aparece
  na linha "estornos" (receita nunca conta `voided_at is not null`).

---

## 8. Fora de escopo v1 + backlog sugerido

| Item | Status | Motivo |
|---|---|---|
| Fila / check-in / chamar por número | ❌ fora v1 | Empty chair de espera é fluxo novo (estado, tela, chamada); balcão v1 é ordem de chegada informal |
| Fiscal / NFC-e / SAT | ❌ fora v1 | Exige emissão, certificado, alíquota por serviço — projeto à parte |
| Estoque / produto físico | ❌ fora v1 | Premissa travada: serviço-only, sem produto |
| Fidelidade / pontos / clube | ❌ fora v1 | Depende de cliente identificado; balcão anônimo não alimenta |
| Marketplace / link público de venda | ❌ fora v1 | Superfície pública nova; RBAC e RLS próprios |
| Combo/pacote dentro do PDV | ❌ fora v1 (salão) | Combo já existe cobrado via appointment; o PDV v1 vende serviço avulso (decisão: se o cliente pedir o combo no balcão, usa a J3 sobre appointment de combo) |
| Desconto avançado (%/cupom/aprovação) | ❌ fora v1 | Quebra "preço do catálogo" e mexe em comissão; preço da venda = preço do serviço |
| Split complexo (3+ formas/percentual) | ❌ fora v1 | Herda parcial 2 formas; 3+ formas não tem caso de uso de balcão |
| Walk-in sem profissional | ❌ backlog | Exige migration (`professional_id` nullable) + regra de comissão "sem dono" — ADR próprio |
| Esperado vs contado persistido multimoeda/turno | ❌ backlog | v1 = fechamento diário; turno/caixa por operador físico é evolução |
| Exportação CSV/PDF do fechamento | ❌ backlog | Aba Recebimentos já decidiu "sem exportação" — manter consistência |
| Fila real necessária? | ver §9 | Sem fila na v1; ordem de chegada é do operador |

---

## 9. Riscos de produto (e mitigação na v1)

| # | Risco | Impacto | Mitigação v1 / decisão |
|---|---|---|---|
| R1 | **Venda anônima não fideliza.** Sem cliente, sem histórico, sem lembrete D-1, sem WhatsApp. O walk-in "escapa" do ciclo de retenção. | Perda de retorno; venda vira caixa sem lastro de CRM | Campo cliente **opcional mas incentivado**: nome (1 campo) sempre visível na tela; sinônimo: "identificar cliente rende lembrete". Métrica acompanhar: % de vendas anônimas — se > 40%, vira foco de produto |
| R2 | **Walk-in ocupa a grade.** `starts_at=agora`, `ends_at=agora+duração` entra na exclusão `appointments_no_overlap`: enquanto a venda está `em_atendimento`, ninguém agenda aquele profissional sobreposto. | Bloqueio temporário real de agenda | **Desejado**: a cadeira está ocupada de verdade. Ao concluir, o horário já passou (fim da exclusão efetiva). Risco só se a venda "emperrar" em `em_atendimento` — mitigado pela venda instantânea (vida útil ≤ tempo do serviço) |
| R3 | **Sem profissional, comissão sem dono** (se J2 fosse implementada na v1) | Receita sem atribuição quebra comissões | J2 fora v1 por decisão §4.2 — sem mitigação necessária agora |
| R4 | **Recepção vende, mas não vê totais.** O operador do balcão (recepção) não enxerga fechamento nem histórico financeiro — pode não notar erro de caixa no dia. | Erro de gaveta só aparece no fechamento do admin | Aceitável: é a regra vigente (recepção não lê faturamento). O comprovante da própria venda é visível; a diferença é do admin no fechamento |
| R5 | **Fila real necessária?** Sem check-in, 2 walk-ins simultâneos disputam a mesma cadeira; o sistema só barra **depois** (exclusão no banco). | Operador tenta vender 2x o mesmo profissional no mesmo instante → erro de conflito em tempo de pagamento | v1: erro pt-BR "profissional ocupado neste horário" mapeado da `23P01` (mesmo mapa da agenda) + sugestão de outro profissional. Fila/check-in vira backlog se o volume justificar (métrica: taxa de conflito) |
| R6 | **Duplo PDV no mesmo caixa.** Dois terminais vendendo para o mesmo profissional. | Conflito de horário / cliente com 2 vendas | A trava é o banco (exclusão + idempotência); a UI só traduz o erro. Usuário só vê 1 venda salva por clique |
| R7 | **Cliente sintético vira "gaveta" de dado sujo.** Relatórios por cliente mostram um cliente gigante. | Poluição de CRM e de métrica "novos clientes" | Cliente sintético com flag/filtro: relatórios de cliente o excluem; métrica "novos clientes" conta só identificados. Decisão registrada aqui para o planners detalhar |

---

## 10. O que entra nas ADRs (para o planejador)

1. **ADR de criação do appointment instantâneo** — `customer_id` (sintético),
   `professional_id` (obrigatório), XOR `service_id` (principal) + `price_cents`
   (soma), `starts_at=agora`, atalho da máquina de estados até `concluido`,
   commission trigger herdado.
2. **ADR de multi-serviço** — `appointment_items` aditivo (ou rejeitar multi na
   v1); leitura de receita/comissão inalterada.
3. **ADR de fechamento** — `cash_closings` (única tabela nova), contado por
   método, `unique` por dia/método, agrupamento por `received_by`,
   reuso de `financial_summary` sem nova agregação.
4. **ADR de navegação** — rota `/app/pdv`, item na sidebar, botão na agenda,
   gating `payments === true`, RBAC herdado (venda: 3 papéis; fechamento: admin).
5. **ADR de cliente sintético** — criação única por tenant, exclusão em
   relatórios/métricas, `whatsapp_opt_in=false`, sem disparo.

---

## 11. Resumo em 10 linhas (para o orquestrador)

- **Título:** PDV balcão (alternativas: Venda rápida · Caixa expresso).
- **Tese:** PDV é segunda porta do checkout existente — mesmo ledger, mesma
  regra, zero duplicação de receita. Só muda a origem: appointment criado na hora.
- **Jornadas:** J1 walk-in com profissional (v1) · J2 sem profissional (fora v1)
  · J3 concluir appointment existente (já existe; PDV adiciona aba "A concluir hoje").
- **Entrada:** item "PDV" na sidebar (`/app/pdv`, 3 papéis se `payments`) +
  botão "Nova venda" na agenda.
- **Dados mínimos:** serviço(s) ≥1 (multi via `appointment_items` aditivo),
  profissional obrigatório, cliente opcional (sintético "Cliente de balcão"),
  método(s) + gorjeta opcional via checkout herdado.
- **Fechamento v1:** tela admin com esperado por método, gorjetas, estornos,
  por operador + contado (dinheiro) vs esperado, persistido em `cash_closings`
  (única tabela nova). Exportação = backlog.
- **Decisão central:** `customer_id NOT NULL` + `professional_id NOT NULL` +
  XOR `service_id` impedem walk-in "em branco" sem migration — por isso
  cliente sintético (zero migration de cliente) e profissional obrigatório.
- **Maior risco:** venda anônima fora do ciclo de retenção (sem lembrete/WhatsApp);
  mitigação: nome opcional em destaque + métrica de % anônimas.
- **Fora v1:** fila/check-in, fiscal, estoque, fidelidade, marketplace,
  combo no PDV, desconto, split complexo — tudo backlog mapeado no §8.
- **Entrega para o planejador:** 5 ADRs (criação instantânea, multi-serviço,
  fechamento, navegação, cliente sintético) com aceite mensurável por jornada no §7.

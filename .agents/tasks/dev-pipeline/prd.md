# PRD: PDV balcão (walk-in) — venda instantânea sem agendamento

Status: aprovada (PRD 1R enxuto; análises em `analysis-data.md` e `analysis-product.md` são o contrato técnico).
Branch de trabalho: `feat/pdv-balcao` a partir da master.
Formato: hermético estilo repo — problema/valor, escopo, fluxo, RBAC, critérios de aceite (J1 walk-in, J3 a-concluir-hoje, fechamento só-leitura), decisões. Sem detalhe de código.

---

## 1. Problema e valor de negócio

Hoje só existe uma porta de venda: o fechamento de um appointment já agendado (`PaymentCaptureDialog`, modo `close`). Quem chega sem hora marcada — o walk-in de porta de barbearia/salão — não tem caminho no sistema. O operador improvisa em papel ou força um horário fictício na agenda, poluindo a grade, quebrando a estatística de ocupação e atrasando o fechamento de caixa.

Quando esta demanda estiver pronta:

- O balcão vende em menos de 60 segundos: 1 serviço (ou 1 combo) + 1 profissional + checkout no mesmo fluxo.
- A venda vira `appointment` real e cai no checkout, ledger, comissão e financeiro existentes — segunda porta do mesmo caixa, sem segundo financeiro.
- O cliente de balcão é anônimo por padrão (sem telefone fake, sem cliente sintético, sem toque em `customers`); identificado é opcional via cadastro rápido (nome + WhatsApp).
- O dono fecha o dia com esperado/gorjetas/estornos/por operador, só-leitura.
- A agenda continua mostrando o que foi vendido, com badge "Balcão" — walk-in concluído aparece como concluído.

Valor: menos papel, menos slot fictício, caixa fechável no dia, receita rastreável no ledger único.

---

## 2. Escopo

### Entra

- Origem walk-in no appointment: `origin = 'walk_in'`, orthogonale ao status; `customer_id` nullable só para walk-in (agendado sempre exige cliente).
- Walk-in nasce `em_atendimento` e conclui via `register_appointment_payments` com `close_appointment = true` (comissão snapshot no trigger). Inserir `concluido` direto é proibido.
- Single-service v1: 1 serviço ou 1 combo por venda. Profissional obrigatório. Serviço ativo do tenant com vínculo N:N válido (erro `SERVICE_NOT_OFFERED`).
- Tela `/app/pdv` (sidebar + botão na agenda), 2 colunas em desktop (esquerda: serviço + profissional + cliente; direita: total + checkout). Mobile empilhado. Sem wizard de 3 passos.
- Aba "A concluir hoje": appointments `em_atendimento`/`confirmado` do dia sem pagamento quitado; finalizar reabre o checkout existente sem criar appointment novo (J3).
- Badge "Balcão" e nome "Cliente de balcão" quando `customer_id` é nulo. Na agenda, walk-in concluído aparece como concluído com badge.
- QR Pix em concluído walk-in para recepção (ampliar `can_view_qr` só nesse caso; agendado não muda).
- Fechamento só-leitura admin em `/app/relatorios/financeiro` (ou aba em Financeiro): esperado por método, gorjetas, estornos, por operador + filtro "só balcão" via `origin`. Reusa `financial_summary` + Recebimentos existentes.
- Idempotência: `creation_idempotency_key` (unique parcial tenant+key) no INSERT + `idempotency_key` de lote existente. Mesma chave devolve o existente.
- Erros pt-BR: `23P01` → "profissional ocupado neste horário"; `PT403`/`PT409` via `payments-messages`.
- Escopo fileira (ramo): PDV aparece só quando `payments === true` (salão/barbearia). Edge walk-in lê `tenants.segment` e recusa `SEGMENT_NOT_ENABLED` fora do ramo. Nunca RLS por segment.

### Fora de escopo v1 + backlog (registrado, não implementado)

| Item | Motivo |
|---|---|
| Multi-serviço por venda (vários serviços num checkout) | Fora v1: 1 serviço ou 1 combo por venda. Multi evolui depois, sem entidade `sales`. |
| Fila / check-in / chamar por número | Fluxo novo de estado/tela; balcão v1 é ordem informal de chegada. |
| Fiscal (NFC-e/NF) | Projeto à parte (emissão, certificado, alíquota). Comprovante interno sem valor fiscal. |
| Estoque / produto físico | Premissa travada: serviço-only. |
| Fidelidade / pontos / clube | Depende de cliente identificado; anônimo não alimenta. |
| Desconto / override de preço | Quebra "preço do catálogo" e mexe em comissão. Preço da venda = preço do catálogo no ato. |
| Contado-vs-esperado persistido (`cash_closings`) | Backlog. Fechamento v1 é só-leitura (esperado). |
| Split complexo (3+ formas, percentuais) | Herda parcial/append atual (2 formas com confirmação explícita). |
| Walk-in sem profissional | ADR próprio: `professional_id` nullable + comissão sem dono + exceção na exclusão. |
| Exportação CSV/PDF do fechamento | Backlog (Recebimentos já decidiu "sem exportação"). |
| Marketplace / link público de venda | Superfície pública nova; RBAC/RLS próprios. |

---

## 3. Fluxo

### J1 — Walk-in (jornada principal v1)

1. Operador abre `/app/pdv` (ou "Nova venda" na agenda quando `payments === true`).
2. Seleciona 1 serviço/combo ativo + 1 profissional ativo. Cliente: anônimo default ou identificado (cadastro rápido nome + WhatsApp, opcional).
3. Sistema cria o walk-in `em_atendimento` (`starts_at = agora`, `ends_at = agora + duração`, `price_cents` snapshot do catálogo, `origin = 'walk_in'`) — 1 chamada de abertura.
4. Operador confere total e registra método(s) + gorjeta opcional no checkout existente (2 chamadas: criar + registrar). Pagamento integral por padrão na UI; parcial fica "em aberto" (herdado).
5. `close_appointment = true` conclui no mesmo commit → comissão snapshot dispara → venda aparece na agenda como `concluido` com badge "Balcão" e "Cliente de balcão" quando anônima.
6. Comprovante `PaymentReceipt` exibido (sem valor fiscal).

### J3 — A concluir hoje (venda de appointment existente pelo PDV)

1. Aba "A concluir hoje" lista `em_atendimento`/`confirmado` do dia com saldo aberto (nome, serviço, profissional, saldo).
2. Linha reabre `PaymentCaptureDialog` modo `close`/`register` existente.
3. Finaliza no mesmo ledger, `concluido`, zero appointment novo, zero receita duplicada.

### Fechamento só-leitura (admin)

1. Admin abre `/app/relatorios/financeiro` ("Fechamento de balcão" só-leitura).
2. Vê esperado por método (5 formas), gorjetas, estornos (nº + valor) e por operador, tudo com `received_at` no fuso do tenant.
3. Filtro "só balcão" recorta por `origin = 'walk_in'`. Recepção/profissional não veem totais.

---

## 4. RBAC herdado 100%

| Ação | admin | receptionist | professional |
|---|---|---|---|
| Abrir venda walk-in | qualquer profissional do tenant | qualquer profissional do tenant | só para si |
| Registrar + concluir | qualquer | qualquer | só próprio |
| Pix sistema (após concluído) | qualquer | qualquer | só próprio |
| Ver QR Pix pendente | sim | `em_atendimento` + `concluido` walk-in (novo); agendado sem mudança | só `em_atendimento` |
| Cancelar cobrança | sim | sim (force só admin) | não |
| Baixa manual Pix / estorno (`void`) | sim único | não | não |
| Ver fechamento / `financial_summary` / ledger / comissões | sim | não | não (só próprias comissões) |

Nenhum papel ganha visibilidade financeira nova. `origin` não é RBAC. `super_admin`: sem caminho cliente para walk-in.

---

## 5. Critérios de aceite

### J1 — walk-in

- [ ] Operador com `canRegisterPayments` abre `/app/pdv`; seleciona 1 serviço + 1 profissional + dinheiro e confirma → `concluido`, linhas no ledger com `received_by` = operador, total = `price_cents` do catálogo, ≤3 campos, ≤60s.
- [ ] Venda com gorjeta R$ 10: `tip_cents = 1000` fora da receita de serviço e da comissão.
- [ ] Duplo clique / retry com mesma chave → **uma única venda** (idempotência de criação + lote).
- [ ] Venda sem cliente → grava com `customer_id` nulo, exibe "Cliente de balcão", sem telefone, sem WhatsApp, sem erro.
- [ ] Profissional ocupado (`23P01`) → erro pt-BR "profissional ocupado neste horário" + sugestão de outro profissional.
- [ ] Serviço não oferecido pelo profissional → `SERVICE_NOT_OFFERED`.
- [ ] `commission` apurada sobre `price_cents` integral (gorjeta fora), mesmo com parcial.
- [ ] PDV invisível fora de salão/barbearia (`payments !== true`); Edge recusa `SEGMENT_NOT_ENABLED` fora do ramo.

### J3 — a concluir hoje

- [ ] `em_atendimento` do dia com saldo aberto aparece na aba com nome, serviço e saldo.
- [ ] Finalizar pela aba grava no mesmo ledger, `concluido`, sem appointment novo.

### Fechamento só-leitura

- [ ] Admin com preset "hoje" vê esperado por método, gorjetas, estornos e por operador, `received_at` no fuso do tenant.
- [ ] Filtro "só balcão" recorta `origin = 'walk_in'`.
- [ ] Papel ≠ admin abre `/app/relatorios` ou `/app/pdv` → sem totais (mesma barreira do `FinanceiroPage` atual).
- [ ] Venda estornada sai do esperado e aparece em estornos (receita nunca conta `voided_at is not null`).

### Técnico

- [ ] `npm run typecheck`, `npm run build`, `npm test` verdes; `supabase db reset` 2× exit 0; regressão existente verde.
- [ ] QA visual Chrome DevTools (console zero erros) com screenshots em `.agents/tasks/dev-pipeline/qa/`.
- [ ] 1 commit por ADR; branch `feat/pdv-balcao` + PR manual (sem merge automático).

---

## 6. Decisões travadas (não reabrir)

- **D-01 Modelo 1R:** `appointments.origin` (`agendado|walk_in`) + `customer_id` nullable com CHECK `agendado exige cliente, walk_in pode ser anônimo`. Sem novo status, sem entidade `sales`, sem segundo financeiro. `origin` é ortogonal: não entra em trigger/máquina/RLS/relatório.
- **D-02 Nasce `em_atendimento`, conclui no UPDATE.** INSERT direto `em_atendimento` (trigger é só de UPDATE, sem transição forçada), conclui via `register_appointment_payments` com `close_appointment = true` (comissão no trigger). Nunca inserir `concluido` direto.
- **D-03 Single-service v1.** 1 serviço (ou 1 combo) por venda. Multi-serviço, fila/check-in, fiscal, estoque, fidelidade, desconto, contado-vs-esperado persistido, split complexo = backlog.
- **D-04 Cliente anônimo default.** Sem telefone fake, sem cliente sintético, sem toque em `customers`. Identificado opcional = cadastro rápido (nome + WhatsApp).
- **D-05 Profissional obrigatório v1** + vínculo N:N validado na Edge (`SERVICE_NOT_OFFERED`) — única regra nova.
- **D-06 2 chamadas (create + register).** Janela intermediária "venda aberta" é estado de domínio válido (`sem_pagamento`/`parcial`), já coberto. RPC única rejeitada (funde responsabilidades).
- **D-07 Preço/origem/nascimento do servidor.** Cliente nunca envia preço, `origin` ou `tenant_id`. Snapshot do catálogo no ato.
- **D-08 Fechamento só-leitura.** Contado persistido (`cash_closings`) = backlog. QR recepção em concluído walk-in: ampliar `can_view_qr` só para recepção + walk-in + concluído (decisão de produto, §8.6 da analysis-data).
- **D-09 Segment gate server-side é produto, não RLS.** Edge lê `tenants.segment` e recusa `SEGMENT_NOT_ENABLED` fora de salão/barbearia. Nunca policy RLS por segment.

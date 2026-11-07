# PRD — Formas de pagamento no fechamento do atendimento

> **prd-id**: `cobranca-formas-pagamento`
> **Tipo de rota**: Feature (novo domínio de recebimento)
> **Segmento**: salão de beleza e barbearia (clínica/convênio fora)
> **Dono da aprovação**: Product Owner (fundador)
> **Status**: `approved` (2026-11-06 — gate humano)
> **Mapa**: §1, §2, §5, §6, §7, §9, §16 obrigatórias (contrato em `.agents/rules/prd-adr-pipeline.md`).
> **Insumo**: plano `2026-11-06-cobranca-formas-pagamento.md` + decisões fechadas D1–D9 (não reabertas aqui).

## 1. Problema

O sistema assume hoje que **todo atendimento é pago por PIX Asaas**, e essa suposição está codificada em três pontos:

- `charges` é PIX-only (`status` `pendente|pago|expirado|cancelado`, `amount_cents`, `asaas_payment_id`, QR/copia-e-cola), com **um único charge por atendimento** (`supabase/migrations/20250306100000_asaas_charges.sql:16-32,53`).
- Ao concluir o atendimento, `StatusChangeConfirm` chama a Edge `create-charge` **automaticamente** e **pelo valor cheio** (`src/app/agenda/StatusChangeConfirm.tsx:86-101`); a Edge usa `appointments.price_cents` como valor e trata “já existe charge” como idempotência por atendimento (`supabase/functions/create-charge/handler.ts:56,68-71,101,116-125`). Falha vira aviso e não bloqueia a conclusão.
- A baixa só acontece por webhook do Asaas (`supabase/functions/asaas-webhook/handler.ts:72-86`). Não existe “marcar como pago” manual.
- A receita do painel lê `charges` com status `pago`; a comissão apura sobre `appointments.price_cents` no gancho de `concluido` (`supabase/migrations/20250226092000_commission_on_conclude.sql:98-108`).
- O sigilo financeiro é imposto na leitura: `charges` tem SELECT apenas para admin do tenant (`20250306100000_asaas_charges.sql:74-77`).

Consequências verificáveis no desenho atual:

1. Dinheiro, cartão de crédito, cartão de débito e PIX de maquininha **não existem** como forma de recebimento.
2. Todo atendimento concluído tende a gerar um PIX **indevido** — inclusive quando o cliente já pagou em dinheiro ou cartão.
3. Pagamento **dividido** é impossível (um charge por atendimento).
4. O dono **não sabe quanto entrou por forma** de pagamento, nem separa gorjeta de receita de serviço.
5. Recepção e profissional não conseguem fechar o atendimento sem depender do gateway.

**Baseline quantitativo:** o repositório **não mede** taxa de PIX indevido, volume de PIX órfão nem tempo de fechamento — não há telemetria desse fluxo. Este PRD trata essas linhas de base como “a medir antes do rollout” (§5), sem inventar número.

> ❓ Validação: o problema está descrito com evidência no código e sem métrica inventada? (sim/não)

## 2. Objetivo

Quando esta melhoria estiver pronta, no segmento salão/barbearia:

- **Todo atendimento concluído tem um desfecho de pagamento explícito**: uma ou mais formas registradas, ou a escolha consciente “sem pagamento / registrar depois”. Nenhum atendimento termina em silêncio financeiro.
- **PIX do sistema deixa de ser automático**: só existe quando alguém escolhe PIX no fechamento, e pelo valor da parcela PIX — nunca pelo valor cheio por padrão.
- **A receita passa a ter uma fonte única** (o ledger de recebimentos), separada do que é “a receber” no gateway. O dono vê recebido por forma e gorjeta em linha própria.
- **Recepção e profissional fecham o atendimento** no seu escopo (operacional / próprio atendimento) sem ganhar leitura de histórico, relatórios ou totais financeiros.
- **Pagamento parcial existe como estado explícito**, com confirmação e sem virar desconto silencioso.
- **Comissão não muda no v1**: continua apurada pelo preço do serviço no ato da conclusão; forma de pagamento e gorjeta não a alteram.

O objetivo é de **produto**: o fechamento reflete o que aconteceu no balcão, e o dono enxerga a receita real. Não é “criar uma tabela” nem “trocar uma tela”.

> ❓ Validação: o objetivo descreve mudança no mundo e não é uma solução técnica? (sim/não)

## 3. Contexto e evidências

Fatos verificados no disco (não assumidos), em 2026-11-06:

| Artefato | Fato relevante |
|---|---|
| `supabase/migrations/20250306100000_asaas_charges.sql` | `charges` PIX-only, `unique (appointment_id)`, RLS SELECT só admin; `webhook_events` com dedupe `(event_id, payment_id)` |
| `src/app/agenda/StatusChangeConfirm.tsx` | PIX automático ao concluir; valor cheio; falha apenas avisa; QR exibido em diálogo próprio |
| `supabase/functions/create-charge/handler.ts` | `amount_cents = price_cents`; idempotência por “existe charge do atendimento”; papéis admin/recepção/profissional (profissional só o próprio) |
| `supabase/functions/asaas-webhook/handler.ts` | Baixa por `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`; expira por `PAYMENT_OVERDUE`; dedupe por `webhook_events`; token por tenant com fallback global |
| `supabase/migrations/20250226092000_commission_on_conclude.sql` | Comissão `round(price_cents * pct)` no `concluido`; idempotente por `(tenant_id, appointment_id)` |
| `src/hooks/usePermissions.ts` | Capacidades por papel; `canViewCommission` = admin ou profissional; recepção nunca lê comissão |
| `src/lib/segment-features.ts` + `src/hooks/useSegmentFeatures.ts` | Gating de UI por `tenants.segment`, exclusivo por ramo; nunca fronteira de segurança |
| `src/app/cobrancas/CobrancasPage.tsx` + `src/hooks/useCharges.ts` | Lista de cobranças PIX com status e QR/copia-e-cola |
| `src/app/agenda/AppointmentDetail*` / agenda | Ações de transição de status; “Concluir” passa pelo diálogo de confirmação |
| `.agents/rules/dominio.md` | Regra vigente ainda afirma “ao entrar em concluído: gera cobrança PIX” — precisa ser corrigida na mesma entrega (risco documental) |
| `.agents/rules/produto.md` | Regra do segmento, papéis, planos e convenções de dinheiro (centavos) e fuso |
| `.agents/rules/seguranca-multitenant.md` | RLS obrigatória; `tenant_id` do JWT; webhook idempotente e autenticado; logs sem PII |

Rotas/telas afetadas: agenda (ação “Concluir”), detalhe do atendimento, cobranças (nova aba de recebimentos), painel financeiro do admin. Edge Functions afetadas: `create-charge` e `asaas-webhook` (alteração) e novas funções de registro, settlement, cancelamento, baixa manual e estorno (§12).

> ❓ Validação: as evidências citadas existem no repositório e não são suposição? (sim/não)

## 4. Público e impacto

| Público | Impacto |
|---|---|
| **Admin (dono)** | Passa a ver recebido por forma, gorjeta separada, “a receber” e saldo em aberto; decide sobre estorno, baixa manual e cancelamento de PIX. Ganha previsibilidade de caixa e para de emitir PIX indevido. |
| **Recepção** | Fecha o atendimento com qualquer forma, divide o pagamento, registra gorjeta e troco. **Não** ganha histórico, relatórios, totais nem leitura financeira ampla. |
| **Profissional** | Registra o pagamento do próprio atendimento no fechamento. **Não** lê histórico financeiro nem recebimentos de colegas. |
| **Cliente final (indireto)** | Deixa de receber PIX que não pediu; vê o valor e a gorjeta com clareza; o comprovante reflete o que pagou. |
| **Super admin** | **Fora deste escopo.** Nenhuma tela, permissão ou leitura cross-tenant nova para plataforma. |

Impacto de negócio esperado: menos atrito no balcão (fechar sem gateway), receita registrada de verdade, menos cobrança PIX indevida e melhor leitura de mix de recebimento pelo dono.

> ❓ Validação: cada papel tem impacto declarado e o super admin está explicitamente fora? (sim/não)

## 5. Métricas de sucesso

Linha de base: **não medida hoje** (o fluxo não tem telemetria). Medir na semana anterior ao rollout e comparar após 30 dias.

| Métrica | Como medir | Meta |
|---|---|---|
| Atendimentos concluídos com desfecho de pagamento registrado (formas ou “sem pagamento” explícito) | atendimentos concluídos com ao menos 1 linha de recebimento **ou** marcação explícita de sem pagamento ÷ atendimentos concluídos no período | ≥ 95% em 30 dias |
| PIX do sistema indevido | charges PIX criadas sem linha `pix_sistema` correspondente ÷ charges PIX criadas no período | ≤ 10% (queda forte vs baseline) |
| PIX órfão (pendente que nunca vira recebimento) | charges pendentes expiradas/canceladas sem recebimento ÷ charges criadas, antes × depois | redução ≥ 80% |
| Tempo de fechamento | duração entre abrir “Fechar atendimento” e confirmar (telemetria de UI), mediana por operador | ≤ 30 s |
| Divergência receita × ledger | reconciliação entre receita exibida no painel e soma de recebimentos não estornados | 0 divergências |
| Registros financeiros órfãos | linhas de recebimento sem atendimento/tenant válidos | 0 |
| Vazamento de leitura financeira para recepção/profissional | testes de RLS/Edge + auditoria de acesso a histórico | 0 incidentes |

> ❓ Validação: todas as métricas têm “como medir” e meta, e a linha de base é honesta? (sim/não)

## 6. Escopo MVP e requisitos não-funcionais

### Escopo (resumo dos RFs — detalhe testável em §9)

- **RF-01** métodos v1 e gating por segmento (salão/barbearia).
- **RF-02** dinheiro com troco.
- **RF-03** cartão de crédito e débito.
- **RF-04** PIX da maquininha.
- **RF-05** PIX do sistema por escolha, pela parcela PIX.
- **RF-06** nenhum PIX automático ao concluir.
- **RF-07** pagamento dividido (múltiplas formas).
- **RF-08** pagamento parcial com confirmação explícita.
- **RF-09** pagar a mais só via gorjeta.
- **RF-10** gorjeta explícita, fora de receita de serviço e de comissão.
- **RF-11** concluir sem pagamento.
- **RF-12** registrar pagamento depois.
- **RF-13** estorno/correção com imutabilidade.
- **RF-14** idempotência do fechamento.
- **RF-15** limite `pago + reservado + novo ≤ total`.
- **RF-16** no máximo uma cobrança PIX pendente.
- **RF-17** webhook idempotente e tardio.
- **RF-18** baixa manual de PIX pelo admin.
- **RF-19** cancelamento de cobrança PIX pendente.
- **RF-20** recepção registra sem ler faturamento.
- **RF-21** profissional só no próprio atendimento.
- **RF-22** valor zero.
- **RF-23** tenant sem Asaas.
- **RF-24** comissão inalterada.
- **RF-25** receita × a receber separados.
- **RF-26** comprovante e reexibição de QR.
- **RF-27** falha de gateway no fechamento com retry/“concluir sem pagamento”.
- **RF-28** backfill único dos charges pagos.
- **RF-29** isolamento multi-tenant.

### Requisitos não-funcionais

- **RNF-01 — Performance**: o fechamento é interativo, sem recarregar a página; abertura do diálogo e registro não introduzem espera perceptível além do gateway quando PIX do sistema é escolhido.
- **RNF-02 — Responsivo/mobile-first**: diálogo e comprovante utilizáveis em 375 px e 1280 px.
- **RNF-03 — i18n**: todo texto visível via `react-i18next`, pt-BR padrão; nenhum literal solto em componente.
- **RNF-04 — Acessibilidade**: WCAG 2.1 AA — labels, foco visível, navegação por teclado, contraste, `role=alert` em erro.
- **RNF-05 — Dinheiro**: valores sempre em centavos inteiros; nenhum cálculo monetário em ponto flutuante.
- **RNF-06 — Tempo**: timestamps em UTC (`timestamptz`), exibição no fuso do tenant.
- **RNF-07 — Idempotência**: fechamento e webhook são idempotentes por chave/evento; replay não duplica receita.
- **RNF-08 — Privacidade**: logs e metadados de auditoria sem nome, telefone, documento, QR, copia-e-cola ou payload cru.
- **RNF-09 — RLS**: nova tabela de recebimentos com RLS e `tenant_id` obrigatório; escrita só por caminho privilegiado.
- **RNF-10 — Auditabilidade**: registro, estorno, baixa manual, cancelamento e conclusão sem pagamento geram trilha de auditoria.
- **RNF-11 — Compatibilidade de deploy**: durante a janela de transição, chamada antiga de criação de cobrança sem valor explícito usa o saldo restante; o fallback é removido na fase final de rollout.
- **RNF-12 — Não regressão**: agenda, cobranças, dashboard, comissão e fluxos de WhatsApp permanecem verdes.

> ❓ Validação: o escopo está fechado e os RNFs são verificáveis no aceite? (sim/não)

## 7. NÃO entra

Fora do v1, explicitamente:

- Integração com maquininha/adquirente (TEF/POS), taxa de máquina, valor líquido e conciliação automática.
- Parcelamento, antecipação e recebimento de cartão via gateway.
- Múltiplos PIX do sistema por atendimento.
- Estorno financeiro real no gateway (estorno do v1 é lógico, no ledger).
- Desconto no fechamento.
- Comissão sobre valor recebido (comissão segue pelo preço do serviço).
- Gorjeta na base de comissão.
- Caixa/turno/sangria e fechamento de caixa.
- Convênio/plano de saúde e segmento clínica.
- Nota fiscal, envio de comprovante por WhatsApp, link de pagamento.
- Relatórios financeiros além do painel/aba de recebimentos previstos.
- Qualquer leitura cross-tenant ou tela de super admin neste fluxo.

> ❓ Validação: o não-escopo está declarado e impede interpretação elástica do MVP? (sim/não)

## 8. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Receita dupla (ledger + charges pagas somados) | Números inflados e decisão errada | Fonte única de receita no ledger; “a receber” vem só de cobranças pendentes; painel nunca soma os dois |
| PIX ainda gerado por hábito do operador | Métrica de PIX indevido não cai | PIX só por escolha explícita no fechamento; remover o disparo automático; acompanhar a métrica §5 |
| Webhook tardio após baixa manual | Receita duplicada | Baixa manual cria recebimento vinculado à cobrança; webhook posterior é no-op |
| Webhook tardio após cancelamento | Receita fantasma | Não cria receita; registra anomalia para conciliação |
| Corrida entre duas recepções | Estouro de valor / lote duplicado | Trava no atendimento + chave de idempotência por lote |
| Parcial tratado como desconto | Caixa inconsistente e comissão confusa | Estado `parcial` explícito, confirmação e saldo restrito ao admin |
| Recepção enxerga financeiro por engano | Violação de RBAC/LGPD | Leitura de histórico negada na tabela; leitura só do settlement do atendimento via caminho privilegiado e escopado |
| Comissão maior que o recebido | Expectativa errada do dono | Limitação declarada (competência × caixa); decisão de v2 |
| Backfill duplicado ou parcial | Receita histórica errada | Backfill idempotente e contagem conferida antes/depois |
| Regra de domínio desatualizada (“gera PIX ao concluir”) | Retrabalho e decisões erradas | Atualizar as regras de domínio na mesma entrega |
| Janela de deploy com front antigo | Chamada antiga sem valor quebra o fechamento | Fallback de saldo restante até a fase final (RNF-11) |

> ❓ Validação: cada risco tem mitigação verificável e nenhum foi maquiado? (sim/não)

## 9. Requisitos funcionais verificáveis

Formato: **entrada → saída observável**. Todos verificáveis por teste de integração, RLS ou UI.

- **RF-01 — Métodos e gating.** Entrada: tenant `salao` ou `barbearia`, atendimento em `em_atendimento`, operador aciona “Concluir”. Saída: diálogo “Fechar atendimento” oferece exatamente dinheiro, cartão de crédito, cartão de débito, PIX do sistema, PIX da maquininha e “Registrar depois”. Entrada: tenant `clinica` (ou segmento nulo). Saída: etapa de pagamento não é exibida.
- **RF-02 — Dinheiro com troco.** Entrada: total 10000 centavos, linha dinheiro 10000, valor recebido 12000. Saída: recebimento de 10000; comprovante exibe troco de 2000; receita considera 10000, nunca 12000. Entrada: valor recebido menor que a linha. Saída: rejeição com mensagem em pt-BR.
- **RF-03 — Cartões.** Entrada: linha `cartao_credito` ou `cartao_debito` com valor > 0. Saída: recebimento persistido com o método escolhido e sem campo de troco. Entrada: cartão com valor maior que o saldo. Saída: rejeitado; excedente só é aceito como gorjeta.
- **RF-04 — PIX da maquininha.** Entrada: linha `pix_maquininha` declarada pelo operador. Saída: recebimento persistido, sem QR, sem chamada a gateway e sem comprovante PIX do sistema; a origem fica distinguível de `pix_sistema`.
- **RF-05 — PIX do sistema por escolha.** Entrada: linha `pix_sistema` com valor igual à parcela PIX (não necessariamente o total). Saída: cobrança criada **por esse valor**, QR/copia-e-cola exibidos, status “aguardando”; recebimento **não** é criado até a confirmação do gateway. Entrada: nenhuma escolha de PIX. Saída: nenhuma cobrança criada.
- **RF-06 — Sem PIX automático.** Entrada: atendimento em `em_atendimento` concluído com dinheiro ou cartão. Saída: zero cobranças criadas; nenhuma chamada ao gateway. Entrada: conclusão sem interação com o diálogo (fluxo legado). Saída: nenhuma cobrança automática criada após o rollout completo.
- **RF-07 — Pagamento dividido.** Entrada: total 10000, linhas dinheiro 6000 + débito 4000. Saída: duas linhas de recebimento; soma 10000; settlement lista as duas formas; estado `quitado`. Entrada: linhas cuja soma excede 10000 sem gorjeta. Saída: rejeitado.
- **RF-08 — Pagamento parcial.** Entrada: total 10000, linha 4000, operador confirma explicitamente. Saída: estado `parcial`, recebimento de 4000, saldo 6000 visível só ao admin. Entrada: operador não confirma. Saída: nada persistido, diálogo permanece. Entrada: soma atinge 10000 em lançamento posterior. Saída: estado passa a `quitado`.
- **RF-09 — Pagar a mais.** Entrada: total 10000, serviço 10000 + gorjeta 500. Saída: aceito; receita de serviço 10000, gorjeta 500. Entrada: serviço 11000 sem gorjeta, total 10000. Saída: rejeitado com erro de excedente.
- **RF-10 — Gorjeta explícita.** Entrada: linha com `tip_cents > 0`. Saída: gorjeta armazenada separada do valor do serviço, somada em linha própria no comprovante e no painel, **excluída** da receita de serviço e da comissão. Entrada: linha sem gorjeta. Saída: gorjeta 0, sem efeito em comissão.
- **RF-11 — Concluir sem pagamento.** Entrada: operador escolhe “Registrar depois” e confirma. Saída: atendimento `concluido`, estado `sem_pagamento`, badge “Pagamento pendente” no detalhe; nenhuma cobrança PIX criada; comissão apurada normalmente pelo preço.
- **RF-12 — Registrar depois.** Entrada: atendimento `concluido` com `sem_pagamento`, admin ou operador autorizado registra 5000. Saída: recebimento com data/hora do **lançamento** (não da conclusão), estado `parcial` ou `quitado` conforme o valor; trilha de auditoria com o ator.
- **RF-13 — Estorno e imutabilidade.** Entrada: admin estorna um recebimento com motivo. Saída: linha permanece no histórico marcada como estornada, sai de todas as somas de receita, saldo do atendimento volta a subir; novo lançamento é permitido. Entrada: tentativa de editar ou apagar linha existente. Saída: negada.
- **RF-14 — Idempotência do fechamento.** Entrada: mesmo lote de fechamento submetido duas vezes com a mesma chave. Saída: mesmas linhas retornadas, sem duplicar receita, com indicação de replay. Entrada: dois lotes distintos disputando o mesmo saldo. Saída: no máximo um deles é aceito; o outro recebe erro de excedente.
- **RF-15 — Limite de valor.** Entrada: total 10000, recebido 7000, cobrança pendente 2000, novo lançamento 2000. Saída: rejeitado (7000 + 2000 + 2000 > 10000). Entrada: novo lançamento 1000. Saída: aceito; recebido 8000 e reservado 2000.
- **RF-16 — Uma cobrança PIX pendente.** Entrada: atendimento já tem cobrança PIX pendente e o operador escolhe PIX do sistema novamente. Saída: a cobrança existente é reapresentada (QR/copia-e-cola), sem criar segunda; estado permanece `aguardando_pix`.
- **RF-17 — Webhook idempotente e tardio.** Entrada: evento de pagamento duplicado. Saída: um único recebimento e nenhuma receita extra. Entrada: evento de pagamento após baixa manual. Saída: no-op. Entrada: evento de pagamento de cobrança cancelada. Saída: nenhum recebimento criado e anomalia registrada para conciliação.
- **RF-18 — Baixa manual de PIX (admin).** Entrada: admin marca cobrança pendente como paga manualmente. Saída: recebimento criado com origem manual vinculada à cobrança, cobrança marcada como paga, auditoria registrada; webhook posterior é no-op. Entrada: recepção ou profissional tenta a baixa. Saída: negado.
- **RF-19 — Cancelar cobrança.** Entrada: admin cancela cobrança pendente. Saída: cancelamento no gateway antes do local quando aplicável; falha do gateway impede o cancelamento local e retorna erro em pt-BR. Entrada: recepção cancela. Saída: permitido com auditoria. Entrada: profissional cancela. Saída: negado.
- **RF-20 — Recepção sem faturamento.** Entrada: recepção autenticada consulta recebimentos/histórico/período/relatórios diretamente. Saída: zero linhas ou negação; nenhum total, KPI ou histórico acessível. Entrada: recepção abre o settlement de um atendimento específico. Saída: vê total, linhas e pendência daquele atendimento, apenas no ato do fechamento.
- **RF-21 — Profissional só próprio.** Entrada: profissional registra pagamento do atendimento em que é o profissional responsável. Saída: aceito. Entrada: profissional tenta registrar ou ler settlement de atendimento de outro profissional. Saída: negado (403/sem linhas), inclusive por leitura direta da base.
- **RF-22 — Valor zero.** Entrada: atendimento com total 0. Saída: nenhuma linha de recebimento aceita (valores devem ser > 0); conclusão sem pagamento permitida, settlement mostra total 0 e pago 0. Entrada: tentativa de registrar valor > 0 em atendimento total 0. Saída: rejeitada por excedente.
- **RF-23 — Tenant sem Asaas.** Entrada: tenant sem configuração ativa do Asaas escolhe PIX do sistema. Saída: opção indisponível ou erro em pt-BR explicando que o PIX do sistema não está configurado; demais formas continuam funcionando. Entrada: escolhe dinheiro/cartão. Saída: fechamento normal.
- **RF-24 — Comissão inalterada.** Entrada: atendimento total 10000 concluído com dinheiro 10000 + gorjeta 500. Saída: comissão calculada sobre 10000, idêntica ao comportamento anterior; gorjeta e forma não alteram o valor. Entrada: conclusão sem pagamento. Saída: comissão igualmente apurada sobre 10000.
- **RF-25 — Receita × a receber.** Entrada: painel financeiro do admin com 1 atendimento quitado em dinheiro e 1 cobrança PIX pendente. Saída: recebido = valor do dinheiro; a receber = valor da cobrança pendente; “nunca” receita = cobrança paga. Entrada: cobrança paga e com recebimento no ledger. Saída: contada uma única vez, pelo ledger.
- **RF-26 — Comprovante e reexibição.** Entrada: fechamento confirmado. Saída: comprovante com total, linhas por forma, troco, gorjeta e status. Entrada: admin reabre o atendimento e pede “Reexibir QR” de cobrança pendente. Saída: QR exibido. Entrada: recepção tenta reexibir fora do ato do fechamento, com cobrança ainda pendente e não expirada. Saída: QR/copia-e-cola reexibidos (decisão de 2026-11-06); cobrança expirada/cancelada não é reexibida.
- **RF-27 — Falha de gateway no fechamento.** Entrada: PIX do sistema escolhido e gateway falha. Saída: diálogo permanece aberto com erro em pt-BR e opções “Tentar de novo” e “Concluir sem pagamento”; nenhuma receita é registrada para a parcela PIX; escolher “Concluir sem pagamento” conclui com estado `sem_pagamento`.
- **RF-28 — Backfill único.** Entrada: base com cobranças pagas ligadas a atendimentos. Saída: cada uma vira exatamente um recebimento histórico, origem gateway, sem recalcular comissão; reexecução não duplica; cobranças pagas sem atendimento não entram e são contabilizadas para relatório.
- **RF-29 — Isolamento multi-tenant.** Entrada: usuário do tenant A tenta ler/registrar pagamento de atendimento do tenant B. Saída: zero linhas/negação, por tabela e por caminho privilegiado; nenhuma operação cross-tenant é possível com `tenant_id` enviado pelo cliente.

> ❓ Validação: cada RF tem entrada, saída observável e é testável sem interpretar intenção? (sim/não)

## 10. Histórias de usuário

- Dado um atendimento em `em_atendimento` num tenant de salão, Quando a recepção clica em “Concluir”, Então vê o diálogo “Fechar atendimento” com total, cliente, serviço e profissional.
- Dado total de 10000 centavos, Quando a recepção registra dinheiro com 12000 recebidos, Então o sistema persiste 10000 de serviço e mostra troco de 2000 no comprovante.
- Dado total de 10000 centavos, Quando a recepção registra cartão de crédito de 10000, Então o recebimento fica com método crédito e nenhum campo de troco é exibido.
- Dado total de 10000 centavos, Quando a recepção registra cartão de débito de 10000, Então o recebimento fica com método débito e a receita do atendimento fica quitada.
- Dado que o cliente pagou na maquininha via PIX, Quando a recepção registra “PIX da maquininha”, Então o recebimento é gravado sem gerar QR nem cobrança do sistema.
- Dado total de 10000 centavos e pagamento dividido em 6000 dinheiro + 4000 débito, Quando a recepção confirma, Então as duas linhas aparecem no settlement e o atendimento fica quitado.
- Dado um atendimento de 10000 centavos, Quando a recepção escolhe PIX do sistema para uma parcela de 3000, Então a cobrança é criada por 3000 e o QR aparece no próprio diálogo.
- Dado um atendimento concluído com dinheiro, Quando a conclusão termina, Então nenhuma cobrança PIX foi criada e o gateway não foi chamado.
- Dado total de 10000 centavos, Quando o operador registra 4000 e confirma o aviso de pagamento parcial, Então o atendimento fica `parcial` e o saldo de 6000 só é visível ao admin.
- Dado total de 10000 centavos, Quando o operador tenta registrar 11000 sem gorjeta, Então o sistema rejeita o excedente e explica que o valor adicional só pode ser gorjeta.
- Dado total de 10000 centavos, Quando o operador registra 10000 de serviço e 500 de gorjeta, Então receita de serviço é 10000, gorjeta é 500 e a comissão não muda.
- Dado que o cliente vai pagar depois, Quando o operador escolhe “Registrar depois” e confirma, Então o atendimento conclui com “Pagamento pendente” e nenhuma cobrança é criada.
- Dado um atendimento concluído sem pagamento, Quando o admin registra 5000 dois dias depois, Então o recebimento usa a data do lançamento e o estado vira `parcial`.
- Dado um recebimento lançado por engano, Quando o admin estorna com motivo, Então a linha sai da receita, permanece no histórico como estornada e o saldo do atendimento volta a subir.
- Dado um recebimento já quitado por PIX do sistema, Quando o Asaas envia o mesmo evento de pagamento duas vezes, Então existe um único recebimento e nenhuma receita duplicada.
- Dado um PIX cancelado no sistema, Quando chega um evento de pagamento tardio do gateway, Então nenhuma receita é criada e a anomalia fica registrada para conciliação.
- Dado um usuário de recepção autenticado, Quando tenta abrir histórico, relatório ou total de recebimentos, Então o acesso é negado e nenhum valor financeiro agregado é exibido.
- Dado um usuário de recepção no fechamento de um atendimento específico, Quando consulta o settlement daquele atendimento, Então vê total, linhas e pendência somente daquele atendimento.
- Dado um profissional responsável por um atendimento, Quando registra o pagamento desse atendimento, Então o lançamento é aceito e atribuído a ele.
- Dado um profissional que não é o responsável por um atendimento, Quando tenta registrar ou consultar o pagamento alheio, Então recebe negação e nenhuma linha é exposta.
- Dado um atendimento com total zero, Quando o operador tenta registrar qualquer valor positivo, Então o sistema rejeita; ao concluir sem pagamento, Então total e pago aparecem como zero.
- Dado um tenant sem Asaas configurado, Quando o operador tenta usar PIX do sistema, Então vê mensagem de indisponibilidade e ainda consegue fechar em dinheiro ou cartão.
- Dado que o gateway falha ao criar o PIX da parcela, Quando o operador confirma, Então o diálogo continua aberto com “Tentar de novo” e “Concluir sem pagamento”, sem registrar receita da parcela PIX.
- Dado o painel financeiro do admin, Quando consulta o período, Então recebido vem dos recebimentos não estornados, gorjeta aparece separada e cobranças pendentes aparecem como “a receber”.

## 11. UX / experiência do fechamento

O fechamento é um único diálogo, aberto pela ação “Concluir” na agenda. Não é uma tela nova de navegação nem um formulário longo.

1. **Abertura.** O diálogo “Fechar atendimento” substitui a confirmação genérica de mudança de status. Cabeçalho com cliente, serviço/combo, profissional e total (preço snapshot). O total é operacional: quem fecha precisa saber quanto cobrar.
2. **Escolha de forma.** Chips visíveis: Dinheiro, Crédito, Débito, PIX do sistema, PIX da maquininha e “Registrar depois”. A forma escolhida vira uma linha; “Adicionar forma” cria outra linha para pagamento dividido.
3. **Valor.** A linha nasce com o saldo restante; é editável para permitir parcial e divisão. O diálogo mostra, de forma clara, quanto ainda falta para quitar.
4. **Dinheiro.** Campo “Valor recebido” calcula o troco em tempo real; campo de gorjeta separado, com rótulo explícito de que não é receita do serviço.
5. **Cartões e PIX da maquininha.** O operador declara a forma; a interface pede confirmação na maquininha antes de registrar. Não há captura de dados de cartão, bandeira ou adquirente.
6. **PIX do sistema.** Ao escolher, o diálogo mostra o QR e o copia-e-cola da **parcela PIX**, com status “aguardando”. O recebimento não é dado como pago até o gateway confirmar. O diálogo pode ser fechado deixando a cobrança pendente.
7. **Confirmação.** Ao confirmar, as linhas são registradas e o atendimento transita para concluído. Se o gateway falhar, o diálogo permanece com erro legível e as duas saídas conscientes: tentar de novo ou concluir sem pagamento.
8. **Sucesso.** Comprovante simples: total, linhas por forma, troco (quando dinheiro), gorjeta, status e data/hora. É o registro que o operador mostra ao cliente.
9. **Concluído sem pagamento.** O detalhe do atendimento passa a exibir “Pagamento pendente” e oferece “Registrar pagamento”, que reabre a captura com o saldo atual.
10. **Depois do fechamento.** O detalhe do atendimento vira o settlement: total, pago, pendente, linhas e cobranças pendentes, com ações conforme papel (registrar, cancelar PIX, estornar). Histórico, relatórios e totais continuam sendo superfície do admin.

Regras de experiência transversal: mobile-first, teclado e foco previsíveis, erros em pt-BR no contexto da linha que falhou, nenhuma ação financeira irreversível sem confirmação explícita. Estados de carregamento, vazio e erro são obrigatórios no settlement e na aba de recebimentos.

> ❓ Validação: o fluxo de UX cobre os caminhos de erro e deixa claro o que cada papel vê? (sim/não)

## 12. Dependências

- **Banco**: nova estrutura de recebimentos por atendimento (ledger), vínculo opcional com cobrança do gateway, índices de consulta e unicidade que sustenta idempotência; ajustes em `charges` (unicidade de pendente, chave de idempotência); backfill dos pagamentos históricos. Regras de migration em `.agents/rules/db-migration-supabase.md`.
- **RLS/RBAC**: política de leitura admin-only na nova estrutura; nenhuma política de escrita direta para `authenticated`; grants compatíveis com a leitura recortada.
- **Caminhos privilegiados**: registro de pagamentos por lote, settlement de um atendimento, cancelamento de cobrança, baixa manual, estorno e resumo financeiro; alteração de `create-charge` (valor explícito + idempotência) e do webhook (recebimento idempotente, não rebaixar status, anomalia pós-cancelamento).
- **Frontend**: diálogo de captura, diálogo de settlement, alteração de `StatusChangeConfirm` para não criar cobrança automática, nova aba “Recebimentos” em cobranças, painel financeiro do admin, hooks de pagamento/settlement/cancelamento/estorno/resumo, capacidades em `usePermissions` e flag de segmento.
- **Reuso**: `PixQrDialog` existente, padrões de `CobrancasPage`, TanStack Query, shadcn/ui, `sonner`, i18n.
- **Documentação**: atualizar `.agents/rules/dominio.md` (e espelho `.kiro/steering/dominio.md`) para remover “ao concluir gera cobrança PIX” — dependência da entrega, não deste PRD.
- **Fora deste PRD**: RESEARCH, ADR-INDEX, ADRs, SPEC/PLAN/TASKS e código.

> ❓ Validação: as dependências estão nomeadas sem virar desenho de implementação? (sim/não)

## 13. Segurança

- **Isolamento de tenant**: toda linha de recebimento carrega `tenant_id`; o valor vem do vínculo autenticado (JWT/perfil), nunca de parâmetro confiável do cliente. Atendimento, cobrança, operador e profissional referenciados devem pertencer ao mesmo tenant.
- **RLS**: RLS habilitada na nova estrutura; leitura de histórico/relatórios apenas admin; sem política de INSERT/UPDATE/DELETE para o cliente; escrita exclusivamente por caminho privilegiado. `charges` mantém leitura admin-only.
- **Leitura escopada**: recepção e profissional leem o settlement de **um** atendimento por caminho privilegiado que valida o vínculo (profissional só o próprio; recepção só no ato), sem acesso à tabela para varredura.
- **Idempotência**: fechamento por chave de lote; webhook por evento + cobrança; baixa manual e webhook não somam duas vezes. Replay é resposta de sucesso idempotente, não erro.
- **Autenticidade do webhook**: token por tenant com fallback global, comparação em tempo constante; corpo tratado como não confiável e validado antes de qualquer uso.
- **Privilégio mínimo**: operações privilegiadas só em Edge Function com service role; nenhuma chave de serviço, token de gateway ou segredo no bundle.
- **Auditoria**: registro, estorno, baixa manual, cancelamento e conclusão sem pagamento geram trilha com ator, tenant, atendimento, método e valores.
- **LGPD**: logs e metadados sem nome, telefone, documento, QR, copia-e-cola, payload cru ou token. Valores financeiros por atendimento não são expostos a papéis sem necessidade operacional.
- **Super admin**: sem caminho novo de leitura cross-tenant neste fluxo.

> ❓ Validação: RLS, tenant do JWT, idempotência e operações privilegiadas estão cobertos? (sim/não)

## 14. Perguntas abertas

As decisões D1–D9 estão fechadas e **não** são reabertas aqui. Os pontos abaixo são ambiguidades reais entre o plano, o código atual e as decisões — nenhum foi resolvido silenciosamente.

1. **Ordem transacional “registrar × concluir”.** O fluxo de UX registra as formas e depois conclui; o contrato técnico do plano exige atendimento já `concluido` para registrar. Recomendação: tratar como um único ato atômico (concluir + registrar no mesmo commit), com falha revertendo ambos. Confirmar no ADR.
2. **Saldo restante visível à recepção.** D5 diz “saldo visível só ao admin”, mas o fluxo pré-preenche o valor a capturar com o saldo restante para a recepção. Recomendação: a recepção vê o valor a capturar **dentro do diálogo de fechamento** (operacional), e não vê saldo devedor em histórico, listas ou relatórios. Confirmar a leitura de D5.
3. **Janela de “reexibir QR só no ato” para recepção.** “No ato” não está definido. Recomendação: apenas enquanto o diálogo de fechamento daquele atendimento está aberto; depois, só admin. Confirmar.
4. **Retry do fechamento.** O plano exige chave de idempotência por lote, mas não diz se “Tentar de novo” reutiliza a chave ou gera nova. Recomendação: reutilizar a mesma chave enquanto for a mesma tentativa de fechamento; nova chave só após estorno/correção deliberada. Confirmar.
5. **Persistência do valor recebido em dinheiro (troco).** O plano mostra “Valor recebido → troco”, mas o ledger não guarda o valor entregue. Recomendação: calcular e exibir o troco sem persistir o valor entregue no v1. Confirmar se é suficiente para auditoria.
6. **“Múltiplos PIX do sistema por atendimento” fora de escopo × unicidade de pendente.** A unicidade proposta permite nova cobrança após uma paga; o não-escopo diz múltiplos PIX fora. Recomendação original: no v1, no máximo **uma** cobrança PIX do sistema por atendimento (mesmo após paga). **Decisão revisada em 2026-11-06 (gate humano):** 1 PIX **ativo** por vez; se a cobrança expirou ou foi cancelada, o mesmo atendimento pode reemitir o QR (mesma linha de `charges`, cancelando a anterior no Asaas); após **paga**, nunca reemite.
7. **Desconto no fechamento.** O plano lista como fora e a pendência pede confirmação. Recomendação: manter fora do v1; desconto exige decisão de produto e impacto em comissão. Confirmar.
8. **Badge “Pagamento pendente” na agenda.** O fluxo cita badge no detalhe; o plano sugere “badge depois, se necessário”. Recomendação: badge no detalhe do atendimento no v1; indicador na lista da agenda fica para v2. Confirmar.
9. **Tenant legado sem `segment`.** D7 cobre salão e barbearia; `null`/legado fica de fora. Recomendação: manter desligado por padrão (coerente com `resolveFeatures`) e planejar migração de segmento depois. Confirmar se tenant legado deve ser tratado como salão.
10. **Copy pt-BR final.** Textos de estados (`sem_pagamento`, `parcial`, `aguardando_pix`), do comprovante e das mensagens de erro ainda não estão congelados. Recomendação: congelar no ADR de frontend com `@ux_designer`.
11. **Classificação de total zero.** O plano pede teste de “valor zero”, mas não define o estado. Recomendação: total 0 com conclusão sem pagamento = `quitado` sem linhas; confirmar se o negócio prefere um estado próprio “sem cobrança”.
12. **Estorno após PIX pago no gateway.** O não-escopo exclui estorno financeiro real. Recomendação: no v1 o estorno é apenas lógico no ledger, com aviso ao admin de que o dinheiro não volta pelo sistema; a conciliação com o gateway fica para v2. Confirmar o texto do aviso.

**Decisões do gate humano (2026-11-06):** todas as 12 recomendações acima foram aceitas; nenhuma alteração de escopo. Detalhamento técnico de cada uma fica no ADR correspondente.

> ❓ Validação: as ambiguidades estão registradas com recomendação, sem decisão silenciosa? (sim)

## 15. PICCO

```text
<role>Product Manager sênior do Atlas Agenda (micro-SaaS multi-tenant de agenda + cobrança)</role>

<task>Entregar o PRD da melhoria "formas de pagamento no fechamento do atendimento" para salão e barbearia, com recebimento multi-forma, parcial, gorjeta e PIX do sistema apenas por escolha, substituindo o PIX automático pelo valor cheio.</task>

<context>
Atlas Agenda — React 18 + Vite + TS + shadcn/ui no frontend; Supabase (Postgres + Auth + RLS + Edge Functions Deno) no backend; Asaas para PIX.
Baseline verificado: charges é PIX-only com unique por atendimento; StatusChangeConfirm dispara create-charge automático pelo valor cheio; baixa só por webhook; receita lida de charges pagas; comissão sobre price_cents no concluido; RLS de charges admin-only.
Decisões fechadas D1–D9: 5 métodos sem adquirente; split; recepção registra sem ler histórico; profissional registra o próprio; parcial com confirmação e saldo só admin; gorjeta explícita fora de receita/comissão; gating salão+barbearia; comissão inalterada; PIX do sistema só por escolha.
Arquitetura acordada: ledger de recebimentos por atendimento como fonte única de receita; charges gateway-only; backfill dos pagos; escrita privilegiada; leitura admin-only na tabela e escopada por atendimento para recepção/profissional.
PRD alvo: .spec/prd/cobranca-formas-pagamento/PRD.md (16 seções; §1, §2, §5, §6, §7, §9, §16 obrigatórias).
</context>

<constraints>
1. Não reabrir nem reinterpretar D1–D9.
2. Nesta etapa só PRD; sem RESEARCH, ADR-INDEX, ADR, SPEC, PLAN, TASKS ou código.
3. Produto, não implementação: sem DDL e sem código no PRD.
4. Dinheiro sempre em centavos inteiros; tempo em UTC.
5. RLS multi-tenant obrigatória; tenant_id nunca vem do cliente.
6. Idempotência obrigatória em fechamento e webhook.
7. Comissão permanece por price_cents no concluido; gorjeta fora da base.
8. Não inventar métrica de baseline que o repositório não mede.
9. Não descartar nenhum ponto do plano nem das decisões.
10. §16 permanece pending, com checklist para o humano.
</constraints>

<acceptance>
- PRD.md existe em .spec/prd/cobranca-formas-pagamento/ com as 16 seções e as 7 obrigatórias preenchidas.
- §5 tem tabela com "como medir" e meta por métrica.
- §9 tem RFs numerados, cada um com entrada e saída observável.
- §10 cobre dinheiro/troco, crédito, débito, PIX maquininha, PIX sistema, split, parcial, gorjeta, concluir sem pagamento, registrar depois, estorno, webhook tardio, recepção sem faturamento, profissional próprio, valor zero e tenant sem Asaas.
- §13 cobre RLS, tenant do JWT, idempotência e operações privilegiadas.
- §16 com status pending, data e checklist não marcado.
</acceptance>

<open_questions>Ver §14 do PRD: ordem registrar×concluir; saldo no diálogo vs D5; janela de reexibir QR; retry/idempotency key; persistência do troco; um ou mais PIX do sistema; desconto fora; badge na agenda; tenant legado sem segmento; copy pt-BR; estado de total zero; estorno após PIX pago.</open_questions>
```

> ❓ Validação: o PICCO re-encoda a demanda sem introduzir requisito novo? (sim/não)

## 16. Aprovação humana

> Nenhum `ADRs/**` nasce antes deste bloco estar preenchido pelo humano. Esta seção é o ponto de parada da esteira PRD → ADR.

- **Veredito**: `approved`
- **Data**: 2026-11-06
- **Aprovador**: Product Owner (fundador)
- **Decisão do gate**: aprovado com as 12 recomendações de §14 aceitas, sem alteração de escopo ou RF.
- **Portão**: P0→P1 (PRD aprovado libera RESEARCH e ADRs)

Checklist objetivo para o humano marcar:

- [x] **Problema**: o baseline descrito (§1) corresponde ao que o dono vê no balcão hoje.
- [x] **Escopo**: os 29 RFs (§9) são o MVP correto e nenhum é dispensável.
- [x] **Métricas**: metas e “como medir” (§5) são aceitáveis, com baseline a medir antes do rollout.
- [x] **Não-escopo**: a lista §7 está correta, inclusive desconto, adquirente e estorno real no gateway.
- [x] **RBAC**: recepção registra sem ler faturamento; profissional só o próprio atendimento; admin vê tudo (§4, §13).
- [x] **Riscos**: as mitigações de §8 são suficientes para liberar a fase de ADRs.
- [x] **Ambiguidades**: as 12 perguntas de §14 estão respondidas ou delegadas explicitamente ao ADR.
- [x] **Autorização**: autorizo abrir RESEARCH/ADR-INDEX/ADRs desta melhoria.

> ❓ Validação: o PRD está pronto para o gate humano, sem ADR criado antes da aprovação? (sim/não)

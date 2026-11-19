# PRD — Fase 4 (Retenção e No-show)

> **prd-id**: `retencao-no-show` (roadmap Fase 4)
> **Tipo de rota**: Feature (módulo de retenção)
> **Segmento**: todos os segmentos atendidos (salão/barbearia/clínica), com gating por plano/entitlement
> **Dono da aprovação**: Product Owner (fundador)
> **Status**: `draft` (aguarda gate humano)
> **Insumo**: UX-SPEC.md (vinculante, 8 capacidades A–H) + roadmap v1.4 Fase 4 (G8, G9, G10, G11, G14, G16, T1.3, T2.3)
> **Base**: agenda, PDV, cobranças/ledger, relatórios, WhatsApp, clientes, backoffice, planos, entitlements

## 1. Problema e valor

Hoje o Atlas Agenda retém pouco: não há depósito/sinal para reduzir no-show, não há lista de espera para recuperar slots cancelados, não há campanhas para reativar clientes inativos, não há fidelidade para aumentar frequência, o CRM é raso (sem histórico/notas/preferências consolidadas), os relatórios não medem retenção/no-show/utilização/ticket, o plano é só leitura (sem checkout self-service) e as métricas de WhatsApp não existem. Consequência: perda de receita por no-show, slots ociosos, clientes que não voltam e upgrade de plano dependente de atendimento manual.

Quando esta fase estiver pronta: depósito obrigatório por serviço reduz no-show; waitlist reaproveita cancelamentos; campanhas reativam inativos com consentimento; fidelidade aumenta recorrência; CRM profundo dá visão 360° do cliente; relatórios de retenção orientam decisão; checkout self-service reduz atrito comercial; métricas de WhatsApp permitem operar o canal com segurança.

## 2. Escopo

**Entra (capacidades A–H do UX-SPEC):**
- A. Depósito/sinal (config por serviço, agendamento público com PIX, status "Aguardando depósito", badge, drawer com charge).
- B. Waitlist (lista de espera com prioridade/validade, CTA na agenda, oferta automática com countdown, Confirmar/Recusar).
- C. Campanhas (presets win-back/aniversário/rebooking, segmentação, preview, métricas; reuso de TemplatesMensagemPage).
- D. Fidelidade (config de pontos/regras/expiração, cartão, cupons, gift cards; aba no CRM; aplicação no PDV).
- E. CRM profundo (ficha 360° do cliente com 6 abas, filtros, notas por papel).
- F. Relatórios de retenção (hub estendido + 3 páginas, filtros, export CSV, gráficos + tabela acessível).
- G. Meu plano + checkout self-service (PlanoPage evoluída com estados completos).
- H. Métricas WhatsApp (tabs Conexão/Mensagens/Métricas, KPIs, log filtrável).

**NÃO entra:**
- Motor de entitlements novo (reuso do catálogo de planos/entitlements existente; apenas novas chaves: `deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkoutSelfService`).
- Multi-unidade / multi-filial.
- App mobile nativo.
- Autoagendamento público, taxa de reserva antecipada e painel métricas consolidadas (Fase 3 do produto) — fora, salvo pedido explícito.
- Financeiro completo (NFCe, membership/assinatura de cliente, contas a pagar, conciliação bancária).
- Desconto arbitrário no fechamento (fora, exceto cupom de fidelidade — ver perguntas).
- Integração com adquirente/TEF para cartão (declaração do operador, como no v1).
- Leitura cross-tenant ou novas telas de super admin.
- Alteração do ledger de recebimento (reuso de `appointment_payments`/`charges`).

## 3. Objetivo

Quando pronto, no segmento atendido e conforme plano:
- No-show reduzido via depósito por serviço.
- Slots cancelados reofertados automaticamente pela waitlist.
- Clientes inativos reativados por campanhas consentidas.
- Recorrência aumentada por fidelidade.
- Dono tem visão 360° do cliente e métricas de retenção/no-show/utilização/ticket/coorte.
- Upgrade de plano self-service, sem atendimento manual.
- Canal WhatsApp operado com métricas e risco de ban visível.

## 4. Perfis e impacto

| Perfil | Impacto |
|---|---|
| **Admin (dono)** | Configura depósito/waitlist/campanhas/fidelidade; vê CRM completo (incl. financeiro agregado), relatórios de retenção, métricas WhatsApp, plano/checkout. |
| **Recepção** | Opera waitlist, CRM (notas operacionais, preferências), agenda com depósito; não vê financeiro agregado nem métricas WhatsApp. |
| **Profissional** | Vê própria agenda e clientes próprios (sem financeiro agregado); aplica cupom/gift card no PDV se autorizado. |
| **Cliente final (indireto)** | Depósito com PIX, waitlist, fidelidade, cupons/gift cards. |
| **Super admin** | Fora deste escopo (sem telas/leituras cross-tenant novas). |

## 5. Métricas de sucesso

Linha de base: parte das métricas não é medida hoje (a medir na semana anterior ao rollout); as que já existem (no-show count, última visita) servem de referência.

| Métrica | Como medir | Meta |
|---|---|---|
| Taxa de no-show | atendimentos `nao_compareceu` ÷ agendamentos concluídos/confirmados no período | redução ≥ 30% em 60 dias nos serviços com depósito |
| Conversão de waitlist | ofertas aceitas ÷ ofertas enviadas | ≥ 40% |
| Tempo de reoferta | minutos entre liberação do slot e confirmação da waitlist | ≤ 15 min (mediana) |
| Reativação por campanha | agendamentos gerados por campanha ÷ envios entregues | ≥ 5% |
| Retenção 90 dias | clientes com ≥ 2 visitas em 90 dias ÷ clientes ativos | aumento ≥ 10 p.p. |
| Resgate de fidelidade | cupons/gift cards resgatados ÷ emitidos | ≥ 25% em 90 dias |
| Conversão de checkout | upgrades concluídos ÷ checkouts iniciados | ≥ 60% |
| Entrega WhatsApp | entregues ÷ enviadas | ≥ 95% |
| Leitura WhatsApp | lidas ÷ entregues | baseline a medir |
| Incidentes de vazamento financeiro | acessos indevidos a histórico/relatórios por recepção/profissional | 0 |

## 6. Requisitos funcionais verificáveis (RF-01..)

Formato: **entrada → saída observável**. Testáveis por integração, RLS ou UI.

### 6.1 Depósito/sinal (A)
- **RF-01 — Configuração por serviço.** Entrada: admin edita serviço com entitlement `deposito`. Saída: toggle de depósito, tipo (% ou fixo), valor, prazo em horas e política de reembolso (total/parcial/nenhum) persistidos; sem entitlement, seção invisível.
- **RF-02 — Agendamento público com depósito.** Entrada: cliente agenda serviço com depósito ativo. Saída: passo "Depósito" exibe valor e PIX (QR + copia-e-cola), prazo; appointment em status `aguardando_deposito`; charge PIX pendente vinculada; no máximo uma cobrança pendente por atendimento.
- **RF-03 — Confirmação.** Entrada: pagamento confirmado pelo gateway. Saída: appointment sai de `aguardando_deposito` para o status operacional seguinte; charge paga; notificação WhatsApp opcional conforme opt-in.
- **RF-04 — Expiração.** Entrada: prazo expira sem pagamento. Saída: appointment cancelado com motivo "depósito não pago"; slot liberado; charge expirada/cancelada; notificação ao cliente.
- **RF-05 — Reembolso/cancelamento.** Entrada: cancelamento de appointment com depósito pago. Saída: aplicação da política configurada; estorno lógico no ledger quando aplicável; charge cancelada/reembolsada conforme política.
- **RF-06 — Badge e drawer.** Entrada: abrir detalhe do appointment. Saída: badge "Aguardando depósito" quando aplicável; drawer exibe charge e ações (reenviar QR, cancelar) conforme RBAC.

### 6.2 Waitlist (B)
- **RF-07 — Lista de espera.** Entrada: admin/recepção abre `/app/lista-espera`. Saída: entradas por serviço/profissional, ordenadas por prioridade e validade, com filtros.
- **RF-08 — Inclusão.** Entrada: tentativa de agendar slot ocupado. Saída: CTA "Entrar na lista de espera"; entrada persistida (cliente, serviço, profissional, período desejado, prioridade); confirmação.
- **RF-09 — Oferta automática.** Entrada: slot liberado (cancelamento/no-show). Saída: oferta ao primeiro da fila com countdown e ações Confirmar/Recusar; Confirmar cria agendamento; Recusar/expirar passa ao próximo; notificação WhatsApp respeitando opt-in.
- **RF-10 — Gestão manual.** Entrada: admin/recepção reordena prioridade, remove ou marca entrada como atendida/expirada. Saída: estado atualizado com auditoria.
- **RF-11 — Gating.** Entrada: tenant sem entitlement `waitlist`. Saída: rota/CTA indisponíveis e upsell; nenhuma escrita de waitlist.

### 6.3 Campanhas (C)
- **RF-12 — Templates.** Entrada: admin gerencia templates em biblioteca reutilizada. Saída: templates salvos por tenant com variáveis.
- **RF-13 — Criação de campanha.** Entrada: admin cria campanha com preset (win-back, aniversário, rebooking), segmentação (tags, última visita, no-show, serviço), agendamento de envio e preview. Saída: campanha em rascunho/agendada.
- **RF-14 — Execução e métricas.** Entrada: campanha agendada. Saída: disparo via WhatsApp (Evolution) com templates aprovados fora da janela de 24h; métricas de envio/entrega/resposta/conversão.
- **RF-15 — Consentimento.** Entrada: campanha inclui cliente sem `whatsapp_opt_in`. Saída: cliente excluído do envio; contado em "excluídos por opt-in".
- **RF-16 — Gating.** Entrada: tenant sem entitlement `campanhas`. Saída: rota indisponível e upsell.

### 6.4 Fidelidade (D)
- **RF-17 — Configuração.** Entrada: admin configura programa (ativo, pontos por real, regras por serviço, expiração, níveis). Saída: config persistida por tenant.
- **RF-18 — Cartão do cliente.** Entrada: conclusão de atendimento. Saída: pontos creditados conforme regra; aba Fidelidade no CRM exibe saldo e extrato.
- **RF-19 — Cupons.** Entrada: admin cria cupom (código, tipo %/fixo, validade, limite de uso, segmento). Saída: cupom ativo e aplicável no PDV.
- **RF-20 — Gift cards.** Entrada: admin emite gift card (valor, validade); PDV resgata. Saída: gift card com saldo; resgate abate valor consumido; saldo parcial permitido.
- **RF-21 — PDV.** Entrada: fechamento de atendimento com cupom/gift card. Saída: aplicação registrada no fechamento; gift card como forma de pagamento (saldo consumido); cupom reduzindo total a pagar conforme regra; trilha de auditoria.
- **RF-22 — Expiração e estorno.** Entrada: data de expiração atingida ou cancelamento de atendimento. Saída: pontos/cupons/gift cards expiram conforme config; cancelamento estorna pontos creditados.
- **RF-23 — Gating.** Entrada: tenant sem entitlement `fidelidade`. Saída: rota/fluxos indisponíveis e upsell.

### 6.5 CRM profundo (E)
- **RF-24 — Ficha do cliente.** Entrada: abrir cliente em `/app/clientes`. Saída: drawer com abas Resumo/Histórico/Preferências/Notas/Fidelidade/Mensagens.
- **RF-25 — Resumo.** Entrada: aba Resumo. Saída: no-show count, última visita, ticket médio (admin only), tags, segmento, opt-in e consentimento LGPD com data.
- **RF-26 — Histórico.** Entrada: aba Histórico. Saída: lista paginada de atendimentos (data, serviço, profissional, status); valores financeiros apenas admin.
- **RF-27 — Preferências.** Entrada: admin/recepção edita preferências (profissional preferido, horário, observações). Saída: persistidas e exibidas.
- **RF-28 — Notas.** Entrada: recepção/admin cria nota. Saída: recepção lê/cria notas operacionais; admin lê/cria todas; profissional vê apenas notas do próprio atendimento quando aplicável.
- **RF-29 — Filtros.** Entrada: filtros por tag/segmento/no-show count. Saída: lista filtrada.
- **RF-30 — Opt-in/consentimento.** Entrada: atualização de consentimento. Saída: `whatsapp_opt_in` e consentimento LGPD registrados com data/hora; bloqueio de disparo sem opt-in.

### 6.6 Relatórios de retenção (F)
- **RF-31 — Hub.** Entrada: admin abre RelatoriosHubPage. Saída: cards Rebooking/No-show/Utilização/Ticket médio/Retenção por coorte/WhatsApp com métricas resumo e links.
- **RF-32 — Páginas.** Entrada: admin abre `/app/relatorios/retencao`, `/utilizacao`, `/ticket`. Saída: gráficos (Recharts) + tabela acessível, filtros por período/profissional/serviço, export CSV.
- **RF-33 — Métricas.** Entrada: filtros aplicados. Saída: no-show rate, rebooking rate, utilização de agenda, ticket médio, retenção por coorte calculados via RPC; admin only.
- **RF-34 — Acessibilidade.** Entrada: leitura por leitor de tela. Saída: gráficos com tabela alternativa, headers de tabela, foco gerenciado.

### 6.7 Meu plano + checkout self-service (G)
- **RF-35 — Meu plano.** Entrada: usuário abre PlanoPage. Saída: plano atual, uso vs quota, fatura, histórico, opções de upgrade/downgrade, checkout self-service.
- **RF-36 — Estados.** Entrada: variação de status de assinatura. Saída: UI para loading, bloqueado, cancelado, upgrade confirm, pagamento pendente, sucesso, erro.
- **RF-37 — Checkout.** Entrada: usuário inicia upgrade com entitlement `checkoutSelfService`. Saída: checkout (Asaas) iniciado; webhook atualiza plano/entitlements; status refletido na UI.
- **RF-38 — Gating.** Entrada: tenant sem entitlement `checkoutSelfService`. Saída: checkout indisponível e upsell.

### 6.8 Métricas WhatsApp (H)
- **RF-39 — Tabs.** Entrada: admin abre WhatsAppPage. Saída: tabs Conexão/Mensagens/Métricas.
- **RF-40 — KPIs.** Entrada: período selecionado. Saída: enviadas, entregues, lidas, confirmadas, respostas, falhas, risco de ban; log filtrável.
- **RF-41 — Acesso.** Entrada: recepção/profissional tenta acessar métricas. Saída: acesso negado; apenas admin vê métricas.

## 7. Regras de fronteira

- **RLS multi-tenant**: toda tabela de domínio nova (`waitlist_entries`, `campaigns`, `campaign_sends`, `loyalty_accounts`, `loyalty_transactions`, `coupons`, `gift_cards`, `gift_card_redemptions`, config de depósito se não couber em `services`) tem `tenant_id` + índice + policy. `tenant_id` vem do JWT/perfil, nunca do cliente.
- **RBAC**: admin tudo no tenant; professional apenas própria agenda/clientes próprios e sem financeiro agregado; receptionist operacional sem financeiro agregado; super admin cross-tenant só por caminhos explícitos/auditados.
- **Ledger**: `appointment_payments` continua fonte única de receita; `charges` gateway-only; receita + a receber nunca se somam; estorno é lógico (`voided_at/by/reason`); update de valor e delete proibidos.
- **Dinheiro/tempo**: `*_cents` inteiros; timestamps `timestamptz` UTC; exibição no fuso do tenant.
- **Anti-sobreposição**: appointments e recursos (salas/equipamentos) não podem sobrepor `[starts_at, ends_at)` para o mesmo recurso/profissional.
- **Status de assinatura**: `bloqueado` redireciona para quitação e bloqueia escrita operacional; `cancelado` arquiva e suspende disparos.
- **LGPD/opt-in**: disparo de WhatsApp (campanha, waitlist, lembrete) exige `whatsapp_opt_in=true`; consentimento registrado com data; minimizar PII em logs.
- **Janela de 24h**: disparos fora da janela de conversa do WhatsApp Business usam apenas templates aprovados; dentro da janela, mensagens livres permitidas.
- **Depósito**: no máximo uma cobrança PIX pendente por atendimento; expiração cancela e libera slot.
- **Idempotência**: webhooks, campanhas e fechamentos idempotentes por chave/evento; replay não duplica efeito.
- **Segredos**: service role/Asaas/Evolution apenas em Edge Functions; nunca no bundle.

## 8. Enquadramento no roadmap

Fase 1 (agenda/PDV/cobranças/WhatsApp/clientes/backoffice/planos/entitlements) → Fase 3 (estoque/varejo/comissão/split-timing/recursos) → **Fase 4 (retenção/no-show: este PRD)**. Backend novo mínimo: tabelas `waitlist_entries`, `campaigns`, `campaign_sends`, `loyalty_accounts`, `loyalty_transactions`, `coupons`, `gift_cards`, `gift_card_redemptions` (+ config de depósito em `services` se aplicável) e RPCs de agregação/fila. Entitlements reutilizados do catálogo de planos, com novas chaves `deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkoutSelfService` (sem motor novo). Integra com T1.3 (checkout self-service) e T2.3 (métricas WhatsApp).

## 9. Aceite QA (DevTools)

- Breakpoints 375/768/1024/1440 sem scroll horizontal; touch targets ≥ 44px.
- Console zero erros/warnings; Network sem rotas duplicadas e sem 4xx/5xx em fluxo feliz.
- RBAC por papel validado (admin/recepção/profissional) em UI e RLS (testes de integração).
- Gating por entitlement: sem entitlement mostra upsell e não dispara request sensível.
- Dark mode contraste AA; reduced motion respeitado; foco visível; aria-labels; tabelas com headers; formulários com labels.
- Estados loading/empty/error em listas e drawers.
- RLS: zero linhas cross-tenant; leitura financeira negada a recepção/profissional.
- Idempotência de webhook/campanha/waitlist validada.
- Screenshots em `.spec/roadmap-fase4/retencao-no-show/harness/`.

## 10. Perguntas em aberto

1. **Cupom vs desconto**: cupom de fidelidade reduz total a pagar antes ou depois do registro no ledger? Como registrar o efeito (linha de desconto vs ajuste de total)?
2. **Gift card como forma**: gift card é forma de pagamento (`gift_card`) no ledger ou abatimento de total? Impacto em receita/a receber.
3. **Pontos por cancelamento/no-show**: pontos creditados no agendamento ou na conclusão? Estorno em cancelamento parcial?
4. **Waitlist pública**: cliente final pode entrar na waitlist pelo agendamento público ou apenas admin/recepção?
5. **Oferta automática**: countdown padrão (minutos) e quantas tentativas antes de expirar a entrada?
6. **Campanhas**: limites de frequência por cliente (anti-spam) e horário de envio (janela comercial)?
7. **Depósito reembolsável**: reembolso total/parcial por cancelamento do cliente vs do salão; texto do aviso.
8. **CRM financeiro**: ticket médio visível a recepção (agregado anonimizado) ou só admin?
9. **Checkout**: upgrade imediato ou no fim do ciclo de cobrança; downgrade com efeito quando?
10. **Métricas WhatsApp ban risk**: definição e limiar de alerta (bloqueio preventivo?).
11. **Relatórios coorte**: definição de coorte (mês da primeira visita) e janela de retenção (30/60/90).
12. **Entitlements por plano**: quais planos (Individual/Clínica/Pro) liberam `deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkoutSelfService`?

## 11. PICCO

```text
<role>Product Manager sênior do Atlas Agenda (micro-SaaS multi-tenant de agenda + cobrança)</role>

<task>Entregar o PRD da Fase 4 (Retenção e No-show) com 8 capacidades A–H, reuso de base existente e gating por plano/entitlement.</task>

<context>
Atlas Agenda — React 18 + Vite + TS + shadcn/ui; Supabase (Postgres + Auth + RLS + Edge Functions); Asaas (PIX) e Evolution (WhatsApp).
Base: agenda, PDV, cobranças/ledger, relatórios, WhatsApp, clientes, backoffice, planos, entitlements.
UX-SPEC vinculante: 8 capacidades A–H (depósito, waitlist, campanhas, fidelidade, CRM profundo, relatórios retenção, plano/checkout, métricas WhatsApp).
Roadmap v1.4 Fase 4: G8, G9, G10, G11, G14, G16, T1.3, T2.3.
</context>

<constraints>
1. Não criar motor de entitlements novo; apenas novas chaves consumidas do catálogo de planos.
2. Sem multi-unidade, app, autoagendamento/taxa/métricas consolidadas Fase 3, financeiro completo.
3. Dinheiro em centavos inteiros; tempo em UTC.
4. RLS multi-tenant obrigatória; tenant_id nunca do cliente.
5. Idempotência em webhooks/campanhas/waitlist.
6. LGPD: opt-in antes de disparo.
7. Backend mínimo: tabelas waitlist/campanhas/fidelidade + RPCs.
8. Sem código no PRD.
</constraints>

<acceptance>
- PRD com seções Problema/valor, Escopo, RFs testáveis, Fronteiras, Perfis, Enquadramento, Aceite QA, Perguntas.
- RFs numerados com entrada/saída observável.
- Fronteiras cobrem RLS, RBAC, ledger, *_cents, UTC, anti-sobreposição, blocked/cancelled, opt-in, janela 24h.
</acceptance>

<open_questions>Ver seção 10: cupom/gift card no ledger, pontos por cancelamento, waitlist pública, countdown, limites de campanha, reembolso depósito, CRM financeiro, checkout timing, ban risk, coorte, entitlements por plano.</open_questions>
```

## 12. Aprovação humana

> Nenhum `ADRs/**` nasce antes deste bloco estar preenchido pelo humano.

- **Veredito**: `pending`
- **Data**: (a preencher)
- **Aprovador**: Product Owner (fundador)
- **Portão**: P0→P1 (PRD aprovado libera RESEARCH e ADRs)

Checklist para o humano marcar:
- [ ] Problema e valor correspondem ao que o dono vê hoje.
- [ ] Escopo (capacidades A–H) é o MVP correto e nenhum é dispensável.
- [ ] Métricas e "como medir" são aceitáveis, com baseline a medir antes do rollout.
- [ ] Não-escopo está correto (sem motor entitlements novo, multi-unidade, app, financeiro completo).
- [ ] RBAC e gating por entitlement estão corretos.
- [ ] Fronteiras (RLS, ledger, *_cents, UTC, anti-sobreposição, blocked/cancelled, opt-in, janela 24h) estão suficientes.
- [ ] Perguntas em aberto estão respondidas ou delegadas ao ADR.
- [ ] Autorizo abrir RESEARCH/ADR-INDEX/ADRs desta fase.

> ❓ Validação: o PRD está pronto para o gate humano, sem ADR criado antes da aprovação? (sim/não)

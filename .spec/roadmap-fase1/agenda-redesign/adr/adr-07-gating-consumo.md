# ADR-07 — Gating T1.1 leitura + consumo T2

- **Status:** proposta
- **Depende de:** ADR-02 (ResumoDoDia exibe badge) e ADR-06 (aba Pagamento tem estado-guia)

## Contexto

Fase 1 = agenda + T1.1 leitura + T2.0/T2.1/T2.2 consumo (PRD §6). T1.0 assumido (badge degrada sem travar). Fundador: badge com números exatos + CTA para `/app/config/plano` (Q5); confirmar dispara WhatsApp respeitando opt-in + toggle ligado (Q7); comissão só em concluído (Q8). R7 LGPD, R8 janela 24h, R10 bloqueado/cancelado, R11 comissão.

## Decisão

- **Sem motor entitlements novo, sem migration nova salvo T1.x já prevista**: leitura via hook/flag existente de plano (`usePlanEntitlements` ou equivalente T1.x); se ausente/falhar, badge degrada (oculta) sem travar agenda.
- `PlanBadge.tsx`: "Plano X · uso/limite" com números exatos + CTA → `/app/config/plano`; aba Pagamento do Drawer mostra estado-guia quando indisponível (texto + CTA, sem quebrar fluxo de agenda).
- Consumo T2 (só fiação nos fluxos existentes, sem lógica nova de cobrança/mensagem):
  - T2.0 confirmação 1-clique/lote reaproveita sender WhatsApp existente **se** `whatsapp_opt_in=true` + toggle ligado + dentro da janela 24h; fora disso, só muda status (silencioso).
  - T2.1/T2.2 pagamento/pix usam `PaymentCaptureDialog`/cobrança existentes; comissão exibe valor só quando `status=concluido` (Q8, R11; estorno não altera — sem código novo de comissão).
  - Tenant bloqueado/cancelado: escrita operacional bloqueada + CTA quitação (R10, reuso do guard existente).

## Consequências

- Pró: monetização visível sem acoplar agenda ao billing.
- Contra: badge depende de T1.x — contrato de interface congelado aqui: `usePlanEntitlements() -> { planName, usage, limit, isAvailable } | null`.

## Escopo

- Arquivos afetados: `PlanBadge.tsx` (novo), `AppointmentDrawer.tsx` (estado-guia aba Pagamento), `AppointmentBlock.tsx` (regra exibição comissão), fiação WhatsApp no handler de confirmação existente.
- Fora: motor de planos, scheduler, novas tabelas.

## Critérios de aceite (testáveis)

- [ ] Sem T1.x disponível: agenda funciona, badge oculto, nenhum throw.
- [ ] Badge exibe "Plano X · N/M" exatos; CTA navega para `/app/config/plano`.
- [ ] Confirmar com opt-in=false ou toggle off → status muda, nenhuma chamada WhatsApp (mock spy).
- [ ] Comissão visível só em `concluido`; demais status ocultam valor.
- [ ] Tenant bloqueado: ação de escrita mostra tela/CTA quitação.

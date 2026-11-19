# UX-SPEC — Fase 4 (Retenção e No-show)

Fonte da verdade visual: DS real (jade + shadcn/ui + Space Grotesk, dark-first). Pulse não usado.

## Propostas (8 capacidades, mobile-first 375px, pt-BR)
A. Depósito/sinal: config em ServiceFormDialog (toggle, tipo %/fixo, prazo, reembolso); AgendarPage público passo "Depósito" com PIX QR/copia-e-cola; status "Aguardando depósito"; badge no bloco; drawer exibe charge. Entitlement: deposito.
B. Waitlist: /app/lista-espera (admin/recepção), prioridade, validade; CTA na agenda ao slot ocupado; oferta automática com countdown + Confirmar/Recusar. Entitlement: waitlist.
C. Campanhas: /app/campanhas (admin), presets win-back/aniversário/rebooking, segmentação, preview, métricas. Reuso TemplatesMensagemPage como biblioteca. Entitlement: campanhas.
D. Fidelidade: /app/fidelidade (admin), config pontos/regras/expiração, cartão, cupons, gift cards. Cliente: aba Fidelidade no CRM. PDV: aplicar cupom/gift card. Entitlement: fidelidade.
E. CRM profundo: ClientesPage drawer "Ficha do cliente" (Resumo/Histórico/Preferências/Notas/Fidelidade/Mensagens). Resumo: no-show count, última visita, ticket médio, tags, segmento, opt-in, consentimento. Filtros por tag/segmento/no-show. Receptionist lê/cria notas operacionais; financeiro agregado só admin.
F. Relatórios retenção: estender RelatoriosHubPage com cards Rebooking/No-show/Utilização/Ticket médio/Retenção por coorte/WhatsApp. Páginas /app/relatorios/retencao, /utilizacao, /ticket; filtros período/profissional/serviço; export CSV. Gráficos Recharts + tabela acessível. Admin only.
G. Meu plano + checkout self-service: evoluir PlanoPage (plano atual, uso vs quota, fatura, histórico, upgrade/downgrade, checkout self-service). Estados: loading, bloqueado, cancelado, upgrade confirm, pagamento pendente, sucesso, erro. Entitlement: checkoutSelfService.
H. Métricas WhatsApp: evoluir WhatsAppPage com tabs Conexão/Mensagens/Métricas. KPIs: enviadas, entregues, lidas, confirmadas, respostas, falhas, ban risk. Log filtrável. Admin only para métricas.

## Adesão DS + a11y AA + QA DevTools: 375/768/1024/1440, Console zero, Network sem duplicados, touch 44px, foco, aria-labels, tabelas com headers, formulários com labels, dark mode contraste, reduced motion, RBAC, gating sem request sensível, screenshots harness/.

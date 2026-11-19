# UX-SPEC — Reestruturação da Agenda (/app/agenda)

> Fonte da verdade visual: DS real do repo (jade + shadcn/ui + Space Grotesk, dark-first). Pulse tratado como direção aspiracional de densidade/hierarquia, nunca tokens literais (decisão §0 do parecer: trocar jade→âmbar quebraria StatusBadge/AppointmentBlock/KpiCard e modelo mental).

## 1. Parecer do visual atual
- 3 visões (Lista/Dia/Semana) com persistência; Dia já tem calha real (HOUR_HEIGHT 56), Semana busca 7 dias em 1 request; clique-em-vazio pré-preenche.
- Barra de filtro com ~6 controles heterogêneos sem hierarquia; nenhum quick filter; avançados sem popover.
- Item/bloco: borda-lateral de status + StatusBadge + dot de serviço + ClientConfirmedBadge + PaymentStatusBadge + CommissionAmount + WalkInBadge/ComboTag; compact <76px.
- Ações: Editar + Enviar mensagem + "Mudar status" (dropdown, 2 cliques) + Pagamento. Concluir com paymentsFeature===true → PaymentCaptureDialog.
- Form AppointmentFormDialog (789 linhas): RHF+zod, serviço×pacote, ends_at/price derivados, SlotPicker radiogroup, conflito local + banco.
- A11y já boa: radiogroup aria-checked, foco ring-ring, sr-only, tabular-nums, prefers-reduced-motion, labels, deep-link ?dia=.
- Confirmado e aberto: sem resumo do dia (KPIs); 5+ controles sem hierarquia; modal denso (Guide manda Sheet p/ 6+ campos); ações em dropdown; sem DnD/duplicar/lote; sem ocupação na semana; sem gating de plano na UI.

## 2. Proposta
### 2.1 Resumo do dia (novo): ResumoDoDia — 4 MetricCards clicáveis
1. Ocupação % (agendados ÷ capacidade) + "X de Y horários" → filtra ocupados/livres.
2. Previsto R$ (soma price_cents não-cancelados) + "N atendimentos".
3. A confirmar (pendente) → filterStatus=pendente.
4. Risco no-show (nao_compareceu 7d / sem opt-in). Skeleton em aria-busy; erro com retry; professional vê só a própria; receptionist NÃO vê R$.

### 2.2 Filtros: chips + popover
- Linha 1: Hoje / Amanhã / Esta semana (aria-pressed) + "A confirmar" + view toggle.
- Linha 2: chips de filtro ativo removíveis + "Limpar tudo".
- "Filtros" (outline + Popover/Sheet mobile): profissional, serviço/combo, status, somente pagamento pendente + badge de contagem.

### 2.3 Dia: grade 30min + DnD + quick actions
- Slots 30min, fora-expediente rotulado, linha do agora; DnD intra-dia com fallback teclado + aria-live; conflito com recovery; quick actions 1-clique (Confirmar/Iniciar/Concluir/Editar/Pagamento); dropdown vira overflow; Duplicar; lote com checkbox + barra.

### 2.4 Semana: grade real (≤3 profissionais) ou cards + % ocupação; mobile 1 coluna.

### 2.5 Drawer (substitui modal): Sheet side=right (mobile bottom), abas Dados/Pagamento/Histórico, wizard 3 passos (Quem/O quê → Quando → Revisar), rascunho localStorage, SlotPicker por turnos.

### 2.6 Mobile/a11y: bottom sheet, alvos ≥44pt, estados loading/empty/error/success, foco gerenciado, contraste AA, reduced-motion.

### 2.7 Gating T1.1: badge "Plano X · uso/limite" + CTA upgrade; aba Pagamento com estado-guia quando indisponível.

## 3. Fluxos (F1 confirmar 1-clique, F2 wizard, F3 DnD, F4 lote+erros) — ver parecer integral do ux-designer.

## 4. Checklist QA DevTools (§5 do parecer): KPIs, chips, Dia 30min+DnD, Semana ocupação, Drawer+Wizard, quick actions, SlotPicker turnos, gating T1.1, a11y, console zero ERROR/WARN, screenshots 375+1280.

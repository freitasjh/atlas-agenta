# UX-SPEC — Fase 2 Estética (prontuário / pacotes / checkout clínica)

> Fonte da verdade visual: DS real do repo (jade + shadcn/ui + Space Grotesk, dark-first). Pulse ignorado como tokens literais (decisão Fase 1).
> Emendas v1.1 (auditoria modern-web-guidance: forms, tabs, accessibility, form-factor-adaptation): B1 tabs single-row scroll; B2 assinatura por traço OU nome digitado; B3 painéis com hidden + underline além da cor; ajustes 1–8.

## Propostas (4 telas/fluxos, mobile-first 375px, pt-BR)

### T1 — Aba Prontuário no Drawer (4ª aba) + B1/B3
TabsList 4 cols (Dados/Pagamento/Prontuário/Histórico) em linha única SEMPRE — em 375px, tablist com scroll horizontal (touch-first), nunca grade 2x2. Seleção segue o foco (padrão Radix automático). Painéis `role=tabpanel` + `aria-labelledby`, inativos com `hidden` (estado inicial renderizado no HTML). Aba selecionada com underline além da cor (nunca só cor). Gating por segmento/entitlement `prontuario` (disabled + upsell, nunca hide silencioso). RBAC: receptionist vê só banner alergia; admin/professional full (LGPD dado saúde).
Ordem: 1. Banner alergias/contraindicações (sticky, destructive, aria-live); 2. Ficha atual (3 grupos colapsáveis com `<label for/id>` explícitos e contadores x/500 como helper persistente via `aria-describedby` + `maxlength` nativo, read-only + "Corrigir (nova versão)"); 3. Evolução timeline append-only (badge v1/v2, link ver original, "Nova evolução"); 4. Fotos antes/debedo (`alt "Antes — dd/mm/yyyy"`, grid 2col WebP lazy, lightbox Dialog nativo lado-a-lado com trap de foco/Esc/retorno de foco, upload exige consentimento); 5. Mapa facial SVG: cada zona = `<button>` nativo ≥44px com nome acessível + lista textual espelhada (fonte p/ SR); 6. Termo consentimento (status, Dialog texto + canvas assinatura + campo alternativo "Nome completo (vale como assinatura)" + checkbox LGPD nunca pré-marcado, assinado mostra nome/data/hash). [B2]

### T2 — Anamnese wizard (primeira ficha) + ajustes 1/2/4
Banner "Ficha não criada" + CTA. 3 passos com progresso acessível (`aria-current="step"` ou `<progress>` nomeado) (Quem → Histórico/contraindicações → Revisão + consentimento): foco move para o heading do passo (`tabindex="-1"`) a cada transição; passos inativos fora da ordem de Tab (`hidden`/`inert`); `enterkeyhint` next/previous/done (teclado mobile não cobre inputs). Validação no `blur` (se editado), limpa no `input`, nunca anuncia erro a cada keystroke; `aria-invalid="true"` + `aria-describedby` → mensagem; foco no 1º inválido no submit; CTA nunca desabilitado para bloquear validação (só após submit válido, contra duplo-post). Mínimo 1 campo (regra trigger has_content). Inputs `font-size ≥16px` (sem zoom iOS). Autosave rascunho local + descarte com confirmação (2 cliques).

### T3 — Pacotes de sessões
Venda: Config → Pacotes (admin-only, padrão CombosPage): `<table>` real com `<caption>` + `scope` nos th + Dialog novo pacote (labels visíveis, nunca placeholder-only). Venda no Drawer Pagamento ou Clientes: Dialog (select pacote + início + resumo + Confirmar). Gating T1.2 sem entitlement → empty + upsell.
Saldo: Card "X/Y restantes, expira D" + progress `role=progressbar` com `aria-valuenow/min/max` + texto % (nunca só cor). Baixa automática ao concluir (toast undo 5s). Vencido → badge + "Renovar". Receptionist: só "N restantes" sem preço. Saldo zero → bloqueia + oferece avulso.

### T4 — Checkout liberado p/ estética
Novo flag aestheticCheckout (payments true p/ clinica/estética). Reutiliza SettlementDialog + PaymentCaptureDialog + ledger (botão de pagamento com valor exato, ex.: "Pagar R$ X"). RBAC mantido. Estados skeleton/vazio/erro/sucesso.

## Adesão DS + a11y AA + QA DevTools: 375/1280 claro+escuro sem scroll-X, touch ≥44px (forms: 48px onde couber), fotos lazy WebP, Network sem 4xx/5xx, Console zero ERROR/WARN, RBAC por papel, gating sem crash, append-only v1 intacta, foco gerenciado (abrir → 1º campo; fechar → trigger), contraste AA, `prefers-reduced-motion`, screenshots em .spec/roadmap-fase2/estetica/harness/.

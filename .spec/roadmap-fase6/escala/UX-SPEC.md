# UX-SPEC — Fase 6 (Escala: multi-unidade + app mobile/PWA)

Fonte da verdade visual: DS real (jade `--primary` 160°, shadcn/ui, Space Grotesk/Inter, dark-first, `--radius .75rem`). Pulse não usado; nenhum token novo.

## 1. Parecer

Reutilizável sem redesenho: `DashboardShell`, `AppSidebar`/`SidebarNav`, `Sheet` mobile, `PageHeader`, `StatePanel`, `EntitlementGate`, `usePlanEntitlements` (18 chaves → 20), `usePlanLimits`, `PeriodFilter`, `Table`/`Badge`/`Tabs`/`Dialog`/`DropdownMenu`, `useCepLookup`, `WeekScheduleForm`.

Lacunas críticas: agenda por profissional sem dimensão unidade (double-booking cross-unit); PDV/caixa sem unidade; horários sem unidade; estoque único por tenant; dashboard sem quebra por unidade; ConfigHub sem "Unidades"; DRE/financeiro/cobranças consolidados sem filtro unidade; templates sem `{unidade_endereco}`; shell mobile sem tab bar/offline; `PlanCurrentCard` sem quota de unidades; `usePlanEntitlements` all-or-nothing (upsell falso ao adicionar chaves).

Achado de escopo: `super_admin` não entra em `/app` (tenant null + `RequireActiveSubscription`). Multi-unidade cross-tenant vive em `/internal-admin/empresas/:id/unidades`.

## 2. Decisões

- **D1** Contexto global de unidade no chrome (sidebar desktop / topbar mobile), contrato `?unidade=<id>` + `localStorage("atlas:unit")`.
- **D2** "Todas as unidades" é **somente leitura**; escrita exige unidade única.
- **D3** Em agregado, "Unidade" é o 1º campo obrigatório dos forms de criação.
- **D4** Sem FAB; CTA primário no `PageHeader`.
- **D5** Sem cor por unidade (avatar de iniciais `bg-primary/10 text-primary` + nome); cor nunca é o único sinal.
- **D6** `short_name` ≤12 chars para trigger/grade/notificações.
- **D7** Switcher: `DropdownMenu` radio até 6 unidades; acima, `Dialog` com busca (regra por dado).
- **D8** Unidade inativa listada com `Badge secondary` e selecionável para leitura histórica.
- **D9** Shell `appMobile`: 5 bottom tabs, hamburguer removido, `/app/mais` é rota.
- **D10** Offline = degradação explícita somente leitura; zero escrita otimista.
- **D11** `appMobile` gateia shell + instalação + cache offline; sem entitlement a casca atual fica idêntica.
- **D12** Conflito de agenda validado por profissional **entre unidades**.

## 3. Taxonomia de escopo (espinha da spec)

| Classe | Regra em "Todas" | Superfícies |
|---|---|---|
| **A — Agregável (leitura)** | Consolidado + quebra por unidade, sem CTA primário | `/app`, relatórios, financeiro, cobranças, clientes |
| **B — Unidade obrigatória** | Interstitial de escolha (não modal) | agenda, PDV, estoque, lista de espera, recursos |
| **C — Mista** | Leitura consolidada + edição só em unidade | profissionais, horários, serviços, mensagens |
| **D — Tenant-level** | Indiferente | usuários, membros, auditoria, pagamentos, plano, WhatsApp conexão, campanhas, fidelidade |

Regra de ouro: seletor só aparece com `units.length > 1 && multiUnidade === true`. Unidade única = zero fricção nova.

## 4. Fluxos

1. **Troca de unidade:** `?unidade` válida → escopo; inválida → "Sem acesso a esta unidade" + trocar (nunca revela nome alheio); ausente → localStorage → senão agregado; classe B em agregado → interstitial.
2. **Onboarding (4 passos + revisão):** dados (nome/apelido/CEP→endereço/telefone/saldo) → horários (7 dias + "copiar de") → equipe (associar existentes) → recursos (opcional + "copiar da matriz") → sucesso com 3 próximos passos.
3. **Drill-down:** card por unidade → "Abrir unidade" (secundário) → `?unidade=id` preservando rota/período.
4. **Offline:** banner `role=status` + agenda do dia em cache + CTAs de escrita disabled com descrição; reconexão → banner "Conexão restaurada" + refetch.

## 5. Telas

- **UnitSwitcher** (desktop: sidebar abaixo do logo; mobile: topbar): trigger 44px, avatar iniciais + nome + chevron; `aria-haspopup`/`aria-expanded`; menu radio (`menuitemradio`, setas, Esc); agregado com ícone `Building2`; crossfade 150–200ms com `prefers-reduced-motion`; live region "Unidade ativa: X".
- **/app/config/unidades** (lista): cards mobile / `Table` desktop (Unidade, Endereço, Equipe, Status, Atend. 7d, Ações); estados loading/empty/error/gate/limite.
- **/app/config/unidades/:id**: tabs Dados (form + CEP + fuso herdado), Horários (por unidade + aviso multi-unidade), Equipe (associar/remover), Recursos (CRUD + copiar da matriz). Inativar com confirmação por nome quando há futuros.
- **/app/config/unidades/nova**: wizard 1/4..4/4, validação on blur, passos 3–4 puláveis, revisão editável, sucesso com 3 CTAs; **não** re-semear catálogo.
- **/app (agregado)**: hero no-show + "Maior: X"; bloco "Por unidade" com barras 6px + `role=img` + valor textual; drill-down.
- **/app/agenda agregada**: **sumário por unidade** (não grade) com contadores, conflito/pendente badged, "Abrir agenda"; em unidade: grade atual + campo Unidade no drawer + chip no bloco (só multi) + conflito cross-unit no SlotPicker.
- **Relatórios**: `UnitFilter` + hub com "Comparativo entre unidades" (tabela ordenável ≥md, `<dl>` cards em 375); CSV com coluna unidade.
- **Financeiro**: DRE com `UnitFilter` + bloco "Por unidade" em Tabs; Receber/Cobranças com coluna+filtro; export avisa coluna unidade; regra receita/a receber preservada.
- **PDV agregado**: interstitial com cards de caixa (aberto/fechado).
- **Estoque**: agregado read-only com coluna Unidade; movimentação exige unidade; produtos tenant-level.
- **Shell appMobile**: topbar 56 + 5 tabs (Início, Agenda, Clientes, 4ª por capability, Mais), `aria-current`, traço 2px no ativo, `h-14` + safe-area, `pb-[calc(3.5rem+env(...))]`, `viewport-fit=cover`, `min-h-dvh`.
- **/app/mais**: nav completa (fonte única), `ThemeToggle`, card de instalação (dispensável), sign out separado por `Separator`.
- **Agenda mobile do dia**: chips de 7 dias (`aria-pressed`, scroll-snap), cartão com hora/status/cliente/serviço/unidade/profissional e ações 44px (sem swipe).
- **Offline/instalação**: banner + cache read-only; card de instalação sem interstitial.

## 6. RBAC por unidade

Admin: tudo nas suas unidades + agregado. Recepção: operacional por unidade, agregado leitura. Profissional: só própria agenda/horário nas unidades onde atende. Super admin: leitura + suspender em `/internal-admin`.

Contratos invioláveis: lista de unidades vem filtrada por RLS (nunca no cliente); `?unidade` sem permissão → StatePanel (nunca 403 cru); escrita em agregado nunca escolhe por você; capabilities via `usePermissions`.

## 7. Gating

Contrato 20 chaves: `multiUnidade` (feature `multi_unidade`), `appMobile` (`app_mobile`, migration aditiva). `null` = degradação como `false`. **W2 bloqueante de design:** validador deve ser tolerante (chaves novas assumem `false`) para não invalidar payload F5.

Limites: `units_limit` (null=∞) — proposta free 1 · starter 1 · premium 2 · enterprise ∞ (requer decisão, W1). No limite: CTA disabled + copy de limite + link planos (distinguir de falta de entitlement). `PlanCurrentCard` ganha linha "Unidades — 2 de 3".

## 8. DS

Sem token/cor/fonte/sombra novos. Badge default=Ativa, secondary=Inativa; `tabular-nums`; `font-display` só em títulos; foco `ring-2 ring-ring offset-2`; motion 150–200ms. Proibido: cor por unidade, overflow-x em tabela mobile, segundo primário, ícone como único rótulo.

## 9. A11y AA

Switcher nome acessível + `aria-expanded`; `menuitemradio`/`aria-checked`; `aria-current` em tabs; live region na troca; foco preservado; alvos 44px; contraste 4.5:1/3:1 nos dois temas; barras com `role=img` + valor textual; tabelas com `scope`/`aria-sort`/`caption`; alternativa em lista no mobile; erros `role=alert` + foco; banner offline sem roubar foco; safe-area; zoom habilitado.

## 10. Estados por tela

Todas as telas: loading (Skeleton/aria-busy), vazio (StatePanel + CTA), erro (StatePanel + retry), gate OFF (EntitlementGate + upsell, zero request), limite (CTA disabled + copy), offline (cache + banner).

## 11. UI spec verificável (QA DevTools)

Viewports 375×812, 768×1024, 1280×800, 1440×900. Por rota: Console zero `[ERROR]/[WARN]`, Network sem duplicado e sem 4xx/5xx, `scrollWidth <= innerWidth`, alvos ≥44px, foco visível.

24 asserções cobrindo: lista (gate false/null sem request a `units`), limite, switcher (menu/teclado/URL), acesso negado sem vazar nome, agregado sem CTA primário, agenda agregada em cards, conflito cross-unit no SlotPicker, PDV interstitial, relatórios em `<dl>` sem overflow, DRE por unidade, export aviso, wizard, shell 5 tabs (4ª por capability), shell sem appMobile idêntico, offline banner + CTAs disabled + zero unhandled rejection, reconexão, tema claro AA, plano quota, internal-admin coluna Unidades, teclado sem trap.

Screenshots em `.spec/roadmap-fase6/escala/harness/` (`adrNN-<slug>-{1280,375}.png`).

## 12. Riscos e questões abertas

- **W1** `multi_unidade` só no seed enterprise vs `units_limit` 2 no premium → decidir (recomendado premium+enterprise).
- **W2** validador tolerante de entitlements (bloqueante de design).
- **W3** backfill de `unit_id` obrigatório (senão histórico desaparece); filtrar só quando `multiUnidade && units>1`.
- **W4** não re-semear catálogo ao criar unidade.
- **W5** template precisa de `{unidade_endereco}`.
- **W6** agenda agregada nunca em grade lado a lado.
- **W7** switcher manda; `UnitFilter` é recorte explícito do relatório.

Q1 serviços tenant-level + join `service_units` (recomendado) · Q2 sem preço por unidade na v1 · Q3 `units_limit` = nº de unidades; quotas de prof/agendamento seguem tenant-level · Q4 grade distinta por unidade (sim) · Q5 campanhas/fidelidade tenant-level.

Contrato mínimo: `UnitContext { mode: "all"|"single"; unitId: string|null; units: UnitSummary[] }`; query keys incluem `unitId`; escrita exige `unitId` (nunca null). Backend: tabela `units` + RLS por membership; `unit_id` em `appointments`/`working_hours`/`resources`/`stock_*`/`cash_sessions`/`appointment_payments`; `plans.units_limit`; features `app_mobile`/`multi_unidade`; conflito cross-unit por profissional; RLS filtrando o seletor no servidor.

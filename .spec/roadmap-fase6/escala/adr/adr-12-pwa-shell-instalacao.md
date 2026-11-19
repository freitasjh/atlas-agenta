# ADR-12 — PWA shell: 5 tabs, `/app/mais` e instalação

- **Status**: Aceito (design congelado)
- **PRD**: §6.5 RF-27..RF-31, §12 D9/D11
- **UX-SPEC**: §5 shell appMobile e `/app/mais`, §9 a11y, §10 estados
- **Depende de**: ADR-01 (`appMobile`), ADR-04 (contexto), ADR-09 (nav/seções)
- **Bloqueia**: ADR-13 (offline reusa shell/SW)
- **Escopo de escrita**: `vite.config.ts`, `public/`, `index.html`, `src/app/mobile/`, `src/components/`, `src/hooks/`

## Contexto

Não existe manifest, service worker nem registro (`public/` só tem `favicon.svg`; nenhum
`vite-plugin-pwa`). A casca mobile atual é a shell desktop comprimida (Sheet), sem tab bar e
sem instalação. O UX-SPEC exige 5 bottom tabs (4ª por capability), hambúrguer removido,
`/app/mais` como rota real, safe-area, e — sem `appMobile` — casca **idêntica** à atual e
**zero cache novo**.

## Decisão

### D1 — Gating por entitlement (D11)

`appMobile` decide o shell, a instalação e o cache. Sem entitlement (`false`/`null`):
`DashboardShell` atual, nenhum SW registrado, nenhum manifest ativo (link não injetado),
nenhum prompt de instalação. O gate é na composição do layout, não em CSS.

### D2 — Shell mobile (5 tabs)

Componente `MobileAppShell` (montado quando `appMobile && viewport mobile`) com:

- Topbar 56px (título da rota + `UnitSwitcher` variant `topbar` quando `isMulti`).
- Bottom tab bar `h-14` + safe-area (`pb-[calc(3.5rem+env(safe-area-inset-bottom))]`),
  `viewport-fit=cover`, `min-h-dvh`; traço ativo 2px; `aria-current="page"`; alvos 44px.
- Tabs fixas: Início, Agenda, Clientes, **4ª por capability**, Mais.
- Hambúrguer/Sheet removido nesse shell.

### D3 — 4ª aba determinística (RF-29)

Regra única, avaliada em ordem, com entitlement/permissão:

| Prioridade | Capability | Aba |
|---|---|---|
| 1 | `fidelidade` + admin | Fidelidade |
| 2 | `campanhas` + admin | Campanhas |
| 3 | `estoque` + (admin/recepção) | Estoque |
| 4 | `canViewFinancials` | Financeiro |
| 5 | admin | Relatórios |
| 6 | recepção | PDV |
| 7 | profissional | Meus horários |
| 8 | fallback | Configurações |

Nunca some: se a capability cai, a aba é recalculada (sem estado "vazio"). Teste com fixtures
para cada prioridade e para o fallback.

### D4 — `/app/mais`

Rota real (não modal) com a navegação completa como **fonte única** dos destinos (o tab bar
consome o mesmo mapa), `ThemeToggle`, card de instalação dispensável (persistido em
`localStorage`), e sign out separado por `Separator`. Itens sem permissão não aparecem.

### D5 — Manifest, SW e instalação

- `manifest.webmanifest`: nome curto, `start_url=/app`, `display=standalone`, `theme_color`
  do DS, ícones 192/512 + maskable, `lang=pt-BR`. Sem splash/interstitial.
- Service worker via `vite-plugin-pwa` (Workbox) — decisão por geração de precache +
  versionamento, em vez de SW manual. `registerType: "autoUpdate"`, escopo `/app`.
- Registro **condicionado** a `appMobile`; sem entitlement o plugin não injeta registro no
  bundle de entrada (build flag) ou o registro é condicionado em runtime e não faz fetch de
  precache (documentado; testado).
- Instalação: `beforeinstallprompt` capturado, card em `/app/mais` com botão "Instalar app";
  dispensável; nada de interstitial automático. iOS: instrução textual ("Compartilhar →
  Adicionar à Tela de Início").
- Sem cache de financeiro; o SW da fase só precacheia shell estático (dados são ADR-13).

### D6 — Segurança do SW

Escopo restrito a `/app`, `navigateFallback` apenas para rotas do shell, `denylist` para
`/public`, `/agendar`, `/internal-admin`, `/api`/Edge; nenhuma resposta autenticada de
financeiro é cacheada. Atualização não recarrega a página no meio de uma edição: `autoUpdate`
aplica no próximo carregamento.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `MobileAppShell` | renderiza topbar + children + `MobileTabBar`; só com `appMobile` |
| `useMobileNav()` | retorna itens `{ to, label, icon, requires?, entitlement? }` — fonte única |
| `getFourthTab(capabilities, role)` | puro; ordem do D3; nunca `null` |
| `/app/mais` | rota `app/mais`, nav completa + tema + instalação + sign out |
| `useInstallPrompt()` | `{ canInstall, promptInstall, dismiss }`; no-op sem `appMobile` |
| `manifest.webmanifest` | `start_url=/app`, `display=standalone`, ícones 192/512/maskable |

## Consequências

**Positivas**
- Experiência instalável nativa-ish sem app de loja.
- Navegação mobile com fonte única (tab bar e `/mais` nunca divergem).
- Sem entitlement, nada muda (zero regressão).

**Negativas / custos**
- Build ganha plugin/SW e uma matriz de capability para a 4ª aba.
- Testar instalação exige harness com HTTPS/localhost e `beforeinstallprompt` simulado.

**Riscos e mitigação**
- *Risco*: SW cachear HTML autenticado e vazar dado entre contas. *Mitigação*: precache só
  assets estáticos; dados só via ADR-13 com escopo de usuário; limpar cache no sign out.
- *Risco*: 4ª aba mudar entre navegações. *Mitigação*: função pura + teste.
- *Risco*: shell mobile aparecer para quem não tem entitlement. *Mitigação*: gate na
  composição + teste de casca idêntica.

## Escopo

**Entra**
- Manifest, ícones, SW, registro condicionado, shell/tab bar, `/app/mais`, 4ª aba, card de
  instalação, safe-area, a11y, teste de gate.

**Não entra**
- Offline de dados (ADR-13), app nativo, push notifications, cache de financeiro, redesign
  do desktop, splash screens customizadas.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `vite.config.ts` | `vite-plugin-pwa` |
| `public/manifest.webmanifest`, `public/icons/*` | manifest/ícones |
| `index.html` | `viewport-fit=cover`, theme-color, link do manifest condicionado |
| `src/app/mobile/MobileAppShell.tsx` (novo) + test | shell |
| `src/app/mobile/MobileTabBar.tsx` (novo) + test | tabs |
| `src/app/mobile/mais/MorePage.tsx` (novo) + test | `/app/mais` |
| `src/lib/mobile-nav.ts` (novo) + test | fonte única + 4ª aba |
| `src/hooks/useInstallPrompt.ts` (novo) | instalação |
| `src/router.tsx` | rota `app/mais` |
| `src/app/AppLayout.tsx` | escolha de shell |

## Critérios de aceite (testáveis)

- [ ] Sem `appMobile`: casca idêntica à atual, sem tab bar, sem manifest/SW registrado.
- [ ] Com `appMobile`: 5 tabs, hambúrguer ausente, `aria-current` correto.
- [ ] 4ª aba respeita a ordem e nunca fica vazia; muda ao perder capability.
- [ ] `/app/mais` é rota (back funciona), lista nav completa e só itens permitidos.
- [ ] `manifest.webmanifest` válido (nome, start_url, display, ícones 192/512/maskable).
- [ ] SW registra só com entitlement; precache sem HTML autenticado/financeiro.
- [ ] Card de instalação dispensável; sem interstitial; iOS mostra instrução textual.
- [ ] `scrollWidth <= innerWidth` em 375; safe-area respeitada com notch simulado.

## Dependência / ordem

Depois de ADR-09/10 (navegação e telas). Antes de ADR-13 (offline usa o mesmo shell/SW).

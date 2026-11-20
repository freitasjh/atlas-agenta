# DESIGN.md — Atlas Admin Template (Perfil `shadcn`)

> **Contrato Arquitetural e de Design System Mandatório**
> - **Perfil Ativo**: `shadcn` (Atlas Admin Template — SaaS, ERP, Fintech, PDV & E-commerce)
> - **Fonte de Verdade de Tokens**: `tokens/*.json` (`profiles/shadcn/tokens/`) → compilado via `npm run tokens:build` para `src/tokens-shadcn.css`
> - **Escopo Duplo**: Este documento governa tanto o **Desenvolvimento Greenfield** (criação de novas telas e componentes) quanto a **Refatoração/Migração** de sistemas existentes para o padrão Atlas Admin.

---

## 1. Princípios Fundamentais e Filosofia Visual

1. **Superfícies Sólidas e Hierarquia de Contraste**:
   - O perfil `shadcn` segue a estética **New York / Linear / Stripe Financial**: superfícies limpas (`bg-background`, `bg-card`), bordas sutis de 1px (`border-border/70` ou `border-border/80`), elevação mínima (`shadow-xs`) e foco absoluto na legibilidade dos dados.
   - Vidro translúcido (`backdrop-blur`) é permitido **apenas** em barras superiores fixas (`SiteHeader`, toolbars flutuantes) com fallback sólido (`bg-background/95 supports-[backdrop-filter]:bg-background/60`). Cards de dados nunca usam glassmorphism.
2. **Zero Cores Hardcoded (Tokens Semânticos Estritos)**:
   - É **estritamente proibido** usar cores hexadecimais (`#fff`, `#1e293b`), `rgb()` ou paletas utilitárias neutras fixas (`bg-slate-900`, `text-gray-500`, `bg-zinc-100`, `bg-white`, `text-black`) para estrutura de layout.
   - Toda superfície, texto e borda estrutural deve usar exclusivamente os tokens semânticos mapeados no tema claro (`:root`) e escuro (`.dark`).
3. **Precisão Numérica e Financeira (`font-mono tabular-nums`)**:
   - Todo valor monetário (`R$`), saldo, limite, percentual (`%`), código de barras (EAN), SKU, número de cartão, agência/conta, protocolo e data em tabelas ou KPIs **DEVE** usar `font-mono tabular-nums` para alinhamento vertical perfeito de dígitos.

---

## 2. Sistema de Tokens Semânticos (`shadcn`)

### 2.1 Tokens Estruturais Obrigatórios
| Token CSS | Classe Tailwind | Uso Obrigatório |
| :--- | :--- | :--- |
| `--background` | `bg-background` | Fundo principal da página e áreas de conteúdo. |
| `--foreground` | `text-foreground` | Títulos, valores principais e textos de leitura primária. |
| `--card` / `--card-foreground` | `bg-card text-card-foreground` | Contêineres de KPIs, painéis de resumo, tabelas emolduradas e widgets. |
| `--muted` / `--muted-foreground` | `bg-muted/30` · `text-muted-foreground` | Fundos secundários sutis, cabeçalhos de tabela, subtítulos, legendas e metadados. |
| `--primary` / `--primary-foreground` | `bg-primary text-primary-foreground` | Ação primária da tela, indicadores ativos, chips selecionados. |
| `--secondary` / `--secondary-foreground` | `bg-secondary text-secondary-foreground` | Botões secundários, pílulas de filtro e badges neutros. |
| `--accent` / `--accent-foreground` | `hover:bg-accent hover:text-accent-foreground` | Estados de hover em linhas, menus, seletores e botões `ghost`/`outline`. |
| `--destructive` | `bg-destructive` · `text-destructive` | Ações destrutivas, exclusões, bloqueios, alertas de erro ou saldo devedor crítico. |
| `--border` / `--input` / `--ring` | `border-border/70` · `border-input` · `ring-ring/50` | Divisórias, bordas de cards/inputs e anéis de foco (`focus-visible`). |
| `--sidebar-*` | `bg-sidebar text-sidebar-foreground border-sidebar-border` | Exclusivo para a navegação lateral (`AppSidebar`). |

### 2.2 Semântica de Status e Indicadores Financeiros
Nunca use cores puras saturadas como fundo de card ou badge. Use sempre **opacidade de 10% a 15% no fundo** combinada com **borda de 30% a 40%** e texto semântico adaptável ao modo escuro:

| Estado / Semântica | Classes de Badge / Destaque | Ícone Obrigatório (WCAG) |
| :--- | :--- | :--- |
| **Positivo / Receita / Conciliado / Pago** | `border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400` | `ArrowUpRight`, `CheckCircle2`, `TrendingUp` ou sinal `+` |
| **Atenção / Pendente / Fechada / Alerta** | `border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400` | `Clock`, `AlertTriangle` |
| **Negativo / Despesa / Vencida / Divergente** | `border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400` (ou `destructive`) | `ArrowDownRight`, `AlertCircle`, `XCircle` ou sinal `-` |
| **Informativo / Corporativo / Neutro** | `border-primary/30 bg-primary/10 text-primary` | Ícone contextual do domínio |

### 2.3 Escala de Raio (`--radius`)
- O raio base é definido em `--radius` (`0.625rem`).
- Componentes derivam seu arredondamento via `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl` (conectados a `var(--radius)` no `@theme inline`). Não sobrescreva a escala de raio com valores arbitrários desconectados.

---

## 3. Shell Oficial e Ritmo de Layout (`AtlasAdminTemplate`)

Toda visualização administrativa interna deve ser renderizada dentro do `AtlasAdminTemplate` (`@/layouts`):

```tsx
import { AtlasAdminTemplate } from "@/layouts"

export function MeuModuloPage() {
  return (
    <AtlasAdminTemplate title="Título do Módulo" activeView="overview">
      <div className="flex flex-col gap-6 px-4 lg:px-6">
        {/* Blocos da tela */}
      </div>
    </AtlasAdminTemplate>
  )
}
```

### Regras de Alinhamento e Espaçamento:
1. **Alinhamento Horizontal Inegociável (`px-4 lg:px-6`)**: Todo conteúdo dentro do `<main>` deve alinhar exatamente com o `SiteHeader` usando `px-4 lg:px-6`. **Proibido** usar `container mx-auto` ou `max-w-7xl` que desalinhem a margem esquerda da sidebar.
2. **Ritmo Vertical (`gap-5` ou `gap-6`)**: O contêiner principal de cada view deve usar `flex flex-col gap-5` ou `flex flex-col gap-6`.
3. **Tipografia de Cabeçalho de Página**:
   - Título `<h1>`: `text-xl font-bold tracking-tight text-foreground sm:text-2xl`
   - Subtítulo `<p>`: `text-xs text-muted-foreground`

---

## 4. Os 5 Arquétipos de Tela do Atlas Admin

Ao criar uma tela nova (**Desenvolvimento**) ou converter uma tela legada (**Refatoração**), classifique-a obrigatoriamente em um dos 5 arquétipos abaixo:

### Arquétipo 1: Operacional Analítico (KPIs + Tabela Unificada)
- **Módulos de Referência**: `overview` (`DashboardPage`), `transactions` (`TransactionsView`).
- **Estrutura Vertical**:
  1. Cabeçalho da seção (`<h1>` + `<p>`).
  2. Grid de 4 KPIs (`grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`).
  3. Gráfico analítico opcional (`ChartAreaInteractive`).
  4. Tabela de dados (`DataTable` / `TransactionTable`) com barra `<search>` e **Regra da Ação Única** (o botão primário `Novo Registro` fica exclusivamente na toolbar da tabela, nunca duplicado no topo da página).

### Arquétipo 2: Seletor Compacto + Veredito em 3 Colunas (Cartões & Contas Bancárias)
- **Módulos de Referência**: `cards` (`CardStatementsView`) e `accounts` (`BankAccountsView`).
- **Quando usar**: Telas onde o usuário gerencia múltiplas entidades financeiras (cartões corporativos, contas bancárias/cofres) e precisa alternar rapidamente entre elas para conciliar faturas ou extratos sem poluir a tela com dezenas de cards gigantes.
- **Estrutura Vertical**:
  1. **Cabeçalho + Toggle de Modo em Pílula**: Alternância rápida entre `Extrato / Lançamentos` (foco operacional reduzido) e `Carteira Completa` (grid de gestão de cartões/contas) + botões de ação no topo (`Transferir`, `Importar OFX`, `Nova Conta/Cartão`).
  2. **KPIs Consolidados Compactos** (opcional, 4 colunas com `p-4`) exibindo liquidez global.
  3. **Barra Horizontal de Seleção (`SelectorBar`)**: Lista horizontal rolável (`flex items-center gap-2.5 overflow-x-auto pb-1 scrollbar-none`) com chips compactos para cada conta/cartão (ícone/cor da instituição + apelido + saldo/fatura em `font-mono` + ponto colorido de status) + botão tracejado `+ Nova Conta / Cartão`.
  4. **Card de Veredito em 3 Colunas (`SummaryHeader` — `grid-cols-1 lg:grid-cols-12`)**:
     - *Coluna 1 (`lg:col-span-5`)*: Identidade da conta/cartão, dados copiáveis (agência/conta, chave Pix ou final do cartão) e **Saldo / Valor da Fatura** em destaque (`text-2xl sm:text-3xl font-bold font-mono tabular-nums`).
     - *Coluna 2 (`lg:col-span-4`)*: Métricas secundárias, barra de progresso de limite/meta ou fluxo do período (Entradas vs Saídas) e status de sincronização/vencimento.
     - *Coluna 3 (`lg:col-span-3`)*: CTAs primários e secundários empilhados (`Pagar Fatura` / `Novo Lançamento`, `Importar OFX`, `Extrato PDF`).
  5. **Tabela de Lançamentos / Conciliação**: Busca `<search>`, filtros em pílula (`Todos`, `Entradas`, `Saídas`, `Pendentes de Conciliação`), ações de conciliação 1-clique e drawer/modal de detalhes.

### Arquétipo 3: Frente de Caixa Split-Screen de Alta Velocidade (PDV / POS)
- **Módulo de Referência**: `pdv` (`PDVView`).
- **Quando usar**: Terminais de venda, balcão de atendimento, operação assistida por teclado.
- **Estrutura**:
  1. **Viewport Fixa**: `h-[calc(100vh-4rem)] overflow-hidden` (sem scroll global na página; o scroll ocorre apenas dentro do grid de catálogo e da lista de itens do cupom).
  2. **Topbar Operacional do Caixa**: Identificação do terminal (`Caixa #01`), status (`CAIXA ABERTO`), operador ativo, cliente vinculado e ações administrativas (`Sangria / Suprimento`, `Fechar Caixa`).
  3. **Grid Split-Screen (`lg:grid-cols-12`)**:
     - *Esquerda (`lg:col-span-7 xl:col-span-8`)*: Barra de leitura de código de barras/busca (`F2`) com auto-focus + pílulas de categoria + grid denso de produtos com estoque, SKU e adição em 1 clique.
     - *Direita (`lg:col-span-5 xl:col-span-4`)*: Cupom Fiscal Ativo (`PDVCart`) com controles `+/-`, desconto, subtotal e painel de **Total a Pagar** em alto contraste + botão `Finalizar Venda (F9)`.
  4. **Rodapé Sticky de Atalhos (`PDVHotkeysFooter`)**: Barra inferior exibindo teclas rápidas (`F2 Buscar`, `F4 Cliente`, `F6 Desconto`, `F7 Sangria`, `F8 Cancelar`, `F9 Pagamento`, `F10 Fechar`) com listener global de teclado (ignorado quando o foco está em inputs de modais abertas).

### Arquétipo 4: Backoffice, Compliance & Super-Admin (Master-Detail)
- **Módulos de Referência**: `backoffice` (`BackofficeView`), `internal-admin` (`InternalAdminView`), `files` (`FileManagerView`).
- **Estrutura**:
  1. **Regra dos 5 Segundos no Topo**: Status do operador, indicadores de SLA/fila/quotas críticas.
  2. **Tabela Densa / Grid Selecionável**: Suporte a seleção em lote e clique na linha.
  3. **Inspeção em `Sheet` Lateral Direito (`side="right"`)**: Clicar em um caso, empresa (tenant) ou arquivo abre um painel deslizante mantendo o contexto da fila ao fundo (`CaseInspectorSheet`, `TenantDetailsSheet`, `FileDetailsSheet`).
  4. **Governança de Ações Críticas**: Bloqueios, estornos, reprovações de KYC ou *impersonation* exigem confirmação explícita com motivo padronizado (`ActionReasonModal` / `ImpersonateModal`).

### Arquétipo 5: Split-Screen Transacional & Onboarding Progressivo
- **Módulos de Referência**: `checkout` (`CheckoutView`) e `auth` (`LoginPage`, `SignupPage`, `MfaSetupCard`).
- **Estrutura**:
  - *Checkout*: `lg:grid-cols-12` com 7 colunas para o stepper de endereço/pagamento (com `InteractiveCreditCard` 3D) e 5 colunas para o `OrderSummary` com `lg:sticky lg:top-6`.
  - *Auth / Cadastro*: Split `50/50` (`lg:grid-cols-2`), formulário contido em `max-w-md` com micro-onboarding em 3 etapas, medidor de força de senha inline e **sem campo duplicado de confirmação de senha**.

---

### Arquétipo 6: Painel de Configurações (Settings)
- **Módulo de Referência**: `settings` (`SettingsView`). Regras completas em `.agents/rules/settings-panel.md`.
- Nav lateral sticky agrupada + busca Ctrl+K, rascunho global com barra fixa de alterações não salvas, cards `SettingsCard`/`SettingRow`, zona de perigo com confirmação digitada.

### Arquétipo 7: AI Copilot & Agentic Workspace (`ai-elements`)
- **Módulo de Referência**: `ai` (`AIWorkspaceView`). Regras completas em `.agents/rules/ai-workspace.md`.
- Layout split-screen em 3 painéis travado no viewport (`h-[calc(100vh-4rem)] overflow-hidden`): sidebar de histórico/persona + área central (`Conversation`, `Message`, `Reasoning`, `PlanCard`, `Tool` + `Confirmation` Human-in-the-Loop, `InlineCitation`, `Sources`, `PromptInput` com `@contexto`, `/comandos`, `ModelSelector` e `ContextIndicator`) + painel lateral Canvas/Artifact versionado.

---

## 5. Regras Críticas de Contenção, Modais e Formulários (Anti-Bug)

### 5.1 Prevenção de Estouro Horizontal em Flexbox (`min-w-0`)
> [!CAUTION]
> **Bug Clássico de Estouro de Modal/Card**: Strings longas sem espaços (código **Pix Copia e Cola**, linha digitável de boleto, hashes, tokens de API, URLs longas) dentro de um elemento `flex` forçam `min-width: auto` a expandir além da largura do `DialogContent` ou `Card`.
- **Regra Obrigatória**: Todo container flex que envolva textos dinâmicos, códigos ou inputs copiáveis **DEVE** ter `min-w-0` e `w-full`, e o elemento de texto interno **DEVE** usar `truncate` ou `break-all`:
  ```tsx
  <div className="flex min-w-0 w-full items-center gap-2">
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-muted/40 px-3 py-2">
      <p className="truncate font-mono text-xs text-muted-foreground">{pixCode}</p>
    </div>
    <Button type="button" className="shrink-0">Copiar</Button>
  </div>
  ```

### 5.2 Contenção de Modais (`DialogContent`)
- Toda modal deve declarar explicitamente:
  `className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6"` (ou `sm:max-w-xl` para formulários de 2 colunas).
- O rodapé `DialogFooter` **DEVE** usar `className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0"` para evitar botões colados.

### 5.3 Largura Integral em Formulários (`w-full`)
- Em qualquer grid de formulário (`grid-cols-1 sm:grid-cols-2`), todos os componentes `<Input>`, `<SelectTrigger>`, `<Combobox>` e `<DatePicker>` **DEVEM** possuir `className="h-10 w-full"`. Nunca deixe `SelectTrigger` com `w-fit` dentro de formulários.
- Distância entre `<Label>` e `<Input>`: `gap-1.5` (`6px`). Distância entre campos no grid: `gap-x-4 gap-y-3.5`.

### 5.4 Tipagem Estrita de Ícones (`lucide-react`)
- **Nunca** passe a prop HTML `title="..."` diretamente para um ícone do `lucide-react` (ex: `<Lock title="Bloqueado" />`), pois isso falha na checagem `tsc --noEmit`. Sempre envolva o ícone em um `<span title="Bloqueado"><Lock className="size-3.5" /></span>` ou use `Tooltip`.

---

## 6. Catálogo Oficial de Domínios (`src/components/shadcn/`)

| Domínio (`--domain`) | Diretório | Componentes Principais |
| :--- | :--- | :--- |
| `navigation` | `src/components/shadcn/navigation` | `AppSidebar`, `SiteHeader`, `DashboardShell`, `ModeToggle`, `NotificationCenter` |
| `dashboard` | `src/components/shadcn/dashboard` | `SectionCards`, `ChartAreaInteractive`, `DataTable`, `CreateEntrySheet` |
| `transactions` | `src/components/shadcn/transactions` | `TransactionsView`, `TransactionStats`, `TransactionTable`, `TransactionDialog`, `TransactionDetailDialog` |
| `credit-card` (`cards`) | `src/components/shadcn/credit-card` | `CardStatementsView`, `InteractiveCreditCard`, `CreditCardForm`, `CreditCardWallet`, `CardExpensesTable`, `PayInvoiceDialog`, `InvoiceCycleTimeline` |
| `bank-accounts` (`accounts`) | `src/components/shadcn/bank-accounts` | `BankAccountsView`, `TreasuryMetricsHeader`, `AccountSelectorBar`, `AccountSummaryHeader`, `BankAccountStatementTable`, `NewBankAccountModal`, `InternalTransferModal`, `ImportOfxModal` |
| `pdv` (`pos`) | `src/components/shadcn/pdv` | `PDVView`, `PDVHeader`, `PDVProductCatalog`, `PDVCart`, `PDVPaymentModal`, `PDVCashMovementModal`, `PDVCustomerModal`, `PDVCloseRegisterModal`, `PDVReceiptModal`, `PDVHotkeysFooter` |
| `checkout` | `src/components/shadcn/checkout` | `CheckoutView`, `CheckoutStepper`, `AddressForm`, `PaymentForm`, `ReviewOrder`, `OrderSummary` |
| `file-manager` (`files`) | `src/components/shadcn/file-manager` | `FileManagerView`, `FileStorageWidget`, `FileDropzoneModal`, `FileDetailsSheet` |
| `backoffice` | `src/components/shadcn/backoffice` | `BackofficeView`, `CaseInspectorSheet`, `ActionReasonModal` |
| `internal-admin` | `src/components/shadcn/internal-admin` | `InternalAdminView`, `TenantDetailsSheet`, `ImpersonateModal` |
| `kanban` | `src/components/shadcn/kanban` | `KanbanBoard`, `KanbanColumn`, `KanbanCard` |
| `scheduler` | `src/components/shadcn/scheduler` | `Scheduler`, `DayView`, `WeekView`, `TimelineView`, `AppointmentDialog` |
| `auth` | `src/components/shadcn/auth` | `LoginForm`, `SignupWizardCard`, `PasswordStrengthMeter`, `OtpVerificationCard`, `MfaSetupCard` |
| `settings` | `src/components/shadcn/settings` | `SettingsView`, `SettingsNav` (busca Ctrl+K), `SettingsSaveBar`, `SettingsCard`, `SettingRow`, `TeamSection` (matriz de permissões), `AdvancedSection` (zona de perigo) |
| `ai` | `src/components/shadcn/ai` | `AIWorkspaceView`, `AIThreadsSidebar`, `AIArtifactPanel`, `Conversation`, `Message`, `PromptInput`, `Reasoning`, `Tool`, `Confirmation`, `PlanCard`, `Sources`, `InlineCitation`, `Suggestions`, `ModelSelector`, `ContextIndicator` |
| `pricing` | `src/components/shadcn/pricing` | `PricingTable`, `PlanSubscribeDialog` |

---

## 7. Diretrizes de Refatoração (Migração para Atlas Admin)

Ao refatorar qualquer tela ou componente existente para o padrão Atlas Admin:
1. **Substituir o Layout Raiz**: Remover wrappers legados (`<div className="min-h-screen bg-gray-100 p-8">`, sidebars customizadas ou navbars avulsas) e envolver a tela em `<AtlasAdminTemplate>` com container interno `<div className="flex flex-col gap-6 px-4 lg:px-6">`.
2. **Sanitizar Cores e Superfícies**: Substituir todas as classes `bg-white`, `bg-slate-*`, `bg-gray-*`, `text-gray-*`, `border-gray-*` e hexadecimais por tokens semânticos (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border/70`).
3. **Adequar ao Arquétipo Correto**:
   - Se a tela possui dezenas de cards repetitivos de contas/cartões acima de uma tabela, **refatore para o Arquétipo 2** (`SelectorBar` horizontal + `SummaryHeader` de 3 colunas + tabela unificada).
   - Se a tela possui botões duplicados no topo e na tabela, **aplique a Regra da Ação Única** movendo a ação primária para a barra `<search>` da tabela.
4. **Padronizar Números e Moedas**: Adicionar `font-mono tabular-nums` em todas as células de valor, saldos, percentuais e códigos.
5. **Blindar Modais e Formulários**: Aplicar `max-h-[92vh] overflow-y-auto overscroll-contain`, `min-w-0` em containers flex com códigos longos e `w-full` em todos os inputs/selects.

---

## 8. Gate Obrigatório de Qualidade

Toda criação ou refatoração em `src/` **DEVE** ser validada executando:

```bash
bash scripts/verify.sh
```

O gate executa em sequência:
1. `node scripts/build-tokens.mjs` (compilação e validação de colisão de tokens DTCG)
2. `npx oxlint src` (regras estritas: proibido `any`, proibido `!` non-null assertion, `jsx-key`, `rules-of-hooks`)
3. `npx tsc --noEmit` (tipagem estrita TypeScript sem erros)


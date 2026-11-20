# Regras: Desenvolvimento de Telas e Layouts (screens-and-layouts.md)

Este documento dita como montar páginas e telas completas dentro do perfil **Atlas Admin** (`shadcn`), garantindo coerência visual, ritmo vertical e responsividade em qualquer dispositivo.

---

## 1. O Esqueleto Oficial (`AtlasAdminTemplate`)

Toda tela administrativa deve ser envolvida pelo layout padrão exportado de `@/layouts`:

```tsx
"use client"

import { AtlasAdminTemplate } from "@/layouts"
import type { DashboardViewId } from "@/components/shadcn/navigation"

export function MinhaPaginaAdmin() {
  return (
    <AtlasAdminTemplate
      title="Gestão Financeira"
      activeView="transactions"
      onSelectView={(view) => console.log("Navegar para:", view)}
    >
      {/* Conteúdo da tela aqui */}
    </AtlasAdminTemplate>
  )
}
```

### O que o layout provê automaticamente:
1. **Sidebar retrátil (`AppSidebar`)**: Menu lateral com perfil do usuário, rotas principais, grupos de documentos e rodapé retrátil (`collapsible="offcanvas"`).
2. **Cabeçalho com Breadcrumbs (`SiteHeader`)**: Barra superior fixa com botão de alternância da sidebar, breadcrumb automático, busca rápida, central de notificações e alternador de tema claro/escuro (`ModeToggle`).
3. **Área de Conteúdo `<main>`**: Área scrollável com Container Queries ativas (`@container/main`) e variáveis de controle de altura e largura de navegação.

---

## 2. Alinhamento Horizontal e Espaçamentos Obrigatórios

Para manter o alinhamento pixel-perfect com os elementos da barra superior (`SiteHeader`):

- **Espaçamento Horizontal Padrão**: Todo contêiner de seção, grid de cards ou cabeçalho de página deve usar:
  ```tsx
  className="px-4 lg:px-6"
  ```
- **Ritmo Vertical da Página**: O contêiner raiz da visualização deve organizar seus blocos com:
  ```tsx
  className="flex flex-col gap-6"
  ```

---

## 3. Cabeçalho de Página e Tipografia

Toda tela deve conter um cabeçalho de seção claro e conciso:

```tsx
{/* Cabeçalho de Seção Oficial */}
<div className="flex flex-col gap-1 px-4 lg:px-6">
  <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
    Título da Tela
  </h1>
  <p className="text-xs text-muted-foreground">
    Subtítulo descritivo explicando a finalidade e principais ações desta área do sistema.
  </p>
</div>
```

### Regras do Cabeçalho:
- **Títulos**: `text-xl font-bold tracking-tight text-foreground sm:text-2xl`.
- **Subtítulos**: `text-xs text-muted-foreground` (evitar textos longos ou redundantes).
- **🚫 Sem Ações Duplicadas no Cabeçalho**: Se a página contém uma tabela de dados (`DataTable` ou `TransactionTable`), os botões de ação (como *"Novo Registro"*, *"Exportar"*) **NÃO DEVEM** ficar no cabeçalho superior; eles pertencem à barra de ferramentas da tabela.

---

## 4. Ordem e Estrutura dos Blocos em Telas Administrativas

As telas administrativas devem seguir a ordem canônica:

1. **Cabeçalho de Página**: Título e descrição textual.
2. **Grid de Indicadores (KPIs / Métricas)**: Cards de resumo em 4 colunas responsivas (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`).
3. **Área Principal de Conteúdo**:
   - Tabela com filtros e paginação (`DataTable`, `TransactionTable`), OU
   - Quadro de cartões (`KanbanBoard`), OU
   - Grade de agendamento (`Scheduler`), OU
   - Gráfico de visualização analítica (`ChartAreaInteractive`).
4. **Modais e Drawers de Contexto**: Componentes de criação, edição e detalhes renderizados na raiz do componente.

---

## 5. Exemplo de Tela Completa no Padrão do Template

```tsx
"use client"

import { useState } from "react"
import { AtlasAdminTemplate } from "@/layouts"
import { SectionCards } from "@/components/shadcn/dashboard/section-cards"
import { TransactionTable } from "@/components/shadcn/transactions/transaction-table"
import { TransactionDialog } from "@/components/shadcn/transactions/transaction-dialog"
import { INITIAL_TRANSACTIONS, type Transaction } from "@/components/shadcn/transactions/transaction-types"

export function ExemploTelaAdmin() {
  const [data, setData] = useState<Transaction[]>(INITIAL_TRANSACTIONS)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  return (
    <AtlasAdminTemplate title="Gestão de Receitas" activeView="transactions">
      <div className="flex flex-col gap-6">
        {/* 1. Cabeçalho */}
        <div className="flex flex-col gap-1 px-4 lg:px-6">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Gestão de Receitas
          </h1>
          <p className="text-xs text-muted-foreground">
            Acompanhe o faturamento mensal e gerencie cobranças em aberto.
          </p>
        </div>

        {/* 2. Métricas */}
        <SectionCards />

        {/* 3. Tabela com Ação de Cadastro Unificada */}
        <TransactionTable
          transactions={data}
          onNewTransaction={() => setIsDialogOpen(true)}
          onSelectTransaction={(tx) => console.log(tx)}
          onEditTransaction={(tx) => console.log(tx)}
          onDeleteTransaction={(id) => setData((p) => p.filter((x) => x.id !== id))}
          onToggleStatus={(id, status) => console.log(id, status)}
        />

        {/* 4. Modal de Cadastro */}
        <TransactionDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          onSave={(item) => console.log("Salvo:", item)}
        />
      </div>
    </AtlasAdminTemplate>
  )
}
```

---

## 6. Padrões Especiais de Tela

### A. Layout Split-Screen para Checkout e Compras
Para fluxos transacionais e de pagamento (como o `CheckoutView`):
- **Divisão Responsiva**: Em telas grandes (`lg:`), divida o grid em **7 ou 8 colunas** para o formulário multi-etapas (`AddressForm`, `PaymentForm`, `ReviewOrder`) e **5 ou 4 colunas** para o resumo lateral (`OrderSummary`).
- **Resumo Sticky**: O card lateral de resumo deve utilizar `lg:sticky lg:top-8` para acompanhar o preenchimento dos passos sem que o usuário perca de vista o valor total e as garantias.
- **Transição de Etapas**: Cada passo deve manter foco limpo no conteúdo ativo, com botão de retorno claro para a etapa anterior e avanço apenas após validação.

### B. Layout de Gerenciador de Arquivos (File Manager)
Para gestão de mídia, nuvem e documentos (como o `FileManagerView`):
- **Barra de Ferramentas Rica**: Inclui busca com debounce, filtros de tipo via botões em pílula (`Pills`), seletor de ordenação e alternador de visualização (`Grid` vs `List`).
- **Storage Overview**: Visão geral de capacidade posicionada no topo com barra segmentada colorida por categoria de arquivo.
- **Seção de Pastas e Arquivos**: Pastas organizadas em grid (`grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4`) seguidas da lista/grid de arquivos com seleção múltipla e barra flutuante de ações em lote.

### C. Layout de Backoffice e Central de Compliance
Para operações internas, esteira de risco, KYC e esteiras de suporte (como o `BackofficeView`):
- **Regra dos 5 Segundos**: O cabeçalho deve exibir o status do analista (`Disponível`, `Em Análise`, `Pausa`), ticker de saúde das integrações e KPIs essenciais (Fila Pendente, SLA, Risco Crítico, Disputas, Uptime).
- **Abas Operacionais Rápidas**: Navegação entre *Fila de Casos*, *Trilha de Auditoria (Audit Trail)* e *Saúde de Gateways*.
- **Padrão Split-Pane / Drawer Lateral (`CaseInspectorSheet`)**: Ao clicar em uma linha da tabela, a inspeção profunda deve abrir em um `Sheet` lateral direito, mantendo a fila visível ao fundo.
- **Justificativa Obrigatória em Ações Críticas**: Ações destrutivas ou de alto impacto regulatório (Reprovação, Bloqueio, Estorno) exigem abertura de `ActionReasonModal` com código padronizado (*Reason Code*) e parecer do analista gravado no log de auditoria.

### D. Layout de Internal Admin / Super Admin SaaS
Para gestão central de empresas, planos e métricas de consumo de plataforma (como o `InternalAdminView`):
- **Visão Macro de SaaS**: KPIs focados em Total de Empresas Ativas, MRR Consolidado, Empresas em Trial, Inadimplência e Quotas Críticas (≥80%).
- **Gestão de Tenants com Alta Densidade**: Tabela com controle de planos (`Starter`, `Pro`, `Enterprise`), status (`Ativo`, `Trial`, `Fatura Atrasada`, `Suspenso`), barras visuais de consumo de assentos/seats e armazenamento.
- **Drawer de Tenant (`TenantDetailsSheet`)**: Abas internas de Visão Geral, Quotas & Consumo, e Faturamento & Histórico de Faturas.
- **Recurso de Impersonation Seguro (`ImpersonateModal`)**: Acesso direto ao ambiente do cliente com aviso explícito de rastreabilidade e gravação em log de super-admin.

### E. Layout de Cadastro de Usuário e Onboarding Progressivo (User Registration)
Para páginas públicas de cadastro e micro-onboarding (como `SignupPage` e `SignupWizardCard`):
- **Layout Split-Screen 50/50**: Lado esquerdo com o formulário centrado (`max-w-md`), rim-light de 1px no topo do card e rodapé com copyright estático; lado direito com imagem institucional imersiva, depoimento de autoridade e selos de conformidade (SOC-2, ISO, LGPD).
- **Micro-Onboarding em 3 Etapas (Stepper)**:
  1. *Conta/Credenciais*: Social Auth (Google, GitHub), Nome, E-mail com detecção corporativa, Senha única com medidor inline de força (`PasswordStrengthMeter`) e termos.
  2. *Workspace*: Nome da empresa, slug/subdomínio automático em tempo real, seleção visual de tamanho de equipe em cards e cargo/função.
  3. *Equipe*: Adição rápida de colegas via tags/chips de e-mail e atalho de baixa fricção *"Pular esta etapa"*.
- **Eliminação de Campo Duplo**: Nunca exigir "Confirmar Senha". Utilizar campo único com botão de alternância de visibilidade (Eye/EyeOff) e medidor de força.

### F. Layout Reduzido de Carteira & Extrato (Cartões de Crédito e Contas Bancárias)
Para módulos financeiros com múltiplas contas bancárias ou cartões corporativos (como `CardStatementsView` e `BankAccountsView`), **nunca** renderize uma grade gigante de cartões acima do extrato. Utilize o **Arquétipo de Seletor Compacto em Carrossel + Veredito em 3 Colunas**:
- **Alternador de Modo no Cabeçalho (Pill Toggle)**: Permite alternar em 1 clique entre o modo operacional (`Extrato & Conciliação` / `Faturas`) e o modo gerencial (`Carteira de Contas` / `Meus Cartões`).
- **Barra Horizontal de Seleção em Carrossel (`SelectorBar`)**:
  - **1. Botão Fixo de Ação no Início (`shrink-0`)**: O botão de criação (`+ Nova Conta` ou `+ Novo Cartão`) deve ficar **sempre visível no início da barra** (à esquerda, antes do carrossel), com altura `h-[52px]`, borda tracejada `border-dashed border-primary/50`, fundo `bg-primary/5`, ícone `Plus` destacado e classe `shrink-0`. Isso garante que o botão nunca suma da tela nem exija rolagem lateral quando a lista de contas/cartões crescer.
  - **2. Divisor Visual**: Separador vertical sutil `<div className="h-8 w-px bg-border/70 shrink-0 hidden sm:block" />`.
  - **3. Chip Fixo de Visão Consolidada**: Chip destacado (`h-[52px] rounded-xl border px-3.5 py-2 shrink-0`) exibindo o saldo ou fatura total consolidada de todos os cartões/contas (`selectedId === ""`), permitindo alternância instantânea entre visão unificada e individual.
  - **4. Controles de Rolagem do Carrossel**: Botões laterais de navegação (`ChevronLeft` e `ChevronRight`) com rolagem programática suave (`scrollBy({ left: ±300, behavior: "smooth" })`).
  - **5. Trilho Rolável dos Itens**: Contêiner com `flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none snap-x flex-1 min-w-0`. Cada conta/cartão possui `h-[52px] snap-start`, mini avatar da instituição ou cartão com gradiente temático, apelido truncado com estrela (`Star`) para o padrão, e valor monetário em destaque tabular (`font-mono text-xs font-bold text-foreground tabular-nums`).
- **Card de Veredito em 3 Colunas (`SummaryHeader` — `grid-cols-1 lg:grid-cols-12`)**:
  - **Coluna 1 (`lg:col-span-5`)**: Identidade da conta/cartão selecionado, dados bancários copiáveis (Agência/Conta, Chave Pix ou final do cartão) e **Saldo Disponível / Total da Fatura** em destaque (`text-2xl sm:text-3xl font-bold font-mono tabular-nums`).
  - **Coluna 2 (`lg:col-span-4`)**: Indicadores de limite utilizado, barra de progresso (`h-2 rounded-full`) ou resumo de fluxo do período (`Entradas` vs `Saídas`) + status de sincronização Open Finance.
  - **Coluna 3 (`lg:col-span-3`)**: Ações contextuais empilhadas (`Pagar Fatura` / `Transferir`, `Importar OFX`, `Extrato PDF`).
- **Tabela de Lançamentos / Conciliação Unificada**: Posicionada logo abaixo do card de veredito, com filtros rápidos em pílula (`Todos`, `Entradas`, `Saídas`, `Pendentes de Conciliação`).

### G. Layout de Frente de Caixa de Alta Velocidade (PDV / POS Split-Screen)
Para terminais de Ponto de Venda e operação assistida por teclado (como `PDVView`):
- **Viewport Travada sem Scroll de Página**: Container raiz com `flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background`. O scroll ocorre exclusivamente dentro do catálogo de produtos e da lista de itens do carrinho.
- **Topbar Operacional do Caixa (`PDVHeader`)**: Exibe número do terminal, badge pulsante `CAIXA ABERTO`, operador ativo, cliente vinculado (CPF/CNPJ na nota) e botões rápidos para `Sangria / Suprimento (F7)` e `Fechar Caixa (F10)`.
- **Divisão 8/4 Colunas (`lg:grid-cols-12`)**:
  - **Esquerda (`lg:col-span-7 xl:col-span-8`)**: Input de busca/leitor de código de barras EAN-13 com foco prioritário (`F2`), filtros de categoria em pílulas horizontais e grade densa de produtos com badge de estoque e SKU em `font-mono`.
  - **Direita (`lg:col-span-5 xl:col-span-4`)**: Cupom Fiscal Ativo (`PDVCart`) com lista numerada de itens, ajuste rápido de quantidade (`-`/`+`), subtotal, descontos e bloco de **Total a Pagar** em alto contraste + CTA `Finalizar Venda (F9)`.
- **Rodapé Sticky de Atalhos (`PDVHotkeysFooter`)**: Barra fixa inferior listando os atalhos de teclado (`F2` a `F10`) sincronizados com listener global `keydown` (desativado automaticamente quando uma modal está aberta ou o foco está em inputs de formulário).

---

## 7. Anti-Patterns (O que NÃO fazer)

- ❌ **NÃO colocar `max-w-7xl` ou `container mx-auto` com padding aleatório** dentro do `<main>`. Use sempre `px-4 lg:px-6`.
- ❌ **NÃO usar cores fixas como `#ffffff` ou `#000000`**. Use `bg-background` e `text-foreground`.
- ❌ **NÃO duplicar botões de ação principais** no cabeçalho e na tabela simultaneamente.
- ❌ **NÃO omitir o breadcrumb ou o título da tela**. O `title` passado para o `AtlasAdminTemplate` alimenta o topo da página e a aba do navegador.


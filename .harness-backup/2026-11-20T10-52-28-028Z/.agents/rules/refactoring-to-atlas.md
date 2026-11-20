# Regras: Refatoração e Migração para o Atlas Admin Template (refactoring-to-atlas.md)

Este documento estabelece o protocolo obrigatório para **refatorar telas legadas, componentes avulsos ou páginas fora do padrão** para a arquitetura e identidade visual do **Atlas Admin Template (`shadcn`)**.

---

## 1. Diagnóstico Inicial (Checklist de Auditoria Pré-Refatoração)

Antes de alterar qualquer linha de código em uma tela existente, audite os **7 desvios clássicos**:

1. **Shell Ausente ou Customizado**: A página renderiza uma sidebar/navbar própria ou usa `<div className="min-h-screen bg-gray-100 p-8">` em vez de `<AtlasAdminTemplate>`.
2. **Cores Hardcoded / Paletas Fixas**: Uso de `bg-white`, `bg-slate-50`, `bg-gray-900`, `text-gray-600`, `border-slate-200` ou valores hexadecimais (`#f8fafc`) que quebram o Modo Escuro (`.dark`).
3. **Alinhamento Horizontal Quebrado**: Uso de `container mx-auto`, `max-w-7xl` ou `p-8` desalinhado do `SiteHeader` (o padrão obrigatório é `px-4 lg:px-6`).
4. **Poluição de Botões Duplicados**: Botão `+ Novo Registro` repetido no cabeçalho superior da página e novamente acima da tabela.
5. **Grades Gigantes de Cards Financeiros**: Múltiplos cards grandes de contas bancárias ou cartões de crédito empurrando a tabela de lançamentos para fora da dobra da tela (*below the fold*).
6. **Números sem Alinhamento Tabular**: Valores em `R$`, saldos, datas e códigos sem `font-mono tabular-nums`.
7. **Modais e Formulários Desalinhados**: Modais com `max-w-3xl` cheias de espaço vazio, `SelectTrigger` encolhido (`w-fit`), rodapés com botões colados ou strings longas (Pix/hashes) estourando a largura da modal por falta de `min-w-0`.

---

## 2. Tabela de Conversão de Classes (Legado → Tokens Semânticos Atlas)

Substitua sistematicamente todas as classes legadas conforme o mapa abaixo:

| Elemento / Contexto | ❌ Classe Legada / Proibida | ✅ Padrão Oficial Atlas Admin (`shadcn`) |
| :--- | :--- | :--- |
| **Fundo de Página** | `bg-white`, `bg-gray-50`, `bg-slate-100`, `bg-[#f8fafc]` | `bg-background text-foreground` |
| **Superfície de Card / Painel** | `bg-white shadow-lg rounded-2xl border-gray-200` | `bg-card text-card-foreground border border-border/70 shadow-xs rounded-xl` |
| **Fundo Secundário / Header Tabela** | `bg-gray-100`, `bg-slate-50`, `dark:bg-slate-800` | `bg-muted/30` ou `bg-muted/40` |
| **Texto Principal** | `text-gray-900`, `text-slate-800`, `text-black` | `text-foreground` |
| **Texto Secundário / Subtítulo** | `text-gray-500`, `text-slate-400` | `text-muted-foreground` |
| **Bordas e Divisórias** | `border-gray-200`, `border-slate-300`, `divide-gray-200` | `border-border/70`, `border-border/80`, `divide-border/60` |
| **Wrapper de Conteúdo da View** | `container mx-auto p-6 max-w-7xl space-y-8` | `flex flex-col gap-6 px-4 lg:px-6` |
| **Título da Página (`<h1>`)** | `text-3xl font-extrabold text-gray-900` | `text-xl font-bold tracking-tight text-foreground sm:text-2xl` |
| **Valores Monetários / Saldos / Datas** | `font-sans font-bold` | `font-mono tabular-nums font-semibold` (ou `font-bold`) |
| **Badge Positivo (Pago / Receita)** | `bg-green-500 text-white` ou `bg-green-100 text-green-800` | `border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400` |
| **Badge Pendente / Alerta** | `bg-yellow-500 text-white` ou `bg-yellow-100 text-yellow-800` | `border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400` |
| **Badge Negativo (Vencido / Erro)** | `bg-red-500 text-white` ou `bg-red-100 text-red-800` | `border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400` |

---

## 3. Passo a Passo de Refatoração Estrutural

### Passo 1: Envolver no Shell `AtlasAdminTemplate`
Se a tela é uma página inteira isolada, extraia o miolo para um componente `*View.tsx` (ex: `MinhaFeatureView.tsx`) com `flex flex-col gap-6 px-4 lg:px-6` e renderize-o dentro de `<AtlasAdminTemplate title="..." activeView="...">`.

### Passo 2: Escolher e Aplicar o Arquétipo Correto
- **Listagem CRUD / Relatório Financeiro** → Converta para **Arquétipo 1**:
  1. Cabeçalho limpo (`<h1>` + `<p>`).
  2. 4 KPIs no topo (`grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4`).
  3. Tabela emoldurada (`rounded-xl border border-border/70 bg-card shadow-xs`) com barra `<search>` contendo filtros à esquerda e `Exportar` + `+ Novo Registro` à direita.
- **Gestão de Contas Bancárias, Cartões ou Carteiras Múltiplas** → Converta para **Arquétipo 2 (Layout Reduzido)**:
  1. Substitua grids de cartões gigantes por uma **Barra Horizontal de Chips (`SelectorBar`)** (`overflow-x-auto scrollbar-none`).
  2. Adicione abaixo um **Card de Veredito em 3 Colunas (`SummaryHeader` — `lg:grid-cols-12`)** exibindo saldo/fatura da entidade selecionada (`lg:col-span-5`), limites/fluxo (`lg:col-span-4`) e botões de ação rápida (`lg:col-span-3`).
  3. Posicione o extrato/lançamentos logo abaixo, adicionando um toggle no cabeçalho da página para alternar entre `Extrato` e `Carteira Completa`.
- **Operação de Caixa / Balcão / Atendimento Rápido** → Converta para **Arquétipo 3 (PDV Split-Screen)**:
  1. Trave a altura em `h-[calc(100vh-4rem)] overflow-hidden`.
  2. Divida em `lg:grid-cols-12` (`lg:col-span-8` catálogo + leitor de código de barras; `lg:col-span-4` cupom ativo + totalizador) e adicione barra inferior de atalhos `F2..F10`.
- **Fila de Compliance / Suporte / Gestão de Tenants** → Converta para **Arquétipo 4 (Master-Detail com `Sheet`)**:
  1. Mantenha a tabela densa na tela principal e mova os detalhes profundos de modais gigantes para um `Sheet` lateral direito (`side="right" sm:max-w-md` ou `sm:max-w-lg`).

### Passo 3: Refatorar Formulários e Modais
1. Redimensione modais exageradas (`max-w-2xl`, `max-w-4xl`) para `w-full sm:max-w-xl` (cadastros de 2 colunas) ou `w-full sm:max-w-[480px]` (pagamentos/confirmações).
2. Adicione `max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6` em todos os `DialogContent`.
3. Garanta `w-full h-10` em todos os `<Input>` e `<SelectTrigger>` dentro de grids.
4. Em blocos com códigos copiáveis (Pix, Boleto, Chave API, URL), adicione `min-w-0` no container flex pai e `truncate` no texto para impedir estouro horizontal da modal.
5. Corrija o `DialogFooter` para `mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0`.

### Passo 4: Executar o Gate de Verificação
Ao concluir a refatoração, execute obrigatoriamente:
```bash
bash scripts/verify.sh
```
Corrija qualquer alerta do `oxlint` (como `no-explicit-any` ou falta de `key`) e qualquer erro do `tsc --noEmit` antes de finalizar a entrega.


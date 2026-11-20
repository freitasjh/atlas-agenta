# Regras: Cards e Indicadores de Métricas (cards-and-metrics.md)

Este documento estabelece as diretrizes para desenvolvimento de **Cards de Indicadores (KPIs)**, cartões de resumo analítico e contêineres de informação no padrão do template Atlas.

---

## 1. Grid Responsivo de KPIs

A grade de cartões de indicadores deve sempre ocupar a largura completa, respeitando o padding padrão de alinhamento:

```tsx
<div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
  {/* 4 Cards de Métricas */}
</div>
```

- **Mobile (1 coluna)**: `grid-cols-1` para leitura vertical sem quebra de texto.
- **Tablet (2 colunas)**: `sm:grid-cols-2` com proporções quadradas.
- **Desktop (4 colunas)**: `lg:grid-cols-4` com espaçamento uniforme de `gap-4`.

---

## 2. Estrutura Padrão de um Card de Métrica

```tsx
import { ArrowUpRight } from "lucide-react"
import { Card, CardContent } from "@/components/shadcn/ui/card"

export function MetricCard() {
  return (
    <Card className="border-border/70 shadow-xs">
      <CardContent className="p-4 sm:p-5">
        {/* Cabeçalho do Card: Rótulo + Ícone Semântico */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Receita Total
          </span>
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <ArrowUpRight className="size-4" />
          </div>
        </div>

        {/* Valor em Destaque e Texto Auxiliar */}
        <div className="mt-3">
          <div className="text-2xl font-bold tracking-tight text-foreground">
            R$ 45.280,00
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            +12.5% em relação ao mês anterior
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
```

---

## 3. Diretrizes de Cores e Semântica de Ícones

Nunca utilize cores puras saturadas. Utilize sempre **fundos com opacidade (10% a 15%)** associados ao texto com contraste adequado:

| Tipo de Métrica | Classe do Contêiner do Ícone | Cor do Texto/Valor |
| :--- | :--- | :--- |
| **Receitas / Positivo** | `bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400` | `text-emerald-600 dark:text-emerald-400` |
| **Despesas / Custos** | `bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400` | `text-rose-600 dark:text-rose-400` |
| **Pendências / Alertas** | `bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400` | `text-amber-600 dark:text-amber-400` |
| **Neutro / Patrimônio** | `bg-primary/10 text-primary` | `text-foreground` |

> [!IMPORTANT]
> **Acessibilidade WCAG**: Nunca dependa unicamente da cor para indicar variação positiva ou negativa. Inclua sempre um ícone (`ArrowUpRight` ou `ArrowDownRight`) ou sinal explícito (`+` ou `-`).

---

## 4. Cards de Conteúdo Complexo (`CardHeader`, `CardContent`, `CardFooter`)

Para cartões que abrigam formulários, tabelas ou gráficos:

```tsx
<Card className="border-border/70 shadow-xs">
  <CardHeader className="pb-3">
    <CardTitle className="text-base font-semibold text-foreground">
      Título do Card
    </CardTitle>
    <CardDescription className="text-xs text-muted-foreground">
      Descrição auxiliar do propósito deste painel.
    </CardDescription>
  </CardHeader>
  <CardContent className="pt-0">
    {/* Conteúdo, gráfico ou lista */}
  </CardContent>
  <CardFooter className="border-t border-border/60 py-3 text-xs text-muted-foreground">
    {/* Rodapé ou ações */}
  </CardFooter>
</Card>
```

---

## 5. Barra Seletora em Carrossel com Ação Fixa (`SelectorBar`)

Para seletores de entidades financeiras (contas bancárias, cartões de crédito, filiais ou carteiras), utilize a **Barra de Seleção em Carrossel Padronizada**:

```tsx
<div className="relative flex items-center gap-2 w-full">
  {/* 1. Botão Fixo de Adicionar (Sempre no início, shrink-0) */}
  <Button
    type="button"
    size="sm"
    onClick={onAdd}
    className="h-[52px] px-3.5 text-xs font-semibold gap-2 border border-dashed border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary shrink-0 rounded-xl shadow-2xs transition-all hover:border-primary cursor-pointer"
  >
    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-xs">
      <Plus className="h-4 w-4" />
    </div>
    <span className="hidden sm:inline font-bold">Novo Item</span>
  </Button>

  {/* Divisor Visual */}
  <div className="h-8 w-px bg-border/70 shrink-0 hidden sm:block" />

  {/* 2. Chip Fixo de Visão Consolidada */}
  <button
    type="button"
    onClick={() => onSelect("")}
    className={cn(
      "flex items-center gap-2.5 px-3.5 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs",
      isSelectedAll ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/80 bg-card hover:bg-muted/50"
    )}
  >
    {/* Ícone + Título + Valor Consolidado em font-mono tabular-nums */}
  </button>

  {/* 3. Controles Chevron Esquerda/Direita + Trilho Rolável */}
  <Button size="icon" onClick={() => scroll("left")} className="h-8 w-8 rounded-lg shrink-0">
    <ChevronLeft className="h-4 w-4" />
  </Button>

  <div ref={scrollRef} className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none snap-x flex-1 min-w-0">
    {/* Itens com h-[52px] e snap-start */}
  </div>

  <Button size="icon" onClick={() => scroll("right")} className="h-8 w-8 rounded-lg shrink-0">
    <ChevronRight className="h-4 w-4" />
  </Button>
</div>
```

---

## 6. Anti-Patterns em Cards

- ❌ **NÃO colocar o botão de adicionar no final do carrossel**. Quando houver muitas contas/cartões, o botão desaparece da tela. Coloque-o **sempre fixo no início**.
- ❌ **NÃO usar sombras pesadas** (`shadow-xl`, `shadow-2xl` com opacidade escura). Use `shadow-xs` ou `shadow-sm`.
- ❌ **NÃO usar bordas sólidas pesadas** (`border-2 border-black`). O padrão do template é `border border-border/70`.
- ❌ **NÃO usar gradientes coloridos chamativos** como fundo do card. Os cards no perfil shadcn são superfícies limpas e sólidas (`bg-card`).


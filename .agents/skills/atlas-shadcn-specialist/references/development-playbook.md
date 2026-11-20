# Playbook de Desenvolvimento Greenfield — Atlas Admin Template (`shadcn`)

Este guia contém os blueprints canônicos prontos para uso na construção de novas telas, módulos e componentes dentro do **Atlas Admin Template**.

---

## 1. Blueprint: Arquétipo 1 — Tela Operacional Analítica (KPIs + Tabela Unificada)

Use para módulos de Gestão Financeira, Clientes, Pedidos, Notas Fiscais, Estoque ou Relatórios.

```tsx
"use client"

import { useState, useMemo } from "react"
import { Plus, Search, Download, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/shadcn/ui/card"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Badge } from "@/components/shadcn/ui/badge"

export function OperationalModuleView() {
  const [search, setSearch] = useState("")

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 lg:px-6">
      {/* 1. Cabeçalho da Seção (Sem botão duplicado se houver tabela abaixo) */}
      <div className="flex flex-col gap-1 border-b border-border/70 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Título do Módulo Operacional
        </h1>
        <p className="text-xs text-muted-foreground">
          Descrição clara e objetiva do propósito operacional desta visualização.
        </p>
      </div>

      {/* 2. Grid de 4 KPIs Semânticos */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/70 bg-card shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Receita Consolidada</span>
              <div className="flex size-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <ArrowUpRight className="size-4" />
              </div>
            </div>
            <div className="mt-2.5">
              <p className="font-mono text-xl font-bold tracking-tight text-foreground tabular-nums sm:text-2xl">
                R$ 128.450,00
              </p>
              <span className="mt-1 inline-block text-[11px] text-muted-foreground">
                +14,2% vs. mês anterior
              </span>
            </div>
          </CardContent>
        </Card>
        {/* Demais 3 cards seguindo a mesma estrutura... */}
      </div>

      {/* 3. Tabela com Barra <search> e Regra da Ação Única */}
      <Card className="border-border/70 bg-card shadow-xs overflow-hidden">
        <div className="border-b border-border/70 p-4">
          <search
            aria-label="Buscar e filtrar registros"
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por descrição, código..."
                className="h-9 pl-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => toast.success("Exportação iniciada")}
                className="h-8 gap-1.5 text-xs"
              >
                <Download className="size-3.5" />
                Exportar CSV
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold"
              >
                <Plus className="size-3.5" />
                Novo Registro
              </Button>
            </div>
          </search>
        </div>

        {/* Corpo da tabela com valores em font-mono tabular-nums */}
        <div className="overflow-x-auto">
          {/* <Table> ... </Table> */}
        </div>

        {/* Rodapé informativo obrigatório */}
        <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <span>Mostrando <strong>10</strong> de <strong>10</strong> registros</span>
          <span className="text-[11px]">Valores expressos em BRL (R$)</span>
        </div>
      </Card>
    </div>
  )
}
```

---

## 2. Blueprint: Arquétipo 2 — Carteira & Extrato Reduzido (`SelectorBar` em Carrossel + `SummaryHeader`)

Use para **Cartões de Crédito (`src/components/shadcn/credit-card`)**, **Contas Bancárias (`src/components/shadcn/bank-accounts`)**, **Cofres**, **Centros de Custo** ou **Filiais**.

### Anatomia Obrigatória:
1. **Cabeçalho com Pill Toggle**: Alterna entre `viewMode === "statement"` (Extrato Operacional Reduzido) e `viewMode === "wallet"` (Grade de Gestão da Carteira).
2. **Barra Horizontal de Seleção em Carrossel (`SelectorBar`)**:
   ```tsx
   <div className="relative flex items-center gap-2 w-full">
     {/* 1. Botão Fixo de Ação no Início (Sempre visível à esquerda, shrink-0) */}
     <Button
       type="button"
       size="sm"
       onClick={onAddNew}
       className="h-[52px] px-3.5 text-xs font-semibold gap-2 border border-dashed border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary shrink-0 rounded-xl shadow-2xs transition-all hover:border-primary cursor-pointer"
     >
       <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 shadow-xs">
         <Plus className="h-4 w-4" />
       </div>
       <span className="hidden sm:inline font-bold">Novo Item</span>
     </Button>

     <div className="h-8 w-px bg-border/70 shrink-0 hidden sm:block" />

     {/* 2. Chip de Visão / Fatura Consolidada */}
     <button
       type="button"
       onClick={() => onSelect("")}
       className={cn(
         "flex items-center gap-2.5 px-3.5 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs",
         isConsolidatedSelected ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/80 bg-card hover:bg-muted/50"
       )}
     >
       {/* Ícone + Título + Total Consolidado em font-mono tabular-nums */}
     </button>

     {/* 3. Controles Chevron Esquerda/Direita + Trilho Rolável */}
     <Button size="icon" onClick={() => scroll("left")} className="h-8 w-8 rounded-lg shrink-0">
       <ChevronLeft className="h-4 w-4" />
     </Button>

     <div ref={scrollRef} className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none snap-x flex-1 min-w-0">
       {items.map((item) => (
         <button
           key={item.id}
           type="button"
           onClick={() => onSelect(item.id)}
           className={cn(
             "group relative flex items-center gap-2.5 px-3 py-2 h-[52px] rounded-xl border text-left transition-all shrink-0 cursor-pointer shadow-2xs snap-start",
             item.id === selectedId ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border/80 bg-card hover:bg-muted/50"
           )}
         >
           {/* Mini avatar ou cartão temático + Nome truncado com Star + Valor em font-mono */}
         </button>
       ))}
     </div>

     <Button size="icon" onClick={() => scroll("right")} className="h-8 w-8 rounded-lg shrink-0">
       <ChevronRight className="h-4 w-4" />
     </Button>
   </div>
   ```
3. **Card de Veredito em 3 Colunas (`SummaryHeader` — `grid-cols-1 lg:grid-cols-12`)**:
   - `lg:col-span-5`: Identidade da conta/cartão + Saldo/Fatura em `font-mono text-2xl sm:text-3xl font-bold tabular-nums`.
   - `lg:col-span-4`: Limite/Cheque Especial (`Progress h-2`) ou Fluxo do Mês (`Entradas` vs `Saídas`) + Status Open Finance.
   - `lg:col-span-3`: Botão de ação primária (`Pagar Fatura` / `Transferir`) + 2 botões secundários em grid (`grid-cols-2 gap-2`).
4. **Tabela de Lançamentos / Conciliação**: Logo abaixo do card de veredito, sem precisar rolar a página.

---

## 3. Blueprint: Arquétipo 3 — Frente de Caixa Split-Screen (PDV / POS)

Use para terminais de venda rápida (`src/components/shadcn/pdv`):
- **Container Raiz**: `flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background`.
- **Topbar (`PDVHeader`)**: Status do caixa (`ABERTO` / `FECHADO`), operador, cliente vinculado e botões `Sangria / Suprimento` e `Fechar Caixa`.
- ** Área Central (`grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12`)**:
  - **Catálogo (`lg:col-span-7 xl:col-span-8`)**: Barra de leitura de código de barras EAN com ref de foco (`F2`), pílulas de categoria e grid rolável de produtos (`overflow-y-auto p-4`).
  - **Cupom Ativo (`lg:col-span-5 xl:col-span-4`)**: Lista de itens numerada (`01`, `02`...), controles `+/-`, subtotal, desconto e bloco de **Total a Pagar** em `font-mono text-3xl font-black tabular-nums` + botão `Finalizar Venda (F9)`.
- **Rodapé (`PDVHotkeysFooter`)**: Barra fixa listando `F2`..`F10`.

---

## 4. Blueprint: Modal Blindada Contra Overflow (`Dialog`)

Toda modal de pagamento, Pix, boleto ou cadastro deve seguir este contrato:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
    <DialogHeader>
      <DialogTitle className="text-base font-bold text-foreground sm:text-lg">
        Título da Modal
      </DialogTitle>
      <DialogDescription className="text-xs text-muted-foreground">
        Subtítulo explicativo conciso.
      </DialogDescription>
    </DialogHeader>

    {/* Corpo com min-w-0 obrigatório para evitar estouro de strings longas */}
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 w-full items-center gap-2">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-muted/40 px-3 py-2">
          <p className="truncate font-mono text-xs text-muted-foreground select-all">
            {longUnbrokenCodeString}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-9 shrink-0 px-3 text-xs font-semibold">
          Copiar
        </Button>
      </div>
    </div>

    <DialogFooter className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0">
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
        Cancelar
      </Button>
      <Button type="submit" className="font-semibold">
        Confirmar
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```


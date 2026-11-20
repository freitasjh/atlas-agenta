import { useState, useMemo } from "react"
import {
  Search,
  Filter,
  Calendar,
  Clock,
  MapPin,
  Tag,
  CreditCard,
  AlertTriangle,
  Receipt,
  Server,
  ShoppingBag,
  Utensils,
  Car,
  Laptop,
  HeartPulse,
} from "lucide-react"
import { Input } from "@/components/shadcn/ui/input"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/shadcn/ui/sheet"
import { cn } from "@/lib/cn"
import type { CardExpenseItem } from "./statement-types"

interface CardExpensesTableProps {
  expenses: CardExpenseItem[]
  cardLast4: string
  className?: string
}

export function CardExpensesTable({
  expenses,
  cardLast4,
  className,
}: CardExpensesTableProps) {
  const [search, setSearch] = useState("")
  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [selectedExpense, setSelectedExpense] = useState<CardExpenseItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Categorias únicas
  const categories = useMemo(() => {
    const set = new Set<string>()
    expenses.forEach((e) => set.add(e.category))
    return Array.from(set)
  }, [expenses])

  // Filtragem dos lançamentos
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (selectedCategory !== "all" && e.category !== selectedCategory) {
        return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const matchesName = e.merchantName.toLowerCase().includes(q)
        const matchesCat = e.category.toLowerCase().includes(q)
        const matchesLoc = e.location?.toLowerCase().includes(q)
        if (!matchesName && !matchesCat && !matchesLoc) return false
      }
      return true
    })
  }, [expenses, selectedCategory, search])

  const formatBRL = (val: number) => {
    const isCredit = val > 0
    const formatted = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Math.abs(val))
    return `${isCredit ? "+ " : ""}${formatted}`
  }

  // Ícone de categoria
  const getCategoryIcon = (cat: CardExpenseItem["category"]) => {
    switch (cat) {
      case "Infraestrutura":
        return <Server className="h-4 w-4 text-blue-500" />
      case "E-commerce":
        return <ShoppingBag className="h-4 w-4 text-amber-500" />
      case "Transporte":
        return <Car className="h-4 w-4 text-emerald-500" />
      case "Alimentação":
        return <Utensils className="h-4 w-4 text-orange-500" />
      case "Software":
        return <Laptop className="h-4 w-4 text-purple-500" />
      case "Saúde":
        return <HeartPulse className="h-4 w-4 text-rose-500" />
      default:
        return <Tag className="h-4 w-4 text-muted-foreground" />
    }
  }

  const handleRowClick = (expense: CardExpenseItem) => {
    setSelectedExpense(expense)
    setDrawerOpen(true)
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Barra de Busca e Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por estabelecimento, categoria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-xs h-9 w-full"
          />
        </div>

        {/* Chips de Categoria */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <Button
            type="button"
            variant={selectedCategory === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory("all")}
            className="text-xs font-semibold h-8 rounded-full"
          >
            Todos ({filteredExpenses.length})
          </Button>

          {categories.map((cat) => (
            <Button
              key={cat}
              type="button"
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(selectedCategory === cat ? "all" : cat)}
              className="text-xs font-semibold h-8 rounded-full shrink-0"
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Lista / Feed de Lançamentos */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-xs">
        {filteredExpenses.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Filter className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs font-semibold text-foreground">
              Nenhum lançamento encontrado
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Tente redefinir sua busca ou os filtros de categoria.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {filteredExpenses.map((item) => {
              const isCredit = item.amount > 0

              return (
                <div
                  key={item.id}
                  onClick={() => handleRowClick(item)}
                  className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-muted/40 transition-colors cursor-pointer group"
                >
                  {/* Ícone de Categoria + Dados do Comerciante */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/50 group-hover:bg-background transition-colors">
                      {getCategoryIcon(item.category)}
                    </div>

                    <div className="min-w-0">
                      <span className="text-xs font-bold text-foreground block truncate group-hover:text-primary transition-colors">
                        {item.merchantName}
                      </span>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span className="truncate">{item.category}</span>
                        <span>•</span>
                        <span>
                          {item.date.split("-").reverse().join("/")} às {item.time}
                        </span>
                        {item.installments && (
                          <>
                            <span>•</span>
                            <span className="font-semibold text-foreground/80">
                              Parcela {item.installments.current}/{item.installments.total}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Valor Financeiro Tabular */}
                  <div className="text-right shrink-0 pl-3">
                    <span
                      className={cn(
                        "font-mono text-xs sm:text-sm font-bold block",
                        isCredit
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-foreground"
                      )}
                    >
                      {formatBRL(item.amount)}
                    </span>
                    <span className="text-[10px] text-muted-foreground block font-mono">
                      •••• {cardLast4}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Drawer / Sheet de Detalhes do Lançamento */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="sm:max-w-md p-0 flex flex-col">
          {selectedExpense && (
            <>
              <SheetHeader className="p-5 border-b border-border/80 sticky top-0 bg-background/95 backdrop-blur-md z-10">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs font-semibold gap-1">
                    {getCategoryIcon(selectedExpense.category)}
                    {selectedExpense.category}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    ID: {selectedExpense.id}
                  </span>
                </div>

                <SheetTitle className="text-lg font-bold tracking-tight text-foreground text-left mt-2">
                  {selectedExpense.merchantName}
                </SheetTitle>
                <SheetDescription className="text-xs text-left">
                  Transação processada no cartão terminado em •••• {cardLast4}
                </SheetDescription>
              </SheetHeader>

              <div className="p-5 flex-1 space-y-5 overflow-y-auto">
                {/* Destaque do Valor */}
                <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-center">
                  <span className="text-xs text-muted-foreground block">Valor do Lançamento</span>
                  <span
                    className={cn(
                      "font-mono text-2xl font-extrabold block mt-0.5",
                      selectedExpense.amount > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-foreground"
                    )}
                  >
                    {formatBRL(selectedExpense.amount)}
                  </span>
                  {selectedExpense.installments && (
                    <Badge variant="secondary" className="mt-2 text-[10px] font-semibold">
                      Compra Parcelada em {selectedExpense.installments.total}x (Você está na {selectedExpense.installments.current}ª)
                    </Badge>
                  )}
                </div>

                {/* Metadados da Transação */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Dados do Lançamento
                  </h4>

                  <div className="rounded-xl border border-border/70 p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-primary" />
                        Data da Compra:
                      </span>
                      <span className="font-semibold text-foreground">
                        {selectedExpense.date.split("-").reverse().join("/")}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-primary" />
                        Horário:
                      </span>
                      <span className="font-semibold text-foreground">
                        {selectedExpense.time}
                      </span>
                    </div>

                    {selectedExpense.location && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-primary" />
                          Local / Origem:
                        </span>
                        <span className="font-semibold text-foreground">
                          {selectedExpense.location}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5 text-primary" />
                        Cartão Utilizado:
                      </span>
                      <span className="font-mono font-bold text-foreground">
                        •••• {cardLast4}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Notas ou Observações */}
                {selectedExpense.notes && (
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Notas da Despesa
                    </h4>
                    <p className="text-xs text-foreground bg-muted/40 p-3 rounded-lg border border-border/60 leading-relaxed">
                      {selectedExpense.notes}
                    </p>
                  </div>
                )}

                {/* Ações de Contestação ou Suporte */}
                <div className="pt-2 space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full text-xs font-semibold gap-1.5 h-9"
                    onClick={() => alert("Comprovante digital emitido com sucesso.")}
                  >
                    <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                    Visualizar Recibo Fiscal
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5 h-9"
                    onClick={() =>
                      alert("Solicitação de contestação encaminhada para análise antifraude.")
                    }
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Não reconheço esta compra (Contestar)
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

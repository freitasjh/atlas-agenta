import { useState, useRef, useEffect } from "react"
import {
  Search,
  Barcode,
  Layers,
  Coffee,
  Utensils,
  Croissant,
  Cookie,
  Package,
  Plus,
} from "lucide-react"
import { Input } from "@/components/shadcn/ui/input"
import { Badge } from "@/components/shadcn/ui/badge"
import { cn } from "@/lib/cn"
import type { PDVProduct, ProductCategory } from "./pdv-types"

interface PDVProductCatalogProps {
  products: PDVProduct[]
  onSelectProduct: (product: PDVProduct) => void
  onBarcodeScan?: (code: string) => void
  focusSearchTrigger?: number
}

const CATEGORIES: { id: ProductCategory; label: string; icon: typeof Layers }[] = [
  { id: "all", label: "Todos", icon: Layers },
  { id: "beverages", label: "Bebidas", icon: Coffee },
  { id: "food", label: "Lanches & Refeições", icon: Utensils },
  { id: "bakery", label: "Padaria", icon: Croissant },
  { id: "snacks", label: "Snacks & Doces", icon: Cookie },
  { id: "grocery", label: "Mercearia", icon: Package },
]

export function PDVProductCatalog({
  products,
  onSelectProduct,
  onBarcodeScan,
  focusSearchTrigger,
}: PDVProductCatalogProps) {
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory>("all")
  const [searchTerm, setSearchTerm] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Dá foco no input quando o atalho F2 é acionado
  useEffect(() => {
    if (focusSearchTrigger) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [focusSearchTrigger])

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  // Filtragem rápida
  const filteredProducts = products.filter((prod) => {
    const matchesCategory =
      selectedCategory === "all" || prod.category === selectedCategory
    const searchLower = searchTerm.toLowerCase().trim()
    const matchesSearch =
      !searchLower ||
      prod.name.toLowerCase().includes(searchLower) ||
      prod.sku.toLowerCase().includes(searchLower) ||
      prod.ean.includes(searchLower)

    return matchesCategory && matchesSearch
  })

  // Ao pressionar Enter no input de busca
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchTerm.trim()) {
      e.preventDefault()
      // Se digitou ou bipou um código exato de barras ou SKU
      const exactMatch = products.find(
        (p) =>
          p.ean === searchTerm.trim() ||
          p.sku.toLowerCase() === searchTerm.trim().toLowerCase()
      )

      if (exactMatch) {
        onSelectProduct(exactMatch)
        setSearchTerm("")
      } else if (filteredProducts.length === 1 && filteredProducts[0]) {
        onSelectProduct(filteredProducts[0])
        setSearchTerm("")
      } else if (onBarcodeScan) {
        onBarcodeScan(searchTerm.trim())
        setSearchTerm("")
      }
    }
  }

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Barra de Leitor de Código de Barras e Busca Rápida */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-muted-foreground">
          <Barcode className="h-5 w-5 text-primary" />
        </div>
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="Bipe o código de barras (EAN), digite o SKU ou pesquise por nome... [F2]"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-11 pr-10 h-11 text-sm bg-background border-border/80 shadow-xs focus-visible:ring-primary/40"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs text-muted-foreground hover:text-foreground"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Categorias em Chips Horizontais */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon
          const isSelected = selectedCategory === cat.id
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all border",
                isSelected
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-muted/40 text-muted-foreground border-border/70 hover:bg-muted hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{cat.label}</span>
            </button>
          )
        })}
      </div>

      {/* Grid de Produtos */}
      <div className="flex-1 overflow-y-auto pr-1">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground">
            <Search className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm font-semibold">Nenhum produto encontrado</p>
            <p className="text-xs">
              Verifique o código digitado ou tente outro termo de busca.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => onSelectProduct(product)}
                className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-sm active:scale-[0.98] cursor-pointer"
              >
                {/* Badge promocional / categoria */}
                <div className="flex items-start justify-between gap-1 w-full mb-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {product.sku}
                  </span>
                  {product.badge && (
                    <Badge
                      variant="secondary"
                      className="text-[9px] px-1.5 py-0 font-semibold bg-primary/10 text-primary border-transparent"
                    >
                      {product.badge}
                    </Badge>
                  )}
                </div>

                {/* Nome do Produto */}
                <h3 className="text-xs font-bold text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors mb-2">
                  {product.name}
                </h3>

                {/* Preço e Estoque */}
                <div className="flex items-end justify-between pt-2 border-t border-border/60 w-full">
                  <div>
                    <span className="text-[10px] text-muted-foreground block">
                      Estoque: {product.stock} {product.unit}
                    </span>
                    <span className="font-mono text-sm font-extrabold text-foreground tabular-nums">
                      {formatBRL(product.price)}
                    </span>
                  </div>

                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                    <Plus className="h-4 w-4" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


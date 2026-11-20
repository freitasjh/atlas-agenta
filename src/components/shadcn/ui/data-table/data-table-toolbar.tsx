"use client"

import * as React from "react"
import { Search, X } from "lucide-react"
import type { RowData } from "@tanstack/react-table"

import { Input } from "@/components/shadcn/ui/input"
import { Button } from "@/components/shadcn/ui/button"
import { DataTableViewOptions } from "./data-table-view-options"
import type { DataTableInstance } from "./data-table-types"

interface DataTableToolbarProps<TData extends RowData> {
  table: DataTableInstance<TData>
  searchKey?: string
  searchPlaceholder?: string
  searchAriaLabel?: string
  toolbarFilters?: React.ReactNode
  toolbarActions?: React.ReactNode
  enableColumnVisibility?: boolean
}

export function DataTableToolbar<TData extends RowData>({
  table,
  searchKey,
  searchPlaceholder = "Buscar registros...",
  searchAriaLabel = "Buscar e filtrar registros da tabela",
  toolbarFilters,
  toolbarActions,
  enableColumnVisibility = false,
}: DataTableToolbarProps<TData>) {
  // Se searchKey for especificada, filtra por coluna; senão filtra globalmente se disponível
  const column = searchKey ? table.getColumn(searchKey) : null
  const searchValue = column
    ? ((column.getFilterValue() as string) ?? "")
    : ((table.state.globalFilter as string) ?? "")

  const handleSearchChange = (value: string) => {
    if (column) {
      column.setFilterValue(value)
    } else {
      table.setGlobalFilter(value)
    }
  }

  const isFiltered =
    Boolean(searchValue) || table.state.columnFilters.length > 0

  const handleResetFilters = () => {
    table.resetColumnFilters()
    table.setGlobalFilter("")
  }

  return (
    <search
      aria-label={searchAriaLabel}
      className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 sm:p-4 border-b border-border/70 bg-card/40"
    >
      {/* Lado Esquerdo: Busca + Filtros */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {/* Campo de Busca Textual */}
        {(Boolean(searchKey) || Boolean(searchPlaceholder)) && (
          <div className="relative w-full sm:w-auto sm:min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="h-8.5 pl-8 pr-7 text-xs bg-background border-border/80"
              aria-label={searchPlaceholder}
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-sm"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Filtros customizados (PillToggle, Select, DatePicker, etc.) */}
        {toolbarFilters}

        {/* Botão de Limpar Todos os Filtros */}
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
            <span>Limpar</span>
          </Button>
        )}
      </div>

      {/* Lado Direito: Visibilidade de Colunas + Ações Principais */}
      <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
        {enableColumnVisibility && <DataTableViewOptions table={table} />}
        {toolbarActions}
      </div>
    </search>
  )
}

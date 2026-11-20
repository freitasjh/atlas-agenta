"use client"

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"
import type { RowData } from "@tanstack/react-table"

import { Button } from "@/components/shadcn/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import type { DataTableInstance } from "./data-table-types"

interface DataTablePaginationProps<TData extends RowData> {
  table: DataTableInstance<TData>
  pageSizeOptions?: number[]
}

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 30, 50, 100],
}: DataTablePaginationProps<TData>) {
  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const totalCount = table.getFilteredRowModel().rows.length
  const pageIndex = table.state.pagination.pageIndex
  const pageSize = table.state.pagination.pageSize
  const pageCount = table.getPageCount()

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4 border-t border-border/70 bg-muted/20 px-3 sm:px-4 py-2.5 sm:py-3">
      {/* Contagem de Linhas e Seleção */}
      <div className="text-xs text-muted-foreground text-center sm:text-left w-full sm:w-auto">
        {selectedCount > 0 ? (
          <span>
            <strong className="text-foreground">{selectedCount}</strong> de{" "}
            <strong>{totalCount}</strong> linha(s) selecionada(s).
          </span>
        ) : (
          <span>
            Mostrando <strong>{totalCount === 0 ? 0 : pageIndex * pageSize + 1}</strong> a{" "}
            <strong>{Math.min((pageIndex + 1) * pageSize, totalCount)}</strong> de{" "}
            <strong>{totalCount}</strong> registros
          </span>
        )}
      </div>

      {/* Controles de Paginação */}
      <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4 w-full sm:w-auto">
        {/* Seletor de Linhas por Página */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap hidden sm:inline">
            Linhas por página
          </span>
          <Select
            value={`${pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value))
            }}
          >
            <SelectTrigger className="h-8 w-[64px] sm:w-[72px] text-xs">
              <SelectValue placeholder={`${pageSize}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={`${size}`} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Indicador de Página */}
        <div className="flex items-center justify-center text-xs font-medium text-muted-foreground min-w-[75px] sm:min-w-[90px]">
          Página {pageCount === 0 ? 0 : pageIndex + 1} de {pageCount}
        </div>

        {/* Botões de Navegação */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="hidden size-8 p-0 sm:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            title="Primeira página"
          >
            <span className="sr-only">Primeira página</span>
            <ChevronsLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            title="Página anterior"
          >
            <span className="sr-only">Página anterior</span>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            className="size-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            title="Próxima página"
          >
            <span className="sr-only">Próxima página</span>
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            className="hidden size-8 p-0 sm:flex"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            title="Última página"
          >
            <span className="sr-only">Última página</span>
            <ChevronsRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

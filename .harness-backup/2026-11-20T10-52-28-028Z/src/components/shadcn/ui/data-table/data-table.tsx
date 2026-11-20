"use client"

import * as React from "react"
import {
  FlexRender,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type RowData,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table"
import { Inbox } from "lucide-react"

import { cn } from "@/lib/cn"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import { Skeleton } from "@/components/shadcn/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table"

import { dataTableFeatures, type DataTableProps } from "./data-table-types"
import { DataTableToolbar } from "./data-table-toolbar"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableFloatingBar } from "./data-table-floating-bar"

export function DataTable<TData extends RowData>({
  columns,
  data,
  title,
  description,
  badgeCount,
  icon,
  searchKey,
  searchPlaceholder,
  searchAriaLabel,
  toolbarFilters,
  toolbarActions,
  enableColumnVisibility = false,
  enableRowSelection = true,
  enablePagination = true,
  pageSize = 10,
  pageSizeOptions = [10, 20, 30, 50, 100],
  onRowClick,
  emptyTitle = "Nenhum registro encontrado",
  emptyDescription = "Tente alterar os termos da busca ou redefinir os filtros aplicados.",
  emptyAction,
  isLoading = false,
  skeletonRows = 5,
  floatingBar,
  className,
  tableClassName,
}: DataTableProps<TData>) {
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState("")
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize,
  })

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    enableRowSelection,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
  })

  const hasToolbar = Boolean(
    searchKey ||
      toolbarFilters ||
      toolbarActions ||
      enableColumnVisibility
  )

  const visibleColumnsCount = table.getVisibleLeafColumns().length

  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs transition-all",
        className
      )}
    >
      {/* 1. Header com Título e Descrição (se fornecido) */}
      {(title || description) && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 border-b border-border/60 bg-muted/20">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {icon && <span className="text-primary">{icon}</span>}
              {typeof title === "string" ? (
                <h3 className="font-semibold text-sm sm:text-base text-foreground tracking-tight">
                  {title}
                </h3>
              ) : (
                title
              )}
              {badgeCount !== undefined && (
                <Badge variant="secondary" className="text-[11px] font-mono px-2 py-0">
                  {badgeCount}
                </Badge>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      )}

      {/* 2. Toolbar Semântica de Busca, Filtros e Ações */}
      {hasToolbar && (
        <DataTableToolbar
          table={table}
          searchKey={searchKey}
          searchPlaceholder={searchPlaceholder}
          searchAriaLabel={searchAriaLabel}
          toolbarFilters={toolbarFilters}
          toolbarActions={toolbarActions}
          enableColumnVisibility={enableColumnVisibility}
        />
      )}

      {/* 3. Tabela de Dados */}
      <div className="relative overflow-x-auto">
        <Table className={tableClassName}>
          <TableHeader className="sticky top-0 z-10 border-b border-border/70 bg-muted/30 backdrop-blur-xs">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className="h-9 px-3 text-xs font-semibold text-muted-foreground/90 whitespace-nowrap"
                  >
                    {header.isPlaceholder ? null : (
                      <FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="divide-y divide-border/60">
            {isLoading ? (
              // Loading Skeleton State
              Array.from({ length: skeletonRows }).map((_, rIdx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows
                <TableRow key={`skeleton-row-${rIdx}`} className="hover:bg-transparent">
                  {Array.from({ length: visibleColumnsCount }).map((_, cIdx) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton cells
                    <TableCell key={`skeleton-cell-${cIdx}`} className="p-3">
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              // Linhas de Dados
              table.getRowModel().rows.map((row) => {
                const isSelected = row.getIsSelected()
                return (
                  <TableRow
                    key={row.id}
                    data-state={isSelected && "selected"}
                    onClick={() => onRowClick?.(row.original)}
                    className={cn(
                      "transition-colors",
                      onRowClick && "cursor-pointer hover:bg-muted/50",
                      isSelected && "bg-muted/60"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className="px-3 py-2.5 text-xs align-middle"
                      >
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            ) : (
              // Empty State
              <TableRow>
                <TableCell
                  colSpan={visibleColumnsCount}
                  className="h-44 text-center p-6"
                >
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto text-center space-y-2">
                    <div className="size-10 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground">
                      <Inbox className="size-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-foreground">
                        {emptyTitle}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {emptyDescription}
                      </p>
                    </div>
                    {emptyAction ? (
                      emptyAction
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          table.resetColumnFilters()
                          table.setGlobalFilter?.("")
                        }}
                        className="h-7 text-xs font-medium mt-1"
                      >
                        Redefinir Filtros
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* 4. Rodapé e Paginação */}
      {enablePagination ? (
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      ) : (
        <div className="flex items-center justify-between border-t border-border/70 bg-muted/10 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Total de <strong>{table.getFilteredRowModel().rows.length}</strong> registro(s)
          </span>
          {onRowClick && (
            <span className="text-[11px] hidden sm:inline">
              Clique em uma linha para inspecionar os detalhes.
            </span>
          )}
        </div>
      )}

      {/* 5. Barra Flutuante de Ações em Massa */}
      {floatingBar ? (
        floatingBar(table)
      ) : (
        <DataTableFloatingBar table={table} />
      )}
    </div>
  )
}

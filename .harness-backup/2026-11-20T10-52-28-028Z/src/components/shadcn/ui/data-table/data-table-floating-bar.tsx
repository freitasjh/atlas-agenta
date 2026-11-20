"use client"

import { X, CheckSquare } from "lucide-react"
import type { RowData } from "@tanstack/react-table"

import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import { Separator } from "@/components/shadcn/ui/separator"
import type { DataTableInstance } from "./data-table-types"

interface DataTableFloatingBarProps<TData extends RowData> {
  table: DataTableInstance<TData>
  children?: React.ReactNode
}

export function DataTableFloatingBar<TData extends RowData>({
  table,
  children,
}: DataTableFloatingBarProps<TData>) {
  const selectedCount = table.getFilteredSelectedRowModel().rows.length

  if (selectedCount === 0) return null

  return (
    <div
      role="region"
      aria-label="Ações em massa para itens selecionados"
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 sm:gap-3 rounded-xl border border-border/80 bg-background/95 backdrop-blur-md px-3 sm:px-4 py-2 shadow-lg animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-[calc(100vw-2rem)]"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <Badge variant="secondary" className="gap-1 font-mono text-[11px] px-2 py-0.5">
          <CheckSquare className="size-3 text-primary" />
          {selectedCount}
        </Badge>
        <span className="text-muted-foreground hidden sm:inline">
          {selectedCount === 1 ? "item selecionado" : "itens selecionados"}
        </span>
      </div>

      {children && (
        <>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">{children}</div>
        </>
      )}

      <Separator orientation="vertical" className="h-4" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => table.toggleAllRowsSelected(false)}
        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5 mr-1" />
        Desmarcar
      </Button>
    </div>
  )
}

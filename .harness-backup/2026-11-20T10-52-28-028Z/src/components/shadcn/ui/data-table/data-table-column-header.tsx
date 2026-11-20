"use client"

import * as React from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff } from "lucide-react"
import type { Column, RowData } from "@tanstack/react-table"

import { cn } from "@/lib/cn"
import { Button } from "@/components/shadcn/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import type { dataTableFeatures } from "./data-table-types"

interface DataTableColumnHeaderProps<TData extends RowData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<typeof dataTableFeatures, TData, TValue>
  title: string
}

export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn("text-xs font-semibold uppercase tracking-wider text-muted-foreground", className)}>{title}</div>
  }

  const isSorted = column.getIsSorted()

  return (
    <div className={cn("flex items-center space-x-1.5", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 -ml-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground data-[state=open]:bg-accent"
          >
            <span>{title}</span>
            {isSorted === "desc" ? (
              <ArrowDown className="ml-1.5 size-3.5 text-primary" />
            ) : isSorted === "asc" ? (
              <ArrowUp className="ml-1.5 size-3.5 text-primary" />
            ) : (
              <ArrowUpDown className="ml-1.5 size-3.5 text-muted-foreground/60" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40">
          <DropdownMenuItem onClick={() => column.toggleSorting(false)} className="gap-2 text-xs">
            <ArrowUp className="size-3.5 text-muted-foreground" />
            Ascendente
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => column.toggleSorting(true)} className="gap-2 text-xs">
            <ArrowDown className="size-3.5 text-muted-foreground" />
            Descendente
          </DropdownMenuItem>
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => column.toggleVisibility(false)} className="gap-2 text-xs">
                <EyeOff className="size-3.5 text-muted-foreground" />
                Ocultar Coluna
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

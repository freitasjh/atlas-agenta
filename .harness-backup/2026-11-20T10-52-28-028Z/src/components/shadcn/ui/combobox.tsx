"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search, X } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover"
import { ScrollArea } from "@/components/shadcn/ui/scroll-area"
import { cn } from "@/lib/cn"

export type ComboboxItem = {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export interface ComboboxProps {
  items: ComboboxItem[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  id?: string
  name?: string
  required?: boolean
}

export function Combobox({
  items,
  value: controlledValue,
  defaultValue = "",
  onValueChange,
  placeholder = "Selecione uma opção...",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhum resultado encontrado.",
  className,
  disabled = false,
  id,
  name,
  required,
}: ComboboxProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const isControlled = controlledValue !== undefined
  const value = isControlled ? controlledValue : internalValue

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const selectedItem = React.useMemo(() => {
    return items.find((item) => item.value === value)
  }, [items, value])

  const filteredItems = React.useMemo(() => {
    if (!query.trim()) return items
    const lower = query.toLowerCase()
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.value.toLowerCase().includes(lower) ||
        (item.description && item.description.toLowerCase().includes(lower))
    )
  }, [items, query])

  function handleSelect(selectedValue: string) {
    if (!isControlled) {
      setInternalValue(selectedValue)
    }
    onValueChange?.(selectedValue)
    setOpen(false)
    setQuery("")
  }

  return (
    <div className={cn("relative w-full", className)}>
      {/* Campo nativo invisível para suporte a formulários tradicionais */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-between rounded-md border-input bg-transparent px-3 text-sm font-normal shadow-xs transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
              !selectedItem && "text-muted-foreground",
              className
            )}
          >
            <span className="truncate">
              {selectedItem ? selectedItem.label : placeholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="relative w-(--radix-popover-trigger-width) min-w-56 overflow-hidden rounded-xl border border-border/70 p-0 shadow-[0_4px_16px_rgba(0,0,0,0.08),0_12px_32px_rgba(0,0,0,0.06)] dark:border-border/60 dark:shadow-none"
          align="start"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
          />

          {/* Campo de Busca com Lupa */}
          <div className="flex items-center border-b border-border/60 px-3 py-2">
            <Search className="mr-2 size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              className="flex h-6 w-full rounded-md bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="rounded-xs p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Lista de Opções */}
          <ScrollArea className="max-h-56 p-1">
            {filteredItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredItems.map((item) => {
                  const isSelected = item.value === value
                  return (
                    <button
                      key={item.value}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => handleSelect(item.value)}
                      className={cn(
                        "relative flex w-full cursor-pointer select-none items-center rounded-md py-1.5 pr-2 pl-8 text-left text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
                        isSelected && "bg-accent/80 font-medium text-accent-foreground"
                      )}
                    >
                      <span className="absolute left-2 flex size-3.5 items-center justify-center text-primary">
                        {isSelected && <Check className="size-3.5" />}
                      </span>
                      <div className="flex flex-col">
                        <span className="truncate">{item.label}</span>
                        {item.description && (
                          <span className="truncate text-[10px] text-muted-foreground font-normal">
                            {item.description}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  )
}


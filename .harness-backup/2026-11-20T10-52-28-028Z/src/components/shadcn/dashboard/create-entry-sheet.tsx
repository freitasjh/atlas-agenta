"use client"

import * as React from "react"
import { IconCircleCheckFilled, IconPlus } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/shadcn/ui/button"
import { Combobox, type ComboboxItem } from "@/components/shadcn/ui/combobox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/shadcn/ui/field"
import { Input } from "@/components/shadcn/ui/input"
import { Separator } from "@/components/shadcn/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/ui/sheet"

const categoryItems: ComboboxItem[] = [
  { value: "operational", label: "Operacional", description: "Despesas de rotina e fornecedores" },
  { value: "treasury", label: "Tesouraria", description: "Operações CDI, caixa e hedge" },
  { value: "infrastructure", label: "Infraestrutura", description: "Servidores, licenças e cloud" },
  { value: "revenue", label: "Receita", description: "Entradas e faturamento de clientes" },
]

const reviewerItems: ComboboxItem[] = [
  { value: "eddie", label: "Eddie Lake", description: "Operador Sênior" },
  { value: "jamik", label: "Jamik Tashpulatov", description: "Gerente de Risco" },
  { value: "marina", label: "Marina Souza", description: "Controladoria" },
  { value: "emily", label: "Emily Whalen", description: "Auditoria Interna" },
]

export function CreateEntrySheet({
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen

  const [isLoading, setIsLoading] = React.useState(false)
  const [category, setCategory] = React.useState("operational")
  const [reviewer, setReviewer] = React.useState("eddie")

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    setTimeout(() => {
      setIsLoading(false)
      setOpen(false)
      toast.success("Lançamento cadastrado com sucesso!", {
        description: "Os dados foram salvos e sincronizados com a fila operacional.",
        icon: <IconCircleCheckFilled className="size-4 text-emerald-500" />,
      })
    }, 700)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {trigger ? (
        <SheetTrigger asChild>{trigger}</SheetTrigger>
      ) : (
        <SheetTrigger asChild>
          <Button size="sm" className="hidden sm:flex">
            <IconPlus className="size-4" />
            Novo lançamento
          </Button>
        </SheetTrigger>
      )}
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border/70 bg-card p-0 sm:max-w-md"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
        />

        <SheetHeader className="border-b border-border/60 p-6 text-left">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Operacional
            </span>
          </div>
          <SheetTitle className="text-lg font-semibold tracking-tight text-foreground">
            Cadastrar Lançamento
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Insira os dados da transação para conciliação contábil e auditoria.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col justify-between overflow-y-auto">
          <div className="flex flex-col gap-5 p-6">
            <FieldGroup className="gap-5">
              <Field>
                <FieldLabel htmlFor="entry-title">Título do lançamento</FieldLabel>
                <Input
                  id="entry-title"
                  placeholder="Ex: Liquidação de contrato fornecedor"
                  required
                  className="h-9"
                />
                <FieldDescription>Nome legível para rastreabilidade nos relatórios.</FieldDescription>
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="entry-category">Categoria</FieldLabel>
                  <Combobox
                    id="entry-category"
                    items={categoryItems}
                    value={category}
                    onValueChange={setCategory}
                    placeholder="Selecione..."
                    searchPlaceholder="Buscar categoria..."
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="entry-value">Valor previsto</FieldLabel>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs text-muted-foreground">
                      R$
                    </span>
                    <Input
                      id="entry-value"
                      type="text"
                      placeholder="0,00"
                      required
                      className="h-9 pl-9 tabular-nums"
                    />
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="entry-date">Data de competência</FieldLabel>
                  <Input
                    id="entry-date"
                    type="date"
                    defaultValue={new Date().toISOString().split("T")[0]}
                    required
                    className="h-9"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="entry-reviewer">Responsável</FieldLabel>
                  <Combobox
                    id="entry-reviewer"
                    items={reviewerItems}
                    value={reviewer}
                    onValueChange={setReviewer}
                    placeholder="Responsável..."
                    searchPlaceholder="Buscar membro..."
                  />
                </Field>
              </div>

              <Separator className="my-1" />

              <Field>
                <FieldLabel htmlFor="entry-notes">Notas complementares</FieldLabel>
                <Input
                  id="entry-notes"
                  placeholder="Instruções para o operador de liquidação (opcional)"
                  className="h-9"
                />
              </Field>
            </FieldGroup>
          </div>

          <SheetFooter className="border-t border-border/60 bg-muted/20 p-4 sm:flex-row sm:justify-end sm:gap-2">
            <SheetClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={isLoading}>
                Cancelar
              </Button>
            </SheetClose>
            <Button type="submit" size="sm" disabled={isLoading}>
              {isLoading ? "Salvando..." : "Salvar Lançamento"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}


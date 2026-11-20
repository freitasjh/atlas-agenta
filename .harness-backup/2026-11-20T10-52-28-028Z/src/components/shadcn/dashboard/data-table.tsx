"use client"

import * as React from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconDotsVertical,
  IconGripVertical,
  IconLayoutColumns,
  IconPlus,
  IconTrendingUp,
} from "@tabler/icons-react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type Row,
  type SortingState,
} from "@tanstack/react-table"
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts"
import { toast } from "sonner"
import { z } from "zod"

import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/cn"
import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import { CreateEntrySheet } from "@/components/shadcn/dashboard/create-entry-sheet"
import { KanbanBoard } from "@/components/shadcn/kanban/kanban-board"
import { Scheduler } from "@/components/shadcn/scheduler/scheduler"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/shadcn/ui/chart"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/shadcn/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import { Separator } from "@/components/shadcn/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/shadcn/ui/tabs"

// New in v9: declare the features this table uses — anything you don't
// register is tree-shaken out of the bundle.
const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<
  typeof features,
  z.infer<typeof schema>
>()

export const schema = z.object({
  id: z.number(),
  header: z.string(),
  type: z.string(),
  status: z.string(),
  target: z.string(),
  limit: z.string(),
  reviewer: z.string(),
})

// Create a separate component for the drag handle
function DragHandle({ id }: { id: number }) {
  const { attributes, listeners } = useSortable({
    id,
  })

  return (
    <Button
      {...attributes}
      {...listeners}
      variant="ghost"
      size="icon"
      className="size-7 text-muted-foreground hover:bg-transparent"
    >
      <IconGripVertical className="size-3 text-muted-foreground" />
      <span className="sr-only">Arrastar para reordenar</span>
    </Button>
  )
}

const columns = columnHelper.columns([
  columnHelper.display({
    id: "drag",
    header: () => null,
    cell: ({ row }) => <DragHandle id={row.original.id} />,
  }),
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Selecionar todas"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Selecionar linha"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),
  columnHelper.accessor("header", {
    header: "Documento",
    cell: ({ row }) => {
      return <TableCellViewer item={row.original} />
    },
    enableHiding: false,
  }),
  columnHelper.accessor("type", {
    header: "Categoria",
    cell: ({ row }) => (
      <div className="w-32">
        <Badge
          variant="outline"
          className="rounded-md border-border/60 bg-muted/20 px-2 py-0.5 text-xs font-normal text-muted-foreground"
        >
          {row.original.type}
        </Badge>
      </div>
    ),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: ({ row }) => {
      const isDone = row.original.status === "Done"
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
            isDone
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300"
              : "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-300"
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isDone ? "bg-emerald-500" : "bg-sky-500 animate-pulse"
            )}
          />
          {row.original.status}
        </span>
      )
    },
  }),
  columnHelper.accessor("target", {
    header: () => <div className="w-full text-right">Meta</div>,
    cell: ({ row }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Salvando ${row.original.header}`,
            success: "Salvo",
            error: "Erro",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-target`} className="sr-only">
          Meta
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.target}
          id={`${row.original.id}-target`}
        />
      </form>
    ),
  }),
  columnHelper.accessor("limit", {
    header: () => <div className="w-full text-right">Limite</div>,
    cell: ({ row }) => (
      <form
        onSubmit={(e) => {
          e.preventDefault()
          toast.promise(new Promise((resolve) => setTimeout(resolve, 1000)), {
            loading: `Salvando ${row.original.header}`,
            success: "Salvo",
            error: "Erro",
          })
        }}
      >
        <Label htmlFor={`${row.original.id}-limit`} className="sr-only">
          Limite
        </Label>
        <Input
          className="h-8 w-16 border-transparent bg-transparent text-right shadow-none hover:bg-input/30 focus-visible:border focus-visible:bg-background dark:bg-transparent dark:hover:bg-input/30 dark:focus-visible:bg-input/30"
          defaultValue={row.original.limit}
          id={`${row.original.id}-limit`}
        />
      </form>
    ),
  }),
  columnHelper.accessor("reviewer", {
    header: "Responsável",
    cell: ({ row }) => {
      const isAssigned = row.original.reviewer !== "Atribuir responsável"

      if (isAssigned) {
        return row.original.reviewer
      }

      return (
        <>
          <Label htmlFor={`${row.original.id}-reviewer`} className="sr-only">
            Responsável
          </Label>
          <Select>
            <SelectTrigger
              className="w-38 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate"
              size="sm"
              id={`${row.original.id}-reviewer`}
            >
              <SelectValue placeholder="Atribuir responsável" />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="Eddie Lake">Eddie Lake</SelectItem>
              <SelectItem value="Jamik Tashpulatov">
                Jamik Tashpulatov
              </SelectItem>
            </SelectContent>
          </Select>
        </>
      )
    },
  }),
  columnHelper.display({
    id: "actions",
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
          >
            <IconDotsVertical />
            <span className="sr-only">Abrir menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem>Editar</DropdownMenuItem>
          <DropdownMenuItem>Fazer uma cópia</DropdownMenuItem>
          <DropdownMenuItem>Favoritar</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Excluir</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  }),
])

function getColumnVisibilityClass(columnId: string) {
  switch (columnId) {
    case "drag":
      return "hidden md:table-cell w-8"
    case "type":
      return "hidden sm:table-cell"
    case "target":
    case "limit":
      return "hidden lg:table-cell"
    case "reviewer":
      return "hidden md:table-cell"
    default:
      return ""
  }
}

function DraggableRow({
  row,
}: {
  row: Row<typeof features, z.infer<typeof schema>>
}) {
  const { transform, transition, setNodeRef, isDragging } = useSortable({
    id: row.original.id,
  })

  return (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      data-dragging={isDragging}
      ref={setNodeRef}
      className="relative z-0 data-[dragging=true]:z-10 data-[dragging=true]:opacity-80"
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition,
      }}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={getColumnVisibilityClass(cell.column.id)}
        >
          <FlexRender cell={cell} />
        </TableCell>
      ))}
    </TableRow>
  )
}

export function DataTable({
  data: initialData,
}: {
  data: z.infer<typeof schema>[]
}) {
  const [data, setData] = React.useState(() => initialData)
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })
  const sortableId = React.useId()
  const sensors = useSensors(
    useSensor(MouseSensor, {}),
    useSensor(TouchSensor, {}),
    useSensor(KeyboardSensor, {})
  )

  const dataIds = React.useMemo<UniqueIdentifier[]>(
    () => data?.map(({ id }) => id) || [],
    [data]
  )

  const table = useTable({
    features,
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  })

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over && active.id !== over.id) {
      setData((data) => {
        const oldIndex = dataIds.indexOf(active.id)
        const newIndex = dataIds.indexOf(over.id)
        return arrayMove(data, oldIndex, newIndex)
      })
    }
  }

  return (
    <Tabs
      defaultValue="outline"
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
        <Label htmlFor="view-selector" className="sr-only">
          Visualização
        </Label>
        <Select defaultValue="outline">
          <SelectTrigger
            className="flex w-fit @4xl/main:hidden"
            size="sm"
            id="view-selector"
          >
            <SelectValue placeholder="Selecionar visão" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="outline">Visão geral (Tabela)</SelectItem>
            <SelectItem value="kanban">Quadro Kanban</SelectItem>
            <SelectItem value="past-performance">Histórico</SelectItem>
            <SelectItem value="key-personnel">Agenda da Equipe</SelectItem>
            <SelectItem value="focus-documents">Documentos foco</SelectItem>
          </SelectContent>
        </Select>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          <TabsTrigger value="outline">Tabela</TabsTrigger>
          <TabsTrigger value="kanban">
            Quadro Kanban <Badge variant="secondary">6</Badge>
          </TabsTrigger>
          <TabsTrigger value="key-personnel">
            Agenda da Equipe <Badge variant="secondary">4</Badge>
          </TabsTrigger>
          <TabsTrigger value="past-performance">
            Histórico <Badge variant="secondary">3</Badge>
          </TabsTrigger>
          <TabsTrigger value="focus-documents">Documentos foco</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <IconLayoutColumns />
                <span className="hidden lg:inline">Personalizar colunas</span>
                <span className="lg:hidden">Colunas</span>
                <IconChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
          <CreateEntrySheet
            trigger={
              <Button variant="outline" size="sm">
                <IconPlus />
                <span className="hidden lg:inline">Adicionar seção</span>
              </Button>
            }
          />
        </div>
      </div>
      <TabsContent
        value="outline"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_3px_0_rgba(0,0,0,0.03),0_6px_16px_0_rgba(0,0,0,0.02)] dark:border-border/60 dark:shadow-none">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
          />
          <DndContext
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
            id={sortableId}
          >
            <Table>
              <TableHeader className="sticky top-0 z-10 border-b border-border/60 bg-muted/30 backdrop-blur-xs">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id} className="hover:bg-transparent">
                    {headerGroup.headers.map((header) => {
                      return (
                        <TableHead
                          key={header.id}
                          colSpan={header.colSpan}
                          className={cn(
                            "h-9 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/85",
                            getColumnVisibilityClass(header.id)
                          )}
                        >
                          {header.isPlaceholder ? null : (
                            <FlexRender header={header} />
                          )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody className="**:data-[slot=table-cell]:first:w-8 divide-y divide-border/40">
                {table.getRowModel().rows?.length ? (
                  <SortableContext
                    items={dataIds}
                    strategy={verticalListSortingStrategy}
                  >
                    {table.getRowModel().rows.map((row) => (
                      <DraggableRow key={row.id} row={row} />
                    ))}
                  </SortableContext>
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-28 text-center text-muted-foreground"
                    >
                      Sem resultados.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </DndContext>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-muted/20 px-3 sm:px-4 py-2.5 sm:py-3">
            <div className="hidden flex-1 text-xs text-muted-foreground lg:flex">
              {table.getFilteredSelectedRowModel().rows.length} de{" "}
              {table.getFilteredRowModel().rows.length} linha(s) selecionada(s).
            </div>
            <div className="flex w-full items-center justify-between sm:justify-end gap-3 sm:gap-6 lg:w-fit">
              <div className="hidden items-center gap-2 lg:flex">
                <Label htmlFor="rows-per-page" className="text-xs font-medium text-muted-foreground">
                  Linhas por página
                </Label>
                <Select
                  value={`${table.state.pagination.pageSize}`}
                  onValueChange={(value) => {
                    table.setPageSize(Number(value))
                  }}
                >
                  <SelectTrigger size="sm" className="h-8 w-18 text-xs" id="rows-per-page">
                    <SelectValue placeholder={table.state.pagination.pageSize} />
                  </SelectTrigger>
                  <SelectContent side="top">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-fit items-center justify-center text-xs font-medium text-muted-foreground">
                Página {table.state.pagination.pageIndex + 1} de{" "}
                {table.getPageCount()}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  className="hidden size-8 p-0 lg:flex"
                  onClick={() => table.setPageIndex(0)}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Ir para a primeira página</span>
                  <IconChevronsLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8 p-0"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <span className="sr-only">Página anterior</span>
                  <IconChevronLeft className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="size-8 p-0"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Próxima página</span>
                  <IconChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  className="hidden size-8 p-0 lg:flex"
                  onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                  disabled={!table.getCanNextPage()}
                >
                  <span className="sr-only">Ir para a última página</span>
                  <IconChevronsRight className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </TabsContent>
      <TabsContent
        value="kanban"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <KanbanBoard />
      </TabsContent>
      <TabsContent
        value="past-performance"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/10 p-6 text-center">
          <p className="text-sm font-medium text-foreground/80">Histórico de desempenho</p>
          <p className="text-xs text-muted-foreground">Nenhum registro anterior localizado para o período filtrado.</p>
        </div>
      </TabsContent>
      <TabsContent
        value="key-personnel"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <Scheduler />
      </TabsContent>
      <TabsContent
        value="focus-documents"
        className="flex flex-col px-4 lg:px-6"
      >
        <div className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-muted/10 p-6 text-center">
          <p className="text-sm font-medium text-foreground/80">Documentos em foco</p>
          <p className="text-xs text-muted-foreground">Nenhum anexo prioritário pendente de revisão técnica.</p>
        </div>
      </TabsContent>
    </Tabs>
  )
}

const chartData = [
  { month: "January", desktop: 186, mobile: 80 },
  { month: "February", desktop: 305, mobile: 200 },
  { month: "March", desktop: 237, mobile: 120 },
  { month: "April", desktop: 73, mobile: 190 },
  { month: "May", desktop: 209, mobile: 130 },
  { month: "June", desktop: 214, mobile: 140 },
]

const chartConfig = {
  desktop: {
    label: "Desktop",
    color: "var(--primary)",
  },
  mobile: {
    label: "Mobile",
    color: "var(--primary)",
  },
} satisfies ChartConfig

function TableCellViewer({ item }: { item: z.infer<typeof schema> }) {
  const isMobile = useIsMobile()

  return (
    <Drawer direction={isMobile ? "bottom" : "right"}>
      <DrawerTrigger asChild>
        <Button variant="link" className="w-fit px-0 text-left font-medium text-foreground hover:underline">
          {item.header}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="relative border-l border-border/70 bg-card">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
        />
        <DrawerHeader className="gap-1 border-b border-border/60 p-4">
          <DrawerTitle className="text-base font-semibold tracking-tight">{item.header}</DrawerTitle>
          <DrawerDescription className="text-xs text-muted-foreground">
            Métricas de desempenho e auditoria nos últimos 6 meses
          </DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4 text-sm">
          {!isMobile && (
            <>
              <ChartContainer config={chartConfig}>
                <AreaChart
                  accessibilityLayer
                  data={chartData}
                  margin={{
                    left: 0,
                    right: 10,
                  }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={(value) => value.slice(0, 3)}
                    hide
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="dot" />}
                  />
                  <Area
                    dataKey="mobile"
                    type="natural"
                    fill="var(--color-mobile)"
                    fillOpacity={0.6}
                    stroke="var(--color-mobile)"
                    stackId="a"
                  />
                  <Area
                    dataKey="desktop"
                    type="natural"
                    fill="var(--color-desktop)"
                    fillOpacity={0.4}
                    stroke="var(--color-desktop)"
                    stackId="a"
                  />
                </AreaChart>
              </ChartContainer>
              <Separator />
              <div className="grid gap-1 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                  Em alta de 5,2% no período{" "}
                  <IconTrendingUp className="size-4 text-emerald-500" />
                </div>
                <div className="text-xs text-muted-foreground leading-relaxed">
                  Volumetria de processamento com estabilidade operacional e aderência às métricas contratuais.
                </div>
              </div>
              <Separator />
            </>
          )}
          <form className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="header" className="text-xs font-medium text-muted-foreground">Título do Módulo</Label>
              <Input id="header" defaultValue={item.header} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="type" className="text-xs font-medium text-muted-foreground">Categoria</Label>
                <Select defaultValue={item.type}>
                  <SelectTrigger id="type" className="h-9 w-full">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Table of Contents">Sumário</SelectItem>
                    <SelectItem value="Executive Summary">Resumo Executivo</SelectItem>
                    <SelectItem value="Technical Approach">Abordagem Técnica</SelectItem>
                    <SelectItem value="Design">Design</SelectItem>
                    <SelectItem value="Capabilities">Capacidades</SelectItem>
                    <SelectItem value="Focus Documents">Documentos foco</SelectItem>
                    <SelectItem value="Narrative">Narrativa</SelectItem>
                    <SelectItem value="Cover Page">Capa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="status" className="text-xs font-medium text-muted-foreground">Status da Revisão</Label>
                <Select defaultValue={item.status}>
                  <SelectTrigger id="status" className="h-9 w-full">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Done">Concluído</SelectItem>
                    <SelectItem value="In Progress">Em Progresso</SelectItem>
                    <SelectItem value="Not Started">Não Iniciado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="target" className="text-xs font-medium text-muted-foreground">Meta Operacional</Label>
                <Input id="target" defaultValue={item.target} className="h-9 tabular-nums" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="limit" className="text-xs font-medium text-muted-foreground">Limite de Risco</Label>
                <Input id="limit" defaultValue={item.limit} className="h-9 tabular-nums" />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reviewer" className="text-xs font-medium text-muted-foreground">Revisor Designado</Label>
              <Select defaultValue={item.reviewer}>
                <SelectTrigger id="reviewer" className="h-9 w-full">
                  <SelectValue placeholder="Responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Eddie Lake">Eddie Lake</SelectItem>
                  <SelectItem value="Jamik Tashpulatov">Jamik Tashpulatov</SelectItem>
                  <SelectItem value="Emily Whalen">Emily Whalen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
        </div>
        <DrawerFooter className="border-t border-border/60 bg-muted/20 p-4">
          <Button size="sm">Salvar Alterações</Button>
          <DrawerClose asChild>
            <Button variant="outline" size="sm">Fechar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

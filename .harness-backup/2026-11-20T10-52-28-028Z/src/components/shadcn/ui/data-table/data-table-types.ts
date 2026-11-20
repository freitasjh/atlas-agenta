import * as React from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnDef,
  type ReactTable,
  type RowData,
} from "@tanstack/react-table"

/**
 * Features padrão do TanStack Table v9 para o DataTable do Atlas
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

export type DataTableInstance<TData extends RowData = RowData> = ReactTable<
  typeof dataTableFeatures,
  TData
>

export interface DataTableProps<TData extends RowData = RowData> {
  /** Definições de colunas da tabela */
  columns: ColumnDef<typeof dataTableFeatures, TData, unknown>[]
  /** Array de dados a serem exibidos */
  data: TData[]
  /** Título principal exibido no topo da tabela */
  title?: React.ReactNode
  /** Subtítulo descritivo */
  description?: React.ReactNode
  /** Badge numérico ou textual ao lado do título */
  badgeCount?: number | string
  /** Ícone exibido ao lado do título */
  icon?: React.ReactNode
  /** Chave da coluna usada para o filtro de busca textual (ex: "description", "name") */
  searchKey?: string
  /** Placeholder do campo de busca textual */
  searchPlaceholder?: string
  /** Controles de filtro adicionais exibidos na toolbar (ex: PillToggle, Select) */
  toolbarFilters?: React.ReactNode
  /** Botões de ação principais da tabela (ex: Exportar, Novo Registro) */
  toolbarActions?: React.ReactNode
  /** Habilitar o dropdown de exibição/ocultação de colunas */
  enableColumnVisibility?: boolean
  /** Habilitar seleção de linhas via checkbox */
  enableRowSelection?: boolean
  /** Habilitar controles de paginação */
  enablePagination?: boolean
  /** Quantidade inicial de linhas por página (padrão: 10) */
  pageSize?: number
  /** Opções de quantidade de linhas por página (padrão: [10, 20, 30, 50, 100]) */
  pageSizeOptions?: number[]
  /** Callback disparado ao clicar em uma linha */
  onRowClick?: (row: TData) => void
  /** Mensagem / Título quando nenhum registro for encontrado */
  emptyTitle?: string
  /** Descrição quando nenhum registro for encontrado */
  emptyDescription?: string
  /** Ação customizada no empty state */
  emptyAction?: React.ReactNode
  /** Estado de carregamento */
  isLoading?: boolean
  /** Quantidade de linhas skeleton exibidas no estado de carregamento */
  skeletonRows?: number
  /** Barra flutuante de ações em lote renderizada quando há linhas selecionadas */
  floatingBar?: (table: DataTableInstance<TData>) => React.ReactNode
  /** Classes CSS adicionais do container principal */
  className?: string
  /** Classes CSS da tabela */
  tableClassName?: string
  /** Identificador acessível da busca */
  searchAriaLabel?: string
}

# Regras: Tabelas de Dados e Listagens (tables-and-data.md)

Este documento especifica os padrões de desenvolvimento para tabelas de dados (`Table`, `DataTable`, `TransactionTable`) no template Atlas.

---

## 1. Regra da Ação Única (Anti-Duplicação de Botões)

> [!IMPORTANT]
> **Ação Única na Tabela**: Em qualquer tela administrativa que contenha uma tabela de dados com barra de ferramentas, o botão primário de cadastro (como *"Nova Transação"*, *"Novo Usuário"*, *"Novo Agendamento"*) **DEVE FICAR EXCLUSIVAMENTE NA BARRA DE FERRAMENTAS DA TABELA**, ao lado dos filtros e do botão de exportação.
> 
> **Nunca** duplique esse mesmo botão no cabeçalho superior da página, pois isso gera confusão de fluxo e poluição visual.

---

## 2. Barra de Busca e Filtros Semântica (`<search>`)

De acordo com o **Modern Web Guidance**, todos os controles de busca e filtragem de tabelas devem ser envolvidos pelo elemento semântico `<search>`:

```tsx
<search
  aria-label="Buscar e filtrar transações"
  className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
>
  {/* Lado Esquerdo: Input de Busca + Selects de Filtro */}
  <div className="flex flex-1 flex-wrap items-center gap-2">
    <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Buscar por descrição, contato..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 pl-8 text-xs"
      />
    </div>

    {/* Filtros em Select */}
    <Select value={tipo} onValueChange={setTipo}>
      <SelectTrigger className="h-9 w-[140px] text-xs">
        <SelectValue placeholder="Tipo" />
      </SelectTrigger>
      {/* Opções */}
    </Select>
  </div>

  {/* Lado Direito: Ações Principais (Exportar + Botão Novo Registro) */}
  <div className="flex items-center gap-2">
    <Button variant="outline" size="sm" onClick={exportarCSV} className="h-8 gap-1.5 text-xs">
      <Download className="size-3.5" />
      Exportar
    </Button>
    <Button size="sm" onClick={abrirModalNovo} className="h-8 gap-1.5 text-xs font-semibold">
      <Plus className="size-3.5" />
      Novo Registro
    </Button>
  </div>
</search>
```

---

## 3. Alinhamento de Colunas e Formatação de Dados

Para garantir escaneamento visual imediato:

| Tipo de Dado | Alinhamento | Exemplo Visual | Classes Recomendadas |
| :--- | :--- | :--- | :--- |
| **Identificador / Ícone** | Esquerda | Ícone de seta circular | `w-[48px] pr-0` |
| **Descrição & Subtítulo** | Esquerda | Título principal + Cliente em texto menor | `font-medium text-foreground` + `text-[11px] text-muted-foreground` |
| **Categorias & Badges** | Esquerda | Badge sutil com variant secondary | `<Badge variant="secondary" className="text-[11px]">` |
| **Datas** | Esquerda | `11/05/2026` | `w-[110px] text-xs text-muted-foreground` |
| **Status da Linha** | Esquerda | Badge com variante correspondente | `<Badge variant="default\|secondary\|destructive">` |
| **Valores Monetários (R$)** | **Direita** | `+ R$ 14.850,00` ou `- R$ 3.420,00` | `text-right text-sm font-semibold tracking-tight` |
| **Menu de Ações** | **Direita** | DropdownMenu com ícone `MoreHorizontal` | `w-[48px] text-right` |

---

## 4. Linhas Clicáveis e Ações por Linha

- **Clique na Linha**: A linha inteira (`<TableRow>`) deve ter `className="cursor-pointer transition-colors hover:bg-muted/50"` disparando a visualização de detalhes ou comprovante.
- **Isolamento de Cliques no Menu**: A célula final contendo o `DropdownMenu` deve possuir `onClick={(e) => e.stopPropagation()}` para que abrir o menu não dispare a abertura da tela de detalhes da linha.

---

## 5. Rodapé da Tabela e Contador de Registros

Toda tabela deve possuir um rodapé informativo para que o usuário saiba o volume total de dados exibidos:

```tsx
<div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
  <span>
    Mostrando <strong>{filtrados.length}</strong> de <strong>{total.length}</strong> registros
  </span>
  <span className="text-[11px]">
    Clique em uma linha para inspecionar os detalhes completos.
  </span>
</div>
```

---

## 6. Componente Padrão Unificado: `<DataTable />`

Sempre que criar ou refatorar listagens tabulares, utilize o componente padrão padronizado em `@/components/shadcn/ui/data-table`:

```tsx
import { DataTable, DataTableColumnHeader } from "@/components/shadcn/ui/data-table"
import { createColumnHelper } from "@tanstack/react-table"
import { dataTableFeatures } from "@/components/shadcn/ui/data-table"

const columnHelper = createColumnHelper<typeof dataTableFeatures, MinhaEntidade>()

const columns = columnHelper.columns([
  columnHelper.accessor("titulo", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Título" />,
    cell: ({ row }) => <span className="font-medium">{row.original.titulo}</span>,
  }),
])

<DataTable
  title="Entidades"
  description="Gestão integrada de registros"
  badgeCount={dados.length}
  columns={columns}
  data={dados}
  searchKey="titulo"
  searchPlaceholder="Buscar registros..."
  toolbarFilters={<PillToggle ... />}
  toolbarActions={<Button size="sm"><Plus className="size-3.5 mr-1" />Novo Registro</Button>}
  enableColumnVisibility
  enablePagination
  pageSize={10}
  onRowClick={(item) => abrirDetalhes(item)}
/>
```



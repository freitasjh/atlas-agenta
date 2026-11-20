"use client"

import * as React from "react"
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { IconFilter, IconPlus, IconSearch } from "@tabler/icons-react"
import { toast } from "sonner"

import { Button } from "@/components/shadcn/ui/button"
import { Combobox, type ComboboxItem } from "@/components/shadcn/ui/combobox"
import { Input } from "@/components/shadcn/ui/input"
import { KanbanCardView } from "./kanban-card"
import { KanbanColumn } from "./kanban-column"
import type { KanbanColumnData, KanbanTask } from "./kanban-types"

const priorityItems: ComboboxItem[] = [
  { value: "all", label: "Todas", description: "Todos os níveis de prioridade" },
  { value: "urgent", label: "Urgente", description: "Atenção imediata" },
  { value: "high", label: "Alta", description: "Impacto no ciclo operacional" },
  { value: "medium", label: "Média", description: "Fluxo regular de entregas" },
  { value: "low", label: "Baixa", description: "Melhorias e ajustes secundários" },
]

const defaultColumns: KanbanColumnData[] = [
  { id: "todo", title: "A Fazer", statusDotClass: "bg-muted-foreground/60" },
  { id: "in-progress", title: "Em Andamento", statusDotClass: "bg-blue-500 animate-pulse" },
  { id: "review", title: "Em Revisão", statusDotClass: "bg-amber-500" },
  { id: "done", title: "Concluído", statusDotClass: "bg-emerald-500" },
]

const initialTasks: KanbanTask[] = [
  {
    id: "task-1",
    code: "OPS-101",
    title: "Conciliação automática de recebíveis Stone Lote #894",
    columnId: "in-progress",
    priority: "urgent",
    tag: "Financeiro",
    assignee: { name: "Eddie Lake" },
    dueDate: "Hoje",
    subtasks: { completed: 3, total: 4 },
    commentsCount: 2,
  },
  {
    id: "task-2",
    code: "OPS-102",
    title: "Ajustar regras de liquidação Bacen DI e repasse",
    columnId: "todo",
    priority: "high",
    tag: "Bacen",
    assignee: { name: "Jamik Tashpulatov" },
    dueDate: "14 Nov",
    subtasks: { completed: 1, total: 3 },
  },
  {
    id: "task-3",
    code: "OPS-103",
    title: "Validar certificado mTLS para integração Itaú Custódia",
    columnId: "todo",
    priority: "medium",
    tag: "Infra",
    assignee: { name: "Marina Souza" },
    dueDate: "18 Nov",
    commentsCount: 1,
  },
  {
    id: "task-4",
    code: "OPS-104",
    title: "Homologar webhook de confirmação Pix no ambiente sandbox",
    columnId: "review",
    priority: "high",
    tag: "Webhooks",
    assignee: { name: "Eddie Lake" },
    subtasks: { completed: 5, total: 5 },
  },
  {
    id: "task-5",
    code: "OPS-105",
    title: "Emissão de relatório gerencial de fechamento Q3",
    columnId: "done",
    priority: "low",
    tag: "Auditoria",
    assignee: { name: "Emily Whalen" },
    dueDate: "08 Nov",
    subtasks: { completed: 2, total: 2 },
  },
  {
    id: "task-6",
    code: "OPS-106",
    title: "Revisar permissões RBAC de novos analistas de tesouraria",
    columnId: "in-progress",
    priority: "medium",
    tag: "Segurança",
    assignee: { name: "Marina Souza" },
    dueDate: "Amanhã",
  },
]

export function KanbanBoard({
  initialTasksData = initialTasks,
  columns = defaultColumns,
}: {
  initialTasksData?: KanbanTask[]
  columns?: KanbanColumnData[]
}) {
  const [tasks, setTasks] = React.useState<KanbanTask[]>(initialTasksData)
  const [activeTask, setActiveTask] = React.useState<KanbanTask | null>(null)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [priorityFilter, setPriorityFilter] = React.useState<string>("all")

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const filteredTasks = React.useMemo(() => {
    return tasks.filter((task) => {
      const matchesSearch =
        searchQuery === "" ||
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        task.tag.toLowerCase().includes(searchQuery.toLowerCase())

      const matchesPriority =
        priorityFilter === "all" || task.priority === priorityFilter

      return matchesSearch && matchesPriority
    })
  }, [tasks, searchQuery, priorityFilter])

  function handleDragStart(event: DragStartEvent) {
    const { active } = event
    const foundTask = tasks.find((t) => t.id === active.id)
    if (foundTask) {
      setActiveTask(foundTask)
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = active.id
    const overId = over.id

    if (activeId === overId) return

    const isActiveTask = active.data.current?.type === "Task"
    const isOverTask = over.data.current?.type === "Task"
    const isOverColumn = over.data.current?.type === "Column"

    if (!isActiveTask) return

    // Arrastando tarefa sobre outra tarefa em coluna diferente
    if (isActiveTask && isOverTask) {
      setTasks((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId)
        const overIndex = prev.findIndex((t) => t.id === overId)

        if (prev[activeIndex].columnId !== prev[overIndex].columnId) {
          const updated = [...prev]
          updated[activeIndex] = {
            ...updated[activeIndex],
            columnId: prev[overIndex].columnId,
          }
          return arrayMove(updated, activeIndex, overIndex)
        }

        return arrayMove(prev, activeIndex, overIndex)
      })
    }

    // Arrastando tarefa sobre uma coluna vazia ou área da coluna
    if (isActiveTask && isOverColumn) {
      setTasks((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId)
        if (prev[activeIndex].columnId !== overId) {
          const updated = [...prev]
          updated[activeIndex] = {
            ...updated[activeIndex],
            columnId: overId as string,
          }
          return arrayMove(updated, activeIndex, activeIndex)
        }
        return prev
      })
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)

    if (!over) return

    const activeId = active.id
    const overId = over.id

    const activeTaskIndex = tasks.findIndex((t) => t.id === activeId)
    const targetTask = tasks[activeTaskIndex]

    if (targetTask) {
      toast.info(`Tarefa ${targetTask.code} atualizada`, {
        description: `Posicionada na coluna ${targetTask.columnId.toUpperCase()}`,
      })
    }

    if (activeId !== overId) {
      setTasks((prev) => {
        const activeIndex = prev.findIndex((t) => t.id === activeId)
        const overIndex = prev.findIndex((t) => t.id === overId)
        return arrayMove(prev, activeIndex, overIndex)
      })
    }
  }

  function handleAddTask(columnId: string) {
    const newId = `task-${Date.now()}`
    const newCode = `OPS-${Math.floor(100 + Math.random() * 900)}`
    const newTask: KanbanTask = {
      id: newId,
      code: newCode,
      title: "Nova atividade operacional de tesouraria",
      columnId,
      priority: "medium",
      tag: "Operacional",
      assignee: { name: "Eddie Lake" },
      dueDate: "Hoje",
    }

    setTasks((prev) => [newTask, ...prev])
    toast.success(`Tarefa ${newCode} criada!`)
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Board Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-xs">
        <div className="flex flex-1 items-center gap-2 min-w-48 max-w-sm">
          <div className="relative w-full">
            <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar no board..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 text-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <IconFilter className="size-3.5" />
            <span className="hidden sm:inline">Prioridade:</span>
          </div>

          <Combobox
            items={priorityItems}
            value={priorityFilter}
            onValueChange={setPriorityFilter}
            placeholder="Todas"
            searchPlaceholder="Filtrar prioridade..."
            className="w-32"
          />

          <Button
            size="sm"
            onClick={() => handleAddTask("todo")}
            className="h-8 gap-1 text-xs"
          >
            <IconPlus className="size-3.5" />
            <span className="hidden sm:inline">Nova tarefa</span>
          </Button>
        </div>
      </div>

      {/* Dnd Board Arena */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 pt-1 snap-x snap-mandatory scrollbar-none">
          {columns.map((column) => {
            const columnTasks = filteredTasks.filter(
              (task) => task.columnId === column.id
            )
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                tasks={columnTasks}
                onAddTask={handleAddTask}
              />
            )
          })}
        </div>

        {/* Drag Overlay (Smooth floating preview) */}
        <DragOverlay>
          {activeTask ? (
            <div className="w-72">
              <KanbanCardView task={activeTask} isOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

"use client"

import * as React from "react"
import { useDroppable } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { IconDotsVertical, IconPlus } from "@tabler/icons-react"

import { Button } from "@/components/shadcn/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import { cn } from "@/lib/cn"
import { KanbanCard } from "./kanban-card"
import type { KanbanColumnData, KanbanTask } from "./kanban-types"

export function KanbanColumn({
  column,
  tasks,
  onAddTask,
}: {
  column: KanbanColumnData
  tasks: KanbanTask[]
  onAddTask?: (columnId: string) => void
}) {
  const taskIds = React.useMemo(() => tasks.map((t) => t.id), [tasks])

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "Column",
      column,
    },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[82vw] max-w-[320px] sm:w-72 shrink-0 snap-center flex-col rounded-2xl border border-border/50 bg-muted/20 p-2.5 transition-colors",
        "shadow-[0_1px_2px_0_rgba(0,0,0,0.02)] dark:bg-muted/10 dark:border-border/40",
        isOver && "border-primary/50 bg-accent/25 ring-2 ring-primary/20"
      )}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-1 py-1.5">
        <div className="flex items-center gap-2">
          <span
            className={cn("size-2 rounded-full", column.statusDotClass)}
            aria-hidden="true"
          />
          <h3 className="text-xs font-semibold tracking-wider uppercase text-foreground/90">
            {column.title}
          </h3>
          <span className="flex size-5 items-center justify-center rounded-full bg-muted-foreground/15 text-[11px] font-semibold text-muted-foreground">
            {tasks.length}
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => onAddTask?.(column.id)}
            title="Adicionar tarefa nesta coluna"
          >
            <IconPlus className="size-3.5" />
            <span className="sr-only">Adicionar</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
              >
                <IconDotsVertical className="size-3.5" />
                <span className="sr-only">Opções da coluna</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 overflow-hidden">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
              />
              <DropdownMenuItem onClick={() => onAddTask?.(column.id)}>
                Adicionar tarefa
              </DropdownMenuItem>
              <DropdownMenuItem>Limpar coluna</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                Excluir coluna
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Task List / Droppable Area */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto py-1">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <KanbanCard key={task.id} task={task} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex h-28 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 p-4 text-center">
            <p className="text-xs font-medium text-muted-foreground">
              Coluna vazia
            </p>
            <p className="text-[10px] text-muted-foreground/80">
              Arraste tarefas aqui ou clique em +
            </p>
          </div>
        )}
      </div>

      {/* Footer Add Button */}
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-full justify-start gap-1.5 text-xs text-muted-foreground hover:bg-card/70 hover:text-foreground"
        onClick={() => onAddTask?.(column.id)}
      >
        <IconPlus className="size-3.5" />
        Adicionar tarefa
      </Button>
    </div>
  )
}


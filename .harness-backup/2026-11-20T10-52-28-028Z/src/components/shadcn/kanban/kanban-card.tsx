"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  IconAlertTriangle,
  IconCalendar,
  IconChecklist,
  IconDotsVertical,
  IconFlame,
  IconMessageCircle,
} from "@tabler/icons-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/shadcn/ui/avatar"
import { Button } from "@/components/shadcn/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import { cn } from "@/lib/cn"
import type { KanbanTask, Priority } from "./kanban-types"

function PriorityIndicator({ priority }: { priority: Priority }) {
  if (priority === "urgent") {
    return (
      <span
        title="Urgente"
        className="inline-flex items-center gap-1 rounded-sm bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300"
      >
        <IconFlame className="size-3 text-rose-500 animate-pulse" />
        Urgente
      </span>
    )
  }
  if (priority === "high") {
    return (
      <span
        title="Alta"
        className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
      >
        <IconAlertTriangle className="size-3 text-amber-500" />
        Alta
      </span>
    )
  }
  if (priority === "medium") {
    return (
      <span
        title="Média"
        className="inline-flex items-center gap-1 rounded-sm bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300"
      >
        Média
      </span>
    )
  }
  return (
    <span
      title="Baixa"
      className="inline-flex items-center rounded-sm bg-muted/50 px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
    >
      Baixa
    </span>
  )
}

export function KanbanCardView({
  task,
  isOverlay = false,
  isDragging = false,
}: {
  task: KanbanTask
  isOverlay?: boolean
  isDragging?: boolean
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-border/70 bg-card p-3 text-card-foreground transition-all",
        "shadow-[0_1px_3px_0_rgba(0,0,0,0.03),0_4px_12px_0_rgba(0,0,0,0.02)]",
        "hover:border-border/90 hover:shadow-[0_2px_6px_0_rgba(0,0,0,0.05),0_8px_20px_0_rgba(0,0,0,0.03)]",
        "dark:border-border/60 dark:shadow-none dark:hover:border-border/80",
        isDragging && "opacity-35 border-dashed border-primary/50 shadow-none",
        isOverlay && "cursor-grabbing rotate-[1.5deg] shadow-[0_16px_36px_rgba(0,0,0,0.14)] ring-1 ring-primary/20"
      )}
    >
      {/* Rim light superior */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
      />

      {/* Header Row: ID, Priority, Actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-code text-xs font-medium text-muted-foreground">
            {task.code}
          </span>
          <PriorityIndicator priority={task.priority} />
        </div>

        <div className="flex items-center gap-1">
          <Avatar className="size-5 rounded-full ring-1 ring-border/60">
            <AvatarImage src={task.assignee.avatar} alt={task.assignee.name} />
            <AvatarFallback className="text-[10px] font-semibold text-primary">
              {task.assignee.name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 p-0 text-muted-foreground opacity-60 transition-opacity hover:opacity-100 group-hover:opacity-100"
              >
                <IconDotsVertical className="size-3.5" />
                <span className="sr-only">Opções do card</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36 overflow-hidden">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/15 to-transparent dark:via-white/20"
              />
              <DropdownMenuItem>Editar tarefa</DropdownMenuItem>
              <DropdownMenuItem>Copiar link</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Body: Title */}
      <p className="line-clamp-2 text-xs font-semibold leading-relaxed tracking-tight text-foreground/95">
        {task.title}
      </p>

      {/* Footer Meta Row: Tag, Subtasks, Comments, Due Date */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {task.tag}
        </span>

        <div className="flex items-center gap-2 font-medium">
          {task.subtasks && (
            <span
              title="Subtarefas concluídas"
              className="flex items-center gap-1 text-[10px]"
            >
              <IconChecklist className="size-3" />
              {task.subtasks.completed}/{task.subtasks.total}
            </span>
          )}

          {task.commentsCount !== undefined && task.commentsCount > 0 && (
            <span
              title="Comentários"
              className="flex items-center gap-0.5 text-[10px]"
            >
              <IconMessageCircle className="size-3" />
              {task.commentsCount}
            </span>
          )}

          {task.dueDate && (
            <span
              title="Data limite"
              className="flex items-center gap-1 text-[10px]"
            >
              <IconCalendar className="size-3 text-muted-foreground/70" />
              {task.dueDate}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function KanbanCard({ task }: { task: KanbanTask }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: "Task",
      task,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-xl"
    >
      <KanbanCardView task={task} isDragging={isDragging} />
    </div>
  )
}

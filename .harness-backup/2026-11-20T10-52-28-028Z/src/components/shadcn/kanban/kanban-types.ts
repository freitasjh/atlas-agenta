export type Priority = "urgent" | "high" | "medium" | "low"

export type KanbanAssignee = {
  name: string
  avatar?: string
}

export type KanbanTask = {
  id: string
  code: string
  title: string
  columnId: string
  priority: Priority
  tag: string
  assignee: KanbanAssignee
  dueDate?: string
  subtasks?: {
    completed: number
    total: number
  }
  commentsCount?: number
}

export type KanbanColumnData = {
  id: string
  title: string
  statusDotClass: string
}


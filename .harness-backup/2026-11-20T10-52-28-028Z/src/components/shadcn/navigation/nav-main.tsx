"use client"

import { IconCirclePlusFilled, IconMail, type Icon } from "@tabler/icons-react"

import { Button } from "@/components/shadcn/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/shadcn/ui/sidebar"
import { cn } from "@/lib/cn"

export interface NavMainItem {
  id?: string
  title: string
  url: string
  icon?: Icon
  badge?: string
  isActive?: boolean
  onClick?: () => void
}

export function NavMain({
  items,
  onNewEntry,
}: {
  items: NavMainItem[]
  onNewEntry?: () => void
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip="Novo lançamento"
              onClick={onNewEntry}
              className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground cursor-pointer"
            >
              <IconCirclePlusFilled />
              <span>Novo lançamento</span>
            </SidebarMenuButton>
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <IconMail />
              <span className="sr-only">Caixa de entrada</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={item.isActive}
                onClick={item.onClick}
                className={cn(
                  "cursor-pointer transition-colors",
                  item.isActive && "bg-muted font-medium text-foreground shadow-2xs"
                )}
              >
                {item.icon && <item.icon />}
                <span className="flex-1 truncate">{item.title}</span>
                {item.badge && (
                  <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-muted-foreground/15 px-1.5 font-mono text-[10px] font-semibold text-foreground group-data-[collapsible=icon]:hidden">
                    {item.badge}
                  </span>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

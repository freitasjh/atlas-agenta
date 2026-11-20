import type { Meta, StoryObj } from "@storybook/react"
import * as React from "react"
import { MonthYearPicker, type MonthYearValue } from "./month-year-picker"

const meta: Meta<typeof MonthYearPicker> = {
  title: "Shadcn/UI/MonthYearPicker",
  component: MonthYearPicker,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof MonthYearPicker>

export const Default: Story = {
  args: {
    defaultValue: "2026-11",
    format: "long",
  },
}

export const ControlledExample: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [selected, setSelected] = React.useState<MonthYearValue>({
      month: 11,
      monthIndex: 10,
      year: 2026,
      date: new Date(2026, 10, 1),
      label: "Novembro de 2026",
      isoString: "2026-11",
    })

    return (
      <div className="flex flex-col items-center gap-4">
        <MonthYearPicker
          value={selected}
          onChange={(val) => setSelected(val)}
        />
        <div className="rounded-lg border border-border/70 bg-card p-3 text-center text-xs text-muted-foreground font-mono">
          Período selecionado: <strong className="text-foreground">{selected.isoString}</strong> ({selected.label})
        </div>
      </div>
    )
  },
}

export const ShortFormat: Story = {
  args: {
    defaultValue: "2026-11",
    format: "short",
  },
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16">Pequeno:</span>
        <MonthYearPicker size="sm" defaultValue="2026-11" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16">Padrão:</span>
        <MonthYearPicker size="default" defaultValue="2026-11" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16">Grande:</span>
        <MonthYearPicker size="lg" defaultValue="2026-11" />
      </div>
    </div>
  ),
}

export const MinMaxLimits: Story = {
  args: {
    defaultValue: "2026-11",
    minDate: "2026-09",
    maxDate: "2027-02",
  },
}

export const DarkMode: Story = {
  args: {
    defaultValue: "2026-11",
  },
  decorators: [
    (Story) => (
      <div className="dark bg-background p-8 rounded-2xl border border-border/80">
        <Story />
      </div>
    ),
  ],
}


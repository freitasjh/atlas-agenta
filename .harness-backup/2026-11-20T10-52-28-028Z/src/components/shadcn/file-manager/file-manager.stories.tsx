import type { Meta, StoryObj } from "@storybook/react"
import { FileManagerView } from "./file-manager-view"
import { INITIAL_FILES, INITIAL_FOLDERS, INITIAL_STORAGE_OVERVIEW } from "./file-manager-types"

const meta: Meta<typeof FileManagerView> = {
  title: "Shadcn/FileManager/FileManagerView",
  component: FileManagerView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof FileManagerView>

export const Default: Story = {
  args: {
    initialFiles: INITIAL_FILES,
    initialFolders: INITIAL_FOLDERS,
    initialStorage: INITIAL_STORAGE_OVERVIEW,
  },
}

export const Empty: Story = {
  args: {
    initialFiles: [],
    initialFolders: [],
  },
}


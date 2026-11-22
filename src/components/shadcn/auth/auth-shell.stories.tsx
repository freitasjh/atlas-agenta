import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthShell } from "@/components/shadcn/auth/auth-shell";

/**
 * `AuthShell` usa `<Outlet />`, então a story precisa de um contexto de rota.
 * Os dois estados da casca — pública e bloqueada — são documentados aqui antes
 * de qualquer página que os consuma (storybook-first).
 */
function ShellHarness({ internal = false }: { internal?: boolean }) {
  return (
    <ThemeProvider>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<AuthShell internal={internal} />}>
            <Route
              index
              element={
                <p className="text-center text-sm text-muted-foreground">
                  Conteúdo da etapa de autenticação
                </p>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  );
}

const meta = {
  title: "Auth/AuthShell",
  component: ShellHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ShellHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Casca pública: marca com link para `/`, toggle de tema e coluna de marketing. */
export const Default: Story = { args: { internal: false } };

/** Casca bloqueada do `/internal-admin`: só marca + `<Outlet />` em `max-w-md`. */
export const Internal: Story = { args: { internal: true } };

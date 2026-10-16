// Amostra temporária do design system (ADR-02). A ADR-04/05 substitui isto
// pela casca navegável real (rotas + layouts).
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { StatusBadge } from "@/components/StatusBadge";
import { PlaceholderPanel } from "@/components/PlaceholderPanel";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { APPOINTMENT_STATUSES } from "@/types/domain";

function DesignSystemSample() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10 sm:px-6">
        <PlaceholderPanel
          titulo="Design system do Atlas Agenda"
          descricao="Amostra temporária: tokens, tema escuro padrão, botão shadcn e os seis status do agendamento."
        >
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Confirmar</Button>
              <Button variant="outline">Cancelar</Button>
              <Button variant="ghost">Detalhes</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {APPOINTMENT_STATUSES.map((status) => (
                <StatusBadge key={status} status={status} />
              ))}
            </div>
          </div>
        </PlaceholderPanel>
      </main>

      <Toaster />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <DesignSystemSample />
    </ThemeProvider>
  );
}

export default App;

import { LogOut, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSignOut } from "@/hooks/useAuthMutations";

/**
 * Menu do usuário no topbar do `DashboardShell`. Mostra o e-mail de quem está
 * logado (prova visual de sessão ativa — útil no QA) e oferece a ação "Sair".
 *
 * Logout: `useSignOut` (`signOut()` + `queryClient.clear()` no `onSettled`) e só
 * então navega para `/login`. Soberano localmente: `onSettled` cobre sucesso e
 * falha de rede. O e-mail vem de `useCurrentUser` (sessão do servidor), nunca de
 * entrada do cliente.
 */
export function UserMenu() {
  const navigate = useNavigate();
  const { session } = useCurrentUser();
  const signOut = useSignOut();

  const email = session?.user.email ?? "Conta";

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSettled: () => navigate("/login", { replace: true }),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu da conta"
        >
          <UserRound aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={handleSignOut}
          disabled={signOut.isPending}
        >
          <LogOut aria-hidden="true" />
          {signOut.isPending ? "Saindo…" : "Sair"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

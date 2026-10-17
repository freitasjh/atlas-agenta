import { LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { useSignOut } from "@/hooks/useAuthMutations";

interface SignOutButtonProps {
  /** Variante do `Button`. Default `ghost` (item de menu/rodapé). */
  variant?: ButtonProps["variant"];
  className?: string;
}

/**
 * Botão "Sair" compartilhado (rodapé das sidebars, topbar e billing gate).
 *
 * Ação: `useSignOut` (`signOut()` + `queryClient.clear()` no `onSettled`) e só
 * então navega para `/login`. O logout local é soberano — mesmo com falha de
 * rede o cache é limpo e o usuário volta ao login (`onSettled` cobre sucesso e
 * erro). Durante a chamada o botão fica desabilitado para evitar duplo clique.
 */
export function SignOutButton({
  variant = "ghost",
  className,
}: SignOutButtonProps) {
  const navigate = useNavigate();
  const signOut = useSignOut();

  function handleSignOut() {
    signOut.mutate(undefined, {
      onSettled: () => navigate("/login", { replace: true }),
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={handleSignOut}
      disabled={signOut.isPending}
    >
      <LogOut aria-hidden="true" />
      {signOut.isPending ? "Saindo…" : "Sair"}
    </Button>
  );
}

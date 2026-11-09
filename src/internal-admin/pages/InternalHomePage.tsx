import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/hooks/useAuthMutations";

/**
 * Início da área interna: confirma a prova de operador+AAL2 sem expor dado de
 * tenant. Ações operacionais vivem nas Edges; aqui só sessão e saída.
 */
export function InternalHomePage() {
  const signOut = useSignOut();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Operadores internos</CardTitle>
        <CardDescription>Sessão verificada com 2 etapas.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className="text-sm text-muted-foreground">
          Identidade confirmada pelo servidor a cada acesso.
        </p>
        <Button
          variant="outline"
          className="min-h-[44px] w-full"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
        >
          Sair
        </Button>
      </CardContent>
    </Card>
  );
}

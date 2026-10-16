import { Link } from "react-router-dom";

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Páginas-casca da área de autenticação (formulários funcionais vêm na fase
 * de auth). Mínimas e em pt-BR; rendem dentro do card centralizado do
 * AuthLayout.
 */

function AuthCard({
  titulo,
  descricao,
  rodape,
}: {
  titulo: string;
  descricao: string;
  rodape: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardFooter className="text-sm text-muted-foreground">{rodape}</CardFooter>
    </Card>
  );
}

export function LoginPage() {
  return (
    <AuthCard
      titulo="Entrar"
      descricao="Acesse o painel da sua empresa. Formulário em construção."
      rodape={
        <span>
          Ainda não tem conta?{" "}
          <Link to="/cadastro" className="text-primary hover:underline">
            Criar conta
          </Link>
        </span>
      }
    />
  );
}

export function CadastroPage() {
  return (
    <AuthCard
      titulo="Criar conta da empresa"
      descricao="Comece o teste do Atlas Agenda. Formulário em construção."
      rodape={
        <span>
          Já tem conta?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </span>
      }
    />
  );
}

export function RecuperarSenhaPage() {
  return (
    <AuthCard
      titulo="Recuperar senha"
      descricao="Enviaremos um link de redefinição. Formulário em construção."
      rodape={
        <Link to="/login" className="text-primary hover:underline">
          Voltar para o login
        </Link>
      }
    />
  );
}

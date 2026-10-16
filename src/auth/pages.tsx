/**
 * Barrel das páginas da área de autenticação. Cada tela vive em seu próprio
 * arquivo (um componente por arquivo, PascalCase); este módulo só reexporta
 * para manter os imports de `router.tsx` estáveis.
 */
export { LoginPage } from "@/auth/LoginPage";
export { CadastroPage } from "@/auth/CadastroPage";
export { RecuperarSenhaPage } from "@/auth/RecuperarSenhaPage";
export { RedefinirSenhaPage } from "@/auth/RedefinirSenhaPage";

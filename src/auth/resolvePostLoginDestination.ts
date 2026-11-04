import type { Role } from "@/types/domain";

/** Destino padrão de quem não tem `from` utilizável. */
export const POST_LOGIN_DEFAULT = "/app";

/** Destino padrão de professional/receptionist (ADR-004): agenda própria. */
export const POST_LOGIN_PROFESSIONAL = "/app/agenda";
export const POST_LOGIN_RECEPTIONIST = "/app/agenda";

/** Casa do super admin (ADR-08): painel de empresas, não o dashboard. */
export const POST_LOGIN_SUPER_ADMIN = "/admin/empresas";

/** Tela de troca de senha obrigatória (ADR-10). */
export const POST_LOGIN_CHANGE_PASSWORD = "/trocar-senha";

/** Entrada da decisão de destino pós-login. */
export interface PostLoginDestinationInput {
  /** Papel das claims do JWT; `null` = sem claims legíveis. */
  role: Role | null;
  /** Claim `must_change_password` (ADR-01). */
  mustChangePassword?: boolean;
  /** Rota interna que o guard interrompeu (`pathname + search`). */
  from?: string | null;
}

/** Esquema de URL (`https:`, `javascript:`, `data:`…) — nunca é path interno. */
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** ASCII de controle (inclui TAB/LF/CR) e DEL — o navegador os descarta na hora de resolver a URL. */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/**
 * Diz se `from` é um caminho interno seguro para redirecionar.
 *
 * Recusa ASCII de controle primeiro (`\t`, `\n`, `\r`, `\u0000`, `\u007f`):
 * o navegador remove esses caracteres ao parsear a URL, então `/\t/evil.com`
 * seria lido como `//evil.com`. Depois exige começar com `/`, recusa `//` no
 * início (URL protocol-relative), barra invertida (normalizada como `/` por
 * alguns navegadores) e qualquer esquema. Sem essa validação, `state.from`
 * viraria open redirect para fora do site.
 */
export function isInternalPath(from: unknown): from is string {
  if (typeof from !== "string" || from.length === 0) return false;
  if (CONTROL_CHARACTER_PATTERN.test(from)) return false;
  if (URL_SCHEME_PATTERN.test(from)) return false;
  if (!from.startsWith("/")) return false;
  if (from.startsWith("//")) return false;
  if (from.includes("\\")) return false;

  return true;
}

/**
 * Decide o destino pós-login a partir SÓ da sessão (ADR-08). Função pura: é a
 * única fonte da regra de destino — os guards (ADR-11) repetem esta ordem.
 *
 * Ordem (a primeira regra que casa vence):
 * 1. `mustChangePassword === true` → `/trocar-senha`. Primeiro sempre, para
 *    nenhum destino vazar antes da troca obrigatória;
 * 2. `super_admin` → `/admin/empresas`;
 * 3. sem claims (`role` nulo) → `/app` — os guards negam o acesso depois;
 * 4. demais papéis → `from` se for caminho interno válido, senão `/app`.
 */
export function resolvePostLoginDestination({
  role,
  mustChangePassword,
  from,
}: PostLoginDestinationInput): string {
  if (mustChangePassword === true) return POST_LOGIN_CHANGE_PASSWORD;
  if (role === null) return POST_LOGIN_DEFAULT;
  if (role === "super_admin") return POST_LOGIN_SUPER_ADMIN;

  if (role === "professional" || role === "receptionist") {
    // Só respeita `from` se for caminho interno E permitido ao papel; caso
    // contrário cai no destino padrão do papel (evita pousar em rota restrita).
    if (isInternalPath(from) && isAllowedForRole(role, from)) {
      return from;
    }
    return POST_LOGIN_PROFESSIONAL;
  }

  // admin: respeita `from` interno (acesso total ao /app).
  return isInternalPath(from) ? from : POST_LOGIN_DEFAULT;
}

/**
 * Valida se `from` é uma rota que o papel pode acessar (ADR-004). Evita que
 * um professional/receptionist seja redirecionado para rota restrita (ex.:
 * /app/cobrancas) ao fazer login.
 */
function isAllowedForRole(role: Role, path: string): boolean {
  if (role === "admin") return true;
  const pathname = path.split("?")[0].split("#")[0];
  if (pathname === "/app" || pathname === "/app/") return true;
  if (pathname.startsWith("/app/agenda")) return true;
  if (pathname.startsWith("/app/clientes")) return true;
  // Detalhe de horários (router: RequireRole admin/professional/receptionist
  // em /app/config/profissionais/:id/horarios). O índice da lista continua
  // só-admin — não entra aqui.
  if (
    (role === "professional" || role === "receptionist") &&
    /^\/app\/config\/profissionais\/[^/]+\/horarios(\/|$)/.test(pathname)
  ) {
    return true;
  }
  return false;
}

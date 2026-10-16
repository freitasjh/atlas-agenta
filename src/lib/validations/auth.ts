import { z } from "zod";

/**
 * Schema de exemplo de login — prepara o padrão react-hook-form + resolver zod
 * para a fase de auth. Não há submit funcional neste recorte (scaffold).
 *
 * Mensagens de validação em pt-BR, conforme convenção do produto.
 */
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Informe seu e-mail.")
    .email("E-mail inválido."),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres."),
});

export type LoginInput = z.infer<typeof loginSchema>;

import { z } from "npm:zod@3.23.8";

/**
 * `plan` é validado contra o catálogo SSoT `public.plans` no handler (T1.0) —
 * slug desconhecido/inativo ou preço não positivo é 400, nunca um preço
 * default silencioso. O schema só garante a forma do slug; a existência e o
 * preço são lidos da tabela com a service role. `annual` não tem regra de
 * desconto definida, então só `monthly` é aceito; `annual` é rejeitado em
 * vez de inventar `mensal * 10`.
 */
export const requestSchema = z.object({
  tenant_id: z.string().uuid(),
  plan: z.string().trim().min(1).max(64),
  billing_period: z.literal("monthly").default("monthly"),
});
export type RequestInput = z.infer<typeof requestSchema>;

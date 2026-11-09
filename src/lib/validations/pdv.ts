import { z } from "zod";

/**
 * Validação do PDV balcão (ADR-23) — react-hook-form + zod, pt-BR.
 * Cliente é **opcional** (anônimo default); identificado = cadastro rápido
 * (nome + WhatsApp opt-in). Preço, `ends_at` e `starts_at` nunca vêm do form —
 * são derivados no servidor (snapshot do catálogo, `agora + duração`).
 */
export const walkInSchema = z
  .object({
    professionalId: z.string().uuid("Selecione o profissional."),
    selection: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("service"),
        serviceId: z.string().uuid("Selecione o serviço."),
      }),
      z.object({
        kind: z.literal("combo"),
        comboId: z.string().uuid("Selecione o pacote."),
      }),
    ]),
    customerName: z
      .string()
      .trim()
      .max(120, "O nome deve ter no máximo 120 caracteres.")
      .optional(),
    customerPhone: z.string().trim().max(20, "Informe um telefone válido.").optional(),
    whatsappOptIn: z.boolean(),
  })
  .superRefine((input, ctx) => {
    const hasName = (input.customerName ?? "").length > 0;
    const hasPhone = (input.customerPhone ?? "").length > 0;
    if (hasName && !hasPhone) {
      ctx.addIssue({
        code: "custom",
        path: ["customerPhone"],
        message: "Informe o WhatsApp para identificar o cliente.",
      });
    }
    if (hasPhone && !hasName) {
      ctx.addIssue({
        code: "custom",
        path: ["customerName"],
        message: "Informe o nome do cliente.",
      });
    }
  });

export type WalkInInput = z.infer<typeof walkInSchema>;

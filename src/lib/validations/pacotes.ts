import * as z from "zod";

/**
 * Validação da venda de pacote (Fase 2, ADR-02/ADR-06). Espelha os CHECKs do
 * `sell_package`: total e validade > 0, preço >= 0 (centavos inteiros, nunca
 * float). Mensagens em pt-BR instruindo a correção.
 */
export const sellPackageSchema = z.object({
  customerId: z.string().min(1, "Selecione o cliente."),
  serviceId: z.string().min(1, "Selecione o serviço do pacote."),
  totalSessions: z
    .number({ invalid_type_error: "Informe o número de sessões." })
    .int("O número de sessões precisa ser inteiro.")
    .min(1, "O pacote precisa de pelo menos 1 sessão.")
    .max(100, "O pacote comporta no máximo 100 sessões."),
  priceCents: z
    .number({ invalid_type_error: "Informe o preço do pacote." })
    .int("O preço precisa ser em centavos inteiros.")
    .min(0, "O preço não pode ser negativo."),
  validityDays: z
    .number({ invalid_type_error: "Informe a validade em dias." })
    .int("A validade precisa ser em dias inteiros.")
    .min(1, "A validade precisa de pelo menos 1 dia.")
    .max(730, "A validade comporta no máximo 730 dias."),
});

export type SellPackageInput = z.infer<typeof sellPackageSchema>;

/** Valores iniciais do Dialog de venda (pacote avulso de 5 sessões, 30 dias). */
export const SELL_PACKAGE_DEFAULTS: SellPackageInput = {
  customerId: "",
  serviceId: "",
  totalSessions: 5,
  priceCents: 0,
  validityDays: 30,
};

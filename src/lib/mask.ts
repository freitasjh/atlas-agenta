/**
 * Máscaras de apresentação do cadastro rico (ADR-003).
 *
 * Máscara é apresentação; o canônico é só dígitos (`stripDigits`) e viaja no
 * submit. As funções são puras e progressivas: recebem qualquer estado parcial
 * da digitação (ou texto colado já formatado) e devolvem a forma mascarada até
 * ali — nunca travam apagar/colar nem exigem comprimento completo. Por isso o
 * caret do input não salta: o valor só ganha pontuação à direita do que foi
 * digitado.
 */

/** Remove tudo que não é dígito ASCII. Nunca `\d` (aceita dígitos unicode). */
export function stripDigits(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^0-9]/g, "") : "";
}

/**
 * Máscara dinâmica CPF/CNPJ: até 11 dígitos formata como CPF
 * (`000.000.000-00`), do 12º em diante como CNPJ (`00.000.000/0000-00`).
 */
export function maskDocument(value: string): string {
  const digits = stripDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** Máscara de telefone BR: 10 dígitos `(00) 0000-0000`, 11 `(00) 00000-0000`. */
export function maskPhone(value: string): string {
  const digits = stripDigits(value).slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (digits.length <= 10) {
    if (rest.length <= 4) return `(${ddd}) ${rest}`;
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  if (rest.length <= 5) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** Máscara de CEP: `00000-000` progressiva. */
export function maskCep(value: string): string {
  const digits = stripDigits(value).slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

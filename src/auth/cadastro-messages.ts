import type { BusinessSegment } from "@/types/domain";

/**
 * Catálogo local de strings do cadastro rico da empresa (ADR-003).
 *
 * Desvio documentado do ADR (SPEC §2): o repo não tem infra `react-i18next`
 * (nenhuma dependência, tudo literal), então todas as strings novas da tela
 * vivem aqui — labels, helpers, erros por campo, status do ViaCEP e as 27 UFs.
 * A migração futura para `cadastro.*` vira troca mecânica. Nenhum literal
 * solto fora deste catálogo nas telas do cadastro.
 */

/** Rótulos pt-BR dos ramos (mesmos literais do enum do servidor, ADR-002). */
export const CADASTRO_SEGMENT_LABELS: Record<BusinessSegment, string> = {
  barbearia: "Barbearia",
  clinica: "Clínica",
  salao: "Salão de beleza",
} as const;

/** As 27 siglas do IBGE (canônico: UF maiúscula, ADR-001). */
export const CADASTRO_UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

export type CadastroUf = (typeof CADASTRO_UFS)[number];

export const cadastroMessages = {
  title: "Criar conta da empresa",
  subtitle: "Comece seu teste gratuito.",
  lgpdHelper:
    "Usamos estes dados para emitir cobranças e identificar sua empresa. Nada é compartilhado sem seu consentimento.",
  sections: {
    empresa: {
      legend: "Empresa",
      description: "Dados que identificam o seu negócio.",
    },
    endereco: {
      legend: "Endereço",
      description: "Onde sua empresa atende.",
    },
    acesso: {
      legend: "Acesso",
      description: "O e-mail também é o login da conta.",
    },
    responsavel: {
      legend: "Responsável",
      description: "Quem administra a conta.",
    },
  },
  labels: {
    tradeName: "Nome da empresa",
    legalName: "Razão social",
    legalNameOptional: "Razão social (opcional)",
    document: "CNPJ ou CPF",
    phoneEmpresa: "Telefone da empresa",
    addressCep: "CEP",
    addressStreet: "Logradouro",
    addressNumber: "Número",
    addressComplement: "Complemento",
    addressComplementOptional: "Complemento (opcional)",
    addressCity: "Cidade",
    addressState: "UF",
    email: "E-mail",
    password: "Senha",
    confirmPassword: "Confirmar senha",
    fullName: "Seu nome",
    segment: "Ramo da empresa",
  },
  placeholders: {
    email: "voce@empresa.com.br",
    document: "00.000.000/0000-00",
    phoneEmpresa: "(11) 98765-4321",
    addressCep: "01310-100",
    addressStreet: "Avenida Paulista",
    addressNumber: "1000",
    addressComplement: "Sala 1",
    addressCity: "São Paulo",
    segment: "Selecione o ramo",
    addressState: "Selecione a UF",
  },
  helpers: {
    document: "Só números: a formatação é automática.",
    phoneEmpresa: "Com DDD, só números.",
    addressCep: "8 dígitos: buscamos o endereço para você.",
    password: "No mínimo 8 caracteres.",
  },
  errors: {
    tradeName: "Informe o nome da empresa.",
    legalName: "A razão social deve ter entre 2 e 120 caracteres.",
    documentRequired: "Informe o CNPJ ou CPF.",
    documentInvalid: "CNPJ/CPF inválido.",
    phoneEmpresa: "Informe o telefone da empresa.",
    addressCepRequired: "Informe o CEP.",
    addressCepInvalid: "CEP inválido. Use 8 dígitos.",
    addressStreet: "Informe o logradouro.",
    addressNumber: "Informe o número.",
    addressComplement: "O complemento deve ter no máximo 60 caracteres.",
    addressCity: "Informe a cidade.",
    addressState: "Escolha a UF.",
    emailRequired: "Informe seu e-mail.",
    emailInvalid: "E-mail inválido.",
    passwordMin: "A senha deve ter ao menos 8 caracteres.",
    passwordMismatch: "As senhas não coincidem.",
    segment: "Escolha o ramo da sua empresa.",
    fullName: "Informe seu nome.",
    documentTaken: "Este CNPJ/CPF já tem cadastro.",
    emailTaken: "Este e-mail já tem cadastro.",
    generic: "Não foi possível criar sua conta. Tente novamente.",
  },
  viaCep: {
    searching: "Buscando endereço…",
    found: "Endereço encontrado. Confira e complete o número.",
    notFound: "CEP não encontrado. Preencha o endereço manualmente.",
    error: "Não foi possível buscar o CEP. Preencha o endereço manualmente.",
    retry: "Tentar de novo",
  },
  summary: {
    title: "Verifique os campos destacados.",
    goTo: "Ir para o campo",
  },
  submit: "Criar conta",
  submitting: "Criando conta…",
  showPassword: "Mostrar senha",
  hidePassword: "Ocultar senha",
  hasAccount: "Já tem conta?",
  signIn: "Entrar",
  skipAutoLoginNotice: "Conta criada. Entre com seu e-mail e senha.",
  chosenPlan: "Plano escolhido",
  chosenPlanTitle: "Você escolheu o plano",
} as const;

export type CadastroMessages = typeof cadastroMessages;

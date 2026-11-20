export type TeamSize = "solo" | "2-10" | "11-50" | "51-200" | "200+"

export type UserRole =
  | "engineering"
  | "product"
  | "design"
  | "marketing_sales"
  | "operations"
  | "finance_exec"
  | "other"

export interface SignupCredentialsData {
  fullName: string
  email: string
  password: string
  agreeTerms: boolean
}

export interface SignupWorkspaceData {
  companyName: string
  workspaceSlug: string
  teamSize: TeamSize
  role: UserRole
}

export interface SignupInviteData {
  inviteEmails: string[]
}

export interface SignupFullFormData extends SignupCredentialsData, SignupWorkspaceData, SignupInviteData {}

export interface PasswordStrengthResult {
  score: number // 0 a 4
  label: "Muito Fraca" | "Fraca" | "Média" | "Forte" | "Excelente"
  hasMinLength: boolean
  hasUppercase: boolean
  hasNumberOrSymbol: boolean
}

export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const hasMinLength = password.length >= 8
  const hasUppercase = /[A-Z]/.test(password)
  const hasNumberOrSymbol = /[0-9\W]/.test(password)
  const hasExtendedLength = password.length >= 12

  let score = 0
  if (password.length > 0) score += 1
  if (hasMinLength) score += 1
  if (hasUppercase && hasNumberOrSymbol) score += 1
  if (hasExtendedLength && hasUppercase && hasNumberOrSymbol) score += 1

  let label: PasswordStrengthResult["label"] = "Muito Fraca"
  if (score === 2) label = "Fraca"
  else if (score === 3) label = "Média"
  else if (score === 4) label = "Forte"

  return {
    score,
    label,
    hasMinLength,
    hasUppercase,
    hasNumberOrSymbol,
  }
}


export type MfaMethod = "totp" | "sms" | "email" | "backup_code" | "security_key"

export interface MfaUserContext {
  userId: string
  userEmail: string
  phoneNumberMasked?: string
  preferredMethod: MfaMethod
  availableMethods: MfaMethod[]
}

export interface MfaSetupData {
  secretKey: string
  qrCodeUrl: string
  issuer: string
  accountName: string
  backupCodes: string[]
}

export interface MfaVerificationResult {
  success: boolean
  trustDevice?: boolean
  message?: string
  remainingAttempts?: number
}


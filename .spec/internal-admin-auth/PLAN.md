# Refatoração internal-admin — login + MFA + casca

**Bases:** src/components/shadcn/auth/, src/components/shadcn/mfa/
**Alvos:** InternalLoginPage, InternalMfaPage, InternalEnrollPage, casca internal-admin

1. Analisar componentes base e páginas internas atuais.
2. Login interno com AuthShell/LoginForm (anti-enumeracao preservada).
3. MFA com MfaChallengeCard adaptado a listFactors/challenge/verify reais + lockout.
4. Enroll coerente; casca e telas internas padronizadas.
5. Validar build/testes/browser.

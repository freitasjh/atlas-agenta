# Regras: Autenticação em Duas Etapas (MFA / 2FA) e Segurança (mfa-and-security.md)

Este documento especifica a arquitetura, experiência de usuário (UX), acessibilidade (a11y) e padrões de segurança para componentes de **Autenticação em Duas Etapas (MFA / 2FA)**, **Input OTP** e **Códigos de Recuperação** no Harness Templates.

---

## 1. Princípios Fundamentais de UX e Segurança

A autenticação em duas etapas deve equilibrar **alta segurança** com **baixa fricção**. Um fluxo mal projetado resulta em bloqueios acidentais e chamados de suporte.

### Diretrizes Obrigatórias:
1. **Padrão Segmentado (Pillbox Pattern)**: Códigos de 6 dígitos devem ser apresentados em 6 caixas individuais (`InputOtp`), com separador central `-` (3 + 3) para facilitar a leitura e reduzir erros cognitivos.
2. **Suporte a Colagem (Clipboard Paste)**: Usuários frequentemente copiam códigos de SMS, e-mails ou gerenciadores de senhas. Se o usuário colar o código em qualquer uma das caixas, o componente deve capturar os 6 dígitos numéricos e preencher todos os campos instantaneamente.
3. **Otimização para Teclados Mobile**: Todos os inputs de código devem conter obrigatoriamente:
   - `inputMode="numeric"` (abre teclado numérico sem letras no iOS/Android).
   - `pattern="[0-9]*"`.
   - `autoComplete="one-time-code"` (ativa o preenchimento automático de SMS no iOS e Android).
4. **Navegação Inteligente por Teclado**:
   - Avanço automático para a próxima caixa após digitar um dígito.
   - Tecla `Backspace` limpa o caractere atual; se já vazio, recua o foco para a caixa anterior e limpa-a.
   - Teclas `ArrowLeft` e `ArrowRight` navegam entre as caixas.
5. **Auto-Submit Opcional**: Ao preencher o 6º dígito (por digitação ou colagem), o componente deve acionar a validação imediatamente, mantendo o botão de ação visível com indicador de carregamento.

---

## 2. Anatomia do Desafio de Login (`MfaChallengeCard`)

O card de desafio é apresentado imediatamente após a validação bem-sucedida de e-mail e senha.

### Regras do Desafio:
* **Identificação Clara do Canal**: O usuário deve saber exatamente de onde vem o código:
  - TOTP: *"Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador"*.
  - SMS: *"Código enviado por SMS para (11) 9\*\*\*\*-4589"*.
  - Backup: *"Insira um dos seus códigos de recuperação de uso único"*.
* **Confiar neste Dispositivo ("Trust this browser")**:
  - Checkbox acessível: `"Não solicitar neste dispositivo pelos próximos 30 dias"`.
  - Nunca marcar por padrão em ambientes de alto risco ou navegadores anônimos.
* **Caminho de Contingência ("Fallback")**:
  - Se o usuário não tiver acesso ao telefone, forneça um link visível: *"Problemas para acessar? Tentar de outra forma"* ou *"Usar código de recuperação"*.
* **Contagem Regressiva de Reenvio (Cooldown)**:
  - Para SMS e e-mail, o botão de reenvio deve iniciar uma contagem regressiva visual de **60 segundos** para mitigar ataques de negação de serviço e abuso de custos de SMS.
* **Feedback de Erro Não Bloqueante**:
  - Código incorreto: acionar animação sutil de vibração (shake), focar na primeira caixa e exibir mensagem descritiva com o número de tentativas restantes.

---

## 3. Fluxo de Ativação e Configuração (`MfaSetupDialog`)

A ativação do MFA deve ser um fluxo guiado em **3 etapas obrigatórias**:

```
[Etapa 1: Escanear QR Code + Chave Manual] 
                    ↓
[Etapa 2: Validação com Código de 6 Dígitos] 
                    ↓
[Etapa 3: Salvamento Obrigatório de Códigos de Backup]
```

### Regras da Configuração:
1. **Acessibilidade no QR Code**:
   - Nunca confie apenas na câmera. Sempre exiba a **chave secreta alfanumérica** em fonte monospace legível (`select-all`) com botão de **Copiar Segredo** para usuários que utilizam leitores de tela ou autenticadores desktop.
2. **Confirmação Prévia Obrigatória (Etapa 2)**:
   - Jamais ative o MFA na conta do usuário sem exigir a digitação do primeiro código de 6 dígitos gerado no app dele, garantindo que o relógio e a chave estão sincronizados.
3. **Códigos de Recuperação Inegociáveis (Etapa 3)**:
   - O usuário **não pode concluir a ativação** sem visualizar os 10 códigos reservas de emergência.
   - Fornecer ações rápidas: **Copiar Códigos** e **Baixar Arquivo (.txt)** preformatado.
   - Exigir a marcação do checkbox de confirmação: *"Confirmo que copiei ou baixei meus 10 códigos de recuperação em um local seguro"*.

---

## 4. Gestão de Códigos de Recuperação (`MfaBackupCodesDialog`)

Os códigos de emergência descartáveis são a última linha de defesa contra bloqueio permanente da conta.

### Regras de Negócio:
* **Indicador de Consumo**: Exibir quantos códigos ainda restam ativos (ex: *"8 de 10 códigos restantes"*).
* **Alerta Crítico**: Quando restarem $\le 2$ códigos ativos, exibir um banner de aviso incentivando o usuário a gerar uma nova lista.
* **Alerta de Revogação**: Ao clicar em *"Gerar Novos Códigos"*, exibir confirmação explícita de que **todos os códigos anteriores serão imediatamente revogados**.
* **Marcação Visual de Utilizados**: Códigos já consumidos devem aparecer tachados (`line-through`) com a etiqueta `(Usado)`.

---

## 5. Diretrizes de Código e Acessibilidade (WCAG)

```tsx
// Exemplo de uso do InputOtp com acessibilidade total
<InputOtp
  length={6}
  value={code}
  onChange={setCode}
  onComplete={handleSubmit}
  isInvalid={hasError}
  autoFocus
/>
```

* Cada caixa interna do `InputOtp` deve conter `aria-label="Dígito X de 6"`.
* Foco visual em anel semântico: `focus:ring-2 focus:ring-primary/20 focus:border-primary`.
* Estado inválido com token de erro: `border-destructive text-destructive focus:ring-destructive/20`.
* Compatível com tema Claro e Escuro utilizando estritamente variáveis de design token (`bg-background`, `text-foreground`, `border-border`, `bg-card`).


-- Migration: appointments_state_machine — máquina de estados no banco (ADR-04, RF07)
-- O agendamento tem um ciclo de vida com transições ESTRITAS (OLD -> NEW). O CHECK de coluna
-- da ADR-02 cobre apenas o CONJUNTO de valores válidos de `status`; ele não enxerga a transição
-- de um valor antigo para um novo. A guarda de transição precisa comparar `OLD.status` com
-- `NEW.status`, o que só um trigger `BEFORE UPDATE` consegue fazer.
--
-- Defesa em profundidade: a UI (ADR-08) já só oferece transições válidas; este trigger é a
-- trava real no banco, independente de a camada de app errar. As duas camadas são
-- complementares: CHECK = valores possíveis; trigger = transições possíveis.
--
-- Diagrama de transições (RF07):
--   pendente       -> confirmado | em_atendimento | cancelado | nao_compareceu
--   confirmado     -> em_atendimento | cancelado | nao_compareceu
--   em_atendimento -> concluido | cancelado
--   concluido      -> (final, imutável)
--   cancelado      -> (final, imutável)
--   nao_compareceu -> (final, imutável)
--
-- Efeito colateral de domínio (P1): ao ENTRAR em `confirmado`, carimbar `confirmed_at` com
-- now() — derivado da transição, NUNCA preenchido pelo cliente. O frontend não envia (nem deve)
-- `confirmed_at`. O carimbo é idempotente (só escreve se `confirmed_at is null`), então
-- confirmar de novo (caso raro de reentrada) não reescreve o instante original.
--
-- ESCOPO desta migration (ADR-04): função + trigger. NENHUMA integração: nada de tabela
-- `charges`/`messages`, nada de Edge Function, nada de PIX/WhatsApp. Os ganchos das fases
-- seguintes (concluido -> cobrança PIX; confirmado -> mensagem WhatsApp) ficam APENAS como
-- comentário no ponto exato de extensão, sem código (trava negativa AC-21).
--
-- Separada da ADR-02/ADR-03 em migration própria para coesão e diagnóstico se o `db reset`
-- falhar neste passo. Timestamp > ADR-03 para ordenar depois dela.
--
-- Contrato para o frontend: transição inválida levanta SQLSTATE `23514` (check_violation), que a
-- app mapeia para pt-BR ("Não é possível mudar para este status.") no mapa de erros da fundação
-- (ADR-05). A função NÃO é `security definer` (só lê/escreve colunas da própria linha — menor
-- superfície). Idempotente no re-apply (`create or replace function` / `drop trigger if exists`).
-- Nenhum segredo no SQL.

-- ============================================================================
-- appointments_validate_transition — guarda de transição da máquina de estados.
-- Roda BEFORE UPDATE OF status: compara OLD.status com NEW.status e barra transições fora do
-- diagrama; carimba confirmed_at ao entrar em 'confirmado'.
-- ============================================================================
create or replace function appointments_validate_transition()
returns trigger
language plpgsql
as $$
begin
  -- Sem mudança de estado: UPDATE de outros campos (ex.: corrigir starts_at) passa sem a guarda.
  if new.status = old.status then
    return new;
  end if;

  -- Estados finais são imutáveis: nenhuma saída é permitida.
  if old.status in ('concluido','cancelado','nao_compareceu') then
    raise exception 'Transicao de status invalida: % e um estado final e nao pode mudar para %',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Transições permitidas a partir de cada estado não-final (ver diagrama no cabeçalho).
  if not (
    (old.status = 'pendente'
      and new.status in ('confirmado','em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'confirmado'
      and new.status in ('em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'em_atendimento'
      and new.status in ('concluido','cancelado'))
  ) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Efeito colateral (P1): ao entrar em 'confirmado', carimbar confirmed_at uma única vez.
  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  -- ==========================================================================
  -- GANCHOS DE FASES SEGUINTES (apenas documentação; NÃO implementar aqui):
  --   - Ao entrar em 'concluido': disparar geração de cobrança PIX (RF13, skill asaas-pix) e a
  --     mensagem de cobrança via WhatsApp. Fará parte da fase financeira (tabela `charges` +
  --     Edge Function com service role). NENHUM código de integração neste trigger.
  --   - Ao entrar em 'confirmado': enfileirar mensagem de confirmação no WhatsApp (skill
  --     whatsapp-evolution, tabela `messages`). Também fase futura.
  -- O ponto de extensão natural é logo após o carimbo acima, mas o disparo de efeitos externos
  -- deve viver fora do caminho do UPDATE (fila/Edge Function), não dentro deste trigger.
  -- ==========================================================================

  return new;
end;
$$;

-- Trigger: dispara só quando a coluna `status` entra no SET do UPDATE — UPDATEs que não mexem em
-- status não pagam o custo da função.
drop trigger if exists appointments_transition_guard on appointments;
create trigger appointments_transition_guard
  before update of status on appointments
  for each row
  execute function appointments_validate_transition();

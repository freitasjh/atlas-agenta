import { useRef } from "react";
import type { Control } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import type { MessageTemplateInput } from "@/lib/validations/whatsapp";
import { VariableChips } from "@/app/config/mensagens/VariableChips";

/** Limite do corpo no form (ADR-05; o banco aceita até 2000). */
const MAX_BODY = 1000;

interface TemplateBodyFieldProps {
  control: Control<MessageTemplateInput>;
  disabled?: boolean;
}

/**
 * Campo do corpo do template: chips de variável acima, `Textarea` controlado
 * pelo rhf, e abaixo o contador de caracteres (`aria-live`) + dica pt-BR.
 * Inserir um chip injeta o `{token}` na posição do cursor do textarea.
 */
export function TemplateBodyField({
  control,
  disabled,
}: TemplateBodyFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  return (
    <FormField
      control={control}
      name="body"
      render={({ field }) => {
        function insertToken(token: string) {
          const textarea = textareaRef.current;
          const current = field.value ?? "";
          if (!textarea) {
            field.onChange(current + token);
            return;
          }
          const start = textarea.selectionStart ?? current.length;
          const end = textarea.selectionEnd ?? current.length;
          const next = current.slice(0, start) + token + current.slice(end);
          field.onChange(next);
          // Reposiciona o cursor após o token inserido, mantendo o foco.
          const caret = start + token.length;
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(caret, caret);
          });
        }

        const length = (field.value ?? "").length;

        return (
          <FormItem className="space-y-2">
            <FormLabel>Texto do modelo</FormLabel>
            <VariableChips onInsert={insertToken} disabled={disabled} />
            <FormControl>
              <Textarea
                {...field}
                ref={(node) => {
                  field.ref(node);
                  textareaRef.current = node;
                }}
                rows={5}
                maxLength={MAX_BODY}
                disabled={disabled}
                placeholder="Ex.: Olá {nome}, confirmando {servico} em {dataHora}."
              />
            </FormControl>
            <div className="flex items-center justify-between gap-2">
              <FormDescription>
                Use as variáveis para personalizar. Se um dado faltar, entra um
                texto padrão no lugar.
              </FormDescription>
              <span
                aria-live="polite"
                className="shrink-0 text-xs tabular-nums text-muted-foreground"
              >
                {length}/{MAX_BODY}
              </span>
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

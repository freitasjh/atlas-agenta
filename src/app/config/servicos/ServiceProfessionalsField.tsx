import { Loader2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useProfessionals } from "@/hooks/useProfessionals";

interface ServiceProfessionalsFieldProps {
  /** IDs dos profissionais atualmente selecionados. */
  value: string[];
  /** Emite a nova lista completa de IDs selecionados. */
  onChange: (professionalIds: string[]) => void;
  /** Desabilita a interação (leitura / enquanto salva). */
  disabled?: boolean;
}

/**
 * Seção N:N "Profissionais que executam este serviço", renderizada dentro do
 * form do serviço (D6 — sem rota própria). Lista os profissionais **ativos** do
 * tenant (`useProfessionals({ activeOnly: true })`) com um checkbox por
 * profissional; o estado é a lista de IDs selecionados, controlada pelo form.
 */
export function ServiceProfessionalsField({
  value,
  onChange,
  disabled,
}: ServiceProfessionalsFieldProps) {
  const professionalsQuery = useProfessionals({ activeOnly: true });

  function toggle(professionalId: string, checked: boolean) {
    if (checked) {
      if (value.includes(professionalId)) return;
      onChange([...value, professionalId]);
    } else {
      onChange(value.filter((id) => id !== professionalId));
    }
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium leading-none">
        Profissionais que executam este serviço
      </legend>
      <p className="text-sm text-muted-foreground">
        Marque quem pode atender este serviço. Só profissionais ativos aparecem
        aqui.
      </p>

      {professionalsQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando profissionais…
        </p>
      ) : professionalsQuery.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar os profissionais. Tente novamente.
        </p>
      ) : professionalsQuery.data && professionalsQuery.data.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          {professionalsQuery.data.map((professional) => {
            const checkboxId = `service-professional-${professional.id}`;
            return (
              <div key={professional.id} className="flex items-center gap-3">
                <Checkbox
                  id={checkboxId}
                  checked={value.includes(professional.id)}
                  onCheckedChange={(checked) =>
                    toggle(professional.id, checked === true)
                  }
                  disabled={disabled}
                />
                <Label htmlFor={checkboxId} className="font-normal">
                  {professional.name}
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nenhum profissional ativo. Cadastre profissionais para vinculá-los a
          serviços.
        </p>
      )}
    </fieldset>
  );
}

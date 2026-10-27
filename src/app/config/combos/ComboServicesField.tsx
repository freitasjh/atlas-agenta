import { Loader2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useServices } from "@/hooks/useServices";
import { formatCentsToBRL } from "@/lib/money";

interface ComboServicesFieldProps {
  /** IDs dos serviços atualmente selecionados para o pacote. */
  value: string[];
  /** Emite a nova lista completa de IDs selecionados. */
  onChange: (serviceIds: string[]) => void;
  /** Desabilita a interação (leitura / enquanto salva). */
  disabled?: boolean;
}

/**
 * Seção N:N "Serviços incluídos no pacote", renderizada dentro do form do
 * pacote (espelha `ServiceProfessionalsField`). Lista os serviços **ativos** do
 * tenant (`useServices({ activeOnly: true })`) com um checkbox por serviço e um
 * texto auxiliar `45 min · R$ 50,00` (duração e preço de referência). O estado
 * é a lista de IDs selecionados, controlada pelo form. O invariante "≥1
 * serviço" é validado pelo `comboSchema` antes de submeter.
 */
export function ComboServicesField({
  value,
  onChange,
  disabled,
}: ComboServicesFieldProps) {
  const servicesQuery = useServices({ activeOnly: true });

  function toggle(serviceId: string, checked: boolean) {
    if (checked) {
      if (value.includes(serviceId)) return;
      onChange([...value, serviceId]);
    } else {
      onChange(value.filter((id) => id !== serviceId));
    }
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium leading-none">
        Serviços incluídos no pacote
      </legend>
      <p className="text-sm text-muted-foreground">
        Marque os serviços que compõem o pacote. Só serviços ativos aparecem
        aqui.
      </p>

      {servicesQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando serviços…
        </p>
      ) : servicesQuery.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar os serviços. Tente novamente.
        </p>
      ) : servicesQuery.data && servicesQuery.data.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          {servicesQuery.data.map((service) => {
            const checkboxId = `combo-service-${service.id}`;
            return (
              <div key={service.id} className="flex items-center gap-3">
                <Checkbox
                  id={checkboxId}
                  checked={value.includes(service.id)}
                  onCheckedChange={(checked) =>
                    toggle(service.id, checked === true)
                  }
                  disabled={disabled}
                />
                <Label
                  htmlFor={checkboxId}
                  className="flex flex-1 flex-wrap items-baseline justify-between gap-x-3 font-normal"
                >
                  <span>{service.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {service.duration_minutes} min ·{" "}
                    {formatCentsToBRL(service.price_cents)}
                  </span>
                </Label>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Nenhum serviço ativo. Cadastre serviços para montar um pacote.
        </p>
      )}
    </fieldset>
  );
}

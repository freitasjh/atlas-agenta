import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MoneyInput } from "@/components/MoneyInput";
import type {
  DepositConfigInput,
  DepositRefundPolicy,
  DepositType,
} from "@/lib/validations/deposit";

export interface DepositConfigSectionProps {
  /**
   * `true` = recurso liberado. `false`/`null` = seção invisível + upsell
   * (ADR-12 §4: sem entitlement a seção/CTA somem, nenhum request sensível).
   */
  entitled: boolean | null;
  value: DepositConfigInput;
  onChange: (next: DepositConfigInput) => void;
  disabled?: boolean;
}

function set<T extends keyof DepositConfigInput>(
  value: DepositConfigInput,
  onChange: (next: DepositConfigInput) => void,
  patch: Pick<DepositConfigInput, T>,
) {
  onChange({ ...value, ...patch });
}

/**
 * Seção de depósito/sinal do `ServiceFormDialog` (Fase 4, ADR-12 / PRD RF-01).
 * Apresentação pura: o estado mora no form pai via `value`/`onChange`.
 * Sem entitlement, os campos somem e aparece o upsell para `/precos`.
 */
export function DepositConfigSection({
  entitled,
  value,
  onChange,
  disabled = false,
}: DepositConfigSectionProps) {
  if (entitled !== true) {
    return (
      <section
        aria-label="Depósito/sinal indisponível no plano atual"
        className="space-y-3 rounded-md border border-dashed border-border p-4"
      >
        <p className="text-sm font-medium">Depósito/sinal</p>
        <p className="text-sm text-muted-foreground">
          Exija um sinal via PIX para confirmar o agendamento e reduzir faltas.
          Recurso não incluído no plano atual.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/precos">Ver planos</Link>
        </Button>
      </section>
    );
  }

  const locked = disabled;
  const showValueAsMoney = value.type !== "percent";

  return (
    <section aria-label="Configuração de depósito/sinal" className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="deposit-enabled">Exigir depósito/sinal</Label>
          <p className="text-sm text-muted-foreground">
            Cliente paga um sinal via PIX ao agendar este serviço.
          </p>
        </div>
        <Switch
          id="deposit-enabled"
          checked={value.enabled}
          disabled={locked}
          onCheckedChange={(checked) =>
            set(value, onChange, { enabled: checked })
          }
          aria-label="Exigir depósito/sinal"
        />
      </div>

      {value.enabled ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deposit-type">Tipo de depósito</Label>
            <Select
              value={value.type ?? undefined}
              onValueChange={(next) =>
                set(value, onChange, { type: next as DepositType })
              }
              disabled={locked}
            >
              <SelectTrigger id="deposit-type" aria-label="Tipo de depósito">
                <SelectValue placeholder="Escolha percentual ou valor fixo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentual do preço (%)</SelectItem>
                <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.type === "percent" ? (
            <div className="space-y-2">
              <Label htmlFor="deposit-value-percent">
                Percentual do depósito
              </Label>
              <Input
                id="deposit-value-percent"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                disabled={locked}
                value={value.value || ""}
                onChange={(event) =>
                  set(value, onChange, {
                    value: event.target.valueAsNumber || 0,
                  })
                }
                aria-describedby="deposit-value-percent-ajuda"
              />
              <p
                id="deposit-value-percent-ajuda"
                className="text-xs text-muted-foreground"
              >
                De 1 a 100% do preço do serviço.
              </p>
            </div>
          ) : null}

          {showValueAsMoney && value.type === "fixed" ? (
            <div className="space-y-2">
              <Label htmlFor="deposit-value-fixed">Valor do depósito</Label>
              <MoneyInput
                id="deposit-value-fixed"
                value={value.value}
                disabled={locked}
                onChange={(cents) => set(value, onChange, { value: cents })}
              />
              <p className="text-xs text-muted-foreground">
                Valor fixo em reais, mínimo R$ 1,00.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="deposit-deadline">Prazo para pagar (horas)</Label>
            <Input
              id="deposit-deadline"
              type="number"
              inputMode="numeric"
              min={1}
              max={720}
              step={1}
              disabled={locked}
              value={value.deadlineHours || ""}
              onChange={(event) =>
                set(value, onChange, {
                  deadlineHours: event.target.valueAsNumber || 0,
                })
              }
              aria-describedby="deposit-deadline-ajuda"
            />
            <p
              id="deposit-deadline-ajuda"
              className="text-xs text-muted-foreground"
            >
              Sem pagamento no prazo, o agendamento é cancelado e o horário é
              liberado.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit-refund">Política de reembolso</Label>
            <Select
              value={value.refundPolicy}
              onValueChange={(next) =>
                set(value, onChange, {
                  refundPolicy: next as DepositRefundPolicy,
                })
              }
              disabled={locked}
            >
              <SelectTrigger
                id="deposit-refund"
                aria-label="Política de reembolso"
              >
                <SelectValue placeholder="Escolha a política" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Total</SelectItem>
                <SelectItem value="partial">Parcial (%)</SelectItem>
                <SelectItem value="none">Sem reembolso</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Aplicada ao cancelar um agendamento com depósito pago.
            </p>
          </div>

          {value.refundPolicy === "partial" ? (
            <div className="space-y-2">
              <Label htmlFor="deposit-refund-percent">
                Percentual reembolsável
              </Label>
              <Input
                id="deposit-refund-percent"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                disabled={locked}
                value={value.refundPercent ?? ""}
                onChange={(event) =>
                  set(value, onChange, {
                    refundPercent: event.target.valueAsNumber || 0,
                  })
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

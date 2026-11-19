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
import { crmMessages } from "@/app/clientes/crm-messages";
import type { CrmFilter } from "@/app/clientes/crm-model";

const t = crmMessages.filtros;

/**
 * Filtros da lista de clientes (RF-29): tag, segmento, no-show mínimo.
 * Client-side sobre a lista carregada, no molde da busca existente.
 */
export function CustomerCrmFilters({
  value,
  onChange,
  tags,
}: {
  value: CrmFilter;
  onChange: (next: CrmFilter) => void;
  tags: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="filtro-tag">{t.tagLabel}</Label>
        <Select value={value.tag || "__all"} onValueChange={(next) => onChange({ ...value, tag: next === "__all" ? "" : next })}>
          <SelectTrigger id="filtro-tag" aria-label={t.tagLabel}>
            <SelectValue placeholder={t.allTags} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t.allTags}</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="filtro-segmento">{t.segmentLabel}</Label>
        <Input
          id="filtro-segmento"
          placeholder={t.segmentPlaceholder}
          value={value.segment}
          onChange={(event) => onChange({ ...value, segment: event.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="filtro-noshow">{t.minNoShowLabel}</Label>
        <Input
          id="filtro-noshow"
          type="number"
          inputMode="numeric"
          min={0}
          value={String(value.minNoShow)}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange({ ...value, minNoShow: Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0 });
          }}
        />
      </div>
      <div className="flex items-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange({ tag: "", segment: "", minNoShow: 0 })}
        >
          {t.clear}
        </Button>
      </div>
    </div>
  );
}

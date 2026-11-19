import { useCallback, useState } from "react";

/**
 * Seleção de lote da agenda (ADR-04): checkbox por item da Lista com teto de
 * 50 (F4/Q3 do fundador). Acima do teto o item é recusado e `limitHit`
 * sinaliza a mensagem — nunca estoura para 51.
 */
export const BULK_SELECTION_LIMIT = 50;

export interface BulkSelection {
  selectedIds: string[];
  count: number;
  limit: number;
  /** `true` após uma tentativa além do teto (a barra exibe a mensagem). */
  limitHit: boolean;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
}

export function useBulkSelection(
  limit: number = BULK_SELECTION_LIMIT,
): BulkSelection {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [limitHit, setLimitHit] = useState(false);

  const isSelected = useCallback(
    (id: string) => selectedIds.includes(id),
    [selectedIds],
  );

  const toggle = useCallback(
    (id: string) => {
      if (selectedIds.includes(id)) {
        setSelectedIds((current) =>
          current.filter((selected) => selected !== id),
        );
        setLimitHit(false);
        return;
      }
      if (selectedIds.length >= limit) {
        setLimitHit(true);
        return;
      }
      setSelectedIds((current) => [...current, id]);
    },
    [limit, selectedIds],
  );

  const selectAll = useCallback(
    (ids: string[]) => {
      const unique = [...new Set(ids)].slice(0, limit);
      setSelectedIds(unique);
      setLimitHit(ids.length > limit);
    },
    [limit],
  );

  const clear = useCallback(() => {
    setSelectedIds([]);
    setLimitHit(false);
  }, []);

  return {
    selectedIds,
    count: selectedIds.length,
    limit,
    limitHit,
    isSelected,
    toggle,
    selectAll,
    clear,
  };
}

import { Badge } from "@/components/ui/badge";

/** Selo "Balcão" — venda walk-in (`origin='walk_in'`, ADR-23). */
export function WalkInBadge({ label = "Balcão" }: { label?: string }) {
  return <Badge variant="secondary">{label}</Badge>;
}

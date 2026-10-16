import { PlaceholderPanel } from "@/components/PlaceholderPanel";

/**
 * Páginas-casca da área de marketing (conteúdo final vem na ADR-05).
 * Mínimas e em pt-BR: rendem o layout sem erro e marcam o ponto de extensão.
 */

export function LandingPage() {
  return (
    <PlaceholderPanel
      titulo="Atlas Agenda"
      descricao="Agenda e cobrança via WhatsApp e PIX para quem atende clientes. Landing em construção."
    />
  );
}

export function PrecosPage() {
  return (
    <PlaceholderPanel
      titulo="Planos e preços"
      descricao="Individual, Clínica e Pro. Tabela de planos em construção."
    />
  );
}

export function TermosPage() {
  return (
    <PlaceholderPanel
      titulo="Termos e privacidade"
      descricao="Termos de uso e política de privacidade (LGPD) em construção."
    />
  );
}

import { useEffect, useState } from "react";
import { z } from "zod";
import { Loader2, MailPlus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useInviteMember } from "@/hooks/useInvitations";

const emailSchema = z.string().trim().email();

interface ConviteProfissionalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  professionalId: string;
  professionalName: string;
  onSuccess?: () => void;
}

/**
 * Dialog de convite de acesso para um profissional pré-cadastrado. Reusa
 * `useInviteMember` com `role=professional` e `professional_id` fixos (ADR-005).
 * Apenas o e-mail é informado pelo admin.
 */
export function ConviteProfissionalDialog({
  open,
  onOpenChange,
  professionalId,
  professionalName,
  onSuccess,
}: ConviteProfissionalDialogProps) {
  const inviteMember = useInviteMember();
  const [email, setEmail] = useState("");

  const isEmailValid = emailSchema.safeParse(email).success;

  useEffect(() => {
    if (!open) {
      setEmail("");
    }
  }, [open]);

  async function handleSubmit() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    try {
      await inviteMember.mutateAsync({
        email: parsed.data,
        role: "professional",
        professional_id: professionalId,
      });
      toast.success("Convite enviado.");
      onOpenChange(false);
      setEmail("");
      onSuccess?.();
    } catch {
      toast.error("Não foi possível enviar o convite. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para acesso</DialogTitle>
          <DialogDescription>
            Envie um convite por e-mail para {professionalName} acessar o sistema
            como profissional.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="convite-profissional-email">E-mail</Label>
          <Input
            id="convite-profissional-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@empresa.com"
            autoComplete="email"
            disabled={inviteMember.isPending}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={inviteMember.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={inviteMember.isPending || !isEmailValid}
          >
            {inviteMember.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Enviando…
              </>
            ) : (
              <>
                <MailPlus aria-hidden="true" />
                Enviar convite
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
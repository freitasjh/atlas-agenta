import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle,
  Clock,
  Loader2,
  Phone,
  Scissors,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import { env } from "@/lib/env";

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

type Step = "service" | "professional" | "datetime" | "customer" | "confirm";

interface Tenant {
  trade_name: string | null;
  legal_name: string | null;
  phone: string | null;
}

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
}

interface Professional {
  id: string;
  name: string;
}

interface Slot {
  slot_start: string;
  slot_end: string;
}

const STEP_LABELS: string[] = [
  "Serviço",
  "Profissional",
  "Data e horário",
  "Seus dados",
  "Confirmação",
];

function initialsOf(name: string | null | undefined): string {
  const base = (name ?? "").trim();
  if (!base) return "A";
  return base
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatPrice(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
  });
}

function validateName(value: string): string | undefined {
  if (value.trim().length < 2) return "Informe seu nome (mínimo 2 caracteres).";
  return undefined;
}

function validatePhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return "Telefone inválido (mínimo 10 dígitos).";
  return undefined;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return `(${digits}`;
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${area}) ${rest}`;
  if (rest.length <= 8) return `(${area}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${area}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
}

function buildIcs(service: Service | null, professional: Professional | null, slot: Slot | null, customerName: string): string {
  if (!service || !professional || !slot) return "";
  const start = new Date(slot.slot_start);
  const end = new Date(slot.slot_end);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Atlas Agenda//PT",
    "BEGIN:VEVENT",
    `UID:${slot.slot_start}@atlas`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:${service.name} - ${professional.name}`,
    `DESCRIPTION:Agendamento de ${customerName}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

export function AgendarPage() {
  const { token } = useParams<{ token: string }>();

  const [step, setStep] = useState<Step>("service");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerTouched, setCustomerTouched] = useState({ name: false, phone: false });
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = ["service", "professional", "datetime", "customer", "confirm"].indexOf(step);

  const nameError = customerTouched.name ? validateName(customerName) : undefined;
  const phoneError = customerTouched.phone ? validatePhone(customerPhone) : undefined;
  const isCustomerValid = !validateName(customerName) && !validatePhone(customerPhone);

  const tenantName = tenant?.trade_name?.trim() || tenant?.legal_name?.trim() || "Agendamento Online";
  const tenantInitials = initialsOf(tenant?.trade_name || tenant?.legal_name);

  async function loadInitialData() {
    try {
      setLoading(true);
      setError(null);
      const today = new Date().toLocaleDateString("en-CA");
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/public-slots?token=${token}&service_id=00000000-0000-0000-0000-000000000000&date=${today}`,
        { headers: { apikey: SUPABASE_ANON_KEY } },
      );
      if (res.ok) {
        const data = await res.json();
        setTenant(data.tenant ?? null);
        setServices(data.services || []);
        setProfessionals(data.professionals || []);
      } else {
        setError("Link inválido ou expirado");
      }
    } catch {
      setError("Erro ao carregar agendamento");
    } finally {
      setLoading(false);
    }
  }

  async function loadSlots(date: string) {
    if (!date || !selectedService) return;
    try {
      setSlotsLoading(true);
      const url = new URL(`${SUPABASE_URL}/functions/v1/public-slots`);
      url.searchParams.set("token", token ?? "");
      url.searchParams.set("service_id", selectedService.id);
      if (selectedProfessional?.id) url.searchParams.set("professional_id", selectedProfessional.id);
      url.searchParams.set("date", date);
      const res = await fetch(url.toString(), { headers: { apikey: SUPABASE_ANON_KEY } });
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots || []);
      } else {
        setSlots([]);
      }
    } catch {
      setSlots([]);
      setError("Erro ao carregar horários");
    } finally {
      setSlotsLoading(false);
    }
  }

  async function handleBooking() {
    if (!selectedService || !selectedProfessional || !selectedSlot) return;
    try {
      setBooking(true);
      setError(null);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/public-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          token,
          service_id: selectedService.id,
          professional_id: selectedProfessional.id,
          starts_at: selectedSlot.slot_start,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
        }),
      });
      if (res.ok) {
        setSuccess(true);
      } else {
        let message = "Erro ao agendar";
        try {
          const data = await res.json();
          if (data?.error === "slot_unavailable") message = "Horário indisponível";
        } catch {
          // ignore
        }
        setError(message);
      }
    } catch {
      setError("Erro ao agendar");
    } finally {
      setBooking(false);
    }
  }

  function resetAll() {
    setSuccess(false);
    setError(null);
    setStep("service");
    setSelectedService(null);
    setSelectedProfessional(null);
    setSelectedDate("");
    setSlots([]);
    setSelectedSlot(null);
    setCustomerName("");
    setCustomerPhone("");
    setCustomerTouched({ name: false, phone: false });
    loadInitialData();
  }

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const el = document.getElementById("main");
    el?.focus();
  }, [step]);

  const progressValue = ((stepIndex + 1) / 5) * 100;
  const progressLabel = `Etapa ${stepIndex + 1} de 5 — ${STEP_LABELS[stepIndex]}`;

  if (!loading && error && services.length === 0 && !success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
        >
          Pular para o conteúdo
        </a>
        <main id="main" tabIndex={-1} className="w-full max-w-md">
          <Card className="text-center" role="alert">
            <CardHeader>
              <AlertCircle className="h-16 w-16 text-destructive mx-auto mb-4" aria-hidden="true" />
              <CardTitle className="font-display text-destructive">Link inválido</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => loadInitialData()} className="min-h-11">
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <main id="main" tabIndex={-1} className="w-full max-w-md">
          <Card className="text-center" role="status">
            <CardHeader>
              <CheckCircle className="h-16 w-16 text-status-concluido mx-auto mb-4" aria-hidden="true" />
              <CardTitle className="font-display">Agendamento solicitado!</CardTitle>
              <CardDescription>Aguarde confirmação via WhatsApp</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Card className="text-left">
                <CardContent className="pt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <dt className="font-medium text-muted-foreground">Serviço:</dt>
                    <dd>{selectedService?.name}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="font-medium text-muted-foreground">Profissional:</dt>
                    <dd>{selectedProfessional?.name}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="font-medium text-muted-foreground">Data/Hora:</dt>
                    <dd>{selectedSlot ? formatDateTime(selectedSlot.slot_start) : ""}</dd>
                  </div>
                </CardContent>
              </Card>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const ics = buildIcs(selectedService, selectedProfessional, selectedSlot, customerName);
                    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "agendamento.ics";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="flex-1 min-h-11"
                >
                  Adicionar ao calendário
                </Button>
                <Button variant="ghost" onClick={resetAll} className="flex-1 min-h-11">
                  Novo agendamento
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Pular para o conteúdo
      </a>

      <header className="border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
          <Avatar className="h-11 w-11">
            <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
              {tenantInitials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold truncate">{tenantName}</h1>
            <p className="text-sm text-muted-foreground">Agende seu horário online</p>
            {tenant?.phone && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="h-3 w-3" aria-hidden="true" />
                {tenant.phone}
              </p>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="mb-6" aria-live="polite">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium" role="status">{progressLabel}</span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={stepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={5}
            aria-label={progressLabel}
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all motion-reduce:transition-none"
              style={{ width: `${progressValue}%` }}
            />
          </div>

          <ol className="mt-3 flex items-center justify-between gap-1" aria-hidden="true">
            {STEP_LABELS.map((label, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={label} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                  <span
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium border motion-reduce:transition-none",
                      done && "bg-primary text-primary-foreground border-primary",
                      current && "border-primary text-primary bg-primary/10",
                      !done && !current && "border-muted text-muted-foreground bg-background",
                    )}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="hidden sm:block text-[10px] text-muted-foreground truncate w-full text-center">
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <div key={step} className="animate-in fade-in slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
        {step === "service" && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Escolha o serviço</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div aria-busy="true" aria-live="polite" className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg border p-4">
                      <Skeleton className="h-10 w-10 rounded-full motion-reduce:animate-none" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
                        <Skeleton className="h-3 w-1/3 motion-reduce:animate-none" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-full motion-reduce:animate-none" />
                    </div>
                  ))}
                </div>
              ) : services.length === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <Scissors className="h-12 w-12 mx-auto text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum serviço disponível no momento
                  </p>
                  {tenant?.phone && (
                    <Button variant="outline" asChild className="min-h-11">
                      <a href={`tel:${tenant.phone.replace(/\D/g, "")}`}>
                        <Phone className="h-4 w-4 mr-2" aria-hidden="true" />
                        Contatar {tenant.phone}
                      </a>
                    </Button>
                  )}
                </div>
              ) : (
                services.map((service) => (
                  <Button
                    key={service.id}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedService(service);
                      setStep("professional");
                    }}
                    className="w-full min-h-11 h-auto p-4 border rounded-lg text-left justify-start hover:border-primary active:scale-[0.98] motion-reduce:active:scale-100 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex justify-between items-center gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{service.name}</p>
                        <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="h-3 w-3" aria-hidden="true" /> {service.duration_minutes} min
                        </p>
                      </div>
                      <Badge variant="secondary">{formatPrice(service.price_cents)}</Badge>
                    </div>
                  </Button>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {step === "professional" && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Escolha o profissional</CardTitle>
              <CardDescription>{selectedService?.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {professionals.length === 0 ? (
                <div className="py-8 text-center space-y-3">
                  <User className="h-12 w-12 mx-auto text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum profissional disponível
                  </p>
                  <Button variant="ghost" className="min-h-11" onClick={() => setStep("service")}>
                    <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" /> Voltar
                  </Button>
                </div>
              ) : (
                professionals.map((prof) => (
                  <Button
                    key={prof.id}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedProfessional(prof);
                      setStep("datetime");
                    }}
                    className="w-full min-h-11 h-auto p-4 border rounded-lg text-left hover:border-primary active:scale-[0.98] motion-reduce:active:scale-100 transition-all duration-150 flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring justify-start"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-muted text-foreground">
                        {initialsOf(prof.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{prof.name || "Profissional"}</span>
                  </Button>
                ))
              )}
              <Button variant="ghost" className="min-h-11" onClick={() => setStep("service")}>
                <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" /> Voltar
              </Button>
            </CardContent>
          </Card>
        )}

        {step === "datetime" && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Escolha data e horário</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="booking-date">Data</Label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { label: "Hoje", days: 0 },
                    { label: "Amanhã", days: 1 },
                    { label: "+7 dias", days: 7 },
                  ].map((chip) => {
                    const d = dateOffset(chip.days);
                    const active = selectedDate === d;
                    return (
                      <Button
                        key={chip.label}
                        type="button"
                        variant={active ? "default" : "outline"}
                        size="sm"
                        className="min-h-11"
                        onClick={() => {
                          setSelectedDate(d);
                          setSelectedSlot(null);
                          loadSlots(d);
                        }}
                      >
                        {chip.label}
                      </Button>
                    );
                  })}
                </div>
                <Input
                  id="booking-date"
                  type="date"
                  aria-label="Data do agendamento"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setSelectedSlot(null);
                    loadSlots(e.target.value);
                  }}
                  min={new Date().toLocaleDateString("en-CA")}
                  className="h-11"
                />
              </div>

              {selectedDate && (
                <>
                  {slotsLoading ? (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" aria-busy="true" aria-live="polite">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <Skeleton key={i} className="h-11 w-full motion-reduce:animate-none" />
                      ))}
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="py-6 text-center space-y-3">
                      <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden="true" />
                      <p className="text-sm text-muted-foreground">
                        Sem horários disponíveis nesta data — tente outra data
                      </p>
                      {tenant?.phone && (
                        <Button variant="outline" size="sm" asChild className="min-h-11">
                          <a href={`tel:${tenant.phone.replace(/\D/g, "")}`}>
                            <Phone className="h-4 w-4 mr-2" aria-hidden="true" />
                            Falar com a empresa
                          </a>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {slots.map((slot) => {
                        const selected = selectedSlot?.slot_start === slot.slot_start;
                        return (
                          <Button
                            key={slot.slot_start}
                            type="button"
                            variant={selected ? "default" : "outline"}
                            className={cn("min-h-11 active:scale-[0.98] motion-reduce:active:scale-100 transition-all", selected && "ring-2 ring-primary")}
                            aria-pressed={selected}
                            aria-label={`Horário ${formatTime(slot.slot_start)}`}
                            onClick={() => setSelectedSlot(slot)}
                          >
                            {selected && <Check className="h-3 w-3 mr-1 inline" aria-hidden="true" />}
                            {formatTime(slot.slot_start)}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-sm border border-input" aria-hidden="true" />
                      Disponível
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
                      Selecionado
                    </span>
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Button variant="ghost" className="min-h-11" onClick={() => setStep("professional")}>
                  <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" /> Voltar
                </Button>
                <Button
                  disabled={!selectedSlot}
                  onClick={() => setStep("customer")}
                  className="ml-auto min-h-11"
                >
                  Continuar <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "customer" && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Seus dados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customer-name">Nome completo</Label>
                <Input
                  id="customer-name"
                  autoComplete="name"
                  aria-required="true"
                  aria-invalid={!!nameError}
                  aria-describedby={nameError ? "customer-name-error" : "customer-name-helper"}
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  onBlur={() => setCustomerTouched((t) => ({ ...t, name: true }))}
                  className="h-11"
                />
                {nameError ? (
                  <p id="customer-name-error" className="text-xs text-destructive">{nameError}</p>
                ) : (
                  <p id="customer-name-helper" className="text-xs text-muted-foreground flex items-center gap-1">
                    {customerName.trim().length >= 2 && <Check className="h-3 w-3 text-status-concluido" aria-hidden="true" />}
                    Mínimo de 2 caracteres.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="customer-phone">Telefone/WhatsApp</Label>
                <Input
                  id="customer-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  aria-required="true"
                  aria-invalid={!!phoneError}
                  aria-describedby={phoneError ? "customer-phone-error" : "customer-phone-helper"}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(maskPhone(e.target.value))}
                  onBlur={() => setCustomerTouched((t) => ({ ...t, phone: true }))}
                  placeholder="(00) 00000-0000"
                  className="h-11"
                />
                {phoneError ? (
                  <p id="customer-phone-error" className="text-xs text-destructive">{phoneError}</p>
                ) : (
                  <p id="customer-phone-helper" className="text-xs text-muted-foreground flex items-center gap-1">
                    {customerPhone.replace(/\D/g, "").length >= 10 && <Check className="h-3 w-3 text-status-concluido" aria-hidden="true" />}
                    DDD + número (mínimo 10 dígitos).
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Button variant="ghost" className="min-h-11" onClick={() => setStep("datetime")}>
                  <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" /> Voltar
                </Button>
                <Button
                  disabled={!isCustomerValid}
                  onClick={() => setStep("confirm")}
                  className="ml-auto min-h-11"
                >
                  Continuar <ArrowRight className="h-4 w-4 ml-2" aria-hidden="true" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Confirmar agendamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <Scissors className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Serviço</dt>
                  <dd className="flex-1">{selectedService?.name}</dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("service")}>Editar</Button>
                </div>
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Profissional</dt>
                  <dd className="flex-1">{selectedProfessional?.name}</dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("professional")}>Editar</Button>
                </div>
                <div className="flex items-start gap-2">
                  <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Data/Hora</dt>
                  <dd className="flex-1">
                    {selectedDate} {selectedSlot && formatTime(selectedSlot.slot_start)}
                  </dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("datetime")}>Editar</Button>
                </div>
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Cliente</dt>
                  <dd className="flex-1">{customerName}</dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("customer")}>Editar</Button>
                </div>
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Telefone</dt>
                  <dd className="flex-1">{customerPhone}</dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("customer")}>Editar</Button>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 text-muted-foreground" aria-hidden="true" />
                  <dt className="font-medium text-muted-foreground w-24">Valor</dt>
                  <dd className="flex-1">
                    {selectedService && formatPrice(selectedService.price_cents)}
                  </dd>
                  <Button variant="ghost" size="sm" className="min-h-11 px-2 text-xs" onClick={() => setStep("service")}>Editar</Button>
                </div>
              </dl>

              <div className="flex gap-2">
                <Button variant="ghost" className="min-h-11" onClick={() => setStep("customer")}>
                  <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" /> Voltar
                </Button>
                <Button
                  disabled={booking}
                  onClick={handleBooking}
                  className="ml-auto min-h-11"
                >
                  {booking ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      Agendando...
                    </>
                  ) : (
                    "Confirmar agendamento"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </main>
    </div>
  );
}

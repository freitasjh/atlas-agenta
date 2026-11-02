import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Clock, User, CheckCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatePanel } from "@/components/StatePanel";
import { cn } from "@/lib/utils";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

type Step = "service" | "professional" | "datetime" | "customer" | "confirm";

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

export function AgendarPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("service");
  const [services, setServices] = useState<Service[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProfessional, setSelectedProfessional] = useState<Professional | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInitialData();
  }, [token]);

  async function loadInitialData() {
    try {
      setLoading(true);
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/public-slots?token=${token}&service_id=00000000-0000-0000-0000-000000000000&date=${today}`,
        { headers: { apikey: SUPABASE_ANON_KEY } }
      );
      if (res.ok) {
        const data = await res.json();
        setServices(data.services || []);
        setProfessionals(data.professionals || []);
      } else {
        setError("Link inválido ou expirado");
      }
    } catch (e) {
      setError("Erro ao carregar agendamento");
    } finally {
      setLoading(false);
    }
  }

  async function loadSlots(date: string) {
    if (!selectedService) return;
    try {
      setLoading(true);
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/public-slots?token=${token}&service_id=${selectedService.id}&professional_id=${selectedProfessional?.id || ""}&date=${date}`,
        { headers: { apikey: SUPABASE_ANON_KEY } }
      );
      if (res.ok) {
        const data = await res.json();
        setSlots(data.slots || []);
      }
    } catch (e) {
      setError("Erro ao carregar horários");
    } finally {
      setLoading(false);
    }
  }

  async function handleBooking() {
    if (!selectedService || !selectedProfessional || !selectedSlot) return;
    try {
      setBooking(true);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/public-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({
          token,
          service_id: selectedService.id,
          professional_id: selectedProfessional.id,
          starts_at: selectedSlot.slot_start,
          customer_name: customerName,
          customer_phone: customerPhone,
        }),
      });
      if (res.ok) {
        setSuccess(true);
      } else {
        const data = await res.json();
        setError(data.error === "slot_unavailable" ? "Horário indisponível" : "Erro ao agendar");
      }
    } catch (e) {
      setError("Erro ao agendar");
    } finally {
      setBooking(false);
    }
  }

  const formatPrice = (cents: number) => `R$ ${(cents / 100).toFixed(2)}`;
  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (loading && step === "service") {
    return <StatePanel titulo="Carregando..." descricao="Preparando agendamento" />;
  }

  if (error && !services.length) {
    return <StatePanel titulo="Link inválido" descricao={error} />;
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <CardTitle>Agendamento solicitado!</CardTitle>
            <CardDescription>Seu agendamento foi criado com status pendente. Aguarde confirmação.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Agendamento Online</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          {["service", "professional", "datetime", "customer", "confirm"].map((s, i) => (
            <div key={s} className={cn("flex items-center", i < 4 && "flex-1")}>
              <div className={cn("h-8 w-8 rounded-full flex items-center justify-center text-sm", 
                step === s ? "bg-primary text-primary-foreground" : ["service","professional","datetime","customer"].indexOf(step) >= i ? "bg-primary/20" : "bg-muted")}>
                {i + 1}
              </div>
              {i < 4 && <div className="flex-1 h-0.5 mx-2 bg-muted" />}
            </div>
          ))}
        </div>

        {step === "service" && (
          <Card>
            <CardHeader>
              <CardTitle>Escolha o serviço</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {services.map((service) => (
                <button
                  key={service.id}
                  onClick={() => { setSelectedService(service); setStep("professional"); }}
                  className="w-full p-4 border rounded-lg text-left hover:border-primary transition-colors"
                >
                  <div className="flex justify-between">
                    <div>
                      <p className="font-medium">{service.name}</p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {service.duration_minutes} min</p>
                    </div>
                    <Badge variant="secondary">{formatPrice(service.price_cents)}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {step === "professional" && (
          <Card>
            <CardHeader>
              <CardTitle>Escolha o profissional</CardTitle>
              <CardDescription>{selectedService?.name}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {professionals.map((prof) => (
                <button
                  key={prof.id}
                  onClick={() => { setSelectedProfessional(prof); setStep("datetime"); }}
                  className="w-full p-4 border rounded-lg text-left hover:border-primary transition-colors flex items-center gap-3"
                >
                  <User className="h-5 w-5" />
                  <span className="font-medium">{prof.name || "Profissional"}</span>
                </button>
              ))}
              <Button variant="ghost" onClick={() => setStep("service")}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
            </CardContent>
          </Card>
        )}

        {step === "datetime" && (
          <Card>
            <CardHeader>
              <CardTitle>Escolha data e horário</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Data</Label>
                <Input type="date" value={selectedDate} onChange={(e) => { setSelectedDate(e.target.value); loadSlots(e.target.value); }} min={new Date().toISOString().split("T")[0]} />
              </div>
              {selectedDate && (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => (
                    <Button key={slot.slot_start} variant={selectedSlot?.slot_start === slot.slot_start ? "default" : "outline"} onClick={() => setSelectedSlot(slot)}>
                      {formatTime(slot.slot_start)}
                    </Button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("professional")}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
                <Button disabled={!selectedSlot} onClick={() => setStep("customer")} className="ml-auto">Continuar <ArrowRight className="h-4 w-4 ml-2" /></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "customer" && (
          <Card>
            <CardHeader>
              <CardTitle>Seus dados</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Nome completo</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label>Telefone/WhatsApp</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="(00) 00000-0000" />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("datetime")}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
                <Button disabled={!customerName || !customerPhone} onClick={() => setStep("confirm")} className="ml-auto">Continuar <ArrowRight className="h-4 w-4 ml-2" /></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "confirm" && (
          <Card>
            <CardHeader>
              <CardTitle>Confirmar agendamento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <p><strong>Serviço:</strong> {selectedService?.name}</p>
                <p><strong>Profissional:</strong> {selectedProfessional?.name}</p>
                <p><strong>Data/Hora:</strong> {selectedDate} {selectedSlot && formatTime(selectedSlot.slot_start)}</p>
                <p><strong>Cliente:</strong> {customerName}</p>
                <p><strong>Telefone:</strong> {customerPhone}</p>
                <p><strong>Valor:</strong> {selectedService && formatPrice(selectedService.price_cents)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep("customer")}><ArrowLeft className="h-4 w-4 mr-2" /> Voltar</Button>
                <Button disabled={booking} onClick={handleBooking} className="ml-auto">{booking ? "Agendando..." : "Confirmar agendamento"}</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

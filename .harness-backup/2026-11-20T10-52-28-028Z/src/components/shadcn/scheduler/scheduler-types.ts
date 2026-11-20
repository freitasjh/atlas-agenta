export type ProfessionalStatus = "available" | "busy" | "away"

export interface Professional {
  id: string
  name: string
  role: string
  avatar: string
  initials: string
  status: ProfessionalStatus
  color: {
    bg: string
    border: string
    text: string
    badge: string
  }
  workHours: {
    start: string // "08:00"
    end: string   // "19:00"
    lunchStart?: string // "12:00"
    lunchEnd?: string   // "13:00"
  }
}

export type AppointmentStatus =
  | "confirmed"
  | "in_progress"
  | "pending"
  | "completed"
  | "cancelled"

export interface Appointment {
  id: string
  professionalId: string
  clientName: string
  clientPhone?: string
  clientEmail?: string
  service: string
  date: string // "YYYY-MM-DD"
  startTime: string // "09:00"
  endTime: string   // "10:00"
  status: AppointmentStatus
  price: number
  room?: string
  notes?: string
}

export type SchedulerViewMode = "day" | "week" | "list"

export const START_HOUR = 8
export const END_HOUR = 19
export const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60 // 660 mins

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

export function formatPriceBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

export const STATUS_CONFIG: Record<
  AppointmentStatus,
  {
    label: string
    dotColor: string
    bgLight: string
    borderColor: string
    textColor: string
  }
> = {
  confirmed: {
    label: "Confirmado",
    dotColor: "bg-emerald-500",
    bgLight: "bg-emerald-500/10 dark:bg-emerald-500/15",
    borderColor: "border-emerald-500/30",
    textColor: "text-emerald-700 dark:text-emerald-300",
  },
  in_progress: {
    label: "Em Atendimento",
    dotColor: "bg-sky-500 animate-pulse",
    bgLight: "bg-sky-500/10 dark:bg-sky-500/15",
    borderColor: "border-sky-500/30",
    textColor: "text-sky-700 dark:text-sky-300",
  },
  pending: {
    label: "Pendente",
    dotColor: "bg-amber-500",
    bgLight: "bg-amber-500/10 dark:bg-amber-500/15",
    borderColor: "border-amber-500/30",
    textColor: "text-amber-700 dark:text-amber-300",
  },
  completed: {
    label: "Concluído",
    dotColor: "bg-muted-foreground",
    bgLight: "bg-muted/40",
    borderColor: "border-border/60",
    textColor: "text-muted-foreground",
  },
  cancelled: {
    label: "Cancelado",
    dotColor: "bg-rose-500",
    bgLight: "bg-rose-500/10 dark:bg-rose-500/15",
    borderColor: "border-rose-500/30",
    textColor: "text-rose-700 dark:text-rose-300",
  },
}

export const INITIAL_PROFESSIONALS: Professional[] = [
  {
    id: "prof-1",
    name: "Dra. Camila Torres",
    role: "Cardiologia Clínica",
    avatar: "https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=120&auto=format&fit=crop&q=80",
    initials: "CT",
    status: "available",
    color: {
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      text: "text-emerald-700 dark:text-emerald-300",
      badge: "bg-emerald-500",
    },
    workHours: {
      start: "08:00",
      end: "18:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    },
  },
  {
    id: "prof-2",
    name: "Dr. Lucas Meireles",
    role: "Dermatologia & Estética",
    avatar: "https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=120&auto=format&fit=crop&q=80",
    initials: "LM",
    status: "busy",
    color: {
      bg: "bg-sky-500/10",
      border: "border-sky-500/30",
      text: "text-sky-700 dark:text-sky-300",
      badge: "bg-sky-500",
    },
    workHours: {
      start: "08:30",
      end: "19:00",
      lunchStart: "12:30",
      lunchEnd: "13:30",
    },
  },
  {
    id: "prof-3",
    name: "Dra. Mariana Dias",
    role: "Ortopedia & Traumatologia",
    avatar: "https://images.unsplash.com/photo-1594824813570-58348574d538?w=120&auto=format&fit=crop&q=80",
    initials: "MD",
    status: "available",
    color: {
      bg: "bg-violet-500/10",
      border: "border-violet-500/30",
      text: "text-violet-700 dark:text-violet-300",
      badge: "bg-violet-500",
    },
    workHours: {
      start: "08:00",
      end: "17:30",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    },
  },
  {
    id: "prof-4",
    name: "Dr. Rodrigo Ramos",
    role: "Fisioterapia Avançada",
    avatar: "https://images.unsplash.com/photo-1537368910025-700350fe46c7?w=120&auto=format&fit=crop&q=80",
    initials: "RR",
    status: "away",
    color: {
      bg: "bg-amber-500/10",
      border: "border-amber-500/30",
      text: "text-amber-700 dark:text-amber-300",
      badge: "bg-amber-500",
    },
    workHours: {
      start: "09:00",
      end: "18:00",
      lunchStart: "13:00",
      lunchEnd: "14:00",
    },
  },
]

export const INITIAL_APPOINTMENTS: Appointment[] = [
  {
    id: "apt-1",
    professionalId: "prof-1",
    clientName: "Renata Vasconcelos",
    clientPhone: "(11) 98765-4321",
    clientEmail: "renata.v@example.com",
    service: "Check-up Cardiológico",
    date: "2026-11-10",
    startTime: "08:30",
    endTime: "09:30",
    status: "completed",
    price: 450,
    room: "Consultório 102",
    notes: "Paciente com histórico de hipertensão familiar. ECG solicitado.",
  },
  {
    id: "apt-2",
    professionalId: "prof-1",
    clientName: "Eduardo Silveira",
    clientPhone: "(11) 97722-1133",
    clientEmail: "eduardo.s@example.com",
    service: "Ecocardiograma com Doppler",
    date: "2026-11-10",
    startTime: "10:00",
    endTime: "11:15",
    status: "in_progress",
    price: 600,
    room: "Sala de Exames B",
    notes: "Retorno pós-cirúrgico de 6 meses.",
  },
  {
    id: "apt-3",
    professionalId: "prof-1",
    clientName: "Beatriz Nogueira",
    clientPhone: "(11) 96655-4422",
    clientEmail: "beatriz.n@example.com",
    service: "Consulta de Rotina",
    date: "2026-11-10",
    startTime: "14:00",
    endTime: "15:00",
    status: "confirmed",
    price: 400,
    room: "Consultório 102",
    notes: "Primeira consulta de acompanhamento anual.",
  },
  {
    id: "apt-4",
    professionalId: "prof-1",
    clientName: "Henrique Faria",
    clientPhone: "(11) 95544-3322",
    clientEmail: "henrique.f@example.com",
    service: "Avaliação Pré-Operatória",
    date: "2026-11-10",
    startTime: "16:00",
    endTime: "17:00",
    status: "pending",
    price: 480,
    room: "Consultório 102",
    notes: "Exames de sangue anexados no prontuário.",
  },
  {
    id: "apt-5",
    professionalId: "prof-2",
    clientName: "Clara Mendonça",
    clientPhone: "(11) 94433-2211",
    clientEmail: "clara.m@example.com",
    service: "Mapeamento de Pintas & Nevos",
    date: "2026-11-10",
    startTime: "09:00",
    endTime: "10:00",
    status: "completed",
    price: 520,
    room: "Consultório 204",
    notes: "Dermatoscopia digital completa.",
  },
  {
    id: "apt-6",
    professionalId: "prof-2",
    clientName: "Thiago Albuquerque",
    clientPhone: "(11) 93322-1100",
    clientEmail: "thiago.a@example.com",
    service: "Procedimento Laser Fracionado",
    date: "2026-11-10",
    startTime: "10:30",
    endTime: "12:00",
    status: "in_progress",
    price: 950,
    room: "Sala Estética 1",
    notes: "Sessão 2 de 4. Aplicar anestésico tópico 30m antes.",
  },
  {
    id: "apt-7",
    professionalId: "prof-2",
    clientName: "Sabrina Sato Ramos",
    clientPhone: "(11) 92211-0099",
    clientEmail: "sabrina.r@example.com",
    service: "Consulta Dermatológica",
    date: "2026-11-10",
    startTime: "14:30",
    endTime: "15:30",
    status: "confirmed",
    price: 450,
    room: "Consultório 204",
  },
  {
    id: "apt-8",
    professionalId: "prof-3",
    clientName: "Gabriel Antunes",
    clientPhone: "(11) 91100-9988",
    clientEmail: "gabriel.a@example.com",
    service: "Infiltração de Joelho",
    date: "2026-11-10",
    startTime: "08:30",
    endTime: "09:45",
    status: "completed",
    price: 800,
    room: "Procedimentos Ortopédicos",
    notes: "Ácido hialurônico de alta viscosidade.",
  },
  {
    id: "apt-9",
    professionalId: "prof-3",
    clientName: "Juliana Paes Correia",
    clientPhone: "(11) 90099-8877",
    clientEmail: "juliana.p@example.com",
    service: "Avaliação Postural & Coluna",
    date: "2026-11-10",
    startTime: "11:00",
    endTime: "12:00",
    status: "confirmed",
    price: 420,
    room: "Consultório 301",
  },
  {
    id: "apt-10",
    professionalId: "prof-3",
    clientName: "Otávio Mesquita Jr.",
    clientPhone: "(11) 98877-6655",
    clientEmail: "otavio.m@example.com",
    service: "Retorno Pós-Imobilização",
    date: "2026-11-10",
    startTime: "15:00",
    endTime: "16:00",
    status: "confirmed",
    price: 350,
    room: "Consultório 301",
  },
  {
    id: "apt-11",
    professionalId: "prof-4",
    clientName: "Felipe Bronze",
    clientPhone: "(11) 97766-5544",
    clientEmail: "felipe.b@example.com",
    service: "Reabilitação Motora Ombro",
    date: "2026-11-10",
    startTime: "10:00",
    endTime: "11:00",
    status: "confirmed",
    price: 280,
    room: "Studio Fisio",
    notes: "Fase 3 de fortalecimento do manguito rotador.",
  },
  {
    id: "apt-12",
    professionalId: "prof-4",
    clientName: "Larissa Manoela Souza",
    clientPhone: "(11) 96655-4433",
    clientEmail: "larissa.m@example.com",
    service: "Liberação Miofascial & Dry Needling",
    date: "2026-11-10",
    startTime: "14:00",
    endTime: "15:15",
    status: "confirmed",
    price: 320,
    room: "Studio Fisio",
  },
]


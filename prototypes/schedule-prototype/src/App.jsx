import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  LayoutDashboard,
  List,
  LogOut,
  Menu,
  Moon,
  Plus,
  Receipt,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Visão geral", icon: LayoutDashboard },
  { label: "Agenda", icon: CalendarDays },
  { label: "PDV", icon: Store },
  { label: "Clientes", icon: Users },
  { label: "Cobranças", icon: Receipt },
  { label: "Configurações", icon: Settings },
  { label: "Relatórios", icon: BarChart3 },
];

const INITIAL_APPOINTMENTS = [
  {
    id: "a1",
    date: "2026-11-12",
    start: "09:30",
    end: "10:00",
    client: "Camila Souza",
    service: "Corte e barba",
    professional: "Profissional Demo",
    status: "confirmado",
    priceCents: 5000,
    serviceColor: "var(--service-1)",
  },
  {
    id: "a2",
    date: "2026-11-12",
    start: "11:30",
    end: "12:00",
    client: "Rafael Lima",
    service: "Corte de cabelo",
    professional: "Profissional Demo",
    status: "confirmado",
    priceCents: 5000,
    serviceColor: "var(--service-2)",
  },
  {
    id: "a3",
    date: "2026-11-13",
    start: "10:00",
    end: "10:45",
    client: "Bruna Alves",
    service: "Coloração",
    professional: "Profissional Demo",
    status: "pendente",
    priceCents: 12000,
    serviceColor: "var(--service-4)",
  },
  {
    id: "a4",
    date: "2026-11-10",
    start: "14:00",
    end: "15:00",
    client: "Diego Martins",
    service: "Barboterapia",
    professional: "Profissional Demo",
    status: "concluido",
    priceCents: 8000,
    serviceColor: "var(--service-3)",
  },
  {
    id: "a5",
    date: "2026-11-16",
    start: "09:00",
    end: "09:30",
    client: "Larissa Gomes",
    service: "Corte e barba",
    professional: "Profissional Demo",
    status: "confirmado",
    priceCents: 5000,
    serviceColor: "var(--service-1)",
  },
];

const HOURS = Array.from({ length: 11 }, (_, index) => 9 + index);
const HOUR_HEIGHT = 58;
const DAY_START_MINUTES = 9 * 60;
const TODAY_ISO = "2026-11-19";
const TOMORROW_ISO = "2026-11-20";

const STATUS_LABELS = {
  confirmado: "Confirmado",
  pendente: "A confirmar",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatDateBR(iso) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function startOfWeek(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}

function minutesOf(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMoney(cents) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function MetricCard({ label, value, support, active, onClick }) {
  return (
    <button
      type="button"
      className={`metric-card${active ? " is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-support">{support}</span>
    </button>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <span className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </span>
    </label>
  );
}

function AppointmentPill({ appointment }) {
  return (
    <span className={`status-pill status-${appointment.status}`}>
      {STATUS_LABELS[appointment.status] ?? appointment.status}
    </span>
  );
}

function DaySchedule({ appointments, onOpen }) {
  return (
    <section className="schedule-panel" aria-label="Agenda do dia por profissional">
      <header className="professional-header">
        <span className="professional-avatar">PD</span>
        <span>
          <strong>Profissional Demo</strong>
          <small>{appointments.length} agendamentos</small>
        </span>
      </header>
      <div className="timeline-scroll">
        <div className="timeline">
          <div className="time-gutter" aria-hidden="true">
            {HOURS.map((hour) => (
              <span key={hour} style={{ height: HOUR_HEIGHT }}>
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          <div className="timeline-grid" style={{ height: HOURS.length * HOUR_HEIGHT }}>
            {HOURS.map((hour) => (
              <div key={hour} className="hour-line" style={{ height: HOUR_HEIGHT }} />
            ))}
            {appointments.map((appointment) => {
              const top =
                ((minutesOf(appointment.start) - DAY_START_MINUTES) / 60) * HOUR_HEIGHT;
              const height =
                ((minutesOf(appointment.end) - minutesOf(appointment.start)) / 60) *
                HOUR_HEIGHT;
              return (
                <button
                  key={appointment.id}
                  type="button"
                  className={`appointment-block appointment-${appointment.status}`}
                  style={{ top, height: Math.max(height, 44) }}
                  onClick={() => onOpen(appointment)}
                >
                  <span className="appointment-caret" aria-hidden="true">
                    <ChevronDown size={15} />
                  </span>
                  <span className="appointment-copy">
                    <span className="appointment-client">
                      <i style={{ background: appointment.serviceColor }} aria-hidden="true" />
                      {appointment.client}
                    </span>
                    <span className="appointment-service">
                      {appointment.start}–{appointment.end} · {appointment.service}
                    </span>
                  </span>
                  <AppointmentPill appointment={appointment} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function ListSchedule({ appointments, onOpen }) {
  if (appointments.length === 0) {
    return (
      <section className="empty-panel" aria-label="Lista de agendamentos">
        <strong>Nenhum agendamento para este dia</strong>
        <span>Crie o primeiro agendamento deste dia.</span>
        <span className="empty-cta">
          <Plus size={16} aria-hidden="true" /> Novo agendamento
        </span>
      </section>
    );
  }

  return (
    <section className="list-panel" aria-label="Lista de agendamentos">
      {appointments.map((appointment) => (
        <button
          key={appointment.id}
          type="button"
          className="list-item"
          onClick={() => onOpen(appointment)}
        >
          <span className="list-time">
            <strong>{appointment.start}</strong>
            <small>{appointment.end}</small>
          </span>
          <span className="list-copy">
            <strong>{appointment.client}</strong>
            <span>
              <i style={{ background: appointment.serviceColor }} aria-hidden="true" />
              {appointment.service} · {appointment.professional}
            </span>
          </span>
          <AppointmentPill appointment={appointment} />
        </button>
      ))}
    </section>
  );
}

function WeekSchedule({ appointments, selectedDate, onOpen }) {
  const monday = startOfWeek(selectedDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));

  return (
    <section className="week-panel" aria-label="Agenda da semana">
      <div className="week-scroll">
        {days.map((day) => {
          const items = appointments.filter((appointment) => appointment.date === day);
          const weekday = new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR", {
            weekday: "short",
          });
          const dayNumber = day.slice(8);
          return (
            <div key={day} className={`week-column${day === selectedDate ? " is-selected" : ""}`}>
              <header>
                <span>{weekday.replace(".", "")}</span>
                <strong>{dayNumber}</strong>
              </header>
              <div className="week-items">
                {items.length === 0 ? (
                  <span className="week-empty">Sem agendamentos</span>
                ) : (
                  items.map((appointment) => (
                    <button
                      key={appointment.id}
                      type="button"
                      className={`week-item appointment-${appointment.status}`}
                      onClick={() => onOpen(appointment)}
                    >
                      <strong>{appointment.start}</strong>
                      <span>{appointment.client}</span>
                      <small>{appointment.service}</small>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NewBookingDialog({ date, onClose, onCreate }) {
  const [step, setStep] = useState(0);
  const [client, setClient] = useState("Camila Souza");
  const [professional, setProfessional] = useState("Profissional Demo");
  const [service, setService] = useState("Corte e barba");

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="booking-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Novo agendamento"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="dialog-header">
          <div>
            <h2>Novo agendamento</h2>
            <p>Passo {step + 1} de 3: {["Quem e o quê", "Quando", "Revisar"][step]}.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="step-chips" aria-label="Etapas do agendamento">
          {["Quem e o quê", "Quando", "Revisar"].map((label, index) => (
            <span key={label} className={index === step ? "is-current" : ""}>
              {label}
            </span>
          ))}
        </div>
        <div className="tab-row">
          {["Dados", "Pagamento", "Histórico"].map((label, index) => (
            <button key={label} type="button" className={index === 0 ? "is-current" : ""}>
              {label}
            </button>
          ))}
        </div>
        <div className="dialog-body">
          {step === 0 ? (
            <>
              <SelectField
                label="Cliente"
                value={client}
                options={["Camila Souza", "Rafael Lima", "Bruna Alves"]}
                onChange={setClient}
              />
              <SelectField
                label="Barbeiro"
                value={professional}
                options={["Profissional Demo", "Ana Ribeiro"]}
                onChange={setProfessional}
              />
              <SelectField
                label="Serviço"
                value={service}
                options={["Corte e barba", "Corte de cabelo", "Coloração", "Barboterapia"]}
                onChange={setService}
              />
            </>
          ) : step === 1 ? (
            <div className="review-box">
              <Clock size={18} aria-hidden="true" />
              <span>
                <strong>{formatDateBR(date)}</strong>
                <small>Horário sugerido: 14:00 às 14:30</small>
              </span>
            </div>
          ) : (
            <div className="review-box">
              <CircleCheck size={18} aria-hidden="true" />
              <span>
                <strong>{client}</strong>
                <small>{service} com {professional} · {formatDateBR(date)} às 14:00</small>
              </span>
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          {step > 0 && (
            <button type="button" className="button button-outline" onClick={() => setStep(step - 1)}>
              Voltar
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (step < 2) {
                setStep(step + 1);
                return;
              }
              onCreate({ client, professional, service, date });
            }}
          >
            {step < 2 ? "Avançar" : "Salvar agendamento"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AppointmentDrawer({ appointment, onClose, onChangeStatus }) {
  if (!appointment) return null;

  return (
    <div className="overlay drawer-overlay" role="presentation" onMouseDown={onClose}>
      <aside
        className="appointment-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalhes do agendamento de ${appointment.client}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <span className="drawer-eyebrow">Agendamento</span>
            <h2>{appointment.client}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <AppointmentPill appointment={appointment} />
          <dl className="detail-list">
            <div><dt>Serviço</dt><dd>{appointment.service}</dd></div>
            <div><dt>Profissional</dt><dd>{appointment.professional}</dd></div>
            <div><dt>Data</dt><dd>{formatDateBR(appointment.date)}</dd></div>
            <div><dt>Horário</dt><dd>{appointment.start} às {appointment.end}</dd></div>
            <div><dt>Valor</dt><dd>{formatMoney(appointment.priceCents)}</dd></div>
          </dl>
        </div>
        <footer className="drawer-footer">
          <button
            type="button"
            className="button button-outline"
            onClick={() => onChangeStatus(appointment.id, "cancelado")}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => onChangeStatus(appointment.id, "confirmado")}
          >
            <Check size={16} aria-hidden="true" /> Confirmar
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState("dark");
  const [activeNav, setActiveNav] = useState("Agenda");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [date, setDate] = useState("2026-11-12");
  const [view, setView] = useState("dia");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [teamFilter, setTeamFilter] = useState("Todos (equipe clínica)");
  const [serviceFilter, setServiceFilter] = useState("Todos (procedimentos)");
  const [statusFilter, setStatusFilter] = useState("Todos os status");
  const [draftFilters, setDraftFilters] = useState({
    team: "Todos (equipe clínica)",
    service: "Todos (procedimentos)",
    status: "Todos os status",
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [appointments, setAppointments] = useState(INITIAL_APPOINTMENTS);
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const dayAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.date === date),
    [appointments, date],
  );

  const visibleAppointments = useMemo(() => {
    return dayAppointments.filter((appointment) => {
      if (pendingOnly && appointment.status !== "pendente") return false;
      if (statusFilter !== "Todos os status" && STATUS_LABELS[appointment.status] !== statusFilter) {
        return false;
      }
      if (
        serviceFilter !== "Todos (procedimentos)" &&
        appointment.service !== serviceFilter
      ) {
        return false;
      }
      return true;
    });
  }, [dayAppointments, pendingOnly, statusFilter, serviceFilter]);

  const weekAppointments = useMemo(() => {
    const monday = startOfWeek(date);
    const sunday = addDays(monday, 6);
    return appointments.filter(
      (appointment) => appointment.date >= monday && appointment.date <= sunday,
    );
  }, [appointments, date]);

  const occupancy = dayAppointments.length;
  const revenue = dayAppointments.reduce((total, item) => total + item.priceCents, 0);
  const pending = dayAppointments.filter((item) => item.status === "pendente").length;

  function showToast(message) {
    setToast(message);
  }

  function selectQuickDay(nextDate) {
    setDate(nextDate);
    setView("dia");
  }

  function applyFilters() {
    setTeamFilter(draftFilters.team);
    setServiceFilter(draftFilters.service);
    setStatusFilter(draftFilters.status);
    setFiltersOpen(false);
    showToast("Filtros aplicados.");
  }

  function clearFilters() {
    const reset = {
      team: "Todos (equipe clínica)",
      service: "Todos (procedimentos)",
      status: "Todos os status",
    };
    setDraftFilters(reset);
    setTeamFilter(reset.team);
    setServiceFilter(reset.service);
    setStatusFilter(reset.status);
    setPendingOnly(false);
    setFiltersOpen(false);
    showToast("Filtros limpos.");
  }

  function changeStatus(id, status) {
    setAppointments((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item)),
    );
    setSelectedAppointment(null);
    showToast(status === "confirmado" ? "Agendamento confirmado." : "Agendamento cancelado.");
  }

  function createBooking({ client, service, date: bookingDate }) {
    const newAppointment = {
      id: `new-${Date.now()}`,
      date: bookingDate,
      start: "14:00",
      end: "14:30",
      client,
      service,
      professional: "Profissional Demo",
      status: "pendente",
      priceCents: 5000,
      serviceColor: "var(--service-5)",
    };
    setAppointments((current) => [...current, newAppointment]);
    setDate(bookingDate);
    setView("dia");
    setBookingOpen(false);
    showToast("Agendamento criado no protótipo.");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <CircleCheck size={22} aria-hidden="true" />
          <strong>Atlas Agenda</strong>
        </div>
        <nav>
          {NAV_ITEMS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className={`nav-item${activeNav === label ? " is-active" : ""}`}
              aria-current={activeNav === label ? "page" : undefined}
              onClick={() => {
                setActiveNav(label);
                setMobileNavOpen(false);
                if (label !== "Agenda") showToast(`${label}: seção representada no protótipo.`);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>
        <button type="button" className="signout" onClick={() => showToast("Sair: ação de demonstração.")}>
          <LogOut size={17} aria-hidden="true" /> Sair
        </button>
      </aside>

      {mobileNavOpen && (
        <div className="overlay mobile-nav-overlay" onMouseDown={() => setMobileNavOpen(false)}>
          <aside className="mobile-nav" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div className="brand">
                <CircleCheck size={22} aria-hidden="true" />
                <strong>Atlas Agenda</strong>
              </div>
              <button type="button" className="icon-button" aria-label="Fechar menu" onClick={() => setMobileNavOpen(false)}>
                <X size={18} />
              </button>
            </header>
            <nav>
              {NAV_ITEMS.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  className={`nav-item${activeNav === label ? " is-active" : ""}`}
                  onClick={() => {
                    setActiveNav(label);
                    setMobileNavOpen(false);
                  }}
                >
                  <Icon size={18} aria-hidden="true" /> {label}
                </button>
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="main-area">
        <header className="topbar">
          <button
            type="button"
            className="icon-button mobile-menu-button"
            aria-label="Abrir menu de navegação"
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span className="mobile-brand" aria-label="Atlas Agenda">
            <CircleCheck size={22} aria-hidden="true" />
          </span>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <div className="user-menu-wrap">
              <button
                type="button"
                className="icon-button"
                aria-label="Abrir menu do usuário"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <UserRound size={19} />
              </button>
              {userMenuOpen && (
                <div className="user-menu">
                  <strong>Operador Demo</strong>
                  <span>administrador</span>
                  <button type="button" onClick={() => setUserMenuOpen(false)}>Trocar senha</button>
                  <button type="button" onClick={() => setUserMenuOpen(false)}>Sair</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="content">
          <div className="page-heading">
            <div>
              <h1>Agenda</h1>
              <p>Agendamentos do dia por profissional.</p>
            </div>
            <div className="page-actions">
              <button type="button" className="button button-outline" onClick={() => showToast("Nova venda iniciada.")}>
                <ShoppingCart size={16} aria-hidden="true" /> Nova venda
              </button>
              <button type="button" className="button button-primary" onClick={() => setBookingOpen(true)}>
                <Plus size={17} aria-hidden="true" /> Novo agendamento
              </button>
            </div>
          </div>

          <section className="metrics" aria-label="Resumo do dia">
            <MetricCard
              label="Ocupação"
              value={String(occupancy)}
              support={`${occupancy} agendados`}
              active={false}
              onClick={() => setPendingOnly(false)}
            />
            <MetricCard
              label="Previsto"
              value={formatMoney(revenue)}
              support={`${occupancy} atendimentos`}
              active={false}
              onClick={() => setPendingOnly(false)}
            />
            <MetricCard
              label="A confirmar"
              value={String(pending)}
              support={`${pending} agendamentos pendentes`}
              active={pendingOnly}
              onClick={() => setPendingOnly((current) => !current)}
            />
            <MetricCard
              label="Risco no-show"
              value="0"
              support="Sem opt-in + faltas 7d"
              active={pendingOnly}
              onClick={() => setPendingOnly((current) => !current)}
            />
          </section>

          <section className="filters-row" aria-label="Filtros da agenda">
            <div className="date-group">
              <span className="filter-label">Ir para data</span>
              <div className="date-controls">
                <button type="button" className="square-button" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>
                  <ChevronLeft size={17} />
                </button>
                <label className="date-field">
                  <input
                    type="date"
                    value={date}
                    aria-label="Ir para data"
                    onChange={(event) => event.target.value && setDate(event.target.value)}
                  />
                </label>
                <button type="button" className="square-button" aria-label="Próximo dia" onClick={() => setDate(addDays(date, 1))}>
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>

            <div className="quick-filters" role="group" aria-label="Período rápido">
              <button type="button" className="quick-button" aria-pressed={date === TODAY_ISO && view !== "semana"} onClick={() => selectQuickDay(TODAY_ISO)}>
                Hoje
              </button>
              <button type="button" className="quick-button" aria-pressed={date === TOMORROW_ISO && view !== "semana"} onClick={() => selectQuickDay(TOMORROW_ISO)}>
                Amanhã
              </button>
              <button type="button" className="quick-button" aria-pressed={view === "semana"} onClick={() => setView("semana")}>
                Esta semana
              </button>
              <button
                type="button"
                className={`quick-button${pendingOnly ? " is-active" : ""}`}
                aria-pressed={pendingOnly}
                onClick={() => setPendingOnly((current) => !current)}
              >
                A confirmar
              </button>
            </div>

            <div className="view-toggle" role="group" aria-label="Modo de visualização da agenda">
              {[
                { value: "lista", label: "Lista", icon: List },
                { value: "dia", label: "Dia", icon: CalendarDays },
                { value: "semana", label: "Semana", icon: CalendarRange },
              ].map(({ value: option, label, icon: Icon }) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  className={view === option ? "is-active" : ""}
                  onClick={() => setView(option)}
                >
                  <Icon size={15} aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </section>

          <div className="filters-footer">
            <div className="filter-popover-wrap">
              <button
                type="button"
                className="button button-outline filters-button"
                aria-expanded={filtersOpen}
                onClick={() => {
                  setDraftFilters({ team: teamFilter, service: serviceFilter, status: statusFilter });
                  setFiltersOpen((open) => !open);
                }}
              >
                <SlidersHorizontal size={16} aria-hidden="true" /> Filtros
              </button>
              {filtersOpen && (
                <div className="filter-popover" role="dialog" aria-label="Filtros avançados">
                  <SelectField
                    label="Equipe clínica"
                    value={draftFilters.team}
                    options={["Todos (equipe clínica)", "Profissional Demo", "Ana Ribeiro"]}
                    onChange={(team) => setDraftFilters((current) => ({ ...current, team }))}
                  />
                  <SelectField
                    label="Procedimentos"
                    value={draftFilters.service}
                    options={["Todos (procedimentos)", "Corte e barba", "Corte de cabelo", "Coloração", "Barboterapia"]}
                    onChange={(service) => setDraftFilters((current) => ({ ...current, service }))}
                  />
                  <SelectField
                    label="Status"
                    value={draftFilters.status}
                    options={["Todos os status", "Confirmado", "A confirmar", "Concluído"]}
                    onChange={(status) => setDraftFilters((current) => ({ ...current, status }))}
                  />
                  <div className="popover-actions">
                    <button type="button" className="button button-ghost" onClick={clearFilters}>Limpar</button>
                    <button type="button" className="button button-primary" onClick={applyFilters}>Aplicar</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="schedule-area">
            {view === "dia" && (
              <DaySchedule appointments={visibleAppointments} onOpen={setSelectedAppointment} />
            )}
            {view === "lista" && (
              <ListSchedule appointments={visibleAppointments} onOpen={setSelectedAppointment} />
            )}
            {view === "semana" && (
              <WeekSchedule appointments={weekAppointments} selectedDate={date} onOpen={setSelectedAppointment} />
            )}
          </div>
        </main>
      </div>

      {bookingOpen && (
        <NewBookingDialog date={date} onClose={() => setBookingOpen(false)} onCreate={createBooking} />
      )}
      <AppointmentDrawer
        appointment={selectedAppointment}
        onClose={() => setSelectedAppointment(null)}
        onChangeStatus={changeStatus}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

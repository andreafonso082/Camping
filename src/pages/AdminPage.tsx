import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Map as MapIcon,
  Calendar,
  LogOut,
  CheckCircle2,
  XCircle,
  Clock,
  User,
  Phone,
  Mail,
  Home,
  Search,
  Filter,
  TrendingUp,
  Users,
  ArrowUpRight,
  RefreshCw,
  Plus,
  Lock,
  Unlock,
  X,
  AlertCircle,
  Globe,
  Building2,
} from 'lucide-react';
import type {
  AccommodationType,
  AvailabilityResponse,
  Booking,
  BookingStatus,
  ResourceUnit,
} from '../types/booking.ts';
import {
  adminLogin,
  checkAvailability,
  createBooking,
  fetchAdminState,
  subscribeSync,
  updateAdminBooking,
  updateAdminResource,
} from '../lib/api.ts';
import { isDateWithinStay } from '../lib/pricing.ts';

const STATUS_LABELS: Record<BookingStatus, { label: string; badge: string }> = {
  pending: { label: 'Pendente', badge: 'bg-amber-100 text-amber-800' },
  confirmed: { label: 'Confirmada', badge: 'bg-blue-100 text-blue-800' },
  'checked-in': { label: 'Em Estadia', badge: 'bg-green-100 text-green-800' },
  'checked-out': { label: 'Concluída', badge: 'bg-gray-100 text-gray-600' },
  cancelled: { label: 'Cancelada', badge: 'bg-red-100 text-red-700' },
};

function formatDatePT(dateStr: string): string {
  if (!dateStr || !dateStr.includes('-')) return dateStr;
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function AdminPage() {
  const [token, setToken] = useState<string>(() => localStorage.getItem('crf_admin_token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'bookings' | 'map' | 'bungalows'>(
    'dashboard'
  );
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [resources, setResources] = useState<ResourceUnit[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mapFilter, setMapFilter] = useState<'all' | 'free' | 'occupied' | 'blocked'>('all');

  // Selected resource modal/drawer
  const [selectedResource, setSelectedResource] = useState<ResourceUnit | null>(null);

  // Manual Booking Modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newType, setNewType] = useState<AccommodationType>('alveolos');
  const [newSubtypeKey, setNewSubtypeKey] = useState('all');
  const [newCheckIn, setNewCheckIn] = useState(() => new Date().toISOString().slice(0, 10));
  const [newCheckOut, setNewCheckOut] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [newAdults, setNewAdults] = useState(2);
  const [newChildren, setNewChildren] = useState(0);
  const [newPreferredUnit, setNewPreferredUnit] = useState('');
  const [newUnitSearch, setNewUnitSearch] = useState('');
  const [newAvailability, setNewAvailability] = useState<AvailabilityResponse | null>(null);
  const [loadingNewAvail, setLoadingNewAvail] = useState(false);
  const [unitInvalidNotice, setUnitInvalidNotice] = useState('');
  const [newBookingError, setNewBookingError] = useState('');
  const [creatingBooking, setCreatingBooking] = useState(false);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErrorBanner('');
    try {
      const data = await fetchAdminState(token);
      setBookings(data.bookings);
      setResources(data.resources);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar dados.';
      setErrorBanner(msg);
      if (msg.includes('inválida') || msg.includes('expirada')) {
        localStorage.removeItem('crf_admin_token');
        setToken('');
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time sync with public site & polling every 8 seconds
  useEffect(() => {
    if (!token) return;
    const unsub = subscribeSync(() => {
      loadData();
    });
    const onFocus = () => loadData();
    window.addEventListener('focus', onFocus);
    const interval = setInterval(loadData, 8000);
    return () => {
      unsub();
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [token, loadData]);

  // Live availability inside Manual Booking Modal
  useEffect(() => {
    if (!showNewModal || !newCheckIn || !newCheckOut || newCheckOut <= newCheckIn) {
      setNewAvailability(null);
      return;
    }
    let cancelled = false;
    setLoadingNewAvail(true);
    checkAvailability({
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      adults: newAdults,
      children: newChildren,
    })
      .then((res) => {
        if (cancelled) return;
        setNewAvailability(res);
      })
      .catch(() => {
        if (!cancelled) setNewAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingNewAvail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showNewModal, newCheckIn, newCheckOut, newAdults, newChildren]);

  const manualBookingAvailability = useMemo(() => {
    const resourceById = new Map(resources.map((r) => [r.id, r]));
    if (!newAvailability) {
      return {
        allIdsForType: [] as string[],
        filteredIds: [] as string[],
        matchingUnits: [] as ResourceUnit[],
        availableSetForType: new Set<string>(),
      };
    }

    const sortIds = (ids: string[]) =>
      [...ids].sort((a, b) => {
        const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return na - nb;
      });

    const allIdsForType =
      newType === 'alveolos'
        ? sortIds([
            ...newAvailability.alveolos.pequeno.availableIds,
            ...newAvailability.alveolos.grande.availableIds,
            ...newAvailability.alveolos.xl.availableIds,
          ])
        : sortIds([
            ...newAvailability.bungalows.classeA.availableIds,
            ...newAvailability.bungalows.classeB.availableIds,
          ]);

    const availableSetForType = new Set(allIdsForType);

    let filteredIds = allIdsForType;
    if (newType === 'alveolos') {
      if (newSubtypeKey === 'pequeno') filteredIds = sortIds(newAvailability.alveolos.pequeno.availableIds);
      else if (newSubtypeKey === 'grande') filteredIds = sortIds(newAvailability.alveolos.grande.availableIds);
      else if (newSubtypeKey === 'xl') filteredIds = sortIds(newAvailability.alveolos.xl.availableIds);
    } else {
      if (newSubtypeKey === 'A') filteredIds = sortIds(newAvailability.bungalows.classeA.availableIds);
      else if (newSubtypeKey === 'B') filteredIds = sortIds(newAvailability.bungalows.classeB.availableIds);
    }

    const q = newUnitSearch.trim().toLowerCase();
    const matchingUnits = filteredIds
      .map((id) => resourceById.get(id))
      .filter((u): u is ResourceUnit => !!u)
      .filter((u) => {
        if (!q) return true;
        return (
          u.id.toLowerCase().includes(q) ||
          u.name.toLowerCase().includes(q) ||
          String(u.number).includes(q) ||
          (u.sector || '').toLowerCase().includes(q) ||
          (u.size || '').toLowerCase().includes(q) ||
          (u.street ? `rua ${u.street}` : '').includes(q)
        );
      });

    return { allIdsForType, filteredIds, matchingUnits, availableSetForType };
  }, [newAvailability, newType, newSubtypeKey, newUnitSearch, resources]);

  // Keep selected preferred unit valid when dates/type/category change
  useEffect(() => {
    if (!showNewModal || !newAvailability || !newPreferredUnit) {
      setUnitInvalidNotice('');
      return;
    }
    const validIds = new Set(manualBookingAvailability.filteredIds);
    if (!validIds.has(newPreferredUnit)) {
      const stillFreeInType = manualBookingAvailability.availableSetForType.has(newPreferredUnit);
      if (!stillFreeInType) {
        setUnitInvalidNotice(
          `A unidade ${newPreferredUnit} não está disponível para as datas selecionadas. Selecione outra unidade.`
        );
      } else {
        setUnitInvalidNotice('');
      }
      setNewPreferredUnit('');
    } else {
      setUnitInvalidNotice('');
    }
  }, [showNewModal, newAvailability, newPreferredUnit, manualBookingAvailability]);

  const selectedPreferredUnitObj = useMemo(
    () => resources.find((r) => r.id === newPreferredUnit) || null,
    [resources, newPreferredUnit]
  );

  const resolvedManualSubtypeKey = useMemo(() => {
    if (selectedPreferredUnitObj && selectedPreferredUnitObj.type === newType) {
      return newType === 'alveolos'
        ? selectedPreferredUnitObj.size || 'grande'
        : selectedPreferredUnitObj.bungalowClass || 'A';
    }
    if (newType === 'alveolos') {
      if (newSubtypeKey === 'pequeno' || newSubtypeKey === 'grande' || newSubtypeKey === 'xl') {
        return newSubtypeKey;
      }
      if (newAvailability) {
        if (newAvailability.alveolos.grande.eligible) return 'grande';
        if (newAvailability.alveolos.pequeno.eligible) return 'pequeno';
        if (newAvailability.alveolos.xl.eligible) return 'xl';
      }
      return 'grande';
    }
    if (newSubtypeKey === 'A' || newSubtypeKey === 'B') {
      return newSubtypeKey;
    }
    if (newAvailability) {
      if (newAvailability.bungalows.classeA.eligible) return 'A';
      if (newAvailability.bungalows.classeB.eligible) return 'B';
    }
    return 'A';
  }, [selectedPreferredUnitObj, newType, newSubtypeKey, newAvailability]);

  const selectedManualSummary = useMemo(() => {
    if (!newAvailability) return null;
    if (newType === 'alveolos') {
      if (resolvedManualSubtypeKey === 'pequeno') return newAvailability.alveolos.pequeno;
      if (resolvedManualSubtypeKey === 'xl') return newAvailability.alveolos.xl;
      return newAvailability.alveolos.grande;
    }
    return resolvedManualSubtypeKey === 'A'
      ? newAvailability.bungalows.classeA
      : newAvailability.bungalows.classeB;
  }, [newAvailability, newType, resolvedManualSubtypeKey]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await adminLogin(username.trim(), password);
      localStorage.setItem('crf_admin_token', res.token);
      setToken(res.token);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Erro ao autenticar.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('crf_admin_token');
    setToken('');
  };

  const handleBookingStatus = async (id: string, status: BookingStatus) => {
    setErrorBanner('');
    try {
      await updateAdminBooking(token, id, { status });
      await loadData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erro ao atualizar reserva.');
    }
  };

  const handleToggleBlock = async (unit: ResourceUnit) => {
    setErrorBanner('');
    try {
      const updated = await updateAdminResource(token, unit.id, {
        blocked: !unit.blocked,
        blockedReason: !unit.blocked ? 'Bloqueado no Backoffice' : undefined,
      });
      setSelectedResource(updated);
      await loadData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Erro ao atualizar unidade.');
    }
  };

  const handleCreateManualBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingBooking(true);
    setNewBookingError('');
    try {
      await createBooking(
        {
          guestName: newGuestName,
          email: newEmail,
          phone: newPhone,
          type: newType,
          subtypeKey: resolvedManualSubtypeKey,
          preferredResourceId: newPreferredUnit || undefined,
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          adults: newAdults,
          children: newChildren,
          source: 'backoffice',
          status: 'confirmed',
        },
        token
      );
      setShowNewModal(false);
      setNewGuestName('');
      setNewEmail('');
      setNewPhone('');
      setNewPreferredUnit('');
      setNewUnitSearch('');
      setUnitInvalidNotice('');
      await loadData();
    } catch (err) {
      setNewBookingError(err instanceof Error ? err.message : 'Erro ao criar reserva.');
    } finally {
      setCreatingBooking(false);
    }
  };

  const getBookingForResourceOnDate = useCallback(
    (resourceId: string, date: string): Booking | undefined => {
      return bookings.find(
        (b) =>
          b.resourceId === resourceId &&
          b.status !== 'cancelled' &&
          b.status !== 'checked-out' &&
          isDateWithinStay(date, b.checkIn, b.checkOut)
      );
    },
    [bookings]
  );

  // Live stats for today
  const todayStr = new Date().toISOString().slice(0, 10);
  const stats = useMemo(() => {
    const alveolos = resources.filter((r) => r.type === 'alveolos');
    const bungalows = resources.filter((r) => r.type === 'bungalows');

    const occupiedAlveolosToday = alveolos.filter(
      (r) => r.blocked || !!getBookingForResourceOnDate(r.id, todayStr)
    ).length;
    const occupiedBungalowsToday = bungalows.filter(
      (r) => r.blocked || !!getBookingForResourceOnDate(r.id, todayStr)
    ).length;

    const freeAlveolos = alveolos.length - occupiedAlveolosToday;
    const freeBungalows = bungalows.length - occupiedBungalowsToday;
    const activeReservations = bookings.filter(
      (b) => b.status === 'confirmed' || b.status === 'checked-in' || b.status === 'pending'
    ).length;
    const revenue = bookings
      .filter((b) => b.status !== 'cancelled')
      .reduce((acc, b) => acc + b.totalPrice, 0);

    return {
      freeAlveolos,
      totalAlveolos: alveolos.length || 350,
      freeBungalows,
      totalBungalows: bungalows.length || 5,
      activeReservations,
      pendingCount: bookings.filter((b) => b.status === 'pending').length,
      revenue: revenue.toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }),
    };
  }, [resources, bookings, getBookingForResourceOnDate, todayStr]);

  const filteredBookings = useMemo(() => {
    return bookings.filter((b) => {
      const term = searchTerm.trim().toLowerCase();
      const matchesSearch =
        !term ||
        b.guestName.toLowerCase().includes(term) ||
        b.id.toLowerCase().includes(term) ||
        b.resourceId.toLowerCase().includes(term) ||
        b.email.toLowerCase().includes(term);
      const matchesStatus = filterStatus === 'all' || b.status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [bookings, searchTerm, filterStatus]);

  // Auth Screen
  if (!token) {
    return (
      <div className="min-h-screen bg-branco-quente flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-10 rounded-[2.5rem] shadow-2xl border border-gray-100 max-w-md w-full"
        >
          <div className="text-center mb-10">
            <img src="/assets/logo-camping.png" alt="Logo" className="h-16 mx-auto mb-6" />
            <h2 className="text-2xl font-serif text-principal font-bold uppercase tracking-widest">
              Área Reservada
            </h2>
            <p className="text-texto-main/40 text-[10px] uppercase font-bold tracking-widest mt-2">
              Backoffice • Camping Ria Formosa
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-principal/40 ml-2">
                Utilizador
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-branco-quente/60 border-0 border-b-2 border-gray-100 p-4 rounded-t-xl focus:outline-none focus:border-secundaria transition-all"
                placeholder="camping1"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-principal/40 ml-2">
                Palavra-passe
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-branco-quente/60 border-0 border-b-2 border-gray-100 p-4 rounded-t-xl focus:outline-none focus:border-secundaria transition-all"
                placeholder="•••••"
                required
              />
            </div>
            {loginError && (
              <p className="text-red-600 text-xs font-bold text-center bg-red-50 py-2.5 rounded-xl">
                {loginError}
              </p>
            )}
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full bg-principal text-white py-5 rounded-full font-bold uppercase tracking-widest text-xs hover:bg-secundaria hover:text-principal transition-all shadow-xl"
            >
              {loggingIn ? 'A entrar...' : 'Entrar no Backoffice'}
            </button>
          </form>
          <div className="mt-8 pt-6 border-t border-gray-100 text-center">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-principal/45 hover:text-principal transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              Voltar ao site público
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const alveoloResources = resources.filter((r) => r.type === 'alveolos');
  const bungalowResources = resources.filter((r) => r.type === 'bungalows');

  return (
    <div className="min-h-screen bg-branco-quente flex flex-col lg:flex-row">
      {/* Mobile & Tablet Top Tab Bar */}
      <div className="lg:hidden bg-principal text-white px-4 py-3 space-y-3 shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-secundaria">
              Backoffice Conectado
            </p>
            <p className="text-sm font-serif font-bold">Gestão de Reservas</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/"
              className="min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
            >
              <Globe className="w-3.5 h-3.5" /> Site
            </Link>
            <button
              onClick={handleLogout}
              className="min-h-[40px] px-3 rounded-xl bg-white/10 hover:bg-red-500/20 text-white/80 hover:text-red-300 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest"
            >
              <LogOut className="w-3.5 h-3.5" /> Sair
            </button>
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {[
            { id: 'dashboard', label: 'Resumo', icon: LayoutDashboard },
            { id: 'bookings', label: `Reservas (${bookings.length})`, icon: Calendar },
            { id: 'map', label: 'Planta (350)', icon: MapIcon },
            { id: 'bungalows', label: 'Bungalows (5)', icon: Home },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as typeof activeTab)}
              className={`min-h-[44px] px-4 py-2 rounded-xl flex items-center gap-2 text-[10px] font-black uppercase tracking-wider whitespace-nowrap shrink-0 transition-all ${
                activeTab === item.id
                  ? 'bg-secundaria text-principal'
                  : 'bg-white/10 text-white/80 hover:bg-white/15'
              }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 xl:w-72 bg-principal text-white flex-col py-8 sticky top-0 h-screen shadow-2xl shrink-0">
        <div className="px-8 mb-10">
          <img
            src="/assets/logo-camping.png"
            alt="Camping Ria Formosa"
            className="h-11 w-auto object-contain brightness-0 invert mb-5 opacity-95"
          />
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-secundaria">
            Backoffice Conectado
          </p>
          <p className="text-lg font-serif font-bold mt-1">Gestão de Reservas</p>
        </div>

        <nav className="flex-grow px-4 space-y-2">
          {[
            { id: 'dashboard', label: 'Resumo', icon: LayoutDashboard },
            { id: 'bookings', label: 'Reservas', icon: Calendar },
            { id: 'map', label: 'Planta (350 Alvéolos)', icon: MapIcon },
            { id: 'bungalows', label: 'Bungalows (5)', icon: Home },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as typeof activeTab)}
              className={`w-full flex items-center gap-3.5 px-5 py-4 rounded-2xl transition-all ${
                activeTab === item.id
                  ? 'bg-secundaria text-principal font-bold shadow-lg'
                  : 'hover:bg-white/5 text-white/70 hover:text-white'
              }`}
            >
              <item.icon
                className={`w-5 h-5 ${activeTab === item.id ? 'text-principal' : 'text-secundaria'}`}
              />
              <span className="text-[11px] uppercase tracking-wider font-black text-left">
                {item.label}
              </span>
              {item.id === 'bookings' && bookings.length > 0 && (
                <span
                  className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    activeTab === item.id ? 'bg-principal text-white' : 'bg-white/10 text-white'
                  }`}
                >
                  {bookings.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-6 pt-6 border-t border-white/10 space-y-4">
          <div className="flex items-center gap-2 text-[10px] text-green-400 font-bold uppercase tracking-widest">
            Sincronizado com o Site
          </div>
          <Link
            to="/"
            className="flex items-center gap-3 text-white/60 hover:text-secundaria transition-colors text-xs font-bold uppercase tracking-widest"
          >
            <Globe className="w-4 h-4" /> Ver Site Público
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 text-white/50 hover:text-red-400 transition-colors text-xs font-bold uppercase tracking-widest"
          >
            <LogOut className="w-4 h-4" /> Terminar Sessão
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow p-4 sm:p-6 md:p-10 overflow-y-auto">
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6 sm:mb-8">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] sm:tracking-[0.35em] text-secundaria">
              Camping Ria Formosa • Receção
            </p>
            <h1 className="text-2xl sm:text-3xl font-serif text-principal font-bold">
              {activeTab === 'dashboard' && 'Visão Geral'}
              {activeTab === 'bookings' && 'Todas as Reservas'}
              {activeTab === 'map' && 'Planta dos 350 Alvéolos'}
              {activeTab === 'bungalows' && 'Bungalows (Classe A e B)'}
            </h1>
          </div>

          <div className="w-full sm:w-auto flex items-center gap-2 sm:gap-3">
            <button
              onClick={loadData}
              className="flex-1 sm:flex-initial justify-center min-h-[44px] bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-gray-100 text-principal/60 hover:text-principal flex items-center gap-2 text-[10px] font-black uppercase tracking-widest cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex-1 sm:flex-initial justify-center min-h-[44px] bg-principal text-white px-5 py-2.5 rounded-2xl font-bold uppercase tracking-widest text-[10px] hover:bg-secundaria hover:text-principal transition-all flex items-center gap-2 shadow-lg cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" /> Nova Reserva
            </button>
          </div>
        </header>

        {errorBanner && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-2xl flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errorBanner}
            </div>
            <button onClick={() => setErrorBanner('')} className="text-red-500 hover:text-red-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                <div className="bg-white p-5 sm:p-7 rounded-3xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-2xl bg-green-50 text-green-600">
                      <MapIcon className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-green-600">Hoje</span>
                  </div>
                  <p className="text-2xl sm:text-3xl font-serif font-bold text-principal">
                    {stats.freeAlveolos} / {stats.totalAlveolos}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-principal/40 mt-1">
                    Alvéolos Livres Hoje
                  </p>
                </div>

                <div className="bg-white p-5 sm:p-7 rounded-3xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-2xl bg-blue-50 text-blue-600">
                      <Home className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-blue-600">Hoje</span>
                  </div>
                  <p className="text-2xl sm:text-3xl font-serif font-bold text-principal">
                    {stats.freeBungalows} / {stats.totalBungalows}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-principal/40 mt-1">
                    Bungalows Livres Hoje
                  </p>
                </div>

                <div className="bg-white p-5 sm:p-7 rounded-3xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-2xl bg-amber-50 text-amber-600">
                      <Users className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-amber-600">Ativas</span>
                  </div>
                  <p className="text-2xl sm:text-3xl font-serif font-bold text-principal">
                    {stats.activeReservations}
                  </p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-principal/40 mt-1">
                    Reservas Confirmadas / Em Curso
                  </p>
                </div>

                <div className="bg-white p-5 sm:p-7 rounded-3xl shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-2xl bg-purple-50 text-purple-600">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <span className="text-[9px] font-black uppercase text-purple-600">Total</span>
                  </div>
                  <p className="text-2xl sm:text-3xl font-serif font-bold text-principal">{stats.revenue}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-principal/40 mt-1">
                    Volume de Reservas
                  </p>
                </div>
              </div>

              <div className="bg-white p-5 sm:p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex flex-wrap justify-between items-center gap-3 mb-5 sm:mb-6">
                  <h2 className="text-lg sm:text-xl font-serif font-bold text-principal">
                    Últimas Reservas Recebidas
                  </h2>
                  <button
                    onClick={() => setActiveTab('bookings')}
                    className="text-[10px] font-black uppercase tracking-widest text-secundaria hover:underline"
                  >
                    Gerir todas →
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {bookings.slice(0, 6).map((b) => (
                    <div
                      key={b.id}
                      className="py-4 flex flex-wrap items-center justify-between gap-4"
                    >
                      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                        <span className="px-3 py-1.5 rounded-xl bg-principal text-white text-xs font-black tracking-wide shrink-0">
                          {b.type === 'bungalows' ? `Bungalow ${b.resourceId}` : `Alvéolo ${b.resourceId}`}
                        </span>
                        <div className="px-3 py-1.5 rounded-xl bg-secundaria/20 border border-secundaria/40 text-principal text-xs font-bold flex items-center gap-1.5 shrink-0 tabular-nums">
                          <Calendar className="w-3.5 h-3.5 text-principal/70" />
                          <span>{formatDatePT(b.checkIn)}</span>
                          <span className="text-principal/50">→</span>
                          <span>{formatDatePT(b.checkOut)}</span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-principal flex items-center gap-2">
                            {b.guestName}
                            <span className="text-[11px] font-semibold text-principal/40">
                              ({b.id})
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                                b.source === 'website'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {b.source === 'website' ? (
                                <>
                                  <Globe className="w-2.5 h-2.5" /> Site (Auto)
                                </>
                              ) : (
                                <>
                                  <Building2 className="w-2.5 h-2.5" /> Receção
                                </>
                              )}
                            </span>
                          </p>
                          <p className="text-xs text-texto-main/60">
                            {b.subtype} • {b.adults + b.children} hóspedes
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-sm text-principal">
                          {b.totalPrice.toFixed(2)}€
                        </span>
                        <span
                          className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            STATUS_LABELS[b.status].badge
                          }`}
                        >
                          {STATUS_LABELS[b.status].label}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* TAB 2: RESERVAS */}
          {activeTab === 'bookings' && (
            <motion.div
              key="bookings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-5 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 justify-between">
                <div className="flex items-center gap-3 bg-branco-quente/60 px-4 py-2.5 rounded-2xl flex-grow">
                  <Search className="w-4 h-4 text-principal/40" />
                  <input
                    type="text"
                    placeholder="Pesquisar por cliente, código (CRF-...) ou unidade (A12, B1)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-transparent border-0 w-full text-sm focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 bg-branco-quente/60 px-4 py-2.5 rounded-2xl">
                  <Filter className="w-4 h-4 text-principal/40" />
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    className="bg-transparent text-xs font-bold text-principal focus:outline-none cursor-pointer"
                  >
                    <option value="all">Todos os Estados</option>
                    <option value="confirmed">Confirmadas</option>
                    <option value="checked-in">Em Estadia</option>
                    <option value="pending">Pendentes</option>
                    <option value="checked-out">Concluídas</option>
                    <option value="cancelled">Canceladas</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                {filteredBookings.length === 0 ? (
                  <div className="bg-white p-16 rounded-3xl text-center text-principal/30 font-serif text-xl">
                    Nenhuma reserva encontrada com os filtros atuais.
                  </div>
                ) : (
                  filteredBookings.map((b) => (
                    <div
                      key={b.id}
                      className="bg-white p-4 sm:p-6 md:p-7 rounded-3xl shadow-sm border border-gray-100 flex flex-col lg:flex-row lg:items-center justify-between gap-5 sm:gap-6 hover:border-secundaria/40 transition-all"
                    >
                      <div className="space-y-4 flex-grow">
                        {/* Primary Highlight: Space ID + Check-in / Check-out */}
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="inline-flex items-center gap-2.5 bg-principal text-white px-4 py-2 rounded-2xl shadow-sm">
                            <Home className="w-4 h-4 text-secundaria shrink-0" />
                            <span className="text-sm sm:text-base font-black tracking-wide">
                              {b.type === 'bungalows'
                                ? `Bungalow ${b.resourceId}`
                                : `Alvéolo ${b.resourceId}`}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-white/15 px-2 py-0.5 rounded-full text-white/90">
                              {b.subtype}
                            </span>
                          </div>

                          <div className="inline-flex flex-wrap items-center gap-3 bg-secundaria/20 border border-secundaria/50 text-principal px-4 py-2 rounded-2xl">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-4 h-4 text-principal shrink-0" />
                              <span className="text-[10px] font-black uppercase tracking-wider text-principal/60">
                                Check-in:
                              </span>
                              <span className="text-sm font-black tabular-nums">
                                {formatDatePT(b.checkIn)}
                              </span>
                            </div>
                            <span className="text-principal/40 font-black">→</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-black uppercase tracking-wider text-principal/60">
                                Check-out:
                              </span>
                              <span className="text-sm font-black tabular-nums">
                                {formatDatePT(b.checkOut)}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                              STATUS_LABELS[b.status].badge
                            }`}
                          >
                            {STATUS_LABELS[b.status].label}
                          </span>
                        </div>

                        {/* Secondary Row: Guest + Contact + Source */}
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-texto-main/70 pt-1">
                          <div className="flex items-center gap-2">
                            <User className="w-3.5 h-3.5 text-principal/40 shrink-0" />
                            <span className="text-base font-serif font-bold text-principal">
                              {b.guestName}
                            </span>
                            <span className="text-[11px] font-black text-principal/35">{b.id}</span>
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              b.source === 'website'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {b.source === 'website' ? 'Reserva Automática (Site)' : 'Receção'}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-secundaria shrink-0" />
                            <span className="truncate">{b.email}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-secundaria shrink-0" />
                            <span>
                              {b.phone} •{' '}
                              <strong className="text-principal">{b.totalPrice.toFixed(2)}€</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {b.status === 'pending' && (
                          <button
                            onClick={() => handleBookingStatus(b.id, 'confirmed')}
                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar
                          </button>
                        )}
                        {b.status === 'confirmed' && (
                          <button
                            onClick={() => handleBookingStatus(b.id, 'checked-in')}
                            className="bg-principal hover:bg-secundaria hover:text-principal text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" /> Check-in
                          </button>
                        )}
                        {b.status === 'checked-in' && (
                          <button
                            onClick={() => handleBookingStatus(b.id, 'checked-out')}
                            className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                          >
                            Check-out
                          </button>
                        )}
                        {b.status !== 'cancelled' && b.status !== 'checked-out' && (
                          <button
                            onClick={() => handleBookingStatus(b.id, 'cancelled')}
                            className="bg-red-50 hover:bg-red-100 text-red-700 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Cancelar
                          </button>
                        )}
                        {b.status === 'cancelled' && (
                          <button
                            onClick={() => handleBookingStatus(b.id, 'confirmed')}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest"
                          >
                            Reativar Reserva
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 3: PLANTA DOS 350 ALVÉOLOS */}
          {activeTab === 'map' && (
            <motion.div
              key="map"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Date & Filter Bar */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-6">
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-widest text-principal/40 block mb-1">
                      Disponibilidade na Data:
                    </label>
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="bg-branco-quente border border-gray-200 rounded-xl px-4 py-2.5 text-xs font-bold text-principal focus:outline-none focus:border-secundaria"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-4 sm:pt-0">
                    {[
                      { id: 'all', label: 'Todos (350)' },
                      { id: 'free', label: 'Livres' },
                      { id: 'occupied', label: 'Ocupados' },
                      { id: 'blocked', label: 'Bloqueados' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setMapFilter(f.id as typeof mapFilter)}
                        className={`px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                          mapFilter === f.id
                            ? 'bg-principal text-white'
                            : 'bg-branco-quente text-principal/60 hover:text-principal'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-5 text-[10px] font-black uppercase tracking-wider text-principal/60">
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-emerald-100 border border-emerald-300 inline-block" />
                    Livre
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-secundaria inline-block" />
                    Ocupado
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-red-200 border border-red-400 inline-block" />
                    Bloqueado
                  </span>
                </div>
              </div>

              {/* Active Occupied Alvéolo Cards for Selected Date */}
              {(() => {
                const occupiedUnits = alveoloResources
                  .map((unit) => ({
                    unit,
                    booking: getBookingForResourceOnDate(unit.id, selectedDate),
                  }))
                  .filter((item): item is { unit: ResourceUnit; booking: Booking } => !!item.booking);

                if (occupiedUnits.length === 0) return null;

                return (
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-sm font-black uppercase tracking-widest text-principal">
                        Alvéolos Reservados em {formatDatePT(selectedDate)} ({occupiedUnits.length})
                      </h2>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {occupiedUnits.map(({ unit, booking }) => (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => setSelectedResource(unit)}
                          className="text-left p-4 rounded-2xl bg-branco-quente/80 border border-secundaria/40 hover:border-principal transition-all space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-3 py-1 rounded-xl bg-principal text-white text-xs font-black tracking-wide">
                              Alvéolo {unit.id}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                STATUS_LABELS[booking.status].badge
                              }`}
                            >
                              {STATUS_LABELS[booking.status].label}
                            </span>
                          </div>
                          <div className="bg-secundaria/20 border border-secundaria/40 rounded-xl px-3 py-2 text-principal">
                            <div className="flex items-center justify-between text-[11px] font-bold tabular-nums">
                              <span>
                                <span className="text-[9px] uppercase text-principal/60 mr-1">In:</span>
                                {formatDatePT(booking.checkIn)}
                              </span>
                              <span className="text-principal/40">→</span>
                              <span>
                                <span className="text-[9px] uppercase text-principal/60 mr-1">Out:</span>
                                {formatDatePT(booking.checkOut)}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs font-bold text-principal truncate">
                            {booking.guestName}{' '}
                            <span className="text-principal/40 font-normal">({booking.id})</span>
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Sectors Grid */}
              <div className="bg-white p-6 md:p-10 rounded-3xl shadow-sm border border-gray-100 space-y-10">
                {[
                  {
                    sector: 'Norte',
                    title: 'Setor Norte • Alvéolos Pequenos (A1 – A120)',
                    units: alveoloResources.filter((r) => r.sector === 'Norte'),
                  },
                  {
                    sector: 'Sul',
                    title: 'Setor Sul • Pequenos & Grandes (A121 – A240)',
                    units: alveoloResources.filter((r) => r.sector === 'Sul'),
                  },
                  {
                    sector: 'Nascente',
                    title: 'Setor Nascente • Grandes & XL (A241 – A350)',
                    units: alveoloResources.filter((r) => r.sector === 'Nascente'),
                  },
                ].map((group) => (
                  <div key={group.sector} className="space-y-4">
                    <h3 className="text-xs font-black uppercase tracking-[0.25em] text-principal/50 flex items-center gap-4 after:flex-grow after:h-px after:bg-gray-100">
                      {group.title}
                    </h3>
                    <div className="grid grid-cols-7 sm:grid-cols-12 md:grid-cols-[repeat(18,minmax(0,1fr))] lg:grid-cols-[repeat(25,minmax(0,1fr))] gap-1.5">
                      {group.units.map((unit) => {
                        const booking = getBookingForResourceOnDate(unit.id, selectedDate);
                        const isOccupied = !!booking;
                        const isBlocked = unit.blocked;

                        const matchesFilter =
                          mapFilter === 'all' ||
                          (mapFilter === 'free' && !isOccupied && !isBlocked) ||
                          (mapFilter === 'occupied' && isOccupied) ||
                          (mapFilter === 'blocked' && isBlocked);

                        return (
                          <button
                            key={unit.id}
                            type="button"
                            onClick={() => setSelectedResource(unit)}
                            title={`${unit.id} (${unit.size}) — ${
                              isBlocked
                                ? 'Bloqueado'
                                : isOccupied
                                  ? `Ocupado: ${booking.guestName} | Check-in: ${formatDatePT(booking.checkIn)} → Check-out: ${formatDatePT(booking.checkOut)}`
                                  : 'Livre'
                            }`}
                            className={`aspect-square rounded-md text-[8px] font-bold flex items-center justify-center transition-all hover:scale-125 hover:z-20 ${
                              !matchesFilter ? 'opacity-15' : ''
                            } ${
                              isBlocked
                                ? 'bg-red-100 text-red-700 border border-red-300'
                                : isOccupied
                                  ? 'bg-secundaria text-principal shadow-sm ring-1 ring-principal/20'
                                  : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            {unit.number}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* TAB 4: BUNGALOWS */}
          {activeTab === 'bungalows' && (
            <motion.div
              key="bungalows"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-serif font-bold text-principal">
                    Disponibilidade dos 5 Bungalows
                  </h2>
                  <p className="text-xs text-texto-main/60">
                    B1 e B2 (Classe A até 5 pax) • B3, B4 e B5 (Classe B até 4 pax)
                  </p>
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-widest text-principal/40 block mb-1">
                    Ver Data:
                  </label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-branco-quente border border-gray-200 rounded-xl px-4 py-2 text-xs font-bold text-principal focus:outline-none focus:border-secundaria"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {bungalowResources.map((bUnit) => {
                  const activeOnDate = getBookingForResourceOnDate(bUnit.id, selectedDate);
                  const upcomingForUnit = bookings.filter(
                    (b) => b.resourceId === bUnit.id && b.status !== 'cancelled' && b.status !== 'checked-out'
                  );

                  return (
                    <div
                      key={bUnit.id}
                      className={`bg-white p-5 sm:p-7 md:p-8 rounded-3xl shadow-sm border transition-all flex flex-col justify-between gap-5 sm:gap-6 ${
                        bUnit.blocked
                          ? 'border-red-200 bg-red-50/20'
                          : activeOnDate
                            ? 'border-secundaria/50'
                            : 'border-gray-100'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <h3 className="text-2xl sm:text-3xl font-serif font-bold text-principal">
                              {bUnit.id}
                            </h3>
                            <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-branco-quente text-principal">
                              Classe {bUnit.bungalowClass} • Até {bUnit.capacity} pax
                            </span>
                          </div>
                          <p className="text-xs text-texto-main/50 mt-1">
                            Estado em {formatDatePT(selectedDate)}:{' '}
                            <strong
                              className={
                                bUnit.blocked
                                  ? 'text-red-600'
                                  : activeOnDate
                                    ? 'text-amber-700'
                                    : 'text-green-700'
                              }
                            >
                              {bUnit.blocked
                                ? 'Bloqueado (Manutenção)'
                                : activeOnDate
                                  ? `Ocupado (${activeOnDate.guestName})`
                                  : 'Disponível para Reserva Online'}
                            </strong>
                          </p>
                          {activeOnDate && (
                            <div className="mt-2.5 inline-flex flex-wrap items-center gap-2 bg-secundaria/20 border border-secundaria/40 text-principal px-3 py-1.5 rounded-xl text-xs font-bold tabular-nums">
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              <span>Check-in: {formatDatePT(activeOnDate.checkIn)}</span>
                              <span className="text-principal/40">→</span>
                              <span>Check-out: {formatDatePT(activeOnDate.checkOut)}</span>
                            </div>
                          )}
                        </div>

                        <div className="w-full sm:w-auto flex items-center gap-2 shrink-0">
                          {!bUnit.blocked && !activeOnDate && (
                            <button
                              onClick={() => {
                                setNewType('bungalows');
                                setNewSubtypeKey(bUnit.bungalowClass || 'A');
                                setNewPreferredUnit(bUnit.id);
                                setNewUnitSearch('');
                                setUnitInvalidNotice('');
                                setNewCheckIn(selectedDate);
                                const next = new Date(`${selectedDate}T12:00:00`);
                                next.setDate(next.getDate() + 2);
                                setNewCheckOut(next.toISOString().slice(0, 10));
                                setShowNewModal(true);
                              }}
                              className="flex-1 sm:flex-initial justify-center min-h-[40px] px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-principal text-white hover:bg-secundaria hover:text-principal transition-all flex items-center cursor-pointer"
                            >
                              Reservar
                            </button>
                          )}
                          <button
                            onClick={() => handleToggleBlock(bUnit)}
                            className={`flex-1 sm:flex-initial justify-center min-h-[40px] px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                              bUnit.blocked
                                ? 'bg-green-100 text-green-800 hover:bg-green-200'
                                : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {bUnit.blocked ? (
                              <>
                                <Unlock className="w-3.5 h-3.5" /> Desbloquear
                              </>
                            ) : (
                              <>
                                <Lock className="w-3.5 h-3.5" /> Bloquear
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-gray-100 pt-5 space-y-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-principal/40">
                          Reservas Associadas ({upcomingForUnit.length})
                        </p>
                        {upcomingForUnit.length === 0 ? (
                          <p className="text-xs text-texto-main/40 italic py-2">
                            Sem reservas futuras atribuídas.
                          </p>
                        ) : (
                          upcomingForUnit.map((ub) => (
                            <div
                              key={ub.id}
                              className="bg-branco-quente/80 border border-gray-200/70 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="px-2.5 py-1 rounded-lg bg-principal text-white font-black text-[11px]">
                                    Bungalow {bUnit.id}
                                  </span>
                                  <span className="px-2.5 py-1 rounded-lg bg-secundaria/25 border border-secundaria/40 text-principal font-black tabular-nums">
                                    {formatDatePT(ub.checkIn)} → {formatDatePT(ub.checkOut)}
                                  </span>
                                </div>
                                <p className="font-bold text-principal">
                                  {ub.guestName}{' '}
                                  <span className="text-principal/40 font-normal">({ub.id})</span>
                                  <span className="text-texto-main/60 font-semibold ml-2">
                                    • {ub.totalPrice.toFixed(2)}€
                                  </span>
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase ${
                                    STATUS_LABELS[ub.status].badge
                                  }`}
                                >
                                  {STATUS_LABELS[ub.status].label}
                                </span>
                                {ub.status === 'confirmed' && (
                                  <button
                                    onClick={() => handleBookingStatus(ub.id, 'checked-in')}
                                    className="bg-principal text-white px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase"
                                  >
                                    Check-in
                                  </button>
                                )}
                                {ub.status !== 'cancelled' && (
                                  <button
                                    onClick={() => handleBookingStatus(ub.id, 'cancelled')}
                                    className="bg-red-100 text-red-700 px-3 py-1.5 rounded-lg text-[9px] font-bold uppercase"
                                  >
                                    Cancelar
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* RESOURCE DETAIL MODAL (when clicking any of the 350 alvéolos) */}
      <AnimatePresence>
        {selectedResource && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => setSelectedResource(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 max-w-md w-full shadow-2xl space-y-5 sm:space-y-6 max-h-[92vh] overflow-y-auto"
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-secundaria">
                    Setor {selectedResource.sector} • Rua {selectedResource.street}
                  </span>
                  <h3 className="text-3xl font-serif font-bold text-principal">
                    {selectedResource.name} ({selectedResource.id})
                  </h3>
                  <p className="text-xs text-texto-main/60 mt-1 capitalize">
                    Tamanho: {selectedResource.size} • Lotação máx: {selectedResource.capacity} pax
                  </p>
                </div>
                <button
                  onClick={() => setSelectedResource(null)}
                  className="p-2 text-principal/40 hover:text-principal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {(() => {
                const booking = getBookingForResourceOnDate(selectedResource.id, selectedDate);
                const upcomingForResource = bookings.filter(
                  (b) =>
                    b.resourceId === selectedResource.id &&
                    b.status !== 'cancelled' &&
                    b.status !== 'checked-out'
                );

                return (
                  <div className="space-y-4">
                    <div className="bg-branco-quente p-5 rounded-2xl space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-principal/40">
                        Estado em {formatDatePT(selectedDate)}
                      </p>
                      {selectedResource.blocked ? (
                        <p className="text-sm font-bold text-red-700 flex items-center gap-2">
                          <Lock className="w-4 h-4" /> Bloqueado (Indisponível no site público)
                        </p>
                      ) : booking ? (
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="bg-white border border-secundaria/40 rounded-xl p-2.5">
                              <p className="text-[9px] font-black uppercase tracking-wider text-principal/50">
                                Check-in
                              </p>
                              <p className="text-sm font-black text-principal tabular-nums">
                                {formatDatePT(booking.checkIn)}
                              </p>
                            </div>
                            <div className="bg-white border border-secundaria/40 rounded-xl p-2.5">
                              <p className="text-[9px] font-black uppercase tracking-wider text-principal/50">
                                Check-out
                              </p>
                              <p className="text-sm font-black text-principal tabular-nums">
                                {formatDatePT(booking.checkOut)}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm font-bold text-principal">
                            {booking.guestName}{' '}
                            <span className="text-principal/40 font-normal text-xs">({booking.id})</span>
                          </p>
                          <p className="text-xs text-texto-main/60">
                            {booking.email} • {booking.phone}
                          </p>
                          <div className="pt-1 flex gap-2">
                            {booking.status === 'confirmed' && (
                              <button
                                onClick={() => handleBookingStatus(booking.id, 'checked-in')}
                                className="bg-principal text-white px-4 py-2 rounded-xl text-[10px] font-bold uppercase"
                              >
                                Fazer Check-in
                              </button>
                            )}
                            <button
                              onClick={() => handleBookingStatus(booking.id, 'cancelled')}
                              className="bg-red-100 text-red-700 px-4 py-2 rounded-xl text-[10px] font-bold uppercase"
                            >
                              Cancelar Reserva
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm font-bold text-green-700 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4" /> Livre e disponível no site público
                        </p>
                      )}
                    </div>

                    {upcomingForResource.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-principal/40">
                          Reservas deste Alvéolo ({upcomingForResource.length})
                        </p>
                        <div className="max-h-36 overflow-y-auto space-y-2">
                          {upcomingForResource.map((ub) => (
                            <div
                              key={ub.id}
                              className="p-3 rounded-xl bg-branco-quente/70 border border-gray-200/70 flex items-center justify-between gap-2 text-xs"
                            >
                              <div>
                                <p className="font-black text-principal tabular-nums">
                                  {ub.resourceId} • {formatDatePT(ub.checkIn)} → {formatDatePT(ub.checkOut)}
                                </p>
                                <p className="text-[11px] text-texto-main/70">
                                  {ub.guestName} ({ub.id})
                                </p>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                                  STATUS_LABELS[ub.status].badge
                                }`}
                              >
                                {STATUS_LABELS[ub.status].label}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={() => handleToggleBlock(selectedResource)}
                        className={`flex-1 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 ${
                          selectedResource.blocked
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-red-50 text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {selectedResource.blocked ? (
                          <>
                            <Unlock className="w-4 h-4" /> Desbloquear Alvéolo
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4" /> Bloquear p/ Manutenção
                          </>
                        )}
                      </button>
                      {!selectedResource.blocked && !booking && (
                        <button
                          onClick={() => {
                            setNewType('alveolos');
                            setNewSubtypeKey(selectedResource.size || 'grande');
                            setNewPreferredUnit(selectedResource.id);
                            setNewCheckIn(selectedDate);
                            const next = new Date(`${selectedDate}T12:00:00`);
                            next.setDate(next.getDate() + 2);
                            setNewCheckOut(next.toISOString().slice(0, 10));
                            setSelectedResource(null);
                            setShowNewModal(true);
                          }}
                          className="flex-1 bg-principal text-white py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-secundaria hover:text-principal transition-colors"
                        >
                          Reservar Este
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* NEW MANUAL BOOKING MODAL */}
      <AnimatePresence>
        {showNewModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
            onClick={() => setShowNewModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 max-w-2xl w-full shadow-2xl max-h-[92vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-5 sm:mb-6">
                <div>
                  <h3 className="text-xl sm:text-2xl font-serif font-bold text-principal">
                    Nova Reserva (Receção)
                  </h3>
                  <p className="text-xs text-texto-main/55 mt-0.5">
                    Escolha as datas e selecione o alvéolo ou bungalow disponível.
                  </p>
                </div>
                <button
                  onClick={() => setShowNewModal(false)}
                  className="p-2 text-principal/40 hover:text-principal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateManualBooking} className="space-y-5">
                {/* 1. Datas e Hóspedes */}
                <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="min-w-0">
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Check-in
                    </label>
                    <input
                      type="date"
                      required
                      value={newCheckIn}
                      onChange={(e) => setNewCheckIn(e.target.value)}
                      className="w-full min-w-0 min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-2.5 text-sm md:text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Check-out
                    </label>
                    <input
                      type="date"
                      required
                      value={newCheckOut}
                      onChange={(e) => setNewCheckOut(e.target.value)}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-2.5 text-sm md:text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Adultos
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={newAdults}
                      onChange={(e) => setNewAdults(parseInt(e.target.value, 10) || 1)}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-2.5 text-sm md:text-xs font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Crianças
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={6}
                      value={newChildren}
                      onChange={(e) => setNewChildren(parseInt(e.target.value, 10) || 0)}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-2.5 text-sm md:text-xs font-bold"
                    />
                  </div>
                </div>

                {/* 2. Tipo e Filtro de Categoria */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Tipo de Alojamento
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          id: 'alveolos' as AccommodationType,
                          label: 'Alvéolo',
                          count: newAvailability?.alveolos.totalAvailable,
                        },
                        {
                          id: 'bungalows' as AccommodationType,
                          label: 'Bungalow',
                          count: newAvailability?.bungalows.totalAvailable,
                        },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => {
                            setNewType(t.id);
                            setNewSubtypeKey('all');
                            setNewPreferredUnit('');
                            setNewUnitSearch('');
                            setUnitInvalidNotice('');
                          }}
                          className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between transition-all ${
                            newType === t.id
                              ? 'bg-principal text-white border-principal shadow-sm'
                              : 'bg-branco-quente text-principal/70 border-gray-200 hover:border-principal/40'
                          }`}
                        >
                          <span>{t.label}</span>
                          {t.count !== undefined && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                                newType === t.id
                                  ? 'bg-secundaria text-principal'
                                  : 'bg-white text-principal/60'
                              }`}
                            >
                              {t.count}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Filtrar Categoria / Classe
                    </label>
                    <select
                      value={newSubtypeKey}
                      onChange={(e) => {
                        setNewSubtypeKey(e.target.value);
                        setNewPreferredUnit('');
                      }}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-3 text-sm md:text-xs font-bold"
                    >
                      {newType === 'alveolos' ? (
                        <>
                          <option value="all">
                            Todos os Alvéolos ({newAvailability?.alveolos.totalAvailable ?? 0} livres)
                          </option>
                          <option value="pequeno">
                            Pequeno — até 35m² ({newAvailability?.alveolos.pequeno.availableUnits ?? 0} livres)
                          </option>
                          <option value="grande">
                            Grande — até 90m² ({newAvailability?.alveolos.grande.availableUnits ?? 0} livres)
                          </option>
                          <option value="xl">
                            XL — +90m² ({newAvailability?.alveolos.xl.availableUnits ?? 0} livres)
                          </option>
                        </>
                      ) : (
                        <>
                          <option value="all">
                            Todos os Bungalows ({newAvailability?.bungalows.totalAvailable ?? 0} livres)
                          </option>
                          <option value="A">
                            Classe A — até 5 pax ({newAvailability?.bungalows.classeA.availableUnits ?? 0} livres)
                          </option>
                          <option value="B">
                            Classe B — até 4 pax ({newAvailability?.bungalows.classeB.availableUnits ?? 0} livres)
                          </option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* 3. Seleção da Unidade Disponível */}
                <div className="bg-branco-quente/70 border border-gray-200/80 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[10px] font-black uppercase tracking-wider text-principal">
                      {newType === 'alveolos'
                        ? `Selecionar Alvéolo Disponível (${manualBookingAvailability.filteredIds.length} livres nestas datas)`
                        : `Selecionar Bungalow Disponível (${manualBookingAvailability.filteredIds.length} livres nestas datas)`}
                    </label>
                    {loadingNewAvail && (
                      <span className="text-[10px] text-principal/50 font-semibold">
                        A atualizar...
                      </span>
                    )}
                  </div>

                  {unitInvalidNotice && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl font-medium">
                      {unitInvalidNotice}
                    </p>
                  )}

                  {newCheckOut <= newCheckIn ? (
                    <p className="text-xs text-red-600 font-medium">
                      A data de check-out deve ser posterior ao check-in.
                    </p>
                  ) : newType === 'bungalows' ? (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {bungalowResources
                          .filter(
                            (b) => newSubtypeKey === 'all' || b.bungalowClass === newSubtypeKey
                          )
                          .map((bUnit) => {
                            const isAvailable =
                              manualBookingAvailability.availableSetForType.has(bUnit.id);
                            const isSelected = newPreferredUnit === bUnit.id;
                            const totalGuests = newAdults + newChildren;
                            const overCapacity = totalGuests > bUnit.capacity;
                            const priceInfo =
                              bUnit.bungalowClass === 'A'
                                ? newAvailability?.bungalows.classeA.estimatedTotal
                                : newAvailability?.bungalows.classeB.estimatedTotal;

                            return (
                              <button
                                key={bUnit.id}
                                type="button"
                                disabled={!isAvailable || overCapacity}
                                onClick={() => setNewPreferredUnit(isSelected ? '' : bUnit.id)}
                                className={`p-3 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                                  isSelected
                                    ? 'bg-principal text-white border-principal ring-2 ring-secundaria shadow-md'
                                    : isAvailable && !overCapacity
                                      ? 'bg-white border-gray-200 hover:border-principal/40 text-principal'
                                      : 'bg-gray-100/80 border-gray-200 text-gray-400 cursor-not-allowed opacity-70'
                                }`}
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-serif font-bold text-sm">{bUnit.id}</span>
                                    <span
                                      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                                        isSelected
                                          ? 'bg-secundaria text-principal'
                                          : 'bg-branco-quente text-principal/70'
                                      }`}
                                    >
                                      Classe {bUnit.bungalowClass} • até {bUnit.capacity} pax
                                    </span>
                                  </div>
                                  <p
                                    className={`text-[10px] mt-1 font-medium ${
                                      isSelected
                                        ? 'text-white/80'
                                        : !isAvailable
                                          ? 'text-red-600'
                                          : overCapacity
                                            ? 'text-amber-700'
                                            : 'text-emerald-700'
                                    }`}
                                  >
                                    {!isAvailable
                                      ? bUnit.blocked
                                        ? 'Bloqueado'
                                        : 'Ocupado nestas datas'
                                      : overCapacity
                                        ? `Excede lotação (${bUnit.capacity} pax)`
                                        : `Disponível${priceInfo ? ` • ${priceInfo.toFixed(2)}€` : ''}`}
                                  </p>
                                </div>
                                {isSelected && <CheckCircle2 className="w-4 h-4 text-secundaria shrink-0" />}
                              </button>
                            );
                          })}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-principal/65 pt-1">
                        <span>
                          {newPreferredUnit
                            ? `Bungalow selecionado: ${newPreferredUnit}`
                            : manualBookingAvailability.filteredIds.length > 0
                              ? `Atribuição automática: ${manualBookingAvailability.filteredIds[0]}`
                              : 'Sem bungalows livres para estas datas.'}
                        </span>
                        {newPreferredUnit && (
                          <button
                            type="button"
                            onClick={() => setNewPreferredUnit('')}
                            className="text-principal font-bold underline hover:text-secundaria"
                          >
                            Voltar a automático
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-principal/40 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={newUnitSearch}
                            onChange={(e) => setNewUnitSearch(e.target.value)}
                            placeholder="Pesquisar alvéolo (ex: 120, Sul)..."
                            className="w-full min-h-[40px] bg-white border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-xs font-medium focus:outline-none focus:border-secundaria"
                          />
                        </div>

                        <select
                          value={newPreferredUnit}
                          onChange={(e) => setNewPreferredUnit(e.target.value)}
                          className="w-full min-h-[40px] bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-bold text-principal"
                        >
                          <option value="">
                            {(() => {
                              const firstEligible = manualBookingAvailability.matchingUnits.find(
                                (u) => newAdults + newChildren <= u.capacity
                              );
                              if (firstEligible) return `Atribuição Automática (${firstEligible.id})`;
                              if (manualBookingAvailability.filteredIds.length > 0)
                                return 'Sem alvéolos compatíveis com a lotação';
                              return 'Sem alvéolos livres nestas datas';
                            })()}
                          </option>
                          {manualBookingAvailability.matchingUnits.map((u) => {
                            const overCapacity = newAdults + newChildren > u.capacity;
                            return (
                              <option key={u.id} value={u.id} disabled={overCapacity}>
                                {u.id} — Alvéolo {u.number} ({u.size} · Setor {u.sector} · Rua {u.street}
                                {overCapacity ? ` · máx ${u.capacity} pax` : ''})
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {manualBookingAvailability.matchingUnits.length > 0 ? (
                        <div className="max-h-36 overflow-y-auto bg-white border border-gray-200 rounded-xl p-2 grid grid-cols-4 min-[400px]:grid-cols-5 sm:grid-cols-8 gap-1.5">
                          {manualBookingAvailability.matchingUnits.map((u) => {
                            const isSelected = newPreferredUnit === u.id;
                            const overCapacity = newAdults + newChildren > u.capacity;
                            return (
                              <button
                                key={u.id}
                                type="button"
                                disabled={overCapacity}
                                onClick={() => setNewPreferredUnit(isSelected ? '' : u.id)}
                                title={`${u.name} • ${u.size?.toUpperCase()} • Setor ${u.sector} • até ${u.capacity} pax`}
                                className={`py-1.5 px-1 rounded-lg text-[10px] font-bold transition-all ${
                                  isSelected
                                    ? 'bg-principal text-white ring-2 ring-secundaria shadow-sm'
                                    : overCapacity
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                      : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                                }`}
                              >
                                {u.id}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-texto-main/50 italic py-2 text-center bg-white rounded-xl border border-gray-100">
                          Nenhum alvéolo disponível encontrado para este filtro/pesquisa.
                        </p>
                      )}
                    </div>
                  )}

                  {selectedManualSummary && newCheckOut > newCheckIn && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-200/70 text-[11px]">
                      <span className="text-principal/70 font-medium">
                        {selectedPreferredUnitObj
                          ? `${selectedPreferredUnitObj.name} (${
                              selectedPreferredUnitObj.type === 'alveolos'
                                ? `${selectedPreferredUnitObj.size?.toUpperCase()} · Setor ${selectedPreferredUnitObj.sector}`
                                : `Classe ${selectedPreferredUnitObj.bungalowClass}`
                            } · máx. ${selectedPreferredUnitObj.capacity} pax)`
                          : `${selectedManualSummary.label} (Automático)`}
                      </span>
                      <span className="font-bold text-principal">
                        Total estimado: {selectedManualSummary.estimatedTotal.toFixed(2)}€ ({selectedManualSummary.nights}{' '}
                        {selectedManualSummary.nights === 1 ? 'noite' : 'noites'})
                      </span>
                    </div>
                  )}
                </div>

                {/* 4. Dados do Cliente */}
                <div>
                  <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                    Nome do Cliente *
                  </label>
                  <input
                    type="text"
                    required
                    value={newGuestName}
                    onChange={(e) => setNewGuestName(e.target.value)}
                    className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-3 text-xs"
                    placeholder="Nome completo"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-3 text-sm md:text-xs"
                      placeholder="cliente@email.com"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-principal/40 block mb-1">
                      Telefone *
                    </label>
                    <input
                      type="tel"
                      required
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      className="w-full min-h-[44px] bg-branco-quente border border-gray-200 rounded-xl p-3 text-sm md:text-xs"
                      placeholder="+351 9..."
                    />
                  </div>
                </div>

                {selectedManualSummary && !selectedManualSummary.eligible && newCheckOut > newCheckIn && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 p-3 rounded-xl font-medium">
                    {selectedManualSummary.ineligibleReason}
                  </p>
                )}

                {newBookingError && (
                  <p className="text-xs text-red-600 bg-red-50 p-3 rounded-xl font-medium">
                    {newBookingError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    creatingBooking ||
                    newCheckOut <= newCheckIn ||
                    manualBookingAvailability.filteredIds.length === 0 ||
                    (selectedManualSummary ? !selectedManualSummary.eligible : false)
                  }
                  className="w-full bg-principal text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-secundaria hover:text-principal transition-all disabled:opacity-40"
                >
                  {creatingBooking
                    ? 'A registar...'
                    : newPreferredUnit
                      ? `Criar Reserva Confirmada (${newPreferredUnit})`
                      : 'Criar Reserva Confirmada'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * SenderTripsPage — страница поездок ОТПРАВИТЕЛЯ.
 * ✅ FIX П-8: Исправлен статус inProgress (camelCase).
 * ✅ FIX П-6: Грузы отправителя вынесены в отдельную вкладку «Мои грузы»
 *    с корректным отображением без смешивания с booking-логикой.
 * ✅ FIX П-CG: SenderCargoCard показывает кол-во откликов водителей.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, ArrowLeft, RefreshCw, Plus, AlertTriangle, Weight, Calendar, Trash2, Truck, CheckCircle, PhoneCall, Star } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTheme } from '../context/ThemeContext';
import { useUser } from '../contexts/UserContext';
import { useIsMounted } from '../hooks/useIsMounted';
import { toast } from 'sonner';
import { getTripsByIds, getOffersForUser, getMyCargos, updateOffer, deleteCargo, getCargoOffersForSender } from '../api/dataApi';
import { initChatRoom, getChats } from '../api/chatStore';
import { generatePairChatId } from '../api/chatUtils';
import { TripCardSkeleton } from './SkeletonCard';
import { PullIndicator } from './PullIndicator';
import { TripCard } from './TripCard';
import { SwipeableCard } from './SwipeableCard';
import { cleanAddress } from '../utils/addressUtils';

const REVIEWED_TRIPS_KEY = 'ovora_reviewed_trips';

// ── Карточка груза отправителя (П-6: не использует TripCard с mode='sender') ─
function SenderCargoCard({
  cargo, onDelete, offers = [],
}: {
  cargo: any;
  onDelete: (id: string) => void;
  offers?: any[];
}) {
  const navigate = useNavigate();
  const statusColors: Record<string, string> = {
    active:    'bg-emerald-500/15 text-emerald-400',
    matched:   'bg-blue-500/15 text-blue-400',
    cancelled: 'bg-rose-500/15 text-rose-400',
    completed: 'bg-white/[0.07] text-[#64748b]',
  };
  const statusLabels: Record<string, string> = {
    active:    'Активно',
    matched:   'Водитель найден',
    cancelled: 'Отменено',
    completed: 'Завершено',
  };
  const st = cargo.status || 'active';
  const pendingOffers  = offers.filter((o: any) => o.status === 'pending');
  const acceptedOffers = offers.filter((o: any) => o.status === 'accepted');
  const acceptedOffer  = acceptedOffers[0] || null;
  const pendingCount   = pendingOffers.length;
  const acceptedCount  = acceptedOffers.length;
  const totalOffers    = pendingCount + acceptedCount;

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-[#0d1929] p-4 space-y-3 cursor-pointer hover:border-white/[0.14] transition-all active:scale-[0.99]"
      onClick={() => navigate(`/trip/${cargo.id}`)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${statusColors[st] || statusColors.active}`}>
            {statusLabels[st] || 'Активно'}
          </span>
          {acceptedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <CheckCircle className="w-2.5 h-2.5" /> Водитель выбран
            </span>
          )}
          {acceptedCount === 0 && pendingCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Truck className="w-2.5 h-2.5" />
              {pendingCount} {pendingCount === 1 ? 'отклик' : pendingCount < 5 ? 'отклика' : 'откликов'}
            </span>
          )}
        </div>
        {cargo.date && (
          <div className="flex items-center gap-1 text-[11px] text-[#607080] shrink-0">
            <Calendar className="w-3 h-3" />
            <span>{cargo.date}</span>
          </div>
        )}
      </div>
      <div className="flex items-stretch gap-3 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.05]">
        <div className="flex flex-col items-center shrink-0 pt-0.5 gap-0">
          <div className="w-2.5 h-2.5 rounded-full bg-[#5ba3f5] ring-2 ring-[#5ba3f5]/25" />
          <div className="w-0.5 flex-1 my-1 rounded-full bg-gradient-to-b from-[#5ba3f5]/60 to-amber-400/60" style={{ minHeight: 16 }} />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-400/25" />
        </div>
        <div className="flex-1 flex flex-col justify-between gap-1.5 min-w-0">
          <p className="font-bold text-[14px] text-white leading-tight truncate">{cleanAddress(cargo.from)}</p>
          <p className="font-bold text-[14px] text-white leading-tight truncate">{cleanAddress(cargo.to)}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {(cargo.cargoWeight ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-[#8a9baa]">
            <Weight className="w-2.5 h-2.5" />{cargo.cargoWeight} кг
          </span>
        )}
        {(cargo.budget ?? 0) > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
            {cargo.budget} {cargo.currency || 'TJS'}
          </span>
        )}
        {cargo.notes && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.04] text-[#607080] max-w-[160px] truncate">
            {cargo.notes}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.05]">
        <div className="flex items-center gap-1.5">
          {totalOffers === 0 ? (
            <span className="text-[11px] text-[#475569]">Откликов нет</span>
          ) : (
            <span className="text-[11px] text-[#8a9baa]">{totalOffers} {totalOffers === 1 ? 'отклик' : totalOffers < 5 ? 'отклика' : 'откликов'}</span>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete(cargo.id); }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-rose-400 hover:bg-rose-500/10 transition-all active:scale-95"
        >
          <Trash2 className="w-3 h-3" /> Удалить
        </button>
      </div>
      {acceptedOffer && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <PhoneCall className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-emerald-400">{acceptedOffer.driverName}</p>
            <p className="text-[10px] text-[#4a6278] truncate">{acceptedOffer.driverPhone}</p>
          </div>
          <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        </div>
      )}
    </div>
  );
}

export function SenderTripsPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark' || !theme;
  const { user: currentUser } = useUser();
  const isMountedRef = useIsMounted();
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'cancelled'>('active');
  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [activeTab]);

  const [reviewedTrips, setReviewedTrips] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(REVIEWED_TRIPS_KEY) || '[]'); }
    catch { return []; }
  });
  const [confirmModal, setConfirmModal] = useState<{
    title: string; message: string; confirmLabel: string;
    onConfirm: () => void; isDanger?: boolean;
  } | null>(null);

  const [senderTrips, setSenderTrips]       = useState<any[]>([]);
  const [publishedCargos, setPublishedCargos] = useState<any[]>([]);
  const [cargoOffersMap, setCargoOffersMap]   = useState<Record<string, any[]>>({});
  const [chats, setChats]                   = useState<any[]>([]);
  const [loading, setLoading]               = useState(true);
  const [isRefreshing, setIsRefreshing]     = useState(false);
  const [isPulling, setIsPulling]           = useState(false);

  const pullRef = useRef<HTMLDivElement>(null);
  const [pullY, setPullY]   = useState(0);
  const pullStartY          = useRef(0);
  const isPullingRef        = useRef(false);
  // ✅ FIX: версия запроса — pull-to-refresh и кнопка обновления могут запустить
  // loadData() параллельно; без версионирования более старый ответ мог прилететь
  // позже и перезаписать стейт свежими данными более нового запроса.
  const loadVersionRef = useRef(0);

  const showConfirm = (
    title: string, message: string, confirmLabel: string,
    onConfirm: () => void, isDanger = false
  ) => setConfirmModal({ title, message, confirmLabel, onConfirm, isDanger });

  // ── Load cargos ────────────────────────────────────────────────────────────
  const loadCargos = useCallback(async (version: number) => {
    if (!currentUser?.email) return;
    try {
      // ✅ FIX: один батч-запрос (по всем грузам отправителя сразу) вместо
      // N параллельных getCargoOffersForCargo — при 20 грузах это было 20
      // отдельных запросов на каждую загрузку/обновление страницы.
      const [cargos, allOffers] = await Promise.all([
        getMyCargos(currentUser.email),
        getCargoOffersForSender(currentUser.email).catch(() => [] as any[]),
      ]);
      if (!isMountedRef.current || version !== loadVersionRef.current) return;
      setPublishedCargos(cargos);
      const offersMap: Record<string, any[]> = {};
      for (const offer of allOffers) {
        if (!offer?.cargoId) continue;
        (offersMap[offer.cargoId] ??= []).push(offer);
      }
      setCargoOffersMap(offersMap);
    } catch {}
  }, [currentUser?.email]);

  // ── Main data load ─────────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!currentUser?.email) return;
    const version = ++loadVersionRef.current;
    if (!silent) setLoading(true);
    else setIsRefreshing(true);
    try {
      const offerList = await getOffersForUser(currentUser.email);
      const chatList = getChats();
      if (!isMountedRef.current || version !== loadVersionRef.current) return;
      setChats(chatList);

      const acceptedOffers = offerList.filter((o: any) => o.status === 'accepted');
      const tripIds = [...new Set(acceptedOffers.map((o: any) => o.tripId).filter(Boolean))] as string[];
      if (tripIds.length > 0) {
        const trips = await getTripsByIds(tripIds);
        if (!isMountedRef.current || version !== loadVersionRef.current) return;
        const merged = acceptedOffers.map((offer: any) => {
          const trip = trips.find((t: any) => t.id === offer.tripId);
          // ✅ FIX: реальный груз/цена живут в оферте, а не в Trip — без этого
          // спайда трекинг отправителя показывал "undefined" вместо веса/цены.
          return trip ? {
            ...trip,
            offerId:           offer.offerId,
            offerStatus:       offer.status,
            senderEmail:       offer.senderEmail,
            inProgress:        offer.inProgress ?? false,
            cargoType:         offer.cargoType,
            weight:            offer.weight,
            price:             offer.price,
            currency:          offer.currency,
            notes:             offer.notes,
            requestedSeats:    offer.requestedSeats,
            requestedChildren: offer.requestedChildren,
            requestedCargo:    offer.requestedCargo,
          } : null;
        }).filter(Boolean);
        setSenderTrips(merged);
      } else {
        setSenderTrips([]);
      }
      await loadCargos(version);
    } catch {
      if (!silent) toast.error('Не удалось загрузить данные поездок');
    }
    finally {
      if (isMountedRef.current && version === loadVersionRef.current) { setLoading(false); setIsRefreshing(false); }
    }
  }, [currentUser?.email, loadCargos]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Pull to refresh ────────────────────────────────────────────────────────
  const pullTouchStart = (e: React.TouchEvent) => {
    if (!pullRef.current) return;
    const scrollTop = pullRef.current.scrollTop;
    if (scrollTop > 0) return;
    pullStartY.current = e.touches[0].clientY;
    isPullingRef.current = true;
  };
  const pullTouchMove = (e: React.TouchEvent) => {
    if (!isPullingRef.current) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0) { setPullY(Math.min(dy, 80)); setIsPulling(dy > 40); }
  };
  const pullTouchEnd = async () => {
    if (isPulling) await loadData(true);
    setPullY(0); setIsPulling(false); isPullingRef.current = false;
  };

  // ── Computed values ────────────────────────────────────────────────────────
  // 'frozen' — водитель поставил поездку на паузу, но бронирование остаётся
  // активным (см. карточка в TripCard.tsx с пояснением и кнопкой отмены) —
  // должна оставаться в «Бронированиях», иначе поездка пропадает из всех табов.
  const activeCount  = senderTrips.filter(t => t.status === 'planned' || t.status === 'active' || t.status === 'inProgress' || t.status === 'frozen').length;
  const cargosCount  = publishedCargos.length;
  const filteredTrips = senderTrips.filter(t => {
    if (activeTab === 'active')    return t.status === 'planned' || t.status === 'active' || t.status === 'inProgress' || t.status === 'frozen';
    if (activeTab === 'completed') return t.status === 'completed';
    if (activeTab === 'cancelled') return t.status === 'cancelled';
    return false;
  });
  // ✅ FIX: пагинация — список бронирований у активного отправителя со временем
  // растёт (особенно "Завершённые"), рендерить всё сразу дорого по DOM/памяти.
  const visibleTrips = filteredTrips.slice(0, visibleCount);
  const hasMoreTrips = filteredTrips.length > visibleCount;
  const senderAllCargos = publishedCargos;

  const getUnread = (trip: any) => {
    const chatId = generatePairChatId(currentUser?.email || '', trip.driverEmail || '');
    const chat = chats.find(c => c.id === chatId);
    return chat?.unreadCount || 0;
  };

  const openDriverChat = async (e: React.MouseEvent, trip: any) => {
    e.stopPropagation();
    if (!currentUser?.email || !trip.driverEmail) return;
    const chatId = generatePairChatId(currentUser.email, trip.driverEmail);
    await initChatRoom(chatId, {
      id: trip.driverEmail,
      name: trip.driverName || 'Водитель',
      avatar: trip.driverAvatar || '',
      role: 'driver',
      sub: 'Водитель',
      online: true,
      verified: true,
      email: trip.driverEmail,
    }, String(trip.tripId ?? trip.id), `${trip.from} → ${trip.to}`, trip);
    navigate(`/chat/${chatId}`);
  };

  // ✅ Единственный канонический способ оставить отзыв — страница «Архив
  // поездки» (TripDetail.tsx, ReviewCard). Раньше тут был ещё один полный
  // дубль формы отзыва в модалке — два разных места с разными багами и
  // путаницей у пользователя, какое из них «настоящее». Кнопка на карточке
  // теперь просто открывает архив поездки, как и тап по самой карточке.
  const openReview = (e: React.MouseEvent, trip: any) => {
    e.stopPropagation();
    navigate(`/trip/${trip.tripId || trip.id}`);
  };

  const handleCancelBooking = async (e: any, trip: any) => {
    e.stopPropagation();
    showConfirm(
      'Отменить бронирование?',
      'Вы уверены, что хотите отменить эту поездку?',
      'Отменить',
      async () => {
        try {
          await updateOffer(trip.tripId ?? trip.id, trip.offerId, { status: 'cancelled', callerEmail: currentUser?.email });
          setSenderTrips(prev =>
            prev.map(t => t.offerId === trip.offerId ? { ...t, status: 'cancelled' } : t)
          );
          toast.success('Бронирование отменено');
        } catch { toast.error('Ошибка при отмене'); }
      },
      true
    );
  };

  const handleDeleteCargo = (cargoId: string) => {
    showConfirm(
      'Удалить объявление?',
      'Это действие необратимо.',
      'Удалить',
      async () => {
        try {
          await deleteCargo(cargoId);
          setPublishedCargos(prev => prev.filter(c => c.id !== cargoId));
          toast.success('Объявление удалено');
        } catch (err: any) {
          if (err?.status === 404) {
            // Груз уже удалён (например, с другого устройства) — для
            // пользователя это не ошибка, просто синхронизируем список.
            setPublishedCargos(prev => prev.filter(c => c.id !== cargoId));
            toast.success('Объявление уже было удалено');
          } else {
            toast.error('Ошибка при удалении');
          }
        }
      },
      true
    );
  };

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs = [
    { key: 'active' as const,    label: 'Бронирования', count: activeCount },
    { key: 'completed' as const, label: 'Завершённые',  count: senderTrips.filter(t => t.status === 'completed').length },
    { key: 'cancelled' as const, label: 'Отменённые',   count: senderTrips.filter(t => t.status === 'cancelled').length },
  ];

  // ── Cargo list (переиспользуемый блок) ────────────────────────────────────
  const renderCargoList = (grid = false) => {
    if (loading) {
      return (
        <div className={grid ? 'grid grid-cols-2 xl:grid-cols-3 gap-4' : 'px-4 pt-3 space-y-3'}>
          {[1,2,3].map(i => <TripCardSkeleton key={i} isDark={isDark} />)}
        </div>
      );
    }
    if (senderAllCargos.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-3 px-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center bg-amber-500/10">
            <Package className="w-7 h-7 text-amber-400" />
          </div>
          <p className="text-sm font-medium text-[#475569] text-center">Объявлений о грузах нет</p>
        </div>
      );
    }
    if (grid) {
      return (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
          {senderAllCargos.map(cargo => (
            <SenderCargoCard key={cargo.id} cargo={cargo} onDelete={handleDeleteCargo}
              offers={cargoOffersMap[cargo.id] || []} />
          ))}
        </div>
      );
    }
    return (
      <div className="px-4 pt-3 space-y-3 pb-24">
        {senderAllCargos.map(cargo => (
          <SenderCargoCard key={cargo.id} cargo={cargo} onDelete={handleDeleteCargo}
            offers={cargoOffersMap[cargo.id] || []} />
        ))}
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-30 md:relative md:inset-auto md:z-auto md:min-h-screen flex flex-col font-['Sora'] bg-[#060e1a]">

      {/* ══════════ MOBILE LAYOUT ══════════ */}
      <div className="md:hidden flex flex-col h-full overflow-hidden">
        <header className="shrink-0 flex items-center gap-3 px-4 border-b backdrop-blur-xl bg-[#060e1a]/95 border-white/[0.06]"
          style={{ paddingTop: 'max(48px, env(safe-area-inset-top, 48px))', paddingBottom: 14 }}>
          <button onClick={() => navigate('/dashboard')} className="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-bold tracking-tight truncate text-white">Мои поездки</h1>
              {activeCount > 0 && (
                <div className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#1978e5] shrink-0">
                  <span className="text-[10px] font-bold text-white leading-none">{activeCount > 99 ? '99+' : activeCount}</span>
                </div>
              )}
            </div>
            <p className="text-[11px] mt-0.5 text-[#64748b]">Ваши бронирования</p>
          </div>
          <button onClick={() => loadData(true)} className="w-9 h-9 rounded-full flex items-center justify-center text-[#1978e5] hover:bg-[#1978e5]/15 active:scale-90 transition-all">
            <RefreshCw style={{ width: 18, height: 18 }} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </header>

        {/* Mobile Tabs */}
        <div className="shrink-0 border-b border-white/[0.06]">
          <div className="flex h-11 items-stretch overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex-shrink-0 flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold transition-all border-b-2 px-1 ${
                  activeTab === tab.key ? 'border-[#1978e5] text-white' : 'border-transparent text-[#475569]'
                }`}>
                {tab.label}
                {tab.count > 0 && <span className={`text-[10px] font-bold ${activeTab === tab.key ? 'text-[#1978e5]' : 'text-[#475569]'}`}>{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Mobile List */}
        <div ref={pullRef} className="flex-1 overflow-y-auto"
          onTouchStart={pullTouchStart} onTouchMove={pullTouchMove} onTouchEnd={pullTouchEnd}>
          <PullIndicator pullY={pullY} isRefreshing={isPulling} />

          <>
              {loading && filteredTrips.length === 0 && (
                <div className="px-4 pt-3 space-y-3">{[1,2,3].map(i => <TripCardSkeleton key={i} isDark={isDark} />)}</div>
              )}
              {!loading && filteredTrips.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 gap-3 px-6">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center bg-white/[0.05]">
                    <Package className="w-7 h-7 text-[#475569]" />
                  </div>
                  <p className="text-sm font-medium text-[#475569] text-center">
                    {activeTab === 'active' ? 'Активных поездок нет' : activeTab === 'completed' ? 'Завершённых нет' : 'Отменённых нет'}
                  </p>
                  {activeTab === 'active' && (
                    <p className="text-xs text-center text-[#3d5a6a]">Найдите поездку и отправьте заявку водителю</p>
                  )}
                </div>
              )}
              {!loading && visibleTrips.map(trip => (
                <div key={trip.id} className="px-4 py-2">
                  <SwipeableCard
                    enabled={trip.status === 'cancelled'}
                    onSwipeDismiss={() => handleCancelBooking({ stopPropagation: () => {} } as any, trip)}
                    actionLabel="Удалить"
                  >
                    <TripCard
                      trip={trip}
                      mode="sender"
                      alreadyReviewed={reviewedTrips.includes(String(trip.id))}
                      unreadMessages={getUnread(trip)}
                      onChat={e => openDriverChat(e, trip)}
                      onTrack={e => {
                        e.stopPropagation();
                        // ✅ FIX: сохраняем ВЕСЬ объект (id, координаты, груз/цена из оферты) —
                        // раньше тут писалась урезанная копия без id/координат/цены, из-за
                        // чего страница трекинга отправителя не находила shipment и показывала demo-данные.
                        localStorage.setItem('ovora_sender_tracking_trip', JSON.stringify(trip));
                        navigate('/tracking');
                      }}
                      onReview={e => openReview(e, trip)}
                      onCancelBooking={e => handleCancelBooking(e, trip)}
                    />
                  </SwipeableCard>
                </div>
              ))}
              {!loading && hasMoreTrips && (
                <div className="px-4 py-2">
                  <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                    className={`w-full h-10 rounded-xl text-[13px] font-semibold ${isDark ? 'bg-white/[0.06] text-[#94a3b8] hover:bg-white/10' : 'bg-black/[0.04] text-[#64748b] hover:bg-black/[0.08]'}`}>
                    Показать ещё ({filteredTrips.length - visibleCount})
                  </button>
                </div>
              )}
            </>
          <div style={{ height: 'env(safe-area-inset-bottom, 16px)', minHeight: 80 }} />
        </div>
      </div>

      {/* ══════════ DESKTOP LAYOUT ══════════ */}
      <div className="hidden md:flex flex-col min-h-screen">
        <div className="border-b border-white/[0.06] shrink-0" style={{ background: '#060e1a' }}>
          <div className="max-w-6xl mx-auto px-8 py-5 flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')}
              className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center text-[#607080] hover:text-white hover:bg-white/[0.10] transition-all shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[20px] font-black text-white">Мои поездки</h1>
                {activeCount > 0 && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500 text-white text-[11px] font-black">{activeCount} активных</span>
                )}
              </div>
              <p className="text-[11px] text-[#4a6278] mt-0.5">Ваши бронирования поездок</p>
            </div>
            <div className="flex items-center gap-3">
              {[
                { label: 'Бронирования', value: activeCount, color: '#10b981' },
                { label: 'Завершённые', value: senderTrips.filter(t => t.status === 'completed').length, color: '#5ba3f5' },
              ].map(s => (
                <div key={s.label} className="flex flex-col items-center px-4 py-2 rounded-2xl"
                  style={{ background: s.color + '10', border: `1px solid ${s.color}20` }}>
                  <span className="text-[18px] font-black" style={{ color: s.color }}>{s.value}</span>
                  <span className="text-[9px] font-bold text-[#4a6278] uppercase tracking-wide">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => loadData(true)}
                className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center text-[#607080] hover:text-white transition-all">
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => navigate('/search')}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13px] font-bold"
                style={{ background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 4px 16px #10b98130' }}>
                <Plus className="w-4 h-4" /> Найти поездку
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-white/[0.06] shrink-0" style={{ background: '#060e1a' }}>
          <div className="max-w-6xl mx-auto px-8 flex gap-1 pt-1">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 text-[13px] font-bold transition-all border-b-2 ${
                  activeTab === tab.key ? 'text-white border-[#10b981]' : 'text-[#475569] border-transparent hover:text-[#8a9baa]'
                }`}>
                {tab.label}
                {tab.count > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    activeTab === tab.key ? 'bg-[#10b981] text-white' : 'bg-white/[0.06] text-[#475569]'
                  }`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ background: '#060e1a' }}>
          <div className="max-w-6xl mx-auto px-8 py-6">
            <>
                {loading && filteredTrips.length === 0 && (
                  <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="rounded-2xl border border-white/[0.06] p-4 animate-pulse space-y-3" style={{ background: '#0d1929' }}>
                        <div className="flex justify-between"><div className="h-6 w-24 rounded-full bg-white/[0.08]" /><div className="h-4 w-20 rounded-full bg-white/[0.06]" /></div>
                        <div className="h-16 rounded-xl bg-white/[0.05]" /><div className="h-10 rounded-xl bg-white/[0.04]" />
                      </div>
                    ))}
                  </div>
                )}
                {!loading && filteredTrips.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-32 gap-4">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center" style={{ background: '#10b98110' }}>
                      <Package className="w-9 h-9 text-[#10b981]" />
                    </div>
                    <div className="text-center">
                      <p className="text-[20px] font-black text-white mb-2">
                        {activeTab === 'active' ? 'Нет активных бронирований' : activeTab === 'completed' ? 'Завершённых нет' : 'Отменённых нет'}
                      </p>
                      <p className="text-[14px] text-[#4a6278]">
                        {activeTab === 'active' ? 'Найдите поездку и отправьте заявку водителю' : 'Здесь будут отображаться поездки'}
                      </p>
                    </div>
                    {activeTab === 'active' && (
                      <button onClick={() => navigate('/search')}
                        className="flex items-center gap-2 px-6 py-3 rounded-2xl text-white text-[14px] font-bold"
                        style={{ background: 'linear-gradient(135deg,#059669,#10b981)', boxShadow: '0 8px 24px #10b98130' }}>
                        <Plus className="w-4 h-4" /> Найти поездку
                      </button>
                    )}
                  </div>
                )}
                {!loading && filteredTrips.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                      {visibleTrips.map(trip => (
                        <TripCard
                          key={trip.id}
                          trip={trip}
                          mode="sender"
                          alreadyReviewed={reviewedTrips.includes(String(trip.id))}
                          unreadMessages={getUnread(trip)}
                          onChat={e => openDriverChat(e, trip)}
                          onTrack={e => {
                            e.stopPropagation();
                            // ✅ FIX: см. mobile-версию выше — сохраняем полный объект поездки.
                            localStorage.setItem('ovora_sender_tracking_trip', JSON.stringify(trip));
                            navigate('/tracking');
                          }}
                          onReview={e => openReview(e, trip)}
                          onCancelBooking={e => handleCancelBooking(e, trip)}
                        />
                      ))}
                    </div>
                    {hasMoreTrips && (
                      <div className="flex justify-center mt-6">
                        <button onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                          className={`px-5 h-10 rounded-xl text-[13px] font-semibold ${isDark ? 'bg-white/[0.06] text-[#94a3b8] hover:bg-white/10' : 'bg-black/[0.04] text-[#64748b] hover:bg-black/[0.08]'}`}>
                          Показать ещё ({filteredTrips.length - visibleCount})
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
          </div>
        </div>
      </div>

      {/* ── Confirm Modal ─────────────────────────────────────────────────────── */}
      {confirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={() => setConfirmModal(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-message" className="relative w-full max-w-sm mx-4 rounded-3xl shadow-2xl bg-[#162030] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-2">
              <div className="flex items-start gap-3">
                {confirmModal.isDanger && (
                  <div className="w-9 h-9 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle className="w-4.5 h-4.5 text-rose-400" />
                  </div>
                )}
                <div>
                  <h3 id="confirm-modal-title" className="text-base font-bold text-white">{confirmModal.title}</h3>
                  <p id="confirm-modal-message" className="text-sm text-[#475569] mt-1">{confirmModal.message}</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6 pt-4 flex gap-3">
              <button onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold text-[#8a9baa] bg-white/[0.06] hover:bg-white/[0.10] transition-all">
                Отмена
              </button>
              <button
                onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
                className={`flex-1 py-2.5 rounded-2xl text-sm font-bold text-white transition-all ${
                  confirmModal.isDanger ? 'bg-rose-500 hover:bg-rose-600' : 'bg-[#1978e5] hover:bg-[#1565c0]'
                }`}>
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

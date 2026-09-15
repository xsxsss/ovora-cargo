import { useParams, useNavigate } from 'react-router';
import { childSeatPrice } from '../utils/pricing';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { useUser } from '../contexts/UserContext';
import { AVATARS } from '../constants/avatars';
import { getTripById, getCargoById, submitOffer as submitOfferApi, getOffersForUser, getOffersForTrip, updateOffer, submitReview as submitReviewApi, submitCargoOffer, getCargoOffersForCargo, updateCargoOffer } from '../api/dataApi';
import { getActiveShipment, SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_ICONS, type ActiveShipment } from '../api/trackingApi';
import { Star, Users, Calendar, MessageSquare, Shield, ArrowLeft, Share2, CheckCircle2, Truck, Phone, Plus, Minus, X, CheckCircle, Clock, Route, Banknote, ThumbsUp, Award, Zap, Heart, Navigation, FileText, AlertCircle, Package, UserCheck, XCircle, Camera } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { toast } from 'sonner';
import { useFavorites } from '../hooks/useFavorites';
import { initChatRoom, pushMessage } from '../api/chatStore';
import { generatePairChatId } from '../api/chatUtils';
import { cleanAddress } from '../utils/addressUtils';
import { calculateDistance } from '@/utils/geolocation';
import { StarRow } from './ui/StarRow';

const REVIEWS_KEY = 'ovora_reviews';
const REVIEWED_TRIPS_KEY = 'ovora_reviewed_trips';

const CATEGORY_ICONS: Record<string, any> = {
  punctuality: Zap, reliability: Shield,
  communication: MessageSquare, packaging: Award,
};
const CATEGORY_LABELS: Record<string, string> = {
  punctuality: 'Пунктуальность', reliability: 'Надёжность',
  communication: 'Коммуникация', packaging: 'Упаковка',
};

// Helper to format distance
function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} м`;
  const rounded = Math.round(km);
  return rounded >= 1000 
    ? `${Math.floor(rounded / 1000)} ${String(rounded % 1000).padStart(3, '0')} км`.replace(/\s0+/, ' ')
    : `${rounded} км`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETED TRIP PAGE
// ─────────────────────────────────────────────────────────────────────────────
function CompletedTripDetail({ trip, isDark }: { trip: any; isDark: boolean }) {
  const navigate = useNavigate();
  const userRole = sessionStorage.getItem('userRole') || 'sender';
  // Фикс 4/6: полный объект driver с email для чата
  const driver = trip.driver || {
    name: trip.driverName || 'Водитель',
    email: trip.driverEmail || '',
    avatar: trip.driverAvatar || '',
    rating: trip.driverRating ?? 5.0,
    trips: 1,
    verified: false,
  };
  // Фикс 6: текущий пользователь нужен для чата
  const { user: currentUser } = useUser();

  // Calculate real distance from coordinates
  const realDistance = (trip.fromLat && trip.fromLng && trip.toLat && trip.toLng)
    ? formatDistance(calculateDistance(trip.fromLat, trip.fromLng, trip.toLat, trip.toLng))
    : null;
  const displayDistance = realDistance || trip.distance || '~ км';

  // Поездка может иметь несколько принятых офферов от разных отправителей
  // (несколько мест/грузов на одном рейсе) — водитель должен оценить каждого.
  const [tripOffers, setTripOffers] = useState<any[]>([]);
  useEffect(() => {
    if (userRole !== 'driver') return;
    getOffersForTrip(String(trip.id)).then(setTripOffers).catch(() => setTripOffers([]));
  }, [trip.id, userRole]);

  // ✅ Архив поездки не показывал, прошла ли таможня, когда был
  // загружен/выгружен груз и фото-подтверждения — данные о доставке хранятся
  // отдельно от Trip (в shipment-трекинге), подгружаем их явно.
  const [shipment, setShipment] = useState<ActiveShipment | null>(null);
  useEffect(() => {
    if (!currentUser?.email) return;
    getActiveShipment(String(trip.id), currentUser.email).then(setShipment).catch(() => setShipment(null));
  }, [trip.id, currentUser?.email]);

  // ✅ FIX: блокируем самооценку — тестовые/демо-офферы иногда создаются
  // тем же аккаунтом, что и контрагент поездки.
  const myEmail = (currentUser?.email || '').toLowerCase().trim();
  const reviewTargets = useMemo(() => {
    if (userRole === 'driver') {
      const accepted = tripOffers.filter((o: any) => o && o.status === 'accepted' && o.senderEmail && o.senderEmail.toLowerCase().trim() !== myEmail);
      const seen = new Map<string, string>();
      for (const o of accepted) {
        if (!seen.has(o.senderEmail)) seen.set(o.senderEmail, o.senderName || o.senderEmail);
      }
      if (seen.size > 0) return Array.from(seen.entries()).map(([email, name]) => ({ email, name }));
      // Резерв для старых поездок без отдельных офферов
      const fallbackEmail = trip.senderEmail || trip.acceptedSenderEmail || '';
      return fallbackEmail && fallbackEmail.toLowerCase().trim() !== myEmail
        ? [{ email: fallbackEmail, name: trip.senderName || 'Отправитель' }] : [];
    }
    const driverEmail = driver.email || trip.driverEmail || '';
    return driverEmail && driverEmail.toLowerCase().trim() !== myEmail
      ? [{ email: driverEmail, name: driver.name || 'Водитель' }] : [];
  }, [userRole, tripOffers, trip, driver, myEmail]);

  return (
    <div className="min-h-screen flex flex-col font-['Sora'] bg-[#060e1a] text-white">
      <header className="sticky top-0 z-50 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b bg-[#060e1a]/95 border-white/[0.06]">
        <button onClick={() => navigate(-1)} className={`flex size-10 items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-[#1e2d3a]' : 'hover:bg-[#e2e8f0]'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className={`text-sm font-bold ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`}>Архив поездки</span>
        <button
          onClick={async () => {
            const url = `${window.location.origin}/trip/${trip.id}`;
            const text = `${trip.from} → ${trip.to} · ${trip.date} | Ovora Cargo`;
            if (navigator.share) { try { await navigator.share({ title: 'Архив поездки Ovora Cargo', text, url }); } catch {} }
            else { await navigator.clipboard.writeText(`${text}\n${url}`); toast.success('Ссылка скопирована!'); }
          }}
          className={`flex size-10 items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-[#1e2d3a]' : 'hover:bg-[#e2e8f0]'}`}>
          <Share2 className="w-5 h-5" />
        </button>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden mx-4 mt-5 rounded-3xl">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url('${trip.images?.[0] || AVATARS.truckRoad}')` }} />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/80 via-emerald-900/70 to-[#0d2d1e]/90" />
        <div className="relative z-10 px-5 py-6 flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400/40 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
          </div>
          <div>
            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-1">Поездка завершена</p>
            <h1 className="text-white text-2xl font-extrabold leading-tight">{trip.from}<span className="text-emerald-400 mx-2">→</span>{trip.to}</h1>
            <p className="text-white/60 text-sm mt-1">{trip.date} · {trip.time}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 mt-4">
        <div className={`rounded-3xl border overflow-hidden ${isDark ? 'bg-[#1a2736] border-[#1e2d3a]' : 'bg-white border-[#e2e8f0]'}`}>
          <div className="grid grid-cols-3">
            {[
              { icon: Route, label: 'Расстояние', value: displayDistance, color: 'text-[#1978e5]' },
              { icon: Calendar, label: 'Дата', value: trip.date, color: 'text-emerald-500' },
              { icon: Banknote, label: 'Цена', value: `${trip.pricePerSeat || trip.pricePerKg || 0} ${trip.currency || 'TJS'}`, color: 'text-amber-500' },
            ].map(({ icon: Icon, label, value, color }, i) => (
              <div key={i} className={`py-4 px-2 flex flex-col items-center gap-1.5 ${i < 2 ? (isDark ? 'border-r border-[#1e2d3a]' : 'border-r border-[#f1f5f9]') : ''}`}>
                <Icon className={`w-4 h-4 ${color}`} />
                <span className={`text-[10px] uppercase tracking-wider font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>{label}</span>
                <span className={`text-xs font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Этапы доставки — таможня, загрузка/выгрузка, фото-подтверждение */}
      {shipment && (
        <div className="px-4 mt-4">
          <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>Этапы доставки</p>
          <div className={`rounded-2xl border p-4 space-y-2.5 ${isDark ? 'bg-[#1a2736] border-[#1e2d3a]' : 'bg-white border-[#e2e8f0]'}`}>
            {(['pending', 'loaded', 'inProgress', 'customs', 'arrived', 'delivered'] as const).map(key => {
              const entry = shipment.statusHistory?.find(h => h.status === key);
              const done = !!entry;
              return (
                <div key={key} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{SHIPMENT_STATUS_ICONS[key]}</span>
                    <span className={`text-xs font-semibold ${done ? (isDark ? 'text-white' : 'text-[#0f172a]') : (isDark ? 'text-[#475569]' : 'text-[#94a3b8]')}`}>
                      {SHIPMENT_STATUS_LABELS[key]}
                    </span>
                  </div>
                  <span className={`text-[11px] ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`}>
                    {entry ? new Date(entry.timestamp).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
          {!!shipment.podPhotos?.length && (
            <div className={`mt-2.5 rounded-2xl border p-4 ${isDark ? 'bg-[#1a2736] border-[#1e2d3a]' : 'bg-white border-[#e2e8f0]'}`}>
              <div className="flex items-center gap-1.5 mb-2.5">
                <Camera className={`w-3.5 h-3.5 ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`} />
                <span className={`text-[11px] font-bold uppercase tracking-wider ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>Фото-подтверждение</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {shipment.podPhotos.map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="relative shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-white/[0.08]">
                    <img src={p.url} alt={p.type} className="w-full h-full object-cover" />
                    <span className="absolute bottom-1 left-1 text-[9px] font-black px-1.5 py-0.5 rounded bg-black/60 text-white">
                      {p.type === 'loading' ? '📦 Загрузка' : '✅ Выгрузка'}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Driver */}
      <div className="px-4 mt-4">
        <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>Водитель</p>
        <div className={`flex items-center gap-4 p-4 rounded-2xl border ${isDark ? 'bg-[#1a2736] border-[#1e2d3a]' : 'bg-white border-[#e2e8f0]'}`}>
          <div className="relative shrink-0">
            <div className="h-14 w-14 rounded-2xl bg-cover bg-center ring-2 ring-emerald-500/30" style={{ backgroundImage: `url('${driver.avatar}')` }} />
            {driver.verified && (
              <div className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full ${isDark ? 'bg-[#1a2736]' : 'bg-white'}`}>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
            )}
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-base font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>{driver.name}</span>
              {driver.verified && <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>Верифицирован</span>}
            </div>
            <div className={`flex items-center gap-2 mt-1 text-xs ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`}>
              <div className="flex items-center gap-0.5">
                <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                <span className={`font-bold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>{driver.rating}</span>
              </div>
              <span>·</span><span>{driver.trips} поездок</span>
            </div>
          </div>
          {/* Фикс 6: навигация в конкретный чат с водителем */}
          <button onClick={() => {
            const driverEmail = driver.email || trip.driverEmail || `driver_${trip.id}`;
            const chatId = generatePairChatId(driverEmail, currentUser?.email || 'guest');
            initChatRoom(chatId, {
              id: driverEmail, name: driver.name, avatar: driver.avatar || '',
              role: 'driver', sub: 'Водитель', rating: driver.rating,
              online: true, verified: driver.verified,
            }, String(trip.id), `${trip.from} → ${trip.to}`, trip);
            navigate(`/chat/${chatId}`);
          }} className={`flex items-center justify-center h-10 w-10 rounded-full ${isDark ? 'bg-[#1e2d3a] text-[#94a3b8] hover:bg-[#253840]' : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]'}`}>
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Review — отдельная карточка на каждого отправителя/водителя поездки */}
      <div className="mb-8">
        {reviewTargets.map(target => (
          <ReviewCard
            key={target.email}
            trip={trip}
            targetEmail={target.email}
            targetName={target.name}
            showName={reviewTargets.length > 1}
            userRole={userRole}
            currentUser={currentUser}
            isDark={isDark}
            navigate={navigate}
          />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW CARD — оценка одного конкретного участника поездки (водитель/отправитель)
// ─────────────────────────────────────────────────────────────────────────────
function ReviewCard({ trip, targetEmail, targetName, showName, userRole, currentUser, isDark, navigate }: {
  trip: any; targetEmail: string; targetName: string; showName: boolean;
  userRole: string; currentUser: any; isDark: boolean; navigate: (path: string) => void;
}) {
  const reviewKey = `${trip.id}:${targetEmail}`;
  const [reviewed, setReviewed] = useState(false);
  const [formRating, setFormRating] = useState(0);
  const [formComment, setFormComment] = useState('');
  const [formCats, setFormCats] = useState({ punctuality: 0, reliability: 0, communication: 0, packaging: 0 });

  useEffect(() => {
    const keys: string[] = JSON.parse(localStorage.getItem(REVIEWED_TRIPS_KEY) || '[]').map(String);
    // Старый формат ключа — просто tripId (одна оценка на поездку) — тоже считаем оценённым
    setReviewed(keys.includes(String(trip.id)) || keys.includes(reviewKey));
  }, [reviewKey, trip.id]);

  const markReviewed = () => {
    const keys: string[] = JSON.parse(localStorage.getItem(REVIEWED_TRIPS_KEY) || '[]');
    localStorage.setItem(REVIEWED_TRIPS_KEY, JSON.stringify([...keys, reviewKey]));
    setReviewed(true);
  };

  // Фикс 1: отзыв уходит на сервер + localStorage как резерв
  const submitReview = async () => {
    if (!formRating) { toast.error('Укажите оценку'); return; }
    if (!formComment.trim()) { toast.error('Напишите комментарий'); return; }
    const authorName = currentUser?.fullName ||
      `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() ||
      (userRole === 'driver' ? 'Водитель' : 'Отправитель');
    try {
      await submitReviewApi({
        authorEmail: currentUser?.email || '',
        authorName,
        targetEmail,
        tripId: trip.id,
        rating: formRating,
        comment: formComment.trim(),
        tripRoute: `${trip.from} → ${trip.to}`,
        categories: {
          punctuality: formCats.punctuality || formRating,
          reliability: formCats.reliability || formRating,
          communication: formCats.communication || formRating,
          packaging: formCats.packaging || formRating,
        },
        type: 'given',
        verified: true,
      });
    } catch (err: any) {
      if (err?.message === 'DUPLICATE_REVIEW') {
        toast.error('Вы уже оставляли отзыв на эту поездку');
        markReviewed();
        return;
      }
      // Если сервер недоступен — только локальное сохранение, UX не блокируем
    }
    const newReview = {
      id: Date.now(), author: authorName, initials: authorName.slice(0, 2).toUpperCase(),
      color: 'bg-blue-500', rating: formRating,
      date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }),
      trip: `${trip.from} → ${trip.to}`, comment: formComment.trim(),
      helpful: 0, helpedBy: [], verified: true, type: 'given',
      categories: {
        punctuality: formCats.punctuality || formRating,
        reliability: formCats.reliability || formRating,
        communication: formCats.communication || formRating,
        packaging: formCats.packaging || formRating,
      },
    };
    const existing = JSON.parse(localStorage.getItem(REVIEWS_KEY) || '[]');
    localStorage.setItem(REVIEWS_KEY, JSON.stringify([newReview, ...existing]));
    markReviewed();
    toast.success('Отзыв опубликован! Спасибо 🙏');
  };

  return (
    <div className="px-4 mt-4">
      <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>
        {userRole === 'driver' ? 'Оцените отправителя' : 'Оцените водителя'}{showName && targetName ? `: ${targetName}` : ''}
      </p>
      <div className={`rounded-3xl border overflow-hidden ${isDark ? 'bg-[#1a2736] border-[#1e2d3a]' : 'bg-white border-[#e2e8f0]'}`}>
        {reviewed ? (
          <div className="flex flex-col items-center gap-3 py-8 px-4 text-center">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isDark ? 'bg-emerald-500/15' : 'bg-emerald-50'}`}>
              <ThumbsUp className="w-7 h-7 text-emerald-500" />
            </div>
            <p className={`font-extrabold text-base ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>Отзыв оставлен!</p>
            <button onClick={() => navigate('/reviews')} className={`px-5 py-2.5 rounded-xl text-sm font-bold ${isDark ? 'bg-[#1e2d3a] text-[#94a3b8]' : 'bg-[#f1f5f9] text-[#475569]'}`}>Посмотреть отзывы</button>
          </div>
        ) : (
          <div className="p-5 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-2">
              <StarRow value={formRating} onChange={setFormRating} size="lg" />
              <span className={`text-xs font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>
                {formRating === 5 ? '😍 Отлично!' : formRating === 4 ? '👍 Хорошо' : formRating === 3 ? '😐 Нейтрально' : formRating === 2 ? '😕 Плохо' : formRating === 1 ? '😤 Ужасно' : 'Нажмите на звезду'}
              </span>
            </div>
            <div className={`rounded-2xl p-4 border ${isDark ? 'bg-[#060e1a]/60 border-[#1e2d3a]' : 'bg-[#f8fafc] border-[#e9eef5]'}`}>
              <div className="space-y-3">
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                  const Icon = CATEGORY_ICONS[key];
                  return (
                    <div key={key} className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 shrink-0 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`} />
                      <span className={`text-xs w-28 shrink-0 ${isDark ? 'text-[#94a3b8]' : 'text-[#475569]'}`}>{label}</span>
                      <StarRow value={formCats[key as keyof typeof formCats]} onChange={v => setFormCats(p => ({ ...p, [key]: v }))} size="sm" />
                    </div>
                  );
                })}
              </div>
            </div>
            <textarea rows={3} placeholder="Расскажите о своём опыте..." value={formComment} onChange={e => setFormComment(e.target.value)}
              className={`w-full px-4 py-3 rounded-2xl border text-sm outline-none focus:border-[#1978e5] resize-none transition-colors ${isDark ? 'bg-[#060e1a] border-[#1e2d3a] text-white placeholder-[#475569]' : 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a] placeholder-[#94a3b8]'}`}
            />
            <button onClick={submitReview} className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-2xl shadow-lg shadow-emerald-500/25 active:scale-[0.98] transition-all">
              <Heart className="w-4 h-4" />Опубликовать отзыв
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE TRIP PAGE (planned / inProgress)
// ─────────────────────────────────────────────────────────────────────────────
function ActiveTripDetail({ trip, isDark, userRole }: { trip: any; isDark: boolean; userRole: string }) {
  const navigate = useNavigate();
  const { id } = useParams();
  const { isFavorite, toggle: toggleFav } = useFavorites();
  const { user: profileUser } = useUser(); // ✅ Get user from UserContext

  // Calculate real distance from coordinates
  const realDistance = (trip.fromLat && trip.fromLng && trip.toLat && trip.toLng)
    ? formatDistance(calculateDistance(trip.fromLat, trip.fromLng, trip.toLat, trip.toLng))
    : null;
  const displayDistance = realDistance || trip.distance || '~ км';

  const hasSeats = (trip.availableSeats ?? 0) > 0;
  const hasCargo = (trip.cargoCapacity ?? 0) > 0;
  const hasChildren = (trip.childSeats ?? 0) > 0;
  const images: string[] = trip.images?.length ? trip.images : ['https://images.unsplash.com/photo-1734903251828-b8d4c0423e56?w=800&h=600&fit=crop'];

  // Resolve driver from nested object OR flat fields saved by SearchPage (driverName, driverEmail, etc.)
  const driver = trip.driver ?? {
    name: trip.driverName || 'Водитель',
    avatar: trip.driverAvatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    email: trip.driverEmail || '',
    phone: trip.driverPhone || '',
    rating: trip.driverRating ?? 5.0,
    trips: trip.driverTrips ?? 1,
    verified: !!trip.driverVerified,
  };

  const isInProgress = trip.status === 'inProgress';
  // Фикс 4: водитель видит "Управлять" только если это ЕГО рейс
  const isOwnTrip = !!profileUser?.email &&
    (profileUser.email === (driver.email || trip.driverEmail || ''));
  const isDriver = userRole === 'driver' && isOwnTrip;

  // ✅ FIX П-7: Оферты на рейс (для водителя)
  const [incomingOffers, setIncomingOffers] = useState<any[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offerActionId, setOfferActionId] = useState<string | null>(null);

  const loadIncomingOffers = async () => {
    if (!isDriver || !id) return;
    setOffersLoading(true);
    try {
      const offersRes = await getOffersForTrip(String(id));
      const active = (offersRes || []).filter((o: any) => o.status === 'pending' || o.status === 'accepted');
      setIncomingOffers(active);
    } catch {
      // silent
    } finally {
      setOffersLoading(false);
    }
  };

  const handleAcceptOffer = async (offer: any) => {
    setOfferActionId(offer.offerId);
    try {
      await updateOffer(String(id), offer.offerId, { status: 'accepted' });
      setIncomingOffers(prev => prev.map(o => o.offerId === offer.offerId ? { ...o, status: 'accepted' } : o));
      toast.success(`Оферта от ${offer.senderName} принята!`);
    } catch (err: any) {
      toast.error(err?.status === 409
        ? 'Недостаточно мест/вместимости на рейсе для этой оферты'
        : 'Ошибка при принятии оферты');
    } finally {
      setOfferActionId(null);
    }
  };

  const handleDeclineOffer = async (offer: any) => {
    setOfferActionId(offer.offerId);
    try {
      await updateOffer(String(id), offer.offerId, { status: 'declined' });
      setIncomingOffers(prev => prev.filter(o => o.offerId !== offer.offerId));
      toast.success('Оферта отклонена');
    } catch {
      toast.error('Ошибка при отклонении оферты');
    } finally {
      setOfferActionId(null);
    }
  };

  useEffect(() => {
    if (isDriver) loadIncomingOffers();
  }, [isDriver, id]);

  // Offer modal
  const [showOffer, setShowOffer] = useState(false);
  const [includeSeats, setIncludeSeats] = useState(false);
  const [includeCargo, setIncludeCargo] = useState(false);
  const [offerSeats, setOfferSeats] = useState(1);
  const [offerChildren, setOfferChildren] = useState(0);
  const [offerCargoKg, setOfferCargoKg] = useState(1);
  const [offerCargoDesc, setOfferCargoDesc] = useState('');
  
  // Unified fields for submission
  const [_offerCargoType, setOfferCargoType] = useState('');
  const [_offerWeight, setOfferWeight] = useState('');
  const [_offerVolume, setOfferVolume] = useState('');
  const [_offerPrice, setOfferPrice] = useState('');
  const [_offerCurrency, _setOfferCurrency] = useState<'TJS' | 'RUB' | 'USD'>('TJS');
  const [_offerNotes, setOfferNotes] = useState('');

  // profileUser уже доступен из useUser() в начале компонента
  const [offerName, setOfferName] = useState(`${profileUser?.firstName || ''} ${profileUser?.lastName || ''}`.trim());
  const [offerPhone, setOfferPhone] = useState(profileUser?.phone || '');

  const [offerDone, setOfferDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);

  // ✅ Auto-fill offer form with trip data when modal opens
  useEffect(() => {
    if (!showOffer || !trip) return;

    // Fix: начинаем с минимальных значений — пользователь сам укажет нужное количество
    setOfferSeats(1);
    setOfferChildren(0);
    setOfferCargoKg(1);

    // Тоггл по умолчанию: один активный
    // — есть места → только seats ON; нет мест но есть груз → только cargo ON
    const hasSeatsAvail = (trip.availableSeats ?? 0) > 0;
    const hasCargoAvail = (trip.cargoCapacity ?? 0) > 0;
    if (hasSeatsAvail) {
      setIncludeSeats(true);
      setIncludeCargo(false);
    } else if (hasCargoAvail) {
      setIncludeSeats(false);
      setIncludeCargo(true);
    } else {
      setIncludeSeats(false);
      setIncludeCargo(false);
    }

    // Auto-fill user profile data
    if (profileUser) {
      const fullName = `${profileUser.firstName || ''} ${profileUser.lastName || ''}`.trim();
      if (fullName) setOfferName(fullName);
      if (profileUser.phone) setOfferPhone(profileUser.phone);
    }
  }, [showOffer, trip]);

  // ✅ Check if sender already submitted an offer for this trip (from server)
  const [alreadyOffered, setAlreadyOffered] = useState(false);
  const [offerStatus, setOfferStatus] = useState<'pending' | 'accepted' | 'declined' | null>(null);
  const previousStatusRef = useRef<'pending' | 'accepted' | 'declined' | null>(null);

  const checkAlreadyOffered = async () => {
    // profileUser уже доступен из useUser() в начале компонента
    if (!profileUser?.email) return;
    try {
      const offers = await getOffersForUser(profileUser.email);
      // ✅ Also purge stale localStorage cache to prevent ghost offers
      localStorage.removeItem('ovora_offers');
      
      // Фикс 10: console.log убраны из production
      const currentOffer = offers.find((o: any) => String(o.tripId) === String(id));
      if (currentOffer) {
        const newStatus = currentOffer.status;
        // Уведомление только при реальном изменении статуса (не при первой загрузке)
        if (previousStatusRef.current !== null && previousStatusRef.current !== newStatus) {
          if (newStatus === 'accepted') {
            toast.success('🎉 Водитель принял вашу оферту!', { duration: 4000 });
          } else if (newStatus === 'declined') {
            toast.error('Водитель отклонил оферту. Вы можете отправить новую.', { duration: 4000 });
          }
        }
        previousStatusRef.current = newStatus;
        setOfferStatus(newStatus);
        const hasActiveOffer = currentOffer.status === 'pending' || currentOffer.status === 'accepted';
        setAlreadyOffered(hasActiveOffer);
      } else {
        previousStatusRef.current = null;
        setOfferStatus(null);
        setAlreadyOffered(false);
      }
    } catch {
      // Ошибка polling — молча, не ломает UX
    }
  };

  useEffect(() => {
    checkAlreadyOffered();
    
    // ✅ Auto-refresh offer status every 5 seconds (polling)
    const pollInterval = setInterval(() => {
      checkAlreadyOffered();
    }, 5000);
    
    // Обновляем при возврате на вкладку
    const handleFocus = () => checkAlreadyOffered();
    // Фикс 2: сохраняем ссылку на handler чтобы корректно удалить listener при unmount
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAlreadyOffered();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, profileUser?.email]);
  const heroTouchStartX = useRef(0);
  const heroTouchStartY = useRef(0);

  // ── Swipe-to-close
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);

  const onTouchStart = (e: React.TouchEvent) => {
    const sheet = sheetRef.current;
    if (!sheet || sheet.scrollTop > 0) return;
    dragStartY.current = e.touches[0].clientY;
    dragStartTime.current = Date.now();
    setIsDragging(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const sheet = sheetRef.current;
    if (sheet && sheet.scrollTop > 0) { setIsDragging(false); return; }
    const delta = e.touches[0].clientY - dragStartY.current;
    if (delta < 0) return;
    setDragY(delta);
  };
  const onTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const elapsed = Math.max(1, Date.now() - dragStartTime.current);
    const velocity = dragY / elapsed;
    if (dragY > 120 || velocity > 0.5) {
      setDragY(400);
      setTimeout(() => { setShowOffer(false); setDragY(0); }, 280);
    } else {
      setDragY(0);
    }
  };

  // Calculate prices
  const totalSeatsPrice = includeSeats ? offerSeats * (trip.pricePerSeat || 0) + offerChildren * childSeatPrice(trip) : 0;
  const totalCargoPrice = includeCargo ? offerCargoKg * (trip.pricePerKg || 0) : 0;
  const totalPrice = totalSeatsPrice + totalCargoPrice;

  const submitOffer = async () => {
    if (!offerName.trim()) return;
    if (!includeSeats && !includeCargo) return;
    if (isSubmitting) return; // ✅ Prevent double-submit
    setIsSubmitting(true);
    
    // Map old fields to new format for submission
    const seatsPart = includeSeats ? `${offerSeats} взр.${offerChildren > 0 ? ` + ${offerChildren} дет.` : ''}` : '';
    const cargoPart = includeCargo ? `${offerCargoKg} кг` : '';
    const cargoType = includeSeats && includeCargo
      ? `Пассажиры + ${offerCargoDesc || 'Груз'}`
      : includeSeats ? 'Пассажирские места'
      : offerCargoDesc || 'Груз';
    const weight = [seatsPart, cargoPart].filter(Boolean).join(' + ') || '';
    const volume = '';
    const price = totalPrice;
    const currency = 'TJS';
    const notes = offerCargoDesc || '';
    
    const totalPriceVal = price;
    
    // Submit offer to server — capacity is NOT reduced here.
    // Capacity is reduced only when the driver ACCEPTS the offer (server-side).
    // profileUser уже доступен из useUser() в начале компонента
    const offerData = {
      tripId: String(id),
      senderEmail: profileUser?.email || 'guest',
      senderName: offerName,
      senderPhone: offerPhone,
      type: includeSeats && includeCargo ? 'both' : includeCargo ? 'cargo' : 'seats',
      cargoType,
      weight,
      volume,
      price: totalPriceVal,
      currency,
      notes,
      // Trip details for consistent display
      from: trip.from,
      to: trip.to,
      date: trip.date,
      vehicleType: trip.vehicle || 'Неизвестно',
      // Driver email so driver can query their incoming offers
      driverEmail: driver.email || trip.driverEmail || '',
      // Capacity details
      requestedSeats: includeSeats ? offerSeats : 0,
      requestedChildren: includeSeats ? offerChildren : 0,
      requestedCargo: includeCargo ? offerCargoKg : 0,
      status: 'pending',
    };

    try {
      // ✅ Save to server first (via API, NOT recursively)
      await submitOfferApi(offerData);
      // ✅ Mark as already offered immediately — no need to wait for next mount
      setAlreadyOffered(true);
      setOfferStatus('pending'); // ✅ Set status to pending immediately
      // ✅ Sync server state to clear any stale localStorage cache
      checkAlreadyOffered();
    } catch {
      toast.error('Ошибка при отправке оферты. Попробуйте снова.');
      setIsSubmitting(false);
      return;
    }

    // Create / open chat with the driver
    const chatId = generatePairChatId(driver.email || `driver_${id}`, profileUser?.email || 'guest');
    
    // Initialize chat room
    await initChatRoom(
      chatId,
      {
        id: driver.email || `driver_${id}`,
        name: driver.name,
        avatar: driver.avatar || '',
        role: 'driver',
        sub: trip.vehicle || 'Водитель',
        rating: driver.rating,
        online: true,
        verified: driver.verified || false,
        email: driver.email,
      },
      String(id),
      `${trip.from} → ${trip.to}`,
      trip, // ✅ Pass full trip object for auto-fill
    );

    // Send proposal message to chat
    const proposalMessage = {
      id: `opt_${Date.now()}`,
      type: 'proposal' as const,
      proposal: {
        id: String(Date.now()),
        cargoType,
        weight,
        volume: volume || '—',
        price: String(totalPriceVal),
        currency: currency as 'TJS' | 'RUB' | 'USD',
        from: trip.from,
        to: trip.to,
        date: trip.date,
        notes: notes || '',
        status: 'pending' as const,
        vehicleType: trip.vehicle || 'Неизвестно',
        // ✅ Attach tripId & senderEmail so server can reliably match the offer on accept
        tripId: String(id),
        senderEmail: profileUser?.email || 'guest',
        // ✅ Attach coordinates for tracking
        fromLat: trip.fromLat,
        fromLng: trip.fromLng,
        toLat: trip.toLat,
        toLng: trip.toLng,
        departureTime: trip.time, // время отправления
      },
      from: 'sender' as const,
      senderId: profileUser?.email || 'guest',
      time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      ts: Date.now(),
      read: false,
    };

    await pushMessage(chatId, proposalMessage);

    setOfferDone(true);
    setTimeout(() => {
      setOfferDone(false); setShowOffer(false); setIsSubmitting(false);
      setIncludeSeats(false); setIncludeCargo(false);
      setOfferSeats(1); setOfferChildren(0); setOfferCargoKg(1); setOfferCargoDesc('');
      setOfferCargoType(''); setOfferWeight(''); setOfferVolume('');
      setOfferPrice(''); setOfferNotes('');
      setOfferName(''); setOfferPhone('');
      navigate(`/chat/${chatId}`);
    }, 2400);
  };

  return (
    <div className="font-['Sora'] bg-[#060e1a] text-white min-h-screen">

    {/* ════════════════ MOBILE (не трогаем) ════════════════ */}
    <div className="md:hidden flex flex-col pb-36 min-h-screen">

      {/* ── HERO ── */}
      <div
        className="relative w-full overflow-hidden"
        style={{ height: 260 }}
        onTouchStart={e => {
          heroTouchStartX.current = e.touches[0].clientX;
          heroTouchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={e => {
          const dx = e.changedTouches[0].clientX - heroTouchStartX.current;
          const dy = Math.abs(e.changedTouches[0].clientY - heroTouchStartY.current);
          if (Math.abs(dx) > 40 && dy < 60) {
            if (dx < 0) setImgIdx(i => Math.min(i + 1, images.length - 1));
            else setImgIdx(i => Math.max(i - 1, 0));
          }
        }}
      >
        <div className="absolute inset-0 bg-cover bg-center scale-105 transition-all duration-700"
          style={{ backgroundImage: `url('${images[imgIdx]}')` }} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/20 to-[#060e1a]" />

        {/* Top controls */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 z-10"
          style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))' }}>
          <button onClick={() => navigate(-1)}
            className="flex size-10 items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white active:scale-90 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const url = `${window.location.origin}/trip/${trip.id}`;
                const text = `${trip.from} → ${trip.to} · ${trip.date} · ${trip.pricePerSeat ? trip.pricePerSeat + ` ${trip.currency || 'TJS'}/место` : trip.pricePerKg + ` ${trip.currency || 'TJS'}/кг`} | Ovora Cargo`;
                if (navigator.share) { try { await navigator.share({ title: 'Поездка Ovora Cargo', text, url }); } catch {} }
                else { await navigator.clipboard.writeText(`${text}\n${url}`); toast.success('Ссылка скопирована!'); }
              }}
              className="flex size-10 items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white active:scale-90 transition-all">
              <Share2 className="w-5 h-5" />
            </button>
            <button
              onClick={() => {
                toggleFav({ id: trip.id, from: trip.from, to: trip.to, date: trip.date, time: trip.time, pricePerSeat: trip.pricePerSeat, pricePerKg: trip.pricePerKg, driverName: trip.driverName, availableSeats: trip.availableSeats, cargoCapacity: trip.cargoCapacity });
                toast(isFavorite(trip.id) ? 'Удалено из избранного' : '❤️ Добавлено в избранное');
              }}
              className="flex size-10 items-center justify-center rounded-full bg-black/30 backdrop-blur-md text-white active:scale-90 transition-all">
              <Heart className={`w-5 h-5 transition-colors ${isFavorite(trip.id) ? 'fill-rose-500 text-rose-500' : ''}`} />
            </button>
          </div>
        </div>

        {/* Status badge */}
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10">
          {isInProgress ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold bg-emerald-500/25 backdrop-blur-md text-emerald-300 border border-emerald-400/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              В пути
            </span>
          ) : trip.status === 'frozen' ? (
            // Fix #2: mobile badge для frozen рейса
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold bg-cyan-500/20 backdrop-blur-md text-cyan-300 border border-cyan-400/30">
              ❄️ Заморожена
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold bg-amber-500/25 backdrop-blur-md text-amber-300 border border-amber-400/30">
              <Clock className="w-3 h-3" /> Запланирована
            </span>
          )}
        </div>

        {/* Route at bottom of hero */}
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 z-10">
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-[#5ba3f5] shrink-0" />
                <p className="text-white/70 text-[12px] font-semibold truncate">{cleanAddress(trip.from)}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                <p className="text-white text-[15px] font-extrabold truncate leading-tight">{cleanAddress(trip.to)}</p>
              </div>
            </div>
            <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/15">
              <p className="text-white/60 text-[9px] font-bold uppercase tracking-wider">расст.</p>
              <p className="text-white font-black text-[13px]">{displayDistance}</p>
            </div>
          </div>
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-16 right-4 flex gap-1 z-10">
            {images.map((_: any, i: number) => (
              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i === imgIdx ? 'w-3 bg-white' : 'w-1 bg-white/40'}`} />
            ))}
          </div>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div className="flex flex-col gap-3 px-4 pt-4">

        {/* Info chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.08]">
            <Calendar className="w-3.5 h-3.5 text-[#5ba3f5]" />
            <span className="text-[12px] font-bold text-white">{trip.date}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.08]">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[12px] font-bold text-white">{trip.time}</span>
          </div>
          {trip.vehicle && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.06] border border-white/[0.08]">
              <Truck className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[12px] font-semibold text-white/80">{trip.vehicle}</span>
            </div>
          )}
        </div>

        {/* Route card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-3">Маршрут</p>
          <div className="flex gap-4">
            <div className="flex flex-col items-center pt-1 shrink-0">
              <div className="w-3 h-3 rounded-full bg-[#5ba3f5] ring-4 ring-[#5ba3f5]/20" />
              <div className="w-px flex-1 min-h-[32px] my-1.5 bg-gradient-to-b from-[#5ba3f5]/40 to-emerald-500/40" />
              <div className="w-3 h-3 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
            </div>
            <div className="flex-1 flex flex-col justify-between gap-3 min-w-0">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-0.5">Откуда · {trip.time}</p>
                <p className="text-[15px] font-extrabold text-white leading-tight">{cleanAddress(trip.from)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-0.5">Куда</p>
                <p className="text-[15px] font-extrabold text-white leading-tight">{cleanAddress(trip.to)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Capacity */}
        {(hasSeats || hasCargo || hasChildren) && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-3">Доступность</p>
            <div className="space-y-2">
              {hasSeats && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#5ba3f5]/10 border border-[#5ba3f5]/20">
                  <div className="w-9 h-9 rounded-xl bg-[#5ba3f5] flex items-center justify-center shrink-0">
                    <Users className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-[#5ba3f5] uppercase tracking-wider">Пассажирские места</p>
                    <p className="text-[15px] font-black text-white">{trip.availableSeats} <span className="text-[12px] font-semibold text-white/50">свободно</span></p>
                  </div>
                  <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-[#5ba3f5] text-white text-right">
                    <p className="text-[10px] font-semibold opacity-80">цена</p>
                    <p className="text-[13px] font-black">{trip.pricePerSeat} {trip.currency || 'TJS'}</p>
                  </div>
                </div>
              )}
              {hasChildren && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 text-base">👶</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Детские места</p>
                    <p className="text-[15px] font-black text-white">{trip.childSeats} <span className="text-[12px] font-semibold text-white/50">мест</span></p>
                  </div>
                  {(trip.pricePerChild ?? 0) > 0 && (
                    <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white text-right">
                      <p className="text-[10px] font-semibold opacity-80">цена</p>
                      <p className="text-[13px] font-black">{trip.pricePerChild} {trip.currency || 'TJS'}</p>
                    </div>
                  )}
                </div>
              )}
              {hasCargo && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
                    <Truck className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Перевозка груза</p>
                    <p className="text-[15px] font-black text-white">{trip.cargoCapacity} <span className="text-[12px] font-semibold text-white/50">кг</span></p>
                  </div>
                  <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-amber-500 text-white text-right">
                    <p className="text-[10px] font-semibold opacity-80">цена</p>
                    <p className="text-[13px] font-black">{trip.pricePerKg} {trip.currency || 'TJS'}/кг</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Driver card */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] overflow-hidden">
          <div className="flex items-center gap-4 p-4">
            <div className="relative shrink-0">
              <div className="h-14 w-14 rounded-2xl bg-cover bg-center ring-2 ring-[#5ba3f5]/25"
                style={{ backgroundImage: `url('${driver.avatar}')` }} />
              {driver.verified && (
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#060e1a]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="text-[15px] font-extrabold text-white">{driver.name}</span>
                {driver.verified && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase bg-emerald-500/15 text-emerald-400">Верифицирован</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {[1,2,3,4,5].map(s => (
                  <Star key={s} className={`w-3 h-3 ${s <= Math.floor(driver.rating) ? 'fill-amber-400 text-amber-400' : 'fill-white/10 text-white/10'}`} />
                ))}
                <span className="text-[12px] font-bold text-white ml-1">{driver.rating}</span>
                <span className="text-[11px] text-[#607080] ml-1">· {driver.trips} поездок</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-white/[0.06]">
            {/* Телефон виден только водителю (его рейс) или отправителю с принятой офертой */}
            {driver.phone && (isDriver || offerStatus === 'accepted') && (
              <a href={`tel:${driver.phone}`}
                className="flex items-center justify-center gap-2 py-3.5 text-[13px] font-bold text-[#607080] hover:text-white hover:bg-white/[0.04] border-r border-white/[0.06] transition-all active:scale-[0.97]">
                <Phone className="w-4 h-4" /> Позвонить
              </a>
            )}
            <button
              onClick={() => {
                const chatId = generatePairChatId(driver.email || `driver_${id}`, profileUser?.email || 'guest');
                initChatRoom(chatId, { id: driver.email || `driver_${id}`, name: driver.name, avatar: driver.avatar || '', role: 'driver', sub: trip.vehicle || 'Водитель', rating: driver.rating, online: true, verified: driver.verified || false, email: driver.email }, String(id), `${trip.from} → ${trip.to}`, trip);
                navigate(`/chat/${chatId}`);
              }}
              className="flex items-center justify-center gap-2 py-3.5 text-[13px] font-bold text-[#5ba3f5] hover:bg-white/[0.04] transition-all active:scale-[0.97]">
              <MessageSquare className="w-4 h-4" /> Написать
            </button>
          </div>
        </div>

        {/* Notes */}
        {trip.notes && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-3.5 h-3.5 text-[#607080]" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Заметки водителя</p>
            </div>
            <p className="text-[13px] leading-relaxed text-white/70">{trip.notes}</p>
          </div>
        )}

        {/* ✅ FIX П-7: Входящие оферты — только для водителя на своём рейсе */}
        {isDriver && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-amber-400" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Входящие заявки</p>
              </div>
              {incomingOffers.filter(o => o.status === 'pending').length > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
                  {incomingOffers.filter(o => o.status === 'pending').length}
                </span>
              )}
            </div>
            {offersLoading ? (
              <div className="space-y-2">
                {[1,2].map(i => <div key={i} className="h-16 rounded-xl bg-white/[0.04] animate-pulse" />)}
              </div>
            ) : incomingOffers.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <Package className="w-8 h-8 text-[#3a5570]" />
                <p className="text-[12px] text-[#475569] text-center">Заявок пока нет</p>
              </div>
            ) : (
              <div className="space-y-2">
                {incomingOffers.map(offer => (
                  <div key={offer.offerId}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3 space-y-2">
                    {/* Sender info */}
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#1978e5]/20 flex items-center justify-center shrink-0">
                        <span className="text-[11px] font-black text-[#5ba3f5]">
                          {(offer.senderName || 'О').slice(0,2).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-white truncate">{offer.senderName || 'Отправитель'}</p>
                        {offer.senderPhone && (
                          <a href={`tel:${offer.senderPhone}`} className="text-[11px] text-[#5ba3f5] font-medium"
                            onClick={e => e.stopPropagation()}>
                            {offer.senderPhone}
                          </a>
                        )}
                      </div>
                      {offer.status === 'accepted' ? (
                        <span className="px-2 py-1 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400">
                          Принята
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-[10px] font-black bg-amber-500/15 text-amber-400">
                          Ожидает
                        </span>
                      )}
                    </div>
                    {/* Offer details */}
                    <div className="flex gap-1.5 flex-wrap">
                      {offer.weight && (
                        <span className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/[0.05] text-[#8a9baa]">
                          {offer.weight}
                        </span>
                      )}
                      {offer.price > 0 && (
                        <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-400">
                          {offer.price} {offer.currency || 'TJS'}
                        </span>
                      )}
                      {offer.cargoType && (
                        <span className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/[0.05] text-[#8a9baa]">
                          {offer.cargoType}
                        </span>
                      )}
                    </div>
                    {/* Actions — только для pending */}
                    {offer.status === 'pending' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => handleAcceptOffer(offer)}
                          disabled={offerActionId === offer.offerId}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[12px] font-bold hover:bg-emerald-500/25 transition-all active:scale-95 disabled:opacity-50">
                          <UserCheck className="w-3.5 h-3.5" />
                          {offerActionId === offer.offerId ? '...' : 'Принять'}
                        </button>
                        <button
                          onClick={() => handleDeclineOffer(offer)}
                          disabled={offerActionId === offer.offerId}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[12px] font-bold hover:bg-rose-500/20 transition-all active:scale-95 disabled:opacity-50">
                          <XCircle className="w-3.5 h-3.5" />
                          {offerActionId === offer.offerId ? '...' : 'Отклонить'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── STICKY BOTTOM CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
          {isDriver ? (
            <div className="flex gap-2.5">
              <button onClick={() => navigate('/tracking')}
                className="flex-1 py-3.5 rounded-2xl bg-[#5ba3f5] font-bold text-white text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-[#5ba3f5]/20">
                <Navigation className="w-4 h-4" /> Управлять поездкой
              </button>
              {/* Фикс 7: конкретный чат с пассажиром/отправителем текущего рейса */}
              <button onClick={() => {
                const driverEmail = driver.email || trip.driverEmail || `driver_${id}`;
                const chatId = generatePairChatId(driverEmail, profileUser?.email || 'guest');
                initChatRoom(chatId, {
                  id: driverEmail, name: driver.name, avatar: driver.avatar || '',
                  role: 'driver', sub: trip.vehicle || 'Водитель',
                  rating: driver.rating, online: true, verified: driver.verified || false, email: driver.email,
                }, String(id), `${trip.from} → ${trip.to}`, trip);
                navigate(`/chat/${chatId}`);
              }} className="w-12 py-3.5 rounded-2xl border border-white/[0.1] bg-white/[0.04] text-white flex items-center justify-center active:scale-[0.98] transition-all">
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          ) : (hasSeats || hasCargo) ? (
            alreadyOffered ? (
              offerStatus === 'pending' ? (
                <div className="flex items-center justify-center gap-2.5 py-3.5 rounded-2xl border bg-amber-500/10 border-amber-500/25 text-amber-400">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                  </span>
                  <span className="font-bold text-sm">Оферта отправлена · Ожидание</span>
                </div>
              ) : offerStatus === 'accepted' ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-center gap-2.5 py-3 rounded-2xl border bg-emerald-500/10 border-emerald-500/25 text-emerald-400">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span className="font-bold text-sm">Оферта принята!</span>
                  </div>
                  <button
                    onClick={async () => {
                      const chatId = generatePairChatId(driver.email || `driver_${id}`, profileUser?.email || 'guest');
                      await initChatRoom(chatId, { id: driver.email || `driver_${id}`, name: driver.name, avatar: driver.avatar || '', role: 'driver', sub: trip.vehicle || 'Водит��ль', rating: driver.rating, online: true, verified: driver.verified || false, email: driver.email }, String(id), `${trip.from} → ${trip.to}`, trip);
                      navigate(`/chat/${chatId}`);
                    }}
                    className="flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm bg-[#5ba3f5] text-white active:scale-[0.98] transition-all">
                    <MessageSquare className="w-4 h-4" /> Перейти в переписку
                  </button>
                </div>
              ) : null
            ) : (
              <div className="flex flex-col gap-2">
                {offerStatus === 'declined' && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs bg-orange-500/5 border-orange-500/20 text-orange-400">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">Предыдущая оферта отклонена. Вы можете отправить новую.</span>
                  </div>
                )}
                <div className="flex items-stretch gap-2 w-full">
                  <div className="flex flex-col justify-center shrink-0 px-3 py-2 rounded-2xl bg-white/[0.05] border border-white/[0.08] min-w-[72px]">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#607080]">от</span>
                    <span className="text-[15px] font-black leading-none text-white whitespace-nowrap">
                      {Math.min(...[trip.pricePerSeat, trip.pricePerKg].filter(Boolean))} {trip.currency || 'TJS'}
                    </span>
                  </div>
                  <button
                    onClick={() => setShowOffer(true)}
                    disabled={showOffer}
                    className="flex-1 min-w-0 py-3.5 rounded-2xl bg-[#5ba3f5] font-extrabold text-white text-[14px] active:scale-[0.98] transition-all disabled:opacity-60 shadow-lg shadow-[#5ba3f5]/20">
                    Отправить оферту
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="py-3.5 rounded-2xl flex items-center justify-center bg-white/[0.04] border border-white/[0.08]">
              <span className="text-sm font-bold text-[#607080]">Мест нет · Груз заполнен</span>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════ OFFER MODAL ══════════════════════════ */}
      {showOffer && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            style={{ opacity: Math.max(0, 1 - dragY / 320), transition: isDragging ? 'none' : 'opacity 0.3s ease' }}
            onClick={() => setShowOffer(false)}
          />
          <div
            ref={sheetRef}
            className={`relative rounded-t-3xl px-5 pt-3 pb-10 shadow-2xl max-h-[90vh] overflow-y-auto ${isDark ? 'bg-[#162030]' : 'bg-white'}`}
            style={{
              transform: `translateY(${dragY}px)`,
              transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.32,0.72,0,1)',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {offerDone ? (
              <div className="flex flex-col items-center justify-center gap-0 py-10 overflow-hidden">
                {/* Пульсирующие кольца */}
                <div className="relative flex items-center justify-center mb-6">
                  <motion.div
                    className="absolute w-28 h-28 rounded-full bg-emerald-500/10"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: [0.7, 1.35, 1.35], opacity: [0, 0.6, 0] }}
                    transition={{ duration: 1.4, ease: 'easeOut', delay: 0.15, repeat: Infinity, repeatDelay: 1.2 }}
                  />
                  <motion.div
                    className="absolute w-20 h-20 rounded-full bg-emerald-500/15"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: [0.8, 1.2, 1.2], opacity: [0, 0.7, 0] }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.05, repeat: Infinity, repeatDelay: 1.4 }}
                  />
                  {/* Основной круг */}
                  <motion.div
                    className={`relative w-[72px] h-[72px] rounded-full flex items-center justify-center ${isDark ? 'bg-emerald-500/20' : 'bg-emerald-50'}`}
                    initial={{ scale: 0, rotate: -20, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 220, delay: 0 }}
                  >
                    {/* SVG галочка рисуется */}
                    <svg viewBox="0 0 44 44" className="w-10 h-10" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <motion.circle
                        cx="22" cy="22" r="19"
                        stroke="#22c55e"
                        strokeWidth="2.2"
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.55, ease: 'easeInOut', delay: 0.1 }}
                      />
                      <motion.path
                        d="M13 22.5l6.5 6.5 11.5-13"
                        stroke="#22c55e"
                        strokeWidth="2.6"
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity: 1 }}
                        transition={{ duration: 0.45, ease: 'easeOut', delay: 0.55 }}
                      />
                    </svg>
                  </motion.div>
                </div>

                {/* Текст */}
                <motion.h3
                  className={`text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-[#0f172a]'}`}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.38, ease: 'easeOut', delay: 0.72 }}
                >
                  Оферта отправлена!
                </motion.h3>

                <motion.p
                  className={`text-sm text-center mt-2 px-6 leading-relaxed ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: 'easeOut', delay: 0.9 }}
                >
                  Водитель получит уведомление и свяжется с вами.
                </motion.p>

                {/* Зелёная полоска прогресса */}
                <motion.div
                  className="mt-6 h-[3px] w-24 rounded-full bg-emerald-500/30 overflow-hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.05 }}
                >
                  <motion.div
                    className="h-full bg-emerald-500 rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 2.5, ease: 'linear', delay: 1.1 }}
                  />
                </motion.div>
              </div>
            ) : (
              <>
                <div className="mb-5">
                  <h3 className={`text-lg font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>Отправить оферту</h3>
                </div>

                {/* ── Seats block ── */}
                {hasSeats && (
                  <div className={`mb-3 rounded-2xl border overflow-hidden transition-all ${includeSeats
                    ? isDark ? 'border-[#1978e5]/40 bg-[#1978e5]/5' : 'border-[#bfdbfe] bg-[#eff6ff]'
                    : isDark ? 'border-[#1e2d3a] bg-[#060e1a]/50 opacity-60' : 'border-[#e2e8f0] bg-[#f8fafc] opacity-70'}`}>
                    <button onClick={() => setIncludeSeats(!includeSeats)} className="w-full flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${includeSeats ? 'bg-[#1978e5]' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#e2e8f0]'}`}>
                        <Users className={`w-4 h-4 ${includeSeats ? 'text-white' : isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className={`text-sm font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>Пассажирские места</p>
                        <p className={`text-[10px] font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>{trip.pricePerSeat} {trip.currency || 'TJS'}/место · доступно {trip.availableSeats}</p>
                      </div>
                      <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${includeSeats ? 'bg-[#1978e5]' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#cbd5e1]'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${includeSeats ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </button>
                    {includeSeats && (
                      <div className="px-4 pb-4">
                        <div className={`flex items-center gap-2 p-3 rounded-xl border ${isDark ? 'bg-[#060e1a] border-[#1e2d3a]' : 'bg-white border-[#dbeafe]'}`}>
                          <button onClick={() => setOfferSeats(Math.max(1, offerSeats - 1))} className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-[#1e2d3a] text-white' : 'bg-[#f1f5f9] text-[#0f172a] border border-[#e2e8f0]'}`}><Minus className="w-4 h-4" /></button>
                          <div className="flex-1 flex flex-col items-center">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={offerSeats}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^0-9]/g, '');
                                if (raw === '' || raw === '0') { setOfferSeats('' as any); return; }
                                const v = parseInt(raw);
                                if (!isNaN(v)) setOfferSeats(v);
                              }}
                              onBlur={() => {
                                const v = parseInt(String(offerSeats)) || 1;
                                setOfferSeats(Math.min(trip.availableSeats, Math.max(1, v)));
                              }}
                              className={`w-full text-center text-3xl font-black bg-transparent border-b-2 outline-none focus:border-[#1978e5] transition-colors ${isDark ? 'text-white border-[#1e2d3a] focus:border-[#1978e5]' : 'text-[#0f172a] border-[#e2e8f0] focus:border-[#1978e5]'}`}
                            />
                            <p className={`text-[10px] mt-1 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>мест</p>
                          </div>
                          <button onClick={() => setOfferSeats(Math.min(trip.availableSeats, offerSeats + 1))} className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-[#1978e5]/20 text-[#1978e5]' : 'bg-[#dbeafe] text-[#1978e5]'}`}><Plus className="w-4 h-4" /></button>
                        </div>
                        <div className={`mt-2 px-3 py-2 rounded-xl space-y-1 ${isDark ? 'bg-[#1978e5]/10' : 'bg-[#dbeafe]/60'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-[#1978e5]">
                              {offerSeats} взр. × {trip.pricePerSeat} {trip.currency || 'TJS'}
                            </span>
                            <span className="text-xs font-bold text-[#1978e5]">
                              {offerSeats * (trip.pricePerSeat || 0)} {trip.currency || 'TJS'}
                            </span>
                          </div>
                          {offerChildren > 0 && (
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-[#1978e5]">
                                {offerChildren} дет. × {childSeatPrice(trip)} {trip.currency || 'TJS'}
                              </span>
                              <span className="text-xs font-bold text-[#1978e5]">
                                {offerChildren * childSeatPrice(trip)} {trip.currency || 'TJS'}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center justify-between border-t border-[#1978e5]/20 pt-1">
                            <span className="text-xs font-bold text-[#1978e5]">Итого</span>
                            <span className="text-sm font-black text-[#1978e5]">{totalSeatsPrice} {trip.currency || 'TJS'}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Children counter — always visible when trip has seats ── */}
                {hasSeats && (
                  <div className={`mb-3 rounded-2xl border overflow-hidden ${isDark ? 'border-[#1e2d3a] bg-[#060e1a]/50' : 'border-[#e2e8f0] bg-[#f8fafc]'}`}>
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-[#1e2d3a]' : 'bg-[#e0edff]'}`}>
                        <span className="text-base">👶</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>Дети <span className={`font-normal text-[10px] ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>(до 12 лет · ½ цены)</span></p>
                        <p className={`text-[10px] font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>{childSeatPrice(trip)} {trip.currency || 'TJS'}/место</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setOfferChildren(Math.max(0, (Number(offerChildren) || 0) - 1))}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${isDark ? 'bg-[#1e2d3a] text-white hover:bg-[#253840]' : 'bg-[#e2e8f0] text-[#0f172a] hover:bg-[#cbd5e1]'}`}
                        ><Minus className="w-4 h-4" /></button>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={offerChildren}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '');
                            if (raw === '') { setOfferChildren('' as any); return; }
                            setOfferChildren(parseInt(raw, 10));
                          }}
                          onBlur={() => {
                            const v = parseInt(String(offerChildren), 10);
                            setOfferChildren(isNaN(v) ? 0 : Math.max(0, v));
                          }}
                          onFocus={(e) => e.target.select()}
                          className={`w-10 text-center text-sm font-black bg-transparent border-b-2 outline-none focus:border-[#1978e5] transition-colors ${isDark ? 'text-white border-[#1e2d3a] focus:border-[#1978e5]' : 'text-[#0f172a] border-[#e2e8f0] focus:border-[#1978e5]'}`}
                        />
                        <button
                          onClick={() => setOfferChildren((Number(offerChildren) || 0) + 1)}
                          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${isDark ? 'bg-[#1978e5]/20 text-[#1978e5] hover:bg-[#1978e5]/30' : 'bg-[#dbeafe] text-[#1978e5] hover:bg-[#bfdbfe]'}`}
                        ><Plus className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Cargo block ── */}
                {hasCargo && (
                  <div className={`mb-4 rounded-2xl border overflow-hidden transition-all ${includeCargo
                    ? isDark ? 'border-amber-500/40 bg-amber-500/5' : 'border-amber-200 bg-amber-50'
                    : isDark ? 'border-[#1e2d3a] bg-[#060e1a]/50 opacity-60' : 'border-[#e2e8f0] bg-[#f8fafc] opacity-70'}`}>
                    <button onClick={() => setIncludeCargo(!includeCargo)} className="w-full flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${includeCargo ? 'bg-amber-500' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#e2e8f0]'}`}>
                        <Truck className={`w-4 h-4 ${includeCargo ? 'text-white' : isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`} />
                      </div>
                      <div className="flex-1 text-left">
                        <p className={`text-sm font-extrabold ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>Перевозка груза</p>
                        <p className={`text-[10px] font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>{trip.pricePerKg} {trip.currency || 'TJS'}/кг · доступно {trip.cargoCapacity} кг</p>
                      </div>
                      <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${includeCargo ? 'bg-amber-500' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#cbd5e1]'}`}>
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${includeCargo ? 'translate-x-5' : 'translate-x-0.5'}`} />
                      </div>
                    </button>
                    {includeCargo && (
                      <div className="px-4 pb-4 space-y-2">
                        <div className={`flex items-center gap-2 p-3 rounded-xl border ${isDark ? 'bg-[#060e1a] border-[#1e2d3a]' : 'bg-white border-[#fde68a]'}`}>
                          <button onClick={() => setOfferCargoKg(Math.max(1, offerCargoKg - 5))} className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-[#1e2d3a] text-white' : 'bg-[#f1f5f9] text-[#0f172a] border border-[#e2e8f0]'}`}><Minus className="w-4 h-4" /></button>
                          <div className="flex-1 flex flex-col items-center">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={1}
                              max={trip.cargoCapacity}
                              value={offerCargoKg}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^0-9]/g, '');
                                if (raw === '' || raw === '0') { setOfferCargoKg('' as any); return; }
                                const v = parseInt(raw);
                                if (!isNaN(v)) setOfferCargoKg(v);
                              }}
                              onBlur={() => {
                                const v = parseInt(String(offerCargoKg)) || 1;
                                setOfferCargoKg(Math.min(trip.cargoCapacity, Math.max(1, v)));
                              }}
                              className={`w-full text-center text-3xl font-black bg-transparent border-b-2 outline-none focus:border-amber-500 transition-colors ${isDark ? 'text-amber-300 border-[#1e2d3a] focus:border-amber-500' : 'text-amber-700 border-[#e2e8f0] focus:border-amber-500'}`}
                            />
                            <p className={`text-[10px] mt-1 ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>кг</p>
                          </div>
                          <button onClick={() => setOfferCargoKg(Math.min(trip.cargoCapacity, offerCargoKg + 5))} className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}><Plus className="w-4 h-4" /></button>
                        </div>
                        <div className={`px-3 py-2 rounded-xl flex items-center justify-between ${isDark ? 'bg-amber-500/10' : 'bg-amber-100/60'}`}>
                          <span className={`text-xs font-semibold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{offerCargoKg} кг × {trip.pricePerKg} {trip.currency || 'TJS'}</span>
                          <span className={`text-sm font-black ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>{totalCargoPrice} {trip.currency || 'TJS'}</span>
                        </div>
                        <input
                          className={`w-full px-3 py-2.5 rounded-xl text-sm font-semibold border outline-none focus:ring-2 focus:ring-amber-400/30 transition ${isDark ? 'bg-[#060e1a] border-[#1e2d3a] text-white placeholder:text-[#475569]' : 'bg-white border-[#e2e8f0] text-[#0f172a] placeholder:text-[#94a3b8]'}`}
                          placeholder="Описание груза (продукты, одежда...)"
                          value={offerCargoDesc}
                          onChange={(e) => setOfferCargoDesc(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Combined total row */}
                {includeSeats && includeCargo && (
                  <div className={`mb-4 p-3 rounded-2xl flex items-center justify-between border ${isDark ? 'bg-[#1e2d3a] border-[#253840]' : 'bg-[#f1f5f9] border-[#e2e8f0]'}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <div className="w-5 h-5 rounded-md bg-[#1978e5] flex items-center justify-center"><Users className="w-2.5 h-2.5 text-white" /></div>
                        <div className="w-5 h-5 rounded-md bg-amber-500 flex items-center justify-center"><Truck className="w-2.5 h-2.5 text-white" /></div>
                      </div>
                      <span className={`text-xs font-bold ${isDark ? 'text-[#94a3b8]' : 'text-[#475569]'}`}>Итого (места + груз)</span>
                    </div>
                    <span className={`text-base font-black ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>{totalPrice} {trip.currency || 'TJS'}</span>
                  </div>
                )}

                {/* Sender info */}
                <div className="space-y-3 mb-5">
                  <p className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>Ваши данные</p>

                  {/* Profile preview card */}
                  {profileUser && (
                    <div className={`flex items-center gap-3 p-3 rounded-2xl border ${isDark ? 'bg-[#060e1a] border-[#1e2d3a]' : 'bg-[#f8fafc] border-[#e2e8f0]'}`}>
                      {profileUser.avatarUrl ? (
                        <div className="w-10 h-10 rounded-xl bg-cover bg-center shrink-0" style={{ backgroundImage: `url('${profileUser.avatarUrl}')` }} />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-[#1978e5] flex items-center justify-center shrink-0">
                          <span className="text-white text-sm font-black">
                            {`${profileUser.firstName?.[0] || ''}${profileUser.lastName?.[0] || ''}`.toUpperCase() || 'ВЫ'}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-extrabold truncate ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>
                          {`${profileUser.firstName || ''} ${profileUser.lastName || ''}`.trim() || 'Пользователь'}
                        </p>
                        <p className={`text-[11px] font-semibold ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>{profileUser.phone || profileUser.email || ''}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg bg-emerald-500/15">
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                        <span className="text-[10px] font-black text-emerald-500">Из профиля</span>
                      </div>
                    </div>
                  )}

                  <input
                    className={`w-full px-4 py-3 rounded-xl text-sm font-semibold border outline-none focus:ring-2 focus:ring-[#1978e5]/40 transition ${isDark ? 'bg-[#060e1a] border-[#1e2d3a] text-white placeholder:text-[#475569]' : 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a] placeholder:text-[#94a3b8]'}`}
                    placeholder="Ваше имя *"
                    value={offerName}
                    onChange={(e) => setOfferName(e.target.value)}
                  />
                  <input
                    className={`w-full px-4 py-3 rounded-xl text-sm font-semibold border outline-none focus:ring-2 focus:ring-[#1978e5]/40 transition ${isDark ? 'bg-[#060e1a] border-[#1e2d3a] text-white placeholder:text-[#475569]' : 'bg-[#f8fafc] border-[#e2e8f0] text-[#0f172a] placeholder:text-[#94a3b8]'}`}
                    placeholder="Телефон"
                    type="tel"
                    value={offerPhone}
                    onChange={(e) => setOfferPhone(e.target.value)}
                  />
                </div>

                <div className="sticky bottom-0 pt-3 pb-1 -mx-5 px-5">
                  <button
                    onClick={submitOffer}
                    disabled={!offerName.trim() || (!includeSeats && !includeCargo) || isSubmitting}
                    className={`w-full py-3.5 rounded-2xl font-extrabold text-white text-sm transition-all active:scale-[0.98] shadow-lg flex items-center justify-center gap-2 ${
                      offerName.trim() && (includeSeats || includeCargo) && !isSubmitting
                        ? includeSeats && includeCargo
                          ? 'bg-gradient-to-r from-[#1978e5] via-[#7c3aed] to-amber-500 shadow-purple-500/20'
                          : includeSeats
                            ? 'bg-gradient-to-r from-[#1978e5] to-[#1565c0] shadow-[#1978e5]/30'
                            : 'bg-gradient-to-r from-amber-500 to-amber-600 shadow-amber-500/30'
                        : 'bg-[#334155] opacity-50 cursor-not-allowed'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin shrink-0" />
                        Отправляем...
                      </>
                    ) : (
                      `Подтвердить · ${totalPrice} ${trip.currency || 'TJS'}`
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>{/* end mobile */}

      {/* ════════════════ DESKTOP ════════════════ */}
      <div className="hidden md:block min-h-screen" style={{ background: '#080f1a' }}>
        <style>{`
          @keyframes td-up  { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
          @keyframes td-in  { from{opacity:0} to{opacity:1} }
          .td-s1{animation:td-up .4s cubic-bezier(.22,1,.36,1) .05s both}
          .td-s2{animation:td-up .4s cubic-bezier(.22,1,.36,1) .12s both}
          .td-s3{animation:td-up .4s cubic-bezier(.22,1,.36,1) .19s both}
          .td-s4{animation:td-up .4s cubic-bezier(.22,1,.36,1) .26s both}
          .td-s5{animation:td-up .4s cubic-bezier(.22,1,.36,1) .33s both}
          .td-action-btn {
            display:flex; align-items:center; justify-content:center; gap:8px;
            padding:13px; border-radius:16px; font-size:14px; font-weight:800;
            cursor:pointer; border:none; font-family:inherit;
            transition:transform .2s ease, box-shadow .2s ease;
          }
          .td-action-btn:hover:not(:disabled) { transform:translateY(-2px); }
          .td-action-btn:disabled { opacity:.45; cursor:not-allowed; }
          .td-chip {
            display:inline-flex; align-items:center; gap:6px;
            padding:6px 12px; border-radius:100px; font-size:11px; font-weight:700;
            border:1px solid; white-space:nowrap;
          }
          .td-inp {
            width:100%; padding:11px 14px; border-radius:13px; font-size:14px; font-weight:500;
            outline:none; font-family:inherit; color:#e2e8f0;
            background:#0a1520; border:1px solid #1e2d3d;
            transition:border-color .2s; box-sizing:border-box;
          }
          .td-inp:focus{border-color:#5ba3f550;}
          .td-inp::placeholder{color:#3a5570;}
          .td-toggle {
            display:flex; align-items:center; gap:12px; padding:14px 16px;
            border-radius:16px; cursor:pointer; border:none; font-family:inherit;
            text-align:left; width:100%; background:transparent;
          }
          .td-counter-btn {
            width:36px; height:36px; border-radius:11px; border:none; cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            font-family:inherit; transition:background .15s, transform .12s;
          }
          .td-counter-btn:hover { transform:scale(1.08); }
        `}</style>

        {/* ── TOP BAR ── */}
        <div style={{ background:'#0a1220', borderBottom:'1px solid #ffffff08', animation:'td-in .3s ease both' }}>
          <div className="max-w-7xl mx-auto px-10 py-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate(-1)}
                className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95"
                style={{ background:'#ffffff0a', border:'1px solid #ffffff0f', color:'#8a9bb0' }}>
                <ArrowLeft style={{ width:18, height:18 }} />
              </button>
              <div>
                <p style={{ fontSize:10, fontWeight:800, letterSpacing:'.18em', textTransform:'uppercase', color:'#3a5570' }}>Детали рейса</p>
                <h1 style={{ fontSize:20, fontWeight:900, color:'#fff', lineHeight:1.2 }}>
                  {cleanAddress(trip.from)} → {cleanAddress(trip.to)}
                </h1>
              </div>
              {isInProgress ? (
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#10b98118', border:'1px solid #10b98135', fontSize:12, fontWeight:800, color:'#10b981' }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:'#10b981', boxShadow:'0 0 8px #10b981', display:'inline-block' }} />
                  В пути
                </span>
              ) : trip.status === 'frozen' ? (
                // Fix #2: desktop badge для frozen рейса
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#06b6d418', border:'1px solid #06b6d435', fontSize:12, fontWeight:800, color:'#22d3ee' }}>
                  <span style={{ fontSize:13 }}>❄️</span> Заморожена
                </span>
              ) : (
                <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#f59e0b18', border:'1px solid #f59e0b35', fontSize:12, fontWeight:800, color:'#f59e0b' }}>
                  <Clock style={{ width:12, height:12 }} /> Запланирована
                </span>
              )}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/trip/${trip.id}`;
                  const text = `${trip.from} → ${trip.to} · ${trip.date}`;
                  if (navigator.share) { try { await navigator.share({ title:'Ovora Cargo', text, url }); } catch {} }
                  else { await navigator.clipboard.writeText(`${text}\n${url}`); toast.success('Ссылка скопирована!'); }
                }}
                className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background:'#ffffff0a', border:'1px solid #ffffff0f', color:'#8a9bb0' }}>
                <Share2 style={{ width:16, height:16 }} />
              </button>
              <button
                onClick={() => {
                  toggleFav({ id:trip.id, from:trip.from, to:trip.to, date:trip.date, time:trip.time, pricePerSeat:trip.pricePerSeat, pricePerKg:trip.pricePerKg, driverName:trip.driverName, availableSeats:trip.availableSeats, cargoCapacity:trip.cargoCapacity });
                  toast(isFavorite(trip.id) ? 'Удалено из избранного' : '❤️ Добавлено в избранное');
                }}
                className="w-10 h-10 rounded-2xl flex items-center justify-center transition-all hover:scale-105"
                style={{ background: isFavorite(trip.id) ? '#f43f5e18' : '#ffffff0a', border: isFavorite(trip.id) ? '1px solid #f43f5e35' : '1px solid #ffffff0f', color: isFavorite(trip.id) ? '#f43f5e' : '#8a9bb0' }}>
                <Heart style={{ width:16, height:16, fill: isFavorite(trip.id) ? '#f43f5e' : 'none' }} />
              </button>
            </div>
          </div>
        </div>

        {/* ── BODY ── */}
        <div className="max-w-7xl mx-auto px-10 py-8 flex gap-8 items-start">

          {/* ── LEFT: Main content ── */}
          <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:20 }}>

            {/* Hero image */}
            <div className="td-s1 rounded-3xl overflow-hidden relative" style={{ height:280 }}>
              <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage:`url('${images[imgIdx]}')` }} />
              <div className="absolute inset-0" style={{ background:'linear-gradient(to bottom,#00000055 0%,#00000015 50%,#080f1a 100%)' }} />
              {images.length > 1 && (
                <div style={{ position:'absolute', bottom:16, right:16, display:'flex', gap:6 }}>
                  {images.map((_: any, i: number) => (
                    <button key={i} onClick={() => setImgIdx(i)}
                      style={{ width: i === imgIdx ? 20 : 6, height:6, borderRadius:3, background: i === imgIdx ? '#fff' : '#ffffff50', border:'none', cursor:'pointer', transition:'width .3s' }} />
                  ))}
                </div>
              )}
              <div style={{ position:'absolute', top:16, right:16, padding:'8px 14px', borderRadius:14, backdropFilter:'blur(12px)', background:'#ffffff15', border:'1px solid #ffffff20' }}>
                <p style={{ fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'.14em', color:'#ffffffa0', marginBottom:2 }}>Расстояние</p>
                <p style={{ fontSize:16, fontWeight:900, color:'#fff' }}>{displayDistance}</p>
              </div>
            </div>

            {/* Chips */}
            <div className="td-s1" style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              <span className="td-chip" style={{ background:'#5ba3f512', borderColor:'#5ba3f530', color:'#5ba3f5' }}><Calendar style={{ width:12, height:12 }} /> {trip.date}</span>
              <span className="td-chip" style={{ background:'#10b98112', borderColor:'#10b98130', color:'#10b981' }}><Clock style={{ width:12, height:12 }} /> {trip.time}</span>
              {trip.vehicle && <span className="td-chip" style={{ background:'#f59e0b12', borderColor:'#f59e0b30', color:'#f59e0b' }}><Truck style={{ width:12, height:12 }} /> {trip.vehicle}</span>}
              <span className="td-chip" style={{ background:'#8b5cf612', borderColor:'#8b5cf630', color:'#8b5cf6' }}><Route style={{ width:12, height:12 }} /> {displayDistance}</span>
            </div>

            {/* Route card */}
            <div className="td-s2 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(145deg,#0e1e32,#0a1520)', border:'1px solid #1a2d42', boxShadow:'0 16px 40px #00000050' }}>
              <div style={{ height:3, background:'linear-gradient(90deg,#5ba3f5,#10b981)' }} />
              <div style={{ padding:24 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
                  <div style={{ width:28, height:28, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', background:'#5ba3f518', border:'1px solid #5ba3f530' }}>
                    <Route style={{ width:13, height:13, color:'#5ba3f5' }} />
                  </div>
                  <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#3a5570' }}>Маршрут</span>
                </div>
                <div style={{ display:'flex', gap:18 }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, paddingTop:4, flexShrink:0 }}>
                    <div style={{ width:12, height:12, borderRadius:'50%', background:'#5ba3f5', boxShadow:'0 0 10px #5ba3f5' }} />
                    <div style={{ width:2, flex:1, minHeight:32, background:'linear-gradient(180deg,#5ba3f5,#10b981)', borderRadius:1 }} />
                    <div style={{ width:12, height:12, borderRadius:'50%', background:'#10b981', boxShadow:'0 0 10px #10b981' }} />
                  </div>
                  <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between', gap:16 }}>
                    <div>
                      <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.14em', color:'#5ba3f5', marginBottom:4, opacity:.8 }}>Откуда · {trip.time}</p>
                      <p style={{ fontSize:18, fontWeight:900, color:'#fff', lineHeight:1.2 }}>{cleanAddress(trip.from)}</p>
                    </div>
                    <div>
                      <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.14em', color:'#10b981', marginBottom:4, opacity:.8 }}>Куда · Назначение</p>
                      <p style={{ fontSize:18, fontWeight:900, color:'#fff', lineHeight:1.2 }}>{cleanAddress(trip.to)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Capacity */}
            {(hasSeats || hasCargo || hasChildren) && (
              <div className="td-s3 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(145deg,#0e1e32,#0a1520)', border:'1px solid #1a2d42' }}>
                <div style={{ padding:'18px 22px', borderBottom:'1px solid #1a2d3d', display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:28, height:28, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', background:'#5ba3f518', border:'1px solid #5ba3f530' }}>
                    <Users style={{ width:13, height:13, color:'#5ba3f5' }} />
                  </div>
                  <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#3a5570' }}>Доступность</span>
                </div>
                <div style={{ padding:'16px 22px', display:'flex', flexDirection:'column', gap:12 }}>
                  {hasSeats && (
                    <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:16, background:'#5ba3f510', border:'1px solid #5ba3f525' }}>
                      <div style={{ width:42, height:42, borderRadius:14, background:'#5ba3f5', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 6px 16px #5ba3f540' }}><Users style={{ width:18, height:18, color:'#fff' }} /></div>
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.12em', color:'#5ba3f5', opacity:.8 }}>Пассажирские места</p>
                        <p style={{ fontSize:22, fontWeight:900, color:'#fff' }}>{trip.availableSeats} <span style={{ fontSize:13, fontWeight:500, color:'#4a6580' }}>свободно</span></p>
                      </div>
                      <div style={{ textAlign:'right', padding:'8px 14px', borderRadius:12, background:'#5ba3f5', flexShrink:0 }}>
                        <p style={{ fontSize:9, fontWeight:700, color:'#ffffffaa' }}>цена</p>
                        <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{trip.pricePerSeat} {trip.currency || 'TJS'}</p>
                      </div>
                    </div>
                  )}
                  {hasChildren && (
                    <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:16, background:'#10b98110', border:'1px solid #10b98125' }}>
                      <div style={{ width:42, height:42, borderRadius:14, background:'#10b981', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:18, boxShadow:'0 6px 16px #10b98140' }}>👶</div>
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.12em', color:'#10b981', opacity:.8 }}>Детские места</p>
                        <p style={{ fontSize:22, fontWeight:900, color:'#fff' }}>{trip.childSeats} <span style={{ fontSize:13, fontWeight:500, color:'#4a6580' }}>мест</span></p>
                      </div>
                      {(trip.pricePerChild ?? 0) > 0 && (
                        <div style={{ textAlign:'right', padding:'8px 14px', borderRadius:12, background:'#10b981', flexShrink:0 }}>
                          <p style={{ fontSize:9, fontWeight:700, color:'#ffffffaa' }}>цена</p>
                          <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{trip.pricePerChild} {trip.currency || 'TJS'}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {hasCargo && (
                    <div style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:16, background:'#f59e0b10', border:'1px solid #f59e0b25' }}>
                      <div style={{ width:42, height:42, borderRadius:14, background:'#f59e0b', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, boxShadow:'0 6px 16px #f59e0b40' }}><Truck style={{ width:18, height:18, color:'#fff' }} /></div>
                      <div style={{ flex:1 }}>
                        <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.12em', color:'#f59e0b', opacity:.8 }}>Перевозка груза</p>
                        <p style={{ fontSize:22, fontWeight:900, color:'#fff' }}>{trip.cargoCapacity} <span style={{ fontSize:13, fontWeight:500, color:'#4a6580' }}>кг</span></p>
                      </div>
                      <div style={{ textAlign:'right', padding:'8px 14px', borderRadius:12, background:'#f59e0b', flexShrink:0 }}>
                        <p style={{ fontSize:9, fontWeight:700, color:'#ffffffaa' }}>цена</p>
                        <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{trip.pricePerKg} {trip.currency || 'TJS'}/кг</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Driver */}
            <div className="td-s4 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(145deg,#0e1e32,#0a1520)', border:'1px solid #1a2d42' }}>
              <div style={{ padding:'18px 22px', borderBottom:'1px solid #1a2d3d', display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:28, height:28, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', background:'#a855f718', border:'1px solid #a855f730' }}>
                  <Shield style={{ width:13, height:13, color:'#a855f7' }} />
                </div>
                <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#3a5570' }}>Водитель</span>
              </div>
              <div style={{ padding:'20px 22px', display:'flex', alignItems:'center', gap:16 }}>
                <div style={{ position:'relative', flexShrink:0 }}>
                  <div style={{ width:72, height:72, borderRadius:22, backgroundImage:`url('${driver.avatar}')`, backgroundSize:'cover', backgroundPosition:'center', border:'2px solid #5ba3f530', boxShadow:'0 8px 24px #00000050' }} />
                  {driver.verified && (
                    <div style={{ position:'absolute', bottom:-4, right:-4, width:22, height:22, borderRadius:8, background:'#10b981', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #0a1520', boxShadow:'0 4px 10px #10b98150' }}>
                      <CheckCircle2 style={{ width:12, height:12, color:'#fff' }} />
                    </div>
                  )}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                    <p style={{ fontSize:18, fontWeight:900, color:'#fff' }}>{driver.name}</p>
                    {driver.verified && <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:6, background:'#10b98118', color:'#10b981', textTransform:'uppercase', letterSpacing:'.1em' }}>Верифицирован</span>}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    {[1,2,3,4,5].map(s => <Star key={s} style={{ width:14, height:14, color: s <= Math.floor(driver.rating) ? '#f59e0b' : '#2a4060', fill: s <= Math.floor(driver.rating) ? '#f59e0b' : '#2a4060' }} />)}
                    <span style={{ fontSize:14, fontWeight:800, color:'#fff', marginLeft:4 }}>{driver.rating}</span>
                    <span style={{ fontSize:12, color:'#4a6580' }}>· {driver.trips} поездок</span>
                  </div>
                </div>
                <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                  {driver.phone && (
                    <a href={`tel:${driver.phone}`} style={{ width:44, height:44, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', background:'#10b98118', border:'1px solid #10b98130', color:'#10b981', textDecoration:'none', transition:'transform .15s' }} className="hover:scale-110">
                      <Phone style={{ width:18, height:18 }} />
                    </a>
                  )}
                  <button onClick={() => { const chatId = generatePairChatId(driver.email||`driver_${id}`, profileUser?.email||'guest'); initChatRoom(chatId, { id:driver.email||`driver_${id}`, name:driver.name, avatar:driver.avatar||'', role:'driver', sub:trip.vehicle||'Водитель', rating:driver.rating, online:true, verified:driver.verified||false, email:driver.email }, String(id), `${trip.from} → ${trip.to}`, trip); navigate(`/chat/${chatId}`); }}
                    style={{ width:44, height:44, borderRadius:14, display:'flex', alignItems:'center', justifyContent:'center', background:'#5ba3f518', border:'1px solid #5ba3f530', color:'#5ba3f5', cursor:'pointer', transition:'transform .15s' }} className="hover:scale-110">
                    <MessageSquare style={{ width:18, height:18 }} />
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            {trip.notes && (
              <div className="td-s5 rounded-2xl" style={{ background:'linear-gradient(145deg,#0e1e32,#0a1520)', border:'1px solid #1a2d42', padding:'18px 22px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
                  <FileText style={{ width:14, height:14, color:'#4a6580' }} />
                  <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#3a5570' }}>Заметки водителя</span>
                </div>
                <p style={{ fontSize:14, color:'#7a9ab5', lineHeight:1.75 }}>{trip.notes}</p>
              </div>
            )}
          </div>

          {/* ── RIGHT: Sticky offer panel ── */}
          <div style={{ width:340, flexShrink:0 }} className="sticky top-8 flex flex-col gap-5">

            {/* Price summary */}
            <div className="td-s1 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(160deg,#0f1f38,#0c1624)', border:'1px solid #1a2d45', boxShadow:'0 24px 48px #00000060' }}>
              <div style={{ height:3, background:'linear-gradient(90deg,#5ba3f5,#a855f7,#10b981)' }} />
              <div style={{ padding:22 }}>
                <p style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#3a5570', marginBottom:12 }}>Стоимость</p>
                <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
                  {hasSeats && (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:14, background:'#5ba3f510', border:'1px solid #5ba3f525' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}><Users style={{ width:14, height:14, color:'#5ba3f5' }} /><span style={{ fontSize:13, fontWeight:600, color:'#7a9ab5' }}>За место</span></div>
                      <span style={{ fontSize:16, fontWeight:900, color:'#5ba3f5' }}>{trip.pricePerSeat} <span style={{ fontSize:11, fontWeight:500 }}>{trip.currency || 'TJS'}</span></span>
                    </div>
                  )}
                  {hasCargo && (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:14, background:'#f59e0b10', border:'1px solid #f59e0b25' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}><Truck style={{ width:14, height:14, color:'#f59e0b' }} /><span style={{ fontSize:13, fontWeight:600, color:'#7a9ab5' }}>За кг</span></div>
                      <span style={{ fontSize:16, fontWeight:900, color:'#f59e0b' }}>{trip.pricePerKg} <span style={{ fontSize:11, fontWeight:500 }}>{trip.currency || 'TJS'}/кг</span></span>
                    </div>
                  )}
                </div>

                {isDriver ? (
                  <button onClick={() => navigate('/tracking')} className="td-action-btn" style={{ width:'100%', background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', color:'#fff', boxShadow:'0 8px 24px #1d4ed840' }}>
                    <Navigation style={{ width:16, height:16 }} /> Управлять поездкой
                  </button>
                ) : (hasSeats || hasCargo) ? (
                  alreadyOffered ? (
                    offerStatus === 'pending' ? (
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'14px', borderRadius:16, background:'#f59e0b10', border:'1px solid #f59e0b30', color:'#f59e0b' }}>
                        <span style={{ width:8, height:8, borderRadius:'50%', background:'#f59e0b', display:'inline-block' }} />
                        <span style={{ fontSize:13, fontWeight:800 }}>Оферта отправлена · Ожидание</span>
                      </div>
                    ) : offerStatus === 'accepted' ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'12px', borderRadius:14, background:'#10b98110', border:'1px solid #10b98130', color:'#10b981' }}>
                          <CheckCircle2 style={{ width:18, height:18 }} /><span style={{ fontSize:13, fontWeight:800 }}>Оферта принята!</span>
                        </div>
                        <button onClick={async () => { const chatId = generatePairChatId(driver.email||`driver_${id}`, profileUser?.email||'guest'); await initChatRoom(chatId, { id:driver.email||`driver_${id}`, name:driver.name, avatar:driver.avatar||'', role:'driver', sub:trip.vehicle||'Водитель', rating:driver.rating, online:true, verified:driver.verified||false, email:driver.email }, String(id), `${trip.from} → ${trip.to}`, trip); navigate(`/chat/${chatId}`); }}
                          className="td-action-btn" style={{ width:'100%', background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', color:'#fff', boxShadow:'0 8px 24px #1d4ed840' }}>
                          <MessageSquare style={{ width:16, height:16 }} /> Перейти в переписку
                        </button>
                      </div>
                    ) : null
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {offerStatus === 'declined' && (
                        <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:13, background:'#f9731610', border:'1px solid #f9731630', color:'#f97316' }}>
                          <AlertCircle style={{ width:14, height:14, flexShrink:0 }} /><span style={{ fontSize:12, fontWeight:600 }}>Предыдущая оферта отклонена. Можете отправить новую.</span>
                        </div>
                      )}
                      <button onClick={() => setShowOffer(true)} disabled={showOffer} className="td-action-btn"
                        style={{ width:'100%', background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', color:'#fff', boxShadow:'0 8px 24px #1d4ed840' }}>
                        <Zap style={{ width:16, height:16 }} /> Отправить оферту
                      </button>
                    </div>
                  )
                ) : (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'13px', borderRadius:16, background:'#0e1e32', border:'1px solid #1a2d42' }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#3a5570' }}>Мест нет · Груз заполнен</span>
                  </div>
                )}
              </div>
            </div>

            {/* Inline offer form */}
            {showOffer && !offerDone && (
              <div className="td-s2 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(145deg,#0f1f38,#0a1520)', border:'1px solid #1a2d45', boxShadow:'0 24px 48px #00000060' }}>
                <div style={{ height:2, background:'linear-gradient(90deg,#5ba3f5,#a855f7)' }} />
                <div style={{ padding:22 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
                    <p style={{ fontSize:16, fontWeight:900, color:'#fff' }}>Оформить оферту</p>
                    <button onClick={() => setShowOffer(false)} style={{ width:28, height:28, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', background:'#ffffff0a', border:'none', cursor:'pointer', color:'#4a6580' }}>
                      <X style={{ width:14, height:14 }} />
                    </button>
                  </div>

                  {hasSeats && (
                    <div style={{ marginBottom:12, borderRadius:16, overflow:'hidden', border: includeSeats ? '1px solid #5ba3f540' : '1px solid #1a2d3d', background: includeSeats ? '#5ba3f508' : '#0a1520', transition:'border-color .2s' }}>
                      <button className="td-toggle" onClick={() => setIncludeSeats(!includeSeats)}>
                        <div style={{ width:32, height:32, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', background: includeSeats ? '#5ba3f5' : '#1a2d3d', flexShrink:0, transition:'background .2s' }}><Users style={{ width:15, height:15, color: includeSeats ? '#fff' : '#4a6580' }} /></div>
                        <div style={{ flex:1 }}><p style={{ fontSize:13, fontWeight:800, color:'#fff' }}>Пассажирские места</p><p style={{ fontSize:11, color:'#4a6580' }}>{trip.pricePerSeat} {trip.currency||'TJS'}/место · {trip.availableSeats} свободно</p></div>
                        <div style={{ width:38, height:22, borderRadius:11, background: includeSeats ? '#5ba3f5' : '#1a2d3d', position:'relative', flexShrink:0, transition:'background .2s' }}>
                          <div style={{ position:'absolute', top:3, left: includeSeats ? 18 : 3, width:16, height:16, borderRadius:8, background:'#fff', transition:'left .2s', boxShadow:'0 1px 4px #00000040' }} />
                        </div>
                      </button>
                      {includeSeats && (
                        <div style={{ padding:'0 14px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:13, background:'#080f1a', border:'1px solid #1a2d3d', marginBottom:8 }}>
                            <button className="td-counter-btn" onClick={() => setOfferSeats(Math.max(1, offerSeats-1))} style={{ background:'#1a2d3d', color:'#fff' }}><Minus style={{ width:13, height:13 }} /></button>
                            <div style={{ flex:1, textAlign:'center' }}><p style={{ fontSize:28, fontWeight:900, color:'#fff', lineHeight:1 }}>{offerSeats}</p><p style={{ fontSize:10, color:'#4a6580' }}>мест</p></div>
                            <button className="td-counter-btn" onClick={() => setOfferSeats(Math.min(trip.availableSeats, offerSeats+1))} style={{ background:'#5ba3f520', color:'#5ba3f5' }}><Plus style={{ width:13, height:13 }} /></button>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderRadius:11, background:'#5ba3f510' }}>
                            <span style={{ fontSize:12, color:'#5ba3f5' }}>{offerSeats} × {trip.pricePerSeat} {trip.currency||'TJS'}</span>
                            <span style={{ fontSize:14, fontWeight:900, color:'#5ba3f5' }}>{totalSeatsPrice} {trip.currency||'TJS'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Children counter desktop ── */}
                  {hasSeats && (
                    <div style={{ marginBottom:12, borderRadius:16, border:'1px solid #1a2d3d', background:'#0a1520', overflow:'hidden' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px' }}>
                        <div style={{ width:32, height:32, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', background:'#1a2d3d', flexShrink:0 }}>
                          <span style={{ fontSize:15 }}>👶</span>
                        </div>
                        <div style={{ flex:1 }}>
                          <p style={{ fontSize:13, fontWeight:800, color:'#fff' }}>Дети <span style={{ fontWeight:400, fontSize:11, color:'#4a6580' }}>(до 12 лет · ½ цены)</span></p>
                          <p style={{ fontSize:11, color:'#4a6580' }}>{childSeatPrice(trip)} {trip.currency||'TJS'}/место</p>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                          <button className="td-counter-btn" onClick={() => setOfferChildren(Math.max(0, (Number(offerChildren)||0) - 1))} style={{ background:'#1a2d3d', color:'#fff' }}><Minus style={{ width:13, height:13 }} /></button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={offerChildren}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9]/g, '');
                              if (raw === '') { setOfferChildren('' as any); return; }
                              setOfferChildren(parseInt(raw, 10));
                            }}
                            onBlur={() => {
                              const v = parseInt(String(offerChildren), 10);
                              setOfferChildren(isNaN(v) ? 0 : Math.max(0, v));
                            }}
                            onFocus={(e) => e.target.select()}
                            style={{ width:36, textAlign:'center', fontSize:18, fontWeight:900, color:'#fff', background:'transparent', border:'none', borderBottom:'2px solid #1a2d3d', outline:'none' }}
                          />
                          <button className="td-counter-btn" onClick={() => setOfferChildren((Number(offerChildren)||0) + 1)} style={{ background:'#5ba3f520', color:'#5ba3f5' }}><Plus style={{ width:13, height:13 }} /></button>
                        </div>
                      </div>
                    </div>
                  )}

                  {hasCargo && (
                    <div style={{ marginBottom:12, borderRadius:16, overflow:'hidden', border: includeCargo ? '1px solid #f59e0b40' : '1px solid #1a2d3d', background: includeCargo ? '#f59e0b08' : '#0a1520', transition:'border-color .2s' }}>
                      <button className="td-toggle" onClick={() => setIncludeCargo(!includeCargo)}>
                        <div style={{ width:32, height:32, borderRadius:11, display:'flex', alignItems:'center', justifyContent:'center', background: includeCargo ? '#f59e0b' : '#1a2d3d', flexShrink:0, transition:'background .2s' }}><Truck style={{ width:15, height:15, color: includeCargo ? '#fff' : '#4a6580' }} /></div>
                        <div style={{ flex:1 }}><p style={{ fontSize:13, fontWeight:800, color:'#fff' }}>Перевозка груза</p><p style={{ fontSize:11, color:'#4a6580' }}>{trip.pricePerKg} {trip.currency||'TJS'}/кг · {trip.cargoCapacity} кг</p></div>
                        <div style={{ width:38, height:22, borderRadius:11, background: includeCargo ? '#f59e0b' : '#1a2d3d', position:'relative', flexShrink:0, transition:'background .2s' }}>
                          <div style={{ position:'absolute', top:3, left: includeCargo ? 18 : 3, width:16, height:16, borderRadius:8, background:'#fff', transition:'left .2s', boxShadow:'0 1px 4px #00000040' }} />
                        </div>
                      </button>
                      {includeCargo && (
                        <div style={{ padding:'0 14px 14px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:13, background:'#080f1a', border:'1px solid #1a2d3d', marginBottom:8 }}>
                            <button className="td-counter-btn" onClick={() => setOfferCargoKg(Math.max(1, offerCargoKg-5))} style={{ background:'#1a2d3d', color:'#fff' }}><Minus style={{ width:13, height:13 }} /></button>
                            <div style={{ flex:1, textAlign:'center' }}><p style={{ fontSize:28, fontWeight:900, color:'#f59e0b', lineHeight:1 }}>{offerCargoKg}</p><p style={{ fontSize:10, color:'#4a6580' }}>кг</p></div>
                            <button className="td-counter-btn" onClick={() => setOfferCargoKg(Math.min(trip.cargoCapacity, offerCargoKg+5))} style={{ background:'#f59e0b20', color:'#f59e0b' }}><Plus style={{ width:13, height:13 }} /></button>
                          </div>
                          <input className="td-inp" placeholder="Описание груза..." value={offerCargoDesc} onChange={e => setOfferCargoDesc(e.target.value)} style={{ marginBottom:8 }} />
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderRadius:11, background:'#f59e0b10' }}>
                            <span style={{ fontSize:12, color:'#f59e0b' }}>{offerCargoKg} кг × {trip.pricePerKg} {trip.currency||'TJS'}</span>
                            <span style={{ fontSize:14, fontWeight:900, color:'#f59e0b' }}>{totalCargoPrice} {trip.currency||'TJS'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {includeSeats && includeCargo && (
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderRadius:14, background:'#1e2d45', border:'1px solid #2a4060', marginBottom:12 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:'#7a9ab5' }}>Итого</span>
                      <span style={{ fontSize:18, fontWeight:900, color:'#fff' }}>{totalPrice} {trip.currency||'TJS'}</span>
                    </div>
                  )}

                  <div style={{ marginBottom:14, display:'flex', flexDirection:'column', gap:8 }}>
                    <input className="td-inp" placeholder="Ваше имя *" value={offerName} onChange={e => setOfferName(e.target.value)} />
                    <input className="td-inp" placeholder="Телефон" type="tel" value={offerPhone} onChange={e => setOfferPhone(e.target.value)} />
                  </div>

                  <button onClick={submitOffer} disabled={!offerName.trim() || (!includeSeats && !includeCargo) || isSubmitting} className="td-action-btn"
                    style={{ width:'100%', background: offerName.trim() && (includeSeats||includeCargo) && !isSubmitting ? 'linear-gradient(135deg,#1d4ed8,#5ba3f5)' : '#1a2d3d', color:'#fff', boxShadow: offerName.trim() && (includeSeats||includeCargo) ? '0 8px 24px #1d4ed840' : 'none' }}>
                    {isSubmitting ? 'Отправляем...' : `Подтвердить · ${totalPrice} ${trip.currency||'TJS'}`}
                  </button>
                </div>
              </div>
            )}

            {showOffer && offerDone && (
              <div className="td-s2 rounded-3xl overflow-hidden" style={{ background:'linear-gradient(145deg,#0f1f38,#0a1520)', border:'1px solid #10b98135' }}>
                <div style={{ padding:28, display:'flex', flexDirection:'column', alignItems:'center', gap:16, textAlign:'center' }}>
                  <div style={{ width:64, height:64, borderRadius:22, display:'flex', alignItems:'center', justifyContent:'center', background:'#10b98120', border:'1px solid #10b98130' }}>
                    <CheckCircle2 style={{ width:30, height:30, color:'#10b981' }} />
                  </div>
                  <div>
                    <p style={{ fontSize:18, fontWeight:900, color:'#fff', marginBottom:6 }}>Оферта отправлена!</p>
                    <p style={{ fontSize:13, color:'#4a6580', lineHeight:1.6 }}>Водитель получит уведомление и свяжется с вами.</p>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCELLED TRIP PAGE — Fix #1
// ─────────────────────────────────────────────────────────────────────────────
function CancelledTripDetail({ trip, isDark }: { trip: any; isDark: boolean }) {
  const navigate = useNavigate();
  return (
    <div className={`min-h-screen flex flex-col font-['Sora'] ${isDark ? 'bg-[#060e1a] text-white' : 'bg-[#f1f5f9] text-[#0f172a]'}`}>
      <header className={`sticky top-0 z-50 backdrop-blur-xl px-4 py-3 flex items-center justify-between border-b ${isDark ? 'bg-[#060e1a]/95 border-white/[0.06]' : 'bg-white/95 border-[#e2e8f0]'}`}>
        <button onClick={() => navigate(-1)} className={`flex size-10 items-center justify-center rounded-full transition-colors ${isDark ? 'hover:bg-[#1e2d3a]' : 'hover:bg-[#f1f5f9]'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className={`text-sm font-bold ${isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'}`}>Рейс отменён</span>
        <div className="w-10" />
      </header>

      <div className="flex flex-col items-center justify-center flex-1 px-6 gap-6 py-16">
        {/* Icon */}
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center" style={{ background: '#ef444415', border: '1px solid #ef444430' }}>
          <XCircleIcon className="w-12 h-12 text-rose-400" />
        </div>

        {/* Title */}
        <div className="text-center">
          <p className="text-[22px] font-black mb-2">Поездка отменена</p>
          <p className={`text-[14px] leading-relaxed ${isDark ? 'text-[#607080]' : 'text-[#64748b]'}`}>
            Рейс <span className="font-bold text-white">{cleanAddress(trip.from)} → {cleanAddress(trip.to)}</span> был отменён и недоступен для бронирования.
          </p>
        </div>

        {/* Route card */}
        <div className={`w-full rounded-2xl border p-4 flex items-stretch gap-3 ${isDark ? 'bg-white/[0.03] border-white/[0.07]' : 'bg-white border-[#e2e8f0]'}`}>
          <div className="flex flex-col items-center flex-shrink-0 pt-1 gap-0">
            <div className="w-2 h-2 rounded-full bg-rose-400" />
            <div className="w-px flex-1 my-1 bg-rose-400/30" style={{ minHeight: 16 }} />
            <div className="w-2 h-2 rounded-full bg-rose-400/60" />
          </div>
          <div className="flex flex-col justify-between gap-2 flex-1 min-w-0">
            <p className="font-bold text-[14px] truncate">{cleanAddress(trip.from)}</p>
            <p className={`font-semibold text-[13px] truncate ${isDark ? 'text-[#607080]' : 'text-[#94a3b8]'}`}>{cleanAddress(trip.to)}</p>
          </div>
          {trip.date && (
            <div className={`flex-shrink-0 flex items-center gap-1 text-[11px] ${isDark ? 'text-[#607080]' : 'text-[#94a3b8]'}`}>
              <Calendar className="w-3 h-3" />
              <span>{trip.date}</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="w-full flex flex-col gap-2.5">
          <button onClick={() => navigate('/search')}
            className="w-full py-3.5 rounded-2xl bg-[#5ba3f5] text-white font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
            <Route className="w-4 h-4" /> Найти другую поездку
          </button>
          <button onClick={() => navigate(-1)}
            className={`w-full py-3.5 rounded-2xl font-semibold text-[14px] border transition-all active:scale-[0.98] ${isDark ? 'border-white/[0.1] text-[#94a3b8] hover:bg-white/[0.04]' : 'border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]'}`}>
            Назад
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline XCircle для CancelledTripDetail (не импортирован в основных иконках)
function XCircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CARGO DETAIL — для объявлений отправителей (tripType === 'cargo')
// ─────────────────────────────────────────────────────────────────────────────
function CargoDetail({ cargo, isDark: _isDark, userRole, currentUser }: {
  cargo: any; isDark: boolean; userRole: string; currentUser: any;
}) {
  const navigate = useNavigate();
  const isDriver = userRole === 'driver';
  const isMyCargo = cargo.senderEmail && cargo.senderEmail === currentUser?.email;

  const [offers, setOffers] = useState<any[]>([]);
  const [offerSent, setOfferSent] = useState(false);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerPrice, setOfferPrice] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [offerVehicle, setOfferVehicle] = useState('');
  const [showOfferSheet, setShowOfferSheet] = useState(false);
  const [loadingOffers, setLoadingOffers] = useState(false);

  // Auto-fill driver info from profile
  const driverName = `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() || 'Водитель';
  const driverPhone = currentUser?.phone || '';

  useEffect(() => {
    if (!cargo?.id) return;
    setLoadingOffers(true);
    getCargoOffersForCargo(cargo.id).then(data => {
      setOffers(data);
      if (isDriver && currentUser?.email) {
        const myOffer = data.find((o: any) => o.driverEmail === currentUser.email && (o.status === 'pending' || o.status === 'accepted'));
        if (myOffer) setOfferSent(true);
      }
    }).catch(() => {}).finally(() => setLoadingOffers(false));
  }, [cargo?.id]);

  // Check if driver's own offer was accepted
  const myAcceptedOffer = isDriver && currentUser?.email
    ? offers.find((o: any) => o.driverEmail === currentUser.email && o.status === 'accepted')
    : null;

  const handleSubmitOffer = async () => {
    if (!currentUser?.email || offerLoading) return;
    setOfferLoading(true);
    try {
      await submitCargoOffer({
        cargoId: cargo.id,
        driverEmail: currentUser.email,
        driverName,
        driverPhone: driverPhone || undefined,
        driverAvatar: currentUser.avatarUrl || null,
        price: offerPrice ? parseFloat(offerPrice) : undefined,
        currency: cargo.currency || 'TJS',
        notes: [offerVehicle ? `Авто: ${offerVehicle}` : '', offerNote.trim()].filter(Boolean).join('\n') || undefined,
      });
      setOfferSent(true);
      setShowOfferSheet(false);
      const { toast } = await import('sonner');
      toast.success('Отклик отправлен! Отправитель получит уведомление 🚛');
    } catch (err: any) {
      const { toast } = await import('sonner');
      if (err?.message?.includes('409')) toast.error('Вы уже откликнулись на этот груз');
      else toast.error(`Ошибка: ${err?.message || err}`);
    } finally { setOfferLoading(false); }
  };

  const handleAcceptOffer = async (offer: any) => {
    try {
      await updateCargoOffer(cargo.id, offer.offerId, { status: 'accepted' });
      setOffers(prev => prev.map(o => o.offerId === offer.offerId ? { ...o, status: 'accepted' } : o));
      const { toast } = await import('sonner');
      toast.success('Отклик принят! Свяжитесь с водителем');
    } catch {
      const { toast } = await import('sonner');
      toast.error('Не удалось принять отклик');
    }
  };

  const handleRejectOffer = async (offer: any) => {
    try {
      await updateCargoOffer(cargo.id, offer.offerId, { status: 'rejected' });
      setOffers(prev => prev.map(o => o.offerId === offer.offerId ? { ...o, status: 'rejected' } : o));
      const { toast } = await import('sonner');
      toast.success('Отклик отклонён');
    } catch {
      const { toast } = await import('sonner');
      toast.error('Не удалось отклонить');
    }
  };

  const statusColors: Record<string, string> = {
    active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    cancelled: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
    completed: 'text-[#64748b] bg-white/[0.05] border-white/[0.08]',
  };
  const statusLabels: Record<string, string> = {
    active: 'Активно', cancelled: 'Отменено', completed: 'Завершено',
  };
  const st = cargo.status || 'active';
  const pendingCount = offers.filter(o => o.status === 'pending').length;

  return (
    <div className="min-h-screen font-['Sora'] bg-[#060e1a] text-white pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#060e1a]/95 backdrop-blur-xl border-b border-white/[0.06]">
        <div style={{ height: 'env(safe-area-inset-top, 0px)' }} />
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)}
            className="w-9 h-9 rounded-xl bg-white/[0.06] flex items-center justify-center text-[#607080] active:scale-90 transition-all">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-black text-white leading-none truncate">
              {cargo.from} → {cargo.to}
            </h1>
            <p className="text-[10px] text-[#607080] mt-0.5">Объявление о грузе</p>
          </div>
          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusColors[st] || statusColors.active}`}>
            {statusLabels[st] || 'Активно'}
          </span>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">
        {/* Route card */}
        <div className="rounded-2xl bg-[#111c28] border border-white/[0.07] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Navigation className="w-3.5 h-3.5 text-[#5ba3f5]" />
            <p className="text-[10px] font-black uppercase tracking-widest text-[#5ba3f5]">Маршрут</p>
          </div>
          <div className="px-4 py-4">
            <div className="flex items-stretch gap-3">
              <div className="flex flex-col items-center shrink-0 pt-0.5">
                <div className="w-2.5 h-2.5 rounded-full bg-[#5ba3f5] ring-2 ring-[#5ba3f5]/25" />
                <div className="w-0.5 flex-1 my-1.5 rounded-full bg-gradient-to-b from-[#5ba3f5]/60 to-amber-400/60" style={{ minHeight: 20 }} />
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-amber-400/25" />
              </div>
              <div className="flex-1 flex flex-col justify-between gap-2 min-w-0">
                <p className="font-bold text-[15px] text-white leading-tight">{cargo.from}</p>
                <p className="font-bold text-[15px] text-white leading-tight">{cargo.to}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Details card */}
        <div className="rounded-2xl bg-[#111c28] border border-white/[0.07] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-[#f59e0b]" />
            <p className="text-[10px] font-black uppercase tracking-widest text-[#f59e0b]">Детали груза</p>
          </div>
          <div className="px-4 py-4 grid grid-cols-2 gap-3">
            {cargo.date && (
              <div className="flex flex-col gap-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#4a6278]">Дата отправки</p>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-[#5ba3f5]" />
                  <p className="text-[13px] font-bold text-white">{cargo.date}</p>
                </div>
              </div>
            )}
            {(cargo.cargoWeight ?? 0) > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#4a6278]">Вес груза</p>
                <div className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-amber-400" />
                  <p className="text-[13px] font-bold text-white">{cargo.cargoWeight} кг</p>
                </div>
              </div>
            )}
            {(cargo.budget ?? 0) > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#4a6278]">Бюджет</p>
                <div className="flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-emerald-400" />
                  <p className="text-[13px] font-bold text-emerald-400">{cargo.budget} {cargo.currency || 'TJS'}</p>
                </div>
              </div>
            )}
            {cargo.cargoType && (
              <div className="flex flex-col gap-1">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#4a6278]">Тип груза</p>
                <div className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-[#607080]" />
                  <p className="text-[13px] font-semibold text-white">{cargo.cargoType}</p>
                </div>
              </div>
            )}
          </div>
          {cargo.notes?.trim() && (
            <div className="px-4 pb-4 border-t border-white/[0.06] pt-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#4a6278] mb-1.5">Описание</p>
              <p className="text-[13px] text-[#8a9baa] leading-relaxed">{cargo.notes}</p>
            </div>
          )}
        </div>

        {/* Sender info card */}
        <div className="rounded-2xl bg-[#111c28] border border-white/[0.07] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
            <UserCheck className="w-3.5 h-3.5 text-[#a78bfa]" />
            <p className="text-[10px] font-black uppercase tracking-widest text-[#a78bfa]">Отправитель</p>
          </div>
          <div className="px-4 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center font-black text-[13px] text-white shrink-0"
              style={{ background: cargo.senderAvatar ? undefined : 'linear-gradient(135deg, #7c3aed, #a78bfa)' }}>
              {cargo.senderAvatar
                ? <img src={cargo.senderAvatar} alt="" className="w-full h-full object-cover rounded-2xl" />
                : (cargo.senderName?.[0] || 'О').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-white">{cargo.senderName || 'Отправитель'}</p>
              <p className="text-[11px] text-[#607080]">Объявление создано</p>
            </div>
            {/* Phone shown to driver only after their offer is accepted */}
            {isDriver && myAcceptedOffer && cargo.senderPhone && (
              <a href={`tel:${cargo.senderPhone}`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[12px] font-bold active:scale-95 transition-all">
                <Phone className="w-3.5 h-3.5" />
                {cargo.senderPhone}
              </a>
            )}
          </div>
        </div>

        {/* DRIVER: offer sent status */}
        {isDriver && !isMyCargo && offerSent && (
          <div className="rounded-2xl overflow-hidden" style={{
            background: myAcceptedOffer ? '#10b98115' : '#f59e0b12',
            border: myAcceptedOffer ? '1px solid #10b98130' : '1px solid #f59e0b30',
          }}>
            <div className="px-4 py-4 flex items-start gap-3">
              {myAcceptedOffer
                ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                : <Truck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <p className={`text-[14px] font-bold ${myAcceptedOffer ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {myAcceptedOffer ? 'Ваш отклик принят!' : 'Отклик отправлен · Ожидание'}
                </p>
                <p className="text-[11px] text-[#607080] mt-0.5">
                  {myAcceptedOffer
                    ? 'Свяжитесь с отправителем для организации перевозки'
                    : 'Отправитель рассмотрит ваше предложение'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* SENDER: incoming driver offers */}
        {isMyCargo && (
          <div className="rounded-2xl bg-[#111c28] border border-white/[0.07] overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-3.5 h-3.5 text-[#5ba3f5]" />
                <p className="text-[10px] font-black uppercase tracking-widest text-[#5ba3f5]">Отклики водителей</p>
              </div>
              <div className="flex items-center gap-2">
                {pendingCount > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-black flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
                {loadingOffers && <div className="w-4 h-4 rounded-full border-2 border-[#5ba3f5]/30 border-t-[#5ba3f5] animate-spin" />}
              </div>
            </div>
            {offers.length === 0 && !loadingOffers ? (
              <div className="px-4 py-8 text-center">
                <Truck className="w-8 h-8 text-[#3a5570] mx-auto mb-2" />
                <p className="text-[13px] text-[#607080]">Пока нет откликов от водителей</p>
                <p className="text-[11px] text-[#3a5570] mt-1">Водители увидят ваше объявление и смогут откликнуться</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.05]">
                {offers.map(offer => (
                  <div key={offer.offerId} className="px-4 py-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-[12px] text-white shrink-0"
                        style={{ background: offer.driverAvatar ? undefined : 'linear-gradient(135deg, #1d4ed8, #5ba3f5)' }}>
                        {offer.driverAvatar
                          ? <img src={offer.driverAvatar} alt="" className="w-full h-full object-cover rounded-xl" />
                          : (offer.driverName?.[0] || 'В').toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-white">{offer.driverName || 'Водитель'}</p>
                        {offer.price > 0 && <p className="text-[11px] text-emerald-400 font-bold">{offer.price} {offer.currency || 'TJS'}</p>}
                      </div>
                      {offer.status === 'accepted' && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">Принят</span>
                      )}
                      {offer.status === 'rejected' && (
                        <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full border border-rose-500/20">Отклонён</span>
                      )}
                      {offer.status === 'pending' && (
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">Ожидает</span>
                      )}
                    </div>
                    {offer.notes && <p className="text-[12px] text-[#8a9baa] leading-relaxed pl-12">{offer.notes}</p>}
                    {offer.status === 'accepted' && offer.driverPhone && (
                      <a href={`tel:${offer.driverPhone.replace(/\D/g, '')}`}
                        className="flex items-center gap-2 text-[12px] font-bold text-emerald-400 pl-12">
                        <Phone className="w-3.5 h-3.5" />
                        {offer.driverPhone}
                      </a>
                    )}
                    {offer.status === 'pending' && (
                      <div className="flex gap-2 pl-12">
                        <button
                          onClick={() => handleAcceptOffer(offer)}
                          className="flex-1 h-9 rounded-xl text-[12px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors flex items-center justify-center gap-1.5"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Принять
                        </button>
                        <button
                          onClick={() => handleRejectOffer(offer)}
                          className="flex-1 h-9 rounded-xl text-[12px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 transition-colors"
                        >
                          Отклонить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ STICKY BOTTOM CTA for DRIVER ══ */}
      {isDriver && !isMyCargo && st === 'active' && (
        <div className="fixed bottom-0 left-0 right-0 z-40">
          <div className="px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
            {offerSent ? (
              myAcceptedOffer ? (
                <div className="flex items-center justify-center gap-2.5 py-3.5 rounded-2xl border bg-emerald-500/10 border-emerald-500/25 text-emerald-400">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span className="font-bold text-sm">Ваш отклик принят!</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2.5 py-3.5 rounded-2xl border bg-amber-500/10 border-amber-500/25 text-amber-400">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                  </span>
                  <span className="font-bold text-sm">Отклик отправлен · Ожидание</span>
                </div>
              )
            ) : (
              <div className="flex items-stretch gap-2 w-full">
                {(cargo.budget ?? 0) > 0 && (
                  <div className="flex flex-col justify-center shrink-0 px-3 py-2 rounded-2xl bg-white/[0.05] border border-white/[0.08] min-w-[72px]">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-[#607080]">бюджет</span>
                    <span className="text-[15px] font-black leading-none text-emerald-400 whitespace-nowrap">
                      {cargo.budget} {cargo.currency || 'TJS'}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setShowOfferSheet(true)}
                  className="flex-1 min-w-0 py-3.5 rounded-2xl font-extrabold text-white text-[14px] active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 8px 24px #10b98130' }}
                >
                  <Truck className="w-4 h-4" />
                  Откликнуться на груз
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ DRIVER OFFER BOTTOM SHEET ══ */}
      {showOfferSheet && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowOfferSheet(false)} />
          <div className="relative rounded-t-3xl shadow-2xl max-h-[90vh] overflow-y-auto bg-[#162030]">
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full bg-white/20" />
            </div>
            <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h3 className="text-[15px] font-black text-white">Предложить перевозку</h3>
                <p className="text-[11px] text-[#607080] mt-0.5">{cargo.from} → {cargo.to}</p>
              </div>
              <button onClick={() => setShowOfferSheet(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/[0.06] text-[#607080]">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 pb-8">
              {/* Driver info preview */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <div className="w-9 h-9 rounded-xl bg-[#1d4ed8]/30 flex items-center justify-center font-black text-[#5ba3f5] text-[12px] shrink-0">
                  {driverName[0]?.toUpperCase() || 'В'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-white truncate">{driverName}</p>
                  {driverPhone && <p className="text-[11px] text-[#607080]">{driverPhone}</p>}
                </div>
                <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Из профиля</span>
              </div>

              {/* Budget hint */}
              {(cargo.budget ?? 0) > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/08 border border-emerald-500/20">
                  <Banknote className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <p className="text-[12px] text-emerald-400">Бюджет: <span className="font-black">{cargo.budget} {cargo.currency || 'TJS'}</span></p>
                </div>
              )}

              {/* Vehicle type */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#4a6278] mb-2">Ваш автомобиль</p>
                <input
                  type="text"
                  placeholder="Газель, Ford Transit, Камаз..."
                  value={offerVehicle}
                  onChange={e => setOfferVehicle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-[#0d1929] border border-white/[0.07] text-[13px] text-white placeholder-[#253545] outline-none focus:border-emerald-500/40 transition-colors"
                />
              </div>

              {/* Price */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#4a6278] mb-2">Ваша цена (опционально)</p>
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-[#0d1929] border border-white/[0.07] focus-within:border-emerald-500/40 transition-colors">
                  <input
                    type="number"
                    placeholder={cargo.budget ? `До ${cargo.budget}` : 'Цена за перевозку'}
                    value={offerPrice}
                    onChange={e => setOfferPrice(e.target.value)}
                    className="flex-1 bg-transparent outline-none text-[14px] font-bold text-white placeholder-[#253545]"
                  />
                  <span className="text-[11px] font-bold text-[#4a6278]">{cargo.currency || 'TJS'}</span>
                </div>
              </div>

              {/* Notes */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#4a6278] mb-2">Комментарий (опционально)</p>
                <textarea
                  placeholder="Опыт перевозок, условия, дополнительная информация..."
                  value={offerNote}
                  onChange={e => setOfferNote(e.target.value)}
                  rows={3}
                  maxLength={400}
                  className="w-full px-4 py-3 rounded-xl bg-[#0d1929] border border-white/[0.07] text-[13px] text-white placeholder-[#253545] outline-none resize-none focus:border-emerald-500/40 transition-colors"
                />
              </div>

              {/* Submit */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowOfferSheet(false)}
                  className="w-24 h-12 rounded-2xl text-[12px] font-bold text-[#607080] bg-white/[0.05] border border-white/[0.07]"
                >
                  Отмена
                </button>
                <button
                  onClick={handleSubmitOffer}
                  disabled={offerLoading}
                  className="flex-1 h-12 rounded-2xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-all"
                  style={{ background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 6px 20px #10b98130' }}
                >
                  {offerLoading
                    ? <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    : <Truck className="w-4 h-4" />
                  }
                  {offerLoading ? 'Отправляем...' : 'Отправить отклик'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TripDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user: currentUser } = useUser();
  const userRole = sessionStorage.getItem('userRole') || 'sender';

  const [trip, setTrip] = useState<any>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      // 1. Instant render from both localStorage caches (trips + cargos)
      const savedTrips = JSON.parse(localStorage.getItem('ovora_published_trips') || '[]');
      const savedCargos = JSON.parse(localStorage.getItem('ovora_published_cargos') || '[]');
      const savedAll = JSON.parse(localStorage.getItem('ovora_all_cargos') || '[]');
      const cached =
        savedTrips.find((t: any) => String(t.id) === String(id)) ||
        savedCargos.find((t: any) => String(t.id) === String(id)) ||
        savedAll.find((t: any) => String(t.id) === String(id)) || null;
      if (cached && !cancelled) setTrip(cached);

      // 2. Fetch fresh: try trip first, fallback to cargo
      try {
        let fresh = await getTripById(id);
        if (!fresh) {
          fresh = await getCargoById(id);
        }
        if (cancelled) return;
        if (fresh) {
          setTrip(fresh);
          // Update appropriate local cache
          try {
            const isCargo = fresh.tripType === 'cargo' || (fresh.senderEmail && !fresh.driverEmail);
            if (isCargo) {
              const list: any[] = JSON.parse(localStorage.getItem('ovora_published_cargos') || '[]');
              const idx = list.findIndex((t: any) => String(t.id) === String(id));
              if (idx >= 0) list[idx] = fresh; else list.unshift(fresh);
              localStorage.setItem('ovora_published_cargos', JSON.stringify(list));
            } else {
              const list: any[] = JSON.parse(localStorage.getItem('ovora_published_trips') || '[]');
              const idx = list.findIndex((t: any) => String(t.id) === String(id));
              if (idx >= 0) list[idx] = fresh; else list.unshift(fresh);
              localStorage.setItem('ovora_published_trips', JSON.stringify(list));
            }
          } catch {}
        } else if (!cached) {
          setTrip({ __notFound: true });
        }
      } catch {
        if (!cancelled && !cached) setTrip({ __notFound: true });
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id]);

  if (!trip) {
    return (
      <div className={`min-h-screen flex items-center justify-center font-['Sora'] ${isDark ? 'bg-[#060e1a]' : 'bg-[#f1f5f9]'}`}>
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#1978e5] border-t-transparent" />
      </div>
    );
  }

  if (trip.__notFound) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center gap-4 font-['Sora'] px-8 ${isDark ? 'bg-[#060e1a] text-white' : 'bg-[#f1f5f9] text-[#0f172a]'}`}>
        <div className={`w-20 h-20 rounded-2xl flex items-center justify-center ${isDark ? 'bg-[#1a2736]' : 'bg-white'}`}>
          <Route className="w-10 h-10 opacity-30" />
        </div>
        <p className="text-lg font-bold text-center">Объявление не найдено</p>
        <p className={`text-sm text-center ${isDark ? 'text-[#475569]' : 'text-[#94a3b8]'}`}>Возможно, оно было удалено или ещё не опубликовано</p>
        <button onClick={() => navigate(-1)} className="mt-2 px-6 py-3 bg-[#1978e5] text-white font-bold rounded-2xl">Назад</button>
      </div>
    );
  }

  // Detect cargo by tripType field or by presence of senderEmail without driverEmail
  const isCargo = trip.tripType === 'cargo' || (trip.senderEmail && !trip.driverEmail && !trip.availableSeats);
  if (isCargo) {
    return <CargoDetail cargo={trip} isDark={isDark} userRole={userRole} currentUser={currentUser} />;
  }

  if (trip.status === 'completed') {
    return <CompletedTripDetail trip={trip} isDark={isDark} />;
  }

  // Fix #1: cancelled рейс → информационный экран, а не форма оферты
  if (trip.status === 'cancelled') {
    return <CancelledTripDetail trip={trip} isDark={isDark} />;
  }

  return <ActiveTripDetail trip={trip} isDark={isDark} userRole={userRole} />;
}
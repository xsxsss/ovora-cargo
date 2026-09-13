/**
 * SenderTrackingPage — страница отслеживания для ОТПРАВИТЕЛЯ.
 * Пассивный режим: карта, водитель, груз.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { AVATARS } from '../constants/avatars';
import {
  ArrowLeft, MessageSquare, AlertTriangle,
  Phone, Truck, MapPin, Shield, Package,
  ChevronUp, Star, CheckCircle2, Clock, Navigation,
  Camera, Share2,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { YMaps, Map, Placemark } from 'react-yandex-maps';
import { YANDEX_MAPS_CONFIG } from '../config/yandex';
import { cleanAddress } from '../utils/addressUtils';
import { calculateDistance } from '@/utils/geolocation';
import { useTrips } from '../contexts/TripsContext';
import { useUser } from '../contexts/UserContext';
import { getActiveShipment, getPODPhotos, getPublicTrackingLink, type ShipmentStatus } from '../api/trackingApi';
import { toast } from 'sonner';

const STATUS_STEPS: { key: ShipmentStatus; label: string; icon: string }[] = [
  { key: 'pending',    label: 'Ожидает',   icon: '⏳' },
  { key: 'loaded',     label: 'Загружен',  icon: '📦' },
  { key: 'inProgress', label: 'В пути',    icon: '🚚' },
  { key: 'customs',    label: 'Таможня',   icon: '🛂' },
  { key: 'arrived',    label: 'Прибыл',    icon: '📍' },
  { key: 'delivered',  label: 'Доставлен', icon: '✅' },
];
const STATUS_ORDER: ShipmentStatus[] = ['pending','loaded','inProgress','customs','arrived','delivered'];
function getStatusIndex(s: ShipmentStatus): number {
  if (s === 'completed') return STATUS_ORDER.length - 1;
  const i = STATUS_ORDER.indexOf(s); return i >= 0 ? i : 0;
}

export function SenderTrackingPage() {
  const navigate = useNavigate();
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetState, setSheetState] = useState<'peek' | 'expanded' | 'hidden'>('peek');
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);

  const mapInstanceRef = useRef<any>(null);
  const ymapsRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [ymapsApi, setYmapsApi] = useState<any>(null);

  const { activeTrip: ctxTrip } = useTrips();
  const { user } = useUser();
  const senderEmail = user?.email || sessionStorage.getItem('ovora_user_email') || '';
  const [currentStatus, setCurrentStatus] = useState<ShipmentStatus>('pending');
  const [statusHistory, setStatusHistory] = useState<{ status: ShipmentStatus; timestamp: string }[]>([]);
  const [podPhotos, setPodPhotos] = useState<{ type: string; url: string; timestamp: string }[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Fix #4: если TripsContext не отдаёт activeTrip для sender — читаем из localStorage
  const savedTrip = (() => {
    try { return JSON.parse(localStorage.getItem('ovora_sender_tracking_trip') || 'null'); } catch { return null; }
  })();
  const activeTrip = ctxTrip || savedTrip;

  // ── Добавляем маршрут когда карта и ymaps готовы ─────────────────────────
  useEffect(() => {
    if (!mapInstance || !ymapsApi || !activeTrip?.fromLat) return;
    if (routeRef.current) {
      try { mapInstance.geoObjects.remove(routeRef.current); } catch (_) {}
    }
    const multiRoute = new ymapsApi.multiRouter.MultiRoute(
      {
        referencePoints: [
          [activeTrip.fromLat, activeTrip.fromLng],
          [activeTrip.toLat, activeTrip.toLng],
        ],
        params: { routingMode: 'auto' },
      },
      {
        routeActiveStrokeColor: '#5ba3f5',
        routeActiveStrokeWidth: 5,
        routeStrokeColor: '#334155',
        routeStrokeWidth: 3,
        boundsAutoApply: true,
        wayPointStartIconColor: '#607080',
        wayPointFinishIconColor: '#5ba3f5',
        pinVisible: false,
      }
    );
    routeRef.current = multiRoute;
    mapInstance.geoObjects.add(multiRoute);
    return () => {
      try { mapInstance.geoObjects.remove(multiRoute); } catch (_) {}
    };
  }, [mapInstance, ymapsApi]);

  // ── Таймер — строго 1 с / тик ─────────────────────────────────────────────
  useEffect(() => {
    intervalRef.current = setInterval(() => setElapsedSecs(s => s + 1), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // ── Polling реальной позиции водителя + статуса каждые 5 с ───────────────
  useEffect(() => {
    const resolvedId = activeTrip?.id || activeTrip?.tripId;
    if (!resolvedId || !senderEmail) return;
    const poll = async () => {
      const shipment = await getActiveShipment(resolvedId, senderEmail);
      if (!shipment) return;
      if (shipment.driverLat && shipment.driverLng) {
        setDriverLocation({ lat: shipment.driverLat, lng: shipment.driverLng });
      }
      if (shipment.status) setCurrentStatus(shipment.status as ShipmentStatus);
      if (shipment.statusHistory) setStatusHistory(shipment.statusHistory as any);
      if (shipment.podPhotos) setPodPhotos(shipment.podPhotos as any);
    };
    poll();
    const pollId = setInterval(poll, 5000);
    return () => clearInterval(pollId);
  }, [activeTrip?.id, activeTrip?.tripId, senderEmail]);

  // POD фото
  useEffect(() => {
    const resolvedId = activeTrip?.id || activeTrip?.tripId;
    if (!resolvedId) return;
    getPODPhotos(resolvedId).then(photos => { if (photos.length) setPodPhotos(photos as any); }).catch(() => {});
  }, [activeTrip?.id, activeTrip?.tripId]);

  // Поделиться ссылкой
  const handleShareLink = useCallback(() => {
    const resolvedId = activeTrip?.id || activeTrip?.tripId;
    if (!resolvedId) return;
    const link = getPublicTrackingLink(resolvedId);
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      toast.success('Ссылка скопирована!');
      setTimeout(() => setLinkCopied(false), 3000);
    }).catch(() => {});
  }, [activeTrip?.id, activeTrip?.tripId]);

  // ✅ FIX: убран фиктивный фолбэк 4500 км — раньше он маскировал отсутствие
  // реальных координат и показывал расстояние, не совпадающее с водителем.
  // При totalDistanceKm === 0 UI ниже сам показывает «—».
  const totalDistanceKm = activeTrip
    ? calculateDistance(activeTrip.fromLat, activeTrip.fromLng, activeTrip.toLat, activeTrip.toLng)
    : 0;

  const routeFrom = cleanAddress(activeTrip?.from || 'Душанбе');
  const routeTo = cleanAddress(activeTrip?.to || 'Москва');

  let displayProgress = 0;
  if (driverLocation && activeTrip && totalDistanceKm > 0) {
    const d = calculateDistance(activeTrip.fromLat, activeTrip.fromLng, driverLocation.lat, driverLocation.lng);
    displayProgress = Math.max(0, Math.min(1, d / totalDistanceKm));
  }
  const pct = Math.round(displayProgress * 100);
  const remainingKm = Math.round(totalDistanceKm * (1 - displayProgress));
  const elapsed = `${String(Math.floor(elapsedSecs / 3600)).padStart(2,'0')}:${String(Math.floor((elapsedSecs % 3600) / 60)).padStart(2,'0')}:${String(elapsedSecs % 60).padStart(2,'0')}`;

  // ✅ FIX: раньше при отсутствующей цене получалась буквальная строка "undefined TJS"
  const cargoInfo = activeTrip
    ? {
        type: activeTrip.cargoType || 'Груз',
        weight: activeTrip.weight,
        price: activeTrip.price ? `${activeTrip.price} ${activeTrip.currency || 'TJS'}` : '',
        notes: activeTrip.notes,
      }
    : { type: '', weight: '', price: '', notes: '' };

  const driver = activeTrip
    ? { name: activeTrip.driverName || activeTrip.contactName || 'Водитель', phone: activeTrip.driverPhone || activeTrip.contactPhone || '', avatar: activeTrip.driverAvatar || activeTrip.contactAvatar || '', rating: 4.9, vehicle: activeTrip.vehicleType || '' }
    : { name: '', phone: '', avatar: '', rating: 0, vehicle: '' };

  // ── Sheet drag ──────────────────────────────────────────────────────────────
  const onSheetTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    isDragging.current = true;
    setDragY(0);
  };
  const onSheetTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const delta = e.touches[0].clientY - dragStartY.current;
    setDragY(Math.max(0, delta));
  };
  const onSheetTouchEnd = () => {
    isDragging.current = false;
    if (dragY > 80) {
      setSheetState(s => s === 'expanded' ? 'peek' : 'hidden');
    } else if (dragY < -60) {
      setSheetState('expanded');
    }
    setDragY(0);
  };

  const sheetTranslate = sheetState === 'hidden' ? '100%' : sheetState === 'expanded' ? '0%' : '52%';

  return (
    <div className="font-['Sora'] bg-[#060e1a] text-white min-h-screen">

    {/* ════════ MOBILE (не трогаем) ════════ */}
    <div className="md:hidden relative h-screen w-full flex flex-col overflow-hidden">

      {/* ── MAP ── */}
      <div className="absolute inset-0 z-0">
        {activeTrip?.fromLat && activeTrip?.fromLng && activeTrip?.toLat && activeTrip?.toLng ? (
          <div className="w-full h-full relative">
            <YMaps query={{ apikey: YANDEX_MAPS_CONFIG.apiKey, lang: YANDEX_MAPS_CONFIG.lang, load: 'package.full' }}>
              <Map
                state={{ center: [(activeTrip.fromLat + activeTrip.toLat) / 2, (activeTrip.fromLng + activeTrip.toLng) / 2], zoom: 6 }}
                width="100%" height="100%"
                modules={['multiRouter.MultiRoute']}
                options={{ suppressMapOpenBlock: true }}
                instanceRef={(ref: any) => {
                  if (ref && ref !== mapInstanceRef.current) {
                    mapInstanceRef.current = ref;
                    setMapInstance(ref);
                  }
                }}
                onLoad={(ymaps: any) => {
                  ymapsRef.current = ymaps;
                  setYmapsApi(ymaps);
                }}
              >
                {/* Расчётная позиция груза */}
                <Placemark
                  geometry={
                    driverLocation
                      ? [driverLocation.lat, driverLocation.lng]
                      : [activeTrip.fromLat, activeTrip.fromLng]
                  }
                  properties={{ hintContent: `Груз: ${pct}% пути`, balloonContent: `<b>Ваш груз</b><br/>${pct}% пути` }}
                  options={{ preset: 'islands#blueCarIcon', iconColor: '#5ba3f5' }}
                />
              </Map>
            </YMaps>
          </div>
        ) : (
          <img alt="Карта маршрута" className="w-full h-full object-cover grayscale brightness-50"
            src="https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&h=1200&fit=crop" />
        )}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg,rgba(14,22,33,0.7) 0%,rgba(14,22,33,0) 20%,rgba(14,22,33,0) 60%,rgba(14,22,33,0.5) 100%)' }} />
      </div>

      {/* ── TOP NAV ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', paddingBottom: 12 }}>
        <button onClick={() => navigate(-1)}
          className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition-all">
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Center status pill */}
        <div className="flex-1 mx-3">
          <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#5ba3f5] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#5ba3f5]" />
              </span>
              <span className="text-[13px] font-bold text-white">Груз в пути · {pct}%</span>
            </div>
            <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#5ba3f5] to-emerald-400 transition-all duration-1000"
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <button onClick={() => navigate('/messages')}
          className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition-all">
          <MessageSquare className="w-5 h-5" />
        </button>
      </div>

      {/* ── BOTTOM SHEET ── */}
      <div
        ref={sheetRef}
        className="absolute left-0 right-0 bottom-0 z-40 rounded-t-3xl bg-[#060e1a] border-t border-white/[0.08] shadow-2xl"
        style={{
          transform: `translateY(calc(${sheetTranslate} + ${dragY}px))`,
          transition: isDragging.current ? 'none' : 'transform 0.4s cubic-bezier(0.32,0.72,0,1)',
          maxHeight: '88vh',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex flex-col items-center pt-3 pb-2 cursor-grab active:cursor-grabbing select-none"
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={() => setSheetState(s => s === 'expanded' ? 'peek' : s === 'peek' ? 'expanded' : 'peek')}
        >
          <div className="w-10 h-1 rounded-full bg-white/20 mb-1" />
          <span className="text-[10px] text-[#607080] font-medium">
            {sheetState === 'expanded' ? 'Свернуть' : 'Детали отправления'}
          </span>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-8 flex flex-col gap-3"
          style={{ maxHeight: 'calc(88vh - 48px)' }}>

          {/* ── Route progress card ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#5ba3f5]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Маршрут</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-[#607080]" />
                <span className="text-[11px] font-mono text-[#607080]">{elapsed}</span>
              </div>
            </div>

            {/* From → To */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full bg-[#5ba3f5] ring-3 ring-[#5ba3f5]/20 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[#607080] font-semibold">Откуда</p>
                <p className="text-[14px] font-extrabold text-white truncate">{routeFrom}</p>
              </div>
              <div className="shrink-0 px-2.5 py-1 rounded-xl bg-white/[0.05] text-center">
                <p className="text-[11px] font-black text-white">{totalDistanceKm > 0 ? totalDistanceKm : '—'} <span className="text-[9px] font-medium text-[#607080]">км</span></p>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-3 ring-emerald-400/20 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-[#607080] font-semibold">Куда</p>
                <p className="text-[14px] font-extrabold text-white truncate">{routeTo}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#607080]">Пройдено {Math.round(totalDistanceKm * displayProgress)} км</span>
                <span className="text-[11px] font-bold text-white">{pct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#5ba3f5] to-emerald-400 transition-all duration-1000 relative"
                  style={{ width: `${pct}%` }}>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#607080]">{routeFrom}</span>
                <span className="text-[10px] text-emerald-400 font-semibold">осталось {remainingKm > 0 ? remainingKm : '—'} км</span>
                <span className="text-[10px] text-[#607080]">{routeTo}</span>
              </div>
            </div>
          </div>

          {/* ── Статус-таймлайн ── */}
          {activeTrip && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Этапы доставки</span>
                {(currentStatus === 'delivered' || currentStatus === 'completed') && (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-[10px] font-black text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Доставлен
                  </span>
                )}
              </div>
              <div className="relative">
                <div className="absolute left-[14px] top-2 bottom-2 w-0.5 bg-white/[0.06]" />
                {STATUS_STEPS.map((step, i) => {
                  const curIdx = getStatusIndex(currentStatus);
                  const isDone = i < curIdx || currentStatus === 'delivered' || currentStatus === 'completed';
                  const isActive = i === curIdx && currentStatus !== 'delivered' && currentStatus !== 'completed';
                  const hist = statusHistory.find(h => h.status === step.key);
                  const ts = hist?.timestamp
                    ? new Date(hist.timestamp).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
                    : null;
                  return (
                    <div key={step.key} className="flex items-start gap-3 pb-3">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-sm z-10 relative shrink-0"
                        style={{
                          background: isDone ? '#10b98115' : isActive ? '#5ba3f515' : 'transparent',
                          border: `1.5px solid ${isDone ? '#10b981' : isActive ? '#5ba3f5' : '#1e3a55'}`,
                        }}
                      >
                        {isDone ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <span className="text-xs">{step.icon}</span>}
                      </div>
                      <div className="flex-1 pt-0.5">
                        <div className="text-[12px] font-semibold" style={{ color: isDone ? '#e2eaf4' : isActive ? '#fff' : '#607080' }}>
                          {step.label}
                        </div>
                        {ts && <div className="text-[10px] text-[#607080] mt-0.5">{ts}</div>}
                        {isActive && <div className="text-[10px] font-semibold text-[#5ba3f5] mt-0.5">Текущий статус</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── POD фото ── */}
          {podPhotos.length > 0 && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 mb-3">
                <Camera className="w-3.5 h-3.5 text-[#f97316]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Фото-подтверждение</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {podPhotos.map((p, i) => (
                  <button key={i} onClick={() => setSelectedPhoto(p.url)} className="relative rounded-xl overflow-hidden aspect-video border border-white/[0.08]">
                    <img src={p.url} alt={p.type} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-end p-1.5" style={{ background: 'linear-gradient(transparent,#060e1a99)' }}>
                      <span className="text-[9px] font-black text-white">{p.type === 'loading' ? '📦 Загрузка' : '✅ Выгрузка'}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Поделиться ссылкой ── */}
          {activeTrip && (
            <button
              onClick={handleShareLink}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-[13px] font-bold transition-all active:scale-[0.98]"
              style={{ background: '#5ba3f510', borderColor: '#5ba3f525', color: '#5ba3f5' }}
            >
              {linkCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              {linkCopied ? 'Скопировано!' : 'Поделиться трекингом'}
            </button>
          )}

          {/* ── Driver card ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className="relative shrink-0">
                {driver.avatar ? (
                  <div className="w-12 h-12 rounded-2xl bg-cover bg-center ring-2 ring-[#5ba3f5]/30"
                    style={{ backgroundImage: `url('${driver.avatar}')` }} />
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-[#1e2d3a] flex items-center justify-center ring-2 ring-[#5ba3f5]/30">
                    <span className="text-white text-lg font-black">{driver.name?.charAt(0) || '?'}</span>
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#060e1a] flex items-center justify-center">
                  <Truck className="w-3 h-3 text-amber-400" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-0.5">Водитель</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[14px] font-extrabold text-white truncate">{activeTrip ? driver.name : '—'}</p>
                  {activeTrip && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-black">
                      <Shield className="w-2.5 h-2.5" /> Верифицирован
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {activeTrip && driver.rating && (
                    <div className="flex items-center gap-0.5">
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                      <span className="text-[12px] font-bold text-white">{driver.rating}</span>
                    </div>
                  )}
                  {activeTrip && driver.vehicle && (
                    <span className="text-[11px] text-[#607080]">· {driver.vehicle}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-white/[0.06]">
              <button onClick={() => navigate('/messages')} disabled={!activeTrip}
                className="flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-[#5ba3f5] border-r border-white/[0.06] hover:bg-white/[0.04] disabled:opacity-40 active:scale-[0.97] transition-all">
                <MessageSquare className="w-4 h-4" /> Написать
              </button>
              {driver.phone ? (
                <a href={`tel:${driver.phone}`}
                  className="flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-[#607080] hover:text-white hover:bg-white/[0.04] active:scale-[0.97] transition-all">
                  <Phone className="w-4 h-4" /> Позвонить
                </a>
              ) : (
                <div className="flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-white/20">
                  <Phone className="w-4 h-4" /> Позвонить
                </div>
              )}
            </div>
          </div>

          {/* ── Cargo info ── */}
          {activeTrip && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-3">Мой груз</p>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5ba3f5]/15 border border-[#5ba3f5]/25 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5 text-[#5ba3f5]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-white">
                    {cargoInfo.type}{cargoInfo.weight ? ` · ${cargoInfo.weight} кг` : ''}
                  </p>
                  {cargoInfo.notes && <p className="text-[11px] text-[#607080] mt-0.5">{cargoInfo.notes}</p>}
                </div>
                {cargoInfo.price && cargoInfo.price !== 'undefined undefined' && (
                  <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
                    <p className="text-[13px] font-black text-emerald-400">{cargoInfo.price}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!activeTrip && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-5 flex flex-col items-center gap-2">
              <Package className="w-8 h-8 text-[#607080]" />
              <p className="text-[13px] font-bold text-white">Нет активных отправлений</p>
              <p className="text-[11px] text-[#607080] text-center">Отправьте оферту водителю, чтобы начать отслеживание</p>
              <button onClick={() => navigate('/search')}
                className="mt-1 px-4 py-2 rounded-xl bg-[#5ba3f5] text-white text-[13px] font-bold active:scale-[0.98] transition-all">
                Найти поездку
              </button>
            </div>
          )}

          {/* ── Emergency ── */}
          <button
            onClick={() => navigate('/help')}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-400 text-[13px] font-bold active:scale-[0.98] transition-all">
            <AlertTriangle className="w-4 h-4" /> Сообщить о проблеме
          </button>

          <div style={{ height: 'env(safe-area-inset-bottom, 8px)' }} />
        </div>
      </div>

      {/* ── Show sheet floating button ── */}
      <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-400 ${sheetState === 'hidden' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <button onClick={() => setSheetState('peek')}
          className="flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-white bg-[#5ba3f5] shadow-2xl shadow-[#5ba3f5]/30 active:scale-95 transition-all">
          <ChevronUp className="w-4 h-4" /> Показать детали
        </button>
      </div>
    </div>{/* end mobile */}

    {/* ── Photo fullscreen modal ── */}
    {selectedPhoto && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        style={{ background: '#000000cc', backdropFilter: 'blur(8px)' }}
        onClick={() => setSelectedPhoto(null)}
      >
        <img src={selectedPhoto} alt="POD" className="max-w-full max-h-[80vh] rounded-2xl object-contain" />
      </div>
    )}

    {/* ════════ DESKTOP ════════ */}
    <div className="hidden md:flex h-screen w-full overflow-hidden" style={{ background:'#080f1a' }}>
      <style>{`
        @keyframes stp-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes stp-pulse-blue { 0%,100%{box-shadow:0 0 0 0 #5ba3f530} 60%{box-shadow:0 0 0 8px #5ba3f500} }
        @keyframes stp-pulse-green { 0%,100%{box-shadow:0 0 0 0 #10b98130} 60%{box-shadow:0 0 0 8px #10b98100} }
        .stp-s1{animation:stp-in .4s cubic-bezier(.22,1,.36,1) .04s both}
        .stp-s2{animation:stp-in .4s cubic-bezier(.22,1,.36,1) .12s both}
        .stp-s3{animation:stp-in .4s cubic-bezier(.22,1,.36,1) .20s both}
        .stp-s4{animation:stp-in .4s cubic-bezier(.22,1,.36,1) .28s both}
        .stp-s5{animation:stp-in .4s cubic-bezier(.22,1,.36,1) .36s both}
        .stp-card { border-radius:20px; overflow:hidden; background:linear-gradient(145deg,#0e1e32,#0a1520); border:1px solid #1a2d42; }
        .stp-sec-label { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.16em; color:#3a5570; }
        .stp-action { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:13px; border-radius:16px; font-size:14px; font-weight:800; cursor:pointer; border:none; font-family:inherit; color:#fff; transition:transform .18s ease; }
        .stp-action:hover { transform:translateY(-2px); }
      `}</style>

      {/* ── MAP ── */}
      <div className="flex-1 relative">
        {activeTrip?.fromLat && activeTrip?.fromLng && activeTrip?.toLat && activeTrip?.toLng ? (
          <div className="w-full h-full">
            <YMaps query={{ apikey: YANDEX_MAPS_CONFIG.apiKey, lang: YANDEX_MAPS_CONFIG.lang, load: 'package.full' }}>
              <Map
                state={{ center: [(activeTrip.fromLat + activeTrip.toLat) / 2, (activeTrip.fromLng + activeTrip.toLng) / 2], zoom: 6 }}
                width="100%" height="100%"
                modules={['multiRouter.MultiRoute']}
                options={{ suppressMapOpenBlock: true }}
                instanceRef={(ref: any) => { if (ref && ref !== mapInstanceRef.current) { mapInstanceRef.current = ref; setMapInstance(ref); } }}
                onLoad={(ymaps: any) => { ymapsRef.current = ymaps; setYmapsApi(ymaps); }}
              >
                <Placemark
                  geometry={[activeTrip.fromLat + (activeTrip.toLat - activeTrip.fromLat) * displayProgress, activeTrip.fromLng + (activeTrip.toLng - activeTrip.fromLng) * displayProgress]}
                  properties={{ hintContent: `Груз: ${pct}% пути`, balloonContent: `<b>Ваш груз</b><br/>${pct}% пути` }}
                  options={{ preset: 'islands#blueCarIcon', iconColor: '#5ba3f5' }}
                />
              </Map>
            </YMaps>
          </div>
        ) : (
          <img alt="Карта маршрута" className="w-full h-full object-cover" style={{ filter:'grayscale(.6) brightness(.45)' }}
            src="https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&h=1200&fit=crop" />
        )}
        <div className="absolute inset-0 pointer-events-none" style={{ background:'linear-gradient(to right,transparent 70%,#080f1a 100%)' }} />

        {/* Back button */}
        <div className="absolute top-6 left-6 z-10">
          <button onClick={() => navigate(-1)} className="w-11 h-11 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-white/15 transition-all hover:scale-105" style={{ background:'#0a1520cc' }}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Status badge on map */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border border-[#5ba3f530]" style={{ background:'#5ba3f518' }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#5ba3f5', display:'inline-block', animation:'stp-pulse-blue 1.5s ease infinite' }} />
            <span style={{ fontSize:12, fontWeight:800, color:'#5ba3f5' }}>Груз в пути · {pct}%</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-y-auto" style={{ background:'#080f1a', borderLeft:'1px solid #0e1e32' }}>

        {/* Header */}
        <div className="stp-s1 px-6 pt-7 pb-5" style={{ borderBottom:'1px solid #0e1e32' }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width:8, height:8, borderRadius:'50%', background:'#5ba3f5', boxShadow:'0 0 8px #5ba3f5', display:'inline-block', animation:'stp-pulse-blue 1.5s ease infinite' }} />
            <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:'#5ba3f5' }}>Отслеживание груза</span>
          </div>
          <h1 style={{ fontSize:22, fontWeight:900, color:'#fff', lineHeight:1.2 }}>
            {activeTrip ? `${routeFrom} → ${routeTo}` : 'Нет активных отправлений'}
          </h1>
          <div className="flex items-center gap-3 mt-3">
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#ffffff0a', border:'1px solid #1a2d3d' }}>
              <Clock style={{ width:12, height:12, color:'#4a6580' }} />
              <span style={{ fontSize:12, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#7a9ab5' }}>{elapsed}</span>
            </div>
            {totalDistanceKm > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#5ba3f512', border:'1px solid #5ba3f530' }}>
                <Navigation style={{ width:12, height:12, color:'#5ba3f5' }} />
                <span style={{ fontSize:12, fontWeight:700, color:'#5ba3f5' }}>{totalDistanceKm} км</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 px-5 py-5 flex flex-col gap-4">

          {/* Progress card */}
          <div className="stp-s2 stp-card p-5">
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
              <div style={{ width:28, height:28, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', background:'#5ba3f518', border:'1px solid #5ba3f530' }}>
                <MapPin style={{ width:13, height:13, color:'#5ba3f5' }} />
              </div>
              <span className="stp-sec-label">Маршрут и прогресс</span>
            </div>

            <div style={{ display:'flex', gap:14, marginBottom:16 }}>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, paddingTop:4, flexShrink:0 }}>
                <div style={{ width:10, height:10, borderRadius:'50%', background:'#5ba3f5', boxShadow:'0 0 8px #5ba3f5' }} />
                <div style={{ width:2, flex:1, minHeight:28, background:'linear-gradient(180deg,#5ba3f5,#10b981)', borderRadius:1 }} />
                <div style={{ width:10, height:10, borderRadius:'50%', background:'#10b981', boxShadow:'0 0 8px #10b981' }} />
              </div>
              <div style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'space-between', gap:12 }}>
                <div>
                  <p style={{ fontSize:10, fontWeight:700, color:'#5ba3f5', opacity:.7, marginBottom:2 }}>ОТКУДА</p>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{routeFrom}</p>
                </div>
                <div>
                  <p style={{ fontSize:10, fontWeight:700, color:'#10b981', opacity:.7, marginBottom:2 }}>КУДА</p>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{routeTo}</p>
                </div>
              </div>
              {totalDistanceKm > 0 && (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'8px 12px', borderRadius:14, background:'#ffffff08', border:'1px solid #1a2d3d', flexShrink:0 }}>
                  <p style={{ fontSize:18, fontWeight:900, color:'#fff', lineHeight:1 }}>{totalDistanceKm}</p>
                  <p style={{ fontSize:10, color:'#4a6580' }}>км</p>
                </div>
              )}
            </div>

            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                <span style={{ fontSize:12, color:'#4a6580' }}>Пройдено {Math.round(totalDistanceKm * displayProgress)} км</span>
                <span style={{ fontSize:13, fontWeight:900, color:'#5ba3f5' }}>{pct}%</span>
              </div>
              <div style={{ height:8, borderRadius:4, background:'#0a1520', overflow:'hidden', position:'relative' }}>
                <div style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,#5ba3f5,#10b981)', width:`${pct}%`, transition:'width .3s ease', position:'relative' }}>
                  <div style={{ position:'absolute', right:-4, top:'50%', transform:'translateY(-50%)', width:12, height:12, borderRadius:'50%', background:'#fff', boxShadow:'0 0 8px #5ba3f580' }} />
                </div>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
                <span style={{ fontSize:10, color:'#2a4060' }}>{routeFrom}</span>
                <span style={{ fontSize:10, fontWeight:700, color:'#10b981' }}>осталось {remainingKm > 0 ? remainingKm : '—'} км</span>
                <span style={{ fontSize:10, color:'#2a4060' }}>{routeTo}</span>
              </div>
            </div>
          </div>

          {/* Driver card */}
          <div className="stp-s3 stp-card overflow-hidden">
            <div style={{ padding:'16px 18px', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ position:'relative', flexShrink:0 }}>
                {driver.avatar ? (
                  <div style={{ width:48, height:48, borderRadius:16, backgroundImage:`url('${driver.avatar}')`, backgroundSize:'cover', backgroundPosition:'center', border:'2px solid #5ba3f530' }} />
                ) : (
                  <div style={{ width:48, height:48, borderRadius:16, background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ color:'#fff', fontWeight:900, fontSize:18 }}>{driver.name?.charAt(0)||'?'}</span>
                  </div>
                )}
                <div style={{ position:'absolute', bottom:-3, right:-3, width:18, height:18, borderRadius:6, background:'#f59e0b', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #080f1a' }}>
                  <Truck style={{ width:9, height:9, color:'#fff' }} />
                </div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p className="stp-sec-label mb-1">Водитель</p>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{activeTrip ? driver.name : '—'}</p>
                  {activeTrip && <span style={{ fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:6, background:'#10b98118', color:'#10b981', textTransform:'uppercase' }}>Верифицирован</span>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                  {driver.rating && activeTrip && (
                    <>
                      <Star style={{ width:12, height:12, color:'#f59e0b', fill:'#f59e0b' }} />
                      <span style={{ fontSize:12, fontWeight:800, color:'#fff' }}>{driver.rating}</span>
                    </>
                  )}
                  {driver.vehicle && activeTrip && <span style={{ fontSize:12, color:'#4a6580' }}>· {driver.vehicle}</span>}
                </div>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', borderTop:'1px solid #0e1e32' }}>
              <button onClick={() => navigate('/messages')} disabled={!activeTrip}
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'12px', fontSize:13, fontWeight:700, color:'#5ba3f5', background:'none', border:'none', borderRight:'1px solid #0e1e32', cursor:'pointer', fontFamily:'inherit', transition:'background .15s', opacity:!activeTrip ? 0.5 : 1 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='#5ba3f508'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='none'}>
                <MessageSquare style={{ width:15, height:15 }} /> Написать
              </button>
              {driver.phone ? (
                <a href={`tel:${driver.phone}`}
                  style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'12px', fontSize:13, fontWeight:700, color:'#4a6580', textDecoration:'none', transition:'color .15s, background .15s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color='#fff'; (e.currentTarget as HTMLElement).style.background='#ffffff08'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color='#4a6580'; (e.currentTarget as HTMLElement).style.background='none'; }}>
                  <Phone style={{ width:15, height:15 }} /> Позвонить
                </a>
              ) : (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'12px', fontSize:13, fontWeight:700, color:'#1e2d3d' }}>
                  <Phone style={{ width:15, height:15 }} /> Позвонить
                </div>
              )}
            </div>
          </div>

          {/* Cargo card */}
          {activeTrip && (
            <div className="stp-s4 stp-card p-5">
              <p className="stp-sec-label mb-4">Мой груз</p>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:14, background:'#5ba3f518', border:'1px solid #5ba3f530', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Package style={{ width:20, height:20, color:'#5ba3f5' }} />
                </div>
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{cargoInfo.type}{cargoInfo.weight ? ` · ${cargoInfo.weight} кг` : ''}</p>
                  {cargoInfo.notes && <p style={{ fontSize:12, color:'#4a6580', marginTop:3 }}>{cargoInfo.notes}</p>}
                </div>
                {cargoInfo.price && cargoInfo.price !== 'undefined undefined' && (
                  <div style={{ flexShrink:0, padding:'7px 12px', borderRadius:12, background:'#10b98115', border:'1px solid #10b98125' }}>
                    <p style={{ fontSize:13, fontWeight:900, color:'#10b981' }}>{cargoInfo.price}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!activeTrip && (
            <div className="stp-s4 stp-card p-6 flex flex-col items-center gap-3 text-center">
              <div style={{ width:52, height:52, borderRadius:18, display:'flex', alignItems:'center', justifyContent:'center', background:'#1a2d42' }}>
                <Package style={{ width:24, height:24, color:'#2a4060' }} />
              </div>
              <p style={{ fontSize:15, fontWeight:800, color:'#fff' }}>Нет активных отправлений</p>
              <p style={{ fontSize:12, color:'#4a6580', lineHeight:1.6 }}>Отправьте оферту водителю, чтобы начать отслеживание</p>
              <button onClick={() => navigate('/search')} className="stp-action" style={{ background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', boxShadow:'0 8px 24px #1d4ed840', marginTop:4, width:'auto', padding:'10px 24px' }}>
                Найти поездку
              </button>
            </div>
          )}

          {/* Emergency */}
          <div className="stp-s5 flex flex-col gap-3">
            <button className="stp-action" style={{ background:'#0a1520', border:'1px solid #ef444430', color:'#ef4444' }}
              onClick={() => navigate('/help')}>
              <AlertTriangle style={{ width:16, height:16 }} /> Сообщить о проблеме
            </button>
          </div>

        </div>
      </div>
    </div>
    </div>
  );
}
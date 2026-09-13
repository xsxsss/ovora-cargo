/**
 * DriverTrackingPage — страница отслеживания для ВОДИТЕЛЯ.
 * GPS-геолокация в реальном времени, запись координат на сервер.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ArrowLeft, Navigation, MessageSquare, AlertTriangle,
  Phone, Truck, MapPin, Shield, Package,
  ChevronUp, Zap, CheckCircle2, Clock, LocateFixed, XCircle,
  Camera, Share2, ChevronRight, Link,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { YMaps, Map, Placemark } from 'react-yandex-maps';
import { YANDEX_MAPS_CONFIG } from '../config/yandex';
import {
  updateDriverLocation, completeShipment, updateShipmentStatus,
  uploadPODPhoto, getPublicTrackingLink, getActiveShipment,
  type ShipmentStatus,
} from '../api/trackingApi';
import { updateTrip, getOffersForTrip } from '../api/dataApi';
import { cleanAddress } from '../utils/addressUtils';
import { calculateDistance } from '@/utils/geolocation';
import { useTrips } from '../contexts/TripsContext';
import { useUser } from '../contexts/UserContext';
import { toast } from 'sonner';

// ── Статусы груза — порядок и конфиг ──────────────────────────────────────────
const STATUS_FLOW: { key: ShipmentStatus; label: string; icon: string; action: string }[] = [
  { key: 'pending',    label: 'Ожидает',   icon: '⏳', action: 'Начать загрузку' },
  { key: 'loaded',     label: 'Загружен',  icon: '📦', action: 'Отправиться в путь' },
  { key: 'inProgress', label: 'В пути',    icon: '🚚', action: 'Таможенный контроль' },
  { key: 'customs',    label: 'Таможня',   icon: '🛂', action: 'Доехал' },
  { key: 'arrived',    label: 'Прибыл',    icon: '📍', action: 'Груз доставлен' },
  { key: 'delivered',  label: 'Доставлен', icon: '✅', action: '' },
];

function getNextStatus(current: ShipmentStatus): ShipmentStatus | null {
  const idx = STATUS_FLOW.findIndex(s => s.key === current);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1].key;
}

function getStatusConfig(status: ShipmentStatus) {
  return STATUS_FLOW.find(s => s.key === status) || STATUS_FLOW[0];
}

export function DriverTrackingPage() {
  const navigate = useNavigate();
  const [sheetState, setSheetState] = useState<'peek' | 'expanded' | 'hidden'>('expanded');
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<'denied' | 'unavailable' | null>(null);
  // ✅ FIX N-4: трекинг времени последнего GPS-обновления для обнаружения потери сигнала
  const lastGpsTsRef = useRef<number>(0);
  const [gpsLost, setGpsLost] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geoWatchId = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const isDragging = useRef(false);

  const mapInstanceRef = useRef<any>(null);
  const ymapsRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const [mapInstance, setMapInstance] = useState<any>(null);
  const [ymapsApi, setYmapsApi] = useState<any>(null);

  const { activeTrip } = useTrips();
  const { user } = useUser();
  const driverEmail = user?.email || sessionStorage.getItem('ovora_user_email') || '';

  // Статус груза и статус-апдейт
  const [currentStatus, setCurrentStatus] = useState<ShipmentStatus>('pending');
  const [statusUpdating, setStatusUpdating] = useState(false);
  // POD фото
  const [podUploading, setPodUploading] = useState<'loading' | 'unloading' | null>(null);
  const [podPhotos, setPodPhotos] = useState<{ type: string; url: string; timestamp: string }[]>([]);
  const podInputRef = useRef<HTMLInputElement>(null);
  const podTypeRef = useRef<'loading' | 'unloading'>('loading');
  // Копирование ссылки
  const [linkCopied, setLinkCopied] = useState(false);
  // ── Принятые оферты: реальные данные груза/мест берём из них, не из самого Trip ──
  // (на одной поездке может быть несколько отправителей с разными accepted-офферами)
  const [acceptedOffers, setAcceptedOffers] = useState<any[]>([]);
  const [selectedOfferIdx, setSelectedOfferIdx] = useState(0);
  const acceptedOffer = acceptedOffers[selectedOfferIdx] || null;

  // ✅ FIX S-1: localStorage fallback — если контекст ещё не загружен,
  // используем данные из 'ovora_active_shipment' (записывается при старте поездки)
  const effectiveTrip = useMemo(() => {
    if (activeTrip) return activeTrip;
    try {
      const raw = localStorage.getItem('ovora_active_shipment');
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  }, [activeTrip]);

  // ── Подгружаем принятую оферту — в ней реальные цена/места/груз, а не в Trip ──
  useEffect(() => {
    if (!effectiveTrip?.id) { setAcceptedOffers([]); setSelectedOfferIdx(0); return; }
    let cancelled = false;
    getOffersForTrip(effectiveTrip.id).then(offers => {
      if (cancelled) return;
      setAcceptedOffers(offers.filter((o: any) => o.status === 'accepted'));
      setSelectedOfferIdx(0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [effectiveTrip?.id]);

  // Загружаем актуальный статус при монтировании
  useEffect(() => {
    if (!effectiveTrip?.id || !driverEmail) return;
    getActiveShipment(effectiveTrip.id, driverEmail).then(s => {
      if (s?.status) setCurrentStatus(s.status as ShipmentStatus);
      if (s?.podPhotos?.length) setPodPhotos(s.podPhotos as any);
    }).catch(() => {});
  }, [effectiveTrip?.id, driverEmail]);

  // Смена статуса груза
  const handleStatusUpdate = useCallback(async (nextStatus: ShipmentStatus) => {
    if (!effectiveTrip?.id || statusUpdating) return;
    setStatusUpdating(true);
    try {
      const updated = await updateShipmentStatus(effectiveTrip.id, nextStatus, driverEmail);
      if (updated) {
        setCurrentStatus(nextStatus);
        const cfg = getStatusConfig(nextStatus);
        toast.success(`Статус: ${cfg.label} ${cfg.icon}`);
      } else {
        toast.error('Не удалось обновить статус');
      }
    } catch {
      toast.error('Ошибка обновления статуса');
    } finally {
      setStatusUpdating(false);
    }
  }, [effectiveTrip?.id, statusUpdating, user]);

  // POD — выбор типа и открытие камеры
  const handlePODCapture = useCallback((type: 'loading' | 'unloading') => {
    podTypeRef.current = type;
    podInputRef.current?.click();
  }, []);

  // POD — загрузка фото на сервер
  const handlePODFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !effectiveTrip?.id) return;
    const type = podTypeRef.current;
    setPodUploading(type);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const photo = await uploadPODPhoto(effectiveTrip.id, base64, type, driverEmail);
        if (photo) {
          setPodPhotos(prev => [...prev, photo as any]);
          toast.success(type === 'loading' ? '📦 Фото загрузки отправлено' : '✅ Фото выгрузки отправлено');
        } else {
          toast.error('Не удалось загрузить фото');
        }
        setPodUploading(null);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error('Ошибка загрузки фото');
      setPodUploading(null);
    }
    // Сброс input для повторного выбора
    if (e.target) e.target.value = '';
  }, [effectiveTrip?.id, user]);

  // Поделиться публичной ссылкой
  const handleShareLink = useCallback(() => {
    if (!effectiveTrip?.id) return;
    const link = getPublicTrackingLink(effectiveTrip.id);
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopied(true);
      toast.success('Ссылка скопирована! Отправьте получателю груза');
      setTimeout(() => setLinkCopied(false), 3000);
    }).catch(() => {
      // Fallback for old browsers
      const el = document.createElement('textarea');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      toast.success('Ссылка скопирована!');
    });
  }, [effectiveTrip?.id]);

  // ── GPS: запрашиваем автоматически — браузер сам покажет диалог ───────────
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('unavailable');
      return;
    }
    setGeoError(null);
    geoWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setDriverLocation({ lat: latitude, lng: longitude });
        setGeoError(null);
        // ✅ FIX N-4: обновляем timestamp последнего GPS-сигнала
        lastGpsTsRef.current = Date.now();
        setGpsLost(false);
        if (effectiveTrip?.id && driverEmail) {
          updateDriverLocation(effectiveTrip.id, latitude, longitude, driverEmail, accuracy).catch(() => {});
        }
      },
      (err) => {
        // ✅ FIX S-4: обрабатываем все типы ошибок GPS
        if (err.code === err.PERMISSION_DENIED) setGeoError('denied');
        else setGeoError('unavailable'); // TIMEOUT или POSITION_UNAVAILABLE
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
    return () => {
      if (geoWatchId.current !== null) navigator.geolocation.clearWatch(geoWatchId.current);
    };
  }, [effectiveTrip?.id, driverEmail]);

  // ── Retry: повторный запрос геолокации ────────────────────────────────────
  const retryGeo = () => {
    if (geoWatchId.current !== null) navigator.geolocation.clearWatch(geoWatchId.current);
    setGeoError(null);
    geoWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        setDriverLocation({ lat: latitude, lng: longitude });
        setGeoError(null);
        if (effectiveTrip?.id && driverEmail) updateDriverLocation(effectiveTrip.id, latitude, longitude, driverEmail, accuracy).catch(() => {});
      },
      (err) => {
        // ✅ FIX S-4: обрабатываем все типы ошибок GPS
        if (err.code === err.PERMISSION_DENIED) setGeoError('denied');
        else setGeoError('unavailable');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  // ── Маршрут на карте ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapInstance || !ymapsApi || !effectiveTrip?.fromLat) return;
    if (routeRef.current) {
      try { mapInstance.geoObjects.remove(routeRef.current); } catch (_) {}
    }
    const multiRoute = new ymapsApi.multiRouter.MultiRoute(
      {
        referencePoints: [
          [effectiveTrip.fromLat, effectiveTrip.fromLng],
          [effectiveTrip.toLat, effectiveTrip.toLng],
        ],
        params: { routingMode: 'auto' },
      },
      {
        routeActiveStrokeColor: '#5ba3f5',
        routeActiveStrokeWidth: 5,
        routeStrokeColor: '#334155',
        routeStrokeWidth: 3,
        boundsAutoApply: true,
        pinVisible: false,
      }
    );
    routeRef.current = multiRoute;
    mapInstance.geoObjects.add(multiRoute);
    return () => {
      try { mapInstance.geoObjects.remove(multiRoute); } catch (_) {}
    };
  }, [mapInstance, ymapsApi]);

  // ── Таймер ────────────────────────────────────────────────────────────────
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsedSecs(s => s + 1);
      // ✅ FIX N-4: если был GPS и прошло > 30 сек без обновления — сигнал потерян
      if (lastGpsTsRef.current > 0 && Date.now() - lastGpsTsRef.current > 30_000) {
        setGpsLost(true);
      }
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const totalDistanceKm = effectiveTrip
    ? calculateDistance(effectiveTrip.fromLat, effectiveTrip.fromLng, effectiveTrip.toLat, effectiveTrip.toLng)
    : 0;

  const routeFrom = cleanAddress(effectiveTrip?.from || '');
  const routeTo = cleanAddress(effectiveTrip?.to || '');

  let displayProgress = 0;
  if (driverLocation && effectiveTrip && totalDistanceKm > 0) {
    const d = calculateDistance(effectiveTrip.fromLat, effectiveTrip.fromLng, driverLocation.lat, driverLocation.lng);
    displayProgress = Math.max(0, Math.min(1, d / totalDistanceKm));
  }
  const pct = Math.round(displayProgress * 100);
  const remainingKm = Math.round(totalDistanceKm * (1 - displayProgress));

  const elapsed = `${String(Math.floor(elapsedSecs / 3600)).padStart(2, '0')}:${String(Math.floor((elapsedSecs % 3600) / 60)).padStart(2, '0')}:${String(elapsedSecs % 60).padStart(2, '0')}`;

  const cargoInfo = effectiveTrip
    ? {
        type: acceptedOffer?.cargoType || effectiveTrip.cargoType || 'Груз',
        weight: acceptedOffer?.weight || effectiveTrip.weight,
        price: acceptedOffer?.price ? `${acceptedOffer.price} ${acceptedOffer.currency || 'TJS'}` : '',
        notes: acceptedOffer?.notes || effectiveTrip.notes,
        seats: acceptedOffer?.requestedSeats || 0,
        children: acceptedOffer?.requestedChildren || 0,
        cargoKg: acceptedOffer?.requestedCargo || 0,
      }
    : { type: '—', weight: '', price: '', notes: '', seats: 0, children: 0, cargoKg: 0 };

  const capacityStr = [
    cargoInfo.seats > 0 ? `${cargoInfo.seats} взр.` : '',
    cargoInfo.children > 0 ? `${cargoInfo.children} дет.` : '',
    cargoInfo.cargoKg > 0 ? `${cargoInfo.cargoKg} кг груза` : '',
  ].filter(Boolean).join(' + ');

  const contactPerson = effectiveTrip
    ? {
        name: acceptedOffer?.senderName || effectiveTrip.contactName || effectiveTrip.senderName || 'Отправитель',
        phone: acceptedOffer?.senderPhone || effectiveTrip.senderPhone || effectiveTrip.contactPhone || '',
        avatar: acceptedOffer?.senderAvatar || effectiveTrip.contactAvatar || '',
      }
    : { name: '—', phone: '', avatar: '' };

  // ── Sheet drag ─────────────────────────────────────────────────────────────
  const onSheetTouchStart = (e: React.TouchEvent) => { dragStartY.current = e.touches[0].clientY; isDragging.current = true; setDragY(0); };
  const onSheetTouchMove = (e: React.TouchEvent) => { if (!isDragging.current) return; setDragY(Math.max(0, e.touches[0].clientY - dragStartY.current)); };
  const onSheetTouchEnd = () => {
    isDragging.current = false;
    if (dragY > 80) setSheetState(s => s === 'expanded' ? 'peek' : 'hidden');
    else if (dragY < -60) setSheetState('expanded');
    setDragY(0);
  };

  const sheetTranslate = sheetState === 'hidden' ? '100%' : sheetState === 'expanded' ? '0%' : '52%';

  // ✅ FIX: «Завершить поездку» закрывала рейс независимо от того, прошёл ли
  // груз таможню и есть ли фото загрузки/выгрузки — кнопка была активна сразу
  // со старта поездки. Теперь требуем полное прохождение этапов (до статуса
  // 'delivered', который достижим только последовательно через таможню) и оба
  // фото-подтверждения.
  const missingCompletionSteps = useMemo(() => {
    const missing: string[] = [];
    if (currentStatus !== 'delivered') missing.push('пройти все этапы доставки (включая таможню)');
    if (!podPhotos.some(p => p.type === 'loading')) missing.push('фото загрузки');
    if (!podPhotos.some(p => p.type === 'unloading')) missing.push('фото выгрузки');
    return missing;
  }, [currentStatus, podPhotos]);

  // ── Завершить поездку: закрыть shipment на сервере, затем перейти ─────────
  const handleCompleteTrip = async () => {
    if (missingCompletionSteps.length > 0) {
      toast.error(`Перед завершением поездки нужно: ${missingCompletionSteps.join(', ')}`);
      return;
    }
    if (effectiveTrip?.id) {
      try {
        await completeShipment(effectiveTrip.id, driverEmail);
      } catch {
        toast.error('Не удалось закрыть отправление на сервере');
        return;
      }
      try {
        await updateTrip(effectiveTrip.id, { status: 'completed', completedAt: new Date().toISOString() });
        window.dispatchEvent(new Event('ovora_trip_update'));
      } catch {
        toast.error('Не удалось обновить статус поездки');
        return;
      }
    }
    navigate('/trips');
  };

  return (
    <div className="font-['Sora'] bg-[#060e1a] text-white min-h-screen">

    {/* ════════ MOBILE (не трогаем) ════════ */}
    <div className="md:hidden relative h-dvh w-full flex flex-col overflow-hidden">

      {/* ── MAP ── */}
      <div className="absolute inset-0 z-0">
        {effectiveTrip?.fromLat && effectiveTrip?.fromLng && effectiveTrip?.toLat && effectiveTrip?.toLng ? (
          <div className="w-full h-full relative">
            <YMaps query={{ apikey: YANDEX_MAPS_CONFIG.apiKey, lang: YANDEX_MAPS_CONFIG.lang, load: 'package.full' }}>
              <Map
                state={{ center: [(effectiveTrip.fromLat + effectiveTrip.toLat) / 2, (effectiveTrip.fromLng + effectiveTrip.toLng) / 2], zoom: 6 }}
                width="100%" height="100%"
                modules={['multiRouter.MultiRoute']}
                options={{ suppressMapOpenBlock: true }}
                instanceRef={(ref: any) => { if (ref && ref !== mapInstanceRef.current) { mapInstanceRef.current = ref; setMapInstance(ref); } }}
                onLoad={(ymaps: any) => { ymapsRef.current = ymaps; setYmapsApi(ymaps); }}
              >
                <Placemark
                  geometry={driverLocation
                    ? [driverLocation.lat, driverLocation.lng]
                    : [effectiveTrip.fromLat, effectiveTrip.fromLng]}
                  properties={{ hintContent: driverLocation ? `GPS: ${pct}%` : 'Старт', balloonContent: driverLocation ? `<b>LIVE GPS</b><br/>${pct}% пути` : '<b>Начальная точка</b>' }}
                  options={{ preset: 'islands#blueCarIcon', iconColor: driverLocation ? '#10b981' : '#5ba3f5' }}
                />
              </Map>
            </YMaps>
          </div>
        ) : (
          <img alt="Карта маршрута" className="w-full h-full object-cover grayscale brightness-50"
            src="https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&h=1200&fit=crop" />
        )}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(180deg,#060e1a66 0%,transparent 20%,transparent 60%,#060e1a80 100%)' }} />
      </div>

      {/* ── TOP NAV ── */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top, 16px))', paddingBottom: 12 }}>
        <button onClick={() => navigate(-1)}
          className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition-all">
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex-1 mx-3">
          <div className="flex flex-col items-center gap-1 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-2.5">
            <div className="flex items-center gap-2">
              {driverLocation ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                  <span className="text-[13px] font-bold text-white">В пути · {pct}%</span>
                </>
              ) : (
                <>
                  <LocateFixed className="w-3.5 h-3.5 text-[#5ba3f5] animate-pulse" />
                  <span className="text-[13px] font-bold text-[#8a9bb0]">Поиск GPS...</span>
                </>
              )}
            </div>
            <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#5ba3f5] to-emerald-400 transition-all duration-1000"
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShareLink}
            className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition-all"
            title="Поделиться ссылкой трекинга"
          >
            {linkCopied ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Link className="w-5 h-5" />}
          </button>
          <button onClick={() => navigate('/messages')}
            className="w-11 h-11 rounded-2xl flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/15 text-white active:scale-90 transition-all">
            <MessageSquare className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── GPS статус-бейдж ── */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20">
        {driverLocation && !gpsLost ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 backdrop-blur-md border border-emerald-400/30">
            <Zap className="w-3 h-3 text-emerald-400" />
            <span className="text-[11px] font-bold text-emerald-300">LIVE GPS</span>
          </div>
        ) : driverLocation && gpsLost ? (
          // ✅ FIX N-4: GPS-сигнал был, но потерян
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/20 backdrop-blur-md border border-amber-400/30">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="text-[11px] font-bold text-amber-300">Сигнал потерян</span>
          </div>
        ) : geoError === 'denied' ? (
          /* ── Баннер: доступ запрещён ── */
          <div className="flex flex-col items-center gap-2 px-4 py-3 rounded-2xl bg-black/80 backdrop-blur-md border border-rose-500/30 max-w-[300px]">
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="text-[12px] font-bold text-white">Геолокация заблокирована</span>
            </div>
            <div className="w-full flex flex-col gap-1.5 text-[11px] text-[#8a9bb0] leading-relaxed">
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-black text-white">1.</span>
                <span>Нажмите <strong className="text-white">🔒</strong> или <strong className="text-white">ⓘ</strong> в адресной строке браузера</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-black text-white">2.</span>
                <span>Найдите <strong className="text-white">«Геолокация»</strong> → выберите <strong className="text-white">«Разрешить»</strong></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 font-black text-white">3.</span>
                <span>Нажмите кнопку ниже</span>
              </div>
            </div>
            <button onClick={() => window.location.reload()}
              className="w-full py-2 rounded-xl bg-[#5ba3f5] text-white text-[12px] font-bold active:scale-95 transition-all">
              Перезагрузить страницу
            </button>
            <button onClick={() => window.open(window.location.href, '_blank')}
              className="w-full py-1.5 rounded-xl border border-white/10 text-[#607080] text-[11px] font-semibold active:scale-95 transition-all">
              Открыть в новой вкладке
            </button>
          </div>
        ) : geoError === 'unavailable' ? (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
            <XCircle className="w-3 h-3 text-[#607080]" />
            <span className="text-[11px] font-bold text-[#607080]">GPS недоступен</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
            <LocateFixed className="w-3 h-3 text-[#5ba3f5] animate-pulse" />
            <span className="text-[11px] font-bold text-[#8a9bb0]">Определение позиции...</span>
          </div>
        )}
      </div>

      {/* ── BOTTOM SHEET ── */}
      <div
        ref={sheetRef}
        className="absolute left-0 right-0 bottom-0 z-40 rounded-t-3xl bg-[#060e1a] border-t border-white/[0.08] shadow-2xl"
        style={{
          transform: `translateY(calc(${sheetTranslate} + ${dragY}px))`,
          transition: isDragging.current ? 'none' : 'transform 0.4s cubic-bezier(0.32,0.72,0,1)',
          maxHeight: '88dvh',
        }}
      >
        <div
          className="flex flex-col items-center pt-3 pb-2 cursor-grab active:cursor-grabbing select-none"
          onTouchStart={onSheetTouchStart}
          onTouchMove={onSheetTouchMove}
          onTouchEnd={onSheetTouchEnd}
          onClick={() => setSheetState(s => s === 'expanded' ? 'peek' : s === 'peek' ? 'expanded' : 'peek')}
        >
          <div className="w-10 h-1 rounded-full bg-white/20 mb-1" />
          <span className="text-[10px] text-[#607080] font-medium">
            {sheetState === 'expanded' ? 'Свернуть' : 'Детали поездки'}
          </span>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 pb-8 flex flex-col gap-3"
          style={{ maxHeight: 'calc(88dvh - 48px)' }}>

          {/* ── Route progress card ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#5ba3f5]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Маршрут</span>
              </div>
              <div className="flex items-center gap-2">
                {driverLocation ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/25 text-[9px] font-black text-emerald-400">
                    <Zap className="w-2.5 h-2.5" /> LIVE GPS
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[9px] font-bold text-[#607080]">
                    <Clock className="w-2.5 h-2.5" /> {elapsed}
                  </span>
                )}
              </div>
            </div>

            {!effectiveTrip ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <Navigation className="w-8 h-8 text-[#607080]" />
                <p className="text-[13px] font-bold text-[#607080]">Нет активной поездки</p>
                <p className="text-[11px] text-[#607080]/60">Выберите заказ, чтобы начать маршрут</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#5ba3f5] ring-3 ring-[#5ba3f5]/20" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[#607080] font-semibold">Откуда</p>
                    <p className="text-[14px] font-extrabold text-white truncate">{routeFrom}</p>
                  </div>
                  <div className="shrink-0 px-2.5 py-1 rounded-xl bg-white/[0.05] text-center">
                    <p className="text-[11px] font-black text-white">
                      {totalDistanceKm > 0 ? totalDistanceKm : '—'}{' '}
                      <span className="text-[9px] font-medium text-[#607080]">км</span>
                    </p>
                  </div>
                  <div className="flex flex-col items-center shrink-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 ring-3 ring-emerald-400/20" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[#607080] font-semibold">Куда</p>
                    <p className="text-[14px] font-extrabold text-white truncate">{routeTo}</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#607080]">
                      {driverLocation ? `Пройдено ${Math.round(totalDistanceKm * displayProgress)} км` : 'Ожидание GPS...'}
                    </span>
                    <span className="text-[11px] font-bold text-white">{driverLocation ? `${pct}%` : '—'}</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#5ba3f5] to-emerald-400 transition-all duration-1000 relative"
                      style={{ width: driverLocation ? `${pct}%` : '0%' }}>
                      {driverLocation && pct > 5 && (
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg" />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-[#607080]">{routeFrom}</span>
                    <span className="text-[10px] text-emerald-400 font-semibold">
                      {driverLocation && remainingKm > 0 ? `осталось ${remainingKm} км` : '—'}
                    </span>
                    <span className="text-[10px] text-[#607080]">{routeTo}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Статус груза ── */}
          {effectiveTrip && (() => {
            const cfg = getStatusConfig(currentStatus);
            const next = getNextStatus(currentStatus);
            const nextCfg = next ? getStatusConfig(next) : null;
            const isLast = currentStatus === 'delivered' || currentStatus === 'completed';
            return (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Статус груза</span>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: isLast ? '#10b98115' : '#5ba3f515', border: `1px solid ${isLast ? '#10b98125' : '#5ba3f525'}` }}>
                    <span className="text-sm">{cfg.icon}</span>
                    <span className="text-[11px] font-black" style={{ color: isLast ? '#10b981' : '#5ba3f5' }}>{cfg.label}</span>
                  </div>
                </div>

                {/* Прогресс шагов */}
                <div className="flex items-center gap-1 mb-3">
                  {STATUS_FLOW.slice(0, 6).map((s, i) => {
                    const _sCfg = getStatusConfig(currentStatus);
                    const curIdx = STATUS_FLOW.findIndex(x => x.key === currentStatus);
                    const done = i <= curIdx;
                    return (
                      <div key={s.key} className="flex-1 h-1 rounded-full transition-all" style={{ background: done ? (isLast ? '#10b981' : '#5ba3f5') : '#1e3a55' }} />
                    );
                  })}
                </div>

                {/* Кнопка следующего статуса */}
                {nextCfg && !isLast && (
                  <button
                    onClick={() => handleStatusUpdate(next!)}
                    disabled={statusUpdating}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] font-bold transition-all active:scale-[0.98] disabled:opacity-60"
                    style={{ background: '#5ba3f5', color: '#fff' }}
                  >
                    {statusUpdating ? (
                      <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    ) : (
                      <>
                        <span>{nextCfg.icon}</span>
                        <span>{cfg.action}</span>
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                )}
                {isLast && (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-[13px] font-bold text-emerald-400">Груз доставлен!</span>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── POD — Фото-подтверждение ── */}
          {effectiveTrip && (
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">Фото-подтверждение</span>
                {podPhotos.length > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-400">{podPhotos.length} фото</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handlePODCapture('loading')}
                  disabled={!!podUploading}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-white/[0.08] text-[12px] font-bold transition-all active:scale-[0.97] disabled:opacity-60"
                  style={{ background: podPhotos.some(p => p.type === 'loading') ? '#5ba3f510' : '#ffffff05' }}
                >
                  {podUploading === 'loading' ? (
                    <div className="w-5 h-5 rounded-full border-2 border-[#5ba3f5]/30 border-t-[#5ba3f5] animate-spin" />
                  ) : podPhotos.some(p => p.type === 'loading') ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Camera className="w-5 h-5 text-[#5ba3f5]" />
                  )}
                  <span style={{ color: podPhotos.some(p => p.type === 'loading') ? '#10b981' : '#8a9bb0' }}>
                    {podPhotos.some(p => p.type === 'loading') ? 'Загрузка ✓' : 'Фото загрузки'}
                  </span>
                </button>
                <button
                  onClick={() => handlePODCapture('unloading')}
                  disabled={!!podUploading}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-white/[0.08] text-[12px] font-bold transition-all active:scale-[0.97] disabled:opacity-60"
                  style={{ background: podPhotos.some(p => p.type === 'unloading') ? '#10b98110' : '#ffffff05' }}
                >
                  {podUploading === 'unloading' ? (
                    <div className="w-5 h-5 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
                  ) : podPhotos.some(p => p.type === 'unloading') ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <Camera className="w-5 h-5 text-emerald-400" />
                  )}
                  <span style={{ color: podPhotos.some(p => p.type === 'unloading') ? '#10b981' : '#8a9bb0' }}>
                    {podPhotos.some(p => p.type === 'unloading') ? 'Выгрузка ✓' : 'Фото выгрузки'}
                  </span>
                </button>
              </div>
              {/* Превью загруженных фото */}
              {podPhotos.length > 0 && (
                <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                  {podPhotos.map((p, i) => (
                    <div key={i} className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-white/[0.08]">
                      <img src={p.url} alt={p.type} className="w-full h-full object-cover" />
                      <div className="absolute bottom-0.5 left-0.5 text-[8px] font-black px-1 rounded" style={{ background: '#000000aa', color: '#fff' }}>
                        {p.type === 'loading' ? '📦' : '✅'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Скрытый input для камеры */}
          <input
            ref={podInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePODFileChange}
          />

          {/* ── Поделиться ссылкой ── */}
          {effectiveTrip && (
            <button
              onClick={handleShareLink}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border text-[13px] font-bold transition-all active:scale-[0.98]"
              style={{ background: linkCopied ? '#10b98110' : '#5ba3f510', borderColor: linkCopied ? '#10b98125' : '#5ba3f525', color: linkCopied ? '#10b981' : '#5ba3f5' }}
            >
              {linkCopied ? <CheckCircle2 className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
              {linkCopied ? 'Ссылка скопирована!' : 'Поделиться трекингом с получателем'}
            </button>
          )}

          {/* ── Переключатель отправителей (если на поездке несколько) ── */}
          {acceptedOffers.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {acceptedOffers.map((o, idx) => (
                <button
                  key={o.offerId || idx}
                  onClick={() => setSelectedOfferIdx(idx)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-bold border transition-all ${
                    idx === selectedOfferIdx
                      ? 'bg-[#5ba3f5]/15 border-[#5ba3f5]/40 text-[#5ba3f5]'
                      : 'bg-white/[0.04] border-white/[0.08] text-[#607080]'
                  }`}
                >
                  {o.senderName || `Отправитель ${idx + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* ── Contact card ── */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] overflow-hidden">
            <div className="flex items-center gap-3 p-4">
              <div className="relative shrink-0">
                {contactPerson.avatar ? (
                  <div className="w-12 h-12 rounded-2xl bg-cover bg-center ring-2 ring-[#5ba3f5]/30"
                    style={{ backgroundImage: `url('${contactPerson.avatar}')` }} />
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-[#1e2d3a] flex items-center justify-center ring-2 ring-[#5ba3f5]/30">
                    <span className="text-white text-lg font-black">{contactPerson.name?.charAt(0) || '?'}</span>
                  </div>
                )}
                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[#060e1a] flex items-center justify-center">
                  <Package className="w-3 h-3 text-[#5ba3f5]" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-0.5">Отправитель</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[14px] font-extrabold text-white truncate">{activeTrip ? contactPerson.name : '—'}</p>
                  {activeTrip && (
                    <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[9px] font-black">
                      <Shield className="w-2.5 h-2.5" /> Верифицирован
                    </span>
                  )}
                </div>
                {activeTrip && contactPerson.phone && (
                  <p className="text-[11px] text-[#607080] mt-0.5">{contactPerson.phone}</p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 border-t border-white/[0.06]">
              <button onClick={() => navigate('/messages')} disabled={!activeTrip}
                className="flex items-center justify-center gap-2 py-3 text-[13px] font-bold text-[#5ba3f5] border-r border-white/[0.06] hover:bg-white/[0.04] disabled:opacity-40 active:scale-[0.97] transition-all">
                <MessageSquare className="w-4 h-4" /> Написать
              </button>
              {activeTrip ? (
                <a href={`tel:${contactPerson.phone}`}
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
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-3">Везу груз</p>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center shrink-0">
                  <Truck className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-extrabold text-white">
                    {capacityStr || cargoInfo.type}{!capacityStr && cargoInfo.weight ? ` · ${cargoInfo.weight} кг` : ''}
                  </p>
                  {cargoInfo.notes && <p className="text-[11px] text-[#607080] mt-0.5">{cargoInfo.notes}</p>}
                </div>
                {cargoInfo.price && (
                  <div className="shrink-0 px-2.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/20">
                    <p className="text-[13px] font-black text-emerald-400">{cargoInfo.price}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Emergency ── */}
          <button
            onClick={() => navigate('/help')}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-400 text-[13px] font-bold active:scale-[0.98] transition-all">
            <AlertTriangle className="w-4 h-4" /> Сообщить о проблеме
          </button>

          {/* ── Complete trip ── */}
          <button
            onClick={handleCompleteTrip}
            disabled={missingCompletionSteps.length > 0}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 text-white text-[14px] font-extrabold active:scale-[0.98] transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:active:scale-100">
            <CheckCircle2 className="w-5 h-5" /> Завершить поездку
          </button>
          {missingCompletionSteps.length > 0 && (
            <p className="text-[11px] text-center text-[#607080] -mt-1">
              Сначала: {missingCompletionSteps.join(', ')}
            </p>
          )}

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

    {/* ════════ DESKTOP ════════ */}
    <div className="hidden md:flex h-screen w-full overflow-hidden" style={{ background:'#080f1a' }}>
      <style>{`
        @keyframes dtp-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes dtp-pulse-green { 0%,100%{box-shadow:0 0 0 0 #10b98130} 60%{box-shadow:0 0 0 8px #10b98100} }
        @keyframes dtp-pulse-blue  { 0%,100%{box-shadow:0 0 0 0 #5ba3f530} 60%{box-shadow:0 0 0 8px #5ba3f500} }
        .dtp-s1{animation:dtp-in .4s cubic-bezier(.22,1,.36,1) .04s both}
        .dtp-s2{animation:dtp-in .4s cubic-bezier(.22,1,.36,1) .12s both}
        .dtp-s3{animation:dtp-in .4s cubic-bezier(.22,1,.36,1) .20s both}
        .dtp-s4{animation:dtp-in .4s cubic-bezier(.22,1,.36,1) .28s both}
        .dtp-s5{animation:dtp-in .4s cubic-bezier(.22,1,.36,1) .36s both}
        .dtp-card {
          border-radius:20px; overflow:hidden;
          background:linear-gradient(145deg,#0e1e32,#0a1520);
          border:1px solid #1a2d42;
        }
        .dtp-sec-label {
          font-size:10px; font-weight:800; text-transform:uppercase;
          letter-spacing:.16em; color:#3a5570;
        }
        .dtp-action {
          display:flex; align-items:center; justify-content:center; gap:8px;
          width:100%; padding:13px; border-radius:16px; font-size:14px; font-weight:800;
          cursor:pointer; border:none; font-family:inherit; color:#fff;
          transition:transform .18s ease, box-shadow .18s ease;
        }
        .dtp-action:hover { transform:translateY(-2px); }
        .dtp-action:disabled { opacity:.4; cursor:not-allowed; transform:none; }
      `}</style>

      {/* ── MAP (full height, takes remaining width) ── */}
      <div className="flex-1 relative">
        {effectiveTrip?.fromLat && effectiveTrip?.fromLng && effectiveTrip?.toLat && effectiveTrip?.toLng ? (
          <div className="w-full h-full">
            <YMaps query={{ apikey: YANDEX_MAPS_CONFIG.apiKey, lang: YANDEX_MAPS_CONFIG.lang, load: 'package.full' }}>
              <Map
                state={{ center: [(effectiveTrip.fromLat + effectiveTrip.toLat) / 2, (effectiveTrip.fromLng + effectiveTrip.toLng) / 2], zoom: 6 }}
                width="100%" height="100%"
                modules={['multiRouter.MultiRoute']}
                options={{ suppressMapOpenBlock: true }}
                instanceRef={(ref: any) => { if (ref && ref !== mapInstanceRef.current) { mapInstanceRef.current = ref; setMapInstance(ref); } }}
                onLoad={(ymaps: any) => { ymapsRef.current = ymaps; setYmapsApi(ymaps); }}
              >
                <Placemark
                  geometry={driverLocation ? [driverLocation.lat, driverLocation.lng] : [effectiveTrip.fromLat, effectiveTrip.fromLng]}
                  properties={{ hintContent: driverLocation ? `GPS: ${pct}%` : 'Старт', balloonContent: driverLocation ? `<b>LIVE GPS</b><br/>${pct}% пути` : '<b>Начальная точка</b>' }}
                  options={{ preset: 'islands#blueCarIcon', iconColor: driverLocation ? '#10b981' : '#5ba3f5' }}
                />
              </Map>
            </YMaps>
          </div>
        ) : (
          <img alt="Карта маршрута" className="w-full h-full object-cover"
            style={{ filter:'grayscale(.6) brightness(.45)' }}
            src="https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&h=1200&fit=crop" />
        )}

        {/* Map overlay gradient */}
        <div className="absolute inset-0 pointer-events-none" style={{ background:'linear-gradient(to right,transparent 70%,#080f1a 100%)' }} />

        {/* Map top-left back button */}
        <div className="absolute top-6 left-6 z-10">
          <button onClick={() => navigate(-1)}
            className="w-11 h-11 rounded-2xl flex items-center justify-center backdrop-blur-xl border border-white/15 transition-all hover:scale-105"
            style={{ background:'#0a1520cc' }}>
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* GPS status badge on map */}
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-10">
          {driverLocation ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border border-emerald-400/25"
              style={{ background:'#10b98120' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'#10b981', display:'inline-block', animation:'dtp-pulse-green 1.5s ease infinite' }} />
              <span style={{ fontSize:12, fontWeight:800, color:'#10b981' }}>LIVE GPS · {pct}%</span>
            </div>
          ) : geoError === 'denied' ? (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border border-rose-400/30" style={{ background:'#0a1520cc' }}>
              <XCircle style={{ width:13, height:13, color:'#f87171' }} />
              <span style={{ fontSize:12, fontWeight:700, color:'#f87171' }}>Геолокация заблокирована</span>
              <button onClick={retryGeo} style={{ fontSize:11, fontWeight:800, color:'#5ba3f5', cursor:'pointer', background:'none', border:'none', fontFamily:'inherit', padding:0 }}>Попробовать</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border border-white/10" style={{ background:'#0a1520cc' }}>
              <LocateFixed style={{ width:13, height:13, color:'#5ba3f5' }} className="animate-pulse" />
              <span style={{ fontSize:12, fontWeight:700, color:'#8a9bb0' }}>Поиск GPS...</span>
            </div>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className="w-[380px] shrink-0 flex flex-col overflow-y-auto" style={{ background:'#080f1a', borderLeft:'1px solid #0e1e32' }}>

        {/* Header */}
        <div className="dtp-s1 px-6 pt-7 pb-5" style={{ borderBottom:'1px solid #0e1e32' }}>
          <div className="flex items-center gap-2 mb-1">
            <div style={{ width:8, height:8, borderRadius:'50%', background:driverLocation?'#10b981':'#5ba3f5', boxShadow:driverLocation?'0 0 8px #10b981':'0 0 8px #5ba3f5', animation:`${driverLocation?'dtp-pulse-green':'dtp-pulse-blue'} 1.5s ease infinite` }} />
            <span style={{ fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'.16em', color:driverLocation?'#10b981':'#5ba3f5' }}>
              {driverLocation ? 'В пути · LIVE' : 'Ожидание GPS'}
            </span>
          </div>
          <h1 style={{ fontSize:22, fontWeight:900, color:'#fff', lineHeight:1.2 }}>
            {effectiveTrip ? `${cleanAddress(effectiveTrip.from)} → ${cleanAddress(effectiveTrip.to)}` : 'Нет активной поездки'}
          </h1>
          <div className="flex items-center gap-3 mt-3">
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#ffffff0a', border:'1px solid #1a2d3d' }}>
              <Clock style={{ width:12, height:12, color:'#4a6580' }} />
              <span style={{ fontSize:12, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#7a9ab5' }}>{elapsed}</span>
            </div>
            {effectiveTrip && totalDistanceKm > 0 && (
              <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:100, background:'#5ba3f512', border:'1px solid #5ba3f530' }}>
                <Navigation style={{ width:12, height:12, color:'#5ba3f5' }} />
                <span style={{ fontSize:12, fontWeight:700, color:'#5ba3f5' }}>{totalDistanceKm} км</span>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable cards */}
        <div className="flex-1 px-5 py-5 flex flex-col gap-4">

          {/* Progress card */}
          <div className="dtp-s2 dtp-card p-5">
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
              <div style={{ width:28, height:28, borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', background:'#5ba3f518', border:'1px solid #5ba3f530' }}>
                <MapPin style={{ width:13, height:13, color:'#5ba3f5' }} />
              </div>
              <span className="dtp-sec-label">Маршрут и прогресс</span>
              {driverLocation && (
                <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:5, padding:'3px 10px', borderRadius:100, background:'#10b98112', border:'1px solid #10b98125' }}>
                  <Zap style={{ width:10, height:10, color:'#10b981' }} />
                  <span style={{ fontSize:10, fontWeight:800, color:'#10b981' }}>LIVE</span>
                </div>
              )}
            </div>

            {!effectiveTrip ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, padding:'20px 0', textAlign:'center' }}>
                <Navigation style={{ width:32, height:32, color:'#2a4060' }} />
                <p style={{ fontSize:14, fontWeight:700, color:'#4a6580' }}>Нет активной поездки</p>
                <p style={{ fontSize:12, color:'#2a4060' }}>Выберите заказ, чтобы начать маршрут</p>
              </div>
            ) : (
              <>
                {/* From → To */}
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
                </div>

                {/* Progress bar */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ fontSize:12, color:'#4a6580' }}>
                      {driverLocation ? `Пройдено ${Math.round(totalDistanceKm * displayProgress)} км` : 'Ожидание GPS...'}
                    </span>
                    <span style={{ fontSize:13, fontWeight:900, color:driverLocation?'#10b981':'#4a6580' }}>
                      {driverLocation ? `${pct}%` : '—'}
                    </span>
                  </div>
                  <div style={{ height:8, borderRadius:4, background:'#0a1520', overflow:'hidden', position:'relative' }}>
                    <div style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,#5ba3f5,#10b981)', width:`${pct}%`, transition:'width 1s ease', position:'relative' }}>
                      {driverLocation && pct > 5 && <div style={{ position:'absolute', right:-4, top:'50%', transform:'translateY(-50%)', width:12, height:12, borderRadius:'50%', background:'#fff', boxShadow:'0 0 8px #10b98180' }} />}
                    </div>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:6 }}>
                    <span style={{ fontSize:10, color:'#2a4060' }}>{routeFrom}</span>
                    <span style={{ fontSize:10, fontWeight:700, color:'#10b981' }}>{driverLocation && remainingKm > 0 ? `осталось ${remainingKm} км` : '—'}</span>
                    <span style={{ fontSize:10, color:'#2a4060' }}>{routeTo}</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Переключатель отправителей (если на поездке несколько) */}
          {acceptedOffers.length > 1 && (
            <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 }}>
              {acceptedOffers.map((o, idx) => (
                <button
                  key={o.offerId || idx}
                  onClick={() => setSelectedOfferIdx(idx)}
                  style={{
                    flexShrink:0, padding:'6px 12px', borderRadius:999, fontSize:12, fontWeight:700,
                    border:'1px solid', cursor:'pointer', fontFamily:'inherit', transition:'all .15s',
                    background: idx === selectedOfferIdx ? '#5ba3f526' : '#ffffff08',
                    borderColor: idx === selectedOfferIdx ? '#5ba3f566' : '#ffffff14',
                    color: idx === selectedOfferIdx ? '#5ba3f5' : '#4a6580',
                  }}
                >
                  {o.senderName || `Отправитель ${idx + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Contact (sender) card */}
          <div className="dtp-s3 dtp-card overflow-hidden">
            <div style={{ padding:'16px 18px', display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ position:'relative', flexShrink:0 }}>
                {contactPerson.avatar ? (
                  <div style={{ width:48, height:48, borderRadius:16, backgroundImage:`url('${contactPerson.avatar}')`, backgroundSize:'cover', backgroundPosition:'center', border:'2px solid #5ba3f530' }} />
                ) : (
                  <div style={{ width:48, height:48, borderRadius:16, background:'linear-gradient(135deg,#1d4ed8,#5ba3f5)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <span style={{ color:'#fff', fontWeight:900, fontSize:18 }}>{contactPerson.name?.charAt(0)||'?'}</span>
                  </div>
                )}
                <div style={{ position:'absolute', bottom:-3, right:-3, width:18, height:18, borderRadius:6, background:'#5ba3f5', display:'flex', alignItems:'center', justifyContent:'center', border:'2px solid #080f1a' }}>
                  <Package style={{ width:9, height:9, color:'#fff' }} />
                </div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <p className="dtp-sec-label mb-1">Отправитель</p>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{effectiveTrip ? contactPerson.name : '—'}</p>
                  {effectiveTrip && <span style={{ fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:6, background:'#10b98118', color:'#10b981', textTransform:'uppercase' }}>Верифицирован</span>}
                </div>
                {effectiveTrip && contactPerson.phone && <p style={{ fontSize:12, color:'#4a6580', marginTop:2 }}>{contactPerson.phone}</p>}
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', borderTop:'1px solid #0e1e32' }}>
              <button onClick={() => navigate('/messages')} disabled={!effectiveTrip}
                style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'12px', fontSize:13, fontWeight:700, color:'#5ba3f5', background:'none', border:'none', borderRight:'1px solid #0e1e32', cursor:'pointer', fontFamily:'inherit', transition:'background .15s', opacity: !effectiveTrip ? 0.5 : 1 }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background='#5ba3f508'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background='none'}>
                <MessageSquare style={{ width:15, height:15 }} /> Написать
              </button>
              {effectiveTrip ? (
                <a href={`tel:${contactPerson.phone}`}
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
          {effectiveTrip && (
            <div className="dtp-s4 dtp-card p-5">
              <p className="dtp-sec-label mb-4">Везу груз</p>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:44, height:44, borderRadius:14, background:'#f59e0b18', border:'1px solid #f59e0b30', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Truck style={{ width:20, height:20, color:'#f59e0b' }} />
                </div>
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{capacityStr || cargoInfo.type}{!capacityStr && cargoInfo.weight ? ` · ${cargoInfo.weight} кг` : ''}</p>
                  {cargoInfo.notes && <p style={{ fontSize:12, color:'#4a6580', marginTop:3 }}>{cargoInfo.notes}</p>}
                </div>
                {cargoInfo.price && (
                  <div style={{ flexShrink:0, padding:'7px 12px', borderRadius:12, background:'#10b98115', border:'1px solid #10b98125' }}>
                    <p style={{ fontSize:13, fontWeight:900, color:'#10b981' }}>{cargoInfo.price}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="dtp-s5 flex flex-col gap-3">
            <button className="dtp-action" style={{ background:'linear-gradient(135deg,#0d3320,#0a4a2a)', border:'1px solid #10b98130', color:'#ef4444', marginBottom:0 }}
              onClick={() => navigate('/help')}>
              <AlertTriangle style={{ width:16, height:16 }} /> Сообщить о проблеме
            </button>
            <button className="dtp-action" onClick={handleCompleteTrip}
              disabled={missingCompletionSteps.length > 0}
              style={{ background:'linear-gradient(135deg,#059669,#10b981)', boxShadow:'0 8px 24px #10b98140', opacity: missingCompletionSteps.length > 0 ? 0.4 : 1, cursor: missingCompletionSteps.length > 0 ? 'not-allowed' : 'pointer' }}>
              <CheckCircle2 style={{ width:16, height:16 }} /> Завершить поездку
            </button>
            {missingCompletionSteps.length > 0 && (
              <p style={{ fontSize:11, textAlign:'center', color:'#607080', margin:0 }}>
                Сначала: {missingCompletionSteps.join(', ')}
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
    </div>
  );
}
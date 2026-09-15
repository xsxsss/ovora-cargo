import { useState, useEffect, useRef } from 'react';
import { childSeatPrice } from '../utils/pricing';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { Users, Truck, Plus, Minus, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useUser } from '../contexts/UserContext';
import { getTripById, submitOffer } from '../api/dataApi';
import type { ChatContact, ChatProposal } from '../api/chatStore';

interface ProposalFormModalProps {
  isDark: boolean;
  contact: ChatContact;
  tripId: string | undefined;
  tripData?: any;
  onClose: () => void;
  onSend: (data: Omit<ChatProposal, 'id' | 'status'>, requestedCapacity?: { seats: number; children: number; cargoKg: number }) => void;
}

export function ProposalFormModal({
  isDark,
  contact,
  tripId,
  tripData: propTripData,
  onClose,
  onSend,
}: ProposalFormModalProps) {
  const { user: profileUser } = useUser();

  // ── Load trip data ─────────────────────────────────────────────────────────
  const [trip, setTrip] = useState<any>(propTripData || null);
  const [loading, setLoading] = useState(!propTripData);

  useEffect(() => {
    if (propTripData) {
      setTrip(propTripData);
      setLoading(false);
      return;
    }

    if (!tripId) {
      setLoading(false);
      return;
    }

    async function loadTripData() {
      try {
        let allTrips = JSON.parse(localStorage.getItem('ovora_published_trips') || '[]');
        let found = allTrips.find((t: any) => String(t.id) === String(tripId));

        if (!found) {
          allTrips = JSON.parse(localStorage.getItem('ovora_all_trips') || '[]');
          found = allTrips.find((t: any) => String(t.id) === String(tripId));
        }

        if (found) {
          setTrip(found);
          setLoading(false);
          return;
        }

        const serverTrip = await getTripById(tripId || '');
        if (serverTrip) {
          setTrip(serverTrip);
        }
      } catch {
        toast.error('Не удалось загрузить данные рейса');
      }
      setLoading(false);
    }

    loadTripData();
  }, [tripId, propTripData]);

  const hasSeats = trip?.availableSeats > 0;
  const hasCargo = trip?.cargoCapacity > 0;

  // Offer modal state
  const [showOffer] = useState(true);
  const [includeSeats, setIncludeSeats] = useState(false);
  const [includeCargo, setIncludeCargo] = useState(false);
  const [offerSeats, setOfferSeats] = useState(1);
  const [offerChildren, setOfferChildren] = useState(0);
  const [offerCargoKg, setOfferCargoKg] = useState(1);
  const [offerCargoDesc, setOfferCargoDesc] = useState('');

  const [offerName, setOfferName] = useState(`${profileUser?.firstName || ''} ${profileUser?.lastName || ''}`.trim());
  const [offerPhone, setOfferPhone] = useState(profileUser?.phone || '');
  const [offerNotes, setOfferNotes] = useState('');

  const [offerDone, setOfferDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Auto-fill form with trip data
  useEffect(() => {
    if (!showOffer || !trip) return;

    if (trip.availableSeats > 0) {
      setIncludeSeats(true);
      setOfferSeats(1);
      setOfferChildren(0);
    }
    if (trip.cargoCapacity > 0) {
      setIncludeCargo(true);
      setOfferCargoKg(1);
    }
    if (profileUser) {
      const fullName = `${profileUser.firstName || ''} ${profileUser.lastName || ''}`.trim();
      if (fullName) setOfferName(fullName);
      if (profileUser.phone) setOfferPhone(profileUser.phone);
    }

    toast.success('Форма автоматически заполнена данными о рейсе', {
      duration: 2000,
      icon: '✅',
    });
  }, [showOffer, trip]);

  // ── Price calculations ────────────────────────────────────────────────────
  const totalSeatsPrice = includeSeats
    ? offerSeats * (trip?.pricePerSeat || 0) + offerChildren * childSeatPrice(trip)
    : 0;
  const totalCargoPrice = includeCargo ? offerCargoKg * (trip?.pricePerKg || 0) : 0;
  const totalPrice = totalSeatsPrice + totalCargoPrice;

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!offerName.trim()) {
      toast.error('Укажите ваше имя');
      return;
    }
    if (!includeSeats && !includeCargo) {
      toast.error('Выберите хотя бы одну услугу (места или груз)');
      return;
    }
    if (isSubmitting) {
      return;
    }
    setIsSubmitting(true);

    const seatsPart = includeSeats
      ? `${offerSeats} взр.${offerChildren > 0 ? ` + ${offerChildren} дет.` : ''}`
      : '';
    const cargoPart = includeCargo ? `${offerCargoKg} кг` : '';
    const weight = [seatsPart, cargoPart].filter(Boolean).join(' + ') || '—';

    const cargoType =
      includeSeats && includeCargo
        ? `Пассажиры + ${offerCargoDesc || 'Груз'}`
        : includeSeats
        ? 'Пассажиры'
        : offerCargoDesc || 'Груз';

    const proposal: Omit<ChatProposal, 'id' | 'status'> = {
      cargoType,
      weight,
      volume: '',
      price: String(totalPrice),
      currency: 'TJS',
      from: trip?.from || '—',
      to: trip?.to || '—',
      date: trip?.date || '—',
      vehicleType: trip?.vehicle || '—',
      notes: `${offerName}${offerPhone ? ` · ${offerPhone}` : ''}${offerNotes ? `\n${offerNotes}` : ''}`,
      tripId: String(tripId),
      senderEmail: profileUser?.email || 'guest',
      senderPhone: offerPhone,
      fromLat: trip?.fromLat,
      fromLng: trip?.fromLng,
      toLat: trip?.toLat,
      toLng: trip?.toLng,
      departureTime: trip?.time || trip?.departureTime || '',
    };

    const offerData = {
      tripId: String(tripId),
      senderEmail: profileUser?.email || 'guest',
      senderName: offerName,
      senderPhone: offerPhone,
      type: includeSeats && includeCargo ? 'both' : includeCargo ? 'cargo' : 'seats',
      createdAt: new Date().toISOString(),
      cargoType,
      weight,
      volume: '',
      price: totalPrice,
      currency: 'TJS',
      notes: offerNotes,
      from: trip?.from || '—',
      to: trip?.to || '—',
      date: trip?.date || '—',
      vehicleType: trip?.vehicle || 'Неизвестно',
      driverEmail: contact?.email || trip?.driverEmail || '',
      requestedSeats: includeSeats ? offerSeats : 0,
      requestedChildren: includeSeats ? offerChildren : 0,
      requestedCargo: includeCargo ? offerCargoKg : 0,
      status: 'pending',
    };

    try {
      await submitOffer(offerData);
    } catch (err: any) {
      toast.error(err?.status === 409
        ? 'У вас уже есть активная оферта на этот рейс'
        : 'Ошибка при отправке оферты');
      setIsSubmitting(false);
      return;
    }

    onSend(proposal, {
      seats: includeSeats ? offerSeats : 0,
      children: includeSeats ? offerChildren : 0,
      cargoKg: includeCargo ? offerCargoKg : 0,
    });

    setOfferDone(true);

    timerRef.current = setTimeout(() => {
      setOfferDone(false);
      setIsSubmitting(false);
      setIncludeSeats(false);
      setIncludeCargo(false);
      setOfferSeats(1);
      setOfferChildren(0);
      setOfferCargoKg(1);
      setOfferCargoDesc('');
      setOfferNotes('');
      onClose();
    }, 2400);
  };

  // ── Shared style helpers ──────────────────────────────────────────────────
  const divider = isDark ? 'border-[#1e2d3a]' : 'border-[#e2e8f0]';
  const bg = isDark ? 'bg-[#162030]' : 'bg-white';
  const labelCls = isDark ? 'text-[#475569]' : 'text-[#94a3b8]';
  const valueCls = isDark ? 'text-white' : 'text-[#0f172a]';
  const inputCls = `w-full px-0 py-2.5 text-sm font-semibold bg-transparent border-b outline-none transition-colors placeholder:font-normal ${
    isDark
      ? `border-[#1e2d3a] text-white placeholder:text-[#475569] focus:border-[#1978e5]`
      : `border-[#e2e8f0] text-[#0f172a] placeholder:text-[#94a3b8] focus:border-[#1978e5]`
  }`;

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
      </motion.div>
    );
  }

  // ── No trip data fallback ─────────────────────────────────────────────────
  if (!trip) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-end justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className={`relative w-full max-h-[85vh] overflow-y-auto ${bg}`}
        >
          <div className="px-5 py-8 text-center">
            <AlertCircle
              className={`w-10 h-10 mx-auto mb-3 ${isDark ? 'text-amber-400' : 'text-amber-500'}`}
            />
            <h3 className={`text-base font-bold mb-2 ${valueCls}`}>
              Данные поездки недоступны
            </h3>
            <p className={`text-sm ${labelCls}`}>
              Невозможно отправить оферту без информации о поездке. Перейдите в объявление
              водителя и попробуйте снова.
            </p>
            <button
              onClick={onClose}
              className="mt-5 px-6 py-2.5 bg-[#1978e5] text-white font-bold text-sm w-full"
            >
              Закрыть
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] flex items-end justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-h-[90vh] overflow-y-auto ${bg}`}
      >
        {offerDone ? (
          // ── SUCCESS STATE ──────────────────────────────────────────────────
          <div className="flex flex-col items-center gap-3 py-10 px-5">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
            <h3 className={`text-lg font-extrabold ${valueCls}`}>Оферта отправлена!</h3>
            <p className={`text-sm text-center ${labelCls}`}>
              Водитель получит уведомление и свяжется с вами.
            </p>
          </div>
        ) : (
          <>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className={`w-9 h-1 ${isDark ? 'bg-[#334155]' : 'bg-[#cbd5e1]'}`} />
            </div>

            {/* Header */}
            <div className={`px-4 py-3 border-b ${divider} flex items-center justify-between`}>
              <div>
                <h3 className={`text-base font-extrabold ${valueCls}`}>Отправить оферту</h3>
                <p className={`text-[11px] mt-0.5 ${labelCls}`}>
                  {trip.from} → {trip.to} · {trip.date}
                </p>
              </div>
              <button
                onClick={onClose}
                className={`w-7 h-7 flex items-center justify-center shrink-0 ${
                  isDark ? 'text-[#64748b]' : 'text-[#94a3b8]'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Seats section ── */}
            {hasSeats && (
              <div className={`border-b ${divider} ${!includeSeats ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => setIncludeSeats(!includeSeats)}
                  className="w-full flex items-center gap-3 px-4 py-3"
                >
                  <Users
                    className={`w-4 h-4 shrink-0 ${
                      includeSeats ? 'text-[#1978e5]' : isDark ? 'text-[#475569]' : 'text-[#94a3b8]'
                    }`}
                  />
                  <div className="flex-1 text-left">
                    <p className={`text-sm font-bold ${valueCls}`}>Пассажирские места</p>
                    <p className={`text-[10px] ${labelCls}`}>
                      {trip.pricePerSeat} TJS/место · доступно {trip.availableSeats}
                    </p>
                  </div>
                  {/* Toggle */}
                  <div
                    className={`relative w-10 h-5 transition-colors shrink-0 ${
                      includeSeats ? 'bg-[#1978e5]' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#cbd5e1]'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white transition-transform ${
                        includeSeats ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                </button>

                {includeSeats && (
                  <div className={`px-4 pb-4 border-t ${divider}`}>
                    {/* Adults counter */}
                    <div className={`flex items-center gap-2 py-3 border-b ${divider}`}>
                      <button
                        onClick={() => setOfferSeats(Math.max(1, offerSeats - 1))}
                        className={`w-9 h-9 flex items-center justify-center shrink-0 border ${divider} ${valueCls}`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1 flex flex-col items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={offerSeats}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '');
                            if (raw === '' || raw === '0') {
                              setOfferSeats('' as any);
                              return;
                            }
                            const v = parseInt(raw);
                            if (!isNaN(v)) setOfferSeats(v);
                          }}
                          onBlur={() => {
                            const v = parseInt(String(offerSeats)) || 1;
                            setOfferSeats(Math.min(trip.availableSeats, Math.max(1, v)));
                          }}
                          className={`w-full text-center text-2xl font-black bg-transparent border-b-2 outline-none transition-colors ${
                            isDark
                              ? 'text-white border-[#1e2d3a] focus:border-[#1978e5]'
                              : 'text-[#0f172a] border-[#e2e8f0] focus:border-[#1978e5]'
                          }`}
                        />
                        <p className={`text-[10px] mt-1 ${labelCls}`}>взрослых мест</p>
                      </div>
                      <button
                        onClick={() =>
                          setOfferSeats(Math.min(trip.availableSeats, offerSeats + 1))
                        }
                        className={`w-9 h-9 flex items-center justify-center shrink-0 border ${divider} text-[#1978e5]`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Children counter */}
                    <div className={`flex items-center gap-3 py-2.5 border-b ${divider}`}>
                      <span className="text-base shrink-0">👶</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold ${valueCls}`}>
                          Дети{' '}
                          <span className={`font-normal text-[10px] ${labelCls}`}>
                            (до 12 лет · ½ цены)
                          </span>
                        </p>
                        <p className={`text-[10px] ${labelCls}`}>
                          {childSeatPrice(trip)} TJS/место
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setOfferChildren(Math.max(0, offerChildren - 1))}
                          className={`w-7 h-7 flex items-center justify-center border ${divider} ${valueCls}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className={`w-5 text-center text-sm font-black ${valueCls}`}>
                          {offerChildren}
                        </span>
                        <button
                          onClick={() =>
                            setOfferChildren(
                              Math.min(
                                Math.max(0, trip.availableSeats - offerSeats),
                                offerChildren + 1
                              )
                            )
                          }
                          className={`w-7 h-7 flex items-center justify-center text-[#1978e5] border border-[#1978e5]/40`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Seats subtotal */}
                    <div className="flex items-center justify-between py-2">
                      <span className={`text-xs ${labelCls}`}>
                        {offerSeats} взр.{offerChildren > 0 ? ` + ${offerChildren} дет.` : ''} ×{' '}
                        {trip.pricePerSeat} TJS
                      </span>
                      <span className="text-sm font-bold text-[#1978e5]">{totalSeatsPrice} TJS</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Cargo section ── */}
            {hasCargo && (
              <div className={`border-b ${divider} ${!includeCargo ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => setIncludeCargo(!includeCargo)}
                  className="w-full flex items-center gap-3 px-4 py-3"
                >
                  <Truck
                    className={`w-4 h-4 shrink-0 ${
                      includeCargo ? 'text-amber-500' : isDark ? 'text-[#475569]' : 'text-[#94a3b8]'
                    }`}
                  />
                  <div className="flex-1 text-left">
                    <p className={`text-sm font-bold ${valueCls}`}>Перевозка груза</p>
                    <p className={`text-[10px] ${labelCls}`}>
                      {trip.pricePerKg} TJS/кг · доступно {trip.cargoCapacity} кг
                    </p>
                  </div>
                  {/* Toggle */}
                  <div
                    className={`relative w-10 h-5 transition-colors shrink-0 ${
                      includeCargo ? 'bg-amber-500' : isDark ? 'bg-[#1e2d3a]' : 'bg-[#cbd5e1]'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 bg-white transition-transform ${
                        includeCargo ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                </button>

                {includeCargo && (
                  <div className={`px-4 pb-4 border-t ${divider} space-y-0`}>
                    {/* Cargo weight counter */}
                    <div className={`flex items-center gap-2 py-3 border-b ${divider}`}>
                      <button
                        onClick={() => setOfferCargoKg(Math.max(1, offerCargoKg - 5))}
                        className={`w-9 h-9 flex items-center justify-center shrink-0 border ${divider} ${valueCls}`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <div className="flex-1 flex flex-col items-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={offerCargoKg}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '');
                            if (raw === '' || raw === '0') {
                              setOfferCargoKg('' as any);
                              return;
                            }
                            const v = parseInt(raw);
                            if (!isNaN(v)) setOfferCargoKg(v);
                          }}
                          onBlur={() => {
                            const v = parseInt(String(offerCargoKg)) || 1;
                            setOfferCargoKg(Math.min(trip.cargoCapacity, Math.max(1, v)));
                          }}
                          className={`w-full text-center text-2xl font-black bg-transparent border-b-2 outline-none transition-colors ${
                            isDark
                              ? 'text-amber-300 border-[#1e2d3a] focus:border-amber-500'
                              : 'text-amber-700 border-[#e2e8f0] focus:border-amber-500'
                          }`}
                        />
                        <p className={`text-[10px] mt-1 ${labelCls}`}>кг</p>
                      </div>
                      <button
                        onClick={() =>
                          setOfferCargoKg(Math.min(trip.cargoCapacity, offerCargoKg + 5))
                        }
                        className={`w-9 h-9 flex items-center justify-center shrink-0 border border-amber-500/40 text-amber-500`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Cargo subtotal */}
                    <div className={`flex items-center justify-between py-2 border-b ${divider}`}>
                      <span className={`text-xs ${labelCls}`}>
                        {offerCargoKg} кг × {trip.pricePerKg} TJS
                      </span>
                      <span
                        className={`text-sm font-bold ${
                          isDark ? 'text-amber-400' : 'text-amber-600'
                        }`}
                      >
                        {totalCargoPrice} TJS
                      </span>
                    </div>

                    {/* Cargo description */}
                    <input
                      className={`${inputCls} mt-1`}
                      placeholder="Описание груза (продукты, одежда...)"
                      value={offerCargoDesc}
                      onChange={(e) => setOfferCargoDesc(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Combined total */}
            {includeSeats && includeCargo && (
              <div className={`flex items-center justify-between px-4 py-3 border-b ${divider}`}>
                <div className="flex items-center gap-2">
                  <Users className="w-3.5 h-3.5 text-[#1978e5]" />
                  <Truck className="w-3.5 h-3.5 text-amber-500" />
                  <span className={`text-xs font-bold ${labelCls}`}>Итого (места + груз)</span>
                </div>
                <span className={`text-base font-black ${valueCls}`}>{totalPrice} TJS</span>
              </div>
            )}

            {/* Sender info */}
            <div className={`px-4 pt-3 pb-2 border-b ${divider}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${labelCls}`}>
                Ваши данные
              </p>

              {/* Profile preview */}
              {profileUser && (
                <div className={`flex items-center gap-3 py-2 mb-2 border-b ${divider}`}>
                  {profileUser.avatarUrl ? (
                    <div
                      className="w-9 h-9 bg-cover bg-center shrink-0"
                      style={{ backgroundImage: `url('${profileUser.avatarUrl}')` }}
                    />
                  ) : (
                    <div className="w-9 h-9 bg-[#1978e5] flex items-center justify-center shrink-0">
                      <span className="text-white text-xs font-black">
                        {`${profileUser.firstName?.[0] || ''}${profileUser.lastName?.[0] || ''}`.toUpperCase() ||
                          'ВЫ'}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-extrabold truncate ${valueCls}`}>
                      {`${profileUser.firstName || ''} ${profileUser.lastName || ''}`.trim() ||
                        'Пользователь'}
                    </p>
                    <p className={`text-[11px] ${labelCls}`}>
                      {profileUser.phone || profileUser.email || ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CheckCircle className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] font-black text-emerald-500">Из профиля</span>
                  </div>
                </div>
              )}

              <input
                className={inputCls}
                placeholder="Ваше имя *"
                value={offerName}
                onChange={(e) => setOfferName(e.target.value)}
              />
              <input
                className={`${inputCls} mt-1`}
                placeholder="Телефон"
                type="tel"
                value={offerPhone}
                onChange={(e) => setOfferPhone(e.target.value)}
              />
              <textarea
                className={`${inputCls} mt-1 resize-none`}
                placeholder="Дополнительные пожелания..."
                rows={2}
                value={offerNotes}
                onChange={(e) => setOfferNotes(e.target.value)}
              />
            </div>

            {/* Submit */}
            <div className="px-4 py-4">
              <button
                onClick={handleSubmit}
                disabled={!offerName.trim() || (!includeSeats && !includeCargo) || isSubmitting}
                className={`w-full py-3.5 font-extrabold text-white text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                  offerName.trim() && (includeSeats || includeCargo) && !isSubmitting
                    ? includeSeats && includeCargo
                      ? 'bg-gradient-to-r from-[#1978e5] via-[#7c3aed] to-amber-500'
                      : includeSeats
                      ? 'bg-[#1978e5]'
                      : 'bg-amber-500'
                    : isDark
                    ? 'bg-[#1e2d3a] text-[#475569] cursor-not-allowed'
                    : 'bg-[#e2e8f0] text-[#94a3b8] cursor-not-allowed'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin shrink-0" />
                    Отправляем...
                  </>
                ) : (
                  `Подтвердить · ${totalPrice} TJS`
                )}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
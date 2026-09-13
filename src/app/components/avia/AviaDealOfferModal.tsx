import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Plane, Package, ArrowRight, Scale,
  DollarSign, MessageSquare, Loader2, CheckCircle2, AlertCircle,
  FileText,
} from 'lucide-react';
import { createAviaDeal } from '../../api/aviaDealApi';
import type { AviaDeal } from '../../api/aviaDealApi';
import type { AviaFlight } from '../../api/aviaApi';
import type { AviaUser } from '../../api/aviaApi';
import { initAviaChat, sendTypedChatMessage } from '../../api/aviaChatApi';
import type { AviaChatAdRef } from '../../api/aviaChatApi';

interface AviaDealOfferModalProps {
  /** Текущий пользователь */
  me: AviaUser;
  /** Предложение на рейс курьера (Отправитель → Курьеру) */
  flight: AviaFlight;
  onClose: () => void;
  onSuccess?: (deal: AviaDeal) => void;
  /** Открыть чат после отправки предложения */
  onOpenChat?: (chatId: string, otherPhone: string, adRef: AviaChatAdRef) => void;
  /** У отправителя уже есть сделка по этому объявлению (backend вернул 409 + dealId) */
  onOpenExistingDeal?: (dealId: string) => void;
}

export function AviaDealOfferModal({ me, flight, onClose, onSuccess, onOpenChat, onOpenExistingDeal }: AviaDealOfferModalProps) {
  // Определяем доступные типы на основе настроек рейса курьера
  const isCargoAvail = flight.cargoEnabled ?? true;
  const isDocsAvail  = flight.docsEnabled ?? false;

  // Начальный тип: если доступны оба — предлагаем cargo первым; если только docs — docs
  const initialType = isCargoAvail ? 'cargo' : 'docs';
  const [dealType, setDealType] = useState<'cargo' | 'docs'>(initialType);

  const [weightKg, setWeightKg] = useState('');
  const [docsCount, setDocsCount] = useState('1');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingDealId, setExistingDealId] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Фокус на первое поле формы при открытии модалки
  const weightInputRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    (weightInputRef.current || messageRef.current)?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  };

  // Определяем, кто получатель
  const recipientPhone = flight.courierId;
  const recipientName  = flight.courierName || flight.courierId;
  const adType: 'flight' = 'flight';
  const adId    = flight.id;
  const adFrom  = flight.from;
  const adTo    = flight.to;
  const adDate  = flight.date;

  // Роли
  const courierId   = flight.courierId;
  const senderId    = me.phone;
  const courierName = flight.courierName || '';
  const senderName  = `${me.firstName || ''} ${me.lastName || ''}`.trim() || me.phone;
  const myName      = senderName;

  // Доступный кг на рейсе
  const availKg = Math.max(0, (flight.freeKg || 0) - (flight.reservedKg || 0));

  // Цену устанавливает курьер на рейсе — отправитель только соглашается, не предлагает свою
  const currency = flight.currency || 'USD';
  const price = dealType === 'cargo'
    ? (flight.pricePerKg && weightKg ? Math.round(Number(weightKg) * flight.pricePerKg) : undefined)
    : (flight.docsPrice ? Math.round(flight.docsPrice * (Number(docsCount) || 0)) : undefined);

  // Сколько пакетов у курьера ещё свободно. null — рейс опубликован до
  // появления лимита, у него документы остаются без ограничений.
  const docsAvailable: number | null = (flight as any).docsCount == null
    ? null
    : Math.max(0, ((flight as any).docsFree || 0) - ((flight as any).docsReserved || 0));

  const handleWeightChange = (v: string) => {
    setWeightKg(v);
  };

  const handleDealTypeChange = (t: 'cargo' | 'docs') => {
    setDealType(t);
    setError('');
    if (t === 'docs') setWeightKg('');
    if (t === 'cargo') setDocsCount('1');
  };

  // ref вместо стейта: при быстром даблклике второй вызов handleSubmit может
  // выполниться до того, как React отрисует loading=true и задизейблит кнопку
  // (стейт читается из стейл-замыкания) — ref мутируется синхронно и блокирует
  // повторный сабмит независимо от рендера.
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (loading || submittingRef.current) return;
    if (dealType === 'cargo' && (!weightKg || Number(weightKg) <= 0)) {
      setError('Укажите вес в кг');
      return;
    }
    if (dealType === 'docs' && (!docsCount || Number(docsCount) <= 0)) {
      setError('Укажите количество пакетов');
      return;
    }
    if (dealType === 'docs' && docsAvailable != null && Number(docsCount) > docsAvailable) {
      setError(`У курьера осталось ${docsAvailable} пакет(ов)`);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError('');
    setExistingDealId(null);

    const result = await createAviaDeal({
      initiatorPhone: me.phone,
      initiatorName: myName,
      recipientPhone,
      recipientName,
      adType,
      adId,
      adFrom,
      adTo,
      adDate,
      weightKg: dealType === 'cargo' ? Number(weightKg) : 0,
      docsCount: dealType === 'docs' ? Math.floor(Number(docsCount)) : 0,
      price,
      currency,
      message: message.trim(),
      courierId,
      senderId,
      courierName,
      senderName,
      dealType,
    });

    setLoading(false);
    if (!result.success) {
      submittingRef.current = false;
      setError(result.dealId ? 'У вас уже есть предложение по этому рейсу' : (result.error || 'Ошибка отправки предложения'));
      setExistingDealId(result.dealId || null);
      return;
    }
    setDone(true);
    const deal = result.deal!;
    if (onSuccess) onSuccess(deal);

    // ── Открываем чат и отправляем deal_offer-сообщение ──────────────────────
    try {
      const adRef: AviaChatAdRef = { type: adType, id: adId, from: adFrom, to: adTo };
      const { chatId } = await initAviaChat(me.phone, recipientPhone, adRef);
      await sendTypedChatMessage(chatId, me.phone, '', 'deal_offer', {
        dealId:         deal.id,
        dealType,
        weightKg:       dealType === 'cargo' ? Number(weightKg) : undefined,
        docsCount:      dealType === 'docs'  ? Math.floor(Number(docsCount)) : undefined,
        price,
        currency,
        adFrom,
        adTo,
        adDate,
        adType,
        message:        message.trim(),
        initiatorPhone: me.phone,
        recipientPhone,
      });
      timerRef.current = setTimeout(() => {
        onClose();
        if (onOpenChat) onOpenChat(chatId, recipientPhone, adRef);
      }, 1200);
    } catch {
      timerRef.current = setTimeout(() => onClose(), 1800);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    borderRadius: 12, border: '1.5px solid #ffffff10',
    background: '#ffffff08', color: '#fff',
    fontSize: 14, fontWeight: 500, outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700,
    color: '#6b8299', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase',
  };

  const accentColor = '#0ea5e9';
  const AdIcon = Plane;

  const showTypeSelector = isCargoAvail && isDocsAvail;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          fontFamily: "'Sora', 'Inter', sans-serif",
        }}
        onClick={onClose}
        onKeyDown={handleKeyDown}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Отправить предложение"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 520,
            background: '#0a1628',
            borderRadius: '24px 24px 0 0',
            border: '1px solid #ffffff0c',
            borderBottom: 'none',
            padding: 'clamp(20px, 5vw, 28px)',
            paddingBottom: 'calc(clamp(20px, 5vw, 28px) + env(safe-area-inset-bottom, 16px))',
            maxHeight: '90dvh', overflowY: 'auto',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 12,
                background: `${accentColor}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AdIcon style={{ width: 18, height: 18, color: accentColor }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                  Отправить предложение
                </div>
                <div style={{ fontSize: 11, color: '#4a6080', marginTop: 1 }}>
                  на рейс курьера
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                width: 32, height: 32, borderRadius: 9,
                border: '1px solid #ffffff12', background: '#ffffff08',
                color: '#6b8299', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>

          {/* Route Info */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', borderRadius: 12,
            background: `${accentColor}0a`, border: `1px solid ${accentColor}20`,
            marginBottom: 20,
          }}>
            <AdIcon style={{ width: 14, height: 14, color: accentColor, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{adFrom}</span>
            <ArrowRight style={{ width: 12, height: 12, color: '#4a6080', flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{adTo}</span>
            {adDate && (
              <span style={{ fontSize: 11, color: '#4a6080', marginLeft: 'auto', fontWeight: 600 }}>
                {new Date(adDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>

          {/* Recipient */}
          <div style={{
            padding: '10px 14px', borderRadius: 12,
            background: '#ffffff06', border: '1px solid #ffffff0a',
            marginBottom: showTypeSelector ? 16 : 20,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 9,
              background: `${accentColor}14`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <AdIcon style={{ width: 12, height: 12, color: accentColor }} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#4a6080', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Курьер
              </div>
              <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
                {recipientName}
              </div>
            </div>
          </div>

          {/* Тип сделки — только если курьер включил оба */}
          {showTypeSelector && !done && (
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Тип отправления</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleDealTypeChange('cargo')}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12,
                    border: `1.5px solid ${dealType === 'cargo' ? '#0ea5e940' : '#ffffff12'}`,
                    background: dealType === 'cargo' ? '#0ea5e910' : '#ffffff06',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <Package style={{ width: 14, height: 14, color: dealType === 'cargo' ? '#0ea5e9' : '#4a6080' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: dealType === 'cargo' ? '#0ea5e9' : '#4a6080' }}>
                    Груз
                  </span>
                </button>
                <button
                  onClick={() => handleDealTypeChange('docs')}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 12,
                    border: `1.5px solid ${dealType === 'docs' ? '#a78bfa40' : '#ffffff12'}`,
                    background: dealType === 'docs' ? '#a78bfa10' : '#ffffff06',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'border-color 0.2s, background 0.2s',
                  }}
                >
                  <FileText style={{ width: 14, height: 14, color: dealType === 'docs' ? '#a78bfa' : '#4a6080' }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: dealType === 'docs' ? '#a78bfa' : '#4a6080' }}>
                    Документы
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Тип badge (если не selector, но тип определён) */}
          {!showTypeSelector && isDocsAvail && !done && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', borderRadius: 10, marginBottom: 16,
              background: '#a78bfa10', border: '1px solid #a78bfa25',
            }}>
              <FileText style={{ width: 13, height: 13, color: '#a78bfa' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa' }}>Документы / конверты</span>
            </div>
          )}

          {/* Done state */}
          <AnimatePresence>
            {done && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                  padding: '32px 20px', textAlign: 'center',
                }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 18,
                  background: '#34d39914', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckCircle2 style={{ width: 28, height: 28, color: '#34d399' }} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Предложение отправлено!</div>
                <div style={{ fontSize: 12, color: '#4a6080', lineHeight: 1.5 }}>
                  {recipientName} получит уведомление и может принять или отклонить его
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          {!done && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Weight — только для cargo */}
              {dealType === 'cargo' && (
                <div>
                  <label style={labelStyle}>
                    <Scale style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />
                    Вес груза (кг) *
                  </label>
                  <input
                    ref={weightInputRef}
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={weightKg}
                    onChange={e => handleWeightChange(e.target.value)}
                    placeholder="Например: 5"
                    style={inputStyle}
                  />
                  {availKg !== null && (
                    <p style={{ fontSize: 10, color: '#3d5268', marginTop: 4 }}>
                      Доступно на рейсе: <span style={{ color: availKg > 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>{availKg} кг</span>
                      {(flight?.reservedKg || 0) > 0 && (
                        <span style={{ color: '#f59e0b' }}> · {flight!.reservedKg} кг ожидает</span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Пакеты документов — количество, как вес у груза */}
              {dealType === 'docs' && (
                <div>
                  <label style={labelStyle}>
                    <FileText style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />
                    Сколько пакетов отправляете *
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={docsCount}
                    onChange={e => { setDocsCount(e.target.value); setError(''); }}
                    placeholder="Например: 2"
                    style={inputStyle}
                  />
                  {docsAvailable !== null ? (
                    <p style={{ fontSize: 10, color: '#3d5268', marginTop: 4 }}>
                      Осталось у курьера:{' '}
                      <span style={{ color: docsAvailable > 0 ? '#34d399' : '#f87171', fontWeight: 700 }}>
                        {docsAvailable} пакет(ов)
                      </span>
                      {((flight as any).docsReserved || 0) > 0 && (
                        <span style={{ color: '#f59e0b' }}> · {(flight as any).docsReserved} ожидает</span>
                      )}
                    </p>
                  ) : (
                    <p style={{ fontSize: 10, color: '#3d5268', marginTop: 4 }}>
                      Курьер не указал лимит — количество не ограничено
                    </p>
                  )}
                </div>
              )}

              {/* Price — фиксированная цена курьера, отправитель только соглашается */}
              <div>
                <label style={labelStyle}>
                  <DollarSign style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />
                  Цена курьера
                </label>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '12px 14px', borderRadius: 12,
                  border: '1.5px solid #ffffff10', background: '#ffffff05',
                }}>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>
                    {price !== undefined ? `${currency} ${price}` : 'Не указана'}
                  </span>
                  {dealType === 'cargo' && flight?.pricePerKg ? (
                    <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                      {currency} {flight.pricePerKg}/кг
                    </span>
                  ) : null}
                </div>
                {dealType === 'cargo' && flight?.pricePerKg && weightKg && (
                  <p style={{ fontSize: 10, color: '#34d399', marginTop: 4, fontWeight: 600 }}>
                    Расчёт: {weightKg} кг × {currency} {flight.pricePerKg}/кг = {currency} {price}
                  </p>
                )}
                <p style={{ fontSize: 10, color: '#4a6080', marginTop: 4 }}>
                  Цену устанавливает курьер на рейсе — её нельзя изменить в предложении
                </p>
              </div>

              {/* Message */}
              <div>
                <label style={labelStyle}>
                  <MessageSquare style={{ width: 11, height: 11, display: 'inline', marginRight: 4 }} />
                  Сообщение
                </label>
                <textarea
                  ref={messageRef}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Дополнительные условия, вопросы..."
                  rows={3}
                  maxLength={300}
                  style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                />
                <p style={{ fontSize: 10, color: '#3d5268', marginTop: 2, textAlign: 'right' }}>
                  {message.length}/300
                </p>
              </div>

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 14px', borderRadius: 12,
                      background: '#ef444410', border: '1px solid #ef444430',
                    }}
                  >
                    <AlertCircle style={{ width: 15, height: 15, color: '#f87171', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#f87171', flex: 1 }}>{error}</span>
                    {existingDealId && onOpenExistingDeal && (
                      <button
                        onClick={() => { onOpenExistingDeal(existingDealId); onClose(); }}
                        style={{
                          fontSize: 11, fontWeight: 700, color: '#f87171',
                          background: '#ef444418', border: '1px solid #ef444440',
                          borderRadius: 8, padding: '5px 10px', cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        Открыть
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Submit */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSubmit}
                disabled={loading}
                style={{
                  width: '100%', padding: '15px 24px',
                  borderRadius: 14, border: 'none',
                  background: loading
                    ? '#ffffff10'
                    : dealType === 'docs'
                      ? 'linear-gradient(135deg, #7c3aed, #a78bfa)'
                      : `linear-gradient(135deg, ${accentColor}cc, ${accentColor})`,
                  color: '#fff', fontSize: 15, fontWeight: 700,
                  cursor: loading ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: loading ? 'none' : `0 8px 24px ${dealType === 'docs' ? '#a78bfa33' : accentColor + '33'}`,
                  transition: 'background 0.2s',
                }}
              >
                {loading ? (
                  <>
                    <Loader2 style={{ width: 17, height: 17, animation: 'spin 1s linear infinite' }} />
                    Отправка...
                  </>
                ) : (
                  <>
                    <CheckCircle2 style={{ width: 17, height: 17 }} />
                    Отправить предложение
                  </>
                )}
              </motion.button>
            </div>
          )}
        </motion.div>
      </motion.div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </AnimatePresence>
  );
}
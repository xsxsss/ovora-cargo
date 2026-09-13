import { useState } from 'react';
import { X, Loader2, Plane, AlertCircle, ArrowRight, Package, FileText, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { createAviaFlight } from '../../api/aviaApi';
import type { AviaUser, AviaFlight } from '../../api/aviaApi';
import { AirportAutocomplete } from './AirportAutocomplete';
import { AviaCurrencySelector, getCurrency, type CurrencyOption } from './AviaCurrencySelector';

interface Props {
  user: AviaUser;
  onClose: () => void;
  onSuccess: (flight: AviaFlight) => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1.5px solid #ffffff12',
  background: '#ffffff08',
  color: '#fff',
  fontSize: 16,
  fontWeight: 500,
  outline: 'none',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b8299',
  marginBottom: 6,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

// ── Price input with currency symbol ─────────────────────────────────────────
// Hoisted to module scope: defining it inside CreateFlightModal's body created a
// new component type on every render, forcing React to unmount/remount the
// <input>, which lost focus and closed the on-screen keyboard on every keystroke.

function PriceInput({
  value, onChange, placeholder, accentBorder, cur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  accentBorder: string;
  cur: CurrencyOption;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
        display: 'flex', alignItems: 'center', gap: 4,
        pointerEvents: 'none', zIndex: 1,
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: cur.color }}>{cur.symbol}</span>
      </div>
      <input
        type="number" value={value} min="0" step="0.5"
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          ...inputStyle,
          border: `1.5px solid ${accentBorder}`,
          paddingLeft: cur.symbol.length > 2 ? 44 : 30,
        }}
      />
    </div>
  );
}

// ── TypeToggle block ──────────────────────────────────────────────────────────
// Also hoisted to module scope for the same reason as PriceInput above.

function TypeToggle({
  enabled, onToggle, icon: Icon, label, color, children,
}: {
  enabled: boolean;
  onToggle: () => void;
  icon: typeof Package;
  label: string;
  color: string;
  children?: React.ReactNode;
}) {
  return (
    <div style={{
      borderRadius: 14,
      border: `1.5px solid ${enabled ? color + '35' : '#ffffff10'}`,
      background: enabled ? color + '08' : '#ffffff04',
      overflow: 'hidden',
      transition: 'border-color 0.2s, background 0.2s',
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: enabled ? color + '20' : '#ffffff08',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'background 0.2s',
        }}>
          <Icon style={{ width: 15, height: 15, color: enabled ? color : '#4a6080' }} />
        </div>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: enabled ? '#fff' : '#6b8299' }}>
          {label}
        </span>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: enabled ? color : '#ffffff10',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s',
        }}>
          {enabled && <Check style={{ width: 12, height: 12, color: '#fff' }} />}
        </div>
      </button>

      <AnimatePresence>
        {enabled && children && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${color}18` }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function CreateFlightModal({ user, onClose, onSuccess }: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [flightNo, setFlightNo] = useState('');
  const [currency, setCurrency] = useState('USD');

  const [cargoEnabled, setCargoEnabled] = useState(true);
  const [cargoKg, setCargoKg] = useState('');
  const [pricePerKg, setPricePerKg] = useState('');

  const [docsEnabled, setDocsEnabled] = useState(false);
  const [docsPrice, setDocsPrice] = useState('');
  const [docsCount, setDocsCount] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const cur = getCurrency(currency);

  const isValid =
    from.trim().length >= 2 &&
    to.trim().length >= 2 &&
    !!date &&
    (cargoEnabled || docsEnabled) &&
    (!cargoEnabled || Number(cargoKg) > 0) &&
    (!docsEnabled  || Number(docsCount) > 0);

  const handleSubmit = async () => {
    if (!isValid) { setError('Заполните обязательные поля'); return; }
    setLoading(true);
    setError('');
    try {
      const result = await createAviaFlight({
        courierId: user.phone,
        from: from.trim(),
        to: to.trim(),
        date,
        flightNo: flightNo.trim() || undefined,
        cargoEnabled,
        cargoKg: cargoEnabled ? Number(cargoKg) : 0,
        freeKg: cargoEnabled ? Number(cargoKg) : 0,
        pricePerKg: cargoEnabled ? (Number(pricePerKg) || 0) : 0,
        docsEnabled,
        docsPrice: docsEnabled ? (Number(docsPrice) || 0) : 0,
        docsCount: docsEnabled ? Math.floor(Number(docsCount) || 0) : 0,
        currency,
      } as any);
      if (result.error) throw new Error(result.error);
      if (result.flight) onSuccess(result.flight);
      else throw new Error('Сервер не вернул данные рейса');
    } catch (e: any) {
      const msg = e.message || 'Ошибка создания рейса';
      setError(msg);
      toast.error(msg, { duration: 3000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="flight-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.78)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}
      >
        <motion.div
          key="flight-sheet"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 520,
            background: '#0a1525',
            border: '1px solid #ffffff0f',
            borderRadius: '24px 24px 0 0',
            padding: '24px 20px 44px',
            maxHeight: '94dvh',
            overflowY: 'auto',
            fontFamily: "'Sora', 'Inter', sans-serif",
          }}
        >
          {/* Handle */}
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#ffffff20', margin: '0 auto 20px' }} />

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 12,
                background: 'linear-gradient(135deg, #0369a1, #0ea5e9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Plane style={{ width: 18, height: 18, color: '#fff' }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Новый рейс</div>
                <div style={{ fontSize: 10, color: '#4a6080', fontWeight: 600 }}>Объявление о перевозке</div>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                width: 34, height: 34, borderRadius: 10,
                border: '1px solid #ffffff12', background: '#ffffff08',
                color: '#6b8299', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>

          {/* Route */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Маршрут *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <AirportAutocomplete
                value={from}
                onChange={v => { setFrom(v); setError(''); }}
                placeholder="Откуда"
                accentColor="#4a6080"
                iconColor="#4a6080"
              />
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <ArrowRight style={{ width: 14, height: 14, color: '#4a6080', transform: 'rotate(90deg)' }} />
              </div>
              <AirportAutocomplete
                value={to}
                onChange={v => { setTo(v); setError(''); }}
                placeholder="Куда"
                accentColor="#0ea5e9"
                iconColor="#0ea5e9"
              />
            </div>
          </div>

          {/* Date */}
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Дата рейса *</label>
            <input
              type="date" value={date} min={todayStr}
              onChange={e => { setDate(e.target.value); setError(''); }}
              style={{ ...inputStyle, colorScheme: 'dark' }}
            />
          </div>

          {/* Flight number */}
          <div style={{ marginBottom: 18 }}>
            <label style={labelStyle}>Номер рейса</label>
            <input
              type="text" value={flightNo}
              onChange={e => setFlightNo(e.target.value)}
              placeholder="Напр: FZ-723 (необязательно)"
              style={inputStyle}
            />
          </div>

          {/* ── Currency selector ── */}
          <div style={{
            marginBottom: 18, padding: '14px 16px', borderRadius: 16,
            background: '#ffffff05', border: '1px solid #ffffff0d',
          }}>
            <AviaCurrencySelector
              value={currency}
              onChange={setCurrency}
              label="Валюта цен"
            />
          </div>

          {/* ── Cargo types ── */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>Что принимаете? *</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Груз */}
              <TypeToggle
                enabled={cargoEnabled}
                onToggle={() => {
                  if (!docsEnabled) return;
                  setCargoEnabled(!cargoEnabled);
                  setError('');
                }}
                icon={Package}
                label="Груз (посылки)"
                color="#0ea5e9"
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 10 }}>Свободный вес, кг *</label>
                    <input
                      type="number" value={cargoKg} min="0.1" step="0.1"
                      onChange={e => { setCargoKg(e.target.value); setError(''); }}
                      placeholder="10"
                      style={{ ...inputStyle, border: '1.5px solid #0ea5e925' }}
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 10 }}>
                      Цена за кг, {cur.symbol} ({cur.code})
                    </label>
                    <PriceInput
                      value={pricePerKg}
                      onChange={setPricePerKg}
                      placeholder="0"
                      accentBorder="#0ea5e925"
                      cur={cur}
                    />
                  </div>
                </div>
              </TypeToggle>

              {/* Документы */}
              <TypeToggle
                enabled={docsEnabled}
                onToggle={() => {
                  if (!cargoEnabled) return;
                  setDocsEnabled(!docsEnabled);
                  setError('');
                }}
                icon={FileText}
                label="Документы / Конверты"
                color="#a78bfa"
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 10 }}>Сколько пакетов приму *</label>
                    <input
                      type="number" value={docsCount} min="1" step="1"
                      onChange={e => { setDocsCount(e.target.value); setError(''); }}
                      placeholder="10"
                      style={{ ...inputStyle, border: '1.5px solid #a78bfa25' }}
                    />
                  </div>
                  <div>
                    <label style={{ ...labelStyle, fontSize: 10 }}>
                      Цена за пакет, {cur.symbol} ({cur.code})
                    </label>
                    <PriceInput
                      value={docsPrice}
                      onChange={setDocsPrice}
                      placeholder="0"
                      accentBorder="#a78bfa25"
                      cur={cur}
                    />
                  </div>
                  <p style={{ fontSize: 10, color: '#4a6080', gridColumn: '1 / -1', margin: 0 }}>
                    Конверты тоже занимают место в багаже. Укажите, сколько реально
                    увезёте — когда пакеты закончатся, рейс перестанет принимать заявки
                    на документы.
                  </p>
                </div>
              </TypeToggle>

            </div>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  marginTop: 12, marginBottom: 4, padding: '10px 14px', borderRadius: 12,
                  background: '#ef444410', border: '1px solid #ef444430',
                }}
              >
                <AlertCircle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {!cargoEnabled && !docsEnabled && (
            <p style={{ fontSize: 11, color: '#f59e0b', marginBottom: 12, textAlign: 'center', marginTop: 8 }}>
              Выберите хотя бы один тип
            </p>
          )}

          {/* Submit */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmit}
            disabled={loading || !isValid}
            style={{
              width: '100%', padding: '16px 24px', marginTop: 16,
              borderRadius: 16, border: 'none',
              background: loading || !isValid
                ? '#ffffff10'
                : 'linear-gradient(135deg, #0369a1, #0ea5e9)',
              color: loading || !isValid ? '#4a6080' : '#fff',
              fontSize: 15, fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: !loading && isValid ? '0 8px 24px #0ea5e930' : 'none',
              transition: 'background 0.2s',
            }}
          >
            {loading ? (
              <>
                <Loader2 style={{ width: 18, height: 18, animation: 'avia-spin 1s linear infinite' }} />
                Публикация...
              </>
            ) : (
              <>
                <Plane style={{ width: 16, height: 16 }} />
                Опубликовать рейс · {cur.flag} {cur.code}
              </>
            )}
          </motion.button>

          <style>{`@keyframes avia-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

import { useState } from 'react';
import { X, Loader2, Pencil, AlertCircle, MapPin, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { updateAviaFlight } from '../../api/aviaApi';
import type { AviaFlight } from '../../api/aviaApi';
import { AviaCurrencySelector, getCurrency } from './AviaCurrencySelector';

interface Props {
  flight: AviaFlight;
  onClose: () => void;
  onSaved: (flight: AviaFlight) => void;
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

export function EditFlightModal({ flight, onClose, onSaved }: Props) {
  const [date, setDate] = useState(flight.date);
  const [flightNo, setFlightNo] = useState(flight.flightNo || '');
  const [currency, setCurrency] = useState(flight.currency || 'USD');
  const [pricePerKg, setPricePerKg] = useState(String(flight.pricePerKg ?? ''));
  const [docsPrice, setDocsPrice] = useState(String(flight.docsPrice ?? ''));
  const [docsCount, setDocsCount] = useState(String(flight.docsCount ?? ''));
  // Уже принятые пакеты — ниже этого числа лимит не опустить, иначе учёт
  // свободных пакетов уйдёт в минус. Тот же расчёт делает и сервер.
  const docsTaken = flight.docsCount == null
    ? 0
    : Math.max(0, (flight.docsCount || 0) - (flight.docsFree || 0));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const cur = getCurrency(currency);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await updateAviaFlight(flight.id, flight.courierId, {
        date,
        flightNo: flightNo.trim(),
        currency,
        pricePerKg: flight.cargoEnabled ? (Number(pricePerKg) || 0) : flight.pricePerKg,
        docsPrice: flight.docsEnabled ? (Number(docsPrice) || 0) : flight.docsPrice,
        ...(flight.docsEnabled && Number(docsCount) > 0
          ? { docsCount: Math.floor(Number(docsCount)) }
          : {}),
      });
      if (result.error) throw new Error(result.error);
      if (result.flight) onSaved(result.flight);
      else throw new Error('Сервер не вернул данные рейса');
    } catch (e: any) {
      const msg = e.message || 'Ошибка сохранения рейса';
      setError(msg);
      toast.error(msg, { duration: 3000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="edit-flight-backdrop"
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
          key="edit-flight-sheet"
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
                <Pencil style={{ width: 17, height: 17, color: '#fff' }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>Редактировать рейс</div>
                <div style={{ fontSize: 10, color: '#4a6080', fontWeight: 600 }}>Цены, номер рейса и дата</div>
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

          {/* Route (read-only) */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '12px 14px', marginBottom: 18, borderRadius: 12,
            background: '#ffffff05', border: '1px solid #ffffff0d',
          }}>
            <MapPin style={{ width: 13, height: 13, color: '#4a6080' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c0d0dd' }}>{flight.from}</span>
            <ArrowRight style={{ width: 13, height: 13, color: '#4a6080' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#c0d0dd' }}>{flight.to}</span>
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

          {/* Currency selector */}
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

          {/* Prices */}
          {flight.cargoEnabled && (
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Цена за кг, {cur.symbol} ({cur.code})</label>
              <input
                type="number" value={pricePerKg} min="0" step="0.5"
                onChange={e => setPricePerKg(e.target.value)}
                placeholder="0"
                style={{ ...inputStyle, border: '1.5px solid #0ea5e925' }}
              />
            </div>
          )}

          {flight.docsEnabled && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Сколько пакетов приму</label>
                <input
                  type="number" value={docsCount} min={Math.max(1, docsTaken)} step="1"
                  onChange={e => setDocsCount(e.target.value)}
                  placeholder="10"
                  style={{ ...inputStyle, border: '1.5px solid #a78bfa25' }}
                />
                {docsTaken > 0 && (
                  <p style={{ fontSize: 10, color: '#4a6080', marginTop: 4 }}>
                    Уже принято {docsTaken} пакет(ов) — меньше поставить нельзя
                  </p>
                )}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Цена за пакет документов, {cur.symbol} ({cur.code})</label>
                <input
                  type="number" value={docsPrice} min="0" step="0.5"
                  onChange={e => setDocsPrice(e.target.value)}
                  placeholder="0"
                  style={{ ...inputStyle, border: '1.5px solid #a78bfa25' }}
                />
              </div>
            </>
          )}

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  marginTop: 4, marginBottom: 4, padding: '10px 14px', borderRadius: 12,
                  background: '#ef444410', border: '1px solid #ef444430',
                }}
              >
                <AlertCircle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmit}
            disabled={loading}
            style={{
              width: '100%', padding: '16px 24px', marginTop: 16,
              borderRadius: 16, border: 'none',
              background: loading ? '#ffffff10' : 'linear-gradient(135deg, #0369a1, #0ea5e9)',
              color: loading ? '#4a6080' : '#fff',
              fontSize: 15, fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              boxShadow: !loading ? '0 8px 24px #0ea5e930' : 'none',
              transition: 'background 0.2s',
            }}
          >
            {loading ? (
              <>
                <Loader2 style={{ width: 18, height: 18, animation: 'avia-edit-spin 1s linear infinite' }} />
                Сохранение...
              </>
            ) : (
              <>
                <Pencil style={{ width: 16, height: 16 }} />
                Сохранить изменения
              </>
            )}
          </motion.button>

          <style>{`@keyframes avia-edit-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

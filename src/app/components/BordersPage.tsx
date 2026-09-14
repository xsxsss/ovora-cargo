import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Truck, ChevronDown, ChevronUp, Send, TrendingUp, Users, Flag, Wifi, Info } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
// @ts-ignore — Vite virtual module resolved at build time
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';
import { withUserToken } from '../api/userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN };

type BorderStatus = 'open' | 'congested' | 'closed';

interface Border {
  id: string;
  name: string;
  from: string;
  to: string;
  status: BorderStatus;
  queueMin: number;
  queueTrucks: number;
  route: string;
  updatedAt?: string;
  reportCount?: number;
  lastReportBy?: string;
}

const STATUS_CFG: Record<BorderStatus, { label: string; color: string; bg: string; border: string; icon: typeof CheckCircle2; dot: string }> = {
  open:      { label: 'Открыт',     color: '#22c55e', bg: '#052010', border: '#0a3a1a', icon: CheckCircle2,  dot: '#22c55e' },
  congested: { label: 'Затор',      color: '#f59e0b', bg: '#1a1000', border: '#3a2000', icon: AlertTriangle, dot: '#f59e0b' },
  closed:    { label: 'Закрыт',     color: '#ef4444', bg: '#1a0505', border: '#3a0a0a', icon: XCircle,       dot: '#ef4444' },
};

function timeAgo(iso?: string) {
  if (!iso) return 'недавно';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} д назад`;
}

/* ─── Report Modal ─────────────────────────────────────────────────────────── */
function ReportModal({ border, onClose, onSuccess }: { border: Border; onClose: () => void; onSuccess: () => void }) {
  const userEmail = sessionStorage.getItem('ovora_user_email') || '';
  const userName  = sessionStorage.getItem('ovora_user_name') || 'Пользователь';
  const [status, setStatus]         = useState<BorderStatus>(border.status);
  const [queueMin, setQueueMin]     = useState(border.queueMin);
  const [queueTrucks, setQueueTrucks] = useState(border.queueTrucks);
  const [text, setText]             = useState('');
  const [loading, setLoading]       = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/borders/${border.id}/report`, {
        method: 'POST', headers: withUserToken(H),
        body: JSON.stringify({ userEmail, userName, status, queueMin, queueTrucks, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Отчёт отправлен! Спасибо 🙏');
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg mx-auto rounded-t-3xl md:rounded-3xl overflow-hidden"
        style={{ background: 'linear-gradient(180deg,#0d1929 0%,#0a1220 100%)', border: '1px solid #1a2d45', boxShadow: '0 -16px 48px #000000a0' }}
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-9 h-1 rounded-full" style={{ background: '#1a3050' }} />
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#0f2448', border: '1px solid #1a3560', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Flag style={{ width: 18, height: 18, color: '#5ba3f5' }} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{border.name}</p>
              <p style={{ fontSize: 12, color: '#4a6880' }}>{border.from} → {border.to}</p>
            </div>
          </div>

          {/* Status picker */}
          <p style={{ fontSize: 12, color: '#4a6880', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Текущий статус</p>
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(['open','congested','closed'] as BorderStatus[]).map(s => {
              const cfg = STATUS_CFG[s];
              const active = status === s;
              return (
                <button key={s} onClick={() => setStatus(s)}
                  style={{
                    padding: '10px 6px', borderRadius: 12, border: `1px solid ${active ? cfg.color + '55' : '#1a2d45'}`,
                    background: active ? cfg.bg : '#080f1a',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    cursor: 'pointer', transition: 'all .15s',
                  }}
                >
                  <cfg.icon style={{ width: 18, height: 18, color: active ? cfg.color : '#2a4060' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: active ? cfg.color : '#2a4060' }}>{cfg.label}</span>
                </button>
              );
            })}
          </div>

          {/* Queue */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { label: 'Ожидание (мин)', val: queueMin, set: setQueueMin, icon: Clock },
              { label: 'Фур в очереди', val: queueTrucks, set: setQueueTrucks, icon: Truck },
            ].map(({ label, val, set, icon: Icon }) => (
              <div key={label}>
                <p style={{ fontSize: 11, color: '#4a6880', fontWeight: 600, marginBottom: 6 }}>{label}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#080f1a', border: '1px solid #1a2d45', borderRadius: 10, padding: '8px 12px' }}>
                  <Icon style={{ width: 14, height: 14, color: '#3a6090' }} />
                  <input
                    type="number" min={0} value={val}
                    onChange={e => set(Math.max(0, +e.target.value))}
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: '#c0d4e8', fontSize: 15, fontWeight: 700, width: 60 }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Comment */}
          <p style={{ fontSize: 11, color: '#4a6880', fontWeight: 600, marginBottom: 6 }}>Комментарий (необязательно)</p>
          <textarea
            value={text} onChange={e => setText(e.target.value)}
            placeholder="Напишите что видите на КПП..."
            rows={2}
            style={{ width: '100%', background: '#080f1a', border: '1px solid #1a2d45', borderRadius: 10, padding: '10px 12px', color: '#c0d4e8', fontSize: 13, resize: 'none', outline: 'none', boxSizing: 'border-box' }}
          />

          <button onClick={submit} disabled={loading}
            style={{
              width: '100%', marginTop: 14, padding: '14px', borderRadius: 14,
              background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', border: 'none',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              opacity: loading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            {loading ? <RefreshCw style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 16, height: 16 }} />}
            {loading ? 'Отправляем...' : 'Отправить отчёт'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Border Card ──────────────────────────────────────────────────────────── */
function BorderCard({ border, onReport }: { border: Border; onReport: (b: Border) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CFG[border.status] || STATUS_CFG.open;
  const Icon = cfg.icon;

  return (
    <motion.div
      layout
      style={{ background: 'linear-gradient(145deg,#0d1929,#091420)', border: `1px solid ${border.status === 'open' ? '#0d2035' : cfg.border}`, borderRadius: 20, overflow: 'hidden', marginBottom: 12 }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* Status accent line */}
      <div style={{ height: 3, background: `linear-gradient(90deg,${cfg.color},transparent)` }} />

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Status circle */}
          <div style={{ width: 44, height: 44, borderRadius: 14, background: cfg.bg, border: `1px solid ${cfg.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon style={{ width: 20, height: 20, color: cfg.color }} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{border.name}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 100, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                {cfg.label}
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#4a6880', marginTop: 3 }}>{border.from} → {border.to} · {border.route}</p>
          </div>

          <button onClick={() => setExpanded(v => !v)}
            style={{ width: 32, height: 32, borderRadius: 9, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
          >
            {expanded ? <ChevronUp style={{ width: 14, height: 14, color: '#3a6090' }} /> : <ChevronDown style={{ width: 14, height: 14, color: '#3a6090' }} />}
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          {border.status !== 'closed' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#080f1a', border: '1px solid #1a2d45', borderRadius: 8, padding: '5px 10px' }}>
                <Clock style={{ width: 12, height: 12, color: '#3a6090' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#7a9ab8' }}>{border.queueMin > 0 ? `~${border.queueMin} мин` : 'Без ожидания'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#080f1a', border: '1px solid #1a2d45', borderRadius: 8, padding: '5px 10px' }}>
                <Truck style={{ width: 12, height: 12, color: '#3a6090' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#7a9ab8' }}>{border.queueTrucks} фур</span>
              </div>
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
            <span style={{ fontSize: 11, color: '#2a5030' }}>обновлено {timeAgo(border.updatedAt)}</span>
          </div>
        </div>

        {/* Expanded */}
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
              <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,#1a2d45,transparent)', margin: '12px 0' }} />
              <div className="flex items-center gap-3 flex-wrap">
                {border.reportCount && border.reportCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Users style={{ width: 12, height: 12, color: '#3a6090' }} />
                    <span style={{ fontSize: 12, color: '#4a6880' }}>{border.reportCount} отчётов от водителей</span>
                  </div>
                )}
                {border.lastReportBy && (
                  <span style={{ fontSize: 12, color: '#4a6880' }}>Последний: <strong style={{ color: '#7a9ab8' }}>{border.lastReportBy}</strong></span>
                )}
              </div>
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#060d16', border: '1px solid #1a2d45' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <Info style={{ width: 12, height: 12, color: '#3a6090' }} />
                  <span style={{ fontSize: 11, color: '#3a6090', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Данные от сообщества</span>
                </div>
                <p style={{ fontSize: 12, color: '#4a6880', lineHeight: 1.6 }}>
                  Статус обновляется в реальном времени водителями платформы. Данные могут отличаться от официальных.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Report button */}
        <button onClick={() => onReport(border)}
          style={{
            width: '100%', marginTop: 12, padding: '10px', borderRadius: 11,
            background: '#0a1828', border: '1px solid #1a3050',
            color: '#5ba3f5', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            transition: 'all .15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0f2448'; e.currentTarget.style.borderColor = '#2a5090'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0a1828'; e.currentTarget.style.borderColor = '#1a3050'; }}
        >
          <TrendingUp style={{ width: 13, height: 13 }} />
          Сообщить о ситуации
        </button>
      </div>
    </motion.div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────────────── */
export function BordersPage() {
  const navigate = useNavigate();
  const [borders, setBorders]   = useState<Border[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<'all' | BorderStatus>('all');
  const [reporting, setReporting] = useState<Border | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/borders`, { headers: withUserToken(H) });
      const data = await res.json();
      if (data.borders) setBorders(data.borders);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // auto-refresh every 90 seconds
  useEffect(() => {
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
  }, [load]);

  const counts = {
    all: borders.length,
    open: borders.filter(b => b.status === 'open').length,
    congested: borders.filter(b => b.status === 'congested').length,
    closed: borders.filter(b => b.status === 'closed').length,
  };

  const displayed = filter === 'all' ? borders : borders.filter(b => b.status === filter);

  const FILTERS: { key: typeof filter; label: string; color: string }[] = [
    { key: 'all',       label: `Все · ${counts.all}`,              color: '#5ba3f5' },
    { key: 'open',      label: `✅ Открыты · ${counts.open}`,      color: '#22c55e' },
    { key: 'congested', label: `⚠️ Заторы · ${counts.congested}`,  color: '#f59e0b' },
    { key: 'closed',    label: `❌ Закрыты · ${counts.closed}`,    color: '#ef4444' },
  ];

  return (
    <div style={{ background: '#060e1a', minHeight: '100vh', fontFamily: "'Sora', sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: '#060e1aee', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid #0d2035',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button onClick={() => navigate(-1)}
          style={{ width: 36, height: 36, borderRadius: 11, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <ArrowLeft style={{ width: 16, height: 16, color: '#7a9ab8' }} />
        </button>

        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 900, color: '#e2e8f0', lineHeight: 1 }}>Состояние границ</h1>
          <p style={{ fontSize: 11, color: '#4a6880', marginTop: 2 }}>Актуально · обновляется водителями</p>
        </div>

        <button onClick={load}
          style={{ width: 36, height: 36, borderRadius: 11, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <RefreshCw style={{ width: 14, height: 14, color: '#3a6090' }} />
        </button>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 80px' }}>

        {/* ── Live banner ─────────────────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg,#0f2448,#091428)',
          border: '1px solid #1a3560', borderRadius: 18,
          padding: '14px 18px', marginBottom: 18,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: '#0a1e40', border: '1px solid #1a3560', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Wifi style={{ width: 20, height: 20, color: '#5ba3f5' }} />
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#c0d8f5' }}>Краудсорсинговые данные</p>
            <p style={{ fontSize: 12, color: '#4a6880', marginTop: 2, lineHeight: 1.5 }}>
              Статус КПП обновляют водители в реальном времени. Помогите сообществу — сообщите о ситуации.
            </p>
          </div>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 18 }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                flexShrink: 0, padding: '7px 14px', borderRadius: 100,
                background: filter === f.key ? '#0f2448' : '#080f1a',
                border: `1px solid ${filter === f.key ? '#2a5090' : '#1a2d45'}`,
                color: filter === f.key ? f.color : '#3a5070',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all .15s',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* ── List ────────────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 130, borderRadius: 20, background: '#0a1220', border: '1px solid #0d1e30', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#3a5070' }}>
            <Flag style={{ width: 40, height: 40, margin: '0 auto 14px', opacity: 0.3 }} />
            <p style={{ fontSize: 15, fontWeight: 700 }}>Нет данных</p>
          </div>
        ) : (
          <div>
            {displayed.map(b => (
              <BorderCard key={b.id} border={b} onReport={setReporting} />
            ))}
          </div>
        )}

        {/* ── Footer note ─────────────────────────────────────────────────── */}
        {!loading && (
          <div style={{ textAlign: 'center', marginTop: 20, padding: '14px', borderRadius: 14, background: '#080f1a', border: '1px solid #0d2035' }}>
            <p style={{ fontSize: 12, color: '#2a4060', lineHeight: 1.6 }}>
              Данные предоставляются водителями Ovora Cargo и носят информационный характер.
              Официальную информацию уточняйте у пограничных служб.
            </p>
          </div>
        )}
      </div>

      {/* ── Report Modal ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {reporting && (
          <ReportModal
            border={reporting}
            onClose={() => setReporting(null)}
            onSuccess={load}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default BordersPage;

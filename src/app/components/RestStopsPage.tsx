import { useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Search, Star, Wifi, ShowerHead, ParkingSquare,
  Coffee, Clock4, MapPin, BadgePercent, Heart, X, Send, RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
// @ts-ignore — Vite virtual module resolved at build time
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';
import { withUserToken } from '../api/userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN };

interface RestStop {
  id: string;
  name: string;
  route: string;
  km: number;
  city: string;
  amenities: string[];
  price: number;
  hasDiscount: boolean;
  discountPct: number;
  rating: number;
  reviewCount: number;
}

type Amenity = 'shower' | 'wifi' | 'parking' | 'cafe' | '24h';

const AMENITY_CFG: Record<Amenity, { icon: typeof Wifi; label: string; color: string }> = {
  shower:  { icon: ShowerHead,     label: 'Душ',      color: '#5ba3f5' },
  wifi:    { icon: Wifi,           label: 'Wi-Fi',    color: '#a78bfa' },
  parking: { icon: ParkingSquare,  label: 'Стоянка',  color: '#34d399' },
  cafe:    { icon: Coffee,         label: 'Кафе',     color: '#f59e0b' },
  '24h':   { icon: Clock4,         label: '24/7',     color: '#f472b6' },
};

const ROUTE_IMAGES: Record<string, string> = {
  'М-5 Урал':          'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&h=220&fit=crop',
  'М-4 Дон':           'https://images.unsplash.com/photo-1545071496-07e32d8e40c1?w=400&h=220&fit=crop',
  'М-7 Волга':         'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&h=220&fit=crop',
  'Трасса Душанбе':    'https://images.unsplash.com/photo-1546961342-ea5f62d5a27b?w=400&h=220&fit=crop',
  'Трасса Худжанд':    'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=400&h=220&fit=crop',
};

function getImage(stop: RestStop) {
  return ROUTE_IMAGES[stop.route] || 'https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&h=220&fit=crop';
}

function StarRow({ value }: { value: number }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <Star key={i} style={{ width: 12, height: 12, color: i <= Math.round(value) ? '#f59e0b' : '#1a2d45', fill: i <= Math.round(value) ? '#f59e0b' : 'none' }} />
      ))}
    </span>
  );
}

/* ─── Review Modal ─────────────────────────────────────────────────────────── */
function ReviewModal({ stop, onClose, onSuccess }: { stop: RestStop; onClose: () => void; onSuccess: () => void }) {
  const userEmail = sessionStorage.getItem('ovora_user_email') || '';
  const userName  = sessionStorage.getItem('ovora_user_name') || 'Пользователь';
  const [rating, setRating] = useState(5);
  const [hover, setHover]   = useState(0);
  const [text, setText]     = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!userEmail) { toast.error('Необходима авторизация'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/rest-stops/${stop.id}/review`, {
        method: 'POST', headers: withUserToken(H),
        body: JSON.stringify({ userEmail, userName, rating, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success('Отзыв добавлен! Спасибо 🙏');
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div className="relative w-full max-w-lg mx-auto rounded-t-3xl md:rounded-3xl overflow-hidden"
        style={{ background: 'linear-gradient(180deg,#0d1929,#0a1220)', border: '1px solid #1a2d45', boxShadow: '0 -16px 48px #000000a0' }}
        initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}>
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div style={{ width: 36, height: 4, borderRadius: 2, background: '#1a3050' }} />
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{stop.name}</p>
              <p style={{ fontSize: 12, color: '#4a6880' }}>{stop.city} · {stop.route}</p>
            </div>
            <button onClick={onClose} aria-label="Закрыть" style={{ width: 32, height: 32, borderRadius: 9, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <X style={{ width: 14, height: 14, color: '#3a6090' }} />
            </button>
          </div>
          {/* Stars */}
          <p style={{ fontSize: 12, color: '#4a6880', fontWeight: 600, marginBottom: 10 }}>Ваша оценка</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
            {[1,2,3,4,5].map(i => (
              <button key={i} onClick={() => setRating(i)} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(0)}
                aria-label={`Оценить на ${i} из 5`}
                aria-pressed={rating === i}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, transition: 'transform .1s' }}>
                <Star style={{ width: 32, height: 32, color: i <= (hover || rating) ? '#f59e0b' : '#1a2d45', fill: i <= (hover || rating) ? '#f59e0b' : 'none', transition: 'all .15s' }} />
              </button>
            ))}
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)}
            placeholder="Расскажите о месте..." rows={3}
            style={{ width: '100%', background: '#080f1a', border: '1px solid #1a2d45', borderRadius: 10, padding: '10px 12px', color: '#c0d4e8', fontSize: 13, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} />
          <button onClick={submit} disabled={loading}
            style={{ width: '100%', padding: '14px', borderRadius: 14, background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', opacity: loading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {loading ? <RefreshCw style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} /> : <Send style={{ width: 16, height: 16 }} />}
            {loading ? 'Сохраняем...' : 'Отправить отзыв'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─── Stop Card ─────────────────────────────────────────────────────────────── */
function StopCard({ stop, onReview }: { stop: RestStop; onReview: (s: RestStop) => void }) {
  const [liked, setLiked] = useState(false);

  return (
    <motion.div
      style={{ background: 'linear-gradient(145deg,#0d1929,#091420)', border: '1px solid #1a2d45', borderRadius: 22, overflow: 'hidden', marginBottom: 14 }}
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }} transition={{ duration: 0.2 }}
    >
      {/* Image */}
      <div style={{ position: 'relative', height: 150, overflow: 'hidden' }}>
        <ImageWithFallback src={getImage(stop)} alt={stop.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        {/* Gradient overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top,#091420 0%,transparent 60%)' }} />
        {/* Discount badge */}
        {stop.hasDiscount && (
          <div style={{ position: 'absolute', top: 12, left: 12, background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', borderRadius: 10, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
            <BadgePercent style={{ width: 12, height: 12, color: '#fff' }} />
            <span style={{ fontSize: 11, fontWeight: 900, color: '#fff' }}>Скидка -{stop.discountPct}% Ovora</span>
          </div>
        )}
        {/* Fav button */}
        <button onClick={() => setLiked(v => !v)}
          style={{ position: 'absolute', top: 10, right: 12, width: 34, height: 34, borderRadius: 10, background: '#00000060', backdropFilter: 'blur(8px)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Heart style={{ width: 15, height: 15, color: liked ? '#f43f5e' : '#fff', fill: liked ? '#f43f5e' : 'none', transition: 'all .2s' }} />
        </button>
        {/* Route badge */}
        <div style={{ position: 'absolute', bottom: 10, left: 12, background: '#00000070', backdropFilter: 'blur(8px)', borderRadius: 8, padding: '4px 10px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#c0d8f5' }}>{stop.route}{stop.km > 0 ? ` · км ${stop.km}` : ''}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px 16px' }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{stop.name}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <MapPin style={{ width: 11, height: 11, color: '#3a6090' }} />
              <span style={{ fontSize: 12, color: '#4a6880' }}>{stop.city}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontSize: 18, fontWeight: 900, color: '#e2e8f0' }}>
              {stop.hasDiscount
                ? <><span style={{ color: '#5ba3f5' }}>{Math.round(stop.price * (1 - stop.discountPct / 100))}₽</span> <span style={{ fontSize: 13, color: '#3a5070', textDecoration: 'line-through' }}>{stop.price}₽</span></>
                : `${stop.price}₽`
              }
            </p>
            <p style={{ fontSize: 11, color: '#3a5070', marginTop: 1 }}>за ночь</p>
          </div>
        </div>

        {/* Rating */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <StarRow value={stop.rating} />
          <span style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{stop.rating.toFixed(1)}</span>
          <span style={{ fontSize: 12, color: '#3a5070' }}>({stop.reviewCount} отзывов)</span>
        </div>

        {/* Amenities */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {(stop.amenities as Amenity[]).map(a => {
            const cfg = AMENITY_CFG[a];
            if (!cfg) return null;
            const Icon = cfg.icon;
            return (
              <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: '#080f1a', border: '1px solid #1a2d45' }}>
                <Icon style={{ width: 12, height: 12, color: cfg.color }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#5a7a98' }}>{cfg.label}</span>
              </div>
            );
          })}
        </div>

        {/* Action */}
        <button onClick={() => onReview(stop)}
          style={{ width: '100%', marginTop: 14, padding: '11px', borderRadius: 12, background: '#0a1828', border: '1px solid #1a3050', color: '#5ba3f5', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all .15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#0f2448'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0a1828'; }}>
          <Star style={{ width: 13, height: 13 }} />
          Оставить отзыв
        </button>
      </div>
    </motion.div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────────── */
export function RestStopsPage() {
  const navigate = useNavigate();
  const [stops, setStops]           = useState<RestStop[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [activeFilters, setActiveFilters] = useState<Amenity[]>([]);
  const [reviewing, setReviewing]   = useState<RestStop | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/rest-stops`, { headers: withUserToken(H) });
      const data = await res.json();
      if (data.places) setStops(data.places);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFilter = (a: Amenity) =>
    setActiveFilters(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);

  const displayed = stops.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.city.toLowerCase().includes(search.toLowerCase()) || s.route.toLowerCase().includes(search.toLowerCase());
    const matchFilters = activeFilters.length === 0 || activeFilters.every(f => s.amenities.includes(f));
    return matchSearch && matchFilters;
  });

  return (
    <div style={{ background: '#060e1a', minHeight: '100vh', fontFamily: "'Sora', sans-serif" }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 30, background: '#060e1aee', backdropFilter: 'blur(16px)', borderBottom: '1px solid #0d2035', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button onClick={() => navigate(-1)}
            style={{ width: 36, height: 36, borderRadius: 11, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ArrowLeft style={{ width: 16, height: 16, color: '#7a9ab8' }} />
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 900, color: '#e2e8f0', lineHeight: 1 }}>Места отдыха</h1>
            <p style={{ fontSize: 11, color: '#4a6880', marginTop: 2 }}>Стоянки и кафе для дальнобойщиков</p>
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#3a6090' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по городу или трассе..."
            style={{ width: '100%', paddingLeft: 36, paddingRight: 12, paddingTop: 10, paddingBottom: 10, borderRadius: 12, background: '#080f1a', border: '1px solid #1a2d45', color: '#c0d4e8', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>

        {/* Amenity filters */}
        <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingTop: 10, paddingBottom: 2 }}>
          {(Object.entries(AMENITY_CFG) as [Amenity, typeof AMENITY_CFG[Amenity]][]).map(([key, cfg]) => {
            const active = activeFilters.includes(key);
            const Icon = cfg.icon;
            return (
              <button key={key} onClick={() => toggleFilter(key)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
                  padding: '6px 12px', borderRadius: 100,
                  background: active ? '#0f2448' : '#080f1a',
                  border: `1px solid ${active ? cfg.color + '55' : '#1a2d45'}`,
                  color: active ? cfg.color : '#3a5070',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
                }}>
                <Icon style={{ width: 12, height: 12 }} />
                {cfg.label}
              </button>
            );
          })}
          {activeFilters.length > 0 && (
            <button onClick={() => setActiveFilters([])}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 100, background: '#1a0808', border: '1px solid #3a1a1a', color: '#ef4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <X style={{ width: 11, height: 11 }} /> Сбросить
            </button>
          )}
        </div>
      </header>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '16px 16px 80px' }}>
        {/* Discount banner */}
        <div style={{ background: 'linear-gradient(135deg,#0a1e40,#0f2448)', border: '1px solid #1a3560', borderRadius: 16, padding: '12px 16px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <BadgePercent style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 800, color: '#c0d8f5' }}>Скидка -20% для водителей Ovora</p>
            <p style={{ fontSize: 11, color: '#4a6880', marginTop: 2 }}>Покажите значок Ovora при заселении</p>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[1,2,3].map(i => <div key={i} style={{ height: 280, borderRadius: 22, background: '#0a1220', border: '1px solid #0d1e30', animation: 'pulse 1.5s ease-in-out infinite' }} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#3a5070' }}>
            <Coffee style={{ width: 40, height: 40, margin: '0 auto 14px', opacity: 0.3 }} />
            <p style={{ fontSize: 15, fontWeight: 700 }}>Ничего не найдено</p>
            <p style={{ fontSize: 13, marginTop: 6 }}>Попробуйте изменить фильтры</p>
          </div>
        ) : (
          <div>
            <p style={{ fontSize: 12, color: '#3a5070', marginBottom: 12 }}>{displayed.length} мест{displayed.length !== 1 ? '' : 'о'}</p>
            {displayed.map(s => <StopCard key={s.id} stop={s} onReview={setReviewing} />)}
          </div>
        )}
      </div>

      <AnimatePresence>
        {reviewing && <ReviewModal stop={reviewing} onClose={() => setReviewing(null)} onSuccess={load} />}
      </AnimatePresence>
    </div>
  );
}

export default RestStopsPage;

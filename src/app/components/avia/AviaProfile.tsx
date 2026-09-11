import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useBlocker } from 'react-router';
import { toast } from 'sonner';
import { User, Camera, Save, CheckCircle2, Package, Send, Loader2, AlertCircle, ShieldCheck, ShieldAlert, ShieldX, KeyRound, Timer, Plane, Handshake, MessageCircle, ThumbsUp, ThumbsDown, MapPin, AtSign, Star, TrendingUp, Calendar, ChevronDown, ChevronUp, LogOut, Plus, Search, ChevronRight, Phone, Shield, Info, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAvia } from './AviaContext';
import { updateAviaProfile, canCreateAd, changeAviaPin } from '../../api/aviaApi';
import { usePassportUpload } from '../../hooks/usePassportUpload';
import { useAvatarUpload } from '../../hooks/useAvatarUpload';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';
import type { AviaUser } from '../../api/aviaApi';
import { getAviaStats } from '../../api/aviaDealApi';
import type { AviaStats } from '../../api/aviaDealApi';
import { getAviaUserReviews } from '../../api/aviaReviewApi';
import type { AviaReview } from '../../api/aviaReviewApi';
import { AviaRatingBadge } from './AviaRatingBadge';
import { AviaVerificationSheet } from './AviaVerificationSheet';

type AviaRole = 'courier' | 'sender';

const ROLE_OPTIONS: { id: AviaRole; icon: typeof Package; label: string; color: string; desc: string }[] = [
  { id: 'courier', icon: Package, label: 'Курьер',       color: '#0ea5e9', desc: 'Создаю рейсы' },
  { id: 'sender',  icon: Send,    label: 'Отправитель',  color: '#a78bfa', desc: 'Ищу курьеров' },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#0b1929',
  border: '1px solid #ffffff0d',
  borderRadius: 20,
  overflow: 'hidden',
  transition: 'border-color 0.3s, box-shadow 0.3s',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  borderRadius: 11, border: '1.5px solid #ffffff10',
  background: '#ffffff07', color: '#e2eeff',
  fontSize: 13, fontWeight: 500,
  outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  color: '#3d5a78', marginBottom: 5,
  letterSpacing: '0.06em', textTransform: 'uppercase',
};

// ── Completeness ──────────────────────────────────────────────────────────────

type CompletenessItem = { label: string; done: boolean };

function calcCompleteness(
  firstName: string, lastName: string, middleName: string,
  birthDate: string, passportNumber: string, hasPassport: boolean,
  city: string, telegram: string,
): { pct: number; filled: number; total: number; items: CompletenessItem[] } {
  const items: CompletenessItem[] = [
    { label: 'Фамилия', done: !!lastName.trim() },
    { label: 'Имя', done: !!firstName.trim() },
    { label: 'Отчество', done: !!middleName.trim() },
    { label: 'Дата рождения', done: !!birthDate },
    { label: 'Номер паспорта', done: !!passportNumber.trim() },
    { label: 'Фото паспорта', done: hasPassport },
    { label: 'Город', done: !!city.trim() },
    { label: 'Telegram', done: !!telegram.trim() },
  ];
  const filled = items.filter(i => i.done).length;
  return { pct: Math.round((filled / items.length) * 100), filled, total: items.length, items };
}

// ── SVG Progress Ring ──

function ProgressRing({ pct, color, size = 64, stroke = 4 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff08" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          initial={{ strokeDasharray: circ, strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <motion.span
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, duration: 0.3 }}
          style={{ fontSize: 15, fontWeight: 900, color, lineHeight: 1 }}
        >
          {pct}%
        </motion.span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  HeroCard — аватар, имя, телефон, роль, рейтинг, completeness
// ─────────────────────────────────────────────────────────────────────────────

interface HeroProps {
  user: AviaUser;
  likes: number;
  dislikes: number;
  completeness: { pct: number; filled: number; total: number; items: { label: string; done: boolean }[] };
  onAvatarUpload: (file: File) => Promise<void>;
  avatarUploading: boolean;
}

function HeroCard({ user, likes, dislikes, completeness, onAvatarUpload, avatarUploading }: HeroProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const fullName = [user.lastName, user.firstName, user.middleName].filter(Boolean).join(' ');
  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    : null;
  const roleInfo = ROLE_OPTIONS.find(r => r.id === user.role) ?? ROLE_OPTIONS[1];
  const pctColor = completeness.pct >= 80 ? '#34d399' : completeness.pct >= 50 ? '#fbbf24' : '#f87171';

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onAvatarUpload(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  return (
    <div style={{ ...card, padding: '24px 20px 20px' }}>
      <input type="file" ref={avatarInputRef} accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />

      {/* Avatar */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div
          style={{ position: 'relative', cursor: 'pointer' }}
          onClick={() => !avatarUploading && avatarInputRef.current?.click()}
        >
          {/* Ring */}
          <motion.div
            animate={!user.avatarUrl ? { scale: [1, 1.06, 1], opacity: [0.7, 1, 0.7] } : {}}
            transition={!user.avatarUrl ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } : {}}
            style={{
              position: 'absolute', inset: -3,
              borderRadius: '50%',
              background: `conic-gradient(${roleInfo.color} ${completeness.pct * 3.6}deg, #ffffff0a 0deg)`,
            }}
          />
          <div style={{
            width: 88, height: 88, borderRadius: '50%',
            background: user.avatarUrl ? 'transparent' : `linear-gradient(135deg, ${roleInfo.color}18, ${roleInfo.color}08)`,
            border: '3px solid var(--avia-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', position: 'relative',
          }}>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="Аватар" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <User style={{ width: 36, height: 36, color: roleInfo.color }} />
            }
            <div className="avia-avatar-overlay" style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: avatarUploading ? 1 : 0, transition: 'opacity 0.2s',
            }}>
              {avatarUploading
                ? <Loader2 style={{ width: 22, height: 22, color: '#fff', animation: 'avia-spin 1s linear infinite' }} />
                : <Camera style={{ width: 20, height: 20, color: '#fff' }} />
              }
            </div>
          </div>

          {/* Camera badge */}
          <div style={{
            position: 'absolute', bottom: 0, right: 0,
            width: 26, height: 26, borderRadius: '50%',
            background: roleInfo.color, border: '2.5px solid var(--avia-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Camera style={{ width: 12, height: 12, color: '#fff' }} />
          </div>
        </div>

        {/* Name & phone */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#e2eeff', lineHeight: 1.2 }}>
            {fullName || <span style={{ color: '#3d5a78' }}>Имя не указано</span>}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 4 }}>
            <Phone style={{ width: 10, height: 10, color: '#3d5a78' }} />
            <span style={{ fontSize: 12, color: '#3d5a78', letterSpacing: '0.03em' }}>
              +{user.phone?.slice(0, 3)} *** {user.phone?.slice(-4)}
            </span>
          </div>
        </div>

        {/* Role + Rating row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 12px', borderRadius: 99,
            background: `${roleInfo.color}12`, border: `1px solid ${roleInfo.color}30`,
          }}>
            <roleInfo.icon style={{ width: 11, height: 11, color: roleInfo.color }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: roleInfo.color }}>{roleInfo.label}</span>
          </div>

          <AviaRatingBadge likes={likes} dislikes={dislikes} size="sm" />

          {memberSince && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 99,
              background: '#ffffff06', border: '1px solid #ffffff0d',
            }}>
              <Calendar style={{ width: 10, height: 10, color: '#3d5a78' }} />
              <span style={{ fontSize: 10, color: '#3d5a78', fontWeight: 600 }}>с {memberSince}</span>
            </div>
          )}
        </div>

        {/* Quick info chips */}
        {(user.city || user.telegram) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {user.city && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 7, background: '#ffffff06', border: '1px solid #ffffff0d' }}>
                <MapPin style={{ width: 10, height: 10, color: '#3d5a78' }} />
                <span style={{ fontSize: 11, color: '#6b8faa', fontWeight: 500 }}>{user.city}</span>
              </div>
            )}
            {user.telegram && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 7, background: '#0ea5e908', border: '1px solid #0ea5e918' }}>
                <AtSign style={{ width: 10, height: 10, color: '#0ea5e9' }} />
                <span style={{ fontSize: 11, color: '#0ea5e9', fontWeight: 600 }}>{user.telegram}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Completeness section */}
      <div style={{ marginTop: 20, padding: '16px', borderRadius: 14, background: '#ffffff04', border: '1px solid #ffffff08' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ProgressRing pct={completeness.pct} color={pctColor} size={58} stroke={4} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b8faa', marginBottom: 4 }}>
              Заполненность профиля
            </div>
            {/* Segmented bar */}
            <div style={{ display: 'flex', gap: 3, marginBottom: 6 }}>
              {completeness.items.map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.4, delay: 0.3 + i * 0.06, ease: 'easeOut' }}
                  style={{
                    flex: 1, height: 4, borderRadius: 99,
                    background: item.done
                      ? `linear-gradient(90deg, ${pctColor}90, ${pctColor})`
                      : '#ffffff0d',
                    transformOrigin: 'left',
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#2a4a65' }}>
              {completeness.filled} из {completeness.total} полей
            </div>
          </div>
        </div>

        {/* Missing fields hints */}
        {completeness.pct < 100 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.3 }}
            style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}
          >
            {completeness.items.filter(i => !i.done).map(item => (
              <span key={item.label} style={{
                padding: '2px 8px', borderRadius: 6, fontSize: 9, fontWeight: 600,
                background: `${pctColor}10`, border: `1px solid ${pctColor}20`,
                color: pctColor,
              }}>
                {item.label}
              </span>
            ))}
          </motion.div>
        )}
        {completeness.pct === 100 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.3 }}
            style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 8,
              background: '#34d39908', border: '1px solid #34d39920',
            }}
          >
            <CheckCircle2 style={{ width: 12, height: 12, color: '#34d399' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399' }}>Профиль заполнен полностью!</span>
          </motion.div>
        )}
      </div>

      <style>{`
        div:has(> .avia-avatar-overlay):hover .avia-avatar-overlay { opacity: 1 !important; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  QuickActions — роль-зависимые быстрые действия
// ─────────────────────────────────────────────────────────────────────────────

interface QuickAction {
  icon: typeof Plane;
  label: string;
  sub: string;
  color: string;
  route?: string;
  onClick?: () => void;
  badge?: number;
}

function QuickActionsCard({ role, onCreateFlight, dealsPending, chatUnread }: {
  role: AviaRole;
  onCreateFlight: () => void;
  dealsPending: number;
  chatUnread: number;
}) {
  const navigate = useNavigate();

  const allActions: Record<string, QuickAction[]> = {
    courier: [
      { icon: Plane,       label: 'Мои рейсы',    sub: 'Управление рейсами',   color: '#0ea5e9', route: '/avia/dashboard' },
      { icon: Plus,        label: 'Новый рейс',    sub: 'Создать объявление',   color: '#34d399', onClick: onCreateFlight },
      { icon: Handshake,   label: 'Сделки',        sub: 'Активные сделки',      color: '#a78bfa', route: '/avia/deals', badge: dealsPending },
      { icon: MessageCircle, label: 'Сообщения',   sub: 'Чаты с отправителями', color: '#f59e0b', route: '/avia/messages', badge: chatUnread },
    ],
    sender: [
      { icon: Search,      label: 'Найти рейс',    sub: 'Поиск курьеров',       color: '#0ea5e9', route: '/avia/dashboard' },
      { icon: Handshake,   label: 'Сделки',        sub: 'Мои договорённости',   color: '#a78bfa', route: '/avia/deals', badge: dealsPending },
      { icon: MessageCircle, label: 'Сообщения',   sub: 'Чаты с курьерами',     color: '#f59e0b', route: '/avia/messages', badge: chatUnread },
    ],
  };

  const actions = allActions[role] ?? allActions.sender;

  return (
    <div style={{ ...card, padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <TrendingUp style={{ width: 12, height: 12, color: '#3d5a78' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#3d5a78', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Быстрые действия
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {actions.map((action, idx) => {
          const Icon = action.icon;
          return (
            <motion.button
              key={action.label}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: idx * 0.06, duration: 0.25 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => action.onClick ? action.onClick() : action.route && navigate(action.route)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 12px', borderRadius: 14, cursor: 'pointer',
                background: `${action.color}08`, border: `1px solid ${action.color}20`,
                textAlign: 'left', position: 'relative', overflow: 'hidden',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 11, flexShrink: 0,
                background: `${action.color}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon style={{ width: 16, height: 16, color: action.color }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#ddeeff', lineHeight: 1.2 }}>{action.label}</div>
                <div style={{ fontSize: 10, color: '#3d5a78', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.sub}</div>
              </div>
              {!!action.badge && action.badge > 0 && (
                <div style={{
                  position: 'absolute', top: 7, right: 7,
                  minWidth: 16, height: 16, borderRadius: 99,
                  background: action.color, padding: '0 4px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 800, color: '#fff',
                }}>
                  {action.badge > 9 ? '9+' : action.badge}
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  StatsRow — горизонтальные мини-статы
// ─────────────────────────────────────────────────────────────────────────────

function StatsRow({ stats, onDealsClick }: { stats: AviaStats; onDealsClick: () => void }) {
  const items = [
    { icon: Plane,         color: '#0ea5e9', value: stats.flightsTotal,  label: 'Рейсов',  sub: `${stats.flightsActive} акт.` },
    { icon: Handshake,     color: '#34d399', value: stats.dealsTotal,    label: 'Сделок',  sub: `${stats.dealsCompleted} зав.` },
    { icon: MessageCircle, color: '#f59e0b', value: stats.chatsTotal,    label: 'Чатов',   sub: '' },
  ];

  return (
    <div style={{ ...card, padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <TrendingUp style={{ width: 12, height: 12, color: '#3d5a78' }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#3d5a78', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Статистика
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
        {items.map(({ icon: Icon, color, value, label, sub }) => (
          <div key={label} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '12px 6px', borderRadius: 14,
            background: `${color}08`, border: `1px solid ${color}18`,
            gap: 2,
          }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: `${color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
              <Icon style={{ width: 13, height: 13, color }} />
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            <div style={{ fontSize: 9, color: '#3d5a78', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>
              {label}{sub ? `\n${sub}` : ''}
            </div>
          </div>
        ))}
      </div>

      {stats.dealsPending > 0 && (
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onDealsClick}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 12, cursor: 'pointer',
            background: '#34d39908', border: '1px solid #34d39925',
            marginTop: 10,
          }}
        >
          <Handshake style={{ width: 13, height: 13, color: '#34d399', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#34d399', fontWeight: 700, flex: 1 }}>
            {stats.dealsPending} предложений ждут ответа
          </span>
          <ChevronRight style={{ width: 14, height: 14, color: '#34d39960' }} />
        </motion.button>
      )}
    </div>
  );
}

// ── StatsRow Skeleton ──

function StatsRowSkeleton() {
  return (
    <div style={{ ...card, padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <div className="avia-skel-pulse" style={{ width: 12, height: 12, borderRadius: 3 }} />
        <div className="avia-skel-pulse" style={{ width: 70, height: 8, borderRadius: 4 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            padding: '12px 6px', borderRadius: 14,
            background: '#ffffff04', border: '1px solid #ffffff08',
          }}>
            <div className="avia-skel-pulse" style={{ width: 30, height: 30, borderRadius: 9 }} />
            <div className="avia-skel-pulse" style={{ width: 24, height: 18, borderRadius: 5 }} />
            <div className="avia-skel-pulse" style={{ width: 36, height: 7, borderRadius: 3 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PersonalDataForm Skeleton ──

function PersonalDataFormSkeleton() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px' }}>
        <div className="avia-skel-pulse" style={{ width: 34, height: 34, borderRadius: 10 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="avia-skel-pulse" style={{ width: 110, height: 11, borderRadius: 5 }} />
          <div className="avia-skel-pulse" style={{ width: 150, height: 8, borderRadius: 4 }} />
        </div>
        <div className="avia-skel-pulse" style={{ width: 16, height: 16, borderRadius: 4 }} />
      </div>
    </div>
  );
}

// ── ReviewsCard Skeleton ──

function ReviewsCardSkeleton() {
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px' }}>
        <div className="avia-skel-pulse" style={{ width: 36, height: 36, borderRadius: 11 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="avia-skel-pulse" style={{ width: 120, height: 11, borderRadius: 5 }} />
          <div className="avia-skel-pulse" style={{ width: 160, height: 8, borderRadius: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div className="avia-skel-pulse" style={{ width: 42, height: 20, borderRadius: 6 }} />
          <div className="avia-skel-pulse" style={{ width: 42, height: 20, borderRadius: 6 }} />
        </div>
        <div className="avia-skel-pulse" style={{ width: 16, height: 16, borderRadius: 4 }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PassportCard — компактная кнопка-триггер → открывает AviaVerificationSheet
// ─────────────────────────────────────────────────────────────────────────────

interface PassportProps {
  user: AviaUser;
  passportUrl: string | null;
  passportExpiry: string;
  manualExpiry: string;
  setManualExpiry: (v: string) => void;
  uploading: boolean;
  uploadSuccess: string | null;
  onConfirmUpload: (file: File, skipOcr: boolean) => void;
  onUpdateClick?: () => void;
}

type PassportStatus = 'none' | 'valid' | 'expired';

const PASSPORT_TRIGGER_CONFIG = {
  none: {
    color: '#f59e0b',
    glow: '#f59e0b15',
    border: '#f59e0b28',
    icon: ShieldAlert,
    title: 'Верификация паспорта',
    sub: 'Не пройдена · Требуется для объявлений',
    pill: 'Загрузить',
    pillBg: '#f59e0b14',
    accent: true,
  },
  valid: {
    color: '#34d399',
    glow: '#34d39910',
    border: '#34d39920',
    icon: ShieldCheck,
    title: 'Верификация паспорта',
    sub: 'Пройдена · Все функции доступны',
    pill: '✓ Подтверждён',
    pillBg: '#34d39912',
    accent: false,
  },
  expired: {
    color: '#f87171',
    glow: '#f8717110',
    border: '#f8717125',
    icon: ShieldX,
    title: 'Верификация паспорта',
    sub: 'Паспорт просрочен · Доступ ограничен',
    pill: '✕ Просрочен',
    pillBg: '#f8717112',
    accent: true,
  },
} as const;

function PassportCard({
  user, passportUrl, passportExpiry, manualExpiry, setManualExpiry,
  uploading, uploadSuccess, onConfirmUpload, onUpdateClick,
}: PassportProps) {
  // См. AviaVerificationSheet: фото/путь доступны только владельцу с токеном,
  // поэтому факт загрузки берём из passportVerified/passportUploadedAt.
  const hasPassport = !!(user.passportPhoto || user.passportPhotoPath || user.passportVerified || user.passportUploadedAt);
  const exp = user.passportExpiryDate || passportExpiry;
  const isExpired = exp ? new Date(exp).getTime() < Date.now() : false;
  const [sheetOpen, setSheetOpen] = useState(false);

  const status: PassportStatus = !hasPassport ? 'none' : isExpired ? 'expired' : 'valid';
  const cfg = PASSPORT_TRIGGER_CONFIG[status];
  const StatusIcon = cfg.icon;

  return (
    <>
      {/* ── Compact trigger button ── */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => setSheetOpen(true)}
        style={{
          width: '100%', cursor: 'pointer',
          borderRadius: 18, border: `1.5px solid ${cfg.border}`,
          background: cfg.glow,
          overflow: 'hidden',
          boxShadow: cfg.accent ? `0 4px 20px ${cfg.color}10` : 'none',
          transition: 'box-shadow 0.3s',
          textAlign: 'left',
        }}
      >
        {/* Accent top line */}
        {cfg.accent && (
          <div style={{
            height: 2,
            background: `linear-gradient(90deg, transparent, ${cfg.color}70, transparent)`,
          }} />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '15px 18px' }}>
          {/* Status icon */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: cfg.pillBg, border: `1.5px solid ${cfg.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <StatusIcon style={{ width: 20, height: 20, color: cfg.color }} />
            </div>
            {status === 'valid' && (
              <div style={{
                position: 'absolute', bottom: -3, right: -3,
                width: 16, height: 16, borderRadius: '50%',
                background: '#34d399', border: '2.5px solid #0b1929',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle2 style={{ width: 8, height: 8, color: '#fff' }} />
              </div>
            )}
            {status === 'none' && (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute', bottom: -3, right: -3,
                  width: 14, height: 14, borderRadius: '50%',
                  background: '#f59e0b', border: '2.5px solid #0b1929',
                }}
              />
            )}
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#ddeeff', letterSpacing: '-0.1px', marginBottom: 3 }}>
              {cfg.title}
            </h2>
            <div style={{ fontSize: 11, color: cfg.color, fontWeight: 600, opacity: 0.85 }}>
              {cfg.sub}
            </div>
            {status === 'valid' && exp && (
              <div style={{ fontSize: 10, color: '#3d5a78', marginTop: 3 }}>
                До {new Date(exp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}
          </div>

          {/* Pill + arrow */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{
              padding: '4px 10px', borderRadius: 99,
              background: cfg.pillBg, border: `1px solid ${cfg.border}`,
              fontSize: 10, fontWeight: 800, color: cfg.color, whiteSpace: 'nowrap',
            }}>
              {cfg.pill}
            </div>
            <ChevronRight style={{ width: 14, height: 14, color: `${cfg.color}60` }} />
          </div>
        </div>

        {/* Uploading inline */}
        {uploading && (
          <div style={{ padding: '0 18px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 style={{ width: 12, height: 12, color: '#f59e0b', animation: 'avia-spin 1s linear infinite' }} />
            <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>Загрузка и OCR распознавание...</span>
          </div>
        )}

        {/* Upload result inline */}
        {uploadSuccess && !uploading && (
          <div style={{
            margin: '0 14px 14px',
            display: 'flex', gap: 7, padding: '8px 12px', borderRadius: 10,
            background: isExpired ? '#f8717110' : '#34d39910',
            border: `1px solid ${isExpired ? '#f8717125' : '#34d39925'}`,
          }}>
            <CheckCircle2 style={{ width: 12, height: 12, color: isExpired ? '#f87171' : '#34d399', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: isExpired ? '#f87171' : '#34d399' }}>
              {uploadSuccess}
            </span>
          </div>
        )}
      </motion.button>

      {/* ── Full Verification Sheet ── */}
      <AviaVerificationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        user={user}
        passportUrl={passportUrl}
        passportExpiry={passportExpiry}
        manualExpiry={manualExpiry}
        setManualExpiry={setManualExpiry}
        uploading={uploading}
        uploadSuccess={uploadSuccess}
        onConfirmUpload={onConfirmUpload}
        onUpdateClick={onUpdateClick}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  PersonalDataForm — коллапсируемая форма
// ─────────────────────────────────────────────────────────────────────────────

interface FormProps {
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
  middleName: string; setMiddleName: (v: string) => void;
  birthDate: string; setBirthDate: (v: string) => void;
  passportNumber: string; setPassportNumber: (v: string) => void;
  city: string; setCity: (v: string) => void;
  telegram: string; setTelegram: (v: string) => void;
  role: AviaRole; setRole: (v: AviaRole) => void;
  saving: boolean; saved: boolean; error: string;
  adCheck: { allowed: boolean; reason?: string };
  hasPassport: boolean; isExpired: boolean;
  onSave: () => void;
}

// ── Inline validation helpers ──

type FieldErrors = Record<string, string>;

const inputErrorStyle: React.CSSProperties = {
  borderColor: '#f87171',
  boxShadow: '0 0 0 1px rgba(248,113,113,0.25)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, color: '#f87171',
  marginTop: 3, lineHeight: 1.3,
  display: 'flex', alignItems: 'center', gap: 3,
};

function validateFields(
  firstName: string, lastName: string, birthDate: string,
  passportNumber: string, telegram: string,
): FieldErrors {
  const e: FieldErrors = {};
  if (!lastName.trim()) e.lastName = 'Фамилия обязательна';
  else if (lastName.trim().length < 2) e.lastName = 'Минимум 2 символа';
  else if (!/^[a-zA-Zа-яА-ЯёЁ\s\-']+$/.test(lastName.trim())) e.lastName = 'Только буквы, дефис, пробел';

  if (!firstName.trim()) e.firstName = 'Имя обязательно';
  else if (firstName.trim().length < 2) e.firstName = 'Минимум 2 символа';
  else if (!/^[a-zA-Zа-яА-ЯёЁ\s\-']+$/.test(firstName.trim())) e.firstName = 'Только буквы, дефис, пробел';

  if (birthDate) {
    const bd = new Date(birthDate);
    const age = (Date.now() - bd.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (age < 14) e.birthDate = 'Минимальный возраст — 14 лет';
    if (age > 120) e.birthDate = 'Проверьте дату рождения';
  }

  if (passportNumber.trim() && passportNumber.trim().length < 5)
    e.passportNumber = 'Минимум 5 символов';

  if (telegram.trim() && !/^[a-zA-Z0-9_]{3,32}$/.test(telegram.trim()))
    e.telegram = 'Латиница, цифры, _ · 3–32 символа';

  return e;
}

function FieldHint({ error }: { error?: string }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.15 }}
          style={hintStyle}
        >
          <AlertCircle style={{ width: 9, height: 9, flexShrink: 0 }} />
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PersonalDataForm({
  firstName, setFirstName, lastName, setLastName,
  middleName, setMiddleName, birthDate, setBirthDate,
  passportNumber, setPassportNumber, city, setCity,
  telegram, setTelegram, role, setRole,
  saving, saved, error, adCheck, hasPassport, isExpired, onSave,
}: FormProps) {
  const [open, setOpen] = useState(false);
  const [shakeError, setShakeError] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [passportMasked, setPassportMasked] = useState(true);

  const fieldErrors = validateFields(firstName, lastName, birthDate, passportNumber, telegram);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const showError = (field: string) => (touched[field] || submitAttempted) ? fieldErrors[field] : undefined;
  const fieldInputStyle = (field: string): React.CSSProperties =>
    showError(field) ? { ...inputStyle, ...inputErrorStyle } : inputStyle;

  const markTouched = (field: string) => setTouched(prev => ({ ...prev, [field]: true }));

  const filledCount = [firstName, lastName, middleName, birthDate, passportNumber, city, telegram].filter(v => v.trim()).length;
  const errorCount = Object.keys(fieldErrors).length;

  return (
    <div style={card}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: 10, background: '#0ea5e910', border: '1px solid #0ea5e920', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <User style={{ width: 14, height: 14, color: '#0ea5e9' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#ddeeff' }}>Личные данные</h2>
          <div style={{ fontSize: 10, color: '#3d5a78', marginTop: 1 }}>
            {filledCount > 0 ? `${filledCount} из 7 полей · Нажмите для редактирования` : 'Нажмите для заполнения'}
          </div>
        </div>
        {!open && submitAttempted && errorCount > 0 && (
          <div style={{
            padding: '3px 8px', borderRadius: 99, marginRight: 4,
            background: '#f8717112', border: '1px solid #f8717130',
            fontSize: 10, fontWeight: 700, color: '#f87171',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <AlertCircle style={{ width: 9, height: 9 }} />
            {errorCount}
          </div>
        )}
        {!open && filledCount > 0 && !(submitAttempted && errorCount > 0) && (
          <motion.div
            animate={filledCount < 4 ? { scale: [1, 1.12, 1] } : {}}
            transition={filledCount < 4 ? { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } : {}}
            style={{
              padding: '3px 8px', borderRadius: 99, marginRight: 4,
              background: filledCount >= 5 ? '#34d39910' : '#fbbf2410',
              border: `1px solid ${filledCount >= 5 ? '#34d39925' : '#fbbf2425'}`,
              fontSize: 10, fontWeight: 700,
              color: filledCount >= 5 ? '#34d399' : '#fbbf24',
            }}
          >
            {filledCount}/7
          </motion.div>
        )}
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown style={{ width: 16, height: 16, color: '#3d5a78' }} />
        </motion.div>
      </button>

      {/* Preview when collapsed */}
      <AnimatePresence initial={false}>
        {!open && (firstName.trim() || lastName.trim()) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <div style={{ padding: '0 18px 14px' }}>
              <div style={{ height: 1, background: '#ffffff07', marginBottom: 10 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {[lastName.trim(), firstName.trim()].filter(Boolean).map((v, i) => (
                  <span key={i} style={{ padding: '3px 8px', borderRadius: 6, background: '#ffffff06', border: '1px solid #ffffff0d', fontSize: 11, color: '#6b8faa', fontWeight: 500 }}>{v}</span>
                ))}
                {city.trim() && (
                  <span style={{ padding: '3px 8px', borderRadius: 6, background: '#ffffff06', border: '1px solid #ffffff0d', fontSize: 11, color: '#4a7090', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <MapPin style={{ width: 9, height: 9 }} />{city.trim()}
                  </span>
                )}
                <motion.span
                  key={role}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                  style={{
                    padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: (ROLE_OPTIONS.find(r => r.id === role)?.color || '#34d399') + '10',
                    color: ROLE_OPTIONS.find(r => r.id === role)?.color || '#34d399',
                    border: `1px solid ${(ROLE_OPTIONS.find(r => r.id === role)?.color || '#34d399')}25`,
                  }}
                >
                  {ROLE_OPTIONS.find(r => r.id === role)?.label || 'Оба'}
                </motion.span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ height: 1, background: '#ffffff07', marginBottom: 2 }} />

              {/* Name row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Фамилия *</label>
                  <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} onBlur={() => markTouched('lastName')} placeholder="Иванов" style={fieldInputStyle('lastName')} />
                  <FieldHint error={showError('lastName')} />
                </div>
                <div>
                  <label style={labelStyle}>Имя *</label>
                  <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} onBlur={() => markTouched('firstName')} placeholder="Иван" style={fieldInputStyle('firstName')} />
                  <FieldHint error={showError('firstName')} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Отчество</label>
                <input type="text" value={middleName} onChange={e => setMiddleName(e.target.value)} placeholder="Иванович" style={inputStyle} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Дата рождения</label>
                  <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)} onBlur={() => markTouched('birthDate')} style={{ ...fieldInputStyle('birthDate'), colorScheme: 'dark' }} />
                  <FieldHint error={showError('birthDate')} />
                </div>
                <div>
                  <label style={labelStyle}>Номер паспорта</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={passportMasked ? 'password' : 'text'}
                      value={passportNumber}
                      onChange={e => setPassportNumber(e.target.value)}
                      onBlur={() => markTouched('passportNumber')}
                      placeholder="00 0000000"
                      style={{ ...fieldInputStyle('passportNumber'), paddingRight: 36 }}
                    />
                    <button
                      type="button"
                      onClick={() => setPassportMasked(v => !v)}
                      aria-label={passportMasked ? 'Показать номер паспорта' : 'Скрыть номер паспорта'}
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {passportMasked
                        ? <EyeOff style={{ width: 13, height: 13, color: '#3d5a78' }} />
                        : <Eye style={{ width: 13, height: 13, color: '#0ea5e9' }} />
                      }
                    </button>
                  </div>
                  <FieldHint error={showError('passportNumber')} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>
                    Город <span style={{ color: '#2a4a65', textTransform: 'none', fontWeight: 500, fontSize: 9 }}>необяз.</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <MapPin style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: '#3d5a78' }} />
                    <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Москва" style={{ ...inputStyle, paddingLeft: 30 }} />
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>
                    Telegram <span style={{ color: '#2a4a65', textTransform: 'none', fontWeight: 500, fontSize: 9 }}>необяз.</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <AtSign style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: '#0ea5e9' }} />
                    <input type="text" value={telegram} onChange={e => setTelegram(e.target.value.replace(/^@/, ''))} onBlur={() => markTouched('telegram')} placeholder="username" style={{ ...fieldInputStyle('telegram'), paddingLeft: 30 }} />
                  </div>
                  <FieldHint error={showError('telegram')} />
                </div>
              </div>

              {/* Role */}
              <div>
                <label style={{ ...labelStyle, marginBottom: 8 }}>Роль в системе</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {ROLE_OPTIONS.map((r) => {
                    const isSelected = role === r.id;
                    const Icon = r.icon;
                    return (
                      <motion.button
                        key={r.id}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setRole(r.id)}
                        style={{
                          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                          padding: '10px 6px', borderRadius: 12, cursor: 'pointer',
                          background: isSelected ? `${r.color}12` : '#ffffff06',
                          border: `1.5px solid ${isSelected ? `${r.color}45` : '#ffffff0d'}`,
                          transition: 'all 0.2s',
                        }}
                      >
                        <Icon style={{ width: 15, height: 15, color: isSelected ? r.color : '#3d5a78' }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: isSelected ? '#ddeeff' : '#3d5a78' }}>{r.label}</span>
                        <span style={{ fontSize: 9, color: isSelected ? r.color : '#2a4a65' }}>{r.desc}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              {/* Warnings */}
              {hasPassport && !adCheck.allowed && adCheck.reason && !isExpired && (
                <div style={{ display: 'flex', gap: 8, padding: '9px 12px', borderRadius: 10, background: '#fbbf2406', border: '1px solid #fbbf2418' }}>
                  <AlertCircle style={{ width: 12, height: 12, color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 11, color: '#c9922a' }}>{adCheck.reason}</span>
                </div>
              )}

              {/* Error */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    style={{ display: 'flex', gap: 8, padding: '9px 12px', borderRadius: 10, background: '#f8717110', border: '1px solid #f8717130' }}
                  >
                    <AlertCircle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Save */}
              <motion.button
                animate={shakeError ? { x: [0, -6, 6, -4, 4, 0] } : {}}
                transition={shakeError ? { duration: 0.4 } : {}}
                onAnimationComplete={() => setShakeError(false)}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  setSubmitAttempted(true);
                  if (hasFieldErrors) { setShakeError(true); return; }
                  onSave();
                }}
                disabled={saving}
                style={{
                  width: '100%', padding: '13px 20px', borderRadius: 13, border: 'none', marginTop: 2,
                  background: saved
                    ? 'linear-gradient(135deg, #059669, #34d399)'
                    : saving || (submitAttempted && hasFieldErrors)
                      ? '#ffffff0d'
                      : 'linear-gradient(135deg, #0369a1, #0ea5e9)',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: saving ? 'wait' : (submitAttempted && hasFieldErrors) ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: saved ? '0 4px 16px #34d39933' : saving ? 'none' : (submitAttempted && hasFieldErrors) ? 'none' : '0 4px 16px #0ea5e920',
                  transition: 'background 0.3s, box-shadow 0.3s',
                  opacity: (submitAttempted && hasFieldErrors) ? 0.4 : 1,
                }}
              >
                {saving
                  ? <><Loader2 style={{ width: 15, height: 15, animation: 'avia-spin 1s linear infinite' }} />Сохранение...</>
                  : saved
                    ? <><CheckCircle2 style={{ width: 15, height: 15 }} />Сохранено!</>
                    : <><Save style={{ width: 15, height: 15 }} />Сохранить</>
                }
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ReviewsCard — коллапсируемые отзывы
// ─────────────────────────────────────────────────────────────────────────────

function AnimatedNumber({ value, color }: { value: number; color: string }) {
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}
    >
      {value}
    </motion.span>
  );
}

function ReviewsCard({ reviews, likes, dislikes }: { reviews: AviaReview[]; likes: number; dislikes: number }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const total = reviews.length;
  const shown = showAll ? reviews : reviews.slice(0, 3);
  const likesPct = total > 0 ? Math.round((likes / total) * 100) : 0;

  return (
    <div style={card}>
      {/* ── Header ── */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 11,
          background: '#34d39910', border: '1px solid #34d39920',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Star style={{ width: 15, height: 15, color: '#34d399' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#ddeeff' }}>Отзывы обо мне</h2>
          <div style={{ fontSize: 10, color: '#3d5a78', marginTop: 2 }}>
            {total === 0
              ? 'Отзывов пока нет'
              : `${total} ${total === 1 ? 'отзыв' : total < 5 ? 'отзыва' : 'отзывов'} · ${likesPct}% положительных`
            }
          </div>
        </div>
        {!open && total > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, marginRight: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 6, background: '#34d39910', border: '1px solid #34d39920' }}>
              <ThumbsUp style={{ width: 9, height: 9, color: '#34d399' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399' }}>{likes}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 6, background: '#f8717110', border: '1px solid #f8717120' }}>
              <ThumbsDown style={{ width: 9, height: 9, color: '#f87171' }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171' }}>{dislikes}</span>
            </div>
          </motion.div>
        )}
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown style={{ width: 16, height: 16, color: '#3d5a78' }} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 18px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ height: 1, background: '#ffffff07' }} />

              {/* ── Rating counters + bar ── */}
              <div style={{
                padding: '14px 16px', borderRadius: 14,
                background: '#ffffff04', border: '1px solid #ffffff08',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: total > 0 ? 12 : 0 }}>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '12px 8px', borderRadius: 12,
                    background: '#34d39909', border: '1px solid #34d39920',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ThumbsUp style={{ width: 16, height: 16, color: '#34d399' }} />
                      <AnimatedNumber value={likes} color="#34d399" />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#2a6a50', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Лайков</span>
                  </div>
                  <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '12px 8px', borderRadius: 12,
                    background: '#f8717109', border: '1px solid #f8717120',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ThumbsDown style={{ width: 16, height: 16, color: '#f87171' }} />
                      <AnimatedNumber value={dislikes} color="#f87171" />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6a2a2a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Дизлайков</span>
                  </div>
                </div>

                {total > 0 ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399' }}>👍 {likesPct}%</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#3d5a78' }}>{total} отзывов</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171' }}>{100 - likesPct}% 👎</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: '#f8717120', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${likesPct}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
                        style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #34d39980, #34d399)' }}
                      />
                    </div>
                  </>
                ) : (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
                    padding: '8px 12px', borderRadius: 10,
                    background: '#ffffff05', border: '1px solid #ffffff0a',
                  }}>
                    <Info style={{ width: 13, height: 13, color: '#3d5a78', flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: '#3d5a78', lineHeight: 1.4 }}>
                      Рейтинг формируется после первой сделки
                    </span>
                  </div>
                )}
              </div>

              {/* ── Empty state ── */}
              {total === 0 && (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '24px 16px', borderRadius: 14,
                  background: '#ffffff03', border: '1px dashed #ffffff0d',
                }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 15,
                    background: '#34d39908', border: '1px solid #34d39918',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Star style={{ width: 20, height: 20, color: '#34d39950' }} />
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#4a6a88', marginBottom: 4 }}>
                      Отзывов пока нет
                    </div>
                    <div style={{ fontSize: 11, color: '#2a4060', lineHeight: 1.5 }}>
                      Ваши отзывы появятся здесь после завершения первых сделок
                    </div>
                  </div>
                </div>
              )}

              {/* ── Review items ── */}
              {total > 0 && (
                <>
                  {shown.map((r, i) => {
                    const isLike = r.type === 'like';
                    const color = isLike ? '#34d399' : '#f87171';
                    const Icon = isLike ? ThumbsUp : ThumbsDown;
                    return (
                      <motion.div
                        key={r.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        style={{
                          padding: '12px 14px', borderRadius: 13,
                          background: `${color}06`, border: `1px solid ${color}18`,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{
                              width: 24, height: 24, borderRadius: 7,
                              background: `${color}14`, border: `1px solid ${color}25`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              <Icon style={{ width: 11, height: 11, color }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color }}>{r.authorName || r.authorPhone}</span>
                          </div>
                          <span style={{ fontSize: 10, color: '#2a4a65', fontWeight: 500 }}>
                            {new Date(r.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: '#6b8faa', margin: 0, lineHeight: 1.6 }}>{r.comment}</p>
                      </motion.div>
                    );
                  })}
                  {total > 3 && (
                    <button
                      onClick={() => setShowAll(v => !v)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                        padding: '9px', borderRadius: 11,
                        background: '#ffffff06', border: '1px solid #ffffff0d',
                        cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#4a7090',
                      }}
                    >
                      {showAll
                        ? <><ChevronUp style={{ width: 13, height: 13 }} />Свернуть</>
                        : <><ChevronDown style={{ width: 13, height: 13 }} />Ещё {total - 3} отзыва</>
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SecurityCard — смена PIN
// ─────────────────────────────────────────────────────────────────────────────

function SecurityCard({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changingPin, setChangingPin] = useState(false);
  const [pinChanged, setPinChanged] = useState(false);
  const [pinError, setPinError] = useState('');
  const [lockoutSec, setLockoutSec] = useState(0);
  const isPinChangingRef = useRef(false);

  useEffect(() => {
    if (lockoutSec <= 0) return;
    const timer = setInterval(() => setLockoutSec(p => p <= 1 ? (clearInterval(timer), 0) : p - 1), 1000);
    return () => clearInterval(timer);
  }, [lockoutSec]);

  const fmtTimer = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const handlePinChange = async () => {
    if (isPinChangingRef.current) return;
    setPinError('');
    if (!/^\d{4}$/.test(currentPin)) { setPinError('Текущий PIN — 4 цифры'); return; }
    if (!/^\d{4}$/.test(newPin)) { setPinError('Новый PIN — 4 цифры'); return; }
    if (newPin !== confirmPin) { setPinError('PIN-коды не совпадают'); return; }
    if (currentPin === newPin) { setPinError('Новый PIN совпадает со старым'); return; }
    isPinChangingRef.current = true;
    setChangingPin(true);
    const result = await changeAviaPin(phone, currentPin, newPin);
    if (result.success) {
      setPinChanged(true);
      setCurrentPin(''); setNewPin(''); setConfirmPin('');
      setTimeout(() => { setPinChanged(false); setOpen(false); }, 2500);
    } else {
      setPinError(result.error || 'Ошибка смены PIN');
      if (result.lockedSeconds && result.lockedSeconds > 0) setLockoutSec(result.lockedSeconds);
    }
    setChangingPin(false);
    isPinChangingRef.current = false;
  };

  const isLocked = lockoutSec > 0;
  const canSubmit = !changingPin && !isLocked && currentPin.length === 4 && newPin.length === 4 && confirmPin.length === 4;

  return (
    <div style={card}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '16px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{ width: 34, height: 34, borderRadius: 10, background: '#fbbf2410', border: '1px solid #fbbf2420', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Shield style={{ width: 14, height: 14, color: '#fbbf24' }} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#ddeeff' }}>Безопасность</h2>
          <div style={{ fontSize: 10, color: '#3d5a78', marginTop: 1 }}>Изменить PIN-код входа</div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown style={{ width: 16, height: 16, color: '#3d5a78' }} />
        </motion.div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 18px 18px' }}>
              <div style={{ height: 1, background: '#ffffff07', marginBottom: 16 }} />

              {isLocked && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 10, background: '#f8717110', border: '1px solid #f8717125', marginBottom: 14 }}>
                  <Timer style={{ width: 13, height: 13, color: '#f87171', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>Заблокировано на {fmtTimer(lockoutSec)}</span>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: 'Текущий PIN', value: currentPin, onChange: (v: string) => { setCurrentPin(v.replace(/\D/g, '').slice(0, 4)); setPinError(''); } },
                  { label: 'Новый PIN', value: newPin, onChange: (v: string) => { setNewPin(v.replace(/\D/g, '').slice(0, 4)); setPinError(''); } },
                  { label: 'Подтвердите новый PIN', value: confirmPin, onChange: (v: string) => { setConfirmPin(v.replace(/\D/g, '').slice(0, 4)); setPinError(''); } },
                ].map(({ label, value, onChange }) => (
                  <div key={label}>
                    <label style={labelStyle}>{label}</label>
                    <input
                      type="password" inputMode="numeric" maxLength={4}
                      value={value} onChange={e => onChange(e.target.value)}
                      placeholder="••••" disabled={isLocked}
                      style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center', fontWeight: 700, fontSize: 18, opacity: isLocked ? 0.4 : 1 }}
                    />
                  </div>
                ))}
              </div>

              <AnimatePresence>
                {pinError && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    style={{ display: 'flex', gap: 7, marginTop: 10, padding: '8px 12px', borderRadius: 10, background: '#f8717110', border: '1px solid #f8717125' }}>
                    <AlertCircle style={{ width: 12, height: 12, color: '#f87171', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#f87171' }}>{pinError}</span>
                  </motion.div>
                )}
                {pinChanged && (
                  <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                    style={{ display: 'flex', gap: 7, marginTop: 10, padding: '8px 12px', borderRadius: 10, background: '#34d39910', border: '1px solid #34d39925' }}>
                    <CheckCircle2 style={{ width: 12, height: 12, color: '#34d399', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>PIN-код успешно изменён!</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.button
                whileTap={canSubmit ? { scale: 0.97 } : {}}
                onClick={handlePinChange}
                disabled={!canSubmit}
                style={{
                  width: '100%', padding: '12px 20px', marginTop: 14,
                  borderRadius: 12, border: 'none',
                  background: canSubmit ? 'linear-gradient(135deg, #b45309, #f59e0b)' : '#ffffff0d',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  opacity: canSubmit ? 1 : 0.4,
                  boxShadow: canSubmit ? '0 4px 14px #f59e0b22' : 'none',
                  transition: 'opacity 0.2s',
                }}
              >
                {changingPin
                  ? <><Loader2 style={{ width: 14, height: 14, animation: 'avia-spin 1s linear infinite' }} />Изменяем...</>
                  : <><KeyRound style={{ width: 14, height: 14 }} />Изменить PIN</>
                }
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  AviaProfile — main
// ─────────────────────────────────────────────────────────────────────────────

export function AviaProfile() {
  const navigate = useNavigate();
  const { user, isAuth: _isAuth, updateUserLocal, logout, chatUnreadCount } = useAvia();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [city, setCity] = useState('');
  const [telegram, setTelegram] = useState('');
  const [role, setRole] = useState<AviaRole>('sender');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const [stats, setStats] = useState<AviaStats | null>(null);
  const [reviews, setReviews] = useState<AviaReview[]>([]);
  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);

  const [manualExpiry, setManualExpiry] = useState('');

  // ── Avatar upload hook ──
  const { avatarUploading, avatarError, setAvatarError, handleAvatarUpload } =
    useAvatarUpload(user?.phone || '', updateUserLocal);

  // ── Passport upload hook ──
  const passport = usePassportUpload({
    phone: user?.phone || '',
    manualExpiry,
    updateUserLocal,
    formValues: { firstName, lastName, middleName, birthDate, passportNumber },
    setFormValues: (upd) => {
      if (upd.firstName) setFirstName(upd.firstName);
      if (upd.lastName) setLastName(upd.lastName);
      if (upd.middleName) setMiddleName(upd.middleName);
      if (upd.birthDate) setBirthDate(upd.birthDate);
      if (upd.passportNumber) setPassportNumber(upd.passportNumber);
    },
  });

  // Modal states for quick actions
  const [_showCreateFlight, _setShowCreateFlight] = useState(false);
  const [_showCreateRequest, _setShowCreateRequest] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // ── Double-click protection ref ──
  const isSavingRef = useRef(false);

  // ── Unsaved changes detection ──
  const isDirty = user ? (
    firstName !== (user.firstName || '') ||
    lastName !== (user.lastName || '') ||
    middleName !== (user.middleName || '') ||
    birthDate !== (user.birthDate || '') ||
    passportNumber !== (user.passportNumber || '') ||
    city !== (user.city || '') ||
    telegram !== (user.telegram || '') ||
    role !== (user.role || 'sender')
  ) : false;

  // Refs для стабильного доступа к актуальным значениям в useBlocker (без пересоздания функции)
  const isDirtyRef = useRef(isDirty);
  const savedRef = useRef(saved);
  isDirtyRef.current = isDirty;
  savedRef.current = saved;

  // Block in-app navigation — стабильный callback предотвращает ошибку «one blocker at a time»
  const blockerFn = useCallback(({ currentLocation, nextLocation, historyAction }: {
    currentLocation: { pathname: string };
    nextLocation: { pathname: string; key?: string };
    historyAction: string;
  }) => {
    if (!isDirtyRef.current || savedRef.current) return false;
    if (currentLocation.pathname === nextLocation.pathname) return false;
    if (historyAction === 'POP' && (!nextLocation.key || nextLocation.key === 'default')) return false;
    return true;
  }, []); // пустой массив: функция создаётся один раз, читает данные через refs

  const blocker = useBlocker(blockerFn);

  // Block browser close / reload
  useEffect(() => {
    if (!isDirty || saved) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, saved]);

  // ── Escape key handler for modals ──
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showLogoutConfirm) { setShowLogoutConfirm(false); return; }
      if (blocker.state === 'blocked') { blocker.reset?.(); return; }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showLogoutConfirm, blocker]);

  // Logout-редирект обрабатывается в AviaLayout (родительский компонент).
  // Дублирующий useEffect здесь удалён — он вызывал «one blocker at a time»
  // при срабатывании одновременно с блокировщиком навигации.

  useEffect(() => {
    if (user?.phone) {
      setIsLoading(true);
      let cancelled = false;
      Promise.all([
        getAviaStats(user.phone)
          .then(s => { if (s && !cancelled) setStats(s); })
          .catch(() => {}),
        getAviaUserReviews(user.phone)
          .then(r => {
            if (cancelled) return;
            setReviews(r);
            setLikes(r.filter(x => x.type === 'like').length);
            setDislikes(r.filter(x => x.type === 'dislike').length);
          })
          .catch(() => {}),
      ]).finally(() => { if (!cancelled) setIsLoading(false); });
      return () => { cancelled = true; };
    }
  }, [user?.phone]);

  // ── Refresh data on tab visibility change ──
  useEffect(() => {
    if (!user?.phone) return;
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      getAviaStats(user.phone).then(s => { if (s) setStats(s); }).catch(() => {});
      getAviaUserReviews(user.phone).then(r => {
        setReviews(r);
        setLikes(r.filter(x => x.type === 'like').length);
        setDislikes(r.filter(x => x.type === 'dislike').length);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.phone]);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || '');
      setLastName(user.lastName || '');
      setMiddleName(user.middleName || '');
      setBirthDate(user.birthDate || '');
      setPassportNumber(user.passportNumber || '');
      setCity(user.city || '');
      setTelegram(user.telegram || '');
      setRole(user.role || 'sender');
      passport.setPassportExpiry(user.passportExpiryDate || '');
      if (user.passportPhotoPath) {
        return passport.loadPassportPhoto(user.phone);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.phone]); // Синхронизируем форму только при смене identity (phone),
                     // а не при каждом updateUserLocal (новый объект user каждый раз).
                     // OCR-поля заполняются напрямую через passport.setFormValues.

  // ── Pull-to-refresh (mobile) ──
  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      if (!user?.phone) return;
      const [s, r] = await Promise.all([
        getAviaStats(user.phone).catch(() => null),
        getAviaUserReviews(user.phone).catch(() => [] as AviaReview[]),
      ]);
      if (s) setStats(s);
      setReviews(r);
      setLikes(r.filter(x => x.type === 'like').length);
      setDislikes(r.filter(x => x.type === 'dislike').length);
      toast.success('Данные обновлены');
    },
  });

  if (!user) return null;

  // См. AviaVerificationSheet: фото/путь доступны только владельцу с токеном,
  // поэтому факт загрузки берём из passportVerified/passportUploadedAt.
  const hasPassport = !!(user.passportPhoto || user.passportPhotoPath || user.passportVerified || user.passportUploadedAt);
  const isExpired = (() => {
    const exp = user.passportExpiryDate || passport.passportExpiry;
    return exp ? new Date(exp).getTime() < Date.now() : false;
  })();
  const adCheck = canCreateAd(user);
  const completeness = calcCompleteness(firstName, lastName, middleName, birthDate, passportNumber, hasPassport, city, telegram);

  const handleSave = async () => {
    if (isSavingRef.current) return;
    if (!firstName.trim() || !lastName.trim()) { setError('Имя и фамилия обязательны'); return; }
    if (role === 'courier' && user.role !== 'courier' && !hasPassport) {
      setError('Для перехода на роль «Курьер» нужно сначала загрузить паспорт');
      return;
    }
    isSavingRef.current = true;
    setSaving(true); setError(''); setSaved(false);
    try {
      const updates: Partial<AviaUser> = {
        firstName: firstName.trim(), lastName: lastName.trim(), middleName: middleName.trim(),
        birthDate: birthDate || undefined, passportNumber: passportNumber.trim(),
        city: city.trim() || undefined, telegram: telegram.trim() || undefined, role,
      };
      await updateAviaProfile(user.phone, updates);
      updateUserLocal(updates);
      setSaved(true);
      toast.success('Профиль сохранён', { description: 'Данные успешно обновлены' });
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения');
      toast.error('Ошибка сохранения', { description: err.message || 'Попробуйте ещё раз' });
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/avia', { replace: true });
  };

  return (
    <div
      ref={pullToRefresh.containerRef}
      onTouchStart={pullToRefresh.onTouchStart}
      onTouchMove={pullToRefresh.onTouchMove}
      onTouchEnd={pullToRefresh.onTouchEnd}
      style={{ minHeight: '100vh', background: 'var(--avia-bg)', fontFamily: "'Sora', 'Inter', sans-serif", overflowY: 'auto' }}
    >
      {/* Pull-to-refresh indicator */}
      {(pullToRefresh.pullY > 0 || pullToRefresh.isRefreshing) && (
        <div style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          height: pullToRefresh.isRefreshing ? 44 : Math.min(pullToRefresh.pullY, 60),
          overflow: 'hidden', transition: pullToRefresh.isRefreshing ? 'height 0.2s' : 'none',
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            border: '2.5px solid #ffffff15', borderTopColor: '#0ea5e9',
            animation: pullToRefresh.isRefreshing ? 'avia-spin 0.8s linear infinite' : 'none',
            opacity: Math.min(pullToRefresh.pullY / 60, 1),
            transform: `rotate(${pullToRefresh.pullY * 3}deg)`,
          }} />
        </div>
      )}

      {/* Hidden file inputs */}
      <input type="file" ref={passport.passportInputRef} accept="image/*" capture="environment" onChange={passport.handlePassportUpload} style={{ display: 'none' }} />

      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'clamp(14px, 4vw, 20px) clamp(16px, 5vw, 28px)',
        borderBottom: '1px solid #ffffff07',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--avia-bg)',
        backdropFilter: 'blur(12px)',
      }}>
        <button
          onClick={() => navigate('/avia/dashboard')}
          className="md:hidden"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 12px', borderRadius: 9,
            border: '1px solid #ffffff10', background: '#ffffff07',
            color: '#6b8faa', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          ← Назад
        </button>
        <div className="hidden md:block" style={{ width: 70 }} />
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#e2eeff', letterSpacing: '-0.3px' }}>
          Мой профиль
        </h1>
        <div style={{ width: 70 }} />
      </div>

      {/* ── Avatar error ── */}
      <AnimatePresence>
        {avatarError && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            style={{
              margin: '12px clamp(16px, 5vw, 28px) 0',
              display: 'flex', gap: 8, padding: '10px 14px', borderRadius: 12,
              background: '#f8717110', border: '1px solid #f8717130',
            }}
          >
            <AlertCircle style={{ width: 14, height: 14, color: '#f87171', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#f87171', flex: 1 }}>{avatarError}</span>
            <button onClick={() => setAvatarError('')} aria-label="Закрыть ошибку" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 16, lineHeight: 1 }}>×</button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content ── */}
      <div style={{ padding: 'clamp(16px, 4vw, 24px)', maxWidth: 1100, margin: '0 auto' }}>
        <div className="avia-profile-grid">

          {/* ── LEFT column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <HeroCard
                user={user} likes={likes} dislikes={dislikes}
                completeness={completeness}
                onAvatarUpload={handleAvatarUpload}
                avatarUploading={avatarUploading}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <QuickActionsCard
                role={user.role || 'sender'}
                onCreateFlight={() => navigate('/avia/dashboard')}
                dealsPending={stats?.dealsPending ?? 0}
                chatUnread={chatUnreadCount}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <PassportCard
                user={user} passportUrl={passport.passportUrl}
                passportExpiry={passport.passportExpiry} manualExpiry={manualExpiry}
                setManualExpiry={setManualExpiry} uploading={passport.uploading}
                uploadSuccess={passport.uploadSuccess}
                onConfirmUpload={(file, skipOcr) => passport.processPassportFile(file, skipOcr)}
                onUpdateClick={() => {
                  passport.resetUploadState();
                  updateUserLocal({ passportPhoto: '', passportPhotoPath: '' }); // allow new upload
                  // The sheet will be opened by clicking the card, so no need to auto-trigger click
                }}
              />
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <SecurityCard phone={user.phone} />
            </motion.div>

            {/* Logout */}
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowLogoutConfirm(true)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 20px', borderRadius: 16, cursor: 'pointer',
                  background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.18)',
                  color: '#f87171', fontSize: 13, fontWeight: 700,
                }}
              >
                <LogOut style={{ width: 14, height: 14 }} />
                Выйти из аккаунта
              </motion.button>
            </motion.div>
          </div>

          {/* ── RIGHT column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {isLoading ? (
              <StatsRowSkeleton />
            ) : stats ? (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
                <StatsRow stats={stats} onDealsClick={() => navigate('/avia/deals')} />
              </motion.div>
            ) : null}

            {isLoading ? (
              <PersonalDataFormSkeleton />
            ) : (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}>
                <PersonalDataForm
                  firstName={firstName} setFirstName={setFirstName}
                  lastName={lastName} setLastName={setLastName}
                  middleName={middleName} setMiddleName={setMiddleName}
                  birthDate={birthDate} setBirthDate={setBirthDate}
                  passportNumber={passportNumber} setPassportNumber={setPassportNumber}
                  city={city} setCity={setCity}
                  telegram={telegram} setTelegram={setTelegram}
                  role={role} setRole={setRole}
                  saving={saving} saved={saved} error={error}
                  adCheck={adCheck} hasPassport={hasPassport} isExpired={isExpired}
                  onSave={handleSave}
                />
              </motion.div>
            )}

            {isLoading ? (
              <ReviewsCardSkeleton />
            ) : (
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
                <ReviewsCard reviews={reviews} likes={likes} dislikes={dislikes} />
              </motion.div>
            )}
          </div>

        </div>

        {/* Bottom padding mobile nav */}
        <div style={{ height: 90 }} className="md:hidden" />
      </div>

      {/* ── Unsaved changes blocker modal ── */}
      <AnimatePresence>
        {blocker.state === 'blocked' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            role="dialog" aria-modal="true" aria-label="Несохранённые изменения"
            style={{
              position: 'fixed', inset: 0, zIndex: 110,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px',
            }}
            onClick={() => blocker.reset?.()}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.2 }}
              style={{
                ...card, padding: '28px 24px', maxWidth: 360, width: '100%',
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 16, margin: '0 auto 16px',
                background: '#fbbf2414', border: '1px solid #fbbf2430',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AlertCircle style={{ width: 22, height: 22, color: '#fbbf24' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 800, color: '#e2eeff', marginBottom: 8 }}>
                Несохранённые изменения
              </div>
              <div style={{ textAlign: 'center', fontSize: 13, color: '#4a7090', lineHeight: 1.6, marginBottom: 24 }}>
                У вас есть несохранённые данные профиля. Покинуть страницу без сохранения?
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => blocker.reset?.()}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, cursor: 'pointer',
                    background: '#ffffff0a', border: '1px solid #ffffff12',
                    color: '#6b8faa', fontSize: 13, fontWeight: 700,
                  }}
                >
                  Остаться
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => blocker.proceed?.()}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #92400e, #f59e0b)',
                    border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                    boxShadow: '0 4px 16px #f59e0b33',
                  }}
                >
                  Покинуть
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Logout confirm modal ── */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            role="dialog" aria-modal="true" aria-label="Подтверждение выхода"
            style={{
              position: 'fixed', inset: 0, zIndex: 100,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px',
            }}
            onClick={() => setShowLogoutConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 16 }}
              transition={{ duration: 0.2 }}
              style={{
                ...card,
                padding: '28px 24px', maxWidth: 360, width: '100%',
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 16, margin: '0 auto 16px',
                background: '#f8717114', border: '1px solid #f8717130',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <LogOut style={{ width: 22, height: 22, color: '#f87171' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 800, color: '#e2eeff', marginBottom: 8 }}>
                Выйти из аккаунта?
              </div>
              <div style={{ textAlign: 'center', fontSize: 13, color: '#4a7090', lineHeight: 1.6, marginBottom: 24 }}>
                Вы можете войти снова в любой момент, используя номер телефона и PIN-код.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, cursor: 'pointer',
                    background: '#ffffff0a', border: '1px solid #ffffff12',
                    color: '#6b8faa', fontSize: 13, fontWeight: 700,
                  }}
                >
                  Отмена
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleLogout}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 12, cursor: 'pointer',
                    background: 'linear-gradient(135deg, #7f1d1d, #ef4444)',
                    border: 'none', color: '#fff', fontSize: 13, fontWeight: 700,
                    boxShadow: '0 4px 16px #ef444433',
                  }}
                >
                  Выйти
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes avia-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes avia-skel-shimmer {
          0% { background-position: -400px 0; }
          100% { background-position: 400px 0; }
        }
        .avia-skel-pulse {
          background: linear-gradient(90deg, #ffffff04 0%, #ffffff0c 40%, #ffffff04 80%);
          background-size: 800px 100%;
          animation: avia-skel-shimmer 1.6s ease-in-out infinite;
        }
        .avia-profile-grid > div > div:hover,
        .avia-profile-grid > div > button:hover {
          border-color: #ffffff18 !important;
          box-shadow: 0 0 20px rgba(14,165,233,0.04) !important;
        }
        .avia-profile-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        @media (min-width: 768px) {
          .avia-profile-grid {
            display: grid;
            grid-template-columns: 360px 1fr;
            gap: 16px;
            align-items: start;
          }
        }
        @media (min-width: 1024px) {
          .avia-profile-grid {
            grid-template-columns: 380px 1fr;
            gap: 20px;
          }
        }
      `}</style>
    </div>
  );
}

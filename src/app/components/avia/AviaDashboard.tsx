import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { useNavigate } from 'react-router';
import { Plane, User, Package, ShieldAlert, ShieldX, Calendar, Plus, RefreshCw, ArrowRight, AlertTriangle, Phone, Copy, Check, XCircle, SlidersHorizontal, X, Search, ArrowDown, Bell, MessageCircle, Handshake, FileText, ClipboardList, Zap } from 'lucide-react';
import { NotificationCenter } from './NotificationCenter';
import { fmtDate, maskPhone } from '../../utils/aviaUtils';

import { makeAviaChatId, getAviaUserChats } from '../../api/aviaChatApi';
import type { AviaChatAdRef } from '../../api/aviaChatApi';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAvia } from './AviaContext';
import {
  canCreateAd,
  getAviaFlights,
  getMyAviaAds,
} from '../../api/aviaApi';
import type { AviaFlight } from '../../api/aviaApi';
import {
  applyFlightFilters,
  countActiveFilters, getFilterChips, removeFilterChip,
  EMPTY_FILTER_STATE,
} from '../../api/aviaFilterApi';
import type { AviaFilterState } from '../../api/aviaFilterApi';
import { AviaSearchBar } from './AviaSearchBar';
import { AviaFilterSheet } from './AviaFilterSheet';
import { CreateFlightModal } from './CreateFlightModal';
import { FlightDetailModal } from './DetailModal';
import { AviaDealOfferModal } from './AviaDealOfferModal';
import { getAviaDeals } from '../../api/aviaDealApi';
import { getPublicAds } from '../../api/dataApi';
import { usePolling } from '../../hooks/usePolling';
import { ImageWithFallback } from '../figma/ImageWithFallback';

type AvSortKey = 'date-desc' | 'date-asc' | 'weight-desc' | 'weight-asc' | 'price-asc' | 'price-desc';

// ── Вспомогательные ───────────────────────────────────────────────────────────

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="avia-card-item" style={{
      padding: '15px 16px', borderRadius: 20,
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden', position: 'relative',
    }}>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .avia-shimmer::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent 0%, #ffffff07 50%, transparent 100%);
          animation: shimmer 1.4s infinite;
        }
      `}</style>
      <div className="avia-shimmer" style={{ position: 'absolute', inset: 0 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: '#ffffff0a' }} />
        <div style={{ width: 140, height: 16, borderRadius: 6, background: '#ffffff0a' }} />
        <div style={{ width: 40, height: 16, borderRadius: 6, background: '#ffffff06', marginLeft: 'auto' }} />
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <div style={{ width: 70, height: 12, borderRadius: 5, background: '#ffffff08' }} />
        <div style={{ width: 50, height: 12, borderRadius: 5, background: '#ffffff08' }} />
        <div style={{ width: 55, height: 12, borderRadius: 5, background: '#ffffff08' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ width: 90, height: 12, borderRadius: 5, background: '#ffffff06' }} />
        <div style={{ width: 60, height: 26, borderRadius: 8, background: '#ffffff06' }} />
      </div>
    </div>
  );
}

// ── Кнопка контакта ───────────────────────────────────────────────────────────

function ContactButton({ phone, accentColor }: { phone: string; accentColor: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`+${phone.replace(/\D/g, '')}`);
      setCopied(true);
      toast.success('Номер скопирован в буфер обмена', { duration: 2000 });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать номер');
    }
  };

  if (!revealed) {
    return (
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={() => setRevealed(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 11px', borderRadius: 9, cursor: 'pointer',
          border: `1px solid ${accentColor}28`,
          background: `${accentColor}0c`,
          color: accentColor, fontSize: 11, fontWeight: 700,
        }}
      >
        <Phone style={{ width: 11, height: 11 }} />
        Связаться
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <span style={{
        fontSize: 12, fontWeight: 700, color: accentColor,
        padding: '4px 10px', borderRadius: 8,
        background: `${accentColor}12`, border: `1px solid ${accentColor}20`,
        letterSpacing: '0.03em',
      }}>
        {maskPhone(phone)}
      </span>
      <button
        onClick={handleCopy}
        aria-label="Скопировать номер телефона"
        style={{
          width: 28, height: 28, borderRadius: 8,
          border: `1px solid ${accentColor}20`,
          background: copied ? `${accentColor}18` : '#ffffff08',
          color: copied ? accentColor : '#4a6080',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.2s, color 0.2s',
        }}
      >
        {copied
          ? <Check style={{ width: 12, height: 12 }} />
          : <Copy style={{ width: 12, height: 12 }} />}
      </button>
    </motion.div>
  );
}

// ── Карточка рейса ────────────────────────────────────────────────────────────

const FlightCard = memo(function FlightCard({
  flight, isMine, onDetail, onChat, onOffer, chatUnread, hasMyDeal,
}: {
  flight: AviaFlight;
  isMine: boolean;
  onDetail?: (f: AviaFlight) => void;
  onChat?: (otherPhone: string, adRef: AviaChatAdRef) => void;
  onOffer?: (flight: AviaFlight) => void;
  chatUnread?: number;
  hasMyDeal?: boolean;
}) {
  const isClosed = flight.status === 'closed';
  const isCompleted = flight.status === 'completed';
  const isInProgress = flight.status === 'in_progress';
  const navigate = useNavigate();

  // Вычисляем отображаемую ёмкость
  const displayFreeKg = (flight.freeKg || 0) - (flight.reservedKg || 0);
  const hasReserved = (flight.reservedKg || 0) > 0;
  const isCargoOn = flight.cargoEnabled ?? ((flight.freeKg || 0) > 0);
  const isDocsOn = flight.docsEnabled ?? false;
  // Остаток пакетов. null — рейс опубликован до появления лимита, у него
  // документы без ограничений; показываем текстом, а не числом.
  const displayFreeDocs: number | null = flight.docsCount == null
    ? null
    : Math.max(0, (flight.docsFree || 0) - (flight.docsReserved || 0));
  const hasReservedDocs = (flight.docsReserved || 0) > 0;

  const isDone = isClosed || isCompleted;

  return (
    <>
    <motion.div
      className="avia-card-item"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isDone ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.25 }}
      style={{
        padding: '15px 16px', borderRadius: 20,
        background: isDone
          ? 'rgba(255,255,255,0.02)'
          : isMine
            ? 'linear-gradient(145deg, rgba(14,165,233,0.08) 0%, rgba(3,105,161,0.04) 50%, rgba(6,14,26,0.7) 100%)'
            : 'rgba(255,255,255,0.04)',
        border: `1px solid ${isDone ? 'rgba(255,255,255,0.05)' : isMine ? 'rgba(14,165,233,0.18)' : 'rgba(255,255,255,0.07)'}`,
        position: 'relative',
        cursor: onDetail ? 'pointer' : undefined,
        boxShadow: isDone ? 'none' : isMine
          ? '0 4px 20px rgba(14,165,233,0.06), inset 0 1px 0 rgba(14,165,233,0.08)'
          : '0 2px 12px rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
      onClick={() => onDetail?.(flight)}
    >
      {/* Top shine line for own cards */}
      {isMine && !isDone && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1, pointerEvents: 'none',
          background: 'linear-gradient(90deg, transparent, rgba(14,165,233,0.35), transparent)',
        }} />
      )}

      {/* Status badge overlay */}
      {isDone && (
        <div style={{
          position: 'absolute', top: 10, right: 12,
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 6,
          background: isCompleted ? '#34d39914' : '#f59e0b14',
          border: `1px solid ${isCompleted ? '#34d39920' : '#f59e0b20'}`,
        }}>
          <XCircle style={{ width: 10, height: 10, color: isCompleted ? '#34d399' : '#f59e0b' }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: isCompleted ? '#34d399' : '#f59e0b', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {isCompleted ? 'Завершён' : 'Закрыт'}
          </span>
        </div>
      )}

      {/* Route row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 11, flexShrink: 0,
            background: isClosed ? 'rgba(255,255,255,0.04)' : 'rgba(14,165,233,0.1)',
            border: `1px solid ${isClosed ? 'rgba(255,255,255,0.06)' : 'rgba(14,165,233,0.18)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: isClosed ? 'none' : '0 0 10px rgba(14,165,233,0.1)',
          }}>
            <Plane style={{ width: 15, height: 15, color: isClosed ? '#2a3d50' : '#38bdf8' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <span
              title={flight.from}
              style={{
                fontSize: 15, fontWeight: 800, color: isClosed ? '#3a5268' : '#e2eaf3', letterSpacing: '-0.2px',
                maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >{flight.from}</span>
            <ArrowRight style={{ width: 12, height: 12, color: isClosed ? '#1a2d40' : '#1e4a6a', flexShrink: 0 }} />
            <span
              title={flight.to}
              style={{
                fontSize: 15, fontWeight: 800, color: isClosed ? '#3a5268' : '#e2eaf3', letterSpacing: '-0.2px',
                maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >{flight.to}</span>
          </div>
        </div>
        {isMine && !isClosed && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#0ea5e9',
            padding: '3px 8px', borderRadius: 6, flexShrink: 0,
            background: '#0ea5e912', border: '1px solid #0ea5e920',
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Мой
          </span>
        )}
      </div>

      {/* Meta */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <Calendar style={{ width: 12, height: 12, color: '#4a6080' }} />
            <span style={{ fontSize: 12, color: '#6b8299', fontWeight: 600 }}>
              {fmtDate(flight.date, 'short')}
            </span>
          </div>
          {flight.flightNo && (
            <span style={{ fontSize: 11, color: '#4a6080', fontWeight: 600 }}>· {flight.flightNo}</span>
          )}
        </div>

        {/* Cargo row */}
        {isCargoOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Package style={{ width: 11, height: 11, color: isDone ? '#4a6080' : '#0ea5e9', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: isDone ? '#4a6080' : '#c8dae8', fontWeight: 600 }}>
              {isDone ? `${flight.freeKg} кг` : `${Math.max(0, displayFreeKg)} кг свободно`}
            </span>
            {!isDone && hasReserved && (
              <span style={{
                fontSize: 10, color: '#f59e0b', fontWeight: 600,
                padding: '1px 6px', borderRadius: 5,
                background: '#f59e0b12', border: '1px solid #f59e0b20',
              }}>
                {flight.reservedKg} кг ожидает
              </span>
            )}
            {!!flight.pricePerKg && (
              <span style={{ fontSize: 12, color: isDone ? '#6b8299' : '#34d399', fontWeight: 700, marginLeft: 'auto' }}>
                {flight.currency ? flight.currency + ' ' : '$'}{flight.pricePerKg}/кг
              </span>
            )}
          </div>
        )}

        {/* Docs row */}
        {isDocsOn && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText style={{ width: 11, height: 11, color: isDone ? '#4a6080' : '#a78bfa', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: isDone ? '#4a6080' : '#c8dae8', fontWeight: 600 }}>
              {displayFreeDocs === null
                ? 'Документы принимаю'
                : isDone
                ? `${flight.docsCount} пакет(ов)`
                : `${displayFreeDocs} пакет(ов) свободно`}
            </span>
            {!isDone && hasReservedDocs && (
              <span style={{
                fontSize: 10, color: '#f59e0b', fontWeight: 600,
                padding: '1px 6px', borderRadius: 5,
                background: '#f59e0b12', border: '1px solid #f59e0b20',
              }}>
                {flight.docsReserved} ожидает
              </span>
            )}
            {!!flight.docsPrice && (
              <span style={{ fontSize: 12, color: isDone ? '#6b8299' : '#a78bfa', fontWeight: 700, marginLeft: 'auto' }}>
                {flight.currency ? flight.currency + ' ' : '$'}{flight.docsPrice}/пакет
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer: author + action */}
      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: '1 1 auto' }}>
          <div style={{
            width: 20, height: 20, borderRadius: 6, flexShrink: 0,
            background: isDone ? '#ffffff08' : '#0ea5e918',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User style={{ width: 10, height: 10, color: isDone ? '#4a6080' : '#0ea5e9' }} />
          </div>
          <span
            title={flight.courierName || maskPhone(flight.courierId)}
            style={{ fontSize: 11, color: '#8aa3ba', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {flight.courierName || maskPhone(flight.courierId)}
          </span>
        </div>

        {isMine ? (
          <button
            onClick={() => navigate(`/avia/flight/${flight.id}/manifest`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
              padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #a78bfa20', background: '#a78bfa08',
              color: '#a78bfa', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            <ClipboardList style={{ width: 12, height: 12 }} />
            Манифест
          </button>
        ) : (
          !isClosed && (
            (isInProgress || isCompleted) ? (
              hasMyDeal && (
                <button
                  onClick={() => navigate(`/avia/flight/${flight.id}/manifest`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                    padding: '5px 10px', borderRadius: 9, cursor: 'pointer',
                    border: '1px solid rgba(167,139,250,0.22)',
                    background: 'rgba(167,139,250,0.08)',
                    color: '#a78bfa', fontSize: 11, fontWeight: 700,
                  }}
                >
                  <ClipboardList style={{ width: 11, height: 11 }} />
                  Манифест
                </button>
              )
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {onChat && (
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    onClick={() => onChat(flight.courierId, { type: 'flight', id: flight.id, from: flight.from, to: flight.to })}
                    style={{
                      position: 'relative',
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 9, cursor: 'pointer',
                      border: '1px solid rgba(14,165,233,0.22)',
                      background: 'rgba(14,165,233,0.08)',
                      color: '#0ea5e9', fontSize: 11, fontWeight: 700,
                    }}
                  >
                    <MessageCircle style={{ width: 11, height: 11 }} />
                    Написать
                    {(chatUnread || 0) > 0 && (
                      <span style={{
                        position: 'absolute', top: -4, right: -4,
                        minWidth: 14, height: 14, borderRadius: 7,
                        background: '#0ea5e9', color: '#fff',
                        fontSize: 8, fontWeight: 800,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 3px',
                        border: '2px solid #060d18',
                        boxShadow: '0 0 6px rgba(14,165,233,0.5)',
                      }}>
                        {chatUnread}
                      </span>
                    )}
                  </motion.button>
                )}
                {onOffer && (
                  <motion.button
                    whileTap={{ scale: 0.94 }}
                    onClick={() => onOffer(flight)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 9, cursor: 'pointer',
                      border: '1px solid rgba(52,211,153,0.22)',
                      background: 'rgba(52,211,153,0.08)',
                      color: '#34d399', fontSize: 11, fontWeight: 700,
                    }}
                  >
                    <Handshake style={{ width: 11, height: 11 }} />
                    Предложить
                  </motion.button>
                )}
                <ContactButton phone={flight.courierId} accentColor="#0ea5e9" />
              </div>
            )
          )
        )}
      </div>
    </motion.div>
    </>
  );
});

// ── Пустой стейт ──────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, subtitle, color, action }: { icon: typeof Plane; title: string; subtitle?: string; color: string; action?: { label: string; onClick: () => void } }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        textAlign: 'center', padding: '44px 24px',
        background: 'rgba(255,255,255,0.02)', borderRadius: 20,
        border: '1px dashed rgba(255,255,255,0.07)',
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 18, margin: '0 auto 14px',
        background: `${color}0a`, border: `1px solid ${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon style={{ width: 24, height: 24, color, opacity: 0.5 }} />
      </div>
      <p style={{ fontSize: 14, fontWeight: 800, color: '#c8d4e0', margin: 0, lineHeight: 1.4 }}>
        {title}
      </p>
      {subtitle && (
        <p style={{ fontSize: 12, color: '#3d5268', margin: '4px 0 0', lineHeight: 1.6, fontWeight: 500 }}>
          {subtitle}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 16, padding: '8px 20px', borderRadius: 12,
            background: `${color}14`, border: `1px solid ${color}30`,
            color, fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}

// ── Карточка быстрого действия ────────────────────────────────────────────────

function QuickActionCard({
  icon: Icon, color, title, subtitle, onClick, delay = 0,
}: {
  icon: typeof Plane; color: string; title: string; subtitle: string; onClick: () => void; delay?: number;
}) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '18px 10px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'center',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 14,
        background: `${color}14`, border: `1px solid ${color}28`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon style={{ width: 18, height: 18, color }} />
      </div>
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 800, color: '#e2e8f0', margin: 0, lineHeight: 1.2 }}>{title}</p>
        <p style={{ fontSize: 9.5, color: '#5a6b7d', margin: '2px 0 0', lineHeight: 1.2 }}>{subtitle}</p>
      </div>
    </motion.button>
  );
}

// ── Рекламный баннер (демо-данные на случай отсутствия реальных) ──────────────

const AVIA_FALLBACK_ADS = [
  { id: 1, image: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=600&h=200&fit=crop', badge: 'Авиадоставка', title: 'Отправляйте посылки\nпо всему миру', description: 'Быстро • Надёжно • Через курьеров', url: 'https://example.com/avia' },
  { id: 2, image: 'https://images.unsplash.com/photo-1517479149777-5f3b1511d5ad?w=600&h=200&fit=crop', badge: 'Экономия', title: 'Курьеры уже летят\nв вашем направлении', description: 'Найдите попутный рейс', url: 'https://example.com/avia2' },
  { id: 3, image: 'https://images.unsplash.com/photo-1474302770737-173ee21bab63?w=600&h=200&fit=crop', badge: 'Безопасность', title: 'Проверенные курьеры\nи отправители', description: 'Рейтинги и отзывы', url: 'https://example.com/avia3' },
];

// ── Главный компонент ─────────────────────────────────────────────────────────

export function AviaDashboard() {
  const navigate = useNavigate();
  const { user, logout, isAuth } = useAvia();

  const [flights, setFlights] = useState<AviaFlight[]>([]);
  const [myFlights, setMyFlights] = useState<AviaFlight[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [_loadingMy, setLoadingMy] = useState(false);
  const [showFlightModal, setShowFlightModal] = useState(false);
  const [detailFlight, setDetailFlight] = useState<AviaFlight | null>(null);

  // ── Пакет I: Сделки ────────────────────────────────────────────────────────
  const [dealOfferFlight, setDealOfferFlight] = useState<AviaFlight | null>(null);
  const [_pendingDealsCount, setPendingDealsCount] = useState(0);
  // Рейсы, на которые у меня (как у отправителя) уже есть сделка — чтобы показать
  // кнопку «Манифест» на карточке рейса вместо переписки/предложения
  const [myDealFlightIds, setMyDealFlightIds] = useState<Set<string>>(new Set());

  const fetchDealsCount = useCallback(() => {
    if (!user?.phone) return;
    getAviaDeals(user.phone)
      .then(deals => {
        const incoming = deals.filter(d => d.recipientPhone === user.phone && d.status === 'pending').length;
        setPendingDealsCount(incoming);
        setMyDealFlightIds(new Set(deals.filter(d => d.adType === 'flight').map(d => d.adId)));
      })
      .catch(() => {});
  }, [user?.phone]);

  useEffect(() => {
    fetchDealsCount();
    const t = setInterval(fetchDealsCount, 30_000);
    return () => clearInterval(t);
  }, [fetchDealsCount]);

  // ── Пакет G: Центр уведомлений — берём из контекста ───────────────────────
  const [showNotifications, setShowNotifications] = useState(false);
  const { notifications, unreadCount, refreshNotifications, updateNotifications, passportDaysLeft } = useAvia();
  const prevUnreadRef = useRef<number>(0);

  // Toast при появлении новых уведомлений во время polling
  useEffect(() => {
    const prev = prevUnreadRef.current;
    if (unreadCount > prev && prev >= 0) {
      const newOnes = notifications.filter(n => n.isUnread).slice(0, 1);
      if (newOnes.length > 0) {
        toast(newOnes[0].title, {
          description: newOnes[0].description?.slice(0, 80),
          duration: 4000,
          action: { label: 'Открыть', onClick: () => setShowNotifications(true) },
        });
      }
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // ── Пакет H: Чат → навигация на /avia/messages ────────────────────────────
  const { chatUnreadCount } = useAvia();

  const handleOpenChat = useCallback((otherPhone: string, adRef: AviaChatAdRef) => {
    const chatId = makeAviaChatId(user!.phone, otherPhone);
    const params = new URLSearchParams({
      chatId, otherPhone,
      adType: adRef.type, adId: adRef.id,
      adFrom: adRef.from, adTo: adRef.to,
      ...(adRef.date ? { adDate: adRef.date } : {}),
    });
    navigate(`/avia/messages?${params.toString()}`);
  }, [user, navigate]);

  // ── Пакет E+F: Поиск + Сортировка ──
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<AvSortKey>('date-desc');

  // ── Пакет M: Фильтры v2 (client-side) ──
  const [flightFS, setFlightFS] = useState<AviaFilterState>(EMPTY_FILTER_STATE);
  const [showFlightFilter, setShowFlightFilter] = useState(false);

  // Загружаем все данные без серверных фильтров — фильтрация выполняется на клиенте (Пакет M)
  const fetchMainData = () => {
    return getAviaFlights().then((f) => { setFlights(f); });
  };

  const fetchMyData = () => {
    if (!user?.phone) return Promise.resolve();
    setLoadingMy(true);
    return getMyAviaAds(user.phone)
      .then(({ flights: mf }) => { setMyFlights(mf); })
      .catch(() => {})
      .finally(() => setLoadingMy(false));
  };

  const loadMainData = useCallback(() => {
    setLoadingData(true);
    setLoadError(false);
    fetchMainData()
      .catch(() => {
        setLoadError(true);
        toast.error('Не удалось загрузить рейсы', {
          action: { label: 'Повторить', onClick: () => loadMainData() },
        });
      })
      .finally(() => setLoadingData(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMainData();
    // Грузим «Активные» сразу, а не только при первом клике на вкладку —
    // нужны для отображения собственных рейсов/заявок на вкладках выше
    // независимо от их статуса (бэкенд публичных списков скрывает не-active).
    fetchMyData();
  }, [user?.id]);

  // ── Загрузка уведомлений (polling теперь в AviaContext) ───────────────────
  // Контекст сам делает polling каждые 20с; при монтировании просто рефрешим
  useEffect(() => {
    if (user?.phone) refreshNotifications();
  }, [user?.phone]);


  // ── Карта chatId → unread для per-card бейджей (ДО условного return!) ────
  const chatUnreadByPhone = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!user?.phone) return;
    getAviaUserChats(user.phone).then(chats => {
      const map: Record<string, number> = {};
      for (const chat of chats) {
        const other = chat.participants.find(p => p !== user.phone) || '';
        if (other) map[other] = (map[other] || 0) + (chat.unread || 0);
      }
      chatUnreadByPhone.current = map;
    }).catch(() => {});
  }, [user?.phone, chatUnreadCount]);

  // ── Пакет D: Auto-polling + Pull-to-refresh ─────────────────────────────────
  const POLL_INTERVAL = 30_000; // 30 секунд
  const [lastPollAt, setLastPollAt] = useState<string>('');

  // Тихий polling без setLoadingData.
  const silentPoll = useCallback(() => {
    if (!user) return;
    getAviaFlights().then((newF) => {
      setFlights(newF);
      setLastPollAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }).catch(() => {});
  }, [user]);

  // Авто-polling по интервалу (usePolling приостанавливается на скрытой вкладке)
  usePolling(async () => silentPoll(), POLL_INTERVAL, !!user);

  // ── Рекламный баннер ────────────────────────────────────────────────────
  const [aviaAdIndex, setAviaAdIndex] = useState(0);
  const [aviaTouchStart, setAviaTouchStart] = useState(0);
  const [aviaTouchEnd, setAviaTouchEnd] = useState(0);
  const [serverAviaAds, setServerAviaAds] = useState<any[] | null>(null);

  usePolling(async () => {
    try {
      const data = await getPublicAds('avia');
      if (data?.length) setServerAviaAds(data);
    } catch { /* silent */ }
  }, 5 * 60_000);

  const isAviaAdFallback = !serverAviaAds?.length;
  const aviaAds          = serverAviaAds?.length ? serverAviaAds : AVIA_FALLBACK_ADS;
  const currentAviaAd    = aviaAds[aviaAdIndex] ?? aviaAds[0];
  const hasAviaAds       = aviaAds.length > 0 && currentAviaAd != null;

  useEffect(() => {
    const id = setInterval(() => {
      setAviaAdIndex(prev => (prev + 1) % aviaAds.length);
    }, 5000);
    return () => clearInterval(id);
  }, [aviaAds.length]);

  const handleAdTouchStart = (e: React.TouchEvent) => setAviaTouchStart(e.targetTouches[0].clientX);
  const handleAdTouchMove  = (e: React.TouchEvent) => setAviaTouchEnd(e.targetTouches[0].clientX);
  const handleAdTouchEnd   = () => {
    if (aviaTouchStart - aviaTouchEnd >  75) setAviaAdIndex(p => (p + 1) % aviaAds.length);
    if (aviaTouchStart - aviaTouchEnd < -75) setAviaAdIndex(p => (p - 1 + aviaAds.length) % aviaAds.length);
  };

  // ── Pull-to-refresh ─────────────────────────────────────────────────────
  const contentRef = useRef<HTMLDivElement>(null);
  const [pullY, setPullY] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDragging, setIsDragging] = useState(false); // true только во время активного касания — 1:1 движение без анимации
  const touchStartY = useRef(0);
  const touchActive = useRef(false);
  const PULL_THRESHOLD = 70;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = contentRef.current;
    if (!el || el.scrollTop > 5) return;
    touchStartY.current = e.touches[0].clientY;
    touchActive.current = true;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchActive.current || isRefreshing) return;
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta < 0) { setPullY(0); return; }
    const dampened = Math.min(delta * 0.45, 120);
    setPullY(dampened);
    setIsPulling(dampened >= PULL_THRESHOLD);
  }, [isRefreshing]);

  const handleTouchEnd = useCallback(() => {
    touchActive.current = false;
    setIsDragging(false); // дальше полоса возвращается плавной анимацией, а не скачком
    if (isPulling && !isRefreshing) {
      setIsRefreshing(true);
      setPullY(50);
      const promises: Promise<any>[] = [fetchMainData(), fetchMyData()];
      Promise.all(promises)
        .then(() => {
          toast('Обновлено', { duration: 1200 });
        })
        .catch(() => toast.error('Ошибка обновления'))
        .finally(() => {
          setIsRefreshing(false);
          setPullY(0);
          setIsPulling(false);
        });
    } else {
      setPullY(0);
      setIsPulling(false);
    }
  }, [isPulling, isRefreshing, fetchMainData, fetchMyData]);

  // ── Пакет M: фильтрация + поиск + сортировка рейсов (мемоизировано — иначе
  // applyFlightFilters() пересчитывался бы на каждый ререндер дашборда,
  // включая ререндеры от polling/pull-to-refresh, не связанные со списком). ──
  const searchLower = searchQuery.toLowerCase().trim();
  const displayFlights = useMemo(() => {
    if (!user) return [];
    // Для курьера вкладка «Мои рейсы» — это его собственные рейсы любого статуса
    // (публичный список flights отдаёт только active, поэтому берём из myFlights,
    // чтобы рейс не пропадал с главной после старта поездки). Завершённые рейсы
    // на главной не нужны — управлять ими можно через «Сделки»/Манифест.
    const preFilteredFlights = (user.role === 'courier' ? myFlights : flights)
      .filter(fl => fl.status !== 'completed');

    const matchesFlight = (f: AviaFlight) => {
      if (!searchLower) return true;
      return [f.from, f.to, f.flightNo, f.courierName, f.id]
        .filter(Boolean)
        .some(v => v!.toLowerCase().includes(searchLower));
    };

    const filtered = applyFlightFilters(preFilteredFlights, flightFS, user.phone).filter(matchesFlight);

    const sorted = [...filtered];
    switch (sortKey) {
      case 'date-desc': sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); break;
      case 'date-asc':  sorted.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); break;
      case 'weight-desc': sorted.sort((a, b) => (b.freeKg || 0) - (a.freeKg || 0)); break;
      case 'weight-asc':  sorted.sort((a, b) => (a.freeKg || 0) - (b.freeKg || 0)); break;
      case 'price-asc':  sorted.sort((a, b) => (a.pricePerKg || 0) - (b.pricePerKg || 0)); break;
      case 'price-desc': sorted.sort((a, b) => (b.pricePerKg || 0) - (a.pricePerKg || 0)); break;
    }
    return sorted;
  }, [user, myFlights, flights, flightFS, searchLower, sortKey]);

  if (!isAuth || !user) return null;

  // ── Производные значения ──────────────────────────────────────────────────
  const hasPassport = !!(user.passportPhoto || user.passportPhotoPath);
  const adCheck   = canCreateAd(user);
  const myPhone   = user.phone;

  const isExpired = (() => {
    if (!user.passportExpiryDate) return false;
    return new Date(user.passportExpiryDate).getTime() < Date.now();
  })();

  // Пакет M: производные для chips + filter badge
  const activeFilterCount = countActiveFilters(flightFS);
  const activeChips   = getFilterChips(flightFS);

  // Быстрое действие «Создать рейс» — доступно только курьеру.
  // Отправитель ничего не создаёт сам: он откликается («Предложить») на уже
  // опубликованные курьерами рейсы прямо из списка на главной.
  const isCourier = user.role === 'courier';

  const handleQuickCreate = () => {
    if (!adCheck.allowed) {
      navigate('/avia/profile');
      toast(adCheck.reason || 'Необходимо заполнить профиль', { icon: '🛂' });
      return;
    }
    setShowFlightModal(true);
  };

  const _handleLogout = () => {
    logout();
    navigate('/avia', { replace: true });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="avia-dashboard-root" style={{
      minHeight: '100vh',
      background: 'var(--avia-bg)',
      fontFamily: "'Sora', 'Inter', sans-serif",
    }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <motion.div
        className="avia-dash-header"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid rgba(14,165,233,0.07)',
          background: 'rgba(6,14,26,0.8)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          position: 'sticky', top: 0, zIndex: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          {/* Лого — скрыто на десктопе (есть в сайдбаре) */}
          <div className="md:hidden flex items-center justify-center" style={{
            width: 38, height: 38, borderRadius: 13,
            background: 'linear-gradient(135deg, #1245b0 0%, #1a6fd4 60%, #2f8fe0 100%)',
            boxShadow: '0 0 0 1px rgba(47,143,224,0.2), 0 4px 16px rgba(26,71,200,0.4)',
          }}>
            <Plane style={{ width: 18, height: 18, color: '#fff' }} />
          </div>
          <div>
            {/* На мобиле — «Ovora AVIA», на десктопе — «Главная» */}
            <div className="md:hidden" style={{ fontSize: 15, fontWeight: 900, color: '#e2eaf3', letterSpacing: '-0.4px', lineHeight: 1 }}>
              Ovora AVIA
            </div>
            <div className="hidden md:block" style={{ fontSize: 18, fontWeight: 800, color: '#e2eaf3', letterSpacing: '-0.3px', lineHeight: 1 }}>
              Главная
            </div>
            <div style={{ fontSize: 10, color: '#8aa3ba', fontWeight: 600, marginTop: 3 }}>
              {user.firstName
                ? `${user.firstName} ${user.lastName || ''}`.trim()
                : maskPhone(myPhone)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
          {/* ── Bell (Пакет G + K) — скрыт на десктопе (есть в сайдбаре) ── */}
          <button
            onClick={() => setShowNotifications(true)}
            className="md:hidden flex items-center justify-center"
            style={{
              width: 34, height: 34, borderRadius: 10,
              border: `1px solid ${unreadCount > 0 ? 'rgba(14,165,233,0.28)' : '#ffffff12'}`,
              background: unreadCount > 0 ? 'rgba(14,165,233,0.10)' : '#ffffff08',
              color: unreadCount > 0 ? '#38bdf8' : '#6b8299',
              cursor: 'pointer',
              position: 'relative',
            }}
            aria-label="Уведомления"
          >
            <motion.div
              animate={unreadCount > 0 ? { rotate: [0, -12, 12, -8, 8, 0] } : {}}
              transition={unreadCount > 0 ? { duration: 0.5, repeat: Infinity, repeatDelay: 4 } : {}}
            >
              <Bell style={{ width: 16, height: 16 }} />
            </motion.div>
            {unreadCount > 0 && (
              <>
                {/* Pulse ring */}
                <motion.span
                  animate={{ scale: [1, 1.7, 1], opacity: [0.6, 0, 0.6] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{
                    position: 'absolute', top: -3, right: -3,
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'rgba(14,165,233,0.35)',
                    pointerEvents: 'none',
                  }}
                />
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  style={{
                    position: 'absolute', top: -3, right: -3,
                    minWidth: 16, height: 16,
                    background: '#0ea5e9',
                    borderRadius: '50%',
                    fontSize: 9, fontWeight: 800, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                    border: '2px solid #060d18',
                    lineHeight: 1,
                  }}
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </motion.span>
              </>
            )}
          </button>


        </div>
      </motion.div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div
        ref={contentRef}
        className="avia-dash-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          maxWidth: 1400, margin: '0 auto',
          overflowY: 'auto', position: 'relative',
        }}
      >
        {/* Pull-to-refresh indicator */}
        <AnimatePresence>
          {pullY > 10 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: Math.min(pullY / PULL_THRESHOLD, 1), y: pullY - 40 }}
              exit={{ opacity: 0, y: -20 }}
              transition={isDragging ? { duration: 0 } : { duration: 0.28, ease: 'easeOut' }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '8px 0', marginBottom: 4,
              }}
            >
              <motion.div
                animate={{ rotate: isRefreshing ? 360 : isPulling ? 180 : 0 }}
                transition={isRefreshing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0.2 }}
              >
                {isRefreshing
                  ? <RefreshCw style={{ width: 16, height: 16, color: '#0ea5e9' }} />
                  : <ArrowDown style={{ width: 16, height: 16, color: isPulling ? '#0ea5e9' : '#4a6080' }} />}
              </motion.div>
              <span style={{
                fontSize: 11, fontWeight: 600,
                color: isPulling || isRefreshing ? '#0ea5e9' : '#4a6080',
              }}>
                {isRefreshing ? 'Обновление...' : isPulling ? 'Отпустите' : 'Потяните для обновления'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Last poll timestamp */}
        {lastPollAt && !loadingData && (
          <div style={{
            textAlign: 'center', fontSize: 9, color: '#2a3d50',
            marginBottom: 6, fontWeight: 600,
          }}>
            Обновлено в {lastPollAt}
          </div>
        )}

        {/* ── Быстрые действия ── */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
            <Zap style={{ width: 13, height: 13, color: '#5ba3f5' }} />
            <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#607080' }}>
              Быстрые действия
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isCourier ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>
            {isCourier && (
              <QuickActionCard
                icon={Plus} color="#5ba3f5" delay={0}
                title="Создать рейс" subtitle="Опубликовать рейс"
                onClick={handleQuickCreate}
              />
            )}
            <QuickActionCard
              icon={Handshake} color="#a78bfa" delay={0.06}
              title="Сделки" subtitle="Договорённости"
              onClick={() => navigate('/avia/deals')}
            />
            <QuickActionCard
              icon={User} color="#34d399" delay={0.12}
              title="Профиль" subtitle="Документы и роль"
              onClick={() => navigate('/avia/profile')}
            />
          </div>
        </div>

        {/* ── Рекламный баннер ── */}
        {hasAviaAds && (
          <motion.div
            style={{ marginBottom: 18 }}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
          >
            <a
              href={isAviaAdFallback ? undefined : currentAviaAd.url}
              target={isAviaAdFallback ? undefined : '_blank'}
              rel="noopener noreferrer"
              onClick={(e) => { if (isAviaAdFallback) e.preventDefault(); }}
              style={{ display: 'block', borderRadius: 22, overflow: 'hidden', cursor: isAviaAdFallback ? 'default' : 'pointer' }}
            >
              <div
                style={{ position: 'relative', overflow: 'hidden', height: 'clamp(140px, 42vw, 180px)', zIndex: 0, isolation: 'isolate' }}
                onTouchStart={handleAdTouchStart}
                onTouchMove={handleAdTouchMove}
                onTouchEnd={handleAdTouchEnd}
              >
                <div style={{ position: 'absolute', inset: 0 }}>
                  <ImageWithFallback src={currentAviaAd.image} alt="Реклама" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #00000090 0%, transparent 55%)' }} />
                </div>
                <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <span style={{
                      display: 'inline-block', lineHeight: 1.4, fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '6px 14px', borderRadius: 999, background: 'rgba(0,0,0,0.45)', color: '#fff', whiteSpace: 'nowrap',
                    }}>
                      {currentAviaAd.badge}
                    </span>
                  </div>
                  <div>
                    <p style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1.2, margin: 0, textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>
                      {currentAviaAd.title.split('\n').map((line: string, i: number) => (
                        <span key={i}>{line}{i < currentAviaAd.title.split('\n').length - 1 && <br />}</span>
                      ))}
                    </p>
                    <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.8)', margin: '4px 0 0' }}>{currentAviaAd.description}</p>
                  </div>
                </div>
                <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 20, display: 'flex', gap: 5 }}>
                  {aviaAds.map((_, idx) => (
                    <div key={idx} style={{
                      height: 4, borderRadius: 999, transition: 'all 0.3s',
                      width: idx === aviaAdIndex ? 18 : 5,
                      background: idx === aviaAdIndex ? '#fff' : 'rgba(255,255,255,0.4)',
                    }} />
                  ))}
                </div>
              </div>
            </a>
          </motion.div>
        )}

        {/* ── Статус паспорта ── */}
        <AnimatePresence>
          {!hasPassport && (
            <motion.button
              key="passport-missing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ delay: 0.05, duration: 0.3 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate('/avia/profile')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 16px', borderRadius: 16, cursor: 'pointer',
                background: '#f59e0b0c', border: '1.5px solid #f59e0b28',
                textAlign: 'left', marginBottom: 10,
              }}
            >
              <ShieldAlert style={{ width: 20, height: 20, color: '#f59e0b', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>Загрузите паспорт</div>
                <div style={{ fontSize: 11, color: '#92743a', marginTop: 1 }}>
                  Необходимо для публикации объявлений
                </div>
              </div>
              <ArrowRight style={{ width: 13, height: 13, color: '#f59e0b40', flexShrink: 0 }} />
            </motion.button>
          )}

          {hasPassport && isExpired && (
            <motion.div
              key="passport-expired"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 14,
                background: '#ef44440c', border: '1.5px solid #ef444425',
                marginBottom: 10,
              }}
            >
              <ShieldX style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>Паспорт просрочен</div>
                <div style={{ fontSize: 11, color: '#b45454', marginTop: 1 }}>Создание объявлений заблокировано</div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── Баннер истечения паспорта ── */}
        {passportDaysLeft !== null && passportDaysLeft >= 0 && passportDaysLeft <= 30 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => navigate('/avia/profile')}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
              background: passportDaysLeft <= 7 ? '#ef444410' : '#f59e0b0a',
              border: `1px solid ${passportDaysLeft <= 7 ? '#ef444428' : '#f59e0b22'}`,
              marginBottom: 12,
            }}
          >
            <AlertTriangle style={{
              width: 14, height: 14, flexShrink: 0,
              color: passportDaysLeft <= 7 ? '#ef4444' : '#f59e0b',
            }} />
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: passportDaysLeft <= 7 ? '#f87171' : '#fbbf24' }}>
                Паспорт истекает через {passportDaysLeft} дн.
              </span>
              <span style={{ fontSize: 10, color: '#4a6080', marginLeft: 6 }}>
                Обновите в профиле →
              </span>
            </div>
          </motion.div>
        )}

        {/* ── Пакет M: Поиск v2 + Кнопка фильтров ── */}
        {(
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="avia-dash-search-row"
            style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
            {/* AviaSearchBar с дебаунсом и историей */}
            <AviaSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Рейс, город, курьер..."
              accentColor="#0ea5e9"
            />

            {/* Кнопка фильтров */}
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={() => setShowFlightFilter(true)}
              style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                border: `1px solid ${activeFilterCount > 0 ? '#0ea5e9' + '35' : '#ffffff10'}`,
                background: activeFilterCount > 0 ? '#0ea5e9' + '0e' : '#ffffff06',
                color: activeFilterCount > 0 ? '#0ea5e9' : '#6b8299',
                cursor: 'pointer', position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s, border-color 0.2s, color 0.2s',
              }}
              aria-label="Фильтры"
            >
              <SlidersHorizontal style={{ width: 14, height: 14 }} />
              <AnimatePresence>
                {activeFilterCount > 0 && (
                  <motion.span
                    key="filter-badge"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                    style={{
                      position: 'absolute', top: -4, right: -4,
                      minWidth: 16, height: 16, borderRadius: '50%',
                      background: '#0ea5e9', color: '#fff',
                      fontSize: 8, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 3px', border: '2px solid #060d18',
                    }}
                  >
                    {activeFilterCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>

            {/* Сортировка */}
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as AvSortKey)}
              style={{
                padding: '8px 22px 8px 8px',
                borderRadius: 10, border: '1px solid #ffffff10',
                background: '#0a1628', color: '#8ea8b8',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                outline: 'none', minWidth: 96, flexShrink: 0,
                appearance: 'none',
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%234a6080\'/%3E%3C/svg%3E")',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 7px center',
              }}
            >
              <option value="date-desc">Дата ↓</option>
              <option value="date-asc">Дата ↑</option>
              <option value="weight-desc">Вес ↓</option>
              <option value="weight-asc">Вес ↑</option>
              <option value="price-asc">Цена ↑</option>
              <option value="price-desc">Цена ↓</option>
            </select>
          </motion.div>
        )}

        {/* ── Пакет M: Chip-теги активных фильтров ── */}
        <AnimatePresence>
          {activeChips.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}
            >
              {activeChips.map(chip => (
                <motion.button
                  key={chip.key}
                  initial={{ opacity: 0, scale: 0.82 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.82 }}
                  transition={{ duration: 0.15 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    const next = removeFilterChip(flightFS, chip.field);
                    setFlightFS(next);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 20,
                    background: '#0ea5e9' + '14',
                    border: '1px solid #0ea5e928',
                    color: '#0ea5e9', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {chip.label}
                  <X style={{ width: 9, height: 9, opacity: 0.7 }} />
                </motion.button>
              ))}
              {activeChips.length > 1 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.82 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.82 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => setFlightFS(EMPTY_FILTER_STATE)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 20,
                    background: '#ffffff06', border: '1px solid #ffffff10',
                    color: '#4a6080', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <X style={{ width: 9, height: 9 }} />
                  Сбросить все
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Счётчик результатов поиска */}
        {(searchQuery || activeFilterCount > 0) && (
          <div style={{
            fontSize: 11, color: '#4a6080', fontWeight: 600,
            marginBottom: 8, textAlign: 'center',
          }}>
            {`Найдено рейсов: ${displayFlights.length}`}
          </div>
        )}

        {/* ── Списки ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key="flights-list"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.22 }}
          >
              {loadingData ? (
                <div className="avia-cards-grid">{[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}</div>
              ) : loadError ? (
                <EmptyState
                  icon={AlertTriangle}
                  color="#ef4444"
                  title="Не удалось загрузить рейсы"
                  subtitle="Проверьте соединение и попробуйте снова"
                  action={{ label: 'Повторить', onClick: loadMainData }}
                />
              ) : displayFlights.length === 0 ? (
                <EmptyState
                  icon={searchQuery ? Search : Plane}
                  color="#0ea5e9"
                  title={
                    searchQuery
                      ? 'Ничего не найдено'
                      : user.role === 'courier'
                        ? 'У вас пока нет рейсов'
                        : 'Рейсов пока нет'
                  }
                  subtitle={
                    searchQuery
                      ? `По запросу «${searchQuery}» совпадений нет`
                      : user.role === 'courier'
                        ? 'Нажмите «Создать», чтобы опубликовать первый рейс'
                        : 'Курьеры пока не опубликовали маршруты — загляните позже'
                  }
                />
              ) : (
                <>
                  <div className="avia-cards-grid">
                    <AnimatePresence>
                      {displayFlights.map((f) => (
                        <FlightCard
                          key={f.id}
                          flight={f}
                          isMine={f.courierId === myPhone}
                          onDetail={setDetailFlight}
                          onChat={f.courierId !== myPhone ? handleOpenChat : undefined}
                          onOffer={f.courierId !== myPhone && user.role === 'sender'
                            ? setDealOfferFlight : undefined}
                          chatUnread={f.courierId !== myPhone ? (chatUnreadByPhone.current[f.courierId] || 0) : undefined}
                          hasMyDeal={f.courierId !== myPhone && myDealFlightIds.has(f.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </>
              )}
          </motion.div>
        </AnimatePresence>

        <div style={{ height: 60 }} />
      </div>

      {/* ── Модалки ── */}
      <AnimatePresence>
        {showFlightModal && (
          <CreateFlightModal
            key="flight-modal"
            user={user}
            onClose={() => setShowFlightModal(false)}
            onSuccess={(flight) => {
              setFlights(prev => [flight, ...prev]);
              setMyFlights(prev => [flight, ...prev]);
              setShowFlightModal(false);
              toast.success('Рейс опубликован!', {
                description: `${flight.from} → ${flight.to}, ${fmtDate(flight.date, 'short')}`,
                duration: 3500,
              });
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Detail Modals ── */}
      <AnimatePresence>
        {detailFlight && (
          <FlightDetailModal
            key={`detail-flight-${detailFlight.id}`}
            flight={detailFlight}
            isMine={detailFlight.courierId === myPhone}
            onClose={() => setDetailFlight(null)}
            onUpdated={(updated) => {
              setFlights(prev => prev.map(x => x.id === updated.id ? updated : x));
              setMyFlights(prev => prev.map(x => x.id === updated.id ? updated : x));
              setDetailFlight(updated);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Пакет I: Deal Offer Modal ── */}
      <AnimatePresence>
        {dealOfferFlight && (
          <AviaDealOfferModal
            key={`deal-flight-${dealOfferFlight.id}`}
            me={user}
            flight={dealOfferFlight}
            onClose={() => setDealOfferFlight(null)}
            onSuccess={() => { fetchDealsCount(); }}
            onOpenChat={(chatId, otherPhone, adRef) => {
              setDealOfferFlight(null);
              const params = new URLSearchParams({
                chatId, otherPhone,
                adType: adRef.type, adId: adRef.id,
                adFrom: adRef.from, adTo: adRef.to,
                ...(adRef.date ? { adDate: adRef.date } : {}),
              });
              navigate(`/avia/messages?${params.toString()}`);
            }}
            onOpenExistingDeal={(dealId) => {
              setDealOfferFlight(null);
              navigate(`/avia/deals?dealId=${encodeURIComponent(dealId)}`);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Пакет M: Filter Sheets ── */}
      <AviaFilterSheet
        open={showFlightFilter}
        onClose={() => setShowFlightFilter(false)}
        filters={flightFS}
        onChange={setFlightFS}
        onReset={() => setFlightFS(EMPTY_FILTER_STATE)}
        accentColor="#0ea5e9"
        isFlights={true}
      />

      {/* ── Пакет G: Notification Center ── */}
      <AnimatePresence>
        {showNotifications && (
          <NotificationCenter
            key="notif-center"
            phone={user.phone}
            notifications={notifications}
            onClose={() => setShowNotifications(false)}
            onUpdate={updateNotifications}
          />
        )}
      </AnimatePresence>

      {/* Чат перенесён на страницу /avia/messages */}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse-badge {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.15); }
        }

        /* ── Responsive: Header ── */
        .avia-dash-header {
          padding: 14px 16px;
        }
        @media (min-width: 640px) {
          .avia-dash-header { padding: 16px 24px; }
        }
        @media (min-width: 1024px) {
          .avia-dash-header { padding: 18px 32px; }
        }

        /* ── Responsive: Content area ── */
        .avia-dash-content {
          padding: 14px 12px;
        }
        @media (min-width: 480px) {
          .avia-dash-content { padding: 16px 16px; }
        }
        @media (min-width: 640px) {
          .avia-dash-content { padding: 18px 24px; }
        }
        @media (min-width: 1024px) {
          .avia-dash-content { padding: 24px 32px; }
        }
        @media (min-width: 1280px) {
          .avia-dash-content { padding: 28px 40px; }
        }

        /* ── Responsive: Cards grid ── */
        .avia-cards-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        @media (min-width: 640px) {
          .avia-cards-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
        }
        @media (min-width: 1024px) {
          .avia-cards-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 14px;
          }
        }
        @media (min-width: 1280px) {
          .avia-cards-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
          }
        }

        /* ── Card items: scale up on desktop ── */
        .avia-card-item {
          transition: box-shadow 0.2s, border-color 0.2s;
        }
        @media (min-width: 640px) {
          .avia-card-item {
            padding: 18px 20px !important;
            border-radius: 22px !important;
          }
        }
        @media (min-width: 1024px) {
          .avia-card-item {
            padding: 20px 22px !important;
          }
          .avia-card-item:hover {
            border-color: rgba(14,165,233,0.25) !important;
            box-shadow: 0 6px 24px rgba(0,0,0,0.3) !important;
          }
        }

        /* ── Responsive: Search row ── */
        .avia-dash-search-row {
          flex-wrap: nowrap;
        }
        @media (max-width: 479px) {
          .avia-dash-search-row {
            flex-wrap: wrap;
          }
          .avia-dash-search-row > * {
            flex-shrink: 1;
          }
        }

        /* ── Responsive: Tabs row ── */
        .avia-dash-tabs-row {
          flex-wrap: nowrap;
        }
        @media (max-width: 380px) {
          .avia-dash-tabs-row {
            flex-wrap: wrap;
            gap: 6px;
          }
        }

        /* ── Footer bottom spacing for mobile nav ── */
        @media (max-width: 767px) {
          .avia-dashboard-root {
            padding-bottom: 72px;
          }
        }
      `}</style>
    </div>
  );
}

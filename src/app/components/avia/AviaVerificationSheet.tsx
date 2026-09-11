import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShieldCheck, ShieldAlert, ShieldX, FileText, Camera, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, CalendarX2, Loader2, MessageCircle, ChevronRight, Clock, Fingerprint, BadgeCheck, Upload, Zap, Database, Globe, ImageIcon, Trash2 } from 'lucide-react';
import type { AviaUser } from '../../api/aviaApi';
import { toast } from 'sonner';

// ─── Shared atoms ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px',
  borderRadius: 12, border: '1.5px solid #ffffff10',
  background: '#ffffff07', color: '#e2eeff',
  fontSize: 14, fontWeight: 500,
  outline: 'none', boxSizing: 'border-box',
  colorScheme: 'dark',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  color: '#3d5a78', marginBottom: 6,
  letterSpacing: '0.06em', textTransform: 'uppercase',
};

// ─── Status config ─────────────────────────────────────────────────────────────

type PassportStatus = 'none' | 'valid' | 'expired';

const STATUS = {
  none: {
    color: '#f59e0b',
    glow: '#f59e0b18',
    border: '#f59e0b30',
    icon: ShieldAlert,
    title: 'Верификация не пройдена',
    sub: 'Загрузите паспорт для доступа к объявлениям',
    pill: 'Требуется',
    pillBg: '#f59e0b14',
  },
  valid: {
    color: '#34d399',
    glow: '#34d39918',
    border: '#34d39930',
    icon: ShieldCheck,
    title: 'Верификация пройдена',
    sub: 'Все функции платформы доступны',
    pill: 'Подтверждён',
    pillBg: '#34d39914',
  },
  expired: {
    color: '#f87171',
    glow: '#f8717118',
    border: '#f8717130',
    icon: ShieldX,
    title: 'Паспорт просрочен',
    sub: 'Создание объявлений временно недоступно',
    pill: 'Просрочен',
    pillBg: '#f8717114',
  },
} as const;

// ─── Props ─────────────────────────────────────────────────────────────────────

interface VerificationSheetProps {
  open: boolean;
  onClose: () => void;
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

// ─────────────────────────────────────────────────────────────────────────────
//  AviaVerificationSheet
// ─────────────────────────────────────────────────────────────────────────────

export function AviaVerificationSheet({
  open, onClose, user, passportUrl, passportExpiry,
  manualExpiry, setManualExpiry, uploading, uploadSuccess,
  onConfirmUpload, onUpdateClick,
}: VerificationSheetProps) {

  // Паспортные поля (фото/путь/номер) сервер отдаёт только владельцу, подтвердившему
  // личность токеном. Факт загрузки определяем по passportVerified/passportUploadedAt —
  // они приходят всегда, иначе интерфейс предложит загрузку уже загруженного паспорта.
  const hasPassport = !!(user.passportPhoto || user.passportPhotoPath || user.passportVerified || user.passportUploadedAt);
  const exp = user.passportExpiryDate || passportExpiry;
  const isExpired = exp ? new Date(exp).getTime() < Date.now() : false;
  const [showPhoto, setShowPhoto] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate / revoke preview URL
  useEffect(() => {
    if (!previewFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(previewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  // Clear preview when uploading starts or sheet closes
  useEffect(() => {
    if (uploading || !open) setPreviewFile(null);
  }, [uploading, open]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const status: PassportStatus = !hasPassport ? 'none' : isExpired ? 'expired' : 'valid';
  const cfg = STATUS[status];
  const StatusIcon = cfg.icon;

  // Days left / days since expire
  const daysInfo = (() => {
    if (!exp) return null;
    const diff = Math.round((new Date(exp).getTime() - Date.now()) / 86400000);
    if (diff > 0) return { days: diff, msg: `Осталось ${diff} дн.`, color: diff < 30 ? '#f59e0b' : '#34d399' };
    return { days: Math.abs(diff), msg: `Просрочен ${Math.abs(diff)} дн. назад`, color: '#f87171' };
  })();

  // Verification stats
  const verStats = [
    {
      icon: BadgeCheck,
      label: 'Тип документа',
      value: hasPassport ? 'Паспорт' : '—',
      color: '#0ea5e9',
    },
    {
      icon: Zap,
      label: 'Метод распознавания',
      value: hasPassport ? 'OCR · Автоматически' : '—',
      color: '#a78bfa',
    },
    {
      icon: Clock,
      label: 'Дата загрузки',
      value: user.passportUploadedAt
        ? new Date(user.passportUploadedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—',
      color: '#6b8faa',
    },
    {
      icon: CalendarX2,
      label: 'Срок действия',
      value: exp
        ? new Date(exp).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        : '—',
      color: isExpired ? '#f87171' : '#34d399',
    },
    {
      icon: Database,
      label: 'Хранение данных',
      value: 'Зашифровано (AES-256)',
      color: '#6b8faa',
    },
    {
      icon: Globe,
      label: 'Статус',
      value: status === 'valid' ? 'Активен' : status === 'expired' ? 'Просрочен' : 'Не загружен',
      color: cfg.color,
    },
  ];

  const uploadSteps = [
    {
      n: '01',
      icon: FileText,
      title: 'Откройте паспорт',
      desc: 'Страница 2–3 с фотографией и серией/номером',
      color: '#0ea5e9',
    },
    {
      n: '02',
      icon: Camera,
      title: 'Сделайте фото',
      desc: 'Хорошее освещение, документ без бликов и теней',
      color: '#a78bfa',
    },
    {
      n: '03',
      icon: Zap,
      title: 'OCR распознает данные',
      desc: 'Система автоматически извлечёт ФИО, номер и срок действия',
      color: '#f59e0b',
    },
    {
      n: '04',
      icon: BadgeCheck,
      title: 'Верификация завершена',
      desc: 'Вам откроются все функции: рейсы, заявки, сделки',
      color: '#34d399',
    },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, zIndex: 200,
              background: 'rgba(0,4,12,0.82)',
              backdropFilter: 'blur(8px)',
            }}
          />

          {/* ── Sheet ── */}
          <motion.div
            role="dialog" aria-modal="true" aria-label="Верификация паспорта"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 38, mass: 0.9 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 201,
              maxHeight: '94dvh',
              background: '#080f1c',
              borderRadius: '24px 24px 0 0',
              borderTop: '1px solid #ffffff0d',
              borderLeft: '1px solid #ffffff0d',
              borderRight: '1px solid #ffffff0d',
              display: 'flex', flexDirection: 'column',
              boxShadow: `0 -24px 80px rgba(0,0,0,0.6), 0 0 0 1px ${cfg.color}12`,
              overflow: 'hidden',
            }}
          >
            {/* ── Glow strip ── */}
            <div style={{
              position: 'absolute', top: 0, left: '20%', right: '20%', height: 1,
              background: `linear-gradient(90deg, transparent, ${cfg.color}60, transparent)`,
            }} />

            {/* ── Drag handle ── */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
              <div style={{ width: 36, height: 4, borderRadius: 99, background: '#ffffff14' }} />
            </div>

            {/* ── Header ── */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 20px 16px',
              borderBottom: '1px solid #ffffff08',
            }}>
              {/* Status icon */}
              <div style={{
                position: 'relative', flexShrink: 0,
                width: 44, height: 44, borderRadius: 14,
                background: cfg.pillBg, border: `1.5px solid ${cfg.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 0 16px ${cfg.glow}`,
              }}>
                <StatusIcon style={{ width: 20, height: 20, color: cfg.color }} />
                {status === 'valid' && (
                  <div style={{
                    position: 'absolute', bottom: -3, right: -3,
                    width: 15, height: 15, borderRadius: '50%',
                    background: '#34d399', border: '2.5px solid #080f1c',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CheckCircle2 style={{ width: 8, height: 8, color: '#fff' }} />
                  </div>
                )}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2eeff', letterSpacing: '-0.3px' }}>
                  Верификация паспорта
                </div>
                <div style={{ fontSize: 11, color: '#3d5a78', marginTop: 2 }}>
                  Паспорт · OCR-верификация
                </div>
              </div>

              {/* Status pill */}
              <div style={{
                padding: '5px 12px', borderRadius: 99,
                background: cfg.pillBg, border: `1px solid ${cfg.border}`,
                fontSize: 11, fontWeight: 800, color: cfg.color,
              }}>
                {cfg.pill}
              </div>

              {/* Close */}
              <button
                onClick={onClose}
                aria-label="Закрыть"
                style={{
                  width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                  background: '#ffffff08', border: '1px solid #ffffff10',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: '#4a6a88',
                }}
              >
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>

              {/* ── Hero status block ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                style={{
                  marginTop: 20,
                  borderRadius: 20,
                  background: `linear-gradient(135deg, ${cfg.glow}, transparent)`,
                  border: `1px solid ${cfg.border}`,
                  padding: '20px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  textAlign: 'center',
                }}
              >
                {/* Big icon */}
                <div style={{
                  width: 72, height: 72, borderRadius: 22,
                  background: cfg.pillBg, border: `2px solid ${cfg.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 8px 32px ${cfg.glow}`,
                }}>
                  <StatusIcon style={{ width: 32, height: 32, color: cfg.color }} />
                </div>

                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: cfg.color, letterSpacing: '-0.4px' }}>
                    {cfg.title}
                  </div>
                  <div style={{ fontSize: 13, color: '#4a6a88', marginTop: 5, lineHeight: 1.5 }}>
                    {cfg.sub}
                  </div>
                </div>

                {/* Days badge */}
                {daysInfo && (
                  <div style={{
                    padding: '6px 16px', borderRadius: 99,
                    background: `${daysInfo.color}12`, border: `1px solid ${daysInfo.color}30`,
                    fontSize: 12, fontWeight: 700, color: daysInfo.color,
                  }}>
                    {daysInfo.msg}
                  </div>
                )}

                {/* Capabilities */}
                {status === 'valid' && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                    {['✈️ Рейсы', '📦 Заявки', '🤝 Сделки', '💬 Чаты'].map(cap => (
                      <div key={cap} style={{
                        padding: '4px 12px', borderRadius: 99,
                        background: '#34d39910', border: '1px solid #34d39922',
                        fontSize: 11, fontWeight: 600, color: '#34d399',
                      }}>
                        {cap}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* ── Stats grid ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 }}
                style={{ marginTop: 16 }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a78', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                  Данные верификации
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {verStats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                      <div key={stat.label} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', borderRadius: 13,
                        background: '#ffffff04', border: '1px solid #ffffff08',
                      }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                          background: `${stat.color}10`, border: `1px solid ${stat.color}20`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon style={{ width: 15, height: 15, color: stat.color }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#2a4060', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {stat.label}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: stat.color === '#6b8faa' ? '#8aa8c4' : stat.color, marginTop: 2 }}>
                            {stat.value}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>

              {/* ══════════ VALID STATE ══════════ */}
              {status === 'valid' && passportUrl && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16 }}
                  style={{ marginTop: 16 }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a78', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                    Фото документа
                  </div>

                  <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #34d39925', position: 'relative' }}>
                    <img
                      src={passportUrl} alt="Паспорт"
                      style={{
                        width: '100%', height: 160, objectFit: 'cover', display: 'block',
                        filter: showPhoto ? 'brightness(0.8)' : 'blur(10px) brightness(0.3)',
                        transition: 'filter 0.4s ease',
                      }}
                    />
                    {/* Overlay */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
                    }}>
                      {!showPhoto && (
                        <>
                          <Lock style={{ width: 28, height: 28, color: '#34d39966' }} />
                          <div style={{
                            padding: '4px 14px', borderRadius: 99,
                            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
                            fontSize: 11, fontWeight: 600, color: '#6b8faa',
                          }}>
                            Данные скрыты для вашей безопасности
                          </div>
                        </>
                      )}
                      <button
                        onClick={() => setShowPhoto(v => !v)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 18px', borderRadius: 99, cursor: 'pointer',
                          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)',
                          border: '1px solid rgba(255,255,255,0.15)',
                          fontSize: 12, fontWeight: 600, color: '#c8ddf0',
                        }}
                      >
                        {showPhoto
                          ? <><EyeOff style={{ width: 13, height: 13 }} />Скрыть фото</>
                          : <><Eye style={{ width: 13, height: 13 }} />Показать фото</>
                        }
                      </button>
                    </div>
                    {/* Security bar */}
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      padding: '8px 14px',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <Lock style={{ width: 10, height: 10, color: '#34d399' }} />
                      <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>
                        AES-256 · Только для верификации личности
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ══════════ EXPIRED STATE ══════════ */}
              {status === 'expired' && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16 }}
                  style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {passportUrl && (
                    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #f8717120', position: 'relative' }}>
                      <img
                        src={passportUrl} alt="Паспорт"
                        style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block', filter: 'blur(10px) brightness(0.2) grayscale(1)' }}
                      />
                      <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                        <CalendarX2 style={{ width: 28, height: 28, color: '#f87171' }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>Документ недействителен</span>
                      </div>
                    </div>
                  )}

                  <div style={{
                    padding: '14px', borderRadius: 14,
                    background: '#f8717108', border: '1px solid #f8717120',
                    display: 'flex', gap: 10,
                  }}>
                    <AlertCircle style={{ width: 16, height: 16, color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
                        Создание объявлений заблокировано
                      </div>
                      <div style={{ fontSize: 12, color: '#7a3535', lineHeight: 1.6 }}>
                        Срок действия паспорта истёк. Для разблокировки необходимо обратиться в службу поддержки с новым документом.
                      </div>
                    </div>
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => window.open('https://t.me/ovora_support', '_blank')}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                      padding: '14px 16px', borderRadius: 14, cursor: 'pointer',
                      background: '#f8717108', border: '1.5px solid #f8717128',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: '#f8717114', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <MessageCircle style={{ width: 18, height: 18, color: '#f87171' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#f09090' }}>Связаться с поддержкой</div>
                      <div style={{ fontSize: 11, color: '#5a3535', marginTop: 2 }}>Обновление документа вручную · @ovora_support</div>
                    </div>
                    <ChevronRight style={{ width: 16, height: 16, color: '#f8717140' }} />
                  </motion.button>
                </motion.div>
              )}

              {/* ══════════ NONE STATE — upload flow ══════════ */}
              {status === 'none' && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.16 }}
                  style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  {/* Steps */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a78', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
                      Процесс верификации
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {uploadSteps.map((step, i) => {
                        const Icon = step.icon;
                        return (
                          <div key={step.n} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: i < uploadSteps.length - 1 ? 16 : 0 }}>
                            {/* Connector line */}
                            {i < uploadSteps.length - 1 && (
                              <div style={{
                                position: 'absolute', left: 17, top: 38, width: 2,
                                height: 'calc(100% - 22px)', borderRadius: 99,
                                background: `linear-gradient(${step.color}30, transparent)`,
                              }} />
                            )}
                            {/* Step icon */}
                            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <div style={{
                                width: 36, height: 36, borderRadius: 11,
                                background: `${step.color}12`, border: `1.5px solid ${step.color}28`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <Icon style={{ width: 16, height: 16, color: step.color }} />
                              </div>
                            </div>
                            {/* Step text */}
                            <div style={{ paddingTop: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
                                <span style={{ fontSize: 9, fontWeight: 800, color: step.color, letterSpacing: '0.06em' }}>
                                  ШАГ {step.n}
                                </span>
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#ddeeff', lineHeight: 1.2, marginBottom: 3 }}>
                                {step.title}
                              </div>
                              <div style={{ fontSize: 11, color: '#4a6a88', lineHeight: 1.5 }}>
                                {step.desc}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: '#ffffff08' }} />

                  {/* ── Hidden File Input ── */}
                  <input
                    type="file"
                    hidden
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (!file.type.startsWith('image/')) {
                        toast.error('Неверный формат файла', { description: 'Поддерживаются только изображения: JPG, PNG, WEBP' });
                        return;
                      }
                      if (file.size > 10 * 1024 * 1024) {
                        toast.error('Файл слишком большой', { description: `Максимум 10 МБ. Ваш файл: ${(file.size / 1024 / 1024).toFixed(1)} МБ` });
                        return;
                      }
                      const wasReplaced = !!previewFile;
                      setPreviewKey(k => k + 1);
                      setPreviewFile(file);
                      if (navigator.vibrate) navigator.vibrate(40);
                      if (wasReplaced) {
                        toast.success('Файл заменён', { description: file.name });
                      }
                      // Reset input value so the same file can be selected again if needed
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  />

                  {/* ── Drop Zone ── */}
                  {!uploading && (
                    <div
                      onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                      onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation(); setDragActive(false);
                        const file = e.dataTransfer.files?.[0];
                        if (!file) return;
                        if (!file.type.startsWith('image/')) {
                          toast.error('Неверный формат файла', { description: 'Поддерживаются только изображения: JPG, PNG, WEBP' });
                          return;
                        }
                        if (file.size > 10 * 1024 * 1024) {
                          toast.error('Файл слишком большой', { description: `Максимум 10 МБ. Ваш файл: ${(file.size / 1024 / 1024).toFixed(1)} МБ` });
                          return;
                        }
                        const wasReplaced = !!previewFile;
                        setPreviewKey(k => k + 1);
                        setPreviewFile(file);
                        // Haptic feedback on mobile
                        if (navigator.vibrate) navigator.vibrate(40);
                        if (wasReplaced) {
                          toast.success('Файл заменён', { description: file.name });
                        }
                      }}
                      onClick={() => !previewFile && fileInputRef.current?.click()}
                      style={{
                        position: 'relative', cursor: previewFile ? 'default' : 'pointer',
                        padding: previewFile ? '0' : '24px 16px',
                        borderRadius: 16,
                        border: `2px dashed ${dragActive ? '#f59e0b' : previewFile ? '#34d39930' : '#ffffff14'}`,
                        background: dragActive
                          ? 'radial-gradient(ellipse at center, #f59e0b0c 0%, transparent 70%)'
                          : previewFile ? '#34d39906' : '#ffffff03',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                        transition: 'border-color 0.25s, background 0.25s',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Glow pulse when dragging */}
                      {dragActive && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          style={{
                            position: 'absolute', inset: 0,
                            background: 'radial-gradient(ellipse at center, #f59e0b10 0%, transparent 70%)',
                            pointerEvents: 'none',
                          }}
                        />
                      )}

                      {/* ── Preview state ── */}
                      {previewFile && previewUrl ? (
                        <motion.div
                          key={previewKey}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.25 }}
                          style={{ width: '100%' }}
                        >
                          {/* Preview image */}
                          <div style={{ position: 'relative', width: '100%', height: 160 }}>
                            <img
                              src={previewUrl}
                              alt="Превью паспорта"
                              style={{
                                width: '100%', height: '100%', objectFit: 'cover', display: 'block',
                                borderRadius: '14px 14px 0 0',
                              }}
                            />
                            <div style={{
                              position: 'absolute', inset: 0,
                              background: 'linear-gradient(transparent 50%, rgba(0,0,0,0.6))',
                              borderRadius: '14px 14px 0 0',
                            }} />
                            {/* File info overlay */}
                            <div style={{
                              position: 'absolute', bottom: 10, left: 12, right: 12,
                              display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                              <ImageIcon style={{ width: 14, height: 14, color: '#34d399', flexShrink: 0 }} />
                              <span style={{ fontSize: 11, fontWeight: 600, color: '#c8ddf0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {previewFile.name}
                              </span>
                              <span style={{ fontSize: 10, color: '#4a6a88', fontWeight: 500, flexShrink: 0 }}>
                                {(previewFile.size / 1024).toFixed(0)} КБ
                              </span>
                            </div>
                          </div>

                          {/* Действие превью — заменить файл. Загрузка идёт единой кнопкой ниже. */}
                          <div style={{ padding: '12px 14px' }}>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              onClick={(e) => { e.stopPropagation(); setPreviewFile(null); }}
                              style={{
                                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: '10px', borderRadius: 11, cursor: 'pointer',
                                background: '#ffffff08', border: '1px solid #ffffff12',
                                color: '#6b8faa', fontSize: 12, fontWeight: 700,
                              }}
                            >
                              <Trash2 style={{ width: 13, height: 13 }} />
                              Выбрать другое фото
                            </motion.button>
                          </div>
                        </motion.div>
                      ) : (
                        /* ── Default drop state ── */
                        <>
                          <motion.div
                            animate={dragActive ? { scale: 1.12, y: -4 } : { scale: 1, y: 0 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                            style={{
                              width: 48, height: 48, borderRadius: 14,
                              background: dragActive ? '#f59e0b18' : '#ffffff08',
                              border: `1.5px solid ${dragActive ? '#f59e0b40' : '#ffffff10'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'background 0.25s, border-color 0.25s',
                            }}
                          >
                            <Upload style={{ width: 20, height: 20, color: dragActive ? '#f59e0b' : '#4a6a88' }} />
                          </motion.div>

                          <div style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
                            <div style={{
                              fontSize: 13, fontWeight: 700, lineHeight: 1.3,
                              color: dragActive ? '#f59e0b' : '#6b8faa',
                              transition: 'color 0.25s',
                            }}>
                              {dragActive ? 'Отпустите файл для загрузки' : 'Перетащите фото паспорта сюда'}
                            </div>
                            <div style={{ fontSize: 11, color: '#2a4a65', marginTop: 4 }}>
                              {dragActive ? 'Только изображения (JPG, PNG, WEBP)' : 'или нажмите для выбора файла'}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Optional expiry date */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <label style={{ ...labelStyle, marginBottom: 0 }}>Срок действия паспорта</label>
                      <div style={{
                        padding: '2px 8px', borderRadius: 99,
                        background: '#0ea5e910', border: '1px solid #0ea5e920',
                        fontSize: 9, fontWeight: 700, color: '#0ea5e9',
                      }}>
                        OCR определит сам
                      </div>
                    </div>
                    <input
                      type="date"
                      value={manualExpiry}
                      onChange={(e) => setManualExpiry(e.target.value)}
                      style={inputStyle}
                    />
                    <div style={{ fontSize: 10, color: '#2a4060', marginTop: 6 }}>
                      Оставьте пустым — система распознает автоматически
                    </div>
                  </div>

                  {/* ── Main CTA — появляется только после выбора фото (в пустом
                       состоянии единственная точка загрузки — drop-зона выше) ── */}
                  {(previewFile || uploading) && (
                  <motion.button
                    whileTap={!uploading ? { scale: 0.97 } : {}}
                    onClick={() => { if (previewFile && !uploading) onConfirmUpload(previewFile, false); }}
                    disabled={uploading}
                    style={{
                      width: '100%', padding: 0,
                      borderRadius: 18, cursor: uploading ? 'wait' : 'pointer',
                      border: 'none', overflow: 'hidden',
                      background: uploading
                        ? '#14110a'
                        : 'linear-gradient(135deg, #78350f 0%, #b45309 40%, #d97706 70%, #f59e0b 100%)',
                      boxShadow: uploading ? 'none' : '0 8px 32px #f59e0b22',
                      transition: 'box-shadow 0.3s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '18px 20px' }}>
                      {/* Icon */}
                      <div style={{
                        width: 52, height: 52, borderRadius: 15, flexShrink: 0,
                        background: 'rgba(255,255,255,0.14)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}>
                        {uploading
                          ? <Loader2 style={{ width: 24, height: 24, color: '#fff', animation: 'avia-spin 1s linear infinite' }} />
                          : <Upload style={{ width: 24, height: 24, color: '#fff' }} />
                        }
                      </div>
                      {/* Text */}
                      <div style={{ flex: 1, textAlign: 'left' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>
                          {uploading ? 'Загрузка и распознавание...' : 'Загрузить и распознать'}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>
                          {uploading
                            ? 'OCR анализирует документ, подождите'
                            : 'OCR распознает данные и заполнит профиль'
                          }
                        </div>
                      </div>
                      {/* Camera badge */}
                      {!uploading && (
                        <div style={{
                          width: 38, height: 38, borderRadius: 12, flexShrink: 0,
                          background: 'rgba(255,255,255,0.16)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Camera style={{ width: 18, height: 18, color: '#fff' }} />
                        </div>
                      )}
                    </div>
                    {/* Progress bar */}
                    {uploading && (
                      <motion.div
                        initial={{ width: '0%' }}
                        animate={{ width: '88%' }}
                        transition={{ duration: 6, ease: 'easeOut' }}
                        style={{ height: 3, background: 'rgba(255,255,255,0.35)', borderRadius: '0 99px 99px 0' }}
                      />
                    )}
                  </motion.button>
                  )}

                  {/* ── Fallback CTA ── */}
                  {!uploading && previewFile && (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onConfirmUpload(previewFile, true)}
                      style={{
                        width: '100%', marginTop: 8, padding: '14px 16px',
                        borderRadius: 14, cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'transparent', color: '#6b8faa',
                        fontSize: 13, fontWeight: 600, textAlign: 'center',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Не получается сканировать? Загрузить и ввести вручную
                    </motion.button>
                  )}

                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#4a6a88' }}>
                      Если OCR не распознает данные, вы сможете ввести их вручную на следующем шаге (в профиле).
                    </div>
                  </div>

                  {/* Privacy note */}
                  <div style={{
                    display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 13,
                    background: '#ffffff04', border: '1px solid #ffffff08',
                  }}>
                    <Fingerprint style={{ width: 16, height: 16, color: '#3d5a78', flexShrink: 0, marginTop: 1 }} />
                    <div style={{ fontSize: 11, color: '#3d5a78', lineHeight: 1.6 }}>
                      Фото паспорта хранится в зашифрованном виде (AES-256) и используется исключительно для верификации личности. Данные не передаются третьим лицам.
                    </div>
                  </div>

                  {/* Upload result */}
                  <AnimatePresence>
                    {uploadSuccess && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.97 }}
                        transition={{ duration: 0.22 }}
                        style={{
                          display: 'flex', gap: 10, padding: '13px 16px', borderRadius: 14,
                          background: isExpired ? '#f8717112' : '#34d39912',
                          border: `1px solid ${isExpired ? '#f8717130' : '#34d39930'}`,
                        }}
                      >
                        {isExpired
                          ? <ShieldX style={{ width: 16, height: 16, color: '#f87171', flexShrink: 0 }} />
                          : <CheckCircle2 style={{ width: 16, height: 16, color: '#34d399', flexShrink: 0 }} />
                        }
                        <span style={{ fontSize: 13, fontWeight: 600, color: isExpired ? '#f87171' : '#34d399' }}>
                          {uploadSuccess}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* ── Upload result for valid/expired ── */}
              {status !== 'none' && (
                <>
                  <AnimatePresence>
                    {uploadSuccess && (
                      <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        style={{
                          marginTop: 16, display: 'flex', gap: 10, padding: '13px 16px', borderRadius: 14,
                          background: isExpired ? '#f8717112' : '#34d39912',
                          border: `1px solid ${isExpired ? '#f8717130' : '#34d39930'}`,
                        }}
                      >
                        {isExpired
                          ? <ShieldX style={{ width: 16, height: 16, color: '#f87171', flexShrink: 0 }} />
                          : <CheckCircle2 style={{ width: 16, height: 16, color: '#34d399', flexShrink: 0 }} />
                        }
                        <span style={{ fontSize: 13, fontWeight: 600, color: isExpired ? '#f87171' : '#34d399' }}>{uploadSuccess}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {/* Update passport button */}
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={onUpdateClick}
                    style={{
                      marginTop: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                      padding: '16px', borderRadius: 16, cursor: 'pointer',
                      background: '#ffffff08', border: '1px solid #ffffff14',
                      color: '#c8ddf0', fontSize: 14, fontWeight: 700,
                    }}
                  >
                    <Upload style={{ width: 16, height: 16 }} />
                    Обновить паспорт
                  </motion.button>
                </>
              )}

              {/* Bottom safe area */}
              <div style={{ height: 20 }} />
            </div>
          </motion.div>

          <style>{`
            @keyframes avia-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
        </>
      )}
    </AnimatePresence>
  );
}
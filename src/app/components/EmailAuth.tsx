import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft, Mail, User, Phone, AlertCircle, CheckCircle2,
  Truck, Package, ChevronRight, MessageCircle, Lock,
  Eye, EyeOff, ShieldCheck, Fingerprint, Sparkles, ArrowRight,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import { useUser } from '../contexts/UserContext';
import { toast } from 'sonner';
import * as notificationsApi from '../api/notificationsApi';
import {
  registerUser, findUserByEmail, loginUser,
  checkEmailForCode, setUserCode, verifyPermCode, resetUserCode,
  sendEmailCode, verifyEmailCode,
  type OvoraUser,
} from '../api/authApi';
import { motion } from 'motion/react';

// ── Steps ──────────────────────────────────────────────────────────────────────
type Step =
  | 'email'
  | 'email_code'   // новый пользователь: подтверждение почты кодом из письма
  | 'create_code'
  | 'enter_code'
  | 'forgot'
  | 'register'
  | 'login_found'
  | 'role_conflict';

const SUPPORT_TG = 'https://t.me/ovora_support';

const STEP_LABELS: Partial<Record<Step, string>> = {
  email:        'Email',
  create_code:  'Создать PIN',
  enter_code:   'Ввести PIN',
  forgot:       'Поддержка',
  register:     'Регистрация',
  login_found:  'Вход',
  role_conflict:'Конфликт',
};

// ═══════════════════════════════════════════════════════════════════════════════
// Standalone helpers & sub-components (defined OUTSIDE EmailAuth so React
// never unmounts/remounts them on re-render → no focus loss while typing)
// ═══════════════════════════════════════════════════════════════════════════════

function Spinner() {
  return <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />;
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
      <p className="text-[12px] text-red-400 font-medium">{msg}</p>
    </div>
  );
}

function GlassCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-white/[0.07] bg-white/[0.04] p-4 ${className}`}>
      {children}
    </div>
  );
}

function CTAButton({
  onClick, disabled, loading, loadingText, children, color = '#1d4ed8',
}: {
  onClick: () => void; disabled?: boolean; loading?: boolean;
  loadingText?: string; children: React.ReactNode; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full rounded-3xl font-black text-[15px] text-white flex items-center justify-center gap-2.5 transition-all active:scale-[0.97] disabled:opacity-50"
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        boxShadow: `0 4px 20px ${color}40`,
        height: 52,
      }}
    >
      {loading ? <><Spinner /><span>{loadingText}</span></> : children}
    </button>
  );
}

function InputField({
  icon: Icon, label, value, onChange, placeholder, type = 'text',
  err, inputRef, onEnter,
}: {
  icon: React.ElementType; label: string; value: string;
  onChange: (v: string) => void; placeholder: string;
  type?: string; err?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnter?: () => void;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-2">{label}</p>
      <div
        className="relative flex items-center rounded-2xl border transition-all"
        style={{
          background: err ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.04)',
          borderColor: err ? '#ef4444' : 'rgba(255,255,255,0.09)',
        }}
      >
        <Icon className="absolute left-3.5 w-4 h-4 text-[#607080]" />
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={type === 'email' ? 'email' : 'off'}
          onKeyDown={onEnter ? (e => e.key === 'Enter' && onEnter()) : undefined}
          className="flex-1 bg-transparent outline-none py-3.5 pl-10 pr-4 font-medium text-white placeholder-[#607080]"
          style={{ fontSize: 16 }}
        />
      </div>
      {err && (
        <p className="mt-1.5 text-[11px] text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />{err}
        </p>
      )}
    </div>
  );
}

function EmailBadge({ email, tag, tagColor }: { email: string; tag: string; tagColor: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.04]">
      <Mail className="w-3.5 h-3.5 text-[#5ba3f5] shrink-0" />
      <p className="text-[12px] font-medium text-[#8899aa] truncate flex-1">{email.trim()}</p>
      <span className="text-[9px] font-black px-2 py-0.5 rounded-full shrink-0"
        style={{ background: `${tagColor}18`, color: tagColor, border: `1px solid ${tagColor}30` }}>
        {tag}
      </span>
    </div>
  );
}

// ── Digit handlers (standalone, no closure over component state) ───────────────
function handleDigitChange(
  i: number, val: string,
  arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>,
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
  onClearError: () => void,
) {
  const d = val.replace(/\D/g, '').slice(-1);
  const next = [...arr]; next[i] = d; setArr(next); onClearError();
  if (d && i < 5) setTimeout(() => { refs.current[i + 1]?.focus(); refs.current[i + 1]?.select(); }, 10);
}

function handleDigitKeyDown(
  e: React.KeyboardEvent<HTMLInputElement>,
  i: number, arr: string[], setArr: React.Dispatch<React.SetStateAction<string[]>>,
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
  onClearError: () => void,
) {
  if (e.key === 'Backspace') {
    e.preventDefault();
    const next = [...arr];
    if (arr[i]) { next[i] = ''; setArr(next); }
    else if (i > 0) { next[i - 1] = ''; setArr(next); setTimeout(() => refs.current[i - 1]?.focus(), 10); }
    onClearError();
  } else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); refs.current[i - 1]?.focus(); }
  else if (e.key === 'ArrowRight' && i < 5)  { e.preventDefault(); refs.current[i + 1]?.focus(); }
  else if (/^\d$/.test(e.key)) {
    e.preventDefault();
    const next = [...arr]; next[i] = e.key; setArr(next); onClearError();
    if (i < 5) setTimeout(() => { refs.current[i + 1]?.focus(); refs.current[i + 1]?.select(); }, 10);
  }
}

function handleDigitPaste(
  e: React.ClipboardEvent<HTMLInputElement>,
  setArr: React.Dispatch<React.SetStateAction<string[]>>,
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
  onClearError: () => void,
) {
  e.preventDefault();
  const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('');
  const next = Array(6).fill('');
  digits.forEach((d, i) => { if (i < 6) next[i] = d; });
  setArr(next); onClearError();
  setTimeout(() => refs.current[Math.min(digits.length, 5)]?.focus(), 10);
}

function handleDigitFocus(e: React.FocusEvent<HTMLInputElement>) {
  setTimeout(() => e.target.select(), 10);
}

function DigitRow({
  arr, setArr, refs, show, onToggleShow, label, codeErr, onClearError,
}: {
  arr: string[]; setArr: React.Dispatch<React.SetStateAction<string[]>>;
  refs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  show: boolean; onToggleShow: () => void; label: string;
  codeErr: string; onClearError: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">{label}</p>
        <button type="button" onClick={onToggleShow}
          className="flex items-center gap-1 text-[11px] font-semibold text-[#607080] hover:text-white transition-colors">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {show ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      <div className="flex gap-2 justify-center">
        {arr.map((digit, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el; }}
            type={show ? 'text' : 'password'}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            onChange={e => handleDigitChange(i, e.target.value, arr, setArr, refs, onClearError)}
            onKeyDown={e => handleDigitKeyDown(e, i, arr, setArr, refs, onClearError)}
            onPaste={e => handleDigitPaste(e, setArr, refs, onClearError)}
            onFocus={handleDigitFocus}
            autoComplete="one-time-code"
            className="text-center font-black outline-none transition-all rounded-2xl border-2"
            style={{
              width: 'clamp(28px, calc((100vw - 120px) / 6), 52px)',
              height: 'clamp(36px, calc((100vw - 120px) / 6 * 1.2), 60px)',
              fontSize: 'clamp(14px, calc((100vw - 120px) / 6 * 0.45), 22px)',
              flexShrink: 0,
              flexGrow: 0,
              background: digit
                ? (codeErr ? '#ef444419' : '#5ba3f51e')
                : '#ffffff0d',
              borderColor: codeErr
                ? '#ef4444'
                : digit ? '#5ba3f5' : '#ffffff1a',
              color: codeErr ? '#f87171' : '#fff',
              boxShadow: digit && !codeErr ? '0 2px 12px #5ba3f52e' : 'none',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════════════
export function EmailAuth() {
  const navigate = useNavigate();
  const { setUserEmail, user } = useUser();
  const [searchParams] = useSearchParams();
  const role = (searchParams.get('role') as 'driver' | 'sender') || 'sender';

  const isAdmin = user?.email === 'admin@ovora.tj';

  const [step, setStep] = useState<Step>('email');

  // email
  const [email,    setEmail]    = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [checking, setChecking] = useState(false);

  // code
  const [code,       setCode]       = useState(['', '', '', '', '', '']);
  const [showCode,   setShowCode]   = useState(false);
  const [codeErr,    setCodeErr]    = useState('');
  const [verifying,  setVerifying]  = useState(false);
  const [resetting,  setResetting]  = useState(false);
  const [resending,  setResending]  = useState(false);

  // confirm
  const [confirm,      setConfirm]      = useState(['', '', '', '', '', '']);
  const [showConfirm,  setShowConfirm]  = useState(false);

  const [existingUser, setExistingUser] = useState<OvoraUser | null>(null);
  const [conflictRole, setConflictRole] = useState<'driver' | 'sender' | null>(null);

  // register
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [phone,     setPhone]     = useState('');
  const [formErr,   setFormErr]   = useState<Record<string, string>>({});
  const [submitting,setSubmitting]= useState(false);

  const codeRefs    = useRef<(HTMLInputElement | null)[]>([]);
  const confirmRefs = useRef<(HTMLInputElement | null)[]>([]);
  const emailRef    = useRef<HTMLInputElement>(null);
  const stepRef     = useRef<Step>(step);
  useEffect(() => { stepRef.current = step; }, [step]);

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const codeStr    = code.join('');
  const confirmStr = confirm.join('');

  const RoleIcon  = role === 'driver' ? Truck : Package;
  const roleColor = role === 'driver' ? '#5ba3f5' : '#10b981';
  const roleLabel = role === 'driver' ? 'Водитель' : 'Отправитель';

  useEffect(() => { if (step === 'email') emailRef.current?.focus(); }, [step]);
  useEffect(() => {
    if (step === 'create_code' || step === 'enter_code' || step === 'email_code')
      setTimeout(() => codeRefs.current[0]?.focus(), 200);
  }, [step]);
  useEffect(() => {
    if (step === 'create_code' && codeStr.length === 6)
      setTimeout(() => confirmRefs.current[0]?.focus(), 300);
  }, [codeStr, step]);

  const resetCode    = () => setCode(['', '', '', '', '', '']);
  const resetConfirm = () => setConfirm(['', '', '', '', '', '']);
  const clearCodeErr = () => setCodeErr('');

  // ── API handlers ──────────────────────────────────────────────────────────
  const handleEmailSubmit = async () => {
    const t = email.trim();
    if (!t)              { setEmailErr('Введите email'); return; }
    if (!isValidEmail(t)){ setEmailErr('Некорректный формат email'); return; }
    setEmailErr(''); setChecking(true);
    try {
      const result = await checkEmailForCode(t);
      resetCode(); resetConfirm(); setCodeErr('');
      if (result.isNew) {
        // Новый пользователь: сначала подтверждаем, что почта его — кодом из
        // письма, и только после этого даём придумать PIN.
        await sendEmailCode(t);
        setStep('email_code');
      } else {
        // Вернувшийся: PIN уже установлен, письмо не нужно.
        setStep('enter_code');
      }
    } catch (err: any) { toast.error(err?.message || 'Ошибка проверки email'); }
    finally { setChecking(false); }
  };

  // Шаг нового пользователя: подтверждаем почту кодом из письма.
  // Успех открывает установку PIN — сервер без этого её отклонит.
  const handleVerifyEmailCode = async () => {
    if (codeStr.length < 6) { setCodeErr('Введите 6-значный код из письма'); return; }
    setCodeErr(''); setVerifying(true);
    const calledFromStep = stepRef.current;
    try {
      await verifyEmailCode(email.trim(), codeStr);
      if (stepRef.current !== calledFromStep) return;
      resetCode(); resetConfirm(); setCodeErr('');
      setStep('create_code');
    } catch (err: any) {
      if (stepRef.current === calledFromStep) setCodeErr(err?.message || 'Неверный код');
    } finally { setVerifying(false); }
  };

  const handleResendEmailCode = async () => {
    setResending(true);
    try {
      await sendEmailCode(email.trim());
      resetCode(); setCodeErr('');
      toast.success('Код отправлен повторно');
    } catch (err: any) { toast.error(err?.message || 'Не удалось отправить код'); }
    finally { setResending(false); }
  };

  const handleCreateCode = async () => {
    if (codeStr.length < 6)    { setCodeErr('Введите 6-значный код'); return; }
    if (confirmStr.length < 6) { setCodeErr('Подтвердите код'); return; }
    if (codeStr !== confirmStr){ setCodeErr('Коды не совпадают'); resetConfirm(); confirmRefs.current[0]?.focus(); return; }
    setCodeErr(''); setVerifying(true);
    const calledFromStep = stepRef.current;
    try {
      await setUserCode(email.trim(), codeStr);
      if (stepRef.current !== calledFromStep) return;
      const found = await findUserByEmail(email.trim());
      if (stepRef.current !== calledFromStep) return;
      if (!found) { setStep('register'); }
      else if (found.role === role) { setExistingUser(found); setStep('login_found'); }
      else { setExistingUser(found); setConflictRole(found.role); setStep('role_conflict'); }
    } catch (err: any) {
      if (stepRef.current === calledFromStep) setCodeErr(err?.message || 'Ошибка создания кода');
    }
    finally { setVerifying(false); }
  };

  const handleVerifyCode = async () => {
    if (codeStr.length < 6) { setCodeErr('Введите 6-значный код'); return; }
    setCodeErr(''); setVerifying(true);
    const calledFromStep = stepRef.current;
    try {
      await verifyPermCode(email.trim(), codeStr);
      if (stepRef.current !== calledFromStep) return;
      const found = await findUserByEmail(email.trim());
      if (stepRef.current !== calledFromStep) return;
      if (!found) { setStep('register'); }
      else if (found.role === role) { setExistingUser(found); setStep('login_found'); }
      else { setExistingUser(found); setConflictRole(found.role); setStep('role_conflict'); }
    } catch (err: any) {
      if (stepRef.current === calledFromStep) {
        setCodeErr(err?.message || 'Неверный код');
        resetCode(); setTimeout(() => codeRefs.current[0]?.focus(), 100);
      }
    } finally { setVerifying(false); }
  };

  const handleResetAndRestart = async () => {
    setResetting(true);
    try {
      await resetUserCode(email.trim());
      resetCode(); setCodeErr('');
      toast.success('Код сброшен. Придумайте новый.'); setStep('create_code');
    } catch (err: any) { toast.error(err?.message || 'Ошибка сброса'); }
    finally { setResetting(false); }
  };

  const handleLogin = async (u: OvoraUser) => {
    loginUser(u); setUserEmail(u.email);
    try {
      await notificationsApi.createNotification({
        userEmail: u.email, type: 'auth', iconName: 'UserCheck',
        iconBg: 'bg-emerald-500/10 text-emerald-500',
        title: 'Вход выполнен', description: `Добро пожаловать, ${u.firstName}!`,
      });
    } catch (_) {}
    toast.success(`Добро пожаловать, ${u.firstName}!`);
    navigate('/dashboard');
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = 'Введите имя';
    if (!lastName.trim())  errs.lastName  = 'Введите фамилию';
    if (!phone.trim() || phone.replace(/\D/g, '').length < 9) errs.phone = 'Введите корректный номер';
    setFormErr(errs);
    return !Object.keys(errs).length;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      const newUser = await registerUser({
        email: email.trim().toLowerCase(), role,
        firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim(),
      });
      try {
        await notificationsApi.createNotification({
          userEmail: newUser.email, type: 'auth', iconName: 'UserCheck',
          iconBg: 'bg-emerald-500/10 text-emerald-500',
          title: 'Аккаунт создан 🎉', description: 'Добро пожаловать в Ovora Cargo!',
        });
      } catch (_) {}
      toast.success('Аккаунт создан!');
      setUserEmail(newUser.email);
      if (role === 'driver') navigate('/driver-registration-form');
      else navigate('/dashboard');
    } catch (err) { toast.error(`Ошибка регистрации: ${err}`); }
    finally { setSubmitting(false); }
  };

  const handleBack = () => {
    const prev: Partial<Record<Step, Step>> = {
      email_code: 'email',
      create_code: 'email', enter_code: 'email', forgot: 'enter_code',
      register: 'email', login_found: 'email', role_conflict: 'email',
    };
    const t = prev[step];
    if (t) { resetCode(); resetConfirm(); setCodeErr(''); setStep(t); }
    else navigate('/role-select');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen font-['Sora'] bg-[#060e1a] text-white">

      {/* ── HERO / BG ── */}
      <div className="relative overflow-hidden shrink-0">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(145deg, #0a1f3d 0%, #060e1a 65%)' }} />
          <div className="absolute -top-16 -right-16 w-60 h-60 rounded-full"
            style={{ background: 'radial-gradient(circle, #1d4ed8 0%, transparent 70%)', opacity: 0.18 }} />
        </div>

        {/* Top bar */}
        <div className="relative flex items-center justify-between px-4"
          style={{ paddingTop: 'max(52px, env(safe-area-inset-top, 52px))', paddingBottom: 8 }}>
          <button onClick={handleBack}
            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white/[0.07] border border-white/10 text-white active:scale-90 transition-all">
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080]">
              {STEP_LABELS[step] ?? 'Авторизация'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border"
            style={{ background: `${roleColor}14`, borderColor: `${roleColor}30` }}>
            <RoleIcon className="w-3.5 h-3.5" style={{ color: roleColor }} />
            <span className="text-[11px] font-black" style={{ color: roleColor }}>{roleLabel}</span>
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <main className="flex flex-col px-4 pb-8 pt-3 max-w-md mx-auto w-full">

        {/* Step progress dots */}
        {step !== 'forgot' && (
          <div className="flex items-center justify-center gap-2 mb-3">
            {[1, 2, 3].map(n => {
              const cur = step === 'email' ? 1
                : (step === 'create_code' || step === 'enter_code' || step === 'email_code') ? 2
                : 3;
              return (
                <div key={n}
                  className="h-[3px] rounded-full transition-all duration-500"
                  style={{
                    width: n === cur ? 28 : 8,
                    background: n <= cur ? '#5ba3f5' : 'rgba(255,255,255,0.10)',
                  }}
                />
              );
            })}
          </div>
        )}

        {/* Animated step container */}
        <motion.div
          key={step}
          className="flex flex-col gap-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        >

          {/* ══ STEP 1: Email ══ */}
          {step === 'email' && (<>
            <div className="flex flex-col items-center text-center pt-4 pb-2">
              <div className="relative flex items-center justify-center mb-5">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.45, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.52 }}
                    transition={{ duration: 1.8, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 80, height: 80, border: '1.5px solid #5ba3f5', borderRadius: 24 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #1d4ed8, #2563eb)' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 24, boxShadow: '0 8px 32px #1d4ed840' }} />
                  <Mail className="w-9 h-9 text-white relative z-10" />
                </div>
                <div className="absolute -bottom-1.5 -right-1.5 z-20 w-7 h-7 rounded-xl bg-[#5ba3f5] flex items-center justify-center border-2 border-[#060e1a]">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
              </div>
              <h2 className="text-[28px] font-black mb-2 leading-tight"
                style={{ background: 'linear-gradient(90deg, #fff 40%, #8899bb)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Добро пожаловать
              </h2>
              <p className="text-[13px] text-[#607080] max-w-[260px] leading-snug">
                Введите email — система сама определит, вы новый или уже зарегистрированы
              </p>
            </div>

            <GlassCard>
              <InputField
                icon={Mail} label="Email адрес"
                value={email} onChange={v => { setEmail(v); setEmailErr(''); }}
                placeholder="example@mail.com" type="email"
                err={emailErr} inputRef={emailRef}
                onEnter={handleEmailSubmit}
              />
            </GlassCard>

            <div className="relative flex items-start gap-3 px-4 py-3.5 rounded-2xl overflow-hidden"
              style={{ background: '#5ba3f50e' }}>
              <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-r-full bg-[#5ba3f5]" />
              <ShieldCheck className="w-4 h-4 text-[#5ba3f5] shrink-0 mt-0.5" />
              <p className="text-[12px] text-[#607080] leading-snug">
                Новым пользователям предложат создать PIN — он заменяет пароль
              </p>
            </div>

            <CTAButton onClick={handleEmailSubmit} loading={checking} loadingText="Проверяем...">
              <span>Продолжить</span>
              <ChevronRight className="w-5 h-5" />
            </CTAButton>
          </>)}

          {/* ══ STEP 2-0: Код из письма (только новый пользователь) ══ */}
          {step === 'email_code' && (<>
            <div className="flex items-center gap-3 pt-1">
              <div className="relative flex items-center justify-center shrink-0">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.4, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.48 }}
                    transition={{ duration: 1.8, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 52, height: 52, border: '1.5px solid #5ba3f5', borderRadius: 16 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 flex items-center justify-center rounded-2xl"
                  style={{ width: 52, height: 52, background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', boxShadow: '0 6px 20px #1d4ed840' }}>
                  <Mail className="w-6 h-6 text-white relative z-10" />
                </div>
              </div>
              <div>
                <h2 className="text-[20px] font-black text-white leading-tight">Код из письма</h2>
                <p className="text-[12px] text-[#607080]">Отправили 6 цифр на вашу почту</p>
              </div>
            </div>

            <EmailBadge email={email} tag="ПОДТВЕРЖДЕНИЕ" tagColor="#5ba3f5" />

            <GlassCard className="flex flex-col gap-4">
              <DigitRow
                arr={code} setArr={setCode} refs={codeRefs}
                show={showCode} onToggleShow={() => setShowCode(v => !v)}
                label="Код из письма" codeErr={codeErr} onClearError={clearCodeErr}
              />
              {codeErr && <ErrorBanner msg={codeErr} />}
            </GlassCard>

            <CTAButton
              onClick={handleVerifyEmailCode}
              disabled={codeStr.length < 6}
              loading={verifying} loadingText="Проверяем..."
            >
              <ShieldCheck className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              <span>Подтвердить</span>
            </CTAButton>

            <button onClick={handleResendEmailCode} disabled={resending}
              className="w-full h-12 rounded-2xl text-[13px] font-semibold text-[#607080] border border-white/[0.07] hover:border-white/[0.15] hover:text-white transition-all flex items-center justify-center gap-2">
              {resending
                ? <><div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" /><span>Отправляем...</span></>
                : 'Не пришло письмо? Отправить ещё раз'}
            </button>
          </>)}

          {/* ══ STEP 2a: Create PIN ══ */}
          {step === 'create_code' && (<>
            <div className="flex items-center gap-3 pt-1">
              <div className="relative flex items-center justify-center shrink-0">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.4, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.48 }}
                    transition={{ duration: 1.8, delay: i * 0.6, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 52, height: 52, border: '1.5px solid #10b981', borderRadius: 16 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 flex items-center justify-center rounded-2xl"
                  style={{ width: 52, height: 52, background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 6px 20px #10b98140' }}>
                  <Fingerprint className="w-6 h-6 text-white relative z-10" />
                </div>
              </div>
              <div>
                <h2 className="text-[20px] font-black text-white leading-tight">Придумайте PIN</h2>
                <p className="text-[12px] text-[#607080]">6 цифр — ваш ключ для входа</p>
              </div>
            </div>

            <EmailBadge email={email} tag="НОВЫЙ" tagColor="#10b981" />

            <GlassCard className="flex flex-col gap-4">
              <DigitRow
                arr={code} setArr={setCode} refs={codeRefs}
                show={showCode} onToggleShow={() => setShowCode(v => !v)}
                label="Придумайте код" codeErr={codeErr} onClearError={clearCodeErr}
              />
              <div style={{
                maxHeight: codeStr.length === 6 ? 200 : 0,
                opacity: codeStr.length === 6 ? 1 : 0,
                overflow: 'hidden',
                transition: 'max-height 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.3s ease',
              }}>
                <div className="h-px bg-white/[0.06] mb-4" />
                <DigitRow
                  arr={confirm} setArr={setConfirm} refs={confirmRefs}
                  show={showConfirm} onToggleShow={() => setShowConfirm(v => !v)}
                  label="Повторите код" codeErr={codeErr} onClearError={clearCodeErr}
                />
              </div>
              {codeErr && <ErrorBanner msg={codeErr} />}
            </GlassCard>

            <div className="relative flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl overflow-hidden"
              style={{ background: '#f59e0b0e' }}>
              <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-r-full bg-amber-400" />
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <p className="text-[11px] text-[#607080] leading-snug">
                Запомните PIN — восстановить только через поддержку
              </p>
            </div>

            <CTAButton
              onClick={handleCreateCode}
              disabled={codeStr.length < 6 || confirmStr.length < 6}
              loading={verifying} loadingText="Сохраняем..."
              color="#059669"
            >
              <Lock className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              <span>Установить PIN</span>
            </CTAButton>
          </>)}

          {/* ══ STEP 2b: Enter PIN ══ */}
          {step === 'enter_code' && (<>
            <div className="flex items-center gap-3 pt-1">
              <div className="relative flex items-center justify-center shrink-0">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.4, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.48 }}
                    transition={{ duration: 1.8, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 52, height: 52, border: '1.5px solid #5ba3f5', borderRadius: 16 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 flex items-center justify-center rounded-2xl"
                  style={{ width: 52, height: 52, background: 'linear-gradient(135deg, #1d4ed8, #2563eb)', boxShadow: '0 6px 20px #1d4ed840' }}>
                  <Lock className="w-6 h-6 text-white relative z-10" />
                </div>
              </div>
              <div>
                <h2 className="text-[20px] font-black text-white leading-tight">Введите PIN</h2>
                <p className="text-[12px] text-[#607080]">Ваш 6-значный код доступа</p>
              </div>
            </div>

            <EmailBadge email={email} tag="ВЕРНУВШИЙСЯ" tagColor="#5ba3f5" />

            <GlassCard className="flex flex-col gap-4">
              <DigitRow
                arr={code} setArr={setCode} refs={codeRefs}
                show={showCode} onToggleShow={() => setShowCode(v => !v)}
                label="Ваш PIN-код" codeErr={codeErr} onClearError={clearCodeErr}
              />
              {codeErr && (
                <div className="flex flex-col gap-2">
                  <ErrorBanner msg={codeErr} />
                  {(codeErr.includes('Осталось') || codeErr.includes('лимит') || codeErr.includes('Неверный')) && (
                    <button type="button" onClick={() => setStep('forgot')}
                      className="text-[#5ba3f5] text-[12px] font-semibold text-left pl-1 hover:underline">
                      Забыли PIN? Обратитесь в поддержку →
                    </button>
                  )}
                </div>
              )}
            </GlassCard>

            <CTAButton
              onClick={handleVerifyCode}
              disabled={codeStr.length < 6}
              loading={verifying} loadingText="Проверяем..."
            >
              <Lock className="w-4.5 h-4.5" style={{ width: 18, height: 18 }} />
              <span>Войти</span>
            </CTAButton>

            <div className="flex flex-col gap-2">
              <button onClick={() => setStep('forgot')}
                className="w-full h-12 rounded-2xl text-[13px] font-semibold text-[#607080] border border-white/[0.07] hover:border-white/[0.15] hover:text-white transition-all">
                Забыли PIN? → Поддержка
              </button>
              {isAdmin && (
                <button onClick={handleResetAndRestart} disabled={resetting}
                  className="w-full h-11 rounded-2xl text-[12px] font-semibold border border-orange-500/20 text-orange-400/70 hover:text-orange-400 hover:border-orange-500/40 transition-all flex items-center justify-center gap-2">
                  {resetting
                    ? <><div className="w-3.5 h-3.5 border-2 border-orange-400/30 border-t-orange-400 rounded-full animate-spin" /><span>Сбрасываем...</span></>
                    : '↺ Сбросить и создать новый PIN'}
                </button>
              )}
            </div>
          </>)}

          {/* ══ STEP 3: Forgot ══ */}
          {step === 'forgot' && (<>
            <div className="flex flex-col items-center text-center pt-4 pb-2">
              <div className="relative flex items-center justify-center mb-5">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.4, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.5 }}
                    transition={{ duration: 1.8, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 80, height: 80, border: '1.5px solid #f59e0b', borderRadius: 24 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 24, boxShadow: '0 8px 32px #f59e0b30' }} />
                  <MessageCircle className="w-9 h-9 text-white relative z-10" />
                </div>
              </div>
              <h2 className="text-[26px] font-black text-white mb-1.5">Забыли PIN?</h2>
              <p className="text-[13px] text-[#607080] max-w-[240px] leading-snug">
                Код нельзя восстановить — в базе только хеш. Напишите нам в Telegram
              </p>
            </div>

            <a href={SUPPORT_TG} target="_blank" rel="noopener noreferrer"
              className="w-full h-16 flex items-center gap-4 px-5 rounded-3xl active:scale-[0.97] transition-all"
              style={{ background: 'linear-gradient(135deg, #229ED9, #1a8cc4)', boxShadow: '0 4px 24px #229ED930' }}>
              <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-white font-black text-[15px]">Написать в Telegram</p>
                <p className="text-white/60 text-[12px]">@ovora_support · Быстрый ответ</p>
              </div>
              <ChevronRight className="w-4 h-4 text-white/50" />
            </a>

            <GlassCard>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-3">Укажите в сообщении</p>
              <div className="flex items-center gap-2 px-3.5 py-3 rounded-2xl bg-white/[0.06] border border-white/[0.08]">
                <Mail className="w-3.5 h-3.5 text-[#607080] shrink-0" />
                <span className="font-mono text-[13px] text-[#8899aa] truncate">{email.trim()}</span>
              </div>
              <p className="text-[11px] text-[#607080] mt-2.5 leading-snug">
                Поддержка верифицирует вашу личность и сбросит доступ
              </p>
            </GlassCard>

            <button onClick={() => { setStep('enter_code'); resetCode(); setCodeErr(''); }}
              className="w-full h-12 rounded-2xl text-[13px] font-semibold text-[#607080] border border-white/[0.07] hover:border-white/[0.15] hover:text-white transition-all">
              ← Попробую вспомнить
            </button>
          </>)}

          {/* ══ STEP 4: Register ══ */}
          {step === 'register' && (<>
            <div className="relative flex items-center gap-3 px-4 py-3.5 rounded-2xl overflow-hidden"
              style={{ background: '#10b9810e' }}>
              <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-r-full bg-[#10b981]" />
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" style={{ width: 18, height: 18 }} />
              <div>
                <p className="text-[12px] font-black text-emerald-400">PIN принят</p>
                <p className="text-[11px] text-[#607080]">Аккаунт не найден — заполните данные</p>
              </div>
            </div>

            <div className="px-1">
              <h2 className="text-[26px] font-black text-white mb-0.5">Регистрация</h2>
              <p className="text-[13px] text-[#607080]">
                {role === 'driver' ? 'Данные авто — на следующем шаге' : 'Создайте аккаунт отправителя'}
              </p>
            </div>

            <GlassCard className="flex flex-col gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#607080] mb-2">Email</p>
                <div className="flex items-center gap-2 px-3.5 py-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.04]">
                  <Mail className="w-4 h-4 text-[#607080] shrink-0" />
                  <span className="text-[13px] text-[#8899aa] truncate flex-1">{email.trim()}</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                </div>
              </div>

              <InputField icon={User} label="Имя"
                value={firstName} onChange={v => { setFirstName(v); setFormErr(p => ({ ...p, firstName: '' })); }}
                placeholder="Алишер" err={formErr.firstName} />

              <InputField icon={User} label="Фамилия"
                value={lastName} onChange={v => { setLastName(v); setFormErr(p => ({ ...p, lastName: '' })); }}
                placeholder="Рахимов" err={formErr.lastName} />

              <InputField icon={Phone} label="Телефон" type="tel"
                value={phone}
                onChange={v => { setPhone(v.replace(/[^\d\s+\-()]/g, '')); setFormErr(p => ({ ...p, phone: '' })); }}
                placeholder="+992 900 00 00 00" err={formErr.phone} />
            </GlassCard>

            <CTAButton onClick={handleRegister} loading={submitting} loadingText="Создание...">
              <span>{role === 'driver' ? 'Далее: данные авто' : 'Создать аккаунт'}</span>
              <ChevronRight className="w-5 h-5" />
            </CTAButton>
          </>)}

          {/* ══ STEP 5: Login found ══ */}
          {step === 'login_found' && existingUser && (<>
            <motion.div
              className="flex flex-col items-center text-center pt-8 pb-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
            >
              {/* Circular glow icon */}
              <div className="relative mb-8 flex items-center justify-center">
                {[1, 2, 3].map(i => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full"
                    style={{ border: '1px solid #10b981' }}
                    initial={{ width: 80, height: 80, opacity: 0.4 }}
                    animate={{ width: 80 + i * 40, height: 80 + i * 40, opacity: 0 }}
                    transition={{ duration: 1.8, delay: i * 0.3, repeat: Infinity, ease: 'easeOut' }}
                  />
                ))}
                <motion.div
                  className="relative z-10 rounded-full flex items-center justify-center"
                  style={{ width: 88, height: 88, background: 'linear-gradient(135deg, #059669, #10b981)', boxShadow: '0 0 48px #10b98150, 0 0 80px #10b98120' }}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.05 }}
                >
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 16, delay: 0.28 }}
                  >
                    <CheckCircle2 className="w-11 h-11 text-white" strokeWidth={2} />
                  </motion.div>
                </motion.div>
              </div>

              <motion.p
                className="text-[22px] font-black text-white mb-2"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.38, duration: 0.35 }}
              >
                PIN-код подтверждён
              </motion.p>
              <motion.p
                className="text-[14px] text-[#607080] mb-6"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.46, duration: 0.35 }}
              >
                Добро пожаловать!
              </motion.p>
              <motion.div
                className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-white/[0.08] bg-white/[0.04]"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.54, duration: 0.35 }}
              >
                <Mail className="w-3.5 h-3.5 text-[#607080]" />
                <p className="text-[13px] text-[#607080]">{existingUser.email}</p>
              </motion.div>
            </motion.div>

            <CTAButton onClick={() => handleLogin(existingUser)} color="#059669">
              <ArrowRight className="w-5 h-5" />
              <span>Войти в аккаунт</span>
            </CTAButton>

            <motion.div
              className="flex items-center justify-center gap-1.5 mt-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#3d5a6a]" />
              <p className="text-[11px] text-[#3d5a6a]">Ваши данные защищены и находятся в безопасности</p>
            </motion.div>
          </>)}

          {/* ══ Role conflict ══ */}
          {step === 'role_conflict' && existingUser && (<>
            <div className="flex flex-col items-center text-center pt-6 pb-2">
              <div className="relative flex items-center justify-center mb-5">
                {[0, 1].map(i => (
                  <motion.div
                    key={i}
                    className="absolute"
                    initial={{ opacity: 0.4, scale: 1 }}
                    animate={{ opacity: 0, scale: 1 + (i + 1) * 0.5 }}
                    transition={{ duration: 1.8, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
                  >
                    <div style={{ width: 80, height: 80, border: '1.5px solid #f59e0b', borderRadius: 24 }} />
                  </motion.div>
                ))}
                <div className="relative z-10 w-20 h-20 rounded-3xl flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 24, boxShadow: '0 8px 32px #f59e0b30' }} />
                  <AlertCircle className="w-10 h-10 text-white relative z-10" />
                </div>
              </div>
              <h2 className="text-[24px] font-black text-white mb-1.5">Другая роль</h2>
              <p className="text-[13px] text-[#607080] max-w-[240px] leading-snug">
                Email зарегистрирован как{' '}
                <strong className="text-white">
                  {conflictRole === 'driver' ? 'Водитель' : 'Отправитель'}
                </strong>
              </p>
            </div>

            <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-amber-500/20"
              style={{ background: '#f59e0b0e' }}>
              {conflictRole === 'driver'
                ? <Truck className="w-5 h-5 text-amber-400 shrink-0" />
                : <Package className="w-5 h-5 text-amber-400 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-white">
                  Аккаунт: {conflictRole === 'driver' ? 'Водитель' : 'Отправитель'}
                </p>
                <p className="text-[11px] text-[#607080] truncate">{existingUser.email}</p>
              </div>
            </div>

            <CTAButton onClick={() => handleLogin(existingUser)} color="#1d4ed8">
              <span>Войти как {conflictRole === 'driver' ? 'Водитель' : 'Отправитель'}</span>
            </CTAButton>

            <button onClick={() => navigate('/role-select')}
              className="w-full h-12 rounded-2xl text-[13px] font-semibold text-[#607080] border border-white/[0.07] hover:border-white/[0.15] hover:text-white transition-all">
              Другой email
            </button>
          </>)}

        </motion.div>
      </main>
    </div>
  );
}

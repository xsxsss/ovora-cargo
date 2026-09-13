import { Home, Truck, MessageSquare, User, Plus, Search, X, Bell, Settings, LayoutGrid, ChevronRight, Plane } from 'lucide-react';
import { useLocation, Link, Outlet } from 'react-router';
import { useTheme } from '../context/ThemeContext';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getChats } from '../api/chatStore';
import { OfflineBanner } from './OfflineBanner';
import { usePolling } from '../hooks/usePolling';
import { PushPermissionBanner } from './PushPermissionBanner';
import { SubscriptionBanner } from './SubscriptionBanner';
import { useUser } from '../contexts/UserContext';

const navigation = [
  { name: 'Главная',   href: '/home',     icon: Home,          badge: null as 'chat' | 'trips' | null },
  { name: 'Поездки',   href: '/trips',    icon: Truck,         badge: 'trips' as const },
  { name: 'Сообщения', href: '/messages', icon: MessageSquare, badge: 'chat' as const },
  { name: 'Профиль',   href: '/profile',  icon: User,          badge: null },
];

// ─────────────────────────────────────────────────────────────────────────────
//  DESKTOP SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function DesktopSidebar({
  nav, isActive, getBadge, userRole,
}: {
  nav: typeof navigation;
  isActive: (item: typeof navigation[0]) => boolean;
  getBadge:  (item: typeof navigation[0]) => number;
  userRole: string;
}) {
  const isDriver = userRole === 'driver';

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-50"
      style={{
        width: 264,
        background: 'linear-gradient(180deg, #05101e 0%, #060d19 60%, #050c17 100%)',
        borderRight: '1px solid rgba(14,165,233,0.08)',
        boxShadow: '4px 0 40px rgba(0,0,0,0.5), 1px 0 0 rgba(14,165,233,0.04)',
      }}
    >
      {/* Subtle top glow */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 160, pointerEvents: 'none',
        background: 'transparent',
      }} />

      {/* ══ Logo ══ */}
      <div style={{ padding: '26px 18px 20px', display: 'flex', alignItems: 'center', gap: 13, position: 'relative' }}>
        <div style={{
          width: 42, height: 42, borderRadius: 14, flexShrink: 0,
          background: 'linear-gradient(135deg, #1245b0 0%, #1a6fd4 60%, #2f8fe0 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 0 1px rgba(47,143,224,0.25), 0 4px 20px rgba(26,71,200,0.45)',
        }}>
          <Plane style={{ width: 19, height: 19, color: '#fff' }} />
        </div>
        <div>
          <div style={{
            fontSize: 19, fontWeight: 900, color: '#e8f4ff',
            letterSpacing: '-0.6px', lineHeight: 1,
            fontFamily: "'Sora', sans-serif",
          }}>
            Ovora
          </div>
          <div style={{
            fontSize: 8.5, fontWeight: 700, color: '#2f8fe0',
            letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: 5,
          }}>
            Cargo Mobile
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{
        height: 1, margin: '0 18px 6px',
        background: 'linear-gradient(90deg, transparent, rgba(14,165,233,0.15), transparent)',
      }} />

      {/* ══ Nav label ══ */}
      <div style={{
        fontSize: 9.5, fontWeight: 700, color: 'rgba(14,165,233,0.3)',
        letterSpacing: '0.14em', textTransform: 'uppercase',
        padding: '14px 22px 8px',
      }}>
        Навигация
      </div>

      {/* ══ Nav ══ */}
      <nav style={{ flex: 1, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {nav.map(item => {
          const active = isActive(item);
          const badge  = getBadge(item);
          return (
            <Link
              key={item.name}
              to={item.href}
              aria-label={badge > 0 ? `${item.name} (${badge} непрочитанных)` : item.name}
              aria-current={active ? 'page' : undefined}
              className={`ovora-sb-link ${active ? 'ovora-sb-active' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 11,
                padding: '10px 12px', borderRadius: 13, textDecoration: 'none',
                position: 'relative', overflow: 'hidden',
                color: active ? '#7dd3fc' : '#2d4a65',
                fontWeight: active ? 700 : 500,
                fontSize: 13.5,
                background: active
                  ? 'linear-gradient(135deg, rgba(14,165,233,0.1) 0%, rgba(14,165,233,0.06) 100%)'
                  : 'transparent',
                boxShadow: active ? 'inset 0 0 0 1px rgba(14,165,233,0.12)' : 'none',
              }}
            >
              {/* Active left bar */}
              {active && (
                <span style={{
                  position: 'absolute', left: 0, top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3, height: 22, borderRadius: '0 4px 4px 0',
                  background: 'linear-gradient(180deg, #38bdf8 0%, #0ea5e9 100%)',
                  boxShadow: '2px 0 10px rgba(56,189,248,0.5)',
                }} />
              )}

              {/* Active bg glow */}
              {active && (
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: 'transparent',
                }} />
              )}

              {/* Icon container */}
              <span style={{
                width: 34, height: 34, borderRadius: 11, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: active
                  ? 'rgba(14,165,233,0.14)'
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${active ? 'rgba(14,165,233,0.22)' : 'rgba(255,255,255,0.05)'}`,
                position: 'relative',
                boxShadow: active ? '0 0 14px rgba(14,165,233,0.15)' : 'none',
                transition: 'all 0.17s ease',
              }}>
                <item.icon style={{
                  width: 15, height: 15,
                  strokeWidth: active ? 2.3 : 1.8,
                  color: active ? '#38bdf8' : '#2d4a65',
                  transition: 'all 0.17s ease',
                }} />
                {badge > 0 && (
                  <span aria-hidden="true" style={{
                    position: 'absolute', top: -5, right: -5,
                    minWidth: 17, height: 17, borderRadius: 9,
                    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                    border: '2px solid #05101e',
                    fontSize: 8.5, fontWeight: 900, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                    boxShadow: '0 2px 8px rgba(239,68,68,0.5)',
                  }}>{badge > 9 ? '9+' : badge}</span>
                )}
              </span>

              <span style={{ flex: 1, letterSpacing: active ? '-0.1px' : 0 }}>{item.name}</span>

              {active && (
                <ChevronRight style={{ width: 13, height: 13, opacity: 0.35, color: '#38bdf8' }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div style={{
        height: 1, margin: '8px 18px',
        background: 'linear-gradient(90deg, transparent, rgba(14,165,233,0.1), transparent)',
      }} />

      {/* ══ Utilities ══ */}
      <div style={{ padding: '2px 10px 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {[
          { icon: Bell,     label: 'Уведомления', href: '/notifications' },
          { icon: Settings, label: 'Настройки',   href: '/settings' },
        ].map(({ icon: Icon, label, href }) => (
          <Link
            key={href} to={href}
            className="ovora-sb-util"
            style={{
              display: 'flex', alignItems: 'center', gap: 11,
              padding: '9px 12px', borderRadius: 11, textDecoration: 'none',
              color: '#1e3a55', fontSize: 13, fontWeight: 500,
            }}
          >
            <span style={{
              width: 30, height: 30, borderRadius: 9, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.04)',
            }}>
              <Icon style={{ width: 13, height: 13 }} />
            </span>
            {label}
          </Link>
        ))}
      </div>

      {/* Divider */}
      <div style={{
        height: 1, margin: '0 18px',
        background: 'linear-gradient(90deg, transparent, rgba(14,165,233,0.08), transparent)',
      }} />

      {/* ══ Role Card ══ */}
      <div style={{ padding: '14px 14px 24px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 11,
          padding: '12px 14px', borderRadius: 14,
          background: isDriver
            ? 'linear-gradient(135deg, rgba(26,71,200,0.08) 0%, rgba(14,165,233,0.05) 100%)'
            : 'linear-gradient(135deg, rgba(4,120,87,0.08) 0%, rgba(52,211,153,0.05) 100%)',
          border: `1px solid ${isDriver ? 'rgba(14,165,233,0.1)' : 'rgba(52,211,153,0.1)'}`,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11, flexShrink: 0,
            background: isDriver
              ? 'linear-gradient(135deg, #1245b0, #2f8fe0)'
              : 'linear-gradient(135deg, #047857, #34d399)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: isDriver ? '0 4px 16px rgba(26,71,200,0.4)' : '0 4px 16px rgba(4,120,87,0.4)',
          }}>
            {isDriver
              ? <Truck style={{ width: 15, height: 15, color: '#fff' }} />
              : <User  style={{ width: 15, height: 15, color: '#fff' }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: isDriver ? 'rgba(14,165,233,0.4)' : 'rgba(52,211,153,0.4)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Роль
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#b8d8f5', lineHeight: 1.2, marginTop: 2 }}>
              {isDriver ? 'Водитель' : 'Отправитель'}
            </div>
          </div>
          {/* Online dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 0 3px rgba(34,197,94,0.15), 0 0 12px rgba(34,197,94,0.5)',
            }} className="animate-pulse-glow" />
          </div>
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  FLOATING MENU  (для страниц где сайдбар скрыт)
// ─────────────────────────────────────────────────────────────────────────────
function FloatingMenu({
  nav, isActive, getBadge, userRole, menuOpen, setMenuOpen,
}: {
  nav: typeof navigation;
  isActive: (item: typeof navigation[0]) => boolean;
  getBadge:  (item: typeof navigation[0]) => number;
  userRole: string;
  menuOpen: boolean;
  setMenuOpen: (v: boolean | ((v: boolean) => boolean)) => void;
}) {
  const isDriver = userRole === 'driver';

  const [pos, setPos]           = useState({ x: 20, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const initialized   = useRef(false);
  const dragging      = useRef(false);
  const hasDragged    = useRef(false);
  const dragOffset    = useRef({ x: 0, y: 0 });
  const mouseDownPos  = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!initialized.current) {
      setPos({ x: 20, y: window.innerHeight - 76 });
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const moved = Math.abs(e.clientX - mouseDownPos.current.x) + Math.abs(e.clientY - mouseDownPos.current.y);
      if (moved > 5) hasDragged.current = true;
      const newX = Math.max(0, Math.min(window.innerWidth  - 50, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
    };
    const onUp = () => { dragging.current = false; setIsDragging(false); };
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const t = e.touches[0];
      const moved = Math.abs(t.clientX - mouseDownPos.current.x) + Math.abs(t.clientY - mouseDownPos.current.y);
      if (moved > 5) { hasDragged.current = true; e.preventDefault(); }
      const newX = Math.max(0, Math.min(window.innerWidth  - 50, t.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 50, t.clientY - dragOffset.current.y));
      setPos({ x: newX, y: newY });
    };
    const onTouchEnd = () => { dragging.current = false; setIsDragging(false); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend',  onTouchEnd);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    hasDragged.current    = false;
    dragging.current      = true;
    mouseDownPos.current  = { x: e.clientX, y: e.clientY };
    dragOffset.current    = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setIsDragging(true);
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    hasDragged.current   = false;
    dragging.current     = true;
    mouseDownPos.current = { x: t.clientX, y: t.clientY };
    dragOffset.current   = { x: t.clientX - pos.x, y: t.clientY - pos.y };
    setIsDragging(true);
  };

  const handleClick = () => {
    if (hasDragged.current) return;
    setMenuOpen(v => !v);
  };

  const openUpward = pos.y > 400;
  const openRight  = pos.x + 280 < window.innerWidth - 10;

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    ...(openUpward ? { bottom: 62 } : { top: 62 }),
    ...(openRight  ? { left: 0 }    : { right: 0 }),
    width: 272,
    borderRadius: 20,
    overflow: 'hidden',
    background: 'linear-gradient(180deg, #071220 0%, #060d18 100%)',
    border: '1px solid rgba(14,165,233,0.1)',
    boxShadow: '0 -4px 6px rgba(0,0,0,0.3), 0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(14,165,233,0.04)',
  };

  return (
    <div className="hidden md:block fixed z-[60]" style={{ left: pos.x, top: pos.y }}>
      <style>{`
        @keyframes fm-panel-in { from { opacity:0; transform:translateY(10px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes fm-item-in  { from { opacity:0; transform:translateX(-6px); }           to { opacity:1; transform:translateX(0); } }
        .fm-link { transition: background .15s ease, color .15s ease; }
        .fm-link:hover:not(.fm-active) { background: rgba(14,165,233,0.06) !important; color: #7dd3fc !important; }
      `}</style>

      {menuOpen && (
        <div
          className="fixed inset-0 z-[-1]"
          style={{ backdropFilter: 'blur(2px)', background: 'rgba(0,0,0,0.2)' }}
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ── Panel ── */}
      {menuOpen && (
        <div style={{ ...panelStyle, animation: 'fm-panel-in 0.22s cubic-bezier(0.22,1,0.36,1) both' }}>

          {/* Top glow */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 80, pointerEvents: 'none',
            background: 'transparent',
          }} />

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '16px 18px 14px',
            borderBottom: '1px solid rgba(14,165,233,0.08)',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 12, flexShrink: 0,
              background: 'linear-gradient(135deg, #1245b0, #2f8fe0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(26,71,200,0.45)',
            }}>
              <Plane style={{ width: 16, height: 16, color: '#fff' }} />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#dff0ff', letterSpacing: '-0.4px', lineHeight: 1 }}>Ovora</div>
              <div style={{ fontSize: 8.5, fontWeight: 700, color: '#2f8fe0', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4 }}>Cargo Mobile</div>
            </div>
            <button
              aria-label="Закрыть меню"
              onClick={() => setMenuOpen(false)}
              style={{
                marginLeft: 'auto', width: 30, height: 30, borderRadius: 9, border: '1px solid rgba(255,255,255,0.06)',
                background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#2a4060',
              }}
            >
              <X style={{ width: 13, height: 13 }} />
            </button>
          </div>

          {/* Nav */}
          <div style={{ padding: '10px 10px 6px' }}>
            {nav.map((item, i) => {
              const active = isActive(item);
              const badge  = getBadge(item);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={`fm-link ${active ? 'fm-active' : ''}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 11,
                    padding: '10px 12px', borderRadius: 12, textDecoration: 'none',
                    color: active ? '#7dd3fc' : '#2e4a65',
                    fontWeight: active ? 700 : 500,
                    fontSize: 13.5,
                    position: 'relative',
                    marginBottom: 2,
                    background: active
                      ? 'linear-gradient(135deg, rgba(14,165,233,0.1), rgba(14,165,233,0.06))'
                      : 'transparent',
                    border: `1px solid ${active ? 'rgba(14,165,233,0.14)' : 'transparent'}`,
                    animation: `fm-item-in .2s ease ${i * 40}ms both`,
                  }}
                >
                  {active && (
                    <span style={{
                      position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                      width: 3, height: 18, borderRadius: '0 3px 3px 0',
                      background: 'linear-gradient(180deg, #38bdf8, #0ea5e9)',
                    }} />
                  )}
                  <span style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? 'rgba(14,165,233,0.14)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${active ? 'rgba(14,165,233,0.22)' : 'rgba(255,255,255,0.05)'}`,
                    position: 'relative',
                    boxShadow: active ? '0 0 12px rgba(14,165,233,0.12)' : 'none',
                  }}>
                    <item.icon style={{
                      width: 15, height: 15, strokeWidth: active ? 2.2 : 1.8,
                      color: active ? '#38bdf8' : '#2d4a65',
                    }} />
                    {badge > 0 && (
                      <span style={{
                        position: 'absolute', top: -5, right: -5,
                        minWidth: 16, height: 16, borderRadius: 8, padding: '0 3px',
                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                        border: '2px solid #060d18',
                        fontSize: 8, fontWeight: 900, color: '#fff',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
                      }}>{badge}</span>
                    )}
                  </span>
                  <span style={{ flex: 1 }}>{item.name}</span>
                  {badge > 0 && (
                    <span style={{
                      minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
                      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.25)',
                      color: '#f87171', fontSize: 10, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{badge}</span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'linear-gradient(90deg,transparent,rgba(14,165,233,0.1),transparent)', margin: '4px 14px' }} />

          {/* Role + utilities */}
          <div style={{ padding: '10px 10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 13,
              background: isDriver
                ? 'linear-gradient(135deg, rgba(26,71,200,0.08), rgba(14,165,233,0.04))'
                : 'linear-gradient(135deg, rgba(4,120,87,0.08), rgba(52,211,153,0.04))',
              border: `1px solid ${isDriver ? 'rgba(14,165,233,0.1)' : 'rgba(52,211,153,0.1)'}`,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                background: isDriver ? 'linear-gradient(135deg,#1245b0,#2f8fe0)' : 'linear-gradient(135deg,#047857,#34d399)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: isDriver ? '0 3px 12px rgba(26,71,200,0.4)' : '0 3px 12px rgba(4,120,87,0.4)',
              }}>
                {isDriver
                  ? <Truck style={{ width: 13, height: 13, color: '#fff' }} />
                  : <User  style={{ width: 13, height: 13, color: '#fff' }} />}
              </div>
              <div>
                <div style={{ fontSize: 9.5, color: isDriver ? 'rgba(14,165,233,0.4)' : 'rgba(52,211,153,0.4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Текущая роль
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#9cc8e8', marginTop: 2, lineHeight: 1 }}>
                  {isDriver ? 'Водитель' : 'Отправитель'}
                </div>
              </div>
              <span style={{
                marginLeft: 'auto',
                width: 8, height: 8, borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 0 3px rgba(34,197,94,0.15), 0 0 8px rgba(34,197,94,0.5)',
              }} />
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { icon: Bell,     href: '/notifications', label: 'Уведомления' },
                { icon: Settings, href: '/settings',      label: 'Настройки' },
              ].map(({ icon: Icon, href, label }) => (
                <Link
                  key={href} to={href}
                  onClick={() => setMenuOpen(false)}
                  title={label}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '11px 8px', borderRadius: 12, textDecoration: 'none',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                    color: '#1e3a55',
                    transition: 'background .15s, color .15s, border-color .15s',
                  }}
                >
                  <Icon style={{ width: 14, height: 14 }} />
                  <span style={{ fontSize: 9.5, fontWeight: 600 }}>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Toggle / Drag Button ── */}
      <button
        aria-label={menuOpen ? 'Закрыть меню навигации' : 'Открыть меню навигации'}
        aria-expanded={menuOpen}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onClick={handleClick}
        style={{
          width: 50, height: 50, borderRadius: 17,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: isDragging ? 'grabbing' : 'grab',
          background: menuOpen
            ? 'linear-gradient(135deg, #1245b0 0%, #2f8fe0 100%)'
            : 'linear-gradient(180deg, #0b1a2e 0%, #07111f 100%)',
          border: `1.5px solid ${menuOpen ? 'rgba(47,143,224,0.35)' : isDragging ? 'rgba(26,71,200,0.3)' : 'rgba(14,165,233,0.08)'}`,
          boxShadow: isDragging
            ? '0 10px 36px rgba(0,0,0,0.7), 0 0 0 3px rgba(26,71,200,0.2)'
            : menuOpen
              ? '0 0 0 4px rgba(14,165,233,0.12), 0 8px 32px rgba(26,71,200,0.5)'
              : '0 4px 28px rgba(0,0,0,0.7), 0 0 0 1px rgba(14,165,233,0.06)',
          transition: isDragging ? 'none' : 'background 0.25s, box-shadow 0.25s, border-color 0.25s',
          userSelect: 'none',
        }}
      >
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: menuOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          pointerEvents: 'none',
        }}>
          {menuOpen
            ? <X          style={{ width: 18, height: 18, color: '#fff' }} />
            : <LayoutGrid style={{ width: 18, height: 18, color: isDragging ? '#5ba3f5' : '#1e4a6a' }} />}
        </span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROOT LAYOUT
// ─────────────────────────────────────────────────────────────────────────────
export function MobileLayout() {
  const location  = useLocation();
  const { theme: _theme } = useTheme();
  const { user }  = useUser();
  const userRole  = user?.role || sessionStorage.getItem('userRole') || 'sender';
  const userEmail = user?.email || sessionStorage.getItem('ovora_user_email') || '';

  const [chatUnread,    setChatUnread]    = useState(0);
  const [pendingOffers, setPendingOffers] = useState(0);
  const [menuOpen,      setMenuOpen]      = useState(false);

  /* ── Chat badge ── */
  const refreshChat = useCallback(() => {
    setChatUnread(getChats().reduce((acc, c) => acc + (c.unread || 0), 0));
  }, []);
  useEffect(() => {
    refreshChat();
    window.addEventListener('ovora_chat_update', refreshChat);
    return () => window.removeEventListener('ovora_chat_update', refreshChat);
  }, [refreshChat]);
  usePolling(async () => refreshChat(), 6_000);

  /* ── Offers badge ── */
  const refreshOffers = useCallback(() => {
    try {
      if (userRole !== 'driver') { setPendingOffers(0); return; }
      const offers = JSON.parse(localStorage.getItem('ovora_offers') || '[]');
      const email  = sessionStorage.getItem('ovora_user_email') || '';
      setPendingOffers(offers.filter((o: any) => o.status === 'pending' && String(o.driverEmail) === email).length);
    } catch {}
  }, [userRole]);
  useEffect(() => {
    refreshOffers();
    const f = (e: Event) => setPendingOffers((e as CustomEvent).detail ?? 0);
    window.addEventListener('ovora_pending_offers', f);
    return () => window.removeEventListener('ovora_pending_offers', f);
  }, [refreshOffers]);
  usePolling(async () => refreshOffers(), 8_000);

  const nav = [...navigation];
  if (userRole === 'driver') nav.splice(1, 0, { name: 'Создать', href: '/create-trip', icon: Plus, badge: null });
  if (userRole === 'sender') nav.splice(1, 0, { name: 'Поиск', href: '/search', icon: Search, badge: null });

  const hideNav = location.pathname.startsWith('/chat/')
    || location.pathname.startsWith('/trip/')
    || location.pathname === '/radio'
    || location.pathname === '/tracking';

  const SIDEBAR_HIDDEN_PATHS = [
    '/home', '/dashboard', '/create-trip', '/trips', '/profile', '/profile/edit',
    '/settings', '/documents', '/messages', '/reviews', '/notifications',
    '/favorites', '/help', '/about', '/tracking', '/search-results', '/search',
    '/calculator', '/privacy-policy', '/terms-of-service', '/payments',
    '/borders', '/rest-stops', '/radio',
  ];

  const hideDesktopSidebar = hideNav || SIDEBAR_HIDDEN_PATHS.includes(location.pathname);
  const FLOATING_HIDDEN_PATHS = ['/search-results'];
  const showFloatingMenu = !hideNav && hideDesktopSidebar && !FLOATING_HIDDEN_PATHS.includes(location.pathname);

  const getBadge = (item: typeof nav[0]) =>
    item.href === '/messages' ? chatUnread : item.href === '/trips' ? pendingOffers : 0;

  const isActive = (item: typeof nav[0]) =>
    location.pathname === item.href ||
    (location.pathname === '/dashboard' && item.href === '/home') ||
    (item.href !== '/home' && location.pathname.startsWith(item.href));

  const sidebarWidth = !hideDesktopSidebar && !hideNav ? 'md:pl-[264px]' : '';

  return (
    <div
      className="flex overflow-hidden"
      style={{ background: '#060e1a', height: '100dvh' }}
    >
      {/* Desktop Sidebar */}
      {!hideDesktopSidebar && (
        <DesktopSidebar nav={nav} isActive={isActive} getBadge={getBadge} userRole={userRole} />
      )}

      {/* Desktop Floating Menu */}
      {showFloatingMenu && (
        <FloatingMenu
          nav={nav} isActive={isActive} getBadge={getBadge} userRole={userRole}
          menuOpen={menuOpen} setMenuOpen={setMenuOpen}
        />
      )}

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${sidebarWidth}`}>
        <OfflineBanner />
        {userEmail && <PushPermissionBanner userEmail={userEmail} />}
        {userEmail && <SubscriptionBanner userEmail={userEmail} />}

        <main
          className={`flex-1 overflow-y-auto ${hideNav ? 'pb-0' : 'pb-24 md:pb-0'}`}
          style={{ background: '#060e1a', WebkitOverflowScrolling: 'touch' }}
        >
          <Outlet />
        </main>

        {/* ══ Mobile Bottom Nav ══ */}
        {!hideNav && (
          <div
            className="md:hidden fixed bottom-0 left-0 right-0 z-50"
            style={{
              paddingBottom: 'env(safe-area-inset-bottom)',
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            {/* Glass nav bar */}
            <nav
              style={{
                display: 'flex',
                alignItems: 'stretch',
                background: 'rgba(6,14,26,0.85)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                borderRadius: 24,
                border: '1px solid rgba(14,165,233,0.1)',
                boxShadow:
                  '0 -2px 0 rgba(14,165,233,0.04), 0 8px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)',
                margin: '0 0 10px',
                padding: '6px 4px',
                gap: 2,
              }}
            >
              {nav.map(item => {
                const active     = isActive(item);
                const badgeCount = getBadge(item);
                const compact    = nav.length > 4;

                return (
                  <Link
                    key={item.name}
                    to={item.href}
                    className="relative flex flex-col items-center justify-center flex-1"
                    style={{
                      gap: compact ? 3 : 4,
                      paddingTop: compact ? 7 : 9,
                      paddingBottom: compact ? 5 : 7,
                      borderRadius: 18,
                      textDecoration: 'none',
                      position: 'relative',
                      overflow: 'hidden',
                      minHeight: 52,
                    }}
                  >
                    {/* Active background pill */}
                    {active && (
                      <span
                        style={{
                          position: 'absolute', inset: 0, borderRadius: 18,
                          background: 'linear-gradient(145deg, rgba(14,165,233,0.12) 0%, rgba(56,189,248,0.06) 100%)',
                          border: '1px solid rgba(14,165,233,0.14)',
                        }}
                      />
                    )}

                    {/* Badge dot */}
                    {badgeCount > 0 && (
                      <span
                        style={{
                          position: 'absolute',
                          top: compact ? 5 : 7,
                          right: compact ? 'calc(50% - 14px)' : 'calc(50% - 18px)',
                          width: 8, height: 8, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                          border: '1.5px solid rgba(6,14,26,0.9)',
                          boxShadow: '0 0 6px rgba(239,68,68,0.6)',
                          zIndex: 2,
                        }}
                      />
                    )}

                    {/* Icon */}
                    <div
                      style={{
                        width: compact ? 30 : 36,
                        height: compact ? 22 : 26,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        position: 'relative', zIndex: 1,
                      }}
                    >
                      <item.icon
                        style={{
                          width:  compact ? 15 : 17,
                          height: compact ? 15 : 17,
                          color:  active ? '#38bdf8' : '#304a65',
                          strokeWidth: active ? 2.4 : 1.7,
                          filter: active ? 'drop-shadow(0 0 6px rgba(56,189,248,0.4))' : 'none',
                          transition: 'color 0.2s ease, filter 0.2s ease, stroke-width 0.2s ease',
                        }}
                      />
                    </div>

                    {/* Label */}
                    <span
                      style={{
                        fontSize: compact ? 8.5 : 9.5,
                        color: active ? '#38bdf8' : '#2a4060',
                        fontWeight: active ? 700 : 500,
                        letterSpacing: active ? '-0.1px' : 0,
                        lineHeight: 1,
                        transition: 'color 0.2s ease',
                        position: 'relative', zIndex: 1,
                      }}
                    >
                      {item.name}
                    </span>

                    {/* Active bottom indicator line */}
                    {active && (
                      <span
                        className="nav-dot-in"
                        style={{
                          position: 'absolute', bottom: 4, left: '50%',
                          transform: 'translateX(-50%)',
                          width: 20, height: 2.5, borderRadius: 2,
                          background: 'linear-gradient(90deg, #38bdf8, #0ea5e9)',
                          boxShadow: '0 0 8px rgba(56,189,248,0.5)',
                        }}
                      />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    </div>
  );
}

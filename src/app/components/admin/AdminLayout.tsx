import React, { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import {
  LayoutDashboard, Users, Car, Package, FileCheck, BarChart3,
  MessageSquare, Bell, ClipboardList as RequestIcon, Star,
  Truck, ClipboardList, Megaphone,
  Crown, Globe, Boxes, Plane, History, ShieldOff,
  KeyRound, SlidersHorizontal, MessageCircle,
} from 'lucide-react';
import { YandexMetrikaTracker } from '../YandexMetrika';
import { getAdminStats, searchAdmin, revokeAllAdminSessions } from '../../api/dataApi';
import { usePolling } from '../../hooks/usePolling';
import { AdminAuthGate } from './AdminAuthGate';
import { GROUP_PLATFORM } from './platformTheme';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { AdminIdleWarning } from './AdminIdleWarning';

const PIN_SESSION_KEY = 'ovora_admin_auth';

// ── Авто-logout по неактивности ──────────────────────────────────────────────
// JWT-сессия живёт 8ч (ADMIN_JWT_SECRET, см. CLAUDE.md), но без идле-таймера
// открытая вкладка с правами админа остаётся залогиненной все 8ч независимо от
// активности — отдельный, более короткий таймер неактивности снижает это окно.
const IDLE_LOGOUT_MS = 25 * 60 * 1000; // 25 мин без активности → авто-выход
const IDLE_WARNING_MS = 2 * 60 * 1000; // предупреждение за 2 мин до выхода

function clearAdminSession() {
  sessionStorage.removeItem(PIN_SESSION_KEY);
  sessionStorage.removeItem('ovora_admin_token');
  sessionStorage.removeItem('ovora_admin_jwt');
  sessionStorage.removeItem('ovora_admin_role');
}

const navGroups = [
  {
    label: 'Главная',
    items: [
      { name: 'Обзор', href: '/admin', icon: LayoutDashboard, exact: true },
      { name: 'Уведомления', href: '/admin/notifications', icon: Bell },
    ],
  },
  {
    label: 'CARGO',
    items: [
      { name: 'Водители', href: '/admin/cargo/drivers', icon: Car },
      { name: 'Пользователи', href: '/admin/cargo/users', icon: Users },
      { name: 'Поездки', href: '/admin/cargo/trips', icon: Package },
      { name: 'Грузы', href: '/admin/cargo/cargos', icon: Boxes },
      { name: 'Оферты', href: '/admin/cargo/offers', icon: ClipboardList },
      { name: 'Верификация', href: '/admin/cargo/verification', icon: FileCheck },
      { name: 'Отзывы', href: '/admin/cargo/reviews', icon: MessageSquare },
      { name: 'Чаты', href: '/admin/cargo/chats', icon: MessageCircle },
      { name: 'Аналитика', href: '/admin/cargo/analytics', icon: BarChart3 },
      { name: 'Подписки', href: '/admin/cargo/subscriptions', icon: Crown },
      { name: 'Настройки CARGO', href: '/admin/cargo/settings', icon: SlidersHorizontal },
      { name: 'Аудит CARGO', href: '/admin/cargo/audit', icon: History },
    ],
  },
  {
    label: 'AVIA',
    items: [
      { name: 'AVIA Пользователи', href: '/admin/avia/users', icon: Plane },
      { name: 'AVIA Карточки', href: '/admin/avia/cards', icon: Boxes },
      { name: 'AVIA Аналитика', href: '/admin/avia/analytics', icon: BarChart3 },
      { name: 'AVIA Настройки', href: '/admin/avia/settings', icon: SlidersHorizontal },
      { name: 'AVIA Чёрный список', href: '/admin/avia/blacklist', icon: ShieldOff },
      { name: 'AVIA Аудит', href: '/admin/avia/audit', icon: History },
    ],
  },
  {
    label: 'Общее',
    items: [
      { name: 'Реклама', href: '/admin/ads', icon: Megaphone },
      { name: 'Чёрный список', href: '/admin/blacklist', icon: ShieldOff },
      { name: 'Коды доступа', href: '/admin/codes', icon: KeyRound },
      { name: 'Настройки сайта', href: '/admin/site', icon: Globe },
    ],
  },
];

// Flatten for breadcrumb lookups
const allNavItems = navGroups.flatMap(g => g.items);

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [authed, setAuthed] = useState(() =>
    sessionStorage.getItem(PIN_SESSION_KEY) === 'true' &&
    (!!sessionStorage.getItem('ovora_admin_token') || !!sessionStorage.getItem('ovora_admin_jwt'))
  );
  const [idleWarningSecs, setIdleWarningSecs] = useState<number | null>(null);
  const adminRole = (sessionStorage.getItem('ovora_admin_role') || 'super-admin') as 'super-admin' | 'cargo-admin' | 'avia-admin';
  // Три роли — три непересекающихся набора разделов:
  //   super-admin (директор) — всё, включая «Общее» (реклама, чёрный список,
  //     коды доступа, настройки сайта) — это настройки всей платформы;
  //   cargo-admin — только своя площадка;
  //   avia-admin  — только своя площадка.
  // Раньше cargo-admin видел ещё и «Общее», из-за чего сотрудник CARGO мог
  // менять общеплатформенные настройки, а роли были несимметричны.
  const visibleNavGroups = navGroups.filter(group => {
    if (adminRole === 'super-admin') return true;
    if (adminRole === 'cargo-admin') return group.label === 'Главная' || group.label === 'CARGO';
    if (adminRole === 'avia-admin')  return group.label === 'Главная' || group.label === 'AVIA';
    return true;
  });

  usePolling(async () => {
    const s = await getAdminStats();
    setStats(s);
  }, 30_000, authed);

  // Закрытие панели уведомлений по клику снаружи
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  // Поиск по сущностям (находит конкретного пользователя/поездку/оферту/груз/отзыв
  // по email/телефону/имени/ID), а не просто роутинг по ключевым словам раздела.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults(null);
      setSearchOpen(false);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const res = await searchAdmin(q);
        setSearchResults(res);
        setSearchOpen(true);
      } catch {
        setSearchResults(null);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // Закрытие выпадающего списка результатов поиска по клику снаружи
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  // Авто-logout по неактивности — отдельно от 8ч TTL самого JWT. Любая активность
  // (клик, клавиатура, тач, скролл) перезапускает таймер и убирает предупреждение.
  // resetIdleRef даёт кнопке «Остаться в системе» прямой вызов arm() без необходимости
  // полагаться на то, что её клик случайно забублится до window-листенера ниже.
  const resetIdleRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!authed) return;
    let warnTimer: ReturnType<typeof setTimeout>;
    let logoutTimer: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;

    const clearAll = () => {
      clearTimeout(warnTimer);
      clearTimeout(logoutTimer);
      clearInterval(countdownInterval);
    };

    const arm = () => {
      clearAll();
      setIdleWarningSecs(null);
      warnTimer = setTimeout(() => {
        let secsLeft = Math.floor(IDLE_WARNING_MS / 1000);
        setIdleWarningSecs(secsLeft);
        countdownInterval = setInterval(() => {
          secsLeft -= 1;
          setIdleWarningSecs(secsLeft);
          if (secsLeft <= 0) clearInterval(countdownInterval);
        }, 1000);
        logoutTimer = setTimeout(() => {
          clearAll();
          clearAdminSession();
          window.location.reload();
        }, IDLE_WARNING_MS);
      }, IDLE_LOGOUT_MS - IDLE_WARNING_MS);
    };

    resetIdleRef.current = arm;
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(ev => window.addEventListener(ev, arm, { passive: true }));
    arm();

    return () => {
      clearAll();
      events.forEach(ev => window.removeEventListener(ev, arm));
    };
  }, [authed]);

  if (!authed) {
    return <AdminAuthGate onSuccess={() => setAuthed(true)} />;
  }

  // Каждый пункт несёт href целевого раздела + q/expand для него: q подставляется
  // в его собственный локальный фильтр (гарантированно совпадающее поле), expand —
  // в его expandedId, чтобы сразу раскрыть найденную карточку.
  const searchHits = searchResults ? [
    ...(searchResults.users || []).map((u: any) => ({
      key: `user-${u.email}`,
      icon: u.role === 'driver' ? Car : Users,
      label: u.name || u.email,
      sublabel: u.role === 'driver' ? (u.phone || u.email) : u.email,
      href: u.role === 'driver' ? '/admin/cargo/drivers' : '/admin/cargo/users',
      q: u.email,
      expand: u.email,
    })),
    ...(searchResults.trips || []).map((t: any) => ({
      key: `trip-${t.id}`,
      icon: Truck,
      label: `${t.from} → ${t.to}`,
      sublabel: t.driverName,
      href: '/admin/cargo/trips',
      q: t.driverName,
      expand: t.id,
    })),
    ...(searchResults.offers || []).map((o: any) => ({
      key: `offer-${o.offerId}`,
      icon: RequestIcon,
      label: `${o.senderName} ↔ ${o.driverName}`,
      sublabel: o.tripId,
      href: '/admin/cargo/offers',
      q: o.tripId,
      expand: o.offerId,
    })),
    ...(searchResults.cargos || []).map((cg: any) => ({
      key: `cargo-${cg.id}`,
      icon: Boxes,
      label: `${cg.from} → ${cg.to}`,
      sublabel: cg.senderName,
      href: '/admin/cargo/cargos',
      q: cg.senderName,
      expand: cg.id,
    })),
    ...(searchResults.reviews || []).map((r: any) => ({
      key: `review-${r.reviewId}`,
      icon: Star,
      label: r.authorName,
      sublabel: r.targetName,
      href: '/admin/cargo/reviews',
      q: r.authorName,
      expand: r.reviewId,
    })),
  ] : [];

  const goToHit = (hit: { href: string; q: string; expand: string }) => {
    setSearchOpen(false);
    setSearchQuery('');
    navigate(`${hit.href}?q=${encodeURIComponent(hit.q)}&expand=${encodeURIComponent(hit.expand)}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchHits[0]) goToHit(searchHits[0]);
  };

  const isActive = (item: { href: string; exact?: boolean }) => {
    if (item.exact) return location.pathname === item.href;
    return location.pathname.startsWith(item.href);
  };

  const currentPage = allNavItems.find(n => isActive(n));
  const currentGroup = navGroups.find(g => g.items.some(n => isActive(n)));
  const currentPlatform = currentGroup ? GROUP_PLATFORM[currentGroup.label] : undefined;
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const notifItems = [
    ...(stats?.pendingOffers > 0 ? [{
      href: '/admin/cargo/offers',
      label: `${stats.pendingOffers} новых заявок`,
      icon: RequestIcon,
      bg: '#eff6ff',
      color: '#2563eb',
    }] : []),
    ...(stats?.recentReviews > 0 ? [{
      href: '/admin/cargo/reviews',
      label: `${stats.recentReviews} новых отзывов`,
      icon: Star,
      bg: '#fffbeb',
      color: '#d97706',
    }] : []),
  ];
  const notifTotal = (stats?.pendingOffers || 0) + (stats?.recentReviews || 0);

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      <YandexMetrikaTracker />

      <AdminIdleWarning secs={idleWarningSecs} onStay={() => resetIdleRef.current()} />

      <AdminSidebar
        navGroups={visibleNavGroups}
        isActive={isActive}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        adminRole={adminRole}
        onRevokeAll={async () => {
          if (!window.confirm('Отозвать все выданные admin-токены? Все админы (включая вас) будут разлогинены немедленно.')) return;
          try {
            await revokeAllAdminSessions();
          } catch (err) {
            console.error('[AdminLayout] revoke-all failed:', err);
          }
          clearAdminSession();
          window.location.reload();
        }}
        onLogout={() => {
          clearAdminSession();
          window.location.reload();
        }}
      />

      {/* ── Main content ── */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <AdminHeader
          onMenuClick={() => setSidebarOpen(true)}
          currentPageName={currentPage?.name || 'Обзор'}
          currentPlatform={currentPlatform}
          searchRef={searchRef}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchOpen={searchOpen}
          setSearchOpen={setSearchOpen}
          searchResults={searchResults}
          searchHits={searchHits}
          onSearchSubmit={handleSearch}
          onGoToHit={goToHit}
          today={today}
          stats={stats}
          notifRef={notifRef}
          notifOpen={notifOpen}
          setNotifOpen={setNotifOpen}
          notifItems={notifItems}
          notifTotal={notifTotal}
          onNotifNavigate={navigate}
        />

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6" style={{ background: '#f1f5f9' }}>
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="px-6 py-3 flex-shrink-0" style={{ borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Ovora Cargo Admin • v2.0</p>
            <p className="text-xs text-gray-400">Все данные из Supabase KV Store</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
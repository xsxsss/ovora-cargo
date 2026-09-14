import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import {
  Users, Car, Package, CheckCircle, RefreshCw, Loader2, Route,
  Star, Activity, Download, ArrowRight, Clock, TrendingUp,
  AlertCircle, Zap, Plane, Send, Handshake, ShieldOff, Boxes,
} from 'lucide-react';
import { DonutChart } from '../ui/DonutChart';
import { SimpleBarChart } from '../ui/SimpleBarChart';
import { getAdminTrips, getAdminUsers, getAdminOffers, getAdminReviews } from '../../api/dataApi';
import { getAviaAdminUsers, getAviaAdminDeals, getAviaAdminFlights } from '../../api/aviaAdminApi';
import { PLATFORM_THEME } from './platformTheme';
import { isLiveTrip, offerStatusBreakdown, TRIP_STATUS_META, tripStatusBreakdown, tripStatusKey } from './tripStatus';
import { toast } from 'sonner';
import { exportCsv } from '../../utils/adminCsvExport';

type AdminPlatform = 'cargo' | 'avia';

function RelTime({ iso }: { iso: string }) {
  if (!iso) return <span className="text-gray-400">—</span>;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return <span className="text-emerald-600 font-medium">только что</span>;
  if (mins < 60) return <span>{mins} мин. назад</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span>{hrs} ч. назад</span>;
  return <span>{Math.floor(hrs / 24)} дн. назад</span>;
}


type AdminRole = 'super-admin' | 'cargo-admin' | 'avia-admin';

export function AdminDashboard() {
  const adminRole = ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ovora_admin_role')) || 'super-admin') as AdminRole;
  // cargo-admin/avia-admin видят только свою платформу — их JWT не проходит
  // requireRole на эндпоинтах другой платформы (см. CLAUDE.md RBAC).
  const availablePlatforms: AdminPlatform[] =
    adminRole === 'cargo-admin' ? ['cargo'] :
    adminRole === 'avia-admin'  ? ['avia']  :
    ['cargo', 'avia'];
  const [platform, setPlatform] = useState<AdminPlatform>(availablePlatforms[0]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{
    trips: number; drivers: number; users: number; senders: number;
    offers: number; reviews: number; acceptedOffers: number;
    pendingOffers: number; activeTrips: number;
  } | null>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [aviaLoading, setAviaLoading] = useState(false);
  const [aviaLoaded, setAviaLoaded] = useState(false);
  const [aviaUsers, setAviaUsers] = useState<any[]>([]);
  const [aviaDeals, setAviaDeals] = useState<any[]>([]);
  const [aviaFlights, setAviaFlights] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [tripsData, usersData, offersData, reviewsData] = await Promise.all([
        getAdminTrips(), getAdminUsers(), getAdminOffers(), getAdminReviews(),
      ]);
      const t = tripsData || [];
      const u = usersData || [];
      const o = offersData || [];
      setTrips(t); setUsers(u); setOffers(o);
      const validTrips = t.filter((x: any) => x && !x.deletedAt);
      setStats({
        trips: validTrips.length,
        drivers: u.filter((x: any) => x?.role === 'driver').length,
        users: u.length,
        senders: u.filter((x: any) => x?.role === 'sender').length,
        offers: o.length,
        reviews: (reviewsData || []).length,
        acceptedOffers: o.filter((x: any) => x?.status === 'accepted').length,
        pendingOffers: o.filter((x: any) => x?.status === 'pending').length,
        activeTrips: validTrips.filter((x: any) => isLiveTrip(x)).length,
      });
      setLastUpdated(new Date());
    } catch (err) {
      toast.error('Ошибка загрузки данных: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  const loadAvia = async () => {
    setAviaLoading(true);
    try {
      const [usersData, dealsData, flightsData] = await Promise.all([
        getAviaAdminUsers(), getAviaAdminDeals(), getAviaAdminFlights(),
      ]);
      setAviaUsers(usersData || []);
      setAviaDeals(dealsData || []);
      setAviaFlights(flightsData || []);
      setAviaLoaded(true);
    } catch (err) {
      toast.error('Ошибка загрузки данных AVIA: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAviaLoading(false);
    }
  };

  useEffect(() => { if (availablePlatforms.includes('cargo')) load(); else setLoading(false); }, []);

  useEffect(() => {
    if (platform === 'avia' && !aviaLoaded) loadAvia();
  }, [platform, aviaLoaded]);

  // ── Chart data (memoized — пересчёт только при изменении исходных данных) ──
  const { tripStatusData, offerStatusData, userRoleData, activityBarData, recentTrips, topDrivers } = useMemo(() => {
    const dayLabels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const dayActivity: Record<string, number> = {};
    trips.filter(t => t?.createdAt && new Date(t.createdAt).getTime() > weekAgo).forEach(t => {
      const d = dayLabels[new Date(t.createdAt).getDay()];
      dayActivity[d] = (dayActivity[d] || 0) + 1;
    });
    const driverMap: Record<string, { name: string; trips: number; email: string }> = {};
    trips.forEach(t => {
      if (!t?.driverEmail) return;
      if (!driverMap[t.driverEmail]) driverMap[t.driverEmail] = { name: t.driverName || t.driverEmail, trips: 0, email: t.driverEmail };
      driverMap[t.driverEmail].trips++;
    });
    return {
      tripStatusData: tripStatusBreakdown(trips),
      offerStatusData: offerStatusBreakdown(offers),
      userRoleData: [
        { name: 'Водители',    value: users.filter(u => u?.role === 'driver').length, color: '#3b82f6' },
        { name: 'Отправители', value: users.filter(u => u?.role === 'sender').length, color: '#8b5cf6' },
      ].filter(d => d.value > 0),
      activityBarData: dayLabels.map(d => ({ label: d, value: dayActivity[d] || 0 })),
      recentTrips: [...trips].filter(t => t && !t.deletedAt).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8),
      topDrivers: Object.values(driverMap).sort((a, b) => b.trips - a.trips).slice(0, 5),
    };
  }, [trips, offers, users]);

  // ── AVIA chart data ──────────────────────────────────────────────────────
  const { aviaCouriers, aviaSenders, aviaBlocked, aviaActiveDeals, aviaCompletedDeals, aviaDealStatusData, aviaRoleData, recentDeals, topCouriers } = useMemo(() => {
    const courierMap: Record<string, { name: string; flights: number }> = {};
    aviaFlights.forEach(f => {
      if (!f?.courierId) return;
      if (!courierMap[f.courierId]) courierMap[f.courierId] = { name: f.courierId, flights: 0 };
      courierMap[f.courierId].flights++;
    });
    const aviaCouriers = aviaUsers.filter(u => u?.role === 'courier').length;
    const aviaSenders = aviaUsers.filter(u => u?.role === 'sender').length;
    return {
      aviaCouriers,
      aviaSenders,
      aviaBlocked: aviaUsers.filter(u => u?.blocked).length,
      aviaActiveDeals: aviaDeals.filter(d => d?.status === 'pending' || d?.status === 'active').length,
      aviaCompletedDeals: aviaDeals.filter(d => d?.status === 'completed').length,
      aviaDealStatusData: Object.entries(
        aviaDeals.reduce((acc: Record<string, number>, d) => {
          const key = d?.status || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).map(([name, value], i) => ({ name, value, color: ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'][i % 5] })).filter(d => d.value > 0),
      aviaRoleData: [
        { name: 'Курьеры',      value: aviaCouriers, color: '#0ea5e9' },
        { name: 'Отправители',  value: aviaSenders,  color: '#38bdf8' },
      ].filter(d => d.value > 0),
      recentDeals: [...aviaDeals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8),
      topCouriers: Object.values(courierMap).sort((a, b) => b.flights - a.flights).slice(0, 5),
    };
  }, [aviaDeals, aviaUsers, aviaFlights]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-72 gap-3">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: '#eff6ff' }}>
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
      <p className="text-gray-500 text-sm font-medium">Загрузка данных из базы...</p>
    </div>
  );

  const statCards = [
    {
      title: 'Всего поездок', value: stats?.trips ?? 0, icon: Route,
      gradient: 'linear-gradient(135deg,#1565d8,#2385f4)',
      sub: `${stats?.activeTrips ?? 0} активных`,
      to: '/admin/cargo/trips', badge: stats?.activeTrips,
    },
    {
      title: 'Водители', value: stats?.drivers ?? 0, icon: Car,
      gradient: 'linear-gradient(135deg,#059669,#10b981)',
      sub: `${stats?.senders ?? 0} отправителей`,
      to: '/admin/cargo/drivers',
    },
    {
      title: 'Пользователей', value: stats?.users ?? 0, icon: Users,
      gradient: 'linear-gradient(135deg,#7c3aed,#8b5cf6)',
      sub: 'Всего в системе',
      to: '/admin/cargo/users',
    },
    {
      title: 'Оферт', value: stats?.offers ?? 0, icon: Package,
      gradient: 'linear-gradient(135deg,#d97706,#f59e0b)',
      sub: `${stats?.pendingOffers ?? 0} ожидают`,
      to: '/admin/cargo/offers', badge: stats?.pendingOffers,
    },
    {
      title: 'Принято', value: stats?.acceptedOffers ?? 0, icon: CheckCircle,
      gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)',
      sub: 'Завершённых сделок',
      to: '/admin/cargo/offers',
    },
    {
      title: 'Отзывов', value: stats?.reviews ?? 0, icon: Star,
      gradient: 'linear-gradient(135deg,#db2777,#ec4899)',
      sub: 'В системе',
      to: '/admin/cargo/reviews',
    },
  ];

  const convRate = offers.length > 0
    ? ((offers.filter(o => o?.status === 'accepted').length / offers.length) * 100).toFixed(0)
    : '0';

  return (
    <div className="space-y-6">

      {/* ── Welcome banner ── */}
      <div
        className="rounded-2xl px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        style={{
          background: 'linear-gradient(135deg, #1565d8 0%, #2385f4 60%, #3b9ef8 100%)',
          boxShadow: '0 8px 32px #1565d840',
        }}
      >
        <div>
          <h1 className="text-xl font-bold text-white">Панель управления</h1>
          <p className="text-sm mt-0.5" style={{ color: '#bfdbfe' }}>
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {lastUpdated && (
              <span className="ml-2 opacity-75">
                • обновлено в {lastUpdated.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Conversion rate pill */}
          <div className="px-3 py-2 rounded-xl flex items-center gap-2" style={{ background: '#ffffff20' }}>
            <TrendingUp className="w-4 h-4 text-white" />
            <span className="text-sm text-white font-semibold">Конверсия: {convRate}%</span>
          </div>
          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setExportOpen(v => !v)}
              onBlur={() => setTimeout(() => setExportOpen(false), 180)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all"
              style={{ background: '#ffffff25', color: '#ffffff' }}
            >
              <Download className="w-4 h-4" />
              Экспорт CSV
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-2 w-44 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                {[
                  {
                    label: 'Поездки', icon: Route, color: 'text-blue-500',
                    onClick: () => exportCsv(
                      trips.map(t => ({ id: t.id, from: t.from, to: t.to, date: t.date, status: t.status, driver: t.driverName || t.driverEmail, price: t.pricePerSeat || t.pricePerKg, created: t.createdAt })),
                      `ovora_trips_${new Date().toISOString().slice(0, 10)}.csv`
                    ),
                  },
                  {
                    label: 'Пользователи', icon: Users, color: 'text-purple-500',
                    onClick: () => exportCsv(
                      users.map(u => ({ email: u.email, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role, phone: u.phone, city: u.city, created: u.createdAt })),
                      `ovora_users_${new Date().toISOString().slice(0, 10)}.csv`
                    ),
                  },
                  {
                    label: 'Оферты', icon: Package, color: 'text-orange-500',
                    onClick: () => exportCsv(
                      offers.map(o => ({ offerId: o.offerId, tripId: o.tripId, senderEmail: o.senderEmail, driverEmail: o.driverEmail, status: o.status, price: o.price, weight: o.weight, created: o.createdAt })),
                      `ovora_offers_${new Date().toISOString().slice(0, 10)}.csv`
                    ),
                  },
                ].map(item => (
                  <button key={item.label} onClick={item.onClick}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 border-b border-gray-100 last:border-0"
                  >
                    <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => (platform === 'cargo' ? load() : loadAvia())}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all"
            style={{ background: '#ffffff25', color: '#ffffff' }}
          >
            <RefreshCw className="w-4 h-4" />
            Обновить
          </button>
        </div>
      </div>

      {/* ── Platform tabs ── */}
      {availablePlatforms.length > 1 && (
      <div className="flex items-center gap-2 bg-white rounded-2xl p-1.5 w-fit" style={{ border: '1px solid #f0f4f8' }}>
        {availablePlatforms.map(p => {
          const theme = PLATFORM_THEME[p];
          const active = platform === p;
          return (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={active ? { background: theme.gradient, color: '#ffffff' } : { color: '#64748b' }}
            >
              {p === 'cargo' ? <Boxes className="w-4 h-4" /> : <Plane className="w-4 h-4" />}
              {theme.label}
            </button>
          );
        })}
      </div>
      )}

      {platform === 'cargo' && (
      <>
      {/* ── Pending alert ── */}
      {(stats?.pendingOffers ?? 0) > 0 && (
        <Link to="/admin/cargo/offers" className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all hover:shadow-md" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800 font-medium flex-1">
            Есть <strong>{stats?.pendingOffers}</strong> оферт, ожидающих рассмотрения
          </p>
          <ArrowRight className="w-4 h-4 text-amber-600 flex-shrink-0" />
        </Link>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {statCards.map(card => (
          <Link key={card.title} to={card.to} className="group">
            <div
              className="rounded-2xl p-3 sm:p-4 transition-all hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden"
              style={{ background: '#ffffff', border: '1px solid #f0f4f8' }}
            >
              {/* Icon */}
              <div
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mb-3 relative"
                style={{ background: card.gradient }}
              >
                <card.icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                {card.badge != null && card.badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold">
                    {card.badge > 9 ? '9+' : card.badge}
                  </span>
                )}
              </div>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-xs font-semibold text-gray-700 mt-0.5">{card.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
              {/* Hover arrow */}
              <ArrowRight className="absolute bottom-3 right-3 w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* ── Charts row 1 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity bar chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#eff6ff' }}>
                <Activity className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm">Активность за 7 дней</p>
                <p className="text-xs text-gray-500">Количество новых поездок</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-gray-600">
                Итого: {activityBarData.reduce((s, d) => s + d.value, 0)}
              </span>
            </div>
          </div>
          {activityBarData.some(d => d.value > 0) ? (
            <div className="w-full overflow-x-auto">
              <SimpleBarChart data={activityBarData} color="#3b82f6" height={200} />
            </div>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-gray-400">
              <Activity className="w-10 h-10 mb-2 text-gray-200" />
              <p className="text-sm">Нет данных за последние 7 дней</p>
            </div>
          )}
        </div>

        {/* Trip status donut */}
        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#eff6ff' }}>
              <Route className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Статус поездок</p>
              <p className="text-xs text-gray-500">Всего: {trips.filter(t => !t?.deletedAt).length}</p>
            </div>
          </div>
          {tripStatusData.length > 0 ? (
            <>
              <div className="flex justify-center">
                <DonutChart data={tripStatusData} innerRadius={45} outerRadius={70} size={160} />
              </div>
              <div className="space-y-2 mt-3">
                {tripStatusData.map(item => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-gray-600 text-xs">{item.name}</span>
                    </div>
                    <span className="font-bold text-gray-900 text-sm">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
          )}
        </div>
      </div>

      {/* ── Charts row 2 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Offers status */}
        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#fff7ed' }}>
              <Package className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Статус оферт</p>
              <p className="text-xs text-gray-500">Всего: {offers.length}</p>
            </div>
          </div>
          {offerStatusData.length > 0 ? (
            <>
              <div className="flex justify-center">
                <DonutChart data={offerStatusData} innerRadius={40} outerRadius={65} size={160} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {offerStatusData.map(item => (
                  <div key={item.name} className="text-center p-2 rounded-xl" style={{ background: item.color + '12' }}>
                    <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                    <p className="text-[11px] text-gray-500">{item.name}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
          )}
        </div>

        {/* Users by role */}
        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f5f3ff' }}>
              <Users className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Роли пользователей</p>
              <p className="text-xs text-gray-500">Всего: {users.length}</p>
            </div>
          </div>
          {userRoleData.length > 0 ? (
            <>
              <div className="flex justify-center">
                <DonutChart data={userRoleData} innerRadius={40} outerRadius={65} size={160} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {userRoleData.map(item => (
                  <div key={item.name} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: item.color + '12' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <div>
                      <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                      <p className="text-[11px] text-gray-600">{item.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
          )}
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent trips */}
        <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#eff6ff' }}>
                <Clock className="w-4 h-4 text-blue-600" />
              </div>
              <p className="font-semibold text-gray-900 text-sm">Последние поездки</p>
            </div>
            <Link to="/admin/cargo/trips" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Все поездки <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentTrips.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Route className="w-10 h-10 mb-2 mx-auto text-gray-200" />
              <p className="text-sm">Поездок пока нет</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTrips.map(trip => (
                <div key={trip.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: (TRIP_STATUS_META[tripStatusKey(trip)].color) + '20' }}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: TRIP_STATUS_META[tripStatusKey(trip)].color }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{trip.from} → {trip.to}</p>
                    <p className="text-xs text-gray-500 truncate">{trip.driverName || trip.driverEmail || '—'}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-gray-700">{trip.pricePerSeat || trip.pricePerKg || '—'} ТЖС</p>
                    <p className="text-xs text-gray-400"><RelTime iso={trip.createdAt} /></p>
                  </div>
                  <span
                    className="hidden sm:inline text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
                    style={{
                      background: (TRIP_STATUS_META[tripStatusKey(trip)].color) + '18',
                      color: TRIP_STATUS_META[tripStatusKey(trip)].color,
                    }}
                  >
                    {TRIP_STATUS_META[tripStatusKey(trip)].label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top drivers */}
        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f0fdf4' }}>
                <Car className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="font-semibold text-gray-900 text-sm">Топ водителей</p>
            </div>
            <Link to="/admin/cargo/drivers" className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Все <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {topDrivers.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Car className="w-10 h-10 mb-2 mx-auto text-gray-200" />
              <p className="text-sm">Нет данных</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topDrivers.map((d, i) => {
                const medals = ['#f59e0b', '#94a3b8', '#d97706'];
                return (
                  <div key={d.email} className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: medals[i] || '#3b82f6' }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{d.name}</p>
                      <div className="w-full rounded-full h-1.5 mt-1" style={{ background: '#f1f5f9' }}>
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (d.trips / (topDrivers[0]?.trips || 1)) * 100)}%`,
                            background: medals[i] || '#3b82f6',
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-700 flex-shrink-0">{d.trips}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </>
      )}

      {platform === 'avia' && (
      <>
      {aviaLoading && !aviaLoaded ? (
        <div className="flex flex-col items-center justify-center h-72 gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: '#f0f9ff' }}>
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: PLATFORM_THEME.avia.accent }} />
          </div>
          <p className="text-gray-500 text-sm font-medium">Загрузка данных AVIA...</p>
        </div>
      ) : (
      <>
      {/* ── AVIA stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {[
          { title: 'Курьеры', value: aviaCouriers, icon: Send, gradient: PLATFORM_THEME.avia.gradient, sub: `${aviaSenders} отправителей`, to: '/admin/avia/users' },
          { title: 'Пользователей AVIA', value: aviaUsers.length, icon: Users, gradient: 'linear-gradient(135deg,#7c3aed,#8b5cf6)', sub: 'Всего в системе', to: '/admin/avia/users' },
          { title: 'Рейсов', value: aviaFlights.length, icon: Plane, gradient: 'linear-gradient(135deg,#0891b2,#06b6d4)', sub: 'Опубликовано курьерами', to: '/admin/avia/cards' },
          { title: 'Сделок', value: aviaDeals.length, icon: Handshake, gradient: 'linear-gradient(135deg,#d97706,#f59e0b)', sub: `${aviaActiveDeals} активных`, to: '/admin/avia/cards', badge: aviaActiveDeals },
          { title: 'Заблокировано', value: aviaBlocked, icon: ShieldOff, gradient: 'linear-gradient(135deg,#dc2626,#ef4444)', sub: 'Пользователей AVIA', to: '/admin/avia/users' },
        ].map(card => (
          <Link key={card.title} to={card.to} className="group">
            <div
              className="rounded-2xl p-3 sm:p-4 transition-all hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden"
              style={{ background: '#ffffff', border: '1px solid #f0f4f8' }}
            >
              <div
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center mb-3 relative"
                style={{ background: card.gradient }}
              >
                <card.icon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                {card.badge != null && card.badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold">
                    {card.badge > 9 ? '9+' : card.badge}
                  </span>
                )}
              </div>
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{card.value}</p>
              <p className="text-xs font-semibold text-gray-700 mt-0.5">{card.title}</p>
              <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
              <ArrowRight className="absolute bottom-3 right-3 w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      {/* ── AVIA charts ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: PLATFORM_THEME.avia.bg }}>
              <Handshake className="w-4 h-4" style={{ color: PLATFORM_THEME.avia.accent }} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Статус сделок</p>
              <p className="text-xs text-gray-500">Всего: {aviaDeals.length}</p>
            </div>
          </div>
          {aviaDealStatusData.length > 0 ? (
            <>
              <div className="flex justify-center">
                <DonutChart data={aviaDealStatusData} innerRadius={40} outerRadius={65} size={160} />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                {aviaDealStatusData.map(item => (
                  <div key={item.name} className="text-center p-2 rounded-xl" style={{ background: item.color + '12' }}>
                    <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                    <p className="text-[11px] text-gray-500">{item.name}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#f5f3ff' }}>
              <Users className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">Роли пользователей AVIA</p>
              <p className="text-xs text-gray-500">Всего: {aviaUsers.length}</p>
            </div>
          </div>
          {aviaRoleData.length > 0 ? (
            <>
              <div className="flex justify-center">
                <DonutChart data={aviaRoleData} innerRadius={40} outerRadius={65} size={160} />
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                {aviaRoleData.map(item => (
                  <div key={item.name} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: item.color + '12' }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <div>
                      <p className="text-lg font-bold" style={{ color: item.color }}>{item.value}</p>
                      <p className="text-[11px] text-gray-600">{item.name}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
          )}
        </div>
      </div>

      {/* ── AVIA bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: PLATFORM_THEME.avia.bg }}>
                <Clock className="w-4 h-4" style={{ color: PLATFORM_THEME.avia.accent }} />
              </div>
              <p className="font-semibold text-gray-900 text-sm">Последние сделки</p>
            </div>
            <Link to="/admin/avia/cards" className="flex items-center gap-1 text-xs font-medium transition-colors" style={{ color: PLATFORM_THEME.avia.accent }}>
              Все сделки <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {recentDeals.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Handshake className="w-10 h-10 mb-2 mx-auto text-gray-200" />
              <p className="text-sm">Сделок пока нет</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentDeals.map(deal => (
                <div key={deal.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: PLATFORM_THEME.avia.bg }}>
                    <Handshake className="w-3.5 h-3.5" style={{ color: PLATFORM_THEME.avia.accent }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{deal.initiatorPhone} → {deal.recipientPhone}</p>
                    <p className="text-xs text-gray-500 truncate">{deal.dealType === 'docs' ? 'Документы' : `${deal.weightKg ?? '—'} кг`}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-bold text-gray-700">{deal.price ? `$${deal.price}` : '—'}</p>
                    <p className="text-xs text-gray-400"><RelTime iso={deal.createdAt} /></p>
                  </div>
                  <span
                    className="hidden sm:inline text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0"
                    style={{ background: PLATFORM_THEME.avia.bg, color: PLATFORM_THEME.avia.accent }}
                  >
                    {deal.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-5" style={{ border: '1px solid #f0f4f8' }}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: PLATFORM_THEME.avia.bg }}>
                <Plane className="w-4 h-4" style={{ color: PLATFORM_THEME.avia.accent }} />
              </div>
              <p className="font-semibold text-gray-900 text-sm">Топ курьеров</p>
            </div>
            <Link to="/admin/avia/users" className="flex items-center gap-1 text-xs font-medium transition-colors" style={{ color: PLATFORM_THEME.avia.accent }}>
              Все <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {topCouriers.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              <Plane className="w-10 h-10 mb-2 mx-auto text-gray-200" />
              <p className="text-sm">Нет данных</p>
            </div>
          ) : (
            <div className="space-y-3">
              {topCouriers.map((c, i) => {
                const medals = ['#f59e0b', '#94a3b8', '#d97706'];
                return (
                  <div key={c.name} className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: medals[i] || PLATFORM_THEME.avia.accent }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                      <div className="w-full rounded-full h-1.5 mt-1" style={{ background: '#f1f5f9' }}>
                        <div
                          className="h-1.5 rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (c.flights / (topCouriers[0]?.flights || 1)) * 100)}%`,
                            background: medals[i] || PLATFORM_THEME.avia.accent,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-gray-700 flex-shrink-0">{c.flights}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </>
      )}
      </>
      )}
    </div>
  );
}
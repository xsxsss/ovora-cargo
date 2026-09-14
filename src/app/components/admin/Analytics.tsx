import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { DonutChart } from '../ui/DonutChart';
import { SimpleBarChart } from '../ui/SimpleBarChart';
import { SimpleAreaChart } from '../ui/SimpleAreaChart';
import { TrendingUp, Users, Car, Package, MapPin, RefreshCw, Activity, BarChart3 } from 'lucide-react';
import { getAdminTrips, getAdminUsers, getAdminOffers, getAdminReviews } from '../../api/dataApi';
import { toast } from 'sonner';
import { AdminPageHeader, HeaderBtn, SkeletonList } from './AdminPageHeader';
import { offerStatusBreakdown, tripStatusBreakdown } from './tripStatus';

const _COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export function Analytics() {
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, u, o, r] = await Promise.all([
        getAdminTrips(), getAdminUsers(), getAdminOffers(), getAdminReviews(),
      ]);
      setTrips(t || []);
      setUsers(u || []);
      setOffers(o || []);
      setReviews(r || []);
    } catch {
      toast.error('Ошибка загрузки аналитики');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Computed metrics ──────────────────────────────────────────────────────────

  // Trips by day (last 14 days)
  const tripsByDay: Record<string, number> = {};
  const offersByDay: Record<string, number> = {};
  const now = Date.now();
  const days14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * 86400000);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  });
  days14.forEach(d => { tripsByDay[d] = 0; offersByDay[d] = 0; });

  trips.forEach(t => {
    if (!t?.createdAt) return;
    const d = new Date(t.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    if (d in tripsByDay) tripsByDay[d]++;
  });
  offers.forEach(o => {
    if (!o?.createdAt) return;
    const d = new Date(o.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    if (d in offersByDay) offersByDay[d]++;
  });

  const activityData = days14.map(d => ({
    date: d, trips: tripsByDay[d], offers: offersByDay[d],
  }));

  // Users registrations by day (last 14)
  const usersByDay: Record<string, number> = {};
  days14.forEach(d => { usersByDay[d] = 0; });
  users.forEach(u => {
    if (!u?.createdAt) return;
    const d = new Date(u.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    if (d in usersByDay) usersByDay[d]++;
  });
  const userGrowthData = days14.map(d => ({ date: d, users: usersByDay[d] }));

  // Trip status breakdown
  const tripStatusData = tripStatusBreakdown(trips);

  // Offer status breakdown
  const offerStatusData = offerStatusBreakdown(offers);

  // User role breakdown
  const userRoleData = [
    { name: 'Водители', value: users.filter(u => u?.role === 'driver').length, color: '#3b82f6' },
    { name: 'Отправители', value: users.filter(u => u?.role === 'sender').length, color: '#8b5cf6' },
  ].filter(d => d.value > 0);

  // Top routes from trips
  const routeMap: Record<string, number> = {};
  trips.filter(t => t?.from && t?.to).forEach(t => {
    const key = `${t.from} → ${t.to}`;
    routeMap[key] = (routeMap[key] || 0) + 1;
  });
  const topRoutes = Object.entries(routeMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([route, count]) => ({ route, count }));

  // Top drivers by trips
  const driverMap: Record<string, { name: string; trips: number }> = {};
  trips.forEach(t => {
    if (!t?.driverEmail) return;
    if (!driverMap[t.driverEmail]) driverMap[t.driverEmail] = { name: t.driverName || t.driverEmail, trips: 0 };
    driverMap[t.driverEmail].trips++;
  });
  const topDrivers = Object.values(driverMap).sort((a, b) => b.trips - a.trips).slice(0, 5);

  // Average rating from reviews
  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + (r?.rating || 0), 0) / reviews.length).toFixed(1)
    : '—';

  // Conversion rate: accepted / total offers
  const conversionRate = offers.length > 0
    ? ((offers.filter(o => o?.status === 'accepted').length / offers.length) * 100).toFixed(1)
    : '0';

  const keyMetrics = [
    { label: 'Всего поездок', value: trips.length, icon: Package, color: 'text-blue-600' },
    { label: 'Пользователей', value: users.length, icon: Users, color: 'text-purple-600' },
    { label: 'Оферт всего', value: offers.length, icon: Car, color: 'text-orange-600' },
    { label: 'Конверсия оферт', value: `${conversionRate}%`, icon: TrendingUp, color: 'text-emerald-600' },
    { label: 'Ср. рейтинг', value: avgRating, icon: Activity, color: 'text-yellow-600' },
    { label: 'Отзывов', value: reviews.length, icon: MapPin, color: 'text-pink-600' },
  ];

  if (loading) return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Аналитика и отчёты"
        subtitle="Загрузка данных..."
        icon={BarChart3}
        gradient="linear-gradient(135deg,#4f46e5,#6366f1)"
        accent="#4f46e5"
      />
      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f0f4f8' }}>
        <SkeletonList rows={6} />
      </div>
    </div>
  );

  const hasActivity = activityData.some(d => d.trips > 0 || d.offers > 0);
  const hasUserGrowth = userGrowthData.some(d => d.users > 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Аналитика и отчёты"
        subtitle="Реальные данные из базы Ovora Cargo"
        icon={BarChart3}
        gradient="linear-gradient(135deg,#4f46e5,#6366f1)"
        accent="#4f46e5"
        stats={[
          { label: 'Поездок', value: trips.length },
          { label: 'Пользователей', value: users.length },
          { label: 'Конверсия', value: `${conversionRate}%` },
          { label: 'Ср. рейтинг', value: Number(avgRating) > 0 ? `★ ${avgRating}` : '—' },
        ]}
        actions={
          <HeaderBtn icon={RefreshCw} onClick={load}>Обновить</HeaderBtn>
        }
      />

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {keyMetrics.map((m) => (
          <Card key={m.label}>
            <CardContent className="p-3 sm:p-4">
              <m.icon className={`w-5 h-5 ${m.color} mb-2`} />
              <p className="text-xl sm:text-2xl font-bold text-gray-900">{m.value}</p>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{m.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Activity chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Активность за 14 дней
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasActivity ? (
            <SimpleAreaChart
              data={activityData}
              labelKey="date"
              series={[
                { dataKey: 'trips', color: '#3b82f6', label: 'Поездки' },
                { dataKey: 'offers', color: '#10b981', label: 'Оферты' },
              ]}
              height={280}
            />
          ) : (
            <div className="h-[280px] flex flex-col items-center justify-center text-gray-400">
              <Package className="w-12 h-12 mb-3 text-gray-200" />
              <p className="text-sm">Нет данных за последние 14 дней</p>
              <p className="text-xs mt-1">Данные появятся по мере использования платформы</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trip status */}
        <Card>
          <CardHeader><CardTitle>Статус поездок</CardTitle></CardHeader>
          <CardContent>
            {tripStatusData.length > 0 ? (
              <>
                <div className="flex justify-center">
                  <div className="w-full max-w-[220px] [&_svg]:w-full [&_svg]:h-auto">
                    <DonutChart data={tripStatusData} innerRadius={55} outerRadius={85} size={220} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  {tripStatusData.map(item => (
                    <div key={item.name} className="flex items-center gap-2 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-gray-600 truncate">{item.name}: <strong>{item.value}</strong></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
            )}
          </CardContent>
        </Card>

        {/* Offer status */}
        <Card>
          <CardHeader><CardTitle>Статус оферт</CardTitle></CardHeader>
          <CardContent>
            {offerStatusData.length > 0 ? (
              <>
                <div className="flex justify-center">
                  <div className="w-full max-w-[220px] [&_svg]:w-full [&_svg]:h-auto">
                    <DonutChart data={offerStatusData} innerRadius={55} outerRadius={85} size={220} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  {offerStatusData.map(item => (
                    <div key={item.name} className="flex items-center gap-2 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-gray-600 truncate">{item.name}: <strong>{item.value}</strong></span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[260px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* User growth + role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Регистрации пользователей (14 дней)</CardTitle></CardHeader>
          <CardContent>
            {hasUserGrowth ? (
              <SimpleBarChart
                data={userGrowthData.map(d => ({ label: d.date, value: d.users }))}
                color="#8b5cf6"
                height={220}
              />
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Нет регистраций за 14 дней</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Роли пользователей</CardTitle></CardHeader>
          <CardContent>
            {userRoleData.length > 0 ? (
              <>
                <div className="flex justify-center">
                  <div className="w-full max-w-[160px] [&_svg]:w-full [&_svg]:h-auto">
                    <DonutChart data={userRoleData} innerRadius={45} outerRadius={70} size={160} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4 mt-4">
                  {userRoleData.map(item => (
                    <div key={item.name} className="text-center p-2.5 sm:p-3 rounded-xl min-w-0" style={{ backgroundColor: item.color + '15' }}>
                      <p className="text-2xl font-bold" style={{ color: item.color }}>{item.value}</p>
                      <p className="text-xs text-gray-600 mt-0.5 truncate">{item.name}</p>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Нет данных</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top routes */}
      {topRoutes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Популярные маршруты</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topRoutes.map((r, i) => (
                <div key={r.route} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                    i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-500' : 'bg-blue-400'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 truncate">{r.route}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1">
                      <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(r.count / (topRoutes[0]?.count || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-sm font-bold text-gray-700 flex-shrink-0">{r.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top drivers */}
      {topDrivers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Топ водителей по поездкам</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topDrivers.map((d, i) => (
                <div key={d.name} className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                    i === 0 ? 'bg-yellow-500' : i === 1 ? 'bg-gray-400' : i === 2 ? 'bg-orange-500' : 'bg-blue-400'
                  }`}>{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{d.name}</p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1.5">
                      <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${(d.trips / (topDrivers[0]?.trips || 1)) * 100}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-900">{d.trips}</p>
                    <p className="text-xs text-gray-500">поездок</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {trips.length === 0 && users.length === 0 && (
        <div className="py-16 text-center">
          <Activity className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">Данные появятся по мере использования платформы</p>
          <p className="text-gray-400 text-sm mt-1">Аналитика строится на основе реальных поездок и пользователей</p>
        </div>
      )}
    </div>
  );
}
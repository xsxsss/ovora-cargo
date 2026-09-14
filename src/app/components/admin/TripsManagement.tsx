import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { Search, Clock, Package, Car, Calendar, XCircle, RefreshCw, Loader2, ChevronDown, ChevronUp, Share2, Download, Route, Truck, Image as ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { getAdminTrips, getAdminOffers, getAdminShipments, adminHeaders } from '../../api/dataApi';
import { SHIPMENT_STATUS_LABELS, SHIPMENT_STATUS_ICONS } from '../../api/trackingApi';
import { projectId } from '../../../../utils/supabase/info';
import { AdminPageHeader, HeaderBtn, FilterChips, SkeletonList, Pagination } from './AdminPageHeader';
import { exportCsv } from '../../utils/adminCsvExport';
import { TRIP_STATUS_META, tripStatusKey } from './tripStatus';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;

async function cancelTrip(id: string) {
  const res = await fetch(`${BASE}/trips/${id}`, {
    method: 'DELETE', headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function RelTime({ iso }: { iso?: string }) {
  if (!iso) return <span className="text-gray-400">—</span>;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return <span>{Math.max(0, mins)} мин.</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span>{hrs} ч.</span>;
  return <span>{Math.floor(hrs / 24)} дн.</span>;
}

const PAGE_SIZE = 20;

export function TripsManagement() {
  const [trips, setTrips] = useState<any[]>([]);
  const [offersByTrip, setOffersByTrip] = useState<Record<string, any[]>>({});
  const [shipmentsByTrip, setShipmentsByTrip] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  // Переход из глобального поиска в шапке админки (AdminLayout)
  useEffect(() => {
    const q = searchParams.get('q');
    const expand = searchParams.get('expand');
    if (q) { setSearchQuery(q); setPage(1); }
    if (expand) setExpandedId(expand);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tripsData, offersData, shipmentsData] = await Promise.all([getAdminTrips(), getAdminOffers(), getAdminShipments()]);
      setTrips(tripsData || []);
      const obt: Record<string, any[]> = {};
      (offersData || []).forEach((o: any) => {
        if (!o?.tripId) return;
        if (!obt[o.tripId]) obt[o.tripId] = [];
        obt[o.tripId].push(o);
      });
      setOffersByTrip(obt);
      const sbt: Record<string, any> = {};
      (shipmentsData || []).forEach((s: any) => { if (s?.tripId) sbt[s.tripId] = s; });
      setShipmentsByTrip(sbt);
    } catch {
      toast.error('Ошибка загрузки поездок');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCancel = async (trip: any) => {
    if (!confirm(`Отменить поездку ${trip.from} → ${trip.to}?`)) return;
    setActionLoading(trip.id);
    try {
      await cancelTrip(trip.id);
      setTrips(prev => prev.map(t => t.id === trip.id ? { ...t, deletedAt: new Date().toISOString(), status: 'cancelled' } : t));
      toast.success('Поездка отменена');
    } catch {
      toast.error('Ошибка отмены');
    } finally {
      setActionLoading(null);
    }
  };

  const statusCounts = {
    all: trips.length,
    planned: trips.filter(t => t && tripStatusKey(t) === 'planned').length,
    inProgress: trips.filter(t => t && tripStatusKey(t) === 'inProgress').length,
    frozen: trips.filter(t => t && tripStatusKey(t) === 'frozen').length,
    completed: trips.filter(t => t && tripStatusKey(t) === 'completed').length,
    cancelled: trips.filter(t => t && tripStatusKey(t) === 'cancelled').length,
  };

  const filtered = trips
    .filter(t => {
      if (!t) return false;
      const q = searchQuery.toLowerCase();
      const matchSearch = !q
        || (t.from || '').toLowerCase().includes(q)
        || (t.to || '').toLowerCase().includes(q)
        || (t.driverName || '').toLowerCase().includes(q)
        || (t.driverEmail || '').toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || tripStatusKey(t) === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const [field, dir] = sortBy.split('_');
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (field === 'date') return dir === 'desc' ? tb - ta : ta - tb;
      if (field === 'price') {
        const pa = parseFloat(String(a.pricePerSeat || a.pricePerKg || 0));
        const pb = parseFloat(String(b.pricePerSeat || b.pricePerKg || 0));
        return dir === 'desc' ? pb - pa : pa - pb;
      }
      return 0;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Управление поездками"
        subtitle="Все поездки платформы в реальном времени"
        icon={Route}
        gradient="linear-gradient(135deg,#059669,#10b981)"
        accent="#059669"
        stats={[
          { label: 'Всего', value: statusCounts.all },
          { label: 'В пути', value: statusCounts.inProgress },
          { label: 'Завершено', value: statusCounts.completed },
          { label: 'Запланировано', value: statusCounts.planned },
        ]}
        actions={
          <>
            <HeaderBtn
              icon={Download}
              variant="ghost"
              onClick={() => exportCsv(
                filtered.map(t => ({
                  id: t.id, from: t.from, to: t.to,
                  date: t.departureDate || t.date, status: t.status,
                  driver: t.driverName || t.driverEmail,
                  pricePerSeat: t.pricePerSeat, pricePerKg: t.pricePerKg,
                  created: t.createdAt,
                })),
                `trips_export_${new Date().toISOString().slice(0, 10)}.csv`
              )}
            >
              CSV
            </HeaderBtn>
            <HeaderBtn icon={RefreshCw} onClick={load}>Обновить</HeaderBtn>
          </>
        }
      />

      {/* Status filter chips */}
      <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1px solid #f0f4f8' }}>
        <FilterChips
          value={statusFilter as any}
          onChange={setStatusFilter as any}
          options={[
            { value: 'all',       label: 'Все поездки',   count: statusCounts.all },
            { value: 'planned',    label: '🕐 Запланированы', count: statusCounts.planned },
            { value: 'inProgress', label: '🔵 В пути',        count: statusCounts.inProgress },
            { value: 'frozen',     label: '❄️ Заморожены',    count: statusCounts.frozen },
            { value: 'completed',  label: '✅ Завершены',     count: statusCounts.completed },
            { value: 'cancelled', label: '❌ Отменены',    count: statusCounts.cancelled },
          ]}
        />
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск по маршруту, водителю..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-gray-700 outline-none transition-all"
              style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#05996666'; e.currentTarget.style.boxShadow = '0 0 0 3px #05996612'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>
          <FilterChips
            value={sortBy as any}
            onChange={setSortBy as any}
            options={[
              { value: 'date_desc', label: 'Новые' },
              { value: 'date_asc',  label: 'Старые' },
              { value: 'price_desc', label: 'Дороже' },
              { value: 'price_asc',  label: 'Дешевле' },
            ]}
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f0f4f8' }}>
          <SkeletonList rows={5} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl py-16 text-center" style={{ border: '1px solid #f0f4f8' }}>
          <Package className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Поездки не найдены</p>
          <p className="text-gray-400 text-sm mt-1">Попробуйте изменить фильтры</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paged.map(trip => {
            const isExpanded = expandedId === trip.id;
            const isActLoading = actionLoading === trip.id;
            const statusKey = tripStatusKey(trip);
            const isCancelled = statusKey === 'cancelled';
            const meta = TRIP_STATUS_META[statusKey];
            const tripOffers = offersByTrip[trip.id] || [];
            const acceptedOffers = tripOffers.filter(o => o.status === 'accepted');
            const pendingOffers = tripOffers.filter(o => o.status === 'pending');
            const shipment = shipmentsByTrip[trip.id];

            return (
              <div
                key={trip.id}
                className="bg-white rounded-2xl overflow-hidden transition-all hover:shadow-md"
                style={{
                  border: '1px solid #f0f4f8',
                  opacity: isCancelled ? 0.7 : 1,
                }}
              >
                <div className="p-4">
                  <div className="flex flex-col sm:flex-row items-start gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0 w-full">
                    {/* Status icon */}
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: meta.bg }}
                    >
                      <div className="w-3 h-3 rounded-full" style={{ background: meta.color }} />
                    </div>

                    {/* Route */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-gray-900 text-sm truncate">
                          {trip.from} → {trip.to}
                        </span>
                        <span
                          className="px-2.5 py-0.5 rounded-xl text-xs font-bold"
                          style={{ background: meta.bg, color: meta.text }}
                        >
                          {meta.label}
                        </span>
                        {pendingOffers.length > 0 && (
                          <span className="px-2 py-0.5 rounded-xl text-xs font-semibold" style={{ background: '#fffbeb', color: '#b45309' }}>
                            {pendingOffers.length} ожид.
                          </span>
                        )}
                        {acceptedOffers.length > 0 && (
                          <span className="px-2 py-0.5 rounded-xl text-xs font-semibold" style={{ background: '#f0fdf4', color: '#15803d' }}>
                            {acceptedOffers.length} принят.
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" />
                          {trip.driverName || trip.driverEmail || '—'}
                        </span>
                        {trip.departureDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {trip.departureDate}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <RelTime iso={trip.createdAt} /> назад
                        </span>
                      </div>
                    </div>
                    </div>

                    {/* Price + actions */}
                    <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-start">
                      {(trip.pricePerSeat || trip.pricePerKg) && (
                        <div
                          className="hidden sm:block px-3 py-1.5 rounded-xl text-right"
                          style={{ background: '#f8fafc' }}
                        >
                          <p className="text-sm font-bold text-gray-900">
                            {trip.pricePerSeat ? `${trip.pricePerSeat}` : `${trip.pricePerKg}`}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {trip.pricePerSeat ? 'ТЖС/мест' : 'ТЖС/кг'}
                          </p>
                        </div>
                      )}
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/trip/${trip.id}`;
                          if (navigator.share) await navigator.share({ title: `${trip.from} → ${trip.to}`, url });
                          else { await navigator.clipboard.writeText(url); toast.success('Ссылка скопирована'); }
                        }}
                        className="p-1.5 hover:bg-blue-50 text-blue-400 rounded-xl transition-colors"
                        title="Скопировать ссылку"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : trip.id)}
                        className="p-1.5 hover:bg-gray-100 text-gray-400 rounded-xl transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {!isCancelled && (
                        <button
                          onClick={() => handleCancel(trip)}
                          disabled={isActLoading}
                          className="p-1.5 hover:bg-red-50 text-red-400 rounded-xl transition-colors"
                          title="Отменить поездку"
                        >
                          {isActLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 grid grid-cols-2 md:grid-cols-4 gap-3" style={{ borderTop: '1px solid #f0f4f8' }}>
                      {[
                        { label: 'Email водителя', value: trip.driverEmail || '—' },
                        { label: 'Мест / Груз', value: [trip.availableSeats ? `${trip.availableSeats} мест` : '', trip.cargoCapacity ? `${trip.cargoCapacity} кг` : ''].filter(Boolean).join(', ') || '—' },
                        { label: 'Создана', value: trip.createdAt ? new Date(trip.createdAt).toLocaleString('ru-RU') : '—' },
                        { label: 'ID', value: trip.id?.slice(0, 14) + '...' },
                      ].map(f => (
                        <div key={f.label}>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">{f.label}</p>
                          <p className="text-sm text-gray-900 break-all font-mono text-xs">{f.value}</p>
                        </div>
                      ))}
                      {tripOffers.length > 0 && (
                        <div className="col-span-2 md:col-span-4">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2">
                            Оферты по поездке ({tripOffers.length})
                          </p>
                          <div className="space-y-1.5">
                            {tripOffers.slice(0, 5).map(offer => (
                              <div key={offer.offerId} className="flex items-center gap-2 sm:gap-3 p-2 rounded-xl text-xs flex-wrap" style={{ background: '#f8fafc' }}>
                                <span
                                  className="px-2 py-0.5 rounded-lg font-semibold flex-shrink-0"
                                  style={
                                    offer.status === 'accepted' ? { background: '#f0fdf4', color: '#15803d' } :
                                    offer.status === 'pending'  ? { background: '#fffbeb', color: '#b45309' } :
                                    { background: '#fef2f2', color: '#dc2626' }
                                  }
                                >
                                  {offer.status === 'accepted' ? 'Принята' : offer.status === 'pending' ? 'Ожидает' : 'Отклонена'}
                                </span>
                                <span className="text-gray-700 flex-1 min-w-0 truncate">{offer.senderName || offer.senderEmail || '—'}</span>
                                <span className="font-bold text-gray-900 flex-shrink-0">{offer.price || '—'} ТЖС</span>
                              </div>
                            ))}
                            {tripOffers.length > 5 && (
                              <p className="text-xs text-gray-400 pl-2">+ ещё {tripOffers.length - 5}</p>
                            )}
                          </div>
                        </div>
                      )}

                      {shipment && (
                        <div className="col-span-2 md:col-span-4 pt-2" style={{ borderTop: '1px solid #f0f4f8' }}>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1.5">
                            <Truck className="w-3.5 h-3.5" /> Отслеживание перевозки
                          </p>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2.5 py-1 rounded-xl text-xs font-bold" style={{ background: '#eff6ff', color: '#1d4ed8' }}>
                              {SHIPMENT_STATUS_ICONS[shipment.status as keyof typeof SHIPMENT_STATUS_ICONS] || '•'}{' '}
                              {SHIPMENT_STATUS_LABELS[shipment.status as keyof typeof SHIPMENT_STATUS_LABELS] || shipment.status || '—'}
                            </span>
                            {shipment.updatedAt && (
                              <span className="text-xs text-gray-400">обновлено {new Date(shipment.updatedAt).toLocaleString('ru-RU')}</span>
                            )}
                          </div>

                          {Array.isArray(shipment.statusHistory) && shipment.statusHistory.length > 0 && (
                            <div className="space-y-1 mb-2">
                              {shipment.statusHistory.map((h: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                                  <span>{SHIPMENT_STATUS_ICONS[h.status as keyof typeof SHIPMENT_STATUS_ICONS] || '•'}</span>
                                  <span className="text-gray-700">{SHIPMENT_STATUS_LABELS[h.status as keyof typeof SHIPMENT_STATUS_LABELS] || h.status}</span>
                                  <span className="text-gray-400">{h.timestamp ? new Date(h.timestamp).toLocaleString('ru-RU') : ''}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {Array.isArray(shipment.podPhotos) && shipment.podPhotos.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {shipment.podPhotos.map((p: any, i: number) => (
                                <a
                                  key={i}
                                  href={p.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium hover:bg-gray-100 transition-colors"
                                  style={{ background: '#f8fafc', color: '#475569' }}
                                >
                                  <ImageIcon className="w-3.5 h-3.5" />
                                  {p.type === 'loading' ? 'Фото погрузки' : 'Фото выгрузки'}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onChange={p => { setPage(p); }} />
      <p className="text-xs text-gray-400 text-center">
        Показано {filtered.length} из {trips.length} поездок
      </p>
    </div>
  );
}
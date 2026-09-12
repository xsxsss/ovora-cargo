import { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, Download, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getAviaAdminAudit } from '../../api/aviaAdminApi';
import { AdminPageHeader, HeaderBtn, SkeletonList } from './AdminPageHeader';
import { exportCsv } from '../../utils/adminCsvExport';
import { ActorBadge, actorInfo } from './auditActor';

const ACTION_LABELS: Record<string, string> = {
  'user.register': '👤 Регистрация', 'user.login': '🔑 Вход', 'user.profile_update': '✏ Обновление профиля',
  'user.passport_upload': '🛂 Загрузка паспорта', 'user.pin_change': '🔐 Смена кода',
  'user.admin_edit': '🛠 Правка админом', 'user.admin_block': '🚫 Блокировка', 'user.admin_unblock': '✅ Разблокировка',
  'user.admin_delete': '🗑 Удаление админом', 'user.admin_reset_code': '🔄 Сброс кода админом',
  'flight.create': '✈ Создан рейс', 'flight.edit': '✏ Правка рейса', 'flight.delete': '🗑 Удаление рейса',
  'flight.start': '🛫 Старт поездки', 'flight.close': '🔒 Закрытие рейса', 'flight.complete': '⭐ Завершение рейса',
  'deal.create': '🤝 Создана сделка', 'deal.accept': '✅ Принята сделка', 'deal.reject': '❌ Отклонена сделка',
  'deal.cancel': '🚫 Отменена сделка', 'deal.complete': '⭐ Завершена сделка', 'deal.pod_upload': '📷 Фото доставки',
  'deal.delete': '🗑 Удаление сделки', 'deal.admin_delete': '🗑 Удаление сделки админом',
  'chat.delete': '💬 Удаление чата',
  'user.passport_verification_status_changed': '🛂 Статус проверки паспорта',
  'user.admin_reset_passport': '♻ Сброс паспорта админом',
  'flight.admin_status_change': '🔁 Смена статуса рейса админом',
  'blacklist.admin_remove': '✅ Снятие из чёрного списка',
  'settings.admin_update': '⚙ Изменение настроек',
  'admin.login': '🔑 Вход в админку',
  'admin.request': '📝 Действие в админке',
};

const PAGE_SIZE = 50;

export function AviaAuditLog() {
  const [entries, setEntries] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [actorPhone, setActorPhone] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAviaAdminAudit({
        actorPhone: actorPhone.trim() || undefined,
        action: actionFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch {
      toast.error('Ошибка загрузки журнала аудита');
    } finally {
      setLoading(false);
    }
  }, [actorPhone, actionFilter, page]);

  useEffect(() => { load(); }, [load]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="AVIA — Журнал аудита"
        subtitle="Кто и что делал в AVIA: вход в админку, рейсы, сделки, паспорта, настройки"
        icon={History}
        gradient="linear-gradient(135deg,#64748b,#94a3b8)"
        accent="#64748b"
        stats={[{ label: 'Всего записей', value: total }]}
        actions={
          <>
            <HeaderBtn
              icon={Download}
              variant="ghost"
              onClick={() => exportCsv(
                entries.map(e => ({ timestamp: e.timestamp, action: ACTION_LABELS[e.action] || e.action, actor: actorInfo(e.actorPhone).label, actorRaw: e.actorPhone, targetId: e.targetId || '', targetType: e.targetType || '', details: JSON.stringify(e.details || {}) })),
                `avia_audit_export_${new Date().toISOString().slice(0, 10)}.csv`
              )}
            >
              CSV
            </HeaderBtn>
            <HeaderBtn icon={RefreshCw} onClick={load}>Обновить</HeaderBtn>
          </>
        }
      />

      <form onSubmit={handleSearch} className="bg-white rounded-2xl p-4 flex flex-col sm:flex-row sm:flex-wrap gap-3" style={{ border: '1px solid #f0f4f8' }}>
        <div className="relative flex-1 sm:min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Актор: телефон или admin:super-admin..."
            value={actorPhone}
            onChange={e => setActorPhone(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-gray-700 outline-none transition-all"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
          />
        </div>
        <select
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(0); }}
          className="w-full sm:w-auto px-3 py-2.5 rounded-xl text-sm text-gray-700 outline-none"
          style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
        >
          <option value="">Все действия</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button type="submit" className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ background: '#64748b' }}>
          Найти
        </button>
      </form>

      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f0f4f8' }}>
        {loading ? (
          <SkeletonList rows={8} />
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <History className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Записи не найдены</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {entries.map(entry => (
              <div key={entry.id} className="flex items-start gap-3 px-3 sm:px-5 py-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base" style={{ background: '#f1f5f9' }}>
                  {(ACTION_LABELS[entry.action] || '').slice(0, 2) || '•'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{ACTION_LABELS[entry.action] || entry.action}</p>
                    <span className="text-xs text-gray-400 sm:hidden">
                      {new Date(entry.timestamp).toLocaleString('ru-RU')}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 break-words">
                    <ActorBadge actor={entry.actorPhone} />
                    {entry.targetId && entry.targetId !== entry.actorPhone ? ` → ${entry.targetId}` : ''}
                    {entry.details && Object.keys(entry.details).length > 0 ? ` · ${JSON.stringify(entry.details)}` : ''}
                  </p>
                </div>
                <div className="hidden sm:block text-xs text-gray-400 flex-shrink-0">
                  {new Date(entry.timestamp).toLocaleString('ru-RU')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-gray-500">Стр. {page + 1} из {totalPages}</span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

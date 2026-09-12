import { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, Search, RefreshCw, Trash2, AlertTriangle,
  CheckCircle2, Clock, XCircle, Mail, Hash, Activity,
  ChevronDown, ChevronUp, X, RotateCcw, Lock, UserCog, Loader2,
} from 'lucide-react';
import { projectId } from '../../../../utils/supabase/info';
import { adminHeaders } from '../../api/dataApi';
import { toast } from 'sonner';
import { AdminPageHeader, HeaderBtn, FilterChips, SkeletonList } from './AdminPageHeader';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;

interface CodeEntry {
  email: string;
  createdAt: string | null;
  lastUsed: string | null;
  attempts: number;
  blocked: boolean;
  hasHash: boolean;
}

function fmt(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ entry }: { entry: CodeEntry }) {
  if (!entry.hasHash) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl" style={{ background: '#f1f5f9', color: '#64748b' }}>
      <X className="w-3 h-3" /> Нет хеша
    </span>
  );
  if (entry.blocked) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl" style={{ background: '#fef2f2', color: '#dc2626' }}>
      <XCircle className="w-3 h-3" /> Заблокирован
    </span>
  );
  if (entry.attempts >= 5) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl" style={{ background: '#fff7ed', color: '#c2410c' }}>
      <AlertTriangle className="w-3 h-3" /> Много ошибок
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl" style={{ background: '#f0fdf4', color: '#15803d' }}>
      <CheckCircle2 className="w-3 h-3" /> Активен
    </span>
  );
}

export function CodeManagement() {
  const [codes, setCodes] = useState<CodeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'warn' | 'blocked'>('all');
  const [sortBy, setSortBy] = useState<'email' | 'createdAt' | 'attempts'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [resettingEmail, setResettingEmail] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Имя и телефон уходят в карточку Supabase Auth при регистрации и правке
  // профиля. У тех, кто зарегистрировался раньше, эти колонки в дашборде
  // остались пустыми — эта кнопка догоняет их одним проходом.
  const syncIdentities = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(`${BASE}/admin/auth/sync-identities`, {
        method: 'POST', headers: adminHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Досланы данные: ${data.synced} из ${data.total} (без имени и телефона: ${data.skipped})`);
      } else if (res.status === 403) {
        toast.error('Досылка доступна только главному админу');
      } else {
        toast.error('Не удалось дослать: ' + (data.error || res.status));
      }
    } catch {
      toast.error('Сетевая ошибка при досылке данных');
    } finally {
      setSyncing(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/admin/codes`, { headers: adminHeaders() });
      const data = await res.json();
      if (data.success) setCodes(data.codes);
      else toast.error('Ошибка загрузки: ' + (data.error || ''));
    } catch {
      toast.error('Сетевая ошибка при загрузке кодов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReset = async (email: string) => {
    setResettingEmail(email);
    try {
      const res = await fetch(`${BASE}/auth/reset-code`, {
        method: 'POST', headers: adminHeaders(),
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Хеш сброшен для ${email}`);
        setCodes(prev => prev.filter(c => c.email !== email));
      } else {
        toast.error(data.error || 'Ошибка сброса');
      }
    } catch {
      toast.error('Сетевая ошибка при сбросе');
    } finally {
      setResettingEmail(null);
      setConfirmEmail(null);
    }
  };

  const stats = {
    total:   codes.length,
    active:  codes.filter(c => c.hasHash && !c.blocked && c.attempts < 5).length,
    blocked: codes.filter(c => c.blocked).length,
    warn:    codes.filter(c => !c.blocked && c.attempts >= 5).length,
    noHash:  codes.filter(c => !c.hasHash).length,
  };

  const filtered = codes
    .filter(c => {
      const matchSearch = c.email.toLowerCase().includes(search.toLowerCase());
      const matchStatus =
        statusFilter === 'all' ? true :
        statusFilter === 'active' ? (c.hasHash && !c.blocked && c.attempts < 5) :
        statusFilter === 'warn' ? (!c.blocked && c.attempts >= 5) :
        statusFilter === 'blocked' ? c.blocked : true;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'email')     cmp = a.email.localeCompare(b.email);
      if (sortBy === 'createdAt') cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      if (sortBy === 'attempts')  cmp = a.attempts - b.attempts;
      return sortAsc ? cmp : -cmp;
    });

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(v => !v);
    else { setSortBy(col); setSortAsc(false); }
  };

  const SortIcon = ({ col }: { col: typeof sortBy }) =>
    sortBy === col
      ? sortAsc ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
      : <ChevronDown className="w-3.5 h-3.5 opacity-20" />;

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="Коды доступа пользователей"
        subtitle="bcrypt-хеши 6-цифровых PIN-кодов · Сырой код никогда не сохраняется"
        icon={ShieldCheck}
        gradient="linear-gradient(135deg,#0f766e,#0d9488)"
        accent="#0f766e"
        stats={[
          { label: 'Всего записей', value: stats.total },
          { label: 'Активных', value: stats.active },
          { label: 'С ошибками', value: stats.warn },
          ...(stats.blocked > 0 ? [{ label: 'Заблокировано', value: stats.blocked }] : []),
        ]}
        actions={
          <>
            <HeaderBtn
              icon={syncing ? Loader2 : UserCog}
              variant="ghost"
              onClick={syncIdentities}
            >
              {syncing ? 'Досылаю…' : 'Досылать в Supabase'}
            </HeaderBtn>
            <HeaderBtn icon={RefreshCw} onClick={load}>Обновить</HeaderBtn>
          </>
        }
      />

      {/* ── Security info ── */}
      <div className="flex items-start gap-3 px-4 py-3.5 rounded-2xl" style={{ background: '#f0fdfa', border: '1px solid #99f6e4' }}>
        <Lock className="w-5 h-5 text-teal-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-teal-900">bcrypt (cost=12) · Не SHA-256</p>
          <p className="text-xs text-teal-700 mt-0.5">
            Хеши несовместимы с предыдущими SHA-256 записями. Пользователи с SHA-256 хешами должны сбросить код через поддержку.
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-2xl p-3 sm:p-4 space-y-3" style={{ border: '1px solid #f0f4f8' }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по email..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl text-sm text-gray-700 outline-none transition-all"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#0f766e66'; e.currentTarget.style.boxShadow = '0 0 0 3px #0f766e12'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <FilterChips
          className="overflow-x-auto flex-nowrap sm:flex-wrap pb-1 -mx-1 px-1"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'Все', count: codes.length },
            { value: 'active', label: '✅ Активные', count: stats.active },
            { value: 'warn', label: '⚠️ Много ошибок', count: stats.warn },
            { value: 'blocked', label: '🚫 Заблокированы', count: stats.blocked },
          ]}
        />
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f0f4f8' }}>
        <div className="overflow-x-auto">
        <div className="min-w-[640px]">
        {/* Header */}
        <div
          className="grid gap-4 px-5 py-3 text-xs font-bold uppercase tracking-wider"
          style={{ gridTemplateColumns: '2fr 1.3fr 1.3fr 90px 110px', background: '#f8fafc', borderBottom: '1px solid #f0f4f8', color: '#94a3b8' }}
        >
          <button onClick={() => toggleSort('email')} className="flex items-center gap-1 text-left hover:text-gray-700 transition-colors">
            <Mail className="w-3.5 h-3.5" /> Email <SortIcon col="email" />
          </button>
          <button onClick={() => toggleSort('createdAt')} className="flex items-center gap-1 hover:text-gray-700 transition-colors">
            <Clock className="w-3.5 h-3.5" /> Создан <SortIcon col="createdAt" />
          </button>
          <span className="flex items-center gap-1">
            <Activity className="w-3.5 h-3.5" /> Последний вход
          </span>
          <button onClick={() => toggleSort('attempts')} className="flex items-center gap-1 hover:text-gray-700 transition-colors">
            <Hash className="w-3.5 h-3.5" /> Попытки <SortIcon col="attempts" />
          </button>
          <span>Действие</span>
        </div>

        {loading ? (
          <SkeletonList rows={5} />
        ) : filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-2 text-gray-400">
            <ShieldCheck className="w-10 h-10 text-gray-200" />
            <p className="text-sm font-medium">
              {search ? `Ничего не найдено по "${search}"` : 'Кодов нет'}
            </p>
          </div>
        ) : (
          filtered.map((entry, i) => (
            <div
              key={entry.email}
              className="grid gap-4 px-5 py-4 items-center transition-colors hover:bg-gray-50"
              style={{
                gridTemplateColumns: '2fr 1.3fr 1.3fr 90px 110px',
                borderTop: i > 0 ? '1px solid #f8fafc' : undefined,
                background: entry.blocked ? '#fef2f208' : entry.attempts >= 5 ? '#fff7ed08' : undefined,
              }}
            >
              {/* Email + status */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                    style={{
                      background: entry.blocked
                        ? '#ef4444'
                        : entry.attempts >= 5
                        ? '#f59e0b'
                        : '#0f766e',
                    }}
                  >
                    {(entry.email[0] || '?').toUpperCase()}
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate min-w-0">{entry.email}</p>
                </div>
                <div className="mt-1.5 pl-9">
                  <StatusBadge entry={entry} />
                </div>
              </div>

              {/* Created */}
              <p className="text-xs text-gray-500">{fmt(entry.createdAt)}</p>

              {/* Last used */}
              <p className="text-xs text-gray-500">{fmt(entry.lastUsed)}</p>

              {/* Attempts */}
              <div>
                <div className="flex items-center gap-1">
                  <span className={`text-sm font-bold ${
                    entry.attempts >= 10 ? 'text-red-600' : entry.attempts >= 5 ? 'text-orange-500' : 'text-gray-700'
                  }`}>
                    {entry.attempts}
                  </span>
                  <span className="text-xs text-gray-400">/ 10</span>
                </div>
                <div className="w-full rounded-full h-1 mt-1" style={{ background: '#f1f5f9' }}>
                  <div
                    className="h-1 rounded-full"
                    style={{
                      width: `${Math.min(100, (entry.attempts / 10) * 100)}%`,
                      background: entry.attempts >= 10 ? '#ef4444' : entry.attempts >= 5 ? '#f59e0b' : '#0f766e',
                    }}
                  />
                </div>
              </div>

              {/* Action */}
              <div>
                {confirmEmail === entry.email ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleReset(entry.email)}
                      disabled={resettingEmail === entry.email}
                      className="px-2.5 py-1.5 text-white text-xs font-bold rounded-xl flex items-center gap-1 transition-colors"
                      style={{ background: '#dc2626' }}
                    >
                      {resettingEmail === entry.email
                        ? <RefreshCw className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                      Да
                    </button>
                    <button
                      onClick={() => setConfirmEmail(null)}
                      className="px-2.5 py-1.5 text-xs font-bold rounded-xl transition-colors"
                      style={{ background: '#f1f5f9', color: '#64748b' }}
                    >
                      Нет
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmEmail(entry.email)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-all"
                    style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Сбросить
                  </button>
                )}
              </div>
            </div>
          ))
        )}
        </div>
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-gray-400 text-center">
          Показано {filtered.length} из {codes.length} записей
        </p>
      )}

      {/* ── Confirm modal ── */}
      {confirmEmail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setConfirmEmail(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: '#fff7ed' }}>
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Сбросить хеш кода?</h3>
            <p className="text-sm text-gray-500 mb-2">
              Email: <span className="font-mono font-semibold text-gray-800 break-all">{confirmEmail}</span>
            </p>
            <p className="text-sm text-gray-500 mb-5">
              bcrypt-хеш будет удалён из базы. Пользователь сможет придумать новый код при следующем входе.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmEmail(null)}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-colors"
                style={{ border: '1px solid #e2e8f0', color: '#64748b' }}
              >
                Отмена
              </button>
              <button
                onClick={() => handleReset(confirmEmail)}
                disabled={resettingEmail === confirmEmail}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2 transition-colors"
                style={{ background: '#dc2626' }}
              >
                {resettingEmail === confirmEmail
                  ? <><RefreshCw className="w-4 h-4 animate-spin" />Сбрасываем...</>
                  : <><Trash2 className="w-4 h-4" />Сбросить</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
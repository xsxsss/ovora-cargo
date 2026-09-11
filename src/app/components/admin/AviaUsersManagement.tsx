import { useState, useEffect, useCallback } from 'react';
import {
  Search, Plane, RefreshCw, Loader2, Download, Trash2, UserCheck, UserX,
  ChevronDown, ChevronUp, MoreVertical, KeyRound, Pencil, ZoomIn, X, FileX,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { toast } from 'sonner';
import {
  getAviaAdminUsers, setAviaUserBlocked, deleteAviaAdminUser,
  resetAviaUserCode, updateAviaAdminUser, getAviaAdminPassportPhoto,
  resetAviaUserPassport,
} from '../../api/aviaAdminApi';
import { getAviaPublicProfile, type AviaPublicProfile } from '../../api/aviaReviewApi';
import { AdminPageHeader, HeaderBtn, FilterChips, SkeletonList } from './AdminPageHeader';
import { exportCsv } from '../../utils/adminCsvExport';
import { RelTime } from './RelTime';

export function AviaUsersManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [ratings, setRatings] = useState<Record<string, AviaPublicProfile | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAviaAdminUsers();
      setUsers(data || []);
    } catch {
      toast.error('Ошибка загрузки пользователей AVIA');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBlock = async (user: any, blocked: boolean) => {
    setActionLoading(user.phone);
    try {
      await setAviaUserBlocked(user.phone, blocked);
      setUsers(prev => prev.map(u => u.phone === user.phone ? { ...u, blocked } : u));
      toast.success(blocked ? `${user.phone} заблокирован` : `${user.phone} разблокирован`);
    } catch {
      toast.error('Ошибка изменения статуса');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (user: any) => {
    if (!confirm(`Удалить AVIA-пользователя ${user.firstName || ''} ${user.lastName || ''} (${user.phone})? Это нельзя отменить.`)) return;
    setActionLoading(user.phone);
    try {
      await deleteAviaAdminUser(user.phone);
      setUsers(prev => prev.filter(u => u.phone !== user.phone));
      toast.success('Пользователь удалён');
    } catch {
      toast.error('Ошибка удаления');
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetCode = async (user: any) => {
    if (!confirm(`Сбросить код доступа для ${user.phone}? Старый код перестанет работать.`)) return;
    setActionLoading(user.phone);
    try {
      const { newPin } = await resetAviaUserCode(user.phone);
      toast.success(`Новый код для ${user.phone}: ${newPin}`, { duration: 15000 });
    } catch {
      toast.error('Ошибка сброса кода');
    } finally {
      setActionLoading(null);
    }
  };

  // Пользователь грузит паспорт один раз, поэтому заменить документ (истёк срок,
  // плохое фото, новый паспорт) можно только отсюда.
  const handleResetPassport = async (user: any) => {
    if (!confirm(`Сбросить паспорт для ${user.phone}? Старый скан будет удалён, пользователь сможет загрузить документ заново.`)) return;
    setActionLoading(user.phone);
    try {
      await resetAviaUserPassport(user.phone);
      toast.success(`Паспорт сброшен — ${user.phone} может загрузить заново`);
      await load();
    } catch {
      toast.error('Ошибка сброса паспорта');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveEdit = async (updates: Record<string, any>) => {
    if (!editTarget) return;
    setActionLoading(editTarget.phone);
    try {
      const { user } = await updateAviaAdminUser(editTarget.phone, updates);
      setUsers(prev => prev.map(u => u.phone === editTarget.phone ? { ...u, ...user } : u));
      toast.success('Профиль обновлён');
      setEditTarget(null);
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setActionLoading(null);
    }
  };

  const couriers = users.filter(u => u?.role === 'courier').length;
  const senders  = users.filter(u => u?.role === 'sender').length;
  const blocked  = users.filter(u => u?.blocked).length;

  const filtered = users
    .filter(u => {
      if (!u) return false;
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const q = searchQuery.toLowerCase();
      const matchSearch = !q || name.includes(q) || (u.phone || '').includes(q);
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus = statusFilter === 'all'
        || (statusFilter === 'blocked' ? !!u.blocked : !u.blocked);
      return matchSearch && matchRole && matchStatus;
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="AVIA — Пользователи"
        subtitle="Курьеры и отправители авиадоставки"
        icon={Plane}
        gradient="linear-gradient(135deg,#0ea5e9,#38bdf8)"
        accent="#0ea5e9"
        stats={[
          { label: 'Всего', value: users.length },
          { label: 'Курьеров', value: couriers },
          { label: 'Отправителей', value: senders },
          ...(blocked > 0 ? [{ label: 'Заблокировано', value: blocked }] : []),
        ]}
        actions={
          <>
            <HeaderBtn
              icon={Download}
              variant="ghost"
              onClick={() => exportCsv(
                filtered.map(u => ({
                  phone: u.phone, name: `${u.firstName || ''} ${u.lastName || ''}`.trim(), role: u.role, city: u.city || '',
                  blocked: !!u.blocked,
                  passportVerified: !!u.passportVerified, passportExpired: !!u.passportExpired,
                  likes: ratings[u.phone]?.likes ?? '', dislikes: ratings[u.phone]?.dislikes ?? '',
                  lastLoginAt: u.lastLoginAt || '', created: u.createdAt || '',
                })),
                `avia_users_export_${new Date().toISOString().slice(0, 10)}.csv`
              )}
            >
              CSV
            </HeaderBtn>
            <HeaderBtn icon={RefreshCw} onClick={load}>Обновить</HeaderBtn>
          </>
        }
      />

      <div className="bg-white rounded-2xl p-4 space-y-3" style={{ border: '1px solid #f0f4f8' }}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Поиск по имени, телефону..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-gray-700 outline-none transition-all"
            style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Роль</p>
            <FilterChips
              value={roleFilter as any}
              onChange={setRoleFilter as any}
              options={[
                { value: 'all', label: 'Все', count: users.length },
                { value: 'courier', label: '✈ Курьеры', count: couriers },
                { value: 'sender', label: '📦 Отправители', count: senders },
              ]}
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Статус</p>
            <FilterChips
              value={statusFilter as any}
              onChange={setStatusFilter as any}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'active', label: '✅ Активные' },
                { value: 'blocked', label: '🚫 Заблокированные', count: blocked },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: '1px solid #f0f4f8' }}>
        {loading ? (
          <SkeletonList rows={6} />
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Plane className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Пользователи не найдены</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filtered.map(user => {
              const isBlocked = !!user.blocked;
              const isExpanded = expandedId === user.phone;
              const isLoading = actionLoading === user.phone;
              const initials = `${(user.firstName || '?')[0]}${(user.lastName || '?')[0]}`.toUpperCase();
              const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.phone;

              return (
                <div key={user.phone} style={{ background: isBlocked ? '#fef2f210' : undefined }}>
                  <div className="flex items-start sm:items-center flex-wrap sm:flex-nowrap gap-3 px-3 sm:px-5 py-3.5 hover:bg-gray-50 transition-colors">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 overflow-hidden"
                      style={{
                        background: isBlocked
                          ? '#94a3b8'
                          : user.role === 'courier'
                          ? 'linear-gradient(135deg,#0ea5e9,#38bdf8)'
                          : 'linear-gradient(135deg,#7c3aed,#8b5cf6)',
                      }}
                    >
                      {user.avatarUrl
                        ? <img src={user.avatarUrl} alt={fullName} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                        : initials}
                    </div>

                    <div className="flex-1 min-w-0 order-1 sm:order-none">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-semibold text-sm truncate ${isBlocked ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                          {fullName}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{user.phone}</p>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0 order-2 sm:order-none ml-auto sm:ml-0">
                      <button
                        onClick={() => {
                          const next = isExpanded ? null : user.phone;
                          setExpandedId(next);
                          if (next && !(next in ratings)) {
                            getAviaPublicProfile(next).then(data => {
                              setRatings(prev => ({ ...prev, [next]: data?.profile || null }));
                            });
                          }
                        }}
                        className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            disabled={isLoading}
                            className="p-1.5 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                          >
                            {isLoading
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <MoreVertical className="w-4 h-4" />}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onClick={() => setEditTarget(user)}>
                            <Pencil className="w-4 h-4 mr-2" /> Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetCode(user)}>
                            <KeyRound className="w-4 h-4 mr-2" /> Сбросить код доступа
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetPassport(user)}>
                            <FileX className="w-4 h-4 mr-2" /> Сбросить паспорт
                          </DropdownMenuItem>
                          {isBlocked ? (
                            <DropdownMenuItem onClick={() => handleBlock(user, false)} className="text-emerald-600">
                              <UserCheck className="w-4 h-4 mr-2" /> Разблокировать
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => handleBlock(user, true)} className="text-orange-600">
                              <UserX className="w-4 h-4 mr-2" /> Заблокировать
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleDelete(user)} className="text-red-600">
                            <Trash2 className="w-4 h-4 mr-2" /> Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap order-3 w-full sm:w-auto sm:order-none">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={
                          user.role === 'courier'
                            ? { background: '#e0f2fe', color: '#0369a1' }
                            : { background: '#f5f3ff', color: '#6d28d9' }
                        }
                      >
                        {user.role === 'courier' ? '✈ Курьер' : '📦 Отправитель'}
                      </span>
                      {isBlocked && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600">
                          🚫 Заблокирован
                        </span>
                      )}
                      <span className="hidden lg:inline text-xs text-gray-400">
                        <RelTime iso={user.createdAt} />
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-3 sm:px-5 pb-4 pt-3 grid grid-cols-2 md:grid-cols-4 gap-4" style={{ background: '#f8fafc', borderTop: '1px solid #f0f4f8' }}>
                      {[
                        { label: 'Телефон', value: user.phone },
                        { label: 'Город', value: user.city || '—' },
                        { label: 'Telegram', value: user.telegram || '—' },
                        { label: 'Регистрация', value: user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU') : '—' },
                        {
                          label: 'Паспорт',
                          value: !user.passportPhoto && !user.passportPhotoPath
                            ? '— не загружен'
                            : user.passportExpired
                            ? '⏳ просрочен'
                            : user.passportVerified
                            ? '✅ подтверждён'
                            : '🕒 на проверке',
                        },
                      ].map(f => (
                        <div key={f.label}>
                          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{f.label}</p>
                          <p className="text-sm text-gray-900 break-all">{f.value}</p>
                        </div>
                      ))}
                      <div className="col-span-2 md:col-span-4 pt-2" style={{ borderTop: '1px solid #e2e8f0' }}>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Рейтинг и сделки</p>
                        {!(user.phone in ratings) ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                        ) : ratings[user.phone] ? (
                          <div className="flex gap-4 flex-wrap">
                            <span className="text-sm text-emerald-600 font-semibold">👍 {ratings[user.phone]!.likes}</span>
                            <span className="text-sm text-red-500 font-semibold">👎 {ratings[user.phone]!.dislikes}</span>
                            <span className="text-sm text-gray-600 font-semibold">🤝 {ratings[user.phone]!.dealsCompleted} сделок завершено</span>
                            <span className="text-sm text-gray-400">{ratings[user.phone]!.reviewsCount} отзывов</span>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400">Нет данных</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Показано {filtered.length} из {users.length} пользователей
      </p>

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, onClose, onSave }: { user: any; onClose: () => void; onSave: (u: Record<string, any>) => void }) {
  const [firstName, setFirstName] = useState(user.firstName || '');
  const [lastName, setLastName] = useState(user.lastName || '');
  const [city, setCity] = useState(user.city || '');
  const [telegram, setTelegram] = useState(user.telegram || '');
  const [passportVerified, setPassportVerified] = useState(!!user.passportVerified);
  const [passportExpired, setPassportExpired] = useState(!!user.passportExpired);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasPassport = !!user.passportUploadedAt;

  const handleViewPhoto = async () => {
    if (photoUrl) { setPreviewOpen(true); return; }
    setPhotoLoading(true);
    try {
      const url = await getAviaAdminPassportPhoto(user.phone);
      if (!url) { toast.error('Фото паспорта не найдено'); return; }
      setPhotoUrl(url);
      setPreviewOpen(true);
    } catch {
      toast.error('Ошибка загрузки фото');
    } finally {
      setPhotoLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: '#00000060' }} onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900">Редактировать профиль</h3>
        <p className="text-xs text-gray-400">{user.phone}</p>
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Имя</label>
            <input value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Фамилия</label>
            <input value={lastName} onChange={e => setLastName(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Город</label>
            <input value={city} onChange={e => setCity(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Telegram</label>
            <input value={telegram} onChange={e => setTelegram(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} />
          </div>
          <div className="pt-2 space-y-2" style={{ borderTop: '1px solid #f1f5f9' }}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide pt-2">Паспорт</p>
            {!hasPassport ? (
              <p className="text-xs text-gray-400">Паспорт не загружен</p>
            ) : (
              <button
                onClick={handleViewPhoto}
                disabled={photoLoading}
                className="flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl"
                style={{ background: '#eff6ff', color: '#1d4ed8' }}
              >
                {photoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ZoomIn className="w-4 h-4" />}
                Посмотреть фото паспорта
              </button>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={passportVerified} onChange={e => setPassportVerified(e.target.checked)} />
              Паспорт подтверждён
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={passportExpired} onChange={e => setPassportExpired(e.target.checked)} />
              Паспорт просрочен
            </label>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600" style={{ background: '#f1f5f9' }}>
            Отмена
          </button>
          <button
            onClick={() => onSave({ firstName, lastName, city, telegram, passportVerified, passportExpired })}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: '#0ea5e9' }}
          >
            Сохранить
          </button>
        </div>
      </div>

      {previewOpen && photoUrl && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4" onClick={() => setPreviewOpen(false)}>
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewOpen(false)} className="absolute -top-10 right-0 text-white/80 hover:text-white p-2">
              <X className="w-6 h-6" />
            </button>
            <img src={photoUrl} alt="Паспорт" loading="lazy" decoding="async" className="w-full rounded-2xl shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}

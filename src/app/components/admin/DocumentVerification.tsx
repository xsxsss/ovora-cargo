import { useState, useEffect, useCallback } from 'react';
import { FileCheck, X, Check, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronUp, Search, ZoomIn } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { toast } from 'sonner';
import { adminHeaders } from '../../api/dataApi';
import { projectId } from '../../../../utils/supabase/info';
import { Pagination } from './AdminPageHeader';
import { useBulkSelect } from '../../hooks/useBulkSelect';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const PAGE_SIZE = 12;

async function fetchAllDocuments() {
  const res = await fetch(`${BASE}/admin/documents`, { headers: adminHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.documents || [];
}

/** Сброс документа: удаляет файл и запись, после чего пользователь загружает заново. */
async function resetDocument(documentId: string, userEmail: string) {
  const res = await fetch(`${BASE}/admin/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE', headers: adminHeaders(),
    body: JSON.stringify({ userEmail }),
  });
  if (!res.ok) throw new Error('Не удалось сбросить документ');
  return res.json();
}

async function updateDocStatus(documentId: string, userEmail: string, status: string, notes?: string) {
  const res = await fetch(`${BASE}/admin/documents/${encodeURIComponent(documentId)}/status`, {
    method: 'PUT', headers: adminHeaders(),
    body: JSON.stringify({ status, userEmail, notes }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const TYPE_LABELS: Record<string, string> = {
  passport: '🪪 Паспорт',
  driver_license: '🚗 Водительские права',
  license: '🚗 Водительские права',
  vehicle_registration: '📋 Техпаспорт',
  registration: '📋 Техпаспорт',
  insurance: '🛡️ Страховка',
  id: '🪪 Удостоверение личности',
};

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:  { label: 'Ожидает',   cls: 'bg-orange-100 text-orange-700' },
  verified: { label: 'Проверен',  cls: 'bg-emerald-100 text-emerald-700' },
  approved: { label: 'Одобрен',   cls: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Отклонён',  cls: 'bg-red-100 text-red-700' },
};

function RelTime({ iso }: { iso?: string }) {
  if (!iso) return <span className="text-gray-400">—</span>;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return <span>{Math.max(0, mins)} мин. назад</span>;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return <span>{hrs} ч. назад</span>;
  return <span>{new Date(iso).toLocaleDateString('ru-RU')}</span>;
}

export function DocumentVerification() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [bulkLoading, setBulkLoading] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAllDocuments();
      setDocs(data);
    } catch {
      toast.error('Ошибка загрузки документов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleReset = async (doc: any) => {
    if (!confirm(`Сбросить документ «${doc.title || doc.type}»?\nФайл будет удалён, пользователь сможет загрузить его заново.`)) return;
    setActionLoading(doc.id);
    try {
      await resetDocument(doc.id, doc.driverEmail || doc.userEmail);
      setDocs(prev => prev.filter(d => d.id !== doc.id));
      toast.success('Документ сброшен — пользователь может загрузить заново');
    } catch {
      toast.error('Ошибка сброса документа');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAction = async (doc: any, status: string) => {
    setActionLoading(doc.id);
    try {
      await updateDocStatus(doc.id, doc.driverEmail || doc.userEmail, status, rejectNotes[doc.id]);
      setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, status } : d));
      toast.success(status === 'verified' || status === 'approved'
        ? `✅ Документ одобрен — ${doc.driverName || doc.driverEmail}`
        : `❌ Документ отклонён`
      );
      setExpandedId(null);
    } catch (_err) {
      toast.error('Ошибка изменения статуса');
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchQuery]);

  const handleBulkAction = async (status: 'verified' | 'rejected') => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    const ids = Array.from(selected);
    const targets = docs.filter(d => ids.includes(d.id));
    const results = await Promise.allSettled(
      targets.map(d => updateDocStatus(d.id, d.driverEmail || d.userEmail, status))
    );
    const okIds = targets.filter((_, i) => results[i].status === 'fulfilled').map(d => d.id);
    setDocs(prev => prev.map(d => okIds.includes(d.id) ? { ...d, status } : d));
    const failed = results.length - okIds.length;
    if (okIds.length) toast.success(`${status === 'verified' ? 'Одобрено' : 'Отклонено'}: ${okIds.length}`);
    if (failed) toast.error(`Не удалось обновить: ${failed}`);
    setSelected(new Set());
    setBulkLoading(false);
  };

  const counts = {
    all: docs.length,
    pending: docs.filter(d => d.status === 'pending').length,
    verified: docs.filter(d => d.status === 'verified' || d.status === 'approved').length,
    rejected: docs.filter(d => d.status === 'rejected').length,
  };

  const filtered = docs
    .filter(d => {
      const matchStatus = statusFilter === 'all' ||
        (statusFilter === 'verified' ? (d.status === 'verified' || d.status === 'approved') : d.status === statusFilter);
      const q = searchQuery.toLowerCase();
      const matchSearch = !q ||
        (d.driverName || '').toLowerCase().includes(q) ||
        (d.driverEmail || '').toLowerCase().includes(q) ||
        (d.type || '').toLowerCase().includes(q) ||
        (d.documentNumber || '').toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });

  const pendingFiltered = filtered.filter(d => d.status === 'pending');
  const { selected, setSelected, toggleSelect, toggleSelectAll, allVisibleSelected } = useBulkSelect(pendingFiltered, (d: any) => d.id);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      <span className="ml-3 text-gray-600">Загрузка документов из базы...</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Верификация документов</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Реальные данные &bull; Всего: <strong>{docs.length}</strong> &bull; Ожидают: <strong className="text-orange-600">{counts.pending}</strong>
          </p>
        </div>
        <button onClick={load} className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium w-full sm:w-auto">
          <RefreshCw className="w-4 h-4" />
          Обновить
        </button>
      </div>

      {/* Status tabs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          ['all',      'Все',         'text-gray-700',   counts.all],
          ['pending',  'Ожидают',     'text-orange-700', counts.pending],
          ['verified', 'Одобрены',    'text-emerald-700',counts.verified],
          ['rejected', 'Отклонены',   'text-red-700',    counts.rejected],
        ] as [string, string, string, number][]).map(([key, label, cls, cnt]) => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`p-4 rounded-xl text-left transition-all border ${
              statusFilter === key ? 'bg-white border-blue-200 shadow-sm' : 'bg-white border-gray-100 hover:bg-gray-50'
            }`}>
            <p className={`text-2xl font-bold ${cls}`}>{cnt}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Поиск по имени, email, типу или номеру документа..."
              value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl flex-wrap" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          <span className="text-sm font-medium text-blue-800">Выбрано: {selected.size}</span>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => handleBulkAction('verified')} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
              Одобрить выбранные
            </button>
            <button onClick={() => handleBulkAction('rejected')} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50">
              Отклонить выбранные
            </button>
            <button onClick={() => setSelected(new Set())} disabled={bulkLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Снять выделение
            </button>
          </div>
        </div>
      )}

      {/* Select all */}
      {pendingFiltered.length > 0 && (
        <label className="flex items-center gap-2 px-1 cursor-pointer text-sm text-gray-500">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={toggleSelectAll}
            className="w-4 h-4 rounded cursor-pointer accent-blue-600"
          />
          Выбрать все ожидающие ({pendingFiltered.length})
        </label>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="py-20 text-center">
          <FileCheck className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">
            {docs.length === 0
              ? 'Документов пока нет — они появятся после загрузки водителями'
              : `Нет документов со статусом «${statusFilter}»`
            }
          </p>
        </div>
      )}

      {/* Documents list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {paged.map(doc => {
          const isExpanded = expandedId === doc.id;
          const isLoading = actionLoading === doc.id;
          const statusCfg = STATUS_CFG[doc.status] || STATUS_CFG.pending;
          const typeLabel = TYPE_LABELS[doc.type] || doc.type || 'Документ';
          const isPending = doc.status === 'pending';
          const initials = ((doc.driverName || doc.driverEmail || '?')[0] || '?').toUpperCase();

          return (
            <Card key={doc.id} className={`transition-all hover:shadow-md ${isPending ? 'border-orange-200' : ''}`}>
              <CardContent className="p-5">
                {/* Header row */}
                <div className="flex items-start gap-3">
                  {isPending && (
                    <input
                      type="checkbox"
                      checked={selected.has(doc.id)}
                      onChange={() => toggleSelect(doc.id)}
                      onClick={e => e.stopPropagation()}
                      className="w-4 h-4 mt-1 rounded cursor-pointer accent-blue-600 flex-shrink-0"
                    />
                  )}
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold flex-shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{doc.driverName || doc.driverEmail || '—'}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.cls}`}>{statusCfg.label}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{typeLabel}</p>
                    {doc.driverPhone && <p className="text-xs text-gray-400">{doc.driverPhone}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => setExpandedId(isExpanded ? null : doc.id)}
                      className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Meta */}
                <div className="flex items-center justify-between gap-2 mt-3 text-xs text-gray-500 flex-wrap">
                  <span>Загружен: <RelTime iso={doc.createdAt} /></span>
                  {doc.documentNumber && <span className="font-mono text-gray-600 break-all">{doc.documentNumber}</span>}
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                    {/* Photo */}
                    {doc.photoUrl && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-2">Скан документа</p>
                        <div className="relative group cursor-pointer" onClick={() => setPreviewUrl(doc.photoUrl)}>
                          <img src={doc.photoUrl} alt="Документ" loading="lazy" decoding="async"
                            className="w-full rounded-xl border border-gray-200 max-h-52 object-cover hover:opacity-90 transition-opacity" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="bg-black/50 rounded-full p-2">
                              <ZoomIn className="w-5 h-5 text-white" />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {doc.extractedFullName && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium">ФИО из документа</p>
                          <p className="text-sm text-gray-900 mt-0.5">{doc.extractedFullName}</p>
                        </div>
                      )}
                      {doc.extractedBirthDate && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium">Дата рождения</p>
                          <p className="text-sm text-gray-900 mt-0.5">{doc.extractedBirthDate}</p>
                        </div>
                      )}
                      {doc.documentNumber && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium">Номер документа</p>
                          <p className="text-sm font-mono text-gray-900 mt-0.5">{doc.documentNumber}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-gray-500 font-medium">Email</p>
                        <p className="text-sm text-gray-900 mt-0.5 break-all">{doc.driverEmail || '—'}</p>
                      </div>
                    </div>

                    {doc.adminNotes && (
                      <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-sm text-orange-800">
                        <AlertTriangle className="w-4 h-4 inline mr-1" />
                        {doc.adminNotes}
                      </div>
                    )}

                    {/* Reject notes */}
                    {isPending && (
                      <div>
                        <label className="text-xs text-gray-500 font-medium block mb-1">Комментарий при отклонении (необязательно)</label>
                        <input type="text" placeholder="Причина отклонения..."
                          value={rejectNotes[doc.id] || ''}
                          onChange={e => setRejectNotes(prev => ({ ...prev, [doc.id]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    )}

                    {/* Actions */}
                    {isPending && (
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleAction(doc, 'rejected')}
                          disabled={isLoading}
                          className="flex-1 py-2.5 border border-red-300 text-red-700 rounded-xl hover:bg-red-50 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                          Отклонить
                        </button>
                        <button
                          onClick={() => handleAction(doc, 'verified')}
                          disabled={isLoading}
                          className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 text-sm font-medium"
                        >
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          Одобрить
                        </button>
                      </div>
                    )}
                    {!isPending && doc.status === 'verified' && (
                      <button onClick={() => handleAction(doc, 'rejected')} disabled={isLoading}
                        className="w-full py-2 border border-red-200 text-red-600 rounded-xl hover:bg-red-50 text-sm transition-colors">
                        Отозвать одобрение
                      </button>
                    )}

                    {/* Доступно в любом статусе: документ удаляется вместе с файлом,
                        и человек может загрузить его заново. */}
                    <button onClick={() => handleReset(doc)} disabled={isLoading}
                      className="w-full mt-3 py-2.5 border border-gray-300 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-50">
                      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Сбросить — разрешить повторную загрузку
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />

      <p className="text-xs text-gray-400 text-center">Показано {paged.length} из {filtered.length} документов (всего {docs.length})</p>

      {/* Image preview modal */}
      {previewUrl && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewUrl(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white p-2">
              <X className="w-6 h-6" />
            </button>
            <img src={previewUrl} alt="Preview" className="w-full rounded-2xl shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}

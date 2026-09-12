/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  CARGO AUDIT LOG — журнал админских действий CARGO            ║
 * ║                                                                ║
 * ║  KV-ключ: ovora:cargo-audit:{timestampMs}:{id}                ║
 * ║  Сортировка по времени достигается префиксом timestamp —      ║
 * ║  при миграции на SQL заменить на ORDER BY created_at DESC.    ║
 * ║  Зеркалирует aviaAudit.tsx — единый паттерн для двух платформ.║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as kv from "./kv_store.tsx";

export type CargoAuditAction =
  | 'cargo.admin_delete' | 'cargo.admin_edit'
  | 'offer.admin_status_change'
  | 'review.admin_delete'
  | 'document.admin_status_change'
  | 'settings.admin_update'
  | 'user.admin_status_change' | 'user.admin_delete'
  | 'blacklist.admin_remove'
  | 'trip.admin_delete_all'
  | 'ad.admin_create' | 'ad.admin_update' | 'ad.admin_delete'
  // Действия обычных пользователей (не админов) — зеркалирует aviaAudit.tsx,
  // где user- и admin-действия живут в одном журнале.
  | 'trip.create' | 'trip.edit' | 'trip.delete'
  | 'cargo.create' | 'cargo.edit' | 'cargo.delete'
  | 'offer.create'
  | 'review.create'
  | 'tracking.status_change' | 'tracking.pod_upload'
  // Сквозной журнал админки: вход в панель и любое изменяющее обращение
  // к /admin/*, которое обработчик не залогировал подробно.
  | 'admin.login' | 'admin.request';

export interface CargoAuditEntry {
  id        : string;
  timestamp : string;
  action    : CargoAuditAction;
  /** Email актора — реальный email пользователя для user-действий, либо `admin:<role>` для admin-действий */
  actorEmail: string;
  targetId  ?: string;
  targetType?: 'cargo' | 'offer' | 'review' | 'document' | 'settings' | 'user' | 'blacklist' | 'trip' | 'ad' | 'tracking' | 'session' | 'request';
  details   ?: Record<string, unknown>;
}

const PREFIX = 'ovora:cargo-audit:';

// ── Ретенция ────────────────────────────────────────────────────────────────
// Журнал лежит в KV, а list() читает его целиком. Со сквозным журналом админки
// записей стало заметно больше, поэтому без чистки он однажды упрётся в память.
// Держим полгода и не больше MAX_ENTRIES записей; чистим не чаще раза в
// час, чтобы не дёргать БД на каждом открытии страницы аудита.
const RETENTION_MS   = 180 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES    = 5000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_MARK     = 'ovora:cargo-audit-pruned-at';

// getByPrefix отдаёт только значения, без ключей — поэтому ключ собираем
// обратно из самой записи, ровно так же, как его составлял record().
function entryKey(e: CargoAuditEntry): string {
  return `${PREFIX}${new Date(e.timestamp).getTime()}:${e.id}`;
}

async function pruneIfDue(all: CargoAuditEntry[]): Promise<void> {
  try {
    const mark: any = await kv.get(PRUNE_MARK);
    if (mark?.at && Date.now() - mark.at < PRUNE_EVERY_MS) return;
    await kv.set(PRUNE_MARK, { at: Date.now() });

    const cutoff = Date.now() - RETENTION_MS;
    const sorted = [...all].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const doomed = sorted.filter((e, i) => i >= MAX_ENTRIES || new Date(e.timestamp).getTime() < cutoff);
    if (doomed.length === 0) return;

    await kv.mdel(doomed.map(entryKey));
    console.log(`[CargoAudit] удалено старых записей журнала: ${doomed.length}`);
  } catch (e) {
    console.warn('[CargoAudit] чистка журнала не удалась (не критично):', e);
  }
}

export const AuditLog = {
  /** MIGRATION → INSERT INTO cargo_audit_log (...) VALUES (...) */
  async record(entry: Omit<CargoAuditEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      const now = Date.now();
      const id  = `caudit_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const full: CargoAuditEntry = { ...entry, id, timestamp: new Date(now).toISOString() };
      await kv.set(`${PREFIX}${now}:${id}`, full);
    } catch (e) {
      // Аудит не должен ронять основной запрос админа
      console.warn('[CargoAudit] record failed (non-fatal):', e);
    }
  },

  /**
   * MIGRATION → SELECT * FROM cargo_audit_log WHERE ... ORDER BY created_at DESC LIMIT/OFFSET
   * KV не умеет фильтровать/пагинировать на стороне БД — делаем в памяти.
   */
  async list(filter?: {
    actorEmail?: string;
    targetId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: CargoAuditEntry[]; total: number }> {
    const all = (await kv.getByPrefix(PREFIX)) as CargoAuditEntry[];
    const valid = all.filter(e => e && typeof e === 'object' && e.id);
    // Чистку запускаем отсюда: страницу аудита открывают регулярно, а отдельного
    // планировщика у edge-функции нет. Ответ админу не ждёт — fire-and-forget.
    pruneIfDue(valid).catch(() => {});
    let filtered = valid;

    if (filter?.actorEmail) filtered = filtered.filter(e => e.actorEmail === filter.actorEmail);
    if (filter?.targetId)   filtered = filtered.filter(e => e.targetId === filter.targetId);
    if (filter?.action)     filtered = filtered.filter(e => e.action === filter.action);

    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total  = filtered.length;
    const offset = filter?.offset || 0;
    const limit  = filter?.limit || 100;
    return { entries: filtered.slice(offset, offset + limit), total };
  },
};

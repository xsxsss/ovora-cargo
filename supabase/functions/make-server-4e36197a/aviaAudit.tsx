/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AVIA AUDIT LOG — журнал действий курьеров и отправителей   ║
 * ║                                                              ║
 * ║  KV-ключ: ovora:avia-audit:{timestampMs}:{id}                ║
 * ║  Сортировка по времени достигается префиксом timestamp —     ║
 * ║  при миграции на SQL заменить на ORDER BY created_at DESC.   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import * as kv from "./kv_store.tsx";

export type AviaAuditAction =
  | 'user.register' | 'user.login' | 'user.profile_update' | 'user.passport_upload'
  | 'user.pin_change'
  | 'user.admin_edit' | 'user.admin_block' | 'user.admin_unblock'
  | 'user.passport_verification_status_changed'
  | 'user.admin_delete' | 'user.admin_reset_code'
  | 'flight.create' | 'flight.edit' | 'flight.delete'
  | 'flight.start' | 'flight.close' | 'flight.complete'
  | 'flight.admin_status_change'
  | 'deal.create' | 'deal.accept' | 'deal.reject' | 'deal.cancel' | 'deal.complete'
  | 'deal.pod_upload' | 'deal.delete' | 'deal.admin_delete'
  | 'chat.delete'
  | 'blacklist.admin_remove'
  | 'settings.admin_update'
  // Сквозной журнал админки: вход в панель и любое изменяющее обращение
  // к /avia/admin/*, которое обработчик не залогировал подробно.
  | 'admin.login' | 'admin.request';

export interface AviaAuditEntry {
  id        : string;
  timestamp : string;
  action    : AviaAuditAction;
  actorPhone: string;
  /** Затронутый объект (dealId / flightId / phone пользователя) */
  targetId  ?: string;
  targetType?: 'deal' | 'flight' | 'user' | 'chat' | 'blacklist' | 'settings' | 'session' | 'request';
  details   ?: Record<string, unknown>;
}

const PREFIX = 'ovora:avia-audit:';

// ── Ретенция ────────────────────────────────────────────────────────────────
// Журнал лежит в KV, а list() читает его целиком. Со сквозным журналом админки
// записей стало заметно больше, поэтому без чистки он однажды упрётся в память.
// Держим полгода и не больше MAX_ENTRIES записей; чистим не чаще раза в
// час, чтобы не дёргать БД на каждом открытии страницы аудита.
const RETENTION_MS   = 180 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES    = 5000;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const PRUNE_MARK     = 'ovora:avia-audit-pruned-at';

// getByPrefix отдаёт только значения, без ключей — поэтому ключ собираем
// обратно из самой записи, ровно так же, как его составлял record().
function entryKey(e: AviaAuditEntry): string {
  return `${PREFIX}${new Date(e.timestamp).getTime()}:${e.id}`;
}

async function pruneIfDue(all: AviaAuditEntry[]): Promise<void> {
  try {
    const mark: any = await kv.get(PRUNE_MARK);
    if (mark?.at && Date.now() - mark.at < PRUNE_EVERY_MS) return;
    await kv.set(PRUNE_MARK, { at: Date.now() });

    const cutoff = Date.now() - RETENTION_MS;
    const sorted = [...all].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const doomed = sorted.filter((e, i) => i >= MAX_ENTRIES || new Date(e.timestamp).getTime() < cutoff);
    if (doomed.length === 0) return;

    await kv.mdel(doomed.map(entryKey));
    console.log(`[AviaAudit] удалено старых записей журнала: ${doomed.length}`);
  } catch (e) {
    console.warn('[AviaAudit] чистка журнала не удалась (не критично):', e);
  }
}

export const AuditLog = {
  /** MIGRATION → INSERT INTO avia_audit_log (...) VALUES (...) */
  async record(entry: Omit<AviaAuditEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      const now = Date.now();
      const id  = `aaudit_${now}_${Math.random().toString(36).slice(2, 8)}`;
      const full: AviaAuditEntry = { ...entry, id, timestamp: new Date(now).toISOString() };
      await kv.set(`${PREFIX}${now}:${id}`, full);
    } catch (e) {
      // Аудит не должен ронять основной запрос пользователя
      console.warn('[AviaAudit] record failed (non-fatal):', e);
    }
  },

  /**
   * MIGRATION → SELECT * FROM avia_audit_log WHERE ... ORDER BY created_at DESC LIMIT/OFFSET
   * KV не умеет фильтровать/пагинировать на стороне БД — делаем в памяти.
   */
  async list(filter?: {
    actorPhone?: string;
    targetId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ entries: AviaAuditEntry[]; total: number }> {
    const all = (await kv.getByPrefix(PREFIX)) as AviaAuditEntry[];
    const valid = all.filter(e => e && typeof e === 'object' && e.id);
    // Чистку запускаем отсюда: страницу аудита открывают регулярно, а отдельного
    // планировщика у edge-функции нет. Ответ админу не ждёт — fire-and-forget.
    pruneIfDue(valid).catch(() => {});
    let filtered = valid;

    if (filter?.actorPhone) filtered = filtered.filter(e => e.actorPhone === filter.actorPhone);
    if (filter?.targetId)   filtered = filtered.filter(e => e.targetId === filter.targetId);
    if (filter?.action)     filtered = filtered.filter(e => e.action === filter.action);

    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total  = filtered.length;
    const offset = filter?.offset || 0;
    const limit  = filter?.limit || 100;
    return { entries: filtered.slice(offset, offset + limit), total };
  },
};

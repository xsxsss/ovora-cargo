/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AVIA REPOSITORY LAYER — Data Access Abstraction            ║
 * ║                                                              ║
 * ║  Текущая реализация: Supabase KV Store                      ║
 * ║                                                              ║
 * ║  MIGRATION PATH → PostgreSQL:                               ║
 * ║    Каждая функция → SQL-запрос через supabase-js.           ║
 * ║    Сигнатуры функций ОСТАЮТСЯ НЕИЗМЕННЫМИ.                  ║
 * ║    Маршруты (aviaRoutes.tsx) не требуют изменений.          ║
 * ║                                                              ║
 * ║  MIGRATION PATH → Redis (для горячих данных):               ║
 * ║    Совмещать с PostgreSQL: пишем в обе БД, читаем из Redis. ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * KV-префиксы (изолированное пространство AVIA):
 *   ovora:avia-user:{phone}            → AviaUser
 *   ovora:avia-pin:{phone}             → AviaPin
 *   ovora:avia-pin-change:{phone}      → AviaPinChange
 *   ovora:air-flight:{id}              → AviaFlight
 *   ovora:avia-notif:{phone}:{id}      → AviaNotif
 *   ovora:avia-deal:{id}               → AviaDeal
 *   ovora:avia-userdeal:{phone}:{id}   → { dealId, role }
 *   ovora:avia-chatmeta:{chatId}       → AviaChatMeta
 *   ovora:avia-chat:{chatId}:{msgId}   → AviaMessage
 *   ovora:avia-userchats:{phone}:{chatId} → { chatId }
 *   ovora:avia-review:{id}             → AviaReview
 *   ovora:avia-userreviews:{phone}:{id}→ AviaReview (index)
 *   ovora:avia-dealreviewed:{dealId}   → { byInitiator, byRecipient }
 *   ovora:avia-audit:{ts}:{id}         → AviaAuditEntry (см. aviaAudit.tsx)
 */

import * as kv from "./kv_store.tsx";
import { aviaCache, CK, TTL } from "./cache.tsx";

// ══════════════════════════════════════════════════════════════════════════════
//  ТИПЫ — контракт миграции (неизменны при переходе на SQL)
// ══════════════════════════════════════════════════════════════════════════════

export interface AviaUser {
  id               : string;
  phone            : string;
  role             : 'courier' | 'sender';
  firstName        : string;
  lastName         : string;
  middleName       : string;
  birthDate        : string;
  passportNumber   : string;
  passportPhoto    : string;
  passportPhotoPath: string;
  passportUploadedAt   ?: string;
  passportExpiryDate   ?: string;
  passportVerified     ?: boolean;
  passportExpired      ?: boolean;
  avatarUrl        : string;
  city             ?: string;
  telegram         ?: string;
  createdAt        : string;
  lastLoginAt      : string;
  updatedAt        ?: string;
  blocked          ?: boolean;
  blockedAt        ?: string;
  blockedReason    ?: string;
}

export interface AviaPin {
  pinHash   : string;
  phone     : string;
  attempts  : number;
  createdAt : string;
  updatedAt ?: string;
}

export interface AviaPinChange {
  attempts     : number;
  lockedUntil  : string | null;
  lastAttempt  : string;
}

export interface AviaFlight {
  id            : string;
  courierId     : string;
  courierName   : string;
  courierAvatar : string;
  from          : string;
  to            : string;
  date          : string;
  flightNo      : string;
  cargoEnabled  : boolean;
  cargoKg       : number;
  freeKg        : number;
  reservedKg    : number;
  pricePerKg    : number;
  docsEnabled   : boolean;
  docsPrice     : number;
  /** Сколько пакетов документов курьер готов взять. Документы считаются
   *  в штуках и НЕ вычитаются из грузовых килограммов — у курьера это
   *  отдельная «полка», и так же конверт продают DHL/FedEx: отдельной
   *  позицией по фиксированной цене, а не по весу. */
  docsCount     : number;
  /** Сколько пакетов ещё свободно */
  docsFree      : number;
  /** Пакеты по заявкам, которые ждут ответа курьера */
  docsReserved  : number;
  currency      : string;
  status        : string;
  isDeleted     ?: boolean;
  startedAt     ?: string;
  closedAt      ?: string;
  completedAt   ?: string;
  createdAt     : string;
  updatedAt     ?: string;
  /** Причина принудительной смены статуса админом (модерация) */
  moderationReason?: string;
  moderationBy     ?: string;
  moderationAt     ?: string;
}

export interface AviaNotif {
  id         : string;
  phone      : string;
  type       : string;
  iconName   : string;
  iconBg     : string;
  title      : string;
  description: string;
  isUnread   : boolean;
  createdAt  : string;
  meta       ?: Record<string, any>;
}

export interface AviaDeal {
  id             : string;
  initiatorPhone : string;
  initiatorName  : string;
  recipientPhone : string;
  recipientName  : string;
  adType         : string;
  adId           : string;
  adFrom         : string;
  adTo           : string;
  adDate         : string | null;
  weightKg       : number;
  price          : number | null;
  currency       : string;
  message        : string;
  courierId      : string;
  senderId       : string;
  courierName    : string;
  senderName     : string;
  dealType       : 'cargo' | 'docs';
  /** Сколько пакетов документов отправляют (для dealType === 'docs') */
  docsCount      ?: number;
  status         : string;
  createdAt      : string;
  updatedAt      : string;
  acceptedAt     ?: string;
  rejectedAt     ?: string;
  cancelledAt    ?: string;
  completedAt    ?: string;
  rejectReason   ?: string;
  cancelReason   ?: string;
  deletedAt      ?: string;
  podPhotos      ?: AviaPODPhoto[];
  /** Напоминание о зависшей в pending сделке (>24ч) уже отправлено — чтобы не дублировать */
  reminderSent   ?: boolean;
}

export interface AviaPODPhoto {
  url      : string;
  path     : string;
  timestamp: string;
  uploadedBy: string;
}

export interface AviaChatMeta {
  chatId          : string;
  participants    : string[];
  adRef           ?: any;
  lastMessage     : string | null;
  lastMessageAt   : string | null;
  lastSenderPhone : string | null;
  unreadBy        : Record<string, number>;
  lastSeenBy      ?: Record<string, string>;
  createdAt       : string;
  updatedAt       ?: string;
}

export interface AviaMessage {
  id          : string;
  chatId      : string;
  senderPhone : string;
  text        : string;
  type        : string;
  meta        ?: Record<string, any>;
  createdAt   : string;
  deleted     ?: boolean;
}

export interface AviaReview {
  id            : string;
  dealId        : string;
  authorPhone   : string;
  authorName    : string;
  recipientPhone: string;
  type          : 'like' | 'dislike';
  comment       : string;
  authorRole    : string;
  createdAt     : string;
}

// ══════════════════════════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════════════════════════
export const Users = {
  /** MIGRATION → SELECT * FROM avia_users WHERE phone = $1 */
  async get(phone: string): Promise<AviaUser | null> {
    const cached = aviaCache.get<AviaUser>(CK.user(phone));
    if (cached) return cached;

    const user = await kv.get(`ovora:avia-user:${phone}`) as AviaUser | null;
    if (!user) return null;

    // Legacy-миграция: роль "both" удалена из системы — принудительно переводим на "sender"
    if ((user.role as string) === 'both') {
      user.role = 'sender';
      await kv.set(`ovora:avia-user:${phone}`, user);
    }

    aviaCache.set(CK.user(phone), user, TTL.USER_PROFILE);
    return user;
  },

  /** MIGRATION → INSERT INTO avia_users ... ON CONFLICT (phone) DO UPDATE ... */
  async set(phone: string, user: AviaUser): Promise<void> {
    await kv.set(`ovora:avia-user:${phone}`, user);
    aviaCache.set(CK.user(phone), user, TTL.USER_PROFILE);
    aviaCache.del(CK.publicProfile(phone));
    aviaCache.del(CK.stats(phone));
  },

  /** MIGRATION → UPDATE avia_users SET ... WHERE phone = $1 RETURNING * */
  async update(phone: string, updates: Partial<AviaUser>): Promise<AviaUser | null> {
    const existing = await this.get(phone);
    if (!existing) return null;
    const updated = { ...existing, ...updates, phone: existing.phone, id: existing.id, updatedAt: new Date().toISOString() };
    await this.set(phone, updated);
    return updated;
  },

  /** MIGRATION → SELECT * FROM avia_users (только для админ-панели) */
  async listAll(): Promise<AviaUser[]> {
    const all = await kv.getByPrefix('ovora:avia-user:') as AviaUser[];
    return all.filter(u => u && typeof u === 'object' && u.phone);
  },

  /** MIGRATION → DELETE FROM avia_users WHERE phone = $1 */
  async hardDelete(phone: string): Promise<void> {
    await kv.del(`ovora:avia-user:${phone}`);
    aviaCache.del(CK.user(phone));
    aviaCache.del(CK.publicProfile(phone));
    aviaCache.del(CK.stats(phone));
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  PINS
// ══════════════════════════════════════════════════════════════════════════════
export const Pins = {
  /** MIGRATION → SELECT * FROM avia_pins WHERE phone = $1 */
  async get(phone: string): Promise<AviaPin | null> {
    // PIN не кешируем — безопасность важнее скорости
    return await kv.get(`ovora:avia-pin:${phone}`) as AviaPin | null;
  },

  /** MIGRATION → INSERT INTO avia_pins ... ON CONFLICT DO UPDATE ... */
  async set(phone: string, pin: AviaPin): Promise<void> {
    await kv.set(`ovora:avia-pin:${phone}`, pin);
  },

  async getPinChange(phone: string): Promise<AviaPinChange | null> {
    return await kv.get(`ovora:avia-pin-change:${phone}`) as AviaPinChange | null;
  },

  async setPinChange(phone: string, data: AviaPinChange): Promise<void> {
    await kv.set(`ovora:avia-pin-change:${phone}`, data);
  },

  async delPinChange(phone: string): Promise<void> {
    await kv.del(`ovora:avia-pin-change:${phone}`);
  },

  /** MIGRATION → DELETE FROM avia_pins WHERE phone = $1 */
  async del(phone: string): Promise<void> {
    await kv.del(`ovora:avia-pin:${phone}`);
    await kv.del(`ovora:avia-pin-change:${phone}`);
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  FLIGHTS
// ══════════════════════════════════════════════════════════════════════════════
export const Flights = {
  /** MIGRATION → SELECT * FROM avia_flights WHERE id = $1 */
  async get(id: string): Promise<AviaFlight | null> {
    return await kv.get(`ovora:air-flight:${id}`) as AviaFlight | null;
  },

  /** MIGRATION → INSERT / UPDATE avia_flights */
  async set(id: string, flight: AviaFlight): Promise<void> {
    await kv.set(`ovora:air-flight:${id}`, flight);
    aviaCache.del(CK.flightsList());
    aviaCache.del(CK.myFlights(flight.courierId));
  },

  /**
   * MIGRATION → SELECT * FROM avia_flights WHERE NOT is_deleted AND status NOT IN ('closed','completed')
   * ORDER BY created_at DESC
   */
  async listActive(): Promise<AviaFlight[]> {
    const cached = aviaCache.get<AviaFlight[]>(CK.flightsList());
    if (cached) return cached;

    const all = await kv.getByPrefix('ovora:air-flight:') as AviaFlight[];
    const result = all
      .filter(f => {
        if (!f || typeof f !== 'object' || f.isDeleted) return false;
        // in_progress — поездка уже начата, скрываем от публичного поиска, чтобы не приходили новые заявки
        if (f.status === 'closed' || f.status === 'completed' || f.status === 'in_progress') return false;
        // Скрываем рейс, когда занято всё, что он предлагает. Раньше проверялся
        // только груз, а документы считались безлимитными — рейс с документами
        // не исчезал из поиска никогда, сколько бы заявок курьер ни набрал.
        const cargoFull = !f.cargoEnabled || (f.freeKg || 0) - (f.reservedKg || 0) <= 0;
        // Рейсы, созданные до появления лимита пакетов, живут без docsCount —
        // для них документы по-прежнему без ограничений, чтобы не убрать из
        // поиска уже опубликованные рейсы. Лимит появится при их правке.
        const docsFull = !f.docsEnabled
          || (f.docsCount == null ? false : (f.docsFree || 0) - (f.docsReserved || 0) <= 0);
        if (cargoFull && docsFull) return false;
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    aviaCache.set(CK.flightsList(), result, TTL.FLIGHTS_LIST);
    return result;
  },

  /**
   * MIGRATION → SELECT * FROM avia_flights WHERE courier_id = $1 AND NOT is_deleted
   * ORDER BY created_at DESC
   */
  async listByCourier(phone: string): Promise<AviaFlight[]> {
    const cached = aviaCache.get<AviaFlight[]>(CK.myFlights(phone));
    if (cached) return cached;

    const all = await kv.getByPrefix('ovora:air-flight:') as AviaFlight[];
    const result = all
      .filter(f => f && typeof f === 'object' && !f.isDeleted && f.courierId === phone)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    aviaCache.set(CK.myFlights(phone), result, TTL.FLIGHTS_LIST);
    return result;
  },

  invalidate(courierId?: string): void {
    aviaCache.del(CK.flightsList());
    if (courierId) aviaCache.del(CK.myFlights(courierId));
  },

  /** MIGRATION → SELECT * FROM avia_flights (только для админ-панели) */
  async listAll(): Promise<AviaFlight[]> {
    const all = await kv.getByPrefix('ovora:air-flight:') as AviaFlight[];
    return all
      .filter(f => f && typeof f === 'object' && f.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════════
export const Notifs = {
  /**
   * MIGRATION → SELECT * FROM avia_notifications WHERE phone = $1
   * ORDER BY created_at DESC
   */
  async list(phone: string): Promise<AviaNotif[]> {
    const cached = aviaCache.get<AviaNotif[]>(CK.notifList(phone));
    if (cached) return cached;

    const all = await kv.getByPrefix(`ovora:avia-notif:${phone}:`) as AviaNotif[];
    const result = all
      .filter(n => n && n.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    aviaCache.set(CK.notifList(phone), result, TTL.NOTIF_LIST);
    return result;
  },

  /** MIGRATION → SELECT COUNT(*) FROM avia_notifications WHERE phone=$1 AND is_unread=true */
  async countUnread(phone: string): Promise<number> {
    const cached = aviaCache.get<number>(CK.notifCount(phone));
    if (cached !== null) return cached;

    const all = await kv.getByPrefix(`ovora:avia-notif:${phone}:`) as AviaNotif[];
    const count = all.filter(n => n && n.isUnread).length;
    aviaCache.set(CK.notifCount(phone), count, TTL.NOTIF_COUNT);
    return count;
  },

  /** MIGRATION → INSERT INTO avia_notifications ... */
  async push(phone: string, notif: AviaNotif): Promise<void> {
    await kv.set(`ovora:avia-notif:${phone}:${notif.id}`, notif);
    aviaCache.del(CK.notifList(phone));
    aviaCache.del(CK.notifCount(phone));
  },

  /** MIGRATION → UPDATE avia_notifications SET is_unread=false WHERE phone=$1 AND id=$2 */
  async markRead(phone: string, id: 'all' | string): Promise<number> {
    let count = 0;
    if (id === 'all') {
      const all = await kv.getByPrefix(`ovora:avia-notif:${phone}:`) as AviaNotif[];
      for (const n of all) {
        if (n?.id && n.isUnread) {
          await kv.set(`ovora:avia-notif:${phone}:${n.id}`, { ...n, isUnread: false });
          count++;
        }
      }
    } else {
      const n = await kv.get(`ovora:avia-notif:${phone}:${id}`) as AviaNotif | null;
      if (n) {
        await kv.set(`ovora:avia-notif:${phone}:${id}`, { ...n, isUnread: false });
        count = 1;
      }
    }
    aviaCache.del(CK.notifList(phone));
    aviaCache.del(CK.notifCount(phone));
    return count;
  },

  /** MIGRATION → DELETE FROM avia_notifications WHERE phone=$1 AND id=$2 */
  async del(phone: string, id: string): Promise<void> {
    await kv.del(`ovora:avia-notif:${phone}:${id}`);
    aviaCache.del(CK.notifList(phone));
    aviaCache.del(CK.notifCount(phone));
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  DEALS
// ══════════════════════════════════════════════════════════════════════════════
export const Deals = {
  /** MIGRATION → SELECT * FROM avia_deals WHERE id = $1 */
  async get(id: string): Promise<AviaDeal | null> {
    const cached = aviaCache.get<AviaDeal>(CK.deal(id));
    if (cached) return cached;
    const deal = await kv.get(`ovora:avia-deal:${id}`) as AviaDeal | null;
    if (deal) aviaCache.set(CK.deal(id), deal, TTL.DEAL);
    return deal;
  },

  /** MIGRATION → INSERT / UPDATE avia_deals */
  async set(id: string, deal: AviaDeal): Promise<void> {
    await kv.set(`ovora:avia-deal:${id}`, deal);
    aviaCache.set(CK.deal(id), deal, TTL.DEAL);
    aviaCache.del(CK.userDeals(deal.initiatorPhone));
    aviaCache.del(CK.userDeals(deal.recipientPhone));
  },

  /**
   * MIGRATION → SELECT d.* FROM avia_deals d
   * JOIN avia_deal_participants p ON p.deal_id = d.id
   * WHERE p.phone = $1 AND d.deleted_at IS NULL
   */
  async listByUser(phone: string): Promise<AviaDeal[]> {
    const cached = aviaCache.get<AviaDeal[]>(CK.userDeals(phone));
    if (cached) return cached;

    const index = await kv.getByPrefix(`ovora:avia-userdeal:${phone}:`) as { dealId: string }[];
    const deals: AviaDeal[] = [];
    for (const entry of index) {
      if (!entry?.dealId) continue;
      const deal = await this.get(entry.dealId);
      if (deal && !deal.deletedAt) deals.push(deal);
    }
    deals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    aviaCache.set(CK.userDeals(phone), deals, TTL.DEAL);
    return deals;
  },

  /** MIGRATION → INSERT INTO avia_deal_participants (deal_id, phone, role) */
  async addParticipant(phone: string, dealId: string, role: 'initiator' | 'recipient'): Promise<void> {
    await kv.set(`ovora:avia-userdeal:${phone}:${dealId}`, { dealId, role });
    aviaCache.del(CK.userDeals(phone));
  },

  /** MIGRATION → SELECT d.* FROM avia_deals d WHERE d.initiator_phone=$1 AND d.ad_id=$2 */
  async findActiveByInitiatorAndAd(phone: string, adId: string, adType: string, recipientPhone: string): Promise<AviaDeal | null> {
    const userDeals = await this.listByUser(phone);
    return userDeals.find(d =>
      d.adId === adId &&
      d.adType === adType &&
      d.recipientPhone === recipientPhone &&
      (d.status === 'pending' || d.status === 'accepted')
    ) || null;
  },

  /** MIGRATION → SELECT * FROM avia_deals (только для админ-панели, включая удалённые) */
  async listAll(): Promise<AviaDeal[]> {
    const all = await kv.getByPrefix('ovora:avia-deal:') as AviaDeal[];
    return all
      .filter(d => d && typeof d === 'object' && d.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  CHATS
// ══════════════════════════════════════════════════════════════════════════════
export const Chats = {
  /** MIGRATION → SELECT * FROM avia_chats WHERE chat_id = $1 */
  async getMeta(chatId: string): Promise<AviaChatMeta | null> {
    const cached = aviaCache.get<AviaChatMeta>(CK.chatMeta(chatId));
    if (cached) return cached;
    const meta = await kv.get(`ovora:avia-chatmeta:${chatId}`) as AviaChatMeta | null;
    if (meta) aviaCache.set(CK.chatMeta(chatId), meta, TTL.CHAT_META);
    return meta;
  },

  /** MIGRATION → INSERT INTO avia_chats ... ON CONFLICT DO UPDATE ... */
  async setMeta(chatId: string, meta: AviaChatMeta): Promise<void> {
    await kv.set(`ovora:avia-chatmeta:${chatId}`, meta);
    aviaCache.set(CK.chatMeta(chatId), meta, TTL.CHAT_META);
    for (const p of meta.participants) aviaCache.del(CK.userChats(p));
  },

  /** MIGRATION → SELECT * FROM avia_messages WHERE chat_id=$1 ORDER BY created_at ASC */
  async getMessages(chatId: string): Promise<AviaMessage[]> {
    const all = await kv.getByPrefix(`ovora:avia-chat:${chatId}:`) as AviaMessage[];
    return all
      .filter(m => m && m.id && !m.deleted)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  /** MIGRATION → INSERT INTO avia_messages ... */
  async addMessage(chatId: string, msg: AviaMessage): Promise<void> {
    await kv.set(`ovora:avia-chat:${chatId}:${msg.id}`, msg);
  },

  /** MIGRATION → SELECT c.* FROM avia_chats c JOIN avia_chat_participants p ON p.chat_id=c.chat_id WHERE p.phone=$1 */
  async listByUser(phone: string): Promise<(AviaChatMeta & { unread: number })[]> {
    const cached = aviaCache.get<any[]>(CK.userChats(phone));
    if (cached) return cached;

    const index = await kv.getByPrefix(`ovora:avia-userchats:${phone}:`) as { chatId: string }[];
    const chats: (AviaChatMeta & { unread: number })[] = [];
    for (const entry of index) {
      if (!entry?.chatId) continue;
      const meta = await this.getMeta(entry.chatId);
      if (!meta) continue;
      chats.push({ ...meta, unread: meta.unreadBy?.[phone] || 0 });
    }
    chats.sort((a, b) =>
      new Date(b.lastMessageAt || b.createdAt || 0).getTime() -
      new Date(a.lastMessageAt || a.createdAt || 0).getTime()
    );
    aviaCache.set(CK.userChats(phone), chats, TTL.CHAT_META);
    return chats;
  },

  async addUserIndex(phone: string, chatId: string): Promise<void> {
    await kv.set(`ovora:avia-userchats:${phone}:${chatId}`, { chatId });
    aviaCache.del(CK.userChats(phone));
  },

  async delUserIndex(phone: string, chatId: string): Promise<void> {
    await kv.del(`ovora:avia-userchats:${phone}:${chatId}`);
    aviaCache.del(CK.userChats(phone));
  },

  async delMeta(chatId: string): Promise<void> {
    await kv.del(`ovora:avia-chatmeta:${chatId}`);
    aviaCache.del(CK.chatMeta(chatId));
  },

  async delMessages(chatId: string): Promise<void> {
    const msgs = await kv.getByPrefix(`ovora:avia-chat:${chatId}:`) as AviaMessage[];
    const keys = msgs.filter(m => m?.id).map(m => `ovora:avia-chat:${chatId}:${m.id}`);
    if (keys.length > 0) await kv.mdel(keys);
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  REVIEWS
// ══════════════════════════════════════════════════════════════════════════════
export const Reviews = {
  /** MIGRATION → SELECT * FROM avia_reviews WHERE recipient_phone=$1 ORDER BY created_at DESC */
  async listByUser(phone: string): Promise<AviaReview[]> {
    const cached = aviaCache.get<AviaReview[]>(CK.reviewsUser(phone));
    if (cached) return cached;

    const all = await kv.getByPrefix(`ovora:avia-userreviews:${phone}:`) as AviaReview[];
    const result = all
      .filter(r => r && r.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    aviaCache.set(CK.reviewsUser(phone), result, TTL.PUBLIC_PROFILE);
    return result;
  },

  /** MIGRATION → SELECT * FROM avia_deal_reviews WHERE deal_id=$1 */
  async getDealStatus(dealId: string): Promise<{ byInitiator: boolean; byRecipient: boolean }> {
    const cached = aviaCache.get<any>(CK.reviewsDeal(dealId));
    if (cached) return cached;

    const data = (await kv.get(`ovora:avia-dealreviewed:${dealId}`)) as any || {};
    const result = { byInitiator: !!data.byInitiator, byRecipient: !!data.byRecipient };
    aviaCache.set(CK.reviewsDeal(dealId), result, TTL.DEAL);
    return result;
  },

  /** Статус по списку сделок за один проход (вместо N отдельных HTTP-запросов с фронта) */
  async getDealStatusBatch(dealIds: string[]): Promise<Record<string, { byInitiator: boolean; byRecipient: boolean }>> {
    const unique = [...new Set(dealIds)];
    const entries = await Promise.all(unique.map(async (dealId) => [dealId, await this.getDealStatus(dealId)] as const));
    return Object.fromEntries(entries);
  },

  /** MIGRATION → INSERT INTO avia_reviews ... */
  async add(review: AviaReview): Promise<void> {
    await kv.set(`ovora:avia-review:${review.id}`, review);
    await kv.set(`ovora:avia-userreviews:${review.recipientPhone}:${review.id}`, review);
    aviaCache.del(CK.reviewsUser(review.recipientPhone));
    aviaCache.del(CK.publicProfile(review.recipientPhone));
  },

  async setDealStatus(dealId: string, status: { byInitiator?: boolean; byRecipient?: boolean }): Promise<void> {
    const existing = await this.getDealStatus(dealId);
    const updated = {
      byInitiator: status.byInitiator ?? existing.byInitiator,
      byRecipient: status.byRecipient ?? existing.byRecipient,
    };
    await kv.set(`ovora:avia-dealreviewed:${dealId}`, updated);
    aviaCache.del(CK.reviewsDeal(dealId));
  },
};

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Нормализация телефона */
export function aviaClean(phone: string): string {
  return (phone || '').replace(/\D/g, '');
}

/** Канонический chatId (сортировка двух телефонов) */
export function aviaChatId(phone1: string, phone2: string): string {
  const [a, b] = [phone1, phone2].sort();
  return `${a}_${b}`;
}

/** Генератор ID */
export function aviaId(prefix = 'avia'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

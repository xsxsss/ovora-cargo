/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AVIA RATE LIMITER — Token Bucket (In-Memory)               ║
 * ║                                                              ║
 * ║  MIGRATION PATH → Redis:                                     ║
 * ║    Заменить bucket-store на:                                 ║
 * ║      `await redis.incr(key)` + `redis.pexpire(key, windowMs)`║
 * ║    Интерфейс check() остаётся неизменным.                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

interface BucketEntry {
  tokens   : number;
  windowEnd: number;
}

class TokenBucketLimiter {
  // ── MIGRATION: заменить на Redis-клиент ───────────────────────────────────
  private buckets  = new Map<string, BucketEntry>();
  private maxBuckets = 200_000; // ~50M users × несколько endpoint'ов

  /**
   * Проверить и уменьшить лимит.
   * @returns `allowed` — разрешить запрос?
   */
  check(
    id       : string,
    max      : number,
    windowMs : number,
  ): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now    = Date.now();
    const bucket = this.buckets.get(id);

    // Новое окно или первый запрос
    if (!bucket || now >= bucket.windowEnd) {
      // MIGRATION: await redis.set(id, max - 1, 'PX', windowMs, 'NX')
      this.evictIfNeeded();
      this.buckets.set(id, { tokens: max - 1, windowEnd: now + windowMs });
      return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
    }

    if (bucket.tokens > 0) {
      // MIGRATION: await redis.decr(id)
      bucket.tokens--;
      return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }

    return {
      allowed      : false,
      remaining    : 0,
      retryAfterMs : bucket.windowEnd - now,
    };
  }

  /** Исчерпан ли лимит — без расходования попытки. */
  isBlocked(id: string): boolean {
    const bucket = this.buckets.get(id);
    return !!bucket && Date.now() < bucket.windowEnd && bucket.tokens <= 0;
  }

  /** Сбросить лимит (после успешной смены PIN, выхода и т.д.) */
  reset(id: string): void {
    // MIGRATION: await redis.del(id)
    this.buckets.delete(id);
  }

  /** Вытесняем старые записи при переполнении */
  private evictIfNeeded(): void {
    if (this.buckets.size < this.maxBuckets) return;
    const now    = Date.now();
    let evicted  = 0;
    for (const [k, v] of this.buckets) {
      if (now >= v.windowEnd) {
        this.buckets.delete(k);
        evicted++;
        if (this.buckets.size < this.maxBuckets * 0.8) break;
      }
    }
    // Если истёкших нет — удаляем первые 20%
    if (evicted === 0) {
      let del = Math.floor(this.maxBuckets * 0.2);
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        if (--del <= 0) break;
      }
    }
  }
}

// ── Глобальный экземпляр (AVIA-изолированный) ────────────────────────────────
export const aviaRL = new TokenBucketLimiter();

// ── Rate-limit presets (50M users — агрессивная защита) ──────────────────────
export const RL = {
  CHECK_PHONE  : { max: 10,  windowMs: 60_000        }, // 10/мин на IP/phone
  REGISTER     : { max: 3,   windowMs: 3_600_000     }, // 3/час
  LOGIN        : { max: 15,  windowMs: 300_000       }, // 15/5мин
  PIN_CHANGE   : { max: 3,   windowMs: 300_000       }, // 3/5мин
  UPLOAD       : { max: 3,   windowMs: 3_600_000     }, // 3/час
  MESSAGE      : { max: 60,  windowMs: 60_000        }, // 60/мин
  DEAL_CREATE  : { max: 10,  windowMs: 3_600_000     }, // 10/час
  GENERAL_READ : { max: 120, windowMs: 60_000        }, // 120/мин — чтение
  GENERAL_WRITE: { max: 30,  windowMs: 60_000        }, // 30/мин — запись
} as const;

// ── Hono middleware factory ───────────────────────────────────────────────────
/**
 * Создаёт Hono middleware для rate limiting.
 * id извлекается из запроса — по phone из body/params или по IP.
 */
export function rateLimitMiddleware(
  preset: { max: number; windowMs: number },
  getId : (c: any) => string = (c) => {
    const jwtEmail = c.get?.("verifiedEmail");
    if (jwtEmail) return `user:${jwtEmail}`;
    return `ip:${c.req.header('x-forwarded-for') || 'unknown'}`;
  },
) {
  return async (c: any, next: any) => {
    const id     = getId(c);
    const result = aviaRL.check(id, preset.max, preset.windowMs);

    c.header('X-RateLimit-Limit'    , String(preset.max));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      console.warn(`[RateLimit] BLOCKED ${id} | path=${c.req.path} | retryIn=${Math.ceil(result.retryAfterMs / 1000)}s`);
      return c.json({
        error       : 'Слишком много запросов. Подождите и попробуйте снова.',
        retryAfterMs: result.retryAfterMs,
      }, 429);
    }

    return next();
  };
}

// ── Авто-очистка истёкших bucket'ов (раз в 10 мин) ───────────────────────────
setInterval(() => {
  // Тригерим evictIfNeeded косвенно через check с несуществующим ключом
  // MIGRATION: Redis TTL делает это автоматически
  (aviaRL as any).evictIfNeeded?.();
}, 10 * 60_000);

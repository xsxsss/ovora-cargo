// ══════════════════════════════════════════════════════════════════════════════
//  USER-DEFINED 6-DIGIT ACCESS CODE SYSTEM
//  Схема:
//   • Пользователь сам придумывает 6-цифровой код
//   • В KV хранится только bcrypt-хеш — сырой код нигде не сохраняется
//   • Новый email → пользователь создаёт код → сохраняется bcrypt-хеш
//   • Повторный вход → пользователь вводит свой код → bcrypt.compare
//   • Забыл код → Telegram поддержка
//   • bcrypt (cost=12) намного медленнее SHA-256 → брутфорс практически невозможен
// ══════════════════════════════════════════════════════════════════════════════

import type { Context } from "npm:hono";
import * as kv from "./kv_store.tsx";
import * as bcrypt from "npm:bcryptjs";
import { signUserToken } from "./userAuth.tsx";
import { rememberAuthUserId } from "./authIdentity.tsx";
import { recordLoginDevice } from "./deviceInfo.tsx";

const MAX_ATTEMPTS = 10;
const BCRYPT_ROUNDS = 12; // Высокий cost-фактор = медленный брутфорс

// ✅ FIX N-2: in-process rate limiter для /auth/email-check (5 запросов / 60s на IP)
const emailCheckRateMap = new Map<string, { count: number; resetAt: number }>();
function emailCheckRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = emailCheckRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    emailCheckRateMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true; // allowed
  }
  if (entry.count >= 10) return false; // blocked
  entry.count++;
  return true;
}

const permKey = (email: string) => `ovora:perm_code:email:${email}`;

/** bcrypt-хеш кода */
async function hashCode(code: string): Promise<string> {
  const salt = await bcrypt.genSalt(BCRYPT_ROUNDS);
  return bcrypt.hash(code.trim(), salt);
}

/** Сравнение кода с bcrypt-хешем */
async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code.trim(), hash);
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST /auth/email-check
//  Возвращает: hasCode true/false (новый или вернувшийся пользователь)
// ══════════════════════════════════════════════════════════════════════════════
export async function handleEmailCheck(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();

    // ✅ FIX N-2: применяем rate limit
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    if (!emailCheckRateLimit(ip)) {
      console.warn(`[PermCode] Rate limit exceeded for IP: ${ip}`);
      return c.json({ success: false, error: 'Слишком много запросов. Попробуйте через минуту.' }, 429);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ success: false, error: "Некорректный email адрес" }, 400);
    }

    // ── Проверка блокировки пользователя ─────────────────────────────────────
    const userRecord: any = await kv.get(`ovora:user:email:${email}`);
    if (userRecord?.status === "blocked") {
      console.log(`[PermCode] 🚫 Blocked user tried to check email: ${email}`);
      return c.json({ success: false, error: "Ваш аккаунт заблокирован. Обратитесь в поддержку.", blocked: true }, 403);
    }

    const stored: any = await kv.get(permKey(email));

    if (stored?.codeHash) {
      console.log(`[PermCode] 🔑 Returning user: ${email}`);
      return c.json({ success: true, hasCode: true, isNew: false });
    }

    console.log(`[PermCode] 👤 New email: ${email}`);
    return c.json({ success: true, hasCode: false, isNew: true });

  } catch (err) {
    console.log("Error POST /auth/email-check:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  ПОДТВЕРЖДЕНИЕ ПОЧТЫ КОДОМ (новый пользователь, до установки PIN)
//  Почта → 6-значный код письмом → ввод кода → короткоживущий флаг «подтверждена»
//  → только после него разрешается /auth/set-code.
//  Без этого шага любой мог занять чужой, ещё не зарегистрированный email.
// ══════════════════════════════════════════════════════════════════════════════

const VERIFIED_TTL_MS  = 15 * 60 * 1000; // окно на установку PIN после подтверждения

const emailVerifiedKey = (email: string) => `ovora:email_verified:${email}`;

// Письмо с кодом отправляет сам Supabase Auth (GoTrue) через SMTP, настроенный
// в дашборде: Authentication → Emails → SMTP Settings. Свой генератор кода и
// Resend здесь не нужны — код выпускает и проверяет Supabase.
// ⚠️ В шаблоне письма обязателен {{ .Token }}, иначе придёт ссылка, а не 6 цифр.
function gotrueUrl(path: string): string {
  return `${(Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')}/auth/v1${path}`;
}
function gotrueHeaders(): Record<string, string> {
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  return { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` };
}

export async function handleSendEmailCode(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();

    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    if (!emailCheckRateLimit(ip)) {
      console.warn(`[PermCode] Rate limit exceeded for IP: ${ip}`);
      return c.json({ success: false, error: 'Слишком много запросов. Попробуйте через минуту.' }, 429);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ success: false, error: "Некорректный email адрес" }, 400);
    }

    const userRecord: any = await kv.get(`ovora:user:email:${email}`);
    if (userRecord?.status === "blocked") {
      return c.json({ success: false, error: "Ваш аккаунт заблокирован. Обратитесь в поддержку.", blocked: true }, 403);
    }

    // Просим Supabase выслать OTP — письмо уйдёт через настроенный им SMTP.
    const res = await fetch(gotrueUrl('/otp'), {
      method : 'POST',
      headers: gotrueHeaders(),
      body   : JSON.stringify({ email, create_user: true }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error(`[PermCode] Supabase OTP не отправлен (${res.status}): ${txt.slice(0, 200)}`);
      return c.json({ success: false, error: 'Не удалось отправить код. Попробуйте позже.' }, 502);
    }

    console.log(`[PermCode] 📧 Supabase OTP отправлен на ${email}`);
    return c.json({ success: true });

  } catch (err) {
    console.log("Error POST /auth/send-email-code:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

export async function handleVerifyEmailCode(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();
    const code  = (body.code || "").trim();

    if (!email || !code) return c.json({ success: false, error: "Email и код обязательны" }, 400);

    // Код выпустил Supabase — он же проверяет срок, попытки и одноразовость.
    const res = await fetch(gotrueUrl('/verify'), {
      method : 'POST',
      headers: gotrueHeaders(),
      body   : JSON.stringify({ email, token: code, type: 'email' }),
    });

    if (!res.ok) {
      const data: any = await res.json().catch(() => ({}));
      const raw = data?.msg || data?.error_description || data?.error || '';
      // GoTrue отвечает по-английски — показываем пользователю понятный текст.
      const msg = /expired|invalid/i.test(raw) ? 'Неверный или просроченный код' : (raw || 'Неверный код');
      console.log(`[PermCode] OTP не подтверждён (${res.status}): ${raw}`);
      return c.json({ success: false, error: msg });
    }

    // GoTrue вернул сессию — из неё забираем id пользователя в Auth, чтобы
    // потом дописать ему имя и телефон без поиска по всей таблице.
    try {
      const session: any = await res.json();
      await rememberAuthUserId(email, session?.user?.id);
    } catch { /* тело ответа не обязательно — не критично */ }

    // Почта подтверждена — выдаём короткоживущий флаг, его требует set-code.
    await kv.set(emailVerifiedKey(email), { email, until: Date.now() + VERIFIED_TTL_MS });

    console.log(`[PermCode] ✅ Почта подтверждена через Supabase OTP: ${email}`);
    return c.json({ success: true });

  } catch (err) {
    console.log("Error POST /auth/verify-email-code:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST /auth/set-code
//  Новый пользователь устанавливает свой 6-значный код (сохраняется хеш)
// ══════════════════════════════════════════════════════════════════════════════
export async function handleSetCode(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();
    const code = (body.code || "").trim();

    if (!email) return c.json({ success: false, error: "Email обязателен" }, 400);
    if (!/^\d{6}$/.test(code)) {
      return c.json({ success: false, error: "Код должен содержать ровно 6 цифр" }, 400);
    }

    // Проверяем что код ещё не установлен (защита от повторного вызова)
    const existing: any = await kv.get(permKey(email));
    if (existing?.codeHash) {
      return c.json({ success: false, error: "Код для этого email уже установлен. Используйте существующий код для входа." }, 409);
    }

    // PIN ставится только после подтверждения почты кодом из письма — иначе
    // любой мог бы занять чужой, ещё не зарегистрированный email.
    const verified: any = await kv.get(emailVerifiedKey(email));
    if (!verified || Date.now() > verified.until) {
      if (verified) await kv.del(emailVerifiedKey(email));
      return c.json({ success: false, error: "Сначала подтвердите почту кодом из письма" }, 403);
    }

    const codeHash = await hashCode(code);

    await kv.set(permKey(email), {
      codeHash,
      email,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastUsed: null,
    });

    // Подтверждение одноразовое: второй PIN по тому же письму поставить нельзя.
    await kv.del(emailVerifiedKey(email));

    console.log(`[PermCode] ✅ User-defined code set for ${email} | hash: ${codeHash.slice(0, 12)}...`);
    return c.json({ success: true, message: "Код установлен" });

  } catch (err) {
    console.log("Error POST /auth/set-code:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST /auth/verify-perm-code
//  Верифицирует код через bcrypt.compare
// ══════════════════════════════════════════════════════════════════════════════
export async function handleVerifyPermCode(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();
    const code = (body.code || "").trim();

    if (!email || !code) {
      return c.json({ success: false, error: "Email и код обязательны" }, 400);
    }

    // ── Проверка блокировки пользователя ─────────────────────────────────────
    const userRecord: any = await kv.get(`ovora:user:email:${email}`);
    if (userRecord?.status === "blocked") {
      console.log(`[PermCode] 🚫 Blocked user tried to verify code: ${email}`);
      return c.json({ success: false, error: "Ваш аккаунт заблокирован. Обратитесь в поддержку.", blocked: true }, 403);
    }

    const stored: any = await kv.get(permKey(email));

    if (!stored?.codeHash) {
      return c.json({ success: false, error: "Код не найден. Начните сначала.", noCode: true });
    }

    const attempts = (stored.attempts || 0) + 1;

    if (attempts > MAX_ATTEMPTS) {
      return c.json({ success: false, error: "Превышен лимит попыток. Обратитесь в поддержку через Telegram.", blocked: true });
    }

    const isCorrect = await verifyCode(code, stored.codeHash);

    if (!isCorrect) {
      await kv.set(permKey(email), { ...stored, attempts });
      const left = MAX_ATTEMPTS - attempts;
      console.log(`[PermCode] ❌ Wrong code for ${email} (${attempts}/${MAX_ATTEMPTS})`);
      return c.json({
        success: false,
        error: left > 0 ? `Неверный код. Осталось попыток: ${left}` : "Превышен лимит попыток. Обратитесь в поддержку.",
        attemptsLeft: left,
      });
    }

    await kv.set(permKey(email), { ...stored, attempts: 0, lastUsed: new Date().toISOString() });
    console.log(`[PermCode] ✅ Code verified for ${email}`);
    // Запоминаем, с какого телефона и браузера зашли — видно в админке.
    await recordLoginDevice('cargo', email, c);
    // Код подтверждён — выдаём сессионный токен (undefined, если USER_JWT_SECRET не настроен).
    const token = await signUserToken(email);
    return c.json({ success: true, token });

  } catch (err) {
    console.log("Error POST /auth/verify-perm-code:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  POST /auth/reset-code
//  Сбрасывает хеш кода — пользователь сможет придумать новый
//  (используется если пользователь никогда не устанавливал код, или поддержкой)
// ══════════════════════════════════════════════════════════════════════════════
export async function handleResetCode(c: Context) {
  try {
    const body = await c.req.json();
    const email = (body.email || "").toLowerCase().trim();

    if (!email) return c.json({ success: false, error: "Email обязателен" }, 400);

    await kv.del(permKey(email));

    console.log(`[PermCode] 🗑️ Code reset for ${email}`);
    return c.json({ success: true, message: "Код сброшен" });

  } catch (err) {
    console.log("Error POST /auth/reset-code:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  GET /admin/codes
//  Список всех email-записей с кодами (для админ-панели)
// ══════════════════════════════════════════════════════════════════════════════
export async function handleAdminListCodes(c: Context) {
  try {
    const rows: any[] = await kv.getByPrefix("ovora:perm_code:email:");
    const result = rows.map((r: any) => ({
      email:     r.email     || "—",
      createdAt: r.createdAt || null,
      lastUsed:  r.lastUsed  || null,
      attempts:  r.attempts  || 0,
      blocked:   (r.attempts || 0) >= MAX_ATTEMPTS,
      hasHash:   !!r.codeHash,
    }));
    result.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    console.log(`[PermCode] 📋 Admin list codes: ${result.length} entries`);
    return c.json({ success: true, codes: result });
  } catch (err) {
    console.log("Error GET /admin/codes:", err);
    return c.json({ success: false, error: 'Внутренняя ошибка сервера' }, 500);
  }
}
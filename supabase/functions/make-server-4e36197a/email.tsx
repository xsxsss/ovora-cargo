/**
 * email.tsx — Ovora Cargo Email Service via Resend API
 * ──────────────────────────────────────────────────────
 * Отвечает за:
 *  • sendEmail()       — отправка одного письма через Resend
 *  • throttleEmail()   — защита от спама (1 письмо на событие / N мин)
 *  • HTML-шаблоны для всех транзакционных писем платформы
 */

import * as kv from "./kv_store.tsx";

// ── Config ────────────────────────────────────────────────────────────────────
const RESEND_API_URL = "https://api.resend.com/emails";

function getResendKey(): string {
  return Deno.env.get("RESEND_API_KEY") || "";
}

function getFromEmail(): string {
  return Deno.env.get("EMAIL_FROM") || "Ovora Cargo <onboarding@resend.dev>";
}

// ── Core send ──────────────────────────────────────────────────────────────────
export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
  skipped?: boolean; // throttled
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const apiKey = getResendKey();
  if (!apiKey) {
    console.warn("[Email] RESEND_API_KEY not configured — email skipped");
    return { success: false, error: "RESEND_API_KEY not configured", skipped: true };
  }

  if (!params.to || !params.to.includes("@")) {
    console.warn("[Email] Invalid recipient:", params.to);
    return { success: false, error: "Invalid recipient email" };
  }

  if (await isUnsubscribed(params.to)) {
    console.log(`[Email] Skipped (unsubscribed): ${params.to}`);
    return { success: false, skipped: true, error: "Recipient unsubscribed" };
  }

  try {
    const body: Record<string, unknown> = {
      from: getFromEmail(),
      to: [params.to],
      subject: params.subject,
      html: params.html,
    };
    if (params.text) body.text = params.text;
    if (params.replyTo) body.reply_to = params.replyTo;

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = (data as any)?.message || (data as any)?.error || `HTTP ${res.status}`;
      console.error(`[Email] Resend error ${res.status} → ${params.to}:`, errMsg);
      return { success: false, error: errMsg };
    }

    const id = (data as any)?.id;
    console.log(`[Email] ✅ Sent "${params.subject}" → ${params.to} (id=${id})`);
    return { success: true, id };
  } catch (err) {
    console.error("[Email] Network/parse error:", err);
    return { success: false, error: String(err) };
  }
}

// ── Отписка от email-уведомлений ───────────────────────────────────────────────
function unsubKey(email: string): string {
  return `ovora:email:unsubscribed:${email.toLowerCase().trim()}`;
}

export async function isUnsubscribed(email: string): Promise<boolean> {
  try {
    return !!(await kv.get(unsubKey(email)));
  } catch {
    return false;
  }
}

export async function setUnsubscribed(email: string, value: boolean): Promise<void> {
  if (value) {
    await kv.set(unsubKey(email), { ts: Date.now() });
  } else {
    await kv.del(unsubKey(email));
  }
}

// ── Rate limiter — max 1 email per (userEmail + event) per ttlMs ──────────────
/**
 * Возвращает true, если письмо нужно пропустить (throttled).
 * Иначе записывает временну́ю метку и возвращает false.
 */
export async function throttleEmail(
  userEmail: string,
  eventType: string,
  ttlMs = 600_000, // 10 минут по умолчанию
): Promise<boolean> {
  const key = `ovora:email:throttle:${userEmail}:${eventType}`;
  try {
    const last: any = await kv.get(key);
    if (last?.ts && Date.now() - last.ts < ttlMs) {
      console.log(`[Email] Throttled: ${eventType} → ${userEmail}`);
      return true; // пропускаем
    }
    await kv.set(key, { ts: Date.now() });
    return false;
  } catch {
    return false; // при ошибке не блокируем отправку
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HTML ШАБЛОНЫ
// ══════════════════════════════════════════════════════════════════════════════

// ── Общая обёртка ─────────────────────────────────────────────────────────────
function layout(content: string, preheader = "", recipientEmail?: string): string {
  const unsubLink = recipientEmail
    ? `${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/make-server-4e36197a/email/unsubscribe?email=${encodeURIComponent(recipientEmail)}`
    : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Ovora Cargo</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0a1220;color:#e2e8f0;-webkit-font-smoothing:antialiased;}
  a{color:#5ba3f5;text-decoration:none;}
  .wrapper{max-width:600px;margin:0 auto;padding:32px 16px;}
  .card{background:linear-gradient(145deg,#0d1929,#111e30);border:1px solid #1a2d45;border-radius:24px;overflow:hidden;}
  .header{background:linear-gradient(135deg,#0f2448 0%,#0d1e38 100%);padding:28px 32px;display:flex;align-items:center;gap:16px;border-bottom:1px solid #1a2d45;}
  .logo{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#1a47c8,#2f8fe0);display:flex;align-items:center;justify-content:center;}
  .logo-text{font-size:22px;font-weight:900;color:#fff;letter-spacing:-1px;}
  .brand{font-size:18px;font-weight:800;color:#fff;letter-spacing:-0.5px;}
  .brand-sub{font-size:11px;color:#4a7090;margin-top:2px;letter-spacing:0.5px;text-transform:uppercase;}
  .body{padding:32px;}
  .badge{display:inline-block;padding:5px 14px;border-radius:100px;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:18px;}
  h1{font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;margin-bottom:10px;}
  .subtitle{font-size:14px;color:#7a9ab8;line-height:1.6;margin-bottom:24px;}
  .info-card{background:#0a1828;border:1px solid #1a2d45;border-radius:16px;padding:18px 20px;margin:20px 0;}
  .route{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
  .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
  .dot-from{background:#5ba3f5;box-shadow:0 0 0 3px rgba(91,163,245,0.2);}
  .dot-to{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,0.2);}
  .route-line{width:1px;height:20px;background:linear-gradient(to bottom,#5ba3f5,#f59e0b);margin:2px 4px;}
  .route-city{font-size:15px;font-weight:700;color:#e2e8f0;}
  .meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;}
  .meta-chip{background:#0f1e30;border:1px solid #1a2d45;border-radius:8px;padding:6px 12px;font-size:12px;color:#7a9ab8;}
  .meta-chip strong{color:#c0d4e8;margin-right:4px;}
  .btn{display:inline-block;padding:14px 28px;border-radius:14px;font-size:15px;font-weight:700;letter-spacing:0.2px;text-align:center;cursor:pointer;}
  .btn-primary{background:linear-gradient(135deg,#1a47c8,#2f8fe0);color:#fff;box-shadow:0 4px 20px rgba(26,71,200,0.35);}
  .btn-success{background:linear-gradient(135deg,#059669,#10b981);color:#fff;box-shadow:0 4px 20px rgba(16,185,129,0.35);}
  .btn-danger{background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;box-shadow:0 4px 20px rgba(220,38,38,0.35);}
  .divider{height:1px;background:linear-gradient(to right,transparent,#1a2d45,transparent);margin:24px 0;}
  .footer{padding:20px 32px;border-top:1px solid #1a2d45;text-align:center;}
  .footer p{font-size:12px;color:#3a5570;line-height:1.7;}
  .footer a{color:#3a7090;}
  @media(max-width:480px){
    .body{padding:20px;}
    h1{font-size:18px;}
    .btn{display:block;width:100%;}
  }
</style>
</head>
<body>
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ""}
<div class="wrapper">
  <div class="card">
    <div class="header">
      <div class="logo"><span class="logo-text">O</span></div>
      <div>
        <div class="brand">Ovora Cargo</div>
        <div class="brand-sub">Платформа грузоперевозок</div>
      </div>
    </div>
    ${content}
    <div class="footer">
      <p>
        © ${new Date().getFullYear()} Ovora Cargo. Все права защищены.<br/>
        Россия · Таджикистан · СНГ<br/>
        <a href="https://t.me/ovora_support">Поддержка в Telegram</a>
        ${unsubLink ? `&nbsp;•&nbsp;<a href="${unsubLink}">Отписаться от уведомлений</a>` : ""}
      </p>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ── 1. Добро пожаловать ───────────────────────────────────────────────────────
export function welcomeTemplate(params: {
  firstName: string;
  role: "driver" | "sender";
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const isDriver = params.role === "driver";
  const role = isDriver ? "Водитель" : "Отправитель";
  const badgeColor = isDriver ? "#1a47c8" : "#059669";
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:${badgeColor}22;color:${badgeColor}cc;border:1px solid ${badgeColor}44;">
    ${isDriver ? "🚛 Водитель" : "📦 Отправитель"}
  </span>
  <h1>Добро пожаловать в Ovora Cargo, ${params.firstName}!</h1>
  <p class="subtitle">
    Вы успешно зарегистрировались как <strong style="color:#c0d4e8;">${role}</strong>.
    ${isDriver
      ? "Начните размещать рейсы и принимать заказы прямо сейчас — тысячи отправителей ждут вас."
      : "Найдите надёжного водителя для своего груза за считанные минуты."}
  </p>

  <div class="info-card">
    <div style="font-size:13px;color:#5a8ab0;margin-bottom:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
      Что вас ждёт:
    </div>
    ${isDriver ? `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">🗺️</span> Публикуйте рейсы по маршрутам РФ · Таджикистан · СНГ
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">⭐</span> Стройте репутацию через систему отзывов
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">💬</span> Общайтесь напрямую с отправителями без посредников
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">📡</span> GPS-трекинг в реальном времени для ваших клиентов
      </div>
    </div>
    ` : `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">🔍</span> Поиск водителей по маршруту, дате и цене
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">📦</span> Разместите объявление и получайте офферы от водителей
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">📡</span> Отслеживайте груз в режиме реального времени
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:18px;">⭐</span> Оставляйте отзывы и помогайте сообществу
      </div>
    </div>
    `}
  </div>

  <div style="text-align:center;margin-top:28px;">
    <a href="${appUrl}" class="btn ${isDriver ? "btn-primary" : "btn-success"}">
      ${isDriver ? "Разместить первый рейс →" : "Найти водителя →"}
    </a>
  </div>

  <div class="divider"></div>
  <p style="font-size:13px;color:#4a6a82;text-align:center;line-height:1.7;">
    Нужна помощь? Напишите нам в
    <a href="https://t.me/ovora_support" style="color:#5ba3f5;">Telegram-поддержку</a>
    — отвечаем в течение 15 минут.
  </p>
</div>`;

  return {
    subject: `Добро пожаловать в Ovora Cargo, ${params.firstName}! 🎉`,
    html: layout(content, `Рады приветствовать вас, ${params.firstName}! Вы зарегистрированы как ${role}.`, params.email),
  };
}

// ── 2. Водителю: новая оферта ─────────────────────────────────────────────────
export function newOfferTemplate(params: {
  driverName: string;
  senderName: string;
  tripRoute: string;
  tripDate?: string;
  cargoWeight?: number;
  price?: number;
  currency?: string;
  notes?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:#1a47c822;color:#5ba3f5cc;border:1px solid #1a47c844;">
    📬 Новая оферта
  </span>
  <h1>${params.driverName}, к вам поступила заявка!</h1>
  <p class="subtitle">
    <strong style="color:#c0d4e8;">${params.senderName}</strong> хочет отправить груз
    с вами. Проверьте детали и примите решение.
  </p>

  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">
      Маршрут
    </div>
    <div style="font-size:16px;font-weight:800;color:#e2e8f0;letter-spacing:-0.3px;">
      ${params.tripRoute}
    </div>
    ${params.tripDate ? `<div style="margin-top:8px;font-size:13px;color:#7a9ab8;">📅 ${params.tripDate}</div>` : ""}

    <div class="meta" style="margin-top:16px;">
      ${params.cargoWeight ? `<div class="meta-chip"><strong>Вес:</strong>${params.cargoWeight} кг</div>` : ""}
      ${params.price ? `<div class="meta-chip"><strong>Цена:</strong>${params.price} ${params.currency || "TJS"}</div>` : ""}
    </div>

    ${params.notes ? `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #1a2d45;">
      <div style="font-size:12px;color:#5a8ab0;font-weight:600;margin-bottom:6px;">Комментарий:</div>
      <p style="font-size:13px;color:#a0b8cc;line-height:1.6;font-style:italic;">"${params.notes}"</p>
    </div>
    ` : ""}
  </div>

  <div style="display:flex;gap:12px;margin-top:24px;justify-content:center;flex-wrap:wrap;">
    <a href="${appUrl}/trips" class="btn btn-primary">Просмотреть оферту →</a>
  </div>

  <div class="divider"></div>
  <p style="font-size:12px;color:#3a5570;text-align:center;line-height:1.7;">
    Войдите в приложение, чтобы принять или отклонить заявку.
    Оферты автоматически истекают через 48 часов без ответа.
  </p>
</div>`;

  return {
    subject: `📬 Новая оферта на маршрут ${params.tripRoute}`,
    html: layout(content, `${params.senderName} отправил оферту на маршрут ${params.tripRoute}`, params.email),
  };
}

// ── 3. Отправителю: оферта принята ───────────────────────────────────────────
export function offerAcceptedTemplate(params: {
  senderName: string;
  driverName: string;
  driverPhone?: string;
  tripRoute: string;
  tripDate?: string;
  price?: number;
  currency?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:#05966922;color:#10b981cc;border:1px solid #05966944;">
    ✅ Оферта принята
  </span>
  <h1>${params.senderName}, ваша заявка принята!</h1>
  <p class="subtitle">
    Отличные новости! <strong style="color:#c0d4e8;">${params.driverName}</strong>
    принял вашу заявку. Свяжитесь с водителем для уточнения деталей.
  </p>

  <div class="info-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Маршрут</div>
        <div style="font-size:16px;font-weight:800;color:#e2e8f0;">${params.tripRoute}</div>
        ${params.tripDate ? `<div style="margin-top:6px;font-size:13px;color:#7a9ab8;">📅 ${params.tripDate}</div>` : ""}
      </div>
      ${params.price ? `
      <div style="text-align:right;">
        <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Стоимость</div>
        <div style="font-size:20px;font-weight:900;color:#10b981;">${params.price} ${params.currency || "TJS"}</div>
      </div>
      ` : ""}
    </div>

    <div style="margin-top:18px;padding-top:16px;border-top:1px solid #1a2d45;">
      <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">Ваш водитель</div>
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,#1a47c8,#2f8fe0);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0;">
          ${params.driverName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-size:15px;font-weight:700;color:#e2e8f0;">${params.driverName}</div>
          ${params.driverPhone ? `<div style="font-size:13px;color:#7a9ab8;margin-top:2px;">📞 ${params.driverPhone}</div>` : ""}
        </div>
      </div>
    </div>
  </div>

  <div style="background:#09261a;border:1px solid #0a3d22;border-radius:14px;padding:14px 18px;margin:20px 0;display:flex;align-items:flex-start;gap:10px;">
    <span style="font-size:18px;flex-shrink:0;">💡</span>
    <p style="font-size:13px;color:#6ee7b7;line-height:1.6;">
      Отслеживайте движение вашего груза в режиме реального времени прямо
      в приложении на вкладке «Трекинг».
    </p>
  </div>

  <div style="text-align:center;margin-top:24px;">
    <a href="${appUrl}/trips" class="btn btn-success">Перейти к поездке →</a>
  </div>
</div>`;

  return {
    subject: `✅ Водитель ${params.driverName} принял вашу заявку`,
    html: layout(
      content,
      `${params.driverName} принял вашу заявку на маршрут ${params.tripRoute}. Свяжитесь с водителем!`,
      params.email,
    ),
  };
}

// ── 4. Отправителю: оферта отклонена ─────────────────────────────────────────
export function offerRejectedTemplate(params: {
  senderName: string;
  driverName: string;
  tripRoute: string;
  reason?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:#dc262622;color:#f87171cc;border:1px solid #dc262644;">
    ❌ Оферта отклонена
  </span>
  <h1>К сожалению, заявка отклонена</h1>
  <p class="subtitle">
    Водитель <strong style="color:#c0d4e8;">${params.driverName}</strong>
    не смог принять вашу заявку на маршрут
    <strong style="color:#c0d4e8;">${params.tripRoute}</strong>.
    Не расстраивайтесь — найдём другого водителя!
  </p>

  ${params.reason ? `
  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Причина:</div>
    <p style="font-size:14px;color:#a0b8cc;line-height:1.6;font-style:italic;">"${params.reason}"</p>
  </div>
  ` : ""}

  <div style="background:#0a1828;border:1px solid #1a2d45;border-radius:14px;padding:16px 20px;margin:20px 0;">
    <div style="font-size:13px;color:#7a9ab8;margin-bottom:12px;font-weight:600;">Что делать дальше?</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:16px;">🔍</span> Найдите другого водителя через поиск
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:16px;">📦</span> Разместите объявление о грузе — водители сами напишут вам
      </div>
      <div style="display:flex;align-items:center;gap:10px;font-size:14px;color:#c0d4e8;">
        <span style="font-size:16px;">💬</span> Обратитесь в поддержку — поможем найти транспорт
      </div>
    </div>
  </div>

  <div style="text-align:center;margin-top:24px;">
    <a href="${appUrl}/search" class="btn btn-primary">Найти другого водителя →</a>
  </div>
</div>`;

  return {
    subject: `❌ Водитель ${params.driverName} отклонил вашу заявку`,
    html: layout(content, `Заявка на ${params.tripRoute} отклонена. Найдите другого водителя!`, params.email),
  };
}

// ── 5. Обоим: поездка завершена ───────────────────────────────────────────────
export function tripCompletedTemplate(params: {
  recipientName: string;
  recipientRole: "driver" | "sender";
  partnerName: string;
  tripRoute: string;
  tripDate?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";
  const isDriver = params.recipientRole === "driver";

  const content = `
<div class="body">
  <span class="badge" style="background:#7c3aed22;color:#a78bfacc;border:1px solid #7c3aed44;">
    🏁 Поездка завершена
  </span>
  <h1>Поездка завершена, ${params.recipientName}!</h1>
  <p class="subtitle">
    Маршрут <strong style="color:#c0d4e8;">${params.tripRoute}</strong> успешно пройден.
    ${isDriver
      ? "Благодарим за надёжную работу!"
      : "Спасибо за выбор Ovora Cargo!"}
  </p>

  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Детали поездки</div>
    <div style="font-size:16px;font-weight:800;color:#e2e8f0;">${params.tripRoute}</div>
    ${params.tripDate ? `<div style="margin-top:6px;font-size:13px;color:#7a9ab8;">📅 ${params.tripDate}</div>` : ""}
    <div style="margin-top:12px;font-size:13px;color:#7a9ab8;">
      ${isDriver ? "📦 Отправитель:" : "🚛 Водитель:"}
      <strong style="color:#c0d4e8;margin-left:4px;">${params.partnerName}</strong>
    </div>
  </div>

  <div style="background:#1e0a4a;border:1px solid #3b1fa3;border-radius:14px;padding:16px 20px;margin:20px 0;text-align:center;">
    <div style="font-size:16px;margin-bottom:8px;">⭐⭐⭐⭐⭐</div>
    <p style="font-size:14px;color:#c4b5fd;font-weight:600;">
      Оцените ${isDriver ? "отправителя" : "водителя"} — ваш отзыв помогает сообществу!
    </p>
  </div>

  <div style="text-align:center;margin-top:24px;">
    <a href="${appUrl}/trips" class="btn" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,0.35);">
      Оставить отзыв →
    </a>
  </div>
</div>`;

  return {
    subject: `🏁 Поездка ${params.tripRoute} завершена`,
    html: layout(content, `Поездка ${params.tripRoute} успешно завершена. Оставьте отзыв!`, params.email),
  };
}

// ── 6. Получателю: новое сообщение ────────────────────────────────────────────
export function newMessageTemplate(params: {
  recipientName: string;
  senderName: string;
  messagePreview: string;
  tripRoute?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:#7c3aed22;color:#a78bfacc;border:1px solid #7c3aed44;">
    💬 Новое сообщение
  </span>
  <h1>${params.recipientName}, вам написали!</h1>
  <p class="subtitle">
    <strong style="color:#c0d4e8;">${params.senderName}</strong> отправил вам сообщение
    ${params.tripRoute ? `по маршруту <strong style="color:#c0d4e8;">${params.tripRoute}</strong>` : ""}.
  </p>

  <div style="background:#0f1e34;border-left:3px solid #7c3aed;border-radius:0 12px 12px 0;padding:16px 20px;margin:20px 0;">
    <div style="font-size:11px;color:#6060a0;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
      ${params.senderName}
    </div>
    <p style="font-size:14px;color:#c0c8e0;line-height:1.6;font-style:italic;">
      "${params.messagePreview}"
    </p>
  </div>

  <div style="text-align:center;margin-top:24px;">
    <a href="${appUrl}/messages" class="btn" style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;box-shadow:0 4px 20px rgba(124,58,237,0.35);">
      Ответить →
    </a>
  </div>

  <div class="divider"></div>
  <p style="font-size:12px;color:#3a5570;text-align:center;">
    Чтобы перес��ать получать email-уведомления о сообщениях,
    отключите их в <a href="${appUrl}/settings">настройках профиля</a>.
  </p>
</div>`;

  return {
    subject: `💬 ${params.senderName} написал вам сообщение`,
    html: layout(
      content,
      `${params.senderName}: ${params.messagePreview.substring(0, 80)}`,
      params.email,
    ),
  };
}

// ── 7. Пользователю: блокировка/разблокировка аккаунта админом ───────────────
export function userStatusTemplate(params: {
  firstName: string;
  blocked: boolean;
  reason?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";
  const badgeColor = params.blocked ? "#dc2626" : "#059669";

  const content = `
<div class="body">
  <span class="badge" style="background:${badgeColor}22;color:${badgeColor}cc;border:1px solid ${badgeColor}44;">
    ${params.blocked ? "🚫 Аккаунт заблокирован" : "✅ Аккаунт разблокирован"}
  </span>
  <h1>${params.firstName}, ваш аккаунт ${params.blocked ? "заблокирован" : "разблокирован"}</h1>
  <p class="subtitle">
    ${params.blocked
      ? "Администратор платформы заблокировал ваш аккаунт. Доступ к размещению грузов, рейсов и чатам временно ограничен."
      : "Доступ к вашему аккаунту восстановлен. Вы можете продолжить пользоваться платформой."}
  </p>
  ${params.reason ? `
  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Причина:</div>
    <p style="font-size:14px;color:#a0b8cc;line-height:1.6;font-style:italic;">"${params.reason}"</p>
  </div>
  ` : ""}
  <div class="divider"></div>
  <p style="font-size:13px;color:#4a6a82;text-align:center;line-height:1.7;">
    Если вы считаете это ошибкой, напишите нам в
    <a href="https://t.me/ovora_support" style="color:#5ba3f5;">Telegram-поддержку</a>.
  </p>
</div>`;

  return {
    subject: params.blocked ? "🚫 Ваш аккаунт Ovora Cargo заблокирован" : "✅ Ваш аккаунт Ovora Cargo разблокирован",
    html: layout(content, params.blocked ? "Ваш аккаунт заблокирован администратором." : "Доступ к аккаунту восстановлен.", params.email),
  };
}

// ── 8. Пользователю: документ проверен админом ────────────────────────────────
export function documentStatusTemplate(params: {
  firstName: string;
  documentType: string;
  approved: boolean;
  reason?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";
  const badgeColor = params.approved ? "#059669" : "#dc2626";

  const content = `
<div class="body">
  <span class="badge" style="background:${badgeColor}22;color:${badgeColor}cc;border:1px solid ${badgeColor}44;">
    ${params.approved ? "✅ Документ одобрен" : "❌ Документ отклонён"}
  </span>
  <h1>${params.firstName}, ваш документ ${params.approved ? "одобрен" : "отклонён"}</h1>
  <p class="subtitle">
    Документ «<strong style="color:#c0d4e8;">${params.documentType}</strong>» прошёл проверку модератором.
    ${params.approved
      ? "Верификация пройдена — теперь у вас полный доступ к функциям платформы."
      : "К сожалению, документ не прошёл проверку. Загрузите его повторно с учётом замечаний."}
  </p>
  ${params.reason ? `
  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Комментарий модератора:</div>
    <p style="font-size:14px;color:#a0b8cc;line-height:1.6;font-style:italic;">"${params.reason}"</p>
  </div>
  ` : ""}
  <div style="text-align:center;margin-top:24px;">
    <a href="${appUrl}/profile" class="btn ${params.approved ? "btn-success" : "btn-primary"}">
      ${params.approved ? "Перейти в профиль →" : "Загрузить документ повторно →"}
    </a>
  </div>
</div>`;

  return {
    subject: params.approved ? `✅ Документ «${params.documentType}» одобрен` : `❌ Документ «${params.documentType}» отклонён`,
    html: layout(content, params.approved ? "Ваш документ прошёл проверку." : "Документ не прошёл проверку — загрузите его повторно.", params.email),
  };
}

// ── 9. Уведомление о действии админа (груз/оферта/отзыв) ──────────────────────
export function adminActionTemplate(params: {
  firstName: string;
  title: string;
  message: string;
  reason?: string;
  email?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const appUrl = params.appUrl || "https://ovora.app";

  const content = `
<div class="body">
  <span class="badge" style="background:#f59e0b22;color:#fbbf24cc;border:1px solid #f59e0b44;">
    ⚠️ Действие администратора
  </span>
  <h1>${params.firstName}, ${params.title}</h1>
  <p class="subtitle">${params.message}</p>
  ${params.reason ? `
  <div class="info-card">
    <div style="font-size:12px;color:#5a8ab0;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Причина:</div>
    <p style="font-size:14px;color:#a0b8cc;line-height:1.6;font-style:italic;">"${params.reason}"</p>
  </div>
  ` : ""}
  <div class="divider"></div>
  <p style="font-size:13px;color:#4a6a82;text-align:center;line-height:1.7;">
    Вопросы? Напишите нам в
    <a href="https://t.me/ovora_support" style="color:#5ba3f5;">Telegram-поддержку</a>.
  </p>
</div>`;

  return {
    subject: `⚠️ ${params.title}`,
    html: layout(content, params.message, params.email),
  };
}
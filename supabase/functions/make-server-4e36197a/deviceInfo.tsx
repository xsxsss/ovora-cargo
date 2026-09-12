/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  УСТРОЙСТВО ВХОДА — с какого телефона и браузера заходит человек          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Разбираем User-Agent запроса и запоминаем последние входы: браузер, ОС,
 * модель устройства, IP и время. Нужно для разбора проблем со входом («у меня
 * не открывается») и чтобы было видно, если в один аккаунт заходят с разных
 * устройств.
 *
 * Это персональные данные — наружу они не отдаются, только в админку.
 *
 * KV-ключ: ovora:device:{platform}:{id}
 */

import * as kv from "./kv_store.tsx";

export interface DeviceRecord {
  /** ISO-время входа */
  at       : string;
  ip       : string;
  browser  : string;
  os       : string;
  /** Модель телефона, если её видно в User-Agent */
  device   : string;
  /** Полный User-Agent — на случай, если разбор чего-то не понял */
  userAgent: string;
}

export interface DeviceLog {
  current: DeviceRecord | null;
  /** Последние входы, новые сверху */
  history: DeviceRecord[];
}

const HISTORY_LIMIT = 5;
const deviceKey = (platform: 'cargo' | 'avia', id: string) => `ovora:device:${platform}:${id}`;

// ── Разбор User-Agent ────────────────────────────────────────────────────────
// Порядок проверок важен: Edge/Opera/Яндекс тоже пишут в UA слово Chrome,
// поэтому их надо поймать раньше, иначе все окажутся «Chrome».

function detectBrowser(ua: string): string {
  const m = (re: RegExp) => ua.match(re)?.[1] || '';
  if (/YaBrowser/i.test(ua))       return `Яндекс.Браузер ${m(/YaBrowser\/(\d+)/)}`.trim();
  if (/Edg[A-Z]?\//i.test(ua))     return `Edge ${m(/Edg[A-Z]?\/(\d+)/)}`.trim();
  if (/OPR\/|Opera/i.test(ua))     return `Opera ${m(/OPR\/(\d+)/)}`.trim();
  if (/SamsungBrowser/i.test(ua))  return `Samsung Internet ${m(/SamsungBrowser\/(\d+)/)}`.trim();
  if (/MiuiBrowser/i.test(ua))     return `MIUI Browser ${m(/MiuiBrowser\/([\d.]+)/)}`.trim();
  if (/HuaweiBrowser/i.test(ua))   return `Huawei Browser ${m(/HuaweiBrowser\/(\d+)/)}`.trim();
  if (/FxiOS/i.test(ua))           return `Firefox ${m(/FxiOS\/(\d+)/)}`.trim();
  if (/Firefox/i.test(ua))         return `Firefox ${m(/Firefox\/(\d+)/)}`.trim();
  if (/CriOS/i.test(ua))           return `Chrome ${m(/CriOS\/(\d+)/)}`.trim();
  if (/Chrome/i.test(ua))          return `Chrome ${m(/Chrome\/(\d+)/)}`.trim();
  if (/Safari/i.test(ua))          return `Safari ${m(/Version\/(\d+)/)}`.trim();
  return 'Неизвестный браузер';
}

function detectOs(ua: string): string {
  let m = ua.match(/Android (\d+(?:\.\d+)?)/i);
  if (m) return `Android ${m[1]}`;

  m = ua.match(/(?:iPhone OS|CPU OS) (\d+)[._](\d+)/i);
  if (m) return `iOS ${m[1]}.${m[2]}`;

  if (/iPad/i.test(ua)) return 'iPadOS';

  m = ua.match(/Windows NT ([\d.]+)/i);
  if (m) {
    // Windows 11 представляется как NT 10.0 — различить по UA нельзя,
    // поэтому честно пишем «Windows 10/11».
    const map: Record<string, string> = { '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7' };
    return map[m[1]] || `Windows NT ${m[1]}`;
  }

  m = ua.match(/Mac OS X (\d+)[._](\d+)/i);
  if (m) return `macOS ${m[1]}.${m[2]}`;

  if (/CrOS/i.test(ua))  return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Неизвестная ОС';
}

function detectDevice(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua))   return 'iPad';

  // Android пишет модель в скобках после версии ОС:
  // "(Linux; Android 13; SM-A525F Build/...)" → SM-A525F
  const m = ua.match(/Android [\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i);
  if (m) {
    const model = m[1].trim();
    if (model && !/^wv$/i.test(model)) return model;
  }

  if (/Android/i.test(ua)) return 'Android-устройство';
  if (/Mobile/i.test(ua))  return 'Мобильное устройство';
  return 'Компьютер';
}

export function parseUserAgent(userAgent: string): Omit<DeviceRecord, 'at' | 'ip'> {
  const ua = (userAgent || '').trim();
  if (!ua) {
    return { browser: 'Неизвестный браузер', os: 'Неизвестная ОС', device: 'Неизвестно', userAgent: '' };
  }
  return {
    browser  : detectBrowser(ua),
    os       : detectOs(ua),
    device   : detectDevice(ua),
    userAgent: ua.slice(0, 400),
  };
}

export function callerIp(c: any): string {
  return (
    c.req.header('cf-connecting-ip') ||
    (c.req.header('x-forwarded-for') || '').split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

/** Запомнить вход. Никогда не роняет сам вход — только логирует ошибку. */
export async function recordLoginDevice(
  platform: 'cargo' | 'avia',
  id: string,
  c: any,
): Promise<DeviceRecord | null> {
  try {
    const record: DeviceRecord = {
      at: new Date().toISOString(),
      ip: callerIp(c),
      ...parseUserAgent(c.req.header('user-agent') || ''),
    };

    const prev = (await kv.get(deviceKey(platform, id))) as DeviceLog | null;
    const prevHistory = Array.isArray(prev?.history) ? prev!.history : [];

    // Один и тот же браузер на одном устройстве не плодит записи — обновляем
    // время последнего входа, а не добавляем строку на каждый вход.
    const same = (a: DeviceRecord, b: DeviceRecord) =>
      a.browser === b.browser && a.os === b.os && a.device === b.device;

    const history = [record, ...prevHistory.filter(h => h && !same(h, record))].slice(0, HISTORY_LIMIT);

    await kv.set(deviceKey(platform, id), { current: record, history } satisfies DeviceLog);
    return record;
  } catch (e) {
    console.warn('[DeviceInfo] не удалось записать устройство (не критично):', e);
    return null;
  }
}

export async function getLoginDevices(platform: 'cargo' | 'avia', id: string): Promise<DeviceLog> {
  try {
    const log = (await kv.get(deviceKey(platform, id))) as DeviceLog | null;
    return { current: log?.current || null, history: Array.isArray(log?.history) ? log!.history : [] };
  } catch {
    return { current: null, history: [] };
  }
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ВЛАДЕЛЕЦ КЕША — чей это телефон/браузер прямо сейчас                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Проблема, которую это решает: чаты, сообщения, поездки, офферы и профиль
 * лежали в localStorage под общими ключами, без привязки к аккаунту. Очистка
 * «данных прошлого пользователя» сверялась с sessionStorage, а он умирает
 * вместе с вкладкой. Поэтому сценарий «в одном приложении зашли в два
 * аккаунта» (закрыли приложение → открыли → вошли другим) не чистил ничего,
 * и второй человек видел переписку первого.
 *
 * Теперь владелец кеша записан в localStorage и переживает перезапуск. При
 * входе под другим аккаунтом весь пользовательский кеш стирается — данные
 * с сервера подтянутся заново, а чужое на устройстве не останется.
 */

const OWNER_KEY = 'ovora_cache_owner';

/**
 * Ключи уровня устройства — принадлежат телефону, а не человеку.
 * Переживают смену аккаунта: язык интерфейса, звук, вибрация, публичный
 * конфиг сайта и служебные флаги (защита от цикла перезагрузки).
 */
const DEVICE_KEYS = new Set([
  'language',
  'ovora_haptic_enabled',
  'ovora_sound_enabled',
  'ovora_site_config',
  'ovora_chunk_reload_ts',
  'ovora_demo_wiped_v2',
  OWNER_KEY,
]);

/** Пользовательские ключи без префикса ovora — перечислены явно. */
const EXTRA_USER_KEYS = ['userRole', 'savedRoutes', 'radio_last_seen', 'radio_muted'];

function isUserScoped(key: string): boolean {
  if (DEVICE_KEYS.has(key)) return false;
  return key.startsWith('ovora') || EXTRA_USER_KEYS.includes(key);
}

/** Стереть всё, что принадлежит человеку, оставив настройки устройства. */
export function wipeUserScopedStorage(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isUserScoped(key)) doomed.push(key);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch { /* приватный режим — просто нечего чистить */ }

  try {
    const doomed: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      // Админ-сессия живёт по другим ключам и по другому паролю — не трогаем,
      // иначе вход в админку слетал бы при каждой смене обычного аккаунта.
      if (key && key.startsWith('ovora_admin')) continue;
      if (key && (isUserScoped(key) || key === 'isAuthenticated')) doomed.push(key);
    }
    doomed.forEach(k => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

/**
 * Объявить устройство «занятым» этим аккаунтом. Вызывать в момент входа,
 * ДО записи новой сессии: если владелец сменился, весь чужой кеш стирается.
 *
 * @param owner строка вида `cargo:<email>` или `avia:<телефон>`
 * @returns true, если кеш чужого аккаунта был стёрт
 */
export function claimCacheOwner(owner: string): boolean {
  try {
    const next = (owner || '').trim().toLowerCase();
    if (!next) return false;
    const prev = localStorage.getItem(OWNER_KEY);
    if (prev === next) return false; // тот же человек — кеш его, не трогаем
    wipeUserScopedStorage();
    localStorage.setItem(OWNER_KEY, next);
    return prev !== null;
  } catch {
    return false;
  }
}

/** Выход: устройство больше ни за кем не закреплено. */
export function releaseCacheOwner(): void {
  try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
}

export function getCacheOwner(): string | null {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}

import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { withUserToken } from './userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

export interface User {
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName?: string;
  phone?: string;
  birthDate?: string;
  role?: 'sender' | 'driver';
  avatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 👤 Получить данные пользователя из БД
 */
export async function getUser(email: string): Promise<User | null> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(email)}`, {
    headers: withUserToken(HEADERS),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  if (data.error) {
    return null;
  }

  return data.user || null;
}

/**
 * ✏️ Обновить профиль пользователя в БД
 */
export async function updateUser(email: string, updates: Partial<User>): Promise<User | null> {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ ...updates, callerEmail: email }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка обновления профиля: ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return data.user;
}

/**
 * 📷 Загрузить фото профиля в Supabase Storage
 */
export async function uploadAvatar(email: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('avatar', file);
  formData.append('callerEmail', email);

  const res = await fetch(`${BASE}/users/${encodeURIComponent(email)}/avatar`, {
    method: 'POST',
    // Content-Type не ставим — браузер сам добавит boundary. CSRF обязателен для любого POST.
    headers: withUserToken({ Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN }),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка загрузки фото: ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  return data.avatarUrl as string;
}

/**
 * 🔄 Синхронизировать ФИО пользователя во всех чатах
 * Вызывается после изменения профиля или успешной OCR верификации паспорта
 */
export async function syncUserNameInChats(
  email: string,
  userData: { firstName?: string; lastName?: string; middleName?: string; fullName?: string; avatarUrl?: string }
): Promise<void> {
  try {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(email)}/sync-chats`, {
      method: 'PUT',
      headers: withUserToken(HEADERS),
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      return;
    }
    await res.json();
  } catch {
    // non-critical
  }
}

/**
 * 🔄 Синхронизировать ФИО пользователя во всех поездках и предложениях
 * Вызывается после изменения профиля или успешной OCR верификации паспорта
 */
export async function syncUserNameInTrips(
  email: string,
  userData: { firstName?: string; lastName?: string; middleName?: string; fullName?: string; avatarUrl?: string }
): Promise<void> {
  try {
    const res = await fetch(`${BASE}/users/${encodeURIComponent(email)}/sync-trips`, {
      method: 'PUT',
      headers: withUserToken(HEADERS),
      body: JSON.stringify(userData),
    });
    if (!res.ok) {
      return;
    }
    await res.json();
  } catch {
    // non-critical
  }
}

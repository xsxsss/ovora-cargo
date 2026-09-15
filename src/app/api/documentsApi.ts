import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { withUserToken } from './userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

export interface Document {
  id: string;
  userEmail: string;
  type: string;
  title: string;
  subtitle: string;
  status: 'verified' | 'rejected' | 'not_uploaded' | 'pending';
  photoUrl?: string;
  photoPath?: string;
  uploadDate?: string;
  expiryDate?: string;
  photoQualityScore: number;
  rejectionReason?: string; // ✅ Автоматическая причина отказа
  extractedFullName?: string; // ✅ ФИО извлеченное из документа
  extractedData?: any; // ✅ Все извлеченные данные (дата рождения, номер и т.д.)
  createdAt: string;
  updatedAt: string;
  // ✅ Поля для обновления профиля
  profileUpdated?: boolean; // Флаг что профиль был обновлён
  updatedUser?: any; // Обновлённые данные пользователя
}

/**
 * 📤 Upload document with file
 */
export async function uploadDocument(params: {
  file: File;
  userEmail: string;
  documentId: string;
  documentType: string;
  title: string;
  subtitle: string;
  expiryDate?: string;
  extractedFullName?: string; // ✅ ФИО пользователя (для проверки соответствия)
}): Promise<Document> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('userEmail', params.userEmail);
  formData.append('callerEmail', params.userEmail); // 🔒 владелец = загружающий
  formData.append('documentId', params.documentId);
  formData.append('documentType', params.documentType);
  formData.append('title', params.title);
  formData.append('subtitle', params.subtitle);
  if (params.expiryDate) {
    formData.append('expiryDate', params.expiryDate);
  }
  if (params.extractedFullName) {
    formData.append('extractedFullName', params.extractedFullName);
  }

  const res = await fetch(`${BASE}/documents/upload`, {
    method: 'POST',
    headers: withUserToken({
      Authorization: `Bearer ${publicAnonKey}`,
      [CSRF_HEADER]: CSRF_TOKEN,
    }),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка загрузки документа: ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  // ✅ Возвращаем весь объект, включая updatedUser и profileUpdated
  return {
    ...data.document,
    profileUpdated: data.profileUpdated,
    updatedUser: data.updatedUser,
  };
}

/**
 * 📋 Get all documents for a user (with retry on network failure)
 */
export async function getUserDocuments(userEmail: string): Promise<Document[]> {
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const res = await fetch(`${BASE}/documents/user/${encodeURIComponent(userEmail)}?callerEmail=${encodeURIComponent(userEmail)}`, {
        headers: withUserToken(HEADERS),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ошибка загрузки документов: ${err}`);
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      return data.documents || [];
    } catch (err: any) {
      lastError = err;
      const isNetworkError = err?.name === 'TypeError' || err?.name === 'AbortError';
      if (isNetworkError && attempt < MAX_ATTEMPTS) {
        const delay = attempt * 1000; // 1s, 2s
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * 🗑️ Delete document
 */
export async function deleteDocument(documentId: string, userEmail: string): Promise<void> {
  const res = await fetch(`${BASE}/documents/${documentId}`, {
    method: 'DELETE',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ userEmail, callerEmail: userEmail }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ошибка удаления документа: ${err}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
}


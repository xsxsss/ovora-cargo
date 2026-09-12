import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as userApi from '../api/userApi';

interface User {
  email: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName?: string;
  phone?: string;
  birthDate?: string;
  role?: 'sender' | 'driver';
  avatarUrl?: string;
  city?: string;
  about?: string;
  createdAt?: string;
  updatedAt?: string;
  rating?: number | null;
  totalTrips?: number | null;
  verificationStatus?: string;
}

interface UserContextType {
  user: User | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<void>;
  setUserEmail: (email: string) => void;
  setUserDirectly: (userData: Partial<User>) => void;
  logout: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// ── Полностью очищает кеш пользователя из localStorage ───────────────────────
function clearLocalCache() {
  try {
    localStorage.removeItem('ovora_current_user');
    localStorage.removeItem('ovora_auth_persistent');
    localStorage.removeItem('ovora_chats_v2');
    localStorage.removeItem('ovora_chat_contacts_v2');
    // Clear per-chat message caches
    const msgKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('ovora_msgs_v2_')) msgKeys.push(k);
    }
    msgKeys.forEach(k => localStorage.removeItem(k));
  } catch { /* silently ignore */ }
}

// ── Сохраняет данные пользователя строго по его email ────────────────────────
// НЕ сливает со старыми данными если email другой — это предотвращает показ
// чужого профиля новому пользователю
function syncToLocalCache(userData: User) {
  try {
    const existingRaw = localStorage.getItem('ovora_current_user');
    let base: Partial<User> = {};

    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        // ✅ Сливаем только если email совпадает — иначе начинаем с чистого листа
        if (parsed?.email && parsed.email === userData.email) {
          base = parsed;
        }
      } catch { /* ignore */ }
    }

    const merged = { ...base, ...userData };
    localStorage.setItem('ovora_current_user', JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('ovora_user_updated', { detail: merged }));
  } catch { /* silently ignore */ }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [_currentEmail, setCurrentEmail] = useState<string | null>(null);

  // ── Загрузить пользователя из БД по email ─────────────────────────────────
  const loadUser = async (email: string, signal?: AbortSignal) => {
    try {
      setLoading(true);

      // ✅ Перед загрузкой нового пользователя сбрасываем состояние
      // чтобы не показывать старые данные пока грузим новые
      setUser(null);

      const userData = await userApi.getUser(email);

      if (signal?.aborted) return;

      if (userData) {
        setUser(userData);
        syncToLocalCache(userData);
      } else {
        setUser(null);
      }
    } catch (error) {
      if (signal?.aborted) return;
      console.error('[UserProvider] Error loading user:', error);
      setUser(null);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  // ── Установить email (при входе / регистрации) ─────────────────────────────
  const setUserEmail = (email: string) => {
    const normalized = email.trim().toLowerCase();

    // ✅ Если email сменился — чистим кеш предыдущего пользователя
    const oldEmail = sessionStorage.getItem('ovora_user_email');
    if (oldEmail && oldEmail !== normalized) {
      clearLocalCache();
      setUser(null);
    }

    sessionStorage.setItem('ovora_user_email', normalized);
    setCurrentEmail(normalized);
    loadUser(normalized);
  };

  // ── Установить пользователя напрямую (после регистрации — данные уже есть) ──
  // Не делает лишний запрос к серверу, обновляет UserContext мгновенно
  const setUserDirectly = (userData: Partial<User>) => {
    if (!userData.email) return;
    const normalized = userData.email.trim().toLowerCase();

    // Чистим кеш если сменился пользователь
    const oldEmail = sessionStorage.getItem('ovora_user_email');
    if (oldEmail && oldEmail !== normalized) {
      clearLocalCache();
    }

    sessionStorage.setItem('ovora_user_email', normalized);
    if (userData.role) sessionStorage.setItem('userRole', userData.role);
    sessionStorage.setItem('isAuthenticated', 'true');
    setCurrentEmail(normalized);

    const fullUser = userData as User;
    setUser(fullUser);
    syncToLocalCache(fullUser);
  };

  // ── Обновить профиль в БД ──────────────────────────────────────────────────
  const updateUser = async (updates: Partial<User>) => {
    if (!user?.email) return;
    try {
      const updatedUser = await userApi.updateUser(user.email, updates);
      const merged = { ...user, ...updatedUser, ...updates } as User;
      setUser(merged);
      syncToLocalCache(merged);
    } catch (error) {
      console.error('[UserProvider] Error updating user:', error);
      throw error;
    }
  };

  // ── Перезагрузить данные из БД ─────────────────────────────────────────────
  const refreshUser = async () => {
    const email = user?.email || sessionStorage.getItem('ovora_user_email');
    if (!email) return;
    await loadUser(email);
  };

  // ── Выход из системы ───────────────────────────────────────────────────────
  const logout = () => {
    // ✅ Полностью чистим все сессионные данные
    sessionStorage.removeItem('ovora_user_email');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('isAuthenticated');
    clearLocalCache();
    setUser(null);
    setCurrentEmail(null);
  };

  // ── При монтировании — читаем email из sessionStorage ─────────────────────
  useEffect(() => {
    const abortController = new AbortController();

    // 1. Try sessionStorage (current tab)
    let savedEmail = sessionStorage.getItem('ovora_user_email');

    // 2. Fallback: restore from localStorage persistent auth (browser restart)
    if (!savedEmail) {
      try {
        const persistent = JSON.parse(localStorage.getItem('ovora_auth_persistent') || '{}');
        if (persistent.email && persistent.role) {
          savedEmail = persistent.email;
          sessionStorage.setItem('ovora_user_email', persistent.email);
          sessionStorage.setItem('userRole', persistent.role);
          sessionStorage.setItem('isAuthenticated', 'true');
          }
      } catch { /* ignore */ }
    }

    if (savedEmail) {
      setCurrentEmail(savedEmail);
      loadUser(savedEmail, abortController.signal);
    } else {
      setLoading(false);
    }

    return () => {
      abortController.abort();
    };
  }, []);

  return (
    <UserContext.Provider
      value={{ user, loading, refreshUser, updateUser, setUserEmail, setUserDirectly, logout }}
    >
      {children}
    </UserContext.Provider>
  );
}

const defaultUserContext: UserContextType = {
  user: null,
  loading: false,
  refreshUser: async () => {},
  updateUser: async () => {},
  setUserEmail: () => {},
  setUserDirectly: () => {},
  logout: () => {},
};

export function useUser() {
  const context = useContext(UserContext);
  return context ?? defaultUserContext;
}

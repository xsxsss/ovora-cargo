/**
 * useMessages — business logic hook for MessagesPage
 * Handles: sync, polling, CRUD, filtering, pull-to-refresh state
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  getChats, markRead, fetchChats, deleteChat, Chat,
} from '../api/chatStore';

export function useMessages() {
  const userRole = sessionStorage.getItem('userRole') || 'sender';
  const isDriver = userRole === 'driver';

  const [chats, setChats] = useState<Chat[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [_selectedChat] = useState<Chat | null>(null); // preserved for hook order stability
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncRef = useRef<() => Promise<void>>(async () => {});

  const loadLocal = useCallback(() => { setChats([...getChats()]); }, []);

  const syncFromApi = useCallback(async () => {
    setSyncing(true);
    try {
      await fetchChats();
      setChats([...getChats()]);
    } catch { /* use cache */ } finally {
      setSyncing(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => { syncRef.current = syncFromApi; }, [syncFromApi]);

  // Init: cleanup old local demo data, start polling (серверная очистка демо-чатов давно выполнена и удалена)
  useEffect(() => {
    if (!localStorage.getItem('ovora_demo_wiped_v2')) {
      const keysToDelete: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === 'ovora_chats_v2' || k === 'ovora_chat_contacts_v2')) keysToDelete.push(k);
      }
      keysToDelete.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('ovora_demo_wiped_v2', '1');
    }

    loadLocal();
    syncFromApi();

    pollRef.current = setInterval(() => {
      if (document.visibilityState !== 'hidden') syncFromApi();
    }, 12_000);

    window.addEventListener('ovora_chat_update', loadLocal);
    window.addEventListener('ovora_user_updated', syncFromApi as EventListener);
    return () => {
      window.removeEventListener('ovora_chat_update', loadLocal);
      window.removeEventListener('ovora_user_updated', syncFromApi as EventListener);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadLocal, syncFromApi, userRole]);

  const filtered = chats
    .filter(c => !c.id.startsWith('demo_'))
    .filter(c =>
      (c.contact.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

  const totalUnread = filtered.reduce((acc, c) => acc + (c.unread || 0), 0);

  const openChat = useCallback((chat: Chat) => {
    markRead(chat.id);
  }, []);

  const handleDeleteChat = useCallback(async (chatId: string) => {
    try {
      setChats(prev => prev.filter(c => c.id !== chatId));
      await deleteChat(chatId);
    } catch {
      loadLocal();
    }
  }, [loadLocal]);

  return {
    isDriver,
    chats,
    filtered,
    initialLoading,
    searchQuery,
    setSearchQuery,
    syncing,
    syncFromApi,
    syncRef,
    totalUnread,
    openChat,
    handleDeleteChat,
  };
}
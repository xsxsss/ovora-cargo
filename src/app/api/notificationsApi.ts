import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { withUserToken } from './userToken';

const API_BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;

export interface Notification {
  id: string;
  userEmail: string;
  type: 'trip' | 'system' | 'payment' | 'info' | 'auth' | 'offer' | 'message' | 'document';
  iconName: string;
  iconBg: string;
  title: string;
  description: string;
  isUnread: boolean;
  createdAt: string;
}

export interface CreateNotificationInput {
  userEmail: string;
  type: Notification['type'];
  iconName?: string;
  iconBg?: string;
  title: string;
  description?: string;
}

/**
 * Создать новое уведомление
 */
export async function createNotification(data: CreateNotificationInput): Promise<Notification> {
  const res = await fetch(`${API_BASE}/notifications`, {
    method: 'POST',
    headers: withUserToken({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${publicAnonKey}`,
      [CSRF_HEADER]: CSRF_TOKEN,
    }),
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to create notification');
  return json.notification;
}

/**
 * Получить все уведомления пользователя
 */
export async function getNotifications(userEmail: string): Promise<Notification[]> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userEmail)}`, {
    headers: withUserToken({ 'Authorization': `Bearer ${publicAnonKey}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to fetch notifications');
  return json.notifications || [];
}

/**
 * Пометить уведомление как прочитанное
 */
export async function markNotificationRead(userEmail: string, notificationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userEmail)}/${notificationId}/read`, {
    method: 'PUT',
    headers: withUserToken({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${publicAnonKey}`,
      [CSRF_HEADER]: CSRF_TOKEN,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to mark notification as read');
}

/**
 * Пометить все уведомления как прочитанные
 */
export async function markAllNotificationsRead(userEmail: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userEmail)}/read-all`, {
    method: 'PUT',
    headers: withUserToken({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${publicAnonKey}`,
      [CSRF_HEADER]: CSRF_TOKEN,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to mark all notifications as read');
}

/**
 * Удалить уведомление
 */
export async function deleteNotification(userEmail: string, notificationId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userEmail)}/${notificationId}`, {
    method: 'DELETE',
    headers: withUserToken({ 'Authorization': `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete notification');
}

/**
 * Удалить все уведомления пользователя
 */
export async function deleteAllNotifications(userEmail: string): Promise<void> {
  const res = await fetch(`${API_BASE}/notifications/${encodeURIComponent(userEmail)}`, {
    method: 'DELETE',
    headers: withUserToken({ 'Authorization': `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Failed to delete all notifications');
}

/**
 * Вспомогательная функция для создания уведомлений об офертах
 */
export async function notifyNewOffer(driverEmail: string, senderName: string, tripRoute: string) {
  return createNotification({
    userEmail: driverEmail,
    type: 'offer',
    iconName: 'Package',
    iconBg: 'bg-blue-500/10 text-blue-500',
    title: 'Новая оферта на перевозку',
    description: `${senderName} отправил оферту на маршрут ${tripRoute}`,
  });
}

/**
 * Вспомогательная функция для создания уведомлений о принятии оферты
 */
export async function notifyOfferAccepted(senderEmail: string, driverName: string, tripRoute: string) {
  return createNotification({
    userEmail: senderEmail,
    type: 'offer',
    iconName: 'UserCheck',
    iconBg: 'bg-emerald-500/10 text-emerald-500',
    title: 'Оферта принята!',
    description: `${driverName} принял вашу оферту на маршрут ${tripRoute}`,
  });
}

/**
 * Вспомогательная функция для создания уведомлений о новом сообщении
 */
export async function notifyNewMessage(recipientEmail: string, senderName: string, messagePreview: string) {
  return createNotification({
    userEmail: recipientEmail,
    type: 'message',
    iconName: 'Bell',
    iconBg: 'bg-purple-500/10 text-purple-500',
    title: `Новое сообщение от ${senderName}`,
    description: messagePreview.substring(0, 100),
  });
}

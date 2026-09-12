import { projectId } from '../../../utils/supabase/info';
import { adminHeaders } from './dataApi';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a/avia/admin`;

async function req(method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: adminHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getAviaAdminUsers() {
  const data = await req('GET', '/users');
  return data.users || [];
}

export async function updateAviaAdminUser(phone: string, updates: Record<string, any>) {
  return req('PUT', `/users/${encodeURIComponent(phone)}`, updates);
}

export async function setAviaUserBlocked(phone: string, blocked: boolean, reason?: string) {
  return req('PATCH', `/users/${encodeURIComponent(phone)}/block`, { blocked, reason });
}

export async function deleteAviaAdminUser(phone: string) {
  return req('DELETE', `/users/${encodeURIComponent(phone)}`);
}

export async function getAviaAdminPassportPhoto(phone: string): Promise<string | null> {
  const data = await req('GET', `/users/${encodeURIComponent(phone)}/passport-photo`);
  return data.found ? data.photoUrl : null;
}

export async function resetAviaUserCode(phone: string): Promise<{ success: boolean; newPin: string }> {
  return req('POST', `/users/${encodeURIComponent(phone)}/reset-code`);
}

/** Сброс паспорта: пользователь грузит документ один раз, заменить может только админ. */
export async function resetAviaUserPassport(phone: string): Promise<{ success: boolean; user: any }> {
  return req('POST', `/users/${encodeURIComponent(phone)}/reset-passport`);
}

/** С какого телефона и браузера человек заходит — для разбора проблем со входом. */
export async function getAviaUserDevices(phone: string): Promise<{ current: any | null; history: any[] }> {
  const data = await req('GET', `/users/${encodeURIComponent(phone)}/devices`);
  return { current: data.current || null, history: data.history || [] };
}

export async function getAviaAdminDeals(filter?: { status?: string; phone?: string; dealType?: string }) {
  const params = new URLSearchParams();
  if (filter?.status)   params.set('status', filter.status);
  if (filter?.phone)    params.set('phone', filter.phone);
  if (filter?.dealType) params.set('dealType', filter.dealType);
  const qs = params.toString();
  const data = await req('GET', `/deals${qs ? `?${qs}` : ''}`);
  return data.deals || [];
}

export async function getAviaAdminFlights() {
  const data = await req('GET', '/flights');
  return data.flights || [];
}

export async function deleteAviaAdminDeal(id: string) {
  return req('DELETE', `/deals/${encodeURIComponent(id)}`);
}

export async function updateAviaAdminFlightStatus(id: string, status: 'active' | 'closed' | 'cancelled', moderationReason?: string) {
  const data = await req('PUT', `/flights/${encodeURIComponent(id)}/status`, { status, moderationReason });
  return data.flight;
}

export async function getAviaAdminBlacklist() {
  const data = await req('GET', '/blacklist');
  return data.entries || [];
}

export async function removeFromAviaBlacklist(phone: string) {
  return req('DELETE', `/blacklist/${encodeURIComponent(phone)}`);
}

export async function getAviaAdminSettings(): Promise<Record<string, any>> {
  const data = await req('GET', '/settings');
  return data.settings || {};
}

export async function updateAviaAdminSettings(settings: Record<string, any>) {
  return req('PUT', '/settings', settings);
}

export async function getAviaAdminAudit(filter?: {
  actorPhone?: string; targetId?: string; action?: string; limit?: number; offset?: number;
}) {
  const params = new URLSearchParams();
  if (filter?.actorPhone) params.set('actorPhone', filter.actorPhone);
  if (filter?.targetId)   params.set('targetId', filter.targetId);
  if (filter?.action)     params.set('action', filter.action);
  if (filter?.limit)      params.set('limit', String(filter.limit));
  if (filter?.offset)     params.set('offset', String(filter.offset));
  const qs = params.toString();
  return req('GET', `/audit${qs ? `?${qs}` : ''}`) as Promise<{ entries: any[]; total: number }>;
}

import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from './csrfToken';
import { withUserToken } from './userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${publicAnonKey}`,
  [CSRF_HEADER]: CSRF_TOKEN,
};

// ══════════════════════════════════════════════════════════════════════════════
// TRACKING API - Управление активными перевозками
// ══════════════════════════════════════════════════════════════════════════════

/** Расширенные статусы груза (6 этапов) */
export type ShipmentStatus =
  | 'pending'     // Ожидает водителя
  | 'loaded'      // Груз загружен
  | 'inProgress'  // В пути
  | 'customs'     // На таможне
  | 'arrived'     // Прибыл
  | 'delivered'   // Доставлен
  | 'completed'   // Завершено (alias delivered)
  | 'cancelled';  // Отменено

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  pending:    'Ожидает погрузки',
  loaded:     'Груз загружен',
  inProgress: 'В пути',
  customs:    'На таможне',
  arrived:    'Прибыл',
  delivered:  'Доставлен',
  completed:  'Доставлен',
  cancelled:  'Отменено',
};

export const SHIPMENT_STATUS_ICONS: Record<ShipmentStatus, string> = {
  pending:    '⏳',
  loaded:     '📦',
  inProgress: '🚚',
  customs:    '🛂',
  arrived:    '📍',
  delivered:  '✅',
  completed:  '✅',
  cancelled:  '❌',
};

/** Запись в истории статусов */
export interface StatusHistoryEntry {
  status: ShipmentStatus;
  timestamp: string;
  driverEmail?: string;
}

/** Фото-подтверждение доставки (POD) */
export interface PODPhoto {
  type: 'loading' | 'unloading';
  url: string;
  path?: string;
  timestamp: string;
  driverEmail?: string;
}

export interface ActiveShipment {
  tripId: string;
  offerId?: string;

  // Trip info
  from: string;
  to: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;

  // Timing
  date: string;          // DD.MM.YYYY
  departureTime: string; // HH:MM

  // Cargo details
  cargoType?: string;
  weight?: string;
  price?: string;
  currency?: string;
  notes?: string;
  vehicleType?: string;

  // Contact info
  contactName: string;
  contactPhone?: string;
  contactAvatar?: string;
  contactEmail?: string;

  // Real-time location (updated by driver)
  driverLat?: number;
  driverLng?: number;
  lastLocationUpdate?: string;
  locationAccuracy?: number;

  // Status — расширенные 6 этапов
  status: ShipmentStatus;
  statusHistory?: StatusHistoryEntry[];

  // POD — фото загрузки и выгрузки
  podPhotos?: PODPhoto[];

  startedAt?: string;
  completedAt?: string;

  // Metadata
  driverEmail?: string;
  senderEmail?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Save or update an active shipment ─────────────────────────────────────────
// callerEmail обязателен — backend проверяет, что звонящий это водитель или
// отправитель данной поставки (либо тот, кем он себя называет при создании).
export async function saveActiveShipment(
  shipment: Partial<ActiveShipment> & { tripId: string },
  callerEmail: string,
): Promise<ActiveShipment> {
  const res = await fetch(`${BASE}/tracking/${encodeURIComponent(shipment.tripId)}`, {
    method: 'PUT',
    headers: withUserToken(HEADERS),
    body: JSON.stringify({ ...shipment, callerEmail }),
  });

  if (!res.ok) {
    throw new Error(`Failed to save shipment: ${await res.text()}`);
  }

  const data = await res.json();
  localStorage.setItem('ovora_active_shipment', JSON.stringify(data.value));
  return data.value;
}

// ── Get active shipment by trip ID ───────────────────────────────────────────
// callerEmail обязателен — backend отдаёт данные только водителю/отправителю поставки.
export async function getActiveShipment(tripId: string, callerEmail: string): Promise<ActiveShipment | null> {
  try {
    if (!callerEmail) return null;
    const res = await fetch(`${BASE}/tracking/${encodeURIComponent(tripId)}?callerEmail=${encodeURIComponent(callerEmail)}`, {
      method: 'GET',
      headers: withUserToken(HEADERS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value || null;
  } catch (error) {
    console.error('[trackingApi] Error getting shipment:', error);
    return null;
  }
}

// ── Get all active shipments for a user ──────────────────────────────────────
export async function getUserShipments(userEmail: string, role: 'driver' | 'sender'): Promise<ActiveShipment[]> {
  try {
    const url = `${BASE}/tracking/user/${encodeURIComponent(userEmail)}?role=${role}`;
    const res = await fetch(url, { method: 'GET', headers: withUserToken(HEADERS) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.values || [];
  } catch (error) {
    console.error('[trackingApi] Error getting user shipments:', error);
    return [];
  }
}

// ── Update driver real-time location ─────────────────────────────────────────
export async function updateDriverLocation(
  tripId: string,
  lat: number,
  lng: number,
  driverEmail: string,
  accuracy?: number,
): Promise<void> {
  try {
    const shipment = await getActiveShipment(tripId, driverEmail);
    if (!shipment) {
      return;
    }
    await saveActiveShipment({
      ...shipment,
      driverLat: lat,
      driverLng: lng,
      locationAccuracy: accuracy,
      lastLocationUpdate: new Date().toISOString(),
    }, driverEmail);
  } catch (error) {
    console.error('[trackingApi] Error updating location:', error);
  }
}

// ── Update shipment status (6 stages) ────────────────────────────────────────
export async function updateShipmentStatus(
  tripId: string,
  status: ShipmentStatus,
  driverEmail?: string,
): Promise<ActiveShipment | null> {
  try {
    const res = await fetch(`${BASE}/tracking/${encodeURIComponent(tripId)}/status`, {
      method: 'POST',
      headers: withUserToken(HEADERS),
      body: JSON.stringify({ status, driverEmail }),
    });
    if (!res.ok) {
      console.error('[trackingApi] updateShipmentStatus failed:', await res.text());
      return null;
    }
    const data = await res.json();
    // Обновляем локальный кэш
    if (data.value) localStorage.setItem('ovora_active_shipment', JSON.stringify(data.value));
    return data.value || null;
  } catch (err) {
    console.error('[trackingApi] Error updating status:', err);
    return null;
  }
}

// ── Upload POD photo (base64) ─────────────────────────────────────────────────
export async function uploadPODPhoto(
  tripId: string,
  base64: string,
  type: 'loading' | 'unloading',
  driverEmail?: string,
): Promise<PODPhoto | null> {
  try {
    const res = await fetch(`${BASE}/tracking/${encodeURIComponent(tripId)}/pod`, {
      method: 'POST',
      headers: withUserToken(HEADERS),
      body: JSON.stringify({ base64, type, driverEmail }),
    });
    if (!res.ok) {
      console.error('[trackingApi] uploadPODPhoto failed:', await res.text());
      return null;
    }
    const data = await res.json();
    return data.photo || null;
  } catch (err) {
    console.error('[trackingApi] Error uploading POD photo:', err);
    return null;
  }
}

// ── Get POD photos for a shipment ─────────────────────────────────────────────
export async function getPODPhotos(tripId: string): Promise<PODPhoto[]> {
  try {
    const res = await fetch(`${BASE}/tracking/${encodeURIComponent(tripId)}/pod`, {
      method: 'GET',
      headers: withUserToken(HEADERS),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.photos || [];
  } catch (err) {
    console.error('[trackingApi] Error getting POD photos:', err);
    return [];
  }
}

// ── Get public tracking data (no auth, limited fields) ───────────────────────
export async function getPublicTracking(tripId: string): Promise<ActiveShipment | null> {
  try {
    const res = await fetch(`${BASE}/public/tracking/${encodeURIComponent(tripId)}`, {
      method: 'GET',
      headers: withUserToken({ Authorization: `Bearer ${publicAnonKey}` }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.found ? data.shipment : null;
  } catch (err) {
    console.error('[trackingApi] Error getting public tracking:', err);
    return null;
  }
}

// ── Mark shipment as completed ────────────────────────────────────────────────
export async function completeShipment(tripId: string, driverEmail: string): Promise<void> {
  await updateShipmentStatus(tripId, 'delivered', driverEmail);
  const shipment = await getActiveShipment(tripId, driverEmail);
  if (shipment) {
    await saveActiveShipment({
      ...shipment,
      status: 'delivered',
      completedAt: new Date().toISOString(),
    }, driverEmail);
  }
  localStorage.removeItem('ovora_active_shipment');
}

// ── Cancel shipment ───────────────────────────────────────────────────────────
export async function cancelShipment(tripId: string, driverEmail: string, reason?: string): Promise<void> {
  const shipment = await getActiveShipment(tripId, driverEmail);
  if (!shipment) throw new Error('Shipment not found');
  await updateShipmentStatus(tripId, 'cancelled', driverEmail);
  await saveActiveShipment({
    ...shipment,
    status: 'cancelled',
    notes: reason ? `${shipment.notes || ''}\nОтменено: ${reason}` : shipment.notes,
  }, driverEmail);
  localStorage.removeItem('ovora_active_shipment');
}

// ── Get cached shipment from localStorage (offline fallback) ──────────────────
export function getCachedShipment(): ActiveShipment | null {
  try {
    const cached = localStorage.getItem('ovora_active_shipment');
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// ── Generate public tracking link ─────────────────────────────────────────────
export function getPublicTrackingLink(tripId: string): string {
  return `${window.location.origin}/track/${tripId}`;
}

export type TripStatusKey = 'planned' | 'inProgress' | 'frozen' | 'completed' | 'cancelled';

type TripLike = { status?: string; deletedAt?: string | null } | null | undefined;

// Поездки создаются со статусом planned; active и scheduled встречаются только в старых записях.
export function tripStatusKey(trip: TripLike): TripStatusKey {
  if (trip?.deletedAt || trip?.status === 'cancelled') return 'cancelled';
  switch (trip?.status) {
    case 'inProgress': return 'inProgress';
    case 'frozen':     return 'frozen';
    case 'completed':  return 'completed';
    default:           return 'planned';
  }
}

/** Поездка ещё не завершена и не отменена. */
export function isLiveTrip(trip: TripLike): boolean {
  const key = tripStatusKey(trip);
  return key !== 'completed' && key !== 'cancelled';
}

export const TRIP_STATUS_ORDER: TripStatusKey[] = ['planned', 'inProgress', 'frozen', 'completed', 'cancelled'];

export const TRIP_STATUS_META: Record<TripStatusKey, { label: string; plural: string; color: string; bg: string; text: string }> = {
  planned:    { label: 'Запланирована', plural: 'Запланированы', color: '#f59e0b', bg: '#fffbeb', text: '#b45309' },
  inProgress: { label: 'В пути',        plural: 'В пути',        color: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8' },
  frozen:     { label: 'Заморожена',    plural: 'Заморожены',    color: '#8b5cf6', bg: '#f5f3ff', text: '#6d28d9' },
  completed:  { label: 'Завершена',     plural: 'Завершены',     color: '#10b981', bg: '#f0fdf4', text: '#15803d' },
  cancelled:  { label: 'Отменена',      plural: 'Отменены',      color: '#ef4444', bg: '#fef2f2', text: '#dc2626' },
};

export function tripStatusBreakdown(trips: TripLike[]): { name: string; value: number; color: string }[] {
  return TRIP_STATUS_ORDER
    .map(key => ({
      name: TRIP_STATUS_META[key].plural,
      value: trips.filter(t => t && tripStatusKey(t) === key).length,
      color: TRIP_STATUS_META[key].color,
    }))
    .filter(d => d.value > 0);
}

type OfferLike = { status?: string } | null | undefined;

// Водитель отклоняет оффер на поездку статусом declined, на груз — rejected: для отчётов это одно.
export function offerStatusBreakdown(offers: OfferLike[]): { name: string; value: number; color: string }[] {
  const count = (...statuses: string[]) => offers.filter(o => o?.status && statuses.includes(o.status)).length;
  return [
    { name: 'Ожидают',   value: count('pending'),              color: '#f59e0b' },
    { name: 'Приняты',   value: count('accepted'),             color: '#10b981' },
    { name: 'Отклонены', value: count('declined', 'rejected'), color: '#ef4444' },
    { name: 'Отменены',  value: count('cancelled'),            color: '#94a3b8' },
  ].filter(d => d.value > 0);
}

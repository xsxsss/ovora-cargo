// Цена детского места. Её задаёт водитель при публикации поездки (pricePerChild).
// Старые поездки без неё — половина взрослого места, как считалось раньше.
// Та же формула на сервере: expectedOfferPrice в supabase/functions/make-server-4e36197a/capacity.tsx.
export function childSeatPrice(trip: { pricePerSeat?: number | string; pricePerChild?: number | string } | null | undefined): number {
  const child = Number(trip?.pricePerChild) || 0;
  if (child > 0) return child;
  return Math.round((Number(trip?.pricePerSeat) || 0) / 2);
}

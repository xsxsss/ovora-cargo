// rating.tsx — общая формула расчёта среднего рейтинга, юнит-тестируется отдельно.
export function calculateAverageRating(ratings: number[]): number {
  const valid = ratings.map(r => Number(r) || 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, r) => acc + r, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

// LOG-14: Recalculate and propagate rating after review creation or deletion.
// Reads all reviews for targetEmail, computes average, updates user record + all trips.
export async function recalculateRating(kv: any, targetEmail: string): Promise<void> {
  const targetIndex: any[] = await kv.getByPrefix(`ovora:userreviews:target:${targetEmail}:`);
  const reviewIds = [...new Set(targetIndex.filter((e: any) => e?.reviewId).map((e: any) => e.reviewId))];
  const reviews: any[] = reviewIds.length > 0
    ? (await kv.mget(reviewIds.map((id: string) => `ovora:review:${id}`))).filter(Boolean)
    : [];
  const avgRating = reviews.length > 0 ? calculateAverageRating(reviews.map((r: any) => r.rating)) : 0;

  // Update user record
  const userKey = `ovora:user:email:${targetEmail.toLowerCase().trim()}`;
  const user: any = await kv.get(userKey);
  if (user) await kv.set(userKey, { ...user, rating: avgRating });

  // Update all driver trips
  const driverTripsIndex: any[] = await kv.getByPrefix(`ovora:drivertrips:${targetEmail}:`);
  let trips: any[];
  if (driverTripsIndex.length > 0) {
    const tripIds = driverTripsIndex.map((e: any) => e.tripId).filter(Boolean);
    trips = tripIds.length > 0
      ? (await kv.mget(tripIds.map((id: string) => `ovora:trip:${id}`))).filter((t: any) => t && !t.deletedAt)
      : [];
  } else {
    const allTrips: any[] = await kv.getByPrefix(`ovora:trip:`);
    trips = allTrips.filter((t: any) => t && !t.deletedAt && t.driverEmail === targetEmail);
  }
  for (const trip of trips) {
    await kv.set(`ovora:trip:${trip.id}`, { ...trip, driverRating: avgRating });
  }
}

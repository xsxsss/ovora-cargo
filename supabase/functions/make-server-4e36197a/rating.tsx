// rating.tsx — общая формула расчёта среднего рейтинга, юнит-тестируется отдельно.
export function calculateAverageRating(ratings: number[]): number {
  const valid = ratings.map(r => Number(r) || 0);
  if (valid.length === 0) return 0;
  const sum = valid.reduce((acc, r) => acc + r, 0);
  return Math.round((sum / valid.length) * 10) / 10;
}

// LOG-14: пересчёт рейтинга после нового или удалённого отзыва. Рейтинг пишется в профиль и
// в карточки поездок водителя — это делает переданная функция (профиль и поездки в таблицах).
export async function recalculateRating(
  kv: any, targetEmail: string, applyRating: (email: string, rating: number) => Promise<void>,
): Promise<void> {
  const targetIndex: any[] = await kv.getByPrefix(`ovora:userreviews:target:${targetEmail}:`);
  const reviewIds = [...new Set(targetIndex.filter((e: any) => e?.reviewId).map((e: any) => e.reviewId))];
  const reviews: any[] = reviewIds.length > 0
    ? (await kv.mget(reviewIds.map((id: string) => `ovora:review:${id}`))).filter(Boolean)
    : [];
  const avgRating = reviews.length > 0 ? calculateAverageRating(reviews.map((r: any) => r.rating)) : 0;

  await applyRating(targetEmail, avgRating);
}

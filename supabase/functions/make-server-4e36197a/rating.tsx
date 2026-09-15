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
  loadRatings: (email: string) => Promise<number[]>, targetEmail: string,
  applyRating: (email: string, rating: number) => Promise<void>,
): Promise<void> {
  const ratings = await loadRatings(targetEmail);
  const avgRating = ratings.length > 0 ? calculateAverageRating(ratings) : 0;
  await applyRating(targetEmail, avgRating);
}

import { describe, it, expect } from 'vitest';
import { calculateAverageRating, recalculateRating } from './rating.tsx';

describe('calculateAverageRating', () => {
  it('возвращает 0 для пустого списка отзывов', () => {
    expect(calculateAverageRating([])).toBe(0);
  });

  it('считает среднее и округляет до 1 знака', () => {
    expect(calculateAverageRating([5, 4, 5])).toBeCloseTo(4.7, 5);
  });

  it('возвращает точное целое значение для одного отзыва', () => {
    expect(calculateAverageRating([3])).toBe(3);
  });

  it('игнорирует невалидные (NaN/нечисловые) значения как 0', () => {
    expect(calculateAverageRating([5, NaN, 5])).toBeCloseTo(3.3, 5);
  });

  it('корректно округляет границу .x5 вверх', () => {
    expect(calculateAverageRating([4, 5])).toBe(4.5);
  });
});

describe('recalculateRating', () => {
  it('средняя оценка из полученных отзывов уходит в профиль и поездки', async () => {
    const applied: Array<[string, number]> = [];
    await recalculateRating(async () => [5, 4, 4], 'd@x.com', async (email, rating) => { applied.push([email, rating]); });
    expect(applied).toEqual([['d@x.com', 4.3]]);
  });

  it('без отзывов рейтинг 0 (после удаления последнего отзыва)', async () => {
    const applied: number[] = [];
    await recalculateRating(async () => [], 'd@x.com', async (_e, rating) => { applied.push(rating); });
    expect(applied).toEqual([0]);
  });
});

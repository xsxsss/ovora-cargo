import { describe, it, expect } from 'vitest';
import { reviewToRow, rowToReview, notificationToRow, rowToNotification } from './feedRows.tsx';

describe('отзыв ↔ строка', () => {
  const review = {
    reviewId: '1789_abc', authorEmail: 'Sender@X.com', targetEmail: 'driver@x.com', tripId: 't1', rating: 4,
    categories: { punctuality: 4, reliability: 5, communication: 4, packaging: 3 }, authorName: 'S', comment: 'Хорошо',
    tripRoute: 'A → B', type: 'given', verified: true, createdAt: '2026-09-15T10:00:00.000Z',
  };

  it('колонки и остальные поля раскладываются, почта нормализуется', () => {
    const row = reviewToRow(review);
    expect(row).toMatchObject({ id: '1789_abc', author_email: 'sender@x.com', target_email: 'driver@x.com', trip_id: 't1', rating: 4 });
    expect(row.data).toEqual({ categories: review.categories, authorName: 'S', comment: 'Хорошо', tripRoute: 'A → B', type: 'given', verified: true });
  });

  it('туда и обратно — прежний формат', () => {
    expect(rowToReview(reviewToRow(review))).toEqual({ ...review, authorEmail: 'sender@x.com' });
  });
});

describe('уведомление ↔ строка', () => {
  const notification = {
    id: '1789_n1', userEmail: 'u@x.com', type: 'offer', iconName: 'Package', iconBg: 'bg-blue-500/10 text-blue-500',
    title: 'Новая заявка', description: 'Душанбе → Худжанд', isUnread: true, createdAt: '2026-09-15T10:00:00.000Z',
  };

  it('туда и обратно — прежний формат', () => {
    const row = notificationToRow('U@X.com', notification);
    expect(row).toMatchObject({ user_email: 'u@x.com', id: '1789_n1', type: 'offer', is_unread: true });
    expect(row.data).toEqual({ iconName: 'Package', iconBg: 'bg-blue-500/10 text-blue-500', title: 'Новая заявка', description: 'Душанбе → Худжанд' });
    expect(rowToNotification(row)).toEqual(notification);
  });

  it('без isUnread — непрочитанное, без типа — info', () => {
    expect(notificationToRow('u@x.com', { id: '1' })).toMatchObject({ is_unread: true, type: 'info' });
    expect(notificationToRow('u@x.com', { id: '1', isUnread: false }).is_unread).toBe(false);
  });
});

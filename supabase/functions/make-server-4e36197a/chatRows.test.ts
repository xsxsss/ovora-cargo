import { describe, it, expect } from 'vitest';
import { chatToRow, rowToChat, messageToRow, rowToMessage, messagePreview } from './chatRows.tsx';

describe('чат ↔ строка', () => {
  const meta = {
    chatId: 'pair_a_b', participants: ['a@x.com', 'b@x.com'], tripId: 't2', tripIds: ['t1', 't2'],
    tripRoute: 'Душанбе → Худжанд', tripData: { from: 'Душанбе' }, contactInfo: { 'a@x.com': { name: 'B', phone: '+992' } },
    senderInfo: {}, lastMessage: 'Привет', lastMessageAt: '2026-09-15T10:00:00.000Z', lastSenderId: 'a@x.com',
    unreadByEmail: { 'b@x.com': 3 }, hasProposal: true, proposalStatus: 'pending', createdAt: '2026-09-14T10:00:00.000Z',
  };

  it('колонки и карточки собеседников раскладываются, непрочитанное в строку не попадает', () => {
    const row = chatToRow(meta);
    expect(row).toMatchObject({ id: 'pair_a_b', participants: ['a@x.com', 'b@x.com'], trip_ids: ['t1', 't2'],
      last_message: 'Привет', last_sender_id: 'a@x.com', has_proposal: true, proposal_status: 'pending' });
    expect(row.data).toEqual({ tripId: 't2', tripRoute: 'Душанбе → Худжанд', tripData: { from: 'Душанбе' },
      contactInfo: { 'a@x.com': { name: 'B', phone: '+992' } }, senderInfo: {} });
    expect(JSON.stringify(row)).not.toContain('unreadByEmail');
  });

  it('туда и обратно — прежний формат, непрочитанное из chat_unread', () => {
    const back = rowToChat(chatToRow(meta), [{ email: 'b@x.com', count: 3 }]);
    expect(back).toMatchObject(meta);
  });

  it('старая карточка только с tripId получает tripIds', () => {
    expect(chatToRow({ chatId: 'c', participants: ['a', 'b'], tripId: 7 }).trip_ids).toEqual(['7']);
  });
});

describe('сообщение ↔ строка', () => {
  const msg = {
    chatId: 'pair_a_b', msgId: '1789_abc', senderId: 'a@x.com', senderName: 'A', senderAvatar: 'https://x/a.jpg',
    text: null, type: 'proposal', proposal: { id: 'p1', status: 'pending', tripId: 't1' }, from: 'sender',
    ts: 1789000000123, createdAt: '2026-09-15T10:00:00.123Z', read: false,
  };

  it('туда и обратно — те же поля, null сохраняются', () => {
    const back = rowToMessage(messageToRow(msg));
    expect(back).toEqual(msg);
  });

  it('неизвестный тип становится текстом, битая метка времени — из даты', () => {
    const row = messageToRow({ chatId: 'c', msgId: 'm', senderId: 'a', type: 'image', ts: 'x', createdAt: '2026-09-15T10:00:00Z' });
    expect(row.type).toBe('text');
    expect(row.ts).toBe(Date.parse('2026-09-15T10:00:00Z'));
  });

  it('текст в карточке чата', () => {
    expect(messagePreview({ type: 'proposal' })).toBe('Новая оферта на перевозку');
    expect(messagePreview({ type: 'text', text: 'Привет' })).toBe('Привет');
    expect(messagePreview({ type: 'system', text: null })).toBe('');
  });
});

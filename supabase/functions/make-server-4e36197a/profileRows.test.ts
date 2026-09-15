import { describe, it, expect } from 'vitest';
import { userToRow, rowToUser, documentToRow, rowToDocument } from './profileRows.tsx';

describe('пользователь ↔ строка', () => {
  const kvUser = {
    email: ' Ivan@Mail.RU ', role: 'driver', firstName: 'Иван', lastName: 'Петров', phone: '+992900000001',
    vehicle: 'Isuzu', avatarUrl: 'https://x/a.jpg', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-02T10:00:00.000Z',
  };

  it('колонки и карточка раскладываются, почта нормализуется', () => {
    const row = userToRow(kvUser);
    expect(row).toMatchObject({ email: 'ivan@mail.ru', role: 'driver', status: 'active', phone: '+992900000001', is_verified: false });
    expect(row.data).toEqual({ firstName: 'Иван', lastName: 'Петров', vehicle: 'Isuzu', avatarUrl: 'https://x/a.jpg' });
  });

  it('туда и обратно — те же поля', () => {
    const back = rowToUser(userToRow(kvUser));
    expect(back).toMatchObject({ ...kvUser, email: 'ivan@mail.ru', createdAt: '2026-09-01T10:00:00.000Z' });
    expect(back.status).toBe('active');
    expect(back.isVerified).toBe(false);
  });

  it('код входа и паспорт в запись пользователя не попадают', () => {
    const row = userToRow({ ...kvUser, codeHash: 'h', passportNumber: '123', passportData: { a: 1 } });
    expect(JSON.stringify(row)).not.toMatch(/codeHash|passport/);
  });

  it('неизвестные роль и статус не проходят в базу как есть', () => {
    expect(userToRow({ email: 'a@b.c', role: 'admin', status: 'deleted' })).toMatchObject({ role: 'sender', status: 'active' });
    expect(userToRow({ email: 'a@b.c', role: 'sender', status: 'blocked' }).status).toBe('blocked');
  });
});

describe('документ ↔ строка', () => {
  const doc = {
    id: 'passport', userEmail: 'Ivan@mail.ru', type: 'passport', title: 'Паспорт', status: 'verified',
    photoPath: 'documents/ivan/p.jpg', photoUrl: 'https://signed', uploadDate: '2026-09-03T10:00:00Z',
    expiryDate: '2030-01-01', extractedFullName: 'Петров Иван',
    extractedData: { fullName: 'Петров Иван', birthDate: '01.01.1990', documentNumber: '4509 123456' },
  };

  it('номер документа и временная ссылка в открытом виде не сохраняются', () => {
    const row = documentToRow(doc, 'v1:cipher');
    expect(JSON.stringify(row)).not.toContain('123456');
    expect(JSON.stringify(row)).not.toContain('https://signed');
    expect(row).toMatchObject({ user_email: 'ivan@mail.ru', id: 'passport', type: 'passport', status: 'verified',
      photo_path: 'documents/ivan/p.jpg', expiry_date: '2030-01-01', document_number_enc: 'v1:cipher',
      created_at: '2026-09-03T10:00:00.000Z' });
    expect(row.data.extractedData).toEqual({ fullName: 'Петров Иван', birthDate: '01.01.1990' });
  });

  it('обратно — прежний формат API', () => {
    const back = rowToDocument(documentToRow(doc, null));
    expect(back).toMatchObject({ id: 'passport', userEmail: 'ivan@mail.ru', type: 'passport', status: 'verified',
      photoPath: 'documents/ivan/p.jpg', expiryDate: '2030-01-01', title: 'Паспорт', extractedFullName: 'Петров Иван' });
    expect(back.photoUrl).toBeUndefined();
    expect(back.documentNumber).toBeUndefined();
  });

  it('неизвестный статус становится «на проверке», а не «проверен»', () => {
    expect(documentToRow({ ...doc, status: 'ok' }, null).status).toBe('pending');
  });
});

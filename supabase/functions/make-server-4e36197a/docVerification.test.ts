import { describe, it, expect } from 'vitest';
import { decideAutoVerification, type VerificationInput } from './docVerification.tsx';

const NOW = new Date('2026-09-15T12:00:00Z');
const base = (over: Partial<VerificationInput> = {}): VerificationInput => ({
  documentType: 'passport', detectedType: 'passport', ocrFullName: 'Петров Иван Сергеевич',
  ocrExpiryDate: null, manualExpiryDate: null, verifiedPassportName: null, now: NOW, ...over,
});

describe('автопроверка документа', () => {
  it('паспорт с ФИО, прочитанным с фото, одобряется и обновляет профиль', () => {
    expect(decideAutoVerification(base())).toEqual({ status: 'verified', needsProfileUpdate: true });
  });

  it('паспорт без распознанного ФИО — на ручную проверку, даже если ФИО ввели в форме', () => {
    // ручное ФИО в функцию не передаётся вовсе — доказательством оно не является
    expect(decideAutoVerification(base({ ocrFullName: null })).status).toBe('pending');
    expect(decideAutoVerification(base({ ocrFullName: '   ' })).status).toBe('pending');
  });

  it('тип на фото не распознан или другой — на ручную проверку', () => {
    expect(decideAutoVerification(base({ detectedType: 'unknown' })).status).toBe('pending');
    expect(decideAutoVerification(base({ detectedType: 'driver_license' })).status).toBe('pending');
  });

  it('просроченный документ отклоняется — по сроку с фото и по сроку из формы', () => {
    expect(decideAutoVerification(base({ ocrExpiryDate: '2026-09-01' })).status).toBe('rejected');
    const d = decideAutoVerification(base({ manualExpiryDate: '2026-09-10', ocrFullName: null }));
    expect(d.status).toBe('rejected');
    expect(d.rejectionReason).toMatch(/просрочен/);
  });

  it('срок из формы в будущем не помогает одобрить нераспознанный документ', () => {
    expect(decideAutoVerification(base({ manualExpiryDate: '2030-01-01', ocrFullName: null })).status).toBe('pending');
  });

  it('права без одобренного паспорта — на ручную проверку', () => {
    expect(decideAutoVerification(base({ documentType: 'driver_license', detectedType: 'driver_license' })).status).toBe('pending');
  });

  it('права с тем же ФИО, что в паспорте, одобряются (регистр, пробелы, ё)', () => {
    const d = decideAutoVerification(base({
      documentType: 'driver_license', detectedType: 'driver_license',
      ocrFullName: 'ПЕТРОВ  Иван Сергеевич', verifiedPassportName: 'петров иван сергеевич',
    }));
    expect(d).toEqual({ status: 'verified' });
    expect(decideAutoVerification(base({
      documentType: 'insurance', detectedType: 'insurance', ocrFullName: 'Семёнов Пётр', verifiedPassportName: 'Семенов Петр',
    })).status).toBe('verified');
  });

  it('права на другое ФИО отклоняются', () => {
    const d = decideAutoVerification(base({
      documentType: 'driver_license', detectedType: 'driver_license',
      ocrFullName: 'Сидоров Олег', verifiedPassportName: 'Петров Иван Сергеевич',
    }));
    expect(d.status).toBe('rejected');
    expect(d.rejectionReason).toMatch(/не совпадает/);
  });
});

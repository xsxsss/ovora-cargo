// Автоматическая проверка загруженного документа. Чистая функция — покрыта тестами docVerification.test.ts.
//
// Правило: сам одобряется только то, что сервер прочитал С ФОТО. Всё, что прислал человек (ФИО из формы,
// срок действия), доказательством не является. Если распознать не удалось — на ручную проверку админу,
// а не «проверен». Раньше паспорт одобрялся с ФИО, набранным вручную, при любой фотографии.

export type VerificationDecision = {
  status: 'verified' | 'rejected' | 'pending';
  rejectionReason?: string;
  /** Паспорт одобрен — ФИО из него переносится в профиль. */
  needsProfileUpdate?: boolean;
  /** Почему не одобрен автоматически — для лога, не для пользователя. */
  reviewReason?: string;
};

export type VerificationInput = {
  documentType: string;
  /** Тип, который распознавание нашло на фото, или 'unknown'. */
  detectedType: string;
  /** ФИО, прочитанное с фото; null — не прочитано. */
  ocrFullName: string | null;
  /** Срок действия, прочитанный с фото. */
  ocrExpiryDate: string | null;
  /** Срок действия из формы — используется только для отказа, не для одобрения. */
  manualExpiryDate: string | null;
  /** ФИО из уже одобренного паспорта пользователя; null — одобренного паспорта нет. */
  verifiedPassportName: string | null;
  now: Date;
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');

function daysUntil(date: string | null, now: Date): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? null : Math.floor((t - now.getTime()) / 86_400_000);
}

export function decideAutoVerification(input: VerificationInput): VerificationDecision {
  const { documentType, detectedType, ocrFullName, now } = input;

  // Просроченный документ отклоняется по любому сроку — и с фото, и из формы: отказ ничего не даёт обманщику.
  for (const date of [input.ocrExpiryDate, input.manualExpiryDate]) {
    const days = daysUntil(date, now);
    if (days !== null && days < 0) {
      return {
        status: 'rejected',
        rejectionReason: `Документ просрочен. Срок действия истек ${Math.abs(days)} дней назад. Обновите документ.`,
      };
    }
  }

  if (detectedType !== documentType) {
    return { status: 'pending', reviewReason: `type not confirmed by photo (detected ${detectedType})` };
  }
  if (!ocrFullName || !ocrFullName.trim()) {
    return { status: 'pending', reviewReason: 'name not read from photo' };
  }

  if (documentType === 'passport') {
    return { status: 'verified', needsProfileUpdate: true };
  }

  // Остальные документы сверяются с одобренным паспортом. Нет паспорта — сверять не с чем.
  if (!input.verifiedPassportName) {
    return { status: 'pending', reviewReason: 'no verified passport to compare name with' };
  }
  if (norm(input.verifiedPassportName) !== norm(ocrFullName)) {
    return {
      status: 'rejected',
      rejectionReason: `ФИО в документе "${ocrFullName}" не совпадает с паспортом "${input.verifiedPassportName}". Все документы должны быть на одно лицо.`,
    };
  }
  return { status: 'verified' };
}

/**
 * Кто сделал запись в журнале.
 *
 * Бэкенд пишет актора одной строкой: для админских действий это `admin:<роль>`
 * (роль берётся из проверенного токена, см. adminActor в index.ts), для действий
 * обычных людей — их email или телефон. В журнале раньше стояло просто «admin»,
 * и по нему нельзя было отличить директора от сотрудника площадки.
 */

export type ActorInfo = {
  /** Человекочитаемое имя актора */
  label: string;
  /** Короткая метка роли — показываем плашкой; null для обычных пользователей */
  badge: string | null;
  /** Цвет плашки */
  color: string;
};

const ADMIN_ROLES: Record<string, { label: string; badge: string; color: string }> = {
  'super-admin': { label: 'Главный админ', badge: 'директор', color: '#7c3aed' },
  'cargo-admin': { label: 'Админ CARGO', badge: 'CARGO', color: '#1565d8' },
  'avia-admin': { label: 'Админ AVIA', badge: 'AVIA', color: '#0ea5e9' },
};

export function actorInfo(actor?: string): ActorInfo {
  const raw = (actor || '').trim();
  if (!raw) return { label: '—', badge: null, color: '#94a3b8' };

  if (raw.startsWith('admin:')) {
    const role = raw.slice('admin:'.length);
    const known = ADMIN_ROLES[role];
    if (known) return { label: known.label, badge: known.badge, color: known.color };
    // Роль не распознана — так выглядят записи, сделанные до появления ролей.
    return { label: 'Админ', badge: 'роль неизвестна', color: '#64748b' };
  }

  // Старые записи, где стояло просто «admin».
  if (raw === 'admin') return { label: 'Админ', badge: 'роль неизвестна', color: '#64748b' };

  return { label: raw, badge: null, color: '#94a3b8' };
}

/** Плашка роли рядом с именем актора */
export function ActorBadge({ actor }: { actor?: string }) {
  const info = actorInfo(actor);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-medium" style={{ color: info.badge ? info.color : undefined }}>
        {info.label}
      </span>
      {info.badge && (
        <span
          className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: `${info.color}18`, color: info.color }}
        >
          {info.badge}
        </span>
      )}
    </span>
  );
}

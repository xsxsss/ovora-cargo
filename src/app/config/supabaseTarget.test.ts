import { describe, it, expect } from 'vitest';
import { isStagingHost } from '../../../utils/supabase/info';

describe('isStagingHost', () => {
  it('основной адрес и старый GitHub Pages — боевая база', () => {
    expect(isStagingHost('ovora-cargo.saburov.workers.dev')).toBe(false);
    expect(isStagingHost('xsxsss.github.io')).toBe(false);
    expect(isStagingHost('ovora-cargo.ru')).toBe(false);
  });

  it('версии веток на Cloudflare и локальный запуск — тестовая база', () => {
    expect(isStagingHost('staging-ovora-cargo.saburov.workers.dev')).toBe(true);
    expect(isStagingHost('a1b2c3d4-ovora-cargo.saburov.workers.dev')).toBe(true);
    expect(isStagingHost('localhost')).toBe(true);
  });

  it('похожие чужие адреса не считаются тестовыми', () => {
    expect(isStagingHost('staging-ovora-cargo.saburov.workers.dev.evil.com')).toBe(false);
    expect(isStagingHost('staging-ovora-cargo.other.workers.dev')).toBe(false);
  });
});

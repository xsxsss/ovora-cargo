import { describe, it, expect } from 'vitest';
import { metrikaPath } from './yandexMetrika';

describe('metrikaPath', () => {
  it('убирает базу GitHub Pages и оставляет путь страницы', () => {
    expect(metrikaPath('/ovora-cargo/search', '/ovora-cargo/')).toBe('/search');
    expect(metrikaPath('/ovora-cargo/', '/ovora-cargo/')).toBe('/');
  });

  it('работает и без базы (Vercel)', () => {
    expect(metrikaPath('/trips', '/')).toBe('/trips');
  });

  it('админку не считает', () => {
    expect(metrikaPath('/ovora-cargo/admin', '/ovora-cargo/')).toBeNull();
    expect(metrikaPath('/ovora-cargo/admin/cargo/users', '/ovora-cargo/')).toBeNull();
    expect(metrikaPath('/admin', '/')).toBeNull();
  });

  it('страница, которая лишь начинается на admin, считается', () => {
    expect(metrikaPath('/administration-info', '/')).toBe('/administration-info');
  });

  it('скрывает телефон и идентификаторы в адресе', () => {
    expect(metrikaPath('/ovora-cargo/avia/user/992900123456', '/ovora-cargo/')).toBe('/avia/user/:phone');
    expect(metrikaPath('/trip/1789235710088_tcdkrb', '/')).toBe('/trip/:id');
    expect(metrikaPath('/chat/pair_abc_def', '/')).toBe('/chat/:id');
    expect(metrikaPath('/track/1789235710088_tcdkrb', '/')).toBe('/track/:id');
    expect(metrikaPath('/avia/flight/f_123/manifest', '/')).toBe('/avia/flight/:id/manifest');
  });
});

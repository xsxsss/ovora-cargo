import { test, expect } from '@playwright/test';

test.describe('сайт открывается', () => {
  test('главная без ошибок в консоли', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // Ответы с ошибкой собираем по адресу: текст «Failed to load resource» в консоли адреса не содержит.
    page.on('response', r => {
      // Известный открытый пункт CLAUDE.md «Ключ Яндекс.Карт»: ключ отдаётся только админу.
      if (r.status() >= 400 && !r.url().endsWith('/config/yandex-key')) errors.push(`${r.status()} ${r.url()}`);
    });

    const res = await page.goto('/');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.waitForLoadState('networkidle');

    // Сторонние счётчики и шрифты могут быть заблокированы сетью — это не ошибка сайта.
    const own = errors.filter(e => !/mc\.yandex|yastatic|fonts\.g/.test(e));
    expect(own, own.join('\n')).toEqual([]);
  });

  test('на тестовой версии видна плашка — не спутать с живым сайтом', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('ТЕСТОВАЯ ВЕРСИЯ')).toBeVisible();
  });

  test('прямая ссылка на страницу открывает приложение, а не 404', async ({ page }) => {
    const res = await page.goto('/privacy-policy');
    expect(res?.status()).toBe(200);
    await expect(page.locator('#root')).not.toBeEmpty();
  });

  test('ссылка отписки без подписи — «недействительна», без кнопки', async ({ page }) => {
    await page.goto('/unsubscribe?email=victim@mail.ru');
    await expect(page.getByRole('heading', { name: 'Ссылка недействительна' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Отписаться' })).toHaveCount(0);
  });

  test('заголовки безопасности на месте', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain('frame-ancestors');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['strict-transport-security']).toContain('max-age=');
  });
});

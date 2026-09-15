// Вход без письма — только для сквозных тестов на ТЕСТОВОЙ площадке.
// Три независимых замка, любой из них закрывает вход:
//  1. боевой проект зашит в код как запрет — на нём вход не включить никакой настройкой;
//  2. нужен флаг E2E_LOGIN_ENABLED=true в секретах проекта;
//  3. только адреса e2e+<имя>@ovora.test — настоящую почту так не получить.

export const PRODUCTION_PROJECT_REF = 'mkbcjxnoeevtkzaqcpsh';

const E2E_EMAIL = /^e2e\+[a-z0-9-]{1,40}@ovora\.test$/;

export function isE2eLoginEnabled(supabaseUrl: string, flag: string | undefined): boolean {
  if (!supabaseUrl || supabaseUrl.includes(PRODUCTION_PROJECT_REF)) return false;
  return flag === 'true';
}

export function isE2eEmail(email: unknown): email is string {
  return typeof email === 'string' && E2E_EMAIL.test(email);
}

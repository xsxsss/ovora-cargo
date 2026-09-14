// Токен сессии (X-User-Token), который выдаёт бэкенд при входе. Сервер верит только ему,
// а email в теле или адресе запроса без токена ничего не доказывает.
const USER_TOKEN_KEY = 'ovora_user_token';

export function userTokenHeader(): Record<string, string> {
  try {
    const token = localStorage.getItem(USER_TOKEN_KEY);
    return token ? { 'X-User-Token': token } : {};
  } catch {
    return {};
  }
}

/** Заголовки запроса плюс токен текущей сессии. Читается при каждом запросе: токен меняется при входе. */
export function withUserToken(headers: Record<string, string>): Record<string, string> {
  return { ...headers, ...userTokenHeader() };
}

// sessionGuard.ts — единая реакция клиента на «токен сессии больше не принимается».
//
// Зачем: пока AVIA_JWT_SECRET / USER_JWT_SECRET не заданы на бэкенде, токен
// сессии не выдаётся вовсе, и в localStorage у всех действующих пользователей
// лежит сессия без поля token со сроком 30 дней. В момент, когда секрет
// добавляют, бэкенд начинает требовать токен — и каждая такая сессия получает
// 401 на почти любом запросе. Своими силами она не восстановится: TTL ещё не
// вышел, поэтому фронт считает пользователя залогиненным и показывает пустые
// экраны с ошибками, пока человек не додумается почистить хранилище.
//
// Поэтому бэкенд помечает именно этот класс отказов кодом в теле ответа
// (см. aviaAuth.tsx / userAuth.tsx), а здесь мы его ловим и поднимаем событие.
// Слушатель (AviaContext / AuthContext) разлогинивает и отправляет на вход —
// пользователь вводит PIN/пароль один раз и получает уже нормальный токен.
//
// Код в теле, а не просто статус 401, нужен чтобы не спутать это с обычными
// «неверный PIN» и «неверный пароль» — у них тот же статус, но сессию трогать
// нельзя.

export const AVIA_SESSION_EXPIRED_EVENT = 'ovora:avia-session-expired';
export const USER_SESSION_EXPIRED_EVENT = 'ovora:user-session-expired';

const AVIA_TOKEN_INVALID = 'AVIA_TOKEN_INVALID';
const USER_TOKEN_INVALID = 'USER_TOKEN_INVALID';

async function inspect(res: Response, code: string, eventName: string): Promise<void> {
  if (res.status !== 401) return;
  try {
    // clone(): тело ответа читает вызывающий код, поток нельзя забирать себе.
    const data = await res.clone().json();
    if (data?.code === code) {
      window.dispatchEvent(new Event(eventName));
    }
  } catch {
    // не JSON или тело уже недоступно — значит это не наш случай
  }
}

function makeGuardedFetch(code: string, eventName: string) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(input, init);
    await inspect(res, code, eventName);
    return res;
  };
}

/** fetch для AVIA-эндпоинтов — ведёт себя как обычный fetch. */
export const aviaFetch = makeGuardedFetch(AVIA_TOKEN_INVALID, AVIA_SESSION_EXPIRED_EVENT);

/** fetch для CARGO-эндпоинтов — ведёт себя как обычный fetch. */
export const cargoFetch = makeGuardedFetch(USER_TOKEN_INVALID, USER_SESSION_EXPIRED_EVENT);

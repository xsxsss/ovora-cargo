# CLAUDE.md — Ovora Cargo Mobile

Контекст проекта для Claude Code. Читай этот файл в начале каждой сессии.

---

## Стек и архитектура

| Слой | Технология |
|---|---|
| Frontend | React 18 + TypeScript + Vite 6 + Tailwind CSS v4 |
| Роутинг | React Router v7 |
| Анимации | Framer Motion (`motion/react`) |
| Backend | Supabase Edge Functions (Deno/Hono) |
| База данных | Supabase KV Store (не PostgreSQL!) |
| Хранилище файлов | Supabase Storage |
| Email | SMTP через edge function |
| Push | Web Push API (VAPID) |
| OCR | OCR.space API |
| Карты | Yandex Maps API v3 |

**Это PWA** (Progressive Web App), не нативное мобильное приложение.

---

## Git и деплой

**Репозиторий:** `https://github.com/xsxsss/ovora-cargo.git` (remote `origin`, ветка `main`).

Старый аккаунт `magamed99` заблокирован GitHub — вместе с ним оказался
заблокирован и привязанный к нему Vercel-проект `dly-a-prid` (`live: false`,
все деплои `BLOCKED`, снять паузу через API нельзя — 403). Поэтому проект
переехал на новый аккаунт.

**Живой сайт:** https://xsxsss.github.io/ovora-cargo/ (GitHub Pages)

**Деплой:**
```bash
git push origin HEAD:main    # пуш → GitHub Actions → Pages, ~1-2 мин
```

**Base-путь определяется автоматически** — не зашивай его константой:
- GitHub Pages отдаёт из подпапки, workflow подставляет `VITE_BASE=/<имя репо>/`
- Vercel отдаёт из корня — база остаётся `/`
- Роутер берёт базу из `import.meta.env.BASE_URL`
- `service-worker.js` и `404.html` вычисляют её из своего адреса (Vite их не обрабатывает)

**Локальная проверка собранной версии:**
```bash
npm run build && npm run preview   # http://localhost:4173
```

---

## Ключевые файлы

| Файл | Назначение |
|---|---|
| `src/app/components/Welcome.tsx` | Главная страница — десктоп/мобайл |
| `src/styles/index.css` | CSS Grid Welcome-страницы, анимации |
| `src/app/i18n/translations.ts` | Переводы ru/tj/en (144 ключа) |
| `src/vite-env.d.ts` | TypeScript global declarations |
| `supabase/functions/make-server-4e36197a/index.ts` | Весь backend API (~7300 строк) |
| `supabase/functions/make-server-4e36197a/rateLimit.tsx` | Token bucket rate limiter |
| `supabase/functions/make-server-4e36197a/kv_store.tsx` | KV абстракция |
| `supabase/functions/make-server-4e36197a/email.tsx` | Email шаблоны |
| `netlify.toml` | Netlify конфиг + CSP/HSTS headers |
| `vercel.json` | Vercel конфиг + CSP/HSTS headers |
| `index.html` | CSP meta-тег (fallback для GitHub Pages) |
| `public/manifest.json` | PWA манифест |
| `.github/workflows/deploy-pages.yml` | CI: typecheck → build → deploy |

---

## Welcome-страница — раскладка (десктоп 700px+)

**CSS Grid 3-колонки × 3-строки** (`src/styles/index.css`):
```
[lang selector]  [пусто — hero просвечивает]  [AVIA карточка ]
[Платформа Ovora]                             [CARGO карточка]
[features bar ————————————— partners card         ————————————]
```

Grid области:
- `.ovora-area-lang`   → col 1 / row 1
- `.ovora-area-brand`  → col 1 / row 2 (скрыт на мобиле)
- `.ovora-area-cards`  → col 3 / rows 1-2
- `.ovora-area-bottom` → col 1/-1 / row 3

**Hero-оверлей:** три направленных градиента (left/right/bottom) скрывают грузовик
`OVORA-CARGO` из фоновой картинки чтобы он не просвечивал через левую колонку.

На мобиле: flex column, порядок → cards → lang → bottom.

---

## Backend API — паттерны безопасности

Все эндпоинты: `POST /make-server-4e36197a/<route>`

### Admin middleware + RBAC
```ts
// Legacy plaintext (backward-compat) — всегда роль super-admin:
X-Admin-Code: <plaintext>

// Role-scoped JWT (подписан ADMIN_JWT_SECRET, 8 часов) — отдельный заголовок,
// т.к. Authorization зарезервирован под Supabase anon key:
X-Admin-Token: <jwt>          // payload: { role: 'super-admin' | 'cargo-admin' | 'avia-admin' }
```
- `super-admin` проходит любую `requireRole(...)` проверку (полный доступ).
- `cargo-admin` — доступ только к `/admin/*` (CARGO + общие разделы).
- `avia-admin` — доступ только к `/avia/admin/*`.
- `cargo-admin`/`avia-admin` работают **только** через JWT — `ADMIN_JWT_SECRET` обязателен, иначе `/admin/auth` отказывает в выдаче токена для этих ролей.
- Фронтенд: роль и токен хранятся в `sessionStorage` (`ovora_admin_role`, `ovora_admin_jwt`/`ovora_admin_token`), `AdminLayout.tsx` фильтрует `navGroups` по роли.

### Правила авторизации (применены)
- `callerEmail` **обязателен** везде где есть проверка владельца
- `PUT /auth/user` — нельзя менять: `role`, `status`, `codeHash`, `blocked`, `isVerified`, `passportNumber`, `passportData`
- `GET /chat/:chatId/messages` — `?callerEmail=` обязателен, проверяется в `participants`
- `PUT /cargos/:id` — `callerEmail` должен совпадать с `senderEmail`
- `DELETE /reviews/:id` — `callerEmail` обязателен
- `PUT /offers/:id` — `callerEmail` должен быть `senderEmail` или `driverEmail`

### Rate limits (из `rateLimit.tsx`)
| Эндпоинт | Лимит |
|---|---|
| `/auth/login-email` | 15 req / 5 мин |
| `/auth/login-phone` | 15 req / 5 мин |
| `/auth/register` | 3 req / час |
| `/admin/auth` | 15 req / 5 мин |

### CORS
Разрешены только: `ovora-cargo.ru` (+ поддомены), `xsxsss.github.io`, `localhost:5173/4173`

**Важно:** при переезде сайта на новый домен его нужно добавить в `ALLOWED_ORIGINS`
(`index.ts`), иначе браузер получит `Failed to fetch` — бэкенд будет жив, но
отклонит запросы с неизвестного origin.

---

## Переменные окружения (Supabase Secrets)

| Переменная | Назначение |
|---|---|
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role ключ |
| `ADMIN_ACCESS_CODE` | Пароль для `/admin/auth` → роль `super-admin` |
| `ADMIN_ACCESS_CODE_CARGO` | Пароль для роли `cargo-admin` (опционально, RBAC) |
| `ADMIN_ACCESS_CODE_AVIA` | Пароль для роли `avia-admin` (опционально, RBAC) |
| `ADMIN_JWT_SECRET` | Секрет для подписи JWT токенов (минимум 32 символа) |
| `AVIA_JWT_SECRET` | Секрет для подписи AVIA session-токенов (`X-Avia-Token`, минимум 32 символа) |
| `SUPABASE_ANON_KEY` | Anon key — нужен для вызова GoTrue (`/auth/v1/otp`, `/auth/v1/verify`) из бэкенда |
| `USER_JWT_SECRET` | Секрет для подписи CARGO session-токенов (`X-User-Token`, минимум 32 символа) |
| `YANDEX_GEOCODER_API_KEY` | Yandex Geocoder API |
| `OCR_SPACE_API_KEY` | OCR.space для распознавания документов |

**Критично:**
- `ADMIN_JWT_SECRET` ещё не добавлен в Supabase Secrets — без него JWT не выдаётся, работает только legacy `X-Admin-Code` (роль `super-admin`). Роли `cargo-admin`/`avia-admin` недоступны, пока не настроены `ADMIN_JWT_SECRET` + соответствующий `ADMIN_ACCESS_CODE_*`.
- `AVIA_JWT_SECRET` ещё не добавлен в Supabase Secrets — без него `verifyAviaActor()` в `aviaAuth.tsx` работает в legacy-режиме (пропускает все проверки без подтверждения личности), т.е. защита от подмены `callerPhone` в AVIA-эндпоинтах **не действует**, пока секрет не настроен.

---

## Переводы (i18n)

Файл: `src/app/i18n/translations.ts`
Языки: `ru` | `tj` | `en` — **144 ключа**, все три языка полностью покрыты.

Проверка синхронности переводов:
```bash
python3 -c "
import re
with open('src/app/i18n/translations.ts') as f: c = f.read()
def keys(lang):
    m = re.search(rf'{lang}:\s*\{{(.*?)^\s*\}},', c, re.DOTALL|re.MULTILINE)
    return set(re.findall(r'^\s+(\w+)\s*:', m.group(1), re.MULTILINE)) if m else set()
ru,tj,en = keys('ru'),keys('tj'),keys('en')
print(f'RU:{len(ru)} TJ:{len(tj)} EN:{len(en)}')
print('Missing TJ:', sorted(ru-tj))
print('Missing EN:', sorted(ru-en))
"
```

---

## TypeScript

```bash
npm run typecheck   # tsc --noEmit — 0 ошибок
npm run build       # сборка через Vite/esbuild — не делает type-check
```

- `tsconfig.json` создан с `strict: true`
- `typescript`, `@types/react`, `@types/react-dom` установлены в devDependencies
- CI запускает `typecheck` перед build (non-blocking: `|| true`)
- Известный реальный баг исправлен: `TripDetail` — отсутствовал `useNavigate()`

---

## Безопасность — сделано в этой сессии

### Edge Function (все в `index.ts`)
| ID | Уязвимость | Исправление |
|---|---|---|
| C-2 | Privilege escalation `PUT /auth/user` | Whitelist полей, блокировка `role`/`status`/`codeHash` |
| H-1 | IDOR chat messages | Проверка `participants` на всех чат-эндпоинтах |
| H-2 | PII leak в login | Удаляем `codeHash`, `passportNumber`, `passportData` из ответа |
| H-3 | IDOR `PUT /cargos/:id` | Проверка `callerEmail === senderEmail` |
| H-4 | Yandex key публичный | `requireAdmin` на `/config/yandex-key` |
| H-5 | Plaintext admin token | JWT (HS256, 8ч) через `npm:jose` |
| H-7 | `/test-ocr` без auth | `requireAdmin` |
| M-4 | `callerEmail` опциональный | Обязателен в `/offers` и `/reviews` |
| M-5 | `/chats/cleanup-demo` | `requireAdmin` |
| M-6 | `/ocr/scan-document` cost hijack | Проверка `callerEmail` + существование юзера |
| CORS | `origin: "*"` | Allowlist доменов |
| Rate | Нет лимитов на auth | `RL.LOGIN` + `RL.REGISTER` |

### Frontend
| Что | Файл |
|---|---|
| CSP + HSTS + Permissions-Policy | `netlify.toml`, `vercel.json`, `index.html` |
| SPA redirect вынесен из inline | `public/spa-redirect.js` |
| Дублирующий `@import fonts.css` | Удалён из `src/styles/index.css` |
| PWA meta tags | `index.html`, `manifest.json` |

---

## Журнал админки — кто что делал

Два журнала, по одному на площадку: `cargoAudit.tsx` (`ovora:cargo-audit:*`) и
`aviaAudit.tsx` (`ovora:avia-audit:*`). В главной админке они собраны в папку
«Аудит»; сотрудник площадки видит в ней только свой журнал.

- Актор админских записей — `admin:<роль>`, роль берётся из проверенного токена
  (`adminActor(c)` в `index.ts` и `aviaRoutes.tsx`). Просто `admin` писать нельзя —
  по такой записи не отличить директора от сотрудника.
- `adminActor(c)` попутно ставит `c.set('auditLogged', true)`. Вызывать его
  **только** внутри `AuditLog.record(...)` — иначе сквозной журнал решит, что
  запрос уже записан, и пропустит его.
- Сквозной журнал (`auditFallback` в `index.ts`) пишет `admin.request` для любого
  POST/PUT/PATCH/DELETE к `/admin/*` и `/avia/admin/*`, который обработчик не
  залогировал подробно. Новый раздел админки нельзя забыть залогировать.
- Вход в админку — `admin.login` (в самом `/admin/auth`), с IP и user-agent,
  включая неудачные попытки подбора кода.

## Данные о человеке и устройстве

- `authIdentity.tsx` — дописывает в карточку Supabase Auth (Authentication → Users)
  Display name и Phone через Admin API. Без этого в дашборде они пустые: в GoTrue
  уходит только email. Вызывается из `/auth/register` и `PUT /auth/user`.
  id пользователя в Auth запоминается в KV (`ovora:auth_uid:<email>`) при проверке
  кода из письма — чтобы не искать его по всей таблице.
- `deviceInfo.tsx` — разбирает User-Agent (браузер, ОС, модель телефона) и хранит
  последние 5 входов в `ovora:device:<platform>:<id>`. Пишется при входе CARGO
  (`verify-perm-code`) и AVIA (`/avia/login`), читается в админке
  (`GET /admin/users/:email/devices`, `GET /avia/admin/users/:phone/devices`).
  Это персональные данные — наружу не отдаются.

## Кеш привязан к аккаунту

`src/app/api/sessionScope.ts` — `claimCacheOwner('cargo:<email>' | 'avia:<phone>')`
вызывается в момент входа и стирает весь пользовательский localStorage, если
устройство было закреплено за другим аккаунтом.

Так закрыт баг «в одном приложении зашли в два аккаунта — второй видел переписку
первого»: чаты, сообщения и поездки лежат под общими ключами, а старая очистка
сверялась с `sessionStorage`, который умирает вместе с вкладкой.

Добавляя новый ключ в localStorage: всё, что начинается на `ovora`, считается
пользовательским и стирается при смене аккаунта. Настройки устройства (язык,
звук, вибрация) перечислены в `DEVICE_KEYS` — их дополняй явно.

## Команды

```bash
npm run dev          # dev сервер
npm run build        # production build → dist/
npm run typecheck    # TypeScript проверка

# Деплой
vercel --prod        # задеплоить на https://dly-a-prid.vercel.app
```

---

## Правила для Claude

1. **Не трогать `role`/`status`/`codeHash` в пользовательских эндпоинтах** — защищены whitelist
2. **`callerEmail` обязателен** во всех write-операциях (cargos, offers, reviews, chats)
3. **Переводы**: добавляй ключи сразу в `ru` + `tj` + `en`
4. **Inline скрипты в `index.html` запрещены** — CSP без `unsafe-inline` для скриптов
5. **Деплой — только через GitHub Pages** (`git push origin HEAD:main`). Пуш делает пользователь: `git push` блокируется классификатором auto-mode
6. **Секреты пользователь вставляет сам** — не просить прислать токен/пароль в чат и не вводить их за него

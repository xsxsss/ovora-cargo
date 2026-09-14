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
| `src/app/i18n/translations.ts` | Переводы ru/tj/en (167 ключей) |
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

**Статус секретов (проверено по логам продакшена 2026-09-13):**
- `ADMIN_JWT_SECRET` — **настроен**. В логах есть `Access granted (role=cargo-admin)` и `(role=avia-admin)`, а эти роли выдаются только через JWT.
- `AVIA_JWT_SECRET` — **настроен**. Входы в AVIA идут без предупреждения `AVIA_JWT_SECRET not configured`.
- `USER_JWT_SECRET` — **настроен**. На каждом входе в CARGO без секрета писалось бы `USER_JWT_SECRET not configured` — таких записей нет. Поэтому `getCallerEmail()` игнорирует `callerEmail` из тела запроса (legacy-фолбэк выключен).

**Не делай выводов о секретах по коду или по этому файлу — проверяй логи.** Без секрета
модули пишут предупреждение на каждом входе, так что его отсутствие в `function_logs` —
надёжный признак, что секрет задан:
```sql
select event_message from logs where source = 'function_logs'
  and event_message like '%JWT_SECRET not configured%'
```
Значения секретов не спрашивай и не проси вставить в чат — их добавляет владелец сам.

---

## Переводы (i18n)

Файл: `src/app/i18n/translations.ts`
Языки: `ru` | `tj` | `en` — **167 ключей** (проверено 2026-09-13), все три языка полностью покрыты.

Проверка синхронности переводов (на Windows вместо `python3` — `python`):
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
- CI запускает `typecheck`, `test` и `lint` перед build — **все три блокируют деплой** (снято «пропускать ошибки» 2026-09-13, когда ошибок стало 0)
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

npm run lint         # ESLint — 0 ошибок (предупреждения не блокируют)
npm run test         # Vitest

# Деплой — только через GitHub Pages (Vercel заблокирован, см. «Git и деплой»)
git push origin HEAD:main
```

---

## Внешние инструменты агентов — Context7 и Strix

Два инструмента подключены в помощь агентам. Работают **параллельно** с основной
работой: Context7 — во время написания кода, Strix — для проверки безопасности
перед выпуском.

### Context7 — свежая документация по стеку (MCP-сервер)

Отдаёт **актуальную** документацию и примеры по конкретной версии библиотеки:
React Router v7, Vite 6, Hono, Supabase, Radix, Tailwind v4, Deno и т.д. Знание
модели устаревает, а Context7 читает документацию в реальном времени — это прямое
применение правила «проверять, а не верить»: перед кодом против незнакомого или
нового API спроси Context7, а не пиши по памяти.

- Подключён в `.mcp.json` в корне проекта (файл в `.gitignore` — **локальный,
  в git и к другому агенту через репозиторий не попадёт**; у каждого свой).
- Запуск: `npx -y @upstash/context7-mcp` (в конфиге через `cmd /c` — так надёжнее
  на Windows). Нужен Node — есть.
- **Заработает только в новой сессии.** MCP-серверы грузятся при старте; при первом
  запуске Claude Code спросит разрешение на новый сервер из `.mcp.json` — подтвердить.
- Ключ необязателен: без него работает с ограничением частоты. Для более высокого
  лимита владелец берёт бесплатный ключ на context7.com/dashboard и **сам** дописывает
  в `.mcp.json` (`"--api-key", "…"` в `args`). Ключ в чат не присылать — файл локальный,
  правит владелец.
- Инструменты сервера: `resolve-library-id` (имя → id библиотеки) и `get-library-docs`
  (документация по версии).

### Strix — тест безопасности своего приложения (отдельный CLI, НЕ MCP)

Автономный ИИ-агент для пентеста: гоняет приложение динамически, ищет уязвимости и
подтверждает их. Это тот самый прогон безопасности «на 100% перед запуском».
`https://github.com/usestrix/strix`

- **Это не MCP-плагин.** Strix — отдельная программа: ставится установщиком с сайта,
  запускается как своя команда `strix`, требует Docker и **свой** ключ LLM
  (`STRIX_LLM`, `LLM_API_KEY`). К Claude подключается не по MCP, а как набор
  скиллов (SKILL.md) или запускается отдельно.
- **Ставит и запускает только владелец.** Установщик скачивается из интернета, а сам
  Strix выполняет код приложения — агенты (Claude, MiMo) его не устанавливают и не
  запускают сами. Тестировать разрешено только **своё** приложение Ovora.
- Годится в CI на pull request (лёгкая проверка) — включать по решению владельца.

### Правило по ключам (оба инструмента)

Ключ Context7 и ключ LLM для Strix добавляет **владелец сам** — в `.mcp.json`
(в `.gitignore`) или в переменные окружения / `.env.local` (тоже в `.gitignore`).
В чат и в код не присылать, в коммиты не класть. См. правило 1 ниже.

## Совместная работа Claude и MiMo

Над проектом работают два агента. **Этот файл — их общий канал**: оба читают его
в начале сессии, пишут сюда предложения и решения и отвечают друг другу здесь,
а не в голове у владельца.

### Роли
- **Claude** — архитектор и ревьюер: проверяет предложения по коду и логам,
  смотрит diff перед выпуском.
- **MiMo** — исполнитель параллельных задач: аудит, рутинные правки, тесты.
- **Владелец** — решает спорное и выкладывает на сайт.

### Жёсткие правила для обоих агентов
1. **Секреты** — значения не спрашивать, не писать в код, коммиты, чат и этот файл.
   Добавляет владелец сам в Supabase. (Однажды секреты уже утекли в коммит — PR #159.)
2. **Проверять, а не верить.** Утверждение о проблеме — только с доказательством
   из кода, логов или команды. Документация устаревает: аудит MiMo объявил
   «авторизация не работает» по старому тексту этого файла, а по логам секреты работали.
3. **Одна папка, одна ветка** (решение владельца). Оба агента работают в этой папке на
   текущей ветке. Ветки не переключать (`git checkout`, `git switch`) — у второго агента
   файлы поменяются посреди работы. В `main` не пушить: `main` = живой сайт, пушит
   владелец после проверки.
4. **Перед «готово»** — `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`,
   все зелёные. В CI это обязательные шаги.
5. **Ядро не трогать без решения на доске:** `UserContext`, `TripsContext`, `chatStore`,
   авторизация, `sessionScope.ts` (изоляция кеша между аккаунтами), учёт ёмкости рейсов
   (`adjustFlightCapacity`), формат ответов API.
6. **Один коммит — одна тема.** Маленькие изменения, которые можно проверить за раз
   и при необходимости откатить отдельно.
7. **Чужое не трогать.** Перед началом работы — `git status`. Чужие несохранённые правки
   не коммитить, не откатывать и не прятать. Запрещено в общей папке: `git stash`,
   `git reset --hard`, `git restore .`, `git checkout -- .`, `git clean` — они стирают
   незаконченную работу второго агента.
8. **Коммитить только своё.** Добавлять файлы явно по путям: `git add <файл>`. Никогда
   `git add -A`, `git add .`, `git commit -a` — они захватят чужие правки. Перед коммитом
   `git diff --cached --stat`: в коммите ровно то, что менял ты.
9. **Кто что делает.** Взял пункт с доски — впиши в его строку «в работе: MiMo» или
   «в работе: Claude». Один файл одновременно правит один агент. Коммиты MiMo начинаются
   с `mimo:` — при проверке сразу видно автора.
10. **Два файла.** `CLAUDE.md` читают оба агента в начале каждой сессии, поэтому он должен
    оставаться коротким: правила, текущее состояние, открытые задачи. Разобранное —
    аудиты, проверки закрытых заданий, прежние версии дизайна — переноси в `CLAUDE2.md`.
    Закрыл задание или спецификацию выпустили — перенеси её туда же.

### Что считается профессиональным на этом проекте

Не общие слова, а то, чем принятые правки отличались от возвращённых.

**Проверять реальность, а не документацию.** Статус поездки — `planned`, хотя бэкенд по
умолчанию ставит `active`; секреты давно настроены, хотя в этом файле стояло «не добавлены».
Дважды из-за этого возвращались правки, один раз родился ложный «критический» пункт аудита.
Источник правды — код, который данные создаёт, логи продакшена и сама база.

**Проверять обе стороны.** Меняешь общий контракт — смотри и фронт, и бэк. LOG-1 и LOG-9 были
отклонены ровно потому, что проверена была одна сторона.

**Сначала искать готовое, потом писать новое.** Образец — UX-3: механизм уведомлений уже
существовал и был мёртв из-за одного слова в статусе. Одна строка вместо нового кода. Прежде чем
писать — посмотри, нет ли рядом работающего примера: AVIA часто впереди CARGO.

**Отдавать работу платформе.** Если то же самое умеет база данных или браузер — пусть делает
она, а не наш код. См. MIGR-1: связь `ON DELETE CASCADE` в схеме решает задачу, на которую
ушло три круга проектирования.

**Мёртвое удалять, а не чинить.** BAK-1: неиспользуемые адреса резервных кодов удалены целиком,
а не обвешаны лимитами. Неиспользуемый код — поверхность для атаки без всякой пользы.

**Маленькие обратимые шаги.** Один коммит — одна мысль. Пять коммитов волны 2 выстроены по
нарастанию риска именно поэтому.

**Честно говорить, что не проверено.** «UX-5, UX-9, UX-10 построчно не проверял» — нормально.
Выдать непроверенное за проверенное — нет.

**Знать, где мы ниже уровня.** Сейчас ниже вот в чём — это не отговорка, а список задач:
- нет автотестов на критичные потоки (приём заявок, учёт мест, документы), поэтому проверка ручная;
- нет тестовой площадки: `main` выкладывается сразу на живой сайт;
- Sentry подключён, но оповещений нет — ошибки, которые мы договорились писать в лог, никто
  не увидит, пока не пойдёт смотреть специально.

### Журнал изменений Claude — что уже сделано

Сделанное здесь не переделывать и не откатывать без решения владельца. Подробности —
в сообщении коммита: `git show <коммит>`.

| Коммит | Что сделано | Что важно знать, чтобы не сломать |
|---|---|---|
| `f32c959` | Журнал админки: роль актора, папка «Аудит», сквозная запись `admin.request`, вход `admin.login` | `adminActor(c)` вызывать только внутри `AuditLog.record` — см. «Журнал админки» |
| `bc79f50` | Кеш привязан к аккаунту (`sessionScope.ts`); имя и телефон в Supabase Auth; устройства входа | Ядро. Всё в localStorage с префиксом `ovora` стирается при смене аккаунта — см. «Кеш привязан к аккаунту» |
| `a4af7f7` | Чистка журналов аудита: полгода или 5000 записей, не чаще раза в час | Ключ записи собирается обратно из `timestamp` и `id` — формат `ovora:*-audit:{ms}:{id}` не менять |
| `643dfc1` | Кнопка «Досылать в Supabase» на странице «Коды доступа» | `POST /admin/auth/sync-identities`, только главный админ |
| `e8c87f4` | AVIA: лимит пакетов документов вместо «без ограничений» | Рейс хранит `docsCount` / `docsFree` / `docsReserved`, учёт только через `adjustFlightCapacity` (ядро). Рейсы без `docsCount` созданы до изменения и **намеренно** безлимитны — проверки `docsCount == null` не удалять |
| `288e60e` → `e2f5df7` | Перенос фона главной из старой копии `ovora-work` — **откачен по решению владельца** | Фон, свечения и надпись на фото из `ovora-work` повторно не переносить |
| `8bb50ad` | Статус JWT-секретов проверен по логам | См. «Статус секретов» |
| `70780ca` | CI: typecheck и lint блокируют деплой; удалён сломанный `deploy-functions.yml` | С ошибками типов или lint сайт не выложится |
| `d418a6e` | Удалены `src/imports/`, MUI, emotion | — |
| `c339501` | Удалены резервные коды `/auth/backup/*` (BAK-1) | Восстановление доступа — только через код на почту, старые адреса не возвращать |
| `6f0a58b` | Один менеджер пакетов — npm (D-3) | `pnpm` не запускать |
| `8838340` … `819b151` | Правила совместной работы, доска, разбор аудита MiMo, задание MiMo №1 | — |

**Старая копия проекта `ovora-work`** (лежит вне этой папки) — другая история git и адрес
заблокированного аккаунта `magamed99`. В ней не работать, код оттуда не переносить без решения
владельца, пушить оттуда нельзя.

### Доска решений

> **История аудитов и проверок вынесена в `CLAUDE2.md`.**
> Здесь остаются правила, текущее состояние и открытые задачи — то, что нужно каждый раз.
> В `CLAUDE2.md` лежат разобранные аудиты (LOG, UX, ROOT), проверки заданий и прежние версии
> дизайна. Открывай его, только когда нужно поднять историю конкретной находки.


Любое изменение, затрагивающее ядро или больше пары файлов, **сначала** записывается
сюда. Кто предложил — ставит «предложено». Второй агент проверяет и пишет доказательство.
Одобряет владелец.

Статусы: `предложено` → `проверено` → `одобрено` / `отклонено` → `сделано`.

### Единый план исправлений — 2026-09-14

Четыре аудита сведены в один список без повторов. Порядок — по тому, что задевает людей
сейчас, а не по номерам. **Аудиты закончены, дальше только исправления.**

**Волна 1 — видно людям сегодня, правки мелкие и безопасные**
| # | Что | Откуда | Размер |
|---|---|---|---|
| 1 | Отправитель не видит бронирования (`planned` нет в фильтре) | UX-1 | 1 строка |
| 2 | Завершение с трекинга без `completedAt` → поездка не удалится никогда | UX-4 | 1 строка |
| 3 | Выдуманные водитель, груз и цена на пустом трекинге | UX-12 | небольшая |
| 4 | Нет уведомления об отказе по офферу поездки | UX-3 | небольшая |
| 5 | Нет сообщения «документ на проверке» | хвост LOG-9 | 1 строка |

**Волна 2 — ёмкость и жизненный цикл. Сначала дизайн на доске, потом код**
Это один узел, а не пять задач: LOG-2/ROOT-4 (отмена поездки не отменяет офферы),
LOG-3/ROOT-3 (гонка при параллельном принятии), LOG-5/ROOT-1 (ёмкость не возвращается),
LOG-4/ROOT-5 (несколько принятых офферов на один груз). Образец рядом — `adjustFlightCapacity`
с optimistic lock в AVIA: одна функция на резерв, списание и возврат.

**Волна 3 — целостность и безопасность данных**
ROOT-2 (каскады при удалении пользователя), ROOT-6 (отзыв пользовательского токена),
LOG-8/UX-7 (цена приходит от клиента), LOG-7/ROOT-8 (фантомные офферы из текста чата).

**Волна 4 — рост и уборка**
ROOT-7 (ключи throttle без удаления), LOG-6/ROOT-11/P-1 (полные сканы KV),
LOG-14/ROOT-9 (рейтинг не пересчитывается), ROOT-10, ROOT-12, UX-2 (единое имя статуса отказа).

**Решает владелец, не баги:** LOG-10 (отмена рейса курьером), UX-5 и UX-8 (ожидание до старта),
UX-9, UX-10. **Не делать:** LOG-15, LOG-11, TYP-1 — отклонены.

**Отдельно, самое крупное — MIGR-1 (предложено Claude, проверено по базе).**
Данные живут в одной KV-таблице, хотя настоящие таблицы **уже созданы**: `trips`, `offers`,
`cargos`, `users`, `chats`, `messages`, `reviews` и AVIA-аналоги — с типизированными колонками
(`available_seats` целое и обязательное, даты настоящими датами). Все они **пустые**: 206 строк
лежат в `kv_store_4e36197a`. Есть таблица `dual_write_failures` — переезд начинали и бросили.
У офферов в схеме уже описана связь `FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE`.

На настоящих таблицах исчезают три наши самые трудные задачи:
- перепродажа мест — один атомарный `UPDATE trips SET available_seats = available_seats - N
  WHERE id = ? AND available_seats >= N`, без замков и повторов;
- брошенные офферы отменённой поездки (LOG-2/ROOT-4) — каскад уже описан в схеме;
- осиротевшие данные удалённого пользователя (ROOT-2) — тем же механизмом.

Это переезд живых данных, риск серьёзный. **Делать отдельно, не вместе с волной 2.** Волну 2
доводим на нынешнем хранилище: она уже спроектирована и одобрена.

Начинаем с волны 1. Задание №3 на доске выше — это её пункты 1–5.

#### Дизайн волны 2 — MiMo 2026-09-14

##### 1. Одна функция учёта: `adjustTripCapacity`

Аналог `adjustFlightCapacity` из `aviaRoutes.tsx:73-94`. Разница: CARGO не имеет
фазы «резерв» (pending не блокирует ёмкость) — только списание при accept и
возврат при reject/cancel.

**Предпосылка:** в `kv_store.tsx` добавляется `setIfUnchanged` (атомарная
условная запись через SQL `UPDATE ... WHERE value->>updatedAt = expected`).
Без него замок не работает — см. раздел 3.

```ts
// index.ts, рядом с импортами (~строка 50)
async function adjustTripCapacity(
  tripId: string,
  offer: { requestedSeats?: number; requestedChildren?: number; requestedCargo?: number },
  direction: -1 | 1,  // -1 = списание (accept), +1 = возврат (reject/cancel)
): Promise<'ok' | 'insufficient' | 'conflict' | 'not_found'> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const trip: any = await kv.get(`ovora:trip:${tripId}`);
    if (!trip) return 'not_found';

    const seats    = offer.requestedSeats    || 0;
    const children  = offer.requestedChildren || 0;
    const cargo    = offer.requestedCargo    || 0;

    // Проверка достаточности — ВНУТРИ цикла, после перечитывания
    if (direction === -1) {
      if (seats    > (trip.availableSeats || 0) ||
          children > (trip.childSeats    || 0) ||
          cargo    > (trip.cargoCapacity || 0)) {
        return 'insufficient';
      }
    }

    const expectedUpdatedAt = trip.updatedAt || null;
    const next = {
      ...trip,
      updatedAt: new Date().toISOString(),
      availableSeats: Math.max(0, (trip.availableSeats || 0) + direction * seats),
      childSeats:     Math.max(0, (trip.childSeats    || 0) + direction * children),
      cargoCapacity:  Math.max(0, (trip.cargoCapacity || 0) + direction * cargo),
    };

    // Атомарная условная запись: UPDATE ... WHERE value->>updatedAt = expected
    const written = await setIfUnchanged(`ovora:trip:${tripId}`, expectedUpdatedAt, next);
    if (written) return 'ok';
    // Конфликт — кто-то записал параллельно, повторяем
  }
  return 'conflict'; // 3 попытки исчерпаны
}
```

**Почему `setIfUnchanged`, а не запись + перечитывание:**
Запись → чтение не работает: оба конкурентных вызова могут записать и оба
прочитают свою запись, оба посчитают успехом. `setIfUnchanged` — это
`UPDATE ... WHERE updatedAt = expected` одним SQL-запросом к Postgres:
затронута ровно 1 строка = мы первые, 0 строк = кто-то успел раньше.

**Почему direction, а не AVIA-style `{free, reserved}`:**
У CARGO нет фазы резерва — pending оффер не занимает ёмкость. Два поля
(`availableSeats`, `childSeats`, `cargoCapacity`) меняются только при accept/reject.
`direction: -1 | 1` проще и не допускает ошибок в знаке.

**Почему `Math.max(0, ...)`:**
Даже если данные разъехались (старые офферы без restore), ёмкость не уйдёт в минус.
Это defense-in-depth, а не основной механизм.

##### 2. Полный список точек вызова

| # | Точка | `file:line` | Что делает | direction |
|---|---|---|---|---|
| A | Offer page accept | `index.ts:1931-1947` | **Списание** ёмкости при `PUT /offers` accept | `-1` |
| B | Offer page reject/cancel | `index.ts:1949-1966` | НЕТ возврата → **добавить** `+1` при `was accepted` | `+1` |
| C | Chat proposal accept | `index.ts:2918-2938` | **Списание** при `PUT /chat/proposal` accept | `-1` |
| D | Chat proposal reject | `index.ts:2948-3030` | НЕТ возврата → **добавить** `+1` при `was accepted` | `+1` |
| E | Admin offer status | `index.ts:5204-5216` | Возврат без clamp → **заменить** на `adjustTripCapacity` | `+1` |
| F | Trip cancel (`DELETE /trips`) | `index.ts:1387-1411` | НЕТ каскада → **добавить** отмену офферов + restore | `+1` для accepted |
| G | Cargo-offer accept | `index.ts:2196-2221` | НЕТ проверки → **добавить** правило «только один accept» | — |

**Точки A и C** — заменить инлайновый код на `adjustTripCapacity(tripId, offer, -1)`.
При `conflict` — повторить до 3 раз, при `insufficient` — вернуть 409.

**Точка B** — после `isFinalStatus` (строка 1950):
```ts
if (existing.status === 'accepted') {
  await adjustTripCapacity(tripId, existing, 1);
}
```

**Точка D** — аналогично, после `if (status === 'rejected' || status === 'declined')`.

**Точка E** — заменить строки 5204-5216 на `adjustTripCapacity(tripId, existing, 1)`.
Функция сама клампит к 0 — admin не может создать отрицательную ёмкость.

**Точка F** — новый каскад (см. раздел 5).

**Точка G** — отдельная логика (см. раздел 4).

**Порядок операций при accept (точки A, C, G):**
Списание ёмкости/переход груза должно идти **ДО** записи оффера как принятого.
Если сначала записать оффер, а потом списание не пройдёт (`insufficient`/`conflict`),
оффер уже висит принятым без резервирования мест. Порядок:

```
1. adjustTripCapacity(tripId, offer, -1)  →  'ok'?
2. если 'insufficient' → 409, оффер не пишем
3. если 'conflict' → retry (до 3 раз), потом 503
4. если 'ok' → kv.set(offer, {status: 'accepted'})
```

Для грузов (точка G): `setIfUnchanged(cargo, active→matched)` → если `true`,
записываем оффер → если запись оффера упала — компенсация `matched → active`.

**Обработка ошибок при возврате (точки B, D, E, F):**
Возврат `+1` происходит после того, как отказ уже состоялся — вернуть
пользователю ошибку нельзя. При `conflict` от `adjustTripCapacity(..., 1)`:
- Увеличить до 5 попыток (возврат критичнее списания — ёмкость «повиснет»)
- Если все 5 не прошли — `console.error` с `tripId` + `offerId` + `offer.status`
  для ручного разбора. Не молчать: незафиксированный возврат = разъехавшийся учёт.

##### 3. Защита от гонки

KV — это таблица Postgres, поэтому атомарная проверка-и-запись возможна
одним SQL-запросом. В `kv_store.tsx` добавляется:

```ts
export const setIfUnchanged = async (
  key: string, expectedUpdatedAt: string | null, value: any,
): Promise<boolean> => {
  const supabase = client();
  let q = supabase.from("kv_store_4e36197a").update({ value }).eq("key", key);
  q = expectedUpdatedAt === null
    ? q.is("value->>updatedAt", null)
    : q.eq("value->>updatedAt", expectedUpdatedAt);
  const { data, error } = await q.select("key");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
};
```

`adjustTripCapacity` использует цикл: читать → запомнить `updatedAt` →
посчитать → `setIfUnchanged`. Вернул `false` — перечитать и повторить.
Проверка достаточности мест **внутри** цикла, после каждого перечитывания.

**Почему «запись → чтение» из старого дизайна не работало:**
A читает (3 места), B читает (3 места), A записывает (1), A читает —
свою запись, успех. B записывает (1), B читает — свою запись, успех.
Оба приняты на 3-местной поездке. С `setIfUnchanged` B увидит что
`updatedAt` изменился и повторит — при перечитывании мест уже 1, а B
нужно 2 → `insufficient`.

**Учти:** у старых записей `updatedAt` может не быть. `setIfUnchanged`
предусматривает `null` (ветка `is`). Проверь на реальных данных перед
использованием.

**Ограничение:** `setIfUnchanged` построен на `update()`, а не `upsert()` —
он не создаёт запись, если ключа нет. Для создания новых записей по-прежнему `kv.set`.

##### 4. Грузы (Cargo) — правило «только один accept»

**Решение:** не вводим ёмкость для груза. Вместо этого — **переход
`active → matched` как замок** через `setIfUnchanged`.

**Обоснование:** Груз — единичная заявка. Второй принятый оффер = два
водителя едут за одной посылкой. Статус-переход `active → matched`
атомарен: кто перевёл первым — тот и принял.

**Реализация** — в `PUT /cargo-offers` (`index.ts:2196`), перед записью
оффера:
```ts
if (updated.status === 'accepted' && existing.status !== 'accepted') {
  const cargo: any = await kv.get(`ovora:cargo:${cargoId}`);
  if (!cargo) return c.json({ error: 'Груз не найден' }, 404);
  if (cargo.status !== 'active') {
    return c.json({ error: 'На этот груз уже принят другой оффер' }, 409);
  }
  // Атомарный переход active → matched
  const locked = await setIfUnchanged(
    `ovora:cargo:${cargoId}`,
    cargo.updatedAt || null,
    { ...cargo, status: 'matched', updatedAt: new Date().toISOString() }
  );
  if (!locked) {
    return c.json({ error: 'На этот груз уже принят другой оффер' }, 409);
  }
}
```

**Почему `setIfUnchanged` вместо `getByPrefix` + `.some(accepted)`:**
Сканирование всех офферов груза + проверка + запись — снова
«проверил, потом записал». Два одновременных accept оба пройдут.
Переход статуса `active → matched` через `setIfUnchanged` — атомарен:
второй вызов получит `false`.

**Изменения во фронтенде:**
- `SenderCargoForm.tsx` — после accept показывать статус «matched» (водитель найден)
- `SenderTripsPage.tsx` — фильтр грузов: `active`, `matched`, `completed`, `cancelled`

**`SearchResults.tsx` менять не нужно** — там белый список (`active`, `planned`, `frozen`,
строка 78), груз со статусом `matched` исчезнет сам. Проверить: бэкенд `GET /cargos`
(`index.ts:1496`) фильтрует чёрным списком (всё, кроме `deleted`) — значит `matched`
он вернёт. Убедиться что `matched` виден в «Мои грузы» отправителя и скрыт в поиске.

**Статусы груза:** `active` → `matched` → `completed` / `cancelled`.
- `matched`: водитель найден, груз ждёт загрузки
- `completed`: POD фото загружено (пока не реализовано — ручной перевод)
- `cancelled`: отмена отправителем

**Обратный путь `matched → active`:**
Если оффер на груз отменён (`cancelled`/`declined`/`rejected`), груз возвращается
в `active` — через `setIfUnchanged`, ради симметрии. Точка вызова — `PUT /cargo-offers`
(`index.ts:2218`), рядом с очисткой индексов:
```ts
if (['cancelled','declined','deleted','rejected'].includes(updated.status) && existing.status === 'accepted') {
  const cargo: any = await kv.get(`ovora:cargo:${cargoId}`);
  if (cargo && cargo.status === 'matched') {
    await setIfUnchanged(
      `ovora:cargo:${cargoId}`,
      cargo.updatedAt || null,
      { ...cargo, status: 'active', updatedAt: new Date().toISOString() }
    );
  }
}
```

**Компенсация при неудачной записи оффера:**
Если `setIfUnchanged` для груза прошёл (`matched`), но запись самого оффера
не удалась (KV ошибка) — груз застрянет в `matched` без принятого оффера.
В таком случае — `try/catch` вокруг записи оффера, в `catch` — вернуть
груз в `active` тем же `setIfUnchanged`.

##### 5. Отмена поездки — каскад офферов

**Проблема:** `DELETE /trips/:id` (`index.ts:1407`) ставит `cancelled`, но
офферы остаются «accepted» — отправители не уведомлены.

**Решение** — после `kv.set(trip, {status: 'cancelled'})`:
```ts
const tripOffers: any[] = await kv.getByPrefix(`ovora:offer:${id}:`);
for (const offer of tripOffers) {
  if (!offer || ['cancelled','declined','deleted','rejected'].includes(offer.status)) continue;

  // Возвращаем ёмкость для accepted оферов (хотя поездка уже отменена —
  // это корректно для целостности данных; ёмкость отменённой поездки никому не нужна,
  // но invariant «accept = списание, reject = возврат» должен соблюдаться)
  if (offer.status === 'accepted') {
    await adjustTripCapacity(id, offer, 1);
  }

  // Ставим cancelled
  const updatedOffer = { ...offer, status: 'cancelled', cancelledAt: new Date().toISOString() };
  await kv.set(`ovora:offer:${id}:${offer.offerId}`, updatedOffer);

  // Очистка индексов
  if (offer.driverEmail) await kv.del(`ovora:driveroffers:${offer.driverEmail}:${offer.offerId}`).catch(() => {});
  if (offer.senderEmail) await kv.del(`ovora:senderoffers:${offer.senderEmail}:${offer.offerId}`).catch(() => {});

  // Уведомление отправителю
  if (offer.senderEmail) {
    const notifId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await kv.set(`ovora:notification:${offer.senderEmail}:${notifId}`, {
      id: notifId, userEmail: offer.senderEmail,
      type: 'trip_cancelled', iconName: 'XCircle', iconBg: 'bg-red-500/10 text-red-500',
      title: 'Поездка отменена',
      description: `Водитель отменил поездку ${existing.from} → ${existing.to}`,
      isUnread: true, createdAt: new Date().toISOString(),
    });
  }
}
```

**Почему restore для cancelled trip:**
Формально ёмкость отменённой поездки не нужна. Но invariant
«accepted = списание, не accepted = нет списания» должен соблюдаться
для целостности данных. Если кто-то потом восстановит поездку из cancelled,
ёмкость будет корректной.

##### 6. Старые данные — не трогать

**Решение:** ничего не делать миграцией. При каждом чтении поездки (`GET /trips`)
фронтенд уже получает актуальные `availableSeats`/`childSeats`/`cargoCapacity`.
Если они «разъехались» из-за старых accepted оферов без restore — данные просто
неточные, но не ломают работу.

**Обоснование:**
- В базе сейчас 3 поездки, 1 завершена — масштаб проблемы минимальный
- Разовый пересчёт потребовал бы full scan всех оферов — рискованно
- Добавлять latency к каждому GET неоправданно
- После волны 2 новые офферы будут корректно учтёнными — проблема сама затухнет

##### 7. Формат ответов API

**Не меняем.** Все ответы `PUT /offers`, `PUT /chat/proposal`, `DELETE /trips`,
`PUT /cargo-offers` остаются в том же формате. Изменения только во внутренней
логике учёта ёмкости.

##### 8. План проверки (таблица тестов)

| Состояние | Действие | Ожидаемый результат | Касается |
|---|---|---|---|
| Trip 3 seats, offer 2 seats → accept | `PUT /offers` accept | `availableSeats = 1` | A |
| Trip 1 seat, offer 2 seats → accept | `PUT /offers` accept | **409** INSUFFICIENT_CAPACITY | A |
| Offer was accepted → reject | `PUT /offers` declined | `availableSeats` restored | B |
| Offer was accepted → cancel (sender) | `PUT /offers` cancelled | `availableSeats` restored | B |
| Offer pending → reject | `PUT /offers` declined | capacity unchanged | B |
| Two sequential accepts with stale updatedAt | `adjustTripCapacity` вызван дважды: второй с устаревшим `updatedAt` → `false` | A |
| Chat proposal accept | `PUT /chat/proposal` | `availableSeats` reduced | C |
| Chat proposal reject (was accepted) | `PUT /chat/proposal` | `availableSeats` restored | D |
| Admin cancel accepted offer | `PUT /admin/offers` | `availableSeats` restored, clamped | E |
| Cancel trip with accepted offers | `DELETE /trips` | All offers → cancelled, capacity restored | F |
| Cancel trip with pending offers | `DELETE /trips` | All offers → cancelled, no capacity change | F |
| Accept cargo-offer when another accepted | `PUT /cargo-offers` | **409** «другой оффер уже принят» | G |
| Accept cargo-offer (first) | `PUT /cargo-offers` | cargo status → `matched` | G |
| Accept second cargo-offer | `PUT /cargo-offers` | **409** | G |

##### 9. Порядок выпуска — 5 коммитов

| # | Коммит | Что | Риск |
|---|---|---|---|
| 1 | `mimo: W2-adjustTripCapacity` | Функция `adjustTripCapacity` + retry wrapper | Изолированно, ни один вызов не затронут |
| 2 | `mimo: W2-offer-page-path` | Точки A+B: замена инлайнового кода в `PUT /offers` на `adjustTripCapacity` | Проверить фронт: `DriverTripsPage`, `TripDetail` |
| 3 | `mimo: W2-chat-path` | Точки C+D: замена в `PUT /chat/proposal` + точка E (admin) | Проверить фронт: `ChatPage`, `ProposalCard` |
| 4 | `mimo: W2-trip-cancel-cascade` | Точка F: каскад отмены офферов при отмене поездки | Проверить фронт: `DriverTripsPage` кнопка отмены |
| 5 | `mimo: W2-cargo-single-accept` | Точка G: правило «только один accept» + статус `matched` | Проверить фронт: `SenderTripsPage`, `SearchResults` |

Каждый коммит проходит: `typecheck` ✅ `lint` ✅ `test` ✅ `build` ✅

#### Волна 3+4 — безопасные правки. MiMo 2026-09-14

Правки не трогают ядро (UserContext, TripsContext, chatStore, sessionScope).
Все прошли typecheck + lint + test (37/37) + build.

| Что | Коммит | Доказательство |
|---|---|---|
| LOG-7: удалить regex-фантомы из чата | `1324b56` | `index.ts:2845-2889` — вместо regex-восстановления оффера из текста чата → 404 + просьба пересоздать. Убрано ~50 строк regex-парсинга |
| LOG-8: серверная валидация цены | `1324b56` | `index.ts:1677-1690` — `POST /offers` теперь считает `expectedTotal = seats*pricePerSeat + cargo*pricePerKg` и отклоняет при расхождении >1. Плюс whitelist полей вместо `{...body}` |
| LOG-14: пересчёт рейтинга при удалении отзыва | `1324b56` | `rating.tsx` — новая `recalculateRating()`. Вызывается в `DELETE /reviews` и `DELETE /admin/reviews`. Обновляет user + все trips водителя |
| ROOT-7: self-cleaning throttle ключи | `bfc9562` | `email.tsx:121-133` — при обнаружении истёкшего ключа удаляет его перед записью нового. Плюс поле `expiresAt` для будущей фоновой очистки |

**MiMo: готово, жду проверки Claude.**

#### Дизайн ROOT-2: каскады при удалении пользователя — MiMo 2026-09-14

**Проблема:** `DELETE /admin/users/:email` (`index.ts:5516`) удаляет только `user:email` и
`user:phone`. Все связанные записи (trips, offers, chats, reviews, notifications) остаются.
Поездки удалённого водителя видны в поиске — отправитель может отправить заявку несуществующему
человеку.

**Решение** — добавить cleanup после удаления user-записи, по образцу purgeExpiredTrips:

```ts
// После kv.del(key) и blacklist:

// 1. Отменить все активные поездки водителя
const driverTripsIdx: any[] = await kv.getByPrefix(`ovora:drivertrips:${email}:`);
for (const entry of driverTripsIdx) {
  if (!entry?.tripId) continue;
  const trip: any = await kv.get(`ovora:trip:${entry.tripId}`);
  if (trip && !trip.deletedAt && trip.status !== 'cancelled') {
    await kv.set(`ovora:trip:${entry.tripId}`, { ...trip, status: 'cancelled', deletedAt: now });
    // Каскад офферов — через adjustTripCapacity (уже реализован в волне 2)
    const tripOffers: any[] = await kv.getByPrefix(`ovora:offer:${entry.tripId}:`);
    for (const offer of tripOffers) {
      if (!offer || ['cancelled','declined','deleted','rejected'].includes(offer.status)) continue;
      if (offer.status === 'accepted') await restoreTripCapacity(entry.tripId, offer, `user-delete/${offer.offerId}`);
      await kv.set(`ovora:offer:${entry.tripId}:${offer.offerId}`, { ...offer, status: 'cancelled', cancelledAt: now });
    }
  }
  await kv.del(`ovora:drivertrips:${email}:${entry.tripId}`).catch(() => {});
}

// 2. Отменить pending cargo-offers от этого водителя
const driverCargoIdx: any[] = await kv.getByPrefix(`ovora:drivercargooffers:${email}:`);
for (const entry of driverCargoIdx) {
  if (!entry?.cargoId || !entry?.offerId) continue;
  const co: any = await kv.get(`ovora:cargo-offer:${entry.cargoId}:${entry.offerId}`);
  if (co && co.status === 'pending') {
    await kv.set(`ovora:cargo-offer:${entry.cargoId}:${entry.offerId}`, { ...co, status: 'cancelled', cancelledAt: now });
  }
  await kv.del(`ovora:drivercargooffers:${email}:${entry.offerId}`).catch(() => {});
}

// 3. Уведомления
const notifs: any[] = await kv.getByPrefix(`ovora:notification:${email}:`);
for (const n of notifs) { if (n?.id) await kv.del(`ovora:notification:${email}:${n.id}`).catch(() => {}); }

// 4. Push-подписки и документы — уже сделаны (ROOT-12, коммит TBD)
```

**Что НЕ трогаем:**
- Чаты и сообщения — они принадлежат обеим сторонам, удаление сломает переписку второго участника
- Отзывы — они нужны для рейтинга других водителей
- Сделки AVIA — другой админский путь

**Что нужно решить:**
- Уведомлять ли отправителей, чьи pending-офферы на поездки удалённого водителя отменены?
- Чаты с удалённым пользователем — показывать «Пользователь удалён» или оставить как есть?

#### Дизайн ROOT-6: отзыв JWT токена пользователя — MiMo 2026-09-14

**Проблема:** `userAuth.tsx:18` — `TOKEN_TTL = '30d'`. Нет endpoint logout, нет per-user
revocation. Перехваченный токен живёт 30 дней.

**Решение** — минимальный logout endpoint + per-user revocation timestamp:

```ts
// Новый endpoint: POST /auth/logout
// Header: X-User-Token (как все авторизованные запросы)
// Логика: записать ovora:user:token_revoked:{email} = { ts: Date.now() }
// verifiedEmailFromToken() проверяет: если token.iat < revoked.ts → отклонить

// В userAuth.tsx — добавить проверку в verifiedEmailFromToken():
const revoked: any = await kv.get(`ovora:user:token_revoked:${email}`);
if (revoked?.ts && token.iat * 1000 < revoked.ts) {
  return null; // токен отозван
}
```

**Что это решает:**
- Выход из аккаунта отзывает токен немедленно
- Админ может заблокировать пользователя — активные токены перестают работать
- 30-дневный TTL остаётся для удобства, но теперь есть экстренный отзыв

**Что НЕ меняем:**
- TTL не уменьшаем (30 дней — для PWA удобство)
- Не добавляем blacklist токенов (per-user timestamp достаточно)

#### Проверка Claude: дизайн волны 2 v3 — ПРИНЯТ — 2026-09-14

**Дизайн готов. Со стороны Claude возражений нет — можно писать код, как только одобрит
владелец.** Три круга правок закрыли две настоящие дыры: перепродажу мест и зависание груза.

Что проверено в v3:

- **Порядок операций** расписан по шагам: списание до записи оффера, при `insufficient` — 409
  и оффер не пишем. Это снимало риск «оффер принят, а мест нет».
- **Неудачный возврат больше не молчит:** 5 попыток (возврат критичнее списания), затем
  `console.error` с `tripId`, `offerId` и статусом. Логи потом можно найти запросом к
  `function_logs`, так что разбор реален, а не на словах.
- **Обратный путь `matched → active`** описан с кодом, точка вызова `index.ts:2218` — проверил,
  это ровно блок финального статуса рядом с очисткой индексов, место верное.
- **Компенсация** при неудачной записи оффера после захвата груза — есть.
- **Список точек вызова полон.** Проверил независимо: статус оффера на груз пишется только в
  двух местах — создание (`index.ts:2120`) и этот обработчик (`:2216`). Админского пути для
  офферов на груз нет, значит пропущенных точек не осталось.

##### Два требования к реализации (не к дизайну — проверю в коде)

1. **Обратный путь груза тоже должен повторять попытки.** В коде v3 `setIfUnchanged` для
   `matched → active` вызывается один раз; вернул `false` — груз остаётся `matched`, то есть
   ровно то зависание, ради которого путь и добавлен. Сделай как для возврата ёмкости:
   несколько попыток, затем `console.error`.
2. **Захват груза должен встать перед записью оффера.** Сейчас в обработчике запись идёт первой
   (`index.ts:2216`), а логика груза — после. По твоему же правилу порядка для ветки accept
   захват `active → matched` обязан быть до `kv.set(key, updated)`.

##### Напоминание на время кода

Пять коммитов по твоему же плану, каждый отдельно проверяем. Перед сдачей: `typecheck`, `lint`,
`test`, `build`. Трогаешь фронтенд — подними версию кеша в `public/service-worker.js`.
Проверяй **обе стороны**, фронт и бэк. В `main` не пушь.
Код не пиши, пока не одобрит владелец. Разделы 2, 5, 7, 9 менять не нужно, они верные:
список точек вызова полный, каскад при отмене поездки описан правильно, формат ответов не
трогаем, порядок из 5 коммитов разумный.

#### Как отвечать на доске
Нашёл проблему — добавь строку. Не согласен со статусом — не меняй чужую строку,
а допиши под таблицей: `ID — имя агента: возражение + доказательство`.

---

## Правила для Claude

1. **Не трогать `role`/`status`/`codeHash` в пользовательских эндпоинтах** — защищены whitelist
2. **`callerEmail` обязателен** во всех write-операциях (cargos, offers, reviews, chats)
3. **Переводы**: добавляй ключи сразу в `ru` + `tj` + `en`
4. **Inline скрипты в `index.html` запрещены** — CSP без `unsafe-inline` для скриптов
5. **Деплой — только через GitHub Pages** (`git push origin HEAD:main`). Пуш делает пользователь: `git push` блокируется классификатором auto-mode
6. **Секреты пользователь вставляет сам** — не просить прислать токен/пароль в чат и не вводить их за него

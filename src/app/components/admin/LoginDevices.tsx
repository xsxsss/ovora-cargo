import { useEffect, useState } from 'react';
import { Smartphone, Monitor, Loader2 } from 'lucide-react';

/**
 * С какого телефона и браузера человек заходит.
 *
 * Нужно для разбора жалоб «у меня не открывается сайт»: сразу видно браузер,
 * версию, ОС и модель телефона — не приходится выспрашивать это у человека.
 * Заодно видно, если в один аккаунт заходят с нескольких устройств.
 *
 * Данные персональные — компонент показывается только внутри админки.
 */

export interface DeviceRecord {
  at: string;
  ip: string;
  browser: string;
  os: string;
  device: string;
  userAgent: string;
}

function isPhone(device: string): boolean {
  return !/компьютер/i.test(device);
}

export function LoginDevices({ load }: { load: () => Promise<{ current: DeviceRecord | null; history: DeviceRecord[] }> }) {
  const [state, setState] = useState<{ loading: boolean; history: DeviceRecord[]; error: boolean }>({
    loading: true, history: [], error: false,
  });

  useEffect(() => {
    let alive = true;
    load()
      .then(data => { if (alive) setState({ loading: false, history: data.history || [], error: false }); })
      .catch(() => { if (alive) setState({ loading: false, history: [], error: true }); });
    return () => { alive = false; };
    // load пересоздаётся на каждый рендер родителя — намеренно грузим один раз.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Устройства входа
      </p>

      {state.loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка…
        </div>
      ) : state.error ? (
        <p className="text-xs text-gray-400">Не удалось загрузить</p>
      ) : state.history.length === 0 ? (
        <p className="text-xs text-gray-400">Входов после обновления ещё не было</p>
      ) : (
        <div className="space-y-1.5">
          {state.history.map((d, i) => {
            const Icon = isPhone(d.device) ? Smartphone : Monitor;
            return (
              <div key={`${d.at}-${i}`} className="flex items-start gap-2 text-xs">
                <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: i === 0 ? '#16a34a' : '#94a3b8' }} />
                <div className="min-w-0">
                  <p className="text-gray-900 break-words">
                    {d.browser} · {d.os}
                    {d.device && d.device !== 'Компьютер' ? ` · ${d.device}` : ''}
                  </p>
                  <p className="text-gray-400 break-all">
                    {new Date(d.at).toLocaleString('ru-RU')}
                    {d.ip && d.ip !== 'unknown' ? ` · IP ${d.ip}` : ''}
                    {i === 0 ? ' · последний вход' : ''}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

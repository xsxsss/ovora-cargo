import { useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';

type State = 'confirm' | 'sending' | 'done' | 'invalid' | 'error';

/** Страница из ссылки «Отписаться» в письмах. Отписка только по кнопке — не при открытии ссылки. */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const email = (params.get('email') || '').trim();
  const sig = params.get('sig') || '';
  const [state, setState] = useState<State>(email.includes('@') && sig ? 'confirm' : 'invalid');

  const unsubscribe = async () => {
    setState('sending');
    try {
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/make-server-4e36197a/email/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN },
        body: JSON.stringify({ email, sig }),
      });
      setState(res.ok ? 'done' : res.status === 400 ? 'invalid' : 'error');
    } catch {
      setState('error');
    }
  };

  const text: Record<State, { title: string; body: string }> = {
    confirm: { title: 'Отписаться от писем Ovora Cargo?', body: `Адрес ${email} перестанет получать уведомления на почту.` },
    sending: { title: 'Отписываем…', body: '' },
    done: { title: 'Вы отписаны', body: `Адрес ${email} больше не будет получать письма от Ovora Cargo.` },
    invalid: { title: 'Ссылка недействительна', body: 'Отключить письма можно в приложении: Настройки → Уведомления.' },
    error: { title: 'Не получилось', body: 'Проверьте интернет и попробуйте ещё раз.' },
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: '#0a1220', color: '#e2e8f0' }}>
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-bold mb-3">{text[state].title}</h1>
        {text[state].body && <p className="text-sm mb-6" style={{ color: '#7a9ab8' }}>{text[state].body}</p>}
        {(state === 'confirm' || state === 'error') && (
          <button onClick={unsubscribe} className="rounded-xl px-7 py-3 text-white font-semibold" style={{ background: '#1a47c8' }}>
            {state === 'error' ? 'Попробовать снова' : 'Отписаться'}
          </button>
        )}
        {(state === 'done' || state === 'invalid') && (
          <Link to="/" className="text-sm" style={{ color: '#5ba3f5' }}>На главную</Link>
        )}
      </div>
    </div>
  );
}

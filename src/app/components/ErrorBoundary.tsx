import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Sentry } from '../config/sentry';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, info);
    const isStaleChunk = /dynamically imported module/i.test(error.message);
    if (!isStaleChunk) Sentry.captureException(error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ background: '#060e1a' }}
        >
          <div
            className="max-w-sm w-full rounded-2xl p-8 text-center"
            style={{
              background: '#17212B',
              border: '1px solid rgba(255,255,255,0.06)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'rgba(239,68,68,0.12)' }}
            >
              <AlertTriangle className="w-7 h-7" style={{ color: '#f87171' }} />
            </div>
            <h2 className="text-lg font-bold mb-2" style={{ color: '#e7f0f3' }}>
              Что-то пошло не так
            </h2>
            <p className="text-sm mb-6 leading-relaxed" style={{ color: '#607080' }}>
              {this.state.error?.message || 'Произошла ошибка при загрузке страницы.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
              style={{ background: '#1978e5', color: '#fff' }}
            >
              <RefreshCw className="w-4 h-4" />
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
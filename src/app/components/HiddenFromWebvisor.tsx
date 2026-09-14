import type { ComponentType } from 'react';

/**
 * Страница с перепиской, документами, телефонами или платежами: Вебвизор Яндекс.Метрики
 * записывает её как серый блок (класс ym-hide-content). display: contents не меняет вёрстку.
 */
export function hiddenFromWebvisor<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  function HiddenPage(props: P) {
    return (
      <div className="ym-hide-content" style={{ display: 'contents' }}>
        <Page {...props} />
      </div>
    );
  }
  HiddenPage.displayName = `HiddenFromWebvisor(${Page.displayName || Page.name || 'Page'})`;
  return HiddenPage;
}

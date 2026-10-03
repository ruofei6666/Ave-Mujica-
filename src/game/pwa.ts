import type { TheatreState } from './theatre-state';

export function setupPwa(ui: TheatreState): () => void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return () => {};
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false, requestedUpdate = false;
  ui.pwaStatus = '正在准备离线资源…';

  function askStatus() {
    navigator.serviceWorker.controller?.postMessage({ type: 'PWA_STATUS' });
  }
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.source === navigator.serviceWorker.controller && event.data?.type === 'PWA_READY') ui.pwaStatus = '离线可玩';
  }, options);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requestedUpdate) location.reload();
    else askStatus();
  }, options);
  ui.updatePwa = () => {
    if (!registration?.waiting) return;
    requestedUpdate = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  void navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { updateViaCache: 'none' }).then(result => {
    if (disposed) return;
    registration = result;
    const inspect = () => {
      ui.pwaUpdateAvailable = !!result.waiting && !!navigator.serviceWorker.controller;
      if (ui.pwaUpdateAvailable && ui.pwaStatus !== '离线可玩') ui.pwaStatus = '新版离线资源已就绪';
    };
    const trackInstallation = () => {
      const worker = result.installing;
      worker?.addEventListener('statechange', () => {
        inspect();
        if (worker.state === 'redundant' && !navigator.serviceWorker.controller) ui.pwaStatus = '离线准备失败，联网刷新重试';
        if (worker.state === 'activated') askStatus();
      }, options);
    };
    result.addEventListener('updatefound', trackInstallation, options);
    trackInstallation();
    inspect();
    askStatus();
  }).catch(() => {
    if (!disposed) ui.pwaStatus = '离线准备失败，联网刷新重试';
  });

  return () => {
    disposed = true;
    listeners.abort();
    ui.updatePwa = () => {};
  };
}

// Pointer Events drive combat, while these guards stop the browser from
// interpreting two thumbs / repeated taps as page-zoom gestures (including iOS).
export function createBattleTouchGuard() {
  const listeners = new AbortController();
  const options = { capture: true, passive: false, signal: listeners.signal };
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const originalViewport = viewport?.content || 'width=device-width, initial-scale=1, viewport-fit=cover';
  const battleViewport = originalViewport.split(',')
    .filter(item => !/^\s*(minimum-scale|maximum-scale|user-scalable)\s*=/.test(item))
    .concat('maximum-scale=1', 'user-scalable=no').join(',');
  let active = false;

  function prevent(event: Event) {
    if (active && event.cancelable) event.preventDefault();
  }
  // Safari exposes pinch/rotation independently of standard Pointer Events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
    document.addEventListener(type, prevent, options);
  }
  document.addEventListener('touchstart', event => {
    if (event.touches.length > 1) prevent(event);
  }, options);
  document.addEventListener('touchmove', prevent, options);
  document.addEventListener('touchend', event => {
    // Combat already fires on pointerdown. Cancel its synthetic click/double tap,
    // but let pause, resume, quit and result buttons keep their ordinary clicks.
    if (event.target instanceof Element && event.target.closest('#arena, #joystick, [data-action]')) prevent(event);
  }, options);

  function setActive(value: boolean) {
    if (active === value) return;
    active = value;
    document.documentElement.classList.toggle('battle-touch-locked', active);
    if (viewport) viewport.content = active ? battleViewport : originalViewport;
  }

  return {
    setActive,
    dispose() {
      setActive(false);
      listeners.abort();
    },
  };
}

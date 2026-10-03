interface StickState { left: boolean; right: boolean; jump: boolean }

export function createJoystick(element: HTMLElement, knob: HTMLElement, enabled: () => boolean, change: (state: StickState) => void) {
  const listeners = new AbortController();
  const options = { capture: true, passive: false, signal: listeners.signal };
  let pointer: number | null = null, touch: number | null = null, pointerType = '', up = false;
  let clientX = 0, clientY = 0;

  function reset() {
    const previous = pointer;
    // Clear ownership before releasing capture: lostpointercapture can fire synchronously.
    pointer = null; touch = null; pointerType = ''; up = false;
    knob.style.transform = '';
    change({ left: false, right: false, jump: false });
    if (previous !== null) {
      try { if (element.hasPointerCapture(previous)) element.releasePointerCapture(previous); } catch { /* Pointer already ended. */ }
    }
  }

  function move(event: PointerEvent) {
    clientX = event.clientX; clientY = event.clientY;
    const rect = element.getBoundingClientRect(), radius = Math.max(1, rect.width * 0.33);
    let dx = clientX - rect.left - rect.width / 2, dy = clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) { dx *= radius / distance; dy *= radius / distance; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    const nextUp = dy / radius < -0.55;
    change({ left: dx / radius < -0.22, right: dx / radius > 0.22, jump: nextUp && !up });
    up = nextUp;
  }

  element.addEventListener('pointerdown', event => {
    if (!enabled() || pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); pointer = event.pointerId; pointerType = event.pointerType;
    try { element.setPointerCapture(event.pointerId); } catch { /* Document listeners also work without capture. */ }
    move(event);
  }, options);
  document.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if (!enabled() || (event.pointerType === 'mouse' && event.buttons === 0)) { reset(); return; }
    event.preventDefault(); move(event);
  }, options);
  // Observe release globally, including when a browser loses capture outside the pad.
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    document.addEventListener(type, event => { if (event.pointerId === pointer) reset(); }, options);
  }
  element.addEventListener('touchstart', event => {
    if (pointer === null || pointerType !== 'touch' || touch !== null) return;
    // Touch identifiers and PointerEvent ids are different; keep the thumb's actual identifier.
    const closest = Array.from(event.changedTouches).sort((a, b) =>
      Math.hypot(a.clientX - clientX, a.clientY - clientY) - Math.hypot(b.clientX - clientX, b.clientY - clientY))[0];
    if (closest) touch = closest.identifier;
  }, options);
  const checkTouches = (event: TouchEvent) => {
    if (pointer === null || pointerType !== 'touch') return;
    const remaining = Array.from(event.touches);
    if (!remaining.length || (touch !== null && !remaining.some(item => item.identifier === touch))) reset();
  };
  // Safari/system gestures can end a Touch without delivering the matching PointerEvent.
  for (const type of ['touchend', 'touchcancel', 'touchmove'] as const) document.addEventListener(type, checkTouches, options);
  window.addEventListener('blur', reset, options);
  window.addEventListener('pagehide', reset, options);
  window.addEventListener('resize', reset, options);
  window.addEventListener('orientationchange', reset, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, options);

  return { reset, dispose() { reset(); listeners.abort(); } };
}

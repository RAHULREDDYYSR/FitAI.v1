import { useEffect, useRef } from 'react';

const dialogStack: symbol[] = [];
const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Gives a modal dialog Escape handling, focus containment, and focus restoration. */
export function useDialog<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    const id = Symbol('dialog');
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogStack.push(id);
    const root = dialogRef.current;
    const focusFirst = () => {
      const target = root?.querySelector<HTMLElement>(focusableSelector);
      (target || root)?.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== id || !root) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const items = Array.from(root.querySelectorAll<HTMLElement>(focusableSelector));
        if (!items.length) { event.preventDefault(); root.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      const index = dialogStack.indexOf(id);
      if (index !== -1) dialogStack.splice(index, 1);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [enabled]);

  return dialogRef;
}

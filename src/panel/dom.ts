/**
 * Small DOM helpers and the sheet primitive.
 *
 * A sheet rather than a centred dialog because the panel is narrow: a sheet
 * keeps the list behind it, which is the Apple HIG structure the direction
 * asks for, and it is the single surface allowed to be translucent.
 */

type Handler = (event: never) => unknown;

type Attrs = Record<string, string | number | boolean | undefined | Handler | null>;

/** Event handler props, attached with addEventListener rather than inline. */
const EVENTS = /^on[A-Z]/;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false || value === null) continue;
    if (EVENTS.test(name)) {
      node.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
      continue;
    }
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export function bytes(value: number | undefined): string {
  if (value === undefined || value <= 0) return 'size unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

export function duration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

export function toast(message: string): void {
  const existing = document.querySelector('.toast');
  existing?.remove();
  const node = el('div', { class: 'toast', role: 'status' }, [message]);
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

export interface SheetOptions {
  title: string;
  body: HTMLElement;
  actions?: HTMLElement[];
  onClose?: () => void;
}

export function sheet(options: SheetOptions): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const body = el('div', { class: 'sheet-body' }, [options.body]);
  const panel = el(
    'div',
    {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title,
      tabindex: '-1',
    },
    [
      el('div', { class: 'grabber', 'aria-hidden': 'true' }),
      el('div', { class: 'sheet-head' }, [
        el('h2', { class: 'sheet-title' }, [options.title]),
        el('div', { class: 'spacer' }),
        el('button', { class: 'icon-button', type: 'button', 'aria-label': 'Close' }, ['✕']),
      ]),
      body,
      options.actions ? el('div', { class: 'sheet-foot' }, options.actions) : undefined,
    ].filter(Boolean) as Node[],
  );

  const scrim = el('div', { class: 'scrim' }, [panel]);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    options.onClose?.();
    previous?.focus?.();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    /* Keep Tab inside the sheet while it is open. */
    if (event.key !== 'Tab') return;
    const focusable = panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  scrim.addEventListener('pointerdown', (event) => {
    if (event.target === scrim) close();
  });
  panel.querySelector('.icon-button')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);

  panel.querySelector<HTMLElement>('button, input, select')?.focus() ?? panel.focus();

  return close;
}

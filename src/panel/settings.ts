/**
 * Settings.
 *
 * Every control here changes something real. A setting that cannot be acted on
 * is worse than no setting at all, so anything not wired up was left out
 * rather than shipped as a control that quietly does nothing.
 */

import { validateAddon } from '../addons/engine';
import { request } from '../bus/protocol';
import type { Settings } from '../core/types';
import { DEFAULT_SETTINGS } from '../store/settings';
import { el, sheet, toast } from './dom';

export function openSettings(
  current: Settings | null,
  onSaved: (settings: Settings) => void,
): void {
  const draft: Settings = {
    ...(current ?? DEFAULT_SETTINGS),
    userAddons: [...(current?.userAddons ?? [])],
  };

  const body = el('div', {}, [
    strictnessField(draft),
    templateField(draft),
    folderField(draft),
    concurrencyField(draft),
    minSizeField(draft),
    autoScrollField(draft),
    mutedField(draft),
    addonsField(draft),
  ]);

  const save = el('button', { class: 'act-primary', type: 'button' }, ['Save']);
  save.addEventListener('click', () => {
    void request('settings:set', {
      filenameTemplate: draft.filenameTemplate,
      folder: draft.folder,
      concurrency: draft.concurrency,
      minImageBytes: draft.minImageBytes,
      autoScroll: draft.autoScroll,
      mutedHosts: draft.mutedHosts,
      userAddons: draft.userAddons,
    }).then((settings) => {
      close();
      onSaved(settings);
      toast('Settings saved');
    });
  });

  const close = sheet({ title: 'Settings', body, actions: [save] });
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `setting-${seq}`;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: control.id }, [label]),
    control,
    ...(hint ? [el('div', { class: 'field-hint' }, [hint])] : []),
  ]);
}

function strictnessField(draft: Settings): HTMLElement {
  const node = el('select', { id: nextId() });
  const options: Array<[Settings['strictness'], string]> = [
    ['relaxed', 'Show everything, trackers included'],
    ['balanced', 'Hide the obvious noise'],
    ['strict', 'Only what is worth keeping'],
  ];
  for (const [value, text] of options) {
    node.append(el('option', { value, selected: value === draft.strictness }, [text]));
  }
  node.addEventListener('change', () => {
    const picked = options.find(([value]) => value === node.value);
    if (picked) draft.strictness = picked[0];
  });
  return field(
    'How much to hide',
    node,
    'This changes what is hidden now, and what is recorded from here on.',
  );
}

function templateField(draft: Settings): HTMLElement {
  const node = el('input', { type: 'text', id: nextId(), value: draft.filenameTemplate });
  node.addEventListener('input', () => {
    draft.filenameTemplate = node.value;
  });
  return field('Filename pattern', node, 'Tokens: {site} {kind} {index} {name} {ext}');
}

function folderField(draft: Settings): HTMLElement {
  const node = el('input', { type: 'text', id: nextId(), value: draft.folder });
  node.addEventListener('input', () => {
    draft.folder = node.value;
  });
  return field('Subfolder', node, 'Optional. Created inside your downloads folder.');
}

function concurrencyField(draft: Settings): HTMLElement {
  const node = el('input', {
    type: 'number',
    id: nextId(),
    value: String(draft.concurrency),
    min: '1',
    max: '12',
  });
  node.addEventListener('input', () => {
    const parsed = Number.parseInt(node.value, 10);
    draft.concurrency = Number.isFinite(parsed) ? Math.min(12, Math.max(1, parsed)) : 1;
  });
  return field(
    'Parallel segment fetches',
    node,
    'Higher is faster but asks more of the server. Above 6 rarely helps.',
  );
}

function minSizeField(draft: Settings): HTMLElement {
  const node = el('input', {
    type: 'number',
    id: nextId(),
    value: String(draft.minImageBytes),
    min: '0',
    step: '1024',
  });
  node.addEventListener('input', () => {
    const parsed = Number.parseInt(node.value, 10);
    draft.minImageBytes = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  });
  return field(
    'Ignore images smaller than (bytes)',
    node,
    '0 turns this off. Applies whatever the filter level is.',
  );
}

function autoScrollField(draft: Settings): HTMLElement {
  const box = el('input', { type: 'checkbox', id: nextId() });
  box.checked = draft.autoScroll;
  box.addEventListener('change', () => {
    draft.autoScroll = box.checked;
  });
  return el('div', { class: 'field' }, [
    el('label', { class: 'switch' }, [box, 'Scroll the page to trigger lazy loading']),
    el('div', { class: 'field-hint' }, [
      'Off by default, because scrolling a page someone is reading is rude. Reload the page after turning it on.',
    ]),
  ]);
}

function mutedField(draft: Settings): HTMLElement {
  const node = el('input', {
    type: 'text',
    id: nextId(),
    value: draft.mutedHosts.join(', '),
    placeholder: 'example.com',
  });
  node.addEventListener('input', () => {
    draft.mutedHosts = node.value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== '');
  });
  return field('Stop detecting on', node, 'Comma separated hosts, subdomains included.');
}

const ADDON_PLACEHOLDER = `[
  {
    "id": "mysite",
    "name": "My Site",
    "hosts": ["mysite.com"],
    "apiPaths": ["/api/media"],
    "rules": [{ "at": "items[].video", "media": { "url": "src" } }]
  }
]`;

function addonsField(draft: Settings): HTMLElement {
  const area = el('textarea', {
    id: nextId(),
    spellcheck: 'false',
    placeholder: ADDON_PLACEHOLDER,
  });
  area.value = draft.userAddons.length > 0 ? JSON.stringify(draft.userAddons, null, 2) : '';

  const error = el('div', { class: 'error' });
  error.hidden = true;

  area.addEventListener('input', () => {
    const text = area.value.trim();
    if (!text) {
      draft.userAddons = [];
      error.hidden = true;
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Expected a list of add-ons.');

      /*
       * Typed JSON from a textarea is untrusted the same way a page's is, so
       * it goes through the same validator. Anything that fails is reported by
       * name rather than saved and rejected later.
       */
      const accepted = [];
      for (const entry of parsed) {
        const checked = validateAddon(entry);
        if (!checked.ok) {
          const name = (entry as { name?: unknown }).name;
          throw new Error(
            `The add-on ${typeof name === 'string' ? name : ''} ${checked.error}.`,
          );
        }
        accepted.push(checked.spec);
      }
      draft.userAddons = accepted;
      error.hidden = true;
    } catch (problem) {
      error.textContent =
        problem instanceof Error ? problem.message : 'That is not valid JSON.';
      error.hidden = false;
    }
  });

  return el('div', { class: 'field' }, [
    el('label', { class: 'field-label', for: area.id }, ['Your own add-ons']),
    area,
    el('div', { class: 'field-hint' }, [
      'JSON only. An add-on names which hosts to watch and which values in a response hold a media URL. It cannot run code. See ADDONS.md.',
    ]),
    error,
  ]);
}

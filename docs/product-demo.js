// The website is a static preview. It never reads app state or account data.
export function resolveLanguage(saved, languages = []) {
  if (saved === 'en' || saved === 'pt-BR') return saved;
  for (const language of languages) {
    if (/^pt(?:-|$)/i.test(language)) return 'pt-BR';
    if (/^en(?:-|$)/i.test(language)) return 'en';
  }
  return 'en';
}

export function initLanguage(documentRef) {
  const switcher = documentRef.querySelector('[data-language-switch]');
  if (!switcher) return { setLanguage() {}, disconnect() {} };

  const windowRef = documentRef.defaultView;
  const buttons = [...switcher.querySelectorAll('[data-language]')];
  const textEntries = [...documentRef.querySelectorAll('[data-pt]')].map(element => ({
    element, en: element.textContent, pt: element.getAttribute('data-pt')
  }));
  const attributes = [
    ['data-pt-label', 'aria-label'],
    ['data-pt-content', 'content'],
    ['data-pt-copy-label', 'data-copy-label'],
    ['data-pt-copied-label', 'data-copied-label'],
    ['data-pt-error-label', 'data-error-label']
  ].flatMap(([source, target]) => [...documentRef.querySelectorAll(`[${source}]`)].map(element => ({
    element, target, en: element.getAttribute(target), pt: element.getAttribute(source)
  })));

  function setLanguage(requested, persist = false) {
    const language = resolveLanguage(requested);
    const portuguese = language === 'pt-BR';
    documentRef.documentElement.lang = language;
    for (const { element, en, pt } of textEntries) element.textContent = portuguese ? pt : en;
    for (const { element, target, en, pt } of attributes) element.setAttribute(target, portuguese ? pt : en);
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.language === language));
    for (const button of documentRef.querySelectorAll('[data-copy-target]')) {
      if (button.dataset.copied === 'true') button.textContent = button.dataset.copiedLabel;
      if (button.dataset.copyError === 'true') button.textContent = button.dataset.errorLabel;
    }
    if (persist) {
      try { windowRef.localStorage.setItem('siphon-site-language', language); } catch { /* The choice still works when storage is blocked. */ }
    }
  }

  function onClick(event) { setLanguage(event.currentTarget.dataset.language, true); }
  let saved;
  try { saved = windowRef.localStorage.getItem('siphon-site-language'); } catch { /* Use the browser preference. */ }
  setLanguage(resolveLanguage(saved, windowRef.navigator.languages ?? [windowRef.navigator.language]));
  buttons.forEach(button => button.addEventListener('click', onClick));
  switcher.hidden = false;
  return {
    setLanguage,
    disconnect() { buttons.forEach(button => button.removeEventListener('click', onClick)); }
  };
}

export function initProductDemo(root) {
  const noop = { selectTab() {}, disconnect() {} };
  if (!root) return noop;
  const tablist = root.querySelector('[role="tablist"]');
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = tabs.map(tab => root.ownerDocument.getElementById(tab.getAttribute('aria-controls')));
  if (!tablist || !tabs.length || panels.some(panel => !panel || !root.contains(panel))) return noop;

  function selectTab(index, focus = false) {
    if (!Number.isInteger(index)) return;
    const selected = ((index % tabs.length) + tabs.length) % tabs.length;
    tabs.forEach((tab, position) => {
      const active = selected === position;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[position].hidden = !active;
    });
    if (focus) tabs[selected].focus();
  }
  function onClick(event) { selectTab(tabs.indexOf(event.currentTarget)); }
  function onKeyDown(event) {
    const current = tabs.indexOf(event.currentTarget);
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(next, event.key)) return;
    event.preventDefault();
    selectTab(next[event.key], true);
  }
  tabs.forEach(tab => {
    tab.addEventListener('click', onClick);
    tab.addEventListener('keydown', onKeyDown);
  });
  selectTab(0);
  tablist.hidden = false;
  return {
    selectTab,
    disconnect() {
      tabs.forEach(tab => {
        tab.removeEventListener('click', onClick);
        tab.removeEventListener('keydown', onKeyDown);
      });
    }
  };
}

export function initMobileMenu(menu) {
  if (!menu) return { disconnect() {} };

  const documentRef = menu.ownerDocument;
  const summary = menu.querySelector('summary');
  let disconnected = false;

  function focusSummary() {
    summary?.focus?.();
  }

  function onClick(event) {
    if (
      event.defaultPrevented
      || (event.button ?? 0) !== 0
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
    ) {
      return;
    }

    const link = event.target?.closest?.('a[href^="#"]');
    const href = link?.getAttribute?.('href');
    if (!href || href.length < 2) return;

    menu.open = false;
    const destination = documentRef?.getElementById?.(href.slice(1));

    if (typeof destination?.focus === 'function') {
      destination.focus({ preventScroll: true });
    } else {
      focusSummary();
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || !menu.open) return;

    event.preventDefault();
    menu.open = false;
    focusSummary();
  }

  menu.addEventListener('click', onClick);
  documentRef?.addEventListener?.('keydown', onKeyDown);

  return {
    disconnect() {
      if (disconnected) return;

      disconnected = true;
      menu.removeEventListener('click', onClick);
      documentRef?.removeEventListener?.('keydown', onKeyDown);
    }
  };
}

export const COPY_FEEDBACK_MS = 2200;

export function initCopyButtons(documentRef, { feedbackMs = COPY_FEEDBACK_MS } = {}) {
  const buttons = [...documentRef.querySelectorAll('[data-copy-target]')];
  const windowRef = documentRef.defaultView;
  const timers = new Map();
  let disconnected = false;

  async function onClick(event) {
    const button = event.currentTarget;
    const text = documentRef.getElementById(button.dataset.copyTarget)?.textContent?.trim();
    if (!text) return;
    let copied = false;
    try {
      await windowRef.navigator.clipboard.writeText(text);
      copied = true;
    } catch { /* The visible command can still be selected and copied manually. */ }
    if (disconnected) return;
    button.dataset.copied = String(copied);
    button.dataset.copyError = String(!copied);
    button.textContent = copied ? button.dataset.copiedLabel : button.dataset.errorLabel;
    windowRef.clearTimeout(timers.get(button));
    timers.set(button, windowRef.setTimeout(() => {
      delete button.dataset.copied;
      delete button.dataset.copyError;
      button.textContent = button.dataset.copyLabel;
      timers.delete(button);
    }, feedbackMs));
  }
  buttons.forEach(button => button.addEventListener('click', onClick));
  return {
    disconnect() {
      disconnected = true;
      buttons.forEach(button => {
        button.removeEventListener('click', onClick);
        windowRef.clearTimeout(timers.get(button));
      });
      timers.clear();
    }
  };
}

if (typeof document !== 'undefined') {
  initLanguage(document);
  initProductDemo(document.querySelector('[data-product-demo]'));
  initMobileMenu(document.querySelector('[data-mobile-menu]'));
  initCopyButtons(document);
}

(function createCouchdicksThemeController() {
  const key = 'cd.theme';
  const cookieName = 'cd-theme';
  const root = document.documentElement;

  function valid(value) {
    return value === 'light' || value === 'dark';
  }

  function readCookie() {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=(light|dark)(?:;|$)`));
    return match ? match[1] : null;
  }

  function readStored() {
    try {
      const value = localStorage.getItem(key);
      return valid(value) ? value : null;
    } catch {
      return null;
    }
  }

  function resolved() {
    return readCookie() || readStored() || 'dark';
  }

  function persist(theme) {
    try { localStorage.setItem(key, theme); } catch {}
    const domain = location.hostname === 'couchdicks.org' || location.hostname.endsWith('.couchdicks.org')
      ? '; Domain=.couchdicks.org'
      : '';
    document.cookie = `${cookieName}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${location.protocol === 'https:' ? '; Secure' : ''}`;
  }

  function buttonMarkup() {
    return '<span class="cd-theme-toggle__icon" data-cd-theme-icon aria-hidden="true"></span><span class="cd-theme-toggle__label" data-cd-theme-label></span>';
  }

  function ensureButtons() {
    document.querySelectorAll('[data-cd-theme-slot]').forEach((slot) => {
      if (slot.querySelector('[data-cd-theme-toggle]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cd-theme-toggle';
      button.dataset.cdThemeToggle = '';
      button.innerHTML = buttonMarkup();
      slot.append(button);
    });
    document.querySelectorAll('[data-cd-theme-toggle]').forEach((button) => {
      button.classList.add('cd-theme-toggle');
      if (!button.querySelector('[data-cd-theme-icon]')) button.innerHTML = buttonMarkup();
      if (!button.dataset.cdThemeBound) {
        button.dataset.cdThemeBound = 'true';
        button.addEventListener('click', () => setTheme(root.dataset.cdTheme === 'dark' ? 'light' : 'dark', true));
      }
    });
  }

  function syncButtons(theme) {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.querySelectorAll('[data-cd-theme-toggle]').forEach((button) => {
      const icon = button.querySelector('[data-cd-theme-icon]');
      const label = button.querySelector('[data-cd-theme-label]');
      if (icon) icon.textContent = next === 'light' ? '☀' : '☾';
      if (label) label.textContent = next.toUpperCase();
      button.dataset.cdThemeCurrent = theme;
      button.setAttribute('aria-label', `Switch to ${next} mode`);
      button.title = `Switch to ${next} mode`;
    });
  }

  function syncThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#f2efe7' : '#0b0d10';
  }

  function setTheme(theme, shouldPersist = false) {
    const next = valid(theme) ? theme : resolved();
    root.dataset.cdTheme = next;
    root.style.colorScheme = next;
    window.__CD_THEME__ = next;
    if (shouldPersist) persist(next);
    syncButtons(next);
    syncThemeColor(next);
    window.dispatchEvent(new CustomEvent('cd:themechange', { detail: { theme: next } }));
    return next;
  }

  function mount() {
    ensureButtons();
    setTheme(root.dataset.cdTheme || resolved());
    const observer = new MutationObserver((records) => {
      const hasThemeTarget = records.some((record) => [...record.addedNodes].some((node) => (
        node.nodeType === Node.ELEMENT_NODE
        && (node.matches?.('[data-cd-theme-slot], [data-cd-theme-toggle]')
          || node.querySelector?.('[data-cd-theme-slot], [data-cd-theme-toggle]'))
      )));
      if (!hasThemeTarget) return;
      ensureButtons();
      syncButtons(root.dataset.cdTheme || resolved());
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  addEventListener('storage', (event) => {
    if (event.key === key && valid(event.newValue)) setTheme(event.newValue);
  });
  window.CouchdicksTheme = { get: () => root.dataset.cdTheme || resolved(), set: (theme) => setTheme(theme, true), mount };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();

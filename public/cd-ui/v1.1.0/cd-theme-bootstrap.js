(function bootstrapCouchdicksTheme() {
  const key = 'cd.theme';
  const cookieName = 'cd-theme';

  function cookieTheme() {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=(light|dark)(?:;|$)`));
    return match ? match[1] : null;
  }

  function storedTheme() {
    try {
      const value = localStorage.getItem(key);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  const theme = cookieTheme()
    || storedTheme()
    || 'dark';

  document.documentElement.dataset.cdTheme = theme;
  document.documentElement.style.colorScheme = theme;
  window.__CD_THEME__ = theme;
})();

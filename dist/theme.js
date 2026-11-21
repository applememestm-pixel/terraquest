'use strict';

const terraTheme = (() => {
  const key = 'terra-theme';
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preferred;
  try { preferred = (globalThis.terraStorage || localStorage).getItem(key); } catch {}

  function apply() {
    const dark = preferred === 'dark' || (preferred !== 'light' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#111a2a' : '#f4f6fb';
    document.getElementById('theme-button')?.setAttribute('aria-pressed', String(dark));
  }

  function toggle() {
    preferred = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { (globalThis.terraStorage || localStorage).setItem(key, preferred); } catch {}
    apply();
  }

  apply();
  system.addEventListener('change', apply);
  return { apply, toggle };
})();

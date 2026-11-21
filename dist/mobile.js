'use strict';

let installPrompt;
const installButton = document.getElementById('install-button');
const standalone = matchMedia('(display-mode: standalone)');

function showInstallAction() {
  installButton.hidden = Boolean(globalThis.TERRA_OFFLINE || standalone.matches || navigator.standalone === true);
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installButton.hidden = true;
});

installButton.addEventListener('click', async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      return;
    } catch {
      // The browser may consume the prompt before it can be shown.
    }
  }
  document.getElementById('install-dialog').showModal();
});

const themeButton = document.getElementById('theme-button');
themeButton.addEventListener('click', terraTheme.toggle);
terraTheme.apply();

standalone.addEventListener('change', showInstallAction);
showInstallAction();
if (!globalThis.TERRA_OFFLINE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

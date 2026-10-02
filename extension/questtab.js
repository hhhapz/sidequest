'use strict';

const api = globalThis.browser ?? chrome;

const signedIn = document.querySelector('form[name^="win"] input[name="ICSID"]') !== null;
api.runtime.sendMessage({ type: 'page', signedIn, path: location.pathname });

api.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== 'fetch' || !msg.url.startsWith(location.origin + '/psc/')) {
    return;
  }
  fetch(msg.url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), ...msg.init })
    .then(async (res) => respond({ url: res.url, text: await res.text() }))
    .catch(() => respond(null));
  return true;
});

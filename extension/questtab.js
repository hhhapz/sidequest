'use strict';

const api = globalThis.browser ?? chrome;

const signedIn = document.querySelector('form[name^="win"] input[name="ICSID"]') !== null;
api.runtime.sendMessage({ type: 'page', signedIn, path: location.pathname }).catch(() => {});

// only the top frame relays, so each request has one response
if (window === window.top) {
  api.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type !== 'fetch' || !msg.url.startsWith(location.origin + '/psc/')) {
      return;
    }
    fetchQuest(msg.url, msg.init)
      .then(respond)
      .catch((err) => {
        let state = 'error';
        if (err instanceof SignedOut) {
          state = 'signin';
        } else if (err instanceof Unreachable) {
          state = 'unreachable';
        }
        respond({ state, why: err.message });
      });
    return true;
  });
}

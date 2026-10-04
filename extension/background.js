'use strict';

if (typeof importScripts === 'function') {
  importScripts('quest.js');
}

const api = globalThis.browser ?? chrome;

const HOUR = 60 * 60 * 1000;

async function direct(url, init) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20000), ...init });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('quest timed out');
    }
    if (!navigator.onLine) {
      throw new Error('offline');
    }
    // a signed out quest redirects to the login server, which fetch can't follow
    throw new SignedOut();
  }
  return { url: res.url, text: await res.text() };
}

// in a firefox container our own fetch has no cookies, an open quest tab does
async function relay(url, init) {
  const tabs = await api.tabs.query({ url: QUEST + '/*' });
  for (const tab of tabs) {
    const res = await api.tabs.sendMessage(tab.id, { type: 'fetch', url, init }).catch(() => null);
    if (res) {
      return res;
    }
  }
  throw new SignedOut();
}

class Client {
  constructor(name, send) {
    this.name = name;
    this.send = send;
  }

  async search(site, q) {
    const key = 'block:' + this.name;
    let block = (await api.storage.session.get(key))[key];

    for (let tries = 0; ; tries++) {
      try {
        const form = searchForm(await this.send(searchURL(block || site + '_newwin')));
        block = form.block;
        await api.storage.session.set({ [key]: block });

        const res = parseResults(await this.send(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.query(q),
        }));
        if (res.term && res.term !== q.term) {
          throw new Error('quest answered for another term');
        }
        return res.sections;
      } catch (err) {
        if (!(err instanceof Stale) || tries > 0) {
          throw err;
        }
        block = null;
      }
    }
  }
}

const clients = [new Client('direct', direct), new Client('relay', relay)];

async function search(site, q) {
  for (const client of clients) {
    try {
      const sections = await client.search(site, q);
      if (client !== clients[0]) {
        clients.reverse();
      }
      return sections;
    } catch (err) {
      if (!(err instanceof SignedOut)) {
        throw err;
      }
    }
  }
  throw new SignedOut();
}

// two searches in the same state block must not interleave
let last = Promise.resolve();

function queue(fn) {
  last = last.then(fn, fn);
  return last;
}

const recent = [];

function throttle() {
  const now = Date.now();
  while (recent.length > 0 && now - recent[0] > 5 * 60 * 1000) {
    recent.shift();
  }
  if (recent.length >= 40) {
    throw new Error('too many searches, try again in a few minutes');
  }
  recent.push(now);
}

function cacheKey(q) {
  return `c:${q.subject}|${q.catalog}|${q.term}`;
}

async function cached(q) {
  const key = cacheKey(q);
  const hit = (await api.storage.local.get(key))[key];
  if (!hit) {
    return { state: 'miss' };
  }
  return { state: 'ok', ...hit, fresh: Date.now() - hit.at < HOUR };
}

const pending = new Map();

function refresh(q) {
  const key = cacheKey(q);
  if (!pending.has(key)) {
    pending.set(key, queue(() => load(q)).finally(() => pending.delete(key)));
  }
  return pending.get(key);
}

async function load(q) {
  throttle();

  // never guess the site, a request to the wrong one signs the user out
  const { site } = await api.storage.local.get('site');
  if (!site) {
    throw new SignedOut();
  }

  const hit = { sections: await search(site, q), at: Date.now() };
  await api.storage.local.set({ [cacheKey(q)]: hit });
  return { state: 'ok', ...hit, fresh: true };
}

async function signin(msg, sender) {
  await api.storage.session.set({ opener: sender.tab.id });
  return {};
}

async function page(msg, sender) {
  const block = blockOf(msg.path);
  if (!msg.signedIn || !block) {
    return {};
  }
  const site = block.split('_')[0];
  await api.storage.local.set({ site });

  const { opener } = await api.storage.session.get('opener');
  if (opener && sender.tab.openerTabId === opener) {
    await api.storage.session.remove('opener');
    await api.tabs.update(opener, { active: true }).catch(() => {});

    const reachable = await queue(async () => new Form(await direct(searchURL(site + '_newwin')))).then(() => true, () => false);
    if (reachable) {
      await api.tabs.remove(sender.tab.id).catch(() => {});
    }
  }

  await api.storage.local.set({ signedInAt: Date.now() });
  return {};
}

async function options() {
  await api.runtime.openOptionsPage();
  return {};
}

const handlers = { cached, refresh, signin, page, options };

api.runtime.onMessage.addListener((msg, sender, respond) => {
  const handler = handlers[msg.type];
  if (!handler) {
    return;
  }
  handler(msg, sender).then(respond, (err) => {
    if (err instanceof SignedOut) {
      respond({ state: 'signin' });
      return;
    }
    respond({ state: 'error', why: err.message });
  });
  return true;
});

api.runtime.onStartup.addListener(async () => {
  const all = await api.storage.local.get(null);
  const old = Object.keys(all).filter((key) => key.startsWith('c:') && Date.now() - all[key].at > 30 * 24 * HOUR);
  await api.storage.local.remove(old);
});

'use strict';

if (typeof importScripts === 'function') {
  importScripts('quest.js');
}

const api = globalThis.browser ?? chrome;

const HOUR = 60 * 60 * 1000;

function scope(sender) {
  const tab = sender.tab || {};
  return `${tab.incognito ? 'private' : 'normal'}:${tab.cookieStoreId || 'default'}`;
}

class Client {
  constructor(name, send) {
    this.name = name;
    this.send = send;
  }

  async search(site, q) {
    const key = 'block:' + this.name;
    let block = (await api.storage.session.get(key))[key];
    if (block && block.split('_')[0] !== site) {
      block = null;
    }

    for (let tries = 0; ; tries++) {
      try {
        const page = await this.send(searchURL(block || site + '_newwin'));
        block = searchForm(page).block;
        await api.storage.session.set({ [key]: block });

        const res = await queryQuest(
          page,
          {
            CLASS_SRCH_WRK2_STRM: q.term,
            SSR_CLSRCH_WRK_SUBJECT: q.subject,
            SSR_CLSRCH_WRK_SSR_EXACT_MATCH1: 'E',
            SSR_CLSRCH_WRK_CATALOG_NBR: q.catalog,
          },
          this.send,
        );
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

async function search(site, q, sender) {
  const clients = [];
  const store = sender.tab && sender.tab.cookieStoreId;
  if (!sender.tab?.incognito && (!store || store === 'firefox-default')) {
    clients.push(new Client(scope(sender) + ':direct', fetchQuest));
  }
  const tabs = await api.tabs.query({ url: QUEST + '/*' });
  for (const tab of tabs) {
    if (scope({ tab }) !== scope(sender)) {
      continue;
    }
    const send = async (url, init) => {
      const res = await api.tabs
        .sendMessage(tab.id, { type: 'fetch', url, init }, { frameId: 0 })
        .catch(() => null);
      if (!res) {
        throw new Unreachable('Quest tab closed or reloaded. Open Quest and try again.');
      }
      if (res.state === 'signin') {
        throw new SignedOut();
      }
      if (res.state === 'error') {
        throw new Error(res.why);
      }
      if (res.state === 'unreachable') {
        throw new Unreachable(res.why);
      }
      return res;
    };
    clients.push(new Client(scope(sender) + ':tab:' + tab.id, send));
  }
  let failure = null;
  for (const client of clients) {
    try {
      return await client.search(site, q);
    } catch (err) {
      if (!(err instanceof SignedOut) && !(err instanceof Unreachable)) {
        throw err;
      }
      if (err instanceof Unreachable) {
        failure = err;
      }
    }
  }
  if (failure) {
    throw failure;
  }
  throw new SignedOut();
}

// two searches in the same state block must not interleave
let last = Promise.resolve();

function queue(fn) {
  last = last.then(fn, fn);
  return last;
}

async function throttle() {
  const now = Date.now();
  const stored = await api.storage.session.get('recentSearches');
  const recent = (stored.recentSearches || []).filter((at) => now - at < 5 * 60 * 1000);
  if (recent.length >= 40) {
    throw new Error('too many searches, try again in a few minutes');
  }
  recent.push(now);
  await api.storage.session.set({ recentSearches: recent });
}

function cacheKey(q, sender) {
  return `c:${scope(sender)}:${q.subject}|${q.catalog}|${q.term}`;
}

async function cached(q, sender) {
  const key = cacheKey(q, sender);
  const hit = (await api.storage.local.get(key))[key];
  if (!hit) {
    return { state: 'miss' };
  }
  return { state: 'ok', ...hit, fresh: Date.now() - hit.at < HOUR };
}

const pending = new Map();

function refresh(q, sender) {
  const key = cacheKey(q, sender);
  if (!pending.has(key)) {
    pending.set(
      key,
      queue(() => load(q, sender)).finally(() => pending.delete(key)),
    );
  }
  return pending.get(key);
}

async function load(q, sender) {
  await throttle();

  // never guess the site, a request to the wrong one signs the user out
  const { site } = await api.storage.local.get('site');
  if (!site) {
    throw new SignedOut();
  }

  const hit = { sections: await search(site, q, sender), at: Date.now() };
  await api.storage.local.set({ [cacheKey(q, sender)]: hit });
  return { state: 'ok', ...hit, fresh: true };
}

async function signin(msg, sender) {
  await api.storage.session.set({ ['opener:' + scope(sender)]: sender.tab.id });
  return {};
}

async function page(msg, sender) {
  const block = blockOf(msg.path);
  if (!msg.signedIn || !block) {
    return {};
  }
  const site = block.split('_')[0];
  await api.storage.local.set({ site });

  const key = 'opener:' + scope(sender);
  const opener = (await api.storage.session.get(key))[key];
  if (opener !== undefined && sender.tab.openerTabId === opener) {
    await api.storage.session.remove(key);
    await api.tabs.update(opener, { active: true }).catch(() => {});

    const store = sender.tab.cookieStoreId;
    const reachable =
      !sender.tab.incognito &&
      (!store || store === 'firefox-default') &&
      (await queue(async () => new Form(await fetchQuest(searchURL(site + '_newwin')))).then(
        () => true,
        () => false,
      ));
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

async function context(msg, sender) {
  return scope(sender);
}

const handlers = { cached, refresh, signin, page, options, context };

api.runtime.onMessage.addListener((msg, sender, respond) => {
  const handler = msg && Object.hasOwn(handlers, msg.type) && handlers[msg.type];
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

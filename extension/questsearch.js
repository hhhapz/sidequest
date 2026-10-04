'use strict';

// api comes from questtab.js, Form and the parsers from quest.js, the page from questpage.js

const FLOW = 'https://uwflow.com';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KEEP = 30 * 60 * 1000;

const state = {
  items: [],
  query: '',
  term: '',
  hideClosed: false,
  hideExtra: false,
  hideGrad: false,
  status: 'idle',
  why: '',
  history: null,
  drawer: null,
  panel: false,
  label: '',
  whole: false,
  sections: [],
  open: null,
};

const details = new Map();
const flowCourses = new Map();
const profRatings = new Map();
const flowSeats = new Map();
const flowReviews = new Map();

let flags = {};
let site = null;
let block = null;
let index = null;
let seq = 0;
let last = Promise.resolve();

function on(flag) {
  return flags[flag] !== false;
}

async function questFetch(url, init) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(60000), ...init });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error('Quest timed out');
    }
    throw new SignedOut();
  }
  return { url: res.url, text: await res.text() };
}

function post(form, values) {
  return questFetch(form.action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.body({ ICAJAX: '0', ...values }),
  });
}

// two requests in the same state block must not interleave
function queue(fn) {
  last = last.then(fn, fn);
  return last;
}

async function entry() {
  for (let tries = 0; ; tries++) {
    const page = await questFetch(searchURL(block || site + '_newwin'));
    try {
      const form = searchForm(page);
      block = form.block;
      return { form, page };
    } catch (err) {
      if (!(err instanceof Stale) || tries > 0) {
        throw err;
      }
      block = null;
    }
  }
}

async function search(values) {
  const { form } = await entry();
  let page = await post(form, { ICAction: SEARCH, ...values });
  if (isPrompt(page)) {
    page = await post(new Form(page), { ICAction: '#ICSave' });
  }
  const res = parseResults(page);
  if (res.term && res.term !== values.CLASS_SRCH_WRK2_STRM) {
    throw new Error(`Quest returned ${termName(res.term)}, not ${termName(values.CLASS_SRCH_WRK2_STRM)}.`);
  }
  return res;
}

async function detail(term, section) {
  const { form } = await entry();
  const page = await post(form, {
    ICAction: SEARCH,
    CLASS_SRCH_WRK2_STRM: term,
    SSR_CLSRCH_WRK_SUBJECT: section.course.split(' ')[0],
    SSR_CLSRCH_WRK_CLASS_NBR: section.classNumber,
  });
  parseResults(page);
  return parseDetail(await post(new Form(page), { ICAction: 'MTG_CLASSNAME$0' }));
}

function criteria(target, term) {
  const values = { CLASS_SRCH_WRK2_STRM: term };
  if (target.kind === 'prof') {
    values.SSR_CLSRCH_WRK_LAST_NAME = target.last;
    values.SSR_CLSRCH_WRK_SSR_EXACT_MATCH2 = 'C';
  } else {
    values.SSR_CLSRCH_WRK_SUBJECT = target.subject;
  }
  if (target.kind === 'course') {
    values.SSR_CLSRCH_WRK_SSR_EXACT_MATCH1 = 'E';
    values.SSR_CLSRCH_WRK_CATALOG_NBR = target.catalog;
  } else {
    // quest wants two criteria besides the term, catalog >= 0 matches everything
    values.SSR_CLSRCH_WRK_SSR_EXACT_MATCH1 = 'G';
    values.SSR_CLSRCH_WRK_CATALOG_NBR = '0';
  }
  return values;
}

// every answer from quest is kept for half an hour, across reloads too
async function kept(key, load) {
  const name = 'r:' + key;
  const stored = (await api.storage.local.get(name))[name];
  if (stored && Date.now() - stored.at < KEEP) {
    return stored.value;
  }
  const value = await queue(load);
  await api.storage.local.set({ [name]: { at: Date.now(), value } });
  return value;
}

function searchKept(values) {
  return kept(JSON.stringify(values), async () => (await search(values)).sections);
}

async function prune() {
  const all = await api.storage.local.get(null);
  const old = Object.keys(all).filter((key) => key.startsWith('r:') && Date.now() - all[key].at > KEEP);
  await api.storage.local.remove(old);
}

async function find(target, term) {
  if (target.kind === 'many') {
    const all = new Map();
    for (const part of target.targets) {
      for (const s of await find(part, term)) {
        all.set(s.classNumber, s);
      }
    }
    return [...all.values()];
  }
  if (target.kind === 'prof') {
    const { mine, all } = await taught(target, term);
    return target.full ? mine : all;
  }
  if (target.kind === 'course') {
    return searchKept(criteria(target, term));
  }

  // a level like cs 2xx is cut from its whole subject, so the two share one search
  const all = await searchKept(criteria({ kind: 'subject', subject: target.subject }, term));
  if (target.kind === 'level') {
    return all.filter((s) => s.course.split(' ')[1].startsWith(target.level));
  }
  return all;
}

// quest searches by last name and uwflow's names aren't always in quest's order,
// so each word is tried as the last name until the person turns up
async function taught(target, term) {
  const words = target.name.trim().split(/\s+/);
  let tries = [words[words.length - 1]];
  if (target.word) {
    tries = [target.word];
  } else if (target.full) {
    tries = [...new Set([words[words.length - 1], words[0], ...words.slice(1, -1)])];
  }

  let res = null;
  for (const word of tries) {
    const sections = await searchKept(criteria({ ...target, last: word }, term));
    const mine = sections.filter((s) => s.instructors.some((name) => nameKey(name) === nameKey(target.name)));
    if (res === null || mine.length > 0) {
      res = { mine, all: sections };
    }
    if (mine.length > 0) {
      target.word = word;
      break;
    }
  }
  return res;
}

async function loadHistory(target, id) {
  state.history = recentTerms().map((term) => ({ term, state: 'loading' }));
  render();

  for (const entry of state.history) {
    try {
      entry.sections = (await taught(target, entry.term)).mine;
      entry.state = 'ok';
    } catch (err) {
      entry.state = 'error';
      entry.why = err instanceof SignedOut ? 'Signed out of Quest.' : err.message;
    }
    if (id !== seq) {
      return;
    }
    render();
  }
}

async function run() {
  // whatever is still typed becomes a tag too
  if (state.query.trim()) {
    const typed = resolve(state.query);
    if (!typed) {
      state.status = 'error';
      state.why = 'Invalid search.';
      render();
      return;
    }
    state.items.push(...(typed.kind === 'many' ? typed.targets : [typed]));
    state.query = '';
  }
  if (state.items.length === 0) {
    return;
  }

  const id = ++seq;
  const term = state.term;
  let target = state.items[0];
  if (state.items.length > 1) {
    target = { kind: 'many', targets: [...state.items], label: state.items.map((t) => t.label).join(', ') };
  }

  // the search lives in the url's hash so back and forward work
  const hash = '#' + new URLSearchParams({ q: target.label, term });
  if (location.hash !== hash) {
    history.pushState(null, '', hash);
  }

  state.status = 'loading';
  state.label = target.label;
  const parts = target.kind === 'many' ? target.targets : [target];
  state.whole = parts.some((t) => t.kind === 'subject' || t.kind === 'level');
  state.open = null;
  state.history = null;
  closePicks();
  save();
  render();

  try {
    const sections = await find(target, term);
    if (id !== seq) {
      return;
    }
    state.status = 'ok';
    state.sections = sections;
    if (on('questRatings') || on('questCourseInfo')) {
      loadFlow(state.sections, term);
    }
    if (target.kind === 'prof' && target.full && on('questHistory')) {
      loadHistory(target, id);
    }
  } catch (err) {
    if (id !== seq) {
      return;
    }
    state.status = err instanceof SignedOut ? 'signin' : 'error';
    state.why = err.message;
  }
  render();
}

function toggleDetail(section) {
  const term = state.term;
  const key = term + '|' + section.classNumber;
  state.open = state.open === key ? null : key;
  const entry = details.get(key);
  if (state.open && (!entry || entry.state === 'error' || Date.now() - entry.at > KEEP)) {
    details.set(key, { state: 'loading', at: Date.now() });
    kept('detail|' + key, () => detail(term, section))
      .then((d) => details.set(key, { state: 'ok', detail: d, at: Date.now() }))
      .catch((err) => details.set(key, { state: 'error', why: err instanceof SignedOut ? 'Signed out of Quest.' : err.message }))
      .then(render);
  }
  render();
}

async function flowQuery(query, variables) {
  const res = await fetch(FLOW + '/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()).data;
}

// ratings, requisites, and enrolment that uwflow copies from uw's api once a day
async function loadFlow(sections, term) {
  const codes = [...new Set(sections.map((s) => flowCode(s.course)))];
  const known = new Map(index ? index.profs.map(([name]) => [nameKey(name), name]) : []);
  const names = [...new Set(sections.flatMap((s) => s.instructors).map((name) => known.get(nameKey(name)) || name))];
  try {
    const data = await flowQuery(
      'query($codes: [String!], $names: [String!], $term: Int) { course(where: { code: { _in: $codes } }) { code name description prereqs coreqs antireqs postrequisites { postrequisite { code name } } rating { liked easy useful filled_count } sections(where: { term_id: { _eq: $term } }) { class_number enrollment_total enrollment_capacity } } prof(where: { name: { _in: $names } }) { code name rating { liked filled_count } } }',
      { codes, names, term: Number(term) },
    );
    for (const c of data.course) {
      flowCourses.set(c.code, c);
      for (const section of c.sections) {
        flowSeats.set(term + '|' + section.class_number, { enrolled: section.enrollment_total, capacity: section.enrollment_capacity });
      }
    }
    for (const p of data.prof) {
      profRatings.set(nameKey(p.name), p);
    }
  } catch (err) {
    console.warn('sidequest: uwflow ratings', err);
    return;
  }
  render();
}

async function loadReviews(code) {
  if (flowReviews.has(code)) {
    return;
  }
  flowReviews.set(code, { state: 'loading' });
  try {
    const data = await flowQuery(
      'query($code: String) { course(where: { code: { _eq: $code } }) { reviews(order_by: { created_at: desc }, limit: 8, where: { course_comment: { _is_null: false } }) { course_comment liked created_at prof { name } } } }',
      { code },
    );
    flowReviews.set(code, { state: 'ok', list: data.course.length > 0 ? data.course[0].reviews : [] });
  } catch (err) {
    flowReviews.set(code, { state: 'error' });
  }
  render();
}

// every course and prof uwflow knows, about 1 MB, kept for a day
async function loadIndex() {
  let { flowIndex } = await api.storage.local.get('flowIndex');
  if (!flowIndex || Date.now() - flowIndex.at > DAY) {
    const data = await flowQuery('{ course_search_index { code name ratings } prof_search_index { name ratings } }');
    flowIndex = {
      at: Date.now(),
      // transfer credits like cs1xx and laurier's cs213w aren't on quest
      courses: data.course_search_index
        .filter((c) => /^[a-z]+\d+[a-vyz]?$/.test(c.code))
        .map((c) => [c.code, c.name, c.ratings]),
      profs: data.prof_search_index.map((p) => [p.name, p.ratings]),
    };
    await api.storage.local.set({ flowIndex });
  }

  const subjects = new Map();
  for (const [code] of flowIndex.courses) {
    const subject = code.match(/^[a-z]+/)[0];
    subjects.set(subject, (subjects.get(subject) || 0) + 1);
  }
  index = { courses: flowIndex.courses, profs: flowIndex.profs, subjects };
}

function nameKey(name) {
  return name.toLowerCase().split(/[\s-]+/).filter(Boolean).sort().join(' ');
}

function flowCode(course) {
  return course.replace(' ', '').toLowerCase();
}

function courseTarget(code, name) {
  const m = code.match(/^([a-z]+)(\d+[a-z]*)$/i);
  const subject = m[1].toUpperCase();
  const catalog = m[2].toUpperCase();
  return { kind: 'course', subject, catalog, label: `${subject} ${catalog}`, note: name || '' };
}

function subjectTarget(subject) {
  const count = index && index.subjects.get(subject.toLowerCase());
  return { kind: 'subject', subject: subject.toUpperCase(), label: subject.toUpperCase(), note: count ? `${count} courses` : 'All courses' };
}

function levelTarget(subject, level) {
  const prefix = subject.toLowerCase() + level;
  const count = index ? index.courses.filter(([code]) => code.startsWith(prefix) && /^[a-z]+\d{3}/.test(code)).length : 0;
  const label = `${subject.toUpperCase()} ${level}xx`;
  return { kind: 'level', subject: subject.toUpperCase(), level, label, note: count ? `${count} courses` : '' };
}

function profTarget(name, full) {
  return { kind: 'prof', name, full, label: name, note: '' };
}

function suggest(text) {
  const q = text.trim().toLowerCase();
  if (!index || q.length < 2) {
    return [];
  }
  const compact = q.replace(/\s+/g, '');
  const words = q.split(/\s+/);

  const out = [];
  if (/^[a-z]+$/.test(compact) && index.subjects.has(compact)) {
    out.push(subjectTarget(compact));
  }
  const level = compact.match(/^([a-z]+)(\d)$/);
  if (level && index.subjects.has(level[1])) {
    out.push(levelTarget(level[1], level[2]));
  }

  const courses = [];
  for (const [code, name, ratings] of index.courses) {
    const byCode = code.startsWith(compact);
    if (byCode || words.every((w) => name.toLowerCase().includes(w))) {
      courses.push({ code, name, ratings, byCode });
    }
  }
  courses.sort((a, b) => (b.byCode - a.byCode) || (a.byCode ? a.code.localeCompare(b.code, 'en', { numeric: true }) : b.ratings - a.ratings));

  const profs = [];
  for (const [name, ratings] of index.profs) {
    const parts = name.toLowerCase().split(/[\s-]+/);
    if (words.every((w) => parts.some((p) => p.startsWith(w)))) {
      profs.push({ name, ratings });
    }
  }
  profs.sort((a, b) => b.ratings - a.ratings);

  out.push(...courses.slice(0, 6).map((c) => courseTarget(c.code, c.name)));
  out.push(...profs.slice(0, 4).map((p) => profTarget(p.name, true)));
  return out.slice(0, 8);
}

// what to search when enter is pressed without picking a suggestion
function resolve(text) {
  if (text.includes(',')) {
    const targets = text.split(',').filter((part) => part.trim()).map(resolve);
    if (targets.length === 0 || targets.includes(null)) {
      return null;
    }
    if (targets.length === 1) {
      return targets[0];
    }
    return { kind: 'many', targets, label: targets.map((t) => t.label).join(', '), note: '' };
  }

  const q = text.trim();
  const level = q.match(/^([a-z]+)\s*(\d)$/i);
  if (level) {
    return levelTarget(level[1], level[2]);
  }
  if (/^[a-z]+\s*\d+[a-z]*$/i.test(q)) {
    return courseTarget(q.replace(/\s+/g, ''));
  }
  if (/^[a-z]+$/i.test(q) && (!index || index.subjects.has(q.toLowerCase()))) {
    return subjectTarget(q);
  }
  const first = suggest(q)[0];
  if (first) {
    return first;
  }
  if (/^[a-z][a-z' -]*$/i.test(q)) {
    return profTarget(q, false);
  }
  return null;
}

function save() {
  if (!on('questRemember')) {
    return;
  }
  const { items, hideClosed, hideExtra, hideGrad } = state;
  api.storage.local.set({ lastSearch: { items, hideClosed, hideExtra, hideGrad } });
}

function restore(saved) {
  if (!saved || !on('questRemember')) {
    return false;
  }
  state.items = saved.items || [];
  state.hideClosed = Boolean(saved.hideClosed);
  state.hideExtra = Boolean(saved.hideExtra);
  state.hideGrad = Boolean(saved.hideGrad);
  return state.items.length > 0;
}

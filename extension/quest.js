'use strict';

// quest is peoplesoft. class search is a GET of the search page, then a POST
// of its form. page state lives in a "state block" picked by the url:
// /psc/SS_newwin/ allocates one and redirects to it, e.g. /psc/SS_3/, so the
// user's own quest pages are never touched. in block 3 the form is win3 and has
// ICElementNum=3, so the POST is built from the form on the page.

const QUEST = 'https://quest.pecs.uwaterloo.ca';
const SEARCH = 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH';

class SignedOut extends Error {}

class Stale extends Error {}

function searchURL(block) {
  return `${QUEST}/psc/${block}/ACADEMIC/SA/c/UW_CEM.UW_CLASS_SRCH.GBL?Page=UW_SSRCLSRCH_ENT&Action=U`;
}

function blockOf(path) {
  const m = path.match(/^\/ps[cp]\/([A-Za-z]+(_\d+)?)\//);
  return m ? m[1] : null;
}

function isLogin(page) {
  return !page.url.startsWith(QUEST) || /[?&]cmd=(login|logout|expire)/.test(page.url);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}=(?:'([^']*)'|"([^"]*)")`));
  return m ? m[1] ?? m[2] : null;
}

function clean(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class Form {
  constructor(page) {
    if (isLogin(page)) {
      throw new SignedOut();
    }
    const html = (page.text.match(/<form\b[^>]*name='win\d+'[\s\S]*?<\/form>/) || [''])[0];

    this.action = attr(html, 'action');
    this.block = blockOf(new URL(page.url).pathname);
    this.fields = new Map();

    for (const tag of html.match(/<input\b[^>]*>|<select\b[\s\S]*?<\/select>/g) || []) {
      if (tag.startsWith('<select')) {
        const option = tag.match(/<option value="([^"]*)" selected/) || tag.match(/<option value="([^"]*)"/);
        this.fields.set(attr(tag, 'name'), option ? option[1] : '');
        continue;
      }
      // checkboxes are mirrored by hidden $chk fields
      const type = attr(tag, 'type');
      if (type === 'hidden' || type === 'text') {
        this.fields.set(attr(tag, 'name'), attr(tag, 'value') || '');
      }
    }

    if (!this.fields.has('ICSID')) {
      throw new Stale('Unexpected Quest page');
    }
  }

  // the server appends a suffix like $35$ that changes between renders
  field(base) {
    for (const name of this.fields.keys()) {
      if (name.startsWith(base + '$')) {
        return name;
      }
    }
    return null;
  }

  // values are keyed by field name without the suffix
  body(values) {
    const fields = new Map(this.fields);
    for (const [base, value] of Object.entries(values)) {
      fields.set(this.field(base) || base, value);
    }

    let body = 'ICNAVTYPEDROPDOWN=0';
    for (const [name, value] of fields) {
      body += `&${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    }
    return body;
  }

  query(q) {
    return this.body({
      ICAJAX: '1',
      ICAction: SEARCH,
      CLASS_SRCH_WRK2_STRM: q.term,
      SSR_CLSRCH_WRK_SUBJECT: q.subject,
      SSR_CLSRCH_WRK_SSR_EXACT_MATCH1: 'E',
      SSR_CLSRCH_WRK_CATALOG_NBR: q.catalog,
    });
  }
}

function searchForm(page) {
  const form = new Form(page);
  if (!form.field('SSR_CLSRCH_WRK_SUBJECT')) {
    throw new Stale('Unexpected Quest page');
  }
  return form;
}

function termsOf(page) {
  const select = page.text.match(/<select\b[^>]*name='CLASS_SRCH_WRK2_STRM[\s\S]*?<\/select>/);
  const terms = [];
  for (const m of select ? select[0].matchAll(/<option value="(\d+)"/g) : []) {
    terms.push(m[1]);
  }
  return terms;
}

// over 100 classes quest asks first, its ok button is #ICSave
function isPrompt(page) {
  return /would you like to continue/i.test(page.text) && page.text.includes("'#ICSave'");
}

function messageOf(page) {
  const m = page.text.match(/id='DERIVED_CLSMSG_ERROR_TEXT'[^>]*>([\s\S]*?)<\/span>/);
  return m ? clean(m[1]) : '';
}

// section n has cells MTG_CLASS_NBR$n, MTG_INSTR$n, MTG_ROOM$n, status is an icon's alt text
function parseResults(page) {
  if (isLogin(page)) {
    throw new SignedOut();
  }
  const xml = page.text;
  if (/search returns no results/i.test(xml)) {
    return { term: null, sections: [] };
  }
  const message = messageOf(page);
  if (message) {
    throw new Error(message);
  }

  const cell = (id, n) => {
    const m = xml.match(new RegExp(`id='${id}\\$${n}'[^>]*>([\\s\\S]*?)</(span|a)>`));
    if (!m) {
      return null;
    }
    return m[1].split(/<br \/>|,/)
      .map(clean)
      .filter((s) => s && s !== 'TBA' && s !== 'To be Announced');
  };

  // a heading like "CS  246 - Title" comes before each course's sections
  const headings = [];
  for (const m of xml.matchAll(/class='PTCOLLAPSE' alt='([A-Z]+ +\d+[A-Z]*) - ([^']*?)(?: Collapsible section)?'/g)) {
    headings.push({ at: m.index, course: m[1].replace(/ +/, ' '), title: clean(m[2]) });
  }

  const sections = [];
  for (let n = 0; cell('MTG_CLASS_NBR', n); n++) {
    const status = xml.match(new RegExp(`divDERIVED_CLSRCH_SSR_STATUS_LONG\\$${n}'[\\s\\S]{0,400}?alt="([^"]*)"`));
    const at = xml.indexOf(`id='MTG_CLASS_NBR$${n}'`);
    const heading = headings.filter((h) => h.at < at).pop() || { course: '', title: '' };
    sections.push({
      classNumber: cell('MTG_CLASS_NBR', n)[0],
      course: heading.course,
      title: heading.title,
      section: (cell('MTG_CLASSNAME', n) || [''])[0],
      times: cell('MTG_DAYTIME', n) || [],
      dates: cell('MTG_TOPIC', n) || [],
      instructors: [...new Set(cell('MTG_INSTR', n))],
      rooms: [...new Set(cell('MTG_ROOM', n))],
      status: status ? status[1] : '',
    });
  }
  if (sections.length === 0) {
    throw new Stale('Unexpected Quest page');
  }

  // the term label carries invisible direction marks, which clean drops
  const m = clean(xml.replace(/<script[\s\S]*?<\/script>/g, '')).match(/\| (Winter|Spring|Fall) 20(\d\d)\b/);
  const term = m ? `1${m[2]}${{ Winter: 1, Spring: 5, Fall: 9 }[m[1]]}` : null;
  return { term, sections };
}

// the class detail page, labels are matched in its text since its ids weren't probed
function parseDetail(page) {
  if (isLogin(page)) {
    throw new SignedOut();
  }
  const text = clean(page.text.replace(/<script[\s\S]*?<\/script>/g, ''));
  const number = (label) => {
    const m = text.match(new RegExp(label + ' (\\d+)'));
    return m ? Number(m[1]) : null;
  };
  const between = (from, to) => {
    const i = text.indexOf(from);
    const j = text.indexOf(to, i + from.length);
    return i < 0 || j < 0 ? '' : text.slice(i + from.length, j).trim();
  };

  const detail = {
    capacity: number('Class Capacity'),
    enrolled: number('Enrollment Total'),
    waitCapacity: number('Wait List Capacity'),
    waitTotal: number('Wait List Total'),
    seats: number('Available Seats'),
    requirements: between('Enrollment Information', 'Enrollment Requirements'),
    notes: between('Class Notes', 'Description'),
  };
  if (detail.capacity === null) {
    throw new Stale('Unexpected Quest page');
  }
  return detail;
}

// a term is 1, the year's last two digits, then the month it starts: 1269 is fall 2026
function termName(code) {
  return `${{ 1: 'Winter', 5: 'Spring', 9: 'Fall' }[code[3]]} 20${code.slice(1, 3)}`;
}

function currentTerm() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const start = month < 5 ? 1 : month < 9 ? 5 : 9;
  return `1${String(now.getFullYear() % 100).padStart(2, '0')}${start}`;
}

function recentTerms(count) {
  const list = [currentTerm()];
  while (list.length < count) {
    list.push(previousTerm(list[list.length - 1]));
  }
  return list;
}

function previousTerm(code) {
  const year = Number(code.slice(1, 3));
  if (code[3] === '1') {
    return `1${String(year - 1).padStart(2, '0')}9`;
  }
  return code.slice(0, 3) + (code[3] === '9' ? '5' : '1');
}

'use strict';

// quest is peoplesoft. class search is a GET of the search page, then a POST
// of its form. page state lives in a "state block" picked by the url:
// /psc/SS_newwin/ allocates one and redirects to it, e.g. /psc/SS_3/, so the
// user's own quest pages are never touched. in block 3 the form is win3 and has
// ICElementNum=3, so the POST is built from the form on the page.

const QUEST = 'https://quest.pecs.uwaterloo.ca';

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

    if (!this.fields.has('ICSID') || !this.field('SSR_CLSRCH_WRK_SUBJECT')) {
      throw new Stale('quest did not return the class search page');
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

  query(q) {
    const fields = new Map(this.fields);
    fields.set('ICAction', 'CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH');
    fields.set(this.field('CLASS_SRCH_WRK2_STRM'), q.term);
    fields.set(this.field('SSR_CLSRCH_WRK_SUBJECT'), q.subject);
    fields.set(this.field('SSR_CLSRCH_WRK_SSR_EXACT_MATCH1'), 'E');
    fields.set(this.field('SSR_CLSRCH_WRK_CATALOG_NBR'), q.catalog);

    let body = 'ICAJAX=1&ICNAVTYPEDROPDOWN=0';
    for (const [name, value] of fields) {
      body += `&${name}=${encodeURIComponent(value)}`;
    }
    return body;
  }
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

  const cell = (id, n) => {
    const m = xml.match(new RegExp(`id='${id}\\$${n}'[^>]*>([\\s\\S]*?)</(span|a)>`));
    if (!m) {
      return null;
    }
    return m[1].split(/<br \/>|,/)
      .map((s) => s.replace(/&nbsp;/g, ' ').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').trim())
      .filter((s) => s && s !== 'TBA' && s !== 'To be Announced');
  };

  const sections = [];
  for (let n = 0; cell('MTG_CLASS_NBR', n); n++) {
    const status = xml.match(new RegExp(`divDERIVED_CLSRCH_SSR_STATUS_LONG\\$${n}'[\\s\\S]{0,400}?alt="([^"]*)"`));
    sections.push({
      classNumber: cell('MTG_CLASS_NBR', n)[0],
      instructors: [...new Set(cell('MTG_INSTR', n))],
      rooms: [...new Set(cell('MTG_ROOM', n))],
      status: status ? status[1] : '',
    });
  }
  if (sections.length === 0) {
    throw new Stale('quest returned an unexpected page');
  }

  const m = xml.match(/\| (Winter|Spring|Fall) 20(\d\d)</);
  const term = m ? `1${m[2]}${{ Winter: 1, Spring: 5, Fall: 9 }[m[1]]}` : null;
  return { term, sections };
}

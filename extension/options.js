'use strict';

const api = globalThis.browser ?? chrome;

// everything is on unless turned off here, except compact
const FLAGS = [
  ['questCompact', 'Compact mode', 'Tighter spacing.'],
  ['questSearch', 'Class search', 'Replaces Quest’s class search.'],
  ['questSuggest', 'Autocomplete', 'Courses, subjects and instructors from UW Flow.'],
  ['questRatings', 'Ratings and enrolment', 'Course and instructor ratings, and daily enrolment, from UW Flow.'],
  ['questCourseInfo', 'Course details', 'Requisites, Leads To and reviews from UW Flow.'],
  ['questHistory', 'Teaching history', 'An instructor’s courses over the last six terms. One Quest search per term.'],
  ['questDetail', 'Live enrolment', 'Click enrolment for Quest’s live seats, waitlist and notes.'],
  ['questRemember', 'Remember last search', 'Restores the last search and filters.'],
  ['uwflowColumns', 'Quest columns on UW Flow', 'Instructor, room and status in UW Flow course schedules.'],
];

let flags = {};

function render() {
  const rows = FLAGS.map(([name, what, why]) => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = name === 'questCompact' ? flags[name] === true : flags[name] !== false;
    input.onchange = () => {
      flags[name] = input.checked;
      api.storage.local.set({ flags });
    };

    const text = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'what';
    title.textContent = what;
    const note = document.createElement('div');
    note.className = 'why';
    note.textContent = why;
    text.append(title, note);

    const label = document.createElement('label');
    label.append(input, text);
    return label;
  });
  document.getElementById('flags').replaceChildren(...rows);
}

function done(text) {
  document.getElementById('done').textContent = text;
}

document.getElementById('reset').onclick = async () => {
  flags = {};
  await api.storage.local.set({ flags });
  render();
  done('Reset.');
};

document.getElementById('forget').onclick = async () => {
  const all = await api.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith('c:') || key.startsWith('r:') || key === 'lastSearch' || key === 'flowIndex');
  await api.storage.local.remove(keys);
  done(`Cleared ${keys.length} ${keys.length === 1 ? 'item' : 'items'}.`);
};

api.storage.local.get('flags').then((stored) => {
  flags = stored.flags || {};
  render();
});

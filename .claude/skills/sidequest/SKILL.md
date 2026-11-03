---
name: sidequest
description: Reference for working on UW Sidequest, the browser extension that adds Quest instructor/room/status to uwflow. Covers how UW Quest (PeopleSoft) and uwflow actually behave, the extension's architecture, release process, and the owner's code style (Go-like, concise, few comments). Use before changing anything in extension/, debugging Quest requests, or cutting a release.
---

# UW Sidequest

Adds Instructor, Room and Status columns from UW Quest to the course schedule table on uwflow.com,
and replaces Quest's class search page with its own, using the user's own signed-in Quest session.
Chrome and Firefox from one MV3 manifest.

## Code style

The owner writes Go and wants the JavaScript to read like their Go.

- Flat files in `extension/`, plain functions, a few small classes used like structs with methods.
- Early returns, braces on every `if`, no clever one-liners.
- No IIFEs, closures-as-modules, layers of tiny helpers, `lib/` folders or "just in case" parsing.
- Don't add abstractions, options or features that weren't asked for.
- No tests or fixtures. This code is tested by hand in real browsers against real Quest. Don't
  add test scaffolding unasked.

Comments should be rare and sound like the owner wrote them:

- Aim for roughly one comment per 50 lines.
- Write short lowercase one-liners with no trailing period, and only where the reason isn't in
  the code: `// a signed out quest redirects to the login server, which fetch can't follow`
- No doc comments on self-explanatory functions or classes.
- No banners, section dividers, file headers, or comments that restate the code.
- One longer block is fine for genuinely reverse-engineered behaviour, like the PeopleSoft note
  at the top of `quest.js`.
- When unsure, read `~/code/doc/godocs/parse.go` for the feel.

Formatting:

- Keep each file's existing formatting. `questpage.js` and `uwflow.js` use tabs and double
  quotes; the other JS files use 2-space indent and single quotes.
- `manifest.json` uses tabs.
- Use `const api = globalThis.browser ?? chrome;` for cross-browser APIs.

Commits use short conventional prefixes, e.g. `feat: ...`, `chore: ...`.

## Files

| File | What it does |
|---|---|
| `quest.js` | DOM-free request and parsing functions shared by the background and Quest page. `fetchQuest` handles timeouts, network failures and HTTP status. `queryQuest` changes listed terms, submits the search, answers the over-100 prompt and validates the returned term. `Form` parses the page's `win<n>` form and builds the POST. Also contains the result/detail parsers, term helpers and errors. |
| `background.js` | Uses its own fetch for the default non-private session, or relays through one Quest tab for the whole search. State blocks, caches and sign-in openers are scoped by container/private context; relay blocks also include the tab id. Searches are serialized by `queue`, throttled to 40 per 5 min using `storage.session`, and cached for 1 h under `c:scope:subject\|catalog\|term`; entries older than 30 days are pruned on startup. Messages: `cached`, `refresh`, `signin`, `page`, `options`, `context`. |
| `questtab.js` | Every Quest frame reports sign-in and its path, so iframe pages can teach the background the site. Only the top frame relays fetches, restricted to `/psc/` on its own origin. It declares the `api` that `questsearch.js` uses. |
| `questsearch.js` | Search state, requests, and turning text into targets. Uses the shared Quest request sequence in its own state block. Search answers are kept for 30 minutes under container-scoped `r:` keys, pruned on page open. Class detail fetches fresh on opening or refreshing and validates the selected class first. Levels share their subject's search. Prof searches try name words as surnames and match full names regardless of order; history covers the configured terms. Obsolete queued searches are skipped. Ratings and the suggestion index come from UW Flow's GraphQL. |
| `questpage.js` / `questsearch.css` | The page side: on Quest's class search page (`/psc/…/UW_CEM.UW_CLASS_SRCH.GBL`, any frame) it hides Quest's page and draws the search, suggestions, results and teaching history. "Use the original Quest page" sets `sessionStorage['sidequest-original']`. The Quest scripts share one scope: `quest.js`, `questtab.js` (declares `api`), `questsearch.js`, `questpage.js`, in that order. |
| `options.html` / `options.js` | Flags live in `storage.local.flags`; missing means on except `questCompact`. Options and open Quest pages listen for changes. `flags.termCount` defaults to 6 and includes the current term. `lastSearch` stores targets, term and filters; URL hashes also preserve target types. |
| `uwflow.js` / `uwflow.css` | Loads sections from GraphQL, reads the selected schedule tab and validates its class numbers before adding Quest data. If the tab cannot be read, only an unambiguous class-number match is accepted. Failures show a retry action. CSS classes are prefixed `sq-`. |

Manifest notes:

- `background` has both `service_worker` (Chrome) and `scripts` (Firefox). `background.js` uses
  `importScripts('quest.js')` only when that function exists.
- Permissions are just `storage` plus the Quest host. The owner wants minimal permissions:
  no `cookies`, no `tabHide`.
- Gecko id is `sidequest@hamza.sh`, minimum Firefox 140, with `data_collection_permissions`
  `websiteContent`.

## Quest / PeopleSoft (verified on real Quest, 2026-10)

The site is learned, never guessed:

- Quest's PeopleSoft site is currently `SS`. Older code assumed `AS`.
- A request to the wrong site bounces through login and **signs the user out**.
- So the site is learned from a signed-in Quest tab (`page` message → `storage.local.site`). With
  no site known, the extension treats the user as signed out.

Each search runs in its own state block:

- PeopleSoft keeps component state per state block, chosen by the URL's site segment.
  `/psc/SS_newwin/...` allocates a fresh block and 302s to `/psc/SS_<n>/...`. The user's own
  Quest tabs (the shared `/psc/SS/` block) are never disturbed.
- In block n the form is `win<n>` with hidden `ICElementNum=<n>`. Build the POST from the page's
  own form fields. Hard-coding `ICElementNum=0` hits the main window → "This page is no longer
  available".
- Field names carry a render suffix like `$35$` that changes between renders. Look them up by
  prefix (`Form.field`).

How a search goes:

1. GET the search entry page in the block. Re-GETting it resets the block for the next search;
   six in a row worked.
2. For a different listed term, the extension changes the term in its own round trip, then
   submits `ICAction=CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH` with STRM, subject, exact-match `E`
   and catalog number. All callers use the same sequence and validate the answer's term.
3. If you get the wrong page (`Stale`), drop the block and retry once with a fresh `_newwin`.

Term codes look like `1` + 2-digit year + month: Winter = 1, Spring = 5, Fall = 9. So Fall 2026
is `1269`.

Result HTML has stable ids, indexed by section n:

- `MTG_CLASS_NBR$n`
- `MTG_CLASSNAME$n` ("001-LEC ⏎ Regular")
- `MTG_DAYTIME$n`
- `MTG_ROOM$n`
- `MTG_INSTR$n`
- `MTG_TOPIC$n` (dates)
- `win0divDERIVED_CLSRCH_SSR_STATUS_LONG$n`, where the status is the img `alt`

Don't parse times or dates out of the results. Their format follows the browser's locale: Chrome
gave `8:30AM - 9:50AM` and `09/09/2026`, while a Firefox capture had `08:30 - 09:20` and ISO
dates. Unassigned values show as "To be Announced" (instructor) or "TBA" (room); filter them out.
The leading day letters (`MoWeFr`, `TuTh`) were the same in both, so `questpage.js` splits
those off and keeps the time text as is. Test slots show their date as month and day, read from
either `MM/DD/YYYY` or `YYYY-MM-DD`; other sections show no dates.

What the search page offers (probed 2026-10-03 with a throwaway extension page, since deleted):

- The term dropdown only lists about a year back (Winter 2026 to Winter 2027 in 2026-10), but a
  POST with an older STRM works too (Fall 2025 confirmed). Past terms still list instructors. Check
  the term on the results page against the one asked for, in case Quest ever ignores it.
- Criteria besides subject and catalog: `SSR_CLSRCH_WRK_LAST_NAME` with `SSR_EXACT_MATCH2`
  (B begins, C contains, E exact), `CLASS_NBR`, `DESCR` (title), `ACAD_CAREER`, `SSR_COMPONENT`,
  `SESSION_CODE`, `CAMPUS`, `LOCATION`, days, start and end times, units. `SSR_EXACT_MATCH1` on the
  catalog also takes C contains, G >=, T <=. Open-only is the hidden `SSR_OPEN_ONLY$chk` (N by default).
- Quest wants two criteria besides the term. Subject alone, or instructor alone, gives
  `DERIVED_CLSMSG_ERROR_TEXT` "Specify additional selection criteria to narrow your search."
  Subject + instructor works, and so does instructor + `ACAD_CAREER=UG` (one request, ~0.7 s, past
  terms too). Instructor search is by surname, so "Smith" mixes several profs; filter on the
  `MTG_INSTR` full name.
- Over 100 classes returns a "would you like to continue?" page instead. POST `ICAction=#ICSave` to
  get the results. Subject + `SSR_EXACT_MATCH1=G` + catalog `0` returns the whole subject: Fall 2026
  CS was 299 sections in 80 courses, 2 MB of HTML, 27 s (MATH 283 sections, 22 s; CS lectures only
  163 sections, 10 s). The CS run reached CS 889, so it didn't look truncated.
- Course headings read "CS  246 - …", with two spaces.
- Results are grouped by course. Each group's collapse img alt is "CS 246 - Object-Oriented
  Software Development …", and `MTG_*$n` keeps counting across groups.
- Results carry status only, no counts. POSTing `ICAction=MTG_CLASSNAME$n` from the results opens the
  class detail: capacity, enrolled, waitlist, reserve caps, notes, prereq text, components.
- Changing the term is a server round trip (`ICAction` = the term select's id) that clears subject
  and catalog. This is Quest's "changing term wipes my fields".
- Plain `ICAJAX=0` POSTs return full pages, which carry the next form.

Sessions and cookies:

- In Chrome, a plain `fetch(credentials: 'include')` from the background, an extension page, or a
  Quest content script all reach the signed-in session with only the host permission. No cookie
  injection is needed.
- Signed out, Quest redirects to the login server. Fetch can't follow that redirect, so a network
  error from `direct` means signed out unless it was a timeout or the browser is offline.
- In a Firefox container the background's fetch has no cookies, but a Quest tab in that container
  does, so `relay` goes through it.
- After sign-in the user is sent back to uwflow. The Quest tab is closed only if `direct` can
  reach the session; otherwise it stays open as the relay. The owner is fine with it staying open.
- The sign-in tab is opened with `window.open` from uwflow so it inherits the Firefox container.

## uwflow

- uwflow has a public GraphQL API at `POST https://uwflow.com/graphql` with no auth. It returns
  `course.sections{term_id class_number section_name meetings{...}}`.
- Its prof field is null and its location is junk now, which is why this extension exists.
- Because of that, `prof_teaches_course` and `prof_search_index.course_codes` are empty (checked 2026-10
  on cs246 and a few profs). The only prof↔course link left is `review{course_id prof_id}`. Reviews,
  ratings and `prof.code` are public to anonymous. Schema: `hasura/metadata/databases/default/tables`
  in github.com/UWFlow/uwflow.
- Term tabs are sorted newest first, and all of them render through one table component.
  React reuses row DOM nodes when the tab changes, so injected cells survive the switch. Redo
  every row on each render and match by term + class number, never by section label. This caused
  the old "current prof shown on a TBA future term" bug.

## Release

1. Bump `version` in `extension/manifest.json`.
2. Update the download links in `README.md`.
3. Commit, then tag and push the tag:
   ```sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
4. CI submits the version to AMO's listed channel after creating the GitHub release. For a
   manual submission, `./amo.sh` reads credentials from the gitignored `.env` and uses the same
   pinned web-ext version and metadata. Use one submission path per version.

`.github/workflows/release.yml` then:

- checks that the tag matches the manifest version,
- zips `extension/` for Chrome,
- creates the GitHub release with the zip,
- submits the listed Firefox version using the repository's AMO secrets.

Firefox users install from https://addons.mozilla.org/firefox/addon/uw-sidequest/. Versions up to
0.2.1 were unlisted .xpi files on GitHub releases.

Things to know:

- Mozilla never signs the same version twice, so a failed or repeated run needs a version bump.
- Listed versions go through AMO review before they're public. `--approval-timeout=0` only submits.
- The Chrome Web Store needs the 128px icon (`extension/icons/sidequest-128.png`), a privacy
  policy URL, 1280×800 or 640×400 screenshots, and justifications for the permissions.
- Never write the AMO credentials anywhere tracked; they live only in `.env`.

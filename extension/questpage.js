"use strict";

const ORIGINAL = "sidequest-original";
const EXTRA = ["TUT", "LAB", "TST", "TLC"];
const DAYS = [
	["Mo", "M"],
	["Tu", "T"],
	["We", "W"],
	["Th", "Th"],
	["Fr", "F"],
	["Sa", "S"],
	["Su", "Su"],
];

const WIDE = matchMedia("(min-width: 1480px)");

const checks = {};
const unfolded = new Set();

let terms = [];
let listed = [];
let picks = [];
let active = -1;
let ui = null;

function add(target) {
	if (!state.items.some((item) => item.label === target.label)) {
		state.items.push(target);
	}
	state.query = "";
	closePicks();
	render();
}

function closePicks() {
	picks = [];
	active = -1;
	if (ui) {
		renderPicks();
	}
}

function visible(s) {
	if (state.hideClosed && s.status !== "Open") {
		return false;
	}
	if (state.hideExtra && EXTRA.includes(s.section.split("-")[1])) {
		return false;
	}
	if (state.hideGrad && Number.parseInt(s.course.split(" ")[1], 10) >= 600) {
		return false;
	}
	return true;
}

// a meeting is like "TuTh 10:00AM - 11:20AM", the time part follows the browser's locale
function meeting(text) {
	const m = text.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)+)\s+(.*)$/);
	if (!m) {
		return { days: [], time: text };
	}
	return { days: m[1].match(/../g), time: m[2] };
}

// course codes in uwflow's requisite text, like CS136L or MATH 135, become searches
function linkCodes(text) {
	const nodes = [];
	let at = 0;
	for (const m of text.matchAll(/\b([A-Z]{2,7}) ?(\d{3}[A-Z]?)\b/g)) {
		nodes.push(text.slice(at, m.index));
		nodes.push(courseLink(m[1] + m[2], `${m[1]} ${m[2]}`));
		at = m.index + m[0].length;
	}
	nodes.push(text.slice(at));
	return nodes;
}

function courseLink(code, label) {
	const node = button("sq-code-link", label, (event) =>
		goTo(code, event.shiftKey),
	);
	node.title = "Shift-click to add to search";
	return node;
}

// shift adds the course to the search instead of replacing it
function goTo(code, add) {
	const target = courseTarget(code.toLowerCase());
	if (!add) {
		state.items = [];
		state.drawer = null;
		state.panel = false;
		window.scrollTo({ top: 0, behavior: "smooth" });
	}
	if (!state.items.some((item) => item.label === target.label)) {
		state.items.push(target);
	}
	state.query = "";
	run();
}

function openDrawer(code) {
	state.drawer = code;
	state.panel = true;
	render();
}

// on a wide screen the panel sits beside the results and shows the first course
// until another is picked, otherwise it only slides in when asked for
// quest only lists about a year back but answers for older terms too
function buildTerms() {
	const now = currentTerm();
	terms = recentTerms(termCount())
		.reverse()
		.map((code) => ({ code, old: !listed.includes(code) }));
	for (const code of listed.filter((code) => code > now)) {
		terms.push({ code, old: false });
	}
}

function beside() {
	return WIDE.matches && on("questSidebar");
}

function panelCode() {
	if (state.status !== "ok" || !on("questCourseInfo")) {
		return null;
	}
	const codes = [
		...new Set(state.sections.filter(visible).map((s) => flowCode(s.course))),
	].filter((code) => flowCourses.has(code));
	if (codes.length === 0 || (!beside() && !state.panel)) {
		return null;
	}
	if (codes.includes(state.drawer)) {
		return state.drawer;
	}
	return beside() ? codes[0] : null;
}

function renderDrawer() {
	const code = panelCode();
	ui.drawer.hidden = code === null;
	ui.layout.classList.toggle("sq-with-panel", code !== null && beside());
	if (code === null) {
		ui.drawer.replaceChildren();
		return;
	}
	if (on("questReviews")) {
		loadReviews(code);
	}
	const flow = flowCourses.get(code);

	const close = button("sq-close", "×", () => {
		state.panel = false;
		render();
	});
	close.setAttribute("aria-label", "Close");

	const desc = el("p", "sq-desc", flow.description || "");
	desc.onclick = () => desc.classList.toggle("sq-open-desc");

	const parts = [
		el(
			"div",
			"sq-panel-head",
			el(
				"div",
				"",
				el("div", "sq-panel-code", courseTarget(flow.code).label),
				el("div", "sq-panel-name", flow.name),
			),
			close,
		),
		on("questReviews") && meters(flow),
		flow.description && desc,
		panelPart(
			"Prerequisites",
			flow.prereqs
				? el("p", "", ...linkCodes(flow.prereqs))
				: el("p", "sq-none", "None"),
		),
	];
	if (flow.coreqs) {
		parts.push(panelPart("Corequisites", el("p", "", ...linkCodes(flow.coreqs))));
	}
	if (flow.antireqs) {
		parts.push(
			panelPart("Antirequisites", el("p", "", ...linkCodes(flow.antireqs))),
		);
	}

	const leads = flow.postrequisites.filter((p) => p.postrequisite);
	if (leads.length > 0) {
		parts.push(
			panelPart(
				`Leads To · ${leads.length}`,
				el(
					"div",
					"sq-leads",
					...leads.map((p) =>
						el(
							"div",
							"sq-lead",
							courseLink(
								p.postrequisite.code,
								courseTarget(p.postrequisite.code).label,
							),
							el("span", "sq-lead-name", p.postrequisite.name),
						),
					),
				),
			),
		);
	}

	if (on("questReviews")) {
		parts.push(
			panelPart("Reviews", ...reviews(flow.code)),
			link("sq-link", "All reviews ›", `${FLOW}/course/${flow.code}`),
		);
	}
	ui.drawer.replaceChildren(...parts.filter(Boolean));
}

function panelPart(name, ...body) {
	return el("section", "sq-block", el("h3", "", name), ...body);
}

function meters(flow) {
	const r = flow.rating;
	if (!r || !r.filled_count) {
		return el("p", "sq-none", "No ratings");
	}
	return el(
		"div",
		"sq-meters",
		meter("Liked", r.liked),
		meter("Easy", r.easy),
		meter("Useful", r.useful),
		el("span", "sq-none", `${r.filled_count} ratings`),
	);
}

function meter(name, value) {
	const pct = Math.round(value * 100) + "%";
	const fill = el("span", "sq-fill");
	fill.style.width = pct;
	return el(
		"div",
		"sq-meter",
		el("span", "", name),
		el("span", "sq-track", fill),
		el("span", "sq-pct", pct),
	);
}

function reviews(code) {
	const entry = flowReviews.get(code);
	if (!entry || entry.state === "loading") {
		return [el("p", "sq-none", "Loading…")];
	}
	if (entry.state === "error" || entry.list.length === 0) {
		return [el("p", "sq-none", "No reviews")];
	}
	return entry.list.map((r) => {
		const when = new Date(r.created_at).toLocaleDateString(undefined, {
			month: "short",
			year: "numeric",
		});
		const meta = el("div", "sq-review-meta");
		if (r.liked === 1) {
			meta.append(el("span", "sq-liked", "Liked"), " · ");
		} else if (r.liked === 0) {
			meta.append(el("span", "sq-disliked", "Disliked"), " · ");
		}
		meta.append(r.prof ? `${when} · ${r.prof.name}` : when);

		const text = el("p", "sq-review-text", r.course_comment);
		text.onclick = () => text.classList.toggle("sq-open-desc");
		return el("div", "sq-review", text, meta);
	});
}

// quest writes dates in the browser's locale, 11/04/2025 in chrome and 2025-11-04 in firefox
function shortDates(text) {
	const days = [];
	for (const m of text.matchAll(
		/(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/\d{4}/g,
	)) {
		const month = Number(m[2] || m[4]);
		const day = Number(m[3] || m[5]);
		const date = new Date(2000, month - 1, day);
		days.push(
			date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
		);
	}
	return [...new Set(days)].join(" – ");
}

function liked(rating) {
	if (!rating || !rating.filled_count) {
		return "";
	}
	return Math.round(rating.liked * 100) + "%";
}

function el(tag, className, ...children) {
	const node = document.createElement(tag);
	node.className = className;
	node.append(
		...children.filter((c) => c !== null && c !== undefined && c !== false),
	);
	return node;
}

function button(className, text, onclick) {
	const node = el("button", className, text);
	node.type = "button";
	node.onclick = onclick;
	return node;
}

function link(className, text, href) {
	const node = el("a", className, text);
	node.href = href;
	node.target = "_blank";
	node.rel = "noopener";
	return node;
}

function checkbox(label, key) {
	const input = document.createElement("input");
	input.type = "checkbox";
	input.checked = state[key];
	checks[key] = input;
	input.onchange = () => {
		state[key] = input.checked;
		save();
		render();
	};
	return el("label", "sq-check", input, label);
}

function shell() {
	const input = document.createElement("input");
	input.type = "text";
	input.className = "sq-query";
	input.setAttribute("aria-label", "Search");
	input.setAttribute("role", "combobox");
	input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-controls", "sq-picks");
	input.setAttribute("aria-expanded", "false");
	input.autocomplete = "off";
	input.spellcheck = false;
	input.oninput = () => {
		// a typed or pasted comma turns everything before it into tags
		if (input.value.includes(",")) {
			const parts = input.value.split(",");
			const rest = parts.pop();
			const typed = parts.filter((part) => part.trim()).map(resolve);
			if (!typed.includes(null)) {
				state.items.push(...typed);
				input.value = rest.trimStart();
				render();
			}
		}
		state.query = input.value;
		picks = on("questSuggest") ? suggest(input.value) : [];
		active = -1;
		renderPicks();
	};
	input.onkeydown = (event) => {
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (picks.length === 0) {
				return;
			}
			event.preventDefault();
			const step = event.key === "ArrowDown" ? 1 : -1;
			active = ((active + step + picks.length + 2) % (picks.length + 1)) - 1;
			renderPicks();
			return;
		}
		if (event.key === "Enter" && active >= 0) {
			event.preventDefault();
			add(picks[active]);
			return;
		}
		if ((event.key === "Tab" || event.key === ",") && picks.length > 0) {
			event.preventDefault();
			add(picks[Math.max(active, 0)]);
			return;
		}
		if (event.key === "Backspace" && input.value === "" && state.items.length > 0) {
			state.items.pop();
			render();
			return;
		}
		if (event.key === "Escape") {
			closePicks();
		}
	};
	input.onblur = closePicks;

	const list = el("ul", "sq-picks");
	list.id = "sq-picks";
	list.setAttribute("role", "listbox");

	const form = el("form", "sq-card sq-form");
	form.onsubmit = (event) => {
		event.preventDefault();
		run();
	};

	ui = {
		input,
		list,
		tags: el("span", "sq-tags"),
		drawer: el("aside", "sq-drawer"),
		layout: el("div", "sq-layout"),
		terms: el("div", "sq-terms"),
		results: el("div", "sq-results"),
	};
	ui.terms.setAttribute("role", "group");
	ui.terms.setAttribute("aria-label", "Term");

	ui.layout.append(el("main", "sq-main", form, ui.results), ui.drawer);

	const submit = el("button", "sq-go", "Search");
	submit.type = "submit";

	const filters = el(
		"fieldset",
		"sq-filters",
		el("legend", "sq-legend", "Hide"),
		checkbox("Closed", "hideClosed"),
		checkbox("TUT, LAB, TST", "hideExtra"),
		checkbox("Graduate", "hideGrad"),
	);

	form.append(
		ui.terms,
		el("div", "sq-line", el("div", "sq-box", ui.tags, input, list), submit),
		filters,
	);

	const original = button("sq-link", "Original page", () => {
		sessionStorage.setItem(ORIGINAL, "1");
		location.reload();
	});
	const settings = button("sq-link", "Settings", () =>
		api.runtime.sendMessage({ type: "options" }),
	);

	return el(
		"div",
		"",
		el(
			"header",
			"sq-top",
			el(
				"div",
				"sq-bar",
				el("span", "sq-brand", "Sidequest"),
				el("span", "sq-crumb", "v" + api.runtime.getManifest().version),
				link("sq-link", "GitHub", "https://github.com/hhhapz/sidequest"),
				el("span", "sq-gap"),
				settings,
				original,
			),
		),
		ui.layout,
	);
}

function renderPicks() {
	const names = {
		course: "Course",
		subject: "Subject",
		level: "Level",
		prof: "Instructor",
	};
	ui.list.replaceChildren(
		...picks.map((pick, i) => {
			const item = el(
				"li",
				"sq-pick",
				el("span", "sq-pick-label", pick.label),
				el("span", "sq-pick-note", pick.note),
				el("span", "sq-pick-kind", names[pick.kind]),
			);
			item.id = "sq-pick-" + i;
			item.setAttribute("role", "option");
			item.setAttribute("aria-selected", i === active);
			item.onmousedown = (event) => event.preventDefault();
			item.onclick = () => add(pick);
			return item;
		}),
	);
	ui.list.hidden = picks.length === 0;
	ui.input.setAttribute("aria-expanded", picks.length > 0);
	if (active >= 0) {
		ui.input.setAttribute("aria-activedescendant", "sq-pick-" + active);
	} else {
		ui.input.removeAttribute("aria-activedescendant");
	}
}

function render() {
	ui.tags.replaceChildren(
		...state.items.map((item, i) => {
			const remove = button("sq-untag", "×", () => {
				state.items.splice(i, 1);
				render();
				ui.input.focus();
			});
			remove.setAttribute("aria-label", "Remove " + item.label);
			return el("span", "sq-tag", item.label, remove);
		}),
	);
	if (ui.input.value !== state.query) {
		ui.input.value = state.query;
	}
	ui.input.placeholder = "Courses, subjects, instructors (CS 246, MATH 239)";
	if (state.items.length > 0) {
		ui.input.placeholder = "Add another";
	} else if (!on("questSuggest")) {
		ui.input.placeholder = "Course, subject or instructor last name";
	}

	ui.terms.replaceChildren(
		...terms.map((t) => {
			const b = button(
				t.old ? "sq-term sq-old" : "sq-term",
				termName(t.code),
				() => {
					state.term = t.code;
					if (state.items.length > 0 || state.query.trim()) {
						run();
						return;
					}
					save();
					render();
				},
			);
			b.setAttribute("aria-pressed", t.code === state.term);
			return b;
		}),
	);
	if (terms.length > 0) {
		const count = document.createElement("select");
		count.className = "sq-count-terms";
		count.setAttribute("aria-label", "Terms shown");
		for (let n = 2; n <= 12; n++) {
			count.append(new Option(`${n} terms`, n));
		}
		count.value = termCount();
		count.onchange = () => {
			flags.termCount = Number(count.value);
			api.storage.local.set({ flags });
			buildTerms();
			render();
		};
		ui.terms.prepend(count);
	}
	renderPicks();
	ui.results.replaceChildren(...results());
	renderDrawer();
}

function results() {
	const termLabel = termName(state.term);

	if (state.status === "idle") {
		return [];
	}
	if (state.status === "loading") {
		const slow = state.whole
			? " Whole-subject searches can take up to 30 s."
			: "";
		return [
			el("div", "sq-card sq-wait", `Searching ${termLabel}…${slow}`),
		];
	}
	if (state.status === "signin") {
		return [
			el(
				"div",
				"sq-card sq-problem",
				"Signed out of Quest. ",
				button("sq-link", "Reload", () => location.reload()),
			),
		];
	}
	if (state.status === "error") {
		return [
			el(
				"div",
				"sq-card sq-problem",
				state.why + " ",
				button("sq-link", "Retry", run),
			),
		];
	}

	const total = state.sections.length;
	const shown = state.sections.filter(visible);
	let count = `${total} ${total === 1 ? "section" : "sections"}`;
	if (shown.length < total) {
		count = `${shown.length} of ${total} sections shown`;
	}
	const summary = el(
		"div",
		"sq-summary",
		el("h1", "", `${state.label} · ${termLabel}`),
		el("span", "sq-count", total === 0 ? "No results" : count),
		button("sq-link", "+ Compare", () => {
			ui.input.focus();
			ui.input.scrollIntoView({ block: "center", behavior: "smooth" });
		}),
	);

	const groups = new Map();
	for (const s of shown) {
		if (!groups.has(s.course)) {
			groups.set(s.course, { course: s.course, title: s.title, sections: [] });
		}
		groups.get(s.course).sections.push(s);
	}
	const cards = [...groups.values()].map(courseCard);
	return state.history
		? [historyCard(), summary, ...cards]
		: [summary, ...cards];
}

function historyCard() {
	const rows = state.history.map((entry) => {
		let what = el("span", "sq-none", "None");
		if (entry.state === "loading") {
			what = el("span", "sq-none", "Loading…");
		} else if (entry.state === "error") {
			what = el("span", "sq-none", entry.why);
		} else if (entry.sections.length > 0) {
			what = el("span", "sq-hist-courses", ...taughtCourses(entry));
		}
		const term = el(
			"span",
			entry.term === state.term ? "sq-hist-term sq-now" : "sq-hist-term",
			termName(entry.term),
		);
		return el("div", "sq-hist-row", term, what);
	});
	return el(
		"section",
		"sq-card sq-history",
		el("h2", "sq-hist-head", `${state.label} · teaching history`),
		...rows,
	);
}

// each course searches its sections in that term, a lecture goes without saying
function taughtCourses(entry) {
	const courses = new Map();
	for (const s of entry.sections) {
		if (!courses.has(s.course)) {
			courses.set(s.course, { title: s.title, components: new Set() });
		}
		courses.get(s.course).components.add(s.section.split("-")[1]);
	}

	return [...courses].map(([course, info]) => {
		const pick = button("sq-link sq-hist-course", course, (event) => {
			state.term = entry.term;
			goTo(flowCode(course), event.shiftKey);
		});
		pick.title = `${info.title} · Shift-click to add to search`;
		if (info.components.has("LEC")) {
			return pick;
		}
		return el("span", "", pick, el("span", "sq-none", " " + [...info.components].join(", ")));
	});
}

function courseCard(group) {
	const code = flowCode(group.course);
	const flow = flowCourses.get(code);
	const title = button("sq-course-title", "", () => openDrawer(code));
	title.append(
		el("h2", "sq-code", group.course),
		el("span", "sq-title", group.title),
	);
	title.disabled = !flow || !on("questCourseInfo");
	const head = el("div", "sq-head", title);
	if (on("questRatings")) {
		const text =
			flow && liked(flow.rating)
				? `${liked(flow.rating)} liked · ${flow.rating.filled_count} ratings`
				: "UW Flow";
		head.append(link("sq-flow", text, `${FLOW}/course/${code}`));
	}
	if (flow && on("questCourseInfo")) {
		head.append(button("sq-link sq-details", "Details ›", () => openDrawer(code)));
	}

	const weekend = group.sections.some((s) =>
		s.times.some((t) => /Sa|Su/.test(meeting(t).days.join(""))),
	);
	const week = weekend ? DAYS : DAYS.slice(0, 5);

	const enrolledLabel = el("span", "", "Enrolled");
	enrolledLabel.title =
		"From UW Flow, updated daily. Click for live enrolment from Quest.";

	const table = el(
		"div",
		"sq-table",
		el(
			"div",
			"sq-cols sq-labels",
			el("span", "", "Section"),
			el("span", "", "Class"),
			enrolledLabel,
			el("span", "", "Days"),
			el("span", "", "Time"),
			el("span", "", "Room"),
			el("span", "", "Instructor"),
			el("span", "", "Status"),
		),
	);

	// sections with no time, room or instructor yet fold into one line
	const empty = group.sections.filter(
		(s) =>
			s.times.length === 0 && s.rooms.length === 0 && s.instructors.length === 0,
	);
	const key = state.term + "|" + group.course;
	if (empty.length === group.sections.length || unfolded.has(key)) {
		table.append(...group.sections.map((s) => sectionRow(s, week)));
	} else {
		table.append(
			...group.sections
				.filter((s) => !empty.includes(s))
				.map((s) => sectionRow(s, week)),
		);
		if (empty.length > 0) {
			const names = empty.map((s) => s.section.split("-").reverse().join(" "));
			const more = button(
				"sq-more",
				`${empty.length} unscheduled (${names.join(", ")})`,
				() => {
					unfolded.add(key);
					render();
				},
			);
			table.append(more);
		}
	}
	return el(
		"section",
		code === panelCode() && beside() ? "sq-card sq-course sq-focus" : "sq-card sq-course",
		head,
		el("div", "sq-scroll", table),
	);
}

function sectionRow(s, week) {
	const key = state.term + "|" + s.classNumber;
	const open = state.open === key;

	const number = button("sq-nbr", s.classNumber, () => {
		navigator.clipboard.writeText(s.classNumber);
		number.textContent = "Copied";
		setTimeout(() => {
			number.textContent = s.classNumber;
		}, 1200);
	});
	number.title = "Copy";

	const [part, component] = s.section.split("-");
	const kind = { LEC: "lec", LAB: "lab", TUT: "tut" }[component] || "other";
	const section = el(
		"span",
		"sq-section",
		el("span", "sq-type sq-" + kind),
		`${component} ${part}`,
	);

	const days = el("span", "sq-lines");
	const times = el("span", "sq-lines");
	for (const [i, m] of s.times.map(meeting).entries()) {
		days.append(
			el(
				"span",
				"sq-days",
				...week.map(([code, letter]) =>
					el("span", m.days.includes(code) ? "sq-on" : "sq-off", letter),
				),
			),
		);
		// a test meets on one day, so each meeting gets its own date after the time
		const date = component === "TST" ? shortDates(s.dates[i] || s.dates[0] || "") : "";
		times.append(
			el(
				"span",
				"sq-time",
				el("span", "sq-keep", m.time),
				date && el("span", "sq-none sq-keep", " · " + date),
			),
		);
	}
	if (s.times.length === 0) {
		days.append(el("span", "sq-none", "TBA"));
	}

	const people = el("span", "sq-people");
	for (const name of s.instructors) {
		const flow = on("questRatings") && profRatings.get(nameKey(name));
		if (!flow) {
			people.append(el("span", "", name));
			continue;
		}
		people.append(
			el("span", "", link("", name, `${FLOW}/professor/${flow.code}`)),
		);
	}
	if (s.instructors.length === 0) {
		people.append(el("span", "sq-none", "TBA"));
	}

	const row = el(
		"div",
		"sq-row",
		el(
			"div",
			"sq-cols",
			section,
			number,
			enrolled(key, s),
			days,
			times,
			el("span", "", s.rooms.join(", ") || "TBA"),
			people,
			el(
				"span",
				"",
				el(
					"span",
					"sq-status sq-" + s.status.toLowerCase().replace(" ", ""),
					s.status,
				),
			),
		),
	);
	if (open) {
		row.append(detailView(details.get(key)));
	}
	return row;
}

// quest's live numbers once a class has been opened, uwflow's daily ones before that
function enrolled(key, s) {
	const entry = details.get(key);
	const seats =
		entry && entry.state === "ok"
			? entry.detail
			: on("questRatings") && flowSeats.get(key);

	let text = "—";
	let full = false;
	if (seats && seats.capacity !== null && seats.capacity !== undefined) {
		text = `${seats.enrolled}/${seats.capacity}`;
		full = seats.capacity > 0 && seats.enrolled >= seats.capacity;
	}
	if (!on("questDetail")) {
		return el("span", full ? "sq-full" : "", text);
	}

	const open = button(full ? "sq-seats sq-full" : "sq-seats", text, () =>
		toggleDetail(s),
	);
	open.title = "Live enrolment from Quest";
	open.setAttribute("aria-expanded", state.open === key);
	return open;
}

function detailView(entry) {
	if (entry.state === "loading") {
		return el(
			"div",
			"sq-detail sq-wait",
			"Loading…",
		);
	}
	if (entry.state === "error") {
		return el("div", "sq-detail sq-problem", entry.why);
	}

	const d = entry.detail;
	const stat = (label, value) =>
		el(
			"div",
			"sq-stat",
			el("div", "sq-stat-label", label),
			el("div", "sq-stat-value", value),
		);
	const view = el(
		"div",
		"sq-detail",
		el(
			"div",
			"sq-stats",
			stat("Enrolled", `${d.enrolled} / ${d.capacity}`),
			stat("Available", String(d.seats)),
			stat("Waitlist", `${d.waitTotal} / ${d.waitCapacity}`),
		),
	);
	if (d.requirements) {
		view.append(el("p", "sq-note", d.requirements));
	}
	if (d.notes) {
		view.append(el("p", "sq-note", d.notes));
	}
	return view;
}

function fromHash() {
	const params = new URLSearchParams(location.hash.slice(1));
	if (!params.get("q")) {
		return false;
	}
	state.items = [];
	state.query = params.get("q");
	if (/^1\d\d[159]$/.test(params.get("term"))) {
		state.term = params.get("term");
	}
	return true;
}

function showBack() {
	const back = button("sq-back", "Sidequest search", () => {
		sessionStorage.removeItem(ORIGINAL);
		location.reload();
	});
	document.body.append(back);
}

async function start() {
	site = (blockOf(location.pathname) || "").split("_")[0];
	if (!site) {
		return;
	}
	if (sessionStorage.getItem(ORIGINAL)) {
		showBack();
		return;
	}

	document.documentElement.classList.add("sq-take");
	const font = document.createElement("link");
	font.rel = "stylesheet";
	font.href =
		"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
	document.head.append(font);
	const root = shell();
	root.id = "sq-root";
	root.classList.toggle("sq-compact", flags.questCompact === true);
	document.body.append(root);
	api.storage.onChanged.addListener((changes) => {
		if (changes.flags) {
			const compact = (changes.flags.newValue || {}).questCompact === true;
			root.classList.toggle("sq-compact", compact);
		}
	});
	render();

	prune().catch((err) => console.warn("sidequest: prune", err));
	let indexed = Promise.resolve();
	if (on("questSuggest")) {
		indexed = loadIndex().catch((err) =>
			console.warn("sidequest: uwflow index", err),
		);
	}

	let page;
	try {
		page = (await queue(entry)).page;
	} catch (err) {
		state.status = err instanceof SignedOut ? "signin" : "error";
		state.why = err.message;
		render();
		return;
	}

	listed = termsOf(page);
	buildTerms();
	state.term = currentTerm();

	const stored = await api.storage.local.get("lastSearch");
	let again = restore(stored.lastSearch);
	if (fromHash()) {
		again = true;
	}
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && state.panel) {
			state.panel = false;
			render();
		}
	});
	WIDE.addEventListener("change", render);
	window.addEventListener("popstate", () => {
		if (fromHash()) {
			run();
		}
	});
	for (const key in checks) {
		checks[key].checked = state[key];
	}
	render();
	if (again) {
		// a name from the url is only known to be a prof once uwflow's list is in
		await indexed;
		run();
	}
}

// under /psp/ the classic page is in an iframe, which gets its own copy of this
if (/^\/psc\/.*\/UW_CEM\.UW_CLASS_SRCH\.GBL/.test(location.pathname)) {
	api.storage.local.get("flags").then((stored) => {
		flags = stored.flags || {};
		if (on("questSearch")) {
			start();
		}
	});
}

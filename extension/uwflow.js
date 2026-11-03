"use strict";

const api = globalThis.browser ?? chrome;

const QUEST = "https://quest.pecs.uwaterloo.ca";
const COLUMNS = ["Instructor", "Room", "Status"];

const SCHEDULE = '[class*="CourseSchedule__CourseScheduleWrapper"]';
const HEADING = '[class*="CollapsibleContainer__HeaderWrapper"]';
const HEADER_ROW = '[class*="Table__HeaderRow"]';
const HEADER_CELL = '[class*="Table__HeaderCell"]';
const HEADER_TEXT = '[class*="Table__HeaderText"]';
const ROW = '[class*="Table__TableRow"]';
const CELL = '[class*="Table__TableCell"]:not(.sq-col)';
const CELL_TEXT = '[class*="CourseSchedule__ContentWrapper"]';
const TABS = '[class*="TabContainer__TabsWrapper"]';

let course = null;
let path = null;
let site = null;
let panelOpen = false;
let enabled = false;

class Course {
	constructor(subject, catalog) {
		this.subject = subject;
		this.catalog = catalog;
		this.classes = new Map();
		this.terms = new Map();
		this.state = "loading";
		this.why = "";
	}

	async loadClasses() {
		if (this.busy) {
			return;
		}
		this.busy = true;
		this.state = "loading";
		render();
		try {
			const res = await fetch("/graphql", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query:
						"query($code: String) { course(where: { code: { _eq: $code } }) { sections { term_id class_number } } }",
					variables: { code: (this.subject + this.catalog).toLowerCase() },
				}),
				signal: AbortSignal.timeout(20000),
			});
			if (!res.ok) {
				throw new Error(`UW Flow returned HTTP ${res.status}`);
			}
			const body = await res.json();
			if (body.errors?.length || !body.data?.course?.[0]) {
				throw new Error(
					body.errors?.[0]?.message || "UW Flow did not return this course.",
				);
			}
			this.classes.clear();
			for (const section of body.data.course[0].sections) {
				const term = String(section.term_id);
				if (!this.classes.has(term)) {
					this.classes.set(term, new Set());
				}
				this.classes.get(term).add(String(section.class_number));
			}
			this.state = "ok";
		} catch (err) {
			this.state = "error";
			this.why =
				err.name === "TimeoutError" ? "UW Flow timed out." : err.message;
		} finally {
			this.busy = false;
			render();
		}
	}

	termOf(numbers, selected) {
		if (numbers.length === 0 || numbers.some((number) => !number)) {
			return null;
		}
		if (selected) {
			const classes = this.classes.get(selected);
			return classes && numbers.every((number) => classes.has(number))
				? selected
				: null;
		}
		let match = null;
		for (const [term, set] of this.classes) {
			if (numbers.every((number) => set.has(number))) {
				if (match) {
					return null;
				}
				match = term;
			}
		}
		return match;
	}

	ask(type, term) {
		return api.runtime
			.sendMessage({ type, subject: this.subject, catalog: this.catalog, term })
			.catch(() => ({
				state: "error",
				why: "extension was reloaded, refresh the page",
			}));
	}

	update(term, res) {
		const entry = {
			...this.terms.get(term),
			state: res.state,
			why: res.why,
			busy: false,
		};
		if (res.state === "ok") {
			entry.at = res.at;
			entry.sections = new Map(res.sections.map((s) => [s.classNumber, s]));
		}
		this.terms.set(term, entry);
		render();
	}

	async load(term) {
		this.terms.set(term, { state: "loading" });
		const hit = await this.ask("cached", term);
		if (hit.state === "ok") {
			this.update(term, hit);
			if (hit.fresh) {
				return;
			}
		}
		await this.refresh(term);
	}

	async refresh(term) {
		const entry = this.terms.get(term);
		if (!entry || entry.busy) {
			return;
		}
		entry.busy = true;
		render();
		this.update(term, await this.ask("refresh", term));
	}
}

function selectedTerm(table) {
	const tabs = table.querySelector(TABS);
	for (const tab of tabs ? tabs.querySelectorAll("button") : []) {
		if (getComputedStyle(tab).fontWeight !== "600") {
			continue;
		}
		const label = tab.textContent.match(/\b(Winter|Spring|Fall)\s+20(\d\d)\b/i);
		if (label) {
			const month = { winter: 1, spring: 5, fall: 9 }[label[1].toLowerCase()];
			return `1${label[2]}${month}`;
		}
	}
	return null;
}

function termLabel(term) {
	const season = { 1: "Winter", 5: "Spring", 9: "Fall" }[term[3]];
	return `${season} 20${term.slice(1, 3)}`;
}

function age(at) {
	const minutes = Math.round((Date.now() - at) / 60000);
	if (minutes < 2) {
		return "just now";
	}
	if (minutes < 90) {
		return `${minutes} min ago`;
	}
	return `${Math.round(minutes / 60)} h ago`;
}

// opened from here so the tab lands in the same firefox container
function openQuest() {
	api.runtime.sendMessage({ type: "signin" }).catch(() => {});
	const home = site
		? `/psc/${site}/ACADEMIC/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`
		: "";
	const tab = window.open(QUEST + home);
	if (tab) {
		tab.opener = null;
	}
}

function values(entry, number) {
	if (entry.state === "loading") {
		return ["…", "…", "…"];
	}
	const section = entry.sections && entry.sections.get(number);
	if (!section) {
		return ["—", "—", "—"];
	}
	return [
		section.instructors.join(", ") || "TBA",
		section.rooms.join(", ") || "TBA",
		section.status,
	];
}

function addHeader(table) {
	const row = table.querySelector(HEADER_ROW);
	if (!row || row.querySelector(".sq-col")) {
		return;
	}
	const template = row.querySelectorAll(HEADER_CELL)[1];
	if (!template) {
		return;
	}
	for (const name of COLUMNS) {
		const cell = template.cloneNode(true);
		cell.classList.add("sq-col");
		const text = cell.querySelector(HEADER_TEXT) || cell;
		text.textContent = name;
		text.style.pointerEvents = "none";
		row.append(cell);
	}
}

function fill(row, term, number, entry) {
	const cells = values(entry, number);
	const mark = [term, number, ...cells].join("|");
	if (row.dataset.sq === mark && row.querySelector(".sq-col")) {
		return;
	}
	const template = row.querySelectorAll(CELL)[1];
	if (!template) {
		return;
	}
	row.dataset.sq = mark;
	row.querySelectorAll(".sq-col").forEach((cell) => cell.remove());
	cells.forEach((value, i) => {
		const cell = template.cloneNode(true);
		cell.classList.add("sq-col");
		const text = cell.querySelector(CELL_TEXT) || cell;
		text.textContent = value;
		if (COLUMNS[i] === "Status") {
			text.classList.add("sq-" + value.toLowerCase().replace(" ", ""));
		}
		row.append(cell);
	});
}

function chipText(entry) {
	if (entry.state === "loading" || entry.busy) {
		return { dot: "load", word: "Loading…", line: "Loading…" };
	}
	const saved = entry.sections
		? `Cached ${age(entry.at)}.`
		: "";
	if (entry.state === "signin") {
		return {
			dot: "alert",
			word: "sign in",
			line: "Sign in to Quest to load instructors and rooms.",
			note: saved,
			button: "Open Quest",
		};
	}
	if (entry.state === "error") {
		return {
			dot: "alert",
			word: "retry",
			line: entry.why,
			note: saved,
			button: "Retry",
		};
	}
	const word = Date.now() - entry.at < 10 * 60 * 1000 ? "live" : "cached";
	return {
		dot: word,
		word,
		sub: age(entry.at),
		line: `From Quest, ${age(entry.at)}.`,
		button: "Refresh",
	};
}

function addChip(table, term, entry) {
	let chip = document.getElementById("sq-chip");
	if (!chip) {
		chip = document.createElement("button");
		chip.type = "button";
		chip.id = "sq-chip";
		chip.setAttribute("aria-controls", "sq-panel");
		chip.onclick = (event) => {
			event.stopPropagation();
			panelOpen = !panelOpen;
			render();
		};
	}
	const heading = table.querySelector(HEADING) || table;
	if (chip.parentElement !== heading) {
		heading.append(chip);
	}

	const text = chipText(entry);
	chip.classList.toggle("open", panelOpen);
	chip.setAttribute("aria-expanded", String(panelOpen));
	chip.replaceChildren(
		el("span", "sq-mark", "Sidequest"),
		el("span", "sq-dot " + text.dot),
		el(
			"span",
			"sq-status",
			el("span", "sq-word", text.word),
			el("span", "sq-sub", text.sub),
		),
		el("span", "sq-caret", "▾"),
	);

	let panel = document.getElementById("sq-panel");
	if (!panelOpen) {
		if (panel) {
			panel.remove();
		}
		return;
	}
	if (!panel) {
		panel = document.createElement("div");
		panel.id = "sq-panel";
		document.body.append(panel);
	}
	panel.replaceChildren(
		el(
			"div",
			"sq-head",
			el("span", "sq-mark", "Sidequest"),
			term && el("span", "term", "· " + termLabel(term)),
		),
		el("div", "sq-rule"),
		el(
			"div",
			"sq-line",
			el("span", "sq-dot " + text.dot),
			el("span", "", text.line),
		),
	);
	if (text.button) {
		const button = el("button", "sq-btn", text.button);
		button.onclick = () => {
			panelOpen = false;
			render();
			if (entry.state === "signin") {
				openQuest();
			} else if (!term) {
				course.loadClasses();
			} else {
				course.refresh(term);
			}
		};
		panel.append(el("div", "sq-actions", button));
	}
	if (text.note) {
		panel.append(el("div", "sq-note", text.note));
	}

	const box = chip.getBoundingClientRect();
	panel.style.top = `${box.bottom + 6}px`;
	panel.style.left = `${Math.max(8, box.right - panel.offsetWidth)}px`;
}

function el(tag, className, ...children) {
	const node = document.createElement(tag);
	node.className = className;
	node.append(...children.filter(Boolean));
	return node;
}

function clear() {
	document
		.querySelectorAll(".sq-col, #sq-chip, #sq-panel")
		.forEach((node) => node.remove());
	document
		.querySelectorAll("[data-sq]")
		.forEach((row) => row.removeAttribute("data-sq"));
}

// uwflow reuses rows when the term tab changes, so every row is redone each time
function render() {
	observer.disconnect();
	try {
		const table = enabled && course && document.querySelector(SCHEDULE);
		if (!table) {
			clear();
			return;
		}
		if (course.state !== "ok") {
			table.querySelectorAll(".sq-col").forEach((node) => node.remove());
			addChip(table, null, { state: course.state, why: course.why });
			return;
		}
		const rows = [];
		for (const row of table.querySelectorAll(ROW)) {
			const cells = row.querySelectorAll(CELL);
			if (cells.length > 1) {
				rows.push({
					row,
					number: (cells[1].textContent.match(/\d+/) || [])[0],
				});
			}
		}

		const term = course.termOf(
			rows.map((r) => r.number),
			selectedTerm(table),
		);
		if (!term) {
			clear();
			return;
		}
		if (!course.terms.has(term)) {
			course.load(term);
		}
		const entry = course.terms.get(term);
		addHeader(table);
		for (const row of rows) {
			fill(row.row, term, row.number, entry);
		}
		addChip(table, term, entry);
	} finally {
		if (enabled) {
			observer.observe(document.body, { childList: true, subtree: true });
			const tabs = document.querySelector(SCHEDULE + " " + TABS);
			if (tabs) {
				observer.observe(tabs, {
					attributes: true,
					subtree: true,
					attributeFilter: ["class", "style", "aria-selected"],
				});
			}
		}
	}
}

const observer = new MutationObserver(render);

const timer = setInterval(() => {
	if (!api.runtime.id) {
		clearInterval(timer);
		observer.disconnect();
		clear();
		return;
	}
	if (!enabled || location.pathname === path) {
		return;
	}
	path = location.pathname;
	panelOpen = false;

	const m = path.match(/^\/course\/([a-z]+)(\d+[a-z]*)\/?$/i);
	course = m ? new Course(m[1].toUpperCase(), m[2].toUpperCase()) : null;
	if (course) {
		course.loadClasses().catch(console.warn);
	}
	render();
}, 500);

function closePanel(event) {
	if (!panelOpen) {
		return;
	}
	if (
		event
			.composedPath()
			.some((node) => node.id === "sq-chip" || node.id === "sq-panel")
	) {
		return;
	}
	panelOpen = false;
	render();
}

document.addEventListener("click", closePanel);
window.addEventListener("scroll", closePanel, true);
window.addEventListener("resize", closePanel);

api.storage.local.get(["site", "flags"]).then((stored) => {
	site = stored.site || null;
	enabled = (stored.flags || {}).uwflowColumns !== false;
});

api.storage.onChanged.addListener((changes) => {
	if (changes.site) {
		site = changes.site.newValue;
	}
	if (changes.flags) {
		enabled = (changes.flags.newValue || {}).uwflowColumns !== false;
		if (!enabled) {
			course = null;
			path = null;
			render();
		}
	}
	if (changes.signedInAt && course) {
		for (const [term, entry] of course.terms) {
			if (entry.state !== "ok") {
				course.refresh(term);
			}
		}
	}
});

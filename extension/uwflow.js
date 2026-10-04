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
	}

	async loadClasses() {
		const res = await fetch("/graphql", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				query:
					"query($code: String) { course(where: { code: { _eq: $code } }) { sections { term_id class_number } } }",
				variables: { code: (this.subject + this.catalog).toLowerCase() },
			}),
		});
		const body = await res.json();
		for (const s of body.data.course[0].sections) {
			const term = String(s.term_id);
			if (!this.classes.has(term)) {
				this.classes.set(term, new Set());
			}
			this.classes.get(term).add(String(s.class_number));
		}
		render();
	}

	termOf(numbers) {
		let best = null;
		let most = 0;
		for (const [term, set] of this.classes) {
			const n = numbers.filter((number) => set.has(number)).length;
			if (n > most) {
				best = term;
				most = n;
			}
		}
		return best;
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
		this.terms.get(term).busy = true;
		render();
		this.update(term, await this.ask("refresh", term));
	}
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
	api.runtime.sendMessage({ type: "signin" });
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
	row.dataset.sq = mark;
	row.querySelectorAll(".sq-col").forEach((cell) => cell.remove());

	const template = row.querySelectorAll(CELL)[1];
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
			line: `Quest error: ${entry.why}.`,
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
		chip = document.createElement("span");
		chip.id = "sq-chip";
		chip.onclick = () => {
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
			el("span", "term", "· " + termLabel(term)),
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

	const table = course && document.querySelector(SCHEDULE);
	const rows = [];
	for (const row of table ? table.querySelectorAll(ROW) : []) {
		const cells = row.querySelectorAll(CELL);
		if (cells.length > 1) {
			rows.push({ row, number: (cells[1].textContent.match(/\d+/) || [])[0] });
		}
	}

	const term = course && course.termOf(rows.map((r) => r.number));
	if (!term) {
		clear();
	} else {
		if (!course.terms.has(term)) {
			course.load(term);
		}
		const entry = course.terms.get(term);
		addHeader(table);
		for (const r of rows) {
			fill(r.row, term, r.number, entry);
		}
		addChip(table, term, entry);
	}

	observer.observe(document.body, { childList: true, subtree: true });
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

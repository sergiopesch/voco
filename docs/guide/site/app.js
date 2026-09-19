import { node, journey, lab } from "./diagrams.js";
import { glossary } from "./glossary.js";
const content = document.querySelector("#content"),
  nav = document.querySelector("#chapters"),
  dialog = document.querySelector("#source-dialog"),
  sidebar = document.querySelector("#sidebar"),
  menu = document.querySelector("#menu-toggle");
const titles = [
  "The big picture",
  "Meet the languages",
  "Pressing the shortcut",
  "Listening to sound",
  "Audio on a conveyor belt",
  "The speech worker",
  "From sounds to words",
  "Words at the cursor",
  "Finishing at Stop",
  "Safe recovery",
  "Interface and settings",
  "Linux integration",
  "Privacy and security",
  "Performance and logs",
  "Testing the promises",
  "Building and shipping",
  "Borrowed libraries",
  "Reading the code",
  "TypeSafe and measured improvement",
];
let chapters = [],
  catalog,
  files = [],
  byPath = new Map(),
  dispose = () => {},
  done = new Set(),
  fileQuery = "",
  fileGroup = "All",
  visible = 80,
  sourceRequest = 0;
try {
  done = new Set(JSON.parse(localStorage.getItem("inside-voco-read") || "[]"));
} catch {
  /* Reading progress is optional; blocked storage must not stop study. */
}
function progress() {
  document.querySelector("#reading-progress").textContent =
    `${done.size} of ${chapters.length} chapters read`;
}
function renderNav(query = "") {
  nav.replaceChildren();
  const q = query.toLowerCase();
  chapters.forEach((ch, i) => {
    if (q && !`${ch.title} ${titles[i]} ${ch.intro}`.toLowerCase().includes(q))
      return;
    const a = node(
      "a",
      { href: "#" + ch.id },
      node("span", {}, done.has(ch.id) ? "✓" : String(i + 1).padStart(2, "0")),
      node("span", {}, titles[i]),
    );
    if (location.hash === "#" + ch.id || (!location.hash && i === 0))
      a.setAttribute("aria-current", "page");
    nav.append(a);
  });
  progress();
}
function closeRail() {
  sidebar.classList.remove("open");
  menu.setAttribute("aria-expanded", "false");
}
menu.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeRail();
});
document.querySelector("#search").addEventListener("input", (e) => {
  renderNav(e.target.value);
  fileQuery = e.target.value;
  document.querySelector("#file-count").textContent = matchingFiles().length;
});
document.querySelector("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    location.hash = "files";
    if (location.hash === "#files") renderFiles();
  }
});
async function openSource(path) {
  const request = ++sourceRequest;
  const f = byPath.get(path);
  if (!f) return;
  document.querySelector("#source-title").textContent = path;
  document.querySelector("#source-commit").textContent = catalog.commit.slice(
    0,
    12,
  );
  document.querySelector("#source-role").textContent =
    `${f.group}. ${f.role} ${f.bytes.toLocaleString()} bytes · Git blob ${f.blob.slice(0, 12)}.`;
  const body = document.querySelector("#source-body"),
    symbols = document.querySelector("#symbol-list>div");
  body.replaceChildren(node("span", {}, "Loading pinned source…"));
  symbols.replaceChildren();
  if (!dialog.open) dialog.showModal();
  document.querySelector("#symbol-list").open = false;
  document.querySelector("#symbol-list").hidden = !f.symbols.length;
  if (!f.text) {
    body.replaceChildren(
      node(
        "span",
        {},
        "Binary or large file. It is included in the complete catalog; this viewer does not decode it.",
      ),
    );
    return;
  }
  try {
    const response = await fetch(
      "/api/source?path=" + encodeURIComponent(path),
    );
    if (!response.ok)
      throw Error(
        "Source unavailable. Check that the local VOCO checkout contains the pinned commit.",
      );
    const data = await response.json();
    if (request !== sourceRequest) return;
    const fragment = document.createDocumentFragment();
    data.text
      .split("\n")
      .forEach((text, i) =>
        fragment.append(
          node(
            "div",
            { class: "code-line", id: "source-L" + (i + 1) },
            node(
              "span",
              { class: "line-no", "aria-hidden": "true" },
              String(i + 1),
            ),
            node("span", { class: "line-text" }, text),
          ),
        ),
      );
    body.replaceChildren(fragment);
    body.scrollTop = 0;
    body.scrollLeft = 0;
    for (const s of f.symbols)
      symbols.append(
        node(
          "button",
          {
            onclick: () => {
              body
                .querySelectorAll(".highlight")
                .forEach((n) => n.classList.remove("highlight"));
              const line = document.querySelector("#source-L" + s.line);
              line?.classList.add("highlight");
              line?.scrollIntoView({ block: "center" });
              document.querySelector("#symbol-list").open = false;
            },
          },
          `${s.name} · ${s.line}`,
        ),
      );
  } catch (error) {
    if (request === sourceRequest) body.textContent = error.message;
  }
}
document.querySelector("#close-source").addEventListener("click", () => {
  sourceRequest++;
  dialog.close();
});
dialog.addEventListener("cancel", () => sourceRequest++);
function renderChapter(ch) {
  content.replaceChildren(
    node("h1", {}, ch.title),
    node("p", { class: "intro" }, ch.intro),
  );
  const j = journey(ch);
  dispose = j.dispose;
  content.append(j.element);
  const story = node(
    "section",
    {},
    node("h2", {}, "The simple story"),
    ...ch.story.map((t) => node("p", {}, t)),
  );
  const links = node(
    "section",
    { class: "source-links" },
    node("h2", {}, "Find it in the code"),
    node("p", {}, ch.sourceNote || "Open the exact implementation of each part."),
  );
  for (const f of ch.files) {
    const b = node(
      "button",
      { title: f.why, onclick: () => openSource(f.path) },
      node("code", {}, f.path.split("/").pop()),
      node("span", {}, "Read code"),
    );
    links.append(b);
  }
  content.append(node("div", { class: "reading-grid" }, story, links));
  const facts = node(
    "section",
    { class: "facts" },
    node("h2", {}, "What really happens"),
  );
  for (const fact of ch.facts)
    facts.append(
      node(
        "article",
        { class: "fact" },
        node("h3", {}, fact.title),
        node("p", {}, fact.text),
      ),
    );
  content.append(facts);
  for (const comparison of ch.comparison ? [ch.comparison, ...(ch.comparison.additional || [])] : []) {
    const table = node("table", { class: "evaluation-table" },
      node("caption", {}, comparison.title),
      node("thead", {}, node("tr", {}, ...comparison.headers.map(text => node("th", { scope: "col" }, text)))),
      node("tbody", {}, ...comparison.rows.map(row => node("tr", {},
        node("th", { scope: "row" }, row[0]), ...row.slice(1).map(text => node("td", {}, text))))),
    );
    content.append(node("section", { class: "evaluation-comparison", "aria-label": "Measured before and after" },
      node("h2", {}, "Before and after the experiment"),
      node("p", {}, comparison.scope),
      node("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Comparison table, scroll horizontally on small screens" }, table),
      node("p", {}, comparison.decision),
      node("p", {}, comparison.limits)));
  }
  const interactive = lab(ch.lab);
  if (interactive) content.append(interactive);
  content.append(
    node(
      "p",
      { class: "boundary" },
      node("strong", {}, "Keep this distinction"),
      ch.caution,
    ),
  );
  const feedback = node("p", { id: "quiz-feedback", "aria-live": "polite" }),
    answers = node("div", { class: "answers" });
  ch.quiz.answers.forEach((answer, i) =>
    answers.append(
      node(
        "button",
        {
          onclick: (e) => {
            answers
              .querySelectorAll("button")
              .forEach((b) => b.classList.remove("selected"));
            e.currentTarget.classList.add("selected");
            feedback.textContent =
              (i === ch.quiz.correct ? "Exactly. " : "Try that idea again. ") +
              ch.quiz.why;
          },
        },
        answer,
      ),
    ),
  );
  content.append(
    node(
      "section",
      { class: "quiz" },
      node("h2", {}, "Check your understanding"),
      node("p", {}, ch.quiz.question),
      answers,
      feedback,
    ),
  );
  const index = chapters.indexOf(ch);
  const mark = node(
    "button",
    {
      onclick: () => {
        done.add(ch.id);
        try {
          localStorage.setItem("inside-voco-read", JSON.stringify([...done]));
        } catch {}
        mark.textContent = "Chapter marked as read";
        renderNav();
      },
    },
    done.has(ch.id) ? "Chapter marked as read" : "Mark chapter as read",
  );
  const end = node("div", { class: "chapter-end" }, mark);
  if (index < chapters.length - 1)
    end.append(
      node(
        "a",
        { href: "#" + chapters[index + 1].id },
        "Next: " + titles[index + 1],
      ),
    );
  else end.append(node("a", { href: "#files" }, "Explore all source files"));
  content.append(end);
}
function matchingFiles() {
  const q = fileQuery.toLowerCase();
  return files.filter(
    (f) =>
      (fileGroup === "All" || f.group === fileGroup) &&
      (!q ||
        `${f.path} ${f.group} ${f.symbols.map((s) => s.name).join(" ")}`
          .toLowerCase()
          .includes(q)),
  );
}
function renderFiles() {
  dispose();
  content.replaceChildren(
    node("h1", {}, "Every file has a place."),
    node(
      "p",
      { class: "intro" },
      `${catalog.fileCount.toLocaleString()} tracked files. One pinned snapshot. Explore the application, its tests, its tools and the libraries it borrows.`,
    ),
  );
  const input = node("input", {
    type: "search",
    placeholder: "Search paths, functions or types",
    "aria-label": "Search source files",
    value: fileQuery,
  });
  const select = node("select", { "aria-label": "Filter source group" });
  for (const group of ["All", ...new Set(files.map((f) => f.group))]) {
    const option = node("option", { value: group }, group);
    option.selected = group === fileGroup;
    select.append(option);
  }
  const count = node("p", { class: "catalog-note", "aria-live": "polite" }),
    list = node("ul", { class: "file-list" }),
    more = node(
      "button",
      {
        onclick: () => {
          visible += 80;
          draw();
        },
      },
      "Show more files",
    );
  function draw() {
    const found = matchingFiles();
    count.textContent = `${found.length.toLocaleString()} ${found.length === 1 ? "match" : "matches"} · Showing ${Math.min(visible, found.length)} · Snapshot ${catalog.commit.slice(0, 12)}`;
    list.replaceChildren(
      ...found
        .slice(0, visible)
        .map((f) =>
          node(
            "li",
            {},
            node(
              "button",
              { onclick: () => openSource(f.path) },
              node("span", { class: "file-path" }, f.path),
              node(
                "small",
                {},
                f.group +
                  " · " +
                  (f.lines
                    ? f.lines.toLocaleString() + " lines"
                    : f.bytes.toLocaleString() + " bytes"),
              ),
            ),
          ),
        ),
    );
    if (!found.length)
      list.append(
        node(
          "li",
          { class: "empty" },
          "No matching files. Try a shorter path or another group.",
        ),
      );
    more.hidden = visible >= found.length;
  }
  input.addEventListener("input", () => {
    fileQuery = input.value;
    visible = 80;
    draw();
  });
  select.addEventListener("change", () => {
    fileGroup = select.value;
    visible = 80;
    draw();
  });
  content.append(
    node("div", { class: "file-tools" }, input, select),
    count,
    list,
    more,
    node("p", { class: "boundary" }, catalog.scope),
  );
  draw();
}
function renderGlossary() {
  content.replaceChildren(
    node("h1", {}, "Small words for big ideas."),
    node(
      "p",
      { class: "intro" },
      "A plain-language dictionary for your trip through VOCO.",
    ),
  );
  const input = node("input", {
      type: "search",
      placeholder: "Find a term",
      "aria-label": "Search glossary",
    }),
    grid = node("div", { class: "glossary" });
  function draw() {
    const q = input.value.toLowerCase();
    const matches = glossary.filter(([a, b]) =>
      `${a} ${b}`.toLowerCase().includes(q),
    );
    grid.replaceChildren(
      ...matches.map(([term, definition]) =>
        node("article", {}, node("h2", {}, term), node("p", {}, definition)),
      ),
    );
    if (!matches.length)
      grid.append(node("p", { class: "empty" }, "No matching terms."));
  }
  input.addEventListener("input", draw);
  content.append(input, grid);
  draw();
}
function route() {
  dispose();
  dispose = () => {};
  closeRail();
  const id = location.hash.slice(1) || "big-picture";
  if (id === "files") renderFiles();
  else if (id === "glossary") renderGlossary();
  else renderChapter(chapters.find((c) => c.id === id) || chapters[0]);
  renderNav(document.querySelector("#search").value);
  document.title =
    (id === "files"
      ? "Source files"
      : id === "glossary"
        ? "Glossary"
        : (chapters.find((c) => c.id === id) || chapters[0]).title) +
    " · Inside VOCO";
  window.scrollTo(0, 0);
}
try {
  const responses = await Promise.all([
    fetch("chapters.json"),
    fetch("catalog.json"),
  ]);
  if (responses.some((r) => !r.ok)) throw Error("Guide data could not load");
  [chapters, catalog] = await Promise.all(responses.map((r) => r.json()));
  files = catalog.files;
  byPath = new Map(files.map((f) => [f.path, f]));
  done = new Set([...done].filter((id) => chapters.some((c) => c.id === id)));
  document.querySelector("#file-count").textContent =
    files.length.toLocaleString();
  window.addEventListener("hashchange", route);
  route();
} catch (error) {
  content.replaceChildren(
    node("h1", {}, "The guide could not open."),
    node("p", {}, error.message),
    node(
      "p",
      {},
      "Start serve.py with your local VOCO checkout, then reload this page.",
    ),
  );
}

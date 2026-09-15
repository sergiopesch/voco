// Teaching diagrams never call VOCO, request audio, or modify another application.
export function node(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null)
      n.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}
const paths = {
  key: '<rect x="8" y="8" width="48" height="48" rx="9"/><path d="M20 28h6m-6 8h24m-10-8h10"/>',
  mic: '<rect x="23" y="7" width="18" height="33" rx="9"/><path d="M15 28v7a17 17 0 0 0 34 0v-7M32 52v7M23 59h18"/>',
  model:
    '<rect x="10" y="8" width="44" height="48" rx="6"/><path d="M20 21h24M20 32h18M20 43h11"/>',
  page: '<path d="M16 6h23l12 12v40H16zM39 6v13h12M25 31h16M25 42h16"/>',
  cursor: '<path d="M24 7h16M32 7v50M24 57h16"/>',
  box: '<rect x="10" y="13" width="44" height="40" rx="8"/><path d="M10 25h44M26 13v12M24 39h16"/>',
};
export function icon(type) {
  const wrap = node("span");
  wrap.innerHTML = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type] || paths.box}</svg>`;
  return wrap.firstChild;
}
export function journey(chapter) {
  let step = 0,
    timer;
  const root = node("section", { "aria-label": "Interactive chapter diagram" });
  const diagram = node("div", { class: "journey" }),
    buttons = [];
  const labels = ["key", "mic", "model", "page", "cursor"];
  chapter.steps.forEach((s, i) => {
    const b = node(
      "button",
      {
        class: "stage",
        "aria-label": `Step ${i + 1}: ${s.label}`,
        onclick: () => show(i),
      },
      icon(chapter.id === "big-picture" ? labels[i] : "box"),
      node("strong", {}, s.label),
      node(
        "small",
        {},
        chapter.id === "big-picture"
          ? [
              "You press a key combination.",
              "Your computer listens to sound.",
              "Turns sound into words.",
              "Sends words to your app.",
              "The words appear where you are typing.",
            ][i]
          : `Step ${i + 1}`,
      ),
    );
    buttons.push(b);
    diagram.append(b);
    if (i < chapter.steps.length - 1) {
      const a = node("span", { class: "flow-arrow", "aria-hidden": "true" });
      a.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h19m-7-7 7 7-7 7"/></svg>';
      diagram.append(a);
    }
  });
  const copy = node("p", { class: "step-copy", "aria-live": "polite" });
  const play = node(
    "button",
    {
      class: "primary",
      onclick: () => {
        if (timer) {
          stop();
          return;
        }
        play.textContent = "Pause the journey";
        timer = setInterval(() => {
          show((step + 1) % buttons.length);
          if (step === buttons.length - 1) stop();
        }, 1700);
      },
    },
    "Play the journey",
  );
  const next = node(
    "button",
    {
      onclick: () => {
        stop();
        show((step + 1) % buttons.length);
      },
    },
    "Next step",
  );
  function stop() {
    clearInterval(timer);
    timer = null;
    play.textContent = "Play the journey";
  }
  function show(i) {
    step = i;
    buttons.forEach((b, j) => {
      b.classList.toggle("active", j === i);
      b.setAttribute("aria-pressed", String(j === i));
    });
    copy.textContent = `${i + 1}. ${chapter.steps[i].detail}`;
  }
  root.append(
    diagram,
    node("div", { class: "flow-controls" }, play, next),
    copy,
  );
  show(0);
  return { element: root, dispose: stop };
}
export function lab(type) {
  if (type === "journey") return null;
  const area = node("section", { class: "lab" });
  const output = node("div", { class: "lab-output", "aria-live": "polite" });
  const controls = node("div", { class: "lab-controls" });
  const note = node(
    "small",
    {},
    "Teaching simulation only. No microphone, model or external app is used.",
  );
  if (type === "queue") {
    let waiting = 0,
      done = 0,
      stopped = false;
    area.append(
      node("h2", {}, "Try a tiny audio queue"),
      node(
        "p",
        {},
        "Add a box, process it, then finish the queue. Stop must account for every box already captured.",
      ),
    );
    function draw() {
      output.textContent = `Captured: ${waiting + done}  ·  Waiting: ${waiting}  ·  Processed: ${done}\n${stopped ? "Finished. No boxes left behind." : waiting ? "□ ".repeat(waiting) : "The queue is empty."}`;
    }
    controls.append(
      node(
        "button",
        {
          onclick: () => {
            if (stopped) return;
            if (waiting >= 6) {
              output.textContent =
                "This toy queue is full. A bounded system must surface overload, not grow forever.";
              return;
            }
            waiting++;
            draw();
          },
        },
        "Add audio box",
      ),
      node(
        "button",
        {
          onclick: () => {
            if (waiting) {
              waiting--;
              done++;
            }
            draw();
          },
        },
        "Process one",
      ),
      node(
        "button",
        {
          onclick: () => {
            done += waiting;
            waiting = 0;
            stopped = true;
            draw();
          },
        },
        "Stop and drain",
      ),
      node(
        "button",
        {
          onclick: () => {
            waiting = done = 0;
            stopped = false;
            draw();
          },
        },
        "Reset",
      ),
    );
    draw();
  }
  if (type === "focus") {
    let same = true,
      valid = true;
    area.append(
      node("h2", {}, "A safe delivery decision"),
      node(
        "p",
        {},
        "Change the conditions. A useful recovery state is safer than guessing.",
      ),
    );
    const focus = node("input", { type: "checkbox", checked: "" }),
      session = node("input", { type: "checkbox", checked: "" });
    function draw() {
      same = focus.checked;
      valid = session.checked;
      output.textContent =
        same && valid
          ? "Checks pass in this simplified example. Delivery may proceed. This is not a universal safety guarantee."
          : "Hold delivery. Preserve recovery; do not paste into a changed target or use an old session.";
    }
    focus.addEventListener("change", draw);
    session.addEventListener("change", draw);
    area.append(
      node("label", {}, focus, "Destination still matches"),
      node("label", {}, session, "Recording session still matches"),
    );
    draw();
  }
  if (type === "protocol") {
    area.append(
      node("h2", {}, "Read a numbered message"),
      node(
        "p",
        {},
        "These small metadata-only examples show the protocol shape. Real push requests also carry validated audio.",
      ),
    );
    let seq = 0;
    for (const op of ["start", "push", "finish", "cancel"])
      controls.append(
        node(
          "button",
          {
            onclick: () => {
              output.textContent = JSON.stringify(
                {
                  session: "example-recording",
                  seq: seq++,
                  op,
                  ...(op === "push"
                    ? { rate: 16000, audio: "omitted in this teaching diagram" }
                    : {}),
                },
                null,
                2,
              );
            },
          },
          op,
        ),
      );
    output.textContent = "Choose an operation to see its message shape.";
  }
  if (type === "wave") {
    area.append(
      node("h2", {}, "Samples are little snapshots"),
      node(
        "p",
        {},
        "More dots show a finer drawing of the same wave. This is a schematic, not a resampler.",
      ),
    );
    const range = node("input", {
      type: "range",
      min: "12",
      max: "80",
      value: "28",
      "aria-label": "Number of waveform samples",
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 700 110");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "A schematic wave made from sample dots");
    function draw() {
      const n = Number(range.value);
      svg.replaceChildren();
      for (let i = 0; i < n; i++) {
        const c = document.createElementNS(svg.namespaceURI, "circle");
        c.setAttribute("cx", String(12 + (i * 675) / (n - 1)));
        c.setAttribute(
          "cy",
          String(55 + Math.sin((i / (n - 1)) * Math.PI * 5) * 34),
        );
        c.setAttribute("r", "3");
        c.setAttribute("fill", "#111318");
        svg.append(c);
      }
      output.textContent = `${n} sample dots in this drawing. The real app carries the actual sample rate with its audio.`;
    }
    range.addEventListener("input", draw);
    area.append(node("label", {}, "Detail", range), svg);
    draw();
  }
  if (type === "latency") {
    area.append(
      node("h2", {}, "Move the stopwatch’s starting line"),
      node(
        "p",
        {},
        "These values are invented for learning. Change leading silence and watch which reported delay grows.",
      ),
    );
    const lead = node("input", {
      type: "range",
      min: "0",
      max: "1500",
      step: "100",
      value: "500",
      "aria-label": "Illustrative leading silence milliseconds",
    });
    function draw() {
      const l = Number(lead.value);
      output.textContent = `Leading silence: ${l} ms\nIllustrative recognition: 700 ms\nIllustrative delivery: 40 ms\nPlayback-to-field: ${l + 740} ms\nSpeech-onset-to-field: 740 ms\nThe clock definition changes the result.`;
    }
    lead.addEventListener("input", draw);
    area.append(node("label", {}, "Leading silence", lead));
    draw();
  }
  area.append(controls, output, note);
  return area;
}

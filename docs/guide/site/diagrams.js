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
      node("h2", {}, "Try a tiny phrase queue"),
      node(
        "p",
        {},
        "Each box stands for 100 ms of audio. Add boxes, let the worker answer one, then stop. Stop sends every captured box before the final answer.",
      ),
    );
    function draw() {
      output.textContent = `Captured: ${waiting + done}  ·  Waiting: ${waiting}  ·  Answered: ${done}\n${stopped ? "Finished. Every captured box was sent before the final answer." : waiting ? "□ ".repeat(waiting) : "The queue is empty."}`;
    }
    controls.append(
      node(
        "button",
        {
          onclick: () => {
            if (stopped) return;
            if (waiting >= 6) {
              output.textContent =
                "This toy queue is full. The real queue has a limit too: when more than three seconds of audio is waiting, VOCO stops transcribing instead of falling further behind.";
              return;
            }
            waiting++;
            draw();
          },
        },
        "Add 100 ms of audio",
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
        "Worker answers one",
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
    area.append(
      node("h2", {}, "A paste decision"),
      node(
        "p",
        {},
        "One paste passes three stages in order. Untick a stage to see how VOCO labels the result.",
      ),
    );
    const copied = node("input", { type: "checkbox", checked: "" }),
      released = node("input", { type: "checkbox", checked: "" }),
      clean = node("input", { type: "checkbox", checked: "" });
    function draw() {
      output.textContent = !copied.checked
        ? "No-mutation. The clipboard helper never started, so nothing changed. The words stay pending for the next phrase or for Stop."
        : !released.checked
          ? "No-mutation. The clipboard holds the words, but the shortcut keys were still down after 1.5 s, so no paste keys were sent. The words stay pending."
          : !clean.checked
            ? "Uncertain. The keys may have gone out, so VOCO never repeats them. Typing stops for this recording, listening continues, and Stop copies the rest to the clipboard."
            : "Dispatched. Shift+Insert went to whichever app has keyboard focus. This means the keys were sent, not that the app accepted the text.";
    }
    for (const box of [copied, released, clean]) box.addEventListener("change", draw);
    area.append(
      node("label", {}, copied, "1. Clipboard helper started"),
      node("label", {}, released, "2. Shortcut keys released within 1.5 s"),
      node("label", {}, clean, "3. Paste helper finished cleanly"),
    );
    draw();
  }
  if (type === "protocol") {
    area.append(
      node("h2", {}, "Read a numbered message"),
      node(
        "p",
        {},
        "These metadata-only examples show the message shapes. A real push carries about 100 ms of audio at the capture's own sample rate, such as 44100 Hz from native capture.",
      ),
    );
    let seq = 0;
    const answers = { start: null, push: "example words", finish: "Example words.", cancel: null };
    for (const op of ["start", "push", "finish", "cancel"])
      controls.append(
        node(
          "button",
          {
            onclick: () => {
              const number = seq++;
              const request = { op, session: "example-session", seq: number };
              if (op === "push") Object.assign(request, { rate: 44100, audio: "4410 samples, omitted here" });
              const response = { session: "example-session", seq: number, text: answers[op], mode: "append-only" };
              output.textContent = `Request\n${JSON.stringify(request, null, 2)}\n\nResponse\n${JSON.stringify(response, null, 2)}`;
            },
          },
          op,
        ),
      );
    output.textContent = "Choose an operation to see a request and its response.";
  }
  if (type === "wave") {
    area.append(
      node("h2", {}, "Samples are little snapshots"),
      node(
        "p",
        {},
        "More dots show a finer drawing of the same wave. Native capture takes 44,100 snapshots a second on each of two channels. This drawing is a schematic, not a resampler.",
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
    const level = node("input", {
      type: "range",
      min: "0",
      max: "100",
      value: "60",
      "aria-label": "Microphone level from 0 to 100 percent",
    });
    const bars = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    bars.setAttribute("viewBox", "0 0 700 110");
    bars.setAttribute("role", "img");
    const weights = [0.35, 0.65, 0.9, 1, 0.8, 0.55, 0.3];
    const levelCopy = node("p", { "aria-live": "polite" });
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
      output.textContent = `${n} sample dots in this drawing. Each real audio packet carries its actual sample rate.`;
    }
    function drawBars() {
      // The same formula as the GNOME companion's model.js barScales().
      const value = Number(level.value) / 100;
      const scales = weights.map((weight) => 0.15 + 0.85 * value * weight);
      bars.replaceChildren();
      scales.forEach((scale, i) => {
        const height = 96 * scale;
        const r = document.createElementNS(bars.namespaceURI, "rect");
        r.setAttribute("x", String(245 + i * 32));
        r.setAttribute("y", String(55 - height / 2));
        r.setAttribute("width", "14");
        r.setAttribute("height", String(height));
        r.setAttribute("rx", "7");
        r.setAttribute("fill", "#111318");
        bars.append(r);
      });
      const list = scales.map((scale) => scale.toFixed(2)).join(", ");
      bars.setAttribute("aria-label", `Seven meter bars at heights ${list}`);
      levelCopy.textContent = `Level ${value.toFixed(2)} gives bar heights ${list}. Silence still leaves each bar at 0.15.`;
    }
    range.addEventListener("input", draw);
    level.addEventListener("input", drawBars);
    area.append(
      node("label", {}, "Detail", range),
      svg,
      node("h3", {}, "From level to top-bar bars"),
      node("label", {}, "Level", level),
      bars,
      levelCopy,
    );
    draw();
    drawBars();
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

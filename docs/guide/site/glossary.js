export const glossary = [
  ["API", "An agreed set of operations one piece of software offers another."],
  [
    "ASR",
    "Automatic speech recognition: turning recorded sound into written words.",
  ],
  [
    "AudioWorklet",
    "A browser audio helper that handles small sound blocks away from ordinary interface work.",
  ],
  [
    "Bounded queue",
    "A waiting line with a maximum capacity, so overload cannot grow forever.",
  ],
  [
    "Callback",
    "A function saved so another part of the program can call it when something happens.",
  ],
  [
    "Capture",
    "Collecting microphone samples. It is different from understanding their words.",
  ],
  [
    "Clipboard",
    "Linux’s shared copy-and-paste storage. VOCO’s normal paste route replaces its text.",
  ],
  [
    "Commit",
    "A named snapshot of the repository. This guide reads one exact snapshot.",
  ],
  [
    "Compositor",
    "The desktop component that combines application surfaces into the pixels on your screen.",
  ],
  [
    "Context",
    "Recent information a streaming model can use while predicting its next result.",
  ],
  [
    "CPU-seconds",
    "Processor work consumed. Two busy CPU threads for one second can consume about two CPU-seconds.",
  ],
  [
    "ctypes",
    "Python’s bridge for calling functions exported by a native library.",
  ],
  ["Debounce", "Preventing one physical action from being counted repeatedly."],
  [
    "Dependency",
    "A library or tool used by the application instead of being reimplemented.",
  ],
  [
    "Descriptor",
    "A small record that carries important facts about another object, such as audio rate and source.",
  ],
  [
    "Epoch",
    "A generation number used to distinguish a replacement owner from an older one.",
  ],
  [
    "Finite value",
    "A normal numeric value, excluding infinity and NaN. Invalid audio values must be rejected.",
  ],
  [
    "Focus",
    "The application window or control currently receiving keyboard input.",
  ],
  [
    "Gate",
    "A rule that decides what may pass. VOCO’s default audio gate identifies digital zero, not all silence.",
  ],
  [
    "Git blob",
    "The stored contents of one version of a file, identified by Git.",
  ],
  [
    "Hypothesis",
    "The recognizer’s current proposed text. It may not yet be final.",
  ],
  [
    "IBus",
    "A Linux input-method framework. VOCO’s optional IBus component handles shortcuts, not generic text mutation.",
  ],
  [
    "IPC",
    "Inter-process communication: messages between separate running programs.",
  ],
  [
    "JSON",
    "A text format for structured values such as objects, arrays, strings and numbers.",
  ],
  ["Lease", "Temporary permission that expires or is explicitly released."],
  ["Median", "The middle value after observations are sorted."],
  [
    "Model weights",
    "Numbers learned during model training and used later for prediction.",
  ],
  [
    "NaN",
    "Not a Number: a special floating-point value that must not enter valid audio.",
  ],
  [
    "Native code",
    "Compiled code that runs through the operating system rather than inside the web interface.",
  ],
  [
    "P95",
    "The 95th percentile. A description of the slow tail, not the worst observed value.",
  ],
  ["PCM", "Pulse-code modulation: a way to represent audio as sample values."],
  [
    "Preflight",
    "Checks made before an operation, such as verifying a destination before paste.",
  ],
  [
    "Preroll",
    "A short retained piece of earlier audio that helps preserve an onset when a gate opens.",
  ],
  [
    "Q8",
    "A quantized model representation. It describes how model values are stored, not an accuracy percentage.",
  ],
  [
    "Race condition",
    "A bug whose result depends on the timing/order of overlapping operations.",
  ],
  [
    "Recovery",
    "An explicit path for handling interrupted or uncertain work instead of claiming success.",
  ],
  [
    "Renderer",
    "The process that turns interface code into the app’s visual content.",
  ],
  [
    "RSS",
    "Resident set size: memory pages currently resident for a process. Summing it can double-count shared pages.",
  ],
  ["Runtime", "The software engine that executes a model or program."],
  [
    "Sample rate",
    "The number of audio sample measurements per second, expressed in hertz.",
  ],
  [
    "Sequence number",
    "An increasing label that helps detect missing, repeated or out-of-order messages.",
  ],
  [
    "Session",
    "The identity and state belonging to one recording or operation.",
  ],
  ["SHA-256", "A cryptographic fingerprint used to check exact file bytes."],
  [
    "Socket",
    "A communication endpoint. A local Unix socket connects programs on the same machine.",
  ],
  [
    "State machine",
    "A map of allowed states and transitions, such as idle → recording → finishing → idle.",
  ],
  [
    "Tauri",
    "The desktop framework connecting VOCO’s web-based interface to its native Rust backend.",
  ],
  [
    "Trust boundary",
    "A point where incoming data or authority needs to be checked again.",
  ],
  [
    "Vendored code",
    "A copy of a third-party library kept in the repository, sometimes with a reviewed local patch.",
  ],
  [
    "VAD",
    "Voice activity detection. VOCO’s acoustic VAD gate is opt-in, not the default digital-zero gate.",
  ],
  [
    "Warmup",
    "Preparatory work before recording, so readiness means the model can actually run.",
  ],
  [
    "Wayland",
    "A Linux display protocol with different application-integration rules from X11.",
  ],
  [
    "WER",
    "Word error rate: substitutions + deletions + insertions divided by reference-word count.",
  ],
  ["Worktree", "A separate checked-out view of a Git repository."],
  [
    "X11",
    "A Linux window-system protocol used by one of VOCO’s desktop integration paths.",
  ],
];

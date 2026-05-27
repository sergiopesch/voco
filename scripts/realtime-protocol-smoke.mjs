#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REALTIME_MODEL = "gpt-realtime-2";
const SAMPLE_RATE = 24_000;
const CHANNELS = 1;
const CHUNK_MS = 80;
const CHUNK_BYTES = Math.round((SAMPLE_RATE * CHUNK_MS) / 1000) * 2;
const SPEECH_TEXT = "give me one very short test reply";
const INTERRUPT_SPEECH_TEXT = "now answer this latest request in one short sentence";
const INTERRUPT_MODE = process.argv.includes("--interrupt");

const REQUIRED_COMMANDS = ["pactl", "parec", "sox", "spd-say"];

function assertCommand(command) {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function parseEnvApiKey(contents) {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [rawKey, ...rawValue] = line.split("=");
    if (rawKey.trim().replace(/^export\s+/, "") !== "OPENAI_API_KEY") {
      continue;
    }
    const value = rawValue
      .join("=")
      .trim()
      .replace(/^['"]/, "")
      .replace(/['"]$/, "");
    if (value) {
      return value;
    }
  }
  return null;
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  const envPath = join(homedir(), ".openclaw", "realtime.env");
  try {
    const key = parseEnvApiKey(readFileSync(envPath, "utf8"));
    if (key) {
      return key;
    }
  } catch (error) {
    throw new Error(`OPENAI_API_KEY is missing and ${envPath} could not be read`);
  }
  throw new Error(`OPENAI_API_KEY is missing from ${envPath}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? `: ${result.stderr.trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${stderr}`);
  }
  return result.stdout.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pcmRms(buffer) {
  if (buffer.length < 2) {
    return 0;
  }
  let sum = 0;
  const samples = Math.floor(buffer.length / 2);
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

function appendPcmStats(stats, buffer) {
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    stats.squaredSum += sample * sample;
    stats.samples += 1;
  }
  stats.bytes += buffer.length;
}

function pcmStatsRms(stats) {
  if (stats.samples === 0) {
    return 0;
  }
  return Math.sqrt(stats.squaredSum / stats.samples);
}

function trimPcmSilence(buffer) {
  const frameBytes = Math.round(SAMPLE_RATE * 0.02) * 2;
  const threshold = 0.004;
  let start = 0;
  let end = buffer.length;

  for (let offset = 0; offset + frameBytes <= buffer.length; offset += frameBytes) {
    if (pcmRms(buffer.subarray(offset, offset + frameBytes)) >= threshold) {
      start = Math.max(0, offset - frameBytes * 5);
      break;
    }
  }

  for (
    let offset = buffer.length - frameBytes;
    offset >= 0;
    offset -= frameBytes
  ) {
    if (pcmRms(buffer.subarray(offset, offset + frameBytes)) >= threshold) {
      end = Math.min(buffer.length, offset + frameBytes * 10);
      break;
    }
  }

  return buffer.subarray(start, end);
}

async function recordSpeechPcm(text = SPEECH_TEXT) {
  REQUIRED_COMMANDS.forEach(assertCommand);

  const originalSink = run("pactl", ["get-default-sink"]);
  const sinkName = `voco_rt_protocol_${process.pid}`;
  let moduleId = "";
  const rawPath = join(tmpdir(), `${sinkName}.raw`);

  try {
    moduleId = run("pactl", [
      "load-module",
      "module-null-sink",
      `sink_name=${sinkName}`,
      `sink_properties=device.description=${sinkName}`,
    ]);
    run("pactl", ["set-default-sink", sinkName]);

    const recorder = spawn("parec", [
      `--device=${sinkName}.monitor`,
      "--format=s16le",
      `--rate=${SAMPLE_RATE}`,
      `--channels=${CHANNELS}`,
    ]);
    const chunks = [];
    recorder.stdout.on("data", (chunk) => chunks.push(chunk));
    recorder.stderr.on("data", () => {});

    await sleep(300);
    run("spd-say", ["-w", text]);
    await sleep(700);
    recorder.kill("SIGINT");
    await new Promise((resolve) => recorder.once("close", resolve));

    const raw = Buffer.concat(chunks);
    writeFileSync(rawPath, raw);
    const converted = spawnSync("sox", [
      "-t",
      "raw",
      "-r",
      String(SAMPLE_RATE),
      "-e",
      "signed-integer",
      "-b",
      "16",
      "-c",
      String(CHANNELS),
      rawPath,
      "-t",
      "raw",
      "-r",
      String(SAMPLE_RATE),
      "-e",
      "signed-integer",
      "-b",
      "16",
      "-c",
      String(CHANNELS),
      "-",
      "gain",
      "-n",
      "-3",
    ]);
    if (converted.status !== 0) {
      throw new Error("sox normalization failed");
    }

    const speech = trimPcmSilence(converted.stdout);
    const trailingSilence = Buffer.alloc(Math.round(SAMPLE_RATE * 0.9) * 2);
    const payload = Buffer.concat([speech, trailingSilence]);
    const rms = pcmRms(payload);
    if (payload.length < SAMPLE_RATE || rms < 0.002) {
      throw new Error("Generated speech sample appears silent");
    }
    return { payload, rms };
  } finally {
    run("pactl", ["set-default-sink", originalSink]);
    if (moduleId) {
      spawnSync("pactl", ["unload-module", moduleId]);
    }
    rmSync(rawPath, { force: true });
  }
}

function realtimeSessionConfig() {
  return {
    type: "realtime",
    model: REALTIME_MODEL,
    output_modalities: ["audio"],
    instructions:
      "You are Sergio's concise realtime OpenClaw voice companion. Answer in 1-2 short sentences. No preamble, no markdown, no waffle. If the user interrupts, stop and respond to the latest thing they said.",
    reasoning: { effort: "low" },
    audio: {
      input: {
        format: { type: "audio/pcm", rate: SAMPLE_RATE },
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        format: { type: "audio/pcm", rate: SAMPLE_RATE },
        voice: "marin",
      },
    },
  };
}

async function createClientSecret(apiKey) {
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session: realtimeSessionConfig() }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`client secret request failed (${response.status})`);
  }
  const parsed = JSON.parse(body);
  if (!parsed.value) {
    throw new Error("client secret response did not include value");
  }
  return parsed.value;
}

async function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket open timeout")), 10_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("WebSocket failed to open"));
    }, { once: true });
  });
}

async function streamAudio(socket, payload) {
  for (let offset = 0; offset < payload.length; offset += CHUNK_BYTES) {
    const chunk = payload.subarray(offset, Math.min(payload.length, offset + CHUNK_BYTES));
    socket.send(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: chunk.toString("base64"),
    }));
    await sleep(CHUNK_MS);
  }
}

async function runRealtimeSmoke(clientSecret, payload, interruptPayload = null) {
  const events = [];
  const counts = {
    speechStarted: 0,
    speechStopped: 0,
    committed: 0,
    responseCreated: 0,
    firstResponseCreated: 0,
    secondResponseCreated: 0,
    outputAudioDelta: 0,
    firstOutputAudioDelta: 0,
    secondOutputAudioDelta: 0,
    outputAudioBytes: 0,
    responseDone: 0,
    firstResponseDone: 0,
    secondResponseDone: 0,
    cancelSent: 0,
    fallbackCommitSent: 0,
    fallbackResponseCreateSent: 0,
  };
  const outputStats = {
    bytes: 0,
    squaredSum: 0,
    samples: 0,
  };
  const interruptMode = Boolean(interruptPayload);
  let secondStreamStarted = false;
  let secondStreamFinished = false;
  let secondSpeechStartedBaseline = 0;
  let secondResponseCreatedBaseline = 0;
  let sendingSecondStream = false;
  const firstResponseIds = new Set();
  const secondResponseIds = new Set();
  let socketError = null;
  let doneResolve;
  const done = new Promise((resolve) => {
    doneResolve = resolve;
  });

  const completeIfReady = () => {
    if (!interruptMode && counts.responseDone > 0) {
      doneResolve();
      return;
    }
    if (
      interruptMode &&
      counts.cancelSent > 0 &&
      counts.secondResponseCreated > 0 &&
      counts.secondOutputAudioDelta > 0 &&
      counts.secondResponseDone > 0
    ) {
      doneResolve();
    }
  };

  const startSecondStream = () => {
    if (!interruptMode || secondStreamStarted || sendingSecondStream) {
      return;
    }
    secondStreamStarted = true;
    sendingSecondStream = true;
    secondSpeechStartedBaseline = counts.speechStarted;
    secondResponseCreatedBaseline = counts.responseCreated;
    void (async () => {
      await sleep(250);
      await streamAudio(socket, interruptPayload);
      secondStreamFinished = true;
      sendingSecondStream = false;
    })().catch((error) => {
      socketError = error instanceof Error ? error.message : String(error);
      doneResolve();
    });
  };

  const socket = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`,
    ["realtime", `openai-insecure-api-key.${clientSecret}`],
  );

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type) {
      events.push(message.type);
    }
    switch (message.type) {
      case "input_audio_buffer.speech_started":
        counts.speechStarted += 1;
        break;
      case "input_audio_buffer.speech_stopped":
        counts.speechStopped += 1;
        break;
      case "input_audio_buffer.committed":
        counts.committed += 1;
        break;
      case "response.created":
        counts.responseCreated += 1;
        if (secondStreamStarted && message.response?.id) {
          secondResponseIds.add(message.response.id);
          counts.secondResponseCreated += 1;
        } else if (secondStreamStarted) {
          counts.secondResponseCreated += 1;
        } else if (message.response?.id) {
          firstResponseIds.add(message.response.id);
          counts.firstResponseCreated += 1;
        } else {
          counts.firstResponseCreated += 1;
        }
        break;
      case "response.output_audio.delta":
        counts.outputAudioDelta += 1;
        if (typeof message.delta === "string") {
          const audio = Buffer.from(message.delta, "base64");
          counts.outputAudioBytes += audio.length;
          appendPcmStats(outputStats, audio);
        }
        if (message.response_id && secondResponseIds.has(message.response_id)) {
          counts.secondOutputAudioDelta += 1;
        } else if (message.response_id && firstResponseIds.has(message.response_id)) {
          counts.firstOutputAudioDelta += 1;
          if (interruptMode && counts.cancelSent === 0) {
            socket.send(JSON.stringify({ type: "response.cancel" }));
            counts.cancelSent += 1;
            startSecondStream();
          }
        } else if (secondStreamStarted) {
          counts.secondOutputAudioDelta += 1;
        } else {
          counts.firstOutputAudioDelta += 1;
          if (interruptMode && counts.cancelSent === 0) {
            socket.send(JSON.stringify({ type: "response.cancel" }));
            counts.cancelSent += 1;
            startSecondStream();
          }
        }
        completeIfReady();
        break;
      case "response.done":
        counts.responseDone += 1;
        if (message.response?.id && secondResponseIds.has(message.response.id)) {
          counts.secondResponseDone += 1;
        } else if (message.response?.id && firstResponseIds.has(message.response.id)) {
          counts.firstResponseDone += 1;
        } else if (secondStreamStarted && counts.secondResponseCreated > 0) {
          counts.secondResponseDone += 1;
        } else {
          counts.firstResponseDone += 1;
        }
        completeIfReady();
        break;
      case "error":
        socketError = message.error?.message ?? "Realtime server error";
        doneResolve();
        break;
    }
  });

  socket.addEventListener("error", () => {
    socketError = "WebSocket error";
    doneResolve();
  });
  socket.addEventListener("close", () => {
    doneResolve();
  });

  await waitForSocketOpen(socket);
  await streamAudio(socket, payload);

  await sleep(4_000);
  if (counts.committed === 0) {
    socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    counts.fallbackCommitSent += 1;
  }
  await sleep(1_200);
  if (counts.responseCreated === 0) {
    socket.send(JSON.stringify({
      type: "response.create",
      response: { output_modalities: ["audio"] },
    }));
    counts.fallbackResponseCreateSent += 1;
  }

  if (interruptMode) {
    await sleep(4_000);
    if (secondStreamFinished && counts.speechStarted === secondSpeechStartedBaseline) {
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      counts.fallbackCommitSent += 1;
    }
    await sleep(1_200);
    if (secondStreamFinished && counts.responseCreated === secondResponseCreatedBaseline) {
      socket.send(JSON.stringify({
        type: "response.create",
        response: { output_modalities: ["audio"] },
      }));
      counts.fallbackResponseCreateSent += 1;
    }
  }

  await Promise.race([done, sleep(20_000)]);
  socket.close();

  return { events, counts, outputRms: pcmStatsRms(outputStats), socketError };
}

async function main() {
  const apiKey = loadApiKey();
  const { payload, rms } = await recordSpeechPcm();
  const interruptRecording = INTERRUPT_MODE
    ? await recordSpeechPcm(INTERRUPT_SPEECH_TEXT)
    : null;
  const clientSecret = await createClientSecret(apiKey);
  const result = await runRealtimeSmoke(
    clientSecret,
    payload,
    interruptRecording?.payload ?? null,
  );
  const summary = {
    ok:
      !result.socketError &&
      result.counts.responseCreated > 0 &&
      result.counts.outputAudioDelta > 0 &&
      result.counts.outputAudioBytes > 0 &&
      result.outputRms > 0.0005 &&
      result.counts.responseDone > 0 &&
      (
        !INTERRUPT_MODE ||
        (
          result.counts.cancelSent > 0 &&
          result.counts.secondResponseCreated > 0 &&
          result.counts.secondOutputAudioDelta > 0 &&
          result.counts.secondResponseDone > 0
        )
      ),
    mode: INTERRUPT_MODE ? "interrupt" : "single-turn",
    audio: {
      inputBytes: payload.length,
      rms: Number(rms.toFixed(6)),
      interruptInputBytes: interruptRecording?.payload.length ?? 0,
      interruptRms: interruptRecording ? Number(interruptRecording.rms.toFixed(6)) : 0,
      outputBytes: result.counts.outputAudioBytes,
      outputRms: Number(result.outputRms.toFixed(6)),
    },
    counts: result.counts,
    observedEvents: [...new Set(result.events)],
    error: result.socketError,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

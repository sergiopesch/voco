const LABEL_PREFIX = "label:";

export interface AudioInputProcessingOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export type AudioInputFallbackStage =
  | "none"
  | "minimal-constraints"
  | "default-device";

export interface OpenMicrophoneStreamResult {
  fallbackStage: AudioInputFallbackStage;
  selectedDeviceConfigured: boolean;
  stream: MediaStream;
}

interface AudioInputDeviceCandidate {
  deviceId: string;
  kind: MediaDeviceKind;
  label: string;
}

export function chooseAudioInputDeviceId(
  preferredDeviceId: string | null,
  devices: AudioInputDeviceCandidate[],
): string | null {
  if (!preferredDeviceId) {
    return null;
  }

  const audioInputs = devices.filter((device) => device.kind === "audioinput");
  const exactDevice = audioInputs.find((device) => device.deviceId === preferredDeviceId);
  if (exactDevice) {
    return exactDevice.deviceId;
  }

  const labelPreference = preferredDeviceId.startsWith(LABEL_PREFIX)
    ? preferredDeviceId.slice(LABEL_PREFIX.length).trim()
    : preferredDeviceId.trim();
  if (!labelPreference) {
    return preferredDeviceId;
  }

  const normalizedLabelPreference = labelPreference.toLocaleLowerCase();
  const exactLabel = audioInputs.find(
    (device) => device.label.toLocaleLowerCase() === normalizedLabelPreference,
  );
  if (exactLabel) {
    return exactLabel.deviceId;
  }

  const partialLabel = audioInputs.find((device) =>
    device.label.toLocaleLowerCase().includes(normalizedLabelPreference),
  );
  if (partialLabel) {
    return partialLabel.deviceId;
  }

  return preferredDeviceId;
}

async function resolvePreferredAudioInputDeviceId(
  preferredDeviceId: string | null,
): Promise<string | null> {
  if (!preferredDeviceId) {
    return null;
  }

  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  let resolvedDeviceId = chooseAudioInputDeviceId(preferredDeviceId, devices);
  if (
    resolvedDeviceId !== preferredDeviceId ||
    !preferredDeviceId.startsWith(LABEL_PREFIX) ||
    devices.some((device) => device.kind === "audioinput" && device.label)
  ) {
    return resolvedDeviceId;
  }

  const permissionStream = await navigator.mediaDevices
    .getUserMedia({ audio: true })
    .catch(() => null);
  permissionStream?.getTracks().forEach((track) => track.stop());

  const refreshedDevices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  resolvedDeviceId = chooseAudioInputDeviceId(preferredDeviceId, refreshedDevices);
  return resolvedDeviceId;
}

export function buildAudioConstraints(
  deviceId: string | null,
  processing: AudioInputProcessingOptions = {},
): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: processing.echoCancellation ?? false },
    noiseSuppression: { ideal: processing.noiseSuppression ?? false },
    autoGainControl: { ideal: processing.autoGainControl ?? false },
  };
}

function buildMinimalAudioConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
  };
}

function isConstraintFailure(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  return (
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError" ||
    name === "NotFoundError"
  );
}

export async function openMicrophoneStream(
  deviceId: string | null,
  processing?: AudioInputProcessingOptions,
): Promise<MediaStream> {
  return openMicrophoneStreamWithDiagnostics(deviceId, processing).then(
    (result) => result.stream,
  );
}

export async function openMicrophoneStreamWithDiagnostics(
  deviceId: string | null,
  processing?: AudioInputProcessingOptions,
): Promise<OpenMicrophoneStreamResult> {
  const resolvedDeviceId = await resolvePreferredAudioInputDeviceId(deviceId);
  const selectedDeviceConfigured = Boolean(deviceId);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: buildAudioConstraints(resolvedDeviceId, processing),
    });
    return { fallbackStage: "none", selectedDeviceConfigured, stream };
  } catch (error) {
    if (!isConstraintFailure(error)) {
      throw error;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: buildMinimalAudioConstraints(resolvedDeviceId),
    });
    return {
      fallbackStage: "minimal-constraints",
      selectedDeviceConfigured,
      stream,
    };
  } catch (error) {
    if (!isConstraintFailure(error)) {
      throw error;
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return {
    fallbackStage: "default-device",
    selectedDeviceConfigured,
    stream,
  };
}

export async function probeMicrophoneAccess(deviceId: string | null): Promise<void> {
  const stream = await openMicrophoneStream(deviceId);
  stream.getTracks().forEach((track) => track.stop());
}

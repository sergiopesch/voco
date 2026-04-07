export function buildAudioConstraints(deviceId: string | null): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  };
}

export async function openMicrophoneStream(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: buildAudioConstraints(deviceId),
  });
}

export async function probeMicrophoneAccess(deviceId: string | null): Promise<void> {
  const stream = await openMicrophoneStream(deviceId);
  stream.getTracks().forEach((track) => track.stop());
}

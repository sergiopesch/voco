const settingsIcons = {
  General: "house",
  Audio: "mic",
  Output: "audio-lines",
  Hotkeys: "keyboard",
  Updates: "download",
  Advanced: "life-buoy",
  shortcut: "keyboard",
  microphone: "mic",
  output: "text-cursor-input",
  chevron: "chevron-right",
} as const;

export function SettingsIcon({ name }: { name: keyof typeof settingsIcons }) {
  return <img className="voco-settings-icon" src={`/icons/settings/${settingsIcons[name]}.svg`} alt="" aria-hidden="true" />;
}

const settingsIcons = {
  General: "house",
  Audio: "mic",
  Output: "audio-lines",
  Hotkeys: "keyboard",
  Appearance: "paintbrush",
  Integrations: "puzzle",
  Updates: "download",
  Advanced: "life-buoy",
  appearance: "sparkles",
  motion: "accessibility",
  shortcut: "keyboard",
  microphone: "mic",
  output: "text-cursor-input",
  chevron: "chevron-right",
} as const;

export function SettingsIcon({ name }: { name: keyof typeof settingsIcons }) {
  return <img className="voco-settings-icon" src={`/icons/settings/${settingsIcons[name]}.svg`} alt="" aria-hidden="true" />;
}

const settingsIcons = {
  General: "house",
  Audio: "mic",
  Hotkeys: "keyboard",
  Updates: "download",
  Advanced: "life-buoy",
  microphone: "mic",
} as const;

export function SettingsIcon({ name }: { name: keyof typeof settingsIcons }) {
  return <img className="voco-settings-icon" src={`/icons/settings/${settingsIcons[name]}.svg`} alt="" aria-hidden="true" />;
}

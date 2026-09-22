#!/usr/bin/env bash
# Embedded into the standalone installer by sync-installer-ui.py.
# Presentation never owns the download: the foreground waits on wget itself.
VOCO_UI_PID=""
VOCO_UI_TIMER_FD=""
VOCO_UI_OPEN=false
VOCO_UI_NO_MOTION=false
VOCO_UI_LAST_BYTES=0
VOCO_UI_LAST_TIME=0
VOCO_UI_RATES=(0 0 0 0 0 0 0)

voco_ui_init() {
  if [[ "${VOCO_INSTALL_PLAIN:-0}" == 1 ]]; then VOCO_TERMINAL_MOTION=false; fi
  if [[ "${VOCO_INSTALL_NO_MOTION:-0}" == 1 ]]; then
    VOCO_UI_NO_MOTION=true
  elif [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
    if [[ "$(gsettings get org.gnome.desktop.interface enable-animations 2>/dev/null)" == false ]]; then
      VOCO_UI_NO_MOTION=true
    fi
  fi
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  # An owned, unlinked FIFO gives read -t a timer without a sleep subprocess.
  local fifo="$VOCO_DOWNLOAD_DIR/ui-timer"
  mkfifo -m 600 "$fifo"
  exec {VOCO_UI_TIMER_FD}<>"$fifo"
  rm -f -- "$fifo"
}

voco_ui_size() {
  local bytes="$1" unit=KiB divisor=1024
  if (( bytes >= 1048576 )); then unit=MiB; divisor=1048576; fi
  printf -v VOCO_UI_SIZE '%d.%d %s' "$((bytes/divisor))" "$((bytes%divisor*10/divisor))" "$unit"
}

voco_ui_frame() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  local title="$1" detail="$2" mark="${3:-—}" shine="${4:--1}" width wordmark='V O C O' i letter
  width="${VOCO_TERMINAL_COLUMNS:-80}"
  [[ "$width" =~ ^[0-9]+$ ]] || width=80
  (( width >= 20 )) || return 0
  width=$((width-5))
  title="${title:0:width}"; detail="${detail:0:width}"
  if (( shine >= 0 )) && [[ "$VOCO_UI_NO_MOTION" != true ]]; then
    wordmark=''
    for ((i=0;i<4;i++)); do
      letter="${VOCO_UI_LETTERS:i:1}"
      if (( i == shine )); then wordmark+="${WHITE}${letter}${GRAPHITE}"; else wordmark+="$letter"; fi
      wordmark+=' '
    done
  fi
  printf '\033[4A\r\033[K  %b%b%b\n\033[K  %s\n\033[K  %s\n\033[K  %s\n' \
    "$GRAPHITE" "$wordmark" "$NC" "$mark" "$title" "$detail"
}
VOCO_UI_LETTERS=VOCO

voco_ui_begin() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  voco_ui_pause
  if [[ "$VOCO_UI_OPEN" != true ]]; then printf '\n\n\n\n'; VOCO_UI_OPEN=true; fi
  voco_ui_frame "$1" "${2:-}" "${3:-—}"
}

voco_ui_sweep() {
  voco_ui_begin "$1" "$2"
  [[ "$VOCO_TERMINAL_MOTION" == true && "$VOCO_UI_NO_MOTION" != true ]] || return 0
  (
    trap - EXIT
    trap 'exit 0' TERM INT
    local shine
    for shine in 0 1 2 3; do
      voco_ui_frame "$1" "$2" '—' "$shine"
      IFS= read -r -t .125 -u "$VOCO_UI_TIMER_FD" _ || true
    done
    voco_ui_frame "$1" "$2" '—'
  ) &
  VOCO_UI_PID=$!
}

voco_ui_pause() {
  if [[ -n "$VOCO_UI_PID" ]]; then
    kill "$VOCO_UI_PID" 2>/dev/null || true
    wait "$VOCO_UI_PID" 2>/dev/null || true
    VOCO_UI_PID=""
  fi
}

voco_ui_release() {
  voco_ui_pause
  VOCO_UI_OPEN=false
}

voco_ui_download_observer() {
  trap - EXIT
  trap 'exit 0' TERM INT
  local destination="$1" initial="$2" start="$3" bytes="$2" now delta rate elapsed tick=0 mark detail shine
  local glyphs=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █) value
  VOCO_UI_LAST_BYTES=$initial
  VOCO_UI_LAST_TIME=${EPOCHREALTIME/./}
  while :; do
    # Sample at 4 Hz; the short entry sweep uses only shell builtins between samples.
    if (( tick % 2 == 0 )); then
      bytes=$(stat -c %s -- "$destination" 2>/dev/null || printf '0')
      now=${EPOCHREALTIME/./}
      delta=$((now-VOCO_UI_LAST_TIME))
      rate=0
      if (( delta > 0 && bytes >= VOCO_UI_LAST_BYTES )); then rate=$(((bytes-VOCO_UI_LAST_BYTES)*1000000/delta)); fi
      VOCO_UI_LAST_BYTES=$bytes; VOCO_UI_LAST_TIME=$now
      VOCO_UI_RATES=("${VOCO_UI_RATES[@]:1}" "$rate")
      elapsed=$((SECONDS-start))
      voco_ui_size "$bytes"; detail="$VOCO_UI_SIZE received"
      if (( elapsed > 0 )); then
        voco_ui_size "$(((bytes>initial?bytes-initial:0)/elapsed))"; detail+=" · $VOCO_UI_SIZE/s avg"
      fi
      mark=''
      if [[ "$VOCO_UI_NO_MOTION" == true ]]; then mark='↓'; else
        # A fixed logarithmic scale keeps rates comparable without needing a known total.
        for value in "${VOCO_UI_RATES[@]}"; do
          if (( value == 0 )); then mark+='· '; else
            value=$((value/131072)); local level=0
            while (( value > 1 && level < 7 )); do value=$((value/2)); level=$((level+1)); done
            mark+="${glyphs[level]} "
          fi
        done
      fi
    fi
    shine=-1
    if (( tick < 4 )); then shine=$tick; fi
    if (( tick < 6 || tick % 2 == 0 )); then voco_ui_frame 'Bringing VOCO to your desktop.' "$detail" "$mark" "$shine"; fi
    IFS= read -r -t .125 -u "$VOCO_UI_TIMER_FD" _ || true
    tick=$((tick+1))
  done
}

voco_ui_close() {
  voco_ui_pause
  if [[ -n "$VOCO_UI_TIMER_FD" ]]; then exec {VOCO_UI_TIMER_FD}>&-; VOCO_UI_TIMER_FD=""; fi
}

voco_run_apt() {
  local result=0
  local wrapper='exec 3>&1 1>&2; exec apt-get -q=2 -o APT::Status-Fd=3 -o Dpkg::Use-Pty=0 install -y -- "$@"'
  local output_fd fifo="$VOCO_DOWNLOAD_DIR/apt-output"
  local -a statuses
  # Minimal systems use APT's own presentation until Python is installed. There
  # is never a download/install of a framework just to display progress.
  if [[ "$VOCO_TERMINAL_MOTION" != true || ! -t 0 ]] || ! command -v python3 >/dev/null 2>&1; then
    sudo apt-get install -y -- "$@"
    return $?
  fi
  voco_ui_release
  dim 'Ubuntu needs your permission to install VOCO.'
  sudo -v || return $?
  # Respect sudo policies that permit apt-get but not an exec wrapper. Do not ask
  # owners to broaden permissions just for presentation.
  if ! sudo -n -l -- sh -c "$wrapper" voco-apt "$@" >/dev/null 2>&1; then
    sudo apt-get install -y -- "$@"
    return $?
  fi
  voco_ui_begin 'Setting up VOCO.' 'Resolving package dependencies.'
  [[ -n "$VOCO_INSTALL_LOG" ]] || VOCO_INSTALL_LOG=$(mktemp "${TMPDIR:-/tmp}/voco-install.XXXXXX.log")
  mkfifo -m 600 "$fifo"
  exec {output_fd}<>"$fifo"
  rm -f -- "$fifo"
  # APT marks its status descriptor close-on-exec before dpkg starts. A dedicated
  # fd is essential: using stdout would close maintainer-script output. Create fd
  # 3 AFTER sudo, with a fixed wrapper and separate arguments (never interpolation).
  if sudo sh -c "$wrapper" voco-apt "$@" 2>&"$output_fd" |
      voco_apt_display "$VOCO_INSTALL_LOG" "$VOCO_UI_NO_MOTION" separate 4<&"$output_fd"; then
    result=0
  else
    statuses=("${PIPESTATUS[@]}")
    result=${statuses[0]}
    (( result != 0 )) || result=${statuses[1]}
  fi
  exec {output_fd}>&-
  voco_ui_release
  if (( result != 0 )); then
    VOCO_KEEP_LOG=true
    dim "Installation details: $VOCO_INSTALL_LOG"
  fi
  return "$result"
}

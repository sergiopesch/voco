#!/usr/bin/env bash
# Embedded into the standalone installer by sync-installer-ui.py.
# Presentation never owns the download: the foreground waits on wget itself.
VOCO_UI_PID=""
VOCO_UI_TIMER_FD=""
VOCO_UI_OPEN=false
VOCO_UI_STAGE=0
VOCO_UI_TITLE="Getting your desktop ready."
VOCO_UI_NOTE=""
VOCO_UI_NO_MOTION=false
VOCO_UI_LAST_BYTES=0
VOCO_UI_LAST_TIME=0
VOCO_UI_RATES=(0 0 0 0 0 0 0)
VOCO_UI_LINES=10
# The art canvas: a graphite card holding the microphone and the wordmark, above
# eight progress lines. Card columns: 2 padding, 14 microphone, 3 gap, 37 for the
# wordmark and text, 2 padding; 11 rows between its rounded top and bottom edges.
VOCO_UI_ART=false
VOCO_UI_ART_BUILT=false
VOCO_UI_CARD_WIDTH=58
VOCO_UI_CARD_ROWS=11
VOCO_UI_ART_RIGHT=19
VOCO_UI_PROGRESS_LINES=8
# The intro, in milliseconds after the canvas opens: a silver line crosses the
# card and leaves the microphone behind it, the letters glide in and lock, one
# shine passes, then the tagline writes itself in. It only ever paints frames;
# the installer never waits for it.
VOCO_UI_SWEEP_MS=480
VOCO_UI_GLIDE_AT=240
VOCO_UI_GLIDE_STEP=100
VOCO_UI_GLIDE_MS=360
VOCO_UI_GLIDE_COLUMNS=12
VOCO_UI_SHINE_AT=900
VOCO_UI_SHINE_MS=280
VOCO_UI_BRAND_AT=900
VOCO_UI_TODAY_AT=1050
VOCO_UI_VERSION_AT=1150
VOCO_UI_INTRO_MS=1300
VOCO_UI_INTRO_START=0
VOCO_UI_SHINE_START=0
VOCO_UI_NOW=0
VOCO_UI_CARD_TEXT=''
VOCO_UI_CARD_FINAL=''
VOCO_UI_BRAND_LINE='The voice layer for Linux.'
VOCO_UI_TODAY_LINE='Today: private dictation.'
# BEGIN GENERATED INSTALLER BRAND
VOCO_UI_GLYPHS=(
  '██    ██' ' ██████ ' ' ██████ ' ' ██████ '
  '██    ██' '██    ██' '██      ' '██    ██'
  ' ██  ██ ' '██    ██' '██      ' '██    ██'
  '  ████  ' '██    ██' '██      ' '██    ██'
  '   ██   ' ' ██████ ' ' ██████ ' ' ██████ '
)
VOCO_UI_SILVER='\033[38;2;199;204;212m'
VOCO_UI_MUTED='\033[38;2;122;128;138m'
VOCO_UI_COMPLETE='\033[38;2;165;217;178m'
VOCO_UI_ACTIVE='\033[38;2;239;206;131m'
VOCO_UI_CARD='17;19;24'
VOCO_UI_WORDMARK=('244;246;249' '233;236;240' '222;225;230' '210;214;221' '199;204;212' '188;193;202' '177;182;192' '165;172;181' '154;161;171' '143;150;161')
VOCO_UI_WORDMARK_SHINE=('255;255;255' '238;241;245')
VOCO_UI_SWEEP=('93;99;109' '225;229;236')
VOCO_UI_TEXT_BRAND='199;204;212'
VOCO_UI_TEXT_TODAY='174;181;191'
VOCO_UI_TEXT_VERSION='140;146;156'
VOCO_UI_EASE=(0 202 397 560 682 767 828 871 903 928 946 960 971 980 986 991 995 997 999 1000 1000)
# The microphone, from assets/voco-symbol.png by generate-installer-art.py.
VOCO_UI_MIC=(
  '19;20;25' '9;10;15' '50;51;55' '167;166;167' '174;171;172' '208;205;205' '177;175;174' '178;176;175' '206;203;203' '170;168;168' '170;168;170' '54;55;59' '8;9;15' '19;20;25'
  '16;17;22' '18;19;24' '180;178;179' '96;94;94' '60;58;58' '187;185;185' '50;49;49' '48;47;47' '185;182;182' '61;59;59' '99;96;96' '190;188;189' '21;22;27' '15;17;22'
  '7;8;13' '61;61;65' '178;176;176' '37;35;35' '76;75;75' '191;189;189' '65;63;63' '60;58;58' '187;185;185' '80;78;78' '36;34;34' '177;174;174' '68;68;72' '6;7;12'
  '7;8;13' '62;63;67' '177;175;175' '47;45;46' '76;74;74' '193;192;192' '65;63;63' '61;59;59' '190;189;188' '79;78;78' '45;43;43' '172;169;169' '69;69;72' '6;7;12'
  '7;8;13' '62;62;67' '176;174;174' '47;45;45' '76;74;74' '192;191;191' '64;62;63' '61;59;59' '190;188;188' '80;78;78' '45;43;43' '171;168;168' '67;67;71' '6;7;12'
  '7;8;13' '62;62;67' '175;172;172' '47;46;46' '77;76;76' '190;188;188' '63;61;62' '60;58;59' '188;185;185' '79;78;78' '46;44;44' '167;165;164' '66;66;70' '6;7;13'
  '7;8;13' '61;62;66' '172;170;170' '47;45;46' '76;74;74' '187;185;185' '64;62;62' '62;60;60' '184;182;182' '78;76;76' '45;43;44' '165;162;162' '65;65;69' '6;8;13'
  '10;11;17' '62;62;66' '168;165;165' '46;44;45' '75;73;73' '184;181;181' '62;60;61' '60;58;58' '180;178;178' '76;74;74' '45;43;44' '162;160;159' '66;66;70' '10;11;16'
  '0;0;1' '53;54;58' '165;162;162' '45;44;44' '75;73;73' '179;177;177' '61;59;59' '59;57;57' '175;172;172' '74;71;72' '44;42;42' '159;157;157' '56;56;60' '0;0;0'
  '140;139;141' '119;118;120' '151;148;148' '49;47;47' '76;74;74' '177;175;175' '62;60;60' '62;60;60' '173;171;170' '74;72;72' '47;45;46' '145;142;143' '121;120;122' '147;146;148'
  '233;231;231' '160;158;158' '140;138;138' '28;26;26' '57;55;55' '170;167;167' '40;38;38' '40;39;39' '165;163;163' '55;53;53' '29;27;27' '133;131;131' '164;162;164' '239;236;235'
  '210;208;209' '136;134;135' '168;166;166' '128;126;126' '148;147;146' '205;204;203' '140;139;138' '137;135;135' '194;193;192' '136;135;134' '117;115;115' '168;166;166' '141;139;141' '216;213;212'
  '210;208;208' '129;127;128' '182;179;179' '237;234;233' '255;255;255' '251;249;249' '246;243;243' '227;224;223' '200;197;197' '192;190;189' '183;181;180' '205;202;201' '140;138;140' '213;210;210'
  '210;207;207' '101;100;102' '138;135;136' '187;184;184' '217;215;215' '221;219;219' '201;199;199' '181;178;178' '164;161;161' '148;145;145' '143;140;141' '159;155;155' '112;110;112' '214;211;210'
  '207;205;205' '79;78;81' '134;132;133' '198;196;195' '237;235;235' '240;238;238' '222;219;219' '199;196;196' '181;178;178' '164;162;161' '161;159;159' '162;160;159' '86;85;88' '213;210;209'
  '203;200;200' '79;78;81' '117;115;116' '191;189;188' '226;224;224' '238;236;235' '222;219;219' '199;196;196' '180;177;177' '158;155;156' '174;172;171' '138;136;136' '79;79;83' '200;196;196'
  '163;161;162' '142;141;142' '34;34;38' '171;166;165' '199;196;195' '216;214;213' '201;199;199' '180;177;177' '163;160;160' '159;156;156' '177;174;173' '38;37;42' '139;138;140' '157;154;155'
  '61;61;65' '219;215;215' '75;74;78' '36;35;39' '120;117;117' '154;151;151' '168;165;165' '152;149;149' '134;131;131' '116;114;114' '37;37;40' '74;74;78' '212;209;208' '59;58;62'
  '6;7;12' '101;99;102' '218;214;214' '139;137;139' '72;72;76' '101;99;101' '208;205;205' '166;163;162' '94;92;93' '74;73;77' '135;134;136' '209;205;205' '96;94;96' '7;8;13'
  '19;20;24' '6;7;12' '63;62;66' '155;152;154' '182;179;180' '176;172;173' '237;235;235' '178;175;175' '149;146;146' '180;177;177' '143;140;141' '59;58;61' '7;8;13' '18;19;24'
  '17;18;23' '20;21;26' '5;6;12' '40;40;44' '76;75;78' '149;146;147' '243;241;241' '194;191;192' '127;125;126' '76;75;78' '45;45;49' '6;7;13' '20;21;25' '17;18;23'
  '17;18;23' '18;19;24' '14;15;21' '106;104;106' '183;179;179' '224;222;221' '221;218;218' '191;188;188' '159;156;156' '163;160;159' '123;121;122' '13;14;19' '18;19;24' '17;18;23'
)
# END GENERATED INSTALLER BRAND

voco_ui_configure() {
  local columns="${VOCO_TERMINAL_COLUMNS:-80}" rows="${VOCO_TERMINAL_ROWS:-24}"
  if [[ "${VOCO_INSTALL_PLAIN:-0}" == 1 || ! "$columns" =~ ^[0-9]+$ || "$columns" -lt 64 || ! "$rows" =~ ^[0-9]+$ || "$rows" -lt 12 ]]; then
    VOCO_TERMINAL_MOTION=false
    DIM='' GREEN='' YELLOW='' RED='' NC=''
  fi
  if [[ "${VOCO_INSTALL_NO_MOTION:-0}" == 1 ]]; then
    VOCO_UI_NO_MOTION=true
  elif [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
    if [[ "$(gsettings get org.gnome.desktop.interface enable-animations 2>/dev/null)" == false ]]; then
      VOCO_UI_NO_MOTION=true
    fi
  fi
  VOCO_UI_LINES=10
  VOCO_UI_ART=false
  # The card needs 24-bit colour and room for its 21 lines; other terminals keep
  # the compact canvas, which names VOCO in one line.
  if [[ "$VOCO_TERMINAL_MOTION" == true && "$rows" -ge 23 && "${COLORTERM:-}" =~ ^(truecolor|24bit)$ ]]; then
    VOCO_UI_ART=true
    VOCO_UI_LINES=$((VOCO_UI_CARD_ROWS + 2 + VOCO_UI_PROGRESS_LINES))
    voco_ui_art_build
  fi
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
}

voco_ui_now_ms() {
  VOCO_UI_NOW=$(( ${EPOCHREALTIME/./} / 1000 ))
}

# Every cell of the card at rest, built once from the generated brand data.
voco_ui_art_build() {
  [[ "$VOCO_UI_ART_BUILT" != true ]] || return 0
  local card=$'\e[48;2;'"$VOCO_UI_CARD"'m ' edge=$'\e[38;2;'"$VOCO_UI_CARD"';49m' r x top bottom
  VOCO_UI_CELLS=() VOCO_UI_TOP_CELLS=() VOCO_UI_BOTTOM_CELLS=() VOCO_UI_WM_LIT=() VOCO_UI_WM_GLOW=()
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    for ((x=0; x<VOCO_UI_CARD_WIDTH; x++)); do
      if (( x >= 2 && x < 16 )); then
        top=${VOCO_UI_MIC[2*r*14+x-2]} bottom=${VOCO_UI_MIC[(2*r+1)*14+x-2]}
        VOCO_UI_CELLS+=($'\e[38;2;'"$top"';48;2;'"$bottom"'m▀')
      else
        VOCO_UI_CELLS+=("$card")
      fi
    done
  done
  # Rounded edges: the card begins and ends half a cell in, on any background.
  for ((x=0; x<VOCO_UI_CARD_WIDTH; x++)); do
    if (( x == 0 )); then VOCO_UI_TOP_CELLS+=("${edge}▗") VOCO_UI_BOTTOM_CELLS+=("${edge}▝")
    elif (( x == VOCO_UI_CARD_WIDTH - 1 )); then VOCO_UI_TOP_CELLS+=("${edge}▖") VOCO_UI_BOTTOM_CELLS+=("${edge}▘")
    else VOCO_UI_TOP_CELLS+=("${edge}▄") VOCO_UI_BOTTOM_CELLS+=("${edge}▀"); fi
  done
  for ((r=0; r<5; r++)); do
    VOCO_UI_WM_LIT+=($'\e[38;2;'"${VOCO_UI_WORDMARK[2*r]}"';48;2;'"${VOCO_UI_WORDMARK[2*r+1]}"'m▀')
    VOCO_UI_WM_GLOW+=($'\e[38;2;'"${VOCO_UI_WORDMARK_SHINE[0]}"';48;2;'"${VOCO_UI_WORDMARK_SHINE[1]}"'m▀')
  done
  VOCO_UI_SWEEP_GLOW=$'\e[48;2;'"${VOCO_UI_SWEEP[0]}"'m '
  VOCO_UI_SWEEP_BAR=$'\e[48;2;'"${VOCO_UI_SWEEP[1]}"'m '
  VOCO_UI_SWEEP_TOP=$'\e[38;2;'"${VOCO_UI_SWEEP[1]}"';49m▄'
  VOCO_UI_SWEEP_BOTTOM=$'\e[38;2;'"${VOCO_UI_SWEEP[1]}"';49m▀'
  VOCO_UI_ART_BUILT=true
}

# Write TEXT's first COUNT characters into the caller's row from column FROM.
voco_ui_card_text() {
  local text="$1" color="$2" from="$3" count="$4" i
  for ((i=0; i<count && i<${#text}; i++)); do
    row[from+i]=$'\e[38;2;'"$color"';48;2;'"$VOCO_UI_CARD"'m'"${text:i:1}"
  done
}

# The card's 13 lines at T milliseconds into the intro, with the shine S
# milliseconds in, or no shine when S is negative.
voco_ui_card_at() {
  local t="$1" s="$2" IFS=
  local W=$VOCO_UI_CARD_WIDTH R=$VOCO_UI_ART_RIGHT sweep=$VOCO_UI_CARD_WIDTH band=-100 out='' line
  local r gr i c x start p offset glyph label="v${VERSION:-}" count
  local -a row
  (( t >= VOCO_UI_SWEEP_MS )) || sweep=$(( t * (W + 1) / VOCO_UI_SWEEP_MS ))
  # The shine is a slanted band, three columns wide, crossing the wordmark.
  (( s < 0 )) || band=$(( -8 + s * 51 / VOCO_UI_SHINE_MS ))
  line="${VOCO_UI_TOP_CELLS[*]:0:sweep}"
  (( sweep >= W )) || line+="$VOCO_UI_SWEEP_TOP"
  out+=$'\r\e[K  '"$line"$'\e[0m\n'
  for ((r=0; r<VOCO_UI_CARD_ROWS; r++)); do
    row=("${VOCO_UI_CELLS[@]:r*W:W}")
    if (( r == 0 && t >= VOCO_UI_VERSION_AT )); then
      voco_ui_card_text "$label" "$VOCO_UI_TEXT_VERSION" $((R + 37 - ${#label})) "${#label}"
    elif (( r >= 2 && r <= 6 )); then
      gr=$((r - 2))
      for ((i=0; i<4; i++)); do
        start=$((VOCO_UI_GLIDE_AT + i * VOCO_UI_GLIDE_STEP))
        (( t >= start )) || continue
        p=$(( (t - start) * 20 / VOCO_UI_GLIDE_MS )); (( p <= 20 )) || p=20
        offset=$(( VOCO_UI_GLIDE_COLUMNS * (1000 - VOCO_UI_EASE[p]) / 1000 ))
        glyph=${VOCO_UI_GLYPHS[gr*4+i]}
        for ((c=0; c<8; c++)); do
          [[ "${glyph:c:1}" == '█' ]] || continue
          x=$((R + i * 9 + offset + c))
          (( x < W - 2 )) || continue
          if (( x - R >= band + 4 - gr && x - R < band + 7 - gr )); then row[x]=${VOCO_UI_WM_GLOW[gr]}
          else row[x]=${VOCO_UI_WM_LIT[gr]}; fi
        done
      done
    elif (( r == 8 && t > VOCO_UI_BRAND_AT )); then
      count=$(( (t - VOCO_UI_BRAND_AT) / 10 ))
      voco_ui_card_text "$VOCO_UI_BRAND_LINE" "$VOCO_UI_TEXT_BRAND" "$R" "$count"
    elif (( r == 9 && t > VOCO_UI_TODAY_AT )); then
      count=$(( (t - VOCO_UI_TODAY_AT) / 10 ))
      voco_ui_card_text "$VOCO_UI_TODAY_LINE" "$VOCO_UI_TEXT_TODAY" "$R" "$count"
    fi
    if (( sweep < W )); then
      (( sweep < 1 )) || row[sweep-1]=$VOCO_UI_SWEEP_GLOW
      line="${row[*]:0:sweep}$VOCO_UI_SWEEP_BAR"
    else
      line="${row[*]}"
    fi
    out+=$'\r\e[K  '"$line"$'\e[0m\n'
  done
  line="${VOCO_UI_BOTTOM_CELLS[*]:0:sweep}"
  (( sweep >= W )) || line+="$VOCO_UI_SWEEP_BOTTOM"
  out+=$'\r\e[K  '"$line"$'\e[0m\n'
  VOCO_UI_CARD_TEXT=$out
}

# The card for now: its final state once the intro and any shine are done.
voco_ui_card() {
  local t=$VOCO_UI_INTRO_MS s=-1
  if [[ "$VOCO_UI_NO_MOTION" != true ]]; then
    voco_ui_now_ms
    if (( VOCO_UI_INTRO_START > 0 && VOCO_UI_NOW - VOCO_UI_INTRO_START < VOCO_UI_INTRO_MS )); then
      t=$((VOCO_UI_NOW - VOCO_UI_INTRO_START))
    fi
    if (( t >= VOCO_UI_SHINE_AT && t < VOCO_UI_SHINE_AT + VOCO_UI_SHINE_MS )); then
      s=$((t - VOCO_UI_SHINE_AT))
    elif (( VOCO_UI_SHINE_START > 0 && VOCO_UI_NOW - VOCO_UI_SHINE_START < VOCO_UI_SHINE_MS )); then
      s=$((VOCO_UI_NOW - VOCO_UI_SHINE_START))
    fi
  fi
  if (( t >= VOCO_UI_INTRO_MS && s < 0 )) && [[ -n "$VOCO_UI_CARD_FINAL" ]]; then
    VOCO_UI_CARD_TEXT=$VOCO_UI_CARD_FINAL
    return
  fi
  voco_ui_card_at "$t" "$s"
  if (( t >= VOCO_UI_INTRO_MS && s < 0 )); then VOCO_UI_CARD_FINAL=$VOCO_UI_CARD_TEXT; fi
}

# True while the intro or a shine is still moving.
voco_ui_animating() {
  [[ "$VOCO_UI_ART" == true && "$VOCO_UI_NO_MOTION" != true ]] || return 1
  voco_ui_now_ms
  (( (VOCO_UI_INTRO_START > 0 && VOCO_UI_NOW - VOCO_UI_INTRO_START < VOCO_UI_INTRO_MS) ||
     (VOCO_UI_SHINE_START > 0 && VOCO_UI_NOW - VOCO_UI_SHINE_START < VOCO_UI_SHINE_MS) ))
}

voco_ui_init() {
  voco_ui_configure
  [[ "$VOCO_TERMINAL_MOTION" == true && -z "$VOCO_UI_TIMER_FD" ]] || return 0
  # An owned, unlinked FIFO gives read -t a timer without a sleep subprocess. It
  # lives in its own private directory, so the intro can play before downloads.
  local folder
  folder=$(mktemp -d) || return 0
  if mkfifo -m 600 "$folder/ui-timer"; then exec {VOCO_UI_TIMER_FD}<>"$folder/ui-timer"; fi
  rm -rf -- "$folder"
}

voco_ui_size() {
  local bytes="$1" unit=KiB divisor=1024
  if (( bytes >= 1048576 )); then unit=MiB; divisor=1048576; fi
  printf -v VOCO_UI_SIZE '%d.%d %s' "$((bytes/divisor))" "$((bytes%divisor*10/divisor))" "$unit"
}

# One bounded canvas is shared by every normal installation stage. With
# "progress" as the fourth argument a resting card stays as it is on screen and
# only the progress lines are drawn again.
voco_ui_frame() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  local title="$1" detail="$2" mark="${3:-—}" card="${4:-full}" width i color
  local stages='' frame='' part='' symbol line2='' rule='────────────────────────────────────────────────────────'
  local -a labels=(Check Download Verify Install)
  width=$((${VOCO_TERMINAL_COLUMNS:-80}-5))
  if (( ${#detail} > width )); then
    local first="${detail:0:width}"
    if [[ "$first" == *' '* ]]; then first="${first% *}"; fi
    line2="${detail:${#first}}"; line2="${line2# }"; detail="$first"
  fi
  for i in 0 1 2 3; do
    symbol='○'; color="$VOCO_UI_MUTED"
    if (( i < VOCO_UI_STAGE )); then symbol='✓'; color="$VOCO_UI_COMPLETE"
    elif (( i == VOCO_UI_STAGE )); then symbol='›'; color="$VOCO_UI_ACTIVE"; fi
    stages+="${color}${symbol} ${labels[i]}${NC}   "
  done
  if [[ "$VOCO_UI_ART" == true && "$card" == progress ]] && ! voco_ui_animating; then
    printf -v frame '\033[%dA' "$VOCO_UI_PROGRESS_LINES"
  elif [[ "$VOCO_UI_ART" == true ]]; then
    printf -v frame '\033[%dA' "$VOCO_UI_LINES"
    voco_ui_card
    frame+="$VOCO_UI_CARD_TEXT"
  else
    printf -v frame '\033[%dA' "$VOCO_UI_LINES"
    printf -v part '\r\033[K  %bV O C O%b  v%s\n\r\033[K  The voice layer for Linux. Today: private dictation.\n' "$VOCO_UI_SILVER" "$NC" "${VERSION:-}"
    frame+="$part"
  fi
  color="$VOCO_UI_SILVER"
  [[ "$mark" != '✓' ]] || color="$VOCO_UI_COMPLETE"
  printf -v part '\r\033[K\n\r\033[K  %b%s%b\n\r\033[K  %s\n\r\033[K  %s\n\r\033[K  %s\n\r\033[K  %s\n\r\033[K  %b\n\r\033[K  %s\n' \
    "$color" "$mark" "$NC" "${title:0:width}" "$detail" "${line2:0:width}" "${rule:0:width}" "$stages" "${VOCO_UI_NOTE:0:width}"
  frame+="$part"
  # A terminating sweep may stop while building the frame, but must never leave
  # the cursor between rows. Bash runs the termination trap after this builtin.
  printf '%s' "$frame"
}

voco_ui_begin() {
  [[ "$VOCO_TERMINAL_MOTION" == true ]] || return 0
  voco_ui_pause
  if [[ "$VOCO_UI_OPEN" != true ]]; then
    local line
    for ((line=0;line<VOCO_UI_LINES;line++)); do printf '\n'; done
    VOCO_UI_OPEN=true
    # The intro plays once, the first time the canvas opens.
    if [[ "$VOCO_UI_ART" == true && "$VOCO_UI_NO_MOTION" != true ]] && (( VOCO_UI_INTRO_START == 0 )); then
      voco_ui_now_ms
      VOCO_UI_INTRO_START=$VOCO_UI_NOW
    fi
  fi
  VOCO_UI_TITLE="$1"
  voco_ui_frame "$1" "${2:-}" "${3:-—}"
}

# Keep the intro or a shine moving after a frame: about 30 frames a second, in the
# background, until both are done. Every foreground frame pauses it first.
voco_ui_animate() {
  [[ -n "$VOCO_UI_TIMER_FD" ]] && voco_ui_animating || return 0
  (
    trap - EXIT
    trap 'exit 0' TERM INT
    while voco_ui_animating; do
      voco_ui_frame "$1" "$2" "$3"
      IFS= read -r -t .033 -u "$VOCO_UI_TIMER_FD" _ || true
    done
    voco_ui_frame "$1" "$2" "$3"
  ) &
  VOCO_UI_PID=$!
}

# End any intro or shine now, so the next frame shows the card at rest. The last
# frame of a fast install uses this instead of waiting for the intro.
voco_ui_settle() {
  voco_ui_pause
  VOCO_UI_INTRO_START=1 VOCO_UI_SHINE_START=0
}

# A foreground frame that leaves any intro or shine still moving.
voco_ui_show() {
  voco_ui_pause
  voco_ui_frame "$1" "$2" "${3:-—}"
  voco_ui_animate "$1" "$2" "${3:-—}"
}

voco_ui_stage() {
  VOCO_UI_STAGE="$1"
  if [[ "$VOCO_TERMINAL_MOTION" == true ]]; then
    if [[ -n "$VOCO_UI_TIMER_FD" ]]; then voco_ui_sweep "$2" "${3:-}"; else voco_ui_begin "$2" "${3:-}"; fi
  else
    dim "$2"
    [[ -z "${3:-}" ]] || dim "$3"
  fi
}

voco_ui_sweep() {
  voco_ui_begin "$1" "$2"
  [[ "$VOCO_TERMINAL_MOTION" == true && "$VOCO_UI_NO_MOTION" != true ]] || return 0
  voco_ui_now_ms
  # Each stage lights the wordmark once, unless the intro is still playing.
  if (( VOCO_UI_INTRO_START == 0 || VOCO_UI_NOW - VOCO_UI_INTRO_START >= VOCO_UI_INTRO_MS )); then
    VOCO_UI_SHINE_START=$VOCO_UI_NOW
  fi
  voco_ui_animate "$1" "$2" '—'
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
  if [[ "$VOCO_UI_OPEN" == true ]]; then
    printf '\033[%dA' "$VOCO_UI_LINES"
    local line
    for ((line=0;line<VOCO_UI_LINES;line++)); do printf '\r\033[K\n'; done
    printf '\033[%dA\r' "$VOCO_UI_LINES"
  fi
  VOCO_UI_OPEN=false
}

voco_ui_download_observer() {
  trap - EXIT
  trap 'exit 0' TERM INT
  local destination="$1" start="$2" bytes=0 now delta rate elapsed mark='' detail='' sampled=0 card=full
  local glyphs=(▁ ▂ ▃ ▄ ▅ ▆ ▇ █) value
  VOCO_UI_LAST_BYTES=0
  VOCO_UI_LAST_TIME=${EPOCHREALTIME/./}
  voco_ui_now_ms
  # The download lights the wordmark once, unless the intro is still playing.
  if [[ "$VOCO_UI_NO_MOTION" != true ]] && (( VOCO_UI_INTRO_START == 0 || VOCO_UI_NOW - VOCO_UI_INTRO_START >= VOCO_UI_INTRO_MS )); then
    VOCO_UI_SHINE_START=$VOCO_UI_NOW
  fi
  while :; do
    now=${EPOCHREALTIME/./}
    # Sample at 4 Hz, whatever the frame rate; only shell builtins run between samples.
    if (( now - sampled >= 250000 )); then
      sampled=$now
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
        voco_ui_size "$((bytes/elapsed))"; detail+=" · $VOCO_UI_SIZE/s avg"
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
    if voco_ui_animating; then
      voco_ui_frame 'Bringing VOCO to your desktop.' "$detail" "$mark"
      card=full
      IFS= read -r -t .033 -u "$VOCO_UI_TIMER_FD" _ || true
    else
      # Once the card has drawn at rest, it stays on screen untouched.
      voco_ui_frame 'Bringing VOCO to your desktop.' "$detail" "$mark" "$card"
      card=progress
      IFS= read -r -t .25 -u "$VOCO_UI_TIMER_FD" _ || true
    fi
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
    voco_ui_release
    sudo apt-get install -y -- "$@"
    return $?
  fi
  if ! sudo -n -v >/dev/null 2>&1; then
    voco_ui_release
    dim 'VOCO · Ubuntu needs your permission to install.'
    sudo -v || return $?
  fi
  # Respect sudo policies that permit apt-get but not an exec wrapper. Do not ask
  # owners to broaden permissions just for presentation.
  if ! sudo -n -l -- sh -c "$wrapper" voco-apt "$@" >/dev/null 2>&1; then
    voco_ui_release
    sudo apt-get install -y -- "$@"
    return $?
  fi
  voco_ui_release
  # The APT renderer owns and clears its canvas, including prompt handoffs.
  [[ -n "$VOCO_INSTALL_LOG" ]] || VOCO_INSTALL_LOG=$(mktemp "${TMPDIR:-/tmp}/voco-install.XXXXXX.log")
  mkfifo -m 600 "$fifo"
  exec {output_fd}<>"$fifo"
  rm -f -- "$fifo"
  # APT marks its status descriptor close-on-exec before dpkg starts. A dedicated
  # fd is essential: using stdout would close maintainer-script output. Create fd
  # 3 AFTER sudo, with a fixed wrapper and separate arguments (never interpolation).
  if sudo sh -c "$wrapper" voco-apt "$@" 2>&"$output_fd" |
      voco_apt_display "$VOCO_INSTALL_LOG" "$VOCO_UI_NO_MOTION" separate "${VERSION:-}" "$VOCO_UI_LINES" 4<&"$output_fd"; then
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

voco_run_dnf() {
  # DNF keeps its own presentation, prompts included; VOCO only hands it a
  # clear terminal and says who is asking for the password.
  voco_ui_release
  if ! sudo -n -v >/dev/null 2>&1; then
    dim 'VOCO · Fedora needs your permission to install.'
  fi
  sudo dnf install -y -- "$@"
}

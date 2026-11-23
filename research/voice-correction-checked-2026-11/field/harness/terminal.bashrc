# rcfile for the terminal cases: a plain prompt, no history file, and one key
# (Ctrl+X Ctrl+P) that writes readline's own line and caret to a file, so the
# harness can read the prompt line without AT-SPI and without running it.
PS1='$ '
unset HISTFILE
__field_ladder_dump() {
  printf '%s\n%s' "$READLINE_POINT" "$READLINE_LINE" > "$FIELD_LADDER_DUMP.tmp"
  mv "$FIELD_LADDER_DUMP.tmp" "$FIELD_LADDER_DUMP"
}
bind -x '"\C-x\C-p": __field_ladder_dump'

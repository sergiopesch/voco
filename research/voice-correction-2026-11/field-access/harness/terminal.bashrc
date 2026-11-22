# rcfile for the terminal cases: a plain prompt, no history file, and one key
# (Ctrl+X Ctrl+P) that writes readline's own line and caret to a file, so the
# harness can read the prompt line without AT-SPI and without running it.
PS1='$ '
unset HISTFILE
__field_access_dump() {
  printf '%s\n%s' "$READLINE_POINT" "$READLINE_LINE" > "$FIELD_ACCESS_DUMP.tmp"
  mv "$FIELD_ACCESS_DUMP.tmp" "$FIELD_ACCESS_DUMP"
}
bind -x '"\C-x\C-p": __field_access_dump'

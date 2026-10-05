# Give the active session its /dev/uinput access now rather than at the next
# boot, as the Debian postinst does. Best effort: containers and chroots have
# no udev to ask, and nothing here can fail the installation.
/usr/bin/timeout 10 /usr/sbin/modprobe uinput >/dev/null 2>&1 || :
/usr/bin/timeout 10 /usr/bin/udevadm control --reload-rules >/dev/null 2>&1 || :
/usr/bin/timeout 10 /usr/bin/udevadm trigger --action=change --subsystem-match=misc --sysname-match=uinput >/dev/null 2>&1 || :

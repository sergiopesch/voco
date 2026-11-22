A=$(gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress | sed "s/^('//; s/',)$//")
echo "addr $A"; echo "xprop: $(xprop -root AT_SPI_BUS 2>&1)"
for n in $(gdbus call --address "$A" --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.ListNames | tr -d "(['])" | tr ',' ' '); do
  case $n in :*) 
   pid=$(gdbus call --address "$A" --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.GetConnectionUnixProcessID $n 2>&1)
   tk=$(gdbus call --address "$A" --dest $n --object-path /org/a11y/atspi/accessible/root --method org.freedesktop.DBus.Properties.Get org.a11y.atspi.Application ToolkitName 2>&1 | head -1)
   cc=$(gdbus call --address "$A" --dest $n --object-path /org/a11y/atspi/accessible/root --method org.freedesktop.DBus.Properties.Get org.a11y.atspi.Accessible ChildCount 2>&1 | head -1)
   echo "$n pid=$pid comm=$(cat /proc/$(echo $pid | tr -dc 0-9)/comm 2>/dev/null) toolkit=$tk childcount=$cc";;
  esac
done
echo "registry children:"; gdbus call --address "$A" --dest org.a11y.atspi.Registry --object-path /org/a11y/atspi/accessible/root --method org.a11y.atspi.Accessible.GetChildren

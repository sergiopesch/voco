# Design

Inside VOCO looks like VOCO: the silver microphone and Geist type on a white
canvas. Graphite is the main ink and a lighter graphite the secondary text. Pale
silver panels and silver lines set the interactive parts apart, and rounded
panels echo the app. There are no accent colors.

## Layout

- The left rail holds the VOCO mark, one search box for chapters and files, the
  numbered chapter list, links to all source files and the glossary, and
  reading progress. The rail stays in place, and its chapter list scrolls on
  its own.
- A utility strip shows the source version and that the guide runs only on this
  computer.
- A chapter reads from top to bottom: the title and a short intro, the
  five-step journey, the plain story beside its code links, the facts under
  "What really happens", then any table or simulation, the caution under "Keep
  this distinction", and the quiz.
- On wide screens the story and the code links sit side by side. At 780 px and
  below they stack, and the chapter list becomes a drawer behind a Chapters
  button. A closed drawer is hidden from keyboard and screen-reader navigation.

## Chapters

There are 20 chapters, in reading order: The big picture, Meet the languages,
Pressing the shortcut, Listening to sound, The phrase queue, The speech worker,
From sounds to words, Words at the cursor, Finishing at Stop, Safe recovery,
Interface and settings, Linux integration, Privacy and security, Performance and
logs, Testing the promises, Building and shipping, Borrowed libraries, Reading
the code, A microphone in the top bar, and Desktops and helpers.

Desktops and helpers adds a table, "Which helper does each job". Its rows are
GNOME on Wayland, other Wayland desktops, X11 and the IBus input source, and its
columns are the shortcut, the keys and the clipboard helper. The table
sits in a keyboard-focusable scroll region, so on a narrow screen it scrolls
sideways inside its own frame instead of widening the page. Its scope and limits
sit above and below it.

## Interaction

- Every chapter's journey has five step buttons, a Next step button and a Play
  button. Play moves one step every 1.7 seconds, turns into Pause while it runs,
  and stops at the last step.
- Seven chapters add one of five teaching simulations: audio samples and the
  top-bar meter, the packet queue, worker messages, a paste decision, and where a
  stopwatch starts. Each is labelled as a teaching simulation that uses no
  microphone, model or other app.
- Code opens in a dialog inside the guide, with line numbers, the commit and a
  list of functions and types to jump to. It never launches an editor.
- A quiz answer gets immediate feedback with an explanation.

## Accessibility and motion

- A skip link jumps to the chapter. Controls are real buttons, links and form
  fields, and keyboard focus shows a visible outline.
- Transitions run only when the system allows motion. The journey moves only
  after Play, and it stops at the last step.
- When the system asks for more contrast, secondary text and lines darken. A
  print style hides navigation and controls.

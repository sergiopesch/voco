"""Read focus metadata and ephemeral, bounded delivery context; never log field text."""
import hashlib
import json
import sys
import time
import uuid
from pathlib import Path

TERMINALS = {"ghostty", "gnome-terminal-server", "kgx", "konsole", "kitty", "alacritty", "wezterm-gui", "xfce4-terminal", "tilix", "xterm", "foot", "terminator"}


class FocusTracker:
    """Events invalidate identity; a retained object is only a hint for a fresh query."""
    def __init__(self):
        self.generation = 0
        self.key = None
        self.hint = None
        self.listener = None
        self.attempted = False
        self.nonce = uuid.uuid4().hex
        self.departure_pending = False

    def observe(self, node):
        key = (node.get_process_id(), node.path)
        if key != self.key:
            self.generation += 1
            self.key = key
        self.hint = node

    def event(self, event, *_):
        try:
            if event.detail1:
                owner = popup_focus_owner(event.source)
                if self.departure_pending:
                    if owner is None or self.key != (owner.get_process_id(), owner.path):
                        self.invalidate()
                    self.departure_pending = False
                self.observe(owner or event.source)
            elif self.key == (event.source.get_process_id(), event.source.path):
                # Chromium-derived controls can emit owner loss then suggestion
                # gain in one batch while keyboard focus stays in the entry.
                self.departure_pending = True
        except Exception:
            self.invalidate()

    def invalidate(self):
        self.generation += 1
        self.key = self.hint = None
        self.departure_pending = False

    def settle_events(self):
        if self.departure_pending:
            self.invalidate()

    def start(self, atspi):
        if self.attempted:
            return
        self.attempted = True
        try:
            listener = atspi.EventListener.new(self.event)
            if listener.register('object:state-changed:focused'):
                self.listener = listener
        except Exception:
            pass  # Fresh tree discovery still works; diagnostics expose the gap.

    def focused_hint(self, window, pid, atspi):
        node = self.hint
        if node is None:
            return None
        try:
            node.clear_cache_single()
            if node.get_process_id() != pid or node.path == window.path:
                return None
            if not node.get_state_set().contains(atspi.StateType.FOCUSED):
                return None
            parent = node
            for _ in range(32):
                parent.clear_cache_single()
                if parent.get_process_id() != pid:
                    return None
                if parent.path == window.path:
                    return node
                child = parent
                index = child.get_index_in_parent()
                parent = child.get_parent()
                if parent is None or index < 0:
                    break
                parent.clear_cache_single()
                if parent.get_child_at_index(index).path != child.path:
                    return None
        except Exception:
            pass
        return None


TRACKER = FocusTracker()


def relation_targets(node, kind):
    relations = node.get_relation_set()
    if len(relations) > 8:
        raise ValueError('Unbounded accessibility relationships')
    targets = []
    for relation in relations:
        if relation.get_relation_type() != kind:
            continue
        count = relation.get_n_targets()
        if count < 0 or len(targets) + count > 8:
            raise ValueError('Unbounded accessibility targets')
        targets.extend(relation.get_target(i) for i in range(count))
    return targets


def popup_focus_owner(source):
    """Suggestion focus can represent an editable controller, not keyboard departure."""
    try:
        import gi
        gi.require_version('Atspi', '2.0')
        from gi.repository import Atspi
        source.clear_cache_single()
        # A real editable child (such as a popup search box) owns its own focus.
        if (source.get_role() == Atspi.Role.PASSWORD_TEXT
                or source.get_state_set().contains(Atspi.StateType.EDITABLE)):
            return None
        pid = source.get_process_id()
        popup = source
        for _ in range(8):
            popup.clear_cache_single()
            if popup.get_process_id() != pid:
                return None
            owners = relation_targets(popup, Atspi.RelationType.POPUP_FOR)
            if owners:
                if len(owners) != 1:
                    return None
                owner = owners[0]
                owner.clear_cache_single()
                if owner.get_process_id() != pid or cursor_state(owner, Atspi) != 'editable':
                    return None
                controlled = relation_targets(owner, Atspi.RelationType.CONTROLLER_FOR)
                if any(target.get_process_id() == pid and target.path == popup.path for target in controlled):
                    # focused_hint still verifies the active window and live ancestry.
                    # Actual owner loss events continue to advance the generation.
                    return owner
                return None
            index = popup.get_index_in_parent()
            parent = popup.get_parent()
            if parent is None or index < 0:
                return None
            parent.clear_cache_single()
            if parent.get_child_at_index(index).path != popup.path:
                return None
            popup = parent
    except Exception:
        pass
    return None


def unavailable(input_state="unavailable", reason="probe_failed"):
    return {"shortcut": "ctrl+v", "token": None, "scope": "unavailable", "input_state": input_state, "reason": reason,
            "events_tracked": TRACKER.listener is not None}


def cursor_state(node, atspi):
    """Classify the actual focused control without reading any field contents."""
    if node is None:
        return "unavailable"
    try:
        node.clear_cache_single()
        state = node.get_state_set()
        if not state.contains(atspi.StateType.FOCUSED):
            return "none"
        role = node.get_role()
        if role == atspi.Role.PASSWORD_TEXT:
            return "protected"
        if role == atspi.Role.TERMINAL or state.contains(atspi.StateType.EDITABLE):
            # A writable field must expose a valid caret, including an empty field.
            text_position(node)
            return "editable"
        return "none"
    except Exception:
        return "unavailable"


def process_binary(pid):
    try:
        return Path(f"/proc/{pid}/exe").resolve(strict=True).name
    except OSError:
        return ""


def probe():
    import gi
    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi, GLib
    Atspi.set_timeout(80, 80)
    TRACKER.start(Atspi)
    context = GLib.MainContext.default()
    # Hiding a WebKit setup window on GNOME can queue nearly 1000 events.
    # Bound both work and elapsed time; never bind through an unsettled queue.
    drain_deadline = time.monotonic() + .05
    for _ in range(4096):
        if not context.pending():
            break
        if time.monotonic() >= drain_deadline:
            return unavailable(reason="events_pending")
        context.iteration(False)
    if context.pending():
        return unavailable(reason="events_pending")  # Never bind through an event backlog.
    TRACKER.settle_events()
    desktop = Atspi.get_desktop(0)
    desktop.clear_cache_single()
    active = []
    for i in range(min(desktop.get_child_count(), 128)):
        app = desktop.get_child_at_index(i)
        try:
            app.clear_cache_single()
            for j in range(min(max(app.get_child_count(), 0), 20)):
                window = app.get_child_at_index(j)
                window.clear_cache_single()
                if window.get_state_set().contains(Atspi.StateType.ACTIVE):
                    # GNOME X11 exports the active client and its server-side
                    # decoration as separate accessible applications. The frame
                    # service is not a dictation destination. Unknown processes
                    # still count, so real ambiguity remains a rejection.
                    if process_binary(app.get_process_id()) != "mutter-x11-frames":
                        active.append((app, window))
        except Exception:
            continue
    if len(active) != 1:
        return unavailable("none" if not active else "unavailable",
                           "no_active_window" if not active else "ambiguous_windows")
    app, window = active[0]
    pid = app.get_process_id()
    binary = process_binary(pid)
    terminal = binary in TERMINALS
    focused = TRACKER.focused_hint(window, pid, Atspi)
    # WebKit reports focused wrappers as well as the actual input. A retained
    # noneditable wrapper is a search root, never proof of an editable caret.
    search_root = focused or window
    hint_is_input = focused is not None and (
        focused.get_role() in (Atspi.Role.PASSWORD_TEXT, Atspi.Role.TERMINAL)
        or focused.get_state_set().contains(Atspi.StateType.EDITABLE))
    pending = [] if hint_is_input else [search_root]
    visited = 0
    discovered = len(pending)
    while pending and visited < 128:
        node = pending.pop()
        visited += 1
        try:
            node.clear_cache_single()
            state = node.get_state_set()
            terminal = terminal or node.get_role() == Atspi.Role.TERMINAL
            if node.path != window.path and state.contains(Atspi.StateType.FOCUSED):
                focused = node
                if (node.get_role() in (Atspi.Role.PASSWORD_TEXT, Atspi.Role.TERMINAL)
                        or state.contains(Atspi.StateType.EDITABLE)):
                    break
            # Bound total child discovery, rather than truncating every container
            # to 30 children. Some toolkits emit no focus event for a control
            # until an accessibility client has first discovered that object.
            for j in range(min(max(node.get_child_count(), 0), 128 - discovered)):
                pending.append(node.get_child_at_index(j))
                discovered += 1
        except Exception:
            continue
    if focused is not None:
        TRACKER.observe(focused)
        terminal = terminal or focused.get_role() == Atspi.Role.TERMINAL
    input_state = cursor_state(focused, Atspi)
    if input_state != "editable":
        reason = "no_focused_control" if focused is None else {
            "none": "not_editable", "protected": "protected",
        }.get(input_state, "control_unavailable")
        return unavailable(input_state, reason)
    focused_path = focused.path if focused is not None else ''
    identity = f"{TRACKER.nonce}:{TRACKER.generation}:{pid}:{window.path}:{focused_path}"
    return {"shortcut": "ctrl+shift+v" if terminal else "ctrl+v",
            "token": hashlib.sha256(identity.encode()).hexdigest(),
            "scope": "control", "input_state": input_state, "reason": "ready",
            "events_tracked": TRACKER.listener is not None}


def safe_probe():
    try:
        return probe()
    except Exception:
        return unavailable()


# One bounded, ephemeral observation; never exported as text or a content hash.
DELIVERY = None
MAX_TEXT_BYTES = 100_000
MAX_REQUEST_BYTES = 650_000


class InconsistentPosition(ValueError):
    """Individual accessibility replies did not form a valid position sample."""


class UnsupportedRichText(ValueError):
    """A nested caret cannot be observed within the bounded delivery contract."""


class InconsistentText(ValueError):
    """A bounded text reply did not match its requested character range."""


def text_position(node):
    """AT-SPI offsets are Unicode character offsets, not UTF-8 byte offsets."""
    from gi.repository import Atspi
    text = node.get_text_iface()
    if text is None:
        raise ValueError('text unavailable')
    # Accessible shadows get_text/get_selection with unrelated no-argument
    # accessors. Dispatch through Text explicitly, as required by real GI objects.
    count = Atspi.Text.get_character_count(text)
    caret = Atspi.Text.get_caret_offset(text)
    selections = Atspi.Text.get_n_selections(text)
    if not (type(count) is int and type(caret) is int and 0 <= caret <= count <= 2**31 - 1):
        raise InconsistentPosition('invalid offsets')
    if selections == 0:
        return text, (count, caret, caret, caret, False)
    if selections != 1:
        raise ValueError('multiple selections')
    try:
        selected = Atspi.Text.get_selection(text, 0)
        start, end = selected.start_offset, selected.end_offset
    except Exception as error:
        # The selection can disappear between n_selections and get_selection.
        raise InconsistentPosition('selection changed during query') from error
    if not (type(start) is int and type(end) is int and 0 <= start < end <= count and caret in (start, end)):
        raise InconsistentPosition('invalid selection')
    return text, (count, caret, start, end, True)


def read_slice(text, start, end):
    from gi.repository import Atspi
    value = Atspi.Text.get_text(text, start, end)
    if not isinstance(value, str) or len(value) != end - start:
        raise InconsistentText('inconsistent character offsets')
    # Also rejects surrogate values before any content is retained.
    value.encode('utf-8')
    return value


def paragraph_position(node, iface, position):
    """Exclude trailing editor scaffolding from the paragraph's text region.

    Chromium may expose a final BR and noneditable placeholder widgets that
    disappear on input. They cannot acknowledge a paste. Retain the real caret,
    selection and all preceding text; inspect at most eight trailing objects.
    """
    from gi.repository import Atspi
    count, caret, start, end, selected = position
    for _ in range(8):
        if count <= max(caret, end):
            break
        last = read_slice(iface, count - 1, count)
        if last == '\n':
            count -= 1
            break
        if last != '\ufffc':
            break
        hypertext = node.get_hypertext_iface()
        index = Atspi.Hypertext.get_link_index(hypertext, count - 1)
        if index < 0:
            raise UnsupportedRichText('unresolved trailing object')
        link = Atspi.Hypertext.get_link(hypertext, index)
        child = link.get_object(0)
        if (link.get_start_index() != count - 1 or link.get_end_index() != count
                or child is None or child.get_process_id() != node.get_process_id()
                or child.get_parent().path != node.path):
            raise UnsupportedRichText('invalid trailing object')
        child.clear_cache_single()
        if child.get_state_set().contains(Atspi.StateType.EDITABLE):
            break
        count -= 1
    else:
        raise UnsupportedRichText('too many trailing objects')
    return count, caret, start, end, selected


def caret_text(node, route=()):
    """Follow only the caret's hypertext links, never scan a growing document.

    Chromium exposes an editable root whose text consists of U+FFFC objects;
    the actual caret and characters belong to a linked paragraph. Bind that
    route as well as the outer focused control. No descendant can authorize
    insertion independently of the focused control.
    """
    from gi.repository import Atspi
    if len(route) >= 8:
        raise UnsupportedRichText('embedded text depth exceeded')
    node.clear_cache_single()
    iface, position = text_position(node)
    count, caret, start, end, selected = position
    offset = start if selected else min(caret, max(0, count - 1))
    hypertext = node.get_hypertext_iface() if count else None
    index = Atspi.Hypertext.get_link_index(hypertext, offset) if hypertext is not None else -1
    if index < 0:
        # An HTML block can expose its text directly (for example <div><br>
        # </div>) instead of through a paragraph link. Chromium removes that
        # empty BR on first input in either shape. Textareas and native text
        # controls retain literal newlines and must not use this normalization.
        paragraph = bool(route) and node.get_role_name() == 'paragraph'
        html_block = False
        if not paragraph and count > max(caret, end):
            try:
                html_block = (node.get_attributes() or {}).get('tag') in ('div', 'p')
            except Exception:
                pass  # Missing HTML metadata keeps the stricter literal-text readback.
        if paragraph or html_block:
            position = paragraph_position(node, iface, position)
        return node, iface, position, route
    try:
        link = Atspi.Hypertext.get_link(hypertext, index)
        left, right = link.get_start_index(), link.get_end_index()
        if (left != offset or right != offset + 1
                or selected and (start != left or end != right)):
            raise UnsupportedRichText('selection spans embedded content')
        child = link.get_object(0)
        if child is None or child.get_process_id() != node.get_process_id():
            raise UnsupportedRichText('unavailable embedded text')
        parent = child.get_parent()
        if parent is None or parent.path != node.path:
            raise UnsupportedRichText('detached embedded text')
        identity = (node.path, offset, child.path)
        if identity in route:
            raise UnsupportedRichText('cyclic embedded text')
        child.clear_cache_single()
        if (not child.get_state_set().contains(Atspi.StateType.EDITABLE)
                or child.get_role() in (Atspi.Role.PASSWORD_TEXT, Atspi.Role.TERMINAL)):
            raise UnsupportedRichText('noneditable embedded caret')
        return caret_text(child, (*route, identity))
    except InconsistentPosition:
        raise  # A torn position stays pending after dispatch, never a receipt.
    except Exception as error:
        raise UnsupportedRichText('unavailable embedded caret') from error


def eligible_node(result):
    from gi.repository import Atspi
    node = TRACKER.hint
    if result['scope'] != 'control' or result['shortcut'] != 'ctrl+v' or node is None:
        raise ValueError('unavailable control')
    node.clear_cache_single()
    state = node.get_state_set()
    if (not state.contains(Atspi.StateType.FOCUSED) or not state.contains(Atspi.StateType.EDITABLE)
            or node.get_role() in (Atspi.Role.PASSWORD_TEXT, Atspi.Role.TERMINAL)):
        raise ValueError('ineligible control')
    return node


def separator_context(node, before, position):
    count, caret, start, end, selected = position
    if selected:
        return 'selection'
    if caret != count:
        return 'inside-field'
    if not before:
        return 'empty'
    if before[-1].isspace():
        return 'whitespace'
    # Exclude known machine-oriented input purposes without reading names/titles.
    attributes = node.get_attributes() or {}
    for key in ('text-input-type', 'input-type', 'type', 'input-purpose'):
        purpose = str(attributes.get(key, '')).lower()
        if purpose and purpose not in ('text', 'search', 'free-form', 'free_form'):
            return 'non-prose'
    # A conservative sentence-ending heuristic, not a general prose classifier.
    # Require a prose word boundary or a capitalized alphabetic sentence; exclude URL/path/email/code punctuation,
    # and never infer a separator after an arbitrary token or decimal fragment.
    if any(ch in before for ch in '/\\@:=<>[]{}_`'):
        return 'non-prose'
    if before[-1] not in '.!?':
        return 'non-sentence'
    words = before[:-1].split()
    single_sentence = (len(words) == 1 and words[0].isalpha() and words[0][0].isupper())
    if (len(words) < 2 and not single_sentence) or not all(any(c.isalpha() for c in word) for word in words):
        return 'non-sentence'
    if any('.' in word.rstrip('.!?') or any(c.isdigit() for c in word) for word in words):
        return 'non-prose'
    return 'sentence-end'


def observation_result(result, observation, receipt=None, added=False, context='unavailable'):
    return {**result, 'observation': observation, 'receipt_id': receipt,
            'added_separator': added, 'context': context}


def prepare_delivery(request):
    global DELIVERY
    DELIVERY = None
    result = safe_probe()
    text = request.get('text')
    try:
        valid_text = isinstance(text, str) and bool(text) and len(text.encode('utf-8')) <= MAX_TEXT_BYTES
    except UnicodeError:
        valid_text = False
    if not valid_text or type(request.get('first_delivery')) is not bool:
        return observation_result(result, 'unavailable')
    expected_token = request.get('expected_token')
    if expected_token is not None and expected_token != result['token']:
        return observation_result(result, 'changed')
    try:
        node = eligible_node(result)
        _, iface, position, route = caret_text(node)
        count, caret, start, end, selected = position
        before = read_slice(iface, max(0, start - 64), start)
        after = read_slice(iface, end, min(count, end + 32))
        context = separator_context(node, before, position)
        # No inferred separators without the caller's independently bound token.
        added = bool(expected_token and request['first_delivery'] and context == 'sentence-end' and text[0].isalnum())
        payload = (' ' if added else '') + text
        again = safe_probe()
        if again['token'] != result['token'] or again['scope'] != 'control':
            return observation_result(again, 'changed')
        eligible_node(again)
        _, iface2, position2, route2 = caret_text(node)
        if (route2 != route or position2 != position or before != read_slice(iface2, max(0, start - 64), start)
                or after != read_slice(iface2, end, min(count, end + 32))):
            return observation_result(again, 'changed')
        receipt = uuid.uuid4().hex
        DELIVERY = dict(receipt=receipt, token=result['token'], position=position,
                        before=before, after=after, payload=payload, added=added, context=context, route=route)
        return observation_result(again, 'prepared', receipt, added, context)
    except UnsupportedRichText:
        return observation_result(result, 'unsupported')
    except InconsistentPosition:
        return observation_result(result, 'changed')
    except Exception:
        return observation_result(result, 'unavailable')


def delivery_stage(snapshot, node):
    """Bracket bounded reads; a torn accessibility sample cannot acknowledge delivery."""
    try:
        _, iface, current, route = caret_text(node)
        if route != snapshot['route']:
            return -1
    except InconsistentPosition:
        return None
    count, caret, start, end, selected = snapshot['position']
    before, after, payload = snapshot['before'], snapshot['after'], snapshot['payload']
    left = start - len(before)
    new_count, new_caret = count - (end - start) + len(payload), start + len(payload)
    expected_position = (new_count, new_caret, new_caret, new_caret, False)
    stage = -1
    try:
        if current == expected_position and read_slice(iface, left, new_caret + len(after)) == before + payload + after:
            stage = 2
        elif (current == snapshot['position'] and read_slice(iface, left, start) == before
                and read_slice(iface, end, end + len(after)) == after):
            stage = 0
        else:
            # Native routing may issue a standalone Space before the paste.
            space_position = (count - (end - start) + 1, start + 1, start + 1, start + 1, False)
            if (payload.startswith(' ') and len(payload) > 1 and not payload[1].isspace()
                    and current == space_position
                    and read_slice(iface, left, start + 1 + len(after)) == before + ' ' + after):
                stage = 1
        if stage == -1 and not selected and not current[4]:
            # Firefox may expose the inserted content/count before its caret
            # update, even across two reads. Only the exact expected local text
            # at an earlier known caret is indeterminate, never acknowledged.
            # The caller's existing deadline bounds this wait; no paste is replayed.
            prior_carets = {start}
            if payload.startswith(' ') and len(payload) > 1 and not payload[1].isspace():
                prior_carets.add(start + 1)
            if (current[0] == new_count and current[1] in prior_carets
                    and read_slice(iface, left, new_caret + len(after)) == before + payload + after):
                stage = None
            elif (payload.startswith(' ') and len(payload) > 1 and not payload[1].isspace()
                    and current == (count + 1, start, start, start, False)
                    and read_slice(iface, left, start + 1 + len(after)) == before + ' ' + after):
                stage = None
        _, _, final_position, final_route = caret_text(node)
        if final_route != route:
            return -1
        if final_position != current:
            return None
    except (InconsistentPosition, InconsistentText):
        # The next bounded poll starts from fresh state; never replay the paste.
        return None
    return stage


def verify_delivery(request):
    global DELIVERY
    snapshot = DELIVERY
    result = safe_probe()
    if snapshot is None or request.get('receipt_id') != snapshot['receipt']:
        DELIVERY = None
        return observation_result(result, 'unavailable')
    receipt, added, context = snapshot['receipt'], snapshot['added'], snapshot['context']
    outcome = 'unavailable'
    try:
        if result['token'] != snapshot['token'] or result['scope'] != 'control':
            outcome = 'changed'
        else:
            first = delivery_stage(snapshot, eligible_node(result))
            # Readback is sampled, not an atomic write receipt. A delayed paste
            # can legitimately advance between these two fresh observations.
            again = safe_probe()
            if again['token'] != snapshot['token'] or again['scope'] != 'control':
                result, outcome = again, 'changed'
            else:
                second = delivery_stage(snapshot, eligible_node(again))
                if first == -1 or second == -1:
                    outcome = 'changed'
                elif first is None or second is None:
                    # Separate AT-SPI RPCs may straddle a legitimate insertion.
                    # An indeterminate sample is never evidence of receipt.
                    outcome = 'pending'
                elif first < snapshot.get('stage', 0) or second < first:
                    outcome = 'changed'
                elif first == second == 2:
                    outcome = 'observed'
                else:
                    # Exact forward transitions need another stable readback;
                    # unrelated changes and backwards transitions never qualify.
                    snapshot['stage'] = second
                    outcome = 'pending'
    except Exception:
        outcome = 'unavailable'
    if outcome != 'pending':
        DELIVERY = None
    return observation_result(result, outcome, receipt, added, context)


def handle_request(request):
    global DELIVERY
    operation = request.get('op', 'probe')
    if operation == 'probe':
        return safe_probe()
    if operation == 'prepare':
        return prepare_delivery(request)
    if operation == 'verify':
        return verify_delivery(request)
    if operation == 'discard':
        DELIVERY = None
        return observation_result(unavailable(), 'discarded')
    DELIVERY = None
    return observation_result(safe_probe(), 'unavailable')


def serve():
    # Delivery content stays in this process; responses contain finite metadata only.
    for line in iter(lambda: sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1), b""):
        if len(line) > MAX_REQUEST_BYTES or not line.endswith(b"\n"): return
        try:
            request = json.loads(line)
            seq = request["seq"]
            if type(seq) is not int or seq < 0: return
        except (ValueError, KeyError, TypeError):
            return
        try:
            result = handle_request(request)
        except Exception:
            global DELIVERY
            DELIVERY = None
            result = observation_result(unavailable(), "unavailable")
        result["seq"] = seq
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]: serve()
    else: print(json.dumps(safe_probe()))

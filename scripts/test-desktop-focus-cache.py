"""Regression contract: fresh destination metadata without recursive tree walks."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/resources/voco_desktop_target.py'
spec = importlib.util.spec_from_file_location('focus_target', SOURCE)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class Node:
    def __init__(self, path, children=(), states=(), role='entry'):
        self.path, self.children, self.states, self.role = path, list(children), set(states), role
        if role == "entry": self.states.add("editable")
        self.parent = None
        for child in self.children: child.parent = self
        self.cache = {}
        self.clears = 0
        self.relations = []
    def clear_cache(self):
        raise AssertionError('Recursive invalidation traverses unrelated subtrees')
    def clear_cache_single(self):
        self.cache.clear()
        self.clears += 1
    def value(self, key, value):
        return self.cache.setdefault(key, value)
    def get_child_count(self): return len(self.value('children', self.children[:]))
    def get_child_at_index(self, i): return self.value('children', self.children[:])[i]
    def get_state_set(self): return types.SimpleNamespace(contains=self.value('states', self.states.copy()).__contains__)
    def get_text_iface(self): return self
    def get_interfaces(self):
        return ['Accessible', 'Action', 'Component'] + ([] if self.get_text_iface() is None else ['Text'])
    def get_role(self): return self.value('role', self.role)
    def get_process_id(self): return 42424242
    def get_relation_set(self): return self.relations
    def get_parent(self): return self.parent
    def get_index_in_parent(self):
        try: return self.parent.children.index(self)
        except (AttributeError,ValueError): return -1

class FocusTests(unittest.TestCase):
    def setUp(self):
        helper.TRACKER = helper.FocusTracker()
        self.a = Node('/a', states=['focused'])
        self.b = Node('/b')
        self.window = Node('/window', [self.a, self.b], ['active'])
        self.app = Node('/app', [self.window])
        self.desktop = Node('/desktop', [self.app])
        atspi = types.SimpleNamespace(StateType=types.SimpleNamespace(ACTIVE='active', FOCUSED='focused', EDITABLE='editable', SHOWING='showing', VISIBLE='visible', SENSITIVE='sensitive', ENABLED='enabled', DEFUNCT='defunct'),
            Role=types.SimpleNamespace(TERMINAL='terminal', PASSWORD_TEXT='password', LIST_BOX='list-box', POPUP_MENU='popup-menu', PANEL='panel', FRAME='frame', DIALOG='dialog', ALERT='alert', MENU='menu', MENU_ITEM='menu-item', CHECK_MENU_ITEM='check-menu-item', RADIO_MENU_ITEM='radio-menu-item'),
            RelationType=types.SimpleNamespace(POPUP_FOR='popup-for', CONTROLLER_FOR='controller-for'),
            Text=types.SimpleNamespace(get_character_count=lambda _:0, get_caret_offset=lambda _:0, get_n_selections=lambda _:0), set_timeout=lambda *args:None, get_desktop=lambda _:self.desktop)
        context = types.SimpleNamespace(pending=lambda:False)
        glib = types.SimpleNamespace(MainContext=types.SimpleNamespace(default=lambda:context))
        gi = types.ModuleType('gi');gi.require_version=lambda *args:None
        repository = types.ModuleType('gi.repository');repository.Atspi=atspi;repository.GLib=glib
        self.modules = patch.dict(sys.modules, {'gi':gi, 'gi.repository':repository})
        self.modules.start();self.addCleanup(self.modules.stop)

    def test_cold_discovery_prioritizes_visible_input_over_hidden_popup_contents(self):
        sidebar = Node('/sidebar', states=['showing'], role='panel')
        parent = sidebar
        for index in range(150):
            child = Node('/side-' + str(index), role='panel')
            parent.children = [child]; child.parent = parent; parent = child
        toolbar = Node('/toolbar', [self.a], ['showing'], role='panel')
        self.window.children = [toolbar, sidebar]
        toolbar.parent = sidebar.parent = self.window
        result = helper.probe()
        self.assertEqual(result['scope'], 'control')
        self.assertIs(helper.TRACKER.hint, self.a)

    def test_unfocused_terminal_does_not_change_an_editor_paste_shortcut(self):
        editor = Node('/editor-pane', [self.a], ['showing'], 'panel')
        terminal = Node('/terminal-pane', states=['showing'], role='terminal')
        self.window.children = [editor, terminal]
        editor.parent = terminal.parent = self.window
        result = helper.probe()
        self.assertEqual(result['scope'], 'control')
        self.assertEqual(result['shortcut'], 'ctrl+v')

    def test_cached_priority_cannot_admit_stale_focus(self):
        self.a.get_state_set()  # Prime the ordering hint before focus disappears.
        self.a.states.discard('focused')
        self.assertIsNone(helper.probe()['token'])

    def wrapper(self, leaf):
        document = Node('/document', [leaf], ['focused'], 'document-web')
        wrapper = Node('/scroll', [document], ['focused'], 'scroll-pane')
        self.window.children = [wrapper]; wrapper.parent = self.window
        return wrapper

    def test_focused_webkit_wrappers_resolve_the_focused_editable_leaf(self):
        wrapper = self.wrapper(self.a)
        helper.TRACKER.observe(wrapper)
        result = helper.probe()
        self.assertEqual(result['scope'], 'control')
        self.assertIs(helper.TRACKER.hint, self.a)

    def test_focused_webkit_wrappers_discover_leaf_without_hint(self):
        self.wrapper(self.a)
        self.assertEqual(helper.probe()['scope'], 'control')
        self.assertIs(helper.TRACKER.hint, self.a)

    def test_focused_wrapper_never_promotes_an_unfocused_child(self):
        self.a.states.discard('focused')
        helper.TRACKER.observe(self.wrapper(self.a))
        self.assertIsNone(helper.probe()['token'])

    def test_focused_wrapper_preserves_password_rejection(self):
        self.a.role = 'password'
        helper.TRACKER.observe(self.wrapper(self.a))
        self.assertEqual(helper.probe()['input_state'], 'protected')

    def popup(self, owner=None):
        owner = owner or self.a
        item = Node('/suggestion', role='list-item')
        popup = Node('/suggestions', [item], role='list-box')
        self.window.children.append(popup); popup.parent = self.window
        def relation(kind, targets):
            return types.SimpleNamespace(get_relation_type=lambda:kind,
                get_n_targets=lambda:len(targets), get_target=lambda i:targets[i])
        popup.relations = [relation('popup-for', [owner])]
        owner.relations = [relation('controller-for', [popup])]
        return item, popup

    def test_cold_popup_relationship_finds_owner_beyond_tree_budget(self):
        _, popup = self.popup()
        hidden = Node('/hidden-owner', [self.a], role='panel')
        self.window.children = [Node('/filler-' + str(i), role='panel') for i in range(125)] + [popup, hidden]
        for child in self.window.children: child.parent = self.window
        result = helper.probe()
        self.assertEqual(result['scope'], 'control')
        self.assertIs(helper.TRACKER.hint, self.a)

    def test_cold_popup_relationship_cannot_escape_active_window(self):
        _, popup = self.popup()
        other = Node('/other-window', [self.a], role='frame')
        self.window.children = [popup]
        result = helper.probe()
        self.assertIsNone(result['token'])
        self.assertIs(self.a.parent, other)

    def test_suggestion_focus_preserves_verified_owner_identity(self):
        before = helper.probe()['token']
        item, _ = self.popup()
        self.event(item, True)
        self.assertIs(helper.TRACKER.hint, self.a)
        self.assertEqual(before, helper.probe()['token'])
        self.event(item, False)
        self.assertEqual(before, helper.probe()['token'])

    def test_owner_loss_followed_by_related_suggestion_is_one_focus_batch(self):
        before = helper.probe()['token']
        item, _ = self.popup()
        self.event(self.a, False)
        self.event(item, True)
        self.assertEqual(before, helper.probe()['token'])

    def test_unresolved_owner_loss_invalidates_even_if_state_already_returned(self):
        before = helper.probe()['token']
        self.event(self.a, False)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_owner_loss_and_gain_without_popup_invalidates_identity(self):
        before = helper.probe()['token']
        self.event(self.a, False)
        self.event(self.a, True)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_popup_cannot_restore_identity_after_real_focus_roundtrip(self):
        before = helper.probe()['token']
        item, _ = self.popup()
        self.event(self.a, False)
        self.event(self.b, True)
        self.event(item, True)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_popup_without_reciprocal_relation_invalidates_identity(self):
        before = helper.probe()['token']
        item, _ = self.popup(); self.a.relations = []
        self.event(item, True)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_popup_cannot_keep_unfocused_owner(self):
        helper.probe(); item, _ = self.popup()
        self.a.states.discard('focused')
        self.event(item, True)
        self.assertIsNone(helper.probe()['token'])

    def test_popup_cannot_cross_active_window(self):
        helper.probe(); item, _ = self.popup()
        self.window.states.discard('active')
        self.event(item, True)
        self.assertIsNone(helper.probe()['token'])

    def test_popup_cannot_claim_foreign_process_owner(self):
        before = helper.probe()['token']
        item, _ = self.popup()
        item.get_process_id = lambda:42424243
        self.event(item, True)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_popup_editable_child_is_its_own_destination(self):
        before = helper.probe()['token']
        item, _ = self.popup()
        item.role='entry';item.states.update(['focused','editable'])
        self.event(item, True)
        self.assertIs(helper.TRACKER.hint, item)
        self.assertNotEqual(before, helper.probe()['token'])
    def test_button_is_not_a_text_cursor(self):
        self.a.role = 'button'; self.a.states.discard('editable')
        result = helper.probe()
        self.assertIsNone(result['token'])
        self.assertEqual(result['input_state'], 'none')
    def test_password_is_never_a_dictation_destination(self):
        self.a.role = 'password'
        result = helper.probe()
        self.assertIsNone(result['token'])
        self.assertEqual(result['input_state'], 'protected')
    def test_read_only_text_rejects(self):
        self.a.states.discard('editable')
        self.assertIsNone(helper.probe()['token'])
    def test_empty_editable_field_accepts_zero_caret(self):
        self.assertEqual(helper.probe()['input_state'], 'editable')
        self.assertIsNotNone(helper.probe()['token'])
    def test_unavailable_caret_is_not_permission_to_paste(self):
        from gi.repository import Atspi
        Atspi.Text.get_caret_offset = lambda _: -1
        result = helper.probe()
        self.assertIsNone(result['token'])
        self.assertEqual(result['input_state'], 'unavailable')
    def test_focus_changes_are_not_cached(self):
        a=helper.probe()['token']
        self.a.states.clear();self.b.states.update(['focused','editable'])
        b=helper.probe()['token']
        self.assertNotEqual(a,b)
        self.a.states.update(['focused','editable']);self.b.states.clear()
        self.assertNotEqual(a,helper.probe()['token'])
    def test_replaced_children_are_refetched(self):
        before=helper.probe()['token']
        self.window.children=[Node('/new',states=['focused'])]
        self.assertNotEqual(before,helper.probe()['token'])
    def test_active_window_state_is_fresh(self):
        self.assertIsNotNone(helper.probe()['token'])
        self.window.states.clear()
        self.assertIsNone(helper.probe()['token'])
    def test_multiple_active_windows_reject(self):
        self.app.children.append(Node('/other',states=['active']))
        self.assertIsNone(helper.probe()['token'])
    def test_mutter_decoration_is_not_a_second_dictation_destination(self):
        decoration = Node('/decoration', states=['active'])
        decorator = Node('/decorator', [decoration])
        decorator.get_process_id = lambda: 51515151
        self.desktop.children.insert(0, decorator)
        def executable(path, **_):
            return Path('/usr/libexec/mutter-x11-frames' if '51515151' in str(path) else '/usr/bin/python3')
        with patch.object(Path, 'resolve', executable):
            before = helper.probe()
            self.assertEqual(before['scope'], 'control')
            self.assertIsNotNone(before['token'])
            self.a.states.clear(); self.b.states.update(['focused','editable'])
            self.assertNotEqual(before['token'], helper.probe()['token'])
            self.window.states.clear()
            self.assertIsNone(helper.probe()['token'])
    def test_unreadable_decorator_identity_does_not_resolve_ambiguity(self):
        self.desktop.children.append(Node('/unknown-app', [Node('/unknown', states=['active'])]))
        with patch.object(Path, 'resolve', side_effect=OSError('process disappeared')):
            self.assertIsNone(helper.probe()['token'])
    def test_terminal_role_and_role_changes_are_fresh(self):
        self.assertEqual(helper.probe()['shortcut'],'ctrl+v')
        self.a.role='terminal'
        self.assertEqual(helper.probe()['shortcut'],'ctrl+shift+v')
        self.a.role='entry'
        self.assertEqual(helper.probe()['shortcut'],'ctrl+v')
    def test_terminal_without_editable_flag_accepts_valid_caret(self):
        self.a.role = 'terminal'; self.a.states.discard('editable')
        self.assertEqual(helper.probe()['input_state'], 'editable')
        self.assertIsNotNone(helper.probe()['token'])
    def test_terminal_without_text_interface_rejects(self):
        self.a.role = 'terminal'; self.a.states.discard('editable')
        self.a.get_text_iface = lambda: None
        self.assertIsNone(helper.probe()['token'])
        self.assertEqual(helper.probe()['input_state'], 'unavailable')
    def test_terminal_without_valid_caret_rejects(self):
        from gi.repository import Atspi
        self.a.role = 'terminal'; self.a.states.discard('editable')
        Atspi.Text.get_caret_offset = lambda _: -1
        self.assertIsNone(helper.probe()['token'])
        self.assertEqual(helper.probe()['input_state'], 'unavailable')
    def test_unvisited_large_subtree_is_not_invalidated(self):
        hidden=Node('/hidden',[Node('/leaf') for _ in range(10000)])
        self.window.children=[hidden,self.a]
        self.assertIsNotNone(helper.probe()['token'])
        self.assertEqual(hidden.clears,0)
        self.assertTrue(all(n.clears==0 for n in hidden.children))
    def test_unavailable_desktop_fails_closed(self):
        self.desktop.get_child_count=lambda: (_ for _ in ()).throw(RuntimeError('offline'))
        self.assertIsNone(helper.safe_probe()['token'])

    def event(self, node, gained):
        helper.TRACKER.event(types.SimpleNamespace(source=node,detail1=int(gained)))
    def test_duplicate_gain_does_not_invalidate(self):
        token=helper.probe()['token']
        self.event(self.a,True)
        self.assertEqual(token,helper.probe()['token'])
    def test_away_and_back_between_probes_invalidates(self):
        token=helper.probe()['token']
        self.event(self.a,False);self.event(self.b,True)
        self.event(self.b,False);self.event(self.a,True)
        self.assertNotEqual(token,helper.probe()['token'])
    def test_event_hint_finds_control_beyond_child_bound(self):
        before=helper.probe()['token']
        self.a.states.clear()
        deep=Node('/deep',states=['focused']);deep.parent=self.window
        self.window.children=[Node('/filler'+str(i)) for i in range(40)]+[deep]
        self.event(deep,True)
        result=helper.probe()
        self.assertEqual(result['scope'],'control')
        self.assertNotEqual(before,result['token'])
        self.assertTrue(all(n.clears==0 for n in self.window.children[:-1]))
    def test_stale_hint_is_not_trusted(self):
        helper.probe();self.a.states.clear()
        self.assertIsNone(helper.probe()['token'])
    def test_foreign_window_hint_is_not_trusted(self):
        self.a.states.clear()
        other=Node('/elsewhere',[Node('/foreign',states=['focused'])])
        self.event(other.children[0],True)
        self.assertIsNone(helper.probe()['token'])
    def test_cyclic_parent_chain_is_bounded(self):
        self.a.states.clear();node=Node('/cycle',states=['focused']);node.parent=node
        self.event(node,True)
        self.assertIsNone(helper.probe()['token'])
        self.assertLessEqual(node.clears,33)
    def test_missing_focus_exposes_window_scope(self):
        self.a.states.clear();result=helper.probe()
        self.assertIsNone(result['token'])
        self.assertFalse(result['events_tracked'])
    def test_window_focused_is_not_control_verification(self):
        self.a.states.clear();self.window.states.add('focused')
        self.assertIsNone(helper.probe()['token'])
    def test_helper_restart_invalidates_old_token(self):
        token=helper.probe()['token'];helper.TRACKER=helper.FocusTracker()
        self.assertNotEqual(token,helper.probe()['token'])
    def test_unrelated_loss_does_not_invalidate(self):
        token=helper.probe()['token'];self.event(self.b,False)
        self.assertEqual(token,helper.probe()['token'])
    def test_registration_failure_exposes_gap(self):
        from gi.repository import Atspi
        Atspi.EventListener=types.SimpleNamespace(new=lambda _:types.SimpleNamespace(register=lambda _:False))
        self.assertFalse(helper.probe()['events_tracked'])
    def test_registration_success_exposes_coverage(self):
        from gi.repository import Atspi
        Atspi.EventListener=types.SimpleNamespace(new=lambda _:types.SimpleNamespace(register=lambda _:True))
        self.assertTrue(helper.probe()['events_tracked'])
    def test_pending_event_backlog_rejects(self):
        from gi.repository import GLib
        calls=[]
        GLib.MainContext.default=lambda:types.SimpleNamespace(pending=lambda:True,iteration=lambda _:calls.append(1))
        result = helper.probe()
        self.assertIsNone(result['token'])
        self.assertEqual(result['reason'], 'events_pending')
        self.assertLessEqual(len(calls),4096)
        self.assertGreater(len(calls),0)
    def test_window_transition_backlog_is_drained_before_binding(self):
        from gi.repository import GLib
        before=helper.probe()['token']
        remaining=[1000]
        def iteration(_):
            remaining[0]-=1
            if remaining[0]==0:
                self.a.states.clear();self.b.states.update(['focused','editable'])
                self.event(self.b,True)
        GLib.MainContext.default=lambda:types.SimpleNamespace(pending=lambda:remaining[0]>0,iteration=iteration)
        after=helper.probe()
        self.assertEqual(after['scope'],'control')
        self.assertEqual(remaining[0],0)
        self.assertIsNotNone(after['token'])
        self.assertNotEqual(before,after['token'])
    def test_slow_event_backlog_has_a_time_budget(self):
        from gi.repository import GLib
        import itertools
        calls=[]
        GLib.MainContext.default=lambda:types.SimpleNamespace(pending=lambda:True,iteration=lambda _:calls.append(1))
        with patch('time.monotonic', side_effect=itertools.count(0, .01)):
            self.assertIsNone(helper.probe()['token'])
        self.assertLess(len(calls),10)
    def test_output_contains_only_finite_metadata_and_opaque_token(self):
        result=helper.probe()
        self.assertEqual(set(result),{'shortcut','token','scope','events_tracked','input_state','reason'})
        self.assertEqual(len(result['token']),64)
        self.assertEqual(result['reason'], 'ready')

    def test_rejection_reasons_do_not_expose_destination_content(self):
        def rejected(reason):
            result = helper.safe_probe()
            self.assertIsNone(result['token'])
            self.assertEqual(result['reason'], reason)
            self.assertEqual(set(result), {'shortcut', 'token', 'scope', 'events_tracked', 'input_state', 'reason'})
        self.window.states.clear()
        rejected('no_active_window')
        self.window.states.add('active')
        self.app.children.append(Node('/private-window-name', states=['active']))
        rejected('ambiguous_windows')
        self.app.children.pop()
        self.a.states.discard('focused')
        rejected('no_focused_control')
        self.a.states.add('focused')
        self.a.states.discard('editable')
        rejected('not_editable')
        self.a.role = 'password'
        rejected('protected')
        self.a.role = 'entry'; self.a.states.add('editable')
        self.a.get_text_iface = lambda: None
        rejected('control_unavailable')
        self.desktop.get_child_count = lambda: (_ for _ in ()).throw(RuntimeError('private diagnostic'))
        rejected('probe_failed')

    def test_undiscovered_control_without_event_is_found_past_30(self):
        self.a.states.clear()
        children=[Node('/item'+str(i)) for i in range(60)]
        children[-1].states.add('focused')
        self.window.children=children
        self.assertEqual(helper.probe()['scope'],'control')
    def test_child_discovery_has_global_budget(self):
        self.a.states.clear()
        children=[Node('/item'+str(i)) for i in range(10000)]
        children[-1].states.add('focused')
        self.window.children=children
        calls=[];original=self.window.get_child_at_index
        self.window.get_child_at_index=lambda i:(calls.append(i),original(i))[1]
        self.assertIsNone(helper.probe()['token'])
        self.assertLessEqual(len(calls),127)

    def ghostty(self):
        from gi.repository import Atspi
        executable = patch.object(helper, 'process_binary', return_value='ghostty')
        executable.start(); self.addCleanup(executable.stop)
        Atspi.EventListener = types.SimpleNamespace(new=lambda callback:
            types.SimpleNamespace(register=lambda event: True))
        self.window.role = 'frame'; self.window.states.discard('editable')
        self.a.role = 'panel'
        self.a.states = {'focused', 'visible', 'showing', 'sensitive'}
        self.a.get_text_iface = lambda: None
        self.window.children = [self.a]
        return Atspi

    def test_ghostty_surface_is_typed_and_has_no_fake_caret_or_receipt(self):
        self.ghostty()
        result = helper.probe()
        self.assertEqual(result['input_state'], 'terminal_surface')
        self.assertEqual(result['scope'], 'control')
        self.assertEqual(result['shortcut'], 'ctrl+shift+v')
        self.assertEqual(len(result['token']), 64)
        self.assertTrue(result['events_tracked'])
        prepared = helper.prepare_delivery({'text': 'Private fixture', 'expected_token': result['token'], 'first_delivery': True})
        self.assertEqual(prepared['observation'], 'unavailable')
        self.assertIsNone(prepared['receipt_id'])
        self.assertFalse(prepared['added_separator'])

    def test_ghostty_aliases_are_one_identity_and_use_downward_route(self):
        self.ghostty()
        left = Node('/left', [self.a], role='panel')
        right = Node('/right', [self.a], role='panel')
        self.window.children = [left, right]
        # GTK's upward parent can skip an exported synthetic tab container.
        self.a.parent = self.window
        result = helper.probe()
        self.assertEqual(result['input_state'], 'terminal_surface')
        self.assertEqual(result['token'], helper.probe()['token'])

    def test_ghostty_search_field_uses_normal_chord_and_caret(self):
        self.ghostty()
        self.a.role = 'entry'; self.a.states.add('editable'); self.a.get_text_iface = lambda: self.a
        result = helper.probe()
        self.assertEqual(result['input_state'], 'editable')
        self.assertEqual(result['shortcut'], 'ctrl+v')
        self.a.role = 'password'
        self.assertEqual(helper.probe()['input_state'], 'protected')

    def test_ghostty_true_caret_does_not_require_complete_canvas_scan(self):
        self.ghostty()
        self.a.role = 'entry'; self.a.states.add('editable'); self.a.get_text_iface = lambda: self.a
        hidden = Node('/hidden', role='panel')
        hidden.get_child_count = lambda: 999
        self.window.children.append(hidden)
        self.assertEqual(helper.probe()['shortcut'], 'ctrl+v')
        self.assertEqual(helper.probe()['input_state'], 'editable')

    def test_ghostty_surface_requires_each_event_registration(self):
        atspi = self.ghostty()
        for missing in ('object:state-changed:focused', 'window:deactivate', 'object:state-changed:active'):
            with self.subTest(missing=missing):
                helper.TRACKER = helper.FocusTracker()
                atspi.EventListener = types.SimpleNamespace(new=lambda callback:
                    types.SimpleNamespace(register=lambda event: event != missing))
                self.assertIsNone(helper.probe()['token'])

    def test_ghostty_window_departure_revokes_even_if_canvas_stays_focused(self):
        self.ghostty()
        for event_type in ('window:deactivate', 'object:state-changed:active'):
            with self.subTest(event_type=event_type):
                before = helper.probe()['token']
                self.assertIsNotNone(before)
                helper.TRACKER.window_event(types.SimpleNamespace(type=event_type, source=self.window, detail1=0))
                self.assertNotEqual(before, helper.probe()['token'])

    def test_ghostty_unrelated_window_event_preserves_identity(self):
        self.ghostty(); before = helper.probe()['token']
        helper.TRACKER.window_event(types.SimpleNamespace(type='window:deactivate', source=self.b, detail1=0))
        self.assertEqual(before, helper.probe()['token'])
        helper.TRACKER.window_event(types.SimpleNamespace(type='object:state-changed:active', source=self.window, detail1=1))
        self.assertEqual(before, helper.probe()['token'])

    def test_window_events_do_not_query_or_invalidate_an_unbound_generic_target(self):
        before = helper.probe()['token']
        source = types.SimpleNamespace(get_process_id=lambda: (_ for _ in ()).throw(AssertionError('unrelated RPC')))
        helper.TRACKER.window_event(types.SimpleNamespace(type='window:deactivate', source=source, detail1=0))
        self.assertEqual(before, helper.probe()['token'])

    def test_leaving_ghostty_does_not_bind_its_window_to_another_field(self):
        self.ghostty(); self.assertIsNotNone(helper.probe()['token'])
        self.b.states.add('focused')
        other = Node('/other-window', [self.b], ['active'], role='frame')
        self.app.children = [other]
        with patch.object(helper, 'process_binary', return_value='text-editor'):
            before = helper.probe()['token']; self.assertIsNotNone(before)
            self.assertIsNone(helper.TRACKER.window_key)
            helper.TRACKER.window_event(types.SimpleNamespace(type='window:deactivate', source=self.window, detail1=0))
            self.assertEqual(before, helper.probe()['token'])

    def test_ghostty_ordinary_field_does_not_retain_canvas_window_binding(self):
        self.ghostty(); helper.probe()
        self.a.role = 'entry'; self.a.states.add('editable'); self.a.get_text_iface = lambda: self.a
        self.assertEqual(helper.probe()['input_state'], 'editable')
        self.assertIsNone(helper.TRACKER.window_key)

    def test_ghostty_canvas_rejects_observed_loss_even_if_focus_returns_before_next_query(self):
        self.ghostty()
        for loss_at in range(1, 4):
            for returns in (False, True):
                with self.subTest(loss_at=loss_at, returns=returns):
                    helper.TRACKER = helper.FocusTracker()
                    self.a.states.add('focused')
                    before = helper.probe()['token']; self.assertIsNotNone(before)
                    calls = []; original = self.a.get_state_set
                    def lose_focus():
                        calls.append(True)
                        if len(calls) == loss_at:
                            self.a.states.discard('focused')
                            self.a.clear_cache_single()
                        sampled = original()
                        if returns:
                            self.a.states.add('focused')
                        return sampled
                    with patch.object(self.a, 'get_state_set', side_effect=lose_focus):
                        self.assertIsNone(helper.probe()['token'])
                    self.a.states.add('focused')
                    self.assertNotEqual(before, helper.probe()['token'])

    def test_ghostty_stale_cached_focus_loss_is_only_a_discovery_hint(self):
        self.ghostty(); before = helper.probe()['token']
        self.a.states.discard('focused'); self.a.clear_cache_single(); self.a.get_state_set()
        self.a.states.add('focused')
        self.assertEqual(before, helper.probe()['token'])

    def test_ghostty_observed_window_loss_rejects_even_if_active_returns(self):
        self.ghostty()
        for loss_at in range(1, 5):
            for returns in (False, True):
                with self.subTest(loss_at=loss_at, returns=returns):
                    helper.TRACKER = helper.FocusTracker()
                    self.window.states.add('active')
                    before = helper.probe()['token']; self.assertIsNotNone(before)
                    calls = []; original = self.window.get_state_set
                    def lose_active():
                        calls.append(True)
                        if len(calls) == loss_at:
                            self.window.states.discard('active')
                        sampled = original()
                        if returns:
                            self.window.states.add('active')
                        return sampled
                    with patch.object(self.window, 'get_state_set', side_effect=lose_active):
                        self.assertIsNone(helper.probe()['token'])
                    self.window.states.add('active')
                    self.assertNotEqual(before, helper.probe()['token'])

    def test_ghostty_surface_focus_departure_and_return_revokes(self):
        self.ghostty(); before = helper.probe()['token']
        self.event(self.a, False); self.event(self.b, True)
        self.event(self.b, False); self.event(self.a, True)
        self.assertNotEqual(before, helper.probe()['token'])

    def test_ghostty_surface_requires_live_visible_sensitive_leaf(self):
        self.ghostty()
        for state in ('focused', 'visible', 'showing', 'sensitive'):
            with self.subTest(missing=state):
                self.a.states.remove(state)
                self.assertIsNone(helper.probe()['token'])
                self.a.states.add(state)
        self.a.states.add('defunct'); self.assertIsNone(helper.probe()['token']); self.a.states.remove('defunct')
        self.a.children = [self.b]; self.assertIsNone(helper.probe()['token']); self.a.children = []
        self.a.get_text_iface = lambda: self.a
        self.assertIsNone(helper.probe()['token'])

    def test_ghostty_surface_rejects_dialog_menu_and_ambiguous_focus(self):
        self.ghostty()
        self.window.role = 'dialog'; self.assertIsNone(helper.probe()['token']); self.window.role = 'frame'
        self.window.children.append(Node('/menu', states=['visible', 'showing'], role='popup-menu'))
        self.assertIsNone(helper.probe()['token']); self.window.children.pop()
        self.window.children.append(Node('/second', states=['focused'], role='button'))
        self.assertIsNone(helper.probe()['token'])

    def test_ghostty_observed_menu_or_inactive_window_revokes_token(self):
        self.ghostty()
        before = helper.probe()['token']
        self.window.children.append(Node('/menu', states=['showing'], role='popup-menu'))
        self.assertIsNone(helper.probe()['token']); self.window.children.pop()
        after = helper.probe()['token']
        self.assertNotEqual(before, after)
        self.window.states.discard('active'); self.assertIsNone(helper.probe()['token'])
        self.window.states.add('active'); self.assertNotEqual(after, helper.probe()['token'])

    def test_ghostty_elapsed_deadline_rejects_surface(self):
        atspi = self.ghostty()
        with patch.object(helper.time, 'monotonic', return_value=10):
            self.assertEqual(helper.ghostty_focus(self.window, 42424242, atspi, 9), (None, 'unavailable'))

    def test_ghostty_alias_edges_have_separate_work_bound(self):
        self.ghostty()
        self.window.children = [Node('/alias-' + str(i), [self.a], role='panel') for i in range(65)]
        self.assertIsNone(helper.probe()['token'])

    def test_non_ghostty_panel_is_never_a_terminal_surface(self):
        self.ghostty()
        with patch.object(helper, 'process_binary', return_value='another-app'):
            self.assertIsNone(helper.probe()['token'])

    def test_ghostty_incomplete_catalog_or_tree_rejects_surface(self):
        self.ghostty()
        for node in (self.desktop, self.app, self.window):
            with self.subTest(path=node.path):
                with patch.object(node, 'get_child_count', return_value=-1):
                    self.assertIsNone(helper.probe()['token'])
        hidden = Node('/unreadable', role='panel'); self.window.children.append(hidden)
        hidden.get_child_count = lambda: -1
        self.assertIsNone(helper.probe()['token'])
        hidden.get_child_count = lambda: (_ for _ in ()).throw(RuntimeError('unavailable'))
        self.assertIsNone(helper.probe()['token'])

    def test_ghostty_surface_scan_cannot_accept_before_budget_exhaustion(self):
        self.ghostty()
        self.window.children += [Node('/filler-' + str(i), role='panel') for i in range(128)]
        self.assertIsNone(helper.probe()['token'])
        self.window.children = [self.a, self.window]
        self.assertIsNone(helper.probe()['token'])

    def test_ghostty_route_is_revalidated_after_complete_scan(self):
        self.ghostty()
        original = self.window.get_child_at_index; calls = []
        def child(index):
            calls.append(index)
            return original(index) if len(calls) == 1 else self.b
        self.window.get_child_at_index = child
        self.assertIsNone(helper.probe()['token'])

    def test_ghostty_foreign_child_and_changed_window_reject(self):
        self.ghostty()
        self.a.get_process_id = lambda: 999
        self.assertIsNone(helper.probe()['token'])
        self.a.get_process_id = lambda: 42424242
        original = self.a.get_state_set
        def state():
            self.window.states.discard('active')
            return original()
        self.a.get_state_set = state
        self.assertIsNone(helper.probe()['token'])

if __name__=='__main__':unittest.main()

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
    def get_role(self): return self.value('role', self.role)
    def get_process_id(self): return 42424242
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
        atspi = types.SimpleNamespace(StateType=types.SimpleNamespace(ACTIVE='active', FOCUSED='focused', EDITABLE='editable'),
            Role=types.SimpleNamespace(TERMINAL='terminal', PASSWORD_TEXT='password'),
            Text=types.SimpleNamespace(get_character_count=lambda _:0, get_caret_offset=lambda _:0, get_n_selections=lambda _:0), set_timeout=lambda *args:None, get_desktop=lambda _:self.desktop)
        context = types.SimpleNamespace(pending=lambda:False)
        glib = types.SimpleNamespace(MainContext=types.SimpleNamespace(default=lambda:context))
        gi = types.ModuleType('gi');gi.require_version=lambda *args:None
        repository = types.ModuleType('gi.repository');repository.Atspi=atspi;repository.GLib=glib
        self.modules = patch.dict(sys.modules, {'gi':gi, 'gi.repository':repository})
        self.modules.start();self.addCleanup(self.modules.stop)
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

if __name__=='__main__':unittest.main()

"""Bounded readback tests use public synthetic strings; no desktop mutation."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'apps/desktop/src-tauri/resources/voco_desktop_target.py'
spec = importlib.util.spec_from_file_location('delivery_target', SOURCE)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class Field:
    def __init__(self, value='', caret=None, selection=None):
        self.value = value
        self.caret = len(value) if caret is None else caret
        self.selection = selection
        self.role = 'text'
        self.states = {'focused', 'editable'}
        self.attributes = {}
        self.reads = []
        self.path = str(id(self))
        self.children = {}
        self.parent = None
    def clear_cache_single(self): pass
    def get_state_set(self): return types.SimpleNamespace(contains=self.states.__contains__)
    def get_role(self): return self.role
    def get_role_name(self): return self.role
    def get_attributes(self): return self.attributes
    def get_text_iface(self): return self
    def get_hypertext_iface(self): return self
    def get_parent(self): return self.parent
    def get_process_id(self): return 1
    def get_link_index(self, offset): return offset if offset in self.children else -1
    def get_link(self, offset):
        child = self.children[offset]
        child.parent = self
        return types.SimpleNamespace(get_start_index=lambda: offset, get_end_index=lambda: offset+1, get_object=lambda _: child)
    def get_character_count(self): return len(self.value)
    def get_caret_offset(self): return self.caret
    def get_n_selections(self): return int(self.selection is not None)
    # Match real Accessible: these shadow Text methods with different signatures.
    def get_selection(self): return self
    def get_text(self): return self
    def text_get_selection(self, _): return types.SimpleNamespace(start_offset=self.selection[0], end_offset=self.selection[1])
    def text_get_text(self, start, end):
        self.reads.append((start, end))
        return self.value[start:end]
    def insert(self, text):
        start, end = self.selection or (self.caret, self.caret)
        self.value = self.value[:start] + text + self.value[end:]
        self.caret = start + len(text)
        self.selection = None


class ObservationTests(unittest.TestCase):
    def setUp(self):
        helper.DELIVERY = None
        self.field = Field()
        helper.TRACKER.hint = self.field
        self.result = dict(shortcut='ctrl+v', token='a'*64, scope='control', events_tracked=True)
        self.probe = patch.object(helper, 'safe_probe', side_effect=lambda: self.result.copy())
        self.probe.start(); self.addCleanup(self.probe.stop)
        atspi = types.SimpleNamespace(StateType=types.SimpleNamespace(FOCUSED='focused', EDITABLE='editable'),
            Role=types.SimpleNamespace(PASSWORD_TEXT='password', TERMINAL='terminal'),
            Hypertext=types.SimpleNamespace(get_link_index=lambda obj, offset: obj.get_link_index(offset), get_link=lambda obj, index: obj.get_link(index)),
            Text=types.SimpleNamespace(
                get_character_count=lambda obj: obj.get_character_count(),
                get_caret_offset=lambda obj: obj.get_caret_offset(),
                get_n_selections=lambda obj: obj.get_n_selections(),
                get_selection=lambda obj, index: obj.text_get_selection(index),
                get_text=lambda obj, start, end: obj.text_get_text(start, end)))
        repository = types.ModuleType('gi.repository'); repository.Atspi = atspi
        modules = patch.dict(sys.modules, {'gi':types.ModuleType('gi'), 'gi.repository':repository})
        modules.start(); self.addCleanup(modules.stop)
    def field_value(self, value, caret=None, selection=None):
        self.field.value = value
        self.field.caret = len(value) if caret is None else caret
        self.field.selection = selection
    def prepare(self, text='New sentence.', first=True, expected='a'*64):
        return helper.handle_request(dict(op='prepare', text=text, expected_token=expected, first_delivery=first))
    def verify(self, receipt):
        return helper.handle_request(dict(op='verify', receipt_id=receipt['receipt_id']))
    def rich_field(self, value='\n', caret=0, selection=None):
        self.field_value('\ufffc', 0)
        paragraph = Field(value, caret, selection)
        paragraph.role = 'paragraph'
        self.field.children[0] = paragraph
        return paragraph
    def test_direct_rich_editor_empty_line_break_disappears_on_paste(self):
        self.field.attributes = {'tag': 'div'}
        self.field_value('\n', 0)
        receipt = self.prepare('W')
        self.assertEqual(receipt['observation'], 'prepared')
        self.field_value('W')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        receipt = self.prepare('elcome.', first=False)
        self.field.insert('elcome.')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')

    def test_nested_html_block_line_break_disappears_on_paste(self):
        child = self.rich_field('\n', 0)
        child.role = 'section'
        child.attributes = {'tag': 'div'}
        receipt = self.prepare('W')
        child.value, child.caret = 'W', 1
        self.assertEqual(self.verify(receipt)['observation'], 'observed')

    def test_missing_html_metadata_keeps_literal_text_delivery(self):
        self.field_value('abc', 0)
        with patch.object(self.field, 'get_attributes', side_effect=RuntimeError('unsupported')):
            receipt = self.prepare('W')
            self.assertEqual(receipt['observation'], 'prepared')
            self.field.insert('W')
            self.assertEqual(self.verify(receipt)['observation'], 'observed')

    def test_plain_text_newline_is_not_rich_editor_scaffolding(self):
        for attributes in ({}, {'tag': 'textarea'}, {'tag': 'input'}):
            self.field.attributes = attributes
            self.field_value('\n', 0)
            receipt = self.prepare('W')
            self.field_value('W')
            self.assertEqual(self.verify(receipt)['observation'], 'changed')

    def test_direct_rich_editor_still_rejects_wrong_first_character(self):
        self.field.attributes = {'tag': 'div'}
        self.field_value('\n', 0)
        receipt = self.prepare('W')
        self.field_value('X')
        self.assertEqual(self.verify(receipt)['observation'], 'changed')

    def test_rich_editor_first_word_and_following_chunk_are_observed(self):
        paragraph = self.rich_field()
        receipt = self.prepare('Hello')
        self.assertEqual(receipt['observation'], 'prepared')
        paragraph.value, paragraph.caret = 'Hello', 5
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        receipt = self.prepare(' there', first=False)
        paragraph.insert(' there')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_rich_editor_placeholder_removal_does_not_hide_inserted_text(self):
        paragraph = self.rich_field('\n\ufffc', 0)
        widget = Field('Placeholder'); widget.states = set()
        paragraph.children[1] = widget
        receipt = self.prepare('Hello')
        self.assertEqual(receipt['observation'], 'prepared')
        paragraph.value, paragraph.caret = 'Hello\n', 5
        paragraph.children = {}
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        self.assertEqual(widget.reads, [])
    def test_rich_editor_unreadable_child_never_downgrades_to_best_effort(self):
        self.rich_field('', -1)
        self.assertEqual(self.prepare()['observation'], 'changed')
    def test_rich_editor_different_paragraph_is_rejected(self):
        paragraph = self.rich_field('Before', 6)
        self.field.value += '\ufffc'
        self.field.children[1] = Field('Elsewhere', 9)
        receipt = self.prepare(' word')
        paragraph.insert(' word')
        self.field.caret = 1
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_rich_editor_wrong_text_and_old_caret_are_not_receipts(self):
        paragraph = self.rich_field('Before', 6)
        receipt = self.prepare(' word')
        paragraph.value = 'Before word'
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        paragraph.caret = 11
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        receipt = self.prepare(' next')
        paragraph.insert(' oops')
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_rich_editor_replaced_paragraph_is_rejected(self):
        self.rich_field('Before', 6)
        receipt = self.prepare(' word')
        self.field.children[0] = Field('Before word', 11)
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_rich_editor_lookup_does_not_read_other_paragraphs(self):
        paragraph = self.rich_field('Before', 6)
        self.field.value = '\ufffc' * 1000
        for index in range(1, 1000): self.field.children[index] = Field('Unrelated text', -1)
        receipt = self.prepare(' word')
        paragraph.insert(' word')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        self.assertTrue(all(not child.reads for child in list(self.field.children.values())[1:]))
    def test_rich_editor_cross_paragraph_selection_is_not_best_effort(self):
        self.rich_field('First', 5)
        self.field.value = '\ufffc\ufffc'; self.field.selection = (0, 2); self.field.caret = 2
        self.assertEqual(self.prepare()['observation'], 'unsupported')
        self.assertIsNone(helper.DELIVERY)
        self.assertEqual(self.field.reads, [])
    def test_rich_editor_depth_is_bounded(self):
        paragraph = self.rich_field('\ufffc', 0)
        for _ in range(10):
            nested = Field('\ufffc', 0); paragraph.children[0] = nested; paragraph = nested
        self.assertEqual(self.prepare()['observation'], 'unsupported')
    def test_protected_descendant_cannot_be_read(self):
        child = self.rich_field('Protected', 9); child.role = 'password'
        self.assertEqual(self.prepare()['observation'], 'unsupported')
        self.assertEqual(child.reads, [])
    def test_lost_nested_text_interface_never_downgrades_to_best_effort(self):
        child = self.rich_field('Before', 6); child.get_text_iface = lambda: None
        self.assertEqual(self.prepare()['observation'], 'unsupported')
    def test_nested_text_arriving_before_caret_is_pending(self):
        child = self.rich_field('Before', 6); receipt = self.prepare(' word')
        original = child.get_character_count
        def count():
            value = original(); child.value = 'Before word'; child.caret = 11; return value
        child.get_character_count = count
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_real_accessible_method_shadowing_uses_text_interface(self):
        with self.assertRaises(TypeError):
            self.field.get_text(0, 0)
        with self.assertRaises(TypeError):
            self.field.get_selection(0)
        self.field_value('Before SELECT after.', 13, (7,13))
        receipt = self.prepare('replacement')
        self.assertEqual(receipt['observation'], 'prepared')
        self.field.insert('replacement')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_empty_delivery_pending_then_observed(self):
        receipt = self.prepare()
        self.assertEqual(receipt['observation'], 'prepared')
        self.assertFalse(receipt['added_separator'])
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.insert('New sentence.')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
        self.assertIsNone(helper.DELIVERY)
    def test_sentence_separator_and_delayed_space(self):
        self.field_value('Existing prefix.')
        receipt = self.prepare()
        self.assertTrue(receipt['added_separator'])
        self.field.insert(' ')
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.insert('New sentence.')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_second_session_observes_fresh_context(self):
        a = self.prepare(); self.field.insert('New sentence.'); self.verify(a)
        b = self.prepare('Another sentence.')
        self.assertTrue(b['added_separator'])
        self.field.insert(' Another sentence.')
        self.assertEqual(self.verify(b)['observation'], 'observed')
    def test_selection_replacement_count_and_caret(self):
        self.field_value('Before REPLACE after.', 14, (7,14))
        receipt = self.prepare('Café 👩\u200d💻')
        self.assertEqual(receipt['context'], 'selection')
        self.assertFalse(receipt['added_separator'])
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.insert('Café 👩\u200d💻')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_selection_replaced_by_standalone_space_is_pending(self):
        self.field_value('Before REPLACE after.', 7, (7,14))
        receipt = self.prepare(' replacement')
        self.field.insert(' ')
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.insert('replacement')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_no_separator_for_sensitive_or_ambiguous_contexts(self):
        for value in ['', 'Existing prefix. ', 'Existing prefix.\u00a0', 'https://example.com.', 'user@example.com.',
                      '/some/path.', 'let value = done.', 'Hello', 'Version 3.', 'example.com.', 'object.']:
            with self.subTest(value=value):
                self.field_value(value)
                self.assertFalse(self.prepare()['added_separator'])
        self.field_value('Existing prefix.', 3)
        self.assertFalse(self.prepare()['added_separator'])
    def test_input_purpose_url_is_excluded(self):
        self.field_value('Existing prefix.')
        self.field.attributes = {'text-input-type':'url'}
        self.assertFalse(self.prepare()['added_separator'])
    def test_later_delivery_never_adds_separator(self):
        self.field_value('Existing prefix.')
        self.assertFalse(self.prepare(first=False)['added_separator'])
    def test_unbound_token_never_adds_separator(self):
        self.field_value('Existing prefix.')
        self.assertFalse(self.prepare(expected=None)['added_separator'])
    def test_password_terminal_and_noneditable_never_read(self):
        for role, states in [('password', {'focused','editable'}), ('terminal', {'focused','editable'}), ('text', {'focused'})]:
            self.field.role, self.field.states = role, states
            self.assertEqual(self.prepare()['observation'], 'unavailable')
        self.assertEqual(self.field.reads, [])
    def test_window_scope_never_reads(self):
        self.result['scope'] = 'window'
        self.assertEqual(self.prepare()['observation'], 'unavailable')
        self.assertEqual(self.field.reads, [])
    def test_changed_focus_and_caret_clear_snapshot(self):
        receipt = self.prepare()
        self.result['token'] = 'b'*64
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
        self.assertIsNone(helper.DELIVERY)
        self.result['token'] = 'a'*64
        self.field_value('Existing prefix.')
        receipt = self.prepare()
        self.field.caret = 1
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_incompatible_local_edit_is_changed(self):
        self.field_value('Existing prefix.')
        receipt = self.prepare()
        self.field.value = 'Existing suffix.'
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_wrong_delivery_same_length_is_changed(self):
        receipt = self.prepare('word')
        self.field.insert('oops')
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_stale_focus_during_prepare(self):
        count = 0
        def probe():
            nonlocal count
            count += 1
            return {**self.result, 'token': ('a' if count == 1 else 'b')*64}
        with patch.object(helper, 'safe_probe', side_effect=probe):
            self.assertEqual(self.prepare()['observation'], 'changed')
        self.assertIsNone(helper.DELIVERY)
    def test_context_slices_are_bounded(self):
        self.field_value('x'*10000+' Existing prefix.')
        self.prepare()
        self.assertTrue(all(end-start <=64 for start,end in self.field.reads))
    def test_old_receipt_cannot_verify_new_prepare(self):
        a = self.prepare(); b = self.prepare()
        self.assertNotEqual(a['receipt_id'], b['receipt_id'])
        self.assertEqual(self.verify(a)['observation'], 'unavailable')
        self.assertIsNone(helper.DELIVERY)
    def test_discard_releases_text(self):
        self.prepare()
        helper.handle_request(dict(op='discard'))
        self.assertIsNone(helper.DELIVERY)
    def test_utf8_bound_and_invalid_request(self):
        self.assertEqual(self.prepare('é'*50000)['observation'], 'prepared')
        self.assertEqual(self.prepare('é'*50001)['observation'], 'unavailable')
        self.assertIsNone(helper.DELIVERY)
        self.assertEqual(self.prepare(first=1)['observation'], 'unavailable')
    def test_response_never_contains_text_or_content_hash(self):
        import json
        receipt = self.prepare('Distinctive private fixture')
        self.assertNotIn('Distinctive', json.dumps(receipt))
        self.assertEqual(set(receipt), {'shortcut','token','scope','events_tracked','observation','receipt_id','added_separator','context'})
        self.assertEqual(len(receipt['receipt_id']),32)
    def test_changed_count_while_reading_rejects(self):
        original = self.field.text_get_text
        def read(start,end):
            value = original(start,end)
            self.field.value += 'x'
            self.field.caret += 1
            return value
        self.field.text_get_text = read
        self.assertEqual(self.prepare()['observation'],'changed')
    def test_same_count_mutation_during_readback_is_rejected(self):
        receipt = self.prepare('word')
        self.field.insert('word')
        calls = 0
        def probe():
            nonlocal calls
            calls += 1
            if calls == 2:
                self.field.value = 'oops'
            return self.result.copy()
        with patch.object(helper, 'safe_probe', side_effect=probe):
            self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def transition_during_second_probe(self, receipt, action):
        calls = 0
        def probe():
            nonlocal calls
            calls += 1
            if calls == 2:
                action()
            return self.result.copy()
        with patch.object(helper, 'safe_probe', side_effect=probe):
            return self.verify(receipt)
    def test_original_to_expected_during_probe_remains_pending(self):
        receipt = self.prepare('word')
        result = self.transition_during_second_probe(receipt, lambda: self.field.insert('word'))
        self.assertEqual(result['observation'], 'pending')
        self.assertIsNotNone(helper.DELIVERY)
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_original_to_space_during_probe_remains_pending(self):
        self.field_value('Hello.')
        receipt = self.prepare('World.')
        result = self.transition_during_second_probe(receipt, lambda: self.field.insert(' '))
        self.assertEqual(result['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.insert('World.')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_space_to_expected_during_probe_remains_pending(self):
        self.field_value('Hello.')
        receipt = self.prepare('World.')
        self.field.insert(' ')
        result = self.transition_during_second_probe(receipt, lambda: self.field.insert('World.'))
        self.assertEqual(result['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_unrelated_insert_during_probe_is_changed(self):
        receipt = self.prepare('word')
        result = self.transition_during_second_probe(receipt, lambda: self.field.insert('oops'))
        self.assertEqual(result['observation'], 'changed')
        self.assertIsNone(helper.DELIVERY)
    def test_expected_to_original_during_probe_is_changed(self):
        receipt = self.prepare('word')
        self.field.insert('word')
        result = self.transition_during_second_probe(receipt, lambda: self.field_value(''))
        self.assertEqual(result['observation'], 'changed')
    def test_previous_pending_progress_cannot_regress(self):
        self.field_value('Hello.')
        receipt = self.prepare('World.')
        self.field.insert(' ')
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field_value('Hello.')
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_incompatible_first_sample_cannot_be_repaired_by_second(self):
        receipt = self.prepare('word')
        self.field.insert('oops')
        result = self.transition_during_second_probe(receipt, lambda: self.field_value('word'))
        self.assertEqual(result['observation'], 'changed')
    def test_selection_replacement_between_count_and_caret_is_pending(self):
        self.field_value('Before SELECT after.', 13, (7,13))
        receipt = self.prepare('replacement')
        original = self.field.get_character_count
        calls = 0
        def count():
            nonlocal calls
            value = original()
            calls += 1
            if calls == 1:
                self.field.insert('replacement')
            return value
        self.field.get_character_count = count
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_insertion_during_bounded_region_read_is_pending(self):
        receipt = self.prepare('word')
        original = self.field.text_get_text
        calls = 0
        def read(start, end):
            nonlocal calls
            value = original(start, end)
            calls += 1
            if calls == 1:
                self.field.insert('word')
            return value
        self.field.text_get_text = read
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_selection_disappears_between_selection_getters_is_pending(self):
        self.field_value('Before SELECT after.', 13, (7,13))
        receipt = self.prepare('replacement')
        original = self.field.get_n_selections
        calls = 0
        def selections():
            nonlocal calls
            value = original()
            calls += 1
            if calls == 1:
                self.field.insert('replacement')
            return value
        self.field.get_n_selections = selections
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_transient_caret_beyond_old_count_is_pending(self):
        receipt = self.prepare('word')
        original = self.field.get_character_count
        calls = 0
        def count():
            nonlocal calls
            value = original()
            calls += 1
            if calls == 1:
                self.field.insert('word')
            return value
        self.field.get_character_count = count
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_expected_content_with_old_caret_waits_for_alignment(self):
        self.field_value('Before ')
        receipt = self.prepare('word')
        self.field_value('Before word', 7)
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.caret = 11
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_old_caret_alone_never_acknowledges_delivery(self):
        receipt = self.prepare('word')
        self.field_value('word', 0)
        for _ in range(4):
            self.assertEqual(self.verify(receipt)['observation'], 'pending')
    def test_standalone_space_count_can_precede_caret(self):
        self.field_value('Before')
        receipt = self.prepare(' word', first=False)
        self.field_value('Before ', 6)
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.caret = 7
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field_value('Before word', 7)
        self.assertEqual(self.verify(receipt)['observation'], 'pending')
        self.field.caret = 11
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_wrong_content_with_old_caret_fails_closed(self):
        receipt = self.prepare('word')
        self.field_value('oops', 0)
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_expected_content_with_unrelated_caret_fails_closed(self):
        receipt = self.prepare('word')
        self.field_value('word', 2)
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
    def test_stable_wrong_text_after_torn_position_is_changed(self):
        receipt = self.prepare('word')
        original = self.field.get_character_count
        calls = 0
        def count():
            nonlocal calls
            value = original()
            calls += 1
            if calls == 1:
                self.field.insert('oops')
            return value
        self.field.get_character_count = count
        self.assertEqual(self.verify(receipt)['observation'], 'changed')
        self.assertIsNone(helper.DELIVERY)
    def test_capitalized_single_sentence_join(self):
        self.field_value('Hello.')
        receipt = self.prepare('World.')
        self.assertTrue(receipt['added_separator'])
        self.field.insert(' World.')
        self.assertEqual(self.field.value, 'Hello. World.')
        self.assertEqual(self.verify(receipt)['observation'], 'observed')
    def test_lowercase_object_token_is_not_joined(self):
        self.field_value('object.')
        self.assertFalse(self.prepare('method')['added_separator'])
    def test_multi_sentence_context_still_allows_separator(self):
        self.field_value('Earlier sentence. Existing prefix.')
        self.assertTrue(self.prepare()['added_separator'])
    def test_invalid_unicode_is_unavailable(self):
        self.assertEqual(self.prepare('\ud800')['observation'], 'unavailable')
    def test_failed_text_read_clears_snapshot(self):
        receipt = self.prepare()
        self.field.text_get_text = lambda *_: (_ for _ in ()).throw(RuntimeError('unavailable'))
        self.assertEqual(self.verify(receipt)['observation'], 'unavailable')
        self.assertIsNone(helper.DELIVERY)
    def test_selection_contents_are_not_read_during_prepare(self):
        self.field_value('before SENSITIVE after',16,(7,16))
        self.prepare()
        self.assertTrue(all(end<=7 or start>=16 for start,end in self.field.reads))


if __name__ == '__main__': unittest.main()

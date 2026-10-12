"""The evaluator's My words: what a --words file sends with each session start."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('evaluator', Path(__file__).with_name('evaluate-dictation-worker.py'))
evaluator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluator)


def written(value):
    folder = tempfile.mkdtemp()
    path = Path(folder) / 'words.json'
    path.write_text(json.dumps(value))
    return path


class StartFieldsTests(unittest.TestCase):
    def test_without_a_file_the_start_carries_no_words_field(self):
        self.assertEqual(evaluator.start_fields(None), {})

    def test_a_file_gives_its_list_and_taught_versions(self):
        chosen = {'words': ['Quilter'], 'heard': [{'heard': 'Kwilter', 'writes': 'Quilter'}]}
        self.assertEqual(evaluator.start_fields(written(chosen)), chosen)
        self.assertEqual(evaluator.start_fields(written({'words': []})), {'words': []})

    def test_anything_else_is_refused(self):
        for value in (['Quilter'], {'words': 'Quilter'}, {'words': [], 'heard': {}}, {'words': [], 'spelling': 'british'}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                evaluator.start_fields(written(value))


class ReplayTests(unittest.TestCase):
    def test_every_session_start_carries_the_chosen_fields(self):
        sent = []

        def exchange(child, reader, session, seq, op, **fields):
            sent.append((op, fields))
            return {'text': 'quilter' if op == 'finish' else None}
        process = types.SimpleNamespace(memory_info=lambda: types.SimpleNamespace(rss=1),
                                        cpu_times=lambda: types.SimpleNamespace(user=0, system=0))
        psutil = types.SimpleNamespace(Process=lambda pid: process)
        item = dict(id='clip', split='development', sha256='0' * 64, reference='QUILTER', rate=16000, audio=[0.0] * 3200)
        chosen = {'words': ['Quilter'], 'heard': [{'heard': 'Kwilter', 'writes': 'Quilter'}]}
        with mock.patch.object(evaluator, 'exchange', exchange), mock.patch.dict(sys.modules, psutil=psutil):
            row = evaluator.replay(types.SimpleNamespace(pid=1), None, item, 0, 100, False, chosen)
        self.assertEqual(sent[0], ('start', chosen))
        self.assertEqual([op for op, _ in sent[1:]], ['push', 'push', 'finish'])
        self.assertEqual(row['hypothesis'], 'quilter')


if __name__ == '__main__':
    unittest.main()

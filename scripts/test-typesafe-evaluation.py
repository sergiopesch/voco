"""Test evaluation boundaries without credentials or network requests."""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('judge',Path(__file__).with_name('typesafe-evaluate.py'))
judge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(judge)


def response():
    q=judge.questions(False)
    return {'model':judge.MODEL,'usage':{'input_tokens':300,'output_tokens':30},'answers':{
        'meaning':{'type':'score','score':2.99,'confidence':.99,
                   'legend':{str(i):x for i,x in enumerate(q['meaning']['criteria'])},
                   'probabilities':{'0':0.,'1':0.,'2':0.,'3':1.}},
        'material_error':{'type':'noul','noul':.02}}}


class EvaluationTests(unittest.TestCase):
    def test_unaudited_formatting_has_no_question(self):
        self.assertNotIn('punctuation',judge.questions(False))
        self.assertIn('punctuation',judge.questions(True))

    def test_live_rounding_is_accepted(self):
        judge.validate_response(response(),judge.questions(False))

    def test_malformed_answers_are_not_scores(self):
        mutations=[lambda x:x.update(model='jev-latest'),
                   lambda x:x['answers'].pop('material_error'),
                   lambda x:x['answers']['meaning'].update(score=float('nan')),
                   lambda x:x['answers']['meaning'].update(score=True),
                   lambda x:x['answers']['meaning'].update(score=1),
                   lambda x:x['answers']['meaning']['probabilities'].update({'3':.2}),
                   lambda x:x['answers']['meaning']['legend'].update({'3':'different'}),
                   lambda x:x['answers']['material_error'].update(noul=1.1),
                   lambda x:x['usage'].update(input_tokens=-1)]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                x=copy.deepcopy(response());mutate(x)
                with self.assertRaises(ValueError):judge.validate_response(x,judge.questions(False))

    def test_private_file_and_symlink_boundary(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'key';path.write_text('test-value-not-a-real-key');path.chmod(0o600)
            self.assertEqual(judge.credential(path),'test-value-not-a-real-key')
            link=Path(folder)/'link';link.symlink_to(path)
            with self.assertRaises(OSError):judge.credential(link)
            path.chmod(0o644)
            with self.assertRaises(ValueError):judge.credential(path)

    def test_empty_key_is_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'key';path.touch(mode=0o600)
            with self.assertRaises(ValueError):judge.credential(path)

    def test_redirect_is_not_followed(self):
        self.assertIsNone(judge.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example'))


if __name__=='__main__':unittest.main()

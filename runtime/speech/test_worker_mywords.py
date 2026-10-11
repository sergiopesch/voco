"""The worker writes each session's listed words as listed, append-only."""
import unittest

from mywords import BOOST
from test_worker_spelling import session


class WorkerMyWordsTests(unittest.TestCase):
    HYPOTHESES = ['Please add git', 'Please add git hub', 'Please add git hub to the colo',
                  'Please add git hub to the color']
    FINAL = 'Please add git hub to the colors.'

    def test_listed_words_are_boosted_and_written_as_listed(self):
        responses, rows = session(self.HYPOTHESES, self.FINAL, spelling='british', words=['GitHub'])
        self.assertEqual(session.model.phrases, ['GitHub'])
        self.assertEqual(session.model.boost, BOOST)
        self.assertEqual([response['text'] for response in responses],
                         [None, 'Please add ', None, 'Please add GitHub to the colo', None,
                          'Please add GitHub to the colours.'])
        # Diagnostics never mention the list, not even how long it is.
        self.assertFalse(any({'text', 'transcript', 'audio', 'words', 'phrases', 'my_words'} & row.keys() for row in rows))
        self.assertFalse(any('GitHub' in str(value) for row in rows for value in row.values()))

    def test_a_start_without_words_is_as_recognised(self):
        responses, rows = session(self.HYPOTHESES, self.FINAL)
        self.assertEqual(session.model.phrases, [])
        self.assertEqual([response['text'] for response in responses][1:], self.HYPOTHESES + [self.FINAL])

    def test_unusable_entries_are_skipped_and_a_malformed_list_rejects_the_start(self):
        responses, rows = session(['the git hub'], 'the git hub', words=['C++', 'GitHub', 'github'])
        self.assertEqual(responses[-1]['text'], 'the GitHub')
        self.assertEqual(session.model.phrases, ['GitHub'])
        for words in ('GitHub', [3], None):
            with self.subTest(words=words):
                responses, rows = session(['the color'], 'the color', words=words)
                self.assertTrue(all('error' in response for response in responses))
                self.assertEqual(rows[0]['error_code'], 'invalid_words')


if __name__ == '__main__':
    unittest.main()

"""My words: listed spellings, the list rules and append-only pushes."""
import random
import unittest

from mywords import MAX_CHARS, MAX_TERMS, Words, accepted
from spelling import Spelling

LIST = ['GitHub', 'PipeWire', 'GTK', 'Zoë', 'Málaga', 'New Zealand', 'Siobhán', 'router', 'Kubernetes']


def written(words, text):
    restored, _, _ = words.restore(text, final=True)
    return restored


class RestoreTests(unittest.TestCase):
    words = Words(LIST)

    def test_listed_terms_are_written_as_listed(self):
        cases = {
            'Please add git hub to the agenda.': 'Please add GitHub to the agenda.',
            'I sent it to Pipewire. Pipe wire too': 'I sent it to PipeWire. PipeWire too',
            'we talked about G T K and Qt': 'we talked about GTK and Qt',
            'Zoe should be here, said zoe': 'Zoë should be here, said Zoë',
            'malaga is on my list': 'Málaga is on my list',
            'New zealand sent me a message': 'New Zealand sent me a message',
            'the Git-hub setup': 'the GitHub setup',
            'we run k u b e r n e t e s': 'we run Kubernetes',
            "Siobhan's notes": "Siobhán's notes",
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(self.words, heard), expected)

    def test_a_lowercase_entry_keeps_sentence_case_and_only_whole_words_match(self):
        self.assertEqual(written(self.words, 'My Router broke. router says no'), 'My router broke. Router says no')
        mixed = Words(['iPhone', 'eBay'])
        self.assertEqual(written(mixed, 'Iphone is ready. ebay too'), 'iPhone is ready. eBay too')
        for heard in ('Pipe. Wire', 'Pipe, wire', 'routers', 'GitHubs', 'pipewiring'):
            with self.subTest(heard=heard):
                self.assertEqual(written(self.words, heard), heard)

    def test_full_stops_join_only_terms_listed_with_them(self):
        words = Words(['St. Ives', 'Acme Inc.', 'GitHub'])
        cases = {
            'we met at st. ives today': 'we met at St. Ives today',
            'we met at St Ives today': 'we met at St. Ives today',
            'Acme inc. makes tea': 'Acme Inc. makes tea',
            'we work at acme inc.': 'we work at Acme Inc.',
            'acme inc makes tea': 'Acme Inc. makes tea',
            'I use git. Hub is new': 'I use git. Hub is new',
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(words, heard), expected)
        restored, _, settled = words.restore('we met at St.', final=False)
        self.assertEqual(restored[:settled], 'we met at ')

    def test_listed_spans_protect_their_words_from_spelling(self):
        words = Words(['Color Run', 'harbor'])
        restored, listed, _ = words.restore('the color run by the harbor and the color', final=True)
        british = Spelling().converter('british')
        self.assertEqual(british.final(restored, listed), 'the Color Run by the harbor and the colour')

    def test_an_empty_list_changes_nothing(self):
        words = Words([])
        for text in ('', 'git hub', 'zoe.'):
            self.assertEqual(words.restore(text, final=False), (text, [], len(text)))
        self.assertEqual(words.phrases(), [])


class StabilityTests(unittest.TestCase):
    words = Words(LIST)

    def pushes(self, final, words=None):
        """What each growing hypothesis may push: its settled restored text."""
        out = []
        for end in range(1, len(final) + 1):
            restored, _, settled = (words or self.words).restore(final[:end].rstrip(), final=False)
            out.append(restored[:settled])
        return out

    def test_a_tail_that_could_become_a_term_waits(self):
        restored, _, settled = self.words.restore('Please add git', final=False)
        self.assertEqual(restored[:settled], 'Please add ')
        restored, _, settled = self.words.restore('Please add git hub to', final=False)
        self.assertEqual(restored[:settled], 'Please add GitHub to')
        restored, _, settled = self.words.restore('New', final=False)
        self.assertEqual(restored[:settled], '')
        restored, _, settled = self.words.restore('New ideas', final=False)
        self.assertEqual(restored[:settled], 'New ideas')

    def test_every_push_extends_the_last_and_the_final_extends_them_all(self):
        rng = random.Random(62)
        vocabulary = ['git', 'hub', 'Git', 'Hub', 'pipe', 'wire', 'G', 'T', 'K', 'zoe', 'Zoë', 'malaga', 'new', 'New',
                      'zealand', 'Zealand', 'siobhan', 'router', 'the', 'a', 'and', 'st', 'St', 'ives', 'acme', 'inc']
        punctuation = ['', '', '', ',', '.', '?']
        for words in (self.words, Words(LIST + ['St. Ives', 'Acme Inc.'])):
            for _ in range(400):
                final = ' '.join(rng.choice(vocabulary) + rng.choice(punctuation) for _ in range(rng.randint(1, 9)))
                done = written(words, final)
                previous = ''
                for pushed in self.pushes(final, words):
                    self.assertTrue(pushed.startswith(previous), (final, previous, pushed))
                    self.assertTrue(done.startswith(pushed), (final, pushed, done))
                    previous = pushed


class ListRuleTests(unittest.TestCase):
    def test_valid_entries_are_kept_in_order(self):
        valid = ['GitHub', 'New Zealand', "O'Neill", 'St. Ives', 'Jean-Luc', 'GTK', 'Málaga', 'R2D2', 'Acme Inc.',
                 'x' * MAX_CHARS]
        self.assertEqual(accepted(valid), valid)
        self.assertEqual(len(accepted([f'term{index}' for index in range(MAX_TERMS)])), MAX_TERMS)
        self.assertEqual(accepted(['Ma\u0301laga']), ['Málaga'])  # decomposed accents compose

    def test_unusable_entries_are_skipped_and_the_first_of_two_alike_is_written(self):
        unusable = ['', ' GitHub', 'GitHub ', 'two  spaces', 'x' * (MAX_CHARS + 1), 'one two three four five',
                    'C++', 'a_b', 'tab\there', 'Line\nbreak', '-dash', 'end-']
        alike = ['Zoë', 'zoe', 'Git Hub', 'github', 'Straße', 'STRASSE']
        words = Words(unusable + alike)
        self.assertEqual(words.terms, alike)
        self.assertEqual(written(words, 'zoe and github and strasse'), 'Zoë and Git Hub and Straße')
        self.assertEqual(len(Words([f'term{index}' for index in range(MAX_TERMS + 5)]).terms), MAX_TERMS)

    def test_a_malformed_list_rejects_the_start(self):
        for terms in ('GitHub', None, {'GitHub': 1}, ['GitHub', 3]):
            with self.subTest(terms=terms), self.assertRaises(ValueError):
                Words(terms)


if __name__ == '__main__':
    unittest.main()

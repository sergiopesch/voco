"""My words: listed spellings, the list rules and append-only pushes."""
import random
import unittest

from mywords import MAX_CHARS, MAX_HEARD, MAX_TERMS, Words, accepted
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
        self.assertEqual(written(Words(['O’Neill']), "o'neill said"), 'O’Neill said')
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
            'we met acme. inc is here': 'we met acme. inc is here',
            's t. ives': 'St. Ives',
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(words, heard), expected)
        restored, _, settled = words.restore('we met at St.', final=False)
        self.assertEqual(restored[:settled], 'we met at ')

    def test_an_apostrophe_after_a_listed_word_waits_for_what_follows(self):
        words = Words(['can', 'GitHub'])
        for hypothesis in ("I can'", "github'", "github's"):
            with self.subTest(hypothesis=hypothesis):
                restored, _, settled = words.restore(hypothesis, final=False)
                self.assertNotIn("'", restored[:settled])
        self.assertEqual(written(words, "I can't use github's api"), "I can't use GitHub's api")

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


class TaughtTests(unittest.TestCase):
    """Versions the user taught VOCO: what the recognizer wrote for an entry."""
    SHIVON = [{'heard': 'Shivon', 'writes': 'Siobhán'}]

    def test_a_taught_version_writes_its_entry_wherever_the_recognizer_writes_it(self):
        words = Words(['Siobhán', 'GitHub'], self.SHIVON)
        cases = {
            'Shivon said hello': 'Siobhán said hello',
            'I told shivon.': 'I told Siobhán.',
            'ask Shi von': 'ask Siobhán',
            'Shi-von wrote': 'Siobhán wrote',
            "Shivon's notes": "Siobhán's notes",
            'Shivonne and shivons': 'Shivonne and shivons',
            'git hub and Shivon': 'GitHub and Siobhán',
            'Shi. Von': 'Shi. Von',
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(words, heard), expected)

    def test_a_taught_version_can_write_one_word_of_an_entry(self):
        words = Words(['Siobhán Kelly'], self.SHIVON)
        cases = {
            'Shivon Kelly called': 'Siobhán Kelly called',
            'Shivon called': 'Siobhán called',
            'siobhan kelly called': 'Siobhán Kelly called',
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(words, heard), expected)

    def test_a_version_of_one_word_writes_the_whole_entry_said_in_full(self):
        words = Words(['José García', 'Dr. Siobhán Kelly'], [{'heard': 'Hosay', 'writes': 'José'},
                                                            {'heard': 'Shivon', 'writes': 'Siobhán'}])
        cases = {
            'Hosay Garcia said': 'José García said',
            'hosay garcía': 'José García',
            "Hosay Garcia's car": "José García's car",
            'Hosay said': 'José said',
            'Garcia said': 'Garcia said',
            'I met Dr. Shivon Kelly': 'I met Dr. Siobhán Kelly',
            'I met Dr Shivon Kelly': 'I met Dr. Siobhán Kelly',
            'I met Shivon': 'I met Siobhán',
        }
        for heard, expected in cases.items():
            with self.subTest(heard=heard):
                self.assertEqual(written(words, heard), expected)
        restored, _, settled = words.restore('Hosay Garcia', final=False)
        self.assertEqual(restored[:settled], '', 'The open entry waits for its last word')

    def test_a_version_of_a_word_stands_for_it_in_every_entry_with_it(self):
        words = Words(['José', 'José García'], [{'heard': 'Hosay', 'writes': 'José'}])
        self.assertEqual(written(words, 'Hosay Garcia and Hosay'), 'José García and José')

    def test_a_version_belongs_to_the_entry_it_writes_whole(self):
        # "Siobhán" is a word of the first entry, but the version was taught for the second.
        versions = [{'heard': f'version{index}', 'writes': 'Siobhán'} for index in range(MAX_HEARD)]
        words = Words(['Siobhán Kelly', 'Siobhán'], versions + [{'heard': 'Kellie', 'writes': 'Kelly'}])
        self.assertEqual(written(words, 'version4 and Kellie'), 'Siobhán and Kelly')

    def test_taught_versions_are_never_boosted_and_are_protected_from_spelling(self):
        words = Words(['Colour Labs'], [{'heard': 'collar labs', 'writes': 'Colour Labs'}])
        self.assertEqual(words.phrases(), ['Colour Labs'])
        restored, listed, _ = words.restore('the collar labs color', final=True)
        self.assertEqual(Spelling().converter('american').final(restored, listed), 'the Colour Labs color')

    def test_without_taught_versions_restore_is_unchanged(self):
        rng = random.Random(64)
        vocabulary = ['git', 'hub', 'zoe', 'new', 'zealand', 'siobhan', 'router', 'shivon', 'the', "can't"]
        plain, empty = Words(LIST), Words(LIST, [])
        for _ in range(300):
            text = ' '.join(rng.choice(vocabulary) + rng.choice(['', ',', '.']) for _ in range(rng.randint(1, 8)))
            for final in (False, True):
                self.assertEqual(plain.restore(text, final), empty.restore(text, final))

    def test_a_tail_that_could_become_a_taught_version_waits(self):
        words = Words(['Siobhán'], [{'heard': 'Shi von', 'writes': 'Siobhán'}])
        for hypothesis, settled_text in (('I met Shi', 'I met '), ('I met shi von', 'I met '),
                                         ('I met Shi von today', 'I met Siobhán today'), ('I met Shirley', 'I met Shirley')):
            with self.subTest(hypothesis=hypothesis):
                restored, _, settled = words.restore(hypothesis, final=False)
                self.assertEqual(restored[:settled], settled_text)

    def test_unusable_versions_are_skipped(self):
        unusable = [
            {'heard': 'Nobody', 'writes': 'Somebody'},
            {'heard': 'Shi. Von', 'writes': 'Siobhán'},
            {'heard': 'Shi, von', 'writes': 'Siobhán'},
            {'heard': '', 'writes': 'Siobhán'},
            {'heard': 'x' * (MAX_CHARS + 1), 'writes': 'Siobhán'},
            {'heard': 'one two three four five', 'writes': 'Siobhán'},
            {'heard': 'git hub', 'writes': 'Siobhán'},
            {'heard': 'SIOBHAN', 'writes': 'Siobhán'},
            {'heard': 'Shivon', 'writes': 'siobhán'},
        ]
        words = Words(['Siobhán', 'GitHub'], unusable)
        self.assertEqual(written(words, 'Nobody, Shi. Von, Shi, von, git hub, Shivon'),
                         'Nobody, Shi. Von, Shi, von, GitHub, Shivon')
        # Of two versions that match alike, the first is written.
        words = Words(['Siobhán', 'Shauna'], [{'heard': 'Shivon', 'writes': 'Siobhán'},
                                              {'heard': 'shi von', 'writes': 'Shauna'}])
        self.assertEqual(written(words, 'Shivon'), 'Siobhán')
        versions = [{'heard': f'version{index}', 'writes': 'Siobhán'} for index in range(MAX_HEARD + 1)]
        words = Words(['Siobhán'], versions)
        self.assertEqual(written(words, f'version{MAX_HEARD - 1} version{MAX_HEARD}'), f'Siobhán version{MAX_HEARD}')

    def test_malformed_versions_reject_the_start(self):
        for heard in ('Shivon', None, ['Shivon'], [{'heard': 'Shivon'}], [{'heard': 3, 'writes': 'Siobhán'}]):
            with self.subTest(heard=heard), self.assertRaises(ValueError):
                Words(['Siobhán'], heard)


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
        vocabulary += ["can't", "github's", "can"]
        vocabulary += ['shi', 'von', 'Shivon']
        taught = [{'heard': 'Shi von', 'writes': 'Siobhán'}, {'heard': 'new zeal', 'writes': 'New Zealand'}]
        for words in (self.words, Words(LIST + ['St. Ives', 'Acme Inc.', 'can']), Words(LIST, taught)):
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

    def test_shared_fixture_validates_nfc_and_nfd_alike(self):
        """Shared fixture tests NFC/NFD normalization and validation rules."""
        import json
        with open('tests/fixtures/mywords/entries.json') as f:
            cases = json.load(f)
        for case in cases:
            result = accepted([case['input']])
            if case['expectedVerdict'] == 'accept':
                self.assertEqual(len(result), 1, f"{case['label']}: expected accept")
                # Note: Python counts words by splitting on spaces, not by the worker's rules,
                # so we don't validate word count here. Rust and TypeScript match the worker.
            else:
                self.assertEqual(len(result), 0, f"{case['label']}: expected reject")

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

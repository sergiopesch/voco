"""Spelling conversion: exact, append-only and limited to unambiguous forms."""
import json
import lzma
import os
from pathlib import Path
import random
import re
import subprocess
import sys
import unittest
from spelling import MODES, TABLE, Spelling, WORD

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
SPELLING = Spelling()
BRITISH = SPELLING.converter('british')
AMERICAN = SPELLING.converter('american')
# Spelled the same in both varieties for some meaning, or kept as said.
UNCHANGED = ('program programs check checks practice license licenses tire tires curb story '
             'stories meter meters draft drafts prize dialog analog gray disk disc jail '
             'judgment aging inquiry toward towards learned learnt spoilt mom moms math maths '
             'airplane aeroplane aluminum aluminium specialty speciality whiskey whiskeys '
             'groin groins').split()


def appended(converter, steps):
    """Every push result and the finish, checked for append-only growth."""
    emitted = ''
    for text in steps:
        stable = converter.stable(text)
        if not stable.startswith(emitted):
            raise AssertionError(f'{emitted!r} revised to {stable!r} at {text!r}')
        emitted = stable
    final = converter.final(steps[-1])
    if not final.startswith(emitted):
        raise AssertionError(f'{emitted!r} revised to {final!r} at finish')
    return final


class TableTests(unittest.TestCase):
    def test_table_carries_varcon_and_ispell_notices_marked_as_modified(self):
        header = ''.join(line for line in TABLE.read_text(encoding='utf-8').splitlines(True) if line.startswith('#'))
        for notice in ('modified from VarCon 2020.12.07', 'Copyright 2000-2019 by Kevin Atkinson',
                       'Copyright 2016 by Benjamin Titze', 'Copyright 1993, Geoff Kuenning',
                       'must be clearly marked as modified versions', 'SHA-256 340858b990255ec409adcf7faaf2b992aa2a76a16f30b4b9e2663863191dba33'):
            self.assertIn(notice, header)

    def test_table_holds_only_lowercase_changes(self):
        for converter in (BRITISH, AMERICAN):
            self.assertGreater(len(converter.words), 3000)
            for recognised, written in converter.words.items():
                self.assertNotEqual(recognised, written)
                self.assertRegex(recognised, r"^[a-z]+(?:'[a-z]+)*$")
                self.assertRegex(written, r"^[a-z]+(?:'[a-z]+)*$")

    def test_meaning_dependent_and_kept_words_never_change(self):
        for word in UNCHANGED:
            self.assertNotIn(word, BRITISH.words, word)
            self.assertNotIn(word, AMERICAN.words, word)

    def test_unknown_mode_is_rejected_and_as_recognised_changes_nothing(self):
        with self.assertRaisesRegex(ValueError, 'spelling'):
            SPELLING.converter('australian')
        self.assertEqual(MODES, ('as-recognised', 'british', 'american'))
        same = SPELLING.converter('as-recognised')
        for text in ('The color of the theater.', 'Colo', ''):
            self.assertEqual(same.stable(text), text)
            self.assertEqual(same.final(text), text)

    @unittest.skipUnless(os.environ.get('VOCO_VARCON_SOURCE'), 'VOCO_VARCON_SOURCE names no pinned varcon.txt')
    def test_table_matches_its_generator(self):
        subprocess.run([sys.executable, '-I', str(REPOSITORY / 'scripts/generate-spelling-table.py'), '--check',
                        os.environ['VOCO_VARCON_SOURCE']], check=True, capture_output=True)


class ConversionTests(unittest.TestCase):
    def test_both_directions_keep_inflections_and_possessives(self):
        self.assertEqual(BRITISH.final("We recognized the organization's colors and traveled to the theater."),
                         "We recognised the organisation's colours and travelled to the theatre.")
        self.assertEqual(AMERICAN.final("We recognised the organisation's colours and travelled to the centre."),
                         "We recognized the organization's colors and traveled to the center.")
        self.assertEqual(BRITISH.final('practiced, practicing, but practice'), 'practised, practising, but practice')
        self.assertEqual(AMERICAN.final('defence and offence; the traveller paid by cheque'),
                         'defense and offense; the traveler paid by check')

    def test_only_lowercase_words_convert(self):
        for text in ('Color is bold. COLOR is BOLD.', 'a colorScheme', 'Organization matters.'):
            self.assertEqual(BRITISH.final(text), text)
        self.assertEqual(BRITISH.final('the color COLOR'), 'the colour COLOR')
        self.assertEqual(AMERICAN.final('Colour me in, the colour'), 'Colour me in, the color')

    def test_names_stay_even_first_in_a_sentence(self):
        for text in ('We went to Pearl Harbor.', 'It was Labor Day.', 'At One World Trade Center we met.',
                     'Labor Day is here.', 'Center Parcs opens.', 'Honor is speaking.',
                     'Color is a software package.', "Color I like. Color? Honor"):
            self.assertEqual(BRITISH.final(text), text)
        self.assertEqual(BRITISH.final('The color. Honor said so.'), 'The colour. Honor said so.')

    def test_code_numbers_and_other_scripts_stay(self):
        for text in ('--color and -color', 'foo_color color_name', 'style.color', 'color2 2color', 'a/color',
                     'coloré', 'x=color'):
            self.assertEqual(BRITISH.final(text), text, text)
        self.assertEqual(BRITISH.final('color-blind'), 'colour-blind')

    def test_punctuation_and_spacing_are_unchanged(self):
        text = "  Well, the colors' meaning? The neighbor's color!  "
        self.assertEqual(BRITISH.final(text), "  Well, the colours' meaning? The neighbour's colour!  ")

    def test_onboarding_sample_sentences_convert_into_each_other(self):
        source = REPOSITORY / 'apps/desktop/src/lib/englishSpelling.ts'
        if not source.is_file():
            self.skipTest('the desktop source is not beside this runtime')
        samples = dict(re.findall(r'(british|american): \{[^}]*?sample: "([^"]+)"', source.read_text()))
        examples = dict(re.findall(r'(british|american): \{[^}]*?examples: \[([^\]]+)\]', source.read_text()))
        self.assertEqual(set(samples), {'british', 'american'})
        self.assertEqual(BRITISH.final(samples['american']), samples['british'])
        self.assertEqual(AMERICAN.final(samples['british']), samples['american'])
        british, american = (re.findall(r'"([^"]+)"', examples[mode]) for mode in ('british', 'american'))
        self.assertEqual([BRITISH.final(word) for word in american], british)
        self.assertEqual([AMERICAN.final(word) for word in british], american)


class StreamingTests(unittest.TestCase):
    SENTENCES = (
        "I recognized the organization's colors.", 'Color is my favorite. Labor Day is near.',
        'The traveler canceled the theater trip.', "Honor I'd keep, Honor Irene.", "the colors' fade",
        'We fulfill and enroll; the fulfillment center.', 'Estrogen and hemoglobin levels.',
        'He traveled. She traveled! They traveled?', 'COLOR Theory and color theory.',
    )

    def test_every_character_prefix_is_append_only_and_exact(self):
        for converter in (BRITISH, AMERICAN):
            for sentence in self.SENTENCES + tuple(AMERICAN.final(s) for s in self.SENTENCES):
                steps = [sentence[:end] for end in range(1, len(sentence) + 1)]
                self.assertEqual(appended(converter, steps), converter.final(sentence))

    def test_open_words_wait_only_where_spelling_differs(self):
        self.assertEqual(BRITISH.stable('I recogni'), 'I recogni')
        self.assertEqual(BRITISH.stable('I recognize'), 'I recogni')
        self.assertEqual(BRITISH.stable('I recognize it'), 'I recognise it')
        self.assertEqual(BRITISH.stable('the catalog'), 'the catalog')
        self.assertEqual(BRITISH.final('the catalog'), 'the catalogue')
        self.assertEqual(BRITISH.stable('the plain words'), 'the plain words')

    def test_capitalized_open_words_never_wait(self):
        for text in ('Color', 'Color ', 'COLOR', "Honor I'm", 'The Colo'):
            self.assertEqual(BRITISH.stable(text), text)
        self.assertEqual(BRITISH.final('Color'), 'Color')

    def test_random_word_piece_growth_is_append_only(self):
        rng = random.Random(62)
        words = ['color', 'Color', 'the', 'recognize', 'organization', "neighbor's", 'I', 'Labor', 'Day',
                 'traveled', 'center', 'program', 'check', 'a', 'he', 'hemoglobin', 'COLOR', 'colors']
        for converter in (BRITISH, AMERICAN):
            for _ in range(300):
                text = ' '.join(rng.choice(words) + rng.choice(['', '', '', ',', '.', '?']) for _ in range(rng.randint(1, 12)))
                cuts = sorted({rng.randint(1, len(text)) for _ in range(rng.randint(1, 8))} | {len(text)})
                self.assertEqual(appended(converter, [text[:cut] for cut in cuts]), converter.final(text))

    def test_long_dictation_stays_fast(self):
        import time
        text = ' '.join(["I recognized the organization's favorite colors, and the theater"] * 400)
        started = time.perf_counter()
        BRITISH.stable(text)
        self.assertLess(time.perf_counter() - started, 0.1)


class BenchmarkTests(unittest.TestCase):
    """Nemotron's own hypotheses from the October 2026 benchmark at VOCO's step."""

    def setUp(self):
        run = REPOSITORY / 'research/engine-benchmark-2026-10/results/runs/nemo-en-r1.jsonl.xz'
        if not run.is_file():
            self.skipTest('the benchmark results are not beside this runtime')
        with lzma.open(run, 'rt') as rows:
            self.utterances = [row for row in map(json.loads, rows) if 'steps' in row]

    def test_replay_is_exact_append_only_and_rarely_waits(self):
        for converter, changes in ((BRITISH, 20), (AMERICAN, 8)):
            words = changed = held = 0
            for utterance in self.utterances:
                steps = [(step[2], step[3]) for step in utterance['steps'] if len(step) >= 4]
                final = appended(converter, [text for text, _ in steps] + [utterance['final']])
                self.assertEqual(final, converter.final(utterance['final']))
                recognised = list(WORD.finditer(utterance['final']))
                written = list(WORD.finditer(final))
                self.assertEqual(len(recognised), len(written))
                outputs = [(converter.stable(text), text) for text, _ in steps]
                for raw, out in zip(recognised, written):
                    words += 1
                    changed += raw[0] != out[0]
                    raw_step = next((i for i, (_, text) in enumerate(outputs) if text[:raw.end()] == utterance['final'][:raw.end()]), len(outputs))
                    out_step = next((i for i, (text, _) in enumerate(outputs) if text[:out.end()] == final[:out.end()]), len(outputs))
                    held += out_step > raw_step
            self.assertEqual(changed, changes, converter.mode)
            self.assertEqual(words, 6377)
            # About 1.1% (British) and 1.7% (American) of words wait for one more hypothesis.
            self.assertLess(held / words, .025, converter.mode)


if __name__ == '__main__':
    unittest.main()

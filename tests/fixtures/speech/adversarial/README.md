# Held-out public speech fixtures

Four untrimmed utterances from [LibriSpeech dev-clean](https://www.openslr.org/12/), copyright 2014 Vassil Panayotov, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original notice is in `LICENSE.txt`. Reader names, references, original archive members, FLAC/WAV/PCM SHA-256 hashes and archive MD5/SHA-256 checksums are recorded in `manifest.json`.

The selection is fixed: exclude the eight development speakers in `tests/fixtures/speech`, take the first four remaining numeric speaker IDs, and choose each speaker's first lexicographic utterance. The selected speakers are 777, 1272, 1988 and 1993. These 30.26 seconds of public read English add independent speakers to the bounded regression corpus; they are not a representative dictation benchmark.

WAVs are lossless decodes of the original mono 16 kHz FLAC samples to PCM16. No words, timing, loudness or samples were changed. References come from corpus transcripts, never model output.

`scripts/evaluate-dictation-worker.py --split held-out` streams these files into the speech worker without network access, audio devices or ffmpeg. Use `--split all` to score them together with the development fixtures; [the evaluation guide](../../../../docs/testing/typesafe-evaluation.md) has the complete command.

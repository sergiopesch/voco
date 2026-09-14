# Additional public speech fixtures

Four untrimmed utterances from [LibriSpeech dev-clean](https://www.openslr.org/12/), copyright 2014 Vassil Panayotov, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original notice is in `LICENSE.txt`. Reader names, references, original archive members, FLAC/WAV/PCM SHA-256 hashes and archive MD5/SHA-256 checksums are recorded in `manifest.json`.

The selection was fixed before candidate inference: exclude the original eight baseline speakers, take the first four remaining numeric speaker IDs, and choose each speaker's first lexicographic utterance. The selected speakers are 777, 1272, 1988 and 1993. These 30.26 seconds of public read English add independent speakers to the bounded regression corpus; they are not a representative dictation benchmark.

WAVs are lossless decodes of the original mono 16 kHz FLAC samples to PCM16. No words, timing, loudness or samples were changed. The checked-in WAVs are byte-identical to those used in the prospectively frozen 58-case evaluation plan. References come from corpus transcripts, never model output.

`python3 scripts/test-speech-adversarial.py prepare --plan-dir NEW_DIRECTORY` verifies and uses these files without network access or ffmpeg. The optional `--archive /path/to/dev-clean.tar.gz` verifies the original archive, independently repeats the selection, verifies source FLAC and reference text, decodes the same samples with ffmpeg, and requires their PCM hashes to match. Both modes generate identical 58 case definitions and PCM; their provenance identifies which source mode was used.

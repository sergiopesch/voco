"""The tokenizer graft adds one metadata entry, changes no tensor byte, and
replaces a model only with the pinned result."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tokenizer_graft = load("graft_model_tokenizer", "graft-model-tokenizer.py")
VOCAB = ["<unk>", "▁the", "s", "▁VO", "CO"]


def string(text):
    raw = text.encode()
    return struct.pack("<Q", len(raw)) + raw


def entry(key, kind, payload):
    return string(key) + struct.pack("<I", kind) + payload


def gguf(vocab=VOCAB, extra=()):
    """A two-tensor GGUF 3 file with the metadata the graft reads."""
    entries = [
        entry("general.architecture", 8, string("fixture")),
        entry("general.alignment", 4, struct.pack("<I", 32)),
        entry("asr.window", 9, struct.pack("<IQ", 6, 2) + struct.pack("<ff", 0.5, 1.5)),
        entry("asr.tokenizer.vocab", 9, struct.pack("<IQ", 8, len(vocab)) + b"".join(map(string, vocab))),
        *extra,
    ]
    info = b"".join(string(name) + struct.pack("<IQIQ", 1, 4, 0, offset) for name, offset in (("a", 0), ("b", 32)))
    body = b"GGUF" + struct.pack("<IQQ", 3, 2, len(entries)) + b"".join(entries) + info
    return body + b"\0" * (-len(body) % 32) + bytes(range(64))


def varint(value):
    out = bytearray()
    while True:
        out.append((value & 0x7F) | (0x80 if value > 0x7F else 0))
        value >>= 7
        if not value:
            return bytes(out)


def field(number, wire, payload):
    tag = varint(number << 3 | wire)
    return tag + (varint(len(payload)) + payload if wire == 2 else payload)


def sentencepiece(vocab=VOCAB):
    """A ModelProto: each piece with its string, score and type, then trainer options."""
    pieces = b"".join(field(1, 2, field(1, 2, piece.encode()) + field(2, 5, struct.pack("<f", -1.0))
                                + field(3, 0, varint(1))) for piece in vocab)
    return pieces + field(2, 2, field(1, 2, b"fixture.txt"))


def tar_header(name, size):
    header = bytearray(512)
    header[:len(name)] = name.encode()
    header[100:108] = b"0000644\0"
    header[124:136] = f"{size:011o}\0".encode()
    header[156:157] = b"0"
    header[257:265] = b"ustar\x0000"
    header[148:156] = b" " * 8
    header[148:156] = f"{sum(header):06o}\0 ".encode()
    return bytes(header)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


class GraftTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.base, self.tokenizer = gguf(), sentencepiece()
        self.model = self.folder / "model.gguf"
        self.model.write_bytes(self.base)
        self.model.chmod(0o644)
        with open(self.folder / "expected.gguf", "wb") as out:
            tokenizer_graft.graft(self.model, self.tokenizer, out)
        self.expected = (self.folder / "expected.gguf").read_bytes()
        self.identity = {
            "source": "https://huggingface.co/nvidia/fixture", "revision": "0" * 40,
            "model_sha256": sha256(self.expected), "base_model_sha256": sha256(self.base),
            "tokenizer": {"archive": "fixture.nemo", "member": "./abc_tokenizer.model",
                          "offset": 2048, "size": len(self.tokenizer), "sha256": sha256(self.tokenizer)}}

    def headers(self, data):
        path = self.folder / "read.gguf"
        path.write_bytes(data)
        with open(path, "rb") as stream:
            return tokenizer_graft.read_header(stream)

    def test_the_graft_adds_only_the_tokenizer_and_keeps_every_tensor_byte(self):
        before, after = self.headers(self.base), self.headers(self.expected)
        self.assertEqual(after["spans"][:-1], before["spans"])
        self.assertEqual(list(after["metadata"])[-1], "asr.tokenizer.spm_model")
        self.assertEqual(base64.b64decode(after["metadata"]["asr.tokenizer.spm_model"]), self.tokenizer)
        self.assertEqual(after["info"], before["info"])
        self.assertEqual(after["tensors"], 2)
        self.assertEqual(after["data_start"] % 32, 0)
        self.assertEqual(self.expected[after["data_start"]:], self.base[before["data_start"]:])
        self.assertEqual(before["metadata"]["asr.window"], [0.5, 1.5])

    def test_upgrade_replaces_the_nvidia_file_once_and_keeps_its_mode(self):
        self.assertEqual(tokenizer_graft.upgrade(self.model, self.identity, self.tokenizer), "grafted")
        self.assertEqual(self.model.read_bytes(), self.expected)
        self.assertEqual(self.model.stat().st_mode & 0o777, 0o644)
        self.assertEqual(tokenizer_graft.upgrade(self.model, self.identity, fetch=self.fail), "pinned")
        self.assertFalse(any(p.name.startswith(".graft-") for p in self.folder.iterdir()))

    def test_upgrade_fetches_the_tokenizer_when_none_is_given(self):
        fetched = []
        def fetch(identity):
            fetched.append(identity)
            return self.tokenizer
        self.assertEqual(tokenizer_graft.upgrade(self.model, self.identity, fetch=fetch), "grafted")
        self.assertEqual(fetched, [self.identity])

    def test_upgrade_refuses_other_models_and_tokenizers_and_leaves_the_file(self):
        self.model.write_bytes(self.base + b"x")
        with self.assertRaisesRegex(ValueError, "neither the pinned model"):
            tokenizer_graft.upgrade(self.model, self.identity, self.tokenizer)
        self.model.write_bytes(self.base)
        with self.assertRaisesRegex(ValueError, "SHA-256 differs from the pin"):
            tokenizer_graft.upgrade(self.model, self.identity, self.tokenizer + b"x")
        self.assertEqual(self.model.read_bytes(), self.base)

    def test_a_result_off_the_pin_is_discarded(self):
        identity = {**self.identity, "model_sha256": "0" * 64}
        with self.assertRaisesRegex(ValueError, "result's SHA-256 differs"):
            tokenizer_graft.upgrade(self.model, identity, self.tokenizer)
        self.assertEqual(self.model.read_bytes(), self.base)
        self.assertFalse(any(p.name.startswith(".graft-") for p in self.folder.iterdir()))

    def test_the_graft_refuses_a_model_it_cannot_extend_exactly(self):
        for model, tokenizer, message in (
                (gguf(extra=[entry("asr.tokenizer.spm_model", 8, string("x"))]), self.tokenizer, "already has"),
                (self.base, sentencepiece(VOCAB[:-1] + ["co"]), "pieces differ"),
                (b"GGML" + self.base[4:], self.tokenizer, "not a GGUF file"),
                (self.base[:40], self.tokenizer, "truncated")):
            with self.subTest(message=message):
                path = self.folder / "candidate.gguf"
                path.write_bytes(model)
                with open(self.folder / "out.gguf", "wb") as out, self.assertRaisesRegex(ValueError, message):
                    tokenizer_graft.graft(path, tokenizer, out)

    def test_the_tar_member_must_be_the_pinned_one(self):
        pin = self.identity["tokenizer"]
        good = tar_header(pin["member"], pin["size"]) + self.tokenizer
        self.assertEqual(tokenizer_graft.tar_member(good, pin), self.tokenizer)
        corrupt = bytearray(good)
        corrupt[0] ^= 1
        for data, message in ((good[:-1], "expected"), (bytes(corrupt), "corrupt"),
                              (tar_header("./other.model", pin["size"]) + self.tokenizer, "pinned offset"),
                              (tar_header(pin["member"], pin["size"]) + b"y" * pin["size"], "SHA-256")):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                tokenizer_graft.tar_member(data, pin)

    def test_the_fetch_is_one_bounded_range_of_the_pinned_revision(self):
        pin = self.identity["tokenizer"]
        calls = []
        def run(command, **options):
            calls.append((command, options))
            return subprocess.CompletedProcess(command, 0, tar_header(pin["member"], pin["size"]) + self.tokenizer, b"")
        self.assertEqual(tokenizer_graft.fetch_tokenizer(self.identity, run), self.tokenizer)
        (command, options), = calls
        self.assertEqual(command[-1], "https://huggingface.co/nvidia/fixture/resolve/" + "0" * 40 + "/fixture.nemo")
        self.assertEqual(command[command.index("--range") + 1], f"1536-{2048 + pin['size'] - 1}")
        self.assertEqual(command[command.index("--max-filesize") + 1], str(512 + pin["size"]))
        self.assertIn("--fail", command)
        self.assertTrue(options["check"])

    def fail(self, identity):
        raise AssertionError("a pinned model needs no tokenizer")


class PinnedIdentityTests(unittest.TestCase):
    def test_the_identity_pins_the_result_its_nvidia_file_and_tokenizer(self):
        identity = json.loads((Path(__file__).resolve().parents[1] / "runtime/speech/MODEL-IDENTITY.json").read_text())
        for key in ("model_sha256", "base_model_sha256"):
            self.assertRegex(identity[key], r"^[0-9a-f]{64}$")
        self.assertNotEqual(identity["model_sha256"], identity["base_model_sha256"])
        pin = identity["tokenizer"]
        self.assertRegex(pin["sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(pin["member"].endswith("tokenizer.model"))
        self.assertEqual(pin["offset"] % 512, 0)
        self.assertTrue(pin["archive"].endswith(".nemo") and "/" not in pin["archive"])
        self.assertRegex(identity["revision"], r"^[0-9a-f]{40}$")
        self.assertTrue(identity["source"].startswith("https://huggingface.co/nvidia/"))


if __name__ == "__main__":
    unittest.main()

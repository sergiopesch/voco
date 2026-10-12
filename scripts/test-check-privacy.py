#!/usr/bin/env python3
"""The privacy check's verdicts, on recorded runs built by hand."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("analyze", Path(__file__).with_name("privacy") / "analyze.py")
analyze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyze)

APP = '10 12:00:00.000001 execve("/opt/voco", ["/opt/voco"], 0x7ff /* 20 vars */) = 0'
WEB = '11 12:00:00.000002 execve("/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/WebKitNetworkProcess", ["WebKitNetworkProcess"], 0x7ff /* 20 vars */) = 0'
WORKER = '12 12:00:00.000003 execve("/usr/bin/python3", ["/usr/bin/python3", "-E", "-s", "-B", "/opt/speech/stream_worker.py"], 0x7ff /* 9 vars */) = 0'
CONNECT = '11 12:00:30.000000 connect(24, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("{address}")}, 16) = -1 EINPROGRESS'
DNS = '11 12:00:29.000000 connect(23, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("169.254.1.1")}, 16) = 0'
ASKED = "    10.0.2.100.37314 > 169.254.1.1.53: [udp sum ok] 24357+ A? {name}. (32)"
ANSWER = "    169.254.1.1.53 > 10.0.2.100.37314: 24357 q: A? {name}. 1/0/0 {name}. A {address} (48)"


class PrivacyVerdictTests(unittest.TestCase):
    def run_case(self, case, trace=(), dns=(), streams=None, ready=True, recognized=("first_hypothesis",), captured=True):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder)
            (run / "strace.txt").write_text("\n".join([APP, WEB, WORKER, *trace]) + "\n")
            (run / "dns.txt").write_text("\n".join(dns) + "\n")
            (run / "app.log").write_text("Bundled Nemotron streaming model ready\n" if ready else "")
            (run / "worker-performance.jsonl").write_text(
                "".join(json.dumps({"event": e}) + "\n" for e in ("worker_ready", *recognized, "worker_closed")))
            if captured:
                (run / "sentinel.txt").write_text("IP 127.0.0.1.40000 > 127.0.0.1.9: UDP, length 21\nvoco-privacy-sentinel\n")
            (run / "marks.jsonl").write_text("".join(json.dumps({"t": t, "mark": m}) + "\n"
                                                     for m, t in (("toggle_on", 100.0), ("toggle_off", 120.0))))
            if streams is None:
                streams = [("open", 101.0), ("close", 121.0)]
            # The virtual microphone's own loopback is open for the whole run.
            harness = json.dumps({"t": 1.0, "event": "open", "id": 3, "node.name": "fixture_loopback_capture"}) + "\n"
            (run / "streams.jsonl").write_text(harness + "".join(json.dumps({"t": t, "event": e, "id": 7}) + "\n"
                                                                 for e, t in streams))
            return analyze.analyze(case, run)

    def github(self, address="140.82.112.6"):
        return [ASKED.format(name="api.github.com"), ANSWER.format(name="api.github.com", address=address)]

    def test_offline_passes_with_no_internet_calls(self):
        verdict = self.run_case("offline")
        self.assertEqual(verdict["result"], "PASS", verdict["failures"])

    def test_offline_fails_on_any_internet_call_or_dns_query(self):
        self.assertEqual(self.run_case("offline", trace=[CONNECT.replace("{address}", "140.82.112.6")])["result"], "FAIL")
        self.assertEqual(self.run_case("offline", dns=self.github())["result"], "FAIL")

    def test_online_passes_when_only_github_is_resolved_and_reached(self):
        verdict = self.run_case("online", trace=[DNS, CONNECT.replace("{address}", "140.82.112.6")], dns=self.github())
        self.assertEqual(verdict["result"], "PASS", verdict["failures"])

    def test_online_fails_on_another_host_or_an_address_dns_did_not_give(self):
        other = [ASKED.format(name="example.com"), ANSWER.format(name="example.com", address="93.184.216.34")]
        reached = [DNS, CONNECT.replace("{address}", "140.82.112.6")]
        self.assertEqual(self.run_case("online", trace=reached, dns=self.github() + other)["result"], "FAIL")
        stray = [DNS, CONNECT.replace("{address}", "93.184.216.34")]
        self.assertEqual(self.run_case("online", trace=stray, dns=self.github())["result"], "FAIL")

    def test_online_fails_when_the_update_check_never_reaches_github(self):
        self.assertEqual(self.run_case("online", dns=self.github())["result"], "FAIL")

    def test_an_ipv6_address_is_read_through_the_flow_label(self):
        ipv6 = ('11 12:00:30.000000 connect(24, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), '
                'inet_pton(AF_INET6, "2606:50c0:8000::154", &sin6_addr), sin6_scope_id=0}, 28) = -1 EINPROGRESS')
        dns = [ASKED.format(name="api.github.com").replace(" A?", " AAAA?"),
               "    169.254.1.1.53 > 10.0.2.100.37314: 1 q: AAAA? api.github.com. 1/0/0 api.github.com. AAAA 2606:50c0:8000::154 (60)"]
        verdict = self.run_case("online", trace=[DNS, ipv6], dns=dns)
        self.assertEqual(verdict["result"], "PASS", verdict["failures"])
        self.assertEqual(verdict["internet_calls"][-1]["address"], "2606:50c0:8000::154")

    def test_the_speech_worker_may_not_reach_any_network(self):
        opened = '12 12:00:40.000000 socket(AF_UNIX, SOCK_STREAM|SOCK_CLOEXEC, 0) = 5'
        self.assertEqual(self.run_case("offline", trace=[opened])["result"], "FAIL")
        refused = '12 12:00:40.000000 socket(AF_INET, SOCK_STREAM, 0) = -1 EPERM (Operation not permitted)'
        verdict = self.run_case("offline", trace=[refused])
        self.assertEqual(verdict["result"], "PASS", verdict["failures"])
        self.assertEqual(verdict["speech_worker_calls_its_sandbox_refused"], 1)

    def test_a_microphone_stream_outside_the_dictation_fails(self):
        self.assertEqual(self.run_case("offline", streams=[("open", 50.0), ("close", 121.0)])["result"], "FAIL")
        self.assertEqual(self.run_case("offline", streams=[("open", 101.0)])["result"], "FAIL")
        self.assertEqual(self.run_case("offline", streams=[])["result"], "FAIL")

    def test_a_run_that_never_became_ready_or_wrote_no_words_proves_nothing(self):
        self.assertEqual(self.run_case("offline", ready=False)["result"], "FAIL")
        self.assertEqual(self.run_case("offline", recognized=())["result"], "FAIL")
        self.assertEqual(self.run_case("offline", captured=False)["result"], "FAIL")

    def test_a_capture_that_stopped_early_proves_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            run = Path(folder)
            for name in ("strace.txt", "dns.txt", "streams.jsonl"):
                (run / name).write_text("")
            (run / "app.log").write_text("Bundled Nemotron streaming model ready\n")
            (run / "marks.jsonl").write_text('{"t": 1, "mark": "toggle_on"}\n{"t": 2, "mark": "toggle_off"}\n')
            (run / "worker-performance.jsonl").write_text('{"event": "first_hypothesis"}\n')
            # tcpdump died before the end: the sentinel isn't in the capture.
            (run / "sentinel.txt").write_text("")
            self.assertIn("the packet capture didn't run to the end, so DNS may have gone unseen",
                          analyze.analyze("offline", run)["failures"])

    def test_every_dns_query_type_counts(self):
        txt = ["    10.0.2.100.40000 > 169.254.1.1.53: [udp sum ok] 4242+ TXT? example.com. (29)"]
        self.assertEqual(self.run_case("offline", dns=txt)["result"], "FAIL")
        ptr = ["    10.0.2.100.40000 > 169.254.1.1.53: [udp sum ok] 4243+ PTR? 34.216.184.93.in-addr.arpa. (44)"]
        verdict = self.run_case("online", trace=[DNS, CONNECT.replace("{address}", "140.82.112.6")], dns=self.github() + ptr)
        self.assertEqual(verdict["result"], "FAIL")


if __name__ == "__main__":
    unittest.main()

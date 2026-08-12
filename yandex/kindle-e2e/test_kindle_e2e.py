import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("kindle-e2e.py")
SPEC = importlib.util.spec_from_file_location("kindle_e2e", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class KindleE2ETest(unittest.TestCase):
    def test_parses_only_successful_json_result(self):
        result = MODULE.parse_result('progress\n' + json.dumps({"ok": True, "kindleDelivery": "skipped"}))
        self.assertEqual(result["kindleDelivery"], "skipped")

    @patch.object(MODULE.subprocess, "run")
    def test_runs_local_target_without_ssh(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = json.dumps({"ok": True})
        target = MODULE.Target("Digest", "local", "sudo -n docker exec bot e2e")

        _, result, error = MODULE.run_target(target)

        self.assertEqual(run.call_args.args[0], ["docker", "exec", "bot", "e2e"])
        self.assertEqual(result, {"ok": True})
        self.assertIsNone(error)

    @patch.object(MODULE.subprocess, "run")
    @patch.object(MODULE, "subscribers", return_value=[1])
    def test_sends_telegram_report_through_warp(self, _subscribers, run):
        run.return_value.returncode = 0
        run.return_value.stdout = '{"ok": true}'

        with patch.dict(
            MODULE.os.environ,
            {"TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_PROXY_URL": "socks5h://warp"},
        ):
            MODULE.notify("report")

        self.assertIn("--retry 2", run.call_args.args[0][2])
        self.assertNotIn("token", " ".join(run.call_args.args[0]))
        self.assertEqual(run.call_args.kwargs["input"], "chat_id=1&text=report")


if __name__ == "__main__":
    unittest.main()

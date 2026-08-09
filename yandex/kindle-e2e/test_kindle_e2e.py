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


if __name__ == "__main__":
    unittest.main()

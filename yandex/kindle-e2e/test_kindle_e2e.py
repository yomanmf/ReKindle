import importlib.util
import json
import sys
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()

"""Deployment gate unit tests; no DB/provider access or deployment."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('assistant_readiness', Path(__file__).resolve().parents[2] / 'backend/app/cli/check_teacher_assistant_readiness.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class ReadinessTests(unittest.TestCase):
    def test_required_dependencies_fail_closed(self):
        args = dict(tables=gate.REQUIRED_TABLES, revisions={'head'}, heads={'head'}, checks={'credentials': True, 'converter': True})
        self.assertTrue(gate.evaluate(**args)['ok'])
        for changes in ({'tables': set()}, {'revisions': {'old'}}, {'heads': set()}, {'checks': {'credentials': False}}, {'checks': {'converter': False}}):
            self.assertFalse(gate.evaluate(**(args | changes))['ok'])

    def test_cli_probe_failure_does_not_expose_output(self):
        with patch.object(gate.subprocess, 'run', side_effect=OSError('secret-token-in-provider-error')):
            self.assertFalse(gate.command_ok(['/missing', '--version']))

    def test_converter_unavailability_is_bounded_and_fails_closed(self):
        with patch.object(gate, 'urlopen', side_effect=OSError('sensitive-url')), patch('time.sleep') as sleep:
            self.assertFalse(gate.converter_ready('http://internal'))
            self.assertEqual(sleep.call_count, 10)

if __name__ == '__main__':
    unittest.main()

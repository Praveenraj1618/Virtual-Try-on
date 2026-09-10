import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
import unittest
from types import SimpleNamespace

from backend.app.errors import TryOnError
from backend.app.jobs import Jobs


class JobTests(unittest.TestCase):
    def test_busy_completion_and_persistence(self):
        entered, release = Event(), Event()
        def run(*args):
            entered.set()
            release.wait(5)
            return {'id': 'result-id', 'status': 'completed'}
        with TemporaryDirectory() as directory:
            jobs = Jobs(SimpleNamespace(data_dir=Path(directory)), SimpleNamespace(run=run))
            try:
                job = jobs.submit(b'p', b'g', None)
                self.assertTrue(entered.wait(2))
                with self.assertRaises(TryOnError):
                    jobs.submit(b'p', b'g', None)
                release.set()
                jobs.close()
                result = jobs.get(job['id'])
                self.assertEqual(result['status'], 'completed')
                self.assertEqual(result['result']['id'], 'result-id')
            finally:
                release.set()
                jobs.close()

    def test_failure_and_restart_are_explicit(self):
        def run(*args):
            raise RuntimeError('Actual inference error')
        with TemporaryDirectory() as directory:
            settings = SimpleNamespace(data_dir=Path(directory))
            jobs = Jobs(settings, SimpleNamespace(run=run))
            job = jobs.submit(b'p', b'g', None)
            jobs.close()
            self.assertEqual(jobs.get(job['id'])['error']['message'], 'Actual inference error')
            jobs.save({'id': 'interrupted', 'status': 'running'})
            restarted = Jobs(settings, SimpleNamespace(run=run))
            self.assertEqual(restarted.get('interrupted')['status'], 'failed')
            restarted.close()

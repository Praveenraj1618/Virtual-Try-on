"""One background generation at a time; durable status, no automatic retry."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import logging
from threading import Lock
from uuid import uuid4

from .errors import TryOnError


class Jobs:
    def __init__(self, settings, service):
        self.root = settings.data_dir / 'jobs'
        self.service = service
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.lock = Lock()
        self.active = None
        self.root.mkdir(parents=True, exist_ok=True)
        for path in self.root.glob('*.json'):
            try:
                job = json.loads(path.read_text())
                if job['status'] in ('queued', 'running'):
                    job.update(status='failed', error={'message': 'Backend restarted before completion. Check history before retrying.'})
                    self.save(job)
            except (ValueError, KeyError, OSError):
                continue

    def save(self, job):
        path = self.root / (job['id'] + '.json')
        pending = path.with_suffix('.tmp')
        pending.write_text(json.dumps(job), encoding='utf-8')
        pending.replace(path)

    def get(self, job_id):
        try:
            return json.loads((self.root / (str(job_id) + '.json')).read_text(encoding='utf-8'))
        except FileNotFoundError:
            raise TryOnError('not_found', 'Job not found.', 404)

    def submit(self, person, garment, options):
        with self.lock:
            if self.active is not None:
                raise TryOnError('gpu_busy', 'A generation is already in progress.', 409)
            job = dict(id=str(uuid4()), status='queued', created_at=datetime.now(timezone.utc).isoformat())
            self.save(job)
            self.active = job['id']
            self.executor.submit(self.run, job.copy(), person, garment, options)
            return job

    def run(self, job, person, garment, options):
        try:
            job['status'] = 'running'
            self.save(job)
            result = self.service.run(person, garment, options)
            job.update(status='completed', result=result)
        except Exception as error:
            logging.getLogger(__name__).exception("Background try-on failed")
            job.update(status='failed', error={'code': getattr(error, 'code', 'inference_failed'), 'message': str(error)})
        finally:
            try:
                self.save(job)
            finally:
                with self.lock:
                    self.active = None

    def close(self):
        self.executor.shutdown(wait=True)

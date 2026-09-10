from io import BytesIO
from threading import Event
import json
from uuid import uuid4

from PIL import Image
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


def test_jobs_api_validation_history_and_polling(tmp_path):
    finished = Event()
    run_id = str(uuid4())
    class Service:
        def run(self, *args):
            path = tmp_path / 'runs' / run_id
            path.mkdir(parents=True)
            report = {'id': run_id, 'status': 'completed', 'seconds': 1.0}
            (path / 'report.json').write_text(json.dumps(report))
            finished.set()
            return report
    settings = Settings(data_dir=tmp_path, source_dir=tmp_path / 'source')
    buffer = BytesIO()
    Image.new('RGB', (200, 300)).save(buffer, 'PNG')
    with TestClient(create_app(settings, Service()), base_url='http://127.0.0.1') as client:
        bad = client.post('/v1/jobs', files={'person': ('p.png', b'bad'), 'garment': ('g.png', buffer.getvalue())})
        assert bad.status_code == 422
        response = client.post('/v1/jobs', files={'person': ('p.png', buffer.getvalue()), 'garment': ('g.png', buffer.getvalue())})
        assert response.status_code == 202
        assert finished.wait(2)
        client.app.state.jobs.close()  # wait for final status persistence
        job = client.get('/v1/jobs/' + response.json()['id']).json()
        assert job['status'] == 'completed'
        assert job['result']['id'] == run_id
        history = client.get('/v1/runs').json()
        assert history['total'] == 1
        assert history['runs'][0]['id'] == run_id
        assert client.get('/v1/runs?limit=0').status_code == 422
        assert client.get('/v1/jobs/' + str(uuid4())).status_code == 404
        assert client.get('/v1/runs', headers={'Origin': 'https://example.com'}).status_code == 403

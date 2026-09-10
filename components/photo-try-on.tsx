"use client";
import { useEffect, useRef, useState } from "react";
import "./photo-try-on.css";

const API = "http://127.0.0.1:8000";
type Run = { id: string; seconds: number; created_at?: number };
type Job = { id: string; status: string; result?: Run; error?: { message: string } };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
function saveActive(id: string | null) { try { if (id) localStorage.setItem('form-active-job', id); else localStorage.removeItem('form-active-job'); } catch { /* Polling still works when storage is unavailable. */ } }
async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + path, { ...init, signal: AbortSignal.timeout(15000) });
  const data = await response.json() as { error?: { message?: string } };
  if (!response.ok) throw new ApiError(data.error?.message || "Request failed. Check the backend terminal.", response.status);
  return data as T;
}
function UploadCard({ title, hint, onChange, disabled }: { title: string; hint: string; onChange: (file: File | null) => void; disabled: boolean }) {
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return <label className="photo-upload"><strong>{title}</strong><span>{hint}</span>
    {preview && <img src={preview} alt={`${title} preview`} />}
    <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={event => {
      const file = event.target.files?.[0] || null;
      if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) {
        setError("Choose a PNG, JPEG or WebP smaller than 10 MB."); onChange(null); setPreview(""); event.target.value = ""; return;
      }
      setError(""); setPreview(file ? URL.createObjectURL(file) : ""); onChange(file);
    }} />{error && <span role="alert">{error}</span>}
  </label>;
}
export default function PhotoTryOn() {
  const [person, setPerson] = useState<File | null>(null);
  const [garment, setGarment] = useState<File | null>(null);
  const [quality, setQuality] = useState("preview");
  const [background, setBackground] = useState("plain");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [compare, setCompare] = useState(true);
  const submittingRef = useRef(false);
  const busy = submitting || !!job && ['queued', 'running'].includes(job.status);
  async function loadHistory(offset = 0) {
    const data = await request<{runs: Run[]; total: number}>(`/v1/runs?limit=20&offset=${offset}`);
    setHistory(current => offset ? [...current, ...data.runs] : data.runs); setTotal(data.total);
  }
  async function connect() {
    try { await request('/health'); setConnected(true); setError(""); await loadHistory(); }
    catch { setConnected(false); setError("Start the local backend on port 8000, then reconnect."); }
  }
  useEffect(() => {
    void connect();
    try { const id = localStorage.getItem('form-active-job'); if (id && /^[0-9a-f-]{36}$/.test(id)) setJob({ id, status: 'running' }); } catch { /* Storage unavailable. */ }
  }, []);
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next: Job = await request<Job>(`/v1/jobs/${job!.id}`);
        if (cancelled) return;
        setConnected(true); setJob(next); setError("");
        if (next.status === 'completed' || next.status === 'failed') {
          saveActive(null);
          if (next.result) { setRun(next.result); await loadHistory(); }
          if (next.error) setError(next.error.message);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) { saveActive(null); setJob(null); setError("Previous job is no longer available. Check history before retrying."); return; }
        setError("Connection interrupted. Reconnecting to your generation…");
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [job?.id, job?.status]);
  async function generate() {
    if (!person || !garment || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    const form = new FormData(); form.append('person', person); form.append('garment', garment);
    form.append('quality', quality); form.append('garment_background', background);
    try {
      const next: Job = await request<Job>('/v1/jobs', { method: 'POST', body: form });
      saveActive(next.id); setJob(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setSubmitting(false); submittingRef.current = false; }
  }
  async function download() {
    if (!run) return;
    try {
      const response = await fetch(`${API}/v1/runs/${run.id}/result.png`);
      if (!response.ok) throw new Error('Download failed.');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
      a.href = url; a.download = `try-on-${run.id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Could not download. Check the backend connection.'); }
  }
  return <main className="photo-app">
    <header className="photo-header"><a href="/">FORM <span>Fitting room</span></a><nav><b>Photo try-on</b><a href="/">3D studio</a></nav></header>
    <section className="photo-intro"><div><p className="photo-eyebrow">YOUR PHOTO. YOUR NEXT LOOK.</p><h1>See it on you.</h1><p>Try a shirt on your own photo. Keep your pose and preview a new look.</p></div>
      <button className="photo-secondary" onClick={() => void connect()}>{connected ? '● Local backend connected' : 'Reconnect backend'}</button></section>
    {error && <div className="photo-error" role="alert">{error}</div>}
    {!connected && <aside className="photo-setup">Run this from your project folder in the vton environment:<code>python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --workers 1</code><p>Open this frontend at http://127.0.0.1:5173/try-on. Photos are processed by your local backend.</p></aside>}
    <div className="photo-workspace"><aside className="photo-controls"><h2>Create a look</h2>
      <UploadCard title="1. Your photo" hint="One person, face visible, arms slightly apart." onChange={setPerson} disabled={busy} />
      <UploadCard title="2. Your shirt" hint="Shirt or T-shirt product photo. PNG, JPEG or WebP · up to 10 MB." onChange={setGarment} disabled={busy} />
      <details><summary>Image options</summary><label>Quality<select value={quality} disabled={busy} onChange={e => setQuality(e.target.value)}><option value="preview">Preview · faster</option><option value="detail">Detail · more GPU memory</option></select></label><label>Garment background<select value={background} disabled={busy} onChange={e => setBackground(e.target.value)}><option value="plain">Remove plain background</option><option value="keep">Keep already prepared image</option></select></label></details>
      <button className="photo-primary" disabled={!person || !garment || !connected || busy} onClick={() => void generate()}>{busy ? 'Creating your look…' : 'Generate try-on'}</button>
      <p className="photo-note">Currently supports one shirt or T-shirt. Results approximate appearance, not size or fit.</p></aside>
      <section className="photo-preview" aria-label="Try-on preview"><div className="photo-preview-bar"><h2>{run ? 'Your look' : 'Your fitting room'}</h2>{run && <button className="photo-secondary" onClick={() => setCompare(!compare)}>{compare ? 'Show result only' : 'Compare original'}</button>}</div>
        {busy && <div className="photo-progress" role="status"><span className="photo-spinner" />{submitting ? 'Uploading photos…' : 'Processing your photo and generating clothing…'}<small>You can refresh this page; generation continues in the backend.</small></div>}
        {run ? <><img className="photo-result" alt={compare ? 'Original photo and generated try-on side by side' : 'Generated try-on'} src={`${API}/v1/runs/${run.id}/${compare ? 'comparison' : 'result'}.png`} /><footer><span>{run.seconds.toFixed(1)} seconds · Review collar, hands and garment details</span><button className="photo-primary" onClick={() => void download()}>Download image</button></footer></> : <div className="photo-empty"><span>✦</span><h3>A new look starts here</h3><p>Add your photo and a shirt to see them together.</p></div>}
      </section></div>
    <section className="photo-history"><div className="photo-preview-bar"><h2>Recent looks <span>({total})</span></h2><button className="photo-secondary" onClick={() => loadHistory().catch(() => setError('Could not refresh history.'))}>Refresh history</button></div>
      {!history.length && <p>Your completed looks will appear here, including earlier smoke tests.</p>}
      <div className="photo-history-grid">{history.map(item => <button key={item.id} onClick={() => { setRun(item); setCompare(true); }} aria-label={`Open look ${item.id}`}><img loading="lazy" src={`${API}/v1/runs/${item.id}/result.png`} alt="Saved try-on" /><span>{item.created_at ? new Date(item.created_at * 1000).toLocaleString() : 'Saved look'}</span></button>)}</div>
      {history.length < total && <button className="photo-secondary" onClick={() => loadHistory(history.length).catch(() => setError('Could not load more history.'))}>Load more</button>}
    </section>
  </main>;
}

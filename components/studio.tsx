"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Shirt,
  Ruler,
  Bookmark,
  Upload,
  Download,
  RotateCcw,
  Rotate3D,
  Info,
  Check,
  Trash2,
  Layers,
  SlidersHorizontal,
  MoveHorizontal,
  Plus,
  LoaderCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Toaster, toast } from "sonner";
import {
  defaultMeasurements,
  defaultDesign,
  measurementFields,
  measurementsSchema,
  garmentNames,
  type Measurements,
  type Design,
  type Look,
} from "@/lib/tryon/schema";
import { GarmentEditor, MeasurementComparison } from "./garment-editor";
import { templateDimensions, canDrapeGarment } from "@/lib/tryon/schema";
import { PoseEditor } from "./pose-editor";
import { DesignTracer } from "./design-tracer";
import { neutralPose, type Pose } from "@/lib/tryon/pose";
const AvatarViewer = dynamic(() => import("./avatar-viewer"), {
  ssr: false,
  loading: () => <div className="fallback subtle">Loading the 3D studio…</div>,
});
const colors = [
  "#315a49",
  "#202d48",
  "#b4a188",
  "#dbd8ce",
  "#8d3948",
  "#303435",
];
async function responseData<T = Record<string, unknown>>(response: Response) {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
export default function Studio() {
  const [measurements, setMeasurements] = useState<Measurements>({
      ...defaultMeasurements,
    }),
    [draft, setDraft] = useState<Measurements>({ ...defaultMeasurements }),
    [design, setDesign] = useState<Design>({ ...defaultDesign });
  const [pose, setPose] = useState<Pose>(neutralPose);
  const [units, setUnits] = useState("cm"),
    [tab, setTab] = useState("garments"),
    [view, setView] = useState("angle"),
    [turn, setTurn] = useState(false),
    [drape, setDrape] = useState(0),
    [guide, setGuide] = useState(false),
    [saveOpen, setSaveOpen] = useState(false),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState(""),
    [measurementError, setMeasurementError] = useState(""),
    [looks, setLooks] = useState<Look[]>([]),
    [loading, setLoading] = useState(false),
    [loadError, setLoadError] = useState(""),
    [removeId, setRemoveId] = useState<string | null>(null),
    [isSample, setIsSample] = useState(true);
  const capture = useRef<(() => string) | null>(null);
  const onReady = useCallback((fn: () => string) => {
    capture.current = fn;
  }, []);
  const update = <K extends keyof Design>(key: K, value: Design[K]) =>
    setDesign((d) => ({ ...d, [key]: value }));
  const setMeasurement = (key: keyof Measurements, value: number) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    setIsSample(false);
    const p = measurementsSchema.safeParse(next);
    if (p.success) {
      setMeasurements(p.data);
      setMeasurementError("");
    } else setMeasurementError(p.error.issues[0].message);
  };
  const loadLooks = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await responseData<{ looks: Look[] }>(
        await fetch("/api/looks"),
      );
      setLooks(data.looks);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (tab === "saved") void loadLooks();
  }, [tab, loadLooks]);
  async function upload(file: File | undefined, kind: "texture" | "reference") {
    if (!file) return;
    setError("");
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP image under 5 MB.");
      return;
    }
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 4096 || bitmap.height > 4096) {
        bitmap.close();
        throw new Error("Use an image no larger than 4096 × 4096 pixels.");
      }
      bitmap.close();
      const data = await responseData<{ url: string }>(
        await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        }),
      );
      update(kind, data.url);
      toast.success(
        kind === "texture"
          ? "Print applied to your garment."
          : "Design added. Mark the outline below to generate its 3D shape.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function saveLook(event: React.FormEvent) {
    event.preventDefault();
    if (measurementError) return;
    setBusy(true);
    setError("");
    try {
      const data = await responseData<{ look: Look }>(
        await fetch("/api/looks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, measurements, design }),
        }),
      );
      setLooks((l) => [data.look, ...l]);
      setSaveOpen(false);
      setName("");
      toast.success("Look saved. Find it in Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function deleteLook(id: string) {
    setBusy(true);
    try {
      await responseData(
        await fetch(`/api/looks?id=${id}`, { method: "DELETE" }),
      );
      setLooks((l) => l.filter((x) => x.id !== id));
      setRemoveId(null);
      toast.success("Look removed.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function downloadPreview() {
    try {
      if (!capture.current) {
        toast.error("Wait for the 3D view to finish loading.");
        return;
      }
      const a = document.createElement("a");
      a.download = "form-outfit-preview.png";
      a.href = capture.current();
      a.click();
    } catch {
      toast.error(
        "Could not export this preview. Try again once the image has loaded.",
      );
    }
  }
  function openLook(look: Look) {
    setMeasurements({ ...look.measurements });
    setDraft({ ...look.measurements });
    setDesign({ ...look.design });
    setIsSample(false);
    setMeasurementError("");
    setError("");
    setTab("garments");
    toast.success(`Opened ${look.name}`);
  }
  const selectTemplate = (kind: Design["kind"]) => {
    if (kind === design.kind) return;
    setDesign((d) => ({
      ...d,
      kind,
      tracedShape: undefined,
      garment: { ...templateDimensions[kind] },
      neckline: "crew",
      silhouette: kind === "dress" ? "flared" : "straight",
      sleeveStyle: "straight",
    }));
  };
  const garmentSelect = (
    <Select
      value={design.kind}
      onValueChange={(v) => selectTemplate(v as Design["kind"])}
    >
      <SelectTrigger className="full" aria-label="Garment template">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(garmentNames).map(([k, n]) => (
          <SelectItem key={k} value={k}>
            {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const designControls = (
    <>
      <hr className="divider" />
      <div className="field-head">
        <span>Colour</span>
        <span className="subtle">
          {design.texture
            ? "Print overrides colour"
            : design.color.toUpperCase()}
        </span>
      </div>
      <div className="swatches">
        {colors.map((c) => (
          <button
            key={c}
            title={c}
            aria-label={`Garment colour ${c}`}
            aria-pressed={design.color === c && !design.texture}
            className={`swatch ${design.color === c && !design.texture ? "selected" : ""}`}
            style={{ background: c }}
            onClick={() => setDesign((d) => ({ ...d, color: c, texture: "" }))}
          />
        ))}
        <input
          type="color"
          aria-label="Custom garment colour"
          value={design.color}
          onChange={(e) =>
            setDesign((d) => ({ ...d, color: e.target.value, texture: "" }))
          }
        />
      </div>
      <GarmentEditor design={design} onChange={setDesign} />
      <hr className="divider" />
      <div className="field-head">
        <span>Fabric behaviour</span>
      </div>
      <Select
        value={design.fabric}
        onValueChange={(v) => update("fabric", v as Design["fabric"])}
      >
        <SelectTrigger className="full" aria-label="Fabric behaviour">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cotton">Cotton · balanced</SelectItem>
          <SelectItem value="denim">Denim · structured</SelectItem>
          <SelectItem value="silk">Silk · soft</SelectItem>
        </SelectContent>
      </Select>
      <p className="subtle" style={{ fontSize: 12, marginTop: 9 }}>
        Illustrative fabric presets; not measured material properties.
      </p>
      <MeasurementComparison measurements={measurements} design={design} />
    </>
  );
  return (
    <>
      <Toaster position="bottom-right" richColors />
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Layers size={21} />
          </span>
          FORM<small>VIRTUAL FITTING STUDIO</small>
        </div>
        <div className="actions">
          <button className="button" onClick={downloadPreview}>
            <Download />
            Export preview
          </button>
          <button
            className="button primary"
            disabled={!!measurementError || uploading}
            onClick={() => {
              setError("");
              setName(garmentNames[design.kind]);
              setSaveOpen(true);
            }}
          >
            <Plus />
            Save look
          </button>
        </div>
      </header>
      <div className="intro">
        <div>
          <div className="eyebrow">YOUR PERSONAL FITTING ROOM</div>
          <h1>Make it yours.</h1>
          <p className="subtle" style={{ margin: 0 }}>
            Your proportions. Your designs. A new perspective.
          </p>
        </div>
        <span className="badge">
          <Rotate3D size={14} />
          3D prototype
        </span>
      </div>
      <main className="workspace">
        <section className="panel measure-panel" aria-label="Body measurements">
          <div className="panel-title">
            <h2>Your measurements</h2>
            <Ruler />
          </div>
          <div className="field-head">
            <span className="subtle">
              {isSample ? "Sample measurements" : "Manual measurements"}
            </span>
            <Select value={units} onValueChange={setUnits}>
              <SelectTrigger aria-label="Measurement units" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cm">cm</SelectItem>
                <SelectItem value="in">in</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="measurements">
            {measurementFields.map((f) => {
              const factor = units === "in" ? 2.54 : 1;
              return (
                <div key={f.key} className="field">
                  <div className="field-head">
                    <label htmlFor={`measure-${f.key}`}>{f.label}</label>
                    <input
                      id={`measure-${f.key}`}
                      type="number"
                      min={Number((f.min / factor).toFixed(1))}
                      max={Number((f.max / factor).toFixed(1))}
                      step="0.1"
                      value={Number((draft[f.key] / factor).toFixed(1))}
                      onChange={(e) => {
                        if (Number.isFinite(e.target.valueAsNumber))
                          setMeasurement(
                            f.key,
                            Math.round(e.target.valueAsNumber * factor * 10) /
                              10,
                          );
                      }}
                      onBlur={() => {
                        if (!measurementsSchema.safeParse(draft).success) {
                          setDraft({ ...measurements });
                          setMeasurementError("");
                          toast.info(
                            "Invalid measurements were restored to the last valid values.",
                          );
                        }
                      }}
                    />
                  </div>
                  <Slider
                    aria-label={`${f.label} in centimetres`}
                    min={f.min}
                    max={f.max}
                    step={1}
                    value={[Math.max(f.min, Math.min(f.max, draft[f.key]))]}
                    onValueChange={([v]) => setMeasurement(f.key, v)}
                  />
                </div>
              );
            })}
          </div>
          {measurementError && (
            <p className="error" role="alert">
              {measurementError} The preview shows your last valid measurements.
            </p>
          )}
          <button className="button full" onClick={() => setGuide(true)}>
            <Ruler />
            How to measure
          </button>
          <hr className="divider" />
          <div className="help">
            <Info />
            <span>
              This is an approximate mannequin. For best results, use a tape
              measure and wear fitted clothing.
            </span>
          </div>
          <button
            className="button quiet full"
            style={{ marginTop: 10 }}
            onClick={() => {
              setMeasurements({ ...defaultMeasurements });
              setDraft({ ...defaultMeasurements });
              setMeasurementError("");
              setIsSample(true);
            }}
          >
            <RotateCcw />
            Reset measurements
          </button>
        </section>
        <section className="stage" aria-label="3D fitting preview">
          <div className="stage-top">
            <div>
              <strong>{garmentNames[design.kind]}</strong>
              <span>
                {design.fabric.charAt(0).toUpperCase() + design.fabric.slice(1)}{" "}
                / {design.texture ? "Printed" : "Solid colour"}
              </span>
            </div>
            <span className="badge">
              {Math.round(measurements.height)} cm avatar
            </span>
          </div>
          <AvatarViewer
            measurements={measurements}
            pose={pose}
            design={design}
            view={view}
            turn={turn}
            drape={drape}
            onReady={onReady}
          />
          <div className="stage-bottom">
            <div className="view-controls">
              {["front", "side", "back"].map((v) => (
                <button
                  key={v}
                  className={view === v && !turn ? "active" : ""}
                  onClick={() => {
                    setView(v);
                    setTurn(false);
                  }}
                >
                  {v[0].toUpperCase() + v.slice(1)}
                </button>
              ))}
              <button
                aria-label="Rotate mannequin automatically"
                aria-pressed={turn}
                className={turn ? "active" : ""}
                onClick={() => setTurn((v) => !v)}
              >
                <Rotate3D />
                360°
              </button>
              <button
                disabled={!canDrapeGarment(measurements, design)}
                onClick={() => setDrape((v) => v + 1)}
                title="Relax the cloth again"
              >
                <RotateCcw />
                Drape
              </button>
            </div>
            <div className="stage-note">
              {canDrapeGarment(measurements, design)
                ? "Drag to rotate · Scroll or pinch to zoom"
                : "Draping paused · Check Body vs garment"}
            </div>
          </div>
        </section>
        <section className="panel garment-panel" aria-label="Garment designer">
          <div className="panel-title">
            <h2>Your wardrobe</h2>
            <SlidersHorizontal />
          </div>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              setError("");
            }}
          >
            <TabsList className="tabs-list">
              <TabsTrigger value="garments">Garments</TabsTrigger>
              <TabsTrigger value="design">Design</TabsTrigger>
              <TabsTrigger value="saved">Saved</TabsTrigger>
            </TabsList>
            <TabsContent value="garments">
              <div className="eyebrow" style={{ marginBottom: 13 }}>
                CHOOSE A TEMPLATE
              </div>
              {Object.entries(garmentNames).map(([key, title], i) => (
                <button
                  key={key}
                  aria-pressed={design.kind === key}
                  className={`garment-choice ${design.kind === key ? "selected" : ""}`}
                  onClick={() => selectTemplate(key as Design["kind"])}
                >
                  <span className="garment-icon">
                    {key === "tshirt" ? (
                      <Shirt size={25} />
                    ) : key === "trousers" ? (
                      <MoveHorizontal size={25} />
                    ) : (
                      <Layers size={25} />
                    )}
                  </span>
                  <span style={{ flex: 1 }}>
                    <strong>{title}</strong>
                    <small>
                      {
                        [
                          "Editable neckline & sleeves",
                          "Independent waist & inseam",
                          "Editable neckline & hem",
                        ][i]
                      }
                    </small>
                  </span>
                  {design.kind === key && <Check size={16} />}
                </button>
              ))}
              {designControls}
              <PoseEditor pose={pose} onChange={setPose} />
              <hr className="divider" />
              <div className="help">
                <Info />
                <span>
                  Changing templates loads example dimensions. Save your look
                  before switching to keep your custom design.
                </span>
              </div>
            </TabsContent>
            <TabsContent value="design">
              <p className="subtle" style={{ marginTop: 0 }}>
                Start with a template, then bring your design into the fitting
                room.
              </p>
              {garmentSelect}
              <hr className="divider" />
              <div className="panel-title">
                <h2>Fabric print</h2>
                <Upload />
              </div>
              {design.texture && (
                <>
                  <img
                    className="uploaded-image"
                    src={design.texture}
                    alt="Current garment print"
                  />
                  <button
                    className="button full"
                    onClick={() => update("texture", "")}
                  >
                    Remove print
                  </button>
                </>
              )}
              <label className="upload">
                <Upload size={22} />
                <strong>
                  {uploading ? "Uploading…" : "Upload your artwork"}
                </strong>
                <span className="subtle">Repeats across the garment</span>
                <input
                  aria-label="Upload fabric print"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(e) => {
                    void upload(e.target.files?.[0], "texture");
                    e.target.value = "";
                  }}
                />
                <small className="subtle">PNG, JPG, WebP · Up to 5 MB</small>
              </label>
              <button
                className="print-preset"
                onClick={() => update("texture", "/cobalt-stripe.webp")}
              >
                <img
                  src="/cobalt-stripe.webp"
                  alt="Cobalt and ivory striped fabric"
                />
                <span>Try the cobalt stripe print</span>
              </button>
              <hr className="divider" />
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Design to 3D</h2>
              <p className="subtle">
                Upload a front-view dress or top. Mark its outline to create a
                wearable 3D shape, then refine its measurements.
              </p>
              {design.reference && (
                <>
                  <img
                    className="uploaded-image"
                    src={design.reference}
                    alt="Your costume design reference"
                  />
                  <button
                    className="button full"
                    onClick={() => update("reference", "")}
                  >
                    Remove reference
                  </button>
                </>
              )}
              <label className="upload" style={{ padding: 12 }}>
                <span>Add a reference image</span>
                <input
                  aria-label="Upload sketch reference"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={uploading}
                  onChange={(e) => {
                    void upload(e.target.files?.[0], "reference");
                    e.target.value = "";
                  }}
                />
              </label>
              {design.reference && (
                <DesignTracer
                  key={design.reference}
                  design={design}
                  onChange={setDesign}
                />
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {designControls}
            </TabsContent>
            <TabsContent value="saved">
              <p className="subtle" style={{ marginTop: 0 }}>
                Saved looks include your measurements, garment settings and
                uploaded designs.
              </p>
              {loading ? (
                <div className="empty" role="status">
                  <LoaderCircle className="animate-spin" />
                  Loading your looks…
                </div>
              ) : loadError ? (
                <div className="error" role="alert">
                  {loadError}
                  <button
                    className="button full"
                    style={{ marginTop: 10 }}
                    onClick={() => void loadLooks()}
                  >
                    Try again
                  </button>
                </div>
              ) : !looks.length ? (
                <div className="empty">
                  <Bookmark />
                  <strong>No saved looks yet</strong>
                  <p className="subtle">
                    Create your first outfit, then choose Save look.
                  </p>
                </div>
              ) : (
                looks.map((look) => (
                  <div className="saved-look" key={look.id}>
                    <span
                      className="swatch"
                      style={{ background: look.design.color, flexShrink: 0 }}
                    />
                    <div
                      style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
                    >
                      <strong>{look.name}</strong>
                      <span className="subtle" style={{ fontSize: 12 }}>
                        {garmentNames[look.design.kind]}
                      </span>
                    </div>
                    <button className="button" onClick={() => openLook(look)}>
                      Open
                    </button>
                    <button
                      className="button quiet"
                      aria-label={`Delete ${look.name}`}
                      onClick={() => setRemoveId(look.id)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>
        </section>
      </main>
      <footer className="bottom-strip">
        <span>
          Visual approximation · Body shape and fabric drape are not
          fit-certified.
        </span>
        <a
          href="https://github.com/Praveenraj1618/Virtual-Try-on"
          target="_blank"
          rel="noreferrer"
        >
          View project on GitHub ↗
        </a>
      </footer>
      <Dialog open={guide} onOpenChange={setGuide}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Measure once. Make it personal.</DialogTitle>
            <DialogDescription>
              Use a flexible tape in centimetres or inches. Keep it snug without
              compressing your body.
            </DialogDescription>
          </DialogHeader>
          <div className="guide">
            {measurementFields.map((f) => (
              <p key={f.key}>
                <strong>{f.label}:</strong> {f.help}
              </p>
            ))}
            <div className="help">
              <Info />
              <span>
                Camera measurement is not available in this version. The
                mannequin estimates unmeasured body proportions.
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={saveOpen}
        onOpenChange={(v) => {
          if (!busy) setSaveOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this look</DialogTitle>
            <DialogDescription>
              Your current measurements and design will be saved together in
              your private wardrobe.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveLook}>
            <label htmlFor="look-name" className="subtle">
              Look name
            </label>
            <input
              id="look-name"
              className="full-input"
              maxLength={60}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My first design"
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy || !name.trim()}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Bookmark />}
              {busy ? "Saving…" : "Save look"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!removeId}
        onOpenChange={(v) => {
          if (!busy && !v) setRemoveId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Remove this saved look?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the saved measurements and outfit settings. Your
            current preview stays open. Uploaded artwork remains available to
            other saved looks.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep look</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (removeId) void deleteLook(removeId);
              }}
            >
              {busy ? "Removing…" : "Remove look"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

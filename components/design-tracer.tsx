"use client";
import { useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectValue,
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
  initialTrace,
  traceToDesign,
  estimateDesign,
  type TracePoint,
} from "@/lib/tryon/design-trace";
import { detectOutline } from "@/lib/tryon/outline-detection";
import type { Design, Measurements } from "@/lib/tryon/schema";
const labels = [
  "Neck centre",
  "Shoulder",
  "Chest edge",
  "Waist edge",
  "Hip edge",
  "Bottom edge",
  "Sleeve outside",
  "Sleeve inside",
];
export function DesignTracer({
  design,
  measurements,
  onChange,
}: {
  design: Design;
  measurements: Measurements;
  onChange: (d: Design) => void;
}) {
  const [open, setOpen] = useState(false),
    [points, setPoints] = useState<TracePoint[]>(
      initialTrace.map((p) => ({ ...p })),
    ),
    [selected, setSelected] = useState(0),
    [aspect, setAspect] = useState(0),
    [length, setLength] = useState(design.garment.length),
    [sleeveless, setSleeveless] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [sizing, setSizing] = useState("estimate"),
    [ending, setEnding] = useState<"hip" | "knee" | "ankle">(
      design.kind === "tshirt" ? "hip" : "knee",
    ),
    [mode, setMode] = useState<"sketch" | "photo">("sketch"),
    [detecting, setDetecting] = useState(false);
  const image = useRef<HTMLImageElement>(null),
    detected = useRef(false),
    drag = useRef<number | null>(null);
  const updatePoint = (index: number, x: number, y: number) => {
    setPoints((p) =>
      p.map((v, i) =>
        i === index
          ? {
              x: Math.max(0, Math.min(100, x)),
              y: Math.max(0, Math.min(100, y)),
            }
          : v,
      ),
    );
    setError("");
  };
  async function detect() {
    if (!image.current?.naturalWidth) return;
    setDetecting(true);
    setError("");
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const img = image.current;
      if (!img) return;
      const scale = Math.min(
        1,
        320 / Math.max(img.naturalWidth, img.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx)
        throw new Error(
          "Image analysis is unavailable in this browser. You can still move the points.",
        );
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const result = detectOutline(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
        mode,
      );
      setPoints(result.points);
      setMessage(result.message);
    } catch (e) {
      setError((e as Error).message);
      setMessage(
        "Automatic detection needs help. Move the points below before generating.",
      );
    } finally {
      setDetecting(false);
    }
  }
  return (
    <>
      <button className="button primary full" onClick={() => setOpen(true)}>
        Create 3D from this design
      </button>
      <p className="subtle">
        Automatic outline suggestions · No tape measure needed
      </p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="design-dialog">
          <DialogHeader>
            <DialogTitle>Turn your design into a garment</DialogTitle>
            <DialogDescription>
              Detect the outline, choose where it ends, then try it on. Works
              best with one front-view garment on a plain background.
            </DialogDescription>
          </DialogHeader>
          <div className="trace-workspace">
            <div className="trace-image-area">
              <div className="trace-image-frame">
                <img
                  ref={image}
                  src={design.reference}
                  alt="Uploaded design with adjustable outline points"
                  onLoad={(e) => {
                    setAspect(
                      e.currentTarget.naturalWidth /
                        e.currentTarget.naturalHeight,
                    );
                    if (!detected.current) {
                      detected.current = true;
                      void detect();
                    }
                  }}
                  onError={() => {
                    setAspect(0);
                    setError(
                      "The design image could not load. Upload it again.",
                    );
                  }}
                />
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="trace-overlay"
                  role="application"
                  tabIndex={0}
                  aria-label={`Adjust ${labels[selected]} with arrow keys, or drag its dot`}
                  onPointerDown={(e) => {
                    const b = e.currentTarget.getBoundingClientRect(),
                      x = ((e.clientX - b.left) / b.width) * 100,
                      y = ((e.clientY - b.top) / b.height) * 100;
                    let nearest = selected;
                    let distance = 9;
                    points.slice(0, sleeveless ? 6 : 8).forEach((p, i) => {
                      const d = Math.hypot(p.x - x, p.y - y);
                      if (d < distance) {
                        distance = d;
                        nearest = i;
                      }
                    });
                    setSelected(nearest);
                    drag.current = nearest;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    updatePoint(nearest, x, y);
                  }}
                  onPointerMove={(e) => {
                    if (drag.current === null) return;
                    const b = e.currentTarget.getBoundingClientRect();
                    updatePoint(
                      drag.current,
                      ((e.clientX - b.left) / b.width) * 100,
                      ((e.clientY - b.top) / b.height) * 100,
                    );
                  }}
                  onPointerUp={() => {
                    drag.current = null;
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (!e.key.startsWith("Arrow")) return;
                    e.preventDefault();
                    const p = points[selected],
                      d = e.shiftKey ? 2 : 0.5;
                    updatePoint(
                      selected,
                      p.x +
                        (e.key === "ArrowLeft"
                          ? -d
                          : e.key === "ArrowRight"
                            ? d
                            : 0),
                      p.y +
                        (e.key === "ArrowUp"
                          ? -d
                          : e.key === "ArrowDown"
                            ? d
                            : 0),
                    );
                  }}
                >
                  <polyline
                    points={points
                      .slice(1, 6)
                      .map((p) => `${p.x},${p.y}`)
                      .join(" ")}
                    fill="none"
                    stroke="#d72f77"
                    strokeWidth=".6"
                  />
                  {points.slice(0, sleeveless ? 6 : 8).map((p, i) => (
                    <g key={i}>
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={selected === i ? 1.7 : 1.3}
                        fill={selected === i ? "#ffce3a" : "#d72f77"}
                        stroke="white"
                        strokeWidth=".4"
                      />
                      <text
                        x={p.x + 1.8}
                        y={p.y - 1}
                        fontSize="3"
                        fill="#111"
                        stroke="white"
                        strokeWidth=".3"
                        paintOrder="stroke"
                      >
                        {i + 1}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
            <div className="trace-options">
              <h3>1. Find the outline</h3>
              <div className="trace-detect-row">
                <Select
                  value={mode}
                  onValueChange={(v) => setMode(v as typeof mode)}
                >
                  <SelectTrigger aria-label="Image type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sketch">Pencil / sketch</SelectItem>
                    <SelectItem value="photo">Garment photo</SelectItem>
                  </SelectContent>
                </Select>
                <button
                  className="button"
                  disabled={detecting || !aspect}
                  onClick={() => void detect()}
                >
                  {detecting ? "Detecting…" : "Detect again"}
                </button>
              </div>
              <p className="subtle" role="status">
                {message || "Finding the garment edges…"}
              </p>
              <div className="trace-point-picker">
                {labels.slice(0, sleeveless ? 6 : 8).map((label, i) => (
                  <button
                    key={label}
                    className={`button ${selected === i ? "primary" : ""}`}
                    aria-label={label}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <p className="subtle">
                <strong>
                  {selected + 1}. {labels[selected]}
                </strong>{" "}
                · Drag a dot to correct it.
              </p>
              <label className="trace-check">
                <Checkbox
                  checked={sleeveless}
                  onCheckedChange={(v) => {
                    setSleeveless(v === true);
                    setSelected(0);
                  }}
                />
                No sleeves
              </label>
              <h3>2. Choose the size</h3>
              <Select value={sizing} onValueChange={setSizing}>
                <SelectTrigger aria-label="Sizing method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="estimate">
                    Estimate for this mannequin
                  </SelectItem>
                  <SelectItem value="measured">
                    I know the garment’s length
                  </SelectItem>
                </SelectContent>
              </Select>
              {sizing === "estimate" ? (
                <>
                  <label className="field-head" style={{ marginTop: 12 }}>
                    Where should it end?
                  </label>
                  <Select
                    value={ending}
                    onValueChange={(v) => setEnding(v as typeof ending)}
                  >
                    <SelectTrigger aria-label="Garment ending">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hip">At the hips · Top</SelectItem>
                      <SelectItem value="knee">At the knees · Dress</SelectItem>
                      <SelectItem value="ankle">
                        At the ankles · Long dress
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="subtle">
                    Uses the mannequin’s proportions with room to move. These
                    are estimated sizes, not measurements from the image.
                  </p>
                </>
              ) : (
                <>
                  <label className="field-head" style={{ marginTop: 12 }}>
                    Top of shoulder to bottom edge{" "}
                    <input
                      type="number"
                      min={35}
                      max={145}
                      value={length}
                      aria-label="Garment length in centimetres"
                      onChange={(e) => setLength(Number(e.target.value))}
                      style={{ width: 72 }}
                    />{" "}
                    cm
                  </label>
                  <p className="subtle">
                    Lay the garment flat. Measure from its highest shoulder
                    point straight down to its bottom edge. If unsure, switch to
                    estimated sizing.
                  </p>
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="button primary full"
                disabled={detecting || !aspect}
                onClick={() => {
                  try {
                    const next =
                      sizing === "estimate"
                        ? estimateDesign(
                            points,
                            measurements,
                            design,
                            ending,
                            sleeveless,
                          )
                        : traceToDesign(
                            points,
                            aspect,
                            length,
                            sleeveless,
                            design,
                          );
                    onChange(next);
                    setOpen(false);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Generate & try on
              </button>
              <p className="subtle">
                Creates an approximate symmetric shape. Layers, decorations and
                hidden seams are not reconstructed.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

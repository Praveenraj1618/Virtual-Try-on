"use client";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  traceLabels,
  initialTrace,
  traceToDesign,
  type TracePoint,
} from "@/lib/tryon/design-trace";
import type { Design } from "@/lib/tryon/schema";
export function DesignTracer({
  design,
  onChange,
}: {
  design: Design;
  onChange: (d: Design) => void;
}) {
  const [points, setPoints] = useState<TracePoint[]>(
    initialTrace.map((p) => ({ ...p })),
  );
  const [selected, setSelected] = useState(0),
    [aspect, setAspect] = useState(0),
    [length, setLength] = useState(design.garment.length),
    [sleeveless, setSleeveless] = useState(false),
    [message, setMessage] = useState(""),
    [generated, setGenerated] = useState(false);
  const move = (x: number, y: number) => {
    setPoints((p) =>
      p.map((v, i) =>
        i === selected
          ? {
              x: Math.max(0, Math.min(100, x)),
              y: Math.max(0, Math.min(100, y)),
            }
          : v,
      ),
    );
    setGenerated(false);
    setMessage("");
  };
  return (
    <section aria-label="Trace design into 3D" style={{ marginTop: 16 }}>
      <p className="subtle">
        Use a straight front view of one dress or top. Choose a point below,
        then click its location on the image’s right half. The other half and
        back are mirrored approximations.
      </p>
      <div style={{ position: "relative", background: "white" }}>
        <img
          src={design.reference}
          alt="Garment design with editable outline landmarks"
          style={{ display: "block", width: "100%" }}
          onLoad={(e) =>
            setAspect(
              e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
            )
          }
          onError={() => {
            setAspect(0);
            setMessage("Image could not load. Upload the design again.");
          }}
        />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            touchAction: "none",
          }}
          role="application"
          aria-label={`Place ${traceLabels[selected]}. Use arrow keys to fine-tune.`}
          tabIndex={0}
          onPointerDown={(e) => {
            const b = e.currentTarget.getBoundingClientRect();
            move(
              ((e.clientX - b.left) / b.width) * 100,
              ((e.clientY - b.top) / b.height) * 100,
            );
          }}
          onKeyDown={(e) => {
            const delta = e.shiftKey ? 2 : 0.5;
            const p = points[selected];
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              move(
                p.x +
                  (e.key === "ArrowLeft"
                    ? -delta
                    : e.key === "ArrowRight"
                      ? delta
                      : 0),
                p.y +
                  (e.key === "ArrowUp"
                    ? -delta
                    : e.key === "ArrowDown"
                      ? delta
                      : 0),
              );
            }
          }}
        >
          <polyline
            points={points
              .slice(1, 6)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            fill="none"
            stroke="#d72f77"
            strokeWidth="0.7"
          />
          {points.slice(0, sleeveless ? 6 : 8).map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={i === selected ? 2 : 1.4}
                fill={i === selected ? "#ffce3a" : "#d72f77"}
                stroke="white"
                strokeWidth=".5"
              />
              <text
                x={p.x + 2}
                y={p.y - 1}
                fontSize="4"
                fill="#151515"
                stroke="white"
                strokeWidth=".2"
                paintOrder="stroke"
              >
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {traceLabels.slice(0, sleeveless ? 6 : 8).map((label, i) => (
          <button
            key={label}
            className={`button ${selected === i ? "primary" : ""}`}
            aria-pressed={selected === i}
            onClick={() => setSelected(i)}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>
      <label className="field-head" style={{ marginTop: 16 }}>
        Shoulder-to-hem length (cm)
        <input
          aria-label="Design shoulder-to-hem length"
          type="number"
          min={35}
          max={145}
          value={length}
          onChange={(e) => {
            setLength(Number(e.target.value));
            setGenerated(false);
          }}
          style={{ width: 70 }}
        />
      </label>
      <label style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <Checkbox
          checked={sleeveless}
          onCheckedChange={(v) => {
            setSleeveless(v === true);
            setSelected(0);
            setGenerated(false);
          }}
        />
        Sleeveless design
      </label>
      <button
        className="button primary full"
        disabled={!aspect}
        onClick={() => {
          try {
            onChange(traceToDesign(points, aspect, length, sleeveless, design));
            setGenerated(true);
            setMessage(
              "3D shape created. Review its dimensions and fit below; save the look to keep it.",
            );
          } catch (e) {
            setGenerated(false);
            setMessage((e as Error).message);
          }
        }}
      >
        Generate 3D garment
      </button>
      {message && (
        <p
          role={generated ? "status" : "alert"}
          className={generated ? "subtle" : "error"}
        >
          {message}
        </p>
      )}
      <p className="subtle">
        Guided reconstruction, not automatic AI conversion. Produces a symmetric
        garment mesh; ruffles, cut-outs, layers and hidden seams need further
        modelling. Fabric thickness and depth are estimated.
      </p>
      {design.tracedShape && (
        <button
          className="button full"
          onClick={() => onChange({ ...design, tracedShape: undefined })}
        >
          Use template outline again
        </button>
      )}
    </section>
  );
}

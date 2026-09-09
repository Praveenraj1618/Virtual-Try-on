"use client";
import { Slider } from "@/components/ui/slider";
import { neutralPose, type Pose } from "@/lib/tryon/pose";
export function PoseEditor({
  pose,
  onChange,
}: {
  pose: Pose;
  onChange: (p: Pose) => void;
}) {
  return (
    <section className="garment-editor" aria-label="Arm pose controls">
      <div className="panel-title">
        <h2>Move the arms</h2>
      </div>
      <p className="subtle">
        Move each shoulder and bend each elbow. Cloth settles after each
        adjustment.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="button" onClick={() => onChange(neutralPose)}>
          Relaxed
        </button>
        <button
          className="button"
          onClick={() =>
            onChange({
              left: { raise: 68, forward: 0, bend: 0 },
              right: { raise: 68, forward: 0, bend: 0 },
            })
          }
        >
          Arms out
        </button>
        <button
          className="button"
          onClick={() =>
            onChange({
              ...neutralPose,
              right: { raise: 55, forward: 20, bend: 110 },
            })
          }
        >
          Wave
        </button>
      </div>
      {(["left", "right"] as const).map((side) => (
        <div key={side}>
          <h3 style={{ fontSize: 15, marginTop: 18 }}>
            {side === "left" ? "Left arm" : "Right arm"} (mannequin’s)
          </h3>
          {(
            [
              { key: "raise", label: "Shoulder lift", min: -10, max: 110 },
              {
                key: "forward",
                label: "Forward / backward",
                min: -40,
                max: 100,
              },
              { key: "bend", label: "Elbow bend", min: 0, max: 135 },
            ] as const
          ).map((f) => (
            <div className="field" key={f.key}>
              <div className="field-head">
                <span>{f.label}</span>
                <span>{pose[side][f.key]}°</span>
              </div>
              <Slider
                aria-label={`${side} ${f.label}`}
                min={f.min}
                max={f.max}
                step={1}
                value={[pose[side][f.key]]}
                onValueChange={([v]) =>
                  onChange({ ...pose, [side]: { ...pose[side], [f.key]: v } })
                }
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

"use client";
import { useEffect, useId, useState } from "react";
import { Info, RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  type Design,
  type Measurements,
  type GarmentMeasurements,
  templateDimensions,
  measurementComparison,
  canDrapeGarment,
} from "@/lib/tryon/schema";
function DimensionField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId(),
    [text, setText] = useState(String(value)),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n) || n < min || n > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(Math.round(n * 10) / 10);
  };
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <span className="dimension-number">
          <input
            id={id}
            type="number"
            value={text}
            min={min}
            max={max}
            step="0.1"
            aria-invalid={invalid}
            aria-describedby={invalid ? id + "-error" : undefined}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit();
                e.currentTarget.blur();
              }
            }}
          />
          <span>cm</span>
        </span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={([v]) => onChange(v)}
      />
      {invalid && (
        <p id={id + "-error"} className="dimension-error">
          Enter {min}–{max} cm; the preview keeps the previous value.
        </p>
      )}
    </div>
  );
}
export function GarmentEditor({
  design,
  onChange,
}: {
  design: Design;
  onChange: (design: Design) => void;
}) {
  const update = (key: keyof GarmentMeasurements, value: number) =>
    onChange({ ...design, garment: { ...design.garment, [key]: value } });
  const base = templateDimensions[design.kind];
  const fields: {
    key: keyof GarmentMeasurements;
    label: string;
    min: number;
    max: number;
  }[] = [
    ...(design.kind !== "trousers"
      ? [
          {
            key: "chest" as const,
            label: "Chest circumference",
            min: 60,
            max: 180,
          },
        ]
      : []),
    { key: "waist", label: "Waist circumference", min: 50, max: 170 },
    {
      key: "hips",
      label:
        design.kind === "tshirt"
          ? "Lower-body circumference"
          : "Hip circumference",
      min: 65,
      max: 185,
    },
    ...(design.kind !== "trousers"
      ? [
          {
            key: "shoulders" as const,
            label: "Shoulder width",
            min: 28,
            max: 65,
          },
          {
            key: "length" as const,
            label: "Shoulder-to-hem length",
            min: 35,
            max: 145,
          },
          {
            key: "sleeveLength" as const,
            label: "Sleeve length (0 = none)",
            min: 0,
            max: 75,
          },
        ]
      : [
          {
            key: "inseam" as const,
            label: "Garment inseam",
            min: 40,
            max: 110,
          },
          {
            key: "rise" as const,
            label: "Waist-to-crotch rise",
            min: 18,
            max: 38,
          },
        ]),
  ];
  return (
    <section
      className="garment-editor"
      aria-label="Independent garment dimensions"
    >
      <div className="panel-title">
        <h2>Garment dimensions</h2>
        <span className="badge">Fixed size</span>
      </div>
      <p className="subtle">
        These stay fixed when your body measurements change. Values describe the
        garment before draping.
      </p>
      <div className="field">
        <Select
          value="custom"
          onValueChange={(v) => {
            if (v === "custom") return;
            const change = Number(v);
            onChange({
              ...design,
              garment: {
                ...base,
                chest: base.chest + change,
                waist: base.waist + change,
                hips: base.hips + change,
                shoulders: base.shoulders + change / 4,
              },
            });
          }}
        >
          <SelectTrigger
            className="full"
            aria-label="Apply an example garment size"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">Custom dimensions</SelectItem>
            {[-4, 0, 4].map((delta, i) => (
              <SelectItem key={delta} value={String(delta)}>
                Example {i + 1} ·{" "}
                {design.kind === "trousers" ? "waist" : "chest"}{" "}
                {base[design.kind === "trousers" ? "waist" : "chest"] + delta}{" "}
                cm
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="subtle" style={{ fontSize: 12, marginTop: 7 }}>
          Illustrative examples, not retail size labels.
        </p>
      </div>
      {fields.map(({ key, ...field }) => (
        <DimensionField
          key={key}
          {...field}
          value={design.garment[key]}
          onChange={(v) => update(key, v)}
        />
      ))}
      <hr className="divider" />
      <div className="panel-title">
        <h2>Shape your design</h2>
      </div>
      {design.kind !== "trousers" && (
        <div className="field">
          <label className="field-head" htmlFor="neckline-style">
            Neckline
          </label>
          <Select
            value={design.neckline}
            onValueChange={(v) =>
              onChange({ ...design, neckline: v as Design["neckline"] })
            }
          >
            <SelectTrigger id="neckline-style" className="full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crew">Crew neck</SelectItem>
              <SelectItem value="scoop">Scoop neck</SelectItem>
              <SelectItem value="v">V-neck</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="field">
        <label className="field-head" htmlFor="silhouette-style">
          {design.kind === "trousers" ? "Leg silhouette" : "Hem silhouette"}
        </label>
        <Select
          value={design.silhouette}
          onValueChange={(v) =>
            onChange({ ...design, silhouette: v as Design["silhouette"] })
          }
        >
          <SelectTrigger id="silhouette-style" className="full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="straight">Straight</SelectItem>
            <SelectItem value="tapered">Tapered</SelectItem>
            <SelectItem value="flared">Flared</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {design.kind !== "trousers" && design.garment.sleeveLength > 0 && (
        <div className="field">
          <label className="field-head" htmlFor="sleeve-style">
            Sleeve shape
          </label>
          <Select
            value={design.sleeveStyle}
            onValueChange={(v) =>
              onChange({ ...design, sleeveStyle: v as Design["sleeveStyle"] })
            }
          >
            <SelectTrigger id="sleeve-style" className="full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="straight">Straight sleeve</SelectItem>
              <SelectItem value="bell">Bell sleeve</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <button
        className="button quiet full"
        onClick={() =>
          onChange({
            ...design,
            garment: { ...base },
            neckline: "crew",
            silhouette: design.kind === "dress" ? "flared" : "straight",
            sleeveStyle: "straight",
          })
        }
      >
        <RotateCcw />
        Reset garment dimensions & shape
      </button>
    </section>
  );
}
export function MeasurementComparison({
  measurements,
  design,
}: {
  measurements: Measurements;
  design: Design;
}) {
  const rows = measurementComparison(measurements, design),
    drape = canDrapeGarment(measurements, design);
  return (
    <section
      className="comparison"
      aria-label="Body and garment measurement comparison"
    >
      <div className="panel-title">
        <h2>Body vs garment</h2>
        <span className="subtle">cm</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Measure</TableHead>
            <TableHead>Body</TableHead>
            <TableHead>Garment</TableHead>
            <TableHead>Δ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell>{r.body}</TableCell>
              <TableCell>{r.garment}</TableCell>
              <TableCell className={r.difference < 0 ? "negative" : "positive"}>
                {r.difference > 0 ? "+" : ""}
                {r.difference}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="subtle" style={{ fontSize: 12, marginTop: 10 }}>
        Δ = garment minus body. Circumference and length differences are not a
        comfort or fit prediction.
      </p>
      {!drape && (
        <div className="help fit-caution">
          <Info />
          <span>
            Draping paused: at least one width has insufficient clearance. The
            garment keeps its dimensions; intersections may be visible.
          </span>
        </div>
      )}
    </section>
  );
}

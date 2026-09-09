import { designSchema, type Design } from "./schema";
export type TracePoint = { x: number; y: number };
export const traceLabels = [
  "Neckline centre",
  "Shoulder tip",
  "Underarm / chest edge",
  "Waist edge",
  "Hip edge",
  "Hem edge",
  "Outer cuff",
  "Inner cuff",
];
export const initialTrace: TracePoint[] = [
  { x: 50, y: 15 },
  { x: 69, y: 12 },
  { x: 69, y: 29 },
  { x: 65, y: 46 },
  { x: 70, y: 64 },
  { x: 78, y: 90 },
  { x: 86, y: 39 },
  { x: 77, y: 42 },
];
/** Convert user-confirmed front-view landmarks into a symmetric elliptical garment.
 * Length calibrates the image scale. No image recognition or hidden-back inference. */
export function traceToDesign(
  points: TracePoint[],
  aspect: number,
  length: number,
  sleeveless: boolean,
  design: Design,
): Design {
  if (
    points.length !== 8 ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 100 ||
        p.y < 0 ||
        p.y > 100,
    )
  )
    throw new Error("Mark all eight points inside the image.");
  const [neck, shoulder, chest, waist, hip, hem, outer, inner] = points;
  const height = hem.y - shoulder.y;
  if (
    height < 15 ||
    !(
      shoulder.y < chest.y &&
      chest.y < waist.y &&
      waist.y < hip.y &&
      hip.y < hem.y
    )
  )
    throw new Error(
      "Place shoulder, chest, waist, hip and hem from top to bottom.",
    );
  if ([shoulder, chest, waist, hip, hem].some((p) => p.x <= neck.x + 2))
    throw new Error(
      "Mark the right-hand edge of the image, to the right of the neckline centre.",
    );
  const scale = length / height;
  const perimeter = (p: TracePoint) =>
    (p.x - neck.x) *
    aspect *
    scale *
    Math.PI *
    (3 * 1.72 - Math.sqrt(3.72 * 3.16));
  const round = (n: number) => Math.round(n * 10) / 10;
  const cuff = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
  const candidate = {
    ...design,
    kind: design.kind === "trousers" ? "dress" : design.kind,
    texture: "",
    garment: {
      ...design.garment,
      length,
      shoulders: round(2 * (shoulder.x - neck.x) * aspect * scale),
      chest: round(perimeter(chest)),
      waist: round(perimeter(waist)),
      hips: round(perimeter(hip)),
      sleeveLength: sleeveless
        ? 0
        : round(
            Math.hypot((cuff.x - shoulder.x) * aspect, cuff.y - shoulder.y) *
              scale,
          ),
    },
    tracedShape: {
      chestAt: (chest.y - shoulder.y) / height,
      waistAt: (waist.y - shoulder.y) / height,
      hipAt: (hip.y - shoulder.y) / height,
      hemCircumference: round(perimeter(hem)),
      neckDepth: round(Math.max(0, neck.y - shoulder.y) * scale),
    },
  };
  const result = designSchema.safeParse(candidate);
  if (!result.success)
    throw new Error(
      `The outline gives unsupported proportions (${result.error.issues[0].path.join(" / ")}). Check the points and the real shoulder-to-hem length.`,
    );
  return result.data;
}

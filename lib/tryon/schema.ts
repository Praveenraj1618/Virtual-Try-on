import { z } from "zod";
export const measurementFields = [
  {
    key: "height",
    label: "Height",
    min: 140,
    max: 210,
    initial: 172,
    help: "Stand barefoot against a wall and measure floor to crown.",
  },
  {
    key: "chest",
    label: "Chest / bust",
    min: 65,
    max: 150,
    initial: 92,
    help: "Measure around the fullest part, keeping the tape level.",
  },
  {
    key: "waist",
    label: "Waist",
    min: 55,
    max: 145,
    initial: 76,
    help: "Measure your natural waist without pulling the tape tight.",
  },
  {
    key: "hips",
    label: "Hips",
    min: 70,
    max: 155,
    initial: 96,
    help: "Measure around the widest part of your hips and seat.",
  },
  {
    key: "shoulders",
    label: "Shoulder width",
    min: 30,
    max: 58,
    initial: 42,
    help: "Measure across the back from shoulder point to shoulder point.",
  },
  {
    key: "inseam",
    label: "Inseam",
    min: 55,
    max: 105,
    initial: 78,
    help: "Measure from the crotch to the ankle along the inside leg.",
  },
  {
    key: "arm",
    label: "Arm length",
    min: 40,
    max: 80,
    initial: 58,
    help: "With a slightly bent arm, measure shoulder point to wrist.",
  },
] as const;
export const measurementsSchema = z
  .object({
    height: z.number().min(140).max(210),
    chest: z.number().min(65).max(150),
    waist: z.number().min(55).max(145),
    hips: z.number().min(70).max(155),
    shoulders: z.number().min(30).max(58),
    inseam: z.number().min(55).max(105),
    arm: z.number().min(40).max(80),
  })
  .superRefine((m, ctx) => {
    if (m.inseam > m.height * 0.53)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inseam"],
        message:
          "Inseam must be no more than 53% of height for this mannequin.",
      });
    if (m.arm > m.height * 0.42)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["arm"],
        message:
          "Arm length must be no more than 42% of height for this mannequin.",
      });
  });
export type Measurements = z.infer<typeof measurementsSchema>;
export const defaultMeasurements = Object.fromEntries(
  measurementFields.map((f) => [f.key, f.initial]),
) as Measurements;
export const assetIdSchema = z.string().uuid();
export const garmentMeasurementsSchema = z.object({
  chest: z.number().min(60).max(180),
  waist: z.number().min(50).max(170),
  hips: z.number().min(65).max(185),
  shoulders: z.number().min(28).max(65),
  length: z.number().min(35).max(145),
  sleeveLength: z.number().min(0).max(75),
  inseam: z.number().min(40).max(110),
  rise: z.number().min(18).max(38),
});
export type GarmentMeasurements = z.infer<typeof garmentMeasurementsSchema>;
export const templateDimensions: Record<
  "tshirt" | "trousers" | "dress",
  GarmentMeasurements
> = {
  tshirt: {
    chest: 100,
    waist: 96,
    hips: 104,
    shoulders: 44,
    length: 64,
    sleeveLength: 20,
    inseam: 80,
    rise: 26,
  },
  trousers: {
    chest: 100,
    waist: 82,
    hips: 104,
    shoulders: 44,
    length: 106,
    sleeveLength: 0,
    inseam: 80,
    rise: 26,
  },
  dress: {
    chest: 100,
    waist: 84,
    hips: 104,
    shoulders: 44,
    length: 106,
    sleeveLength: 16,
    inseam: 80,
    rise: 26,
  },
};
export const designSchema = z.object({
  kind: z.enum(["tshirt", "trousers", "dress"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  // Retained solely to read first-version saved looks.
  ease: z.number().min(2).max(20).default(10),
  length: z.number().min(75).max(120).default(100),
  sleeve: z.number().min(0).max(100).default(32),
  fabric: z.enum(["cotton", "denim", "silk"]),
  texture: z.union([
    z.literal(""),
    z.literal("/cobalt-stripe.webp"),
    z.string().regex(/^\/api\/assets\/[0-9a-f-]{36}$/),
  ]),
  reference: z.union([
    z.literal(""),
    z.string().regex(/^\/api\/assets\/[0-9a-f-]{36}$/),
  ]),
  garment: garmentMeasurementsSchema.default(templateDimensions.tshirt),
  neckline: z.enum(["crew", "scoop", "v"]).default("crew"),
  silhouette: z.enum(["straight", "tapered", "flared"]).default("straight"),
  sleeveStyle: z.enum(["straight", "bell"]).default("straight"),
});
export type Design = z.infer<typeof designSchema>;
export const defaultDesign: Design = designSchema.parse({
  kind: "tshirt",
  color: "#315a49",
  fabric: "cotton",
  texture: "",
  reference: "",
});
export function upgradeDesign(raw: unknown, m: Measurements): Design {
  const parsed = designSchema.parse(raw);
  if (raw && typeof raw === "object" && "garment" in raw) return parsed;
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(n * 10) / 10));
  return {
    ...parsed,
    silhouette: parsed.kind === "dress" ? "flared" : "straight",
    garment: {
      ...templateDimensions[parsed.kind],
      chest: clamp(m.chest + parsed.ease, 60, 180),
      waist: clamp(m.waist + parsed.ease, 50, 170),
      hips: clamp(m.hips + parsed.ease, 65, 185),
      shoulders: clamp(m.shoulders + 4, 28, 65),
      length: clamp(
        ((parsed.kind === "dress" ? 106 : 60) * parsed.length) / 100,
        35,
        145,
      ),
      sleeveLength: clamp((m.arm * parsed.sleeve) / 100, 0, 75),
      inseam: clamp((m.inseam * parsed.length) / 100, 40, 110),
    },
  };
}
export const lookSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    measurements: measurementsSchema,
    design: z.unknown(),
  })
  .transform((v, ctx) => {
    const parsed = designSchema.safeParse(v.design);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({ ...issue, path: ["design", ...issue.path] });
      return z.NEVER;
    }
    return { ...v, design: upgradeDesign(v.design, v.measurements) };
  });
export type Look = z.infer<typeof lookSchema> & {
  id: string;
  createdAt: string;
};
export const garmentNames = {
  tshirt: "Everyday tee",
  trousers: "Tailored trousers",
  dress: "Studio dress",
};
export function measurementComparison(m: Measurements, d: Design) {
  const keys: ("chest" | "waist" | "hips" | "shoulders" | "inseam")[] =
    d.kind === "trousers"
      ? ["waist", "hips", "inseam"]
      : d.kind === "dress"
        ? ["chest", "waist", "hips", "shoulders"]
        : ["chest", "waist", "shoulders"];
  return keys.map((key) => ({
    key,
    label:
      key === "shoulders" ? "Shoulders" : key[0].toUpperCase() + key.slice(1),
    body: m[key],
    garment: d.garment[key],
    difference: Math.round((d.garment[key] - m[key]) * 10) / 10,
  }));
}
export function canDrapeGarment(m: Measurements, d: Design) {
  // A small numerical clearance avoids stretching an undersized template over a body.
  return measurementComparison(m, d)
    .filter((row) => row.key !== "inseam")
    .every((row) => row.difference >= (row.key === "shoulders" ? 0 : 2));
}

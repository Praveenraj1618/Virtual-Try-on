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
export const designSchema = z.object({
  kind: z.enum(["tshirt", "trousers", "dress"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ease: z.number().min(2).max(20),
  length: z.number().min(75).max(120),
  sleeve: z.number().min(0).max(100),
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
});
export type Design = z.infer<typeof designSchema>;
export const defaultDesign: Design = {
  kind: "tshirt",
  color: "#315a49",
  ease: 10,
  length: 100,
  sleeve: 32,
  fabric: "cotton",
  texture: "",
  reference: "",
};
export const lookSchema = z.object({
  name: z.string().trim().min(1).max(60),
  measurements: measurementsSchema,
  design: designSchema,
});
export type Look = z.infer<typeof lookSchema> & {
  id: string;
  createdAt: string;
};
export const garmentNames = {
  tshirt: "Everyday tee",
  trousers: "Straight trousers",
  dress: "A-line dress",
};

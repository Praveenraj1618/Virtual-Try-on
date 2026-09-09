import { defaultDesign, templateDimensions, type Design } from "./schema";
function garment(
  kind: Design["kind"],
  changes: Partial<Design>,
  dimensions: Partial<Design["garment"]>,
): Design {
  return {
    ...defaultDesign,
    kind,
    ...changes,
    garment: { ...templateDimensions[kind], ...dimensions },
  };
}
export const garmentCatalogue = [
  {
    id: "tee",
    name: "Short-sleeve tee",
    description: "Crew neck · straight body",
    design: garment("tshirt", {}, { length: 64, sleeveLength: 20 }),
  },
  {
    id: "blouse",
    name: "V-neck blouse",
    description: "Shaped waist · long sleeves",
    design: garment(
      "tshirt",
      { neckline: "v", fabric: "silk" },
      { waist: 86, length: 62, sleeveLength: 56 },
    ),
  },
  {
    id: "tunic",
    name: "Flared tunic",
    description: "Scoop neck · bell sleeves",
    design: garment(
      "dress",
      { neckline: "scoop", silhouette: "flared", sleeveStyle: "bell" },
      { length: 85, sleeveLength: 38 },
    ),
  },
  {
    id: "aline",
    name: "A-line dress",
    description: "Fitted waist · wide hem",
    design: garment(
      "dress",
      { silhouette: "flared", neckline: "scoop" },
      { waist: 84, hips: 115, length: 106, sleeveLength: 12 },
    ),
  },
  {
    id: "maxi",
    name: "Sleeveless maxi",
    description: "Full length · flared skirt",
    design: garment(
      "dress",
      { silhouette: "flared", neckline: "v" },
      { waist: 86, hips: 118, length: 132, sleeveLength: 0 },
    ),
  },
  {
    id: "shift",
    name: "Straight dress",
    description: "Crew neck · straight cut",
    design: garment(
      "dress",
      { silhouette: "straight" },
      { waist: 98, length: 96, sleeveLength: 16 },
    ),
  },
  {
    id: "trousers",
    name: "Straight trousers",
    description: "Full length · straight legs",
    design: garment("trousers", { color: "#303435" }, {}),
  },
  {
    id: "wide",
    name: "Wide-leg trousers",
    description: "Widening leg opening",
    design: garment(
      "trousers",
      { color: "#b4a188", silhouette: "flared" },
      { hips: 112 },
    ),
  },
  {
    id: "tapered",
    name: "Tapered trousers",
    description: "Narrower ankle opening",
    design: garment(
      "trousers",
      { color: "#202d48", silhouette: "tapered" },
      {},
    ),
  },
];

import type { Recipe } from "./types";

const h = (hours: number, mins: number) => hours * 60 + mins;

/** The worked example from SPEC §11. Illustrative timings for a 5 kg turkey. */
export function christmasRoast(now = Date.now()): Recipe {
  const dishes = [
    { id: "turkey", name: "Turkey", colour: "#b45309" },
    { id: "potatoes", name: "Potatoes", colour: "#a16207" },
    { id: "veg", name: "Veg", colour: "#4d7c0f" },
    { id: "trimmings", name: "Trimmings", colour: "#be185d" },
    { id: "gravy", name: "Gravy", colour: "#7e22ce" },
  ];
  const rows: [number, string | undefined, string, number?, string?][] = [
    [h(4, 55), "turkey", "Take turkey out of the fridge", undefined, "Let it come up to room temperature."],
    [h(4, 15), undefined, "Preheat oven to 180 °C fan"],
    [h(3, 55), "turkey", "Turkey into the oven", h(3, 10), "5 kg bird. Baste every 45 minutes. Cover with foil if browning too fast."],
    [h(2, 0), "potatoes", "Peel and chop potatoes and parsnips", 20],
    [h(1, 35), "potatoes", "Roasting tin with fat into the oven"],
    [h(1, 30), "potatoes", "Potatoes on to boil (parboil)", 10, "Salted water. They should be just soft at the edges."],
    [h(1, 15), "potatoes", "Drain, rough up, into the hot fat", 60],
    [h(1, 0), "trimmings", "Pigs in blankets into the oven", 40],
    [h(0, 50), "veg", "Parsnips into the oven", 40],
    [h(0, 45), "turkey", "Turkey out; rest under foil; oven up to 200 °C", 45, "Juices should run clear; 75 °C in the thickest part."],
    [h(0, 40), "gravy", "Make gravy from the roasting juices", 20],
    [h(0, 35), "potatoes", "Turn the roast potatoes"],
    [h(0, 30), "trimmings", "Stuffing into the oven", 25],
    [h(0, 20), "veg", "Carrots on to boil", 15],
    [h(0, 15), undefined, "Warm plates and serving dishes"],
    [h(0, 12), "veg", "Sprouts on to boil", 8],
    [h(0, 10), "turkey", "Carve the turkey", 10],
    [0, undefined, "Serve"],
  ];
  return {
    id: "christmas-roast",
    name: "Christmas roast",
    description: "Roast turkey with all the trimmings. Timings are for a 5 kg bird — adjust to yours.",
    dishes,
    tasks: rows.map(([startOffsetMin, dishId, title, durationMin, notes], i) => ({
      id: `t${i + 1}`,
      title,
      startOffsetMin,
      ...(dishId ? { dishId } : {}),
      ...(durationMin ? { durationMin } : {}),
      ...(notes ? { notes } : {}),
    })),
    updatedAt: now,
  };
}

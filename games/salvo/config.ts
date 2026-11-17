import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "grid",
      label: "Sea size",
      options: [
        { value: 10, label: "10×10 · 5 ships" },
        { value: 8, label: "8×8 · 4 ships (quick)" },
      ],
      default: 10,
    },
    {
      kind: "choice",
      key: "salvo",
      label: "Salvo",
      options: [
        { value: "fixed", label: "Always 3 shots" },
        { value: "fleet", label: "1 shot per ship afloat" },
      ],
      default: "fixed",
      hint: "Classic rules shrink your salvo as you lose ships; 3 every turn keeps comebacks alive.",
    },
    {
      kind: "choice",
      key: "turn",
      label: "Aim timer",
      options: [
        { value: 20, label: "20s" },
        { value: 30, label: "30s" },
        { value: 45, label: "45s" },
      ],
      default: 30,
    },
  ],
  bots: true,
};

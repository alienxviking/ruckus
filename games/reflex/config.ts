import type { GameConfig } from "../../shared/settings";

export const config: GameConfig = {
  settings: [
    {
      kind: "choice",
      key: "target",
      label: "First to",
      options: [
        { value: 3, label: "3" },
        { value: 5, label: "5" },
        { value: 8, label: "8" },
      ],
      default: 5,
    },
    {
      kind: "choice",
      key: "fakes",
      label: "Fake-outs",
      options: [
        { value: "off", label: "Off" },
        { value: "some", label: "Some" },
        { value: "lots", label: "Lots" },
      ],
      default: "some",
      hint: "How often a fake word flashes before DRAW!",
    },
  ],
  bots: true,
};

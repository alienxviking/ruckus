// Canvas Clash emblems: 5x5 pixel art, server-only (never import this into the client).
// Every cell is a paint colour, so a blank board scores nothing. Letters:
// K ink, S silver, R red, O orange, Y yellow, G green, B blue, P purple.

const LETTERS = "KSROYGBP";

export interface Emblem {
  id: string;
  name: string;
  icon: string;
  /** 25 digits "1"-"8", row-major. */
  art: string;
}

function emblem(id: string, name: string, icon: string, rows: string[]): Emblem {
  const art = rows
    .join("")
    .split("")
    .map((ch) => String(LETTERS.indexOf(ch) + 1))
    .join("");
  return { id, name, icon, art };
}

export const EMBLEMS: Emblem[] = [
  emblem("heart", "Heart", "❤️", ["KRKRK", "RRRRR", "RRRRR", "KRRRK", "KKRKK"]),
  emblem("star", "Star", "⭐", ["PPYPP", "PYYYP", "YYYYY", "PYYYP", "PYPYP"]),
  emblem("skull", "Skull", "💀", ["KSSSK", "SKSKS", "SSSSS", "KSSSK", "KSKSK"]),
  emblem("ghost", "Ghost", "👻", ["PSSSP", "SKSKS", "SSSSS", "SSSSS", "SPSPS"]),
  emblem("mushroom", "Mushroom", "🍄", ["GRRRG", "RSRSR", "RRRRR", "GSSSG", "GSSSG"]),
  emblem("rocket", "Rocket", "🚀", ["KKSKK", "KSSSK", "KSRSK", "SSSSS", "SKRKS"]),
  emblem("cat", "Cat", "🐱", ["OKKKO", "OOOOO", "OGOGO", "OOKOO", "KOOOK"]),
  emblem("sword", "Sword", "🗡️", ["BBSBB", "BBSBB", "BBSBB", "BOOOB", "BBOBB"]),
  emblem("smiley", "Smiley", "🙂", ["KYYYK", "YKYKY", "YYYYY", "YKKKY", "KYYYK"]),
  emblem("tree", "Pine tree", "🌲", ["BBGBB", "BGGGB", "GGGGG", "BBOBB", "BBOBB"]),
  emblem("moon", "Moon", "🌙", ["KKYYK", "KYYKK", "KYYKK", "KYYKK", "KKYYK"]),
  emblem("sun", "Sun", "☀️", ["YBYBY", "BYYYB", "YYYYY", "BYYYB", "YBYBY"]),
  emblem("fish", "Fish", "🐟", ["BBBBB", "OBOOB", "OOOKO", "OBOOB", "BBBBB"]),
  emblem("pumpkin", "Pumpkin", "🎃", ["KKGKK", "OOOOO", "OKOKO", "OOOOO", "OKKKO"]),
  emblem("invader", "Invader", "👾", ["GKKKG", "KGGGK", "GKGKG", "GGGGG", "KGKGK"]),
  emblem("tulip", "Tulip", "🌷", ["RBRBR", "RRRRR", "BRRRB", "BBGBB", "BGGBB"]),
  emblem("house", "House", "🏠", ["BBRBB", "BRRRB", "RRRRR", "BSSSB", "BSRSB"]),
  emblem("crown", "Crown", "👑", ["YPYPY", "YYYYY", "YRYRY", "YYYYY", "PPPPP"]),
  emblem("gem", "Gem", "💎", ["KKBKK", "KBBBK", "BBSBB", "KBBBK", "KKBKK"]),
  emblem("apple", "Apple", "🍎", ["YYYGY", "YRGRY", "RRRRR", "RRRRR", "YRRRY"]),
  emblem("drop", "Droplet", "💧", ["SSBSS", "SSBSS", "SBBBS", "BBBBB", "SBBBS"]),
  emblem("robot", "Robot", "🤖", ["OOSOO", "SSSSS", "SKSKS", "SSSSS", "SKKKS"]),
  emblem("bolt", "Lightning", "⚡", ["PPPYY", "PPYYP", "PYYYP", "PYYPP", "YYPPP"]),
  emblem("umbrella", "Umbrella", "☂️", ["BRRRB", "RRRRR", "BBSBB", "BBSBB", "BSSBB"]),
  emblem("cactus", "Cactus", "🌵", ["OOGOO", "GOGOG", "GOGOG", "GGGGG", "OOGOO"]),
  emblem("icecream", "Ice cream", "🍦", ["BPPPB", "PPPPP", "BOOOB", "BOOOB", "BBOBB"]),
  emblem("chomper", "Chomper", "🟡", ["KYYYK", "YYYKK", "YYKKK", "YYYKK", "KYYYK"]),
  emblem("frog", "Frog", "🐸", ["YGYGY", "GKGKG", "GGGGG", "GKKKG", "YGGGY"]),
  emblem("snowman", "Snowman", "⛄", ["BBSBB", "BSKSB", "BBSBB", "BSSSB", "BSSSB"]),
  emblem("note", "Music note", "🎵", ["PPYYY", "PPYPY", "PPYPP", "YYYPP", "YYYPP"]),
];

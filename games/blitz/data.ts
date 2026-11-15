// Server-only content for Blitz. Every emoji here is Unicode 12 or older, so it
// renders on Windows 10/11, Android and iOS. Lists are whitespace-separated
// strings, split at load time so they stay compact and readable.

const list = (s: string) => s.trim().split(/\s+/);

/**
 * Odd one out: look-alike pairs. Each is visibly different at a glance on a
 * phone, but only if you actually look. Either side can be the odd one.
 */
export const ODD_PAIRS: readonly (readonly [string, string])[] = list(`
  🙂/🙃 🐶/🐱 ⏰/⏲️ 🍎/🍅 🌲/🌳 😐/😑 🙈/🙊 🐭/🐹 🔒/🔓 😴/😪 🦁/🐯 🍩/🥯 🌛/🌜 👈/👉
  💛/🧡 🕐/🕑 ⚽/🏐 📕/📙 🌕/🌝 🐨/🐻 🚗/🚙 🐳/🐋 🍊/🍑 🌑/🌚 😺/😸 🐵/🙈 🎃/🍊 😀/😁
`).map((pair) => pair.split("/") as [string, string]);

/** Count flash: three clearly different emoji per field. */
export const COUNT_SETS: readonly (readonly [string, string, string])[] = list(`
  🐟/🐙/🦀 🍎/🍌/🍇 🐸/🐢/🐍 ⭐/🌙/⚡ 🚗/🚲/🚀 🐝/🐞/🦋 🍩/🍪/🧁 🐔/🐷/🐮 🌵/🌻/🍄 ⚽/🏀/🎾 🎈/🎁/🎂 👻/🎃/🦇
`).map((set) => set.split("/") as [string, string, string]);

/** Find the pair: themed pools so the twin doesn't jump out by colour alone. */
export const PAIR_POOLS: readonly (readonly string[])[] = [
  // animals
  list("🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦉 🐺 🐴 🦄 🐝 🐞 🦋 🐌 🐢"),
  // food
  list("🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥕 🌽 🥔 🥐 🧀 🍔 🍟 🍕 🌭 🌮 🍩 🍪 🧁"),
  // faces
  list("😀 😂 🙂 🙃 😉 😊 😇 😍 🤩 😘 😋 😜 🤪 🤑 🤗 🤔 🤐 😐 😏 🙄 😬 😴 😷 🤢 🥵 🥶 🤯 🤠 🥳 😎 🤓 😱 😭 😡"),
  // things
  list("⚽ 🏀 🏈 ⚾ 🎾 🏐 🎱 🏓 🎯 🎲 🎸 🎺 🎻 🥁 🎹 🎨 🎬 🎤 🎧 📷 💡 🔑 🔔 🎁 🎈 ⏰ 📚 ✏️ 🧲 🧸"),
];

/** Fruit maths: fruit with a hidden value each. */
export const FRUITS: readonly string[] = list("🍎 🍌 🍇 🍓 🍒 🍍 🍑 🍋 🍉 🥝");

/**
 * Anagram words: common, family friendly, 5 or 6 letters. None of them is an
 * anagram of another (the tests check), and words with well-known anagrams
 * (heart/earth, lemon/melon, listen/silent...) are left out on purpose.
 */
export const WORDS: readonly string[] = list(`
  APPLE BEACH BREAD BRAIN CHAIR CLOUD DANCE DREAM EAGLE FLAME FRUIT GHOST GRAPE GRASS HAPPY
  HONEY HOUSE JUICE KNIFE LAUGH MAGIC MONEY MOUSE MUSIC PAINT PARTY PIANO PIZZA PLANT QUEEN
  RIVER ROBOT SPOON STORM SUGAR TIGER TOAST TRAIN WATER WHALE ZEBRA CANDY CLOCK CROWN FROST
  GLOVE JELLY LUCKY PUPPY SHARK SHEEP STAMP SWING TRUCK WORLD BUNNY CABIN CAMEL CHALK COBRA
  DAISY FAIRY FLUTE GIANT HIPPO IGLOO KOALA LLAMA OTTER PANDA PEARL QUILT RADIO SALAD SCARF
  SLOTH STORY SUNNY TEETH THUMB TOWEL TULIP UNCLE VIDEO WAGON YACHT BACON BLOCK CRUMB MOVIE
  BANANA BASKET BUTTER CAMERA CANDLE CARROT CASTLE CHEESE CHERRY COOKIE DONKEY DRAGON GUITAR
  HAMMER JUNGLE KITTEN LADDER MONKEY ORANGE PENCIL PEPPER PLANET POCKET PURPLE RABBIT ROCKET
  SCHOOL SUMMER TOMATO TURTLE WINTER WIZARD YELLOW BUBBLE BUCKET BUTTON COFFEE CIRCUS PICNIC
  PILLOW PUZZLE SOCCER SPONGE TICKET TUNNEL WALRUS WINDOW ZIPPER MUFFIN NAPKIN PEANUT POTATO
  BREEZE CRAYON GOBLIN HELMET JACKET KETTLE LIZARD MAGNET MEADOW NEEDLE RIBBON TEAPOT TROPHY
  WAFFLE WALNUT PARADE SHOVEL VALLEY
`);

/** Real words a scramble must never spell (anagrams of list words), plus the list itself. */
export const NOT_A_SCRAMBLE: ReadonlySet<string> = new Set([
  ...WORDS,
  ...list(`
    BEARD BARED DEBAR ARMED SNOOP PALER CANED PINTA INAPT STOAT WHEAL BRAZE WINGS CAROB TORTE
    TOTER HOLTS UPLIT PAGER FORTS HARKS COULD BAIRN GOTHS TAMPS APPEL CLEATS PLATEN ONAGER TWINER
  `),
]);

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
  💙/💜 📗/📘 🍐/🍏 😃/😄 🐣/🐥 🎾/🥎 🐢/🦎 🚓/🚔 🙂/😊 🐿️/🦔 🌗/🌓 🍪/🍘
`).map((pair) => pair.split("/") as [string, string]);

/** Count flash: three clearly different emoji per field. */
export const COUNT_SETS: readonly (readonly [string, string, string])[] = list(`
  🐟/🐙/🦀 🍎/🍌/🍇 🐸/🐢/🐍 ⭐/🌙/⚡ 🚗/🚲/🚀 🐝/🐞/🦋 🍩/🍪/🧁 🐔/🐷/🐮 🌵/🌻/🍄 ⚽/🏀/🎾 🎈/🎁/🎂 👻/🎃/🦇
  🐱/🐶/🐭 🍕/🍔/🌭 🌸/🌼/🌺 🚌/🚕/🚓 🐧/🦉/🦆 🍓/🍒/🍑 💎/👑/💍 🦁/🐯/🐻
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
  // travel
  list("🚗 🚕 🚙 🚌 🚓 🚑 🚒 🚜 🚲 🛵 🚂 🚁 🚀 ✈️ ⛵ 🚤 🛶 ⛺ 🏠 🏰 🗽 🎡 🎢 🗿 🌋 🗻 ⚓ 🚦"),
  // nature
  list("🌵 🌲 🌴 🍄 🌻 🌹 🌷 🌸 🍁 🍀 🌾 ⭐ 🌙 ☀️ ⛅ 🌈 ❄️ 🔥 💧 🌊 ⚡ 🌍 🐚 🌺 🌼 🌳 🍂 🌱"),
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

/**
 * Spell check: the right spelling first, then three believable misspellings. Words
 * with accepted UK/US variants (colour, judgement...) are left out on purpose, and
 * no misspelling is itself a real word.
 */
export const SPELLINGS: readonly (readonly string[])[] = `
  ACCOMMODATE ACCOMODATE ACOMMODATE ACCOMMODAITE
  NECESSARY NECESARY NECCESSARY NESSESARY
  SEPARATE SEPERATE SEPARETE SEPPARATE
  DEFINITELY DEFINATELY DEFINITLY DEFFINITELY
  CALENDAR CALENDER CALANDAR CALLENDAR
  EMBARRASS EMBARASS EMBARRAS EMBBARASS
  RHYTHM RYTHM RHYTHEM RHYHTM
  BELIEVE BELEIVE BELIVE BEELIEVE
  RECEIVE RECIEVE RECEVE RESEIVE
  WEIRD WIERD WEIRED WEERD
  BUSINESS BUISNESS BUSSINESS BUSINES
  BEAUTIFUL BEUTIFUL BEAUTIFULL BAEUTIFUL
  TOMORROW TOMMOROW TOMOROW TOMMORROW
  BECAUSE BECUASE BECAUZE BEACAUSE
  FRIEND FREIND FRIND FRIENDE
  WEDNESDAY WENDSDAY WEDNSDAY WEDENSDAY
  FEBRUARY FEBUARY FEBRUERY FEBRARY
  LIBRARY LIBARY LIBRERY LIBRAREY
  KNOWLEDGE KNOWLEGE KNOLEDGE KNOWLAGE
  DISAPPEAR DISSAPEAR DISAPEAR DISSAPPEAR
  OCCASION OCASSION OCCASSION OCASION
  GUARANTEE GARANTEE GUARENTEE GAURANTEE
  RESTAURANT RESTARAUNT RESTURANT RESTAURANTE
  CHOCOLATE CHOCLATE CHOCOLLATE CHOKOLATE
  SANDWICH SANWICH SANDWHICH SANDWITCH
  VACUUM VACCUM VACUME VACCUUM
  PARALLEL PARALELL PARRALEL PARALEL
  ENVIRONMENT ENVIROMENT ENVIRONMANT ENVIORNMENT
  GOVERNMENT GOVERMENT GOVERNMANT GUVERNMENT
  MISSPELL MISPELL MISSPEL MISPEL
  PRONUNCIATION PRONOUNCIATION PRONUNCIATON PRONUNSIATION
  CEMETERY CEMETARY CEMMETERY SEMETERY
  PERSISTENT PERSISTANT PERSISSTENT PURSISTENT
  EXISTENCE EXISTANCE EXSISTENCE EXISTENSE
  INDEPENDENT INDEPENDANT INDEPANDENT INDIPENDENT
  CONSCIOUS CONCIOUS CONSCIUS CONSIOUS
  PRIVILEGE PRIVILEDGE PRIVELEGE PRIVILIGE
  GRAMMAR GRAMMER GRAMAR GRAMMMAR
  TRULY TRUELY TRULLY TROOLY
  ARGUMENT ARGUEMENT ARGUMANT ARGGUMENT
  POSSESS POSESS POSSESSE POSESSE
  QUEUE QEUE QUEU QUEEU
  SCISSORS SCISSERS SISSORS SCISORS
  EXAGGERATE EXAGERATE EXXAGERATE EXAGGERRATE
  BROCCOLI BROCOLLI BROCOLI BROCCOLLI
  SPAGHETTI SPAGETTI SPAGHETI SPAHGETTI
  PHARAOH PHAROAH PHARAOAH PHARIAH
  MISCHIEVOUS MISCHIEVIOUS MISCHEVIOUS MISCHIVOUS
  DILEMMA DILEMA DILLEMMA DILEMNA
  MILLENNIUM MILLENIUM MILENNIUM MILLENNIUMM
  CAMOUFLAGE CAMOFLAGE CAMOUFLAUGE CAMMOUFLAGE
  SILHOUETTE SILOUETTE SILHOUETE SILHOUTTE
  ACQUIRE AQUIRE ACQUIER AQCUIRE
  APPARENTLY APPARENTELY APPARANTLY APARENTLY
  COMMITTEE COMMITEE COMITTEE COMMMITTEE
  CURIOSITY CURIOUSITY CURIOSETY CURRIOSITY
  FLUORESCENT FLOURESCENT FLUORESENT FLUORESCANT
  HANDKERCHIEF HANKERCHIEF HANDKERCHEIF HANDKERCHIFE
  BICYCLE BICICLE BYCYCLE BICYCEL
  SURPRISE SUPRISE SURPRIZE SURPRISSE
  ISLAND ILAND ISLANDE ISSLAND
  HUMOROUS HUMORUS HUMMOROUS HUMOROUSS
`
  .trim()
  .split("\n")
  .map(list);

/**
 * Rhyme time: every word in a group rhymes with every other word in it and with
 * nothing in any other group. `traps` look as if they rhyme with the group but don't.
 */
export const RHYMES: readonly { words: readonly string[]; traps: readonly string[] }[] = [
  ["CAKE LAKE SNAKE BAKE SHAKE WAKE BRAKE STEAK", ""],
  ["MOON SPOON TUNE JUNE SOON BALLOON NOON", "DOOR"],
  ["BEE TREE KEY SEA FREE THREE TEA KNEE", ""],
  ["CAT HAT BAT MAT RAT FLAT", "WHAT"],
  ["DOG FROG LOG FOG JOG", ""],
  ["LIGHT KITE NIGHT BITE WHITE WRITE BRIGHT HEIGHT", "EIGHT WEIGHT"],
  ["BEAR CHAIR HAIR PEAR STAIR SQUARE WEAR", "HEAR NEAR CLEAR"],
  ["GOAT BOAT COAT NOTE VOTE WROTE", ""],
  ["STONE BONE PHONE CONE ALONE THRONE LOAN", "DONE GONE NONE"],
  ["RAIN TRAIN PLANE CHAIN BRAIN LANE CRANE", ""],
  ["FISH DISH WISH SWISH", ""],
  ["KING RING SING WING STRING THING SWING", ""],
  ["BED RED BREAD HEAD SLED SHED SAID", "BEAD"],
  ["SHOE BLUE TWO GLUE ZOO CREW TRUE", ""],
  ["SNOW TOE SLOW GROW THROW DOUGH", "COW HOW NOW"],
  ["CHEESE PEAS SNEEZE BREEZE FREEZE PLEASE", ""],
  ["SOCK CLOCK ROCK LOCK BLOCK KNOCK", ""],
  ["DRUM THUMB GUM PLUM CRUMB COME", "HOME"],
  ["CAR STAR JAR FAR GUITAR", "WAR"],
  ["BOOK COOK HOOK LOOK", "SPOOK"],
  ["NOSE ROSE HOSE GOES", "LOSE"],
  ["TOAST GHOST POST COAST MOST", "COST LOST"],
  ["HOUSE MOUSE", ""],
  ["FLOWER POWER TOWER SHOWER HOUR", "LOWER"],
].map(([words, traps]) => ({ words: list(words), traps: traps ? list(traps) : [] }));

/** Odd word out: "Which is NOT {ask}?" Every member clearly is; every impostor clearly isn't. */
export const CATEGORIES: readonly { ask: string; members: readonly string[]; impostors: readonly string[]; hard?: boolean }[] = [
  {
    ask: "a fruit",
    members: ["🍎 Apple", "🍌 Banana", "🍇 Grapes", "🍓 Strawberry", "🍒 Cherry", "🍍 Pineapple", "🍑 Peach", "🍋 Lemon", "🍉 Melon", "🍐 Pear"],
    impostors: ["🥕 Carrot", "🥦 Broccoli", "🥔 Potato", "🧅 Onion", "🧄 Garlic"],
  },
  {
    ask: "a vegetable",
    members: ["🥕 Carrot", "🥦 Broccoli", "🥔 Potato", "🧅 Onion", "🧄 Garlic", "🥬 Lettuce", "🥒 Cucumber"],
    impostors: ["🍓 Strawberry", "🍌 Banana", "🍇 Grapes", "🍒 Cherry"],
  },
  {
    ask: "an animal",
    members: ["🐶 Dog", "🐱 Cat", "🐘 Elephant", "🦒 Giraffe", "🐸 Frog", "🦁 Lion", "🐰 Rabbit", "🐻 Bear"],
    impostors: ["🌵 Cactus", "🍄 Mushroom", "🚗 Car", "🎈 Balloon", "🌻 Sunflower"],
  },
  {
    ask: "a vehicle",
    members: ["🚗 Car", "🚌 Bus", "🚲 Bike", "🚂 Train", "✈️ Plane", "🚁 Helicopter", "⛵ Boat", "🚜 Tractor"],
    impostors: ["🏠 House", "🌳 Tree", "🎸 Guitar", "🐴 Horse"],
  },
  {
    ask: "a musical instrument",
    members: ["🎸 Guitar", "🎺 Trumpet", "🎻 Violin", "🥁 Drum", "🎹 Piano", "🎷 Saxophone"],
    impostors: ["🎧 Headphones", "📻 Radio", "🎤 Microphone", "📺 TV"],
  },
  {
    ask: "cold",
    members: ["❄️ Snow", "🧊 Ice", "⛄ Snowman", "🍦 Ice cream"],
    impostors: ["🔥 Fire", "☀️ Sun", "🌶️ Chilli", "☕ Hot coffee", "🌋 Volcano"],
  },
  {
    ask: "found in the sea",
    members: ["🐟 Fish", "🐙 Octopus", "🦀 Crab", "🐬 Dolphin", "🦑 Squid", "🦐 Shrimp", "🐡 Blowfish", "🐚 Shell"],
    impostors: ["🐫 Camel", "🦒 Giraffe", "🐿️ Squirrel", "🦔 Hedgehog"],
  },
  {
    ask: "a ball sport",
    members: ["⚽ Football", "🏀 Basketball", "🎾 Tennis", "🏐 Volleyball", "⚾ Baseball", "🏉 Rugby"],
    impostors: ["🏊 Swimming", "⛸️ Skating", "🥊 Boxing", "🏹 Archery"],
  },
  {
    ask: "a mammal",
    members: ["🐬 Dolphin", "🦇 Bat", "🐳 Whale", "🐘 Elephant", "🐭 Mouse", "🐵 Monkey", "🦘 Kangaroo"],
    impostors: ["🦈 Shark", "🐢 Turtle", "🐧 Penguin", "🐊 Crocodile", "🐸 Frog", "🐍 Snake"],
    hard: true,
  },
  {
    ask: "a bird",
    members: ["🐧 Penguin", "🦉 Owl", "🦆 Duck", "🦅 Eagle", "🐔 Chicken", "🦜 Parrot", "🦢 Swan", "🦩 Flamingo"],
    impostors: ["🦇 Bat", "🦋 Butterfly", "🐝 Bee", "🐞 Ladybird"],
    hard: true,
  },
  {
    ask: "an insect",
    members: ["🐝 Bee", "🐞 Ladybird", "🦋 Butterfly", "🐜 Ant", "🦗 Cricket"],
    impostors: ["🕷️ Spider", "🐌 Snail", "🦂 Scorpion"],
    hard: true,
  },
];

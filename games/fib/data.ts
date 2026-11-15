// Fib Finder facts. SERVER ONLY: never import this from the client (answers would ship to browsers).
//
// Every fact is strange but true. Rules for adding one:
// - Only facts that are well documented and not disputed or time-sensitive.
// - The prompt has exactly one "____" and the answer is 1-3 words.
// - `alts` lists other answers that are also true, so nobody can submit a true "fib".
// - `decoys` are three plausible but definitely false answers, used when there are too few fibs.

export interface Fact {
  prompt: string;
  answer: string;
  alts?: string[];
  decoys: [string, string, string];
}

export const FACTS: Fact[] = [
  // ---------- animals ----------
  {
    prompt: "A group of flamingos is called a ____.",
    answer: "flamboyance",
    alts: ["stand", "flock", "colony"],
    decoys: ["fiesta", "tutu", "blush"],
  },
  {
    prompt: "A group of crows is called a ____.",
    answer: "murder",
    alts: ["flock", "horde", "hover", "muster", "parcel"],
    decoys: ["jury", "gloom", "heist"],
  },
  {
    prompt: "A group of owls is called a ____.",
    answer: "parliament",
    alts: ["stare", "flock"],
    decoys: ["senate", "library", "seminar"],
  },
  {
    prompt: "A baby puffin is called a ____.",
    answer: "puffling",
    decoys: ["pufflet", "puffkin", "chickling"],
  },
  {
    prompt: "A baby echidna is called a ____.",
    answer: "puggle",
    decoys: ["spikelet", "nubbin", "pricklet"],
  },
  {
    prompt: "A baby hedgehog is called a ____.",
    answer: "hoglet",
    decoys: ["urchling", "hedgling", "spiny"],
  },
  {
    prompt: "Wombats produce poop shaped like ____.",
    answer: "cubes",
    alts: ["cube", "dice", "squares", "boxes", "blocks", "cubed"],
    decoys: ["stars", "spirals", "pyramids"],
  },
  {
    prompt: "An octopus has ____ hearts.",
    answer: "three",
    alts: ["3"],
    decoys: ["two", "five", "nine"],
  },
  {
    prompt: "Octopuses have ____ blood.",
    answer: "blue",
    alts: ["bluish", "blueish", "blue-coloured", "blue-colored"],
    decoys: ["green", "purple", "black"],
  },
  {
    prompt: "Some turtles can breathe through their ____ while underwater.",
    answer: "butts",
    alts: [
      "bum", "bottom", "behind", "rear", "rear end", "backside", "cloaca", "cloacae",
      "tail end", "rump", "anus", "booty", "skin", "throat",
    ],
    decoys: ["shells", "eyes", "ears"],
  },
  {
    prompt: "Under all that fur, a polar bear’s skin is ____.",
    answer: "black",
    alts: ["dark", "jet black", "dark grey", "dark gray", "blackish"],
    decoys: ["pink", "white", "blue"],
  },
  {
    prompt: "Cats can’t taste ____ flavours.",
    answer: "sweet",
    alts: ["sweetness", "sugary", "sugar", "sweets"],
    decoys: ["bitter", "sour", "meaty"],
  },
  {
    prompt: "Butterflies taste with their ____.",
    answer: "feet",
    alts: ["foot", "legs", "toes", "proboscis", "tongues"],
    decoys: ["wings", "eyes", "tails"],
  },
  {
    prompt: "An ostrich’s eye is bigger than its ____.",
    answer: "brain",
    decoys: ["heart", "stomach", "beak"],
  },
  {
    prompt: "Owls can’t move their ____.",
    answer: "eyes",
    alts: ["eyeballs", "ears"],
    decoys: ["beaks", "wings", "tongues"],
  },
  {
    prompt: "A woodpecker’s ____ is so long that it wraps around the back of its skull.",
    answer: "tongue",
    alts: ["hyoid", "hyoid bone", "tongue bone"],
    decoys: ["beak", "neck", "spine"],
  },
  {
    prompt: "Dolphins sleep with half of their ____ awake.",
    answer: "brain",
    decoys: ["pod", "body", "heart"],
  },
  {
    prompt: "A narwhal’s tusk is actually a giant ____.",
    answer: "tooth",
    alts: ["teeth", "canine", "canine tooth", "fang"],
    decoys: ["horn", "nose", "bone"],
  },
  {
    prompt: "The platypus has no ____: its gullet joins straight onto its intestine.",
    answer: "stomach",
    alts: ["tummy", "belly"],
    decoys: ["liver", "tongue", "heart"],
  },
  {
    prompt: "Male platypuses have a venomous ____ on each back leg.",
    answer: "spur",
    alts: ["ankle spur", "heel spur", "spike", "spine"],
    decoys: ["claw", "fang", "quill"],
  },
  {
    prompt: "Reindeer eyes change colour from gold in summer to ____ in winter.",
    answer: "blue",
    alts: ["deep blue", "dark blue", "bluish"],
    decoys: ["red", "green", "silver"],
  },
  {
    prompt: "Sloths move so slowly that ____ grows in their fur.",
    answer: "algae",
    alts: ["alga", "green algae", "fungus", "fungi"],
    decoys: ["grass", "ivy", "clover"],
  },
  {
    prompt: "Microscopic animals called tardigrades have survived being sent into ____ with no protection.",
    answer: "space",
    alts: ["outer space", "open space", "orbit", "earth orbit", "low earth orbit", "the vacuum of space", "vacuum"],
    decoys: ["a volcano", "the sun", "molten lava"],
  },
  {
    prompt: "The “immortal jellyfish” can turn itself back into a ____ and start its life cycle again.",
    answer: "polyp",
    alts: ["polyp stage"],
    decoys: ["egg", "tadpole", "seed"],
  },
  {
    prompt: "____ can’t feel the burn of chilli peppers, so they happily eat them and spread the seeds.",
    answer: "birds",
    decoys: ["squirrels", "mice", "goats"],
  },
  {
    prompt: "In seahorses, it’s the ____ that get pregnant and give birth.",
    answer: "males",
    alts: ["dads", "fathers", "boys", "men", "boy seahorses"],
    decoys: ["eldest", "grandmothers", "queens"],
  },
  {
    prompt: "Giraffes have ____ bones in their necks, the same number as humans.",
    answer: "seven",
    alts: ["7"],
    decoys: ["twelve", "twenty", "forty"],
  },
  {
    prompt: "A rhino’s horn is made of ____, the same stuff as your fingernails.",
    answer: "keratin",
    decoys: ["ivory", "bone", "collagen"],
  },
  {
    prompt: "Koala fingerprints are so like ____ fingerprints that they could confuse a crime scene investigation.",
    answer: "human",
    alts: ["people", "person", "human being", "chimp", "chimpanzee", "gorilla", "ape", "primate"],
    decoys: ["dog", "panda", "kangaroo"],
  },
  {
    prompt: "Goats have ____ pupils.",
    answer: "rectangular",
    alts: [
      "rectangle", "rectangle-shaped", "horizontal", "oblong", "square", "slit", "horizontal slit",
      "letterbox", "box-shaped", "rectangular-shaped",
    ],
    decoys: ["star-shaped", "heart-shaped", "triangular"],
  },
  {
    prompt: "The official national animal of Scotland is the ____.",
    answer: "unicorn",
    decoys: ["stag", "otter", "highland cow"],
  },
  {
    prompt: "In 1932, Australia’s army went to war against ____, and the birds won.",
    answer: "emus",
    decoys: ["pelicans", "cockatoos", "seagulls"],
  },

  // ---------- food & plants ----------
  {
    prompt: "Botanically speaking, a banana is a ____.",
    answer: "berry",
    alts: ["fruit", "herb"],
    decoys: ["nut", "legume", "seed pod"],
  },
  {
    prompt: "Peanuts aren’t really nuts. They’re ____.",
    answer: "legumes",
    alts: ["beans", "pulses", "seeds", "peas"],
    decoys: ["tubers", "grains", "roots"],
  },
  {
    prompt: "Before it became a toy, Play-Doh was sold as a ____ cleaner.",
    answer: "wallpaper",
    alts: ["wall paper", "wall", "walls"],
    decoys: ["window", "carpet", "oven"],
  },
  {
    prompt: "Before rubber erasers, people rubbed out pencil marks with ____.",
    answer: "bread",
    alts: ["breadcrumbs", "bread crumbs", "stale bread", "crumbs", "bread crusts", "wax", "pumice", "sandstone"],
    decoys: ["cheese", "butter", "chalk"],
  },
  {
    prompt: "In the 1830s, tomato ketchup was sold as a ____.",
    answer: "medicine",
    alts: ["medication", "remedy", "cure", "pill", "tonic", "health tonic", "cure-all", "treatment", "medical cure"],
    decoys: ["hair dye", "paint", "perfume"],
  },
  {
    prompt: "Hawaiian pizza was invented in ____.",
    answer: "Canada",
    alts: ["ontario", "chatham"],
    decoys: ["Hawaii", "Australia", "Sweden"],
  },
  {
    prompt: "Caesar salad was invented in ____.",
    answer: "Mexico",
    alts: ["tijuana"],
    decoys: ["Italy", "Greece", "Spain"],
  },
  {
    prompt: "German chocolate cake is named after a man called Samuel ____.",
    answer: "German",
    decoys: ["Black", "Schwartz", "Hershey"],
  },
  {
    prompt: "In Denmark, Danish pastries are called “____ bread”.",
    answer: "Viennese",
    alts: ["vienna", "austrian"],
    decoys: ["Copenhagen", "Swedish", "French"],
  },
  {
    prompt: "Stored in big enough piles, pistachios can spontaneously ____.",
    answer: "combust",
    alts: [
      "catch fire", "ignite", "burst into flames", "burst into flame", "self-ignite", "burn", "catch on fire",
      "go on fire", "self-combust", "set alight", "set on fire", "start a fire", "start fires", "overheat",
      "heat up", "combustion",
    ],
    decoys: ["melt", "glow", "freeze"],
  },
  {
    prompt: "Every cashew nut grows hanging from the bottom of a fruit called the cashew ____.",
    answer: "apple",
    alts: ["fruit"],
    decoys: ["pear", "plum", "fig"],
  },
  {
    prompt: "Fresh pineapple contains an enzyme that breaks down ____.",
    answer: "protein",
    alts: [
      "meat", "flesh", "tongue", "skin", "mouth", "your mouth", "your tongue", "tissue", "collagen", "gelatin",
      "gelatine", "jelly", "jello", "muscle", "steak",
    ],
    decoys: ["sugar", "fat", "starch"],
  },
  {
    prompt: "Apples, pears and strawberries all belong to the ____ family.",
    answer: "rose",
    alts: ["rosaceae"],
    decoys: ["lily", "daisy", "orchid"],
  },
  {
    prompt: "Vanilla comes from the pod of a kind of ____.",
    answer: "orchid",
    alts: ["orchid flower", "vanilla orchid", "flower", "flowering plant", "vine", "climbing orchid"],
    decoys: ["lily", "palm tree", "cactus"],
  },
  {
    prompt: "The “seeds” on the outside of a strawberry are actually tiny ____.",
    answer: "fruits",
    alts: ["achenes", "ovaries"],
    decoys: ["flowers", "leaves", "thorns"],
  },
  {
    prompt: "Most “wasabi” served outside Japan is mainly ____.",
    answer: "horseradish",
    alts: ["horse radish", "dyed horseradish", "horseradish paste", "horseradish and mustard", "mustard"],
    decoys: ["avocado", "seaweed", "matcha"],
  },
  {
    prompt: "Twinkies originally had a ____ cream filling.",
    answer: "banana",
    decoys: ["strawberry", "lemon", "maple"],
  },
  {
    prompt: "“Mountain Dew” was originally slang for ____.",
    answer: "moonshine",
    alts: [
      "whiskey", "whisky", "homemade whiskey", "homemade whisky", "liquor", "hooch", "bootleg whiskey", "booze",
      "alcohol", "corn liquor", "homemade liquor", "illegal whiskey", "illegal alcohol", "bootleg liquor",
      "spirits", "poitin", "poteen",
    ],
    decoys: ["morning fog", "lemonade", "rainwater"],
  },
  {
    prompt: "7 Up once contained ____, a drug now used as a mood stabiliser.",
    answer: "lithium",
    alts: ["lithium citrate"],
    decoys: ["opium", "melatonin", "valerian"],
  },
  {
    prompt: "Fanta was created in ____ during World War II, when Coca-Cola syrup couldn’t be imported.",
    answer: "Germany",
    alts: ["nazi germany", "essen"],
    decoys: ["Italy", "Mexico", "Brazil"],
  },
  {
    prompt: "The Snickers bar was named after the Mars family’s favourite ____.",
    answer: "horse",
    alts: ["racehorse", "race horse", "pony"],
    decoys: ["dog", "uncle", "parrot"],
  },
  {
    prompt: "Cotton candy was co-invented by a ____.",
    answer: "dentist",
    alts: ["candy maker", "candymaker", "confectioner", "sweet maker"],
    decoys: ["baker", "pharmacist", "farmer"],
  },
  {
    prompt: "The Popsicle was invented by accident by a boy aged ____.",
    answer: "eleven",
    alts: ["11"],
    decoys: ["seven", "fourteen", "nine"],
  },
  {
    prompt: "The microwave oven was invented after a radar engineer noticed a ____ had melted in his pocket.",
    answer: "candy bar",
    alts: [
      "chocolate bar", "chocolate", "candy", "peanut bar", "peanut cluster bar", "peanut cluster", "sweet",
      "sweets", "candybar", "choc bar", "snack bar",
    ],
    decoys: ["crayon", "lipstick", "candle"],
  },

  // ---------- companies, toys & inventions ----------
  {
    prompt: "Nintendo was founded in 1889 to make ____.",
    answer: "playing cards",
    alts: ["cards", "hanafuda", "hanafuda cards", "card games", "flower cards", "trading cards", "games"],
    decoys: ["umbrellas", "fireworks", "sake"],
  },
  {
    prompt: "Nokia began in 1865 as a ____ mill.",
    answer: "paper",
    alts: ["pulp", "paper pulp", "wood pulp", "wood", "groundwood pulp", "pulp and paper"],
    decoys: ["flour", "steel", "cotton"],
  },
  {
    prompt: "Google’s original name was ____.",
    answer: "BackRub",
    decoys: ["PageRank", "WebCrawler", "Searchly"],
  },
  {
    prompt: "Before it was Amazon, Jeff Bezos’s company was called ____.",
    answer: "Cadabra",
    alts: ["cadabra inc", "relentless"],
    decoys: ["Bookworm", "Riverbooks", "Bookstack"],
  },
  {
    prompt: "Pepsi was first sold under the name “____”.",
    answer: "Brad's Drink",
    alts: ["brad drink", "brads", "brad"],
    decoys: ["Pep Tonic", "Cola Royale", "Fizzwater"],
  },
  {
    prompt: "The first item ever sold on eBay was a broken ____.",
    answer: "laser pointer",
    alts: ["laser", "laser pen"],
    decoys: ["toaster", "typewriter", "calculator"],
  },
  {
    prompt: "The world’s first webcam was pointed at a ____ in a Cambridge University computer lab.",
    answer: "coffee pot",
    alts: ["coffee machine", "coffee maker", "coffee", "coffee percolator", "coffee jug", "coffee filter machine"],
    decoys: ["fish tank", "printer", "door"],
  },
  {
    prompt: "The first product ever scanned with a barcode was a pack of ____.",
    answer: "chewing gum",
    alts: ["gum", "juicy fruit", "juicy fruit gum", "wrigleys", "wrigleys gum", "bubble gum", "bubblegum"],
    decoys: ["cigarettes", "batteries", "cereal"],
  },
  {
    prompt: "The first ever ____ was sent in 1992 and said “Merry Christmas”.",
    answer: "text message",
    alts: ["text", "sms", "sms message", "txt", "sms text", "mobile text"],
    decoys: ["email", "tweet", "fax"],
  },
  {
    prompt: "The first video ever uploaded to YouTube was filmed at a ____.",
    answer: "zoo",
    alts: ["san diego zoo"],
    decoys: ["beach", "skate park", "birthday party"],
  },
  {
    prompt: "In 1947, engineers found a real ____ stuck inside the Harvard Mark II computer.",
    answer: "moth",
    alts: ["bug", "insect"],
    decoys: ["spider", "cockroach", "beetle"],
  },
  {
    prompt: "Velcro was invented after an engineer noticed burrs stuck to his ____’s fur.",
    answer: "dog",
    alts: ["pet dog", "puppy", "hound", "pooch"],
    decoys: ["cat", "horse", "goat"],
  },
  {
    prompt: "The Q in Q-tips stands for ____.",
    answer: "quality",
    decoys: ["quick", "queen", "quilted"],
  },
  {
    prompt: "The two Ms in M&M’s stand for Mars and ____.",
    answer: "Murrie",
    alts: ["bruce murrie"],
    decoys: ["Milky", "Morgan", "Milton"],
  },
  {
    prompt: "WD-40 stands for “Water Displacement, 40th ____”.",
    answer: "formula",
    alts: ["attempt", "try", "formulation", "go", "recipe", "experiment"],
    decoys: ["anniversary", "edition", "street"],
  },
  {
    prompt: "The man who designed the Pringles can had some of his ashes buried in a ____.",
    answer: "Pringles can",
    alts: [
      "pringles tube", "pringles canister", "pringles container", "pringle can", "can of pringles", "pringles",
      "pringles box", "pringle tube", "pringles tin", "can", "tube", "canister", "chip can", "crisp tube",
    ],
    decoys: ["time capsule", "potato field", "crisp packet"],
  },
  {
    prompt: "Ed Headrick, the “father of disc golf”, had his ashes moulded into ____.",
    answer: "frisbees",
    alts: ["flying discs", "discs", "golf discs", "disc golf discs", "memorial discs"],
    decoys: ["golf balls", "bowling balls", "trophies"],
  },
  {
    prompt: "Mr. Potato Head was the first toy ever advertised on ____.",
    answer: "television",
    alts: ["tv", "telly", "tele", "tv commercials", "tv ads", "television ads"],
    decoys: ["radio", "billboards", "the internet"],
  },
  {
    prompt: "Barbie’s full name is Barbara Millicent ____.",
    answer: "Roberts",
    decoys: ["Hamilton", "Carson", "Mattel"],
  },
  {
    prompt: "Pac-Man’s creator says the character was partly inspired by a ____ with a slice missing.",
    answer: "pizza",
    alts: ["pizza pie"],
    decoys: ["cake", "cheese wheel", "watermelon"],
  },
  {
    prompt: "Mario’s original name was ____.",
    answer: "Jumpman",
    alts: ["jump man", "mr video"],
    decoys: ["Plumberman", "Hopper", "Mr. Hammer"],
  },
  {
    prompt: "Monopoly grew out of “The ____ Game”, designed in 1903 to show the evils of land monopolies.",
    answer: "Landlord's",
    alts: ["landlord"],
    decoys: ["Banker's", "Tycoon's", "Merchant's"],
  },
  {
    prompt: "Scrabble was originally called ____.",
    answer: "Lexiko",
    alts: ["lexico", "criss-crosswords", "criss crosswords", "criss cross words", "criss-cross"],
    decoys: ["Wordplay", "Letterbox", "Tilecraft"],
  },
  {
    prompt: "Nachos are named after a man called ____.",
    answer: "Ignacio",
    alts: ["nacho", "ignacio anaya", "nacho anaya", "anaya"],
    decoys: ["Nathan", "Pancho", "Nicolás"],
  },
  {
    prompt: "Sideburns are named after an American Civil War general called Ambrose ____.",
    answer: "Burnside",
    decoys: ["Sideman", "Custer", "Sherman"],
  },
  {
    prompt: "The leotard is named after Jules Léotard, a French ____.",
    answer: "acrobat",
    alts: [
      "trapeze artist", "aerialist", "gymnast", "circus performer", "trapezist", "circus acrobat",
      "trapeze performer", "performer", "circus artist", "trapeze acrobat", "aerial acrobat", "trapeze",
    ],
    decoys: ["ballet dancer", "tailor", "wrestler"],
  },

  // ---------- words ----------
  {
    prompt: "The word “robot” comes from a Czech word meaning ____.",
    answer: "forced labour",
    alts: [
      "forced labor", "labour", "labor", "work", "drudgery", "servitude", "forced work", "slave", "slavery",
      "slave labour", "slave labor", "serf labour", "serf labor", "hard work", "toil", "servant", "worker",
      "compulsory labour", "compulsory labor", "serfdom",
    ],
    decoys: ["metal man", "machine", "puppet"],
  },
  {
    prompt: "“Quarantine” comes from the Italian for “____ days”.",
    answer: "forty",
    alts: ["40"],
    decoys: ["fourteen", "ten", "thirty"],
  },
  {
    prompt: "The word “muscle” comes from the Latin for “little ____”.",
    answer: "mouse",
    alts: ["mice"],
    decoys: ["snake", "rope", "fish"],
  },
  {
    prompt: "The word “salary” comes from the Latin word for ____.",
    answer: "salt",
    decoys: ["silver", "bread", "gold"],
  },
  {
    prompt: "“Disaster” literally means “bad ____”.",
    answer: "star",
    alts: ["star sign"],
    decoys: ["luck", "omen", "weather"],
  },
  {
    prompt: "The word “clue” comes from “clew”, meaning a ball of ____.",
    answer: "thread",
    alts: ["yarn", "string", "twine", "wool", "cord"],
    decoys: ["wax", "clay", "dough"],
  },
  {
    prompt: "“Goodbye” is a shortened form of “God be with ____”.",
    answer: "you",
    alts: ["ye", "thee", "u", "yee"],
    decoys: ["thy soul", "us all", "the king"],
  },
  {
    prompt: "“Nickname” comes from the old phrase “an ____name”, meaning an extra name.",
    answer: "eke",
    alts: ["ekename"],
    decoys: ["nick", "ick", "neck"],
  },
  {
    prompt: "“OK” started in 1839 as a jokey abbreviation of “oll ____”.",
    answer: "korrect",
    alts: ["korect", "correct", "korekt"],
    decoys: ["kool", "kwik", "klear"],
  },
  {
    prompt: "The word “nerd” first appeared in print in a 1950 book by ____.",
    answer: "Dr. Seuss",
    alts: ["seuss", "theodor geisel", "theodor seuss geisel", "doctor seuss", "geisel", "ted geisel"],
    decoys: ["Roald Dahl", "Ray Bradbury", "Isaac Asimov"],
  },
  {
    prompt: "The punctuation mark ‽, a question mark fused with an exclamation mark, is called an ____.",
    answer: "interrobang",
    alts: ["interabang"],
    decoys: ["exclamaquest", "quexclaim", "surprisemark"],
  },
  {
    prompt: "The dot over a lowercase i is called a ____.",
    answer: "tittle",
    alts: ["superscript dot"],
    decoys: ["dib", "nib", "pip"],
  },
  {
    prompt: "The little plastic tip on the end of a shoelace is called an ____.",
    answer: "aglet",
    alts: ["aiglet"],
    decoys: ["eyelet", "ortlet", "tippet"],
  },
  {
    prompt: "The groove between your nose and your upper lip is called the ____.",
    answer: "philtrum",
    alts: ["philtra", "infranasal depression", "medial cleft"],
    decoys: ["glabella", "septum", "uvula"],
  },
  {
    prompt: "The pale crescent at the base of a fingernail is called the ____.",
    answer: "lunula",
    alts: ["lunulae", "lunule", "half-moon", "moon"],
    decoys: ["cuticle", "nail bed", "quick"],
  },
  {
    prompt: "Petrichor is the name for the smell of ____.",
    answer: "rain",
    alts: [
      "rain on dry earth", "rain on dry ground", "after rain", "wet earth", "wet soil", "rainfall", "rain on soil",
      "wet ground", "fresh rain", "rainy weather", "earth after rain", "first rain", "dirt after rain", "wet dirt",
      "rain on dirt", "rainwater",
    ],
    decoys: ["cut grass", "old books", "the sea"],
  },
  {
    prompt: "In Italian, the @ symbol is called “chiocciola”, which means ____.",
    answer: "snail",
    alts: ["little snail", "snail shell"],
    decoys: ["little ear", "curl", "whirlpool"],
  },

  // ---------- places, history & space ----------
  {
    prompt: "The Statue of Liberty’s official name is “Liberty Enlightening the ____”.",
    answer: "World",
    decoys: ["Nations", "Harbor", "People"],
  },
  {
    prompt: "The Eiffel Tower was only meant to stand for ____ years.",
    answer: "twenty",
    alts: ["20"],
    decoys: ["five", "fifty", "one hundred"],
  },
  {
    prompt: "The Eiffel Tower grows several centimetres taller in ____.",
    answer: "summer",
    alts: [
      "the summer", "summertime", "hot weather", "the heat", "heat", "heatwaves", "heat waves", "a heatwave",
      "warm weather", "the sun", "sunshine", "july", "august", "hot days", "hot summers",
    ],
    decoys: ["winter", "the rain", "a storm"],
  },
  {
    prompt: "Mount Rushmore was originally meant to show the presidents down to their ____.",
    answer: "waists",
    alts: ["waistlines", "belts", "torsos", "hips", "bellies", "belly buttons", "navels", "midriffs"],
    decoys: ["knees", "shoes", "ankles"],
  },
  {
    prompt: "Because its islands cross the 180° line, Alaska is the westernmost, northernmost and ____ US state.",
    answer: "easternmost",
    alts: ["eastern-most", "most eastern", "eastmost", "furthest east", "farthest east"],
    decoys: ["southernmost", "smallest", "flattest"],
  },
  {
    prompt: "Uzbekistan and ____ are the only countries surrounded entirely by other landlocked countries.",
    answer: "Liechtenstein",
    alts: ["lichtenstein", "liechtenstien", "lichtenstien"],
    decoys: ["Switzerland", "Andorra", "Austria"],
  },
  {
    prompt: "There’s a village in Norway called ____, and in winter it really does freeze over.",
    answer: "Hell",
    decoys: ["Hades", "Mordor", "Narnia"],
  },
  {
    prompt: "Australia is wider than the ____.",
    answer: "Moon",
    alts: ["moon's diameter", "pluto", "europa", "io", "triton", "ceres", "charon", "eris"],
    decoys: ["Sahara", "Pacific", "Earth"],
  },
  {
    prompt: "Pluto was named by an 11-year-old girl from ____, England.",
    answer: "Oxford",
    decoys: ["Cambridge", "Bristol", "York"],
  },
  {
    prompt: "On Venus, the Sun rises in the ____.",
    answer: "west",
    alts: ["westward"],
    decoys: ["east", "north", "south"],
  },
  {
    prompt: "Saturn is so light for its size that it would ____ in a giant bathtub.",
    answer: "float",
    alts: ["float on top", "bob", "stay afloat", "bob up and down", "drift"],
    decoys: ["sink", "dissolve", "fizz"],
  },
  {
    prompt: "Sunsets on Mars look ____.",
    answer: "blue",
    alts: ["bluish", "blueish", "blue-grey", "blue-gray", "light blue", "pale blue"],
    decoys: ["green", "purple", "red"],
  },
  {
    prompt: "Earth is the only planet in our solar system not named after a ____.",
    answer: "god",
    alts: [
      "deity", "god or goddess", "goddess", "roman god", "greek god", "mythological god", "mythological figure",
      "myth", "divinity", "mythical god", "roman deity",
    ],
    decoys: ["number", "king", "star"],
  },
  {
    prompt: "In 1977, a radio telescope picked up a mysterious signal now known as the “____!” signal.",
    answer: "Wow",
    alts: ["wow signal"],
    decoys: ["Hey", "Hello", "Eureka"],
  },
  {
    prompt: "The first animals sent into space, in 1947, were ____.",
    answer: "fruit flies",
    alts: ["flies", "fruitflies", "insects", "drosophila"],
    decoys: ["mice", "monkeys", "frogs"],
  },
  {
    prompt: "In 1971, astronaut Alan Shepard played ____ on the Moon.",
    answer: "golf",
    alts: ["golf shots"],
    decoys: ["tennis", "baseball", "cricket"],
  },
  {
    prompt: "In 1896, Britain fought a war against ____ that lasted under an hour.",
    answer: "Zanzibar",
    alts: ["sultanate of zanzibar"],
    decoys: ["Portugal", "Tonga", "Siam"],
  },
  {
    prompt: "The Hundred Years’ War actually lasted ____ years.",
    answer: "116",
    alts: ["one hundred sixteen", "one hundred and sixteen", "hundred sixteen", "hundred and sixteen"],
    decoys: ["99", "100", "124"],
  },
  {
    prompt: "In 1919, a huge wave of ____ flooded the streets of Boston.",
    answer: "molasses",
    alts: ["treacle", "syrup", "black treacle", "sugar syrup"],
    decoys: ["beer", "maple syrup", "milk"],
  },
  {
    prompt: "In 1814, a flood of ____ killed eight people in London.",
    answer: "beer",
    alts: ["porter", "ale", "porter beer"],
    decoys: ["gin", "milk", "tea"],
  },
  {
    prompt: "In 1518, a “dancing ____” broke out in Strasbourg, with people dancing for days.",
    answer: "plague",
    alts: ["mania", "epidemic", "craze", "fever", "frenzy"],
    decoys: ["festival", "contest", "riot"],
  },
  {
    prompt: "In 1923, jockey Frank Hayes won a horse race despite being ____.",
    answer: "dead",
    alts: ["deceased", "already dead", "dead in the saddle"],
    decoys: ["blindfolded", "asleep", "eleven years old"],
  },
  {
    prompt: "Park ranger Roy Sullivan survived being struck by lightning ____ times.",
    answer: "seven",
    alts: ["7"],
    decoys: ["four", "twelve", "three"],
  },
  {
    prompt: "Woolly mammoths were still alive when the Great ____ of Giza was built.",
    answer: "Pyramid",
    alts: ["sphinx", "great pyramid"],
    decoys: ["Library", "Lighthouse", "Colossus"],
  },
  {
    prompt: "In 1992, Abraham Lincoln was honoured by the National ____ Hall of Fame.",
    answer: "Wrestling",
    decoys: ["Boxing", "Chess", "Bowling"],
  },
  {
    prompt: "In 1952, Albert Einstein was offered the job of President of ____.",
    answer: "Israel",
    decoys: ["Germany", "Switzerland", "Austria"],
  },
  {
    prompt: "Marie Curie’s notebooks are still so ____ that they are kept in lead-lined boxes.",
    answer: "radioactive",
    alts: ["contaminated", "irradiated", "hot", "dangerous", "toxic", "deadly", "radiated", "harmful"],
    decoys: ["magnetic", "secret", "sticky"],
  },
  {
    prompt: "Cleopatra came from a royal family that was ____ in origin.",
    answer: "Greek",
    alts: ["macedonian", "macedonian greek", "ptolemaic", "hellenistic", "greek macedonian", "hellenic"],
    decoys: ["Roman", "Persian", "Phoenician"],
  },
  {
    prompt: "Athletes at the ancient Olympic Games usually competed completely ____.",
    answer: "naked",
    alts: ["nude", "in the nude", "unclothed", "without clothes", "in the buff", "barefoot", "nakey"],
    decoys: ["blindfolded", "masked", "silent"],
  },
  {
    prompt: "From 1912 to 1948, Olympic medals were awarded for painting, sculpture, music, literature and ____.",
    answer: "architecture",
    alts: ["architectural design", "town planning", "buildings", "building design"],
    decoys: ["dance", "photography", "cooking"],
  },
  {
    prompt: "In medieval timekeeping, a “moment” lasted about ____.",
    answer: "ninety seconds",
    alts: [
      "90 seconds", "a minute and a half", "one and a half minutes", "1.5 minutes", "1 and a half minutes",
      "one minute thirty", "1 minute 30 seconds", "90 secs", "90",
    ],
    decoys: ["one second", "ten minutes", "one hour"],
  },

  // ---------- the human body ----------
  {
    prompt: "The ____ is the only bone in the human body not attached to any other bone.",
    answer: "hyoid",
    alts: ["hyoid bone", "tongue bone", "lingual bone"],
    decoys: ["kneecap", "tailbone", "collarbone"],
  },
  {
    prompt: "The cornea of your eye has no ____, so it takes its oxygen straight from the air.",
    answer: "blood vessels",
    alts: ["blood", "blood supply", "veins", "arteries", "capillaries", "vessels"],
    decoys: ["nerves", "cells", "water"],
  },
  {
    prompt: "Because they’re rich in potassium, bananas give off a tiny amount of ____.",
    answer: "radiation",
    alts: ["radioactivity", "gamma rays", "gamma radiation", "beta radiation"],
    decoys: ["electricity", "magnetism", "static"],
  },
];

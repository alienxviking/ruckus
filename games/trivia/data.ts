// Trivia Rush question bank (server-only: never import this from client code).
//
// Every question is original and sticks to stable, well-established facts:
// nothing that depends on "current" records, rankings, populations or versions.
// Choices are written correct-first (answer: 0); the game shuffles them per game
// and tracks the correct position on the server only.

import type { Category, Difficulty } from "./shared";

export interface Question {
  q: string;
  choices: [string, string, string, string];
  answer: number;
  cat: Category;
  diff: Difficulty;
}

function q(cat: Category, diff: Difficulty, text: string, right: string, w1: string, w2: string, w3: string): Question {
  return { q: text, choices: [right, w1, w2, w3], answer: 0, cat, diff };
}

const SCI = "Science";
const SPA = "Space";
const GEO = "Geography";
const HIS = "History";
const NAT = "Nature & Animals";
const FOO = "Food & Drink";
const SPO = "Sports";
const TEC = "Technology";
const LAN = "Language & Words";
const ART = "Art & Music";
const MAT = "Maths & Logic";
const FIL = "Film & Books";

export const QUESTIONS: readonly Question[] = [
  // ── Science ──
  q(SCI, "easy", "What is the chemical symbol for gold?", "Au", "Ag", "Gd", "Go"),
  q(SCI, "easy", "Which gas do plants take in from the air to make their food?", "Carbon dioxide", "Oxygen", "Nitrogen", "Helium"),
  q(SCI, "easy", "Which element has the atomic number 1?", "Hydrogen", "Helium", "Oxygen", "Carbon"),
  q(SCI, "easy", "What force pulls objects towards the centre of the Earth?", "Gravity", "Magnetism", "Friction", "Static electricity"),
  q(SCI, "easy", "Which organ pumps blood around the human body?", "The heart", "The liver", "The lungs", "The kidneys"),
  q(SCI, "medium", "Which gas makes up most of Earth's atmosphere?", "Nitrogen", "Oxygen", "Carbon dioxide", "Argon"),
  q(SCI, "medium", "Which mineral sits at 10, the top of the Mohs hardness scale?", "Diamond", "Quartz", "Topaz", "Corundum"),
  q(SCI, "medium", "Which blood cells carry oxygen around the body?", "Red blood cells", "White blood cells", "Platelets", "Nerve cells"),
  q(SCI, "medium", "Which vitamin does your skin make when it is exposed to sunlight?", "Vitamin D", "Vitamin C", "Vitamin A", "Vitamin B12"),
  q(SCI, "medium", "How many bones are in a typical adult human skeleton?", "206", "186", "226", "256"),
  q(SCI, "medium", "What is the pH of pure water at 25 °C?", "7", "5", "9", "14"),
  q(SCI, "hard", "What is the SI unit of electrical resistance?", "Ohm", "Volt", "Ampere", "Watt"),
  q(SCI, "hard", "Roughly how fast does light travel in a vacuum?", "300,000 km/s", "30,000 km/s", "3,000 km/s", "3,000,000 km/s"),
  q(SCI, "hard", "Which element is the most abundant in Earth's crust by mass?", "Oxygen", "Silicon", "Iron", "Calcium"),
  q(SCI, "hard", "Which noble gas is the most abundant in Earth's atmosphere?", "Argon", "Neon", "Helium", "Xenon"),

  // ── Space ──
  q(SPA, "easy", "Which planet is known as the Red Planet?", "Mars", "Venus", "Jupiter", "Mercury"),
  q(SPA, "easy", "What is the largest planet in our Solar System?", "Jupiter", "Saturn", "Neptune", "Earth"),
  q(SPA, "easy", "Which planet is closest to the Sun?", "Mercury", "Venus", "Mars", "Earth"),
  q(SPA, "easy", "Who was the first person to walk on the Moon?", "Neil Armstrong", "Buzz Aldrin", "Yuri Gagarin", "John Glenn"),
  q(SPA, "medium", "Who was the first human to travel into space, in 1961?", "Yuri Gagarin", "Neil Armstrong", "Alan Shepard", "John Glenn"),
  q(SPA, "medium", "What is the name of the galaxy that contains our Solar System?", "The Milky Way", "Andromeda", "Triangulum", "The Whirlpool Galaxy"),
  q(SPA, "medium", "Roughly how long does sunlight take to reach Earth?", "About 8 minutes", "About 8 seconds", "About 8 hours", "About 8 days"),
  q(SPA, "medium", "Which planet has the hottest average surface temperature?", "Venus", "Mercury", "Mars", "Earth"),
  q(SPA, "medium", "What do we call the streak of light from a space rock burning up in Earth's atmosphere?", "A meteor", "A comet", "A nova", "A quasar"),
  q(SPA, "medium", "Which NASA programme first landed astronauts on the Moon?", "Apollo", "Gemini", "Mercury", "Skylab"),
  q(SPA, "hard", "Which is the larger of Mars's two moons?", "Phobos", "Deimos", "Titan", "Europa"),
  q(SPA, "hard", "What is the largest moon of Saturn?", "Titan", "Enceladus", "Ganymede", "Mimas"),
  q(SPA, "hard", "Which planet rotates on its side, with an axial tilt of about 98 degrees?", "Uranus", "Neptune", "Saturn", "Mars"),
  q(SPA, "hard", "Which spacecraft, launched in 1977, was the first to reach interstellar space?", "Voyager 1", "Voyager 2", "Pioneer 10", "New Horizons"),
  q(SPA, "hard", "What is the boundary around a black hole, beyond which nothing can escape?", "The event horizon", "The singularity", "The accretion disc", "The corona"),

  // ── Geography ──
  q(GEO, "easy", "What is the capital of Japan?", "Tokyo", "Kyoto", "Osaka", "Hiroshima"),
  q(GEO, "easy", "Which is the largest ocean on Earth?", "The Pacific", "The Atlantic", "The Indian", "The Arctic"),
  q(GEO, "easy", "On which continent is most of Egypt located?", "Africa", "Asia", "Europe", "South America"),
  q(GEO, "easy", "What is the tallest mountain above sea level?", "Mount Everest", "K2", "Kangchenjunga", "Mont Blanc"),
  q(GEO, "easy", "Which imaginary line divides Earth into the Northern and Southern Hemispheres?", "The Equator", "The Prime Meridian", "The Tropic of Cancer", "The Arctic Circle"),
  q(GEO, "medium", "Which river flows through Paris?", "The Seine", "The Thames", "The Danube", "The Rhine"),
  q(GEO, "medium", "What is the capital of Australia?", "Canberra", "Sydney", "Melbourne", "Perth"),
  q(GEO, "medium", "What is the largest hot desert in the world?", "The Sahara", "The Gobi", "The Kalahari", "The Atacama"),
  q(GEO, "medium", "What is the smallest country in the world by area?", "Vatican City", "Monaco", "San Marino", "Liechtenstein"),
  q(GEO, "medium", "Which mountain range runs down the western side of South America?", "The Andes", "The Rockies", "The Alps", "The Urals"),
  q(GEO, "medium", "What is the capital of Canada?", "Ottawa", "Toronto", "Vancouver", "Montreal"),
  q(GEO, "hard", "What is the longest river in Europe?", "The Volga", "The Danube", "The Rhine", "The Dnieper"),
  q(GEO, "hard", "The Strait of Gibraltar separates Spain from which country?", "Morocco", "Algeria", "Portugal", "Tunisia"),
  q(GEO, "hard", "Lake Titicaca lies on the border of Peru and which other country?", "Bolivia", "Chile", "Ecuador", "Argentina"),
  q(GEO, "hard", "Which country was historically known as Abyssinia?", "Ethiopia", "Kenya", "Somalia", "Sudan"),

  // ── History ──
  q(HIS, "easy", "In which year did World War II end?", "1945", "1939", "1918", "1950"),
  q(HIS, "easy", "Which ancient civilisation built the pyramids at Giza?", "The Egyptians", "The Romans", "The Greeks", "The Aztecs"),
  q(HIS, "easy", "Who was the first President of the United States?", "George Washington", "Thomas Jefferson", "Abraham Lincoln", "John Adams"),
  q(HIS, "easy", "In 1912, the RMS Titanic sank after striking what?", "An iceberg", "A reef", "Another ship", "A sea mine"),
  q(HIS, "medium", "In which year did the Berlin Wall fall?", "1989", "1991", "1985", "1961"),
  q(HIS, "medium", "Who was the first woman to win a Nobel Prize?", "Marie Curie", "Florence Nightingale", "Ada Lovelace", "Rosalind Franklin"),
  q(HIS, "medium", "Genghis Khan founded which empire?", "The Mongol Empire", "The Ottoman Empire", "The Persian Empire", "The Byzantine Empire"),
  q(HIS, "medium", "Which ship carried the Pilgrims to North America in 1620?", "The Mayflower", "The Santa María", "The Endeavour", "The Beagle"),
  q(HIS, "medium", "In which year did Christopher Columbus first reach the Americas?", "1492", "1488", "1500", "1521"),
  q(HIS, "medium", "Which civilisation built the mountain citadel of Machu Picchu?", "The Inca", "The Maya", "The Aztecs", "The Olmecs"),
  q(HIS, "hard", "Who was Britain's Prime Minister for most of World War II?", "Winston Churchill", "Neville Chamberlain", "Clement Attlee", "David Lloyd George"),
  q(HIS, "hard", "In which year was Magna Carta first sealed?", "1215", "1066", "1415", "1605"),
  q(HIS, "hard", "Which wonder of the ancient world stood at Alexandria in Egypt?", "The Pharos lighthouse", "The Colossus", "The Hanging Gardens", "The Temple of Artemis"),
  q(HIS, "hard", "Who was the first emperor of Rome?", "Augustus", "Julius Caesar", "Nero", "Caligula"),
  q(HIS, "hard", "In which city was the US Declaration of Independence signed?", "Philadelphia", "Boston", "New York", "Washington, D.C."),

  // ── Nature & Animals ──
  q(NAT, "easy", "How many legs does a spider have?", "8", "6", "10", "12"),
  q(NAT, "easy", "Honey is made from which sugary liquid that bees collect from flowers?", "Nectar", "Pollen", "Sap", "Dew"),
  q(NAT, "easy", "What is a baby kangaroo called?", "A joey", "A kit", "A cub", "A calf"),
  q(NAT, "easy", "Which tree produces acorns?", "Oak", "Maple", "Birch", "Pine"),
  q(NAT, "easy", "What is the process called when a caterpillar changes into a butterfly?", "Metamorphosis", "Photosynthesis", "Hibernation", "Migration"),
  q(NAT, "medium", "What is the fastest land animal?", "The cheetah", "The lion", "The pronghorn", "The greyhound"),
  q(NAT, "medium", "Which is the only mammal capable of true powered flight?", "The bat", "The flying squirrel", "The sugar glider", "The colugo"),
  q(NAT, "medium", "How many hearts does an octopus have?", "3", "1", "2", "8"),
  q(NAT, "medium", "What kind of animal is a Komodo dragon?", "A lizard", "A snake", "A crocodile", "A salamander"),
  q(NAT, "medium", "What is the largest species of shark?", "The whale shark", "The great white shark", "The basking shark", "The tiger shark"),
  q(NAT, "medium", "What is a group of crows called?", "A murder", "A parliament", "A pride", "A gaggle"),
  q(NAT, "hard", "Which living bird lays the largest eggs?", "The ostrich", "The emu", "The emperor penguin", "The albatross"),
  q(NAT, "hard", "How many chambers does a cow's stomach have?", "4", "2", "3", "6"),
  q(NAT, "hard", "The axolotl, famous for regrowing lost limbs, is what kind of animal?", "An amphibian", "A fish", "A reptile", "An insect"),
  q(NAT, "hard", "Animals that are mainly active at dawn and dusk are described as what?", "Crepuscular", "Nocturnal", "Diurnal", "Arboreal"),

  // ── Food & Drink ──
  q(FOO, "easy", "What is the main ingredient in guacamole?", "Avocado", "Tomato", "Lime", "Green pepper"),
  q(FOO, "easy", "Pizza Margherita comes from which country?", "Italy", "Greece", "France", "Spain"),
  q(FOO, "easy", "What is tofu made from?", "Soybeans", "Rice", "Chickpeas", "Wheat"),
  q(FOO, "easy", "Chocolate is made from the beans of which plant?", "Cacao", "Coffee", "Vanilla", "Carob"),
  q(FOO, "easy", "Which fruit is traditionally used to make cider?", "Apples", "Pears", "Grapes", "Plums"),
  q(FOO, "medium", "Which costly spice comes from the stigmas of a crocus flower?", "Saffron", "Turmeric", "Paprika", "Cardamom"),
  q(FOO, "medium", "What is the main ingredient of hummus?", "Chickpeas", "Lentils", "Fava beans", "Peas"),
  q(FOO, "medium", "Marzipan is made mainly from which nut?", "Almonds", "Hazelnuts", "Walnuts", "Cashews"),
  q(FOO, "medium", "Paella is a classic rice dish from which country?", "Spain", "Italy", "Portugal", "Mexico"),
  q(FOO, "medium", "What is the Korean side dish of fermented vegetables, often cabbage, called?", "Kimchi", "Bibimbap", "Bulgogi", "Tteokbokki"),
  q(FOO, "medium", "Classic red borscht gets its colour from which vegetable?", "Beetroot", "Red cabbage", "Tomato", "Red pepper"),
  q(FOO, "hard", "Which type of pastry is used to make éclairs?", "Choux pastry", "Puff pastry", "Filo pastry", "Shortcrust pastry"),
  q(FOO, "hard", "What is the Japanese name for the savoury 'fifth taste'?", "Umami", "Wasabi", "Miso", "Dashi"),
  q(FOO, "hard", "Tequila is distilled from which plant?", "Blue agave", "Cactus", "Sugarcane", "Corn"),
  q(FOO, "hard", "Which fizzy drink is made by fermenting sweet tea with a culture of bacteria and yeast?", "Kombucha", "Kefir", "Matcha", "Chai"),

  // ── Sports ──
  q(SPO, "easy", "In football (soccer), how many players does each team have on the pitch?", "11", "9", "10", "12"),
  q(SPO, "easy", "In which sport would you perform a slam dunk?", "Basketball", "Volleyball", "Tennis", "Rugby"),
  q(SPO, "easy", "How many rings are on the Olympic flag?", "5", "4", "6", "7"),
  q(SPO, "easy", "In tennis, what is a score of zero called?", "Love", "Nil", "Duck", "Zip"),
  q(SPO, "easy", "How many holes are played in a standard round of golf?", "18", "9", "12", "24"),
  q(SPO, "medium", "How long is a marathon, to the nearest kilometre?", "42 km", "40 km", "26 km", "50 km"),
  q(SPO, "medium", "In golf, what is one stroke under par on a hole called?", "A birdie", "An eagle", "A bogey", "An albatross"),
  q(SPO, "medium", "How many points is a touchdown worth in American football?", "6", "3", "7", "5"),
  q(SPO, "medium", "How long is an Olympic swimming pool?", "50 metres", "25 metres", "100 metres", "75 metres"),
  q(SPO, "medium", "How many events are in a decathlon?", "10", "7", "5", "12"),
  q(SPO, "medium", "In which sport do teams compete for the Stanley Cup?", "Ice hockey", "Baseball", "American football", "Basketball"),
  q(SPO, "hard", "In snooker, which coloured ball is worth the most points?", "Black", "Pink", "Blue", "Green"),
  q(SPO, "hard", "How many points is a try worth in rugby union?", "5", "3", "4", "7"),
  q(SPO, "hard", "Which martial art's name means 'the gentle way' in Japanese?", "Judo", "Karate", "Aikido", "Kendo"),
  q(SPO, "hard", "Which country hosted the first modern Olympic Games in 1896?", "Greece", "France", "Britain", "The United States"),

  // ── Technology ──
  q(TEC, "easy", "What does 'www' stand for in a web address?", "World Wide Web", "World Web Wire", "Wide Web World", "Web Without Walls"),
  q(TEC, "easy", "What does 'CPU' stand for?", "Central Processing Unit", "Computer Power Unit", "Central Program Utility", "Core Processing Uplink"),
  q(TEC, "easy", "Which number system uses only the digits 0 and 1?", "Binary", "Decimal", "Hexadecimal", "Octal"),
  q(TEC, "easy", "QWERTY is the name of a common layout for what?", "Keyboards", "Circuit boards", "Web pages", "Spreadsheets"),
  q(TEC, "easy", "What does 'RAM' stand for?", "Random Access Memory", "Read And Modify", "Rapid Action Memory", "Runtime Allocation Module"),
  q(TEC, "medium", "What does 'HTML' stand for?", "HyperText Markup Language", "High Tech Modern Language", "Hyperlink Text Management Language", "Home Tool Markup Language"),
  q(TEC, "medium", "How many bits are in a byte?", "8", "4", "16", "10"),
  q(TEC, "medium", "What does 'USB' stand for?", "Universal Serial Bus", "Unified System Board", "Universal Signal Bridge", "User Serial Backup"),
  q(TEC, "medium", "In 'HTTPS', what does the 'S' stand for?", "Secure", "Server", "Standard", "Speed"),
  q(TEC, "medium", "Who invented the World Wide Web?", "Tim Berners-Lee", "Bill Gates", "Steve Jobs", "Vint Cerf"),
  q(TEC, "medium", "What does 'GPS' stand for?", "Global Positioning System", "General Positioning Satellite", "Geographic Pointing Service", "Global Pathfinding Signal"),
  q(TEC, "hard", "Who is often called the first computer programmer, for her notes on Babbage's Analytical Engine?", "Ada Lovelace", "Grace Hopper", "Margaret Hamilton", "Mary Somerville"),
  q(TEC, "hard", "Which British mathematician devised a famous test of whether a machine can pass for a human in conversation?", "Alan Turing", "Charles Babbage", "Tim Berners-Lee", "Isaac Newton"),
  q(TEC, "hard", "In hexadecimal, what decimal value does the digit F represent?", "15", "16", "14", "6"),
  q(TEC, "hard", "Which programming language shares its name with an Indonesian island famous for coffee?", "Java", "Python", "Ruby", "Kotlin"),

  // ── Language & Words ──
  q(LAN, "easy", "What is the opposite of 'ancient'?", "Modern", "Old", "Antique", "Historic"),
  q(LAN, "easy", "Which word means the same as 'happy'?", "Joyful", "Gloomy", "Weary", "Anxious"),
  q(LAN, "easy", "What is the plural of 'mouse' (the animal)?", "Mice", "Mouses", "Meese", "Mousen"),
  q(LAN, "easy", "'Bonjour' means 'hello' in which language?", "French", "Spanish", "Italian", "Portuguese"),
  q(LAN, "medium", "What do you call a word that reads the same forwards and backwards, like 'level'?", "A palindrome", "An anagram", "A homophone", "An acronym"),
  q(LAN, "medium", "Which word means an intense fear of spiders?", "Arachnophobia", "Claustrophobia", "Acrophobia", "Agoraphobia"),
  q(LAN, "medium", "What is the simple past tense of 'swim'?", "Swam", "Swimmed", "Swum", "Swimmen"),
  q(LAN, "medium", "Words that sound alike but differ in meaning, like 'pair' and 'pear', are called what?", "Homophones", "Synonyms", "Antonyms", "Acronyms"),
  q(LAN, "medium", "What does the Latin phrase 'carpe diem' mean?", "Seize the day", "Love conquers all", "Time flies", "Know yourself"),
  q(LAN, "medium", "How many items are in a baker's dozen?", "13", "12", "11", "14"),
  q(LAN, "hard", "Which letter appears most often in written English?", "E", "A", "T", "S"),
  q(LAN, "hard", "The word 'kindergarten' comes from which language?", "German", "Dutch", "Danish", "Swedish"),
  q(LAN, "hard", "What is the term for a word that imitates a sound, like 'buzz'?", "Onomatopoeia", "Alliteration", "Metaphor", "Hyperbole"),
  q(LAN, "hard", "The word 'robot' first appeared in a 1920 play written in which language?", "Czech", "Russian", "German", "Polish"),
  q(LAN, "hard", "In the NATO phonetic alphabet, which word stands for the letter D?", "Delta", "Dog", "David", "Dixie"),

  // ── Art & Music ──
  q(ART, "easy", "Who painted the Mona Lisa?", "Leonardo da Vinci", "Michelangelo", "Raphael", "Vincent van Gogh"),
  q(ART, "easy", "How many strings does a standard guitar have?", "6", "4", "5", "8"),
  q(ART, "easy", "Which instrument usually has 88 keys?", "The piano", "The organ", "The harpsichord", "The accordion"),
  q(ART, "easy", "Who painted 'The Starry Night'?", "Vincent van Gogh", "Claude Monet", "Rembrandt", "Pablo Picasso"),
  q(ART, "medium", "Who composed the 'Moonlight Sonata'?", "Ludwig van Beethoven", "Wolfgang Amadeus Mozart", "Frédéric Chopin", "Johann Sebastian Bach"),
  q(ART, "medium", "Who painted the ceiling of the Sistine Chapel?", "Michelangelo", "Leonardo da Vinci", "Raphael", "Donatello"),
  q(ART, "medium", "How many lines make up a standard musical staff?", "5", "4", "6", "7"),
  q(ART, "medium", "Salvador Dalí is best known for which art movement?", "Surrealism", "Cubism", "Impressionism", "Pop Art"),
  q(ART, "medium", "Which painter is famous for a series of water lily paintings?", "Claude Monet", "Edgar Degas", "Pierre-Auguste Renoir", "Paul Gauguin"),
  q(ART, "medium", "Which composer wrote 'The Four Seasons'?", "Antonio Vivaldi", "Johann Sebastian Bach", "George Frideric Handel", "Franz Schubert"),
  q(ART, "medium", "In music, what does 'forte' tell a player to do?", "Play loudly", "Play softly", "Play quickly", "Play slowly"),
  q(ART, "hard", "Who painted 'Girl with a Pearl Earring'?", "Johannes Vermeer", "Rembrandt", "Frans Hals", "Jan van Eyck"),
  q(ART, "hard", "Who sculpted 'The Thinker'?", "Auguste Rodin", "Michelangelo", "Donatello", "Antonio Canova"),
  q(ART, "hard", "How many symphonies did Beethoven complete?", "9", "7", "12", "41"),
  q(ART, "hard", "Which Italian musical term means 'gradually getting louder'?", "Crescendo", "Diminuendo", "Staccato", "Allegro"),

  // ── Maths & Logic ──
  q(MAT, "easy", "What is 7 × 8?", "56", "54", "48", "64"),
  q(MAT, "easy", "How many sides does a hexagon have?", "6", "5", "7", "8"),
  q(MAT, "easy", "How many degrees are in a right angle?", "90", "45", "180", "100"),
  q(MAT, "easy", "What is the highest total you can roll with two standard six-sided dice?", "12", "10", "11", "36"),
  q(MAT, "medium", "What is the square root of 144?", "12", "14", "11", "16"),
  q(MAT, "medium", "What is the next prime number after 7?", "11", "9", "13", "10"),
  q(MAT, "medium", "What comes next: 1, 1, 2, 3, 5, 8, …?", "13", "11", "12", "15"),
  q(MAT, "medium", "What is 15% of 200?", "30", "15", "20", "35"),
  q(MAT, "medium", "If today is Monday, what day will it be in 10 days?", "Thursday", "Wednesday", "Friday", "Tuesday"),
  q(MAT, "medium", "What is the Roman numeral for 50?", "L", "C", "D", "X"),
  q(MAT, "hard", "How many edges does a cube have?", "12", "8", "6", "10"),
  q(MAT, "hard", "What is 2 to the power of 10?", "1,024", "512", "2,048", "1,000"),
  q(MAT, "hard", "How many minutes are there in a full day?", "1,440", "1,240", "1,400", "2,400"),
  q(MAT, "hard", "The interior angles of a quadrilateral add up to how many degrees?", "360°", "180°", "540°", "720°"),
  q(MAT, "hard", "Which logic gate outputs true only when both of its inputs are true?", "AND", "OR", "XOR", "NOT"),

  // ── Film & Books (classics) ──
  q(FIL, "easy", "Who wrote 'Romeo and Juliet'?", "William Shakespeare", "Charles Dickens", "Jane Austen", "Christopher Marlowe"),
  q(FIL, "easy", "Which author created the detective Sherlock Holmes?", "Arthur Conan Doyle", "Agatha Christie", "Charles Dickens", "Edgar Allan Poe"),
  q(FIL, "easy", "In which story does the miser Ebenezer Scrooge appear?", "A Christmas Carol", "Oliver Twist", "Great Expectations", "Bleak House"),
  q(FIL, "easy", "In the 1939 film 'The Wizard of Oz', what colour are Dorothy's magic slippers?", "Ruby red", "Silver", "Emerald green", "Gold"),
  q(FIL, "easy", "In Homer's 'Odyssey', which hero struggles to get home after the Trojan War?", "Odysseus", "Achilles", "Hector", "Perseus"),
  q(FIL, "medium", "Who wrote 'Pride and Prejudice'?", "Jane Austen", "Charlotte Brontë", "Emily Brontë", "George Eliot"),
  q(FIL, "medium", "Who wrote the novel 'Nineteen Eighty-Four'?", "George Orwell", "Aldous Huxley", "Ray Bradbury", "H. G. Wells"),
  q(FIL, "medium", "Which Alfred Hitchcock film has a famous shower scene?", "Psycho", "Vertigo", "The Birds", "Rear Window"),
  q(FIL, "medium", "In 'The Hobbit', which hobbit finds the One Ring?", "Bilbo Baggins", "Frodo Baggins", "Samwise Gamgee", "Peregrin Took"),
  q(FIL, "medium", "What is the name of the one-legged pirate in 'Treasure Island'?", "Long John Silver", "Captain Hook", "Blackbeard", "Captain Flint"),
  q(FIL, "medium", "In 'Moby-Dick', which captain hunts the white whale?", "Captain Ahab", "Captain Nemo", "Captain Hook", "Captain Bligh"),
  q(FIL, "hard", "In Mary Shelley's novel, who is Frankenstein?", "The scientist who builds the creature", "The creature he builds", "A blind hermit", "A ship's captain"),
  q(FIL, "hard", "Which Charles Dickens novel begins 'It was the best of times, it was the worst of times'?", "A Tale of Two Cities", "Great Expectations", "David Copperfield", "Hard Times"),
  q(FIL, "hard", "Who directed the 1968 film '2001: A Space Odyssey'?", "Stanley Kubrick", "Steven Spielberg", "George Lucas", "Ridley Scott"),
  q(FIL, "hard", "Who wrote 'War and Peace'?", "Leo Tolstoy", "Fyodor Dostoevsky", "Anton Chekhov", "Ivan Turgenev"),
];

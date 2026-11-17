// Sketch Storm word list. Server-only: never import this from the client.
// Rules: family-friendly, concrete and drawable, no brands or proper nouns,
// lowercase letters with single spaces or hyphens, at most 16 characters.

import type { BuiltinLevel } from "./shared";

const EASY = [
  "apple", "banana", "cherry", "grapes", "lemon", "pear", "strawberry", "carrot",
  "corn", "mushroom", "pizza", "cake", "cookie", "donut", "egg", "bread",
  "cheese", "ice cream", "lollipop", "sandwich", "hot dog", "burger", "cat", "dog",
  "fish", "bird", "duck", "frog", "snake", "spider", "bee", "ant",
  "cow", "pig", "horse", "sheep", "mouse", "lion", "bear", "rabbit",
  "turtle", "whale", "shark", "owl", "penguin", "butterfly", "snail", "crab",
  "monkey", "elephant", "zebra", "panda", "chicken", "fox", "giraffe", "dolphin",
  "tree", "flower", "leaf", "cloud", "sun", "moon", "star", "rainbow",
  "mountain", "snowman", "fire", "island", "house", "car", "bus", "train",
  "boat", "airplane", "bicycle", "rocket", "truck", "ball", "hat", "cup",
  "book", "chair", "table", "bed", "door", "key", "clock", "shoe",
  "sock", "t-shirt", "dress", "glasses", "crown", "ring", "kite", "drum",
  "bell", "candle", "lamp", "phone", "pencil", "umbrella", "balloon", "ladder",
  "gift", "heart", "eye", "hand", "foot", "tooth", "nose", "robot",
  "ghost", "pumpkin", "tent", "castle", "window", "spoon", "fork", "bowl",
  "bottle", "bucket", "shovel", "cactus", "bone", "flag", "worm", "hammer",
  "yo-yo", "igloo", "map", "popcorn",
];

const MEDIUM = [
  "lighthouse", "skateboard", "windmill", "parachute", "telescope", "submarine", "waterfall", "scarecrow",
  "treasure chest", "toothbrush", "fire truck", "sandcastle", "spaceship", "dinosaur", "kangaroo", "peacock",
  "octopus", "jellyfish", "seahorse", "hedgehog", "flamingo", "snowflake", "campfire", "hammock",
  "backpack", "cupcake", "pancake", "pretzel", "pineapple", "watermelon", "coconut", "avocado",
  "broccoli", "teapot", "kettle", "scissors", "magnet", "compass", "microscope", "guitar",
  "violin", "trumpet", "piano", "helicopter", "ambulance", "bulldozer", "skyscraper", "pyramid",
  "tornado", "lightning", "anchor", "mermaid", "unicorn", "dragon", "wizard", "pirate",
  "astronaut", "knight", "spider web", "beehive", "bird nest", "fishbowl", "light bulb", "battery",
  "headphones", "camera", "television", "computer", "keyboard", "envelope", "mailbox", "globe",
  "trophy", "medal", "diamond", "hourglass", "alarm clock", "bandage", "thermometer", "bathtub",
  "mirror", "necklace", "sunglasses", "bow tie", "scarf", "mitten", "boot", "sandal",
  "tractor", "stop sign", "traffic cone", "swing", "slide", "sled", "surfboard", "canoe",
  "sailboat", "fishing rod", "barn", "fence", "chimney", "fireplace", "couch", "bookshelf",
  "toaster", "broom", "ladybug", "caterpillar", "dragonfly", "squirrel", "raccoon", "skunk",
  "beaver", "moose", "llama", "camel", "ostrich", "pelican", "parrot", "eagle",
  "swan", "goat", "donkey", "deer", "wolf", "koala", "sloth", "walrus",
  "polar bear", "lobster", "shrimp", "starfish", "iceberg", "volcano", "microphone", "toilet",
];

const HARD = [
  "ferris wheel", "roller coaster", "hot air balloon", "merry-go-round", "jack-in-the-box", "trampoline", "catapult", "chandelier",
  "escalator", "elevator", "vending machine", "traffic light", "fire hydrant", "lawn mower", "wheelbarrow", "totem pole",
  "chessboard", "jigsaw puzzle", "origami", "kaleidoscope", "periscope", "pinwheel", "sundial", "weather vane",
  "windsock", "life jacket", "snorkel", "scuba diver", "ski lift", "ice skates", "hockey stick", "bowling pin",
  "boomerang", "dartboard", "slingshot", "bow and arrow", "hula hoop", "jump rope", "picnic basket", "barbecue",
  "marshmallow", "gingerbread man", "candy cane", "snow globe", "fireworks", "pinata", "maracas", "tambourine",
  "xylophone", "bagpipes", "conveyor belt", "satellite", "solar panel", "wind turbine", "treehouse", "birdhouse",
  "greenhouse", "haystack", "pitchfork", "ant farm", "cocoon", "chameleon", "porcupine", "armadillo",
  "platypus", "narwhal", "stingray", "pufferfish", "swordfish", "hummingbird", "woodpecker", "stethoscope",
  "saxophone", "accordion", "harmonica", "metronome", "typewriter", "sewing machine", "spinning top", "rubber duck",
  "paper plane", "lava lamp", "fortune cookie", "cuckoo clock", "sleeping bag", "mousetrap", "drawbridge", "waterslide",
];

export const WORDS: Record<BuiltinLevel, readonly string[]> = {
  easy: EASY,
  medium: MEDIUM,
  hard: HARD,
};

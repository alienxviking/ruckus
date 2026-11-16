// The picker's curated emoji: ~420 broadly supported ones (Unicode 12 or older, no flags),
// grouped in categories with search keywords. Plain data, parsed once on first use.
// Line format: "<emoji> <name>|<extra keywords>".

export interface EmojiItem {
  e: string;
  name: string;
  /** Lowercase search words (name words first). */
  words: string[];
}

export interface EmojiGroup {
  id: string;
  label: string;
  icon: string;
  items: EmojiItem[];
}

const RAW: [id: string, label: string, icon: string, lines: string][] = [
  [
    "smileys",
    "Smileys",
    "😀",
    `😀 grinning|happy smile
😂 tears of joy|laugh lol funny crying
😅 sweat smile|nervous phew relief
😇 angel|halo innocent good heaven
🥰 in love|hearts adore crush
😍 heart eyes|love crush beautiful
🤩 star struck|wow famous amazed celebrity
😘 kiss|blow love
😜 crazy wink|silly joke tongue
🤑 money face|rich cash dollar greedy
🤗 hug|hugs welcome
🤫 shush|quiet secret silence
🤔 thinking|hmm wonder idea question
🤐 zipped mouth|secret mute quiet
🤨 suspicious|raised eyebrow doubt
🙄 eye roll|whatever annoyed bored
😏 smirk|smug sly
😬 grimace|awkward yikes nervous
🤥 liar|lie nose long
😴 sleeping|sleep zzz tired night bed
😷 mask|sick doctor ill
🤕 hurt|bandage injury
🤮 vomit|sick puke gross
🤧 sneeze|cold tissue flu
🥵 hot face|heat sweat summer
🥶 cold face|freezing ice winter
🤯 mind blown|explode shock wow
🤠 cowboy|western hat yeehaw
🥳 party face|celebrate birthday
😎 cool|sunglasses
🤓 nerd|geek glasses smart
🧐 monocle|curious inspect fancy
😮 surprised|wow open mouth
😳 flushed|embarrassed shocked
🥺 pleading|puppy eyes please
😢 crying|sad tear
😭 sobbing|cry sad
😱 scream|scared horror fear
😤 huff|angry steam triumph
😡 angry|mad rage red
😈 devil|evil smiling horns
💀 skull|dead death skeleton
☠️ skull crossbones|pirate poison danger
💩 poop|poo
🤡 clown|circus funny joker
👻 ghost|boo spooky haunted halloween
👽 alien|ufo space et
🤖 robot|machine bot ai
🙈 see no evil|monkey hide shy`,
  ],
  [
    "people",
    "People",
    "🧑",
    `👋 wave|hello hi bye goodbye
✋ hand|stop high five
👌 ok hand|perfect
✌️ peace|victory two
👈 point left|left
👉 point right|right
👍 thumbs up|yes good like
👎 thumbs down|no bad dislike
👊 punch|fist bump hit
👏 clap|applause bravo
🙌 raise hands|hooray praise
🤝 handshake|deal agree meet
🙏 pray|please thanks hope
✍️ writing|write sign
💪 muscle|strong flex gym power arm
👂 ear|hear listen
🧠 brain|smart mind think
🦷 tooth|teeth dentist
👀 eyes|look see watch
👁️ eye|see vision
👄 mouth|lips kiss speak
👶 baby|child infant birth
👨 man|guy father dad
👩 woman|lady mother mom
👴 old man|grandpa grandfather
👵 old woman|grandma grandmother granny
👮 police officer|cop law
🕵️ detective|spy sleuth mystery
👷 builder|construction worker
🤴 prince|royal king
👸 princess|royal queen
🤵 groom|tuxedo wedding suit
👰 bride|wedding veil marry
🎅 santa|christmas claus
🦸 superhero|hero power
🧙 wizard|mage magic witch spell
🧚 fairy|magic wings
🧛 vampire|dracula blood bite
🧜 mermaid|merman sea ocean
🧞 genie|wish lamp magic
🧟 zombie|undead
💇 haircut|barber salon hair
🚶 walking|walk stroll
🏃 running|run race fast jog
💃 dancer|dance salsa party
🕺 dancing man|dance disco
🧘 yoga|meditate calm zen
🛌 in bed|sleep rest
👫 couple|holding hands date
💑 couple heart|love romance
👪 family|parents kids`,
  ],
  [
    "animals",
    "Nature",
    "🐶",
    `🐶 dog|puppy pet
🐱 cat|kitten pet
🐭 mouse|rat
🐰 rabbit|bunny easter
🦊 fox|sly
🐻 bear|teddy
🐯 tiger|stripes
🦁 lion|king jungle
🐮 cow|moo milk farm
🐷 pig|oink farm
🐸 frog|toad prince
🐵 monkey|ape
🐔 chicken|hen farm
🐧 penguin|cold antarctic
🐦 bird|tweet fly
🦆 duck|quack
🦅 eagle|bird freedom
🦉 owl|night wise
🐺 wolf|howl
🐴 horse|pony
🦄 unicorn|magic fantasy
🐝 bee|honey buzz
🐛 bug|caterpillar
🦋 butterfly|pretty
🐌 snail|slow
🕷️ spider|creepy
🕸️ spider web|cobweb
🐢 turtle|slow tortoise
🐍 snake|serpent
🦖 t rex|dinosaur
🐙 octopus|tentacles
🦀 crab|beach
🐟 fish|sea
🐬 dolphin|ocean
🐳 whale|ocean
🦈 shark|jaws ocean
🐘 elephant|big trunk
🦒 giraffe|tall
🦓 zebra|stripes
🐪 camel|desert
🐑 sheep|lamb wool
🦃 turkey|thanksgiving
🦜 parrot|pirate bird talk
🐉 dragon|fire fantasy
🌵 cactus|desert
🎄 christmas tree|xmas
🌲 pine tree|forest woods evergreen
🌳 tree|forest oak woods
🌴 palm tree|beach island tropical
🌱 seedling|plant grow sprout garden
🍀 four leaf clover|luck lucky irish
🍁 maple leaf|autumn fall
🍄 mushroom|fungi
🌹 rose|flower love romance
🌻 sunflower|flower summer
☀️ sun|sunny day hot
🌙 crescent moon|night
⭐ star|night
✨ sparkles|magic shiny new
⚡ lightning|zap electric thunder fast
🔥 fire|hot flame burn lit
🌈 rainbow|colors
🌧️ rain|rainy weather
❄️ snowflake|snow cold winter ice
⛄ snowman|winter snow
🌊 wave|ocean sea surf water
🌪️ tornado|twister wind storm
🌋 volcano|eruption lava
🌍 earth|world globe planet`,
  ],
  [
    "food",
    "Food",
    "🍕",
    `🍎 apple|red fruit teacher
🍊 orange|tangerine fruit
🍋 lemon|sour
🍌 banana|monkey
🍉 watermelon|summer
🍇 grapes|wine
🍓 strawberry|berry
🍑 peach
🥭 mango
🍍 pineapple
🍆 eggplant|aubergine
🥑 avocado|guacamole
🥦 broccoli|vegetable
🥕 carrot|bunny vegetable
🌽 corn|maize cob
🌶️ chili|hot spicy pepper
🧅 onion|cry
🍞 bread|loaf toast
🥐 croissant|french pastry
🧀 cheese
🥚 egg
🍳 fried egg|cooking breakfast pan
🥞 pancakes|breakfast
🥓 bacon|breakfast
🍗 drumstick|chicken leg
🌭 hot dog|sausage
🍔 burger|hamburger fast food
🍟 fries|chips fast food
🍕 pizza|slice
🥪 sandwich
🌮 taco|mexican
🌯 burrito|wrap
🥗 salad|healthy
🍿 popcorn|movie cinema
🍝 spaghetti|pasta noodles italian
🍜 noodles|ramen soup
🍣 sushi|japanese fish
🍦 ice cream|soft serve cone
🍩 donut|doughnut
🍪 cookie|biscuit
🎂 birthday cake|cake candles
🍰 cake slice|shortcake dessert
🧁 cupcake|muffin
🥧 pie
🍫 chocolate|candy bar
🍭 lollipop|candy sweet
🍼 baby bottle|milk
☕ coffee|hot drink
🍵 tea|green tea cup
🥤 soda|cup drink straw
🍺 beer|pub
🥂 champagne glasses|celebrate toast
🍷 wine|glass red
🍹 tropical drink|cocktail vacation
🍾 champagne|bottle pop celebrate
🍴 fork and knife|cutlery eat dinner restaurant`,
  ],
  [
    "activity",
    "Activity",
    "⚽",
    `⚽ soccer|football ball
🏀 basketball|ball
🏈 american football|ball
⚾ baseball|ball
🎾 tennis|ball
🎱 pool ball|billiards eight
🏓 ping pong|table tennis
⛳ golf|flag hole
🏹 bow and arrow|archery
🎣 fishing|rod fish
🥊 boxing|glove fight punch
⛸️ ice skate|skating
🎿 skis|skiing snow
🏋️ weightlifting|gym lift weights
🏄 surfing|surf wave
🏊 swimming|swim pool
🚴 cycling|bike
🧗 climbing|rock climb
🪁 kite|fly wind
🏆 trophy|win champion prize cup
🥇 gold medal|first winner
🎪 circus tent|circus
🤹 juggling|juggle
🎭 theater|drama masks acting
🎨 art|paint palette artist
🎬 clapper|movie film action
🎤 microphone|sing karaoke
🎧 headphones|music listen
🎹 piano|keyboard
🥁 drum|beat
🎺 trumpet
🎸 guitar|rock
🎲 dice|game chance luck
♟️ chess|pawn
🎯 bullseye|target dart goal aim
🎳 bowling
🎮 video game|controller gaming
🧩 puzzle|jigsaw piece
🧸 teddy bear|toy
🎈 balloon|party birthday
🎉 party popper|celebrate tada
🎊 confetti|party celebrate
🎁 gift|present birthday
🎃 pumpkin|jack o lantern halloween
🎆 fireworks|celebration new year
🎵 music note|song`,
  ],
  [
    "travel",
    "Travel",
    "✈️",
    `🚗 car|drive
🚕 taxi|cab
🚌 bus|school
🚑 ambulance|hospital
🚒 fire engine|firetruck
🏎️ race car|fast formula
🚚 truck|delivery
🚜 tractor|farm
🚲 bicycle|bike
🚂 locomotive|train steam
🚆 train|rail
✈️ airplane|plane fly travel
🚁 helicopter
🚀 rocket|space launch
🛸 flying saucer|ufo alien
⛵ sailboat|boat sail
⚓ anchor|ship sailor
🚢 ship|boat cruise
🗺️ map|world travel
🧭 compass|direction
🏔️ snowy mountain|mountain
🏕️ camping|tent
🏖️ beach|umbrella sand vacation
🏝️ island|desert island
🏟️ stadium|arena
🏛️ museum|classical building
🏠 house|home
🏰 castle|kingdom
🗼 tower|tokyo
🗽 statue of liberty|new york
⛪ church|wedding
🏥 hospital|doctor
🏦 bank|money
🏫 school|education
🎡 ferris wheel|fair
🎢 roller coaster|theme park
🌃 night city|city night
🌅 sunrise|morning
🌌 milky way|space galaxy stars
🚦 traffic light|stop go
⛽ fuel pump|gas petrol
🏁 checkered flag|race finish
🚩 red flag|warning
🏴‍☠️ pirate flag|jolly roger pirate`,
  ],
  [
    "objects",
    "Objects",
    "💡",
    `⌚ watch|time
📱 phone|mobile cell
💻 laptop|computer
📷 camera|photo picture selfie
🎥 movie camera|film
📺 television|tv
📻 radio
⏰ alarm clock|wake morning time
⏳ hourglass|time wait
🔌 plug|electric
💡 light bulb|idea bright
🔦 flashlight|torch
🕯️ candle|light
💵 dollar|money cash
💰 money bag|rich loot treasure
💳 credit card|pay
💎 gem|diamond jewel rich
⚖️ scales|justice law
🔧 wrench|fix tool
🔨 hammer|build tool
🧱 bricks|wall build
⛓️ chains|prison
🔫 water pistol|squirt gun
💣 bomb|explode boom
⚔️ crossed swords|battle fight
🛡️ shield|protect defend
🔮 crystal ball|fortune future magic
🔭 telescope|stars astronomy
🔬 microscope|science lab
🩺 stethoscope|doctor
💊 pill|medicine drug
💉 syringe|vaccine injection shot
🧪 test tube|science chemistry experiment
🌡️ thermometer|temperature fever
🧹 broom|sweep witch clean
🧺 basket|laundry picnic
🚽 toilet|bathroom
🚿 shower|wash
🛁 bathtub|bath bubble
🔑 key|unlock open
🚪 door|enter exit
🪑 chair|seat
🛏️ bed|sleep
🖼️ picture frame|painting art portrait
🧳 luggage|suitcase travel
☂️ umbrella|rain
👓 glasses|eyewear read
🕶️ sunglasses|shades cool
👔 tie|shirt office work
👕 t shirt|shirt clothes
👗 dress|fashion
👙 bikini|swimsuit beach
👠 high heel|shoe
👟 sneaker|shoe run
🧦 socks|sock
👑 crown|king queen royal
🎩 top hat|magic fancy
🎓 graduation cap|school college degree
💄 lipstick|makeup
💍 ring|wedding engagement marry diamond
✉️ envelope|letter mail
💌 love letter|valentine
📦 package|box parcel delivery
📝 memo|note write
📚 books|library read study
📖 open book|read story
📰 newspaper|news
✏️ pencil|write draw
✂️ scissors|cut
🗑️ wastebasket|trash bin garbage
🔒 lock|locked secure
🔔 bell|ring notification
📣 megaphone|announce cheer
🧯 extinguisher|fire
🛒 shopping cart|shop store
🪓 axe|chop wood`,
  ],
  [
    "symbols",
    "Symbols",
    "❤️",
    `❤️ red heart|love
💙 blue heart|love
💔 broken heart|heartbreak breakup sad
💘 heart with arrow|cupid love
💯 hundred|perfect score
💥 boom|collision explosion crash
💨 dash|fast wind run
💬 speech bubble|talk chat say
💭 thought bubble|think dream
💤 zzz|sleep
➕ plus|add and
➖ minus|subtract less
❓ question|what
❗ exclamation|important
✅ check|done yes correct
❌ cross mark|no wrong
🚫 prohibited|no ban forbidden not
⚠️ warning|caution danger
♻️ recycle|again
🔁 repeat|loop again
➡️ right arrow|next then
⬅️ left arrow|back
⬆️ up arrow|up
⬇️ down arrow|down
♥️ heart suit|cards
🔴 red circle|red
🟡 yellow circle|yellow
🟢 green circle|green
🔵 blue circle|blue
⚫ black circle|black
⬛ black square|black
🔺 red triangle|up
☯️ yin yang|balance
⚛️ atom|science
💲 dollar sign|money
🌀 cyclone|spiral swirl dizzy`,
  ],
];

let groups: EmojiGroup[] | null = null;

/** The categories with their items (parsed once). */
export function emojiGroups(): EmojiGroup[] {
  if (groups) return groups;
  const seen = new Set<string>();
  groups = RAW.map(([id, label, icon, lines]) => ({
    id,
    label,
    icon,
    items: lines
      .split("\n")
      .map((line) => {
        const sp = line.indexOf(" ");
        const e = line.slice(0, sp);
        const [name, extra = ""] = line.slice(sp + 1).split("|");
        return { e, name, words: `${name} ${extra}`.toLowerCase().split(/\s+/).filter(Boolean) };
      })
      .filter((it) => it.e && !seen.has(it.e) && (seen.add(it.e), true)),
  }));
  return groups;
}

let byEmoji: Map<string, EmojiItem> | null = null;

/** Look up an emoji's item (for accessible names). */
export function emojiInfo(e: string): EmojiItem | undefined {
  if (!byEmoji) {
    byEmoji = new Map();
    for (const g of emojiGroups()) for (const it of g.items) byEmoji.set(it.e, it);
  }
  return byEmoji.get(e);
}

export const emojiName = (e: string) => emojiInfo(e)?.name ?? "emoji";

/** Keyword search: every query word must prefix-match some keyword; name hits rank first. */
export function searchEmoji(query: string, limit = 60): EmojiItem[] {
  const q = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!q.length) return [];
  const hits: { it: EmojiItem; score: number }[] = [];
  for (const g of emojiGroups()) {
    for (const it of g.items) {
      let score = 0;
      let all = true;
      for (const w of q) {
        let best = 0;
        for (let i = 0; i < it.words.length; i++) {
          const k = it.words[i];
          const nameWord = i < it.name.split(" ").length;
          const s = k === w ? 3 : k.startsWith(w) ? 2 : 0;
          if (s) best = Math.max(best, s + (nameWord ? 1 : 0));
        }
        if (!best) {
          all = false;
          break;
        }
        score += best;
      }
      if (all) hits.push({ it, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit).map((h) => h.it);
}

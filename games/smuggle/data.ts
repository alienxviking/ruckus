// Word Smuggler word bank (server-only, original). One card per line:
// word|banned|banned|banned|banned|banned   (exactly five banned words, family-friendly)
const RAW = `
Pizza|cheese|slice|Italian|pepperoni|delivery
Elephant|trunk|gray|big|tusk|Africa
Giraffe|neck|tall|spots|leaves|Africa
Penguin|bird|ice|black|white|waddle
Kangaroo|jump|pouch|Australia|baby|hop
Lion|king|mane|roar|jungle|cat
Tiger|stripes|orange|cat|jungle|roar
Zebra|stripes|horse|black|white|Africa
Monkey|banana|tree|climb|tail|ape
Dolphin|ocean|smart|swim|fin|mammal
Shark|teeth|ocean|fin|fish|bite
Whale|ocean|big|blue|mammal|spout
Octopus|eight|arms|ink|ocean|tentacles
Turtle|shell|slow|reptile|sea|tortoise
Snail|shell|slow|slimy|garden|slug
Butterfly|wings|caterpillar|colorful|insect|monarch
Bee|honey|buzz|sting|hive|flower
Spider|web|eight|legs|bug|insect
Ant|small|colony|hill|insect|picnic
Owl|night|bird|hoot|wise|eyes
Parrot|bird|talk|colorful|feathers|pirate
Frog|green|jump|pond|lily|croak
Rabbit|bunny|ears|carrot|hop|fluffy
Squirrel|nuts|tree|tail|acorn|furry
Horse|ride|saddle|gallop|hooves|mane
Cow|milk|moo|farm|spots|grass
Pig|oink|pink|mud|farm|bacon
Sheep|wool|baa|farm|lamb|fluffy
Chicken|egg|cluck|farm|hen|feathers
Duck|quack|pond|bird|swim|feathers
Goat|horns|farm|cheese|milk|beard
Camel|hump|desert|sand|ride|water
Panda|bear|bamboo|black|white|China
Koala|bear|eucalyptus|Australia|tree|sleepy
Polar bear|white|Arctic|ice|snow|fur
Crocodile|teeth|swamp|reptile|alligator|jaws
Snake|slither|hiss|scales|long|reptile
Bat|night|wings|cave|fly|upside
Fox|orange|tail|sly|forest|clever
Wolf|howl|pack|moon|dog|forest
Deer|antlers|forest|fawn|Bambi|brown
Hedgehog|spikes|prickly|small|curl|spines
Peacock|feathers|tail|colorful|bird|fan
Flamingo|pink|bird|leg|stand|feathers
Jellyfish|sting|ocean|clear|wobbly|tentacles
Starfish|ocean|arms|beach|five|points
Crab|claws|sideways|beach|shell|pinch
Lobster|claws|red|seafood|ocean|shell
Mouse|cheese|squeak|small|tail|rodent
Hamster|pet|wheel|cage|small|cheeks
Goldfish|bowl|pet|orange|swim|memory
Puppy|dog|young|bark|cute|pet
Kitten|cat|young|meow|cute|pet
Gorilla|ape|big|chest|jungle|monkey
Hippo|river|big|mouth|Africa|water
Rhino|horn|big|gray|Africa|thick
Eagle|bird|fly|bald|wings|claws
Ladybug|red|spots|insect|black|beetle
Worm|dirt|wiggle|soil|bait|long
Dinosaur|extinct|fossil|big|reptile|bones
Unicorn|horn|horse|magic|rainbow|myth
Dragon|fire|wings|breathe|scales|myth
Mermaid|tail|fish|ocean|swim|half
Burger|bun|beef|patty|fries|cheese
Spaghetti|pasta|noodles|Italian|sauce|meatballs
Sushi|rice|fish|Japan|raw|roll
Taco|shell|Mexican|beef|cheese|salsa
Pancake|breakfast|flat|syrup|flip|butter
Waffle|breakfast|syrup|squares|iron|batter
Ice cream|cold|cone|scoop|dessert|vanilla
Chocolate|sweet|brown|candy|cocoa|bar
Popcorn|movie|butter|kernel|snack|salty
Sandwich|bread|lunch|slice|filling|ham
Hot dog|sausage|bun|mustard|ketchup|grill
French fries|potato|ketchup|chips|salty|crispy
Banana|yellow|peel|fruit|monkey|bunch
Apple|red|fruit|tree|pie|core
Orange|fruit|citrus|juice|peel|color
Strawberry|red|fruit|seeds|jam|shortcake
Watermelon|green|red|seeds|summer|fruit
Pineapple|spiky|yellow|tropical|fruit|Hawaii
Grapes|bunch|purple|green|vine|raisin
Lemon|sour|yellow|citrus|juice|lime
Coconut|tropical|palm|hairy|milk|tree
Cherry|red|pit|fruit|stem|pie
Carrot|orange|vegetable|rabbit|root|crunchy
Broccoli|green|vegetable|tree|florets|healthy
Potato|vegetable|mashed|fries|chips|spud
Tomato|red|ketchup|vegetable|fruit|sauce
Onion|cry|layers|vegetable|tears|peel
Corn|yellow|cob|kernels|maize|farm
Mushroom|fungus|cap|pizza|forest|toadstool
Pumpkin|orange|Halloween|pie|carve|squash
Cucumber|green|pickle|salad|vegetable|cool
Bread|loaf|toast|bake|flour|slice
Cheese|yellow|milk|mouse|cheddar|holes
Egg|chicken|yolk|shell|breakfast|white
Butter|toast|spread|yellow|milk|margarine
Honey|bee|sweet|sticky|golden|hive
Cookie|biscuit|chocolate|chip|bake|jar
Cake|birthday|candles|frosting|bake|slice
Cupcake|small|frosting|sprinkles|muffin|bake
Donut|hole|glazed|sprinkles|round|sweet
Cereal|breakfast|bowl|milk|box|spoon
Soup|bowl|spoon|hot|broth|tomato
Salad|lettuce|green|healthy|dressing|bowl
Rice|grain|white|bowl|Asia|cook
Noodles|pasta|long|ramen|slurp|soup
Pie|crust|apple|bake|slice|dessert
Candy|sweet|sugar|lollipop|treat|wrapper
Lollipop|stick|candy|lick|sweet|round
Marshmallow|fluffy|white|campfire|roast|s'mores
Peanut butter|jelly|sandwich|spread|nuts|jar
Milk|cow|white|drink|glass|dairy
Lemonade|sour|yellow|drink|stand|summer
Hot chocolate|cocoa|warm|drink|marshmallow|winter
Pretzel|twisted|salty|knot|snack|bread
Muffin|blueberry|breakfast|bake|cupcake|top
Smoothie|blend|fruit|drink|yogurt|straw
Yogurt|cup|dairy|spoon|fruit|creamy
Toast|bread|butter|breakfast|brown|crunchy
Omelette|eggs|breakfast|fold|cheese|pan
Kitchen|cook|stove|fridge|food|room
Bathroom|toilet|shower|sink|tub|mirror
Bedroom|sleep|pillow|closet|blanket|dresser
Bed|sleep|pillow|blanket|mattress|sheets
Pillow|bed|head|sleep|soft|fight
Blanket|warm|bed|cover|cozy|quilt
Chair|sit|seat|legs|table|furniture
Table|chair|dinner|legs|wood|furniture
Sofa|couch|sit|living|cushion|furniture
Lamp|light|bulb|shade|desk|switch
Clock|time|hands|tick|wall|alarm
Mirror|reflection|glass|look|face|bathroom
Window|glass|look|open|curtain|pane
Door|open|close|knock|handle|key
Stairs|steps|up|down|climb|floor
Refrigerator|cold|food|fridge|kitchen|freezer
Oven|bake|hot|kitchen|cook|stove
Microwave|heat|kitchen|popcorn|beep|minutes
Toaster|bread|pop|kitchen|slots|breakfast
Umbrella|rain|wet|open|dry|cover
Toothbrush|teeth|paste|bristles|clean|dentist
Soap|wash|bubbles|clean|hands|bar
Towel|dry|bath|wet|beach|cloth
Shower|water|bath|wash|clean|head
Bathtub|water|bubbles|soak|wash|duck
Key|lock|door|open|ring|unlock
Scissors|cut|paper|blades|sharp|snip
Candle|wax|flame|wick|light|birthday
Television|TV|watch|remote|screen|shows
Remote control|TV|buttons|channel|change|couch
Telephone|call|ring|talk|dial|mobile
Camera|photo|picture|snap|lens|flash
Computer|keyboard|mouse|screen|laptop|internet
Backpack|school|bag|carry|straps|books
Wallet|money|pocket|cards|cash|purse
Glasses|eyes|see|lenses|frames|wear
Hat|head|wear|cap|brim|sun
Shoes|feet|laces|wear|pair|sneakers
Socks|feet|pair|wear|shoes|toes
Gloves|hands|fingers|winter|warm|mittens
Scarf|neck|winter|warm|wrap|wool
Jacket|coat|wear|zipper|warm|sleeves
Pajamas|sleep|bed|night|wear|pjs
Sunglasses|eyes|dark|shades|summer|bright
Watch|time|wrist|clock|hands|wear
Necklace|jewelry|chain|wear|pendant|pearls
Crown|king|queen|head|gold|jewels
Balloon|air|party|pop|float|string
Kite|fly|wind|string|sky|tail
Teddy bear|toy|stuffed|soft|cuddle|hug
Doll|toy|play|girl|dress|baby
Yo-yo|string|toy|up|down|spin
Puzzle|pieces|jigsaw|fit|solve|picture
Ladder|climb|rungs|steps|up|tall
Hammer|nail|hit|tool|bang|build
Broom|sweep|floor|clean|witch|dust
Vacuum cleaner|dust|suck|carpet|floor|noise
Bucket|water|pail|handle|carry|sand
Rope|tie|knot|climb|pull|string
Flashlight|torch|dark|battery|beam|bright
Map|directions|travel|lost|world|treasure
Globe|world|earth|spin|map|round
Book|read|pages|story|library|cover
Pencil|write|lead|eraser|draw|sharpen
Eraser|rubber|mistake|pencil|remove|rub
Crayon|color|draw|wax|kids|box
Paintbrush|art|bristles|canvas|color|artist
Notebook|write|paper|pages|school|notes
Ruler|measure|inches|straight|line|centimeters
Calculator|math|numbers|add|buttons|solve
Teacher|school|class|students|lesson|homework
Classroom|school|desk|teacher|students|board
Homework|school|teacher|assignment|study|night
Library|books|quiet|borrow|read|shelves
Chalkboard|school|teacher|write|black|eraser
Lunchbox|school|food|carry|sandwich|meal
School bus|yellow|kids|ride|driver|stop
Recess|playground|break|school|play|outside
Exam|test|school|study|grade|questions
Alphabet|letters|ABC|26|learn|song
Science|experiment|lab|chemistry|physics|biology
Math|numbers|add|subtract|school|equation
History|past|school|events|old|dates
Graduation|cap|gown|diploma|school|finish
Doctor|hospital|sick|medicine|nurse|stethoscope
Nurse|hospital|doctor|care|patient|sick
Dentist|teeth|cavity|brush|drill|floss
Firefighter|truck|hose|hero|rescue|flames
Police officer|cop|law|badge|siren|arrest
Chef|cook|kitchen|restaurant|food|hat
Farmer|crops|tractor|animals|barn|field
Pilot|plane|fly|airport|cockpit|captain
Astronaut|space|rocket|moon|suit|NASA
Mail carrier|letters|deliver|postman|stamps|packages
Baker|bread|oven|cakes|flour|pastry
Builder|construct|house|hammer|hard hat|tools
Artist|paint|draw|canvas|museum|creative
Singer|song|voice|music|microphone|concert
Magician|trick|rabbit|hat|wand|cards
Clown|circus|funny|nose|red|makeup
Lifeguard|pool|beach|swim|save|whistle
Scientist|lab|experiment|coat|research|science
Librarian|books|library|quiet|shh|borrow
Mechanic|car|fix|garage|repair|engine
Plumber|pipes|water|leak|fix|toilet
Detective|mystery|clue|solve|magnifying|case
Photographer|camera|pictures|photos|snap|lens
Zookeeper|animals|feed|care|cage|lions
Waiter|restaurant|food|serve|order|tip
Barber|hair|cut|scissors|shave|shop
Taxi driver|cab|car|ride|yellow|passenger
Beach|sand|ocean|waves|sun|swim
Mountain|climb|high|peak|snow|hill
Forest|trees|woods|green|animals|jungle
Desert|sand|hot|dry|cactus|camel
Island|water|ocean|surrounded|beach|land
Volcano|lava|erupt|mountain|hot|ash
Waterfall|river|cliff|splash|drop|Niagara
River|water|flow|stream|boat|bank
Lake|water|pond|fish|swim|boat
Ocean|sea|water|waves|salt|blue
Cave|dark|rock|bats|underground|explore
Jungle|trees|rainforest|monkeys|vines|tropical
Rainbow|colors|sky|arc|sun|seven
Sun|hot|sky|star|light|day
Moon|night|sky|full|crescent|space
Star|sky|night|shine|twinkle|space
Cloud|sky|white|rain|fluffy|weather
Rain|water|wet|umbrella|drops|cloud
Snow|cold|white|winter|flakes|sled
Thunderstorm|lightning|rain|loud|clouds|rumble
Tornado|wind|twister|spin|storm|funnel
Wind|blow|air|breeze|kite|weather
Tree|leaves|branches|trunk|wood|forest
Flower|petals|garden|bloom|rose|smell
Sunflower|yellow|tall|seeds|petals|plant
Rose|red|flower|thorns|petals|smell
Cactus|desert|spiky|plant|prickly|green
Grass|green|lawn|mow|yard|blades
Leaf|tree|green|fall|autumn|branch
Acorn|oak|tree|nut|squirrel|seed
Seashell|beach|ocean|sand|collect|conch
Puddle|rain|water|splash|jump|wet
Iceberg|Titanic|ocean|cold|float|frozen
Earthquake|shake|ground|tremble|cracks|Richter
Fog|mist|cloud|see|gray|morning
Sunset|evening|orange|sky|dusk|night
Sunrise|morning|dawn|early|sky|wake
Planet|space|Earth|orbit|Mars|solar
Comet|space|tail|ice|sky|streak
Rocket|space|launch|blast|NASA|fly
Pyramid|Egypt|triangle|pharaoh|ancient|tomb
Moon landing|Apollo|astronaut|space|1969|step
Statue|stone|sculpture|carve|still|monument
Castle|king|queen|tower|knight|moat
Lighthouse|ship|coast|tower|beam|rocks
Zoo|animals|cage|visit|lions|keeper
Farm|animals|barn|tractor|cow|crops
Airport|plane|fly|gate|travel|luggage
Hospital|doctor|nurse|sick|emergency|patient
Restaurant|food|eat|waiter|menu|dinner
Supermarket|food|groceries|cart|shopping|store
Playground|swing|slide|kids|park|recess
Park|trees|grass|bench|playground|walk
Museum|art|history|exhibit|visit|old
Movie theater|film|popcorn|screen|cinema|seats
Circus|clown|tent|acrobat|ring|elephant
Amusement park|rides|roller coaster|fun|tickets|theme
Bakery|bread|cakes|oven|pastry|shop
Post office|mail|letters|stamps|send|package
Swimming pool|water|dive|lifeguard|splash|deep end
Bridge|cross|river|over|road|span
City|buildings|town|people|streets|busy
Skyscraper|tall|building|city|floors|elevator
Tent|camping|sleep|outdoor|poles|canvas
Igloo|ice|snow|house|cold|Eskimo
Treehouse|ladder|kids|wood|backyard|fort
Garden|flowers|plants|grow|soil|vegetables
Barn|farm|animals|red|hay|cow
Car|drive|wheels|road|engine|vehicle
Bicycle|bike|pedal|wheels|ride|two
Bus|ride|stop|passengers|school|driver
Train|tracks|railway|station|choo|carriage
Airplane|fly|wings|pilot|sky|airport
Helicopter|fly|blades|spin|chopper|hover
Boat|water|sail|float|ship|row
Submarine|underwater|ocean|periscope|dive|yellow
Motorcycle|bike|ride|helmet|wheels|engine
Skateboard|ride|wheels|tricks|ramp|ollie
Scooter|ride|kick|wheels|handle|push
Tractor|farm|field|drive|plow|green
Fire truck|red|ladder|siren|hose|emergency
Ambulance|hospital|siren|emergency|sick|paramedic
Hot air balloon|fly|basket|float|sky|fire
Sailboat|wind|water|mast|ocean|yacht
Canoe|paddle|boat|river|row|kayak
Traffic jam|cars|stuck|slow|road|rush
Traffic light|red|green|yellow|stop|go
Roller coaster|ride|fast|loop|scream|amusement
Ferris wheel|ride|big|carnival|round|fair
Soccer|ball|kick|goal|football|team
Basketball|hoop|dribble|net|court|slam dunk
Baseball|bat|pitch|home run|glove|innings
Tennis|racket|ball|net|court|serve
Golf|club|hole|ball|course|tee
Swimming|water|pool|stroke|float|laps
Running|race|fast|jog|legs|marathon
Bowling|pins|ball|strike|lane|alley
Skiing|snow|mountain|slope|poles|winter
Surfing|wave|board|ocean|beach|ride
Ice skating|rink|glide|winter|blades|figure
Volleyball|net|spike|beach|serve|team
Hockey|ice|stick|puck|goal|skates
Karate|kick|chop|belt|martial|Japan
Gymnastics|flip|tumble|balance|beam|Olympics
Olympics|games|medal|gold|athletes|torch
Trophy|win|cup|award|gold|prize
Medal|gold|silver|bronze|win|Olympics
Referee|whistle|game|rules|judge|foul
Jump rope|skip|playground|exercise|double dutch|count
Hide and seek|game|count|find|ready|closet
Fishing|rod|hook|bait|lake|catch
Camping|tent|outdoors|fire|sleeping bag|woods
Hiking|walk|trail|mountain|boots|nature
Painting|brush|canvas|art|color|easel
Drawing|pencil|sketch|art|paper|picture
Dancing|dance|music|move|ballet|steps
Singing|song|voice|music|karaoke|choir
Cooking|food|kitchen|chef|recipe|stove
Baking|oven|cake|bread|cookies|flour
Reading|book|words|story|pages|library
Gardening|plants|flowers|soil|grow|dig
Knitting|yarn|needles|wool|sweater|scarf
Juggling|balls|throw|catch|clown|air
Chess|king|queen|board|checkmate|pawn
Video game|play|controller|console|screen|level
Board game|dice|play|pieces|family|turn
Photography|camera|picture|lens|snap|shoot
Guitar|strings|music|strum|play|rock
Piano|keys|music|play|black|white
Drums|beat|sticks|music|bang|rhythm
Violin|strings|bow|music|play|fiddle
Trumpet|brass|blow|music|horn|play
Birthday|cake|candles|party|presents|age
Halloween|costume|candy|trick|treat|October
Christmas|Santa|tree|presents|December|snow
Thanksgiving|turkey|November|feast|thankful|family
New Year|midnight|countdown|January|fireworks|resolution
Fireworks|boom|sky|colors|night|celebrate
Snowman|carrot|winter|build|frosty|scarf
Santa Claus|Christmas|beard|presents|sleigh|reindeer
Party|celebrate|guests|fun|music|birthday
Picnic|basket|blanket|park|food|outside
Vacation|holiday|travel|trip|beach|relax
Present|gift|wrap|box|bow|birthday
Costume|dress|Halloween|wear|disguise|mask
Mask|face|cover|costume|hide|wear
Pirate|ship|treasure|parrot|eye patch|sail
Treasure chest|gold|pirate|coins|box|jewels
Robot|machine|metal|beep|computer|android
Alien|space|UFO|green|Mars|outer
Ghost|boo|white|haunted|spooky|sheet
Witch|broom|hat|spell|cauldron|Halloween
Wizard|magic|wand|spell|hat|beard
Superhero|cape|powers|save|fly|villain
Knight|armor|horse|castle|king|shield
Princess|crown|castle|queen|royal|tiara
Fairy|wings|magic|small|wand|tooth
Giant|big|tall|huge|beanstalk|ogre
Snowball|throw|fight|round|winter|cold
Sandcastle|beach|build|bucket|towers|moat
Bubble|soap|blow|pop|float|round
Shadow|dark|light|follow|sun|silhouette
Echo|repeat|sound|cave|voice|bounce
Dream|sleep|night|bed|nightmare|imagine
Sneeze|nose|achoo|cold|bless|tissue
Yawn|tired|sleepy|mouth|bored|open
Hiccup|breath|stop|throat|scare|water
Tickle|laugh|fingers|feet|giggle|funny
Hug|arms|squeeze|love|embrace|friend
Smile|happy|teeth|mouth|grin|face
Laugh|funny|joke|ha|giggle|smile
Whisper|quiet|secret|soft|ear|voice
Nap|sleep|short|afternoon|rest|tired
Alarm clock|wake|morning|ring|beep|snooze
Breakfast|morning|eat|cereal|eggs|meal
Lunch|noon|meal|eat|sandwich|midday
Dinner|evening|meal|eat|supper|night
Weekend|Saturday|Sunday|off|relax|school
Morning|sunrise|early|wake|breakfast|day
Bedtime|sleep|night|story|pajamas|tired
Shopping|buy|store|mall|money|bags
Laundry|clothes|wash|dryer|machine|dirty
Grocery list|shopping|food|write|buy|store
Haircut|scissors|barber|trim|salon|short
Sleepover|friends|night|party|pajamas|movie
Road trip|car|drive|travel|highway|vacation
Selfie|photo|phone|camera|picture|yourself
Fingerprint|unique|detective|police|thumb|ink
Footprint|sand|track|step|shoe|mud
Heartbeat|pulse|thump|doctor|chest|rhythm
Skeleton|bones|skull|body|Halloween|ribs
Brain|think|head|smart|mind|organ
Tooth|teeth|mouth|bite|dentist|fairy
Nose|smell|face|sniff|nostrils|sneeze
Ear|hear|listen|head|sound|lobe
Eye|see|look|blink|vision|face
Hand|fingers|five|wave|palm|arm
Foot|toes|walk|shoe|leg|sock
Hair|head|comb|brush|cut|long
Beard|face|hair|chin|shave|mustache
Mustache|lip|hair|face|beard|curly
Rubber duck|bath|yellow|toy|squeak|float
Piggy bank|money|save|coins|slot|oink
Paper airplane|fold|throw|fly|wings|origami
Snow globe|shake|glass|ball|scene|winter
Magnet|metal|stick|fridge|attract|pole
Telescope|stars|look|space|lens|far
Microscope|small|lens|science|cells|look
Compass|north|direction|needle|south|map
Hourglass|sand|time|timer|flip|minutes
Thermometer|temperature|hot|cold|fever|degrees
Wheelbarrow|garden|push|dirt|carry|cart
Trampoline|jump|bounce|high|springs|backyard
Swing|playground|push|back|forth|seat
Slide|playground|down|slippery|climb|ladder
Sandbox|play|kids|bucket|shovel|backyard
Hammock|swing|relax|trees|lie|rope
Fireplace|warm|chimney|logs|wood|flames
Chimney|smoke|roof|Santa|fireplace|brick
Mailbox|letters|post|send|stamp|flag
Doorbell|ring|button|ding|visitor|knock
Fence|yard|wall|wood|gate|boundary
Garage|car|park|door|tools|house
Attic|roof|top|house|storage|dusty
Basement|under|house|downstairs|cellar|dark
Elevator|up|down|floors|buttons|lift
Escalator|stairs|moving|mall|up|down
Lawn mower|grass|cut|yard|engine|push
Snowflake|winter|cold|white|unique|frozen
Icicle|ice|hanging|cold|drip|winter
Avalanche|snow|mountain|slide|fall|danger
Glacier|ice|slow|melt|mountain|cold
Coral reef|ocean|fish|colorful|underwater|Australia
Seaweed|ocean|green|plant|slimy|sushi
Pebble|stone|small|rock|smooth|beach
Diamond|ring|shiny|jewel|hard|gem
Gold|metal|shiny|yellow|treasure|coins
Coin|money|penny|round|metal|flip
Piggyback|ride|carry|shoulders|kid|hold
Pillow fight|hit|feathers|fun|sleepover|soft
Tug of war|rope|pull|team|game|strength
Musical chairs|stop|sit|game|party|circle
Sack race|jump|bag|hop|potato|picnic
Magic trick|wand|card|rabbit|illusion|hat
Card game|deck|play|shuffle|deal|hand
Dice|roll|six|numbers|game|cube
Jigsaw|puzzle|pieces|fit|picture|edges
Coloring book|crayons|pages|pictures|kids|lines
Comic book|superhero|pictures|story|panels|read
Fairy tale|once upon|princess|story|happily|magic
Lullaby|song|sleep|baby|soft|night
Bookshelf|library|read|wood|store|stack
Calendar|days|months|year|date|week
Newspaper|read|daily|headline|morning|print
Envelope|letter|mail|stamp|seal|send
Postcard|mail|picture|vacation|send|stamp
Stamp|mail|letter|envelope|post|stick
Gift card|present|store|money|shop|plastic
Recipe|cook|ingredients|instructions|food|bake
Shopping cart|wheels|store|push|groceries|basket
Price tag|cost|money|label|store|sale
Cash register|money|store|pay|drawer|checkout
Vending machine|snacks|coins|buy|drinks|button
Parking lot|cars|spaces|mall|lines|garage
Gas station|fuel|car|pump|fill|petrol
Car wash|clean|soap|water|suds|vehicle
Seatbelt|car|safety|buckle|click|strap
Steering wheel|car|drive|turn|driver|hands
Tire|wheel|car|rubber|flat|round
Windshield wiper|car|rain|glass|window|swish
Speed bump|road|slow|car|street|hump
Crosswalk|street|stripes|pedestrian|zebra|lights
Stop sign|red|road|octagon|traffic|halt
Lemonade stand|sell|kids|summer|cups|drink
Ice cream truck|music|summer|van|kids|cone
Bubble gum|chew|pink|blow|sticky|pop
Cotton candy|pink|fluffy|sugar|fair|stick
Popsicle|ice|stick|cold|summer|frozen
Milkshake|ice cream|straw|drink|thick|chocolate
Food truck|street|eat|van|window|lunch
Birthday cake|candles|frosting|wish|party|blow
Gingerbread man|cookie|Christmas|run|catch|house
Pumpkin pie|Thanksgiving|dessert|orange|slice|whipped cream
Spider web|silk|sticky|catch|weave|corner
Bird nest|eggs|twigs|tree|build|chicks
Beehive|bees|honey|buzz|wax|queen
Anthill|ants|dirt|colony|small|mound
Caterpillar|butterfly|green|crawl|cocoon|leaves
Tadpole|frog|baby|pond|swim|tail
Dragonfly|wings|insect|pond|buzz|summer
Firefly|light|glow|night|bug|summer
Seahorse|ocean|fish|curly|tail|pony
Walrus|tusks|ice|whiskers|Arctic|blubber
Seal|ocean|clap|flippers|ice|bark
Sloth|slow|tree|hang|lazy|sleepy
Raccoon|mask|trash|night|stripes|bandit
Skunk|smell|stink|black|white|stripe
Beaver|dam|teeth|wood|river|tail
Moose|antlers|Canada|big|deer|forest
Llama|wool|spit|Peru|alpaca|neck
Ostrich|bird|big|fast|egg|run
Swan|white|bird|lake|neck|graceful
Pelican|bird|beak|pouch|fish|big
Woodpecker|bird|tree|knock|beak|drum
Hummingbird|small|fast|wings|nectar|hover
Toucan|beak|bird|colorful|tropical|big
Chameleon|color|change|lizard|tongue|blend
Lizard|reptile|scales|tail|small|gecko
Cheetah|fast|spots|cat|run|Africa
Leopard|spots|cat|jungle|big|fast
Bulldog|wrinkly|breed|face|puppy|drool
Poodle|dog|curly|fluffy|French|breed
Hula hoop|spin|hips|circle|plastic|twirl
Snorkel|swim|underwater|breathe|tube|mask
Life jacket|float|water|boat|vest|safety
Sunscreen|burn|lotion|beach|protect|SPF
Flip-flops|sandals|feet|beach|summer|toes
Swimsuit|beach|pool|wear|bathing|summer
Bucket list|things|do|before|dreams|goals
Time machine|travel|past|future|clock|history
Space station|orbit|astronaut|NASA|float|ISS
Solar system|sun|planets|orbit|space|Earth
Black hole|space|gravity|dark|star|pull
Meteor|space|rock|falling|shooting|star
Treasure map|pirate|X|island|gold|dig
Message in a bottle|ocean|note|float|letter|beach
Paper boat|fold|float|water|origami|puddle
Origami|paper|fold|Japan|crane|art
Sculpture|statue|art|clay|carve|stone
Marathon|run|race|long|miles|finish
Finish line|race|end|win|tape|cross
Gold medal|first|win|Olympics|champion|winner
High five|hand|slap|celebrate|clap|palm
Thumbs up|good|okay|like|hand|approve
Wave|hand|hello|goodbye|ocean|water
Handshake|greet|meet|deal|grip|hello
Applause|clap|hands|cheer|audience|bravo
Campfire|camping|marshmallows|logs|stories|flames
Sleeping bag|camping|zip|tent|warm|outdoors
Backpacking|hike|travel|bag|trail|camping
Compass rose|map|north|south|east|west
Passport|travel|country|airport|stamp|visa
Suitcase|travel|pack|clothes|luggage|wheels
Souvenir|trip|remember|gift|shop|vacation
Hotel|room|stay|bed|vacation|check-in
Tourist|visit|camera|travel|sightseeing|vacation
Snowboard|mountain|ride|winter|slope|ski
Sled|snow|hill|slide|winter|ride
Raincoat|wet|yellow|hood|jacket|waterproof
Rain boots|wet|feet|puddle|wellies|rubber
Earmuffs|ears|warm|winter|cold|fluffy
Mittens|hands|warm|winter|gloves|thumb
Bonfire|big|night|wood|burn|flames
Treasure hunt|clues|find|search|map|pirate
Scavenger hunt|list|find|items|search|game
Spelling bee|words|contest|letters|school|competition
Science fair|project|school|experiment|volcano|display
Field trip|school|bus|class|visit|teacher
Report card|grades|school|teacher|parents|marks
Pencil case|pens|school|zip|box|erasers
Glue stick|paper|craft|school|paste|tube
Sticker|peel|label|paper|reward|shiny
Paper clip|metal|hold|office|bend|sheets
Stapler|paper|office|click|attach|metal
Highlighter|yellow|marker|bright|text|pen
Whiteboard|marker|erase|write|classroom|wipe
Sticky note|yellow|paper|reminder|office|square
`;

export interface SmuggleCard {
  w: string;
  ban: string[];
}

export const CARDS: readonly SmuggleCard[] = RAW.trim()
  .split("\n")
  .map((line) => line.split("|").map((x) => x.trim()))
  .filter((parts) => parts.length === 6 && parts.every(Boolean))
  .map(([w, ...ban]) => ({ w, ban }));

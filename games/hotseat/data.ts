// Hot Seat question bank (server-only, original). One question per line:
// question|emoji Option|emoji Option            (this-or-that / would-you-rather: 2 options)
// question|emoji Option|emoji Option|emoji Option|emoji Option   (pick one of four)
const RAW = `
Would you rather explore the deep sea or outer space?|🌊 Deep sea|🚀 Outer space
Would you rather be able to fly or be invisible?|🦅 Fly|👻 Be invisible
Would you rather talk to animals or speak every human language?|🐶 Talk to animals|🗣️ Speak every language
Would you rather live without music or without movies?|🎵 No music|🎬 No movies
Would you rather always be 10 minutes early or 10 minutes late?|⏰ Always early|🐢 Always late
Would you rather have a rewind button or a pause button for life?|⏪ Rewind button|⏸️ Pause button
Would you rather live in a treehouse or a houseboat?|🌳 Treehouse|⛵ Houseboat
Would you rather eat only sweet food or only savory food forever?|🍰 Only sweet|🧀 Only savory
Would you rather be famous for a hit song or a bestselling book?|🎤 A hit song|📚 A bestselling book
Would you rather have a personal chef or a personal driver?|🍳 Personal chef|🚗 Personal driver
Would you rather never feel cold again or never feel too hot again?|🧣 Never cold|🔥 Never too hot
Would you rather read minds or see the future?|🧠 Read minds|🔮 See the future
Would you rather live in a big city or the countryside forever?|🏙️ Big city|🌾 Countryside
Would you rather have a pet dragon or a pet unicorn?|🐉 Dragon|🦄 Unicorn
Would you rather time travel to the past or to the future?|🏛️ The past|🛸 The future
Would you rather give up your phone or your bed for a week?|📱 Give up phone|🛏️ Give up bed
Would you rather sing everything you say or rhyme everything you say?|🎶 Sing it all|📝 Rhyme it all
Would you rather be the funniest or the smartest person in the room?|😂 Funniest|🤓 Smartest
Would you rather have unlimited pizza or unlimited ice cream?|🍕 Pizza|🍦 Ice cream
Would you rather go on a road trip or a cruise?|🚙 Road trip|🚢 Cruise
Would you rather instantly know every fact or instantly have every skill?|📖 Every fact|🛠️ Every skill
Would you rather have a photographic memory or perfect pitch?|📸 Photographic memory|🎼 Perfect pitch
Would you rather never need to sleep or never need to eat?|😴 No sleep needed|🍽️ No food needed
Would you rather live on the moon or under the ocean?|🌙 On the moon|🐠 Under the ocean
Would you rather be a wizard or a superhero?|🧙 Wizard|🦸 Superhero
Would you rather be able to teleport anywhere or pause time?|✨ Teleport|⏳ Pause time
Would you rather have a robot butler or a magic closet?|🤖 Robot butler|🚪 Magic closet
Would you rather give up chocolate or cheese forever?|🍫 Give up chocolate|🧀 Give up cheese
Would you rather explore a jungle or a desert?|🌴 Jungle|🏜️ Desert
Would you rather always win board games or always win video games?|🎲 Board games|🎮 Video games
Would you rather have a giant library or a home cinema?|📚 Giant library|🍿 Home cinema
Would you rather be a kid again for a day or skip ahead ten years?|🧸 Kid for a day|⏩ Skip ten years
Would you rather live without the internet or without air conditioning?|🌐 No internet|❄️ No AC
Would you rather have hiccups for a day or sneeze every hour?|😮 Hiccups all day|🤧 Hourly sneezes
Would you rather be an amazing dancer or an amazing singer?|💃 Dancer|🎤 Singer
Would you rather visit every country or every planet?|🗺️ Every country|🪐 Every planet
Would you rather wear pajamas everywhere or a suit everywhere?|🛌 Pajamas everywhere|👔 A suit everywhere
Would you rather have a talking car or a talking fridge?|🚗 Talking car|🧊 Talking fridge
Would you rather only be able to whisper or only be able to shout?|🤫 Only whisper|📢 Only shout
Would you rather be the best on a losing team or the worst on a winning team?|🌟 Best on losing team|🏆 Worst on winning team
Would you rather cook every meal or wash every dish?|🍳 Cook everything|🧽 Wash everything
Would you rather have a snow day or a beach day?|☃️ Snow day|🏖️ Beach day
Would you rather write a movie or star in one?|✍️ Write it|🎭 Star in it
Would you rather redo your school years or skip straight to retirement?|🎒 Redo school|🏝️ Retire now
Would you rather have super speed or super strength?|⚡ Super speed|💪 Super strength
Would you rather live in a castle or a spaceship?|🏰 Castle|🚀 Spaceship
Would you rather never use social media again or never watch TV again?|📲 No social media|📺 No TV
Would you rather breathe underwater or see in the dark?|🐟 Breathe underwater|🦉 See in the dark
Would you rather get a lifetime of free flights or free food?|✈️ Free flights|🍔 Free food
Would you rather spend a day at a theme park or a museum?|🎢 Theme park|🖼️ Museum
Would you rather camp in a tent or stay in a fancy hotel?|⛺ Tent|🏨 Fancy hotel
Would you rather be stuck in an elevator or on a ski lift for an hour?|🛗 Elevator|🚡 Ski lift
Would you rather have a theme song when you enter or a laugh track all day?|🎺 Theme song|😆 Laugh track
Would you rather be a famous chef or a famous athlete?|🍝 Famous chef|🏅 Famous athlete
Would you rather have a clone of yourself or a time machine?|🧬 A clone|🕰️ Time machine
Would you rather explore an abandoned mall or a spooky old castle?|🛍️ Abandoned mall|🏚️ Spooky castle
Would you rather eat breakfast food or dinner food for every meal?|🥞 Breakfast always|🍛 Dinner always
Would you rather have unlimited books or unlimited games?|📕 Unlimited books|🕹️ Unlimited games
Would you rather be able to shrink tiny or grow giant?|🐜 Shrink tiny|🦕 Grow giant
Would you rather spend a day as a cat or as a dog?|🐱 A cat|🐶 A dog
Would you rather live in a world without colors or without sounds?|🎨 No colors|🔇 No sounds
Would you rather win an Olympic medal or an Oscar?|🥇 Olympic medal|🏆 An Oscar
Would you rather have a house with an indoor slide or a secret room?|🎢 Indoor slide|🗝️ Secret room
Would you rather know the answer to everything or be able to fix anything?|💡 Know everything|🔧 Fix anything
Would you rather travel by hot air balloon or by submarine?|🎈 Hot air balloon|🐋 Submarine
Would you rather have a huge garden or a swimming pool?|🌻 Huge garden|🏊 Swimming pool
Would you rather give a speech to a thousand people or sing to ten?|🎙️ Speech to 1000|🎵 Sing to 10
Would you rather spend a year without sugar or without coffee and tea?|🍬 No sugar|☕ No coffee or tea
Would you rather be the main character or the wise sidekick?|🦸 Main character|🦉 Wise sidekick
Would you rather meet your great-great-grandparents or great-great-grandkids?|📜 Ancestors|👶 Descendants
Would you rather have a mansion in a dull town or a tiny flat in a great city?|🏡 Big dull mansion|🌆 Tiny cool flat
Would you rather take one big trip a year or lots of small weekend trips?|🌍 One big trip|🧳 Many small trips
Would you rather have a skip button for chores or for traffic jams?|🧹 Skip chores|🚦 Skip traffic
Would you rather be a professional gamer or a professional video creator?|🎮 Pro gamer|📹 Video creator
Would you rather wear one color forever or never wear the same outfit twice?|🎨 One color forever|👗 Never repeat outfits
Would you rather live inside a video game or inside a cartoon?|👾 A video game|🖍️ A cartoon
Would you rather have to dance whenever music plays or sing along to every song?|🕺 Always dance|🎶 Always sing along
Would you rather control the weather or control time?|⛈️ Weather|⏱️ Time
Would you rather win a free vacation or a free year of groceries?|🏝️ Free vacation|🛒 Free groceries
Would you rather chat with your younger self or your older self?|🧒 Younger self|🧓 Older self
Would you rather be stranded on an island alone or with your chattiest friend?|🏝️ Alone|🗣️ Chattiest friend
Would you rather have a dream job with low pay or a boring job with high pay?|❤️ Dream job, low pay|💰 Boring, high pay
Would you rather never wait in line again or never sit in traffic again?|🧍 No lines|🚗 No traffic
Would you rather have a perfect hair day daily or never need to iron again?|💇 Perfect hair always|👕 Never iron again
Would you rather explore a volcano or a glacier?|🌋 Volcano|🏔️ Glacier
Would you rather live above a bakery or above a bookstore?|🥐 Bakery|📖 Bookstore
Would you rather see a real dinosaur or a real mermaid?|🦖 Dinosaur|🧜 Mermaid
Would you rather instantly learn any instrument or any sport?|🎸 Any instrument|⚽ Any sport
Would you rather sleep in a hammock or a waterbed every night?|🌴 Hammock|💧 Waterbed
Would you rather host every party or just attend every party?|🏠 Always host|🎉 Always attend
Would you rather have a dragon's treasure or a wizard's spellbook?|💎 Treasure|📘 Spellbook
Would you rather lose your keys every day or your phone once a month?|🔑 Keys daily|📱 Phone monthly
Would you rather only eat with chopsticks or only eat with a spoon?|🥢 Chopsticks|🥄 Spoon
Would you rather live where it is always spring or always autumn?|🌷 Forever spring|🍂 Forever autumn
Would you rather be invited to everything or be free to skip anything?|📩 Invited to all|🚪 Skip anything
Would you rather be an expert in one thing or decent at everything?|🎯 Expert in one|🌈 Decent at all
Would you rather have a giant trampoline or a zip line in your yard?|🤸 Trampoline|🪂 Zip line
Would you rather be a friendly ghost haunting a library or a bakery?|📚 Haunt a library|🧁 Haunt a bakery
Would you rather ace every quiz or tell perfect jokes every time?|✅ Ace every quiz|🃏 Perfect jokes
Would you rather have the voice of a movie narrator or a cartoon character?|🎬 Movie narrator|🐭 Cartoon voice
Would you rather take a train across a continent or sail across an ocean?|🚂 Train trip|⛵ Ocean sail
Would you rather get an extra hour every day or an extra day every week?|🕐 Extra hour daily|📅 Extra day weekly
Would you rather be a world-class painter or a world-class pianist?|🖌️ Painter|🎹 Pianist
Would you rather get lost in a forest or in a giant hedge maze?|🌲 Forest|🌀 Hedge maze
Would you rather always know the exact time or always know which way is north?|⌚ Always know time|🧭 Always know north
Would you rather have a fluffy tail or wings that cannot fly?|🦊 A fluffy tail|🪶 Useless wings
Would you rather live in a house made of candy or of building blocks?|🍭 Candy house|🧱 Block house
Would you rather do a puzzle for three hours or a workout for one hour?|🧩 Puzzle for hours|🏋️ Workout for an hour
Would you rather swap lives for a day with a celebrity or with your pet?|⭐ A celebrity|🐾 My pet
Would you rather own a fortune cookie that's always right or a magic 8-ball?|🥠 Fortune cookie|🎱 Magic 8-ball
Would you rather have endless energy or endless patience?|🔋 Endless energy|🧘 Endless patience
Would you rather be a secret agent or a detective?|🕶️ Secret agent|🔍 Detective
Would you rather have a lifetime pass to concerts or to sports games?|🎸 Concerts|🏟️ Sports games
Morning person or night owl?|🌅 Morning person|🦉 Night owl
Beach or mountains?|🏖️ Beach|⛰️ Mountains
Cats or dogs?|🐱 Cats|🐶 Dogs
Coffee or tea?|☕ Coffee|🍵 Tea
Sweet snacks or salty snacks?|🍩 Sweet|🥨 Salty
Texting or calling?|💬 Texting|📞 Calling
Books or movies?|📚 Books|🎬 Movies
Summer or winter?|☀️ Summer|❄️ Winter
Early planner or last-minute rusher?|📋 Early planner|🏃 Last-minute rusher
Pancakes or waffles?|🥞 Pancakes|🧇 Waffles
Sunrise or sunset?|🌄 Sunrise|🌇 Sunset
Window seat or aisle seat?|🪟 Window|🚶 Aisle
Big party or small hangout?|🎉 Big party|🛋️ Small hangout
Rainy days or sunny days?|🌧️ Rainy|🌞 Sunny
Pizza or burgers?|🍕 Pizza|🍔 Burgers
Spontaneous trips or planned trips?|🎲 Spontaneous|🗓️ Planned
Introvert or extrovert?|🏡 Introvert|📣 Extrovert
Messy desk or tidy desk?|🌪️ Messy|✨ Tidy
Chocolate or vanilla?|🍫 Chocolate|🍨 Vanilla
Hot shower or cold shower?|🔥 Hot|🧊 Cold
Paper books or e-readers?|📖 Paper|📱 E-reader
Sneakers or sandals?|👟 Sneakers|🩴 Sandals
Fries or onion rings?|🍟 Fries|🧅 Onion rings
Front row or back row?|🔝 Front row|🔙 Back row
Comedy or horror movies?|😂 Comedy|👻 Horror
Binge a whole series or watch one episode a week?|📺 Binge it all|📆 One a week
Phone on silent or ringer on?|🔕 Silent|🔔 Ringer on
Cook at home or order in?|🍳 Cook at home|🛵 Order in
Card games or jigsaw puzzles?|🃏 Card games|🧩 Jigsaw puzzles
Pool or ocean?|🏊 Pool|🌊 Ocean
Mac and cheese or spaghetti?|🧀 Mac and cheese|🍝 Spaghetti
Socks in bed or bare feet?|🧦 Socks on|🦶 Bare feet
Fiction or nonfiction?|🐲 Fiction|🧠 Nonfiction
Handwritten notes or typed notes?|✏️ Handwritten|⌨️ Typed
Morning workout or evening workout?|🌅 Morning|🌙 Evening
A mountain of pillows or just one pillow?|☁️ Pillow mountain|🛏️ Just one
Sweatpants or jeans?|😌 Sweatpants|👖 Jeans
Ketchup or mayo?|🍅 Ketchup|🥚 Mayo
Train or plane?|🚆 Train|✈️ Plane
Leftovers: love them or hate them?|😋 Love them|🙅 Hate them
Pineapple on pizza: yes or no?|🍍 Yes please|🚫 No way
Cereal before milk or milk before cereal?|🥣 Cereal first|🥛 Milk first
Cozy cabin or beach bungalow?|🪵 Cozy cabin|🐚 Beach bungalow
Thunderstorms: cozy or scary?|☕ Cozy|😱 Scary
Superhero movies or animated movies?|🦸 Superhero|🐭 Animated
Podcasts or music on a commute?|🎧 Podcasts|🎵 Music
Crunchy or smooth peanut butter?|🥜 Crunchy|🧈 Smooth
Road trip driver or road trip DJ?|🚗 Driver|🎶 DJ
Ice cream in a cone or in a cup?|🍦 Cone|🍨 Cup
Hoodie or denim jacket?|👕 Hoodie|🧥 Denim jacket
Hours early to the airport or just in time?|🛫 Hours early|⏱️ Just in time
Old classics or new hits?|📻 Old classics|🆕 New hits
Spicy food: bring it on or no thanks?|🌶️ Bring it on|🥛 No thanks
Breakfast in bed or breakfast at a cafe?|🛏️ In bed|🥐 At a cafe
Sunglasses or a hat?|🕶️ Sunglasses|🧢 Hat
Stairs or elevator?|🪜 Stairs|🛗 Elevator
Thrill rides or gentle rides?|🎢 Thrill rides|🎠 Gentle rides
Tacos or burritos?|🌮 Tacos|🌯 Burritos
Snooze button or up at the first alarm?|😴 Snooze|⏰ First alarm
Group chat chatterbox or silent reader?|🗨️ Chatterbox|👀 Silent reader
Fruit or candy?|🍎 Fruit|🍬 Candy
Bath or shower?|🛁 Bath|🚿 Shower
Sudoku or crossword?|🔢 Sudoku|🔤 Crossword
Dark mode or light mode?|🌑 Dark mode|💡 Light mode
Popcorn with butter or caramel?|🧈 Butter|🍯 Caramel
Space movies or ocean documentaries?|🌌 Space movies|🐬 Ocean docs
Pen or pencil?|🖊️ Pen|✏️ Pencil
Sleep with the window open or closed?|🌬️ Open|🔒 Closed
Hugs or high fives?|🤗 Hugs|🙌 High fives
Online shopping or in-store shopping?|💻 Online|🛍️ In-store
Soup or salad?|🍲 Soup|🥗 Salad
Sing in the shower or sing in the car?|🚿 Shower|🚗 Car
Strawberries or blueberries?|🍓 Strawberries|🫐 Blueberries
Watch the game or play the game?|📺 Watch|⚽ Play
Fast walker or slow stroller?|🏃 Fast walker|🐌 Slow stroller
Alarm clock or natural wake-up?|⏰ Alarm clock|🐓 Natural wake-up
Trip photos or trip videos?|📸 Photos|🎥 Videos
Bubble tea or milkshake?|🧋 Bubble tea|🥤 Milkshake
Hot chocolate or iced lemonade?|☕ Hot chocolate|🍋 Iced lemonade
Long weekend at home or away?|🏠 At home|🧳 Away
Thin crust or deep dish?|🍕 Thin crust|🥧 Deep dish
Rollercoasters or water slides?|🎢 Rollercoasters|💦 Water slides
Sticky notes or phone reminders?|🗒️ Sticky notes|📲 Phone reminders
Fireworks or northern lights?|🎆 Fireworks|🌌 Northern lights
Noodles or rice?|🍜 Noodles|🍚 Rice
Mystery novel or fantasy epic?|🕵️ Mystery|🐉 Fantasy
Karaoke: front and center or hiding in the back?|🎤 Front and center|🙈 Hiding in the back
Birthday: big celebration or quiet day?|🎂 Big celebration|🕯️ Quiet day
Dessert first or dessert last?|🍰 First|🍽️ Last
Ocean waves or crackling fire as a sleep sound?|🌊 Ocean waves|🔥 Crackling fire
Unpack right away or live out of the suitcase?|🗄️ Unpack now|🧳 Live out of it
Plants or pets?|🪴 Plants|🐾 Pets
Handwritten letter or video call?|✉️ Letter|📹 Video call
Tidy as you go or one big cleanup?|🧹 As you go|🧺 One big cleanup
Ask for directions or figure it out yourself?|🙋 Ask|🧭 Figure it out
Lemon or lime?|🍋 Lemon|🟢 Lime
Fluffy blanket or light sheet?|🧸 Fluffy blanket|🍃 Light sheet
Matching outfits with friends: fun or cringe?|👯 Fun|😬 Cringe
Cartoons or live action?|🖍️ Cartoons|🎬 Live action
Read the ending first or no spoilers ever?|📖 Ending first|🙉 No spoilers
Giving gifts or receiving gifts?|🎁 Giving|🎀 Receiving
Toast with butter or jam?|🧈 Butter|🍓 Jam
Early dinner or late dinner?|🕔 Early dinner|🕘 Late dinner
Pick your perfect lazy Sunday.|🛋️ Couch and a series|🥾 A long hike|🍳 Big brunch with friends|🎮 Gaming all day
Pick a superpower for doing chores.|🧹 Self-cleaning room|👕 Instant laundry|🍽️ Self-washing dishes|🛒 Auto-groceries
What's your go-to comfort food?|🍕 Pizza|🍜 Noodles|🍫 Chocolate|🍟 Fries
Which pet would you choose if they could all talk?|🐶 Dog|🐱 Cat|🦜 Parrot|🐢 Turtle
Pick your ideal vacation.|🏖️ Beach resort|🏔️ Mountain cabin|🏙️ City tour|🚢 Cruise
What's your karaoke style?|🎤 Power ballad|🕺 Dance hit|🤠 Country tune|🙈 I just hum along
How do you handle a group project?|👑 Take charge|📝 Do the research|🎨 Make it pretty|😅 Show up and nod
Which school subject would you retake just for fun?|🔬 Science|🎨 Art|📜 History|➗ Math
Which dream job did kid-you want most?|🚒 Firefighter|🚀 Astronaut|🦖 Dinosaur expert|🎨 Artist
What's your biggest pet peeve?|🔊 Loud chewing|⏰ People running late|📱 Slow replies|🧦 Socks on the floor
How do you eat your fries?|🍅 With ketchup|🧂 Plain and salty|🧀 Covered in cheese|🍦 Dipped in ice cream
Pick a fictional place to live for a year.|🏰 Fairy-tale castle|🌌 Space station|🧚 Enchanted forest|🏝️ Pirate island
What's your role on a road trip?|🗺️ Navigator|🎶 DJ|🍪 Snack keeper|😴 Professional sleeper
Which season matches your personality?|🌸 Spring|☀️ Summer|🍂 Autumn|❄️ Winter
What do you do first on a day off?|😴 Sleep in|🏃 Go for a run|📱 Scroll my phone|🥞 Make breakfast
Pick your ideal breakfast.|🥞 Pancakes|🍳 Eggs and toast|🥣 Cereal|🥐 Croissant
How would you react to a surprise party?|😭 Happy tears|😱 Total shock|🕺 Instant dancing|😅 Awkward smile
How good are you at cooking, honestly?|🔥 Master chef|🍳 Decent basics|🍜 Instant noodles only|🚒 Smoke alarm risk
Which sound is the most satisfying?|🌧️ Rain on a window|🍳 Sizzling pan|📦 Bubble wrap popping|🍂 Crunchy leaves
Pick a theme for your next birthday party.|🦖 Dinosaurs|🌌 Outer space|⚓ Pirates|🕺 Retro disco
What's your shopping style?|📝 Strict list|🛒 Wander every aisle|🏷️ Only deals|💨 In and out fast
Which animal would you be for a day?|🦅 Eagle|🐬 Dolphin|🐼 Panda|🐆 Cheetah
What's your go-to movie snack?|🍿 Popcorn|🍫 Chocolate|🍭 Candy|🌭 Hot dog
How do you pack for a trip?|📋 Checklist days ahead|🧳 Night before|🎲 Throw stuff in|🤦 Forget half of it
What would you name a pet goldfish?|🐟 Bubbles|👑 Sir Swims-a-Lot|🍕 Pizza|🦈 Jaws
Pick your dream house feature.|🎢 Indoor slide|📚 Secret library|🎬 Home theater|🏊 Rooftop pool
What's your texting style?|📝 Long paragraphs|😂 Only emojis|👍 One-word replies|🎙️ Voice notes
Which chore is the worst?|🍽️ Dishes|👕 Folding laundry|🧹 Vacuuming|🚽 Cleaning the bathroom
How do you spend a rainy day?|📖 Read a book|🎬 Movie marathon|🍪 Bake something|😴 Nap all day
What would you love to collect?|🪙 Coins|🧸 Plush toys|🃏 Trading cards|🌿 Plants
Pick your ideal pizza topping.|🍄 Mushrooms|🍍 Pineapple|🌶️ Peppers|🧀 Extra cheese
What's your vibe at a party?|🕺 On the dance floor|🍕 Near the snacks|🐶 Petting the dog|💬 Deep talk in a corner
Which era would you visit for a week?|🦕 Dinosaur age|🏛️ Ancient Rome|🏰 Medieval times|🕺 The disco seventies
What's your morning drink?|☕ Coffee|🍵 Tea|🧃 Juice|💧 Just water
How do you deal with a bad day?|🍫 Snack therapy|🎧 Loud music|😴 Early night|📞 Call a friend
Pick a mythical creature as your sidekick.|🐉 Dragon|🦄 Unicorn|🧚 Fairy|🔥 Phoenix
What's your favorite way to travel?|✈️ Plane|🚂 Train|🚗 Car|🚲 Bike
Which kind of show would you binge all weekend?|🕵️ Detective mystery|😂 Sitcom|🐾 Nature docs|🍳 Cooking shows
What's your ideal weekend wake-up time?|🌅 Before 7|☀️ Around 9|🕛 Noon|🌙 What is morning?
Pick your ultimate dessert.|🍰 Cake|🍦 Ice cream|🍪 Cookies|🥧 Pie
How do you watch a scary movie?|😎 Totally calm|🙈 Behind a pillow|🗣️ Yelling at the screen|🚪 Leave the room
Which skill would you master overnight?|🎹 Piano|🗣️ A new language|🍳 Gourmet cooking|🎨 Painting
What's your favorite kind of weather?|☀️ Sunny and warm|🌧️ Rainy and cozy|❄️ Snowy|🌬️ Breezy and cool
Pick a road trip snack.|🍪 Cookies|🥨 Pretzels|🍇 Grapes|🍬 Gummies
How organized is your phone?|🗂️ Folders for everything|🌈 Color-coded|😵 Total chaos|🧹 One home screen only
Which job would you try for one week?|🎢 Theme park tester|🍦 Ice cream taster|🐼 Panda keeper|🎮 Game tester
What's your study or work soundtrack?|🎻 Classical|🎧 Lo-fi beats|🔇 Silence|🎤 Pop hits
Pick a dream treehouse upgrade.|🌉 Rope bridge|🔭 Telescope deck|🛏️ Hammock nook|🍿 Snack bar
How do you react when you see a spider?|🏃 Run away|📄 Cup and paper rescue|😱 Scream|🙋 Call for help
What's your go-to excuse to leave early?|🐶 Feed the pet|😴 Super tired|📅 Early start tomorrow|🚗 Beat the traffic
Pick the best place for a picnic.|🌳 Park|🏖️ Beach|🏔️ Hilltop|🛋️ Living room floor
Which emoji do you overuse?|😂 Laughing face|👍 Thumbs up|❤️ Red heart|💀 Skull
What would you do with a surprise free day?|🛌 Sleep|🎢 Adventure|🧹 Catch up on chores|📺 Watch everything
How do you order at a new restaurant?|🔁 Something safe|🎲 The weirdest dish|🙋 Ask the server|👀 Copy a friend
Pick your dream pet, no rules.|🐧 Penguin|🦥 Sloth|🐨 Koala|🦦 Otter
What's your sleeping position?|🌙 On my back|🦐 Curled up|⭐ Starfish|🌀 All over the place
Which game night role is yours?|🏆 Ultra competitive|📖 Rule explainer|🍕 Snack provider|🤡 Chaos maker
What's your ideal dinner group size?|😌 Just one buddy|🍽️ Two or three|🎉 Six or seven|🏟️ A huge crowd
Pick a dream museum to visit.|🦖 Dinosaur museum|🚀 Space museum|🖼️ Art gallery|🍬 Candy museum
How do you handle being lost?|🗺️ Check the map|🙋 Ask a stranger|🚶 Keep walking|📞 Call someone
Which fruit matches your personality?|🍌 Banana|🍉 Watermelon|🍍 Pineapple|🍒 Cherry
What's your go-to sandwich?|🥪 Classic club|🧀 Grilled cheese|🥜 PB and jelly|🥙 Wrap
Pick your ultimate sleepover activity.|🎬 Movies|🎲 Board games|💬 Midnight talks|🍕 Late-night pizza
How do you celebrate good news?|📣 Tell everyone|💃 Happy dance|🍰 Treat myself|🤫 Keep it quiet
What's your favorite thing about weekends?|😴 Sleeping in|🍳 Slow breakfast|🤝 Seeing friends|🎯 Hobby time
Which superhero side job sounds best?|🌙 Night patrol|🐱 Rescuing cats|🚦 Fixing traffic|🌧️ Stopping storms
Pick your dream classroom pet.|🐹 Hamster|🐰 Rabbit|🐠 Fish|🦎 Lizard
How long could you go without your phone?|⏱️ An hour|🌞 A whole day|📅 A week|🏝️ Forever, easy
What's your signature dance move?|🤖 The robot|🌊 The wave|🕺 Disco point|🦆 Awkward shuffle
Which would you bring to a desert island?|🎒 Survival kit|📚 Favorite book|🎸 Guitar|🐶 My pet
How do you leave a get-together?|👋 Quick wave|🤗 Big hugs for all|🗣️ Hour-long goodbye|👻 Vanish quietly
Pick a theme park area to explore first.|🏰 Fairy tale land|🤠 Wild West town|🚀 Future world|🌴 Jungle adventure
What do you always order at a cafe?|☕ Same drink every time|🧁 Something sweet|🥪 A sandwich|🎲 Whatever is new
How do you like your eggs?|🍳 Sunny side up|🥚 Boiled|🌀 Scrambled|🧀 Cheesy omelette
Which magical item would you want?|🧹 Flying broom|🪄 Magic wand|🧞 Wish lamp|🗺️ Map to anywhere
What's your most used app?|💬 Messaging|📸 Photos|🎵 Music|🗺️ Maps
Pick your ideal job perk.|🏠 Work from home|🍕 Free lunch|🐶 Pets at work|🏝️ Extra vacation
Which chore would you happily do forever?|🍳 Cooking|🌱 Gardening|🧺 Laundry|🛒 Grocery runs
How do you study for a big test?|📅 Weeks ahead|🌙 All-nighter|👥 Study group|🍀 Hope for the best
What's your go-to hangout spot?|☕ Cafe|🌳 Park|🛋️ A friend's couch|🛍️ The mall
Pick your coziest evening.|🔥 Fireplace and cocoa|🧩 Big jigsaw puzzle|🎬 Movie night|📖 Book and blanket
What would your autobiography be called?|😂 Oops, Did It Again|🍕 Snacks and Stories|😴 Five More Minutes|🌪️ Organized Chaos
Which ride do you pick first at a fair?|🎡 Ferris wheel|🎢 Rollercoaster|🎠 Carousel|🚗 Bumper cars
How do you eat a cookie?|😋 Whole thing at once|🥛 Dunk in milk|🔍 Tiny nibbles|🧩 Break into pieces
What's your favorite kind of gift?|🎁 Total surprise|📝 Something on my list|✈️ An experience|🍫 Treats
Pick one outfit for the rest of your life.|👕 Tee and jeans|🛌 Cozy pajamas|👔 Smart suit|🎽 Sporty gear
Which kitchen tool are you?|🍳 Frying pan|🥢 Chopsticks|🧂 Salt shaker|🫖 Teapot
What's your bedtime routine?|📖 Read a little|📱 Scroll forever|🎧 Podcast to sleep|😴 Out instantly
Pick a hobby to start tomorrow.|🎨 Painting|🎸 Guitar|🧶 Knitting|🧗 Climbing
Which outdoor activity is your favorite?|🚴 Cycling|🏊 Swimming|🥾 Hiking|🪁 Kite flying
What's your vacation photo style?|🤳 Selfies|🏞️ Landscapes|🍝 Food pics|🙅 No photos at all
How do you wrap presents?|🎀 Perfectly|🛍️ Gift bags only|🌀 Way too much tape|📰 Old newspaper
Which snack do you secretly hide from others?|🍫 Chocolate|🥔 Chips|🍪 Cookies|🍬 Gummies
Pick a dream sports move to master.|⚽ Bicycle kick|🏀 Slam dunk|🎾 Perfect serve|🏊 Olympic swim
How are you with houseplants?|🌿 Green thumb|💀 Plant destroyer|🪴 Fake plants only|🌵 Cactus survivor
How loud is your laugh?|🤭 Silent giggle|😄 Normal|📢 Fills the room|🐷 Snort included
Which would you add to your home?|🎳 Bowling lane|🧗 Climbing wall|🎤 Karaoke room|🍦 Ice cream machine
What's your go-to drink at a party?|🥤 Soda|🧃 Juice|💧 Water|🧋 Bubble tea
Pick a famous landmark to visit.|🗼 Eiffel Tower|🗽 Statue of Liberty|🏯 A Japanese castle|🗿 Easter Island
How do you start a long car ride?|🎶 Playlist ready|🍿 Snacks out|😴 Nap immediately|🗣️ Story time
Which talent show act would you do?|🎩 Magic trick|🤹 Juggling|🎭 Comedy skit|🎻 Violin solo
What's your favorite meal of the day?|🥞 Breakfast|🥪 Lunch|🍝 Dinner|🍪 Midnight snack
Pick your secret hideout.|🌳 Treehouse|🏚️ Dusty attic|🛖 Garden hut|🔦 Hidden basement
How do you react to spoilers?|😤 Furious|🤷 Don't care|🙉 Fingers in ears|📖 I spoil myself
Which quirky skill would you learn?|🎤 Ventriloquism|🃏 Card tricks|🧮 Speed math|🎯 Archery
What do you notice first in a new home?|🎨 The decor|📚 The books|🐶 Any pets|🍪 The snacks
Pick a food you could eat every single day.|🍚 Rice|🍞 Bread|🥔 Potatoes|🍝 Pasta
How competitive are you, really?|😇 Not at all|🙂 A little|😤 Very|🔥 Dangerously
Which thing do you lose most often?|🔑 Keys|🕶️ Sunglasses|🎧 Earbuds|🧦 One sock
What's your role on a group trip?|🗺️ The planner|📸 The photographer|💸 The budget keeper|😴 Along for the ride
Pick a weird ice cream flavor to try.|🥒 Pickle|🧀 Cheese|🌶️ Chili|🥓 Bacon
How do you handle a long queue?|📱 Phone time|💬 Chat with strangers|😤 Sigh loudly|🚶 Walk away
Which animal sound can you copy best?|🐮 Cow|🐱 Cat|🦆 Duck|🐺 Wolf howl
What's your favorite thing to do at the beach?|🏊 Swim|🏰 Sandcastles|📖 Read in the shade|🐚 Collect shells
Pick your ideal study or work spot.|🛏️ In bed|☕ A cafe|📚 A library|🌳 Outdoors
How do you choose a movie to watch?|⭐ Reviews|🎞️ The trailer|🎲 Random pick|🙋 Group vote
Which childhood game would you replay today?|🙈 Hide and seek|🏃 Tag|🪢 Jump rope|🪀 Yo-yo
What's your cooking superpower?|🔥 Perfect grilling|🍰 Baking|🍲 Soups|🥗 Fancy salads
Pick a superpower for school or work.|📚 Instant reading|⏰ Never late|🧠 Perfect memory|☕ Never tired
How do you prefer to say thank you?|✉️ A note|🎁 A small gift|🗣️ Say it loudly|🍪 Bake something
How do you eat a slice of pizza?|🍕 Crust and all|🙅 Leave the crust|🍴 Fork and knife|🌯 Fold it in half
What's your umbrella strategy?|☂️ Always carry one|🏃 Run for it|🧥 Hood up|💧 Enjoy the rain
Pick a dream vehicle.|🏎️ Race car|🚁 Helicopter|🛥️ Speedboat|🛴 Scooter
`;

export type HotQuestion = readonly [question: string, ...options: string[]];

export const QUESTIONS: readonly HotQuestion[] = RAW.trim()
  .split("\n")
  .map((line) => line.split("|").map((x) => x.trim()) as unknown as HotQuestion)
  .filter((q) => (q.length === 3 || q.length === 5) && q.every(Boolean));

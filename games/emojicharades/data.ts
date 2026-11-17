// Server-only: the secret phrases. Never import this from the client.
// Original, generic phrases and common (public-domain) sayings. Lowercase letters,
// spaces, apostrophes and hyphens only, so the letter mask and matching stay simple.

import type { BuiltinCat } from "./shared";

const list = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export const PHRASES: Record<BuiltinCat, string[]> = {
  saying: list(`
    early bird gets the worm
    break a leg
    piece of cake
    raining cats and dogs
    spill the beans
    let the cat out of the bag
    cold feet
    under the weather
    hit the hay
    once in a blue moon
    the ball is in your court
    bite the bullet
    cry over spilled milk
    when pigs fly
    elephant in the room
    time flies
    costs an arm and a leg
    on cloud nine
    hold your horses
    the last straw
    burn the midnight oil
    break the ice
    an apple a day keeps the doctor away
    busy as a bee
    head in the clouds
    walking on eggshells
    a fish out of water
    barking up the wrong tree
    every cloud has a silver lining
    don't count your chickens
    actions speak louder than words
    two peas in a pod
    a needle in a haystack
    curiosity killed the cat
    go the extra mile
    light at the end of the tunnel
    love at first sight
    money doesn't grow on trees
    practice makes perfect
    rome wasn't built in a day
    throw in the towel
    top of the world
    turn over a new leaf
    a storm in a teacup
    home sweet home
    slow and steady wins the race
    out of the frying pan into the fire
    cat got your tongue
    butterflies in my stomach
    the sky is the limit
    cool as a cucumber
    a bird in the hand
  `),
  story: list(`
    a pirate's birthday party
    robot falls in love
    alien lost in the city
    zombie wedding
    haunted pizza shop
    dinosaur goes to school
    vampire at the beach
    ghost on a road trip
    superhero with a cold
    wizard learns to cook
    detective cat solves a mystery
    the shark who was afraid of water
    a dragon's first day at work
    mermaid in the desert
    snowman on summer vacation
    time travelling chef
    the moon goes missing
    a penguin in the jungle
    robbery on a train
    the king loses his crown
    the princess and the robot
    monster under the bed
    treasure hunt on an island
    rock star grandma
    a ghost who is scared of people
    spy at the circus
    the last cookie in the jar
    a unicorn in the big city
    zombies at the mall
    rocket to the moon
    the clown who lost his smile
    an alien at the rodeo
    the frog who became a king
    night at the toy store
    the volcano that sneezed
    a wedding on a boat
    two dogs on a road trip
    the haunted hotel
    the shy dragon
    a snail wins the race
    the octopus chef
    a cowboy in space
    the robot who wanted a puppy
    a witch opens a bakery
  `),
  thing: list(`
    birthday cake
    time machine
    haunted house
    rubber duck
    magic wand
    treasure chest
    roller coaster
    fire truck
    alarm clock
    hot air balloon
    light bulb
    teddy bear
    message in a bottle
    crystal ball
    flying carpet
    snow globe
    traffic jam
    love letter
    broken heart
    pirate ship
    water balloon
    paper airplane
    first aid kit
    lucky charm
    secret diary
    christmas tree
    sand castle
    rocket ship
    golden ticket
    piggy bank
    shooting star
    lost sock
    bubble bath
    sleeping bag
    school bus
    wedding ring
    spider web
    remote control
    rainbow umbrella
    disco ball
  `),
  activity: list(`
    walking the dog
    baking cookies
    camping in the woods
    going to the gym
    taking a selfie
    watching a scary movie
    brushing your teeth
    doing the laundry
    building a snowman
    learning to swim
    riding a bike
    flying a kite
    playing video games
    singing karaoke
    washing the car
    going fishing
    planting a garden
    reading in bed
    making pancakes
    doing yoga
    climbing a mountain
    surfing the waves
    playing chess
    skiing down a mountain
    moving house
    going on a first date
    throwing a surprise party
    painting a portrait
    shopping for shoes
    falling asleep in class
    running a marathon
    telling a ghost story
    taking out the trash
    missing the bus
    dancing in the rain
    feeding the ducks
    going to the dentist
    opening presents
    cooking dinner
    walking on the beach
  `),
  food: list(`
    spaghetti and meatballs
    pizza party
    fish and chips
    peanut butter sandwich
    chocolate chip cookie
    ice cream sundae
    fried egg
    hot chocolate
    apple pie
    banana split
    breakfast in bed
    chicken soup
    popcorn and a movie
    strawberry milkshake
    birthday cupcakes
    bacon and eggs
    cheeseburger
    fruit salad
    corn on the cob
    lemonade stand
    tea party
    hot dog stand
    sushi dinner
    pancake stack
    grilled cheese
    french fries
    carrot cake
    watermelon slice
    chocolate fountain
    coffee break
    candy shop
    baked potato
    midnight snack
    garlic bread
    ramen noodles
    cookies and milk
    fortune cookie
    pineapple pizza
    honey toast
  `),
  place: list(`
    the north pole
    desert island
    haunted castle
    outer space
    the zoo
    a farm
    the dentist's office
    the jungle
    a hospital
    the moon
    an amusement park
    the library
    a movie theater
    the airport
    under the sea
    a fire station
    a train station
    a candy store
    the mountains
    a wedding chapel
    the circus
    a bakery
    a pet shop
    a volcano
    a campsite
    the city at night
    a football stadium
    a police station
    a hair salon
    a pirate island
    a ski resort
    a school classroom
    a museum
    a bank
    a rainforest
    a beach party
    a royal palace
  `),
};

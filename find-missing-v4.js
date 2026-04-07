// find-missing-v4.js — Comprehensive common word gap finder
// Checks the current words.json against a large curated list of everyday
// American English words that most adults would recognize.
// Outputs categorized missing words ready to paste into rebuild-words.js.
//
// Usage: node find-missing-v4.js

const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
const currentWords = new Set(data.words.map(w => w.toUpperCase()));

console.log(`Current dictionary: ${currentWords.size} words\n`);

// ═══════════════════════════════════════════════════════════════════════
// COMMON ENGLISH WORDS — organized by category
// Every word here passes: "Would most American adults recognize this word
// and potentially encounter it in daily life, news, books, or conversation?"
// NO: slurs, explicit, ultra-technical, archaic, UK-only spellings
// ═══════════════════════════════════════════════════════════════════════

const COMMON_WORDS = {

// ─── BODY / HEALTH / MEDICINE ───────────────────────────────────────
body_health: `
thirst throat thumb skull spine wrist ankle elbow kidney liver lung brain
heart stomach muscle nerve tissue organ vein artery pulse temple scalp
forehead cheek nostril eyebrow eyelid jawline ribcage pelvis tendon
ligament bladder intestine colon thyroid gland tonsil marrow cartilage
symptom fever cough sneeze rash bruise blister wound scar itch ache cramp
nausea dizzy faint swollen stiff sore bleed clot fracture sprain strain
surgery vaccine therapy dosage prescription remedy antibiotic vitamin pill
tablet capsule ointment bandage splint crutch wheelchair diagnosis
prognosis terminal chronic acute infection virus bacteria parasite allergy
asthma diabetes cancer tumor stroke seizure concussion migraine insomnia
fatigue anxiety depression trauma disorder syndrome epidemic pandemic
hygiene sterile sanitary nutrition diet calorie protein fiber calcium iron
zinc magnesium potassium sodium cholesterol glucose insulin metabolism
immune antibody hormone adrenaline cortisol serotonin dopamine melatonin
pregnant childbirth infant toddler puberty adolescent elderly dementia
arthritis osteoporosis anemia obesity pneumonia tuberculosis hepatitis
malaria influenza measles chickenpox smallpox polio tetanus rabies
`,

// ─── ANIMALS (commonly known) ──────────────────────────────────────
animals_common: `
sloth parrot turtle tortoise lizard snake frog toad newt salamander
crocodile alligator iguana chameleon gecko python cobra rattlesnake
eagle hawk falcon owl vulture crow raven sparrow robin cardinal
hummingbird pelican flamingo penguin ostrich peacock swan goose duck
pigeon dove seagull stork crane heron woodpecker
whale dolphin shark octopus squid jellyfish starfish seahorse lobster
crab shrimp oyster clam mussel snail slug worm caterpillar butterfly
moth beetle ant spider scorpion tick flea mosquito dragonfly firefly
cricket grasshopper wasp hornet ladybug cockroach centipede
bear wolf fox deer moose elk caribou bison buffalo antelope gazelle
zebra giraffe elephant rhinoceros hippopotamus gorilla chimpanzee monkey
lion tiger leopard jaguar cheetah panther cougar lynx bobcat
rabbit squirrel chipmunk beaver otter weasel ferret skunk porcupine
hedgehog bat mole rat hamster gerbil guinea pig mouse
horse pony donkey mule stallion mare foal colt filly
cow bull calf steer ox goat sheep lamb ram pig hog boar sow piglet
rooster hen chick turkey pheasant quail dove
puppy kitten cub pup fawn joey calf lamb
`,

// ─── FOOD / DRINK (everyday) ───────────────────────────────────────
food_drink: `
thirst hunger appetite feast snack meal brunch lunch dinner supper
breakfast dessert appetizer entree portion serving helping plate bowl
fork knife spoon napkin glass mug pitcher jug bottle carton
bread toast bagel muffin croissant biscuit roll bun loaf crust dough
pasta noodle rice grain cereal oatmeal porridge granola
beef pork chicken turkey lamb veal bacon ham sausage steak chop roast
fillet burger patty meatball meatloaf rib wing breast thigh drumstick
salmon tuna shrimp lobster crab clam oyster mussel cod trout bass
apple orange banana grape strawberry blueberry raspberry cherry peach
pear plum watermelon cantaloupe pineapple mango papaya coconut lemon lime
tomato potato onion garlic pepper carrot celery broccoli cauliflower
spinach lettuce cabbage corn pea bean lentil mushroom cucumber zucchini
avocado olive pickle beet turnip radish squash pumpkin yam
cheese butter cream milk yogurt egg mayo ketchup mustard vinegar
salt sugar honey syrup jam jelly sauce gravy broth soup stew chili
pizza pasta sandwich wrap taco burrito salad sushi casserole omelet
pancake waffle crepe donut cookie cake pie brownie pudding custard
chocolate vanilla caramel cinnamon ginger nutmeg basil oregano parsley
thyme rosemary cumin pepper paprika cayenne
coffee tea juice water soda lemonade milkshake smoothie
beer wine whiskey vodka rum gin tequila champagne cocktail
`,

// ─── NATURE / WEATHER / GEOGRAPHY ──────────────────────────────────
nature_weather: `
earth soil dirt sand gravel clay mud dust ash soot pebble stone
rock boulder cliff ledge cave cavern canyon gorge ravine valley
mountain hill ridge peak summit plateau mesa slope terrain
river stream creek brook pond lake lagoon marsh swamp bog wetland
ocean sea coast shore beach island peninsula cape bay harbor cove inlet
reef coral tide wave current ripple whirlpool geyser waterfall rapids
forest woods jungle thicket grove orchard meadow field prairie grassland
desert tundra glacier iceberg volcano crater lava magma eruption
weather climate season spring summer autumn winter
rain drizzle downpour shower sleet hail snow blizzard frost ice icicle
mist fog dew humidity moisture drought
wind breeze gale gust hurricane tornado cyclone typhoon storm
thunder lightning bolt cloud overcast haze smog rainbow sunrise sunset
dawn dusk twilight moonlight starlight eclipse
flood drought wildfire earthquake tremor aftershock landslide avalanche
tsunami sinkhole erosion sediment fossil mineral crystal gem
tree trunk bark branch twig limb root leaf stem bud blossom petal pollen
seed sprout seedling sapling shrub bush hedge vine fern moss lichen
flower rose daisy tulip lily orchid sunflower violet pansy petunia
grass weed clover dandelion thistle thorn bramble ivy
pine oak maple elm birch willow cedar redwood palm bamboo cactus
`,

// ─── HOME / HOUSEHOLD / FURNITURE ──────────────────────────────────
home_household: `
house home apartment condo cabin cottage mansion estate villa bungalow
room bedroom bathroom kitchen living dining hallway closet attic basement
cellar garage porch deck patio balcony yard lawn garden driveway sidewalk
door doorway doorbell doorknob hinge lock bolt latch knob handle
window pane sill curtain blind shade shutter screen
wall ceiling floor tile carpet rug hardwood laminate
roof gutter chimney fireplace mantle hearth furnace vent duct pipe drain
stair staircase railing banister elevator escalator
bed mattress pillow blanket sheet quilt comforter bedspread headboard
sofa couch loveseat recliner armchair ottoman footstool bench stool
table desk chair counter island shelf bookshelf cabinet drawer dresser
wardrobe closet nightstand endtable coffeetable
lamp light chandelier sconce lantern candle bulb switch outlet plug
sink faucet tub shower toilet bathtub vanity mirror towel soap shampoo
stove oven microwave refrigerator freezer dishwasher toaster blender
washer dryer iron vacuum mop broom dustpan sponge bucket
plate bowl cup mug glass pitcher pot pan skillet spatula whisk ladle
colander strainer grater peeler tongs corkscrew opener
trash garbage recycle compost bin bag basket hamper
paint wallpaper plaster drywall plywood lumber nail screw bolt nut
hammer screwdriver wrench pliers drill saw tape glue sandpaper
fence gate post rail hedge shrub sprinkler hose rake shovel wheelbarrow
`,

// ─── CLOTHING / FASHION ────────────────────────────────────────────
clothing: `
shirt blouse top tank sweater hoodie jacket coat vest suit tuxedo dress
gown skirt pants jeans shorts leggings overalls jumpsuit romper robe
pajamas nightgown underwear bra boxer briefs panties sock stocking
shoe boot sandal sneaker heel flat loafer slipper flip flop
hat cap beanie bonnet beret helmet visor headband bandana turban crown
tie bowtie scarf shawl wrap stole poncho cape cloak
glove mitten belt buckle suspender apron pocket collar cuff sleeve hem
zipper button snap lace ribbon bow fringe tassel patch pocket
ring necklace bracelet earring brooch pendant charm chain choker anklet
watch glasses sunglasses goggles purse handbag wallet clutch backpack
briefcase suitcase trunk luggage tote bag pouch satchel
cotton wool silk linen polyester denim leather suede velvet satin lace
corduroy flannel fleece cashmere tweed plaid stripe polka dot
fashion style trend outfit attire wardrobe ensemble accessory
laundry wash fold iron press starch bleach stain wrinkle shrink stretch
tailor seamstress hem alter fit size small medium large
`,

// ─── EMOTIONS / PERSONALITY / MENTAL ────────────────────────────────
emotions: `
happy sad angry afraid scared nervous anxious worried stressed calm
peaceful relaxed content satisfied pleased delighted thrilled excited
eager hopeful optimistic grateful thankful proud confident brave bold
daring fearless courageous determined passionate enthusiastic energetic
cheerful joyful merry jolly playful silly goofy giddy blissful ecstatic
love hate like dislike adore cherish treasure appreciate admire respect
trust faith loyalty devotion affection fondness warmth tenderness
compassion empathy sympathy pity mercy kindness generosity charity
forgive resent grudge envy jealous covet greed selfish vain arrogant
humble modest shy timid meek gentle tender caring nurture comfort console
sad gloomy melancholy somber solemn grim bleak dreary dismal
lonely isolated abandoned forsaken rejected neglected ignored overlooked
angry furious livid outraged enraged hostile aggressive fierce savage
bitter resentful spiteful vindictive vengeful cruel harsh brutal ruthless
afraid terrified horrified petrified panic dread horror terror fright
nervous tense uptight edgy jittery restless fidgety uneasy unsettled
confused bewildered puzzled perplexed baffled stumped lost disoriented
surprised shocked stunned astonished amazed awestruck speechless
bored weary tired exhausted drained burned fatigued lethargic sluggish
embarrassed ashamed humiliated mortified awkward self-conscious
disgusted repulsed revolted nauseated appalled horrified sickened
stubborn obstinate defiant rebellious disobedient willful headstrong
patient tolerant understanding forgiving accepting open-minded flexible
honest sincere genuine authentic truthful straightforward blunt frank
sneaky devious cunning sly crafty manipulative deceptive dishonest
wise smart clever bright brilliant genius sharp witty humorous funny
foolish naive gullible ignorant clueless dense oblivious absent-minded
`,

// ─── WORK / BUSINESS / MONEY ───────────────────────────────────────
work_business: `
work job career profession occupation trade craft skill talent expertise
hire fire promote demote resign quit retire layoff severance pension
salary wage income earning profit loss revenue expense cost price fee
tax deduction refund rebate discount coupon sale bargain deal offer
budget finance invest stock bond fund portfolio asset liability debt
loan mortgage interest rate credit debit check balance account deposit
withdrawal transfer payment invoice receipt bill statement ledger audit
bank vault safe cash coin bill dollar cent penny nickel dime quarter
wealth rich poor broke bankrupt fortune millionaire billionaire
office cubicle desk chair computer phone printer scanner copier stapler
meeting conference call email memo report document file folder binder
boss manager supervisor director executive chief officer president
employee worker staff team crew colleague coworker partner associate
intern apprentice trainee recruit volunteer contractor freelance
company firm corporation enterprise startup venture franchise chain
industry sector market economy commerce trade import export supply demand
product service brand label logo trademark patent copyright
customer client consumer buyer shopper vendor supplier distributor
advertise promote market sell pitch negotiate close deal contract
manufacture produce assemble package ship deliver distribute warehouse
deadline schedule calendar appointment agenda priority task project
interview resume portfolio reference recommendation qualification
`,

// ─── SCHOOL / EDUCATION ─────────────────────────────────────────────
education: `
school college university academy institute campus classroom lecture hall
teacher professor instructor tutor mentor coach counselor principal dean
student pupil scholar graduate freshman sophomore junior senior
class course subject lesson unit chapter module seminar workshop
homework assignment project essay paper thesis dissertation research
test exam quiz midterm final grade score mark pass fail retake
study review memorize practice drill exercise rehearse prepare cram
read write spell count calculate solve analyze evaluate interpret
math algebra geometry calculus trigonometry statistics probability
science biology chemistry physics anatomy astronomy geology ecology
history geography civics government economics sociology psychology
language grammar vocabulary spelling punctuation composition rhetoric
literature poetry prose fiction nonfiction novel short story essay
art music drama theater dance choir orchestra band
gym recess lunch cafeteria library lab auditorium gymnasium
diploma degree certificate license credential scholarship fellowship
grant loan tuition fee registration enrollment admission graduation
commencement ceremony honor roll dean valedictorian salutatorian
textbook notebook binder pencil pen marker crayon chalk eraser ruler
chalkboard whiteboard projector screen computer tablet
backpack locker desk chair globe map chart poster bulletin board
`,

// ─── FAMILY / RELATIONSHIPS / PEOPLE ────────────────────────────────
family_people: `
family parent mother father mom dad mama papa mommy daddy
brother sister sibling twin triplet
son daughter child kid baby infant toddler teenager adolescent youth adult
grandmother grandfather grandma grandpa grandparent
uncle aunt cousin nephew niece
husband wife spouse partner fiance fiancee
boyfriend girlfriend lover companion soulmate
friend buddy pal mate acquaintance neighbor stranger
man woman boy girl gentleman lady sir madam mister miss missus
person people human individual citizen resident native foreigner immigrant
crowd mob gang group team crew squad tribe clan
king queen prince princess knight lord lady duke duchess baron count
president governor mayor senator representative judge officer chief
doctor nurse surgeon dentist pharmacist therapist counselor psychologist
lawyer attorney judge jury witness defendant plaintiff prosecutor
teacher professor coach tutor mentor instructor guide
priest pastor minister rabbi imam bishop pope monk nun
cop police detective sheriff marshal agent spy
soldier sailor marine pilot captain general sergeant private colonel
chef cook baker butcher fisherman farmer rancher cowboy
artist painter sculptor musician singer dancer actor actress writer poet
builder carpenter plumber electrician mechanic technician engineer
driver taxi trucker pilot captain navigator
author editor journalist reporter anchor correspondent
cashier clerk waiter waitress bartender receptionist secretary assistant
`,

// ─── TIME / DATES / NUMBERS ─────────────────────────────────────────
time_numbers: `
time clock watch hour minute second moment instant
morning afternoon evening night midnight noon dawn dusk
today tomorrow yesterday
monday tuesday wednesday thursday friday saturday sunday
week month year decade century millennium
january february march april may june july august september october
november december
spring summer autumn fall winter season
past present future history ancient medieval modern current recent
early late soon already never always sometimes often rarely seldom
schedule deadline timer alarm countdown
first second third fourth fifth sixth seventh eighth ninth tenth
twenty thirty forty fifty sixty seventy eighty ninety hundred
thousand million billion trillion
half quarter third double triple single pair dozen score
zero one two three four five six seven eight nine ten eleven twelve
`,

// ─── TRANSPORTATION / TRAVEL ────────────────────────────────────────
transport: `
car truck van bus taxi cab limo ambulance firetruck
motorcycle scooter bicycle bike skateboard
train subway metro trolley tram streetcar monorail locomotive
airplane jet helicopter drone blimp balloon glider parachute
boat ship yacht sailboat canoe kayak rowboat ferry cruise submarine
road street avenue boulevard lane highway freeway expressway turnpike
bridge tunnel overpass intersection crossroad roundabout
sidewalk crosswalk curb gutter median shoulder lane barrier guardrail
parking lot garage meter space spot ramp
traffic light signal sign stop yield merge detour speed limit
map route direction compass north south east west
airport terminal gate runway hangar tower control
station depot platform track rail switch signal crossing
harbor port dock pier wharf marina berth anchor buoy lighthouse
gas fuel diesel electric hybrid engine motor battery brake pedal wheel
tire axle bumper fender hood trunk dashboard windshield mirror headlight
seat belt airbag horn honk siren alarm emergency
drive ride fly sail cruise navigate steer park reverse
trip journey voyage expedition adventure tour excursion commute
ticket pass fare toll boarding passport visa customs baggage
hotel motel hostel resort lodge inn campground tent trailer
tourist traveler passenger crew pilot captain conductor engineer
`,

// ─── SPORTS / GAMES / RECREATION ────────────────────────────────────
sports_games: `
sport game match tournament championship league season playoff
team player coach referee umpire fan crowd stadium arena field court
score point goal touchdown homerun basket ace serve volley rally
win lose tie draw forfeit disqualify eliminate advance champion
ball bat glove helmet puck stick racket club net hoop goal post
football soccer basketball baseball hockey tennis golf volleyball
swimming diving wrestling boxing karate judo fencing archery
track field sprint relay hurdle marathon triathlon
skiing snowboard skating surfing rowing sailing climbing hiking
fishing hunting camping kayak canoe raft
chess checkers cards dice poker blackjack domino puzzle board game
video game console controller joystick headset arcade
exercise workout fitness gym treadmill weight barbell dumbbell
jog run sprint walk hike climb swim bike paddle row lift press curl
push pull stretch bend twist jump leap hop skip squat lunge plank
score point lead trail ahead behind halftime overtime sudden death
foul penalty free throw free kick corner kick throw-in
offense defense tackle block pass shoot dribble catch throw pitch hit
kick punt fumble interception sack rebound assist steal turnover
`,

// ─── ARTS / ENTERTAINMENT / MEDIA ───────────────────────────────────
arts_media: `
movie film cinema theater show performance concert recital exhibit
television radio podcast stream channel network broadcast
book novel story tale narrative fiction fantasy horror mystery thriller
romance comedy drama tragedy epic saga sequel prequel series trilogy
music song lyric melody harmony rhythm beat tempo chord note scale
rock pop jazz blues country folk classical hip hop rap reggae soul funk
guitar piano keyboard violin cello bass drum trumpet saxophone flute
dance ballet waltz tango salsa swing hip hop tap breakdance
art painting drawing sketch illustration portrait landscape still life
sculpture statue carving pottery ceramic glass mosaic mural fresco
photography camera lens flash zoom focus exposure shutter aperture
album track single record vinyl cassette disc playlist
movie director producer writer actor actress star cast crew
plot scene act chapter verse stanza climax twist ending
comedy humor joke prank skit parody satire irony sarcasm
stage curtain spotlight prop costume makeup script rehearsal audition
museum gallery studio workshop exhibition festival carnival parade
newspaper magazine journal blog article column editorial headline
`,

// ─── LAW / GOVERNMENT / POLITICS ────────────────────────────────────
law_government: `
law rule regulation statute ordinance code policy standard
court judge jury lawyer attorney prosecutor defendant plaintiff witness
trial hearing verdict sentence penalty fine parole probation bail bond
crime offense felony misdemeanor violation infraction arrest warrant
police officer detective sheriff marshal agent investigator
prison jail cell inmate convict parole probation sentence term
guilty innocent plea bargain acquit convict appeal overturn
right freedom liberty justice equality fairness
vote election ballot poll campaign candidate party debate primary
president governor mayor senator representative congress parliament
democrat republican liberal conservative independent moderate
law bill act amendment constitution treaty charter
tax budget deficit surplus debt ceiling shutdown
military army navy marines air force coast guard national guard
war peace treaty alliance embargo sanction troops deploy withdraw
weapon gun rifle pistol shotgun cannon missile bomb grenade
`,

// ─── SCIENCE / TECHNOLOGY ───────────────────────────────────────────
science_tech: `
science research experiment theory hypothesis evidence proof data
atom molecule element compound mixture solution reaction equation
energy force gravity friction momentum velocity acceleration mass weight
heat temperature degree celsius fahrenheit thermometer
light color spectrum wavelength frequency radiation ultraviolet infrared
sound wave vibration echo resonance pitch volume tone
electricity current voltage resistance circuit battery wire conductor
magnet magnetic pole attract repel field compass
chemistry lab beaker flask test tube microscope telescope lens mirror prism
biology cell tissue organ system organism species evolution mutation gene
DNA RNA chromosome genome protein enzyme bacteria virus fungus
ecology habitat ecosystem food chain predator prey extinct endangered
geology rock mineral crystal fossil soil erosion volcano earthquake plate
astronomy planet star sun moon galaxy universe cosmos nebula orbit comet
asteroid meteor satellite telescope observatory constellation zodiac
physics quantum relativity particle photon neutron proton electron
computer software hardware program code algorithm data network internet
robot artificial intelligence machine learning neural network database
`,

// ─── COMMON ABSTRACT / EVERYDAY CONCEPTS ────────────────────────────
abstract_concepts: `
thing stuff matter object item piece part bit chunk portion section
idea thought concept notion theory belief opinion view perspective point
reason cause effect result outcome consequence impact influence
problem issue trouble difficulty challenge obstacle barrier hurdle
solution answer fix cure remedy response reaction
change shift move switch turn twist flip spin roll slide
start begin launch open initiate spark trigger ignite
stop end finish close conclude wrap complete final last
fast quick rapid swift brisk speedy hasty hurried
slow gradual steady gentle mild moderate cautious careful
big large huge massive enormous giant tremendous immense vast
small little tiny miniature petite compact slim thin narrow
good great excellent superb outstanding wonderful terrific fantastic
bad poor terrible awful horrible dreadful atrocious lousy
new fresh recent modern current latest updated advanced
old ancient vintage classic traditional dated outdated obsolete
true real genuine authentic actual factual accurate correct right
false fake phony counterfeit bogus fraud sham hoax lie wrong
safe secure protected guarded shielded defended sealed locked
danger risk threat hazard peril jeopardy harmful toxic
clean pure fresh neat tidy spotless pristine sanitary
dirty filthy grimy muddy dusty stained messy sloppy
dark dim gloomy shadowy murky pitch obscure
bright light shiny gleaming sparkling radiant glowing luminous
loud noisy rowdy boisterous thunderous deafening blaring roaring
quiet silent still hushed muted muffled soft gentle calm peaceful
`,

// ─── MISCELLANEOUS COMMON WORDS (alphabetical catch-all) ───────────
misc_common: `
sloth thirst ghost spirit soul angel demon devil witch wizard
magic spell curse charm potion wand crystal oracle prophecy fate destiny
luck chance fortune risk gamble odds bet wager
fire flame blaze ember spark ash smoke soot char burn scorch singe
water ice steam mist fog dew rain snow frost chill freeze thaw melt
air wind breeze gust draft blow puff swirl whirl vacuum
earth ground soil dirt mud clay sand gravel stone rock mineral metal
gold silver bronze copper iron steel tin lead zinc aluminum platinum
diamond ruby emerald sapphire pearl jade opal amethyst crystal gem jewel
glass mirror lens prism window pane sheet plate bottle jar vase
wood timber lumber plank board beam pole post stake stump log bark
paper card stock sheet page scroll parchment envelope stamp seal wax
cloth fabric textile yarn thread string rope cord chain wire cable link
leather rubber plastic foam cardboard concrete cement brick tile mortar
paint dye stain varnish polish wax glue paste tape staple clip pin needle
math add subtract multiply divide equal sum total count number digit
inch foot yard mile meter centimeter kilometer acre gallon liter ounce
pound ton gram kilogram barrel bushel pint quart volume area perimeter
circle square triangle rectangle oval diamond cube sphere cone cylinder
angle curve line dot point edge corner border frame shape form pattern
color red blue green yellow orange purple pink brown black white gray
beige tan cream ivory maroon navy teal olive coral salmon peach mint
north south east west left right up down front back top bottom middle
center edge corner border margin surface inside outside above below
between among beside behind beyond within without through across along
always never sometimes often usually rarely seldom forever briefly
here there where everywhere nowhere somewhere anywhere nearby far close
now then when before after during since until while once
this that these those which what who whom whose how why
very much many few some all most any each every several both either
just only even still already yet again also too quite rather fairly
`,
};

// ═══════════════════════════════════════════════════════════════════════
// SCAN
// ═══════════════════════════════════════════════════════════════════════

const allMissing = {};
let totalMissing = 0;

for (const [category, wordBlock] of Object.entries(COMMON_WORDS)) {
    const words = wordBlock.trim().split(/\s+/).filter(w => /^[a-z]+$/i.test(w));
    const missing = [];
    
    for (const word of words) {
        const upper = word.toUpperCase();
        if (upper.length < 2) continue;
        if (!currentWords.has(upper)) {
            missing.push(upper);
        }
    }
    
    // Dedupe within category
    const uniqueMissing = [...new Set(missing)];
    
    if (uniqueMissing.length > 0) {
        allMissing[category] = uniqueMissing;
        totalMissing += uniqueMissing.length;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════');
console.log(`MISSING COMMON WORDS REPORT`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Collect ALL missing into a flat deduplicated set for the final output
const flatMissing = new Set();

for (const [category, words] of Object.entries(allMissing)) {
    const label = category.replace(/_/g, ' ').toUpperCase();
    console.log(`── ${label} (${words.length} missing) ──`);
    console.log(words.map(w => w.toLowerCase()).join(' '));
    console.log('');
    for (const w of words) flatMissing.add(w);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(`TOTAL UNIQUE MISSING: ${flatMissing.size}`);
console.log('═══════════════════════════════════════════════════════════════\n');

// Sort by length then alphabetically for easy review
const sorted = [...flatMissing].sort((a, b) => a.length - b.length || a.localeCompare(b));

// Group by likely part of speech / placement in rebuild-words.js
// Simple heuristic: short words (2-4) likely NOUNS or OTHER, 
// longer ones need manual review
console.log('── PASTE-READY: All missing words (lowercase, sorted) ──');
console.log(sorted.map(w => w.toLowerCase()).join(' '));
console.log('');

// Show length distribution
const lenDist = {};
for (const w of flatMissing) {
    const len = w.length;
    lenDist[len] = (lenDist[len] || 0) + 1;
}
console.log('── Length distribution ──');
for (const len of Object.keys(lenDist).sort((a,b) => a-b)) {
    console.log(`  ${len} letters: ${lenDist[len]} words`);
}

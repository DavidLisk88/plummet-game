// rebuild-words.js
// Builds words.json directly from curated word lists with proper inflections.
// Run once after editing word lists, then push.
//
// Usage: node rebuild-words.js

const fs = require('fs');
const path = require('path');

// ─── English morphology helpers ─────────────────────────────────────

const VOWELS = new Set('aeiou'.split(''));

function endsWithDoubleConsonant(w) {
    if (w.length < 2) return false;
    const last = w[w.length - 1];
    return w[w.length - 2] === last && !VOWELS.has(last);
}

function shouldDoubleConsonant(w) {
    // Short words (CVC pattern): run→running, sit→sitting, big→bigger
    if (w.length < 3) return false;
    const last = w[w.length - 1];
    const penult = w[w.length - 2];
    const ante = w[w.length - 3];
    if (VOWELS.has(last) || !VOWELS.has(penult) || VOWELS.has(ante)) return false;
    // Don't double w, x, y
    if ('wxy'.includes(last)) return false;
    // Only double for short words (1 syllable generally ≤5 letters)
    return w.length <= 5;
}

function pluralize(noun) {
    const results = [];
    const w = noun.toLowerCase();
    if (w.endsWith('s') || w.endsWith('x') || w.endsWith('z') || w.endsWith('sh') || w.endsWith('ch')) {
        results.push(noun + 'es');
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        results.push(noun.slice(0, -1) + 'ies');
    } else if (w.endsWith('f')) {
        results.push(noun.slice(0, -1) + 'ves');
        results.push(noun + 's'); // some words take both
    } else if (w.endsWith('fe')) {
        results.push(noun.slice(0, -2) + 'ves');
    } else {
        results.push(noun + 's');
    }
    return results;
}

function verbForms(verb) {
    const forms = [];
    const w = verb.toLowerCase();

    // -s (third person)
    if (w.endsWith('s') || w.endsWith('x') || w.endsWith('z') || w.endsWith('sh') || w.endsWith('ch')) {
        forms.push(verb + 'es');
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(verb.slice(0, -1) + 'ies');
    } else {
        forms.push(verb + 's');
    }

    // -ing
    if (w.endsWith('ie')) {
        forms.push(verb.slice(0, -2) + 'ying');
    } else if (w.endsWith('e') && !w.endsWith('ee') && !w.endsWith('ye')) {
        forms.push(verb.slice(0, -1) + 'ing');
    } else if (shouldDoubleConsonant(w)) {
        forms.push(verb + verb[verb.length - 1] + 'ing');
    } else {
        forms.push(verb + 'ing');
    }

    // -ed (past tense)
    if (w.endsWith('e')) {
        forms.push(verb + 'd');
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(verb.slice(0, -1) + 'ied');
    } else if (shouldDoubleConsonant(w)) {
        forms.push(verb + verb[verb.length - 1] + 'ed');
    } else {
        forms.push(verb + 'ed');
    }

    // -er (one who does)
    if (w.endsWith('e')) {
        forms.push(verb + 'r');
    } else if (shouldDoubleConsonant(w)) {
        forms.push(verb + verb[verb.length - 1] + 'er');
    } else {
        forms.push(verb + 'er');
    }

    return forms;
}

function adjectiveForms(adj) {
    const forms = [];
    const w = adj.toLowerCase();

    // -er (comparative)
    if (w.endsWith('e')) {
        forms.push(adj + 'r');
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(adj.slice(0, -1) + 'ier');
    } else if (shouldDoubleConsonant(w)) {
        forms.push(adj + adj[adj.length - 1] + 'er');
    } else {
        forms.push(adj + 'er');
    }

    // -est (superlative)
    if (w.endsWith('e')) {
        forms.push(adj + 'st');
    } else if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(adj.slice(0, -1) + 'iest');
    } else if (shouldDoubleConsonant(w)) {
        forms.push(adj + adj[adj.length - 1] + 'est');
    } else {
        forms.push(adj + 'est');
    }

    // -ly (adverb)
    if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(adj.slice(0, -1) + 'ily');
    } else if (w.endsWith('le')) {
        forms.push(adj.slice(0, -1) + 'y');
    } else if (w.endsWith('e') && !w.endsWith('le')) {
        forms.push(adj + 'ly');
    } else {
        forms.push(adj + 'ly');
    }

    // -ness
    if (w.endsWith('y') && !VOWELS.has(w[w.length - 2])) {
        forms.push(adj.slice(0, -1) + 'iness');
    } else {
        forms.push(adj + 'ness');
    }

    return forms;
}

// ─── Comprehensive common English words ─────────────────────────────
// Organized by part of speech for proper inflection

const NOUNS = `
act age air aim ant ape arc arp arm art ash axe bag ban bar bat bay bed bet bid bin bit
bow box boy bud bug bun bus cab can cap car cat cow cry cub cup cut dam day den dew
dig dip dog dot dub dud due dug dun duo dye ear eat egg elk elm emu end era eve ewe
eye fan fat fax fed fig fin fit fix flu fly foe fog for fox fry fun fur gag gal gam
gap gas gel gem gin gnu god goo gum gun gut guy gym had ham hat hay hem hen her hew
hid him hip hit hob hog hop hub hue hug hum hut ice ill imp ink inn ion ire ivy jab
jag jam jar jaw jay jet jig job jog joy jug jut keg kid kin kit lab lad lag lap law
lay lea led leg let lid lip lit log lot low lug mad man map mar mat maw may men met
mix mob mod mop mow mud mug nab nag nap net nil nip nit nod nor not now nun nut oak
oar oat odd ode oil old one opt orb ore our out owe owl own pad pal pan pat paw pay
pea peg pen pet pew pie pig pin pit ply pod pop pot pow pox pro pub pug pun pup put
rag ram ran rap rat raw ray red rib rid rig rim rip rod rot row rub rug run rut rye
sac sad sag sap sat saw say sea set sew shy sin sip sir sit six ski sky sly sob sod
son sop sot sow spa spy sty sub sue sum sun sup tab tad tag tan tap tar tat tax tea
ten the tie tin tip toe ton too top tot tow toy try tub tug tun two urn use van vat
vet vex vie vim vow wad war was wax way web wed wet who wig win wit woe wok won woo
wow yak yam yap yaw yea yen yet yew you zap zeal zen zero zest zinc zip zone zoo
bib bra cam cob cog cur fad fen fib fir gig gob hex max nib nub sax sis
able acid ally also area army aunt auto axis axle babe baby back bail bait bake ball
band bang bank bare bark barn base bath beam bean bear beat beef been beer bell belt
bend bike bill bind bird bite blow blue blur boar boat body bold bolt bomb bond bone
book boom boot bore born boss both bout bowl bulk bull bump burn bust buzz cafe cage
cake calf call calm came camp cane cape card care cart case cash cast cave cell cent
chef chin chip chop cite city clad clam clan clap claw clay clip clod clog clot club
clue coal coat code coil coin coke cold cole colt comb come cone cook cool cope copy
cord core cork corn cost coup cove crew crop crow cube cult curb cure curl curt dash
data date dawn dead deaf deal dear debt deck deed deem deep deer dent desk dial dice
die diet dime dine dire dirt disc dish disk dock does doll dome done doom door dose dose
down doze drag draw drew drip drop drug drum dual duck duel duff duke dull dump dune
dusk dust duty each earl earn ease east easy edge edit eggs emit envy epic euro even
exam exec exit expo face fact fade fail fair fake fall fame fang fare farm fast fate
fawn fear feat feed feel feet file fill film find fine fire firm fish fist five flag
flat flaw fled flee flew flip flock flog flow flux foam foal foam foci fold folk food
fool foot ford fore fork form fort foul four free frog from fuel full fume fund fuse
fuss gain gait gale game gang gape garb gash gate gave gaze gear gift girl give glad
glen glow glue goat goes gold golf gone good gown grab gray grew grid grim grin grip
grit grow gulf gust hail hair half hall halt hand hang hare harm harp have hawk haze
head heal heap hear heat heel help herb herd here hero hide high hike hill hilt hint hive
hire hold hole home hood hook hope horn hose host hour howl hull hump hung hunt hurl
hurt hymn icon idea inch info into iris iron isle item jack jade jail jake jamb jazz
jean jeer jell jerk jest joke jolt jump june jury just keen keep kelp kegs keys kick
kill kind king kiss kite knee knew knit knob knot know lace lack lady laid lake lamb
lamp land lane lard lark lash lass last late lawn lead leaf leak lean leap left lend
lens lent less levy liar lick lift like limb lime limp line link lint lion list live
load loaf loan lock loft logo lone long look loop lord lore lose loss lost loud love
luck lump lung lure lurk lush mace made maid mail main make male mall malt mane mare
mark mask mass mast mate math maze mead meal mean meat meet melt memo mend menu mere
mesh mild mile milk mill mime mind mine mint miss mist mitt moat mock mode mold mole
mood moon moor more moss most moth move much muck mule muse musk must myth nail name
navy near neat neck nerd need nest news next nice nine node none noon norm nose note noun
obey odor oink omen once only onto open oral oven over pace pack page paid pail pain
pair pale palm pane pang park part pass past path pave peak peal pear peat peck peek
peel peer pelt pent perk pest pick pier pile pill pine pink pipe plan play plea plot plow
plug plum plus poem poet poke pole poll polo pond pony pool poor pope pork port pose
post pour pray prey prod prop prow pull pulp pump pure push quit quiz race rack raft
rage raid rail rain rake ramp rang rank rare rash rate rave read real rear reed reef
reel rely rent rest rice rich ride rift ring riot rise risk road roam roar robe rock
rode role roll roof room root rope rose rout rude ruin rule rung rush rust sack safe
sage said sail sake sale salt same sand sang sash save scan scar seal seam seat sect
seed seek seem seen self sell send sept sere sewn shed shin ship shoe shoo shop shot
show shut sick side sigh sign silk sill sing sink site size skim skin skip slab slam
slap slat sled slew slim slip slit slot slow slug snap snip snow soak soap soar sock
soda sofa soil sold sole some song soon sore sort soul soup spin spit spot star stay
stem step stew stir stop stub such suit sulk sure surf swap swim tale talk tall tame
tank tape tart task team tear tell temp tend tent term test text than that them then
thick thin this thou tick tide tidy tile till tilt time tiny tire toad toil told toll
tomb tone took tool torn tour town trap tray tree trim trio trip trod true tube tuck
tuft tune turn tusk twin type ugly undo unit unto upon urge used user vain vale vane
vary vase vast veil vein vent verb very vest vice view vine void volt vote wade wage
wail wait wake walk wall wand ward warm warn warp wart wash wasp wave wavy waxy weak
wear weed week well went were west wick wide wife wild will wilt wind wine wing wink
wire wise wish wisp wive woke wolf wood wool word wore work worm worn wrap wren writ
yard yarn year yell yoga yoke your
abuse admit adult agent agree ahead alarm album alert alien align alive alley allow
alone along alter among angel anger angle ankle apart apple apply arena argue arise
armor array aside asset atlas avoid award aware badge badly basic basin basis batch
beach beard beast begin being below bench berry birth black blade blame blank blast
blaze bleed blend bless blind blink bliss block blood bloom blown board boast bonus
booth bound boxer brain brake brand brave bread break breed brick bride brief bring
broad broke brook brown brush buddy build built bunch burst buyer cabin cable canal
cargo carry carve catch cause chain chair chalk chant chaos charm chart chase cheap
check cheek cheer chess chest chief child chill china choir chord chunk civic civil
claim clash class clean clear clerk climb cling clock clone close cloth cloud clown
coach coast color combo comic coral count court cover crack craft crash crazy cream
creek crest crew crime cross crowd crown crush cubic curve cycle daily dairy dance
death debug decay decoy delay delta dense depot depth derby devil diary dirty disco
ditch dizzy donor doubt draft drain drama drank drape drawn dream dress dried drift
drill drink drive drone drool droop drops drove drown drunk dying eager eagle early
earth eaten eater eight elbow elder elect elite email embed enemy enjoy enter entry
equal equip error essay event every exact exert exile exist extra fable faced facto
faint fairy faith false fancy fatal fault favor feast fence fewer fiber field fifth
fifty fight final first flame flash fleet flesh flies float flock floor flora flour
fluid flush flute focus folly force forge forth forum found frame frank fraud fresh
front frost froze fruit fully funds funny gamma gauge giant given gland glass gleam
glide globe gloom gloss glove gonna grace grade grain grand grant grape grasp grass
grave great green greet grief grill grind groan groom gross group grove grown guard
guess guest guide guild guilt guise gypsy habit happy harsh haunt haven heart heavy
hence hobby honor horse hotel house human humor hurry ideal image imply index inner
input inter issue ivory jewel jimmy joint joker judge juice knife knock known label
labor lance large laser later laugh layer learn lease least legal lemon level light
limit linen liver local lodge logic loose lover lower lucky lunar lunch lying magic
major maker manor march match maybe mayor media mercy metal meter might minor minus
model money month moral motor mount mouse mouth movie music naked nerve never night
noble noise north novel nurse nylon ocean offer onset opera orbit order other ought
outer owner oxide ozone paint panel panic paper patch pause peace peach penny phase
phone photo piano piece pilot pinch pitch pixel pizza place plain plane plant plate
plaza plead pluck point poker polar pound power press price pride prime print prior
prize probe proof proud prove psalm pupil purse queen quest quick quiet quite quota
radar radio raise rally ranch range rapid ratio reach react rebel reign relax relay
renal reply rider rifle right rigid rival river robin robot rocky roman rough round
route royal rugby ruler rural sadly saint salad sauce scale scare scene scent scope
score scout screw sense serve seven shade shady shaft shake shall shame shape share
sharp shave shelf shell shift shine shirt shock shore short shout shown shrub siege
sight sigma since sixth sixty skate skill skull slave sleep slice slide slope small
smart smell smile smoke snake solar solid solve sorry sound south space spare speak
speed spell spend spent spice spine split spoke spoon sport spray squad stack staff
stage stair stake stall stamp stand stare start state steak steal steam steel steep
steer stern stick stiff still stock stone stood storm story stove strap straw stray
strip stuck study stuff style sugar suite super surge swamp swear sweat sweep sweet
swept swift swing sword sworn stuck symptom
table taken taste teach teeth thank theme thick thing think third those three threw
throw thumb tiger tight timer tired title today topic total touch tough tower trace
track trade trail train trait trans trash travel treat trend trial tribe trick tried
troop truck truly trump trunk trust truth tumor twelfth twice twist ultra uncle under
union unite unity until upper upset urban usage usual utter valid value valve vapor
verse video vigor viral virus visit vital vivid vocal voice voter waste watch water
weave wheat wheel where which while white whole whose widow woman women world worry
worse worst worth would wound write wrong wrote yield young youth
absorb accept access across acting actual adding adjust admire admit advice advise
affair afford agency albeit allies almost amount animal annual anyway appear around
arrest artist assume attack august basket battle beauty become behalf behind belong
beside better beyond bother bottom bounce branch breath bridge bright broken bronze
brutal bubble bucket budget bundle burden bureau button bypass cancel carbon career
castle cattle caught center chance change charge chosen circle client clinic closed
coffee column combat coming commit common comply copper corner costly cotton couple
course cousin covers create credit crisis critic custom damage danger deadly debate
decade decent decide defeat defend degree demand depart depend deploy deputy desert
design desire detail detect device devote dialog differ dining dinner direct divine
domain double driven driver during earned easily eating editor effect effort eighth
eleven emerge employ enable ending energy engage engine enough ensure entire entity
equals escape estate ethnic evolve exceed except excess excite excuse exempt expand
expect expert export expose extend extent fabric factor failed fairly fallen family
famous farmer faster father fellow figure filing filter finale finger fiscal flying
follow forbid forced forest forever forget formal format former foster fourth freely
friend frozen galaxy garage garden gender gentle ghost global golden govern growth
guilty guitar handle happen harbor hatred hazard health heaven height hidden highly
holder honest hoping horror hunger hunter ignore ilLUST impact impose income indeed
infant inform injure injury inland insert inside insist intact intake intend invest
island itself jacket jersey jungle junior kidney kidney kindly knight ladder lately
latter launch lawyer layout leader league legacy length lesson letter likely linear
liquid listen litter little living lonely lookup lovely luxury mainly making manage
manner margin marked market master matter medium member memory mental mentor merely
method middle mighty miller mirror modify moment mostly mother motion moving murder
museum mutual namely narrow nation nature nearby nearly neatly nicely nobody normal
notice notion number object obtain occupy offense office online oppose option orange
origin output oxygen palace partly patent patrol patron battle pepper period permit
person phrase pillar planet player plenty pocket poetry poison police policy polish
pool poorly portrait poster potato praise prayer prefer pretty prince prison profit
proper proven public purple pursue racing random rarely rating reader reason recall
recent record reduce reform regard regime region reject relate relief remain remind
remote remove rental repair repeat report rescue resist resort result resume retail
retire return reveal review reward rhythm riding rising robust rocket roller rotate
ruling runner sacred safety salary sample saving scared scheme school season second
secret sector secure select seller senior series server settle severe sexual shadow
shaped shield signal silent silver simple singer sister slight smooth soccer solely
source spirit spread spring square stable status steady strain strand street stress
strict strike string stroke strong struck studio submit sudden suffer summer summit
sunday sunset superb supply surely survey switch symbol talent target temple tenant
tender terror thanks theory thirty threat throne tissue toward travel treaty tribal
tumble tunnel twelve unique unless unlike update useful valley vanish varied vendor
verbal versus victim viewer violet virgin vision volume walker wealth weekly weight
welfare window winner winter within wonder wooden worker worthy writer yellow
abandon ability absence academy account achieve acquire address advance airline airport
already amazing ancient another anxiety anybody applied applied arrange article assault
attempt attract auction author average awesome balance banking barrier battery bearing
bedroom behave believe benefit billion binding biology bizarre blanket blogger bombing
booklet boulder brewery briefly brother browser cabinet capable capital capture careful
catalog caution ceiling central certain chamber channel chapter charter chicken circuit
classic cleanup climate closest closing cluster coastal collect college comfort command
comment company compare compete complex concern conduct confirm connect consist contact
contain content context control convert cooking correct council counter courage covered
creator culture current dealing deceive decline default defence deficit deliver density
deposit dessert destiny destroy develop devoted digital disable discard dismiss display
distant diverse divided dominate donated donated drawing dropped dynamic earlier earnest
eastern economy edition elderly element embrace emotion emperor endless enforce engaged
enhance extract factory failure fashion feature fiction finance firearm fishing fitness
flutter foolish foreign forever formula fortune forward founder freedom fulfill funding
furnish further gallery gateway general genetic genuine gesture getting glacier glimpse
granted greatly growing habitat halfway halfway handler hanging harbour harmful harmony
harvest heading healing healthy hearing heavily helpful helpful herself highway himself
history holding holiday hosting housing however hundred hunting husband illegal imagery
imagine immunity implied impress improve include initial inquiry insight inspect install
instant intense interim invalid involve italian jointly journal journey justify killing
kingdom kitchen lacking landing largely lateral leading leather lengthy liberal liberty
license lighter limited literal loading logical longing lottery mandate marital massive
meaning measure medical meeting mention migrate militia mineral minimum miracle mission
missing mixture monitor monthly morning mounted musical mysterynatural neglect neither
nervous network neutral notable nothing nuclear nursing obesity observe obvious offense
officer ongoing opening operate opinion operate organic origins outdoor outlook outside
overall overlap oversee pacific painful parking partial partner passage passive patient
pattern payment penalty pension percent perfect perform perhaps persona pioneer plastic
playful pleased plenary plotter pointed polymer popular portion portray poverty powered
predict premium prepare present prevent primary printer privacy problem proceed process
produce product profile program project promise promote prophet protect protest provide
publish pursuit qualify quantum quarter quickly radical readily reality receipt receive
recover recruit reflect regards regular related release remains removal removed replace
request require reserve resolve respect respond restore retired retreat revenue reverse
revised roughly routine running runtime scholar section seeking segment selling seminar
serious servant serving session shelter sheriff shooter shortly showing silence similar
sitting skilled slavery smoking soldier someone sorting speaker special sponsor squeeze
stadium staffed standby startup station storage strange strikes student studied subject
succeed success suffer suggest suicide summary sunrise support supreme supreme surface
surgery surplus survive suspect sustain symptom teacher testing theater therapy thereby
thought through tobacco tobacco tonight totally tourism towards trading traffic trainer
transit trigger triumph trouble turning typical undergo unified uniform unknown unlikely
upgrade venture version veteran veteran village violent virtual visible wanting warrant
weather website weekend welcome welfare western whisper willing witness working workers
worried worship wrapper writing younger acne cod doc cot rep rite whey lien ark bot soy balm lye
accident action activity afternoon apartment approach attention
background baseball basketball bathroom birthday border bottle boyfriend breakfast bullet
camera campaign campus cancer candidate category chairman champion character charity
chocolate choice church cigarette citizen classroom clothes clothing collection
combination community competition computer condition conference conflict congress
connection construction consultant conversation cookie county criminal
dad database daughter decision defense delivery democracy department depression
description distance distinction district diversity doctor document dollar downtown
dozen education election emergency employee entrance environment episode equipment
evidence examination example exchange executive exercise existence expectation
experience experiment explanation explosion expression
facility favorite fee fighter flight football foundation frequency function furniture
generation gentleman girlfriend goal government governor graduate grandfather
grandmother guarantee headline hell hello hospital household
identity illustration imagination implementation implication impression improvement
incident increase independence indication individual industry influence information
institution insurance intelligence intention interest interview introduction
investigation investor invitation
january journalist judgment justice
knowledge
landscape language leadership legend library lifestyle literature location
machine magazine majority management marriage material meanwhile medicine
membership message military million minister minority minute mistake mom
mountain movement multiple mystery
narrative national nature necessity neighbor neighborhood newspaper
objective obligation observation obstacle occasion occurrence offense officer
operation operator opponent opportunity opposition ordinary organization orientation
outcome overlook
package painting parent party passenger passion percentage perception performance
permission personality perspective philosophy photograph picture platform
politician politics pollution population porch position possibility potential
practice preparation presence president pressure princess principal principle
priority prisoner production profession professor progress property proportion
proposal prospect protection protein province purchase purpose
quality quarterback question quote
racism reaction recommendation reduction reflection refrigerator regulation
relation relationship relative religion representation representative requirement
research researcher resistance resolution resource response responsibility
restaurant retirement revolution
sanction satellite scandal schedule scholarship science scientist screen
search secretary security senate senator sentence sequence service session setup
sheet shoulder shower significance situation society software solution somebody
something southern specialist speech spokesman stability standard statement
stomach stranger strategy stream strength structure struggle success suggestion
supporter surprise survivor system
tactic technology television temperature tendency territory testimony
thousand throat tradition transition translation transportation treatment ticket
tourist tuesday
university understanding utility
vacation valley variety vehicle victory violence visitor volunteer
weapon whatever whenever wherever wisdom
yesterday youngster yourself
bicycle blog butter century cheese childhood couch development difference difficulty
direction director discussion disease emphasis engineer evening
female fifteen highlight instance internet pleasure presidential
commercial commission committee contract
prompt punch someday stretch
abolish accountant acquaintance acquit actor actress administration advocate
agenda airplane algebra algorithm allergy alliance alligator allowance alphabet
ambassador ambulance amendment analyst animation anniversary antibiotic app
applause applicant application appointment apricot apron arcade archery
architect arrival aspirin assembly assignment assistant associate asylum
athlete athletic atmosphere attic attorney attribute audience audio audition
auditorium authority avocado baboon bachelor backpack backstage backup bacon
badger badminton bagel bakery balcony ballet ballot banana bandage banker
bartender basement bass bathtub beaver beetle belly bikini binary birch
biscuit bison bitcoin blackboard blazer blister blockbuster blouse bluetooth
boardwalk bookmark bookshelf bookstore boulevard boxing bracelet breast breeze
broadband broadcast broccoli broker broom brownie bruise brunch buckle buffalo
bully bumper bunny burger burrito bush butterfly buzzard byte cache cafeteria
calculus calendar camel campfire canary candle candy canoe canyon capitol
captain caramel cardigan cardinal caribou carnival carpenter carpet carpool
carrot cartoon cashback cashier casino caterpillar cathedral celebrity celery
cellular cemetery census cereal ceremony certificate championship chapel
checkout checkup cheerleader cheetah chemistry cherry chick chili chimney
chipmunk chorus cinema cinnamon citizenship civilian classmate clearance
click cliff climbing clipboard closet coalition cobbler cobra cockroach
coconut collar colleague collision colony comedy commissioner commitment
commute companion competitor compliment composition compromise compute
concert confederate congressman conservation conservative console conspiracy
constitution continent contractor controversy convention convertible
cooperate coordinator copyright corporation corridor costume cottage cougar
cough counselor countryside coupon courthouse courtyard coworker coyote crab
cracker cradle cranberry crane crayon cricket crocodile croissant crossing
crossroads crouton cruise cubicle cuckoo cucumber cuddle cupboard cupcake
currency curry cursor curtain cushion cycling cyclist dancer danish dart
dashboard daylight deadline dealer dean debit declare decree dedication
defendant delegate deli democrat dentist departure destination detective
detention devotion diamond diaper dictatorship diesel diner dinosaur diploma
diplomat discharge discord discount discrimination dispatch distributor
dive diver diving divorce dodge dolphin dominoes donation donkey donut
doorbell doorknob doorstep doorway dorm dough dove download dragon dragonfly
drawer dresser dressing dribble driveway drought duet dumpling dwelling
earnings earring earthquake eclipse eel electrician elementary elephant
embassy ember emoji empathy empire employment enchilada encode engagement
enrollment enterprise entertain entrepreneur equality eraser erosion esteem
ethernet exclusive execution expense expressway extension eyebrow eyelash
faculty fairground fajita falcon fantasy farewell farmhouse faucet february
feedback fencing ferret ferry festival fiance fiancee finch firefighter
firefly firehouse fireplace firewall firmware flamingo flannel flashcard flea
flirt flood font forehead forgave fountain franchise freelance freestyle
freeway freezer freshman friday friendship frisbee frosting fudge gaming
garlic gazebo generosity genre geography geometry gerbil germ gigabyte ginger
giraffe glitch glossary goalie godfather godmother goldfish golfer gorge
gorilla gospel gossip graduation grammar grandchild granddaughter grandparent
grandson graphic grasshopper gravel gravy greenhouse grizzly grocery
groundhog grownup guacamole guardian guardrail guidance gull gymnasium
gymnast gymnastics halftime hallway hamburger hamster handbag handball
handlebar handout hanger hardware hashtag headache headlight headliner
headphone headquarters heartbreak heartfelt hedge hedgehog helicopter heroine
heron hippo hockey homeland homepage homework honey hoodie hoop horizon
hormone hornet hostel hostess hotspot hound hummingbird hummus hurdle
hurricane hyena idol iguana immigrant immigration impeach import inbox indict
indie infection inflation injection inning insect inspector instruction
instructor instrument integrity interface intern intersection interstate
interval inventory investment invoice itch jackal jackpot jaguar janitor
jelly jellyfish jewelry jingle judicial july junction junkyard jurisdiction
juvenile kale kangaroo karaoke kayak ketchup kettle keyboard kickball
kindergarten kitten knuckle koala laboratory lacrosse ladybug lagoon
landlady landlord landmark laptop latch laundry lava lawsuit lecture
legislation legislator legislature legitimate leopard lettuce librarian
lifeguard lifetime lighthouse lightning lily limousine lineup literacy lizard
llama loafer lobby lobster login logistics loon lounge loyal loyalty luggage
lynx lyric macaroni macaw magpie maiden mailbox mainstream maintenance
malware mammal manatee mango mansion mantle manufacturer maple marathon
marina marketing marketplace marsh marshal mascot mathematics mattress mayo
meadow meatball mechanic medal mediate megabyte melody melon memoir memorial
merchandise merchant merge metro microphone midnight midterm migraine mileage
milkshake millennium mingle minivan minnow mitten modem moisture monarchy
monday monkey monopoly monument moose mortgage mosquito motel motherboard
motorcycle muffin muffler multiplication municipal mural muscle mushroom
musician mussel mustard namesake napkin narrator nausea navigate necklace newt
niece nightclub nightgown nightingale nightstand nominate noodle notebook
notification november nursery oasis oath oatmeal objection observatory
occupation october octopus offline ointment opossum orca orchard orchestra
orchid ordinance oriole orphan osprey ostrich otter outfield outfit outgoing
outlaw outlet overhead overpass overtime ownership oyster paddle paintball
pajamas pancake panda panther pantry paradise paragraph parakeet paramedic
parliament parlor parody parole parrot parsley partisan password pasta paste
pasture pathway patience patio pavement pavilion paycheck payroll peacock
peanut pearl pebble pedestrian pelican pencil penguin peninsula penthouse
pepperoni perch petal petition pharmacy pheasant photographer physics pickle
pickup pigeon pike pillow pineapple ping piranha pitcher pizzeria plagiarism
plaid plank plantation plateau platypus playground playlist playoff pledge
pliers plugin plumbing podcast pollute ponytail poodle popcorn popup porcupine
porpoise portal portfolio possum postal prairie prawn preach precinct
premiere preschool prescription pretzel preview privilege procedure processor
programmer promotion propeller prosecution prosecutor provision psychology
puck pudding puddle pulse puma pumpkin punctual punishment punt puppet puppy
puzzle quail quarrel queue quotation rabbit raccoon racket radish railroad
rainbow raisin ranger rapport raptor raspberry ratify raven realm realtor
rebate rebellion reboot recess recipe reconcile recreation referee reference
referendum referral refugee refund reggae register rehearsal reindeer reliable
reluctant rematch remedy remix repay replay reptile republic republican
reservation reservoir resign restrict retailer retweet reunion revolt ridge
riff ringtone rink ripple riverbank romance rooftop roommate rooster roster
router runway sacrifice saddle saga sailboat sailor salesman salon salsa
sanctuary sandal sandwich sardine saturday sausage scalp schoolyard scooter
scorpion scrape screenshot script scroll seafood seahorse seashore seatbelt
selfie selfish semester semi sensor september sergeant serial sesame
settlement shark shipment shortage shortcut showroom shrimp shrine shuttle
sibling sideline sidewalk signature silicon sincere singles sitcom skateboard
skeleton sketch skirt skunk skyline skyscraper sleeve smartphone smoothie
snack snail snapshot sneeze snowflake socialist socialize socket softball
solo sometime songwriter soulmate soundtrack sovereign spaghetti sparrow
speedometer spider spinach sponge spouse sprint squabble squid squirrel stag
stallion standup starfish statute stingray stockbroker stool stork storyline
strawberry streaming strengthen stripe stubborn submarine subscribe
subscription substitute subtitle suburb subway suitcase sunburn sundae
sunflower sunglasses sunlight sunshine superior supermarket supervisor
supplier surgeon surrender sushi suspicion swan swimmer swimsuit syllabus
sympathize symphony sync syrup tablet taco tavern taxi teammate tech
technician teenager template tennis terminal termite terrace terrain terrorism
textbook thanksgiving therapist thermometer thigh thorn thoughtful thread
thrive thumbnail thunder thursday timber timeline timeout toast toddler tofu
toggle toilet token tolerance tollway tomato tongue toolbar tornado torso
tortilla tortoise totalitarian toucan touchscreen tournament towel township
trademark transaction transport treasure treetop triathlon tribunal tribute
trilogy troll trolley trophy tropical troubleshoot troublesome trout truce
truthful tryout tsunami tulip tuna tundra turnpike turtle tutor tutorial
tutoring tuxedo tweet twenty umbrella umpire unconditional undergraduate
underground undershirt underwear unemployment unfaithful unstable unwed
upload uptown url username vaccine vacuum vanilla vegetable velvet venue
veto villain vinegar vineyard violation vista vitamin vocabulary volcano
volleyball voucher vulture waffle waist wallet wallpaper walnut walrus
wardrobe warehouse warranty watchful waterfall waterfront watermelon weasel
webcam wednesday wetland whale whippet whirlpool whistle wholesale wholesome
widget wifi wilderness wildfire windshield wireless wolverine woodpecker
workforce workout workplace workshop wrist yacht yearbook yearly yogurt
zebra zucchini
bile brat carp chow clamp cloak crate crumb crypt felt flask fury gig gist grub gums
hex hinge lever lobe lull max mess molt mush nave nook oats pore rein rind romp rump
scab shawl slag slob snag soot spec sway tact tarp tier tint torch trench turf welt
womb wrench yolk clasp flint plume pouch prism sheath cuff crux daub daze fowl jinx
bluff notch pants
sloth thirst organ artery nostril eyelid jawline ribcage pelvis tendon ligament
bladder intestine colon thyroid tonsil marrow cartilage fracture sprain dosage
capsule splint crutch wheelchair asthma diabetes seizure concussion insomnia
fatigue disorder calcium magnesium potassium sodium cholesterol antibody
adrenaline cortisol serotonin dopamine melatonin childbirth puberty adolescent
dementia arthritis osteoporosis anemia pneumonia tuberculosis hepatitis malaria
influenza measles chickenpox smallpox polio tetanus rabies
salamander seagull hippopotamus piglet joey filly guinea
carton crust porridge granola veal fillet patty meatloaf drumstick squash broth
omelet crepe custard nutmeg basil oregano thyme rosemary cumin paprika cayenne
lemonade whiskey vodka rum tequila champagne cocktail
ledge cavern mesa inlet thicket grassland iceberg crater drizzle downpour icicle
typhoon overcast smog twilight moonlight starlight tremor aftershock landslide
avalanche sinkhole fern daisy pansy petunia bramble redwood
condo villa bungalow cellar hardwood laminate hearth duct staircase railing
banister elevator escalator quilt bedspread headboard loveseat recliner armchair
ottoman footstool endtable coffeetable chandelier sconce lantern vanity shampoo
dishwasher dustpan corkscrew opener garbage compost drywall lumber screwdriver
sandpaper sprinkler shovel wheelbarrow
leggings jumpsuit romper panties sneaker beanie bonnet beret helmet visor
headband bandana turban bowtie poncho ribbon fringe tassel brooch pendant anklet
goggles clutch briefcase tote satchel polyester denim suede satin corduroy fleece
cashmere tweed polka attire accessory starch tailor seamstress
mama papa mommy daddy triplet grandma grandpa nephew madam mister missus resident
foreigner duchess baron pharmacist psychologist plaintiff priest pastor rabbi
imam bishop monk colonel butcher fisherman rancher cowboy navigator anchor
correspondent waitress receptionist
december medieval countdown seventh ninth tenth
limo firetruck tram streetcar monorail blimp balloon glider parachute rowboat
avenue crossroad roundabout crosswalk median hangar wharf berth buoy pedal
fender airbag honk siren boarding visa campground
volley disqualify judo snowboard skating checkers blackjack domino controller
joystick headset treadmill barbell dumbbell lunge interception
tragedy prequel funk violin cello trumpet saxophone waltz tango breakdance
statue photography exposure aperture vinyl cassette stanza climax prank skit
satire sarcasm spotlight
probation felony misdemeanor infraction investigator inmate shutdown marines
pistol shotgun cannon missile
atom acceleration celsius fahrenheit vibration resonance electricity magnet
beaker gene dna rna ecology endangered astronomy cosmos nebula comet meteor
zodiac relativity electron
concept belief digit kilometer liter kilogram barrel bushel quart triangle oval
aluminum amethyst parchment envelope cardboard concrete cement mortar varnish
staple needle demon witch potion oracle prophecy
`.split(/\s+/).filter(w => w.length >= 3);

const VERBS = `
ace act add age aid aim air ask ate ban bar bat bay bed bet bid bit boo bow bug bum
buy can cap car cob con cop cry cub cue cup cut dab dam dig dill dim din dip dog don dot
dry dub dud dug dye ear eat egg end era err eye fag fan fax fed fig fin fit fix fly
fog for fry fun fur gag gap gas get gin got gum gun gut guy had ham has hat hid him
hit hob hog hop hug hum ice ink ion jab jag jam jar jig jog jot joy jug jut key kid
kin kit lag lap lay let lie lit log lug mad map mar mat met mix mob mop mow mud mug
nab nag nap net nip nod nor not now nut pad pam pan pat paw pay peg pen pet pin pip
pit ply pod pop pot pry pub pug pun put rag ram ran rap rat raw ray red rev rib rid rig
rim rip rob rod rot row rub rug run rut sac sag sap sat saw say see set sew shy sin sip
sir sit six ski sky sly sob sod sow spy sty sue sum sun sup tag tan tap tar tax tip
toe ton too top tot tow toy try tub tug tun two use van vet vex vie vim vow wad wag
war was wax wed wet who wig win wit woe wok won woo wow zap zip
abet abase abut ache arch atop avow back bait bake band bang bare bark base bash bask
bate bath bear beat bell beg bend best bias bike bill bind bite blot blow blur boar boat
bolt bomb bond book boom boot bore boss bowl brag brew buck burn burp bury bust buzz
cage calm came camp care cart cave char chat chip chop cite clad clam clap claw clip
erect
clog club clue coal coat coax cock code coil come cook cool cope copy cord core cost
coup cram crew crop crow cube curb cure curl dash date dawn deal deck deem deny dine
dock does dole dome done doom dose down doze drag draw drip drop drum duck duel dump
dunk dust earn ease echo edge edit emit envy even exit face fade fail fake fall farm
fast fawn fear feat feed feel file fill find fine fire fish fist flag flat flaw flee
flew flip flit flog flow foam fold foil fool foot ford forge fork form foul free fuel
fume fund fuse fuss gain gait gape gash gate gave gaze gift give glad glow glue grab
grade grin grip grit grow gush hack hail halt hand hang haul have hawk haze haul heal
heap hear heat heed heel help herd hide hike hint hire hiss hitch hive hold hole home hone
hook hope host howl huff hunt hurl hurt hush iron jack jail jest jilt join joke jolt
judge jump keep kick kill kind kiss kneel knew knit know lace lack land last lash lead
lean leap lend lick lift like limp line link list live load loan lock long look loop
loom lose love lure lurk mail make mark mask mate maul mean meet melt mend mind mine
miss moan mock mold monitor moon mope mount mourn move much muse must nail name nark
near need nest note obey omit ooze open oust over pace pack page pant park part pass
past pave pawn peck peek peel peer pelt pick pile pine piss plan play plod plot plow
ploy plug plum plus poke poll pool poor pour pray prim prod prop pull pump push quiz
race rack rage raid rain rake ramp rank rant rate rave read reap rear reel rely rend
rent rest ride ring riot rise risk roam roar rock rode role roll roof root rope rove
ruin rule rush rust sack said sail sake save scan scar seal seam seat seed seek seem
send serve sew shag shed shim shin ship shock shoe shoo shop shot show shun shut sigh
sign sing sink site size skim skip slam slap slay sled slew slim slip slog slot slow
slug slum smack smash smell smile smite smoke snap snare snatch sneak sniff snore sort
soak soap soar sock soothe sort sour span spar spark speak speed spell spend spill spin
spit spoil spoke spoon sport spray spread spring sprout squeeze stack stagger stain
stake stall stamp stand stare start state stay steer step stick sting stir stock stomp
stop store storm stow strip study stuff stump stun submit suck suggest suit sulk sum
supply surf surge survey swap swear sweat sweep swell swept swim swing swipe switch
swore tackle take talk tame tank tape toss tease tell tempt tend test thank tick tide
tidy tie till tilt time tire toad toil toll tone took toot tore tour tout town trace
track trade trail train trap travel tread treat trend trick tried trim trip trod trot
trouble truck trudge trump trust try tuck tumble tune turn twist type undo unit unite
unload unlock untie unveil usher value vault vary veer vent venture view voice vote
wade wager wait wake walk wander want ward warm warn warp wash waste watch water wave
waive wear weave wedge weep weigh welcome weld wheel whine whip whirl whisper widen
wield wilt win wind wipe wish withdraw wither witness woke wonder work worry worship
wound wrap wreck wrestle wring write yank yawn yearn yell yield zero zoom
abort absorb accept access accuse accrue achieve acquire act adapt adjust admire adopt
advance advise afford affirm agree alert align allege allow alter amaze amend amuse
annex annoy answer appeal appear apply arise arouse arrest arrive assert assess assign
assist assume assure attach attain attempt attend author avenge avoid awaken battle
behave belong betray beware bless block blossom boast borrow bother bounce breach
breathe burden bypass cancel carve caution challenge channel charge charter chatter
cherish circle clarify classify clamor cleanse coerce collect combat combine comfort
command compel compile comply compose conceal concern condemn conduct confess confide
confirm confuse connect conquer consent conserve consider consist consult consume contact
contain content contest contrast control convict convince condemn counter counsel create
credit deliver demand depart depend depict deploy derive deserve design desire detect
develop devote differ direct discard disclose dismiss display dispose dispute dissolve
divide donate double downfall edit effect elect emerge employ enable endure engage enjoy
ensure enrich equip escape evolve exceed excuse exempt exhaust exhibit expand expect
expend explain exploit explore expose extend extract factor falter figure filter finish
follow forbid forget forgive format foster fulfill furnish gather govern handle happen
harbor ignore imagine immerse impact implore impose improve include inform inhabit inject
injure inspect inspire install intend invade invest invoke involve isolate justify launch
listen locate manage manage matter meddle modify monitor neglect notice nourish nurture
object obtain occupy offend offset oppose order orient outwit pardon patrol penalize
perform persist plaster plunder plunge polish ponder portray possess precede predict
prepare preserve presume prevent proceed process produce profess project promise propose
prosper protect provide publish punish pursue qualify rebound recall recite reclaim
record recover recruit reduce reflect reform refrain refuse regain regard reject relate
relax release relish remain remind remove render repair repeat repeal replace report
request require rescue resent reserve resist resolve restore resume retire retreat
reveal reverse revolve enforce embrace emerge employ enable engage ensure evolve exceed
expect expose extend finance forgive furnish govern handle impose include inspire
install involve justify justify launch liberate observe operate outline overcome
persuade pronounce realize receive recover reform reflect regulate remove require
respect restore restore retain reverse
announce celebrate communicate complain continue contribute convince
dare define deliver describe despite determine develop disappear discipline
discover discuss eliminate encourage encounter establish estimate evaluate
examine exercise identify illustrate imagine implement impose indicate
influence install introduce investigate negotiate organize overcome
persuade please practice precisely prepare promote propose protect
provide recognize recommend represent satisfy search separate
suggest suppose surround testify threaten transform translate
understand volunteer
generate hate highlight invite leave maintain marry moderate occur remember
transfer acknowledge adore analyze apologize appreciate approve assemble
bargain bathe boil brighten broaden browse calculate cheat chew choke chuckle
collapse concentrate conclude confront construct cooperate correspond cough
crawl criticize crouch customize decorate decrease delegate delete delight
demonstrate deprive diagnose dictate disagree disappoint disconnect discourage
disguise distinguish distribute disturb dodge download educate embarrass
emphasize enroll entertain erase exaggerate exclude execute explode express
facilitate fascinate fasten flatten flick fling flood flourish fluctuate
forecast frighten frustrate gamble glance grieve harass hesitate import
incorporate inherit innovate inquire insure integrate interact interfere
interpret interrupt invent irritate itch lecture lessen lighten likewise
manufacture maximize mediate memorize merge minimize mobilize motivate
multiply navigate nominate normalize notify oblige originate outsource
overturn overwhelm parade parallel participate paste perceive pledge postpone
prescribe prioritize prohibit provoke rebuild reckon reconcile recycle refer
refrigerate reinforce relapse relieve remark remedy remodel renew reproduce
resemble reside resign restrict retrieve revise revolutionize rinse roast
sacrifice scratch sharpen shorten showcase simplify simulate situate specialize
specify splash stabilize standardize stimulate straighten strategize strengthen
subscribe summarize supervise supplement surrender suspend symbolize terminate
terrify thicken thread thrive tighten tolerate transport treasure troubleshoot
underline undertake unfold unify unpack upload utilize validate verify violate
visualize weaken
ail caw coo ebb eke irk lop nix rue balk bilk blab etch faze gird gnaw laud laze
loot lope maim molt pout brace churn clamp clasp cramp crave curse deter graze grope
grunt heave mangle notch nudge poach poise pounce purge quash repel ripen savor scold
scoop scour scrub shove shriek shrug skimp slant slash smear spool splat squat stoop
stroll strut swerve taunt thaw topple trample unwind vouch wallow whisk wince wrench
mess fib torch hex max
scorch singe swirl demote honk disqualify rehearse retake
`.split(/\s+/).filter(w => w.length >= 3);

const ADJECTIVES = `
bad big dry done dull due far fat few fit fun gay hot ill key mad new odd old raw red sad
shy wet fit apt coy icy lax mum wan
able aged airy arid avid bald bare best blue bold both busy calm cold cool damp dark
dead deaf dear deep dire drab drug dual dull dumb each easy edgy epic even evil faint
fair fake fast flat fond fond foul free full glad glib good gray grim half hard high
holy huge hurt idle just keen kind lame last late lazy left like live lone long lost
loud main male mass mean mere mild more much mute near neat nerdy next nice nude numb only
open oral over pale past pink plan plus poor pure quiet rank rare raw real rich ripe
rock rude safe same self shot shut sick slim slow soft sole some sore such sure tall
tame taut tense that thin tiny torn true ugly used vain vast very warm weak wide wild
wise worn zero
acute adult alert alien alive alone angry awful basic black blank bleak blind blond
blunt brave brief broad brown brute cheap chief civil clean clear close cruel curly
dairy dainty dense dirty dizzy drunk dusty eager early empty equal exact extra faint
false fatal final first fixed fleet flush folic fond frail frank fresh front funny
giant given glad grand grave great green gross grown happy harsh hasty heavy human
humid ideal inner joint jolly jumbo known large later legal level light livid local
loose lousy lovely lower lucky magical major messy minor modal moist moral muddy murky
naive naked nasty naval noble noisy novel okay olive onion only opted outer overt
pagan plain plumb polar possible potent prime pristine prone proud pure quick quiet
rapid raspy ready regal rigid risen rival rocky roman rough round royal rural rusty
sacred salty scary shady shall sharp sheer short silly solar solid sonic sorry sound
south spare stark steady steep stiff still stone stray stuck super sweet thick third
tight tiny total tough toxic tried ugly ultra unique upper upset urban usual utter
valid vague vivid vocal waste weary weird whole wicked windy wrong young
absent absurd active actual allied annual bitter brutal candid casual clever clumsy
coarse common costly custom deadly decent divine double driven drying earned easier
edible eighth eldest entire erotic ethnic exotic facial fierce fiscal flying forced
formal frozen futile future gender gentle global golden guilty hidden honest hungry
immune indoor intact intent junior kindly lively lonely manual marine marked mental
mighty mobile modern modest mortal mutual narrow native nearby normal online orange
outdoor packed partly passive patent placid plenty pliant polite potent proper proven
public purple racial random robust sacred secure select seldom senior severe sexual
severe shaken shared silent simple sinful slight smooth social softer solemn sought
sparse stable static steady sticky stolen strict strong stupid subtle superb tender
timely triple unborn uncommon unfair unique untold upbeat urgent useful vacant verbal
virgin visual wasted weekly wicked wooden worthy
afraid asleep available beautiful boring capable careful comfortable corporate
critical cultural currently dangerous definitely different differently difficult
dramatic economic educational effective effectively electric emotional enormous
essential eventually everybody everyday everything everywhere excellent exciting
extreme extremely familiar fantastic federal financial foreign frequently
fundamental gradually historical horrible immediately impossible important
incredible incredibly independent industrial intellectual interesting
international irish literary moreover naturally necessarily negative normally
northern obviously occasionally offensive official olympic original otherwise
personal personally physical political positive possibly practically previous
previously primarily private probably professional realistic reasonable recently
regional relatively relevant religious remarkable responsible revolutionary
romantic russian scientific sensitive seriously several significant significantly
similarly single social sophisticated specific specifically straight strategic
strong strongly suburban successful successfully suddenly sufficient surprisingly
traditional typically ultimately unable unfortunately unhappy unlikely unusual
various virtually
awake carefully complete distinct domestic either existing immediate
impressive innocent internal married muslim natural necessary
opposite permanent powerful presidential surprised surprising
temporary terrible valuable wonderful german spanish
absolute abstract abundant accurate adorable affordable aggressive agreeable
anxious appropriate artistic attractive automatic awkward balanced beloved
bloody brilliant cautious cheerful civilian colorful competitive comprehensive
confident conservative considerable consistent constant contemporary continuous
convenient countless cozy creative crimson curious cute damaged defensive
deliberate delicate delightful dependent depressed desperate detailed
devastating disabled disappointed dominant efficient elaborate elegant
embarrassed environmental evident exceptional exclusive expensive experienced
experimental explicit extensive extraordinary factual faithful fascinating
fashionable feminine fictional flexible fluffy fragile fragrant frequent
friendly frightened functional furious generous glamorous gorgeous graceful
gradual graphic grateful greasy gummy hairy handsome handy hardcore harmless
hearty historic hollow homeless hopeful hopeless hostile humble identical
ignorant imaginary immense imperial imported impressed inactive inadequate
inappropriate incomplete inevitable informal informative innovative integral
intentional interactive interested intermediate intimate invasive invisible
jealous judicial legitimate lesser loyal magnetic magnificent mandatory
masculine matching mature meaningful mechanical memorable minimal municipal
mysterious nominal notorious numerous occasional operational optional
outstanding overseas overwhelming parallel parental particular peaceful
pending permitted petty philosophical pleasant plump poetic portable precious
predictable predominant pregnant primitive probable productive profound
progressive prominent prospective protective psychological regulatory
reliable reluctant renewable republican residential resistant respective
responsive restricted resulting scattered secondary selective serial shallow
sidewaysn simultaneous sincere sober spatial spiritual spontaneous structural
substantial suitable sunny superior supportive surgical suspicious symbolic
sympathetic systematic tactical talented teenage terminal thankful theatrical
thorough thoughtful thrifty tolerant tragic tremendous tropical ultimate
uncertain uncomfortable unconditional underground underlying unexpected
unfamiliar universal unprecedented upcoming upstairs variable vertical viable
vibrant vicious voluntary vulnerable wasteful wealthy widespread wireless
worldwide worthwhile youthful
amber aqua auburn beige blonde blush burgundy cedar charcoal cherry chestnut
cyan ebony emerald flamingo fuchsia ginger hazel indigo khaki lavender lilac
magenta mahogany maroon mocha mustard neon onyx orchid pastel pearl periwinkle
platinum powder raspberry ruby salmon sapphire scarlet slate strawberry
tangerine taupe teal tomato topaz turquoise vanilla walnut`.split(/\s+/).filter(w => w.length >= 3);

// Common 2-letter American English words (only valid on 3×3 and 4×4 grids)
// Every word here is used in normal English sentences
const TWO_LETTER_WORDS = `
ad ah am an as at aw ax ay
be bi bo by
do
ed el em en er ex
fa
go
ha he hi ho
id if in is it
la lo
ma me mi mo my
na no nu
of oh ok on op or ow ox
pa pi po
re
so
ta to
uh um un up us 
we wo
ya ye im`.split(/\s+/).filter(w => w.length === 2);

// Additional common words that don't need inflection (prepositions, conjunctions, etc.)
const OTHER_WORDS = `
the and for are but not you all any can had her was one our out day get has him his
how its let may new now old see way who did got may own say she too use also back been
both came come down each find from give good have help here high home into just last
like long look made make many more most much must name only over part real same side
some such take tell than that them then they this time turn upon very want well were
what when will with word work year your about after again being below between could
every first found great house large later learn never other place plant point right
shall since small sound spell start still story their there these think those three
under until water where which while world would write above along began below carry
close could earth eight every found group heard house large later learn light might
never often other paper plant point right river shall since small sound start state
still story their there think those three under until water where which while world
above after again along began below carry close could earth eight every found group
heard house large learn light might never often other paper plant point river shall
since small sound start state still story their there think three under until water
where which while world young also another because before between cannot country differ
during follow found great house large later learn might never often place right small
sound start state still story these three under until water where which while world french
vile tub tube stud studs dog dogs
about according after against ago already always anymore anything anyway
basically behind besides between beyond closely completely definitely
despite differently directly elsewhere especially finally frequently
generally highly however immediately increasingly indeed initially instead
literally mainly meanwhile merely moreover naturally necessarily nevertheless
normally obviously occasionally otherwise perfectly personally precisely
previously primarily probably properly rarely rather really recently
relatively seriously significantly similarly simply somehow sometimes
somewhat somewhere specifically strongly successfully suddenly therefore
though throughout thus together tomorrow tonight totally typically
unfortunately unless until usually virtually whatever whenever
whatever whereas wherever whether without yeah yes yesterday
ever everyone everyone myself nowhere off per themselves via whom why
ample anyone anywhere away beneath decimal eighteen eighty else forty fourteen
fraction gallon gram handful kilo mega minimal nineteen ninety numerous ounce
ourselves pint remainder seventeen seventy sixteen theirs thirteen twenty
underneath whoever yep zilch
deft hazy moot oily rosy soggy bland gaudy grimy gruff hefty lanky leafy lusty meaty
mushy musty nutty obese pasty plush pushy rowdy sandy scant shaky showy sleek slick
snowy snug tacky dreary flashy flimsy folksy frosty homely jaunty limber mangy misty
morbid snooty stale steamy stocky stormy stout stubby sultry supple swanky touchy
trendy tricky filthy grumpy prissy quirky queasy ragged rancid rugged scarce sleazy
snappy sordid terse thorny tipsy vulgar wacky wobbly woolly wordy wiry woody zany
cranky crispy evasive brainy
goofy speedy hurried petite compact terrific dreadful atrocious updated outdated
phony counterfeit bogus shiny sparkling radiant thunderous deafening blaring muted
muffled shadowy thrilled courageous meek abandoned forsaken overlooked outraged
savage petrified jittery perplexed disoriented astonished awestruck speechless
drained lethargic sluggish mortified repulsed revolted nauseated appalled sickened
rebellious disobedient willful headstrong straightforward sneaky devious crafty
manipulative deceptive dishonest clueless oblivious shielded defended spotless
sanitary
`.split(/\s+/).filter(w => w.length >= 3);

// Common irregular plurals
const IRREGULAR_PLURALS = {
    child: 'children', foot: 'feet', goose: 'geese', man: 'men', mouse: 'mice',
    person: 'people', tooth: 'teeth', woman: 'women', ox: 'oxen', cactus: 'cacti',
    focus: 'foci', fungus: 'fungi', nucleus: 'nuclei', radius: 'radii',
    stimulus: 'stimuli', thesis: 'theses', crisis: 'crises', analysis: 'analyses',
    basis: 'bases', diagnosis: 'diagnoses', hypothesis: 'hypotheses',
    phenomenon: 'phenomena', criterion: 'criteria', datum: 'data',
    medium: 'media', memorandum: 'memoranda', curriculum: 'curricula',
    alumnus: 'alumni', leaf: 'leaves', knife: 'knives', wife: 'wives',
    life: 'lives', wolf: 'wolves', half: 'halves', self: 'selves',
    shelf: 'shelves', thief: 'thieves', loaf: 'loaves', calf: 'calves',
    elf: 'elves', dwarf: 'dwarves', scarf: 'scarves',
    deer: 'deer', fish: 'fish', sheep: 'sheep', series: 'series', species: 'species',
};

// Common irregular verb forms
const IRREGULAR_VERBS = {
    be: ['is', 'am', 'are', 'was', 'were', 'been', 'being'],
    have: ['has', 'had', 'having'],
    do: ['does', 'did', 'done', 'doing'],
    go: ['goes', 'went', 'gone', 'going'],
    say: ['says', 'said', 'saying'],
    get: ['gets', 'got', 'gotten', 'getting'],
    make: ['makes', 'made', 'making'],
    know: ['knows', 'knew', 'known', 'knowing'],
    think: ['thinks', 'thought', 'thinking'],
    take: ['takes', 'took', 'taken', 'taking'],
    see: ['sees', 'saw', 'seen', 'seeing'],
    come: ['comes', 'came', 'coming'],
    want: ['wants', 'wanted', 'wanting'],
    give: ['gives', 'gave', 'given', 'giving'],
    find: ['finds', 'found', 'finding'],
    tell: ['tells', 'told', 'telling'],
    put: ['puts', 'putting'],
    mean: ['means', 'meant', 'meaning'],
    keep: ['keeps', 'kept', 'keeping'],
    let: ['lets', 'letting'],
    begin: ['begins', 'began', 'begun', 'beginning'],
    show: ['shows', 'showed', 'shown', 'showing'],
    hear: ['hears', 'heard', 'hearing'],
    run: ['runs', 'ran', 'running'],
    hold: ['holds', 'held', 'holding'],
    bring: ['brings', 'brought', 'bringing'],
    write: ['writes', 'wrote', 'written', 'writing'],
    sit: ['sits', 'sat', 'sitting'],
    stand: ['stands', 'stood', 'standing'],
    lose: ['loses', 'lost', 'losing'],
    pay: ['pays', 'paid', 'paying'],
    meet: ['meets', 'met', 'meeting'],
    set: ['sets', 'setting'],
    learn: ['learns', 'learned', 'learnt', 'learning'],
    lead: ['leads', 'led', 'leading'],
    read: ['reads', 'reading'],
    grow: ['grows', 'grew', 'grown', 'growing'],
    draw: ['draws', 'drew', 'drawn', 'drawing'],
    spend: ['spends', 'spent', 'spending'],
    win: ['wins', 'won', 'winning'],
    teach: ['teaches', 'taught', 'teaching'],
    buy: ['buys', 'bought', 'buying'],
    send: ['sends', 'sent', 'sending'],
    fall: ['falls', 'fell', 'fallen', 'falling'],
    cut: ['cuts', 'cutting'],
    speak: ['speaks', 'spoke', 'spoken', 'speaking'],
    rise: ['rises', 'rose', 'risen', 'rising'],
    drive: ['drives', 'drove', 'driven', 'driving'],
    break: ['breaks', 'broke', 'broken', 'breaking'],
    build: ['builds', 'built', 'building'],
    eat: ['eats', 'ate', 'eaten', 'eating'],
    sleep: ['sleeps', 'slept', 'sleeping'],
    sell: ['sells', 'sold', 'selling'],
    choose: ['chooses', 'chose', 'chosen', 'choosing'],
    catch: ['catches', 'caught', 'catching'],
    deal: ['deals', 'dealt', 'dealing'],
    throw: ['throws', 'threw', 'thrown', 'throwing'],
    fight: ['fights', 'fought', 'fighting'],
    sing: ['sings', 'sang', 'sung', 'singing'],
    ring: ['rings', 'rang', 'rung', 'ringing'],
    drink: ['drinks', 'drank', 'drunk', 'drinking'],
    swim: ['swims', 'swam', 'swum', 'swimming'],
    fly: ['flies', 'flew', 'flown', 'flying'],
    hide: ['hides', 'hid', 'hidden', 'hiding'],
    shake: ['shakes', 'shook', 'shaken', 'shaking'],
    blow: ['blows', 'blew', 'blown', 'blowing'],
    wear: ['wears', 'wore', 'worn', 'wearing'],
    tear: ['tears', 'tore', 'torn', 'tearing'],
    freeze: ['freezes', 'froze', 'frozen', 'freezing'],
    steal: ['steals', 'stole', 'stolen', 'stealing'],
    ride: ['rides', 'rode', 'ridden', 'riding'],
    bite: ['bites', 'bit', 'bitten', 'biting'],
    wake: ['wakes', 'woke', 'woken', 'waking'],
    dig: ['digs', 'dug', 'digging'],
    hang: ['hangs', 'hung', 'hanging'],
    shoot: ['shoots', 'shot', 'shooting'],
    feed: ['feeds', 'fed', 'feeding'],
    lay: ['lays', 'laid', 'laying'],
    die: ['dies', 'died', 'dying'],
    lie: ['lies', 'lay', 'lain', 'lying'],
    seek: ['seeks', 'sought', 'seeking'],
    stick: ['sticks', 'stuck', 'sticking'],
    sweep: ['sweeps', 'swept', 'sweeping'],
    swing: ['swings', 'swung', 'swinging'],
    weave: ['weaves', 'wove', 'woven', 'weaving'],
    bind: ['binds', 'bound', 'binding'],
    bleed: ['bleeds', 'bled', 'bleeding'],
    breed: ['breeds', 'bred', 'breeding'],
    creep: ['creeps', 'crept', 'creeping'],
    flee: ['flees', 'fled', 'fleeing'],
    grind: ['grinds', 'ground', 'grinding'],
    leap: ['leaps', 'leapt', 'leaping'],
    light: ['lights', 'lit', 'lighting'],
    sew: ['sews', 'sewed', 'sewn', 'sewing'],
    shrink: ['shrinks', 'shrank', 'shrunk', 'shrinking'],
    sink: ['sinks', 'sank', 'sunk', 'sinking'],
    slide: ['slides', 'slid', 'sliding'],
    spin: ['spins', 'spun', 'spinning'],
    split: ['splits', 'splitting'],
    spread: ['spreads', 'spreading'],
    spring: ['springs', 'sprang', 'sprung', 'springing'],
    sting: ['stings', 'stung', 'stinging'],
    strike: ['strikes', 'struck', 'striking'],
    strive: ['strives', 'strove', 'striven', 'striving'],
    swear: ['swears', 'swore', 'sworn', 'swearing'],
    swell: ['swells', 'swelled', 'swollen', 'swelling'],
    wind: ['winds', 'wound', 'winding'],
    withdraw: ['withdraws', 'withdrew', 'withdrawn', 'withdrawing'],
    wring: ['wrings', 'wrung', 'wringing'],
    bear: ['bears', 'bore', 'borne', 'bearing'],
    bend: ['bends', 'bent', 'bending'],
    bet: ['bets', 'betting'],
    burst: ['bursts', 'bursting'],
    cast: ['casts', 'casting'],
    cling: ['clings', 'clung', 'clinging'],
    cost: ['costs', 'costing'],
    dream: ['dreams', 'dreamt', 'dreamed', 'dreaming'],
    dwell: ['dwells', 'dwelt', 'dwelling'],
    feel: ['feels', 'felt', 'feeling'],
    fling: ['flings', 'flung', 'flinging'],
    forbid: ['forbids', 'forbade', 'forbidden', 'forbidding'],
    forget: ['forgets', 'forgot', 'forgotten', 'forgetting'],
    forgive: ['forgives', 'forgave', 'forgiven', 'forgiving'],
    hit: ['hits', 'hitting'],
    hurt: ['hurts', 'hurting'],
    kneel: ['kneels', 'knelt', 'kneeling'],
    lend: ['lends', 'lent', 'lending'],
    overcome: ['overcomes', 'overcame', 'overcoming'],
    prove: ['proves', 'proved', 'proven', 'proving'],
    quit: ['quits', 'quitting'],
    rid: ['rids', 'ridding'],
    shed: ['sheds', 'shedding'],
    shut: ['shuts', 'shutting'],
    sling: ['slings', 'slung', 'slinging'],
    smell: ['smells', 'smelt', 'smelled', 'smelling'],
    sneak: ['sneaks', 'snuck', 'sneaking'],
    speed: ['speeds', 'sped', 'speeding'],
    spell: ['spells', 'spelt', 'spelled', 'spelling'],
    spill: ['spills', 'spilt', 'spilled', 'spilling'],
    spit: ['spits', 'spat', 'spitting'],
    spoil: ['spoils', 'spoilt', 'spoiled', 'spoiling'],
    stink: ['stinks', 'stank', 'stunk', 'stinking'],
    stride: ['strides', 'strode', 'stridden', 'striding'],
    string: ['strings', 'strung', 'stringing'],
    thrust: ['thrusts', 'thrusting'],
    tread: ['treads', 'trod', 'trodden', 'treading'],
    undo: ['undoes', 'undid', 'undone', 'undoing'],
    upset: ['upsets', 'upsetting'],
};

// ─── Banned words filter ────────────────────────────────────────────
const BANNED = new Set([
    'FAGGOT','VAGINA','RETARD','RETARDED','BITCH','FUCK','FUCKER','HITLER','NAZI',
    'NIGGER','NIGGA','MIDGET','WHORE','CUM','PENIS','BITCHES','HOES','HOE','JIZZ',
    'WEEWEE','DICK','DICKS','PENISES','WHORES','SLUTTY','PUSSY','PUSSIES','KIKE',
    'SHIT','SHITTER','SHITTY','SLUT','CUNT','CUNTS','ARSE','ARSES','WANKER','TWAT',
    'BOLLOCKS','COCKSUCKER','MOTHERFUCKER','ASSHOLE','ASS','DAMN','BASTARD','PISS',
    'CRAP','TITS','BOOBS','HOOKER','PIMP','DILDO','ORGASM','ANAL','RAPE','RAPED',
    'RAPING','RAPIST','MOLEST','PEDOPHILE','INCEST','FAG','FAGS','DYKE','HOMO',
    'QUEER','LESBO','PERVERT','PEDO','NEGRO','SPIC','CHINK','GOOK','WETBACK',
    'BEANER','COON','DARKIE','HONKY','GRINGO','JAP','TRANNY','HEIL','SLITS',
    'FUCKED','FUCKING','FUCKS','SHITS','SHITTING','BITCHING','CUNTING','RAPES',
    'PISSED','PISSING','DICKS','ASSES','SLUTS','WHORED','WHORING',
]);

// ─── Manual extras ──────────────────────────────────────────────────
// Quick-add words here — no inflection, added exactly as written.
// Just toss in any missing words you find during gameplay.
const MANUAL_EXTRAS = `fever fevers bye hey racist should
severance deduction withdrawal ledger nickel bankrupt millionaire billionaire copier
stapler binder apprentice trainee qualification sophomore module dissertation
trigonometry statistics probability astronomy ecology economics sociology
punctuation nonfiction fellowship tuition registration admission commencement
valedictorian salutatorian chalkboard whiteboard projector bulletin warmth fright
genius wrinkle flop tote jeopardy puff dislike fatigued artificial sham hoax
turkey audit builder painter expel agony arrogant ashamed astonish attitude awe
carefree contempt coward cranky despair despise disgust doubtful dread frantic
frenzy giddy glee gloomy greed grumpy humorous hysterical impatient impulse
insecure joyful lust mellow merry miserable moody motive naughty nightmare obsess
optimistic outrage paranoid passionate pity possessive regret restless revenge
ruthless sane sloppy smug sorrow spiteful stingy sympathy thrill timid tremble
trustworthy uneasy ungrateful wary witty acre autumn par avatar desktop dvd bee
coon anytime april appoint authorize confiscate corrupt deport affection argument
attraction bestow boundary breakup chum compatible eternal fetch sideways unfortunate
abashed abode abroad abrupt abstain abundance abyss accelerate acclaim accommodate
accomplish accountable accumulate acoustic acquisition acrid activate adamant adept
adequate adhere adjacent admin admonish advent adventure adverb adverse advertise
affable affiliate afflict aftermath aggravate aggregate aghast agile agitated
agonize ailment aisle alarmed allegiance allocate allude allure alteration altitude
ambiguous ambitious amiable amidst amortize amplifier amplify analogy analytics
anatomy ancestor anecdote anguish animate animated anime anomaly anonymous antenna
anthem anticipate antique apathy apologetic appalling apparatus appetite appetizer
applaud appraisal appraise appreciative apprehend apprehensive approximate aptitude
aquatic arbitrary arbitrate archive ardent aroma arrangement arrogance articulate
artisan artwork ascend aspire assertive asteroid astray astronaut astute atelier
atomic atrocity attentive audacity audible aurora austere authentic automate autonomy
aversion avert awhile backdrop backpacker bacteria baffled baggage banish banter
baritone baroque barren bashful baste beacon beckon befriend behold belligerent
benchmark benevolent benign bewilder bewildered bilateral billboard billow binge
binocular biography blanch blatant bleach blemish blender blinding blissful bloat
blockchain blossom blueprint blunder boisterous bolster bombard bonfire borderline
bottleneck bountiful boutique braise branding brash brazen breadth breathtaking
brevity briefing brilliance brisk bristle brittle brochure brood brooding
brushstroke buffer bumble buoyant bureaucracy burnish burnout bustle buyout caffeine
calamity caliber calibrate callous calorie campsite canopy canvas capacity capitalize
caption captivate captivated caramelize caricature carriage cascade casserole
catalyst catastrophe cease celestial centimeter centralize ceramic certify chancellor
charisma charismatic charitable charming chemical chlorine choreography chowder
chromosome chronic chronicle circulate circumstance classical clatter clemency cliche
clickbait clientele cliffside clingy clutter cobblestone coexist coherent coincide
coincidence colander collaborate collage collateral collide colossal combative
comeback comedian commemorate commence commentary commerce commodity communique
compass compassion compassionate compensate competent complacent compliance component
compound comprehend compress comprise concede conceited concierge concise concoct
condiment condone conductor confine conflicted conform confound congenial congestion
conglomerate conjure conquest conscience conscientious conscious consecutive consensus
consequence considerate consolidate conspicuous constellation constrain contaminate
contemplate contemptuous contend contentment contingency contradict converse convey
convulsion coordinate cordial covet cowardly crackle craving creativity credential
credible crescendo crescent crevice cringe crinkle critique crossover crucial
crumble crystal cuisine culminate cultivate cumulative cunning curator curdle
curtail customary cylinder dagger dangle dapper daydream dazzle debrief debris
decadent decentralize decipher decisive decompose deepfake defeated defiance defiant
deficiency dehydrate dejected delectable delicacy delicately delirious deluge
demographic demographics demolish demure denote denounce deplete deplore depreciate
deregulate derelict designate desolate despairing destined detached detain
deteriorate detest detour devastate devastated deviate devour devout diagram dialogue
diameter diction differentiate digest dignified dignify dilemma diligence diligent
dilute dimension diminish diplomatic directive disapproving disarray disbelief
discern disclaimer discontented discreet discrepancy discrete discretion disdain
disenchant disgruntled disgusted disheartened disheveled disillusion disintegrate
dismal dismay dismissive dispel disperse dispirited displace disposition disregard
disrupt dissatisfied distill distort distracted distraught distressed diverge
diversify divert dividend docile doctrine documentary documentation domineering
dormant downcast downsize downtime downturn drapery drastic drastically dreary
drench drenched drowsy dubious dumbfounded durable dutiful dwindle earthy easel
easygoing eccentric economize ecosystem ecstatic editorial effervescent elated
electrode elevation elicit eligible elope eloquent elude emanate embargo embark
embellish embezzle emblem eminent emission empathetic empower empowered enchanted
encrypt endanger endear endearing endeavor endorse energetic energize engross enigma
enlightened enraged ensemble entail enthrall enthusiastic entreat entree enumerate
envelop envious envision enzyme epidemic epilogue epitome equation equator equity
eradicate erode errand eruption escalate espresso essence estrange etching euphoria
euphoric evacuate evade evaporate everlasting evoke evolution exasperate exasperated
excavate excerpt excessive excited excursion exhibition exhilarate exhilarated
exonerate expanse expectant expedite expedition expenditure expertise expressive
exquisite extinct extravagant exuberant facade facet fallacy famine famished fanatic
fanciful fandom farsighted fastidious fathom fearful fearless feasibility feasible
feather feeble feisty ferment ferocious ferocity fertile fervent festive fiasco
fickle fidelity fidgety fiduciary fiery fiesta figment figurine filmmaker fintech
firecracker fission fixture flagship flair flambeau flamboyant flashback flaunt
flavor flawless fledgling flinch fluent fluster flustered focused foliage folklore
fondue foolhardy foolproof foothold footprint forbearance forceful foremost forfeit
forgo forklift forlorn formidable formulate forsake forthcoming forthright fortify
fortress fossil fragment fragrance framework framing frazzled freewheeling fresco
friction frigid frisky frivolous frolic frontier frontline frostbite frown frugal
fruitful fruitless fulfillment fumble fundraise furnace furrow fusion fussy gadget
gallant garland garnish garrulous generic genial genome geology ghastly gigantic
glamour glare gleaming gleeful glimmer glistening glitter gloat globalize
globetrotter glorify glorious glossy glucose gluttonous gopher gourmand gourmet
governance gracious gradient graffiti granite grapple gratify gratitude gravity
greedy gregarious grenade griddle gridlock grievance grinder gritty grotesque
grouchy grudge grudging grumble guarded guidebook guideline gullible gusto haggard
halfhearted hallmark hammock hamper handicap handiwork haphazard hapless hardworking
hardy harken harness harrowed haste hasten haywire headquarter heartbroken heartless
heavyhearted hectic heighten helpless hemisphere heredity heritage heroic hesitant
hibernate hideous hierarchy hilarious hilltop hinder hoarse holistic homage homesick
homestead horrified horsepower hospitable hospitality hover huddle humane
humanitarian humbled humidity humiliate humiliated hustle hybrid hydrogen hygiene
hyper hyperactive hypothetical idealistic idealize ideology idyllic ignite illuminate
imaginative imbalanced immaculate immaterial immature immersive imminent immodest
impair impartial impassioned impeccable impede impending imperative impersonate
impetuous impish implicit impoverish impractical improvise impudent impulsive
inaccessible inadvertent inattentive incandescent incensed incentive incessant
incline inclusive inconvenient increment incremental incubate incumbent indecisive
indelible indifferent indigenous indignant indispensable indulge industrialize
industrious infamous infatuate infatuated infect infer infinite inflate inflexible
inflict infrastructure infuse ingenious ingredient inherent inhibit inhibited
initiate initiative injustice innate innocence innumerable insatiable insightful
insistent insolent inspiration instantaneous instigate instinct institute insufficient
insulate insulin insulted intellect intensive intercept interlude intermission
intermittent intimidate intolerant intrepid intricate intrigue introvert intuition
intuitive inventive inventor invincible involuntary irate irked ironic irony
irregular irrelevant irresistible irreverent irrevocable irrigate irritable isotope
iterate itinerary jaded jargon jeopardize jubilant judgmental julienne jumpstart
jumpy juxtapose kayaking keynote kickstart kindhearted kindle knack knapsack knead
lackluster ladle languid latitude laureate lavish layoff layover leftovers leisure
lenient levelheaded leverage liability liable liaison lighthearted limelight
limestone linger liquidate litigate livecast livestream locomotive lofty lonesome
longitude lucid lucrative luminous luscious luster lyricist maestro magnanimous
magnate magnify magnitude mainland makeup malicious manifest manipulate manuscript
marginalize marinate masterpiece materialistic matrix meager measured mediator
mediocre meditative medley melancholy melodramatic membrane memento memorabilia
menace merciful mercury metabolism methodology meticulous metronome microscope
microwave miffed milestone mindful miniature mirthful mischievous mislead mitigate
mobility modernize molecule momentum monetary monopolize monotone montage morale
moratorium morose morsel mosaic motivation mournful multimedia multinational
multitask mundane mutation mystified narrate negligent neighborly neural neurotic
neutron niche nickname nimble nitrogen nocturnal nocturne nonchalant nonprofit
northeast northwest nostalgic notarize novelist novice nullify nutrient nutrition
obedient obnoxious obscure observant obsessed obsolete obstinate obstruct oceanfront
offshore offspring optimal optimize orchestrate organism originality ornate oscillate
outback outbreak outperform outright outshine outskirt outweigh overbearing
overcooked overhaul overjoyed override oversight overthrow overture pacify palette
pampered pandemic panicked panini panorama paradigm paradox paramount parasite
parfait parkway particle partnership passport pastry pathetic patronize patronizing
payload payout peculiar penetrate pensive perceptive percussion peril perimeter
perky permissive perpetual persistent personnel persuasive pertinent pessimistic
pesticide petrol petroleum petulant phaseout philharmonic phosphorus photon
picturesque pigment pilgrimage pipeline pitiful placeholder platter plausible
playwright plight plucky plywood poached poignant pointless pollinate pompous
populate porthole postcard pottery pragmatic precaution precise predator predecessor
prejudiced preliminary premise preoccupied prestige presumptuous pretentious prevail
prevalent primate privatize proactive proclaim procure procurement prodigy
proficiency prognosis projection prominence promotional propaganda propagate propane
propel proprietary prose prosecute prospectus protagonist protocol proton prototype
prudent publicize puree purify puzzled quaint quantify quarantine quarrelsome
quarterly quartet querulous questionnaire quizzical radiation rainfall rainforest
rambunctious ramekin rampant ransomware ration rational rationale ravage ravine
reallocate reassured rebrand receptive recession recipient recital reckless
recollect reconfigure rectangle redirect redundant refine reflective refract
refreshed refuge refute regretful reimagine reimburse reinstate reinvent reinvest
reiterate relaxation relentless relocate remnant remorseful remotely remunerate
renaissance rendezvous rendition renegotiate renovate repertoire replenish replica
repository repossess repress reproach reputable requisite resentful residue
resilient resolute resonate resourceful respectful respiration restrain restrained
restructure retention retrofit revelation reverent revert revitalize revoke rewind
rhetoric righteous rigorous risotto rivalry riverside roadblock roadside rotisserie
rotten rueful rupture sabotage safari safeguard sarcastic saturate saute savory
savvy scaffold scalable scallop scarcity scenario scenery scenic scholarly scornful
scramble scrutinize scrutiny sculptor sculpture seaport seasonal seasoning secretive
sediment seismic sensation sentiment sentimental sequel sequoia serenade serene
setback settled shameful shareholder sheepish sheltered shoreline shortfall shrewd
sightsee signify silhouette simmering skeptical skewer skillet slogan smothered
snorkel snowfall solicit solitary solitude soloist soluble somber sonata sorrowful
souffle soulful souvenir spatula specialty specification specimen spectacle
spectacular spectrum speculate spellbound sphere spirited spoonful squeamish
stagnant stakeholder stance standoffish standpoint statistic stature statutory
steadfast steamed stellar stereotype sterile stipend stipulate stockpile stoic
storyboard streamline strenuous stressed strudel stumble subcontract subdued
submissive subordinate subsequent subsidiary subsidize substance subtext subtract
successor succulent succumb suffice sulfur sulky sullen sunbathe sundried sunscreen
superficial superstitious suppress surfboard surveillance sustainability syndicate
syndrome tableau tablespoon tactful tangible tapestry tariff taxable teaspoon
technique tedious telecommute telescope temperament temperamental temperate tempo
tenacious tenderloin tentative tenure teriyaki testament textile texture theorem
thermal thoughtless threshold thriller thunderstorm topical topography tormented
traction trailhead trailside trajectory tranquil transcend transcript transmit
transparency transparent trauma traverse trillion triumphant trivial troupe turbine
turbulence turbulent turmoil turnaround turnover tycoon ultraviolet unaffected
unanimous unappreciated unashamed uncommitted unconvinced uncover undecided
undercover undergird undermine underperform underrate underscore undervalued
underwater underwrite undeserving undeterred unfazed unflappable unforgettable
unilateral uninhibited uninspired unionize universe unleash unmoved unnerved
unperturbed unpredictable unravel unreliable unrepentant unruffled unselfish
unsettled unyielding uphold uplift upscale uptight uranium usurp utensil utilization
vaccination valiant vanguard vantage variation vaudeville vehement velocity vengeful
verdict verification versatile viability vibrate vibrato viewpoint vigilant
vindicate vindictive vintage virtuoso virtuous visceral vitality vivacious vocation
volatile volatility voltage voyage wanderlust warmhearted watercolor wavelength
wayside whitewater wholehearted wildlife windfall windmill winery wistful withhold
withstand woodland woodwind worldly worthless wrath wretched yearlong zealous zesty
pesto wasabi aioli tahini sriracha vinaigrette chutney
tongs toaster grater saucepan strainer sieve chopstick broiler carafe decanter
mandolin whetstone zester placemat
grape plum strawberry blueberry blackberry cranberry nectarine cantaloupe grapefruit
tangerine raisin prune date rhubarb guava papaya plantain pomegranate kiwi
persimmon honeydew quince currant mulberry elderberry gooseberry boysenberry
clementine kumquat lychee starfruit dragonfruit tangelo passionfruit
carrot cabbage cauliflower asparagus artichoke arugula beet turnip parsnip
radish rutabaga leek shallot scallion endive fennel chard collard eggplant okra
yam pea lentil chickpea soybean sprout watercress daikon jicama turmeric kohlrabi
chestnut hazelnut pecan pistachio almond cashew macadamia
alpaca anaconda anchovy anteater antelope armadillo barracuda beagle bobcat
bumblebee bullfrog canine centipede chameleon chimpanzee chinchilla cicada
collie condor copperhead corgi crayfish dachshund dalmatian gazelle gecko gnat
greyhound grouse halibut husky ibis impala jackrabbit kestrel kingfisher koi
lemming lemur mackerel mallard mandrill marlin marmot mastiff meerkat mink
mockingbird mongoose narwhal ocelot orangutan peregrine plover python
rattlesnake rhinoceros roadrunner rottweiler sable sandpiper spaniel sturgeon
tabby tadpole tapir terrier viper vole wallaby warbler wombat woodchuck
bobsled bunt caddie catcher cleats croquet deuce discus dugout epee homerun
infield javelin karate luge lob midfield pushup raceway semifinal shutout
slalom slugger somersault spike striker touchdown tracksuit warmup wicket
acorn bamboo birch blizzard bog bulb clover cyclone dandelion dewdrop fjord
flint geode geyser humus lichen magma mangrove monsoon mound opal pollen
quarry quartz sapling savanna seashell seedling silt sleet spruce steppe
sycamore tempest thistle twig willow cypress
antivirus barcode bitmap captcha chatbot cipher codec crypto daemon defrag
dongle emulate endpoint executable freeware frontend fullstack gpu hotfix
hyperlink infrared inkjet intranet kernel keychain keystroke latency macro
mainframe markup megapixel metadata middleware phishing pipeline sandbox
snippet spam spyware subnet syntax taskbar trojan typeface uninstall unzip
uptime voicemail vpn webinar webpage whitelist wizard igloo fend
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Contractions (apostrophe removed) ─────────────────────────────
// "I've" → IVE, "don't" → DONT, etc.  Stored without apostrophes.
const CONTRACTIONS = `
ive youre youve youll youd hes hed shes itll weve
theyre theyve theyll theyd thatll wholl whod whats whatll
theres hows whens whys
isnt arent wasnt werent dont doesnt didnt wont wouldnt shouldnt couldnt
cant havent hasnt hadnt mustnt neednt aint
couldve shouldve wouldve mightve mustve whove
thered whered whatd howd therell itve
wanna gotta yall maam oclock
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Challenge Category Word Lists ─────────────────────────────────
// Used by the Category Challenge — each list is a curated set of words
// that belong to a game category. Words must exist in the main dictionary.

const CATEGORY_FOOD = `
apple apricot avocado bacon bagel bake banana baste bean beef berry biscuit blanch
braise bread breakfast broccoli broth brownie brunch burger burrito butter cake
calorie candy caramel caramelize casserole celery cereal cheese cherry chicken chili
chive chocolate chowder cinnamon clam coconut concoct cookie corn cracker cream
crepe crisp croissant crouton cucumber cupcake curdle curry custard dairy danish
dessert diet dill dine dinner dough dumpling egg enchilada entree espresso fajita feast
ferment fig flavor fondue food fork fried frosting fry fudge garlic garnish ginger
gourmet gravy grill grind guacamole hamburger herb honey jam jelly julienne kale
ketchup kettle knead lamb lemon lettuce lime lunch macaroni mango marinate mayo
meal meat meatball melt melon menu microwave morsel mousse muffin mushroom mustard
noodle nut oat oatmeal olive onion orange oyster pancake panini parfait parsley pasta
pastry peach peanut pear pepper pepperoni pickle pie pineapple pizza platter poach
popcorn pork potato poultry pretzel produce pudding pumpkin puree ramekin raspberry
recipe rice risotto roast rotisserie salad salmon salsa sandwich sardine sauce
sausage saute savory scallop scramble seafood seasoning sesame shrimp simmer skewer
skillet slice smoothie snack souffle soup spaghetti spatula spice spinach spoonful
squash steak steam stew strudel succulent sundae sushi tablespoon taco teaspoon
tenderloin teriyaki toast tofu tomato tortilla tuna turkey vanilla vegetable waffle
walnut watermelon wheat whisk yogurt zucchini
water juice tea coffee lemonade milkshake soda cider cocoa latte mocha cappuccino
punch nectar ale beer wine champagne cocktail bourbon whiskey vodka rum brandy gin
tonic kombucha matcha chai eggnog sangria mead decaf brew beverage drink gulp sip
ranch relish aioli barbecue chutney glaze horseradish hummus mayo marinade pesto
sriracha tahini tartar vinegar wasabi dressing vinaigrette soy teriyaki hot
knife spoon plate bowl cup mug pan pot wok oven stove tongs ladle blender toaster
grater peeler colander saucepan griddle apron napkin tray jar foil pitcher strainer
sieve chopstick glass mixer fryer broiler burner straw dish placemat carafe decanter
rolling whisk cleaver corkscrew funnel mandolin mortar pestle skimmer thermometer
timer tureen whetstone zester lid rack shelf pantry counter cupboard ingredient
grape plum strawberry blueberry blackberry cranberry nectarine cantaloupe grapefruit
tangerine raisin prune date rhubarb guava papaya plantain pomegranate kiwi
persimmon honeydew quince currant mulberry elderberry gooseberry boysenberry
clementine kumquat lychee starfruit dragonfruit tangelo passionfruit
carrot cabbage cauliflower asparagus artichoke arugula beet turnip parsnip
radish rutabaga leek shallot scallion endive fennel chard collard eggplant okra
yam pea lentil chickpea soybean sprout watercress daikon jicama turmeric kohlrabi
chestnut hazelnut pecan pistachio almond cashew macadamia
`.split(/\s+/).filter(w => w.length >= 3);

const CATEGORY_ANIMALS = `
alligator ant ape baboon badger bat bear beaver beetle bird bison boar buffalo
bull bunny butterfly buzzard camel canary caribou cat caterpillar cheetah chick
chicken chipmunk clam cobra cockroach cod coyote crab crane cricket crocodile crow
cub cuckoo deer dinosaur doe dog dolphin donkey dove dragon dragonfly duck eagle
eel elephant elk emu ewe falcon ferret finch firefly fish flamingo flea fly
fox frog gerbil giraffe goat goldfish goose gopher gorilla grasshopper grizzly
groundhog gull hamster hare hawk hedgehog hen heron hippo hog hound hummingbird
hyena iguana jackal jaguar jay jellyfish kangaroo kitten koala ladybug lamb leopard
lion lizard llama lobster loon lynx macaw magpie mammal manatee minnow mole monkey
moose mosquito moth mouse mussel newt octopus opossum orca oriole osprey ostrich
otter owl ox oyster panda panther parrot peacock pelican penguin pheasant pig
pigeon pike piranha platypus poodle porcupine porpoise puma pup puppy quail rabbit
raccoon ram raptor rat raven reptile robin rooster salmon sardine scorpion seahorse
seal shark sheep shrimp skunk slug snail snake sparrow spider squid squirrel stag
stallion stingray stork swan tiger toad tortoise toucan trout tuna turkey turtle
vulture walrus weasel whale whippet wildcat wildlife wolf wolverine woodpecker
wren yak zebra
alpaca anaconda anchovy anteater antelope armadillo barracuda beagle bobcat
bumblebee bullfrog canine cardinal centipede chameleon chimpanzee chinchilla
cicada collie condor copperhead corgi cougar crayfish dachshund dalmatian fawn
gazelle gecko gnat greyhound grouse halibut hornet husky ibis impala jackrabbit
kestrel kingfisher koi lemming lemur mackerel mallard mandrill mare marlin marmot
mastiff meerkat mink mockingbird mongoose narwhal nightingale ocelot orangutan
parakeet perch peregrine plover pony primate pug python rattlesnake reindeer
retriever rhinoceros roadrunner rottweiler sable sandpiper spaniel starfish
sturgeon tabby tadpole tapir terrier viper vole wallaby warbler wasp wombat
woodchuck hatchling hermit shepherd pointer setter pinto thoroughbred
`.split(/\s+/).filter(w => w.length >= 3);

const CATEGORY_SPORTS = `
athlete athletic badminton baseball basketball bat bike binocular bowling boxing
canoe catch championship climbing coach compete competition court cricket cross
cycling cyclist dart defense dribble drive event exercise fault field fitness
football freestyle frisbee game goal golf goalie grind gym gymnast gymnastics
handball helmet hike hockey hoop hurdle jersey jog jump kayak kayaking kick
kickball lacrosse league marathon match medal net offense olympic pitch player
playoff polo pool practice punt race racket rally referee rider rink rival rivalry
rugby run runner score scout serve shot skate skateboard ski skill slam soccer
softball speed sprint squad stadium surf surfboard swim swimmer swimsuit table
tackle team tennis tournament track trail trainer triathlon trophy tryout umpire
volleyball walk weight whitewater win wrestler yoga
archery arena bench block bout center corner crawl curling cushion diamond
disc doubles draft fencing foul fumble halftime inning lineup outfield overtime
paddle par pass penalty pole quarterback rebound relay roster rowing sailboat
sailing sideline singles sled slugger sparring stance stretch stroke stumble
substitute sweep timeout training trap tumble turnover vault wrestling
bobsled bunt caddie catcher cleats croquet deuce discus dugout epee homerun
infield javelin karate luge lob midfield pushup raceway semifinal shutout
slalom somersault spike striker touchdown tracksuit warmup wicket
`.split(/\s+/).filter(w => w.length >= 3);

const CATEGORY_NATURE = `
acre altitude atmosphere aurora autumn avalanche bay beach bloom blossom boulder
breeze brook bush campfire campsite canyon cave celestial cliff climate cloud coast
coastline cobblestone coral creek crest crevice crystal current dam dawn desert dew
drought dune dust earthquake ecology ecosystem erosion eruption evergreen fern flora
flower fog foliage forest fossil fountain freeze frost glacier globe gorge granite
grove habitat harvest hay heat hemisphere hill hilltop hurricane ice island jungle
lagoon lake landscape lava leaf lightning lily limestone mainland marsh meadow mesa
mineral moisture molecule moon moonlight moss mountain mushroom nitrogen oak oasis
ocean offshore orchid oxygen palm park parkway pasture path pebble petal pine planet
plant plateau pollinate pond prairie rainfall rainforest ravine redwood reef ridge
river riverside rock root sand sandstone scenic sea seafront seaport seaside
sediment sequoia shore shoreline sierra sky slope snowfall soil south sphere spring
star stellar stone storm stream summit sun sunburn sunlight sunrise sunset surf swamp
terrain thicket thorn thunder tide timber topography trail trailhead trailside tree
tropical tundra valley vine volcano wave wavelength weather wetland wilderness
wildfire wildlife wind windmill winter wood woodland
bark basin birch branch brush bud canopy cedar charcoal clay continent copper
crop delta dirt elm ember flood fungi gale garden gem glen gravel gust harbor
haze herb horizon ivy jade kelp log maple mist moor mud nest ore peninsula
rapids reed ripple rose ruby sage shrub slate snow tornado tulip waterfall
weed weeping
acorn bamboo blizzard bog bulb clover cyclone dandelion dewdrop fjord flint
geode geyser humus lichen magma mangrove monsoon mound opal pollen quarry
quartz sapling savanna seashell seedling silt sleet spruce steppe sycamore
tempest thistle twig willow cypress igloo
`.split(/\s+/).filter(w => w.length >= 3);

const CATEGORY_TECHNOLOGY = `
admin algorithm analytics animate app automate backup binary bitcoin blockchain
blog bluetooth broadband browser buffer byte cache cellular clickbait click clipboard
cloud code compile compute computer cursor dashboard data database debug deepfake
decrypt desktop digital display download email emoji encrypt ethernet extension
feedback fetch filename filter fintech firewall firmware flash font format framework
gadget gaming gigabyte gigahertz github glitch graphic hacker hardware hashtag
homepage hotspot html icon inbox input install interface internet iterate keyboard
laptop laser livestream login logout loop malware megabyte merge microchip
microphone microprocessor modem module monitor motherboard mouse multimedia
network neural node notification offline online operate optimize output override
password payload phaseout photon pixel platform playlist plugin podcast portal
processor program programmer protocol proxy ransomware reallocate reboot rebrand
reconfigure redirect registry render repository rewind router runtime scaffold
scalable scanner screenshot script scroll selfie sensor server silicon smartphone
software startup storage stream streamline subscribe sync tablet tech telecommute
template terminal texture thumbnail timeline toggle toolbar touchscreen transmit
troubleshoot tutorial tweet ultraviolet update upgrade upload url username virtual
virus voltage webcam website widget wifi wireless
adapter archive chip command compatible compress connect console cookie copyright
crash default deploy developer device dial domain driver drone embed encode engine
export fiber file folder gateway grid hack import index link load log memory
navigate patch ping pipeline popup port print privacy process profile queue ram
remote resolution restore robot satellite scan search security shortcut socket
swipe token tracker traffic tunnel user utility validate version wallpaper window
zip
antivirus barcode bitmap captcha chatbot cipher codec crypto daemon defrag dongle
emulate endpoint executable freeware frontend fullstack gpu hotfix hyperlink
infrared inkjet intranet kernel keychain keystroke latency macro mainframe markup
megapixel metadata middleware phishing sandbox snippet spam spyware subnet syntax
taskbar trojan typeface uninstall unzip uptime voicemail vpn webinar webpage
whitelist wizard
`.split(/\s+/).filter(w => w.length >= 3);

// ─── Body & Health ─────────────────────────────────────────────────
const CATEGORY_BODY = `
abdomen ankle arm artery back backbone bicep bladder blood bone brain breast breath
calf cartilage cell cheek chest chin collarbone colon cornea diaphragm ear eardrum
elbow esophagus eyelash eyelid face femur finger fingernail foot forehead gland gum
hair hamstring hand head heart heel hip intestine iris jaw joint kidney knee
kneecap knuckle larynx leg ligament limb lip liver lobe lung marrow metabolism
molecule mouth muscle navel neck nerve nostril organ ovary palm pancreas pelvis
pupil pulse rib scalp shin shoulder skeleton skin skull spine spleen stomach temple
tendon thigh thorax throat thumb thyroid tissue toe tongue tooth torso trachea
tricep uterus vein vertebra waist wrist
ache allergy antibiotic bandage bleed blister bruise cardio concussion cough
cramp cure diagnosis diet digest dose exercise fever fracture heal health immune
infection inflammation injection injury medicine migraine nausea nurse nutrition
ointment oxygen pain paramedic pharmacy pill prescription pulse remedy scar stitch
strain stress surgeon surgery symptom therapy transplant treatment vaccine virus
vitamin wellness wound
athlete blood body bone brain breath cell core ear energy eye face fat fiber
finger foot hair hand health heart immune joint kidney knee liver lung membrane
mental metabolism mineral mood muscle nerve organ oxygen physical protein pulse
reflex sense shoulder skin sleep spine strength tissue vitamin weight
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Music ─────────────────────────────────────────────────────────
const CATEGORY_MUSIC = `
accordion acoustic album alto anthem aria audio baritone bass bassoon beat bell
blues brass bridge cello chamber choir chord chorus clarinet classical composer
concert conductor country cymbal drum drummer duet ensemble fiddle flute folk
genre gospel guitar guitarist harp harmony hymn improvise instrument interlude
jazz key keyboard lyric mandolin melody microphone music musician notation note
oboe octave opera orchestra organ overture percussion pianist piano pitch polka
pop prelude quartet rap record recorder refrain reggae rehearsal remix rhythm
riff rock saxophone scale serenade singer solo sonata song soprano soundtrack
string strum suite swing symphony tempo tenor trombone trumpet tuba tune ukulele
verse vibrate viola violin vocal volume waltz
anthem ballad beat blues boogie cadence carol chant classical country disco duet
encore fanfare funk groove hip hop hymn jazz jingle karaoke lullaby march medley
melody opera overture pitch playlist pop prelude punk rap reggae remix rhapsody
riff rock salsa samba serenade solo soul swing tango techno theme tune waltz
acoustic album amplifier band banjo baritone bass baton bell bow brass bridge
bongo cellist cello choir chord chorus clef composer concert cymbal drum ensemble
fiddle flute gig gong guitar harp harmony instrument ivory jam keyboard lyre
mallet mandolin metronome note oboe octave orchestra organ piano pluck quartet
record reed rehearse rhythm sax scale snare solo soprano strum symphony tempo
tenor timpani tone treble trio trombone trumpet tuba tune viola violin vocal
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Home & Household ──────────────────────────────────────────────
const CATEGORY_HOME = `
apartment attic balcony basement bathroom bathtub bed bedroom bench blanket blind
bookcase bookshelf brick cabinet candle carpet ceiling chair chimney closet
couch counter cupboard curtain cushion deck den desk dining door doorbell
doorknob doorstep doorway drawer dresser driveway dwelling entrance fan faucet
fence fireplace floor foyer furniture garage garden gate gutter hallway hamper
handrail hedge home house housekeeper kitchen ladder lamp lawn light living
lounge mailbox mantel mattress mirror mop nightstand nursery ottoman oven
painting patio peel pillow plank plumbing porch radiator railing ranch recliner
refrigerator remodel renovate residence roof room rug shelf shower shutter
sidewalk sink skylight sofa stair staircase stairway stool storage stove
studio table terrace tile toilet toolbox towel vacuum veranda wallpaper wardrobe
washroom window windowsill workshop yard
apartment broom bucket cabinet carpet chandelier closet cozy detergent door
drape dryer duvet faucet floor furnace hamper hinge house insulate iron key
knob lamp laundry linen lock mantle mat mirror mop paint pantry patio pipe
plaster plunger polish porch rafter roof screw shelf shingle shutters sink
socket sponge stain step stove sweep table tenant tile trim vacuum vent wall
washer window wipe wrench
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Clothing & Fashion ───────────────────────────────────────────
const CATEGORY_CLOTHING = `
apron beanie belt bikini blouse bonnet boot bowtie bra bracelet brooch buckle
button cap cape cardigan cloak coat collar corset costume cotton cravat cuff
denim dress earring ensemble fabric fashion fedora flannel fleece frock garment
glove gown handbag hat headband heel hoodie jacket jeans jersey jewel jewelry
jumper kilt kimono knit lace lapel leather legging linen loafer mitten moccasin
necklace necktie nightgown outfit overalls overcoat pajama pants patch pearl
pendant plaid pocket polo poncho print pullover purse raincoat ribbon ring robe
sandal sari scarf sequin shawl shirt shoe shorts silk skirt sleeve slipper
sneaker sock stitch stockings stripe suit sunglasses suspender sweater swimsuit
tailor tank thread tie tights top trench trouser tunic tuxedo umbrella
undershirt uniform velvet vest vintage waistcoat wardrobe weave wool wristband
zipper
accessory alteration attire bead beanie blazer bootcut boutique brooch buckle
cashmere chiffon clasp clog corduroy costume crochet cufflink damask drape
embroider eyelet fabric fashion fiber fringe gauze glamour gown hemline lace
laminate leather linen mannequin mesh mink nylon organza paisley parka patent
pleat polyester rayon ribbon ruffle satin seam sequin sheer spool spandex suede
synthetic taffeta tailor thimble thread trim tulle tweed twill veil vintage
wardrobe weave wool worsted yarn
`.split(/\s+/).filter(w => w.length >= 2);

// ─── Science ──────────────────────────────────────────────────────
const CATEGORY_SCIENCE = `
acid analysis anatomy antibody asteroid atmosphere atom beaker biochemistry
biology botany carbon catalyst cell centrifuge chemistry chromosome climate
clone comet compound condense constellation control correlate cosmos crystal
cytoplasm data decay density diagram dissolve dna ecology electron element
embryo emission energy enzyme equation erosion evolution experiment extinct
fiber fission formula fossil friction fuel fusion galaxy gene genetic genome
geology germ gravity habitat helium hemisphere hormone hydrogen hypothesis
immune inertia infrared ion isotope jupiter kinetic lab laboratory laser lens
lunar magnet magnetism mammal mars mass matter membrane mercury meteor
microscope mineral mitosis molecule momentum moon mutation nebula neptune
neuron neutron newton nitrogen nuclear nucleolus nucleus observe orbit organism
osmosis ozone paleontology parasite particle periodic photon photosynthesis
physics planet plasma pluto pollinate polymer prism probe proton quantum quark
radiation reactor reagent research respiration rocket satellite saturn sediment
seismic semiconductor silicon solar solvent species specimen spectrum sphere
stimulus supernova synthesis telescope theory thermal tissue toxin transistor
universe uranium vacuum variable velocity venus vertebrate virus voltage watt
wavelength xray zinc zoology
acceleration amplitude anode barometer calibrate capacitor cathode celsius
centripetal chromosome combustion compound conductor convection diffusion
distillation dynamo electrode electrolyte emission enzyme fission fluorescent
fossil frequency gestation glacier gradient hemisphere hypothesis hypothesis
incubate insulate isotope latitude lithium longitude metabolism mineral muon
neutrino orbital oscillate oxidize palaeontology pathogen periodic photovoltaic
plasma polymerize precipitate proton pulsar radioactive reagent relativity
respiration semiconductor solstice spectrometer static telescope thermal
thermodynamics titration torque turbine ultraviolet
`.split(/\s+/).filter(w => w.length >= 2);

// ─── WordNet 3.0 extras (auto-generated by wordnet-integration.js) ────
// 12524 new words from WordNet 3.0 (4+ letters, 2+ senses, known English, not already in dict)
const WORDNET_EXTRAS = `
abaca aback abacus abandonment abasement abate abatement abbey abbreviate
abbreviated abbreviation abdication abdomen abduct abduction abductor
abecedarian aberrate aberration abidance abide abject ablactation ablate
ablation ablative ablaze abnegate abnegation abnormal abnormality aboard
abominable abominably abomination aboriginal aborigine aborticide abortion
abound abradant abrade abrasion abrasive abrasiveness abridge abruptness abscise
abscission absinthe absolutely absoluteness absolution absolutism absolve
absorption abstainer abstemious abstemiousness abstinence abstraction
abstractionism abstruseness absurdity abused abusive abutment abysmal abyssal
academic academician accede accelerator accent accented accentual accentuate
accentuation acceptable acceptance acceptation acceptive acceptor accessibility
accessible accession accidental accidentally accommodating accommodation
accommodative accompanied accompaniment accompany accomplished accomplishment
accord accordance accordant accordingly accost accounting accredit accrete
accretion acculturation accumulation accumulative accumulator accuracy
accurately accusation accusative acentric acerb acerbate acerbic acerbity
acerola acetate acetify acetum acetylate achondritic acidic acidify acidity
acinar acinus acknowledgement acknowledgment acme acquaint acquiescence acridity
acridness acrobatics acrostic acrylic actinia activated activation actualise
actualize actuate acuity aculeus acumen acyclic adagio adamantine adaptation
addict addiction addition additive addle addled adenoidal adequacy adherence
adhesion adjective adjoin adjourn adjournment adjudicate adjunct adjuratory
adjure adjustable adjustment adjutant adjuvant administer administrator
admirable admiral admiralty admiration admittance admixture admonition
admonitory adobe adolescence adonis adoption adoptive adoration adorn adornment
adrenal adrift adscititious adscript adulteration adulterator adulterous
adulthood adumbrate adumbration adust advancement advantage advantageous
adventurer adversity advert advertising advertize adynamic aegis aeolian aeon
aeonian aerate aerated aeration aerial aerie aeriform aerobic aerodynamic
aeroembolism aerosol aerosolise aerosolize aery aesthetic aesthetician
aestivation aether aetiological aetiology affect affected affectedness
affiliation affine affinity affirmation affirmative affix affixation afflicted
affliction affluent affray afghan afghani aficionado afield aflame afloat afoot
aftereffect afterglow afterthought agape agar agaric ageing ageratum agglomerate
agglomeration agglutinate agglutination agglutinative aggravated aggravation
aggregation aggression aggressiveness aggressor aggrieve agitate agitation aglet
agnostic agnosticism agonise agonist agonistic agora agreeableness agreement
agrestic agricultural agriculture ague agueweed aide aiglet aimless airhead
airmail airspace airstream airtight airway akee akin alabaster alar albacore
albatross albumen alchemy alcohol alcoholic alcoholise alcoholism alcoholize
alder alewife alexander alfalfa algarroba algorism alibi alidad alidade alienate
alienated alienation alienism alight alignment alike alimentation aliyah alkali
alkalinise alkalinize allay allegation allegorise allegorize allegory allegretto
allegro allergic alleviate alleviation alleviator alliaceous allocation
allograph allomorph allot allotment allowable alloy alloyed allspice allurement
alluvion almanac almandine aloft aloofness aloud alpha alphabetic alphabetical
alphabetize alpine alright altar alterable altered alternate alternating
alternative alto altogether alula alum alveolar alveolitis alveolus alyssum amah
amain amalgam amaranth amaranthine amarelle amass amateur amazon ambiance
ambidextrous ambience ambiguity ambition amboyna ambrosia ambrosial ambrosian
ambulatory ambush ameliorate amenable amerce ametabolic amiability amicability
amicableness amidship amiss amity ammonia ammunition amnesic amnesty amok
amorous amorousness amorphous amortisation amortization ampere amphibian
amphibious amphimixis amphisbaena amphistylar amphitheater amphitheatre
ampleness amplification amplitude amply ampulla amputation amuck amusement
amyloid anabolic anachronism anaemia anaemic anaerobic anaesthetic anaglyph
analogous analphabetic analyse analytic analytical anamnesis anamorphic
anamorphism anamorphosis ananas anaphora anastigmatic anastomose anathema
anatomic anatomical anatomize ancestral ancestry anchorage andante androgynous
andromeda anecdotal anemic anemone anergy anesthetic anestrous angelfish angelic
angelica angelical angelus angina angler anglicism angora angular angularity
angulation anil animadvert animalise animalism animalization animalize animator
anise ankylose annals annexation annihilating annihilation annotate annotation
announcement annoyance annul annulet annulment annulus annunciation anode anoint
anomie anomy anon anorectic anosmic anserine answerable antagonise antagonism
antagonist antagonistic antagonize antecedent antedate antediluvian anterior
anteriority anthrax anthropoid anticipation anticlimactic anticlimax
antipathetic antipathetical antipathy antiphonal antiphony antiquarian antiquate
antiquity antisepsis antiseptic antisocial antithesis antitype antitypic
antitypical antlion anvil anxiousness anyhow apace apache apanage apathetic
apelike apex aphasic apheresis aphoristic apocalypse apocalyptic apocryphal
apogee apologise apology apomictic apophysis apostasy apostle apostolic
apostolical apostrophe apothegmatic apotheosis appal appall appanage apparatchik
apparent apparently apparition appearance appease appellation appellative append
appendage appendix applecart applesauce appliance applier appointed appointee
appointive apportion apposition appraiser appreciation apprehension apprise
apprize approachable approaching approbate approbation appropriateness
appropriation approval approximation appurtenance apropos apteral aquamarine
aquanaut aquaplane aquatint aqueous arabesque arachnoid arbiter arbitration
arbor arboreal arboreous archaic archaist archangel archil architecture
architrave arctic ardor ardour arduous areola argonaut arguable argumentation
argus argyle argyll aridity aristocracy armament armband armed armiger armilla
armored armorer armory armour armoured armourer armoury armyworm arnica aromatic
arousal arraign arranged arranger arrears arrhythmic arroba arrogate arrow
arrowroot arsenal arsenic artful artfully arthrospore articulately articulation
articulator artificer artillery artless artlessly artlessness arum ascendant
ascendent ascender ascension ascent ascertain ascetic ascetical asceticism
ascription asepsis ashen ashram askance aslant asocial aspect aspergillosis
asperity aspersion aspersorium asphalt asphyxiate asphyxiation aspirate
aspiration assail assassin assassinate assassination assay assemblage assertion
assessable assessment assibilate assibilation assignation assimilate
assimilation assimilative assistance assize association assonant assort assorted
assortment assuage assumption assumptive assurance assurgent aster asterism
astern asthenic astigmatism astigmia astir astonishing astounding astragal
astragalus astrakhan astride astringe astringency astringent astronomic
astronomical astuteness asymmetrical asynchronous atheistic atheistical
athenaeum atheneum athwart atomisation atomise atomism atomization atomize atone
atonement atonic atrium atrociously atrophy attache attachment attainment
attaint attendance attendant attentiveness attenuate attenuated attenuation
attest attestant attestation attracter attractiveness attractor attribution
attrition atypical aubergine audacious audaciousness audiometry audiotape
auditor auger augment augmentation augmentative augur aura aural aureate aureole
auricle auricula auricular aurify aurochs auroral auspicate autarchy autarkical
authentication authorisation authorise authorised authoritarian authoritative
authorization authorized authorship autobiographic autobiographical
autochthonous autocracy autocratic autocratically autograph automat
automatically automation automatise automatize automaton automotive autonomous
autopilot autoplasty autotype autumnal auxiliary avail avarice aver averageness
averting aviation avoirdupois avowedly avulsion avuncular awareness awed aweigh
aweless awkwardness awless awry axenic axial axillary axiom axiomatic babble
babbler babel babyhood babysit baccalaureate baccate bacchanal bacchanalia
bacchant bach bachelorhood bacillar bacillary backboard backbone backdoor
backfire backhand backhanded backlash backlog backpedal backscratcher backseat
backside backstop backsword backward backwards backwash backwater bactericide
badlands baffle bagatelle bagger bagman bagnio bailable bailey bailiwick
balancer balata balboa baldpate bale baleful ballad ballast ballgame ballistics
ballpark balmoral balmy balsa balsam baltic bandwagon bandy baneberry baneful
bangle banian banishment bankable bankruptcy bannister banquet bantamweight
banting bantu banyan barb barbarian barbaric barbarise barbarity barbarize
barbarous barbecue barbed barbeque barber bard barefaced barge barilla barley
barleycorn barmy barnacle barnstorm barnstormer baronetage baronetcy barony
barrack barrage barratry barreled barrelled barrenness barricade barrio barrow
basal baseborn baseline basilica basilisk basque bassinet basso basswood bast
bastardise bastardization bastardize bastardly baster bastille bastinado basting
bastion bathhouse bathos baton battalion batten battered battledore battlemented
battue bauble baulk bawl bawler bayberry bazaar bazar beachhead bead beading
beadle beadwork beady beak beaming beamy bearberry bearded beardless bearer
bearskin beastliness beastly beaten beatific beatification beatify beatitude
beau beautify bechance becharm becket becoming bedevil bedfellow bedim bedizen
bedlam bedraggled bedrock beech beefwood beehive beep beetroot befall befool
befuddle befuddled beggar beggarly beggary beginner begrudge beguile beguilement
beguiler beguiling beguine behavior behaviour beheading behemoth belabor
belabour belay belch belching beldam beldame beleaguer belfry belie believably
believer belittle belittling belladonna bellarmine bellied belligerence
belligerency bellow bellwether bellyband belowground beluga belvedere bemused
bender benedict benediction benefaction beneficence beneficent beneficiary benet
benevolence benight benighted benignant benignity benjamin bennet benny benthos
benumbed benzoin bereft berg berlin berm beset besiege besieger besmirch
bespangle bespeak bespoken bestiality bestowal bestowment beta betel bethink
betoken betrayal betrothal betterment bevel bevy bewitch bible biblical
bicameral biddy biennial bier bifurcate bifurcation bigamy bighorn bight
bilaterally bilberry bilge biliary bilious biliousness billabong billet billfish
billionth billy bimestrial bimetallic bimillenary bimillennium bimonthly
binomial biogenesis biogenic biohazard biological biomass biomedicine bionic
bioremediation bioscope biotechnology bipartite bipolar biquadratic birdcall
birdie birl birr birthplace birthright bisexual bisexuality bittersweet
bitterweed bitterwood bivalent bivouac biweekly biyearly blackball blackbird
blackcap blacken blackened blackfish blackfly blackguard blackheart blackmail
blackout blacksnake blackthorn blackwash blackwood bladderwrack bladed blanched
blandishment blandness blare blase blaspheme blasphemous blasphemy blasting
blastogenesis blazing bleached bleary bleat blebby blemished blending blight
blighter blindside blindworm blinker blinking blip blistering blistery blithe
blitz blockade blockage bloodless bloodletting bloodline bloodshed bloodsucking
bloomer blotchy blowback blower blowfish blowhole blowout blowpipe blowtube
blowup blubber blucher bludgeon bluebell bluebird bluebonnet bluebottle bluefin
bluefish bluegrass blueing bluepoint bluing blushful bluster blustery boarder
boarfish bobsleigh bobtail bodacious bodied bodiless bodily bodkin bodyguard
bodywork bogey boggle bogie bogy bohemia bohemian boilerplate boisterousness
bola bole bolero bolivar bolivia bollock bolo bologna bolshevik bolus bombardier
bombardment bombardon bombastically bombshell bonanza bondable bondage bondmaid
bondman bondsman bondswoman bonduc bondwoman boned boneset boney bongo boniface
bonito bonk bony boob booby boodle booger bookmaker bookworm boomerang
boorishness boost booster bootleg bootlegging bootlicking borage bordeaux boreal
boreas borough bosom botany botheration bottlenose bottomless bouncy bounder
bounty bouquet bourbon bourgeois bourn bourne bovine bowdlerisation
bowdlerization boxberry boxed boxwood bozo brachiate bracken bracket brackish
brahma brahman brahmanism brahmin brahminism braid brail braille brainwash
brainwave braky bran branched branching branded brandish brashness brass
brassbound brassy bravery bravo brawl bray brazil brazilwood breadbasket
breadfruit breadstuff breakage breakdown breaker breakthrough bream breathless
brecciate breeziness breezy breton briar brickbat bridal bridegroom bridgehead
bridle brier brig brightness brilliantly brim brine brink brisling bristly brit
britt broadbill broadcaster broadcasting broadcloth broadside broadtail
brobdingnagian brocket broil brokerage bromate bromide bromidic brominate broody
brooklime brookweed brotherhood brougham brouhaha brow browbeat browning
brownstone brucellosis bruin bruising brushed brushing brushwood brutalisation
brutalise brutality brutalization brutalize bubbler bubbling bubbly bubo buccal
buckeye buckskin buckthorn buckwheat bucolic buddha buff buffalofish buffet
buffoon bugaboo bugbane bugbear buggy bugle bugleweed bugloss buildup bulbous
bulge bulging bulimia bulla bulldog bulletproof bullfinch bullhead bullion
bullock bullpen bullrush bulrush bulwark bumpy bundling bung bunghole bungle
bungling bunk bunker bunsen bunting buoyancy bureaucratically burgess burgher
burgoo burgrave burial burke burl burlesque burnside burnt burr bursa burton
bushing bushman bushwhack bushwhacker bushy businesslike butch butcherbird
butcherly butchery butler butt butte butterball butterfish butternut butterweed
buttery buttony buttress buxom byproduct byzantine cabal cabala cabalism
cabalist cabaret cabbala cabbalah cabinetwork caboose cabotage cachet cackle
cackler cacodyl cacophony cadaverous cadence cadge cadre caesar caesarean
caesarian caesura caftan cagey cagy cairn caisson cakewalk calabash calamus
calash calcification calcify calculation calculator caleche calibre caliche
calico caliphate calisthenics calk calla caller calliope callisthenics
callithump callosity callus caloric caltrop calumny calvary calve calycle
calyculus calypso calyptrate camber cambium camion camisole camlet camouflage
canalisation canalization cancellate cancellated cancellation cancerous
candelilla candied candlenut candlewick candor candour canescent canicular
canistel canister canker cannabis cannibalise cannibalize cannikin canon canonic
canonical canonise canonize cantala cantaloup cantankerous canteen canter
cantilever canto canton cantor canvass canvasser capability capableness
capaciousness capacitance capacitate caper capillary capitalisation capitalise
capitalist capitalistic capitalization capitulation capitulum capon capote
capricious capriciously capriciousness capriole capsicum capsid capstone
capsular capsulise capsulize captivation captive captivity capuchin caput
carambola caramelise carat caravan caraway carbonado carbonate carboniferous
carbonise carbonize carbuncle carbuncled cardamom cardamon cardholder
cardinalate cardiograph cardoon careen carefreeness carefulness caregiver
careless carelessly carelessness caretaker carillon carina carioca carload
carnal carnalize carnation carnauba carnivore carnivorous carob carol carom
carotene carousel carpetbag carrel carrier carrousel cartilaginous cartridge
cartwheel cartwright caseate cased casein casing cask casket cassava cassia
castaway caste caster castigate castigation castor castrate castration casualty
casuistic casuistical casuistry catabolic cataclysm catalogue catamount catapult
cataract catatonia catawba catbird catchfly catchword catchy catechetic
catechise catechism catechize catechu categoric categorical categorisation
categorization cater catfish catgut catharsis cathartic cathode catholic
catholicity cattleman catwalk caudal caudate caudex caul cauline causeless
causeway caustic cauterise cauterize cautery cautionary cautiously cavalier
cavalry cavalryman caveat cavernous cavity cecropia cede celandine celebrant
celebration celeriac celiac celibacy cellarage celluloid censor censoring
censorship censure centaur centaury centering centerpiece centesimal centime
centner centralisation centralization centre centrepiece centrifugal centripetal
cerebral cerebrally ceremonially ceremonious ceres cero certainty certifiable
certification certified cervical cervix chablis chachka chad chafe chaff chaffer
chaffy chaise chalaza chalky chamaeleon chamberlain chamfer chamois champ
champaign chancery chancy chandler chandlery changeable changed changeless
changelessness changeling changer channelise channelize chantry chaotic
chaotically chap chapman chapterhouse characterise characteristic
characterization characterize charade chardonnay chariot charioteer charleston
charlotte charmed charmer chartist chartreuse chaser chassis chaste chasten
chastisement chastity chateaubriand chatelaine chatterbox chatty chauvinism
chauvinist chauvinistic checker checkerberry checkered checkmate cheddar
cheerfulness cheesecake chela chelate chelation chemically chemise chemist
chenille chequer cherimoya cherrystone cherub chervil chesterfield chesty
chevalier chevron chewy chicane chichi chickweed chicory chieftain chigger
chihuahua childlike chile chilliness chilly chimaera chimera chimerical
chinaberry chinaman chine chinese chinook chinquapin chintzy chirp chirpy chisel
chit chiton chivalry chives chlamydia chlamys chloride chlorinate chlorination
chock choctaw chokecherry chokehold choler choleric chon chopin choppy chorea
choreograph chou chowchow christian chromatic chrome chronically chronology
chrysanthemum chuck chukka chummy chunky churl churlish chute cicero cilantro
ciliary ciliate cilium cinch cinchona cinnabar cinquefoil circassian circlet
circuitous circular circularise circularize circulation circulatory circumcise
circumcision circumference circumlocution circumpolar circumscribe
circumspection circumstances circumstantially circumvent circus cirrus cisco
cistern citation cither citrange citron citrous citrus cityscape civilisation
civilise civilised civility civilization civilize civilized clack clairvoyant
clamant clamour clamshell clangor clannish clapperclaw claret clarification
clarion clarity classicist classification classifier clastic clathrate clause
claustrophobic clavier claxon clayey claymore cleanliness cleared clearing cleat
cleavage cleave cleft clement clench cleome clerical clew cliffhanger
climacteric climbable climber clinch clincher clinical clink clinker cloaca
cloaked cloakroom clobber cloche cloister cloistered closure clothe clothed
clotheshorse clouded cloudiness cloudy clout clove clowning cloy clubby clump
clunky clustered coachwhip coagulate coagulated coalesce coapt coarctation
coarsen coaster cobble cobnut cobweb cobwebby coca cochineal cockeyed cockle
cocklebur cockney cockpit cockscomb cockspur cocoa cocoon cocotte cocoyam
cocozelle coddle codex codfish codification coercion coffer cogency coggle
cogitate cogitation cogitative cognate cognation cognizance cognomen cohabit
cohere coherence coherency cohesion cohesive cohesiveness coho cohoe cohort coif
coign coigne coinage coincident coiner cola collaboration collaborator collate
collation collective collectivised collectivism collectivized collector
collegial collet colligate colligation collimate collimator collins collocate
collocation colloquium colloquy collusion cologne colonial colonise colonize
colonnade colorado coloration coloratura colored coloring colorless colossus
colour colouration coloured colourful colouring colourless colours coltsfoot
columbarium columnar coma comate comatose comber combinative combinatorial
combinatory combust combustion comedienne comely comer comfortableness
comfortably comfrey comma commandment commando commemoration commend
commendation commentate commentator commercialize commination commingle
commiseration commissary commissioned committal committed commode commonality
commonplace commonwealth commotion commove communal communalism commune
communicable communication communicative communion communisation communise
communism communist communization communize commutability commutable commutation
commuter comose compaction compactly compactness comparable comparative
comparison compartment compartmentalization compatibility compelling compendium
compensation compilation complaint complement complementarity complementary
complementation completed completeness completion complexify complexion
complicate complication complimentary comport composite comprehension
comprehensiveness compressed compressible compression compromising compulsion
compulsive computation computerise computerize computing comrade concatenate
concatenation concavity concealment conceit conceive concentration conception
conceptualization concertina concession conciliate conciliation conciliatory
conclusion concoction concord concordance concordant concourse concretion
concretize concur concurrence concurrency concuss condemnation condensate
condensation condense condenser condescend condescension conditional conditioned
conditioner condominium coneflower coney confab confabulate confabulation
confect confection confectionery confederacy confederation confer conferee
conferrer confession confessor confidence confidential confidentiality
configuration confined confinement confining confirmation conflagrate
conflicting confluence conformable conformation conformist conformity
confrontation confusion confutation conga conge congee congener congeniality
conglobation conglomeration conglutinate conglutination congo congratulate
congratulation congregation congregational congruent congruous conjecture
conjoin conjugate conjugated conjugation conjunct conjunction conjunctive
conjuration conjurer conjuror conk connate connatural connectedness connective
connexion connivance connive conniving connotation connote conodont conquerable
conscientiousness consciousness consecrate consecrated consecration consequently
conservancy conservator conservatory consideration consign consignment
consistence consistency consolation consolidated consolidation consolidative
consonance consonant consonantal consort conspicuously conspicuousness conspire
constable constancy constantly constellate constipate constipation constituent
constitute constitutional constitutionalism constitutionalize constraint
constrict constricted constriction constrictive constructive consubstantiate
consultation consumerism consummate consummation consumption consumptive
contagion contagious containment contaminated contaminating contamination
contemplation contemporaneity contemporaneous contemporaneousness contemporise
contemporize contention contentious conterminous contestant contiguous
continence continental contingent continual continuance continuation continuity
continuously contortion contour contraction contradiction contradictory
contralto contrapuntal contrarily contrariness contrariwise contrary contrastive
contravene contribution contributor contrivance contrive contrived controvert
contumacy contusion convection convene convenience convent conventicle
conventional conventionality conventionalize converge convergence convergency
conversion convexity conveyance conveyer conveyor conviction conviviality
convocation convolute convoluted convolution convoy convulse convulsive cony
cookhouse cooky coop cooper cooperation cooperative coordinated coordination
copestone copious copperplate coquille coralberry cordage cordoba cordon
coriander corker cornerstone cornflower cornhusker cornhusking cornice
cornucopia corollary corona coronet corporal corporeal corps corpus corpuscle
corral correctable correction corrections corrective correctness correlate
correlation correlative correspondence corroborate corrode corrosion corrosive
corrugation corrupted corrupting corruption corruptness corsair corse cortege
cortex coruscate coruscation corvus corydalis cosign cosigner cosmetic
cosmetician cosmic cosmography cosmologic cosmological cosmology cosmopolitan
costa costate costmary cotillion cottar cotter cottonweed cottonwood coulisse
coulomb counsellor countenance counteract counterattack counterbalance
countercharge countercheck countercurrent countermarch countermine counterpart
counterpoint counterrevolutionary countersign countersink countertenor
countervail countryman countrywoman coupled couplet coupling courgette courser
courteous courtesy couscous covenant coverage covering covert covetous
covetously covetousness covey cowage cowberry cower cowhide cowl cowpea cowslip
coxcomb cozen crabapple cracked crackerjack cracking crackling cradlesong
craftiness craftsman crampon crampoon crank cranny crape crappie craps crapshoot
crapulous crawdad crawfish craze craziness creaky creamy crease creation
creature creche credence credulous cree creed creeper creepy crematorium
crematory crenel crenelation crenellation crenelle creole creosote cress crested
cretaceous crewman crib crick crier criminalize criminally criminate crimp
crimper crinoline criollo cripple crisp crispness crisscross criticality
criticise criticism croak croaker crochet crocheting crock cronk crook crooked
crookedness crooning crossbar crossbreeding crosscheck crosscurrent crosscut
crossed crossfire crosshead crossness crosspiece crosswise crotch crotchet
croton croup crowned crowning crucifix crucifixion crucify crud crude crudely
crudeness crudity cruelty cruiser crump crumple crunch crusade crusader crushed
crustaceous crusty crybaby cryptic cryptical cryptograph cryptography crystalise
crystalised crystalize crystalline crystallise crystallization crystallize
crystallized cubbyhole cubeb cubitus cudweed cull culmination cultism cultist
cultivated cultivation cultivator culverin cumbersome cumulus cuneiform
cunningly cupid cupola cupule curable curacao curd curfew curie curiosity
curiously curiousness curlicue currier currish curtailment curtsy curvature
curvy cushaw cusk cusp cuss custody customise cutaway cuticle cutlery cutoff
cutout cutter cyanamide cyanide cyberpunk cyclic cyclonal cyclonic cyclonical
cyclops cynic cynosure cypher cyprian cyprus cyst cystic czar dabble dabbler
dactyl dada dado dahl dairyman dalliance dally damaging damascene damask dame
damnation damned dampen dander dandle dandruff dandy daphne daringly darken
darkened darkling darling darn darter dasheen dateless dateline davenport dawdle
daybed daybook dazed dazzled dazzling deacon deactivate deactivation deaden
deadened deadeye deadhead deadwood deafen deanery dearth deathbed deathly
deathwatch debacle debar debarment debase debased debasement debatable debenture
debonair debonaire debouch debut decalcify decalcomania decamp decampment
decapitation decapod decarboxylate deceit deceitful decelerate deceleration
decency decentralization deception deciduous decimalise decimalize decimate
decipherer decisively decisiveness deckle declaim declamation declaration
declarative declared declarer declension declination decoct decoder
decomposition decompress decompression decoration decorator decorous decorticate
decoupage decouple decrement decrepit decrepitate dedicate dedicated deduce
deduct deductible deductive deepen defalcation defamation defaulter defect
defection defective defenceless defender defenseless defensively defer deference
deferentially deferral deficient defile definite definition definitive
deflagrate deflate deflation deflect deflection deflexion defloration deflower
defoliation deforestation deform deformation deformity deftly defunct defy
degage degeneracy degeneration degradation degrade degraded degrading degressive
dehorn dehumanise dehumanize dehydrated dehydration deification deify dejection
delectation delegacy delegation deletion deliberately deliberateness
deliberation delicatessen delicious deliciously delimit delimitate delineate
delineation delinquency delinquent deliquesce deliriously delirium delphic
delusion deluxe demagnetise demagnetize demarcate demarcation demerara demerit
demesne demigod demilitarise demilitarize demineralization demitasse demobilise
demobilize democratic democratise democratize demoiselle demolition demonstrable
demonstration demonstrative demonstrator demoralisation demoralise
demoralization demoralize demotic demulsify demur demureness demurrage demurrer
denary denaturalise denaturalize denature denial denier denigrate denigration
denizen denomination denominational denominationalism denotation denotative
denouement densitometer dental dentin dentine dentition dependable dependance
dependant dependence dependency depersonalization depiction depilation
depilatory depletion deplorable deplume deportation depose deposition depravity
deprecate deprecation deprecative depreciation depreciative depreciatory
depredation depress depressor deprivation deputation depute deputise deputize
deracinate deracination derail derange derangement dereliction derision
derivation derivative dermal derogation derrick descant descend descendant
descendent descender descent descriptive descriptivism descriptor desecrate
desensitise desensitize deserter desertion desexualise desexualize desiccate
desiccated desiccation designation desirability desirable desirableness
desolation desorb despatch desperately desperation despoil despotic despotism
destabilise destabilization destabilize destine destitute destroyed destroyer
destruct destruction detach detachment detectable detection detector detergent
deterioration determinant determinate determination determinative determinedly
deterrence detestable detonate detonation detoxification detoxify detraction
detribalisation detribalization detrition detritus devaluate devaluation devalue
devastation deviance deviation devilfish devilish devilishly devilry deviltry
deviousness devise devitrify devolution devolve devon dewar dewberry dextral
diabetic diabolic diabolical diagnostic diagonal dialectic diamante diametric
diametrical diaphragm diaspora diatonic dibble dichromatic dickens dickey dickie
dicky dictation dictator dictatorial dictum diddle differentiable differential
differentiated differentiation diffident diffuse diffused diffuser diffusion
diffusor digestion digger diggings digitalis digitalize digitally dignity
digress digression digressive dike dilapidate dilapidation dilatation dilate
dilation dilator dilution dimensional diminished diminution dimly dimness
dimorphism dimple dinar ding dinge dingy dink dinky diode diplomacy dipole
directional directionality directivity directness directory dirham dirndl disa
disabling disaffection disagreeable disagreeableness disagreement disappearance
disappointment disapproval disapprove disarm disarrange disassociation disaster
disband disbud disbursal disbursement discernible discerning discernment discerp
disciplinary disclaim discolor discoloration discolouration discombobulate
discomfort discomposure disconcert disconfirming disconnection disconsolate
discontinue discontinuous discordance discordant discountenance discouragement
discourse discourteous discourtesy discovery discredit discredited discreetness
discrepant discretionary discriminate discriminating discriminative
discriminatory discursive disdainful disdainfully disengage disengagement
disentangle disfavor disfavour disfiguration disfigurement disgorge disgrace
disgraceful disgustingness disheartenment dishonesty dishonor dishonorable
dishonorably dishonour disinclination disintegration disinvest disjoin disjoint
disjointed disjunct disjunction dislocate dislocation dislodge disloyal dismally
dismantle dismember dismissal dismission disobedience disoblige disordered
disorderliness disorderly disorganisation disorganization disorientation disown
disparagement disparate dispatcher dispensation dispense dispenser dispersion
displacement displume disport disposable disposal dispossession disproof
disproportionate disproportionately disputable disputation disqualification
disquiet disrespect disrespectful disruption dissect dissection dissemble
dissembling dissemination dissension dissent dissentient dissident dissimilar
dissimilate dissimilation dissipate dissipated dissipation dissociate
dissociation dissolution dissonance dissonant dissuasion distaff distal
distasteful distastefully distastefulness distemper distend distension
distention distil distillation distinctive distinctiveness distinctly
distinctness distinguishable distorted distortion distract distraction distrain
distress distressing distribution distributively distrust disturbance disunite
dither dithyramb diurnal divagation divan divaricate divergence divergency
divergent diversification diversion divest divestiture divination divinatory
divinity division divisional divisor divot diwan dixie dobson dockage docket
documented dodgy dodo doeskin dogfight dogfish doghouse dogleg dogma dogmatic
dogmatise dogmatize dogtooth dogwood doldrums dollarfish dollhouse dolly dolman
dolomite dolphinfish domestically domesticate domesticated domestication
domesticity domicile domiciliate dominance dominated dominating domination
dominical dominion doodlebug doomsday doorkeeper doormat dope doped doris
dormancy dormitory dorsal dorsum dory dote dotty doubter doubtfulness douche
doughboy doughnut dour douse dowdy dower downhill downplay downright downshift
downswing downward downwind downy dowse dowser drachm drachma draco dracunculus
drafting draftsman dragee dragnet dragoon drake dram dramatically dramatics
dramatisation dramatise dramatization dramatize draped draught dreadfully
dreamer dreamy dredge dressed dribbler drilling drinker drippy dripstone drivel
driveller drogue drollery drooping dropkick dropout dross drouth drowse drubbing
drudge drumbeat drunkenness dryness duality dubiously dubiousness duckbill
duckling ductile dude duffel duffle dukedom dulcet dulcimer dullard dulled dully
dummy dumpy dung dungeon dunghill duologue duplex duplicate duplication
duplicity duration durian duskiness dusky dutch dynamise dynamism dynamize
dysfunctional dyslexic dyspeptic dystopia dystopian dystrophy earful earldom
earmark earnestness earplug earthborn earthbound earthlike earthnut earthshaking
easement easter easterly eccentrically eccentricity ecchymosis ecclesiasticism
echelon echidna echoic echolalia eclat ecologic ecological economical
economically economise ecstasy ectoplasm ecumenical ecumenism edacity eddy
edgeways edgewise edict educe eelgrass eelpout eerie efface effacement
effectiveness effector effectual effervescence effete efficacious efficiency
effloresce efflorescence effortless effuse effusion effusive eggbeater egoism
egoist egotism egotistic egotistical egress egyptian eiderdown eighties
eightsome einstein ejaculate ejaculation ejaculator eject ejection ejector
elaborateness elaboration elan elastic elation electioneering elective elector
electoral electrical electrification electrify electrocute electrocution
electrograph electrolysis electrolytic electromagnetism electronic electrophorus
elegance elegantly elegiac elemental elevate elevated elfin elimination elision
elixir elliptic elliptical elocutionary elongate elongated elongation eloquently
elucidate elucidation elusive elver elysian emaciate emanation emancipate
emasculate emasculation embarrassment embattle embattled embedded embellishment
emblazon emblematic embodiment embody embolism embossment embroider embroidery
embrown embryo embryonic emergence emergent emersion eminence emirate
emotionally emotionlessness empanel emphasise emphatic empiric empirical
empiricism emplace emplacement empyreal empyrean emulation emulous emulsify
emulsion enact enactment enamel enation encampment encapsulate encapsulation
encephalogram enchant enchantment enchantress encircle enclose enclosure
encompassing encouragement encroach encroachment encrust encrustation
encumbrance endeavour endemic endgame endlessly endocrine endogamic endogamous
endogenic endogenous endorsement endorser endow endowment endurance endways
endwise energise energiser energizer enervate enervation enfranchise
enfranchisement engender engineering english engorgement engraft engrave
engraver engraving engrossed engrossment engulf enhancive enigmatic enjoin
enjoyment enkindle enlarge enlarged enlargement enlighten enlightening
enlightenment enlist enlistment enliven enlivened enmity ennoble ennoblement
ennobling enormity enquire enquiry enrichment enrobe enshrine ensign enslavement
ensnare entangle entangled entente enteral enteric entering enthrone enthuse
enthusiasm enthusiast enthusiastically enticement entitle entozoan entrant
entrap entrench entrenched entrepot entrepreneurial entropy entrust entwine
enucleate enumeration enunciate envenom environmentalism environs envoy eonian
epanodos eparch eparchy epicene epicurean epigastric epigraph epilation epilog
epiphany epiphysis episcopal episcopate episodic epistle epitaph epithet epoch
eponym epos equable equalise equaliser equalize equalizer equate equatorial
equerry equestrian equilibrate equilibrium equine equinoctial equinox equipage
equipped equivalence equivalent equivocal equivocation erasure erectile erection
erectness eremitic eremitical ergot eristic ermine eros erosive eroticism
erotism errancy errant erratic eruct eructation erupt eruptive escadrille
escallop escapade escarpment escheat escort escudo escutcheon espousal espouse
esquire establishment esthetic esthetician estimable estimation estivation
estragon estrangement esurience esurient eternity eternize ether ethereal ethic
ethical ethics etiolate etiolation etiologic etiological etiology etna
etymologise etymologize etymology eucalyptus eulogy euphonious euphuism eureka
evacuation evaluation evangelical evangelise evangelist evangelistic evangelize
evaporation evasion evensong eventful evermore eversion evict eviction
evidentiary eviscerate evisceration evocation exabyte exacerbate exacerbation
exacting exaggeration exalt exaltation examen exarch exasperating exasperation
excavation excavator excellence excellency exception exchangeable excise
excision excitability excitable excitation excitement exclaim exclamation
exclusion excogitate excogitation excommunicate excommunication excoriate
excoriation excrescence excretion excruciate excruciation exculpation excusable
execrable execrate execration exemplary exemplification exemplify exemption
exfiltrate exfoliate exfoliation exhalation exhale exhaustible exhaustion
exhibitionism exhibitionist exhilarating exhort exhortation exigency exigent
existent existential exodus exogamic exogamous exoneration exorcist expandable
expansible expansion expansive expansively expansiveness expansivity expatriate
expatriation expectancy expectedness expectorate expectoration expectorator
expedience expedient expendable experiential experimentalism experimentation
experimenter expiation expiration expire expiry expletive explicate explication
exploitation exploration explosive explosively exponent exportation exposit
exposition expostulation expound expulsion extemporize extenuation exterior
exteriorize exterminate extermination external externalisation externalise
externalization externalize externally extinction extinguish extirpate
extirpation extort extortion extraction extractor extracurricular extraneous
extrapolate extrapolation extravagance extravagantly extravasate extravasation
extremity extremum extroverted extrusion exuberance exuberantly exudation exude
exult exultation eyecup eyeful eyehole eyeless eyelet eyrie eyry fabricate
fabrication fabulous facelift facile facilitation facsimile faction factoid
facula facultative fadeout faerie faery fagot fairish fairway fairyland
fairytale fallacious faller fallible fallout fallow falsehood falsification
falsify falsity familial familiarity famish famously fanfare fanjet fanlight
fanny fantasise fantasize fantasm fantastical faraway farce farinaceous farmland
farmstead farseeing farsightedness farther farthest fascia fascicle fascination
fastidiously fatalism fatality fateful fatherhood fatherless fathomable
faultfinding faulty fauna favorable favoritism favour favourable favourite
favouritism fearfully fearfulness fearlessness featherbed feathered
featherweight feathery featured feckless fecklessly fecund fecundate fecundation
fecundity federalisation federalise federalist federalization federalize
federate federation feebleness feebly feeder feeler feign feigning feijoa
felicitation felicitous felicity feller felon feminise feminism feminize
fenestral fenestration fenugreek feria fermata fermentation fermi ferny
fertilisation fertilise fertility fertilization fertilize fervid fervor fervour
festering festoon fete fetich fetichism fetish fetishism fetlock feudatory
feverish fibre fibrillation fibrous fictile fictionalise fictionalization
fictionalize fictitious fictitiously fictive fiddle fiddlehead fiddler fiducial
fiefdom fielder fielding fiend fieriness figuration figurative figurehead
filament filaria filbert filet filial filiation filibuster filicide fils filth
filthiness filtration finder finely fineness finespun fingerboard fingering
fingerprint finis finite fink fireball firebird firebrand firebug fireguard
fireman fireside firestone firestorm fireweed firkin firmly firmness firth
fishbowl fishy fissile fissiparity fissiparous fissure fisticuffs fistula
fistulous fitful fixate fixation fixative fixings fixity fizgig fizzle flaccid
flack flagellant flagellation flagellum flageolet flagitious flagpole flagstaff
flail flak flake flakey flakiness flaky flamenco flaming flank flanker flap
flare flasher flashily flashing flatbed flatfish flatfoot flatfooted flathead
flattop flatulence flatulent flatware flavour flax fleabane fleck flection
fledge fledged fledgeling fleer fleming flemish fleshy flex flexibility
flexibleness flexion flexure flier flighty flinders flintlock flinty flitch
floatation floater floating flocculate floodgate floorboard flooring floral
florence florid florin florist floss flotation flotilla flounce flounder flout
flowage flowering flowery fluctuation flue fluency fluff fluidity fluidness
fluidram fluke flume flummery flump flunkey flunky fluorescent flurry flushed
flyaway flyblown flycatcher flyer flyover flyweight foamy focal focalisation
focalise focalization focalize focusing focussed fodder fogginess foggy foghorn
foible foist foliaceous foliate foliated foliation folio followup foment
fomentation fonda fondler fondu foodstuff foolishness footage footboard footle
footstep footwear footwork forage foray forbear forbiddance foreboding foreclose
forefather forefront forego foreground forehanded foreland forelock foreman
forensic foreordain forerunner foresee foreshorten foresight foreskin forestall
forester foreswear foretell foretelling forethought foretop forewoman forfeiture
forgery forgetful forgetfulness forgiveness formalise formalised formalism
formality formalize formalized formation formative formic formica formless
formulation fornication fornix forsaking forte forties fortification fortified
fortuitous fortunate forwarding forwardness fossa fossilisation fossilise
fossilization fossilize fosterage fothergilla fount fountainhead fourfold
foursome foursquare fowler fractionate fractionation fractious fractiously
fragility fragmentation frailty fraise framer frankfort franklin frap frappe
fraternal fraternity fratricide fraudulence fraught fray frazzle freak freakish
freaky freckle freehanded freehold freemasonry freewheel freight freightage
frenchify frenzied freshen fret fretful fretted friendliness frieze frigate
frightful frigidity frigidness frijole frill fringed frisk fritillary frivolity
frizzle frock frogmarch frontage frontal frontispiece frostiness froth frothy
fructification fructify fruitcake fruitfulness fruition fruitlessness fruity
frustration fuckup fucoid fuddle fugacity fugitive fugue fuji fulfil fulfilment
fullback fulminate fulmination fulsomeness fumigator functionalism fundament
fundamentalism fundamentalist fundamentalistic fundraiser funfair funiculus
funky funnel furiously furlough furor furore furtherance furthest furtive fusee
fussiness fustian fusty futurism futurist futurity fuzee fuzz fuzzy gabardine
gable gadfly gaff gaffer gaga gage gagman gaiety galactic galangal gall
gallantry galley gallfly gallic gallop gallus galore galvanic galvanisation
galvanise galvaniser galvanism galvanization galvanize galvanizer gambit gamboge
gamecock gamey gamine gammon gamut gamy gangling gangly gangrene gangway ganja
gantlet ganymede garbanzo gardener gargle gargoyle garibaldi garishness garner
garrison gasbag gasometer gassy gastronomy gatekeeper gaucherie gaudiness
gauffer gauntlet gauss gauze gavotte gazetteer gazump geek gelatin gelatinise
gelatinize geminate gemination gemini genealogy generalisation generalise
generality generalization generalize generalship generative generator
generically genesis genet genetical geneva genip genotype gent gentianella
gentile genuflect genuinely genuineness genus geographic geographical geometric
geometrical geometrically geriatric germanic germinate germination gestate
gestation gestural getaway gherkin ghetto ghoul giantism gibber gibbet gibbon
gibbous gibe gibson giddiness gigantism gilbert gilded gill gillie gillyflower
gimlet gimmick gingery ginseng gipsy girasol girdle giro girth gismo giveaway
giver gizmo glacial glaciate glaciation gladden gladiator gladiolus gladstone
glamorize glamourise glaring glasswort glassy glaze glazed gleaner glint glom
gloominess glop glorification gloriously glory glum glumness glut glutton
gluttony glycine glycogenesis glycol glyptography gnarl gnome gnostic goad
goalkeeper goaltender gobble gobbler goblet goddamn godlike godly goffer
goldbrick goldeneye goldfinch goldsmith golem goliath gondola gong goodish
goodwill goof goofball goon goop gore gory gossamer goth gothic gouache gouge
gouger gourd gracefully graceless gracelessly gracelessness graciousness grackle
grad gradate gradation gradualness graduated graft graham grail grammatical
grampus granadilla grandeur grandiloquent grandiose grandstand granitic granny
grantee granular granulate granulation grapevine graph graphical graphically
grapnel grappler grappling grasping grassroots grate gratefully gratification
gratifying grating gratuitous gratuity gravelly graven gravida gravimeter
gravitate gravitation gravure grayback grease greece greediness greek
greengrocery grenadier grey greyback greybeard griddlecake gridiron grievous
griffon grille grilled grillwork grizzle grogginess groin grooming groove groovy
grounding groundnut grounds groundwork grouper grouping growler growling grubby
gruffness grumbling grume guaiacum guarani guardianship guardroom gudgeon
guernsey guggle guidepost guiding guilder guile guillotine guimpe gula gulden
gulp gulping gumbo gummosis gumption gumshoe gunman gunnel gurgle guru gusset
gutless guttural guzzler gymnastic gyrate gyration gyro habanera haberdashery
habilitate habitation habituate habituation habitus hacienda hackberry hackney
haddock hades hadith haematocrit haircut hairdressing hairlessness hairline
hajji hake hakim halal halcyon hale haler halfback halftone halloo hallucination
halo hamadryad hamlet hammerhead hamstring handicraft handless handmaid
handmaiden handsomely handwheel handwriting hangdog hangover hanuman haphazardly
harassment hardball harden hardened hardening hardheaded hardhearted hardiness
hardship hardtack harebell haricot harmfulness harmonic harmonious
harmoniousness harmonisation harmonise harmoniser harmonization harmonize
harmonizer harpy harrier harry hart harvester hash hassle hassock hastings hatch
hatchback hatched hatchet hatching hateful hatful haunch haunted haunting
hawkweed haying haymaker haymaking haymow hayrack hazily haziness headed header
headful headgear headhunter headless headlong headman headpiece headrest
headroom headship headshot headstone headway headword heady healthful heartbeat
heartbreaker heartsease heartsick heath heather heavenly heavyweight heckle
hedger hedging hedonism heedful heedless heedlessness heft heftiness hegira heir
heirloom heist hejira helix hellebore helleborine heller hellhound hellish helm
helpfulness helplessness hematocrit hemlock hemp hemstitch henry hepatica herald
heraldic heraldry herculean hercules hereafter hereditary heresy heretic
hereunder hermaphroditic hermaphroditism hermit herpes herring herringbone hertz
hesitancy hesitation heterocycle heterodoxy heterogeneous heterogenous
heterologous hiatus hibernation hickey hickory hideaway hierarch hieratic
hieroglyph hieroglyphic hieroglyphical highjacker highlander hijab hijack
hijacker hilum hind hinderance hindquarters hindrance hipline hipped hippocampus
historically historicalness historiography histrionics hitless hitter hoard
hoariness hoary hobble hobbyhorse hobgoblin hobo hock hodgepodge hogan hogfish
hogg hogshead hoist hoka hokey holdout holdover holdup holler hollo holly
hollyhock holocaust holograph holographic holster homeboy homecoming homeliness
homespun homestretch homiletic homiletical homiletics homogeneity homogenise
homogenised homogenize homogenized homologize homologous homophonic homophony
homunculus honesty honeycomb honeycreeper honeyed honeymoon honeysuckle
honorable honorably honour honourable hoodoo hoodwink hoof hookup hookworm hoot
hooter hoover hopefully hopefulness hopelessly horde horehound hornpipe hornwort
horny horoscope horrid horrific horripilate horseback horsebean horsefly
horsehair horseman horsemint horseradish horseshoe horseweed hospice
hospitalization hosteller hostility hotbed hotchpotch hotdog hothead hotheaded
hotspur houri housebreaker housecleaning howe hoyle huckleberry huckster huddler
huffy hulk humanism humanist humanistic humanity humbug humdrum humiliation
humility humour humpback hunch hunchback hundredth hundredweight hunk hurtful
hurtle husbandly husk huskiness hustler hutch hyacinth hydra hydrant hydrate
hydraulic hydrofoil hydrophobia hydrophobic hydroplane hydroxide hymen
hyperbolic hypersensitivity hypertonic hypertonicity hyperventilate hyphenation
hypnotic hypo hypocrisy hypostasis hypothecate hypotonic hypotonicity
hypsography hyssop hysteria iceboat icebreaker iceman ichor icky iconoclast
iconoclastic icterus idealisation idealise idealism idealization identification
ideological idiom idiotic idolatrous idolisation idoliser idolization idolizer
idyl idyll igneous igniter ignition ignitor ignoble ikon ilium illative
illegitimacy illegitimate illegitimately illicit illicitly illiteracy illiterate
illogical illumination illusion illusionist illustrative illustrious imaging
imago imbalance imbecility imbibe imbibition imbricate imbroglio imbue imitate
imitation imitative imitator immanent immateriality immeasurable immeasurably
immediacy immediateness immersion immigrate immobile immobilisation immobilise
immobility immobilization immobilize immoderately immodesty immoral immorality
immortal immortalise immortality immortalize immunise immunize immutable
impaction impaired impairment impale impalpable impanel impart impasse impassive
impatience impeccability impediment impedimenta impel impenetrability
impenetrable impenitent imperativeness imperfect imperialism imperishable
imperium impermanent impermissible impersonal impersonally impersonation
impertinence impertinent impetus impinge impingement impious implant
implantation implicate implicitly implosion importance importantly importation
imposition impossibility impost impotence impotency impotent impound
impoverished impoverishment imprecate imprecation impregnable impregnate
impregnation impressionistic impressiveness imprint imprison imprisonment
improbable impromptu improper impropriety improvident improvisation imprudent
impudence impulsion impure impurity imputation impute inability inactivate
inactivation inactiveness inactivity inadequacy inadvertence inadvisable
inalienable inanimate inanition inappropriateness inarticulately inattentiveness
inaugural inaugurate inauguration inauspicious inborn inbred incalculable
incandesce incandescence incapability incapable incapableness incapacitate
incapacity incarnate incarnation incautious incendiary incense incessantly
incestuous incidence incidental incidentally incinerate incised incision
incisive incisively incitation incite incitement inclemency inclement
inclination inclined inclinometer inclose inclosure inclusion incoherence
incoherency incoherent incoming incommensurable incommutable incompatibility
incompatible incompetence incompetent incomprehensible inconsequence
inconsequential inconsiderate inconsistency inconsistent inconstancy
incontestable incontinence incontrovertible inconvenience inconvertible
incorporation incorrect incorrectly incorrectness incorrigible incorrupt
increasing incriminate incrust incrustation incubation incubus incumbency
incumbrance incur incurability incurable incurably incursion incurvate
incurvation indebted indebtedness indecency indecent indecipherable indecision
indecisively indecisiveness indecorous indecorum indefensible indefinable
indefinite indelicacy indelicate indemnification indemnify indemnity indent
indentation indenture independently indestructible indeterminable indeterminate
indicant indicative indicator indictment indifference indirect indirection
indiscernible indiscretion indiscriminate indiscriminately indispose indisposed
indisposition indisputable indissoluble indistinguishable individualise
individualism individualistic individuality individualize individuate
individuation indolent indorse indorsement indorser induce inducement inducer
induct inductance inductee induction inductive indulgence indulgent indurate
industrialise indweller inebriate inebriation ineffable ineffective ineffectual
inefficient ineligible inept ineptitude ineptly ineptness inert inertia
inessential inevitably inexcusable inexcusably inexhaustible inexorable
inexpedient inexpensively infamy infancy infanticide infantile infantilism
infatuation infectious infective infelicitous inferential inferior inferiority
infernal inferno infest infestation infiltrate infiltration infiltrator
infinitely infinitude infirm infix inflame inflamed inflammation inflammatory
inflated inflect inflected inflection inflexibility infliction inflorescence
informality informally informant infrangible infringe infringement infusion
ingeniousness ingenue ingenuity ingenuous ingenuousness ingest inglorious
ingrain ingratiating ingratiatory ingress inhalant inhalation inhalator inhale
inharmonious inheritance inhibition inhospitable inhospitableness inhuman
inhumanity iniquity initialise initialism initialize initiation injudiciousness
injunction inkstand inlay inmost innermost innervate innervation innocently
innocuous innovation inoculate inoffensive inoperable inorganic inosculate
inquisition inquisitive inquisitor inquisitorial inroad insane insanely
insatiably inscribe inscribed inscription insectivore insecurely insecurity
inseminate insemination insensate insensibility insensible insensitive insertion
inset inshore insidious insidiousness insignificant insignificantly insinuate
insinuation insipid insipidity insipidness insistence insistency insolation
insolence insolubility insoluble inspissate inspissation instability instal
installation installment instalment instancy instantiate instantly instep
instigation instigator instill instillation institutional institutionalised
institutionalized instruct instrumental instrumentality instrumentation
insubordinate insubordination insubstantial insubstantiality insufferable
insufferably insufficiency insufflate insufflation insular insulation insult
insultingly insuperable insurgent insurmountable intaglio intangible integration
integrative intelligent intelligible intemperance intemperate intemperateness
intensely intensification intensify intensity interaction interbreeding
intercession interchange interchangeable intercommunicate interconnect
interconnected interconnection intercourse interdict interdiction interference
interior interjection interlace interleave interlink interlock interlocking
interlocutor intermarriage intermeshed intermezzo intermixture internationalise
internationalism internationalist internationalize internecine internment
interpellation interpenetrate interpenetration interpolate interpolation
interpose interposition interpretation interracial interrelate interrogate
interrogation interrogative interrogatively interruption intersexual intersperse
interstice intertwine intervene intervention intimacy intimately intimation
intimidation intolerance intolerantly intonate intonation intone intoxicant
intoxicate intoxicated intoxicating intoxication intriguing intrinsic intro
introductory introjection introversion intrude intrusion intrusive intumesce
intumescence intumescency intussusception inundate inundation invaginate
invagination invalidate invariability invariance invariant invasion inveigh
invention inverse inversion invert inverted investiture invigorate invigoration
inviolable inviolate invocation involute involution involvement invulnerability
inward inwardness inwards iodine iodise iodize iodoform ionic ionisation ionise
ionization ionize iota irascible iridescent iridic ironclad ironical ironically
ironing ironmonger ironwood irradiate irradiation irrational irredeemable
irregularity irregularly irresolution irreverence irreverently irrigation
irritability irritably irritation irrupt irruption isolation isomerise isomerize
isometric isometry isotonic isthmus italic itchy itemise itemize iteration
jabiru jaboticaba jackass jackfruit jackknife jacksnipe jackstones jacquard
jactitation jaggy jalapeno jalousie james janissary japan japonica jaundice
jaundiced jauntiness java jawbreaker jazzy jealously jealousy jejune jejuneness
jejunity jellify jenny jerkily jerky jeroboam jetsam jettison jeweler jeweller
jewfish jezebel jibe jigsaw jingoism jitter jock jockey jocosity jocularity
joggle john johnson joinery jointure jokingly jones jonquil jook jordan joseph
jostle joule journalism joviality jowl jubilate jubilation judas judgement
judicature judicially judiciary judiciousness juggernaut juggle jugglery
juggling jugular juiceless juicer juicy juju jujube juke jumble juncture juniper
junk junket junkie junky juridic juridical jurisprudence jurist justiciary
justification justificative justificatory jute juvenility juxtaposition kabala
kabbala kabbalah kabbalism kabbalist kachina kaffir kafir kaftan kail kaki
kaleidoscope kali kamikaze kapok katabolic katharsis katzenjammer kauri keel
keeper kelly kelpie kelvin kenaf kent keratinise keratinize kern keystone khan
khanate kibble kickoff kilobyte kiloton kinaesthesia kindling kindred
kinesthesia kinetic kingcup kingfish kingmaker kingpin kingwood kink kinkajou
kinky kino kinship kirtle kitty klondike knacker knap knave kneeler knell
knickers knickknack knifelike knightly knockabout knocker knockout knotted
knotty knowingness knowledgeable koine kola koruna kosher kowtow kraal kremlin
krona krone kvetch kwacha kwanza labdanum labial labile labored labour laboured
labyrinth labyrinthine lacerate lacerated laceration lachrymal lackadaisical
lackey lacklustre lacquer lacrimal lactation lacy lade laden lager lallation
lama lambast lambaste lambda lambert lambrequin lambskin lamella lament
lamentation lamination lanai lancet lancewood landau landfall landholding
landler landlubber landscaping landscapist landsman langley langouste languish
languor laniard lank lanolin lanyard lapidary lapidate lapin lappet lapse larch
larder largess largesse lari larval lasagna lasagne lascar lassitude lasso
latakia latent laterality laterally latex lather latinise latinize lattice
laughable laugher laughter launder laurel laurels lavatory lave laver lavishly
lavishness lawful lawfully lawless lawlessness laxation laxity lazaretto leach
leaded leaden leaflet leaky leanness leapfrog lear learner leash leatherjacket
leatherleaf leatherwood leaven leavening lector leech leer leering leeward
leeway lefty legation legendary leger leggy legibility legion legionnaire
legislative legitimacy legitimately legitimation legume lemma lemongrass
lemonwood lengthen lengthiness lenience leniency leper lepton lesbian lesion
lethargy levant levee leveling leviathan levitate levitation levity lewd lewis
lexical lexicon libation libel liberalise liberalism liberality liberalize
liberally liberalness liberation libertarian libra librate licence
licentiousness lichee licit licorice lidded lidless liege lieutenant lifeblood
lifeless lifelessly lifelessness lifelike lifeline lifesaver ligate ligature
lighted lighterage lightheaded lightless lightsome lightsomely lightsomeness
lightweight likable likeable lilliputian limbo limerick limitation limiting
limitless limn limpet limpid limpidity linage linchpin linden lineage lineal
lineament lineation linebacker linecut lineman linesman ling lingcod lingonberry
lingual linguist linguistic linguistically linguistics linkage linnet linocut
lipstick liquefied liquefy liquidambar liquidation liquidator liquidity
liquidize liquidness liquified liquify liquor liquorice lira lisle lisp listless
listlessness litany litchi literalism literate lithic lithograph lithography
litigious littleneck littleness liturgy liverish livery lividity loadstar loath
loathsome lobate localisation localise localised localism localization localize
localized loch lockage lockstep lockup locomotion locoweed locus locust lodestar
lodgement lodging lodgment loftiness loganberry loge loggerhead logically logjam
logrolling logwood loin loins loll lollipop lolly longevity longitudinal
longitudinally longsighted loofah lookout loophole loopy loosen loosening
loosestrife lopsided loquat lordliness lordly lordship lorry loser lota loth
lotion lotus louden lough lounger lour louse louvre lovage lovebird loveless
lovingness lowering lowliness lowly lowness lowry lozenge lubber lubberly
lubricate lubrication lubricious luce lucidity lucifer lucre lucubration
ludicrous luff luffa luger luke lukewarm lukewarmness lullaby lumberjack lumen
luminescence lumper lumpy lunacy lunatic lunette lunger lunula lupus lurch lurid
luridness lusterless lustful lustre lustreless lustrous lustrum lute luxuriant
luxuriantly luxuriate luxurious luxuriously lyceum lynchpin lyrical lyricism
lysis lysogenic macadam macerate maceration machinate machinery macintosh
mackinaw mackintosh macon macroscopic macula maculate maculation macumba madden
madeira madison madonna madras maenad maffia mafia mafioso magician magisterial
magisterially magnetically magnetisation magnetise magnetism magnetization
magnetize magnification magnificence magnificently magnolia maguey magus magyar
mahimahi mahoe mailbag maillot mainstay maisonette maisonnette maize majagua
majestic majorette majuscule makeover makeweight malacca maladjusted malady
maleficence malevolence malevolent malformation malice malign malignance
malignancy malignity malleable mallet malpractice maltese mamey mamma mammee
mammon mammy manageable manakin manat manchester mandarin mandrake maneuver
manful mangosteen manhattan manhood mania maniac manicure manifestation manifold
manikin manila manioc manipulation manipulator manlike manly manna mannequin
mannerism mannikin mannish manoeuvre manse manta mantelet mantilla mantra
mantrap manzanita maquis mara marabou marasca maraschino marble marbles
marblewood marcher marchioness margarin marginal margrave marguerite maria
marihuana marijuana maritime marjoram marketable marmite marquee marquess
marquis marquise marseille marshall martial martin martingale martyr martyrdom
marvel marvellous marvelous masculinity masculinize mash masher mason masonic
masonry masquerade massage massasauga massiveness mastering mastermind
mastership mastery masthead mastic masticate mastoid masturbate matched
matchwood mateless materialisation materialism materialist materiality
materialization materially maternal maternalism maternity mathematical matriarch
matricide matrimony matron matte maturate maturation matured maturity maunder
maverick mawkishness maxim maximise maximization maximum maxwell maya mayan
mayflower mayhem mayoress mazurka mealy meander meaningless meaninglessness
meany measurable mecca mechanically mechanisation mechanise mechanised mechanism
mechanistic mechanization mechanize mechanized medalist medallion medallist
mediaeval medial mediation medic medicate medication medico medina mediocrity
meditate meditation medlar medulla medullary medusa meekly meekness meerschaum
megaton megillah meiosis melanise melanize meld meliorate melioration mellowed
mellowness melodic melodious melodramatically meltdown membranous memorialise
memorialize menagerie mendacious mendicancy mendicant meniscus menominee
menomini menorah menstruum mensurable mensural mentality menthol mentum mephitis
mercantile mercantilism mercenary mercer mercifulness mercilessness mercurial
meretricious meretriciousness meridian meridional merit meritocracy merlin
merlot merman merriment mescal meshed meshing mesic mesmerise mesmerize messiah
metabolic metacentric metallic metalwork metamorphic metamorphose metamorphosis
metamorphous metaphase metaphysical metathesis meteoric meteorology metier metre
metric metrical metricise metricize metrification metrify metropolis
metropolitan mettlesome meuse mezzanine mezzo miasm miasma miasmic michigan
micrometer microscopic microscopical microscopically midden middleman
middleweight midi midland midriff midway midweek midwifery migration migrator
migratory mihrab mildew miler militant militarise militarize milkweed millenary
millet millinery millionth millstone milt mimesis mimetic mimicry mimosa mince
mindless mindlessly mindlessness mineralize miniate minim minimalist minimise
ministerial ministry minstrel minstrelsy mintage minty minuet minuscule
minuteman minuteness miosis miraculous mirage mire mirky miro misanthropic
misanthropical misanthropy misapplication misappropriation miscalculate
miscarriage miscarry miscellaneous miscellany mischance mischief mischievousness
misconduct misconstruction miscue misdirect misdirection misery misestimate
misfire misfortune misgiving misguide misguided mishandle mishap misinterpret
mismatched misplace misplaced misplay misread misrepresent misrepresentation
missionary misspend mistaken mistily mistletoe mistress mistrust
misunderstanding misuse mite miter mitigation mitral mitre mitsvah mitzvah mizen
mizzen mobilisation mobilise mobilization mockery mockingly modality modeling
modelling moderately moderateness moderation moderator modernise modernism
modernization modesty modification modifier modiste modulate modulated
modulation modulus mogul mohawk mohican moiety moil moisten molar molecular
molestation mollification mollify moloch momentarily momently monad monarch
monarchal monarchical moneyed moneyless moneymaker moneymaking mongolian
mongoloid mongrel monish monition monkfish monochromatic monochrome monolithic
monologue monophonic monopolise monotonic monotonous monotony monotype
monovalent monster monstera monstrance monstrosity monstrous monstrously
montgolfier monumental moodiness moonfish moong moonshine moonwalk moony moorage
moorhen mooring moosewood moralisation moralise moralism moralist morality
moralization moralize morbidity morbidness mordacious mordant morello morgan
moribund morocco moron moroseness morph morphologic morphological morphology
morris morse mortality mortarboard mortice mortification mortify mortifying
mortise mortmain mortuary moses mossy mothy motif motility motley motorize
motorized mottle mould moulding mountainous mousetrap mousey mousse mousy
mouthful mouthpiece movable mucilage mucky mudcat muddle muff muffle mufti
mugwump mulct muliebrity mull muller mullet multiplex multiplicity multitude
multivalent mumble mumbling mummification mummify mummy munch mundanely
mundaneness mundanity mung municipality munition murderously murderousness
murmur murmuring murray musca muscadet muscadine muscat muscatel muscleman
muscovite muscular muscularity mushiness muskellunge musketry muskmelon muskrat
mutable mutant mutilate mutilation mutinous mutter muttering mutuality muzzle
muzzy myasthenia myeloid myopic myosis myriad myrmidon myrtle mystic mystical
mysticism mystification mystify mythic mythicise mythicize mythologise
mythologize mythology nabob nacreous nadir naiad nailhead nanna nanny napoleon
narcissus narcoleptic narcotic narration narrowed narrowing narthex nasal
nasalise nasalize nasturtium natal nationalisation nationalise nationalism
nationalist nationalistic nationality nationalization nationalize nationally
nativism nativist nativistic nativity naturalisation naturalise naturalism
naturalist naturalization naturalize naturalized naturalness naught nauseate
nauseous nautilus navel navigation neandertal neanderthal neaten nebuchadnezzar
nebular nebulous necessitate neckband necking necrology necromancer necromancy
necromantic nectar neediness needlecraft needlefish needlepoint needlework needy
negate negation negatively negativeness negativist negativity neglectful
negligence negligible negotiable negotiation neighbour neighbourhood nelson
nemesis neologism neology neophyte nephritic nephrosis neritic nerveless
nervously nervousness nervure nervy nescient nestle nestling nestor nether
nettle nettlesome neurology neuter neutralisation neutralise neutrality
neutralization neutralize newborn newcomer newel newmarket newsless newsroom
newsy newton nexus nibble nicety nick nidus niger niggle nigh nightcap nighthawk
nightlife nihilism nihilist nimbleness nimbus nineties ninja nipa nipple nippy
nirvana nitrification nitrify nobble nobility noblesse nodular nodule noisome
nomination nominative nonchalantly noncombatant nonconformance nonconformism
nonconformist nonconformity nonconscious noncritical noncyclic nonentity
nonexempt nonextant nonfunctional nonionic nonmechanical nonmusical nonnative
nonparallel nonpareil nonpayment nonpoisonous nonrational nonreader nonresistant
nonsense nonsensical nonsmoker nonstandard nonstarter nonstop nonsyllabic
nontoxic nonverbal nonviolent noose nopal nordic normalcy normalise normality
norman normative northeasterly northeastern northerly northerner northwesterly
northwestern nosedive nosepiece nostrum notably notation nothingness noticeable
notional nourishment nous novelty novitiate nozzle nuisance nuke nullification
nullifier nullity numerate numeration numeric numerical numinous nutcracker
nutlike nuzzle nyala nymph obbligato obdurate obeah obeche obedience obeisance
obelisk obfuscation objectification objectify objectionable objurgate oblation
obligate obligato obligatorily obligatory oblique obliquely obliqueness
obliquity obliterate obliteration oblivion oblong obloquy obnubilate obscene
obscenely obscenity obscurantism obscureness obscurity obsequious observance
obsession obstinacy obstreperous obstructer obstruction obstructor obtrude
obtrusive obtuse obtuseness obverse obviate occident occidental occidentalism
occluded occlusion occult occultism occupancy occupier oceanic ocellus ocher
ochre octave octet octette ocular oculist oddity oddment odium odoriferous
odorous odour odyssey oecumenical oersted oestrus offence offensively offering
offertory offhand offhanded offhandedly officeholder officially officiate
officiation offing offload offstage ogre oiler oiliness oilman oldwife
oleaginous oleaginousness oliguria olympiad omega ominous omission omnibus
omnivore onager onanism onomatopoeic onomatopoetic onrush onshore onslaught
ontology onward oomph opacify opacity opalesce opaque opaqueness opened
openhearted operable operative ophthalmic opine oppress oppression oppressive
oppressiveness opprobrious opprobrium optative optic optical optics optimise
optimism oracular orbicular orbital orchestration orchil orchis ordain ordained
ordeal ordered orderer ordering orderliness orderly ordinal ordinate ordination
ordnance organically organisation organise organiser orgiastic orgy orientalism
oriflamme originally origination originative orleans ornament ornamentation
ornateness orotund orphanage orphic orris orthodox orthodoxy orthoepy orthogonal
orthogonality oscillation oscitance oscitancy osculate osculation osier
ossification ossify osteal ostensible ostensive ostentation ostentatious ostiary
ostracise ostracism ostracize otiose outage outbid outboard outbrave outburst
outcry outdo outfielder outfitted outfitter outflank outflow outfox outgrow
outgrowth outing outlay outlier outpoint outpost outpouring outrageous
outrageously outrageousness outride outsell outsider outsmart outspoken outstay
outstrip outward outwardly outwardness outwear ovary ovate ovenbird
overabundance overarch overbalance overbear overbid overblown overboard overboil
overburden overcapitalise overcapitalize overcharge overcloud overcoat
overcompensate overcompensation overcrowd overdone overdraw overdress overdrive
overestimate overestimation overexpose overexposure overflow overgrow overgrown
overgrowth overhand overhang overheat overkill overlay overleap overlie overload
overnight overnighter overpayment overpower overproduce overprotect overreach
overrun overshadow overshoot oversimplification oversimplify overspend overspill
overstep overstrung overtake overtone overvaluation overweening overwork ovular
ovule oxbow oxeye oxford oxheart oxidate oxidise oxidize oxygenise oxygenize
pablum pabulum pacemaker pacesetter pachouli pachydermatous pacification
pacificism pacifier pacifism packaging packet packinghouse packrat paddy padre
padrone paean pageant pageantry pageboy pahlavi paigle painfully painfulness
painless painted paired pairing pajama palatability palatableness palatal
palatial palatinate palatine palaver palely pall pallet palliate palliation
pallid pallium palmate palpable palpitate palpitation palsy paltry pamphlet
panacea panache panama pandanus pander panderer panhandle pannier panoplied
panoptic panopticon pantaloon pantheism pantheon papaw paperhanger papery
papilla papism papyrus para parable parabolic parabolical paradigmatic paraffin
paragon paralyse paralytic paralyze parameter paramour paranormal parapet
parasitic parasitical parcel parched pare parenchyma parentage parenteral
parenthesis parer pargeting pargetting paring paris parish parity
parliamentarian parliamentary parlour parochial paronychia parquet parr
parricide parry parsimony partake parterre parthenogenesis partiality
participant participation particularly partita partition partitioning partitive
partizan partridge parturient parvenu parvenue pascal passable passageway
passionately passionless passiveness passivity pastiche pastoral pastorate
pasturage patched patchouli patchouly patchwork pate patella patency paternal
paternity paternoster pathetically pathologic pathological pathology pathos
patina patois patriarch patriarchal patriarchate patrician patricide patrimony
patristics patrology patronage patronise paul pauperization pavage pavan pavane
pavlova pawnee pawpaw payback payoff peaceable peacefulness peacekeeper
peacemaker peachy peaked pean peasant peckish pectoral peculiarity peculiarly
pedagogy pedate peddler pedestal pedigree peduncle peep peeper peepshow
peevishness peewee peewit pegasus pellet pellitory pellucid pellucidity penal
penance pendent penetrable penetrating penetration penetrative pengo
penitentiary pennant pennon pennyroyal pensionary pensiveness penstock pentagon
penurious penuriousness peonage peplum peppermint pepperwort perambulate
perambulation perceivable perceptible perceptiveness perchance percher percolate
percolation peremptory perennial perfection perfective perfidy perforate
perforated perforation perfume perfumed perfumery perfunctory perfuse peri
periodic peripatetic peripheral peristome perkiness perm permeate permeation
permissible permutation pernicious perniciously perorate peroration peroxide
perpendicular perpendicularity perpendicularly perpetually perplex perquisite
perry perseverance perseveration persistence persistently persnickety personage
personalized personate personation personification personify perspicacious
perspicacity perspiration persuasion pertain pertness perturb perturbation
perverse perversely perverseness perversion perversity perverted peso pessimism
pestiferous pestilence pestilent pestle petabyte petitioner petrifaction petrify
pettifogger pewit peyote phalanx phallic phallus phantasm phantasma phantasy
phantom pharisee pharmaceutical phenol phenomenal philander philanthropic
philippines philistine philosopher philosophic philosophically phiz phlegm
phoebe phoenix phonetic phonic phosphate photographic photogravure photometer
photophobia photostat phrasing phylum physiological physiology physique
pianistic piaster piastre pica pickaback pickerel picket picnic pictorial
pictured picturesqueness picturing piddle piedmont pierce piercing piercingly
pieris pietism pietistic pietistical piffle pigeonhole pigfish piggyback
pigmentation pigmy pigweed pilchard pilgrim pillage pillaged pillbox pillory
pilotage piloting pilus pima pimento pimiento pimpernel pincer pinched pineal
pinhead pinion pinioned pinna pinnacle pinpoint pinprick pinstripe pinwheel
pipage piper piping piquance piquancy piquant piquantness pique piquet piracy
pirate piratical piste pistillate piston pitahaya pitched pitching pitchman
pitchy pitfall pith pitiable pitiless pitilessness pitman pivot pixie pixilated
pixy placard placebo placed placement placenta placentation placidity plague
plaguey plaice plainspoken plaint plait planetarium planetary planking planted
planter planting plaque plash plasm plasma plasmodium plasticise plasticize
plastron platen plating platonic platoon playback playbook playfulness pleach
pleasance pleasantly pleasantness pleat pleiades plentiful plenum pleomorphism
pliability pliable pliancy plication plimsoll plonk plop plough plucked plumbago
plumcot plumed plummy plumy plunk plural pluralism pluralist plurality plushy
pneumogastric pneumonic pocked pocketbook pockmarked poetical poignancy poilu
poinciana pointedness pointer pointillism poisoning poisonous pokey poky
polarisation polarise polarity polarization polarize poleax poleaxe polecat
polemic politic politically polity pollack pollard pollock polychromatic
polygamous polymerise polymerize polymorphic polymorphism polymorphous polyp
polyphonic polysyllabic polyvalence polyvalency polyvalent pomelo pommel pomo
pomp pompadour pompano pompey pompon ponce ponderable ponderous ponderously
ponderousness pondweed pons pontifical pontificate pontoon poon poop popeyed
popinjay poplar popularisation popularise popularization popularize porcine
porgy porous portage portentous porter porterage portland portmanteau
portraiture portrayal poser posit positively positiveness positivism positivity
possession postage postdate postdoc posterior posteriority posterity postiche
posting postmortem postponement postscript postulate postulation postulator
posture potation potbelly potency potentiality potentiometer pother pothos
pothunter potpourri potshot pottage potto potty pouf poultry poundage pounder
pounding powdery powerfully powerhouse powwow practicable practical practise
praetorian pragmatical pragmatism pragmatist prance pratfall preaching
precarious precariousness precedence precedency precedent precept precession
preciousness precipitate precipitation precipitous precipitously precipitousness
preciseness preclude precocious preconception precondition precursor predaceous
predacious predate predation predatory predestination predestine
predetermination predetermine predicate prediction predictor predilection
predisposition predominance predominate predomination preempt preemption
preemptor preen prefabricate prefecture preference preferment preferred
prefiguration prefigure preform prehensile prehistoric prejudice prejudicial
prelacy prelature prelim preliterate prelude premature prematurely premedical
premeditate premeditation premier premonition preoccupancy preoccupation
preoccupy preponderance preposition prepossess prepossession prepuce presage
prescriptivism presentation presenter presently presentment preservation
presidency pressing pressman pressurise pressurize prestigious presto
presumption presumptive presuppose pretence pretend pretender pretense
pretension pretentiousness pretermit preternatural pretext pretorian prevalence
prevarication preventative preventive previse prevision priapic prick pricker
pricket prickle prickly prideful priestcraft priestly primal priming primitively
primitivism primness primus princedom princeling princely prink printing prise
prismatic privateer privately privateness privation privileged privy probabilism
probabilistic probate probationer problematic problematical proboscis procedural
proceedings procession processional proclamation proconsul procrastinate
procrastination procurator procurer prodigality prodigious productivity
profanation profane profanely profaneness professedly professionalise
professionalize proficient profitableness profligacy profligate profoundness
profundity progestational prognosticate prognostication programing programme
programming progression prohibition projectile prolate proliferate proliferation
prolific prolong prolongation prolonged prolusion promenade promiscuous
promiscuously prompter prompting promptly promptness promulgate promulgation
pronged pronunciation propagandise propagandize propagation propagator
propensity prophase prophesy prophylactic propitiation propitiatory proportional
proportionality proportionate proportionately proposition propulsion propulsive
prorate prorogue prosaic proscenium proscription proselytism prosody prosperity
prosperous prosthetic prostrate prostration protectiveness protestant
protestation protester proteus protraction protrude protrusion protuberance
protuberate provender proverbial providence provident providential
providentially provincial provincialism provocation provocative prowl proximate
proximity proxy prudence prunella pruner pruning psilosis psittacosis psyche
psychedelic psychic psychical psychodynamics psychogenesis psychogenetic
psychogenic psychologically psychopathology psychotherapeutic psychotherapy
ptomaine pubescent publication publicise publicity puccoon pucker pueblo puerile
puerility puffball puffer puffiness puffing puffy pugnacious puka puke pullback
pullet pullulate pullulation pulsate pulsation pulverisation pulverise
pulverization pulverize puncher punctilio punctuate puncture pungency pungent
pungently puniness punishable punk punter puny puppetry purblind purchasable
purdah purgation purgatorial purgatory purification purifying purine puritan
puritanical puritanism purity purl purport purposeful purposeless purposive purr
pursuance purulence pushover puss pussycat putrefaction putrescence putrid putt
putter putz puzzling pygmy pyjama pylon pyorrhea pyorrhoea pyramid pyrene
pyrethrum pyrimidine pyrogen pyrogenic pyrogenous pyrotechnic pyrotechnics
pyrrhic pythoness pyxis qibla quack quackery quad quadrangle quadrant quadrate
quadratic quadrille quadrillion quadruple quadruplet quahaug quahog quaintly
quaintness quake quaker qualifier qualitative qualm quandang quandary quandong
quantification quantifier quantise quantitative quantity quantize quark
quartering quartette quassia quaternary quaver queasiness quebec queerly
queerness quell quench quenched quercitron questionable questioning
questioningly quetzal quibble quiche quicken quickening quicksand quickstep quid
quiddity quiescence quiescency quiescent quieten quill quilting quint quintal
quintessence quintet quintette quintuplet quip quirk quitclaim quittance quiver
quivering quoin quotable quotient rabbet rabbinate rabble rabid rabidly rachis
rachitis raciness racquetball racy raddle raddled radial radiance radiate
radiator radiogram radiography radiology radiotelegraph radiotelegraphy
radiotelephone raffia raffish rafter ragbag raggedly raggedness ragweed ragwort
railhead railway rainmaker raised raiser raising raja rakish rakishness rallying
ramble rambler rambling rambutan ramequin ramification ramify ramrod rand rangy
ransack ransom ransomed rapacious rapaciousness rapacity raphia rapscallion
raptorial rapture rarefied rarefy rarified rarity rascal rascality rascally
rashness rasp rastafarian ratability ratafia rathole ratiocination
rationalisation rationalise rationalism rationality rationalization rationalize
rattan rattle rattler rattling rattrap ratty raucous raucously raunchy rauwolfia
ravel ravening ravenous ravish ravisher ravishment razing razorback reaching
reactive reactivity reactor readability readapt readjust readjustment readmit
readout realisation realise realism realist realistically realizable realization
reallocation ream reamer reappearance rearm rearward reasonableness reasonably
reasonless reassure rebelliousness rebirth reborn rebuff rebut rebuttal rebutter
recalcitrant recap recapitulate recapitulation recapture recast recede receding
receivership recency recentness receptacle reception receptor recessed
recessional recessive recharge recidivist reciprocal reciprocally reciprocate
reciprocation reciprocative reciprocatory reciprocity recitation reclamation
recline reclusive recognise recognised recognition recognizable recoil
recollection recombination recombine recommence recommit recompense
reconciliation reconditeness reconsider reconsideration reconstruct
reconstruction recount recoup recourse recovery recreant recreate recreational
recrudesce rectangular rectification rectifier rectify recuperate recur recusant
recusation recuse redact redaction redbird redcap redden reddened rede redeem
redeemable redeemer redeeming redefine redemption redemptive redeposit redevelop
redfish redhead redo redolent redouble redoubt redoubtable redound redpoll
redress redstart redtail reductionism redundancy reduplicate reduplication
redwing reecho reedbird reedy reek reeking reenact reeve reexamination reface
referent refill refined refinement reflate reflectivity reflector reflexion
reflexive reflexiveness reflexivity reflexology reflux refocus reformation
refraction refractive refractory refresh refreshen refresher refreshing
refreshingly refreshment refrigeration refuel refusal refutation regalia regency
regenerate regeneration regent regicide regiment regionalism registered
registrar regress regression regressive regroup regularisation regularise
regularity regularization regularize regularly regulator regulus regurgitate
regurgitation rehabilitate rehabilitation rehabilitative rehash reification
reincarnate reincarnation reinforcement reinstatement reinsure reinterpret
reinterpretation reissue rejection rejoice rejoicing rejoin rejoinder rejuvenate
rejuvenation rekindle relativistic relegate relegation reliance relic relict
religionism religiously religiousness reline relinquish relinquishing
relinquishment reload relocation reluctance remand remarkably remedial
remembrance reminiscence remise remission remit remitment remittal remold
remonstrate remoteness remould remount removable remuneration remunerative
rename renascence renegade renewal renounce renovation renunciation reorder
reorganise reorganization reorganize reorient reorientation repaint reparation
repatriate repayment repellant repellent repent repercussion repertory
repetition repetitive replacement replete repletion replicate replication
reportable repose reposition repression reprieve reprimand reprint reprobate
reprobation reproduction republication republish repudiate repudiation
repugnance repulse repulsion repulsive reputation requiem requisition requital
rerun rescript reseat reseau reseed reset reshape reshuffle residence residency
residual residuary resignation resignedly resile resilience resiliency resistive
resistless resolutely resolvable resonant resonator resound resourcefulness
respectable respectably respirator respire respite respondent responsiveness
restart restharrow restitute restitution restive restiveness restlessness
restoration restorative restrainer restraint restriction restrictive
restrictiveness resultant resurface resurrect resurrection resuscitate retaliate
retardation retch retell retentive retentiveness retentivity reticent reticulate
reticulation reticule reticulum retool retort retouch retrace retract retraction
retrain retral retread retrench retrenchment retribution retributive retributory
retrieval retroactive retroflection retroflex retroflexion retrograde retrogress
retrogression retrospection retroversion returning reunite revalue revamp
reveille revel revelatory revenant reverberate reverberation revere reverence
reverend reverie reversal reversible reversion revery revet revetment reviewer
revision revisionism revival revive revived revocation revolutionise rewrite
rhapsodise rhapsodize rhapsody rhea rhetorical rheum rheumatism rheumy rhine
rhomboid rhumba rhyme rial ribaldry ribbonfish ribbonwood ricebird richweed rick
rickety riddance riddle riddled ridicule ridiculous riesling rife riffle
rifleman rigamarole rightful rightness rigidify rigidity rigmarole rigor
rigorousness rigour rile rill rime ringdove ringed ringer ringlet ringtail
riotous riotously ripcord ripening riposte rippled riptide riser risky ritual
ritualism ritualist ritz rive rivet riveter riyal roach roadman roadster roan
robbery roble robotic rockfish rockrose rodeo roentgen rogers roguish roguishly
roguishness roil roiled rollback roma romantically romanticise romanticism
romanticist romanticize rondeau roofless rook roominess roost rootage rootbound
rootstock ropey ropy rosaceous rosebud rosefish rosette rosewood rosiness
rosinweed rostrum rota rotary rotation rotogravure rotor rottenness rotund
rotunda rotundity roughcast roughshod roulade rouleau roulette roundel
roundhouse roundup roundworm rouse rousing rousseau royalist royalty rubberneck
rubbery rubbish rubicon ruble rubric rubricate ruck ruckle rudder ruddle ruddy
rudimentary rudiments ruff ruffle ruffled ruggedness ruination ruinous rumba
rumble ruminate rumination rummage rummy rumple runaway runoff runty rupee
ruralism ruralist russia rustic rusticate rustication rustle rustling ruth
rutherford ruthlessness sabbatical saber sabin sabine sabot saboteur sabre
saccade saccharify sacerdotal sachem sackcloth sacral sadden saddleback saddled
saddlery saffron sagacious sagaciousness sagacity sagitta sailfish sainthood
saki salacious salaried salient salinity salivate sally salmagundi salmonberry
saloon salsify salsilla saltate saltation salter saltwort salubrious salutation
salute salvage salvation salve salvo samba samoyed sampler sampling samurai
sanatorium sanctify sanctioned sanctum sandarac sandbag sandfish sandpit
sandwort sanely sanger sanguinary sanguine sanguineous sanitation sanitise
sanitize sapidity sapless sapodilla saponify sapote sapphic sappy saprophytic
saraband sarsaparilla sartorial sashay saskatoon sassafras satanic satiate
satiation satinwood satisfaction satisfactory satsuma saturated saturation
saturnalia saturnine satyr saucer saucy saul saunter saurel savagely savagery
savannah savior saviour savour savoury savoy savoyard sawmill sawyer saxe
scabrous scalage scalar scalawag scald scaled scalene scaling scallywag scaly
scammony scandalisation scandalization scanty scape scapular scarcely scarify
scarp scatology scatter scatterbrained scattering scatty scavenge scavenger
scented scentless scepter sceptical sceptre schema schematisation schematization
schematize scheming schism schizoid schizophrenic schlep scholastic
scholasticism schooling schoolman schoolmaster schooltime schooner schottische
schrod schtick schtik sciatic scintilla scintillate scintillating scintillation
scissors sclaff scleroderma sclerotic sclerotium scoff scoffer scollop scorer
scorn scorzonera scotch scourge scow scrabble scrag scraggly scraggy scrambler
scrap scrapheap scraping scratchy scrawniness scrawny screak screaky scream
screamer screaming screech screeching screed screening screwball scribble
scribbler scribe scrimmage scriptural scripture scrod scrofulous scrounge
scrubby scrunch scruple scrupulous scrupulousness scrutinise scud scuff scuffle
scull sculpt sculptural sculptured scum scummy scup scupper scurf scurfy
scutcheon scuttle seafaring sealskin sealyham seaman seamless seamy sear
seascape seasonable seasonably seasoned seasoner seaward secant secernment
secession secluded seclusion secondhand secondment secrecy secretariat secrete
secretion secretiveness secretly sectarian sectional secular secularisation
secularization secularize sedan sedate sedation sedimentary seditious seduce
seducer seduction seedtime seedy seeker seer seesaw seethe segmental
segmentation segregate segregation seigneury seigniory seine seize seizing
selection selector selflessness sellout seltzer selvage selvedge semantics
semaphore semblance semiaquatic semiautomatic semiconductor semiliterate seminal
seminary semirigid sender seneca senega senescence senility seniority
sensational sensationalism senseless senselessly sensibility sensible sensing
sensitisation sensitise sensitiveness sensitivity sensitization sensitize
sensory sensual sensualism sensualize sententious sentience sentient
sentimentalise sentimentalism sentimentality sentimentalize separateness
separation separatism separative sepia septet septette septic septum sepulchral
sepulture sequencer sequent sequester sequestered sequestrate sequestration
seraphic serenity sericulture seriema seriousness sermon serpent serration
serviceable serviceberry servile sesquipedalian sessile sestet seta setscrew
settee setter settler seventies sever severally severalty severity sewer
sewerage sexed sexless sextant sextet sextette sexton sexy sforzando shabbily
shabbiness shabby shack shackle shad shaddock shaded shading shagginess shaggy
shakedown shaker shakily shakiness shallowness shamanism shambles shamed
shamefaced shammer shamrock shank shanty shapeless shapelessness shaper shaping
sharing sharpie sharpshooter sharpy shatter shaver shaving shaw shear sheared
shearer sheathe sheepman sheepshearing sheepskin sheik sheldrake shellac
shellfish shelve shenanigan shepherd shetland shibboleth shielding shifter
shiftiness shifting shifty shilling shillyshally shimmy shiner shingle shingling
shining shipbuilder shipway shipwreck shire shirk shirtfront shirttail
shittimwood shiva shiver shivery shlep shoal shockingly shod shoddiness shoddy
shoebox shoeshine shoestring shoofly shopworn shoring shortsighted
shortsightedness shortstop shouting shoveler shoveller showily showman
showstopper shred shrew shrill shrillness shrinkage shrivel shriveled shrivelled
shroud shrubbery shrunken shtick shtik shuck shucks shudder shuffle shuffler
shuffling shunt shylock siamese sibilate sibilation sibyl sibylline sicken
sidebar sideboard sidecar sidelong sidereal siderite sideshow sideslip sidewall
sideway sidewinder sidewise siding sidle siemens sierra sift sigmoid signalise
signalize signally signora signorina silencer silenus silesia silex silkworm
sillabub silo silverfish silvern silversides silverweed silvery similarity
similitude simnel simplex simplicity simplification simplism simulacrum
simulation sincerely sincerity sinecure sinew sinewy singleton singsong singular
singularity sinister sinistral sinker sinuate sinuous sinus sinusoid siphon sire
sisal siss sisterhood sitter sixteenth sixtieth sizable sizeable sizzle sizzling
skank skeletal skep skepticism sketcher skid skidder skillful skimpy skinhead
skinner skinny skipjack skirl skitter skulk skulker skullcap skyhook skyrocket
slack slacken slackness slake slander slang slapdash slaphappy slapstick slating
slattern slaughter slaver slavish sleaziness sledge sleekness sleeper sleepless
sleeveless slender slenderize slenderly slenderness sleuthhound sliced slicer
slicing slicker slickness slider sliminess slimy slippage slipperiness slippery
sliver sloe slop sloping sloppiness slops slosh slouch slough slovenliness
sludge slue sluggishness sluice slumber slumberous slumbrous slump slur slush
slushy sluttish smallness smartly smartness smatter smattering smilax smirch
smith smitten smokescreen smoky smolder smoothen smorgasbord smother smoulder
smudge smut smuttiness smutty snaffle snakeroot snarl sneer snick sniffle snipe
snitch snitcher snivel snooker snoot snort snorter snot snotty snout snowball
snowbird snub snuff snuffer snuffle snuggle snugly soapbox soapy sobriety
sociable sociably socialisation socialise socialism socialization sockeye soddy
sodom sodomise sodomize sodomy soften softened soho solace solacement solarise
solarize soldiering solemnise solemnity solemnize solfege solfeggio solferino
solicitation solicitor solicitous solidify solidity solidus soliloquy solitaire
solitariness solmization solubility solvate solvent soma somaesthesia somberness
sombre sombreness sombrero somerset somesthesia songster sonnet sooner sooty
sophist sophistic sophisticate sophistication soporiferous soporific soppy
soprano sordidness sorghum sorrel sorrowfully sorrowfulness sortie sorus
sottishness soubrette soudan sounding soupy sourdine sourdough sourness soursop
souse southeast southeasterly southeastern southerly southernism southpaw
southwest southwesterly southwestern sovereignty sovietise sovietize soya spaced
spacing spacious spade spangle spanker spareribs sparge sparkle sparkler sparkly
sparling spartan spasm spasmodic spasmodically spastic spatchcock spate
spatiotemporal spatter spattering spawn spear spearhead specialisation
specialise specialism specialistic speciality specialization specially
specialness specificity specious speck speckle spectator specter spectral
spectre spectrograph speculation speculative speculativeness speculator speculum
speedway spelaeology speleology spellbind speller spender spew sphacelus
spherical sphinx spiceberry spicebush spiciness spicy spiel spigot spile
spillage spiller spindle spindlelegs spindleshanks spineless spinet spinner
spinous spinster spiny spiraea spiral spirea spirillum spiritless spiritualise
spiritualism spirituality spiritualize spirt spitball spite spitefully
spitefulness spitter splashboard splashy splattering splay spleen splendid
splendidly splendor splendour splenetic splice splicer spline splinter splintery
splitter splosh splurge splutter spode spoilage spoiler spoliation spongelike
sponger sponginess spongy spontaneously spook sportive sporty sporulate spotter
spotting spotty spousal spout spouter sprag sprat sprawl spreader sprig
springboard springer springtide springy sprinkle sprinkling spritz sprocket
sprog spud spue spunk spunky spur spurious spurt sputter squab squadron squalid
squall squally squander squarely squashy squatter squatting squawk squawker
squeak squeaker squeal squealer squeamishness squelch squelcher squiggle squill
squinch squint squinty squire squirrelfish squirt squish stab stabbing stabile
stabilisation stabilise stabilization staged stager staging stagnancy stagnate
stagnation stalemate staleness stalk stalker stalking stalwart stampede
standardisation standardise standardised standardization standdown standee
standoff standstill starchy stargaze stargazer starlet startle starvation starve
starved stasis stateliness stately stationary statistician statuesque stave
steadfastness steamer steamroll steamroller steely steepen steeplechase steerage
stein stele stemless stemma stemmed stemmer stenograph stenography stentor
stereo stereoscopic sterilisation sterilise sterility sterilization sterilize
sternness sternutatory steroid stet stevens stevia steward stewing sticker
sticktight stiffen stiffening stifle stigma stigmatic stigmatise stigmatism
stigmatize stillborn stilt stimulant stimulation stinger stinker stinkpot stinky
stint stipendiary stipple stipulation stirrup stitch stockade stockholding
stocktaking stodgy stoicism stoker stolidity stoma stomatal stomatous stonewall
stony stooge stoplight stopover stoppage storied storminess storyteller stoup
stoutness stovepipe stowage straddle straggle straggly straightforwardness
straightness straightway strained straining strait straiten straitjacket straits
strangeness strangle stranglehold strangler strangulate strangulation
straphanger stratagem stratification stratified stratify stratum strawflower
strawworm streak streamer streamlined stretched stretcher stretching streusel
strew stria striation stricken strickle stricture strident strife strikingness
stringency stringer stringy striper striptease stroma strongman structuralism
structured struma stubble stubbornness stucco studious stuffiness stuffy
stultification stultify stumblebum stumbler stunt stupefaction stupefied stupefy
stupefying stupidity stupor sturdiness sturdy stygian stylish stylist stylus
stymie stymy suave subaquatic subatomic subdivide subdivision subdue subduedness
subgroup subhuman subjection subjective subjectivism subjugate subjugation
sublimate sublimation sublime sublimely sublunar sublunary submerge submerged
submerse submersed submersible submersion submission submitter subnormality
suborbital subordination suborn subornation subsequence subservience subservient
subside subsidence subsidisation subsidise subsidization subsistence
substantially substantiate substantiation substantive substitutable substitution
substrate substratum substructure subsume subsumption subterranean subterraneous
subtilize subtlety subtracter subtraction suburbanise suburbanize suburbia
subvention subversion subvert succeeding succession suckle suckling sucre
suction sudatory suds sufferance sufferer suffering sufficiency suffocate
suffocation suffuse sugarberry sugarcane sugarcoat sugariness suggestive
sulfurous sulkiness sullenness sully sulphurous sultana sultriness sumac
summarise summate summation summon summons sump sumptuousness sunbaked sunburst
sundowner sunfish sunray sunshade superannuate superannuated superannuation
superbug supercharge supercharged supercilious superficiality superficies
superfine superfluous superhighway superimposed superintendent superiority
superlative superlunar superlunary superman supernal supernaturalism supernormal
supernumerary superordinate superoxide superpose superposition superscribe
superscription supersonic superstratum supine supinely supplemental
supplementary supplementation suppleness supplicant supplicate supplication
supported supporting supposal supposition suppressed suppresser suppression
suppressor suppurate suppuration sura surcharge surcoat surefooted surety
surfeit surffish surmise surmount surmountable surpass surpassing surreal
surreptitious surrey surrogate surroundings surveyor survival susceptible
suspense suspension suspensive suspire sustained sustenance susurration suture
suzerainty swab swag swagger swaggering swallow swallowwort swarm swash swath
swearer sweatband sweatbox swede sweeper sweeten sweetener sweetening sweetheart
sweetsop swelter sweptback swig swill swinger swinish swob swoop swordfish
sycophantic syllabic syllabise syllabize syllabub sylph symbolical symbolically
symbolisation symbolise symbolism symbolist symbolization symmetrical symmetry
sympathetically sympathise sympathiser sympathizer symphonic symphysis
symptomatic synaeresis synchronic synchronisation synchronise synchronization
synchronize synchronizing synchronous syncopate syncopation syncope syncretic
syncretise syncretism syncretistic syncretize syndication syneresis synergism
synergistic synergistically synoptic synthesis synthesiser synthesize
synthesizer synthetic synthetical syphon syringa syrinx syrupy systematist
tabernacle tabloid taboo tabu tabular tabulate tabulation tack tacker tackiness
tacking tactile tactless tactual taenia tail tailback tailfin tailored tailspin
taint takeaway takedown takeoff takeout takeover taker talcum talkative tallis
tally tallyman talus tamale tamarind tambour tammy tamper tandem tang tanga
tangency tangent tangential tangle tangled tanka tankage tantalising tantalizing
tantra tantrism taos tapa tapering tappa taproot taradiddle tarantella tarantula
tardily tare tarmac tarmacadam taro tarradiddle tarragon tarry tartar tartness
tarweed tarzan tasteless tastelessness tastily tasting tatar tatterdemalion
tattered tatting tattle tattler tattoo tatty tauten tautology tawdry taxation
taxonomy tchotchke teaberry teacake teacup teak teamster teardrop tearful
technical technicality technically technocrat technological tectonic tectonics
teddy tedium teem teens telecommunication telegraphic telegraphy telepathist
telephone telephotograph telephotography telescopic teller telluric telophase
temper temperance temperately temperateness tempered tempestuous tempestuousness
temporal temporalty temptation tenderhearted tenge tenner tenor tensile
tensiometer tension tensor tentacle tenuity tenuous tepid tepidness terabyte
tergiversate tergiversation termination terminus terrene terrestrial
terrestrially terribly territorial territorialise territorialize terrorisation
terrorise terrorization terrorize terry tertian tesla tessellate tessellated
tessellation testimonial testudo tetanic thalweg thanatos thane thankfully
thankless thatch thatcher thaumaturgy theanthropism theatre theatrically thebes
theca thematic thenar thence theocracy theologically theologise theologize
theology theoretical theoretically theorize therapeutic thereabout thereabouts
therefrom thereness thereof thermograph theurgy thickset thimble thimbleberry
thinker thirstily thirstiness thirsty thong thorax thorniness thoroughbred
thoroughgoing thoroughly thoughtfully thoughtfulness thoughtlessly
thoughtlessness thousandth thrall thrash thrasher thrashing threadbare thready
threefold threepenny threesome thresh thresher thrift thrilling throb throbbing
throe throstle throttle throwaway throwback thrower thrum thrush thruster thud
thumbhole thumbscrew thump thunderbolt thunderclap thunderer thundering thundery
thymus tickle tidewater tidiness tierce tike tilefish tillage tilth timbale
timbered timecard timekeeper timetable timidity timorousness timothy tincture
tinderbox tinea ting tinge tingle tinker tinkerer tinning tinny tinsel tiptop
tireless titan titania tithe titi titillate titillating titillation titular
tiyin toadyish tobacconist tocsin toehold toetoe tokay toledo tolerable
toleration tomahawk tomatillo tomentose tomentum tonal tonga tongued tongueless
tonic tonsure tontine toothbrush toothed toothless toothsome topgallant tophus
topi topiary topknot topless topminnow topology toponymy toque torah torment
tormenter tormentor toroid torpedo torpid torpidity torpor torrent torrential
torrid torsion tortoiseshell tortrix tortuous tortuously tortuousness torture
torus tory tostada totaliser totalitarianism totality totalizer totem tottering
touched touching toughened toughie townsman toxaemia toxemia toxicity traceable
trachea trackless tract tractable tractor traditionalism tragedian tragicomedy
tragicomic tragicomical trailblazer traitor tramcar trammel tramontane tramp
tramper tramway trance tranquility tranquilize tranquillise tranquillity
tranquillize transamination transcendence transcendency transcendent
transcendental transcribe transcriber transcription transduction transexual
transferable transferee transference transferrable transfiguration transfigure
transfix transformation transfuse transfusion transgress transgression
transience transient transitivity translatable translator translocate
translocation translunar translunary transmigrate transmissible transmission
transmitter transmutation transmute transom transparence transparently
transpiration transpire transplant transplantation transpose transposition
transsexual transubstantiate transubstantiation transudation trapezium trapezoid
trashy traumatic travail traversal travesty trawl trawler treacherous treachery
treacle treadle treason treasury treble trefoil trek tremolo trenchant trencher
trepan trespass trestle trey triad triangular triangulate triangulation
tribalism tribune tributary trice trickery trickiness trickster triclinium trier
trifle trigon trilateral trilby trill trimester trinity tripe triplicity tripoli
triton triumphal trivet triviality trivially troglodyte troika trollop trooper
tropic troth trough trounce trouncing trouper troy truant truckage truckle
truculently truffle trumpery trumpeter truncate truncated truncation trundle
truss trustee trusteeship trustfully tryst tsatske tuber tubercle tubercular
tufa tufted tulipwood tumbleweed tumefy tumid tummy tumult tunic tunny tupelo
turbinate turbofan turbojet turbot turbulently turgid turnabout turncock turnery
turnoff turnout turntable turpentine turret turtledove tussle tutelage tutu
twang twayblade tweak tweediness tweedle tweedy twiddle twill twinberry twine
twinge twinkle twirl twirler twit twitch twofer twofold twosome tyke tyler
tympanic tympanum typecast typification typify typography tyrannical tyrannise
tyrannize tyranny tyrant tyre ulcerate ulceration ulster ulterior ultramarine
ultramontane ultrasound umbellate umber umbrageous umpirage unaccented
unacceptable unaccommodating unaccompanied unaccountable unacknowledged
unacquainted unadapted unadjusted unadulterated unadvised unafraid unai
unalterability unalterable unambiguous unambiguously unappealing unapproachable
unarmed unarmored unarmoured unarticulated unassailable unassisted unattached
unattended unattractive unau unauthorised unauthorized unavowed unawakened
unawares unbalance unbalanced unbeatable unbelievable unbelievably unbelieving
unbend unbent unbiased unbiassed unblinking unblock unbodied unbound unbowed
unbrace unbroken unburden unburdened unbuttoned uncanny uncaring unceasing
unceremonious uncertainly uncertainty unchain unchanged unchanging
uncheerfulness unclassified unclean unclear unclimbable uncloak unclothe
unclouded uncolored uncommonness uncompleted uncomplicated uncomplimentary
unconcern unconcerned unconditionally unconditioned unconfined uncongenial
unconnected unconquerable unconscionable unconscious uncontaminated
uncontrollable unconventional unconventionality unconvincing uncooperative
uncoordinated uncork uncorrected uncorrupted uncovering uncritical uncrossed
uncrowned uncrystallised uncrystallized unction uncultivated uncurled uncut
undaunted undefiled undependable underage underbelly underbid underbred
undercharge undercoat undercurrent undercut underdeveloped underdevelopment
underdress underestimate underexpose underexposure underfoot underhand
underhanded underhung underlay underlie underpayment underpin underplay
underquote underrun undershoot underslung underspend understood undertone
undertow undervalue underworld underwriter undesirable undetectable undetermined
undeveloped undeviating undigested undischarged undisciplined undiscovered
undivided undock undoer undomesticated undraped undress undressed undue undulate
undulation unearth unearthly unease uneasiness uneconomical unemotional
unencumbered unengaged unenlightened unenlightening unenviable unequal
unequivocal uneven unevenly unevenness unexciting unexpectedly unexpended
unexplained unfailing unfashionable unfasten unfastened unfastidious
unfathomable unfavorable unfavourable unfeathered unfed unfeeling unfeelingly
unfinished unfirm unfit unfitness unfixed unflagging unfledged unfocused
unfocussed unforced unforgiving unformed unfree unfreeze unfriendliness
unfriendly ungainly ungenerous unglazed ungoverned ungracious ungraded unguarded
unhampered unhappily unhappiness unhealthful unhealthy unhinge unholy unhurried
unhurt unidentified unification uniformity unimaginative unimaginatively
unimpeachable unimportance unimportant unimproved uninflected uninquiring
uninquisitive unintegrated unintelligibility unintelligible unintentional
uninterested uninteresting uninterrupted uninvited uninviting uninvolved
unionise unionised unionized unison unitary unitisation unitise unitization
unitize univalent universalistic unjust unkempt unkind unknowingness unlaced
unlawful unleaded unlearn unlearned unlettered unlighted unlikable unlikeable
unlimited unlined unlisted unlit unloose unloosen unlucky unmanageable unmanly
unmannered unmarked unmarketable unmask unmatched unmated unmeasured unmelodious
unmerited unmindful unmistakable unmistakably unmixed unmoving unmusical
unnatural unnaturally unnecessarily unnoticeable unobjectionable unoccupied
unoffending unofficial unofficially unoiled unordered unorganised unorganized
unoriginality unorthodox unorthodoxy unostentatious unpaid unpainted
unpalatability unperceptive unpick unplanned unpleasantness unpolished
unpredictability unpremeditated unpretentious unprincipled unprocessed
unproductive unprofitably unpronounceable unqualified unquestionable
unquestionably unquestioning unquiet unreactive unreal unreality unreasonable
unreasonably unrecognised unrecognized unrefined unreformable unregenerate
unregistered unregulated unrelated unrelenting unrepeatable unreserved
unresolvable unresolved unresponsive unrest unrestrained unrestricted unripe
unroll unruly unsafe unsatisfied unsaturated unsavoriness unsavory unsavoury
unscramble unscrew unsealed unseamed unseasonable unseasoned unseat unsecured
unseeded unseeing unseen unselfishness unserviceable unsex unshaded unshakable
unshod unsized unskilled unsophisticated unsorted unsound unsounded unsoundness
unsparing unspeakable unspoiled unspoken unstained unsteadiness unsteady
unstrained unstructured unstuck unstudied unstylish unsuccessful unsuitable
unsullied unsung unsupported unsure unsurmountable unsuspecting unsweet unswept
unswerving unswervingly unsymmetrical unsympathetic untangle untapped unteach
untempered untested unthinking untidiness untimbered untimeliness untimely
untouchable untouched untoward untraveled untravelled untreated untried
untroubled untrue untune unused unutterable unvarnished unvarying unvoiced
unwanted unwarranted unwashed unwavering unwelcome unwieldiness unwieldy
unwilling unwise unwitting unworldly unworthiness unworthy unwrap unwritten
upbringing upend upheaval uphill upholstery upkeep uppermost upright uprightly
uprightness uprise uproar uproarious uproot upstage upstart upsurge uptake
upturned upward upwards upwind urania urbanisation urbanise urbanity
urbanization urbanize urgency urging urinary urinate urochord urticate
urtication usable usance useable usurpation usury utilitarian utmost utopia
utopian utterer uttermost uxoricide vacancy vacate vaccinia vacillate
vacillation vacuity vacuous vagabond valediction valedictory valence valencia
valency valentine validation validity valuation vamp vampirism vandal vandyke
vanishing vapid vaporific vaporisation vaporise vaporization vaporize vaporous
vapour variability variance variant varicolored varicoloured variegate
variegation varlet varmint varna varsity vascularise vascularize vaticinate
vector vega vegetal vegetate vegetation vegetative vehemence veiled velar
velleity vellicate vellum velocipede velum velvety venation veneer veneering
venerable veneration venial venom venomous ventilate ventilation ventilator
ventral ventricle venturi venus veracious verbalisation verbalise verbalism
verbalization verbalize verbiage verdigris verdure verge verifiable veritable
verity vermiculate vermiculation vermin vernacular vernal vernier versification
verso vertex vertu vesiculate vesper vessel vesta vestal vestibule vestry
vesture vexation vibrator vicar vicarious vicereine viceroy vicissitude
victimise victimization victimize victor victoria victorious victual victualer
victualler victuals vicuna videotape vigil vigilance vignette vigorish vigorous
vigour vileness vilification villainy villeinage vinaceous vindication
vindicatory vinegarish vinegary vintner viola violator virago virginal virginia
virile virility virtu virtue virtuously virulence virulency virulent visage
viscerally viscose viscount viscountcy viscountess viscounty viscous visibility
visibly visionary visitation visualise vitalise vitalize vitalness vitiate
vitiated vitreous vitrification vitrify vitriol vitriolic vivification vivify
vixen vizor vocalic vocalise vocaliser vocalism vocalization vocalize vocalizer
vogue voguish voiceless voicelessness voider volcanic volition volta volumed
voluminous voluptuous voluptuously voluptuousness volute vomit voodoo voracious
voraciousness voracity vortex votary vowel vulcanise vulcanize vulgarisation
vulgarise vulgariser vulgarism vulgarization vulgarize vulgarizer vulnerability
wafer waft waggery waggle waggon wagon wahoo wain wainscot wainscoting
wainscotting wakeful wakefulness waken waker wale walkabout walkout walkover
walleye wallflower wallop walloper wampum wane wangle wanton wantonly wantonness
wapiti waratah warble ware warfare warhorse warlike warmheartedness warpath
warragal warrantee warren warrigal washbasin washboard washbowl washout
washstand washup washy wassail wassailer wastage wastefulness watchdog
watchfulness watchword waterborne watercolour watercourse watercraft waterer
wateriness watering waterloo watermark waterproof waterproofing watershed
waterspout watertight waterway waterwheel waterworks watery watt wattle wavering
waviness waxberry waxen waxflower waxwork wayfarer weakfish wean weatherboard
weaver webbed webbing weber webster weeder weedy weekender weighted weightily
weightiness weighty weil weir weirdo wellhead wellington wellspring welsh welter
welterweight westerly whack whacky whaler whammy whang wharfage wheeze wheezy
whelk wherry whet whiff whig whim whimsey whimsicality whimsy whin whipcord
whiplash whipsaw whirligig whirr whish whistler whistling whitebait whiteface
whitefish whitehead whiteness whiteout whitethroat whitewash whiting whitish
whiz whizbang whizz whizzbang whomp whoop whooper whoosh whop whopper
whoremaster whoremonger whoreson whorl whorled whortleberry wicca wicker
widening widowhood wiener wiggler wiggly wight wigwag wildcat wilding wilful
williams wimp winchester windage winder windowpane windward wineberry wingback
winged wingspread winker winkle winnow wintergreen wintry wipeout wired wirer
wiring wishful wispy witchgrass withal withdrawer withe withholder withholding
withstander witless witloof woad wobble woebegone woeful wolffish wolfish
womanhood womanize wonderland wonky wonton woodbine woodcraft woodcut woodiness
woodman woodruff woodsman woodsy woodward woodwork wooly worcester workday
workhorse workhouse worksheet worldliness worldling wormcast wormy worrisome
worsen worsened worsening worshipful worshipper worsted wort worthlessness wrack
wrangle wrangler wreathe wretch wretchedness wriggler wright wrinkled wristband
wrongdoing wrongful wryneck xerox yahoo yakuza yale yammer yankee yardbird
yarder yardman yardstick yawl yawp yearling yeast yeasty yellowbird yellowhammer
yellowtail yellowwood yenta yeoman yeomanry yogi yottabyte yowl yuan zaire
zealot zebrawood zephyr zeppelin zettabyte zinfandel zing zippy zizz zombi
zombie zonal zoological zoology zulu zymosis zymotic
`.split(/\s+/).filter(w => w.length >= 4);
// ─── End WordNet 3.0 extras


// ─── Enriched dictionary words ─────────────────────────────────────
// 44276 words from words-enriched.json with full definitions
const ENRICHED_WORDS = `aardvark abaca aback abacus abaft abandon abandoned abandonment abandons abase abased abasement abaser abases abash abashed abasing abate abatement abattoir abaxial abbey abbreviate abbreviated abbreviation abc abcs abdicate abdication abdomen abduce abduct abduction abductor abecedarian aberrance aberrancy aberrant aberrate aberration abet abetment abets abettal abetted abetter abetting abeyance abeyant abhor abhorrence abhorrent abidance abide abiding abilities ability abject abjection abjectly abjuration abjure ablactate ablactation ablate ablation ablative ablaze able ableness abler ables ablest ably abnegate abnegation abnormal abnormalcy abnormality aboard abode abolish abolishes abominable abominably abominate abomination aboriginal aborigine abort aborted aborter aborticide abortifacient aborting abortion abortive aborts abound about above aboveboard abradant abrade abrader abrase abrasion abrasive abrasiveness abreaction abridge abridgement abridgment abroad abrogation abrupt abruptly abruptness abscise abscission abscond abscondment absence absences absent absenter absentest absently absentminded absentness absinth absinthe absolute absolutely absoluteness absolution absolutism absolve absolved absorb absorbed absorber absorbing absorbs absorption absquatulate abstain abstainer abstemious abstemiously abstemiousness abstention abstinence abstinent abstract abstracted abstractedness abstraction abstractionism abstruse abstruseness abstrusity absurd absurder absurdest absurdity absurdly absurdness abundance abundant abundantly abuse abused abuses abusive abut abutment abuts abutted abutter abutting aby abye abysm abysmal abysmally abyss abyssal academic academician academicism academies academism academy acantha acanthoid acanthous acaulescent accede accelerate accelerated accelerating acceleration accelerations accelerator accent accented accenting accentual accentuate accentuation accept acceptable acceptance acceptant acceptation accepted accepter accepting acceptive acceptor accepts access accessary accessed accesser accesses accessibility accessible accessing accession accessories accessory accho accident accidental accidentally accidents acclaim acclamation acclivitous acclivity accolade accommodate accommodating accommodation accommodative accompanied accompaniment accompany accompanying accomplice accomplish accomplishable accomplished accomplishment accord accordance accordant according accordingly accordion accost accouchement account accountable accountancy accountant accountants accounting accounts accouterment accoutrement accredit accredited accrete accretion accrual accrue accrued accruement accruer accrues accruing acculturation accumulate accumulation accumulative accumulator accuracy accurate accurately accurse accusal accusation accusative accusatory accuse accused accuser accuses accusing accusive accustom accustomed ace aced acedia acentric acer acerb acerbate acerbic acerbity acerola aces acetate acetify acetose acetous acetum acetylate acetylise acetylize ache ached acher acheronian acherontic aches achievable achieve achieved achievement achiever achieves achieving aching achira achondritic achromasia achromatic acid acidic acidify acidity acids acidulate acidulent acidulous acidulousness acinar acing acinic acinose acinous acinus ackee acknowledge acknowledged acknowledgement acknowledger acknowledges acknowledging acknowledgment acme acne acnes acorn acoustic acoustical acquaint acquaintance acquaintances acquaintanceship acquiesce acquiescence acquire acquired acquirement acquirer acquires acquiring acquisition acquit acquits acquittance acre acres acrid acridity acridness acrimonious acrimony acrobatic acrobatics acronym across acrosses acrostic acrylic act acted acter acting actings actinia actinian actiniarian actinotherapy action actions activate activated activating activation active actively activeness activer activest activist activities activity actor actors actress actresses acts actual actualer actualest actualisation actualise actualization actualize actually actualness actuals actuary actuate actuation acuate acuity aculeus acumen acute acutely acuteness acuter acutest acyclic adage adagio adam adamant adamantine adapt adaptation adapted adapter adapting adaption adaptor adapts adaxial add added addendum adder addict addiction adding addings addition additional additive addle addled addlehead address addresses adds adduce adenoidal adept adeptness adequacy adequate adequateness adhd adhere adherence adhesion adhesiveness adieu adios adiposis adjacent adjectival adjective adjoin adjourn adjournment adjudge adjudicate adjunct adjunction adjuratory adjure adjust adjustable adjusted adjuster adjusting adjustment adjusts adjutant adjuvant admin administer administrate administration administrations administrator admirable admiral admiralty admiration admire admired admirer admires admiring admission admit admits admittance admittedly admixture admonish admonisher admonishing admonishment admonition admonitory ado adobe adolescence adolescent adolescents adonis adopt adopted adopter adopting adoption adoptive adopts adorable adoration adore adored adorer adores adoring adorn adornment adrenal adrenalin adrenaline adrenalines adrift adroitness adscititious adscript adscripted adult adulter adulterant adulterate adulterated adulteration adulterator adulteress adulterous adultery adultest adulthood adultly adultness adults adumbrate adumbration adust advance advanced advancement advancer advances advancing advantage advantageous advantageously advantageousness advent adventitia adventure adventurer adverb adversary adverse adversity advert advertent advertise advertisement advertising advertize advertizement advertizing advice advices advise advised advisedly advisement adviser advises advising advisor advocate advocates advocator adynamic aegir aegis aeolian aeon aeonian aerate aerated aeration aerial aerie aeriform aerify aerobatics aerobic aerobics aerodrome aerodynamic aeroembolism aerofoil aerogenerator aeronaut aerophilic aerophilous aeroplane aerosol aerosolise aerosolize aery aesculapian aesthesia aesthesis aesthetic aesthetical aesthetician aestivation aether aetiologic aetiological aetiology affability affable affableness affair affaire affairs affect affectation affected affectedness affecting affection affectionate affectionately affectionateness affiance affiliate affiliation affinal affine affinity affirm affirmation affirmative affirmatory affirmed affirmer affirming affirms affix affixation afflict afflicted affliction afflictive affluent afford affordable afforded afforder affording affords afforest affranchise affray affright affront afghan afghani afghanistani aficionado afield aflame afloat aflutter afoot afraid afraider afraidest afraidly afraidness aft after aftereffect afterglow afterlife aftermath afternoon afternoons afters aftershock aftershocks afterthought afterward afterwards again against agamic agamogenetic agamous agape agar agaric age aged agedder ageddest agedly agedness ageing ageless agencies agency agenda agendas agendum agent agents ager ageratum ages agglomerate agglomerated agglomeration agglomerative agglutinate agglutination agglutinative aggrandise aggrandisement aggrandize aggrandizement aggravate aggravated aggravating aggravation aggravator aggregate aggregated aggregation aggregative aggregator aggress aggression aggressive aggressiveness aggressor aggrieve aggroup aghast agile agility aging agio agiotage agitate agitated agitation agleam aglet agnate agnatic agnise agnize agnostic agnostical agnosticism ago agone agonise agonist agonistic agonistical agonize agony agora agrarian agree agreeability agreeable agreeableness agreeably agreed agreeing agreement agreer agrees agrestic agribusiness agricultural agriculturalist agriculture agriculturist aguacate ague agueweed ahead aheads ahem ahorse ahorseback aid aide aided aider aides aiding aidoneus aids aiglet aiguilette ail ailed ailer ailing ailment ails aim aimed aimer aiming aimless aims aint aioli air airbag airbags airdock airdrome aired airer airfield airfoil airhead airheaded airier airiest airily airiness airing airless airlift airlike airline airlines airmail airman airmanship airplane airplanes airport airports airpost airs airscrew airspace airstream airstrip airt airtight airwave airway airy aisle akee akin akka akko alabaster alabastrine alacrity alar alarm alarmed alarms alarum alary alas albacore albatross albeit albeits album albumen albumin albums alchemy alcides alcohol alcoholic alcoholise alcoholism alcoholize alcove alcyone alder ale alecost alert alerted alerter alertest alerting alertly alertness alerts alewife alexander alexanders alfalfa alfilaria alfileria alfresco algarobilla algarroba algarrobilla algebra algebras algorism algorithm algorithms alibi alidad alidade alien alienage alienate alienated alienation alienee aliener alienest alienism alienly alienness aliens aliform alight align aligned aligner aligning alignment aligns alike alikeness aliment alimental alimentary alimentation alimony aline alinement alir alive alively aliveness aliver alives alivest aliyah alkali alkalinise alkalinize alkane alkanet alky all allay allegation allege alleged allegement alleger alleges allegiance alleging allegorise allegorize allegory allegretto allegro allergic allergies allergy alleviant alleviate alleviation alleviator alley alleys alleyway alliaceous alliance alliances allied allieder alliedest alliedly alliedness allies allieses alligator alligators allmouth allocate allocation allocator allograph allomorph allot allotment allow allowable allowance allowances allowed allower allowing allows alloy alloyed allspice allude allure allurement alluring alluviation alluvion alluvium ally almanac almandine almandite almighty almond almost almosts aloft alone alonely aloneness aloner alones alonest along alongs alongside aloof aloofness aloud alpaca alpha alphabet alphabetic alphabetical alphabetise alphabetize alphabets alpine alreadies already alright also alsos alt altar alter alterable alteration alterative altercate altercation altered alternate alternating alternative alternatively alterred alterrer alterring alters althaea althea altitude alto altogether altruism alula alum aluminium aluminum aluminums alumna alumni alumnus alveolar alveolitis alveolus always alyssum amah amain amalgam amalgamate amalgamated amaranth amaranthine amarelle amass amateur amateurish amative amativeness amatory amaze amazed amazer amazes amazing amazingly amazings amazon ambage ambassador ambassadors amber amberly amberness amberrer amberrest ambiance ambidextrous ambience ambiguity ambiguous ambit ambition ambitious ambitiously ambitiousness ambivalent amble ambo amboyna ambrosia ambrosial ambrosian ambulance ambulances ambulant ambulatory ambuscade ambush ameliorate amelioration amenable amend amendable amended amender amending amendment amendments amends amenity amerce amercement america americium ametabolic ametabolous amethyst amethysts amex amiability amiable amiableness amicability amicableness amidship amidships amidst amiss amity ammo ammonia ammunition amnesia amnesiac amnesic amnestic amnesty amok among amongs amor amorous amorousness amorphous amortisation amortise amortization amortize amount amounts amour amp ampere amphetamine amphibian amphibiotic amphibious amphimixis amphiprostylar amphiprostyle amphisbaena amphisbaenia amphistylar amphitheater amphitheatre ample ampleness amplification amplifier amplify amplitude amply ampulla amputation amuck amuse amused amusement amuser amuses amusing amylaceous amyloid amyloidal amylum amytal anabolic anachronism anaconda anadiplosis anaemia anaemic anaerobic anaerobiotic anaesthetic anaglyph analog analogous analogue analogy analphabet analphabetic analphabetism analyse analyses analysis analyst analysts analytic analytical analytics analyze analyzed analyzer analyzes analyzing anamnesis anamorphic anamorphism anamorphosis ananas anaphora anarchic anarchical anarchist anarchy anastigmatic anastomose anastrophe anathema anathematise anathematize anathemise anathemize anatomic anatomical anatomise anatomize anatomy anatropous ancestor ancestral ancestry anchor anchorage anchorite anchoritic anchorman anchorperson anchors anchovy ancient ancientness ancients ancillary ancylose and andante andiron androgyne androgynous androgyny andromeda ane anecdotal anecdote anecdotic anecdotical anele anemia anemias anemic anemone anergy anesthetic anestric anestrous angel angelfish angelic angelica angelical angelique angels angelus anger angered angers angina angle angler anglerfish angles angleworm anglicism angora angrier angriest angrily angriness angry anguish anguished angular angularity angulate angulation anhinga anil animadversion animadvert animal animalisation animalise animalism animalization animalize animals animate animated animation animations animator anime animise animize anise aniseed anisometric ankara ankle anklebone ankles anklet anklets ankylose annals anneal annex annexation annexe annexed annexer annexes annexing annihilate annihilating annihilation annihilative anniversaries anniversary annon annotate annotating annotation announce announced announcement announcer announces announcing annoy annoyance annoyed annoyer annoying annoys annual annualer annualest annually annualness annuals annul annular annulate annulated annulet annulment annulus annunciate annunciation anode anoestrous anoint anomalousness anomaly anomic anomie anomy anon anonymous anorak anorectic anorexic anorexigenic anosmatic anosmic another anothers anovulant anserine answer answerable answered answerer answering answers ant antagonise antagonism antagonist antagonistic antagonize anteater antecede antecedence antecedency antecedent antecedently antechamber antedate antediluvial antediluvian antelope antenna anterior anteriority anteroom anthem anthesis anthrax anthropoid anthropoidal anthropomorphism antiaircraft antibacterial antibiotic antibiotics antiblack antibodies antibody antic anticipant anticipate anticipation anticipative anticlimactic anticlimactical anticlimax antifeminism antifertility antipathetic antipathetical antipathy antiphon antiphonal antiphonary antiphony antiquarian antiquary antiquate antiquated antique antiquity antisepsis antiseptic antisocial antithesis antitype antitypic antitypical antivirus antlion antonym ants antsy anuran anvil anxieties anxiety anxious anxiousness any anybodies anybody anyhow anymore anyone anyplace anything anytime anyway anyways anywhere apace apache apanage apart apartment apartments aparts apathetic apathy ape apelike aper aperient aperture apertures apery apes apex aphaeresis aphasic apheresis aphonia aphonic aphoristic aphrodisiac aphrodisiacal api apiece apish aplenty aplomb apocalypse apocalyptic apocalyptical apocryphal apogee apologetic apologia apologise apologize apologized apologizer apologizes apologizing apologue apology apomictic apomictical apophysis apoplexy apostasy apostate apostatise apostatize apostle apostolic apostolical apostrophe apothecary apothegmatic apothegmatical apotheosis app appal appall appalled appalling appanage apparatchik apparatus apparel appareled apparent apparently apparition apparitional appeal appealed appealer appealing appealingness appeals appear appearance appeared appearer appearing appears appease appellation appellative append appendage appendix appertain appetence appetency appetiser appetite appetizer applaud applause applauses apple applecart apples applesauce appliance applicant applicants application applications applicator applied applieds applier applies apply applyer applying appoint appointed appointee appointive appointment appointments apportion apportioning apportionment apposite apposition appraisal appraise appraiser appreciate appreciated appreciater appreciates appreciating appreciation appreciative appreciatively apprehend apprehensible apprehension apprehensive apprehensiveness apprentice apprisal apprise apprize approach approachability approachable approached approaches approaching approbate approbation approbative approbatory appropriate appropriately appropriateness appropriation approval approve approved approver approves approving approximate approximately approximation approximative apps appurtenance appurtenant apr apricot apricots april apron aprons apropos apt apter apteral apterous apteryx aptest aptitude aptly aptness aqua aquaer aquaest aqualy aquamarine aquanaut aquaness aquaphobic aquaplane aquatic aquatint aqueous arabesque arachnid arachnidian arachnoid arbalest arbalist arbiter arbitrament arbitrarily arbitrariness arbitrary arbitrate arbitration arbitrator arbitrement arbor arboraceous arborary arboreal arboreous arborescent arboresque arborical arboriculturist arboriform arborous arbour arc arcade arcades arcadian arcanum arcdegree arch archaic archaist archangel arched archer archeries archery arches archetype archil arching architect architectonic architectonics architects architecture architrave archive archness archpriest archway arcminute arcs arcsecond arctic ardent ardor ardour arduous are area areas arena arenaceous arenas arent areola arere argent argillaceous argonaut argonne argot arguable argue argues argufy arguing argument argumentation argus argyle argyll aria arid aridder ariddest aridity aridly aridness aries arise arised ariser arises arising aristocracy aristocrat aristocratic aristocratical aristotelean aristotelian aristotelic ark arks arm armadillo armament armband armchair armchairs armed armies armiger armilla arming armistice armor armored armorer armors armory armour armoured armourer armoury arms army armyworm arnica aroid aroma aromatic aromatise aromatize around arounds arousal arouse aroused arouser arouses arousing arp arps arraign arrange arranged arrangement arranger arranges arranging arras array arrayed arrays arrears arrest arrested arrester arresting arrests arrhythmic arrhythmical arrival arrivals arrive arrived arrivederci arriver arrives arriving arriviste arroba arrogance arrogant arrogate arrow arrowroot arse arsehole arsenal arsenic arsonist art arteria arteries artery artful artfully arthritic arthritis arthritises arthrospore artichoke article articles articulate articulated articulately articulateness articulatio articulation articulator artificer artificial artificially artillery artisan artist artistic artistry artists artless artlessly artlessness arts artwork arugula arum ascend ascendable ascendance ascendancy ascendant ascendence ascendency ascendent ascender ascendible ascending ascension ascensive ascent ascertain ascesis ascetic ascetical asceticism ascribable ascribe ascription asea asepsis aseptic ash ashamed ashen ashes ashram aside asides ask askance askant asked asker askew asking asks aslant asleep asleeper asleepest asleeply asleepness aslope asocial asparagus aspect aspergill aspergillosis asperity asperse aspersion aspersorium asphalt asphyxiate asphyxiation aspinwall aspirant aspirate aspiration aspire aspirer aspirin aspirins asquint ass assail assailant assassin assassinate assassination assassinator assault assaulter assaults assay assemblage assemble assembled assembler assembles assemblies assembling assembly assent assenting assert asserted asserter asserting assertion assertive asserts assess assessable assessed assesser assesses assessing assessment asset assets asseverate asseveration asseverator asshole assibilate assibilation assiduity assiduousness assign assignable assignation assigned assigner assigning assignment assignments assigns assimilate assimilating assimilation assimilative assimilator assimilatory assist assistance assistant assistants assisted assister assisting assists assize associate associates association assoil assonant assort assorted assortment assuage assuagement assume assumed assumer assumes assuming assumption assumptive assurance assure assured assuredness assurer assures assurgent assuring astatine aster asterisk asterism astern asteroid asthenic asthma asthmas asthmatic astigmatism astigmia astir astonied astonish astonished astonishing astonishingly astound astounded astounding astraddle astragal astragalus astrakhan astral astray astride astringe astringence astringency astringent astronaut astronomer astronomic astronomical astronomies astronomy astute astuteness asunder asylum asylums asymmetric asymmetrical asymmetry asynchronous asynclitism ataraxis atavism atavist ate ated atelier ater ates atheist atheistic atheistical athenaeum atheneum athlete athletes athletic athletics athwart ating atlas atlases atm atmosphere atmospheres atmospherics atom atomic atomisation atomise atomiser atomism atomization atomize atomizer atoms atone atonement atonic atop atopped atopper atopping atops atoxic atrabilious atrip atrium atrocious atrociously atrociousness atrocity atrophied atrophy attach attache attached attacher attaches attaching attachment attack attacker attacks attain attained attainer attaining attainment attains attaint attempt attempted attempter attempting attempts attend attendance attendant attended attendee attender attending attends attention attentions attentive attentiveness attenuate attenuated attenuation attest attestant attestation attestator attested attester attestor attic attics attire attired attires attitude attorney attorneys attract attracter attraction attractive attractiveness attractor attracts attribute attributes attribution attrition atypic atypical auberge aubergine auburn auburner auburnest auburnly auburnness auction auctioneer auctions audacious audaciousness audacity audible audience audiences audio audiology audiometry audios audiotape audit audition auditions auditor auditorium auditoriums aug auger aught augment augmentation augmentative augur augury august augusts aunt auntie aunts aunty aura aural aureate aureole auricle auricula auricular aurify auriga aurochs aurora auroral aurorean auspex auspicate auspices austere austereness austerity autarchic autarchical autarchy autarkic autarkical autarky authentic authentically authenticate authenticated authentication authenticator authenticity author authored authorer authoring authorisation authorise authorised authoritarian authoritarianism authoritative authoritatively authorities authority authorization authorize authorized authors authorship auto autobiographic autobiographical autobus autochthonal autochthonic autochthonous autocracy autocrat autocratic autocratically autocue autograft autograph automat automate automatic automatically automation automatise automatize automaton automatonlike automobile automotive autonomous autonomy autopilot autoplasty autopsy autos autotype autotypy autumn autumnal auxiliary avail availability available availableness avalanche avalanches avarice avaricious avariciously avariciousness avaritia avatar avenge avenged avenger avenges avenging avenue avenues aver average averageness averages averment aversion avert averting aviate aviation aviator avid avidder aviddest avidly avidness avocado avocados avocation avoid avoided avoider avoiding avoids avoirdupois avouch avouchment avow avowal avowed avowedly avower avowing avows avulsion avuncular await awake awakely awaken awakened awakener awakeness awakening awakens awaker awakest award awarding awards aware awareness awares away awe aweary awed aweigh aweless awesome awesomes awestricken awestruck awful awfuller awfullest awfully awfulness awhile awing awkward awkwardness awless awning awol awry axe axenic axes axial axile axillary axiom axiomatic axiomatical axis axises axle axles azedarach azederach azure baa babble babbler babbling babe babel babes babies baboon baboons baby babyhood babysit babysitter baccalaureate baccate bacchanal bacchanalia bacchanalian bacchant bacchic bacciferous baccy bach bachelor bachelorhood bachelors bacillar bacillary bacilliform back backboard backbone backbreaking backchat backcloth backdoor backdown backdrop backed backend backer backfire background backgrounds backhand backhanded backing backlash backlog backpack backpacker backpacks backpedal backrest backs backscratcher backseat backsheesh backside backslide backslider backsliding backstage backstages backstair backstairs backstop backswept backsword backtalk backup backups backward backwardness backwards backwash backwater bacon bacons bacteria bacteriacide bactericide bacterium baculiform bad badder baddest baddie badge badger badgering badgers badges badlands badlies badly badminton badmintons badmouth badness baffle baffled bafflement baffling bag bagatelle bagel bagels bagful baggage bagger baggy bagman bagnio bagpiper bags bail bailable bailey bailiwick bails bait baited baiter baiting baits bake bakeapple baked bakehouse baker bakeries bakery bakes bakeshop baking baksheesh bakshis bakshish balance balanced balancer balances balancing balata balboa balconies balcony bald balder balderdash baldest baldhead baldly baldness baldpate baldy bale balefire baleful balefulness balibago balk balked balker balking balks ball ballad ballast ballet ballets ballgame ballista ballistics ballistocardiograph ballock balloon balloons ballot balloting ballots ballpark balls ballyhoo ballyrag balm balmoral balms balmy baloney balsa balsam baltic balusters balustrade bam bambino bamboo bamboozle ban banal banality banana bananas band bandage bandages bandaging bandana bandanas bandanna bandeau banded bandelet bandelette bander banding bandlet bands bandstand bandwagon bandwidth bandy bane baneberry baneful banefully bang banged banger banging bangle bangs banian banish banishment banister banisters banjo bank bankable banker bankers banking bankings banknote bankroll bankrupt bankruptcy banks banned banner banning bannister banquet bans bantam bantamweight banteng banter banting bantu banyan baptistery baptistry bar barb barbarian barbaric barbarise barbarism barbarity barbarize barbarous barbarousness barbate barbecue barbecued barbed barbel barbell barbellate barbells barbeque barber barcode bard barde bare bared barefaced barely bareness barer bares barest barf bargain bargained bargainer bargaining bargains barge barilla baring baritone bark barked barkeep barkeeper barker barking barks barley barleycorn barm barman barmy barn barnacle barns barnstorm barnstormer barometer baron baronetage baronetcy baronial barons barony baroque baroqueness barque barrack barracuda barrage barratry barred barrel barreled barrelful barrelled barrels barren barrenness barrer barretter barricade barricado barrier barriers barring barrio barroom barrow barrowful bars bartender bartenders barter barytone basal base baseball baseballs baseborn based basel baseless baseline basement basements baseness baser bases bash bashed basher bashes bashful bashing basic basically basiccer basiccest basicly basicness basics basil basilica basilisk basils basin basinful basing basins basis basises bask basked basker basket basketball basketballs basketful baskets basking basks basle basque bass bassarisk basses bassinet basso bassoon basswood bast bastard bastardisation bastardise bastardization bastardize bastardly bastardy baste baster bastille bastinado basting bastion bastioned bat batch batches bate bated bater bates bath bathe bathed bather bathes bathetic bathhouse bathing bathos bathroom bathrooms baths bathtub bathtubs bathymetry bating baton batrachian bats batsman battalion batted batten batter battercake battered batteries battery batting battle battled battledore battlefield battlefront battleful battleground battlement battlemented battler battles battling battue batty bauble baulk bawd bawdiness bawdyhouse bawl bawler bay bayberry bayed bayer baying bays bazaar bazar bazillion bbl bboy beach beaches beachhead beacon bead beading beadle beadlike beads beadwork beady beagle beak beaker beakers beam beaming beams beamy bean beanie beanies beans beany bear bearberry beard bearded beardless beards bearer bearing bearings bears bearskin bearwood beast beastliness beastly beasts beat beated beaten beater beatific beatification beatify beating beatitude beatnik beats beau beaut beautician beauties beautiful beautify beauty beaver beavers becalm because bechance becharm becket beckon becloud become becomes becoming bed bedamn bedaze bedazzle bedchamber bedcover bedded bedder bedding bedeck bedevil bedevilment bedfellow bedight bedim bedizen bedlam bedraggled bedrock bedroom bedrooms beds bedspread bedspreads bee beebread beech beechwood beef beefburger beefeater beefs beefwood beefy beehive beelzebub been beens beep beer beers beet beetle beetles beetleweed beetling beetroot beeves befall befit befittingly befog befogged befool befooling before beforehand befoul befoulment befriend befuddle befuddled befuddlement beg began beget begetter beggar beggarly beggary begged begger begging begin beginner beginning begins begrime begrimed begrudge begs beguile beguiled beguilement beguiler beguiling beguine begun behalf behalfs behalves behave behaved behaver behaves behaving behavior behaviour beheading behemoth behind behinds behold beholden beige beigel beigely beigeness beiger beigest being beingness beings bejewel belabor belabour belated belatedly belay belch belching beldam beldame beleaguer beleaguering belem belfry belie belief beliefs believable believably believe believer believes belike belittle belittled belittling bell belladonna bellarmine bellarmino belled beller bellicose bellied bellies belligerence belligerency belligerent belling bellow bellower bellowing bells bellwether belly bellyache bellyacher bellyband bellybutton bellying belong belonged belonger belonging belongings belongs beloved below belowground belows belt belts beltway beluga belvedere bema bemire bemoan bemock bemuse bemused bemusement bench benches benchmark bend bendability bendable bender bending bends beneath benedick benedict benediction benefaction beneficence beneficent beneficial beneficiary benefit benefits benet benevolence benevolent benight benighted benign benignancy benignant benignity benjamin benne bennet benni benny bent benthos benumb benumbed benweed benzoin beplaster bequeath bequest berate berceuse bereaved bereft beret berets berg berlin berm berra berried berries berry berrylike berserk berth berths beryllium beseech beseem beset beshrew beside besides besiege besieger besieging besmirch besotted bespangle bespatter bespeak bespeckle bespoke bespoken besprinkle best bested bester bestest bestial bestiality besting bestir bestly bestness bestow bestowal bestower bestowment bestride bests bet beta betel bethink betide betimes betise betoken betray betrayal betrayed betrayer betraying betrays betroth betrothal betrothed bets better betterment betters betting bettor between betwixt bevel beverage bevy bewail beware bewared bewarer bewares bewaring bewhiskered bewilder bewildered bewilderment bewitch bewitchery bewitching bewitchment bewray beyond beyonds bezant bezzant biannual bias biased biaser biases biasing bib bible biblical bibliothec bibs bicameral bicep biceps bichrome bicker bickering bicolor bicolored bicolour bicoloured bicycle bicycler bicycles bicyclist bid bidded bidder bidding biddy bide bids biennial biennially bier biff bifurcate bifurcation big bigamy bigger biggest bigheaded bighearted bighorn bight bigly bigmouthed bigness bigwig bike biked biker bikes biking bikini bikinis bilateral bilaterally bilberry bile biles bilge bilgewater biliary bilious biliousness bilk bilked bilker bilking bilks bill billabong billboard billed biller billet billfish billfold billhook billing billion billionaire billions billionth billow bills billy billystick bimestrial bimetal bimetallic bimetallistic bimillenary bimillennium bimli bimonthly bin binaries binary bind bindable binder binding bindings binds binful binge bingle binocular binomial binominal bins biochemistry bioengineering biogenesis biogenic biogeny biography biohazard biologic biological biologies biology biomass biomedicine bionic bionomic bionomical bionomics bioremediation bioscope biosynthesis biota biotech biotechnology biovular bipartite bipolar biquadrate biquadratic biramous birch birchen birches bird birdbrain birdcall birdfeeder birdie birdlime birds birdsong birken birl birle birling birr birth birthday birthdays birthing birthplace birthrate birthright births biscuit biscuits bisexual bisexuality bishop bishopric bishopry bishops bismuth bison bisons bit bitch bitchiness bitcoin bitcoins bite bites biting bitingly bitmap bits bitstock bitted bitten bitter bitterer bitterest bitterly bitterness bittersweet bitterweed bitterwood bitting bivalent bivouac bivouacking biweekly biyearly biz bizarre bizarres blab blabbed blabber blabbermouth blabbermouthed blabbing blabby blabs black blackball blackbeard blackberry blackbird blackboard blackboards blackcap blacken blackened blacker blackest blackfish blackfly blackguard blackguardly blackheart blackjack blackjacks blackleg blackly blackmail blackness blackout blacks blacksnake blackthorn blackwash blackwood bladder bladders bladderwrack blade bladed blades blaeberry blah blame blamed blameless blames blanch blanched bland blandishment blandness blank blanker blankest blanket blankets blankly blankness blanks blanquillo blare blaring blarney blase blaspheme blasphemous blasphemy blast blasted blasting blastoff blastogenesis blasts blat blatant blate blather blaze blazer blazers blazes blazing blazon bleach bleached bleak bleaker bleakest bleakly bleakness blear bleary bleat bleb blebbed blebby bled bleed bleeding bleeds bleep blemish blemished blench blend blender blending blends bless blessed blessedness blesser blesses blessing blether blew blight blighted blighter blimp blimps blind blinder blindest blinding blindly blindness blinds blindside blindworm blink blinker blinking blinks blip bliss blisses blissful blissfulness blister blistering blisters blistery blithe blitheness blither blithesome blitz blitzkrieg blizzard bloat blob bloc block blockade blockage blockbuster blockbusters blockchain blocked blocker blockhead blockheaded blocking blocks blog blogger bloggers blogs bloke blond blonde blondely blondeness blonder blondest blondly blondness blood bloodbath bloodhound bloodier bloodiest bloodily bloodiness bloodless bloodletting bloodline bloodroot bloods bloodshed bloodstained bloodsucker bloodsucking bloodthirsty bloody bloom bloomer bloomers blooming blooms blooper blossom blossomed blossomer blossoming blossoms blot blotch blotched blotchy blots blotted blotter blotting blotto blouse blouses blow blowback blowball blower blowfish blowgun blowhole blowing blowlamp blown blowns blowout blowpipe blows blowsy blowtorch blowtube blowup blowy blowzy blub blubber blucher bludgeon blue bluebell blueberry bluebill bluebird bluebonnet bluebottle bluefin bluefish bluegrass blueing bluejacket bluely blueness bluepoint blueprint bluer blues bluest bluetooth bluetooths bluff bluffs blufves bluing bluish blunder blunderer blunt blunted blunter bluntest bluntly bluntness blur blurb blurred blurrer blurriness blurring blurry blurs blurt blush blusher blushest blushful blushly blushness bluster blusterous blustery boar board boarder boarding boardings boards boardwalk boardwalks boared boarer boarfish boaring boars boast boasted boaster boastfully boasting boasts boat boatbill boated boater boating boatload boats bob bobber bobbin bobble bobbysock bobbysocks bobcat bobfloat bobolink bobsled bobsleigh bobtail bobtailed bobwhite bod bodacious bode bodge bodied bodies bodiless bodily boding bodkin bodoni body bodybuilder bodyguard bodyless bodywork boeuf bog bogey bogeyman boggle boggy bogie bogus bogy bohemia bohemian boil boiled boiler boilerplate boilersuit boiling boils boisterous boisterousness bola bolanci bold bolder boldest boldface boldly boldness bolds bole bolero bolide bolivar bolivia bollix bollock bollocks bolo bologna boloney bolshevik bolshevise bolshevism bolshevist bolshevistic bolshevize bolshie bolshy bolster bolt bolted bolter bolting bolts bolus bomb bombard bombardier bombardment bombardon bombast bombastic bombastically bombed bomber bombilate bombilation bombinate bombination bombing bombings bombs bombshell bonanza bonaparte bonce bond bondable bondage bonded bonder bonding bondmaid bondman bonds bondsman bondswoman bonduc bondwoman bone boned bonehead boneheaded boner bones boneset boney bonfire bongo bonhomie boniface boniness bonito bonk bonkers bonnet bonnets bonnie bonny bonus bonuses bony bonyness boo boob booby boodle booed booer booger boogeyman boogie booing book bookcase booked booker bookie booking bookish booklet booklets booklouse bookmaker bookman bookmark bookmarker bookmarks books bookshelf bookshelfs bookshelves bookshop bookstall bookstore bookstores bookworm boom boomed boomer boomerang booming booms boor boorish boorishness boos boost booster boot bootcut booted booter booth booths booting bootleg bootlegging bootless bootlick bootlicking boots booty booze boozer boozing bop borage bordeaux bordello border borderland borderline borders bore boreal boreas borecole bored boredom borer bores boring boringer boringest boringly boringness born borne borns borough borrow borrowed borrower borrowing borrows bosh bosom bosomy boss bossed bosser bosses bossing bossy bot botany botch botched botcher botchy both bother botheration bothered botherer bothering bothers bothersome bothest bothly bothness boths bots bottle bottleful bottleneck bottlenose bottles bottom bottomless bottoms bouffant bought boulder bouldered boulders bouldery boulevard boulevards bounce bounced bouncer bounces bounciness bouncing bouncy bound boundary bounder bounderish boundless boundlessly boundlessness bounds bounteous bounteousness bountiful bountifulness bounty bouquet bourbon bourdon bourgeois bourgeon bourgogne bourn bourne bourtree bout boutique bouts bovid bovine bow bowdlerisation bowdlerise bowdlerization bowdlerize bowed bowel bowelless bower bowerbird bowfin bowing bowknot bowl bowlder bowled bowleg bowlegged bowler bowlful bowling bowls bows bowtie bowties box boxberry boxed boxer boxers boxershorts boxes boxful boxing boxings boxwood boy boyfriend boyfriends boys boysenberry bozo bra brabble brace braced bracelet bracelets bracer braces brachiate bracing bracken bracket brackish bradawl brag braggadocio bragged bragger bragging brags brahma brahman brahmanism brahmin brahminism braid braiding brail braille brain brainchild brainiac brainish brainless brainpower brains brainsick brainstorm brainwash brainwave brainy braise brake brakes braky braless bramble brambles brambly bran branch branched branches branchia branching branchlet brand branded branding brandish brandmark brands brandy bras brash brashness brasil brass brassbound brassiere brassy brat brats brattle bratwurst bravado brave bravely braveness braver bravery braves bravest bravo braw brawl brawn brawniness brawny bray brazen brazil brazilwood breach breached breacher breaches breaching bread breadbasket breadfruit breads breadstuff breadth break breakability breakage breakaway breakdance breakdances breakdown breaker breakers breakfast breakfasts breaking breakout breaks breakthrough breakup breakwater bream breast breastfeed breastpin breastplate breasts breastwork breath breathe breathed breather breathes breathing breathless breathlessness breaths breathtaking brecciate bred breeches breed breeding breeds breeze breezes breeziness breezy breton brevity brew brewage brewed brewer breweries brewery brewing brews briar briary bribable bribe bribery brick brickbat brickle brickly bricks bricole bridal bride bridegroom brides bridge bridgehead bridges bridget bridgework bridle brief briefcase briefcases briefer briefest briefing brieflies briefly briefness briefs brier brierpatch briery brieves brig bright brighten brightened brightener brightening brightens brightly brightness brights brigid brilliance brilliancy brilliant brilliantly brim brinded brindle brindled brine bring bringing brings brininess brinjal brink briny brio brisk brisken briskness brisling bristle bristled bristliness bristly brit briticism britisher britishism briton britt brittle brittleness bro broach broad broadband broadbands broadbill broadcast broadcaster broadcasting broadcasts broadcloth broaden broadened broadener broadening broadens broader broadest broadly broadness broads broadsheet broadside broadtail brobdingnagian brocaded broccoli broccolis brochure brocket broider broil broiled broiler broiling broke broken brokenhearted brokenheartedness brokens broker brokerage brokers brokes bromate bromide bromidic brominate bronze bronzes bronzy brooch brooches brood brooding broody brook brooklime brooks brookweed broom brooms broth brothel brother brotherhood brotherlike brotherly brothers broths brougham brought brouhaha brow browbeat brown browne browned browner brownest brownie brownies browning brownish brownly brownness brownout browns brownstone browse browsed browser browsers browses browsing brucellosis bruin bruise bruiser bruises bruising brumous brunch brunches brusa brush brushed brushes brushing brushstroke brushup brushwood brusk brusque brusqueness brutal brutaler brutalest brutalisation brutalise brutality brutalization brutalize brutally brutalness brutals brute brutely bruteness bruter brutest brutish bubble bubbler bubbles bubbliness bubbling bubbly bubo buccal buccaneer buccaneering buck bucked bucker bucket bucketful buckets buckeye bucking buckle buckler buckles buckram bucks buckskin buckthorn buckwheat bucolic bud buddha buddies buddy budge budgereegah budgerigar budgerygah budget budgets budgie buds buff buffalo buffalofish buffalos buffer buffet buffeting bufflehead buffoon buffoonery buffoonish bug bugaboo bugbane bugbear bugged bugger buggery bugging buggy bugle bugleweed bugloss bugs build builder building builds buildup built builts buirdly bulb bulblike bulbous bulge bulging bulgy bulimia bulk bulkiness bulks bull bulla bullbat bullbrier bulldog bullet bulletin bulletproof bullets bullfinch bullfrog bullhead bullheadedness bullies bullion bullock bullpen bullrush bulls bullshit bully bullying bullyrag bulrush bulwark bum bumble bumblebee bumbler bumbling bummed bummer bumming bump bumper bumpers bumpkin bumpkinly bumps bumptiousness bumpy bums bun bunce bunch bunches bunco buncombe bundle bundles bundling bung bungalow bungalows bunghole bungle bungler bunglesome bungling bunk bunker bunko bunkum bunnies bunny buns bunsen bunt bunting buoy buoyancy buoyant buoys bur burble burbling burbly burbot burden burdened burdener burdening burdenless burdens burdensomeness bureau bureaucracy bureaucratically bureaucratism bureaus burger burgers burgess burgher burglarise burglarize burgle burgoo burgrave burgundy burial buried buries burk burke burl burlesque burly burn burned burner burning burnish burnished burnout burns burnside burnt burp burped burper burping burps burr burred burrito burritos burrow burry bursa burst burster bursting bursts burthen burton bury buryer burying bus busbar busby buses bush bushel bushels bushes bushing bushman bushwhack bushwhacker bushy busier busiest busily business businesslike businessperson buss bust busted buster busting bustle busts busty busy busybodied busyness but butch butcher butcherbird butchering butcherly butchers butchery butler butt butte butter butterball buttercup butterfingered butterfish butterflies butterflower butterfly butternut butters butterweed buttery buttock buttocks button buttonhole buttonlike buttons buttony buttress buttressing buxom buy buyback buyer buyers buying buyout buys buzz buzzard buzzards buzzed buzzer buzzes buzzing buzzword bye bygone byname bypass bypassed bypasser bypasses bypassing bypast byproduct byssus byte bytes byword byzant byzantine cab cabal cabala cabalism cabalist cabalistic cabaret cabbage cabbala cabbalah cabin cabinet cabinetmaking cabinetry cabinets cabinetwork cabins cable cablegram cables caboodle caboose cabotage cabriolet cabs cache caches cachet cackle cackler cacodyl cacoethes cacography cacomistle cacomixle cacophony cacti cactus cactuses cacuminal cad cadaver cadaveric cadaverous caddie caddisworm caddy cadence cadency cadge cadre caducous caecilian caesar caesarean caesarian caesarism caespitose caesura cafe cafeteria cafeterias caffein caffeine caffer caffre caftan cage caged cager cages cagey caging cagy cairn caisson cajole cajolery cake cakehole cakes cakewalk calabash calamari calamary calamitous calamity calamus calash calcareous calced calcification calcify calcium calciums calculate calculated calculater calculates calculating calculation calculative calculator calculus calculuses caleche calendar calendars calendered calf calfs calfskin caliber calibrate calibrated calibration calibre caliche calico caliculus caliphate calisthenics calk calkin call calla callathump callback caller calling calliope callisthenics callithump callosity callous calloused callously callousness callow callowness calls callus calm calmed calmer calmest calming calmly calmness calms caloric calorie caltrop calumniate calumniation calumny calvaria calvary calve calves calx calycle calyculus calypso calypter calyptrate cam camarilla camber cambium cambrian came camed camel camelopard camels camer camera cameras cames caming camion camisole camlet camo camouflage camp campaign campaigner campaigning campaigns campana campanile campeachy camped camper campfire campfires campground campgrounds camping campion camps campsite campus campuses campy cams can canal canalisation canalise canalization canalize canals canaries canary canasta cancel canceled canceler canceling cancellate cancellated cancellation cancelled cancellous cancels cancer cancerous cancers candela candelilla candent candid candidacy candidate candidates candidature candider candidest candidly candidness candied candies candle candleberry candlenut candles candlewick candor candour candy cane canes canescent canicular canid canine caning canistel canister canker cannabis canned canner cannibalise cannibalize cannikin canning cannister cannon cannons cannot canny canoe canoes canon canonic canonical canonise canonize canopy cans cant cantala cantaloup cantaloupe cantankerous canteen canter cantilever cantillate canto canton cantonment cantor canvas canvass canvasser canvassing canyon canyons cap capability capable capableness capables capaciousness capacitance capacitate capacitor capacity caparison cape caper capes capillary capital capitalisation capitalise capitalist capitalistic capitalization capitalize capitals capitol capitols capitulation capitulum capon capote capped capper capping cappuccino caprice capricious capriciously capriciousness capricorn capriole caps capsicum capsid capsize capstone capsular capsulate capsule capsules capsulise capsulize captain captains captcha caption captious captivate captivated captivating captivation captive captivity capture captured captures capuchin caput car caracul carafe carambola caramel caramelise caramelize caramels carapace carat caravan caravansary caravanserai caraway carbon carbonaceous carbonado carbonate carbonic carboniferous carbonise carbonize carbonous carbons carbuncle carbuncled carbuncular carburise carburize carcajou card cardamom cardamon cardamum cardboard cardboards cardholder cardigan cardigans cardinal cardinalate cardinals cardinalship cardio cardiograph cardoon cards cardsharp cardsharper care cared careen career careers carefree carefreeness careful carefully carefulness carefuls caregiver careless carelessly carelessness carer cares caressing caretaker careworn cargo cargos caribe caribou caribous caricature caries carillon carina caring carioca cark carload carmine carnage carnal carnalise carnalize carnation carnauba carnival carnivals carnivore carnivorous carob carol carom carotene carotin carousal carouse carousel carouser carousing carp carpellate carpenter carpenters carpentry carpet carpetbag carpetbagging carpeting carpets carping carpool carpools carps carpus carred carrefour carrel carrell carrer carriage carrier carries carring carrot carrots carrottop carrousel carry carryall cars carshare cart carte carted cartel carter cartilage cartilages cartilaginous carting carton cartonful cartons cartoon cartoons cartridge cartroad carts cartwheel cartwright carve carved carver carves carving caryopsis casava cascade case caseate casebook cased casein cases cash cashable cashback cashbacks cashbox cashes cashew cashier cashiers cashmere cashmeres casing casino casinos cask casket caskful cassava casserole cassette cassettes cassia cassino cast castaway caste castellated caster castigate castigation casting castle castled castles castling castor castrate castration casts casual casualer casualest casually casualness casualty casuist casuistic casuistical casuistry cat catabolic catabolism cataclysm catalog catalogs catalogue catalyst catamenia catamount cataplasm catapult cataract catastrophe catastrophic catatonia catawba catbird catbrier catch catcher catches catchfly catching catchword catchy catechetic catechetical catechise catechism catechistic catechize catechu catechumen categoric categorical categorically categories categorisation categorization category cater caterpillar caterpillars caterwaul catfish catgut catharsis cathartic cathay cathedral cathedrals cathode catholic catholicise catholicism catholicity catholicize catholicon cathouse catnap cats catsup cattiness cattle cattleman cattles catwalk caucasian caudal caudally caudate caudated caudex caught caughts caul caulescent cauliflower cauline caulk causa cause causeless causerie causes causeway caustic cauterant cauterisation cauterise cauterization cauterize cautery caution cautionary cautioned cautioner cautioning cautions cautious cautiously cautiousness cavalier cavalierly cavalla cavalry cavalryman cave caveat caved caveman caver cavern cavernous caverns caves cavil caviler caviller caving cavity cavort cavum caw cawed cawer cawing caws cay cayenne cayennes cease ceaseless ceaselessly cecropia cedar cedarly cedarness cedarrer cedarrest cedarwood cede ceiling ceilings celandine celebrant celebrate celebrated celebrater celebrates celebrating celebration celebrator celebrities celebrity celeriac celeries celery celestial celiac celibacy celibate cell cellar cellarage cellars cellblock cellist cello cellos cellphone cells cellular cellulars celluloid celsius celsiuses cement cements cementum cemeteries cemetery cense censor censoring censorship censure census censuses cent cental centaur centaurus centaury center centerfield centering centerpiece centers centesimal centime centimeter centimetre centipede centner central centralisation centralise centralization centralize centrals centrarchid centre centrepiece centrifugal centrifugate centrifuge centripetal centrist cents centuries century cephalalgia ceramic ceramicist ceramist cerberus cereal cereals cerebral cerebrally cerebrate cerebration cerement ceremonial ceremonially ceremonies ceremonious ceremoniously ceremony ceres ceriman cerise cernuous cero certain certainly certains certainty certifiable certificate certificates certification certified certify cerulean cervical cervid cervix cesarean cesarian cespitose cesspit cesspool cetacean cetchup chablis chachka chad chadic chafe chaff chaffer chafflike chaffy chagrin chagrined chahta chai chain chains chair chairman chairmans chairperson chairs chairwoman chaise chalaza chalice chalk chalkboard chalks chalkstone chalky challenge challenged challenger challenges challenging chalybite chamaeleon chamber chamberlain chamberpot chambers chameleon chamfer chammy chamois champ champagne champagnes champaign champion champions championship championships chance chanceful chancel chancellor chancery chances chancy chandelier chandeliers chandler chandlery change changeable changed changeful changefulness changeless changelessness changeling changeover changer changes channel channeled channeler channeling channelisation channelise channelization channelize channels chant chantey chanting chantlike chantry chants chanty chaos chaoses chaotic chaotically chap chaparral chapeau chapel chapelgoer chapels chapiter chaplet chapman chapter chapterhouse chapters char charabanc character characterisation characterise characteristic characterization characterize characters charade charcoal chard chardonnay charge charged charger charges charging chariot charioteer charisma charismatic charitable charities charity charivari charlatanism charleston charlotte charm charmed charmer charming charms charnel charr charred charrer charring chars chart chartaceous charter chartered charterer chartering charters chartist chartreuse charts charwoman chary chase chaser chases chasse chassis chaste chastely chasten chasteness chastening chastise chastisement chastity chat chatbot chateaubriand chatelaine chatoyant chats chatted chattel chatter chatterbox chattered chatterer chattering chatters chatting chatty chauvinism chauvinist chauvinistic chaw chawbacon cheap cheapen cheaper cheapest cheapjack cheaply cheapness cheaps cheat cheated cheater cheating cheats check checked checker checkerberry checkered checkers checkerses checkmate checkout checkouts checks checkup checkups cheddar cheek cheekiness cheeks cheeky cheep cheer cheerful cheerfulness cheerily cheering cheerio cheerleader cheerleaders cheerlessness cheers cheery cheese cheesecake cheeseflower cheeseparing cheeses cheesy cheetah cheetahs chef chefs chela chelate chelated chelation chemic chemical chemically chemise chemist chemistries chemistry chenfish chenille chennai chequer chequered cherimolla cherimoya cherish cherished cherisher cherishes cherishing cherrier cherries cherriest cherrily cherriness cherry cherrystone cherub cherubic chervil chess chesses chest chesterfield chestnut chests chesty chetah chevalier cheves chevron chevvy chevy chew chewed chewer chewing chews chewy chic chicago chicane chicanery chichi chick chicken chickenhearted chickenpox chickenpoxes chickens chickpea chicks chickweed chicness chicory chicot chide chief chiefer chiefest chiefly chiefness chiefs chieftain chieves chiffon chiffonier chigger chigoe chihuahua child childbearing childbed childbirth childbirths childhood childhoods childish childishness childlike childly children childs chile chili chiliad chilis chill chilli chilliness chilling chills chilly chimaera chime chimera chimeral chimeric chimerical chimney chimneypiece chimneys chimneysweep chimneysweeper chimp chimpanzee chin china chinaberry chinaman chinas chinaware chincapin chinchilla chinchona chinchy chine chinese chink chinkapin chinook chinookan chinquapin chins chintzy chip chipmunk chipmunks chipped chipper chipping chips chiropteran chirp chirpy chirrup chisel chiseler chiseller chit chitchat chiton chittamwood chittimwood chivalric chivalrous chivalry chivaree chive chives chivvy chivy chlamydia chlamys chloride chlorinate chlorination chlorine chock chocolate chocolates choctaw choice choiceness choices choir choirmaster choirs choke chokecherry choked chokehold chokepoint choker chokes choking choler choleric cholesterin cholesterol cholesterols chomp chon chondritic choose chooser chooses choosing chop chopin chopine chopped chopper chopping choppy chops chopstick chord chords chore chorea choreograph choreography chortle chorus choruses chose chosen chosens chou chouse chow chowchow chowder chows christ christian chroma chromatic chromaticity chrome chromosome chronic chronically chronicle chronology chrysanthemum chthonian chthonic chubby chuck chuckle chuckled chuckler chuckles chuckling chuff chukka chukker chum chummy chump chunga chunk chunking chunks chunky church churches churchman churl churlish churn churned churner churning churns churr churrigueresco churrigueresque chute chutney cicada cicala cicatrice cicatrix cicero cider cigaret cigarette cigarettes cilantro cilial ciliary ciliate ciliated ciliophoran cilium cimarron cinch cinchona cincture cinder cinema cinemas cinerarium cinnabar cinnamon cinnamons cinque cinquefoil cipher circassian circinate circle circled circler circles circlet circling circuit circuitous circuits circular circularise circularize circulate circulation circulative circulatory circumboreal circumcise circumcision circumference circumlocution circumnavigate circumpolar circumscribe circumscribed circumspect circumspection circumstance circumstances circumstantially circumvent circumvolve circus cirrhus cirriped cirripede cirrus cisalpine cisco cislunar cissy cistern cisterna cistron citadel citation cite cited citer cites cither cithern cities citing citizen citizens citizenship citizenships citole citrange citron citronwood citrous citrus cittern city cityscape cive civic civics civil civilian civilians civilisation civilise civilised civility civilization civilize civilized civiller civillest civilly civilness civils clabber clack clad cladded cladder cladding clads claim claims clairvoyant clam clamant clamber clammed clammer clamming clamor clamored clamorer clamoring clamorous clamors clamour clamouring clamp clamped clamper clamping clamps clams clamshell clan clandestine clang clangor clangoring clangour clank clannish clans clap clapboard clapped clapper clapperclaw clapping claps claptrap claret clarification clarified clarifies clarify clarifyer clarifying clarinet clarion clarity clash clashes clasp clasped clasper clasping clasps class classes classic classical classicist classics classifiable classification classified classifier classifies classify classifyer classifying classmate classmates classroom classrooms clastic clathrate clatter clause claustrophobic claver clavicle clavier clavus claw clawed clawer clawing claws claxon clay clayey claymore clays clayware clean cleaner cleanest cleaning cleanliness cleanly cleanness cleans cleanse cleansed cleanser cleanses cleansing cleanup cleanups clear clearance clearances clearcutness cleared clearer clearest clearing clearly clearness clears clearweed cleat cleats cleavage cleave cleaver clef cleft cleg clegg clemency clement clementine clench cleome clergyman cleric clerical clerk clerks clever cleverer cleverest cleverly cleverness clew cliche click clickbait clicks client clientele clients cliff cliffhanger cliffs cliffside clifves climacteric climate climates climax climaxes climb climbable climber climbing climbings climbs clime clinch clincher cling clinging clings clingstone clingy clinic clinical clinics clink clinker clinometer clip clipboard clipboards clipped clipper clipping clips clique cliquish clit clitoris cloaca cloak cloaked cloakroom cloaks clobber clochard cloche clock clocks clod clods clog clogged clogger clogging cloggy clogs cloister cloistered cloistral clomp clon clone clones clop close closed closedown closeds closelipped closely closemouthed closeness closer closes closest closests closet closets closing closings closure clot cloth clothe clothed clothes clotheses clotheshorse clothing clothings cloths clots cloture cloud cloudberry cloudburst cloudcomputing clouded cloudiness cloudless cloudlike clouds cloudy clout clove clover clown clowning clownish clownlike clowns cloy cloying club clubbed clubber clubbing clubbish clubby clubhouse clubs cluck clue clued clueless cluer clues cluing clump clumsier clumsiest clumsily clumsiness clumsy clung clunk clunky cluster clustered clustering clusters clutch clutches clutter coach coaches coaching coachwhip coaction coagulate coagulated coagulum coal coaled coaler coalesce coalesced coalescence coalescency coaling coalition coalitions coals coapt coarctation coarse coarsely coarsen coarseness coarser coarsest coast coastal coastals coaster coastline coasts coat coated coater coating coatroom coats coax coaxed coaxer coaxes coaxing cob cobbed cobber cobbing cobble cobbler cobblers cobblestone cobnut cobra cobras cobs cobweb cobwebby coca cochineal cock cockcrow cocked cocker cockeyed cockiness cocking cockle cocklebur cockleburr cockney cockpit cockroach cockroaches cocks cockscomb cocksfoot cockspur cocksucker cocksure cocktail cocktails coco cocoa cocoanut coconspirator coconut coconuts cocoon cocotte cocoyam cocozelle cod coda coddle coddler code codebase codec coded coder codes codex codfish codification coding cods codswallop coeliac coerce coerced coercer coerces coercing coercion coetaneous coeval coevals coexist coextensive coffee coffeehouse coffees coffeetable coffeetables coffer cofferdam coffin cog cogency cogent coggle cogitable cogitate cogitation cogitative cognate cognation cognisance cognise cognition cognizance cognize cognomen cogs cogwheel cohabit cohere coherence coherency coherent cohesion cohesive cohesiveness coho cohoe cohort cohosh coif coiffe coiffure coign coigne coil coiled coiler coiling coils coin coinage coincide coincidence coincident coincidental coinciding coiner coins coition coitus coke cokes col cola colander cold coldcock colder coldest coldly coldness colds cole coles colewort colicky coliseum collaborate collaboration collaborationism collaborationist collaborator collage collapse collapsed collapser collapses collapsing collar collarbone collard collars collate collateral collation colleague colleagues collect collected collecter collecting collection collections collective collectively collectivised collectivism collectivist collectivistic collectivized collector collects college colleges collegial collegiate collet collide collie collier colliery colligate colligation collimate collimator collins collision collisions collocate collocation colloquially colloquium colloquy collude collusion collusive colly cologne colon colonel colonels colonial colonies colonisation colonise colonised colonist colonization colonize colonized colonnade colons colony color colorado coloration coloratura colored colorful coloring colorise colorize colorless colors colossal colossus colour colouration coloured colourful colouring colourise colourize colourless colours colt coltish colts coltsfoot columba columbarium columbary column columnar columniform columnlike columns coma comal comate comatose comatoseness comb combat combatant combated combater combating combative combats comber combinable combination combinational combinations combinative combinatorial combinatory combine combined combiner combines combing combining combo combos combs combust combustion come comeback comedian comedienne comedies comedy comely comer comes comestible comet comets comfit comfort comfortable comfortableness comfortably comforted comforter comforting comforts comfrey comfy comic comical comics coming comings comma command commanded commandeer commander commanding commandment commando commands commemorate commemoration commence commencement commend commendation commensurateness comment commentary commentate commentator comments commerce commercial commercialise commercialism commercialize commercials commie comminate commination commingle comminute commiserate commiseration commissariat commissary commission commissioned commissioner commissioners commissioning commissions commit commitment commitments commits committal committed committedness committee committees commix commixture commode commodious commodiousness commodity common commonality commonalty commoner commonest commonly commonness commonplace commons commonwealth commotion commove communal communalism commune communicable communicate communicated communicater communicates communicating communication communicative communicatory communion communique communisation communise communism communist communistic communities community communization communize commutability commutable commutation commute commuter commutes commuting comose comp compact compaction compactly compactness companies companion companions companionship company comparability comparable comparative comparatively compare compares comparing comparison compartment compartmentalisation compartmentalization compass compassion compassionate compassionateness compatibility compatible compeer compel compeled compeler compeling compelling compels compendious compendium compensable compensate compensated compensating compensation compete competent competes competing competition competitions competitive competitiveness competitor competitors competitory compilation compile compiled compiler compiles compiling complacent complain complainant complained complainer complaining complains complaint complaisance complect complement complemental complementarity complementary complementation complete completed completely completeness completing completion complex complexes complexify complexion compliance compliancy complicate complicated complicatedness complication complied complies compliment complimentary compliments complot comply complyer complying component comport comportment compose composed composer composes composing composite composition compositions compositor compost composts composure compound compounding comprehend comprehension comprehensive comprehensiveness compress compressed compressibility compressible compressing compression compressor comprise compromise compromises compromising comptroller compulsion compulsive compulsorily compulsory computable computation compute computer computerise computerize computers computes computing comrade con concatenate concatenation concaveness concavity conceal concealed concealer concealing concealment conceals concede conceding conceit conceited conceitedness conceive conceiver concenter concentrate concentrated concentrater concentrates concentrating concentration concentre concept conception conceptional conceptive concepts conceptualisation conceptualise conceptuality conceptualization conceptualize conceptus concern concerned concerner concerning concerns concert concerted concertina concerts concession concierge conciliate conciliation conciliative conciliator conciliatory concise concisely conclude concluded concluder concludes concluding conclusion conclusiveness concoct concoction concomitant concord concordance concordant concordat concourse concrete concretes concretion concretise concretize concubine concupiscence concupiscent concur concurrence concurrency concurrent concuss concussion concussions condemn condemnable condemnation condemned condemner condemning condemns condensate condensation condense condenser condensing condescend condescending condescendingness condescension condiment condition conditional conditioned conditioner conditions condo condolence condom condominium condone condor condos conduce conducive conduct conducted conducter conducting conductor conducts cone coneflower cones coney confab confabulate confabulation confect confection confectionary confectionery confederacy confederate confederates confederation confederative confer conferee conference conferences conferment conferral conferrer confess confessed confessedly confesser confesses confessing confession confessor confidant confide confided confidence confident confidential confidentiality confider confides confiding confidingly configuration confine confined confinement confining confirm confirmable confirmation confirmative confirmatory confirmed confirmer confirming confirms confiscate conflagrate conflagration conflate conflict conflicted conflicting conflicts confluence confluent conflux conform conformable conformance conformation conforming conformism conformist conformity confound confounded confounding confrere confront confrontation confronted confronter confronting confronts confuse confused confusedness confuser confuses confusing confusion confutable confutation confutative confuter conga conge congeal congee congenator congener congeneric congenial congeniality congenialness congenital congeries congest congestion congius conglobation conglomerate conglomeration conglutinate conglutination congo congou congratulate congratulation congratulations congregating congregation congregational congregationalist congress congresses congressman congressmans congresswoman congruent congruous conjectural conjecture conjoin conjointly conjugate conjugated conjugation conjunct conjunction conjunctive conjuration conjure conjurer conjuring conjuror conjury conk conker connate connatural connect connected connectedness connecter connecting connection connections connective connector connects conned conner connexion conning conniption connivance connive conniving connoisseurship connotation connote conodont conoid conquer conquerable conquered conquerer conquering conquers conquest cons consanguine consanguineal consanguineous consanguinity conscience conscienceless conscientious conscientiously conscientiousness conscious consciousness conscript conscription consecrate consecrated consecration consecutive consensus consent consentaneous consented consenter consentient consenting consents consequence consequent consequential consequently conservancy conservation conservations conservative conservatively conservatives conservativist conservatoire conservator conservatory conserve conserved conserver conserves conserving consider considerable considerably considerate considerateness consideration considered considerer considering considers consign consignment consist consisted consistence consistency consistent consister consisting consists consociate consolation console consoles consolidate consolidated consolidation consolidative consonance consonant consonantal consort consortium conspicuous conspicuously conspicuousness conspiracies conspiracy conspirator conspire constable constabulary constancy constant constantan constantly constellate constellation consternation constipate constipation constituent constitute constitution constitutional constitutionalise constitutionalism constitutionalize constitutions constrain constrained constraining constraint constrict constricted constricting constriction constrictive constringe construct constructed constructer constructing construction constructions constructive constructor constructs construe consubstantiate consult consultant consultants consultation consulted consulter consulting consults consume consumed consumer consumerism consumes consuming consummate consummation consumption consumptive contact contacted contacter contacting contacts contagion contagious contain contained container containing containment contains contaminant contaminate contaminated contaminating contamination contemn contemplate contemplation contemplative contemplativeness contemporaneity contemporaneous contemporaneousness contemporaries contemporary contemporise contemporize contempt contemptibility contemptuous contemptuously contend contender contending content contented contentedness contenter contenting contention contentious contentment contents conterminous contest contestant contestation contested contester contesting contests context contexts contiguous continence continency continent continental continents contingence contingency contingent continual continuance continuant continuation continuative continue continued continuer continues continuing continuity continuous continuously contort contortion contour contra contraband contrabandist contraceptive contract contractable contraction contractor contractors contracts contradict contradiction contradictory contralto contraption contrapuntal contrarily contrariness contrariwise contrary contrast contrasted contraster contrasting contrastive contrasts contravene contravention contribute contributed contributer contributes contributing contribution contributive contributor contributory contrite contriteness contrition contrivance contrive contrived control controled controler controling controller controllers controls controversialist controversies controversy controvert contumacy contumeliously contumely contuse contusion conundrum conurbation convalesce convalescence convection convene convenience convenient convening convent conventicle convention conventional conventionalise conventionalism conventionality conventionalize conventions conventual converge convergence convergency converging conversance conversancy conversation conversationally conversations converse conversion convert convertible convertibles converts convex convexity convexness convey conveyable conveyance conveyancing conveyer conveying conveyor convict convicted convicter convicting conviction convicts convince convinced convincer convinces convincing conviviality convocation convoke convolute convoluted convolution convolve convoy convulse convulsion convulsive cony coo cooccur cooccurring cooed cooer cooing cook cooked cooker cookery cookhouse cookie cookies cooking cookings cooks cooky cool cooled cooler coolest coolheaded cooling coolly coolness cools coon coop cooper cooperate cooperated cooperater cooperates cooperating cooperation cooperative cooperator coordinate coordinated coordination coordinator coordinators coos cop cope coped coper copes copestone copied copier copies coping copious copiously copiousness copped copper copperhead copperplate coppers coppice copping cops copse copulate copulation copy copycat copyer copying copyist copyright copyrights coquet coquetry coquette coquille coral coralberry corals corbel cord cordage corded corder cordial cordiality cording cordoba cordon cordova cords corduroy corduroys core cored corer cores corgi coriander coring cork corker corking corks corkscrew corkscrews corn cornea cornel corneous corner corners cornerstone cornet cornetist cornflower cornhusker cornhusking cornice corns cornucopia corny corollary corona coronach coronal coronate coronation coronet corp corporal corporality corporate corporation corporations corporeal corporeality corposant corps corpse corpulence corpulency corpulent corpus corpuscle corrade corral corrasion correct correctable correction corrections corrective correctness corrects correlate correlated correlation correlative correlativity correspond corresponded correspondence correspondent correspondents corresponder corresponding corresponds corridor corridors corroborate corroboration corroborative corroboratory corrode corroding corrosion corrosive corrugation corrupt corrupted corruptible corrupting corruption corruptive corruptness corsage corsair corse corset corsica cortef cortege cortex cortisol cortisols coruscant coruscate coruscation corvus corydalis corydalus cosh cosher cosign cosignatory cosigner cosmea cosmetic cosmetician cosmic cosmogenic cosmogeny cosmogonic cosmogonical cosmogony cosmography cosmologic cosmological cosmology cosmonaut cosmopolitan cosmopolite cosmos cosmoses cosset cost costa costate costing costless costlier costlies costliest costlily costliness costly costmary costs costume costumes cosy cot coterie coterminous cotilion cotillion cots cottage cottages cottar cotter cottier cotton cottons cottonweed cottonwood couch couches cougar cougars cough coughed cougher coughing coughs could couldnt couldve coulisse coulomb council councils counsel counseled counseler counseling counselling counsellor counselor counselors counsels count countdown countdowns countenance counter counteract counteraction counterattack counterbalance counterbore counterchange countercharge countercheck countercurrent countered counterer counterfeit counterfoil countering counterinsurgency countermand countermarch countermine countermove counterpane counterpart counterplay counterpoint counterpoise counterpunch counterrevolutionary counterrevolutionist counters countersign countersignature countersink counterspy counterstrike countertenor countervail counterweight counties counting countless countrified country countryfied countryman countryside countrysides countrywoman counts county coup couped couper couping couple coupled coupler couples couplet coupling coupon coupons coups courage courageous courageousness courages courgette course courser courses court courteous courtesan courtesy courthouse courthouses courting courtly courtroom courts courtship courtyard courtyards couscous cousin cousins cove covenant coventry cover coverage coveralls covered covereds covering covers coverses covert coves covet covetous covetously covetousness covey cow cowage coward cowardly cowberry cowboy cowboys cowcatcher cower cowhand cowherd cowhide cowl cowling cowman coworker coworkers cowpea cowpoke cowpox cowpuncher cows cowskin cowslip coxa coxcomb coy coyer coyest coyly coyness coyote coyotes cozen cozier coziest cozily coziness cozy cps cpu crab crabapple crabbed crabbedness crabbiness crabby crabmeat crabs crabwise crack crackbrained cracked cracker crackerjack crackers cracking crackle crackleware crackling crackpot cracks cradle cradles cradlesong craft crafter craftily craftiness crafts craftsman craftsmanship crafty cragged craggy cram crammed crammer cramming cramp cramped cramper crampfish cramping crampon crampoon cramps crams cranberries cranberry cranch crane cranes craniate crank crankiness cranky cranny crap crape crapper crappie crappy craps crapshoot crapulence crapulent crapulous crash crashes crate crateful crater craters crates craunch cravat crave craved craven craver craves craving craw crawdad crawdaddy crawfish crawl crawled crawler crawling crawls crayfish crayon crayons craze crazies crazily craziness crazy crazyweed creak creaky cream creams creamy crease create created creater creates creating creation creative creativeness creativity creator creators creature creche credence credential credentials credenza credible credibly credit creditably credited crediter crediting credits creditworthy credo credulous cree creed creek creeks creep creeper creeping creeps creepy creese crematorium crematory crenation crenature crenel crenelate crenelation crenellate crenellation crenelle creole creosote crepe crepes crepitate crepitation crept crepuscle crepuscule crescendo crescent cress cresson crest crested crests cretaceous cretin crevice crew crewed crewer crewing crewman crews crib cribbage crick cricket crickets cried crier cries crime crimes criminal criminalise criminalize criminally criminals criminate crimp crimper crimson cringe cringing cringle crinkle crinkled crinkly crinoline criollo cripple crippled crippling crises crisis crisises crisp crispen crispiness crispness crispy crisscross crisscrossed cristal criteria criterion critic critical criticality criticalness criticise criticism criticize criticized criticizer criticizes criticizing critics critique cro croak croaker croaking croaky crochet crocheting crock crocked crocodile crocodiles croissant croissants crone cronk crony crook crookback crookbacked crooked crookedness crooning crop cropped cropper cropping crops croquet cross crossbar crossbeam crossbreed crossbreeding crosscheck crosscurrent crosscut crossed crosses crossfire crosshatch crosshatched crosshead crossheading crossing crossings crossness crossover crosspatch crosspiece crossroad crossroads crossroadses crosstie crosswalk crosswalks crossway crossways crosswise crotch crotchet crotchetiness crotchety croton crouch crouched croucher crouches crouching croup croupe crouton croutons crow crowbar crowd crowds crowed crower crowfoot crowing crown crowned crowning crownless crowns crownwork crows crucial cruciality crucifix crucifixion crucify crud cruddy crude crudely crudeness crudity cruel crueler cruelest cruelly cruelness cruelty cruise cruiser cruises crumb crumble crumbs crummy crump crumple crunch crusade crusader crush crushed crushes crushing crust crustacean crustaceous crusted crustlike crusts crusty crutch crutches crux cruxes cry crybaby cryer crying cryopathy crypt cryptanalysis cryptanalytics cryptic cryptical crypto cryptogram cryptograph cryptography cryptology crypts crystal crystalise crystalised crystalize crystalized crystalline crystallisation crystallise crystallised crystallization crystallize crystallized crystallizing cub cubbed cubber cubbing cubby cubbyhole cube cubeb cubed cuber cubes cubic cubicle cubicles cubics cubing cubitus cubs cuckold cuckoo cuckoos cucumber cucumbers cud cudbear cuddle cuddles cuddling cudweed cue cued cuer cues cuff cufflink cuffs cufves cuing cuisine cuke cull cullender culminate culmination cult cultism cultist cultivate cultivated cultivation cultivator cults cultural culture cultured cultures cultus culverin cum cumber cumbersome cumbersomeness cumbrous cumfrey cumin cumins cumquat cumulate cumulation cumulative cumulus cunctation cuneal cuneiform cuneus cunning cunningly cunt cup cupboard cupboards cupcake cupcakes cupful cupid cupidity cupola cupped cupper cupping cups cupule cur curable curacao curacoa curate curative curator curb curbed curber curbing curbs curd curdle curdled cure cured curer cures curfew curie curing curio curiosity curious curiously curiousness curl curled curler curlicue curlier curliest curlily curliness curling curls curly curmudgeon curmudgeonly currant currencies currency current currently currentness currents curricula curriculum currier curries currish curry curs curse cursed curser curses cursing cursor cursorily cursors cursory curt curtail curtailment curtain curtains curtilage curtly curtness curts curtsey curtsy curvaceous curvaceousness curvature curve curves curvey curvy cushat cushaw cushion cushions cushy cusk cusp cuspid cuss cussed custard custards custodian custody custom customary customer customest customise customize customized customizer customizes customizing customly customness customs cut cutaneal cutaneous cutaway cute cutely cuteness cuter cutest cuticle cuticular cutis cutlery cutlet cutoff cutout cutpurse cuts cutter cutthroat cutting cva cwt cyan cyanamid cyanamide cyanide cyanly cyanner cyanness cyannest cybernate cyberpunk cyberspace cycle cycles cyclic cyclical cycling cyclings cyclist cyclists cyclonal cyclone cyclonic cyclonical cyclops cyclorama cyclosis cyder cylinder cymbal cymric cymry cynic cynical cynosure cypher cypress cyprian cypriot cypriote cyprus cyrilla cyst cystic cytol cytoplasm cytosmear czar dab daba dabbed dabber dabbing dabble dabbler dabs dachshund dachsie dactyl dad dada dadaism daddies daddy dado dads daemon daft daftness dag dagger dago dah dahl daikon dailies daily daimon daintier daintiest daintily daintiness dainty dairier dairies dairiest dairily dairiness dairy dairyman dais daisies daisy dalliance dallier dally dalmatian dalo dam damage damaged damages damaging damascene damask dame daminozide dammed dammer damming damn damnable damnation damned damoiselle damosel damozel damp dampen damper dampest dampish damply dampness dams damsel damselfish dance dancer dancers dances dancing dandelion dander dandle dandruff dandy danger dangerous dangers dangle dangling danish danishes daphne dapper dapperness dapple dardan dardanian dare dared daredevil darer dares daring daringly dark darken darkened darker darkest darkling darkly darkness darling darn darned darnel dart darter darts das dash dashboard dashboards dashed dasheen dasher dashes dashing dassie data database databases datas datasecurity date dated dateless dateline datemark dater dates dating datum daub daubs daughter daughters daunt dauntless davenport dawdle dawdler dawdling dawn dawned dawner dawning dawns day daybed daybook daybreak daydream daydreaming daylight daylights days dayspring daystar daytime daze dazed dazes dazzle dazzled dazzling deacon deactivate deactivation dead deadbeat deadbolt deaden deadened deadening deader deadest deadeye deadhead deadlier deadlies deadliest deadlily deadline deadlines deadliness deadlock deadly deadness deadpan deads deadwood deaf deafen deafening deafer deafest deafly deafness deafs deal dealer dealers dealership dealing dealings deals dealt dean deanery deans deanship dear dearer dearest dearie dearly dearness dears dearth deary death deathbed deathlike deathly deathrate deaths deathwatch deaves debacle debar debarment debase debased debasement debasing debatable debate debates debauch debauched debaucher debauchery debenture debile debilitate debilitated debilitation debility debit debits debonair debonaire debone deboned debonnaire debouch debrief debris debt debts debug debugging debugs debunk debunking debut dec decade decadence decadency decadent decades decaf decal decalcify decalcomania decameter decametre decamp decampment decant decanter decapitation decapod decarboxylate decay decayed decays decease deceased deceit deceitful deceitfulness deceive deceiver deceives decelerate deceleration december decembers decency decennary decennium decent decentalisation decenter decentest decently decentness decentralisation decentralise decentralization decentralize decents deception deceptive deceptiveness decide decided decidedly decides deciduous decimal decimalise decimalize decimate decipher decipherer decision decisions decisive decisively decisiveness deck decked decker decking deckle decks declaim declamation declamatory declaration declarative declaratory declare declared declarer declares declension declination decline declines declivitous declivity decoct decode decoder decolor decolorise decolorize decolour decolourise decolourize decompose decomposition decompress decompressing decompression deconcentrate deconsecrate decorate decorated decorater decorates decorating decoration decorative decorator decorous decorticate decoupage decouple decoy decoys decrease decreased decreaser decreases decreasing decree decreed decrees decrement decrepit decrepitate decrepitude decriminalise decriminalize decry decrypt dedicate dedicated dedication dedications deduce deduct deductible deduction deductive deed deeds deem deemed deemer deeming deems deep deepen deeper deepest deepfake deepfreeze deeply deepness deeps deer deers deface defacement defalcate defalcation defamation defame default defaulter defaults defeat defeated defeatist defeats defecate defecation defecator defect defection defective defector defence defenceless defencelessly defences defend defendant defendants defended defender defends defense defenseless defenselessly defenses defensive defensively defer deference deferentially deferment deferral defiance defiant deficiency deficient deficit deficits defile defiled defilement define defined definer defines defining definite definitely definition definitive deflagrate deflate deflation deflect deflection deflective deflexion defloration deflower defoliation deforestation deform deformation deformed deformity defrag defraud defrauder defrayal defrayment deft deftly deftness defunct defunctness defusing defy degage degauss degeneracy degenerate degeneration deglutition degradation degrade degraded degrading degree degrees degressive degustation dehorn dehumanise dehumanize dehydrate dehydrated dehydration deification deify deign deity deject dejected dejectedness dejection dejeuner dekameter dekametre delay delays delectable delectation delegacy delegate delegated delegater delegates delegating delegation delete deleted deleter deleterious deletes deleting deletion deli deliberate deliberately deliberateness deliberation delicacy delicate delicately delicatessen delicious deliciously delight delighted delighter delightful delighting delights delilah delimit delimitate delimitation delineate delineated delineation delinquency delinquent deliquesce deliquium delirious deliriously delirium delis deliver deliverance delivered deliverer deliveries delivering delivers delivery delphian delphic delta deltas delude deluge delusion delusive delusory deluxe demagnetise demagnetize demand demanded demander demanding demands demarcate demarcation demasculinise demasculinize demean demeaning demeanor demeanour demented dementedly dementedness dementia dementias demerara demerit demesne demigod demilitarise demilitarize demineralisation demineralization demise demitasse demo demob demobilise demobilize democracies democracy democrat democratic democratise democratize democrats demode demodulator demographic demographics demoiselle demolish demolishing demolition demon demonic demons demonstrable demonstrate demonstrated demonstrater demonstrates demonstrating demonstration demonstrative demonstrator demoralisation demoralise demoralised demoralization demoralize demoralized demote demoted demoter demotes demotic demoting demulsify demur demure demureness demurrage demurral demurrer den denary denaturalise denaturalize denature dendriform dendroid dendroidal denial denied denier denies denigrate denigration denim denims denizen denominate denomination denominational denominationalism denotation denotative denote denotive denouement denounce dens dense densely denseness denser denses densest densification densimeter densities densitometer density dent dental dentin dentine dentist dentists dentition dents denture denudate denudation denude denuded deny denyer denying deoxidise deoxidize deoxyephedrine depart departed departer departing department departments departs departure departures depend dependable dependance dependant depended dependence dependency dependent depender depending depends depersonalisation depersonalise depersonalization depersonalize depict depicted depicter depicting depiction depicts depilation depilator depilatory deplete depletion deplorable deplorably deplore deploy deployed deployer deploying deployment deploys deplumate deplume depone depopulate deport deportation deportee deportment depose deposit depositary deposition depository deposits depot depots depravation deprave depraved depravity deprecate deprecating deprecation deprecative deprecatory depreciate depreciating depreciation depreciative depreciator depreciatory depredation depress depressed depression depressions depressor depressurise depressurize deprivation deprive deprived depriver deprives depriving depth depths deputation depute deputies deputise deputize deputy deracinate deracination derail derange derangement derbies derby deregulate derelict dereliction derision derisively derisorily derisory derivation derivative derive derived deriver derives deriving dermal dermatosclerosis dermic derogate derogation derrick desacralize descale descant descend descendant descendants descendent descender descent describe described describer describes describing description descriptions descriptive descriptivism descriptor descry desecrate desecration desegregate desegregation desensitise desensitize desert deserted deserter desertion deserts deserve deserved deserver deserves deserving deservingness desex desexualise desexualize desiccate desiccated desiccation design designate designation designed designedly designer designing designs desirability desirable desirableness desire desired desirer desires desiring desirous desist desk desks desktop desolate desolation desorb despair despairing despatch desperate desperately desperation despicability despicable despicableness despise despite despited despiteful despitefully despiter despites despiting despoil despoilation despoiled despoiler despoilment despoliation despondent despot despotic despotical despotism dessert desserts destabilisation destabilise destabilization destabilize destination destinations destine destined destinies destiny destitute destroy destroyed destroyer destroys destruct destruction detach detached detachment detail detailed details detain detainment detect detectable detected detecter detecting detection detective detectives detector detects detent detention detentions deter detergent deteriorate deterioration determent determinant determinate determination determinative determine determined determinedly determiner determines determining deterred deterrence deterrent deterrer deterring deters detersive detest detestable detestably detestation dethaw dethronement detonate detonation detonator detour detox detoxicate detoxification detoxify detraction detractor detribalisation detribalization detriment detrimental detrition detritus detusk deuce deuced deucedly devaluate devaluation devalue devalued devastate devastated devastating devastation develop developed developer developing development developments develops deviance deviant deviate deviation device devices devil devilfish devilish devilishly devilment devilry devils deviltry devious deviousness devisal devise devising devitrify devoid devolution devolve devolvement devon devonshire devops devote devoted devotedness devoteds devotee devoter devotes devoting devotion devotions devour devout devoutness dew dewar dewberry dewdrop dews dexterous dexterously dextral dextrous dextrously dhal diabetes diabeteses diabetic diabolic diabolical diabolically diachronic diadem diaglyph diagnose diagnosed diagnoser diagnoses diagnosing diagnosis diagnostic diagonal diagram diagrammatically diagramming dial dialect dialectic dialectical dialog dialogs dialogue dials diam diamante diameter diametral diametric diametrical diamond diamonds dianoetic diaper diapers diaphanous diaphoresis diaphragm diaphysis diaries diarist diary diaspora diatonic diatribe dibber dibble dibrach dice dices dicey dichotomy dichromatic dick dickens dicker dickey dickhead dickie dicky dictate dictated dictater dictates dictating dictation dictator dictatorial dictatorially dictatorship dictatorships diction dictionary dictum did didactics didder diddle diddley diddly diddlyshit diddlysquat didnt die died dies diesel diesels diet dieting diets differ differed difference differences different differentiable differential differentiate differentiated differentiation differently differer differing differs difficult difficulties difficultness difficulty diffident diffuse diffused diffuser diffusion diffusor dig digest digestion digger digging diggings digit digital digitalin digitalis digitalise digitalize digitally digitals digitise digitize digits dignified dignify dignifying dignity digress digression digressive digs dike dilapidate dilapidated dilapidation dilatation dilate dilater dilation dilator dilatoriness dilatory dilemma dilettante diligence diligent dill dilled diller dilling dills dillydallier dillydally dilute diluted dilution dim dime dimension dimensional dimes diminish diminished diminution diminutive diminutiveness dimly dimmed dimmer dimming dimness dimorphism dimout dimple dims din dinar dine dined diner dinero diners dines ding dingdong dinge dinghy dinginess dingo dingy dining dinings dink dinkey dinky dinned dinner dinners dinning dinosaur dinosaurs dins diocese diode diol dionysia diorama dip diploma diplomacy diplomas diplomat diplomatic diplomatical diplomatist diplomats dipole dipped dipper dipping dips dipsomania dipsomaniac dire direct directed directer directing direction directional directionality directionless directions directive directiveness directivity directly directness director directors directory directs direful direly direness direr dires direst dirge dirham dirndl dirt dirtier dirties dirtiest dirtily dirtiness dirts dirty dis disa disability disable disabled disablement disables disabling disaccord disadvantage disadvantageous disadvantageously disaffect disaffected disaffection disaffirmation disagree disagreeable disagreeableness disagreed disagreeing disagreement disagreer disagrees disallow disappear disappearance disappeared disappearer disappearing disappears disappoint disappointed disappointer disappointing disappointment disappoints disapprobation disapproval disapprove disapproving disarm disarrange disarrangement disarray disarticulate disassemble disassociate disassociation disaster disastrous disavowal disband disbelief disbelieve disbelieving disbud disburden disbursal disbursement disburser disc discalceate discalced discant discard discarded discarder discarding discards discase disceptation discern discernability discernable discernible discerning discernment discerp discharge discharges disciplinal disciplinarian disciplinary discipline disciplined discipliner disciplines disciplining disclaim disclaimer disclose disclosed discloser discloses disclosing disclosure disco discolor discoloration discolorise discolorize discolour discolouration discolourise discombobulate discombobulation discomfit discomfited discomfiture discomfort discommode discompose discomposure disconcert disconcertion disconcertment disconfirming disconnect disconnected disconnectedness disconnecter disconnecting disconnection disconnects disconsolate discontent discontented discontinuation discontinue discontinuous discord discordance discordant discords discorporate discos discotheque discount discountenance discounts discourage discouraged discouragement discourager discourages discouraging discourse discourteous discourtesy discover discovered discoverer discovering discovers discovery discredit discreditably discredited discreet discreetness discrepancy discrepant discrete discreteness discretion discretional discretionary discriminate discriminating discrimination discriminations discriminative discriminatory discs discursive discus discuss discussed discusser discusses discussing discussion discussions disdain disdainful disdainfully disdainfulness disease diseased diseases disembarrass disembodied disembowel disembowelment disembroil disenable disenchant disenchantment disencumber disenfranchised disengage disengagement disentangle disesteem disfavor disfavour disfiguration disfigure disfigurement disforestation disfranchised disgorge disgorgement disgrace disgraced disgraceful disgracefully disgruntled disguise disguised disguiser disguises disguising disgust disgusted disgustful disgusting disgustingly disgustingness dish disharmonious disheartened disheartenment dishes dishevel disheveled dishevelled dishful dishonest dishonesty dishonor dishonorable dishonorably dishonored dishonour dishonourable dishonourably dishwasher dishwashers dishwashing disillusion disillusionment disincentive disinclination disincline disingenuous disingenuously disinherit disintegrate disintegration disinterest disinvest disinvolve disjoin disjoint disjointed disjunct disjunction disjuncture disk disks dislike dislocate dislocated dislocation dislodge disloyal dismal dismally dismantle dismay dismayed dismaying dismember dismiss dismissal dismissed dismisser dismisses dismissing dismission dismissive disobedience disobedient disoblige disobliging disorder disordered disorderliness disorderly disorders disorganisation disorganization disorientation disoriented disown disparage disparagement disparager disparate disparateness dispassion dispassionateness dispatch dispatcher dispatches dispel dispensation dispense dispenser dispersal disperse dispersion dispirit dispirited dispiritedly dispiritedness displace displacement display displayed displayer displaying displays displume disport disposable disposal dispose disposed disposer disposes disposing disposition dispossessed dispossession dispraise disproof disproportional disproportionate disproportionately disprover disputable disputant disputation disputatious disputative dispute disputed disputer disputes disputing disqualification disqualified disqualifies disqualify disqualifyer disqualifying disquiet disquieted disquietude disregard disrepute disrespect disrespectful disrobe disrupt disruption disruptive diss dissatisfied dissect dissected dissection dissemble dissembler dissembling disseminate dissemination disseminator dissension dissent dissenter dissentient dissertate dissertation dissever dissident dissimilar dissimilate dissimilation dissimulation dissimulator dissipate dissipated dissipation dissociate dissociation dissolute dissoluteness dissolution dissolve dissolved dissolvent dissolver dissolves dissolving dissonance dissonant dissuade dissuasion dissymmetry distaff distal distance distances distant distants distaste distasteful distastefully distastefulness distemper distend distension distention distich distil distill distillate distillation distillery distillment distinct distinction distinctions distinctive distinctiveness distinctly distinctness distinguish distinguishable distinguished distinguisher distinguishes distinguishing distort distorted distortion distract distracted distraction distrain distraint distrait distraught distress distressed distressful distressfulness distressing distressingly distressingness distribute distributed distributer distributes distributing distribution distributively distributor distributors district districts distrust distrustfulness disturb disturbance disturbed disturber disturbing disturbs disunite disunited disuse disused dit ditch ditches ditchmoss dither dithyramb diurnal divagate divagation divalent divan divaricate dive diver diverge divergence divergency divergent diverging divers diverse diverseness diverses diversification diversify diversion diversionist diversities diversity divert divertimento dives divest divestiture divide divided divideds dividend divider divides dividing divination divinatory divine divinely divineness diviner divines divinest diving divings divinity division divisional divisor divorce divorcement divorces divot divulge diwan dixie dixieland dizen dizzier dizzies dizziest dizzily dizziness dizzy dkm dna dnas doable dobson dobsonfly doc docile dock dockage docked docker docket dockhand docking docks dockworker docs doctor doctors doctrine docudrama document documental documentary documentation documented documents dod dodder doddering doddery dodge dodged dodger dodges dodging dodgy dodo doe doer does doesed doeser doeses doesing doeskin doesnt dog dogfight dogfish dogged doggedness dogger doggerel dogging doghouse dogleg dogma dogmatic dogmatical dogmatise dogmatize dogs dogshit dogsled dogtooth dogwood doh doi doing doings doj dol doldrums dole doled doleful dolefully doler doles doling doll dollar dollarfish dollars dollhouse dolls dolly dolman dolomite dolorous dolourous dolphin dolphinfish dolphins dolt domain domains dome domed domer domes domestic domestically domesticate domesticated domestication domesticise domesticity domesticize domicile domiciliate domiciliation dominance dominant dominate dominated dominates dominating domination domineer domineering doming dominical dominicus dominion domino dominoes dominoeses dominos don donate donated donateds donater donates donating donation donations done doned donee donely doneness doner dones donest dong dongle doning donjon donkey donkeys donkeywork donned donner donning donnish donor donors dons dont donut donuts doodad doodle doodlebug doohickey doojigger doom doomed doomer dooming dooms doomsday door doorbell doorbells doorhandle doorkeeper doorknob doorknobs doorknocker doorman doormat doors doorsill doorstep doorsteps doorway doorways dopamine dopamines dopastat dope doped dopey doppelzentner dopy doris dork dorm dormancy dormant dormitory dorms dorsal dorsum dory dos dosage dosages dose dosed doser doses dosing doss dot dotage dote doting dots dotted dotter dotting dotty double doubled doubleness doubler doubles doublest doubling doubly doubt doubter doubtful doubtfully doubtfulness doubting doubts douche dough doughboy doughnut doughs doughy dour douse dousing dove dovecote doves dowdiness dowding dowdy dowel dower dowery down downcast downed downer downfall downfalled downfaller downfalling downfalls downhearted downheartedness downhill downing downlike download downloaded downloader downloading downloads downplay downpour downpours downright downrightness downs downshift downsize downsizing downslope downstairs downswing downtime downtown downtowns downturn downward downwardly downwards downwind downy dowry dowse dowser dowsing doxy doyen doze dozed dozen dozens dozer dozes dozing dozy drab drabber drabbest drably drabness drachm drachma draco dracunculus draft draftee drafting drafts draftsman draftsmanship draftsperson drag dragee dragged dragger dragging draggled dragnet dragon dragonflies dragonfly dragonfruit dragons dragoon drags drain drainage drained drainpipe drains drake dram drama dramas dramatic dramatically dramatics dramatisation dramatise dramatist dramatization dramatize dramaturgy drank dranks drape draped drapery drapes drastic drastically draught draughts draughtsman draw drawer drawers drawing drawings drawn drawns draws drawstring dray dread dreaded dreadful dreadfully dream dreamed dreamer dreaminess dreaming dreamlike dreams dreamt dreamy drear drearily dreariness dreary dredge drench drenched drenching dress dressed dresser dressers dresses dressing dressings dressmaker drew drews drib dribble dribbler dribbles dribbling driblet dried drieds drier dries driest drift drifter drifting drifts drill drilling drills drily driness drink drinkable drinker drinking drinks drip dripped dripper drippiness dripping drippy drips dripstone drive drivel driveller driven drivener drivenest drivenly drivenness drivens driver drivers drives driveway driveways driving drizzle drizzles drizzly drogue drollery drome drone drones droning drool drooler drools droop drooping droops droopy drop dropkick dropout dropped droppeds dropper dropping droppings drops dropses dross drought droughts drouth drove droves drown drowns drowse drowsy drub drubbing drudge drudgery drug drugged drugger druggest drugging druggist drugly drugness drugs drugstore drum drumbeat drumbeater drumfish drumhead drummed drummer drumming drums drumstick drumsticks drunk drunkard drunkenness drunker drunkest drunkly drunkness drunks druthers dry dryer drying dryinger dryingest dryingly dryingness dryness drywall drywalls duad dual dualer dualest duality dually dualness duals dub dubbed dubber dubbing dubiety dubious dubiously dubiousness dubitable dubs dubya dubyuh duchess duchesses duchy duck duckbill ducked ducker ducking duckling ducks ducky duct ductile ducts dud dudded dudder dudding dude duds due duel dueled dueler dueling duels duely dueness duer dues duest duet duets duette duff duffel duffle duffs dufves dug dugged dugger dugging dugout dugs duke dukedom dukes dulcet dulcify dulcimer dulcorate dull dullard dulled duller dullest dullly dullness dulls dully duly dumb dumbass dumbbell dumbbells dumber dumbest dumbfound dumbfounded dumbfounding dumbly dumbness dumbstricken dumbstruck dumfounded dumfounding dummy dump dumped dumper dumping dumpling dumplings dumps dumpsite dumpy dun dunce duncical duncish dunderhead dune dunes dung dungaree dungarees dungeon dunghill dunk dunked dunker dunking dunks dunnock duns duo duodecimal duologue duomo duos dupe dupery duple duplex duplicate duplication duplicator duplicitous duplicity durability durable duration durian during durings durion dusk duskiness dusks dusky dust dusted duster dustier dustiest dustily dustiness dusting dustpan dustpanful dustpans dusts dustup dusty dutch duteous duties dutiful duty duvet dvd dwarf dwarves dweeb dwell dweller dwelling dwellings dwells dwelt dwindle dwindling dyad dye dyed dyeing dyer dyes dyestuff dyeweed dying dyings dyke dynamic dynamical dynamics dynamise dynamism dynamize dynamo dysfunctional dyslectic dyslexic dyspeptic dysphoric dyspneal dyspneic dyspnoeal dyspnoeic dystopia dystopian dystrophy each eacher eaches eachest eachly eachness eager eagerly eagerness eagerrer eagerrest eagers eagle eagles eagre ear eardrum eared earer earful earing earl earldom earlier earliers earlies earliest earlily earliness earls early earmark earn earned earneder earnedest earnedly earnedness earneds earner earnest earnestly earnestness earnests earning earnings earningses earns earphone earpiece earplug earreach earring earrings ears earshot earsplitting earth earthball earthborn earthbound earthing earthlike earthling earthman earthnut earthquake earthquakes earths earthshaking earthworm earthy ease eased easel easement easer eases easier easierer easierest easierly easierness easies easiest easilies easily easiness easing east easter easterly eastern easterns easts eastward easy easygoing eat eatable eatage eaten eatens eater eaters eatery eating eatings eats ebb ebbed ebber ebbing ebbs ebon ebonier eboniest ebonily eboniness ebony ebullience ebullient ebulliently ebullition eccentric eccentrically eccentricity ecchymosis ecclesiastic ecclesiasticism ecdysiast ecdysis ecesis echelon echidna echo echoed echoer echography echoic echoing echolalia echolike echos echt eclat eclipse eclipses eclogue ecologic ecological ecologies ecology economic economical economically economics economies economise economize economy ecosystem ecphonesis ecrevisse ecru ecstasy ecstatic ectoplasm ecumenic ecumenical ecumenicalism ecumenicism ecumenism edacious edacity edda eddo eddy eden edge edged edger edges edgeways edgewise edgier edgiest edgily edginess edging edgy edible edibleness edibler ediblest edibly edict edification edify edifying edit editing edition editions editor editorial editors edits editted editter editting educate educated educatee educater educates educating education educational educations educe edulcorate eeg eel eelgrass eelpout eels eerie eery eff efface effacement effect effected effecter effecting effective effectively effectiveness effectivity effector effects effectual effectuality effectualness effectuate effectuation effeminate effeminise effeminize effervesce effervescence effervescent effervescing effete efficacious efficaciously efficiency efficient effigy effloresce efflorescence effluence efflux effort effortless efforts effrontery effulgence effulgent effuse effusion effusive effusiveness egest egg eggbeater egged egger eggfruit egging eggnog eggplant eggs eggses eggshell eggwhisk egis eglantine ego egocentric egocentrism egoism egoist egotism egotist egotistic egotistical egregious egress egression egyptian eib eiderdown eight eighteen eighter eighth eighther eighthest eighthly eighthness eighths eighties eights eightsome eighty einstein either eitherer eitherest eitherly eitherness ejaculate ejaculation ejaculator eject ejection ejector eke eked eker ekes eking elaborate elaborated elaborateness elaboration elan elapse elastic elasticity elate elated elating elation elbow elbows eld elder elderberry elderlies elderly elders eldest eldester eldestest eldestly eldestness eldritch elect elected electer electing election electioneering elections elective elector electoral electric electrical electrician electricians electricities electricity electrification electrify electrifying electrocardiograph electrocute electrocution electrode electroencephalogram electrograph electrolysis electrolyte electrolytic electromagnetics electromagnetism electron electronegative electronegativity electroneutral electronic electrons electrophorus electropositive electrostatic electrotherapy elects eleemosynary elegance elegant elegantly elegiac elegy element elemental elementaries elementary elements elephant elephantine elephants elevate elevated elevation elevator elevators eleven elevens elf elfin elfish elflike elia elicit elicitation eligible eliminate eliminated eliminater eliminates eliminating elimination elision elite elites elixir elk elks ellas ellipse elliptic elliptical elm elms elmwood elocutionary elodea elongate elongated elongation elope eloquence eloquent eloquently else elsewhere elucidate elucidation elude eluding elusion elusive elver elves elvis elvish elysian emaciate emaciated emaciation email emails emanate emanation emancipate emasculate emasculation embargo embark embarkation embarkment embarrass embarrassed embarrasser embarrasses embarrassing embarrassment embassador embassies embassy embattle embattled embayment embed embedded embeds embellish embellishment ember embers embezzle embezzlement embitter emblazon emblem emblematic emblematical embodied embodiment embody embolden embolism embonpoint emboss embossed embossment embouchure embrace embraced embracement embracer embraces embracing embrangle embrasure embrocate embroider embroidery embroil embroiled embroilment embrown embryo embryologic embryonal embryonic embryotic emcee emerald emerge emerged emergence emergencies emergency emergent emerger emerges emerging emersion emesis emetic emf emigration eminence eminent emirate emissary emission emit emits emitted emitter emitting emmet emoji emojis emollient emoticon emotion emotional emotionally emotionless emotionlessness emotions empale empanel empathetic empathetically empathic empathies empathise empathize empathy empennage emperor emperors emphasis emphasise emphasised emphasises emphasize emphasized emphasizer emphasizes emphasizing emphatic emphatically empire empires empiric empirical empiricism empirin emplace emplacement employ employed employee employees employer employing employment employments employs empower empowered empowerment emptier emptiest emptily emptiness emptor empty emptying empurple empurpled empyreal empyrean emu emulate emulation emulator emulous emulsify emulsion emus enable enabled enabler enables enabling enact enactment enamel enamor enamored enamoredness enamour enation encamp encampment encapsulate encapsulation encased enceinte encephalogram encephalon enchant enchanted enchanting enchantment enchantress enchilada enchiladas encipher encircle encirclement enclose enclosing enclosure enclothe encode encoder encodes encomium encompass encompassing encore encounter encountered encounterer encountering encounters encourage encouraged encouragement encourager encourages encouraging encroach encroachment encrust encrustation encrusted encrypt encryption enculturation encumber encumbrance encyclopaedism encyclopedism end endanger endangered endangereds endangerment endear endearing endeavor endeavour ended endemic endemical ender endgame ending endings endive endless endlesses endlessly endocarp endocrinal endocrine endogamic endogamous endogamy endogenetic endogenic endogenous endoparasite endorse endorsement endorser endow endowment endozoan endozoic endpoint ends endtable endtables endue endurance endure endured endurer endures enduring enduringness endways endwise enemies enemy energetic energies energise energiser energising energize energizer energizing energy enervate enervated enervation enfeeble enfeeblement enfold enfolding enforce enforced enforcer enforces enforcing enfranchise enfranchisement engage engaged engageds engagement engagements engager engages engaging engender engine engineer engineering engineers engines english englut engorge engorgement engraft engrave engraved engraver engraving engross engrossed engrossing engrossment engulf enhance enhancement enhancer enhances enhancive enigma enigmatic enigmatical enjoin enjoining enjoinment enjoy enjoyable enjoyably enjoyed enjoyer enjoying enjoyment enjoys enkindle enlace enlarge enlarged enlargement enlighten enlightened enlightening enlightenment enlist enlistee enlistment enliven enlivened enmesh enmeshed enmity ennead ennoble ennoblement ennobling ennui enormity enormous enough enoughs enounce enquire enquiry enraged enrapture enraptured enrich enriched enricher enriches enriching enrichment enrobe enrol enroll enrolled enroller enrolling enrollment enrollments enrolls enrolment ensconce ensemble enshrine enshroud ensign enslavement ensnare ensnarl ensuant ensue ensuing ensure ensured ensurer ensures ensuring entail entailment entangle entangled entanglement entellus entente enter enteral enteric entering enterprise enterpriser enterprises enterprisingness enters entertain entertained entertainer entertaining entertainment entertains enthral enthrall enthralled enthralling enthrallment enthrone enthronement enthronisation enthronization enthuse enthusiasm enthusiast enthusiastic enthusiastically entice enticement enticing entire entirely entireness entirer entires entirest entirety entities entitle entity entomb entombment entoparasite entourage entozoan entozoic entozoon entrance entranced entrancement entrances entranceway entrancing entrant entrap entreat entreaty entree entrench entrenched entrepot entrepreneur entrepreneurial entrepreneurs entresol entries entropy entrust entry entryway entwine enucleate enumerate enumeration enunciate enunciation enured envelop envelope envelopes envelopment envenom envied envies envious enviously enviousness environ environment environmental environmentalism environments environs envisage envision envisioned envisioning envoi envoy envy envyer envying enwrap enwrapped enzyme eolian eon eonian epanaphora epanodos eparch eparchy epee epenthetic ephemeral epic epical epicalyx epiccer epiccest epicene epicly epicness epics epicure epicurean epidemic epidermal epidermic epidermis epigastric epigram epigrammatic epigraph epilation epilator epilog epilogue epinephrin epinephrine epiphany epiphysis episcopacy episcopal episcopalian episcopate episode episodes episodic epistasis epistle epitaph epithet epitome epitomise epitomize epitope epoch eponym epos equable equal equaler equalest equalisation equalise equaliser equalities equality equalization equalize equalizer equally equalness equals equalses equanimity equate equating equation equator equatorial equerry equestrian equid equilibrate equilibrise equilibrium equilibrize equine equinoctial equinox equip equipage equiped equiper equiping equipment equipments equipoise equipped equipping equips equipt equitable equitation equity equivalence equivalent equivocal equivocalness equivocate equivocation equivocator era eradicate eradication eraed eraer eraing eras erase erased eraser erasers erases erasing erasure erbium erect erected erecter erectile erecting erection erectness erects eremitic eremitical ergonomics ergot erinyes eristic eristical ermine erode eroding eros erose erosion erosions erosive erotic erotica eroticer eroticest eroticism eroticly eroticness erotism err errancy errand errant erratic erratum erred errer erring erroneousness error errors errs ersatz erst erstwhile eruct eructation eruditeness erudition erupt eruption eruptive escadrille escalate escalator escalators escallop escapade escape escaped escaper escapes escaping escapism escapist escargot escarole escarp escarpment eschalot eschaton escheat eschew escort escritoire escudo escutcheon esophagus especially espial espousal espouse espresso espy esq esquire essay essayer essays essence essential essentially establish established establisher establishes establishing establishment estate estates esteem esteemed esteems esthesia esthesis esthetic esthetical esthetician estimable estimate estimated estimater estimates estimating estimation estimator estivation estragon estrange estranged estrangement estrus esurience esurient etch etched etcher etches etching eternal eternalise eternalize eternally eternise eternity eternize ethanediol ethanoate ether ethereal ethernet ethernets ethic ethical ethics ethnic ethnical ethnicer ethnicest ethnicly ethnicness ethnics ethoxyethane etiolate etiolated etiolation etiologic etiological etiology etna etymologise etymologize etymologizing etymology etymon eucalypt eucalyptus eucharist eudaemonia eudaimonia eulogium eulogy eumenides eunuch euphonious euphonous euphony euphoria euphoric euphory euphuism eureka euro euros evacuant evacuate evacuation evade evaluate evaluated evaluater evaluates evaluating evaluation evaluator evanesce evangel evangelical evangelise evangelist evangelistic evangelize evaporable evaporate evaporation evasion evasive evasiveness eve even evenfall evenhandedly evening evenings evenly evenned evenner evenness evennest evenning evens evensong event eventful eventide events eventuality eventually ever evergreen everies everlasting everlastingly evermore eversion everting every everybody everyday everyone everyplace everything everywhere eves evict eviction evidence evidences evident evidential evidentiary evidently evil evildoing eviller evillest evilly evilness evince eviscerate evisceration evocation evocative evoke evolution evolve evolved evolver evolves evolving ewe ewer ewes exabyte exacerbate exacerbating exacerbation exact exacter exactest exacting exactly exactness exacts exaggerate exaggerated exaggerater exaggerates exaggerating exaggeration exalt exaltation exalted exalting exam examen examination examinations examine examined examiner examines examining example examples exams exanimate exarch exarchate exasperate exasperated exasperating exasperation exbibyte excavate excavation excavator exceed exceeded exceeder exceeding exceedingly exceeds excel excellence excellency excellent excellently except exception exceptionable exceptional excepts excerpt excerption excess excesses excessive excessively excessiveness exchange exchangeable exchanges exchequer excise excision excitability excitable excitableness excitant excitation excite excited excitement excites exciting exclaim exclaiming exclamation exclamatory exclude excluded excluder excludes excluding exclusion exclusive exclusively exclusives excogitate excogitation excommunicate excommunication excoriate excoriation excrement excrescence excreta excrete excreting excretion excruciate excruciation exculpate exculpated exculpation excursion excursionist excursive excursus excusable excusatory excuse excused excuser excuses excusing exec execrable execrate execration execs executable execute executed executer executes executing execution executions executive executives exemplar exemplary exemplification exemplify exemplifying exempt exempted exempter exempting exemption exempts exercise exercised exerciser exercises exercising exert exertion exerts exfiltrate exfoliate exfoliation exhalation exhale exhaust exhausted exhauster exhaustible exhausting exhaustion exhaustive exhaustively exhausts exhibit exhibited exhibiter exhibiting exhibition exhibitioner exhibitionism exhibitionist exhibitor exhibits exhilarate exhilarated exhilarating exhilaration exhort exhortation exigency exigent exiguity exile exiles exist existence existences existent existential existing exists exit exits exitted exitter exitting exodus exogamic exogamous exogamy exonerate exonerated exoneration exorbitance exorbitant exorciser exorcism exorcist exotic exoticer exoticest exoticly exoticness exotropia expand expandable expanded expander expandible expanding expands expanse expansible expansile expansion expansive expansively expansiveness expansivity expat expatiate expatriate expatriation expect expectancy expectant expectation expectations expected expectedness expecter expecting expectorant expectorate expectoration expectorator expects expedience expediency expedient expedite expedition expeditiousness expel expelling expend expendable expended expender expending expenditure expends expense expenses expensive experience experienced experiences experient experiential experiment experimental experimentalism experimentation experimenter experiments expert expertise expertness experts expiate expiation expiative expiatory expiration expire expiry explain explained explainer explaining explains explanation explanations expletive explicate explication explicit explode exploded exploder explodes exploding exploit exploitation exploited exploiter exploiting exploits exploration explore explored explorer explores exploring explosion explosions explosive explosively expo exponent exponentiation export exportation exporting exports expos expose exposed exposer exposes exposing exposit exposition expostulation exposure exposures expound expounding express expressage expressed expresser expresses expressing expression expressionless expressions expressive expressway expressways expulsion expunction expunge expunging expurgate expurgation exquisite exquisitely exsanguine exsanguinous exsert exsiccate extemporaneous extemporary extempore extemporisation extemporise extemporization extemporize extend extended extender extending extends extension extensions extensive extent extents extenuate extenuation exterior exteriorisation exteriorise exteriorization exteriorize exterminate extermination external externalisation externalise externality externalization externalize externally extinct extinction extinguish extinguishing extirpate extirpation extol extolment extort extortion extortionate extra extract extracted extracter extracting extraction extractor extracts extracurricular extradite extraer extraest extraly extramarital extraneous extraness extraordinary extrapolate extrapolation extras extrasensory extraterrestrial extravagance extravagancy extravagant extravagantly extravasate extravasation extravert extraverted extravertive extreme extremely extremist extremity extremum extricate extrospective extrovert extroverted extrovertive extrusion exuberance exuberant exuberantly exuberate exudate exudation exude exult exultant exultation exulting exuviate eye eyeball eyebath eyebrow eyebrows eyecup eyed eyeful eyehole eyeing eyelash eyelashes eyeless eyelet eyelid eyelids eyepatch eyepiece eyer eyes eyeshade eyespot eyetooth eyrie eyry fab fable fabled fables fabric fabricate fabricated fabrication fabricator fabrics fabulous fabulously facade face faced faceds facelift facer faces facet facetiously facia facial facialer facialest facially facialness facile facilitate facilitated facilitater facilitates facilitating facilitation facilities facility facing facsimile fact faction facto factoid factor factored factorer factories factoring factors factory factos facts factual facula facultative faculties faculty fad fade faded fadeout fader fades fading fads faeces faerie faery fag fagged fagger fagging faggot fagot fahrenheit fahrenheits fail failed faileds failer failing fails failure failures faineant faint fainter faintest fainthearted faintly faintness faints fair fairer fairest fairground fairgrounds fairies fairish fairlies fairly fairness fairs fairway fairy fairyland fairytale faith faithful faithfulness faithless faithlessly faithlessness faiths fajita fajitas fake faked fakely fakeness faker fakes fakest faking falanga falcon falcons falderol fall fallacious fallacy fallal fallback fallen fallens faller fallible falling falloff fallout fallow falls false falsehood falsely falseness falser falses falsest falsifiable falsification falsify falsifying falsity falter faltered falterer faltering falteringly falters fame famed fames familial familiar familiarise familiarity familiarize families family famine famish famished famishment famous famouses famously fan fanatic fanatical fancied fancier fancies fanciful fancify fancy fancywork fandom fanfare fang fangs fanjet fanlight fanned fanner fanning fanny fans fantabulous fantan fantasies fantasise fantasize fantasm fantast fantastic fantastical fantastically fantasy far faraway farawayness farce farcical fare fares farewell farewells farinaceous farly farm farmed farmer farmers farmhouse farmhouses farming farmland farmplace farms farmstead farness farrago farrer farrest farrow farseeing farsighted farsightedness fart farther farthermost farthest farting fascia fascicle fascicule fasciculus fascinate fascinated fascinater fascinates fascinating fascination fashion fashionable fashioning fashions fast fastball fasted fasten fastened fastener fastening fastens faster fasters fastest fastidious fastidiously fasting fastly fastness fasts fat fatal fatalism fatality fataller fatallest fatally fatalness fatals fate fateful fates fathead fatheaded father fatherhood fatherland fatherless fathers fathom fathomable fatigue fatigued fatigues fatly fatness fats fatso fatten fatter fattest fatty fatuity fatuousness faucet faucets fault faultfinder faultfinding faulting faultless faultlessness faults faulty fauna faux favor favorable favorableness favored favorite favorites favoritism favors favour favourable favourableness favourite favouritism fawn fawned fawner fawning fawns fax faxed faxer faxes faxing fay faze fazed fazer fazes fazing fealty fear feared fearer fearful fearfully fearfulness fearing fearless fearlessness fears fearsome feasibility feasible feasibleness feast feasts feat feated feater feather featherbed featherbrained feathered feathering featherless featherlike featherweight feathery feating feats feature featured features feb febricity febrile febrility februaries february feces feckless fecklessly fecund fecundate fecundation fecundity fed fedded fedder fedding federal federalisation federalise federalist federalization federalize federate federated federation fedora feds fee feeble feebleminded feebleness feebly feed feedback feedbacks feeder feeding feeds feel feeler feeling feels fees feet feets feign feigning feijoa feisty felicitate felicitation felicitous felicitousness felicity fell fella fellate feller fellow fellows fellowship felon felonies felonious felony felt felts female females feminine femininity feminise feminism feminize femoris femtometer femtometre femur fen fence fences fencesitter fencing fencings fend fender fenders fenestella fenestral fenestration fenland fennel fens fenugreek feria fermata ferment fermentation fermenting fermi fern ferned fernlike ferns ferny ferocious ferociousness ferocity ferret ferrets ferries ferrule ferry ferryboat ferrying fertile fertilisation fertilise fertility fertilization fertilize fervency fervent fervid fervidness fervor fervour festal fester festering festinate festival festivals festive festivity festoon festoonery fetch fete fetich fetichism feticide fetid fetish fetishism fetlock fetor fetter feudatory fever feverish feverishness feverous fevers few fewer fewers fewest fewly fewness fey fiance fiancee fiancees fiances fiasco fiat fib fibbed fibber fibbing fiber fibers fibre fibril fibrillation fibrous fibs fickle fickleness fictile fiction fictional fictionalisation fictionalise fictionalization fictionalize fictions fictitious fictitiously fictive fiddle fiddlehead fiddler fiddling fidelity fidget fidgetiness fidgety fiducial fiduciary fiefdom field fielder fieldfare fielding fields fieldsman fiend fiendish fiendishly fierce fiercely fierceness fiercer fiercest fieriness fiery fiesta fifteen fifteens fifth fifths fifties fifty fig figged figger figging fight fighter fighters fighting fights figment figs figural figuration figurative figure figured figurehead figurer figures figurine figuring filago filament filamentlike filamentous filaree filaria filbert filch file filed filename filer files filet filial filiation filibuster filibusterer filicide filiform filing filings fill fille filled filler fillet fillets fillies filling fillip fills filly film filmdom filmmaker films filmy fils filter filtered filterer filtering filters filth filthiness filthy filtrate filtration filum fin finagle final finale finales finalise finality finalize finaller finallest finally finalness finals finance financed financer finances financial financing finch finches find finder finding finds fine fined finely fineness finer fines finespun finesse finger fingerboard fingerbreadth fingering fingermark fingernail fingerpost fingerprint fingers fingerstall finical finicky fining finis finish finished finisher finishes finishing finite fink finned finner finning finocchio fins fintech fiord fir fire firearm firearms fireball firebird firebomb firebrand firebreak firebug firecracker fired firedog firedrake firefighter firefighters fireflies firefly fireguard firehouse firehouses firelock fireman firenze fireplace fireplaces fireplug firer fires fireside firestone firestorm firetruck firetrucks firewall firewalls fireweed firework firing firkin firm firmament firmly firmness firms firmware firmwares firs first firstborn firster firstest firstly firstness firsts firth fiscal fiscaler fiscalest fiscally fiscalness fiscals fish fishbowl fished fisher fisherman fishermans fishes fishgig fishily fishing fishings fishworm fishy fissile fission fissionable fissiparity fissiparous fissure fist fisted fister fistfight fistful fisticuffs fisting fists fistula fistular fistulate fistulous fit fitch fitful fitly fitness fitnesses fits fitted fitter fittest fitting fittingly fittingness five fives fivesome fix fixate fixation fixative fixed fixedder fixeddest fixedly fixedness fixer fixes fixing fixings fixity fixture fizgig fizz fizzle fjord flabbergast flabbergasted flabby flaccid flack flag flagellant flagellate flagellation flagellum flageolet flagged flagger flagging flagitious flagpole flagrant flagroot flags flagship flagstaff flagstone flail flair flak flake flakey flakiness flaky flambeau flamboyant flamboyantly flame flamenco flames flaming flamingo flamingos flange flank flanker flannel flannels flap flapcake flapjack flapping flaps flare flared flash flashback flashbulb flashcard flashcards flasher flashes flashgun flashily flashiness flashing flashlight flashpoint flashy flask flaskful flasks flat flatbed flatboat flatcar flatfish flatfoot flatfooted flathead flatly flatness flats flatted flatten flattened flattener flattening flattens flatter flattest flatting flattop flatulence flatulency flatulent flatus flatware flaunt flavor flavorer flavoring flavorless flavorlessness flavour flavourer flavouring flavourless flavourlessness flaw flawed flawer flawing flawless flawlessness flaws flax flaxen flea fleabane fleas fleck flection fled fledge fledged fledgeless fledgeling fledgling fleds flee fleece fleeceable fleeces fleecy fleeing fleer flees fleet fleeter fleetest fleeting fleetly fleetness fleets fleming flemish flesh fleshes fleshiness fleshly fleshy flew flewed flewer flewing flews flex flexibility flexible flexibleness flexile flexion flexure flick flicked flicker flicking flicks flier flies flieses flight flightiness flights flighty flimflam flimsiness flimsy flinch flinders fling flinging flings flint flintlock flints flinty flip flipped flipper flipping flips flirt flirtation flirting flirts flit flitch flits flitted flitter flitting float floatation floater floating floats floaty flocculate flocculent flock flocks flog flogged flogger flogging flogs flood flooded flooder floodgate flooding floodlight floods floor floorboard flooring floors floorshow floozie floozy flop flora floral floras florence florescence florid florilegium florin florist floss flossy flotation flotilla flotsam flounce flounder flour flourish flourished flourisher flourishes flourishing flours flout flouter flow flowage flowed flower flowered flowering flowerpot flowery flowing flown flows flu flub fluctuate fluctuated fluctuater fluctuates fluctuating fluctuation flue fluency fluent fluff fluffier fluffiest fluffily fluffiness fluffy fluid fluidity fluidness fluidram fluids fluke flukey fluky flume flummery flummox flump flung flunk flunkey flunky fluorescent flurry flus flush flushed flusher flushes flushest flushly flushness fluster flustered flute flutes fluting flutter fluttering flutters flux fluxes fluxion fly flyaway flyblown flycatcher flyer flying flyinger flyingest flyingly flyingness flyings flyover flypast flyspeck flyweight foal foals foam foamed foamer foaming foams foamy fob focal focalisation focalise focalization focalize foci focis focus focused focuses focusing focussed focussing fodder foe foeman foes foetid foetor fog fogey fogged fogger fogginess fogging foggy foghorn fogs fogsignal fogy fogyish foible foil foiled foiler foiling foils foist folate fold folded folder folderal folderol folding folds foliaceous foliage foliaged foliate foliated foliation folic foliccer foliccest folicly folicness folie folio foliose folk folklore folks folksy follies follow followed follower following follows followup folly foment fomentation fomite fond fonda fonder fondest fondler fondling fondly fondness fondu fondue font fonts food foodie foods foodstuff fool fooled fooler foolery foolhardiness foolhardy fooling foolish foolishes foolishness foolproof fools foot footage football footballs footboard footed footer footfall footgear foothold footing footle footling footmark footnote footpath footprint footrace footrest foots footslog footslogger footstall footstep footstool footstools footsure footwear footwork fop for forage foraging foramen foray forbade forbear forbearance forbid forbiddance forbidden forbidding forbids force forced forceder forcedest forcedly forcedness forceds forceful forcefulness forcemeat forces forcible ford forded forder fording fords fore forebear forebode foreboding forecast forecasted forecaster forecasting forecasts foreclose foredate forefather forefend forefinger forefront foregather forego foregone foreground forehanded forehead foreheads foreign foreigner foreigners foreignness foreigns foreknow forelady foreland forelock foreman foremost forenoon forensic foreordain foreordination forepart foreplay forerunner fores foresee foreshadow foreshadowing foreshorten foresight foresighted foresightedness foresightful foresightfulness foreskin forest forestage forestall forester forests foreswear foretell foretelling forethought foretoken foretop forever forevermore forevers forewarn forewarning forewoman foreword forfeit forfeited forfeiture forfend forficate forgather forgave forgaves forge forged forger forgery forges forget forgetful forgetfulness forgets forgetting forging forgivable forgive forgiven forgiveness forgives forgiving forgo forgoing forgot forgotten fork forked forker forking forklift forks forlorn forlornness form formal formaler formalest formalise formalised formalism formalistic formalities formality formalize formalized formally formalness formals format formated formater formating formation formative formats formatting formed former formerly formers formic formica formidable forming formless formosan forms formula formulas formulate formulation fornication fornicatress fornix forrad forrader forrard forred forrer forring fors forsake forsaken forsaking forswear forswearing fort forte forth forthcoming forthright forthrightly forthrightness forths forthwith forties fortification fortified fortify fortnightly fortress forts fortuitous fortuity fortunate fortune fortunes forty forum forums forward forwarding forwardness forwards fossa fosse fossil fossilisation fossilise fossilization fossilize fossilology foster fosterage fostered fosterer fostering fosters fothergilla fought foul fouled fouler foulest fouling foully foulmart foulness fouls foumart found foundation foundations founder founders founding founds fount fountain fountainhead fountains four fourfold fours fourscore foursome foursquare fourteen fourth fourthly fourths fowl fowler fowls fox foxberry foxes foxglove foxily foxiness foxy foyer fracas fraction fractionate fractionation fractious fractiously fracture fractures fragile fragility fragment fragmentation fragmentise fragmentize fragrance fragrancy fragrant frail frailer frailest frailly frailness frailty fraise frame framer frames framework framing franchise franchises frangibility frangibleness frank franker frankest frankfort frankfurt frankfurter frankincense franklin frankly frankness franks frantic frap frappe frat fraternal fraternity fratricide fraud frauds fraudulence fraudulent fraught fray frazzle frazzled freak freakish freakishly freakishness freaky freckle free freebooter freed freedom freedoms freehand freehanded freehearted freehold freeing freelance freelancer freelances freelies freely freemason freemasonry freeness freer frees freest freestyle freestyles freethinking freeware freeway freeways freewheel freewheeling freeze freezer freezers freezes freezing freight freightage freighter french frenchify frenetic frenzied frenzy frequence frequencies frequency frequent frequenter frequently fresco fresh freshen fresher freshes freshest freshet freshly freshman freshmans freshness fret fretful fretfulness fretsaw fretted fretwork fri friar fricative friction friday fridays fried friend friendliness friendly friends friendship friendships frier fries frieze frigate fright frighten frightened frightener frightening frightens frightful frightfully frigid frigidity frigidness frijol frijole frill frilled frilly fringe fringed fringes fringy frippery frisbee frisbees frisk frisking frisky frisson fritillary fritter frivol frivolity frivolous frivolousness frizz frizzle frizzly frizzy frock frog frogman frogmarch frogs frolic frolicky frolicsome from froms front frontage frontal frontend fronter frontest frontier frontispiece frontlet frontline frontly frontmost frontness fronts frontward frontwards frost frostbite frostiness frosting frostings frosts frosty froth frothiness frothing frothy froward frown frowsty frowzled froze frozen frozener frozenest frozenly frozenness frozens frozes frs fructification fructify frugal fruit fruitcake fruitful fruitfulness fruition fruitless fruitlessly fruitlessness fruits fruity frumpish frumpy frustrate frustrated frustrater frustrates frustrating frustration fry fryer frying frypan fthm fuchsia fuck fuckhead fucking fuckup fucoid fuddle fuddled fudge fudges fuel fueled fueler fueling fuels fugacious fugaciousness fugacity fugitive fugue fuji fujinoyama fujiyama fulfil fulfill fulfilled fulfiller fulfilling fulfillment fulfills fulfilment fulgent fulgid fulgurant fulgurous full fullback fuller fullest fullies fullly fullness fulls fullstack fully fulminate fulmination fulsome fulsomeness fumble fumbler fumbling fume fumed fumer fumes fumigate fumigator fuming fun function functional functionalism functionary functioning functions fund fundament fundamental fundamentalism fundamentalist fundamentalistic fundamentally fundamentals funded funder funding fundings fundraise fundraiser funds fundses funereal funfair fungi fungus funicle funiculus funk funks funky funly funned funnel funner funness funnest funnier funnies funniest funnily funniness funning funny funs fur furbelow furbish furcate furies furious furiously furiousness furlough furnace furnish furnished furnisher furnishes furnishing furniture furnitures furor furore furred furrer furring furrow furrowed furs further furtherance furthermore furthermost furthers furthest furtive furuncle fury furze fusain fuscous fuse fused fusee fuser fuses fusillade fusing fusion fuss fussed fusser fusses fussiness fussing fussy fustian fusty futile futileness futiler futilest futily future futurely futureness futurer futurest futurism futurist futuristic futurity fuze fuzee fuzz fuzzed fuzziness fuzzy gab gabardine gabble gabby gaberdine gabfest gable gad gadfly gadget gaff gaffe gaffer gag gaga gage gagged gagger gagging gagman gags gagster gagwriter gaiety gain gained gainer gainful gainfulness gaining gainlessly gains gainsay gait gaited gaiter gaiting gaits gal gala galactic galangal galax galaxies galaxy gale gales galingale gall gallant gallantry galleries gallery galley gallfly gallic gallimaufry galling gallon gallop gallous gallus galore galosh gals galvanic galvanisation galvanise galvaniser galvanising galvanism galvanization galvanize galvanizer galvanizing gam gambit gamble gambled gambler gambles gambling gamboge gambol game gameboard gamecock gamelan games gamey gamin gamine gaminess gaming gamings gamma gammas gammon gams gamut gamy gand gang gangboard gangling gangly gangplank gangrene gangrenous gangs gangway ganja gantlet ganymede gaol gaolbreak gaoler gap gape gaped gaper gapes gaping gapped gapper gapping gaps gar garage garages garb garbage garbages garbanzo garbed garble garbled garboil garbs garden gardener gardens garfish gargantuan gargle gargoyle gari garibaldi garish garishness garland garlic garlics garment garmented garner garnish garnishee garotte garpike garret garrison garrote garroter garrotte garrotter garrulous garter gas gasbag gasconade gases gash gashed gasher gashes gashing gasify gasmask gasolene gasoline gasometer gasp gassed gasser gassing gassy gastronome gastronomy gat gate gated gatekeeper gater gates gateway gateways gather gathered gatherer gathering gathers gating gator gauche gaucheness gaucherie gaud gaudery gaudiness gaudy gauffer gauge gauges gaul gaunt gauntlet gauntness gauss gautama gauze gauzy gave gaved gaver gaves gaving gavotte gawk gawky gawp gay gayer gayest gayfeather gayly gayness gaze gazebo gazebos gazed gazelle gazer gazes gazetteer gazillion gazing gazump gear gearing gears gearshift gearstick geartrain gecko geek geese geezerhood gel gelatin gelatine gelatinise gelatinize geld gelid gelidity gels gelt gem geminate gemination gemini gemmation gemmed gems gemstone gender genderer genderest genderly genderness genders gene genealogy general generalcy generalisation generalise generality generalization generalize generally generals generalship generate generated generater generates generating generation generations generative generator generic generically generosities generosity generous generously generousness genes genesis genet genetic genetical genetics geneva geneve genf genial geniality genic genip genitalia genitals genitive genius genome genotype genre genres gens gent genteel gentianella gentile gentle gentleman gentlemans gentleness gentler gentles gentlest gentlewoman gently gentry genu genuflect genuine genuinely genuineness genuines genus geode geographic geographical geographics geographies geography geology geometric geometrical geometrically geometries geometry geomorphologic geomorphological geomorphology gerbil gerbille gerbils geriatric germ german germaner germanest germanic germanly germanness germinal germinate germination germs gerontological gestate gestation gesticulate gestural gesture gestures get geta getaway gets getting gettings getup gewgaw geyser ghastliness ghastly ghent gherkin ghetto ghillie ghost ghostlike ghostly ghosts ghostwrite ghostwriter ghoul ghoulish ghz giant gianter giantest giantism giantly giantness giants gib gibber gibberish gibbet gibbon gibbose gibbosity gibbous gibbousness gibe gibibyte gibingly gibson giddiness giddy gift gifted gifter gifting gifts gig gigabyte gigabytes gigacycle gigahertz gigantic gigantism gigs gigue gilbert gild gilded gill gillie gillyflower gilt gimcrack gimcrackery gimlet gimmick gimp gimpy gin ginep ginger gingerer gingerest gingerly gingerness gingerroot gingers gingersnap gingery gingiva ginmill ginned ginner ginning gins ginseng ginzo gipsy giraffe girafves girasol gird girded girder girding girdle girds girl girlfriend girlfriends girls giro girth gismo gist gists git github gittern give giveaway given givenly givenner givenness givennest givens giver gives giving gizmo glace glacial glaciate glaciation glacier glaciers glad gladded gladden gladdened gladder gladdest gladding glade gladiator gladiola gladiolus gladly gladness glads gladstone glamor glamorise glamorize glamorous glamour glamourise glamourize glamourous glance glanced glancer glances glancing gland glands glare glaring glary glass glassed glasses glassful glasshouse glassless glasswort glassy glaze glazed gleam gleaming gleams glean gleaner glee gleeful gleefulness glen glens glib glibber glibbest glibly glibness glide glider gliders glides gliding glimmer glimmering glimpse glimpses glint glinting glisten glistening glister glistering glitch glitches glitter glittering glittery glitz gloam gloaming gloat gloating glob global globaler globalest globalise globalize globally globalness globals globe globefish globes globetrotter globose globosity globular globularness glom gloom gloomful gloominess glooming glooms gloomy glop glorification glorify gloriole glorious gloriously glory gloss glossa glossaries glossary glosses glossiness glossy glove gloves glow glowed glower glowering glowing glows glucinium glucose glue glued gluer glues gluey glueyness gluiness gluing glum glumness glut glutinous glutton gluttonous gluttony glycine glycogenesis glycol glyptography gnarl gnarled gnarly gnat gnaw gnawed gnawer gnawing gnaws gnome gnostic gnu gnus goad goaded goading goal goalie goalies goalkeeper goalless goals goaltender goat goats gob gobble gobbler goblet goblin gobs goby god goddam goddamn goddamned godfather godfathers godforsaken godhead godless godlike godly godmother godmothers gods godsend goes goeses goffer goggle goggles goggleses going goiter goitre gold goldbrick goldbricking goldcup golden goldener goldenest goldeneye goldenly goldenness goldens goldfinch goldfish goldfishes golds goldsmith goldworker golem golf golfclub golfer golfers golfs golgotha goliath golosh golves gondola gone goner gones gong gonna gonnas gonorrhea gonorrhoea gonzo goo goober good goodby goodbye gooder goodest goodish goodly goodness goods goodwill goody gooey goof goofball goofproof goofy googol gook goon goop goos goose gooseberry goosefish gooselike goosey goosy gopher gore gorge gorgeous gorgeously gorger gorgerin gorges gorilla gorillas gormandise gormandize gorse gory gospel gospeler gospeller gospels gossamer gossip gossiper gossipmonger gossips gossipy got goth gothic gots gotta gotted gotten gotter gotting gouache gouge gouger goujon gourd gourmand gourmandize gourmandizer gourmet govern governance governed governer governing government governments governor governors governs gown gowns goy gpu grab grabbed grabber grabbing grabby grabs grace graceful gracefully graceless gracelessly gracelessness graces gracility gracious graciously graciousness grackle grad gradate gradation gradational gradatory grade graded grader grades gradient grading gradual graduality gradually gradualness graduate graduated graduates graduation graduations graffiti graffito graft grafting graham grail grain grains grainy gram grammar grammars grammatic grammatical gramme gramps grampus gran granadilla granary grand grandad grandchild grandchilds granddad granddaddy granddaughter granddaughters grander grandest grandeur grandfather grandfathers grandiloquence grandiloquent grandiose grandiosely grandiosity grandly grandma grandmas grandmother grandmothers grandness grandpa grandparent grandparents grandpas grands grandson grandsons grandstand granger granite granitelike granitic grannie granny granola granolas grant granted granteds grantee grants granular granulate granulation granulose grape grapefruit grapes grapeshot grapevine graph grapheme graphic graphical graphically graphics graphite grapnel grapple grappler grappling grasp graspable grasping grasps grass grasses grasshopper grasshoppers grassland grasslands grassroots grate grateful gratefully grater graticule gratification gratify gratifying grating gratitude gratuitous gratuity grave gravel gravelly gravels gravely graven graveness graver graverobber graves gravest gravestone graveyard gravid gravida gravies gravimeter gravitas gravitate gravitation gravity gravure gravy gray grayback graybeard grayer grayest grayish grayly grayness grays graze grazed grazer grazes grazing grease greaseball greaser greasier greasiest greasily greasiness greasy great greatcoat greater greatest greathearted greatlies greatly greatness greats greaves grecian greece greed greedily greediness greedy greek green greenback greenbrier greener greenery greenest greengrocery greenhorn greenhouse greenhouses greening greenish greenly greenness greens greensward greenweed greet greeting greets gregarious gregariously gremlin grenade grenadier grew grews grey greyback greybeard greyed greyhound greyish greyness grid griddle griddlecake gridiron gridlock grids grief griefs grievance grieve grieved griever grieves grieving grievous griffin griffon grifter grill grille grilled grilling grillroom grills grillwork grim grimace grime grimly grimmer grimmest grimness grims grimy grin grind grinder grinding grindle grinds grinned grinner grinning grins grip gripe grippe gripped gripper gripping grips grisly gristle gristly grit gritrock grits gritstone gritted gritter gritting gritty grizzle grizzlies grizzly groan groans groceries grocery grogginess groggy groin grok grommet groom grooming grooms groove groovy grope groped groper gropes groping gross grosser grosses grossest grossly grossness grotesque grotesquely grouch grouchy ground groundberry groundbreaker groundbreaking groundhog groundhogs grounding groundless groundnut grounds groundwork group grouper grouping groups grouse grove grovel groveling grovelling groves grow grower growing growings growl growler growling grown growner grownest grownly grownness growns grownup grownups grows growth growths groyne grub grubby grubs grudge grudging grueling gruelling gruesome gruesomeness gruff gruffness grumble grumbler grumbling grume grummet grumose grumous grump grumpiness grumpy grundyism grunge grungy grunt grunted grunter grunting gruntle grunts grus gryphon guacamole guacamoles guaiac guaiacum guanabana guangzhou guarani guarantee guarantees guarantor guaranty guard guarded guardedly guardian guardians guardianship guardrail guardrails guardroom guards guava gubbins guck gudgeon guerilla guernsey guerrilla guess guesses guessing guesswork guest guests guff guggle guidance guidances guide guidebook guideline guidepost guides guideword guiding guild guilder guilds guile guileful guileless guillotine guilt guiltier guilties guiltiest guiltily guiltiness guiltless guilts guilty guimpe guinea guineas guise guises guitar guitarist guitars gula gulch gulden gulf gulfs gull gullet gullible gulls gulp gulper gulping gulves gum gumbo gummed gummer gummier gummiest gummily gumminess gumming gummosis gummy gumption gumptious gums gumses gumshield gumshoe gumweed gumwood gun gunk gunman gunned gunnel gunner gunning gunpoint gunpowder guns gunslinger gunstock gunwale gurgle guru gush gushed gusher gushes gushing gushy gusset gust gustation gusto gusts gusty gut gutless guts gutsiness gutsy gutted gutter gutting guttle guttural guy guyed guyer guying guys guzzler guzzling gybe gym gymnasium gymnasiums gymnast gymnastic gymnastics gymnasticses gymnasts gyms gynandromorph gypsies gypsy gyrate gyration gyre gyro gyroscope gyrus habanera haberdashery habiliment habilimented habilitate habit habitant habitat habitation habitats habits habitual habituate habituation habitue habitus hacek hachure hacienda hack hackberry hacked hacker hacking hackle hackles hackney hackneyed hacks had hadded hadder hadding haddock hades hadith hadji hadnt hads haecceity haematocrit hag haggard haggle haggling hagridden hail hailed hailer hailing hails hair haircare haircloth haircut hairdo hairdresser hairdressing haired hairgrip hairier hairiest hairily hairiness hairlessness hairlike hairline hairpiece hairs hairsbreadth hairsplitting hairstyle hairstylist hairy haji hajji hake hakeem hakim halal halcyon hale haler half halfback halfer halfest halfhearted halfly halfness halfs halftime halftimes halftone halfway halfways halibut halitus hall hallmark halloo hallow hallowed halls hallucinating hallucination hallway hallways halo halt halted halter haltere halting halts halves ham hamadryad hamburger hamburgers hamlet hammed hammer hammerhead hammering hamming hammock hamper hams hamster hamsters hamstring hand handbag handbags handball handballs handbasin handbasket handbill handbuild handcart handclasp handcraft handcuff handed handedness hander handful handgrip handgun handicap handicapped handicraft handier handiest handily handiness handing handiwork handle handlebar handlebars handled handler handlers handles handless handling handlock handmaid handmaiden handout handouts handrail hands handshake handshaking handsome handsomely handwheel handwork handwriting handy hang hangar hangars hangbird hangdog hanger hangers hanging hangings hangout hangover hangs hanker hankering hanuman haoma hap haphazard haphazardly haphazardness hapless happen happened happener happening happens happenstance happier happies happiest happily happiness happy haptic harangue harass harassed harasser harasses harassing harassment harbinger harbor harbored harborer harboring harbors harbour harbours hard hardball hardcore harden hardened hardening harder hardest hardheaded hardhearted hardihood hardiness hardly hardness hardpan hardship hardtack hardware hardwareman hardwares hardwood hardwoods hardworking hardy hare harebell harebrained hares haricot harijan hark harken harlequinade harlot harm harmful harmfulness harmfuls harmless harmonic harmonica harmonical harmonies harmonious harmoniousness harmonisation harmonise harmonised harmoniser harmonium harmonization harmonize harmonized harmonizer harmony harms harness harp harps harpy harrier harrow harrowed harry harsh harsher harshes harshest harshly harshness hart harvest harvester harvesting harvests has haschisch hases hash hasheesh hashish hashtag hashtags hasnt hassed hasser hassing hassle hassock haste hasten hastier hastiest hastily hastiness hastings hasty hat hatch hatchback hatched hatchel hatchet hatching hatchling hatchway hate hated hateful hater hates hatful hating hatmaker hatred hatreds hats hatted hatter hatting haughtiness haughty haul haulage hauled hauler hauling hauls haunch haunt haunted haunting haunts hausen hautbois hautboy hauteur have haven havens havent haversack haves having havoc hawaii hawk hawked hawker hawking hawkish hawks hawkshaw hawkweed hay hayfield haying hayloft haymaker haymaking haymow hayrack hayrick hayrig hays hayseed haystack haywire hazan hazard hazardous hazards haze hazed hazel hazeller hazellest hazelly hazelness hazelnut hazer hazes hazily haziness hazing hazy head headache headaches headband headbands headboard headboards headcounter headdress headed header headfirst headfish headful headgear headhunter heading headings headlamp headland headless headlight headlights headline headliner headliners headlines headlong headman headmaster headphone headphones headpiece headpin headquarter headquarters headquarterses headrest headroom heads headset headsets headship headshot headsman headspring headstall headstone headstrong headwaiter headway headword heady heal healed healer healing healings heals health healthful healthies healths healthy heap heaped heaper heaping heaps hear hearable heard hearer hearing hearings hearken hears heart heartache heartbeat heartbreak heartbreaker heartbreaking heartbreaks heartbroken hearten heartfelt heartfelts hearth hearths heartier heartiest heartily heartiness heartless heartrending hearts heartsease heartsick hearty heat heated heater heath heathen heathenish heather heathland heating heats heave heaved heaven heavenly heavens heaver heaves heavier heavies heaviest heavilies heavily heaviness heaving heavy heavyhearted heavyset heavyweight hebdomad hebdomadal hebdomadally hebdomadary heckle hectic hector hed hedge hedgehog hedgehogs hedger hedgerow hedges hedging hedonic hedonism hedonist hedonistic heed heeded heeder heedful heeding heedless heedlessly heedlessness heeds heel heeled heeler heeling heels heft heftiness hefty hegira height heighten heights heinous heinously heinousness heir heirloom heist hejira held helianthus helical helicon helicopter helicopters heliogravure heliopsis heliotherapy helium helix hell hellcat hellebore helleborine hellene hellenic heller helleri hellgrammiate hellhole hellhound hellion hellish hello hellos hells helm helmet helmetflower helmets help helped helper helpful helpfulness helpfuls helping helpless helplessness helps hem hematocrit hemicrania hemipteran hemipteron hemisphere hemline hemlock hemorrhage hemp hempen hems hemstitch hemstitching hen hence hences henchman hencoop henhouse henpecked henry hens hep hepatica hepatitis hepatitises heptad her hera heracles herakles herald heraldic heraldist heraldry herb herbage herbs herculean hercules herd herded herder herding herds here hereafter hereditary heredity hereford hereinafter heres heresy heretic heretical heretofore hereunder heritage heritor hermaphrodism hermaphrodite hermaphroditic hermaphroditism hermit hermitic hermitical hero heroic heroical heroine heroines heroism heron herons heros herpes herring herringbone hers herself herselfs herselves hertz hes hesitance hesitancy hesitant hesitate hesitated hesitater hesitates hesitating hesitation hesperian hesperus hessian heterocycle heterocyclic heterodox heterodoxy heterogeneous heterogenous heteroicous heterologic heterological heterologous heterosexual heterosexualism heterosexuality heterotaxy hew hews hex hexad hexadecimal hexed hexer hexes hexing hey heyday hiatus hibernate hibernation hick hickey hickory hid hidded hidden hiddener hiddenest hiddenly hiddenness hiddens hidder hidding hide hideaway hideous hideously hideout hides hiding hidrosis hids hie hierarch hierarchy hieratic hieratical hieroglyph hieroglyphic hieroglyphical hifalutin higgle high higher highest highfalutin highfaluting highjack highjacker highlander highlies highlife highlight highlighted highlighter highlighting highlights highly highness highs highschool highway highwayman highways hijab hijack hijacker hike hiked hiker hikes hiking hilarious hilarity hill hillbilly hillock hills hilltop hilly hilt hilts hilum hilus him himmed himmer himming hims himself himselfs himselves hind hinder hinderance hindquarters hindrance hinge hinges hint hinted hinter hinting hints hip hipline hipped hippo hippocampus hippopotamus hippopotamuses hippos hips hire hired hireling hirer hires hiring hirsute hirudinean his hiss hissed hisser hisses hissing historic historical historically historicalness historied histories historiography history histrion histrionic histrionics hit hitch hitched hitcher hitches hitchhike hitching hither hitherto hitless hitman hits hitter hitting hive hived hiver hives hiving hoagie hoagy hoar hoard hoarding hoarfrost hoariness hoarse hoarseness hoary hoax hoaxer hob hobbed hobber hobbies hobbing hobble hobby hobbyhorse hobgoblin hobo hobs hock hockey hockeys hodgepodge hog hogan hogback hogfish hogg hogged hogger hogget hogging hoggish hoggishness hogs hogshead hogwash hoist hoka hokan hokey hokum hold holdall holder holders holding holdings holdout holdover holds holdup hole holed holer holes holey holibut holiday holidaymaker holidays holier holiest holily holiness holing holistic holla hollands holler hollering hollo holloa hollow hollower hollowest hollowly hollowness holly hollyhock holmium holocaust holocene hologram holograph holographic holographical holster holy homage hombre homburg home homeboy homecoming homed homeland homelands homeless homelike homeliness homely homepage homepages homer homerun homes homesick homespun homestead homesteader homestretch homework homeworks homey homiletic homiletical homiletics homing hommos homo homochromatic homoeroticism homogeneity homogeneousness homogenise homogenised homogenize homogenized homologise homologize homologous homophile homophonic homophony homosexual homosexualism homosexuality homunculus homy honcho hone honed honer hones honest honester honestest honestly honestness honests honesty honey honeycomb honeycreeper honeydew honeyed honeymoon honeys honeysuckle honied honing honk honked honker honking honks honkytonk honor honorable honorably honored honoring honors honour honourable honourably hood hoodie hoodies hoodlum hoodmold hoodmould hoodoo hoodooism hoods hoodwink hooey hoof hook hooked hooker hooking hooks hookup hookworm hooligan hoop hoopla hoops hoopskirt hoot hooter hoover hop hope hoped hopeful hopefully hopefulness hopeless hopelessly hoper hopes hoping hopings hopped hopper hopping hopple hops horde hordeolum horehound horizon horizons hormone hormones horn hornet hornets hornlike hornpipe hornpout horns hornswoggle hornwort horny horologe horoscope horrendous horrible horribly horrid horridly horrific horrified horrify horrifying horripilate horror horrors horse horseback horsebean horsefish horsefly horsehair horsehead horseman horsemint horsepower horseradish horses horseshit horseshoe horseweed hose hosepipe hoses hosiery hospice hospitable hospital hospitalisation hospitality hospitalization hospitals host hostage hosted hostel hosteller hostelry hostels hoster hostess hostesses hostile hostilities hostility hosting hostings hostler hosts hot hotbed hotcake hotchpotch hotdog hotel hotelier hotelkeeper hotelman hotels hotfix hotfoot hothead hotheaded hothouse hotly hotness hotshot hotspot hotspots hotspur hotter hottest houhere hoummos hound hounds hour houri hours house housebreaker houseclean housecleaning housecoat household households housekeeper housemaid houseman houses housewrecker housing housings hovel hover how howd howdy howe however howevers howitzer howl howled howler howling howls hows hoy hoyden hoyle html hua hub hubbub hubby hubs huckleberry huckster huddle huddler hue hues huff huffed huffer huffing huffish huffishness huffs huffy hug huge hugely hugeness huger hugest hugged hugger hugging hugs huitre hulk hull hullabaloo hullo hulls hum human humane humanism humanist humanistic humanitarian humanitarianism humanity humankind humanly humanner humanness humannest humans humble humblebee humbled humbleness humbler humblest humbling humbly humbug humdrum humid humidder humiddest humidity humidly humidness humiliate humiliated humiliating humiliation humility hummed hummer humming hummingbird hummingbirds hummock hummus hummuses humor humoring humorous humorousness humors humour humourous humous hump humpback humpbacked humped humps hums humus hunch hunchback hunchbacked hunched hundred hundreds hundredth hundredweight hung hungarian hunger hungers hungrier hungriest hungrily hungriness hungry hungs hunk hunker hunt hunted hunter hunters hunting huntings hunts huntsman hurdle hurdles hurl hurled hurler hurling hurls hurricane hurricanes hurried hurriedness hurries hurry hurrying hurt hurter hurtest hurtful hurting hurtle hurtly hurtness hurts husband husbandly husbandman husbandry husbands hush hushed husher hushes hushing husk huskiness husking husky hussy hustle hustler hut hutch huts hyacinth hyaena hybrid hybridisation hybridise hybridization hybridize hybridizing hydra hydrant hydrargyrum hydrate hydraulic hydrocortisone hydrocortone hydrofoil hydrogen hydrometer hydrophobia hydrophobic hydroplane hydroxide hydroxybenzene hyena hyenas hygiene hygienics hygienise hygienize hymen hymn hymns hype hyper hyperactive hyperbole hyperbolic hyperbolise hyperbolize hyperlink hypermetropia hypermetropy hypernym hyperopia hypersensitised hypersensitive hypersensitivity hypersensitized hypertonia hypertonic hypertonicity hypertonus hypertrophied hyperventilate hyphen hyphenation hypnagogic hypnogogic hypnotic hypnotise hypnotised hypnotism hypnotize hypnotized hypo hypocrisy hypocrite hypodermic hyponym hyponymy hypostasis hypostatisation hypostatization hypothecate hypotheses hypothesis hypothesise hypothesize hypothetic hypothetical hypotonia hypotonic hypotonicity hypotonus hypsography hypsometry hyrax hyssop hysteria hysteric hysterical ibis ice iceberg icebergs iceboat icebox icebreaker iced iceman icer ices ichor icicle icicles icier iciest icily iciness icing icky icon iconoclast iconoclastic icons icteric icterus ictus icy idaho idea ideal idealer idealest idealisation idealise idealism idealist idealistic idealization idealize ideally idealness ideals ideas ideate ideational identical identicalness identification identified identifies identify identifyer identifying identities identity ideologic ideological ideology idiom idiosyncrasy idiot idiotic idle idleness idler idlest idly idol idolater idolatrous idolisation idolise idoliser idolization idolize idolizer idols idyl idyll idyllic iffy igloo iglu igneous ignite igniter ignition ignitor ignoble ignominious ignominiously ignominy ignorant ignorantness ignore ignored ignorer ignores ignoring iguana iguanas iii ikon ilion ilium ilk ill illative illegal illegalise illegalize illegally illegals illegitimacy illegitimate illegitimately iller illest illiberal illiberally illicit illicitly illimitable illiteracy illiterate illly illness illogic illogical illogicality illogicalness ills illume illuminance illuminate illuminated illuminating illumination illumine illusion illusionist illust illustrate illustrated illustrater illustrates illustrating illustration illustrations illustrative illustrious illusts image imageries imagery images imaginary imagination imaginations imaginative imaginativeness imagine imagined imaginer imagines imaging imagining imago imam imams imaum imbalance imbalanced imbecile imbecilic imbecility imbed imbibe imbiber imbibing imbibition imbricate imbricated imbroglio imbrue imbue imitate imitation imitative imitator immaculate immanent immaterial immateriality immature immeasurable immeasurably immediacy immediate immediately immediateness immense immensurable immerse immersed immerser immerses immersing immersion immersive immigrant immigrants immigrate immigration immigrations imminent immingle immix immobile immobilisation immobilise immobility immobilization immobilize immobilizing immoderately immodest immodesty immoral immorality immortal immortalise immortality immortalize immovable immoveable immune immunely immuneness immuner immunest immunise immunities immunity immunize immure immurement immutability immutable immutableness imp impact impacted impacter impacting impaction impacts impair impaired impairment impala impale impalpable impanel impart impartation impartial imparting impasse impassioned impassive impassiveness impassivity impatience impatient impeach impeaches impeccability impeccable impeccant impecunious impecuniousness impedance impede impediment impedimenta impel impelled impendent impending impenetrability impenetrable impenetrableness impenitent imperative imperativeness imperfect imperfectly imperial imperialism imperil imperious imperishable imperium impermanent impermissible impersonal impersonally impersonate impersonation impersonator impertinence impertinent imperturbable imperviousness impetuous impetus impinge impingement impinging impious impish impishness implant implantation implanted implausibly implement implemental implementation implementations implemented implementer implementing implements implicate implication implications implicative implicit implicitly implied implieds implies implike implore implored implorer implores imploring implosion imply import importance important importantly importation imported importee importer importing imports importune importunity impose imposed imposer imposes imposing imposition impossibility impossible impossibleness impost imposter impostor imposture impotence impotency impotent impound impounding impoundment impoverish impoverished impoverishment impractical imprecate imprecation impregnability impregnable impregnate impregnation impresario impress impressed impresses impressible impression impressionable impressionist impressionistic impressions impressive impressiveness impressment imprimatur imprint imprison imprisoned imprisonment improbable improbably impromptu improper improperness impropriety improve improved improvement improvements improver improves improvidence improvident improving improvisation improvise improvize imprudent imps impudence impudent impuissance impulse impulsion impulsive impure impureness impurity imputable imputation impute inability inaccessible inaction inactivate inactivation inactive inactiveness inactivity inadequacy inadequate inadequateness inadvertence inadvertency inadvertent inadvisable inalienable inalterable inanimate inanimateness inanition inanity inapplicable inappropriate inappropriateness inapt inarticulately inattentive inattentiveness inaugural inaugurate inauguration inauspicious inauthentic inborn inbound inbox inboxes inbred inbuilt incalculable incandesce incandescence incandescent incantation incapability incapable incapableness incapacitate incapacitated incapacitating incapacity incarcerate incarceration incarnate incarnation incased incautious incautiously incendiary incense incensed incentive inception incertain incertitude incessant incessantly incestuous inch inches incidence incident incidental incidentally incidents incinerate incised incision incisive incisively incitation incite incitement inciter incitive inclemency inclement inclementness inclination incline inclined inclining inclinometer inclose inclosure include included includer includes including inclusion inclusive incoherence incoherency incoherent income incomes incoming incommensurable incommode incommodiousness incommutable incompatibility incompatible incompetence incompetency incompetent incomplete incomprehensible incomputable inconceivable inconsequence inconsequent inconsequential inconsiderate inconsiderateness inconsideration inconsistency inconsistent inconsolable inconspicuous inconstancy incontestable incontestible incontinence incontinency incontrovertibility incontrovertible incontrovertibleness inconvenience inconvenient inconvertible incorporate incorporated incorporater incorporates incorporating incorporation incorporeal incorporeality incorrect incorrectly incorrectness incorrigible incorrupt incorrupted increase increased increases increasing increasingly incredible incredibly incredulity increment incremental incriminate incrimination incrust incrustation incubate incubation incubus inculcate inculpable inculpate inculpation incumbency incumbent incumbrance incur incurability incurable incurableness incurably incursion incursive incurvate incurvation incurvature incurved incus indebted indebtedness indecency indecent indecipherable indecision indecisive indecisively indecisiveness indecorous indecorousness indecorum indeed indeeds indefatigable indefensible indefinable indefinite indelible indelicacy indelicate indemnification indemnify indemnity indent indentation indention indenture independence independences independency independent independently indescribable indestructible indeterminable indeterminate index indexes indiana indicant indicate indicated indicater indicates indicating indication indications indicative indicator indicatory indict indictment indicts indie indies indifference indifferent indigen indigence indigene indigenous indigent indignant indignation indigo indigoer indigoest indigoly indigoness indigotin indirect indirection indiscernible indiscreetness indiscretion indiscriminate indiscriminately indispensability indispensable indispensableness indispose indisposed indisposition indisputable indissoluble indistinctly indistinctness indistinguishability indistinguishable indite indium individual individualisation individualise individualised individualism individualist individualistic individuality individualization individualize individualized individually individuals individuate individuation indocile indolent indoor indoorer indoorest indoorly indoorness indoors indorse indorsement indorser induce inducement inducer inducing inducive induct inductance inductee induction inductive inductor indue indulge indulgence indulgent indulging indurate industrial industrialise industrialize industries industrious industriousness industry indweller inebriant inebriate inebriated inebriation inebriety ineffable ineffective ineffectual inefficient ineligible ineloquently ineluctably inept ineptitude ineptly ineptness inequitable inert inertia inescapably inessential inestimable inevitable inevitably inexcusable inexcusably inexhaustible inexorable inexpedient inexpensive inexpensively inexpert inexpertly inexplicable inexplicably inexplicit inexpugnable infamous infamy infancy infant infanticide infantile infantilism infantry infantryman infants infatuate infatuated infatuation infect infected infection infections infectious infective infelicitous infer inferential inferior inferiority infernal inferno infertile infertility infest infestation infidel infield infiltrate infiltration infiltrator infinite infinitely infiniteness infinitesimal infinitude infinity infirm infirmary infirmity infix inflame inflamed inflaming inflammation inflammatory inflate inflated inflation inflations inflect inflected inflection inflexibility inflexible inflexibleness inflexion inflict infliction inflorescence influence influenced influencer influences influencing influenza influenzas info infolding inform informal informality informally informant information informations informative informatory informed informer informing informs infos infotainment infra infract infraction infractions infrangible infrared infrastructure infrequency infrigidation infringe infringement infuriate infuriated infuriating infuse infusion ingathering ingeminate ingenious ingeniousness ingenue ingenuity ingenuous ingenuously ingenuousness ingest ingestion inglorious ingloriously ingraft ingrain ingrained ingratiating ingratiation ingratiatory ingredient ingress ingroup inguen ingurgitate inhabit inhabitancy inhabitant inhabitation inhabited inhabiter inhabiting inhabits inhalant inhalation inhalator inhale inhaler inharmonic inharmonious inherent inherit inheritance inherited inheriter inheriting inheritor inherits inhibit inhibited inhibition inhospitable inhospitableness inhuman inhumaneness inhumanity inhumation inhume inimical iniquitous iniquity initial initialise initialism initialize initially initials initiate initiation initiative initiator initiatory inject injectant injected injecter injecting injection injections injects injudiciousness injunction injure injured injurer injures injuries injuring injurious injuriousness injury injustice ink inked inker inkiness inking inkjet inkling inkpad inks inkstand inkwell inland inlands inlay inlet inlets inmarriage inmate inmates inmost inn innate inner innerly innermost innerness innerrer innerrest inners innervate innervation inning innings innkeeper innocence innocent innocently innocuous innovate innovated innovater innovates innovating innovation innovational innovative innovator inns innuendo innumerable innumerous inoculate inoculation inoffensive inoperable inopportuneness inordinate inordinateness inorganic inosculate inpatient input inputs inquietude inquire inquired inquirer inquires inquiries inquiring inquiry inquisition inquisitive inquisitively inquisitiveness inquisitor inquisitorial inroad insalubrious insane insanely insaneness insanitary insatiable insatiably insatiate inscribe inscribed inscription inscrutable insect insectivore insects insecure insecurely insecurity inseminate insemination insensate insensibility insensible insensitive insentient insert insertion inserts insessores inset inshore inside insides insidious insidiously insidiousness insight insightful insightfulness insights insignificant insignificantly insinuate insinuating insinuation insipid insipidity insipidness insist insistence insistency insistent insisting insists insobriety insolate insolation insolence insolent insolubility insoluble insolvable insolvent insomnia insomniac insomnias insouciance insouciant inspect inspected inspecter inspecting inspection inspector inspectors inspects inspiration inspire inspired inspirer inspires inspiring inspirit inspissate inspissation inst instability instal install installation installed installer installing installment installs instalment instance instances instancy instant instantaneous instantaneously instantaneousness instantiate instantly instants instauration instead instep instigant instigate instigation instigative instigator instil instill instillation instillment instilment instinct instinctive institute institution institutional institutionalise institutionalised institutionalize institutionalized institutions instruct instruction instructions instructive instructor instructors instrument instrumental instrumentalist instrumentality instrumentate instrumentation instruments insubordinate insubordination insubstantial insubstantiality insufferable insufferably insufficiency insufficient insufflate insufflation insulant insular insularism insularity insulate insulation insulin insult insulted insulting insultingly insuperable insupportable insurance insurances insure insured insurer insures insurgent insuring insurmountable insurrection insurrectionist intact intacter intactest intactly intactness intacts intaglio intake intakes intangible integral integrality integrate integrated integrater integrates integrating integration integrative integrities integrity intellect intellection intellectual intelligence intelligences intelligent intelligible intemperance intemperate intemperately intemperateness intend intended intender intending intends intense intensely intenses intensification intensifier intensify intension intensity intensive intensiveness intent intenter intentest intention intentional intentionally intentions intently intentness inter interact interacted interacter interacting interaction interactional interactive interacts interahamwe interbreed interbreeding intercalation intercede intercept interception interceptions intercession intercessor interchange interchangeable intercommunicate interconnect interconnected interconnectedness interconnection intercourse intercrossed interdependence interdependency interdict interdiction interest interested interesting interestingness interests interface interfaces interfere interfered interference interferer interferes interfering interim interims interior interject interjection interlace interlaced interlacing interlanguage interlard interleave interlink interlinking interlock interlocking interlocutor interlude intermarriage intermediary intermediate intermediation intermediator interment intermeshed intermezzo interminable interminably intermingle intermission intermit intermittent intermix intermixture intern internal internalisation internality internalization international internationalise internationalism internationalist internationalistic internationality internationalize interne internecine internet internets internment interns interpellation interpenetrate interpenetration interpolate interpolation interpose interposition interpret interpretation interpreted interpreter interpreting interprets interracial interrelate interrelated interrogate interrogation interrogative interrogatively interrogator interrogatory interrupt interrupted interrupter interrupting interruption interrupts inters intersection intersections intersex intersexual intersperse interstate interstates interstice intertwine interval intervals intervene intervention interview interviews interweave interwoven intestinal intestine intestines intimacy intimate intimately intimation intimidate intimidation into intolerance intolerant intolerantly intonate intonation intone intoned intos intoxicant intoxicate intoxicated intoxicating intoxication intragroup intranet intransigent intrench intrepid intricacy intricate intrigue intriguing intrinsic intrinsical intro introduce introduced introducer introduces introducing introduction introductions introductory introjection intromission intromit intropin introversion introvert intrude intrusion intrusive intrust intuition intuitive intumesce intumescence intumescency intumescent intussusception inunct inunction inundate inundation inure inured invade invaded invader invades invading invaginate invagination invalid invalidate invalidating invalidation invalidator invalids invaluableness invariability invariable invariableness invariably invariance invariant invasion invasive invective inveigh inveigle invent invented inventer inventing invention inventive inventiveness inventor inventories inventory inventorying invents inverse inversely inversion invert invertebrate inverted invest invested invester investigate investigated investigater investigates investigating investigation investigations investigator investigators investing investiture investment investments investor investors invests inveterate invidia invidious invigorate invigorated invigoration invincible inviolable inviolate invisible invitation invitations invite invited invitee inviter invites inviting invocation invoice invoices invoke invoked invoker invokes invoking involuntary involute involution involve involved involvement involver involves involving invulnerability inward inwardly inwardness inwards iodin iodine iodise iodize iodoform ion ioned ioner ionic ioning ionisation ionise ionization ionize ions iota ira irascibility irascible irate ire ireful ires iridescent iridic iris irises irish irisher irishest irishly irishness irk irked irker irking irks irksome iron ironclad ironic ironical ironically ironing ironmonger ironned ironner ironning irons ironware ironwood irony irradiate irradiation irrational irreality irreclaimable irredeemable irrefutable irregular irregularity irregularly irrelevant irrepressibility irrepressible irreproachable irresistible irresoluteness irresolution irreverence irreverent irreverently irrevocable irrevokable irrigate irrigation irritability irritable irritably irritant irritate irritated irritater irritates irritating irritation irrupt irruption ishmael islamic island islands isle isles islet ism isnt isobilateral isolate isolated isolater isolates isolating isolation isomerise isomerize isometric isometrical isometry isosmotic isotonic isotope isotropy issuance issue issues issuing isthmus italian italians italic itch itched itcher itches itchiness itching itchy item itemise itemize items iterate iteration itinerant itinerary itll its itself itselfs itselves itve ive ivies ivories ivory ivy jab jabbed jabber jabberer jabbing jabiru jaboncillo jaboticaba jabs jacinth jack jackal jackals jackanapes jackass jackboot jacked jacker jacket jackets jackfruit jacking jackknife jackpot jackpots jackrabbit jacks jacksnipe jackstones jacquard jactation jactitate jactitation jade jaded jades jadestone jag jagannath jagannatha jagganath jagged jaggedly jagger jagging jaggy jags jaguar jaguars jail jailbreak jailed jailer jailhouse jailing jailor jails jak jake jakes jalapeno jalopy jalousie jam jamb jamberry jambon jamboree jambs james jammed jammer jammies jamming jampack jams jan jangle janissary janitor janitors januaries january japan jape japery japonica jar jarful jargon jargoon jarred jarrer jarring jars jaundice jaundiced jaunt jauntiness jaunty java javelin jaw jawbone jawbreaker jawline jawlines jaws jay jays jazz jazzes jazzy jealous jealously jealousy jean jeans jeer jeerer jeering jeeringly jeers jehovah jejune jejuneness jejunity jell jellies jellify jells jelly jellyfish jellyfishes jemmy jennet jenny jeopardise jeopardize jeopardy jerk jerkily jerking jerks jerkwater jerky jeroboam jersey jerseys jest jested jester jesting jestingly jests jesus jet jets jetsam jettison jetty jewel jeweled jeweler jewelled jeweller jewellery jewelries jewelry jewels jewelweed jewfish jezebel jib jibe jicama jiffy jig jigged jigger jigging jiggle jigs jigsaw jillion jilt jilted jilter jilting jilts jimdandy jimhickey jimmies jimmy jingle jingles jingo jingoism jingoist jingoistic jinx jinxes jitney jitter jitteriness jittery jive jnr job jobber jobless jobs jock jockey jockstrap jocoseness jocosity jocularity jocund jocundity joey joeys jog jogged jogger jogging joggle jogs john johnny johnson join joined joiner joinery joining joins joint jointer jointest jointlies jointly jointness joints jointure jointworm joke joked joker jokers jokes jokester joking jokingly jollier jolliest jollification jollify jollily jolliness jollity jolly jolt jolted jolter jolting jolts jolty jonah jones jongleur jonquil jook jordan joseph josh jostle jostling jot jots jotted jotter jotting joule jounce journal journalism journalist journalists journals journey journeyer journeying journeyman journeys joust jove jovial joviality jowl joy joyed joyer joyful joyfulness joying joyousness joyride joys joystick joysticks jubilance jubilancy jubilant jubilate jubilation judas jude judge judged judgement judger judges judgeship judging judgment judgmental judgments judicatory judicature judicial judicially judicials judiciary judicious judiciousness judo judos jug jugful jugged jugger juggernaut jugging juggle jugglery juggling jugs jugular juice juiceless juicer juices juicy juju jujube juke julienne julies july jumbal jumble jumbled jumbo jumboer jumboest jumboly jumboness jump jumped jumper jumpiness jumping jumps jumpstart jumpsuit jumpsuits jumpy junco junction junctions juncture june juneberry junes jungle jungles junior juniorer juniorest juniorly juniorness juniors juniper junk junket junketeer junkie junky junkyard junkyards junoesque junto jupiter juridic juridical juries jurisdiction jurisdictions jurisprudence jurist jury just juster justest justice justices justiciar justiciary justification justificative justificatory justified justifies justify justifyer justifying justly justness justs jut jute juts jutted jutter jutting juvenile juveniles juvenility juxtapose juxtaposition kabala kabbala kabbalah kabbalism kabbalist kabbalistic kachina kaffir kafir kaftan kail kaki kale kaleidoscope kales kali kamikaze kanaf kangaroo kangaroos kapok karakul karaoke karaokes karat karate karyon kashmir kat katabolic katabolism katharsis katzenjammer kauri kaury kayak kayaking kayaks kayo keel keen keener keenest keenly keenness keens keep keeper keeping keeps keepsake keg kegful kegs kegses keister kelly kelp kelpie kelps kelpwort kelpy kelvin kempt ken kenaf kennel kent kept keratinise keratinize kerb kerfuffle kern kernel kestrel ketchup ketchups kettle kettledrum kettleful kettles key keyboard keyboards keychain keyed keyer keyest keying keyly keyness keynote keys keyses keystone keystroke khaki khakier khakiest khakily khakiness khan khanate khat khoisan kib kibble kibibyte kibosh kick kickball kickballs kicked kicker kicking kickoff kicks kickshaw kickstart kid kidded kidder kidding kidnap kidnaper kidnapper kidnapping kidney kidneys kids kidskin kill killed killer killing killings kills kilo kilobyte kilocalorie kilogram kilograms kilometer kilometers kilometre kiloton kilt kimono kin kinaesthesia kinaesthesis kind kinda kinded kinder kindergarten kindergartens kindest kindhearted kinding kindle kindlier kindlies kindliest kindlily kindliness kindling kindly kindness kindred kinds kine kinesthesia kinesthesis kinesthetics kinetic kinfolk king kingbolt kingcup kingdom kingdoms kingfish kingfisher kingmaker kingpin kings kingwood kink kinkajou kinky kinned kinner kinning kino kins kinsfolk kinship kinsperson kiosk kip kirtle kiss kissed kisser kisses kissing kit kitchen kitchens kite kites kits kitschy kitted kitten kittenish kittens kitter kitting kitty kiwi klavier klaxon klick klondike knack knacker knackered knap knapsack knave knavery knavish knavishly knead knee kneecap kneel kneeler kneeling kneels kneepan knees knell knelt knew knewed knewer knewing knews knickerbockers knickers knickknack knickknackery knife knifelike knight knightliness knightly knights knit knits knitted knitter knitting knitwork knives knob knobbed knobs knock knockabout knocker knocking knockoff knockout knocks knoll knot knots knotted knottiness knotty know knowing knowingness knowledge knowledgeability knowledgeable knowledgeableness knowledges known knowner knownest knownly knownness knowns knows knuckle knucklebones knucklehead knuckles koala koalas kohlrabi koi koine kola koln kombucha kookie kooky koran koruna kosher kotow kowtow kraal kremlin kris krona krone kuangchou kubernetes kudos kuki kumquat kurus kvetch kwacha kwai kwangchow kwanza kwanzaa kyd kyphosis kyphotic laager lab labdanum label labels labial labialize labile labor laboratories laboratory labored laborer laborious labors labour laboured labourer labs labyrinth labyrinthian labyrinthine lace lacebark laced lacelike lacer lacerate lacerated laceration laces lacewood lachrymal lachrymation lachrymose lacing laciniate lack lackadaisical lacked lacker lackey lacking lackings lackluster lacklustre lacks laconic lacquer lacrimal lacrimation lacrosse lacrosses lactate lactation lacuna lacunar lacy lad ladanum ladder ladders laddie lade laden ladened ladies lading ladle lads lady ladybeetle ladybird ladybug ladybugs lag lager laggard lagged lagger lagging lagoon lagoons lags laguna lagune lah laic laid laids lain lair laity lake lakes lallation lallygag lam lama lamb lambast lambaste lambda lambency lambent lambert lambrequin lambs lambskin lame lamella lamely lameness lament lamentable lamentably lamentation lamer lamest laminate laminates lamination laminitis lamp lampblack lampoon lamps lampshade lanai lanate lance lances lancet lancetfish lancewood lancinate lancinating land landau landed lander landfall landholding landing landings landladies landlady landler landlord landlords landlubber landlubberly landman landmark landmarks lands landscape landscaper landscapes landscaping landscapist landslide landslides landslip landsman lane lanes langley langouste language languages languid languish languor languorous laniard laniary lank lanky lanolin lantern lanterns lanthanum lanyard lap lapel lapidarist lapidary lapidate lapidify lapidist lapin lapp lapped lapper lappet lapping lapplander laps lapse lapsing laptop laptops laputan lapwing larboard larch lard larder lards large largelies largely largeness larger larges largess largesse largest lari lariat lark larks larn larrup larval larynx lasagna lasagne lascar lascivious laser lasers lash lashed lasher lashes lashing lass lasses lassie lassitude lasso last lasted laster lastest lasting lastingness lastly lastness lasts latakia latch latches late latelies lately latency lateness latent later lateral lateralisation laterality lateralization laterally laterals laterly laterness laterrer laterrest laters lates latest latex lather latin latinise latinize latitude latria latte latter latterly latters lattice latticed latticelike latticework laud lauded lauder lauding lauds laugh laughable laugher laughingstock laughs laughter launch launched launcher launches launching launchpad launder laundries laundry laureate laurel laureled laurelled laurels lav lava lavabo lavas lavation lavatory lave lavender laver lavish lavishly lavishness law lawbreaker lawcourt lawful lawfully lawless lawlessly lawlessness lawmaking lawn lawns laws lawsuit lawsuits lawyer lawyers lax laxation laxer laxest laxity laxly laxness lay layabout layer layered layers laying layman layoff layout layouts layover layperson lays lazar lazaret lazarette lazaretto laze lazed lazer lazes lazier laziest lazily laziness lazing lazuline lazy lbj lea leach leaching lead leaded leaden leader leaders leadership leaderships leading leadings leadless leads leaf leafage leafing leaflet leafs leafy league leagues leak leakage leaks leaky lean leaned leaner leaning leanness leans leap leaper leapfrog leaping leaps leapt lear learn learned learnedness learner learning learns learnt leas lease leases leash least leasts leather leatherfish leatherjack leatherjacket leatherleaf leatherneck leathers leatherwood leave leaved leaven leavening leaver leaves leaving lech lechatelierite lecher lecherousness lector lecture lectured lecturer lectures lecturing led lede ledge ledgeman ledger ledges leds lee leech leechee leechlike leek leer leering leery leeward leeway left lefter leftest leftfield lefthander leftly leftness leftover leftovers lefts lefty leg legacies legacy legal legalisation legalise legalization legalize legaller legallest legally legalness legals legateship legation legato legend legendary legends leger legerdemain legerity legging leggings leggingses leggy leghorn legibility leging legion legionary legionnaire legislating legislation legislations legislative legislator legislators legislature legislatures legitimacy legitimate legitimately legitimates legitimation legitimatise legitimatize legitimise legitimize legs legume lei leisure leisurely lemma lemming lemniscus lemon lemonade lemonades lemongrass lemonlike lemons lemonwood lemony lemur lend lending lends length lengthen lengthened lengthening lengthies lengthiness lengths lengthways lengthwise lengthy lenience leniency lenient lenify lenity lens lense lenses lensman lent lententide lentigo lentil lentisk lents leo leopard leopards leotards leper lepidote leprose lepton lesbian lesion less lessen lessened lessener lessening lessens lesser lesserer lesserest lesserly lesserness lesses lesson lessons let letch letdown lethal lethargic lethargy lets letter lettered lettering letters letting lettuce lettuces letup levant levee level levelheaded leveling leveller levellest levelly levelness levels lever leverage leveraging levers leviathan levies levitate levitation levity levy lewd lewdly lewdness lewis lexical lexicon lexington ley liability liable liaise liaison liar liars libation libel liberal liberalisation liberalise liberalism liberalist liberality liberalization liberalize liberally liberalness liberals liberate liberated liberater liberates liberating liberation libertarian liberties libertine liberty libidinous libra librarian librarians libraries library librate licence licenced license licensed licenses licentiously licentiousness lichee lichen lichi licit licitly lick licked licker licking licks licorice lid lidded lidless lids lie liege liegeman lien lienal liens lies lieu lieutenant life lifeblood lifeguard lifeguards lifeless lifelessly lifelessness lifelike lifeline lifesaver lifespan lifestyle lifestyles lifetime lifetimes lift lifted lifter liftgate lifting lifts ligament ligaments ligate ligature light lightbulb lighted lighten lightened lightener lightening lightens lighter lighterage lighters lightest lightheaded lightheadedness lighthearted lightheartedness lighthouse lighthouses lighting lightless lightlessness lightly lightness lightning lightnings lights lightsome lightsomely lightsomeness lightweight likable like likeable liked likelies likely liken likeness liker likes likest likewise likewised likewiser likewises likewising liking lilac lilaccer lilaccest lilacly lilacness lilies lilliputian lilt lily limb limber limbo limbs lime limelight limen limerick limes limestone limit limitation limited limiteds limiting limitless limitlessness limits limn limning limo limos limousine limousines limp limped limper limpet limpid limpidity limping limps linage linchpin linden line lineage lineal lineament linear linears lineation linebacker linecut lined lineman linen linens liner lines linesman lineup lineups ling lingberry lingcod lingenberry linger lingo lingonberry lingua lingual lingually linguist linguistic linguistically linguistics lining link linkage linked linker linking links linksman linkup linnet linocut lint lintel lints lintwhite lion lionise lionize lions lip lips lipstick liquefied liquefy liqueur liquid liquidambar liquidate liquidation liquidator liquidise liquidiser liquidity liquidize liquidizer liquidness liquids liquified liquify liquor liquorice lira lisle lisp lissom lissome lissomeness list listed listen listened listener listening listens lister listing listless listlessness lists lit litany litchee litchi liter literacies literacy literal literalism literally literals literary literate literature literatures liters lithe litheness lithesome lithic lithium lithograph lithography litigate litigious litotes litre lits litted litter litters litting little littleneck littleness littles liturgy live livecast lived livelier liveliest livelihood livelily liveliness lively liven liveness liver liverish liverleaf livers livery lives livest livestock livestream livid lividder lividdest lividity lividly lividness living livings lizard lizards llama llamas load loaded loader loading loadings loads loadstar loaf loafer loafers loafs loan loanblend loaned loaner loaning loans loanword loath loathe loathing loathly loathsome loathsomeness loaves lob lobate lobated lobbies lobby lobe lobed lobes lobster lobsters lobworm local locale localisation localise localised localism locality localization localize localized localler locallest locally localness locals locate located locater locates locating location locations loch lock lockage locked locker locking lockjaw locks lockstep lockup loco locomote locomotion locomotive locomotor locoweed locus locust locution lode lodestar lodge lodgement lodger lodges lodging lodgings lodgment loft loftiness lofts lofty log loganberry logarithm loge logged logger loggerhead loggerheaded logging logic logical logically logicals logics login logins logistics logisticses logjam logo logos logotype logout logrolling logs logwood logy loin loins loiter loll lollipop lolly lollygag lone lonelier lonelies loneliest lonelily loneliness lonely loneness loner lones lonesome lonesomeness lonest long longanimity longbeard longed longer longest longevity longing longings longitude longitudinal longitudinally longlegs longly longness longs longshoreman longsighted longsightedness longways longwise loo loofa loofah look looked looker looking lookout looks lookup lookups loom loomed loomer looming looms loon looney loons loony loop looped looper loophole looping loops loopy loose loosely loosen looseness loosening looser looses loosest loosestrife loot looted looter looting loots lop lope loped loper lopes loping lopped lopper lopping lops lopsided loquacious loquat lord lordliness lordly lords lordship lore lores lorry lose loser loses losing loss losses lost loster lostest lostly lostness losts lot lota loth lotion lots lotte lotteries lottery lotus loud louden louder loudest loudly loudness louds loudspeaker lough louisiana lounge lounger lounges lour louse lousier lousiest lousily lousiness lousy lout loutish louver louvers louvre lovage love lovebird loved loveless lovelier lovelies loveliest lovelily loveliness lovelorn lovely lovemaking lover lovers loves loveseat loveseats lovesome loving lovingness low lowball lowbred lowbrow lowbrowed lower lowercase lowered lowering lowerly lowerness lowerrer lowerrest lowers lowest lowlife lowliness lowly lowness lowry lows loyal loyalist loyaller loyallest loyally loyalness loyals loyalties loyalty lozenge lubber lubberly lube lubricate lubrication lubricious luce lucent lucerne lucid lucidity lucidness lucifer luck luckier luckies luckiest luckily luckiness luckless lucks lucky lucrative lucrativeness lucre lucubrate lucubration luculent lucullan ludicrous lues luff luffa lug luge luger luggage luggages lugged lugger lugging lugh lugs lugsail lugubriousness lugworm luik luke lukewarm lukewarmness lull lullaby lulls lulu lumber lumbering lumberjack lumberman lumbermill lumbers lumbus lumen luminance luminary luminescence luminosity luminous luminousness lummox lump lumpen lumper lumpish lumps lumpy lunacy lunar lunars lunatic lunation lunch luncheon lunches lunette lung lunge lunger lunges lungs lunkhead lunula lunule lupus lurch lurcher lure lured lurer lures lurid luridness luring lurk lurked lurker lurking lurks luscious lusciously lush lushes lushness lust luster lusterless lusterlessness lustful lustfulness lustiness lustre lustreless lustrelessness lustrous lustrum lusty lute luting luxate luxe luxuria luxuriance luxuriant luxuriantly luxuriate luxuries luxurious luxuriously luxuriousness luxury lxx lxxx lycee lyceum lychee lychnis lye lyes lying lyings lynchpin lynx lynxes lyre lyric lyrical lyricality lyricism lyricist lyrics lyrist lysis lysogenic lyssa maam mac macabre macadam macadamia macadamise macadamize macaroni macaronis macaw macaws mace macebearer macer macerate maceration maces machinate machination machinator machine machinelike machinery machines machinist macho macintosh mack mackerel mackinaw mackintosh macon maconnais macro macrocosm macroscopic macroscopical macula maculate maculation macule macumba mad madam madams madcap madded madden maddened maddening madder maddest madding made madeira mades madhouse madison madly madman madness madonna madras madrona madrono mads madwort maelstrom maenad maestro maffia mafia mafioso mag magazine magazines magenta maggoty magic magical magician magics magisterial magisterially magma magnanimity magnanimous magnanimousness magnate magnesium magnesiums magnet magnetic magnetically magnetics magnetisation magnetise magnetised magnetism magnetization magnetize magnetized magnets magnification magnificence magnificent magnificently magnified magnify magniloquence magniloquent magnitude magnolia magpie magpies maguey magus magyar mahagua mahican mahimahi mahoe mahogany maid maiden maidenhead maidens maids maidservant mail mailbag mailboat mailbox mailboxes mailed mailer mailing maillot mailman mails maim maimed maimer maiming maims main maine mainer mainest mainframe mainland mainlies mainly mainness mains mainsheet mainstay mainstream mainstreams maintain maintained maintainer maintaining maintains maintenance maintenances maisonette maisonnette maize majagua majestic majesty major majorette majorities majority majorly majorness majorrer majorrest majors majuscule make makeover maker makers makes makeup makeweight making makings makomako malacca maladjusted maladroitness malady malaise malaria malarias malarkey malarky malcontent male maledict malediction malefactor malefic maleficence maleness maler males malest malevolence malevolency malevolent malformation malformed malfunctioning malice malicious maliciousness malign malignance malignancy malignity malignment malinger malingerer mall mallard malleable mallet malls malodor malodorous malodour malodourous malpractice malt malted maltese malti maltreat maltreated maltreatment malts malversate malware malwares maly mama mamas mamey mamilla mamma mammal mammalian mammals mammee mammilla mammon mammoth mammy mamoncillo man manacle manage manageable managed management managements manager manages managing manakin manat manatee manatees manchester mandarin mandatary mandate mandates mandatorily mandatory mandible mandibula mandioc mandioca mandolin mandrake mandrel mandril mandrill manducate manduction mane manes maneuver manful manfully manfulness manger mangey manginess mangle mangled mangler mangles mangling mango mangonel mangos mangosteen mangrove mangy manhattan manhood mania maniac manic manicure manifest manifestation manifestly manifold manikin manila manilla manioc manioca manipulable manipulate manipulation manipulative manipulator mankind manlike manliness manly manna manned mannequin manner mannerism manners mannikin mannish manoeuver manoeuvre manor manors manpower mans manse mansion mansions manslayer manta mantel mantelet mantelpiece mantic mantilla mantle mantled mantlepiece mantles mantlet mantra mantrap manual manualer manualest manually manualness manufactory manufacture manufactured manufacturer manufacturers manufactures manufacturing manumit manure manus manuscript many manzanita map maple maples mapped mapper mapping maps maquis maquisard mar mara marabou marabout marasca maraschino marathon marathons maraud marauder marauding marble marbles marblewood march marcher marches marching marchioness marchland mare mares margarin margarine marge margin marginal marginalise marginalize margins margrave marguerite maria marihuana marijuana marina marinade marinas marinate marine marinely marineness mariner marines marineses marinest marionette marital maritals maritime marjoram mark marked markeder markedest markedly markedness markeds marker market marketable marketer marketing marketings marketplace marketplaces markets marking marks marksman markup marlin marmite marmot maroc maroon marooner maroonest maroonly maroonness marque marquee marquess marquis marquise marred marrer marriage marriages married marries marring marrow marrows marruecos marry marryer marrying mars marseille marseilles marsh marshal marshall marshals marshes marshland marshy mart martial martin martinet martingale martyr martyrdom martyrise martyrize marvel marvellous marvelous marxist mary mascot mascots masculine masculinise masculinity masculinize mash masher mashhad mask masked masker masking masks mason masonic masonry masqat masque masquerade mass massachusetts massacre massage massasauga masser masses massest massive massiveness massives massly massness mast master mastered masterful mastering masterly mastermind masterpiece masters mastership mastery masthead mastic masticate mastication mastiff mastoid mastoidal masts masturbate masturbation mat match matcha matched matches matching matchless matchwood mate mated mateless mater materfamilias material materialisation materialise materialism materialist materialistic materiality materialization materialize materially materials materiel maternal maternalism maternity mates matey math mathematical mathematics mathematicses maths mating matman matriarch matricide matrilineage matrimonial matrimony matrix matron mats matt matte matted matter mattered matterer mattering matters matting mattress mattresses maturate maturation mature matured maturely maturement matureness maturer maturest maturity maudlin maul mauled mauler mauling mauls maunder maven maverick mavin mavis maw mawkish mawkishness maws max maxed maxer maxes maxim maximal maximation maximisation maximise maximization maximize maximized maximizer maximizes maximizing maximum maxing maxwell may maya mayan maybe maybes mayflower mayhap mayhem mayo mayonnaise mayor mayoress mayors mayos mays maze mazed mazes mazurka mazy mbd mead meadow meadowlark meadows meads meager meagerly meagerness meagre meagrely meagreness meal meals mealy mean meander meaner meanest meanie meaning meaningful meaningless meaninglessness meanings meanly meanness means meanspirited meant meantime meanwhile meanwhiles meany measles measleses measly measurable measure measured measuredly measureless measurement measures measuring meat meatball meatballs meatloaf meatloafs meatloaves meatman meats meaty mebibyte mecca mechanic mechanical mechanically mechanics mechanisation mechanise mechanised mechanism mechanistic mechanization mechanize mechanized medal medalist medallion medallist medals meddle meddled meddler meddles meddlesome meddling media mediaeval medial median medians medias mediate mediated mediater mediates mediating mediation mediator medic medical medicals medicament medicate medication medicine medicines medick medico mediety medieval medievals medina mediocre mediocrity meditate meditation meditative meditativeness medium mediums medlar medley medulla medullary medusa medusan medusoid meek meekly meekness meerkat meerschaum meet meeter meeting meetinghouse meetings meets meg mega megabucks megabyte megabytes megahit megapixel megascopic megaton megillah megrim megrims meiosis melancholic melancholy melange melanise melanize melatonin melatonins meld melee meliorate melioration meliorist mellifluous mellisonant mellow mellowed mellowly mellowness melodic melodies melodious melodramatic melodramatically melody melon melons melt meltdown melted melter melting melts member members membership memberships membrane membranophone membranous meme memento memo memoir memoirs memorabilia memorable memoranda memorandum memorial memorialisation memorialise memorialization memorialize memorials memories memorise memorize memorized memorizer memorizes memorizing memory memos men menace menacing menage menagerie mend mendacious mended mender mendicancy mendicant mendicity mending mends menial meniscus menominee menomini menopause menorah mens menses menstruate menstruation menstruum mensurable mensural mensuration mental mentaler mentalest mentality mentally mentalness mentals mentation menthol mention mentions mentor mentors mentum menu menus mephistophelean mephistophelian mephitic mephitis mercantile mercantilism mercenary mercer merchandise merchandiser merchandises merchandising merchant merchantable merchantman merchants mercies merciful mercifulness mercilessness mercurial mercury mercy mere merelies merely mereness merer meres merest meretricious meretriciously meretriciousness merganser merge merged merger merges merging meridian meridional merit meritocracy meritoriousness merl merle merlin merlot merman merriment merriness merry merrymaking mesa mesas mescal mescaline mesh meshed meshes meshing meshwork mesic mesmeric mesmerise mesmerised mesmerism mesmerize mesmerized mesmerizing mesomorphic mesonic mess message messages messed messer messes messiah messier messiest messily messiness messing messy met metabolic metabolism metabolous metacentric metadata metagrabolised metagrabolized metagrobolised metagrobolized metal metallic metals metalwork metalworker metalworking metameric metamorphic metamorphose metamorphosis metamorphous metaphase metaphysical metathesis mete metempsychosis meteor meteoric meteoroid meteorologic meteorological meteorology meteors meter meters meth methamphetamine methedrine method methodicalness methodology methods methuselah meticulosity meticulous meticulousness metier metre metric metrical metricate metrication metricise metricize metrics metrification metrify metro metronome metropolis metropolitan metros mets metted metter metting mettle mettlesome meuse mewl mezcal mezzanine mezzo mho miasm miasma miasmal miasmic mib mic mice michigan michigander mick mickey mickle microbe microchip microcode micrometer micron microphone microphones microprocessor microscope microscopic microscopical microscopically microseism microservice microwave micturate midday midden middle middleman middles middleware middleweight middling midfield midget midi midland midnight midnights midpoint midriff midsection midships midst midterm midterms midway midweek midwifery mien mierkat miff miffed might mightier mighties mightiest mightily mightiness mights mightve mighty migraine migraines migrant migrate migrates migration migrator migratory mihrab mike mil milage mild milder mildest mildew mildly mildness milds mile mileage mileages milepost miler miles milestone milieu militant militaries militarisation militarise militarization militarize military militia militias milium milk milklike milks milkshake milkshakes milksop milkweed milky mill millenary millennium millenniums miller millers millet milliampere milliner millinery million millionaire millions millionth mills millstone milquetoast milt miltomate mime mimer mimes mimesis mimetic mimic mimicry mimosa min minacious minatory mince mincing mind minded minder mindful minding mindless mindlessly mindlessness minds mindset mine mined miner mineral mineralize minerals mines minginess mingle mingles mingy miniate miniature minify minim minimal minimalist minimise minimize minimized minimizer minimizes minimizing minimum minimums mining miniscule minister ministerial ministers ministration ministry minivan minivans mink minnesotan minnow minnows minor minorities minority minorly minorness minorrer minorrest minors minstrel minstrelsy mint mintage minter mints minty minuet minus minuscular minuscule minuses minute minutely minuteman minuteness minutes minx miosis miracle miracles miraculous mirage mire mirid mirky miro mirror mirrors mirth mirthful mirthfulness miry misaddress misadventure misadvise misanthropic misanthropical misanthropy misapplication misapply misapprehend misapprehension misappropriate misappropriation misbegot misbegotten misbehave misbeliever miscalculate miscarriage miscarry miscegenation miscellanea miscellaneous miscellany mischance mischief mischievous mischievously mischievousness misconceive misconduct misconstrual misconstruction misconstrue miscreant miscreation miscue misdating misdemean misdemeanor misdemeanors misdemeanour misdirect misdirection miserable miserableness miserly misery misestimate misfire misfit misfortunate misfortune misgiving misguide misguided mishandle mishap mishmash misidentify misinform misinterpret misinterpretation mislaid mislay mislead misleading mismanage mismanagement mismatched mismated misplace misplaced misplay misprint misread misrepresent misrepresentation misrepresented miss missed misser misses misshapen misshapenness missile missiles missing missings mission missional missionary missioner missions missis missive missouri misspend misstep missus missuses missy mist mistake mistaken mistakes mistaking mister misters mistflower mistily mistiming mistiness mistletoe mistreat mistreated mistress mistrust mistrustful mists misty misunderstand misunderstanding misuse mite miter mitigate mitigation mitosis mitral mitre mitsvah mitt mitten mittens mitts mitzvah mix mixed mixer mixes mixing mixologist mixture mixtures mizen mizenmast mizzen mizzenmast mizzle moan moaned moaner moaning moans moat moats mob mobbed mobber mobbing mobile mobileness mobiler mobilest mobilisation mobilise mobility mobilization mobilize mobilized mobilizer mobilizes mobilizing mobily mobs mocassin moccasin mocha mochaer mochaest mochaly mochaness mock mocked mocker mockery mocking mockingbird mockingly mocks mod modal modality modaller modallest modally modalness mode model modeled modeling modelling models modem modems moderate moderated moderately moderateness moderater moderates moderating moderation moderationist moderator modern moderner modernest modernisation modernise modernism modernistic modernity modernization modernize modernized modernly modernness modes modest modester modestest modestly modestness modesty modification modified modifier modifies modify modifyer modifying modishly modishness modiste mods modulate modulated modulation module modulus moghul mogul mohawk mohican moiety moil moist moisten moister moistest moistly moistness moisture moistures mol mola molar mold moldable molded molder moldiness molding molds moldy mole molech molecular molecule moles molest molestation mollification mollify mollusc mollusk mollycoddle mollycoddler mollymawk moloch molotov molt molted molten molter molting molts molybdenum mom moment momentaneous momentarily momentary momently moments momentum momma mommies mommy moms mon monad monarch monarchal monarchic monarchical monarchies monarchist monarchy monas monastic monastical monday mondays monetary money moneyed moneyer moneylender moneyless moneymaker moneymaking moneys monger monggo mongol mongolian mongolic mongoloid mongoose mongrel monied moniker monish monition monitor monitored monitorer monitoring monitors monitory monk monkey monkeys monkfish monks mono monochromatic monochrome monochromic monochromous monocracy monolithic monologue monomania monophonic monopolies monopolise monopolize monopoly monorail monorails monotone monotonic monotonous monotony monotype monovalent monovular monsoon monster monstera monstrance monstrosity monstrous monstrously montage montgolfier month monthlies monthly months monument monumental monuments moo mooch mood moodiness moods moody moolah moon mooned mooner moonfish moong mooning moonlight moonlights moonlit moons moonshine moonstruck moonwalk moony moor moorage moorhen mooring moorland moors moose mooses moosewood moot mop mope moped moper mopes moping mopped mopper mopping mops moral morale moralisation moralise moralism moralist morality moralization moralize moralizing moraller morallest morally moralness morals morass moratorium morbid morbidity morbidness morbific morbilli mordacious mordant more morello morely moreness moreover morer mores morest morgan morgue moribund morn morning mornings morocco moron morose moroseness morph morphologic morphological morphology morris morse morsel mortal mortaler mortalest mortality mortally mortalness mortar mortarboard mortars mortgage mortgages mortice mortification mortified mortify mortifying mortise mortmain mortuary mosaic moses mosh moslem mosquito mosquitos moss mosses mossy most mostlies mostly mosts mote motel motels moth mother motherboard motherboards motherfucker motherhood motherland motherliness mothers moths mothy motif motility motion motionless motionlessness motions motivate motivated motivater motivates motivating motivation motivator motive motiveless motivity motley motor motorbike motorbus motorcar motorcoach motorcycle motorcycles motored motorise motorised motorize motorized motors motortruck motorway mottle motto moue mould moulder moulding mouldy moult moulting mound mount mountain mountainous mountains mounted mounteds mounter mounting mounts mourn mourned mourner mournful mournfulness mourning mourns mouse mouselike mouses mousetrap mousey mousse mousy mouth mouthful mouthpiece mouths mouthwash movable move moveable moved movement movements mover moves movie movies moving movings mow mowed mower mowing mows moxie much muched mucher muches muchest muching muchly muchness mucilage mucilaginous muck muckheap muckhill muckle mucks mucky mud mudcat mudded mudder muddied muddier muddiest muddily muddiness mudding muddle muddled muddy muds muff muffin muffins muffle muffled muffler mufflers mufti mug mugful mugged mugger mugging muggins muggy mugs mugwump mulberry mulct mule mules muleteer muliebrity mulish mulishness mull muller mullet mulloway multicolor multicolored multicolour multicoloured multifaceted multifarious multifariousness multimedia multinational multiple multiples multiplex multiplication multiplications multiplicity multiplied multiplies multiply multiplyer multiplying multitask multitude multitudinous multivalence multivalency multivalent mum mumble mumbling mumly mummer mummery mummest mummification mummify mummy mumness munch mundane mundanely mundaneness mundanity mung munggo municipal municipality municipals munificence munificent munificently munition munro muon mural murals murder murderer murderously murderousness murders murk murkier murkiest murkily murkiness murky murmur murmuration murmuring murmurous murphy murray musca muscadel muscadelle muscadet muscadine muscat muscatel muscle musclebuilder muscleman muscles muscovite muscular muscularity musculus muse mused muser muses museum museums musgoi mush mushes mushiness mushroom mushrooms mushy music musical musicals musician musicians musics musing musk muskat muskellunge musketry muskmelon muskrat musks muslim muslimer muslimest muslimly muslimness musquash muss mussel mussels mussitate mussitation mussy must mustard mustards musted muster mustiness musting mustnt musts mustve musty mutable mutant mutation mute muted mutely muteness muter mutest mutilate mutilation mutinous mutt mutter muttering muttonhead mutual mutualer mutualest mutuality mutually mutualness mutuals muzzle muzzy myasthenia myelic myelin myeline myeloid myopia myopic myosis myriad myringa myrmidon myrtle myself mysteries mysterious mystery mysterynatural mysterynaturals mystic mystical mysticism mystification mystified mystifier mystify mystifying myth mythic mythical mythicise mythicize mythologic mythological mythologise mythologize mythology myths nab nabbed nabber nabbing nabob nabs nacreous nada nadir nag nagged nagger nagging nags naiad naif nail nailed nailer nailhead nailing nailrod nails naive naively naiveness naiver naivest naked nakedder nakeddest nakedly nakedness nakeds name named nameless namelies namely namer names namesake namesakes naming nan nance nandu nanna nanny nanus nap napkin napkins napoleon napped napper napping nappy naps narc narcissistic narcissus narcoleptic narcotic narcotised narcotising narcotized narcotizing nark narked narker narking narks narrate narration narrative narratives narrator narrators narrow narrowed narrower narrowest narrowing narrowly narrowness narrows narthex narwal narwhal narwhale nasal nasalise nasalize nascence nascency nastier nastiest nastily nastiness nasturtium nasty natal natality natation natator nates nation national nationalisation nationalise nationalism nationalist nationalistic nationality nationalization nationalize nationally nationals nations nationwide native natively nativeness nativer nativest nativism nativist nativistic nativity natter nattiness natty natural naturalisation naturalise naturalised naturalism naturalist naturalistic naturalization naturalize naturalized naturally naturalness nature natures naught naughtily naughtiness naughty nausea nauseant nauseas nauseate nauseated nauseating nauseatingness nauseous nautical nautilus naval navaller navallest navally navalness nave navel naves navies navigate navigated navigater navigates navigating navigation navigator navigators navvy navy nawab neandertal neanderthal neanderthalian near nearbier nearbies nearbiest nearbily nearbiness nearby neared nearer nearest nearing nearlies nearly nearness nears nearsighted nearsightedness neat neaten neater neatest neatlies neatly neatness neats neb nebraskan nebuchadnezzar nebuchadrezzar nebula nebular nebulas nebuliser nebulizer nebulose nebulous necessarily necessary necessitate necessities necessitous necessity neck neckband neckcloth necking necklace necklaces necks necktie necrology necromancer necromancy necromantic necromantical necropolis necropsy necrose necrosis nectar nectarine nectarous need needed needer needful needfully neediness needing needle needlecraft needlefish needlelike needlepoint needles needless needlewoman needlework neednt needs needy nefariousness negate negation negative negatively negativeness negativism negativist negativity negatron neglect neglected neglecter neglectful neglectfulness neglecting neglects neglige negligee negligence negligent negligible negociate negotiable negotiate negotiated negotiater negotiates negotiating negotiation negro negroid neighbor neighborhood neighborhoods neighborly neighbors neighbour neighbourhood neighbourly neither neithers nelson nematode nemesis neologism neology neon neonate neoner neonest neonly neonness neophyte neoplasm nephew nephews nephritic nephropathy nephrosis neptune nerd nerdier nerdiest nerdily nerdiness nerds nerdy neritic nerve nerveless nervelessly nerves nervous nervouses nervously nervousness nervure nervus nervy nescience nescient ness nest nested nester nesting nestle nestling nestor nests net nether netherworld netkeeper netlike netmail netminder nets nett netted netter netting nettle nettled nettlesome network networking networks neural neurology neuron neuronal neuronic neurotic neuter neutered neutral neutralisation neutralise neutrality neutralization neutralize neutrals neutrino neutron never nevers nevertheless new newbie newborn newcomer newel newer newest newly newmarket newness news newsboy newsbreak newses newsflash newsless newsmonger newspaper newspaperman newspapers newspaperwoman newsprint newsroom newsworthiness newswriter newsy newt newton newts next nexter nextest nextly nextness nexts nexus nib nibble nibs nice nicelies nicely niceness nicer nices nicest nicety niche nick nickel nicknack nickname nictate nictation nictitate nictitation nidation nidus niece nieces nifty niger niggard niggardliness niggardly niggardness niggle niggling nigh nighest night nightbird nightcap nightclub nightclubs nightcrawler nightdress nighted nightfall nightgown nightgowns nighthawk nightie nightingale nightingales nightlife nightlong nightmare nights nightspot nightstand nightstands nightstick nighttime nightwalker nightwear nihilism nihilist nihility nihon nil nils nimble nimbleness nimbus nimiety nincompoop nine niner nines nineteen nineties ninety ninja ninny ninth ninths nip nipa nipped nipper nipping nipple nippon nippy nips nirvana nisus nit nitid nitrification nitrify nitril nitrile nitrogen nitrogenise nitrogenize nits nitwitted nix nixed nixer nixes nixing nobble nobelium nobility noble nobleman nobleness nobler nobles noblesse noblest noblewoman nobly nobodies nobody nock nocturnal nocturne nod nodded nodder nodding node nodes nods nodular nodulated nodule noduled noesis noetic nog noggin noise noises noisier noisiest noisily noisiness noisome noisomeness noisy nomadic nomenclature nominal nominate nominated nominater nominates nominating nomination nominative nominee non nonadaptive nonage nonaged nonattender nonchalance nonchalant nonchalantly noncitizen noncombatant noncompliance noncompliant nonconcentric nonconformance nonconforming nonconformism nonconformist nonconformity nonconscious noncontinuous noncritical noncrucial noncyclic noncyclical nondrinker none nonentity nones nonessential nonesuch nonetheless nonexempt nonexistence nonextant nonfiction nonfinite nonfunctional nongregarious nonimmune nonindulgence nonindulgent nonintegrated nonionic nonionised nonionized nonliteral nonliterate nonliving nonmaterial nonmeaningful nonmechanical nonmigratory nonmoving nonmusical nonnative nonnatural nonoperational nonparallel nonpareil nonpayment nonperformance nonphysical nonplus nonplused nonplussed nonpoisonous nonpolar nonprofit nonprogressive nonrational nonreader nonrecreational nonremittal nonresistant nonsense nonsensical nonsensicality nonsensitive nonsmoker nonsocial nonstandard nonstarter nonstop nonsubjective nonsuch nonsyllabic nontaxable nontoxic nonunionised nonunionized nonverbal nonviolent nonvoluntary noodle noodles nook nookie nooks nooky noon noonday noons noontide noose nopal nor nordic norm normal normalcy normaler normalest normalisation normalise normality normalization normalize normalized normalizer normalizes normalizing normally normalness normals norman normative norms norred norrer norring nors norse north northeast northeasterly northeastern northeastward norther northerly northern northerner norths northward northwards northwest northwesterly northwestern northwestward nose noseband nosecount nosedive nosegay nosepiece noses nosh nostalgic nostril nostrils nostrum not notability notable notables notably notarise notarize notation notch notched notcher notches notching note notebook notebooks notecase noted noter notes noteworthy nothing nothingness nothings notice noticeability noticeable noticeableness noticed noticer notices noticing notification notifications notified notifies notify notifyer notifying noting notion notional notions notorious nots notted notter notting notturno notwithstanding nought noun nouns nourish nourished nourisher nourishes nourishing nourishment nous nov novel novelise novelist novelize noveller novellest novelly novelness novels novelty november novembers novice noviciate novitiate now nowadays nowed nower nowhere nowing nows nox noxiousness nozzle nuance nub nubbiness nubble nubbly nubby nubs nuclear nuclears nuclei nucleole nucleolus nucleus nude nudely nudeness nuder nudest nudge nudged nudger nudges nudging nuisance nuke null nullification nullifier nullify nullity numb numbat number numbering numberless numbers numbest numbfish numbly numbness numeral numerate numeration numeric numerical numerosity numerous numerousness numinous numskull nun nuns nuptial nurse nurseling nursemaid nurseries nursery nurseryman nurses nursing nursings nursling nurture nurtured nurturer nurtures nurturing nut nutcase nutcracker nuthatch nuthouse nutlike nutmeg nutmegs nutrient nutrify nutriment nutrition nutritious nutritive nuts nutted nutter nutting nutty nuzzle nyala nybble nylon nylons nymph nypa oaf oafish oak oaks oar oarfish oarlock oars oasis oasises oat oath oaths oatmeal oatmeals oats oatses obbligato obdurate obeah obeche obechi obedience obedient obeisance obelisk obese obesities obesity obey obeyed obeyer obeying obeys obfuscation obi obit obituary object objected objecter objectification objectify objecting objection objectionable objectionably objections objective objectives objector objects objurgate oblation obligate obligated obligation obligations obligato obligatorily obligatory oblige obliged obliger obliges obliging obligingness oblique obliquely obliqueness obliquity obliterable obliterate obliterated obliteration oblivion oblivious obliviousness oblong obloquy obnoxious obnoxiously obnubilate oboe obscene obscenely obscenity obscurantism obscure obscureness obscurity obsequious obsequiousness observable observance observant observation observational observations observatories observatory observe observed observer observes observing obsess obsessed obsession obsolete obsoleteness obstacle obstacles obstetrics obstinacy obstinance obstinate obstreperous obstruct obstructer obstruction obstructionist obstructor obtain obtained obtainer obtaining obtains obtrude obtrusive obturate obtuse obtuseness obverse obviate obvious obviouses obviously obviousness occasion occasional occasionally occasions occident occidental occidentalism occlude occluded occlusion occlusive occult occultation occultism occupancy occupant occupation occupations occupied occupier occupies occupy occupyer occupying occur occurred occurrence occurrences occurrent occurrer occurring occurs ocean oceanaut oceanfront oceangoing oceanic oceans ocellus ocelot ocher ochre oclock ocotillo oct octad octave octet octette october octobers octonary octopus octopuses ocular oculist oculus odd oddball odder oddest oddity oddly oddment oddments oddness odds ode odes odious odiously odiousness odium odontiasis odor odoriferous odorize odorous odors odour odourise odyssey oecumenic oecumenical oecumenism oersted oesophagus oestrus oeuvre off offbeat offence offend offended offender offending offends offense offenses offensive offensively offensiveness offer offering offers offertory offhand offhanded offhandedly office officeholder officer officers offices official officially officiate officiating officiation officious offing offish offline offlines offload offprint offset offseted offseter offseting offsets offsetting offshoot offshore offspring offstage oft often oftenness oftentimes ofttimes ogdoad ogre ohio ohioan oil oiler oiliness oilman oils oilskin oily oink oinks ointment ointments okay okayer okayest okayly okayness okeh okey oklahoma oklahoman okra old older oldest oldly oldness olds oldtimer oldwench oldwife oleaginous oleaginousness oleo oleomargarine olfaction olibanum oliguria olive olively oliveness oliver olivest olympiad olympian olympic olympics omega omelet omelets omelette omen omens ominous omission omit omits omitted omitter omitting omnibus omnivore omphalos omphalus onager onanism once onces oncoming one oneirism oneness onerousness ones ongoing ongoings onion onioner onionest onionly onionness onionskin onlier onlies onliest onlily online onlinely onlineness onliner onlines onliness onlinest only onomatopoeic onomatopoeical onomatopoetic onrush onset onsets onshore onslaught onto ontogenesis ontogeny ontology ontos onus onward onwards onyx onyxer onyxest onyxly onyxness oomph ooze oozed oozer oozes oozing opacify opacity opah opal opalesce opalescent opaline opaque opaqueness open opened opener openers openhanded openhandedness openhearted opening openings openly openmouthed openned openner openness opennest openning opens opera operable operas operate operated operater operates operating operation operational operations operative operator operators operose ophidian ophthalmic ophthalmologist opine opinion opinions opossum opossums opponent opponents opportunism opportunities opportunity oppose opposed opposer opposes opposing opposite oppositeness opposition oppositions oppress oppressed oppression oppressive oppressiveness opprobrious opprobrium oppugn opt optative opted optedder opteddest optedly optedness optic optical optics optimal optimise optimism optimistic optimize optimum option optional options optometrist opts opulence opulent opus oracle oracles oracular oral oraller orallest orally oralness orals orang orange orangely orangeness oranger oranges orangest orangish orangutan orangutang orb orbicular orbiculate orbit orbital orbiter orbits orbitual orbs orca orcas orchard orchards orchestra orchestras orchestrate orchestration orchid orchider orchidest orchidly orchidness orchids orchil orchis orcus ordain ordained ordeal order ordered orderer ordering orderliness orderly orderred orderrer orderring orders ordinal ordinance ordinances ordinaries ordinarily ordinariness ordinary ordinate ordination ordnance ordure ore oregano oreganos oregon oregonian ores organ organic organically organics organisation organise organised organiser organism organization organizations organize organized organizer organizes organizing organs organza orgasm orgiastic orgy orient orientalism orientate orientation orientations oriented orienter orienting orients orifice oriflamme origin original originality originally originate originated originater originates originating origination originative originator origins originses oriole orioles orion orison orleans ornament ornamental ornamentalist ornamentation ornate ornateness ornery ornithosis orotund orphan orphanage orphanhood orphans orphic orris orrisroot orthodox orthodoxy orthoepy orthogonal orthogonality orthophosphate oscillate oscillation oscilloscope oscitance oscitancy oscitant osculate osculation osier osmanli osmosis osprey ospreys osseous ossification ossify osteal ostensible ostensibly ostensive ostensorium ostentate ostentation ostentatious ostentatiously ostentatiousness osteoporosis osteoporosises ostiarius ostiary ostler ostracise ostracism ostracize ostrich ostriches other otherness others otherwise otherworldliness otherworldly otic otiose otter otters ottoman ottomans ought oughts ounce our ours ourselves ousel oust ousted ouster ousting ousts out outage outback outbalance outbid outboard outbound outbrave outbreak outburst outcast outcome outcomes outcry outdated outdistance outdo outdoor outdoors outer outerly outerness outerrer outerrest outers outfield outfielder outfields outfit outfits outfitted outfitter outflank outflow outfox outgo outgoing outgoings outgrow outgrowth outhouse outing outlander outlandish outlast outlaw outlawed outlawry outlaws outlay outlet outlets outlier outline outlined outliner outlines outlining outlive outlook outlooks outmaneuver outmanoeuvre outmatch outmoded outperform outpoint outpost outpouring output outputs outrage outraged outrageous outrageously outrageousness outrank outre outride outright outs outscore outsell outset outshine outshout outside outsider outsides outskirt outsmart outsource outsourced outsourcer outsources outsourcing outspoken outstanding outstation outstay outstrip outturn outward outwardly outwardness outwards outwear outweigh outwit outwited outwiter outwiting outwits ouzel oval ovalbumin ovals ovary ovate oven ovenbird ovens over overabundance overabundant overact overactive overage overaged overall overalls overappraisal overarch overarm overawe overbalance overbear overbearing overbid overblown overboard overboil overbold overburden overcall overcame overcapitalise overcapitalize overcast overcasting overcasts overcharge overclothe overcloud overcoat overcoating overcome overcomes overcoming overcompensate overcompensation overconfident overcooked overcrowd overdo overdone overdraw overdress overdrive overdue overeat overeating overemotional overestimate overestimation overexpose overexposure overflow overgenerous overgorge overgrow overgrown overgrowth overhand overhanded overhang overhasty overhaul overhead overheads overheat overindulge overindulgence overjealous overjoyed overkill overlap overlaps overlay overlayer overleap overlie overload overlook overlooked overlooking overlooks overlord overly overlying overmaster overmodest overmuch overmuchness overness overnice overnight overnighter overpass overpasses overpayment overplay overplus overpower overpowering overproduce overproduction overprotect overrate overrating overreach overreckoning overred overrefined overrefinement overrer overrest override overriding overring overrule overrun overs oversea overseas oversee overseer oversees oversewn overshadow overshoot oversight oversimplification oversimplify overspend overspill overstate overstated overstatement overstay overstep overstretch overstrung oversupply overt overtake overter overtest overthrow overtime overtimes overtly overtness overtone overtop overture overturn overturned overturner overturning overturns overuse overvaluation overvalue overweening overweight overwhelm overwhelmed overwhelmer overwhelming overwhelms overwinter overwork overworking overwrought overzealous oviform ovoid ovolo ovular ovule owe owes owl owls own owned owner owners ownership ownerships owns oxalis oxbow oxen oxeye oxford oxheart oxidate oxide oxides oxidise oxidize oxlip oxtongue oxybenzene oxygen oxygenate oxygenise oxygenize oxygens oyster oysters ozone ozones pablum pabulum pace paced pacemaker pacer paces pacesetter pachouli pachydermal pachydermatous pachydermic pachydermous pacific pacification pacificism pacifics pacifier pacifism pacify pacing pack package packages packaging packed packeder packedest packedly packedness packer packet packing packinghouse packman packrat packs packsack pact pad padauk padded padder padding paddle paddlefish paddles paddy padouk padre padrone pads paean pagan paganly paganner paganness pagannest page pageant pageantry pageboy paged pager pages paginate pagination paging pahlavi pahlevi paid paids paigle pail pailful pails pain painful painfully painfulness painfuls painless pains painstaking painstakingly painstakingness paint paintball paintballs painted painter painting paintings paints pair paired pairing pairs paisley pajama pajamas pajamases pal palace palaces paladin palaeontology palatability palatable palatableness palatal palatalised palatalized palatial palatinate palatine palaver pale palely paleness paleontology paler pales palest palette palingenesis palisade pall pallbearer pallet pallette palliate palliation palliative pallid pallidly pallidness pallium pallor pally palm palmate palms palmy palooka palpable palpate palpebra palpitate palpitation pals palsgrave palsy palter paltry paly pam pammed pammer pamming pamper pampered pamperer pampering pamphlet pams pan panacea panache panama pancake pancakes pancreas panda pandanus pandar pandas pandemic pandemonium pander panderer pandowdy pane panegyric panel paneling panelling panels panes pang pangolin pangs panhandle panic panicked panicky panics panini panned panner pannier panning panoplied panoptic panoptical panopticon panorama panpipe pans pansies pansy pant pantaloon panted panter pantheism pantheon panther panthers pantie panties pantieses panting pantomime pantomimer pantomimist pantries pantry pantryman pants pantses panty pantywaist pap papa papacy papaia papal papas papaw papaya paper paperer paperhanger paperlike papers papery papilla papism papist papistic papistical pappa paprika paprikas papyrus par para parable parabolic parabolical parachute parachutes parachuting parade paraded parader parades paradiddle paradigm paradigmatic parading paradise paradises paradox paraffin paragon paragraph paragraphs parakeet parakeets parallel paralleled paralleler paralleling parallelism parallels paralyse paralysis paralytic paralytical paralyze paralyzed paramedic paramedical paramedics parameter paramount paramour paranoiac paranoid paranormal parapet paraphernalia parapraxis paraquet parasite parasitic parasitical parasol paratrooper parazoan parboil parcel parceling parcelling parch parched parchment parchments pardner pardon pardoned pardoner pardoning pardons pare parenchyma parent parentage parental parenteral parenthesis parenthood parents parer parfait parget pargeting pargetry pargetting pariah paries paring paris parish parity park parka parked parker parking parkings parkland parks parkway parky parlance parliament parliamentarian parliamentary parliaments parlor parlors parlour parlous parochial parodies parody parole parolee paroles paronomasia paronychia paroquet parousia paroxysm parquet parr parrakeet parricide parroket parroquet parrot parrots parry parsimonious parsimoniousness parsimony parsley parsleys parsnip parson part partake parted parter parterre parthenogenesis parthenogenetic parthenogeny partial partiality partially partials participant participate participated participater participates participating participation particle particolored particoloured particular particularise particularity particularize particularly parties parting partisan partisans partisanship partita partition partitioning partitive partizan partlier partlies partliest partlily partliness partly partner partners partnership partridge partridgeberry parts parturiency parturient parturition party parvenu parvenue pascal paseo pashto pashtu pasquinade pass passable passably passado passage passages passageway passe passed passee passel passementerie passenger passengers passer passes passim passing passion passionate passionately passionateness passionfruit passionless passions passive passiveness passives passivism passivity passkey passport password passwords past pasta pastas paste pasted pastel pasteler pastelest pastelike pastelly pastelness paster pastes pastest pastiche pastime pasting pastly pastness pastor pastoral pastorale pastorate pastors pastorship pastry pasts pasturage pasture pastureland pastures pasty pat patch patched patches patchouli patchouly patchwork pate patella patency patent patenter patentest patently patentness patents paterfamilias paternal paternity paternoster path pathetic pathetically pathfinder pathless pathogen pathogenic pathologic pathological pathology pathos paths pathway pathways patience patiences patient patients patina patio patios patois patriarch patriarchal patriarchate patriarchy patrician patricide patrimonial patrimony patriot patrioteer patriotic patriotism patristics patrol patroled patroler patroling patrolman patrology patrols patron patronage patronise patronising patronize patronizing patrons pats patsy patted patten patter pattern patterns patties patting patty paucity paul paunch pauperisation pauperise pauperism pauperization pauperize pause pauses pavage pavan pavane pave paved pavement pavements paver paves pavilion pavilions paving pavlova paw pawed pawer pawing pawl pawn pawned pawnee pawner pawning pawns pawpaw paws paxto pay payback paycheck paychecks paygrade paying payload payment payments payoff payout payroll payrolls pays paysheet pcp pct pda pea peace peaceable peaceableness peaceful peacefulness peacekeeper peacemaker peacenik peaces peach peaches peachwood peachy peacock peacocks peag peak peaked peaks peal pealing peals pean peanut peanuts pear pearl pearler pearlescent pearlest pearlly pearlness pearls pears peas peasant peat peats pebble pebbles pebbly pebibyte pecan peccadillo peck pecked pecker peckerwood pecking peckish pecks pecs pectoral pectoralis pectus peculate peculation peculiar peculiarity peculiarly pecuniary pedagogics pedagogy pedal pedals pedant pedantic pedate peddle peddler pedestal pedestrian pedestrians pedigree pedigreed pedlar peduncle pee peeing peek peeked peeker peeking peeks peel peeled peeler peeling peels peep peeper peephole peepshow peer peered peerer peeress peering peerless peers peeved peevish peevishly peevishness peewee peewit peg pegasus pegged pegger pegging pegleg pegs pehlevi peignoir pel pelage pelagic pelf pelican pelicans pellet pellitory pellucid pellucidity pellucidness pelmet pelt pelted pelter pelting pelts pelvis pelvises pen penal penalisation penalise penalization penalize penalized penalizer penalizes penalizing penalties penalty penance penchant pencil pencils pendant pendants pendent pending pendulous penetrable penetrate penetrating penetration penetrative pengo penguin penguins peninsula peninsulas penis penitence penitential penitentiary penman pennant penned penner pennies penniless pennilessness penning pennon pennsylvania penny pennyroyal pennywhistle pens pension pensionary pensioner pensions pensive pensiveness penstock pent pentad pentagon pentateuch penthouse penthouses pents penurious penuriousness penury peon peonage people pep peplos peplum peplus pepper peppercorn peppermint pepperoni pepperonis peppers pepperwort peppiness peppy per peradventure perambulate perambulation perambulator perceivable perceive perceived perceiver perceives perceiving percent percentage percentages percents percept perceptible perception perceptions perceptive perceptiveness perceptivity perch perchance percher perches percolate percolation percussion percy perdition perdurable peregrine peremptory perennial perfect perfection perfective perfectly perfects perfervid perfidious perfidiousness perfidy perforate perforated perforation perform performance performances performed performer performing performs perfume perfumed perfumery perfunctory perfuse pergola perhaps perhapses peri perianth perigone perigonium peril perilous perimeter period periodic periodical periods peripatetic peripheral periphery periphrasis perish peristalsis peristome periwinkle perk perkiness perks perky perm permanent permeate permeation permissible permission permissions permissive permissiveness permit permits permitted permutation permute pernicious perniciously perniciousness pernickety perorate peroration peroxide perpendicular perpendicularity perpendicularly perpetration perpetual perpetually perpetuation perplex perplexed perplexing perquisite perry persecute persecutor perseverance perseveration persevere persevering persimmon persist persisted persistence persistency persistent persistently persister persisting persists persnickety person persona personage personal personalise personalised personalities personality personalize personalized personally personas personate personation personification personify personnel persons perspective perspectives perspicacious perspicaciousness perspicacity perspicuous perspiration perspire perspirer persuade persuaded persuader persuades persuading persuasion persuasive persuasiveness pert pertain pertinacious pertinacity pertinent pertness perturb perturbation perturbed perturbing pervade pervasion perverse perversely perverseness perversion perversity perversive pervert perverted pes pesky peso pessary pessimism pessimistic pest pester pesterer pestering pesthouse pesticide pestiferous pestilence pestilent pestilential pestis pestle pesto pests pet petabyte petal petals petite petiteness petition petitioner petitions petrifaction petrification petrified petrify petrol petroleum pets petted petter pettier pettiest pettifog pettifogger pettifoggery pettily pettiness petting pettish pettishly pettishness petty petulance petulant petulantly petunia petunias pew pewee pewit pews peyote pfalz phalanger phalanx phallic phallus phantasm phantasma phantasmagoric phantasmagorical phantasmal phantasy phantom pharisaic pharisaical pharisee pharmaceutic pharmaceutical pharmaceutics pharmacies pharmacist pharmacists pharmacy pharos pharyngeal pharynx phase phaseout phases pheasant pheasants phellem phenol phenomena phenomenal phenomenon pheresis philander philanthropic philharmonic philia philippic philippines philistine philistinism philology philosopher philosophic philosophical philosophically philosophies philosophy phishing phiz phlebotomise phlebotomize phlegm phloem phoebe phoenix phonate phonation phone phoner phones phonetic phoney phonic phony phosphate phosphorus photalgia photo photocopy photoengraving photoflash photoflood photograph photographer photographers photographic photographies photographs photography photogravure photometer photomosaic photon photophobia photos photostat photosynthesis photovoltaic phrase phraseology phrases phrasing phratry phrenetic phthisis phylogenesis phylogeny phylum physic physical physicalism physicality physicalness physician physics physicses physiognomy physiologic physiological physiology physique phytology pianissimo pianist pianistic piano pianoforte pianos piaster piastre piazza pib pibgorn pic pica picayune pick pickaback pickax pickaxe picked picker pickerel picket picking pickle pickles pickpocket picks pickup pickups picky picnic pictorial pictural picture pictured pictures picturesque picturesqueness picturing piddle piddling pie piebald piece pieces pied piedmont piemonte pieplant pier pierce pierced piercing piercingly pieris piers pies pietism pietistic pietistical piffle piffling pig pigboat pigeon pigeonhole pigeonholing pigeons pigfish piggish piggishness piggy piggyback pigheadedness piglet piglets pigment pigmentation pigmy pigpen pigs pigsty pigswill pigwash pigweed pika pike pikes pilchard pile piled piler piles pileus pilfer pilferer pilgrim pilgrimage piling pill pillage pillaged pillager pillaging pillar pillars pillbox pillock pillory pillow pillowcase pillows pills pilot pilotage piloting pilots pilus pima pimento pimiento pimp pimpernel pimple pin pinafore pincer pinch pinched pinches pine pineal pineapple pineapples pined piner pines pinfish ping pings pinhead pining pinion pinioned pink pinker pinkest pinkish pinkly pinkness pinko pinks pinna pinnace pinnacle pinned pinner pinning pinnule pinny pinpoint pinprick pins pinstripe pint pintado pinto pinwheel pioneer pioneers pip pipage pipe pipefish pipeline piper pipes pipework piping pipit pipped pipper pipping pips piquance piquancy piquant piquantness pique piquet piracy pirana piranha piranhas pirate piratical pirogue pisces pismire piss pissed pisser pisses pissing pistachio piste pistillate pistol pistols piston pit pitahaya pitch pitched pitcher pitcherful pitchers pitches pitchfork pitching pitchman pitchy piteous pitfall pith pithy pitiable pitiably pitiful pitiless pitilessness pitman pitprop pits pitted pitter pitting pity pivot pivotal pixel pixels pixie pixilated pixy pizza pizzas pizzaz pizzazz pizzeria pizzerias placard placate placation place placeable placebo placed placeholder placemat placement placenta placentation places placid placider placidest placidity placidly placidness plagiarisation plagiariser plagiarism plagiarisms plagiarist plagiarization plagiarizer plague plaguey plaguily plaguy plaice plaid plaids plain plainer plainest plainly plainness plains plainspoken plaint plaintiff plaintiffs plaintifves plaintive plait plan plane planer planes planet planetal planetarium planetary planets plangency plank planking planks planless planly planned planner planness plannest planning plans plant plantain plantation plantations planted planter planting plants plaque plash plasm plasma plasmodium plaster plastered plasterer plastering plasters plasterwork plastic plasticise plasticize plastics plastron plat platan plate plateau plateaus plateful platen plates platform platforms plating platinum platitude platitudinal platitudinous platonic platonism platoon platter platypus platypuses plaudit plaudits plausible plausibly plausive play playact playacting playactor playback playbook played player players playful playfulness playfuls playground playgrounds playing playlist playlists playoff playoffs playofves playpen plays playscript plaything playwright plaza plazas plea pleach plead pleader pleads pleas pleasance pleasant pleasantly pleasantness please pleased pleaseds pleaser pleases pleasing pleasurable pleasurably pleasure pleasures pleat pleating plebeian plectron plectrum pledge pledged pledger pledges pledging pleiades plenaries plenary plenitude plenteous plenteousness plentier plenties plentiest plentiful plentifulness plentily plentiness plentitude plenty plenum pleomorphism pleonastic plethora plethoric pleximetry pliability pliable pliancy pliant plianter pliantest pliantly pliantness plica plicate plication plied pliers plierses plies plight plimsoll plinth plod plodded plodder plodding plods plonk plop plosion plosive plot plots plotted plotter plotters plotting plough ploughland ploughshare plover plow plowed plower plowing plowland plows plowshare ploy ployed ployer ploying ploys pluck plucked pluckiness plucks plucky plug plugged plugger plugging plugin plugins plugs plum plumage plumate plumb plumbable plumbago plumber plumbery plumbest plumbing plumbings plumbly plumbness plumcot plume plumed plumelike plumes plummed plummer plummet plumming plummy plumose plump plumper plumpest plumply plumpness plums plumy plunder plundered plunderer plundering plunders plunge plunged plunger plunges plunging plunk plunker plural pluralism pluralist plurality plus pluses plush plushy plusly plusness plussed plusser plussest plussing pluto ply plyboard plyer plyers plying plywood pneumoencephalogram pneumogastric pneumonia pneumonias pneumonic poach poached poacher poaches poaching pock pocked pocket pocketbook pockets pockmarked pod podcast podcasts podded podder podding podgy podium pods poeciliid poem poems poesy poet poetic poetical poeticer poeticest poeticly poeticness poetise poetize poetries poetry poets pogey pogy poignance poignancy poignant poilu poinciana point pointed pointedness pointeds pointer pointillism pointless pointlessness points poise poised poiser poises poising poison poisoning poisonous poisons poke poked poker pokers pokes pokey poking poky pol polar polarisation polarise polarity polarization polarize polarly polarness polarrer polarrest polars pole poleax poleaxe polecat polemic polemical polemicist polemist poles police policeman polices policies policy polio poliomyelitis polios polish polished polisher polishes polishing polite politely politeness politer politesse politest politic political politically politician politicians politico politics politicses polity polka polkas poll pollack pollard polled pollen pollenate poller pollex pollinate polling polliwog pollock polls pollster pollute polluted pollutes pollution pollutions pollyannaish pollywog polo polonium polos poltroon polychromatic polychrome polychromic polyester polyesters polygamous polyglot polymer polymerise polymerize polymers polymorphic polymorphism polymorphous polyoicous polyp polyphonic polyphonous polyplacophore polypus polysyllabic polysynthetic polyvalence polyvalency polyvalent pomegranate pomelo pommel pomo pomp pompadour pompano pompey pompon pomposity pompous pompousness ponce poncho ponchos pond ponder ponderable pondered ponderer pondering ponderosity ponderous ponderously ponderousness ponders ponds pondweed poniard ponies pons pontiff pontifical pontificate pontoon pony ponytail ponytails poodle poodles poof pool pooled pooler pooling pools poon poop poor poored poorer poorest pooring poorlies poorly poorness poors poove pop popcorn popcorns pope popery popes popeyed popinjay popish poplar popped popper popping poppycock pops popsicle populace popular popularisation popularise populariser popularization popularize popularizer populars populate population populations popup popups porc porch porches porcine porcupine porcupines pore pores porgy poriferan poriferous pork porks porn porno pornographic pornography porous porpoise porpoises porridge porridges port porta portable portage portal portals portend portent portentous porter porterage portfolio portfolios porthole porticoed portion portions portland portly portmanteau portrait portraits portraiture portray portrayal portrayed portrayer portraying portrays ports portsmouth pose poser poses poseur posing posit position positioning positions positive positively positiveness positivism positivist positivistic positivity possess possessed possesser possesses possessing possession possessive possessor possibilities possibility possible possibleness possibly possum possums post postage postal postals postbag postbox postcard postcode postdate postdoc postdoctoral poster posterior posteriority posterity posters postiche posting postman postmark postmortal postmortem postpone postponed postponement postponer postpones postponing posts postscript postulate postulation postulational postulator posture posy pot potable potage potassium potassiums potation potato potatos potbelly potbound potence potency potent potentate potenter potentest potential potentiality potentials potentiometer potently potentness pother potholed pothos pothouse pothunter potion potions potomania potpourri pots potshot pottage potted potter pottery potting potto potty pouch pouches pouf pouffe poulet poultice poultry pounce pounced pouncer pounces pouncing pound poundage pounder pounding pounds pour pourboire poured pourer pouring pours pout pouted pouter pouting pouts poverties poverty pow powder powdered powderer powderest powderiness powderise powderize powderly powderness powderpuff powdery power powered powereds powerful powerfully powerfulness powerhouse powerlessness powers pows powwow pox poxes practicable practical practically practice practiced practicer practices practicing practise praetorial praetorian pragmatic pragmatical pragmatism pragmatist prairie prairies praise praises pram prance prank prankish prankishness pranks prankster prat prate prater pratfall prattle prawn prawns praxis pray prayed prayer prayers praying prays prc preach preaches preachify preaching preassemble precarious precariousness precaution precede preceded precedence precedency precedent preceder precedes preceding precentor precept preceptor precession precinct precincts preciosity precious preciously preciousness precipitance precipitancy precipitant precipitate precipitately precipitateness precipitation precipitous precipitously precipitousness precis precise preciselied preciselies precisely preciselyer preciselying preciseness precision preclude precocious precognitive preconception precondition precursor predaceous predacious predate predation predator predatory predecessor predestinate predestination predestine predetermination predetermine predicament predicate predication predict predictable predicted predicter predicting prediction predictor predicts predilection predisposition predominance predominant predominate predomination preeminence preempt preemption preemptor preen prefabricate preface prefatorial prefatory prefecture prefer preferable preferably preference preferent preferential preferment preferred prefers prefiguration prefigure preform pregnancy pregnant prehend prehensile prehension prehistoric prehistorical preindication prejudice prejudiced prejudicial prejudicious prelacy prelate prelature prelim preliminary preliterate prelude premature prematurely premedical premeditate premeditation premier premiere premieres premise premiss premium premiums premix premonition prentice preoccupancy preoccupation preoccupied preoccupy preordain preordination prep preparation preparations prepare prepared preparedness preparer prepares preparing preponderance preponderant preponderate preponderating preposition prepossess prepossession preposterous prepotency prepuce prequel prequels prerequisite prerogative presage presbyopia presbyopic preschool preschools prescience prescribe prescribed prescriber prescribes prescribing prescript prescription prescriptions prescriptive prescriptivism presence presences present presentation presenter presentiment presently presentment presents preservation preserve preserved preserver preserves preserving presidency president presidential presidentials presidents presidentship press presses pressing pressman pressure pressures pressurise pressurize prestidigitator prestige prestigious prestigiousness presto presume presumed presumer presumes presuming presumption presumptive presumptuous presumptuousness presuppose pretence pretend pretended pretender pretending pretense pretension pretentious pretentiousness pretermit preternatural pretext pretorial pretorian pretties prettify pretty pretzel pretzels prevail prevailing prevalence prevalent prevaricate prevarication prevaricator prevent preventative prevented preventer preventing prevention preventive prevents preview previews previous previously previse prevision prevue prexy prey preys priapic price pricelessness prices pricey prick pricker pricket pricking prickle prickliness prickling prickly prickteaser pricy pride prideful pridefulness prides pried pries priest priestcraft priestlike priestly priests prig priggish priggishness prim primaeval primal primaries primarily primary primate prime primely primeness primer primes primest primeval priming primitive primitively primitiveness primitivism primmed primmer primming primness primordial primp prims primus prince princedom princeling princely princes princess princesses principal principality principally principals principle principles prink print printer printers printing prints prior priorities prioritise prioritize prioritized prioritizer prioritizes prioritizing priority priors prise prism prismatic prisms prison prisonbreak prisoner prisoners prisons prissy pristine privacies privacy private privateer privateersman privately privateness privates privation privatise privatize privilege privileged privileges privy prize prizefighter prizes pro proactive probabilism probabilistic probability probable probably probate probation probationary probationer probations probe probes problem problematic problematical problems proboscis procedural procedure procedures proceed proceeded proceeder proceeding proceedings proceeds process processed processer processes processing procession processional processor processors proclaim proclamation proclivity proconsul procrastinate procrastination procreate procreation procreative proctor procural procurance procurator procure procurement procurer prod prodded prodder prodding prodigal prodigality prodigious prodigy prods produce produced producer produces producing product production productions productive productiveness productivity products prof profanation profane profanely profaneness profess professed professedly professer professes professing profession professional professionalise professionalize professions professor professors professorship proffer proficiency proficient profile profiles profit profitability profitableness profitlessly profits profligacy profligate profound profoundly profoundness profundity profuse profusely profuseness profusion progeny progestational prognosis prognostic prognosticate prognostication prognosticator program programing programme programmer programmers programming programs progress progresses progression progressive progressively prohibit prohibited prohibiter prohibiting prohibition prohibitionist prohibits project projected projecter projectile projecting projection projector projects prolate prole proletarian proletariat proliferate proliferation prolific prolificacy prolong prolongation prolonged prolusion prom promenade prominence prominent prominently promiscuous promiscuously promise promised promiser promises promising promo promontory promote promoted promoter promotes promoting promotion promotional promotions prompt prompter prompting promptitude promptly promptness prompts promulgate promulgation prone pronely proneness proner pronest pronged prongy pronounce pronounced pronouncement pronouncer pronounces pronouncing pronto pronunciation proof proofread proofreader proofs prooves prop propaganda propagandise propagandize propagate propagation propagator propane propel propellant propellent propeller propellers propelling propellor propensity proper properer properest properly properness propers properties property prophase prophecies prophecy prophesier prophesy prophet prophets prophylactic propinquity propitiate propitiation propitiative propitiatory proponent proportion proportional proportionality proportionally proportionate proportionately proportionateness proportions proposal proposals propose proposed proposer proposes proposing proposition propped propper propping proprietary proprietor proprietorship props propulsion propulsive prorate prorogue pros prosaic prosaically proscenium proscribe proscribed proscription prose prosecute prosecution prosecutions prosecutor prosecutors proselytism prosodion prosody prosopopoeia prospect prospective prospects prospectus prosper prospered prosperer prospering prosperity prosperous prospers prospicience prospicient prosthetic prostitute prostrate prostration prosy protactinium protagonist protect protected protecter protecting protection protections protective protectiveness protector protects protein proteins protest protestant protestation protester protests proteus protoactinium protocol proton prototype protract protracted protraction protrude protrusion protuberance protuberant protuberate proud prouder proudest proudly proudness prouds provable prove proved proven provenance provender provener provenest provenience provenly provenness provens proverb proverbial proves provide provided providence provident providential providentially provider provides providing province provinces provincial provincialism proving provision provisional provisionary provisioner provisions proviso provocation provocative provoke provoked provoker provokes provoking prow prowess prowl prowler prows proximate proximity proxy prude prudence prudent prudently prudery prudish prudishness prune prunella pruner pruning prurient pry pryer prying psalm psalms pseud pseudo psilosis psittacosis psyche psychedelic psychiatrist psychiatry psychic psychical psychoanalyse psychoanalysis psychoanalyst psychoanalyze psychodynamics psychogenesis psychogenetic psychogenic psychological psychologically psychologies psychologist psychologists psychology psychoneurotic psychopathology psychotherapeutic psychotherapeutics psychotherapy ptomain ptomaine ptyalise ptyalize pub pubbed pubber pubbing puberties puberty puberulent pubes pubescence pubescent public publication publicer publicest publicise publicity publicize publicizing publicly publicness publics publish published publisher publishes publishing pubs puccoon puck pucker puckish puckishness pucks pud pudding puddings puddle puddles pudgy pueblo puerile puerility puff puffball puffer pufferfish puffiness puffing puffy pug pugged pugger pugging pugilism pugilist pugnacious pugnacity pugs puka puke puking pule pull pullback pulled puller pullet pulley pulling pullout pullover pulls pullulate pullulation pulmonary pulmonic pulp pulpiness pulpit pulps pulpy pulsar pulsate pulsation pulse pulseless pulses pulsing pulverisation pulverise pulverised pulverization pulverize pulverized puma pumas pummel pummelo pump pumped pumper pumping pumpkin pumpkins pumps pun punch puncher punches punctilio punctilious punctiliousness punctual punctuality punctuals punctuate punctuation puncture punctured pundit pungency pungent pungently punic puniness punish punishable punished punisher punishes punishing punishment punishments punk punned punner punning puns punt punter punting punts puny pup pupil pupils puppet puppetry puppets puppies puppy pups purau purblind purchasable purchase purchaser purchases purdah pure pureblood pureblooded purebred puree purely pureness purer pures purest purgation purgative purgatorial purgatory purge purged purger purges purging purification purify purifying purine puritan puritanic puritanical puritanism purity purl purlieu purloin purloo purple purpleness purpler purples purplest purplish purply purport purpose purposeful purposeless purposely purposes purposive purpurate purr purse purses pursual pursuance pursue pursued pursuer pursues pursuing pursuit pursuits pursy purulence purulency purvey purview pus push pushcart pushchair pushed pusher pushes pushful pushiness pushing pushover pushup pushy pusillanimous puss pussy pussycat pussyfoot put putrefaction putrescence putrid putridness puts putsch putt putter putting putz puzzle puzzled puzzlement puzzler puzzles puzzling pygmy pyjama pylon pyorrhea pyorrhoea pyramid pyrectic pyrene pyrethrum pyrexia pyrimidine pyrogen pyrogenetic pyrogenic pyrogenous pyrola pyrotechnic pyrotechnical pyrotechnics pyrotechny pyrrhic pythia python pythoness pyxidium pyxie pyxis qabala qabalah qabalistic qabbala qabbalah qat qibla quack quackery quackgrass quad quadrangle quadrant quadrate quadratic quadriceps quadrilateral quadrille quadrillion quadruple quadruplet quadruplex quadruplicate quaff quag quaggy quagmire quahaug quahog quail quails quaint quaintly quaintness quake quaker qualification qualified qualifier qualifies qualify qualifyer qualifying qualitative qualities quality qualm quandang quandary quandong quantification quantifier quantify quantise quantitative quantity quantize quantong quantum quantums quarantine quark quarrel quarrels quarrelsome quarry quart quarter quarterback quarterbacks quartering quarterly quartern quarters quartet quartette quartic quarts quartz quash quashed quasher quashes quashing quassia quat quatern quaternary quaternate quaternion quaternity quaver quayage queasiness queasy quebec queen queens queer queerly queerness quell quelled quelling quench quenched quenching quercitron querulous querulously query quest quester question questionable questionably questioning questioningly questionnaire questions quests quetch quetzal queue queues quibble quibbler quiche quick quicken quickening quicker quickest quicklies quicklime quickly quickness quicks quicksand quicksilver quickstep quid quiddity quiesce quiescence quiescency quiescent quiet quieten quieter quietest quietly quietness quiets quietude quietus quill quilt quilting quilts quin quince quint quintal quintessence quintet quintette quintuple quintuplet quip quirk quirkiness quirky quisling quislingism quit quitclaim quite quites quits quittance quitting quiver quivering quixotic quiz quized quizer quizes quizing quizzical quizzically quoin quota quotable quotas quotation quotations quote quotes quotidian quotient quran rabbet rabbi rabbinate rabbis rabbit rabbits rabble rabid rabidly rabies rabieses raccoon raccoons race racecourse raced racer races racetrack raceway rachis rachitic rachitis racial racialer racialest racialism racialist racially racialness raciness racing racings racism racisms racist rack racked racker racket rackets rackety racking racks racoon racquet racquetball racy radar radars raddle raddled radial radiance radiancy radiant radiate radiation radiator radical radicals radii radio radioactive radioactivity radiocommunication radiogram radiograph radiography radiolocation radiology radiophone radios radioscopy radiotelegraph radiotelegraphy radiotelephone radiotelephony radiotherapy radish radishes radius raetam raffia raffish raffishly raft rafter raftman rafts raftsman rag ragamuffin ragbag rage raged rager rages ragged raggedly raggedness ragger ragging raging rags ragtag ragtime ragweed ragwort raid raided raider raiding raids rail railcar railhead railing railings raillery railroad railroads rails railway railyard raiment rain rainbow rainbows raincoat rained rainer rainfall rainfly rainforest raining rainmaker rainproof rains rainwater raise raised raiser raises raisin raising raisins raja rajah rake raked rakehell raker rakes raking rakish rakishly rakishness rale rallies rally rallying ram ramate ramble rambler rambling rambotan rambunctious rambutan ramekin ramequin ramification ramify rammed rammer ramming ramose ramous ramp rampant rampart ramped ramper ramping ramps ramrod rams ramshackle ran ranch rancher ranchers ranches rancid rancor rancour rand random randomer randomest randomly randomness randoms randy rang range ranger rangers ranges rangs rangy rank ranked ranker rankest ranking rankle rankly rankness ranks ranned ranner ranning rans ransack ransacked ransacking ransom ransomed ransomware rant ranted ranter ranting rants rap rapacious rapaciousness rapacity rape raped raphia rapid rapidder rapiddest rapidly rapidness rapids rapier rapped rapper rapping rapport rapports rapprochement raps rapscallion rapt raptor raptorial raptors rapture rapturous raptus rare rarefied rarefy rarelies rarely rareness rarer rares rarest rarified rarify rarity rascal rascality rascally rase rash rashes rashly rashness rasp raspberries raspberry raspier raspiest raspily raspiness rasping raspy rassling rasta rastafarian rat ratability ratafee ratafia ratan rataplan rate rateability rated rater rates rather rathole ratification ratified ratifier ratifies ratify rating ratings ratio ratiocination ration rational rationale rationalisation rationalise rationalism rationality rationalization rationalize rationalness ratios rats ratsbane rattail rattan ratted ratter ratting rattle rattlebrained rattled rattlepated rattler rattlesnake rattling rattrap ratty raucous raucously raunch raunchy rauvolfia rauwolfia ravage ravaged ravaging rave raved ravel raven ravening ravenous ravenousness ravens raver raves ravine raving ravish ravisher ravishment raw rawed rawer rawest rawing rawly rawness raws ray rayed rayer raying rayon rays raze razing razorback razz razzing reach reachable reaches reaching react reaction reactions reactive reactivity reactor reacts read readability readapt reader readers readier readiest readilies readily readiness reading readjust readjustment readmit readout reads ready readying reagent real realer realest realisation realise realised realism realist realistic realistically realities reality realizable realization realize realized realizer realizes realizing reallocate reallocation reallotment really realm realms realness reals realtor realtors ream reamer reanimate reanimated reap reaped reaper reaping reappearance reapportion reapportionment reappraisal reaps rear reared rearer rearing rearm rearrange rears rearward rearwards reason reasonable reasonableness reasonably reasonless reasons reassert reassessment reassure reassured reata reave reb rebarbative rebate rebates rebel rebellion rebellions rebellious rebelliousness rebels rebirth reboot reboots reborn rebound rebounded rebounder rebounding rebounds rebrand rebroadcast rebuff rebuild rebuilded rebuilder rebuilding rebuilds rebuke rebut rebuttal rebutter recalcitrant recall recalled recaller recalling recalls recant recantation recap recapitulate recapitulation recapture recast recede receding receipt receipts receive received receiver receivership receives receiving recency recent recently recentness recents receptacle reception receptionist receptionists receptive receptor recess recessed recesses recession recessional recessionary recessive recharge recherche recidivate recidivist recipe recipes recipient reciprocal reciprocality reciprocally reciprocate reciprocation reciprocative reciprocatory reciprocity recital recitation recite recited reciter recites reciting reckless recklessness reckon reckoned reckoner reckoning reckons reclaim reclaimed reclaimer reclaiming reclaims reclamation recline recliner recliners recluse reclusive recognisable recognise recognised recognition recognizable recognize recognized recognizer recognizes recognizing recoil recollect recollection recollective recombination recombine recommence recommend recommendation recommendations recommended recommender recommending recommends recommit recompense reconcile reconciled reconciler reconciles reconciliation reconciling recondite reconditeness reconfigure reconnoiter reconnoitre reconsider reconsideration reconstitute reconstruct reconstruction reconstructive record recorded recorder recording records recount recounting recoup recourse recover recovered recoverer recovering recovers recovery recreant recreate recreation recreational recreations recrudesce recruit recruited recruiter recruiting recruits rectangle rectangular rectification rectifier rectify rectitude rector recumb recuperate recuperation recuperative recur recurrence recurrent recurring recusal recusant recusation recuse recycle recycled recycler recycles recycling red redact redaction redactor redbird redbreast redbug redcap redded redden reddened redder reddest redding reddish reddle rede redeem redeemable redeemed redeemer redeeming redefine redemption redemptional redemptive redemptory redeposit redevelop redevelopment redfish redhead redheader redirect redly redneck redness redo redolence redolent redouble redoubt redoubtable redound redpoll redress redroot reds redstart redtail reduce reduced reducer reduces reducing reduction reductionism reductions redundance redundancy redundant reduplicate reduplication redwing redwood redwoods reecho reed reedbird reedlike reedmace reeds reedy reef reefer reefs reek reeking reel reeled reeler reeling reels reenact reenforce reenforcement reestablish reeve reeves reexamination reexamine ref reface refactoring refashion refer referable referee refereeing referees reference references referendum referendums referent referral referrals referred referrer referring refers refill refilling refine refined refinement refining reflate reflect reflectance reflected reflecter reflecting reflection reflections reflective reflectiveness reflectivity reflector reflects reflex reflexion reflexive reflexiveness reflexivity reflexology reflux refocus reforge reform reformable reformation reformed reformer reforming reformist reforms reformulate refract refractile refraction refractive refractory refrain refrained refrainer refraining refrains refresh refreshed refreshen refresher refreshful refreshfully refreshing refreshingly refreshment refrigerate refrigerated refrigerater refrigerates refrigerating refrigeration refrigerator refrigerators refuel refuge refugee refugees refulgence refulgency refulgent refund refunds refurbish refurbishment refusal refuse refused refuser refuses refusing refutable refutal refutation refute refuter regain regained regainer regaining regains regal regale regalia regaller regallest regally regalness regard regarded regarder regarding regards regardses regency regenerate regeneration regent reggae reggaes regicide regime regimen regiment regimes regiomontanus region regional regionalism regions register registered registers registrar registration registry regnant regorge regress regression regressive regret regretful regrets regrettably regroup regular regularisation regularise regularity regularization regularize regularly regulars regulate regulated regulater regulates regulating regulation regulations regulative regulator regulatory regulus regurgitate regurgitation rehabilitate rehabilitation rehabilitative rehash rehearsal rehearsals rehearse rehearsed rehearser rehearses rehearsing reheel reification reign reigning reigns reimagine reimburse rein reincarnate reincarnation reindeer reindeers reinforce reinforced reinforcement reinforcer reinforces reinforcing reins reinstate reinstatement reinsure reinterpret reinterpretation reinvent reinvest reinvigorate reinvigorated reissue reiterate reiteration reject rejected rejecter rejecting rejection rejects rejoice rejoicing rejoin rejoinder rejuvenate rejuvenation rekindle relapse relapsed relapser relapses relapsing relate related relateds relater relates relating relation relations relationship relationships relative relatively relatives relativistic relativities relativity relax relaxation relaxed relaxer relaxes relaxing relay relays release released releaser releases releasing relegate relegating relegation relent relentless relevant reliable reliables reliance relic relict relied relief reliefs relies relieve relieved reliever relieves relieving relievo religion religionism religions religiosity religious religiousism religiously religiousness reline relinquish relinquishing relinquishment relish relished relisher relishes relishing reload relocate relocation reluctance reluctant reluctants rely relyer relying remain remainder remained remainer remaining remains remainses remake remand remark remarkable remarkably remarked remarker remarking remarks rematch rematches remedial remediate remediation remedied remedies remedy remedyer remedying remember remembered rememberer remembering remembers remembrance remind reminded reminder remindful reminding reminds reminiscence reminiscent remise remiss remission remissness remit remitment remittal remittance remix remixes remnant remodel remodeled remodeler remodeling remodels remold remonstrance remonstrate remonstration remorseful remorseless remote remotely remoteness remotes remotion remould remount removable removal removals remove removed removeds remover removes removing remunerate remunerated remuneration remunerative renaissance renal renals rename renascence rend rended render rendered renderer rendering renders rendezvous rending rendition rends renegade renege renegociate renegotiate renew renewable renewal renewed renewer renewing renews renormalise renormalize renounce renouncement renovate renovation renown renowned rent rental rentals rented renter renting rents renunciation reorder reorganisation reorganise reorganization reorganize reorient reorientate reorientation rep repaint repair repaired repairer repairing repairs reparation repast repatriate repay repayment repays repeal repealed repealer repealing repeals repeat repeatable repeated repeater repeating repeats repel repellant repelled repellent repeller repelling repels repent repentance repercussion repertoire repertory repetition repetitious repetitive replace replaceability replaced replacement replacer replaces replacing replay replays replenish replenishment replete repletion replica replicate replication replies reply repoint report reportable reportage reported reporter reporting reports repose repositing reposition repository repossess repp reprehensible reprehension reprehensively represent representation representations representative representatives represented representer representing represents repress repression reprieve reprimand reprint reprinting reprise reprize reproach reproachful reprobate reprobation reprocess reproduce reproduced reproducer reproduces reproducible reproducing reproduction reproductive reproof reproval reprove reproving reps reptile reptiles reptilian republic republican republicans republication republics republish republishing repudiate repudiation repugn repugnance repugnant repulse repulsed repulsion repulsive repulsively repulsiveness repurchase reputable reputation repute request requested requester requesting requests requiem require required requirement requirements requirer requires requiring requisite requisition requital requite rerun rescind rescript rescue rescued rescuer rescues rescuing research researcher researchers researches reseat reseau resect reseed resemble resembled resembler resembles resembling resent resented resenter resentful resenting resentment resents reservation reservations reserve reserved reserver reserves reserving reservoir reservoirs reset resettlement reshape reshuffle reshuffling reside resided residence residency resident residential residents resider resides residing residual residuary residue residuum resign resignation resigned resignedly resigner resigning resigns resile resilience resiliency resilient resinous resiny resist resistance resistances resistant resisted resister resisting resistive resistivity resistless resistor resists resole resolute resolutely resoluteness resolution resolutions resolvable resolve resolved resolvent resolver resolves resolving resonance resonances resonant resonate resonating resonator resort resorts resound resounding resource resourceful resourcefulness resources respect respectable respectably respected respecter respectful respectfulness respecting respective respectively respects respiration respirator respire respite resplendence resplendency resplendent resplendently respond respondent responder responds response responses responsibilities responsibility responsible responsibleness responsive responsiveness rest restart restate restaurant restaurants rested rester restharrow resting restitute restitution restive restiveness restless restlessness restoration restorative restore restored restorer restores restoring restrain restrained restrainer restraint restrict restricted restricter restricting restriction restrictive restrictiveness restricts restroom restructure rests result resultant resulting results resume resumed resumer resumes resuming resupine resurface resurgence resurrect resurrection resuscitate retail retailer retailers retails retain retained retainer retaining retains retake retaked retaker retakes retaking retaliate retaliation retaliative retaliatory retard retardant retardation retardent retch retell retem retention retentive retentiveness retentivity rethink reticence reticent retick reticle reticular reticulate reticulation reticule reticulum retinue retire retired retireds retirement retirements retirer retires retiring retool retort retouch retrace retract retraction retrain retral retread retreat retreated retreater retreating retreats retrench retrenchment retribution retributive retributory retrieval retrieve retrieved retriever retrieves retrieving retro retroactive retrofit retroflection retroflex retroflexed retroflexion retrograde retrogress retrogression retrogressive retrospect retrospection retrousse retroversion retrovert return returning returns retweet retweets reunification reunify reunion reunions reunite reuse rev revaluation revalue revamp reveal revealed revealer revealing reveals reveille revel revelation revelatory revelry revenant revenge revengeful revenue revenues reverberance reverberate reverberating reverberation reverberative revere revered reverence reverend reverent reverential reverie revers reversal reverse reversed reverser reverses reversible reversing reversion reversionist revert reverting revery revet revetement revetment review reviewer reviews revile revilement revisal revise revised reviseds reviser revises revising revision revisionism revitalisation revitalise revitalised revitalising revitalization revitalize revitalized revitalizing revival revivalist revive revived revivification revivify reviving revocation revoke revolt revolted revolting revoltingly revolts revolution revolutionary revolutionise revolutionist revolutionize revolutionized revolutionizer revolutionizes revolutionizing revolutions revolve revolved revolver revolves revolving revs revue revulsion revved revver revving reward rewards rewind rework rewrite rewriter rex rhabdomancer rhabdomancy rhapsodic rhapsodise rhapsodize rhapsody rhea rhein rhenish rhenium rhetoric rhetorical rheum rheumatic rheumatism rheumatoid rheumy rhinal rhine rhino rhinoceros rhizome rhodomontade rhomb rhomboid rhomboidal rhombus rhubarb rhumba rhyme rhythm rhythms rhytidectomy rhytidoplasty rial riata rib ribaldry ribbed ribber ribbing ribbon ribbonfish ribbons ribbonwood ribcage ribcages ribgrass ribs ribwort rice ricebird rices rich richer riches richest richly richness richweed rick ricketiness rickets rickety ricochet rid riddance ridden ridding riddle riddled ride rider riders rides rideshare ridge ridgeline ridgepole ridges ridicule ridiculous ridiculousness riding ridings rids riesling rife riff riffian riffle riffraff riffs rifle rifleman rifles rift rifts rifves rig rigamarole rigged rigger rigging right righteous rightfield rightful rightfully rightfulness rightness rights rigid rigidder rigiddest rigidification rigidify rigidifying rigidity rigidly rigidness rigids rigmarole rigor rigorous rigorousness rigour rigourousness rigs rile riled rilievo rill rim rime rimed rimmed rimmer rimming rims rimy rind rinds ring ringdove ringed ringer ringing ringlet rings ringtail ringtone ringtones ringway ringworm rink rinks rinse rinsed rinser rinses rinsing riot rioted rioter rioting riotous riotously riots rip ripcord ripe ripely ripen ripened ripeness ripening ripenned ripenner ripenning ripens riper ripest riposte ripped ripper ripping ripple rippled ripples rippling rips riptide rise risen risenly risenner risenness risennest riser rises risible rising risings risk risked risker riskiness risking risks risky risotto risque rite rites ritual ritualism ritualist ritually ritz rival rivaller rivallest rivally rivalness rivalrous rivalry rivals rive river riverbank riverbanks rivers riverside rivet riveter riveting rivetter rivulet riyal rna rnas roach road roadblock roadless roadman roadrunner roads roadside roadster roam roamed roamer roaming roams roan roar roared roarer roaring roars roast roasted roaster roasting roasts rob robbed robber robbery robbing robe robed robes robin robins roble robot robotic robotlike robots robs robust robuster robustest robustious robustly robustness robusts rock rocked rocker rockest rocket rockets rockfish rockier rockies rockiest rockily rockiness rocking rocklike rockly rockness rockrose rocks rocky rod rodded rodder rodding rode roded rodeo roder rodes roding rodomontade rods roentgen rogers rogue roguery roguish roguishly roguishness roil roiled roiling roily roister role roled roleplay roler roles roling roll rollback rolled roller rollers rollick rollicking rolling rolls roma romaic roman romance romances romani romanic romanise romanism romanist romanize romanly romanner romanness romannest romans romantic romantically romanticise romanticism romanticist romanticistic romanticize romany rome romish rommany romp romper rompers romps rondeau rondel rondo rontgen rood roof roofed roofer roofing roofless roofs rooftop rooftops rooftree roofy rook rookie room roomer roomie roominess roommate roommates rooms roomy roost rooster roosters root rootage rootbound rooted rooter rooting rootle roots rootstalk rootstock rooves rope ropebark roped roper ropes ropeway ropey rophy ropiness roping ropy roquette rorqual rosaceous rose roseate rosebud rosebush rosefish rosehip roselle rosemaries rosemary roseola roses rosette rosewood rosiness rosinweed roster rosters rostrum rosy rot rota rotary rotate rotates rotation rotatory rotisserie rotogravure rotor rots rotted rotten rottenly rottenness rottenstone rotter rotting rottweiler rotund rotunda rotundity rotundness rouble roue rouge rough roughage roughcast rougher roughest roughlies roughly roughneck roughness roughs roughshod roulade rouleau roulette round roundabout roundabouts roundel rounder roundest roundhouse roundly roundness rounds roundup roundworm rouse rouser rousing rousseau rout route router routers routes routine routines routs rove roved rover roves roving row rowboat rowboats rowdily rowdiness rowdy rowdyism rowed rower rowing rowlock rows royal royalist royaller royallest royally royalness royals royalty rozelle rpm rub rubbed rubber rubberlike rubberneck rubbernecker rubbery rubbing rubbish rubbishy rubble rube rubeola rubicon rubicund rubier rubiest rubily rubiness ruble rubor rubric rubricate rubs ruby ruck ruckle rucksack ruckus ruction rudder rudderless ruddiness ruddle ruddy rude rudely rudeness ruder rudes rudest rudimentary rudiments rue rued rueful ruefulness ruer rues ruff ruffian ruffle ruffled rug rugbies rugby rugged ruggedness rugger rugging rugs ruin ruination ruined ruiner ruing ruining ruinous ruins rule ruled ruler rulers rules ruling rulings rum rumba rumble rumbling rumbustious ruminate rumination ruminative ruminator rummage rummy rumormonger rumourmonger rump rumple rumpled rumps rumpus rums run runabout runaway rundle rundown rung rungs runnel runner runners runniness running runnings runny runoff runs runt runtime runtimes runtiness runty runway runways rupee rupture rural ruralism ruralist rurality ruraller rurallest rurally ruralness rurals rush rushed rusher rushes rushing russia russian rust rusted ruster rustic rusticate rustication rusticism rusticity rustier rustiest rustily rustiness rusting rustle rustling rusts rusty rut rutabaga ruth rutherford ruthful ruthfulness ruthless ruthlessness ruts rutted rutter rutting ruttish rye ryes saame saami sabbatic sabbatical sabbatum saber sabin sabine sable sabot sabotage saboteur sabre sac saccade sacced saccer saccharify saccharine saccing sacerdotal sachem sachsen sack sackcloth sacked sacker sackful sacking sacks sacque sacral sacred sacreder sacredest sacredly sacredness sacreds sacrifice sacrificed sacrificer sacrifices sacrificing sacrilege sacrilegious sacristan sacristy sacrosanct sacs sad sadden sadder saddest saddle saddleback saddlebill saddlebow saddled saddlery saddles sadlies sadly sadness sads safari safe safeguard safekeeping safely safeness safer safest safeties safety saffron sag saga sagacious sagaciousness sagacity sagamore sagas sage sages sagged sagger sagging sagitta sags said saided saider saiding saids sail sailboat sailboats sailed sailer sailfish sailing sailor sailors sailplane sailplaning sails saint sainted sainthood saintlike saintly saints sake saked saker sakes saki saking salacious salaciousness salacity salad salads salamander salamanders salaried salaries salary sale saleroom sales salesclerk salesman salesmans salesroom salience saliency salient salientian salinity saliva salivate sally salmagundi salmon salmonberry salmoner salmonest salmonly salmonness salon salons saloon salsa salsas salsify salsilla salt saltate saltation salter saltier saltiest saltily saltiness salts saltwater saltwort salty salubrious salutary salutation salutatorian salute salvage salvation salve salvia salvo samara samba same samely sameness samer sames samest sami samoyed samoyede samoyedic samphire sample sampler samples sampling samson samurai sanatarium sanative sanatorium sanctified sanctify sanctimonious sanction sanctioned sanctions sanctuaries sanctuary sanctum sand sandal sandals sandarac sandarach sandbag sandbox sandfish sandlike sandpaper sandpapers sandpile sandpiper sandpit sands sandstone sandwich sandwiches sandwort sandy sane sanely sang sangaree sanger sangraal sangria sangs sanguinary sanguine sanguineous sanicle sanies sanitarium sanitary sanitation sanitisation sanitise sanitization sanitize sank sap saphead sapidity sapidness sapience sapient sapless sapling sapodilla saponaceous saponify sapota sapote sapped sapper sapphic sapphire sapping sappy saprophytic saps saraband sarcasm sarcasms sarcastic sarcoid sard sardine sardines sardius saree sari sarsaparilla sartor sartorial sash sashay sashes saskatoon sass sassaby sassafras sassing sassy sat satan satanic satchel satchels sate satellite satellites satiate satiation satiety satin satinpod satins satinwood satiny satire satires satisfaction satisfactory satisfied satisfies satisfy satisfyer satisfying sats satsuma satted satter satting saturate saturated saturation saturday saturdays saturn saturnalia saturnine satyr sauce sauceboat saucepan saucer sauces sauciness saucy sauk saul saunter saurel saury sausage sausages saute sauteed savage savagely savageness savagery savanna savannah savant save saved saver saves saving savings savior saviour savor savoring savorless savorlessness savorred savorrer savorring savors savory savour savouring savourless savourlessness savoury savoy savoyard savvy saw sawbill sawbones sawbuck sawed sawer sawhorse sawing sawmill saws sawyer sax saxe saxes saxony saxophone saxophones say saying sayonara says scab scabies scabrous scabs scaffold scaffolding scag scalable scalage scalar scalawag scald scale scaled scalene scales scaley scaling scallion scallop scallywag scalp scalps scaly scam scammer scammony scamp scamper scan scandal scandalisation scandalise scandalization scandalize scandalous scandals scandinavian scanned scanner scanning scans scant scantiness scantling scantness scanty scape scapular scapulary scar scarce scarcely scarceness scarcity scare scared scareds scares scarf scarier scariest scarify scarily scariness scarlet scarp scarper scarred scarrer scarring scars scarves scary scat scathe scatology scatter scatterbrained scattered scattergood scattergun scattering scatty scaup scavenge scavenger scenario scend scene scenery scenes sceneshifter scenic scent scented scentless scents scepter sceptered sceptic sceptical scepticism sceptre sceptred schadenfreude schedule schedules scheduling schema schematic schematisation schematise schematization schematize scheme schemer schemes scheming scheol schism schizoid schizophrenic schlep schlepper schlesien schmaltzy schmalzy schmoose schmooze schnittlaugh schnorchel schnorkel schnorr schnoz schnozzle scholar scholarly scholars scholarship scholarships scholastic scholasticism school schoolbook schoolchild schooldays schoolfellow schoolhouse schooling schoolman schoolmarm schoolmaster schoolmate schoolmistress schoolroom schools schooltime schoolyard schoolyards schooner schottische schrod schtick schtik sciatic science sciences scientific scientist scientists scilla scintilla scintillant scintillate scintillating scintillation sciolist scissors scissure sclaff scleroderma sclerosed sclerotic sclerotium scoff scoffer scoffing scoffingly scold scolded scolder scolding scolds scollop sconce sconces scoop scooped scooper scoopful scooping scoops scoot scooter scooters scope scopes scorch scorched scorcher scorches scorching score scorecard scorekeeper scoreless scorer scores scoria scorn scornful scornfully scorpio scorpion scorpions scorzonera scotch scoter scots scottish scoundrel scoundrelly scour scoured scourer scourge scouring scours scout scouts scow scowl scrabble scrabbly scrag scraggly scraggy scramble scrambler scranch scrap scrape scrapes scrapheap scraping scrapper scraps scratch scratched scratcher scratches scratchiness scratching scratchy scraunch scrawl scrawler scrawniness scrawny screak screaky scream screamer screaming scree screech screecher screeching screechy screed screen screening screenland screens screenshot screenshots screw screwball screwdriver screwdrivers screwing screws scribble scribbler scribe scriber scrimmage scrimp scrimpy scrimy script scripts scriptural scripture scrivener scrod scrofula scrofulous scroll scrolls scrooge scrounge scrub scrubbed scrubber scrubbiness scrubbing scrubby scrubs scruffy scrum scrumptious scrumptiously scrunch scruple scruples scrupulous scrupulously scrupulousness scrutineer scrutinise scrutinize scrutiny scud scudding scuff scuffle scull sculpt sculpted sculptor sculptural sculpture sculptured sculpturer sculpturesque scum scummy scup scupper scurf scurfy scurrilous scurry scurvy scutcheon scuttle scuttlebutt sea seaboard seacoast seafarer seafaring seafood seafoods seafront seagoing seagull seagulls seahorse seahorses seal sealed sealer sealing seals sealskin sealyham seam seaman seamed seamer seaming seamless seams seamster seamstress seamstresses seamy seance seaplane seaport sear search searched searcher searches searching seas seascape seashell seashore seashores seaside season seasonable seasonably seasonal seasoned seasoner seasoning seasons seat seatbelt seatbelts seated seater seating seats seawall seaward seawards seawater sebaceous sec secant secede secern secernate secernment secession seclude secluded seclusion second secondary secondhand secondment seconds secrecy secret secretaire secretariat secretariate secretaries secretary secrete secreter secretion secretive secretiveness secretly secretor secrets sect sectarian sectarianism sectarist sectary section sectional sectionalisation sectionalism sectionalization sectioned sections sector sectors sects secular secularisation secularise secularization secularize secure securely secureness securer secures securest securities security sedan sedate sedateness sedation sediment sedimentary sedimentation seditious seduce seducer seduction see seeable seed seedcase seeded seeder seediness seeding seedling seedpod seeds seedtime seedy seeing seek seeker seeking seekings seeks seem seemed seemer seeming seemingly seemliness seemly seems seen seens seep seepage seer sees seesaw seethe segment segmental segmentation segmented segments segregate segregated segregation seigneury seigniory seine seism seismal seismic seize seized seizing seizure seizures seldom seldomer seldomest seldomly seldomness select selected selecter selectest selection selective selectly selectness selector selects self selfer selfest selfie selfies selfish selfishes selflessness selfly selfness selfs sell sellable seller sellers selling sellings sellout sells seltzer selvage selvedge selves semantics semaphore semblance semen semester semesters semi semiannual semiannually semiaquatic semiautomatic semiconductor semiconsciousness semifinal semiliterate semimonthly seminal seminar seminars seminary semirigid semis semisweet semisynthetic semitrailer semivowel semiweekly sempiternal sempstress senate senates senator senators send sender sending sends sendup seneca senega senesce senescence senescent senile senility senior seniorer seniorest seniority seniorly seniorness seniors sens sensation sensational sensationalism sense senseless senselessly senselessness senses sensibilise sensibility sensibilize sensible sensibly sensify sensing sensitisation sensitise sensitised sensitising sensitive sensitiveness sensitivity sensitization sensitize sensitized sensitizing sensor sensorial sensors sensory sensual sensualise sensualism sensuality sensualize sensualness sent sentence sentences sententious sentience sentiency sentient sentiment sentimental sentimentalise sentimentalism sentimentalist sentimentality sentimentalize sentimentise sentimentize sentinel sentry sep separate separated separately separateness separater separates separating separation separationism separatism separatist separative separator separatrix sepia sepiolite sept september septembers septenary septet septette septic septs septum sepulcher sepulchral sepulchre sepulture sequel sequenator sequence sequencer sequences sequent sequential sequentially sequester sequestered sequestrate sequestration sequin sequined sequoia seraphic seraphical sere serenade serene serenity seres sergeant sergeants serial serialer serialest serially serialness serials sericeous sericulture seriema series serieses seriocomedy serious seriouses seriously seriousness serjeant sermon sermonise sermonize serotonin serotonins serpent serrate serrated serration servant servants serve served server serverless servers serves service serviceable serviceberry serviceman services servicing serviette servile servility serving servings sesame sesames sesquipedalia sesquipedalian sess sessile session sessions sestet set seta setaceous setback seth setline setoff setose sets setscrew sett settee setter setting settle settled settlement settlements settler settles settling setup setups seven sevener sevens sevensome seventeen seventh sevenths seventies seventy sever several severalise severalize severally severalty severance severe severely severeness severer severes severest severing severity sew sewage sewed sewer sewerage sewing sewn sewns sews sex sexed sexiness sexless sextant sextet sextette sexton sextuplet sexual sexualer sexualest sexuality sexually sexualness sexuals sexy sezession sforzando shabbily shabbiness shabby shabu shack shackle shad shadberry shadblow shadbush shaddock shade shaded shades shadier shadies shadiest shadily shadiness shading shadow shadowed shadower shadowgraph shadows shadowy shady shaft shafts shag shagged shagger shagginess shagging shaggy shags shake shakedown shaken shakener shakenest shakenly shakenness shaker shakes shakeup shakily shakiness shaking shako shaky shall shaller shallest shallly shallness shallot shallow shallowness shalls sham shamanism shamble shambles shambling shame shamed shamefaced shameful shamefully shames shammer shammy shampoo shampoos shamrock shamus shanghai shank shanty shape shaped shapeds shapeless shapelessness shapeliness shaper shapes shaping shard share shared shareder sharedest sharedly sharedness shareholder shareowner shares sharing shark sharks sharp sharpen sharpened sharpener sharpening sharpens sharper sharpest sharpie sharply sharpness sharps sharpshoot sharpshooter sharpy shatter shattered shave shaver shaves shaving shaw shawl shawls shay she sheaf shear sheared shearer sheath sheathe sheathing sheaths shed shedder shedding sheds sheen sheeny sheep sheepcote sheepfold sheepherder sheepish sheeplike sheepman sheepshearing sheepskin sheer sheerer sheerest sheerly sheerness sheet sheets sheik sheikh shekels sheldrake shelf shelfs shell shellac shellack shellfish shelling shells shelter sheltered shelters shelve shelves shenanigan shepherd sherd sheriff sheriffs sherifves sherlock shes shetland shew shibah shibboleth shied shield shielded shielder shielding shields shier shies shiest shift shifter shiftiness shifting shifts shifty shilling shillyshally shily shim shimmed shimmer shimming shimmy shims shin shinbone shine shiner shines shiness shingle shingling shingly shininess shining shinned shinner shinning shinny shins shiny ship shipbuilder shipload shipment shipments shipped shipper shipping ships shipway shipwreck shipwright shire shirk shirking shirt shirtfront shirts shirttail shit shite shithead shitless shitter shittim shittimwood shitting shitty shiva shivah shivaree shiver shivering shivery shlep shlepper shnorr shoal shoat shock shocked shocker shocking shockingly shocks shod shodden shoddiness shoddy shoe shoebox shoed shoelace shoemaker shoer shoes shoeshine shoestring shoetree shogunate shoing shoo shooed shooer shoofly shooing shook shoos shoot shooter shooters shooting shoots shop shoplifter shoplifting shopped shopper shopping shops shopsoiled shopworn shore shoreline shores shoreward shoring shorn short shortage shortages shortcoming shortcut shortcuts shorten shortened shortener shortening shortens shorter shortest shortfall shorthand shortlies shortly shortness shorts shortsighted shortsightedness shortstop shot shote shotgun shotguns shotly shotness shots shotted shotter shottest shotting should shoulder shoulders shouldnt shouldve shout shouter shouting shouts shove shoved shovel shoveler shovelful shoveller shovels shover shoves shoving show showcase showcased showcaser showcases showcasing showdown showed shower showers showily showing showings showman shown showns showroom showrooms shows showstopper showtime showy shrank shred shredded shrew shrewd shrewdness shrewmouse shriek shrieked shrieker shrieking shrieks shrill shrillness shrilly shrimp shrimps shrimpy shrine shrines shrink shrinkage shrinking shrinks shrive shrivel shriveled shrivelled shroud shrub shrubbery shrubs shrug shrugged shrugger shrugging shrugs shrunk shrunken shtick shtik shtup shuck shucks shudder shuddery shuffle shuffler shuffling shumac shun shunned shunner shunning shuns shunt shut shutdown shutdowns shutly shutness shutout shuts shutter shutters shuttest shutting shuttle shuttlecock shuttles shy shyer shying shylock shyster siamese sib sibilant sibilate sibilation sibling siblings sibyl sibyllic sibylline sick sicken sickened sickening sickeningly sickeningness sicker sickest sickish sickly sickness sicks siddhartha side sidebar sideboard sideburn sidecar sidekick sideline sidelines sidelong sidereal siderite sides sideshow sideslip sidesplitter sidesplitting sidestep sidetrack sidewalk sidewalks sidewall sideway sideways sidewaysn sidewinder sidewise siding sidle siege sieges siemens sierra sieve sift sifting sigh sighed sigher sighing sighs sight sightless sightly sights sightsee sightseer sigma sigmas sigmoid sigmoidal sign signal signaling signalise signalize signally signals signature signatures signboard signed signer significance significances significant significantly signification significative signified signifier signify signing signora signorina signory signout signpost signs silence silencer silences silene silent silenter silentest silently silentness silents silenus silesia silex silhouette silicon silicons silk silken silkiness silklike silks silkweed silkworm silky sill sillabub sillier silliest sillily silliness sills silly silo silt silver silverfish silverish silvern silvers silverside silversides silvertip silverweed silvery similar similarity similarly similars similitude simmer simmering simmpleness simnel simony simple simpleness simpler simples simplest simpleton simplex simplicity simplification simplified simplifies simplify simplifyer simplifying simplism simply simulacrum simulate simulated simulater simulates simulating simulation simultaneous sin since sincere sincerely sinceres sincerity sinces sine sinecure sinew sinewy sinful sinfuler sinfulest sinfully sinfulness sing singalong singe singed singer singers singes singing single singleness singler singles singleses singlest singlestick singlet singleton singly sings singsong singular singularity sinister sinistral sink sinker sinkhole sinkholes sinking sinks sinless sinlessness sinned sinner sinning sins sinuate sinuous sinus sinusoid sion sip siphon sipped sipper sipping sips sir sire siren sirens siriasis sirred sirrer sirring sirs sirup sis sisal sise sises siss sissified sissy sissyish sister sisterhood sisters sistership sit sitar sitcom sitcoms site sited siter sites siting sits sitter sitting sittings situate situated situater situates situating situation situations siva six sixed sixer sixes sixing sixpenny sixsome sixteen sixteenth sixth sixths sixties sixtieth sixty sizable size sizeable sized sizer sizes sizing sizz sizzle sizzling skag skank skanky skate skateboard skateboards skates skating skatings skeletal skeleton skeletons skep skeptic skeptical skepticism sketch sketcher sketches skewer ski skiagram skiagraph skiagraphy skid skidder skied skier skies skiing skilful skill skilled skilleds skillet skillful skills skim skimmed skimmer skimming skimp skimped skimper skimping skimps skimpy skims skin skinflint skinhead skinner skinniness skinny skins skint skip skipjack skipped skipper skipping skips skirl skirmish skirt skirts skis skit skits skitter skittish skittishness skreak skreigh skulduggery skulk skulker skull skullcap skullduggery skulls skunk skunks sky skyer skyhook skying skylark skylight skyline skylines skyrocket skyscraper skyscrapers skyway slab slabber slabs slack slacken slackening slacking slackness slag slags slake slaked slalom slam slammed slammer slamming slams slander slang slant slanted slanter slanting slants slap slapdash slaphappy slapped slapper slapping slaps slapstick slash slashed slasher slashes slashing slask slat slate slately slateness slater slatest slating slats slattern slatternly slaughter slaughterer slaughterhouse slaughterous slave slaveholder slaveholding slaver slaveries slavery slaves slavish slay slayed slayer slaying slays sleaze sleaziness sleazy sled sledded sledder sledding sledge sledgehammer sleds sleek sleekness sleep sleeper sleeping sleepless sleeplessness sleeps sleepwear sleet sleeve sleeveless sleeves sleigh slender slenderise slenderize slenderly slenderness slept sleuth sleuthhound sleuthing slew slewed slewer slewing slews slezsko slice sliced slicer slices slicing slick slicker slickness slid slide slider slides slideway sliding slied slies slight slighter slightest slighting slightly slightness slights slim slime slimed sliminess slimly slimmed slimmer slimmest slimming slimness slims slimy sling slingback slinging slings slingshot slip slipover slippage slipped slipper slipperiness slippery slipping slippy slips slipshod slipstream slipway slit slither sliver slivery slob slobber slobberer slobs sloe slog slogan slogged slogger slogging slogs slop slope sloped slopes sloping slopped sloppiness sloppy slops slosh sloshed slot sloth slothful slothfulness sloths slots slotted slotter slotting slouch slough sloughy sloven slovenliness slow slowdown slowed slower slowest slowing slowly slowness slows slowworm slub slubbed sludge slue slug slugfest sluggard slugged slugger slugging sluggish sluggishness slugs sluice sluicegate sluiceway slum slumber slumberer slumberous slumbery slumbrous slummed slummer slumming slump slums slung slur slurred slush slushy slut sluttish sly slyboots slyer slying slyly slyness smack smacked smacker smacking smacks small smallness smallpox smallpoxes smalls smarm smarminess smarmy smart smarting smartly smartness smartphone smartphones smarts smash smashed smasher smashes smashing smatter smattering smear smeared smearer smearing smears smell smelled smelling smells smelly smelt smidge smidgen smidgeon smidgin smilax smile smiled smiler smiles smiley smiling smirch smite smited smiter smites smith smithy smiting smitten smock smog smogginess smogs smoke smoked smoker smokes smokescreen smokestack smoking smokings smoky smolder smooch smooching smooth smoothen smoother smoothest smoothie smoothies smoothly smoothness smooths smoothy smorgasbord smother smothered smoulder smudge smug smuggled smuggler smut smutch smuttiness smutty snack snacks snaffle snag snags snail snails snake snakebird snakeroot snakes snap snapped snapper snapping snappishness snappy snaps snapshot snapshots snare snared snarer snares snarf snaring snarl snarled snarly snatch snatched snatcher snatches snatching sneak sneaked sneaker sneakers sneaking sneaks sneaky sneer sneering sneeze sneezes sneezing snick snicker snide sniff sniffed sniffer sniffing sniffle sniffs sniffy snigger snip snipe snippet snipping snips snitch snitcher snivel sniveling sniveller snob snobbish snobby snog snooker snoop snoot snooty snooze snore snored snorer snores snoring snorkel snort snorter snorting snot snotty snout snow snowball snowberry snowbird snowboard snowboards snowfall snowflake snowflakes snows snowstorm snowy snub snuck snuff snuffer snuffle snug snuggery snuggle snuggling snugly soak soakage soaked soaker soaking soaks soap soapbox soaped soaper soaping soaps soapsuds soapy soar soared soarer soaring soars sob sobbed sobber sobbing sober soberly soberness soberrer soberrest sobriety sobriquet sobs soccer soccers sociable sociably social socialer socialest socialisation socialise socialising socialism socialist socialistic socialists socialization socialize socializes socializing socially socialness societal societies society sociology sock socked socker socket sockets sockeye socking socks sod soda sodality sodas sodbuster sodded sodden sodder sodding soddy sodium sodiums sodom sodomise sodomist sodomite sodomize sodomy sods sofa sofas soft softball softballs soften softened softer softerer softerest softerly softerness softest softheaded softly softness software softwares soggy soh soho soil soiled soils soja sojourn sol solace solacement solar solarise solarize solarly solarness solarrer solarrest solars sold soldier soldiering soldierlike soldierly soldiers soldiership solds sole solecism solelies solely solemn solemner solemness solemnest solemnisation solemnise solemnity solemnization solemnize solemnly solemnness soleness soler soles solest solfege solfeggio solferino solicit solicitation solicitor solicitous solid solidder soliddest solidification solidified solidify solidifying solidity solidly solidness solids solidus soliloquy solitaire solitariness solitary solitude solitudinarian solmisation solmization solo soloist solos solstice solubility soluble solution solutions solvability solvable solvate solve solvent solves solving soly soma somaesthesia somaesthesis somataesthesis somatesthesia somatic somber somberness sombre sombreness sombrero some somebodies somebody someday somedays somehow somely someness someone someones someplace somer somersault somersaulting somerset somes somest somesthesia somesthesis something somethings sometime sometimes someway someways somewhat somewhere somniferous somnific somnolent son sonata song songbird songfulness songs songster songwriter songwriters sonic soniccer soniccest sonicly sonicness sonnet sonny sonography sonority sonorousness sons sonsie sonsy soon sooner soons soot soothe soothed soother soothes soothing soothsayer soothsaying sootiness soots sooty sop soph sophism sophist sophistic sophistical sophisticate sophisticated sophistication sophistry sophomore sopor soporiferous soporific soppy soprano sops sorbed sorcerer sorcerous sorcery sordid sordidness sordino sore sorely soreness sorer sores sorest sorghum sorrel sorrier sorries sorriest sorrily sorriness sorrow sorrowful sorrowfully sorrowfulness sorry sort sorted sorter sortie sorting sortings sorts sorus sot sots sottishness soubrette soubriquet soudan souffle sough soughing sought soughter soughtest soughtly soughtness soul soulful soulfulness soulmate soulmates souls sound soundable soundbox sounder soundest sounding soundless soundly soundness sounds soundtrack soundtracks soup soupcon soupiness soups soupy sour source sources sourdine sourdough soured sourer souring sourish sourness sours soursop sourwood sousaphone souse soused sousing south southeast southeasterly southeastern southeastward souther southerly southern southernism southerns southest southly southness southpaw souths southward southwards southwest southwesterly southwestern southwestward souvenir sovereign sovereigns sovereignty sovietise sovietism sovietize sow sowed sower sowing sows soy soya soybean soys sozzled spa space spaced spaceman spaces spacial spacing spaciotemporal spacious spaciousness spade spadefish spadeful spaghetti spaghettis spam spamming span spandex spangle spangled spangly spaniel spanish spank spanker spanking spanned spanner spanning spans spar spare sparely spareness sparer spareribs spares sparest sparge sparing sparingly spark sparked sparker sparking sparkle sparkler sparkling sparkly sparks sparling sparred sparrer sparring sparrow sparrows spars sparse sparsely sparseness sparser sparsest spartan spas spasm spasmodic spasmodically spastic spat spatchcock spate spatial spatiotemporal spatter spattering spatula spawn spay speak speaker speakers speaking speaks spear spearhead spearpoint spec special specialisation specialise specialiser specialism specialist specialistic specialists speciality specialization specialize specialized specializer specializes specializing specially specialness specials specialty speciate specie species specific specifically specification specificity specified specifies specify specifyer specifying specimen specious speciousness speck speckle speckless specs spectacle spectacular spectator specter spectral spectre spectrogram spectrograph spectrometer spectrum speculate speculation speculative speculativeness speculator speculum sped speech speeches speechless speed speedily speeding speedometer speedometers speeds speedup speedway speedy spelaeology speleology spell spellbind spellbinding spellbound spelled speller spelling spells spelt spelunk spend spendable spender spending spends spendthrift spent spents spermophile spew sphacelate sphacelus sphere spheric spherical sphericalness sphericity sphinx spic spice spiceberry spicebush spicery spices spiciness spick spicy spider spiderflower spiderlike spiderly spiders spidery spied spiel spies spiffy spigot spike spikelet spile spill spillage spilled spiller spilling spills spillway spilt spin spinach spinaches spindle spindlelegs spindleshanks spindly spine spineless spines spinet spininess spinner spinning spinous spins spinster spiny spiraea spiral spiraling spirant spirea spirilla spirillum spirit spirited spiritedness spiritism spiritless spiritlessness spirits spiritual spiritualise spiritualism spiritualist spirituality spiritualize spiritualty spirt spit spitball spite spiteful spitefully spitefulness spits spitter spitting spittle splanchnic splash splashboard splashed splasher splashes splashiness splashing splashy splat splats splatted splatter splattering splatting splay splayfoot spleen splendid splendidly splendiferous splendor splendour splenetic splenic splice splicer splicing spliff spline splint splinter splintering splinters splintery splints split splits splitter splitting splosh splotched splurge splutter spode spoil spoilage spoilation spoiled spoiler spoiling spoils spoilt spoke spoked spoken spoker spokes spokesman spokesmans spokesperson spoking spoliation sponge spongelike sponger sponges sponginess spongy sponsor sponsors spontaneous spontaneously spoof spook spooky spool spooled spooler spooling spools spoon spooned spooner spoonful spooning spoons sport sported sporter sportfishing sporting sportive sports sportsman sportsmanlike sportswoman sporty sporulate spot spotless spotlight spotlights spots spotted spotter spotting spotty spousal spouse spouses spout spouter sprag sprain sprains sprang sprat sprawl sprawling spray sprayed sprayer spraying sprays spread spreadeagle spreader spreadhead spreading spreads spree sprig sprigger sprightliness spring springboard springer springiness springing springs springtide springtime springy sprinkle sprinkler sprinklers sprinkling sprint sprints sprite spritz sprocket sprog sprout sprouted sprouter sprouting sprouts spruce sprucely sprue sprung spry spud spue spume spumy spun spunk spunky spur spurious spurn spurring spurt sputter sputtering sputum spy spyer spyglass spyhole spying spyware squab squabble squabbles squabby squad squadron squads squalid squalidness squall squalling squally squalor squander squandered squanderer square squarely squares squash squashes squashy squat squated squater squating squats squatter squatting squatty squawk squawker squeak squeaker squeaking squeaky squeal squealer squealing squeamish squeamishness squeezability squeezable squeeze squeezed squeezer squeezes squeezing squelch squelched squelcher squid squids squiffy squiggle squill squinch squint squinty squire squirm squirmer squirrel squirrelfish squirrels squirt squish squishy sriracha stab stabbing stabile stabilisation stabilise stabilities stability stabilization stabilize stabilized stabilizer stabilizes stabilizing stable stableboy stableman stableness stabler stables stablest stably stack stacked stacker stacking stacks stadium stadiums staff staffed staffeds staffs stafves stag stage stagecoach staged stager stages stagger staggered staggerer staggering staggers stagily staging stagnancy stagnant stagnate stagnation stags staid staidness stain stained stainer staining stainless stains stair staircase staircases stairs stairway stake staked stakeholder staker stakes staking stale stalemate staleness stalinism stalk stalker stalking stalkless stall stalled staller stalling stallion stallions stalls stalwart stalwartness stammer stamp stamped stampede stamper stamping stamps stance stanch stand standard standardisation standardise standardised standardization standardize standardized standardizer standardizes standardizing standards standbies standby standdown standee standing standoff standoffish standoffishness standpoint stands standstill standup standups stank stanza stanzas stapes staple staplegun stapler staples star starch starches starchlike starchy stare stared starer stares starfish starfishes starfruit stargaze stargazer staring stark starker starkest starkly starkness starlet starlight starlights stars start started starter starting startle starts startup startups starvation starve starved starving stash stasis state statecraft stated stateless stateliness stately statement statements stater states statesmanship static staticer staticest staticly staticness stating station stationariness stationary stations statistic statistician statistics statue statues statuesque statuette stature status statuses statute statutes statutory staunch staunchness stave stay stayed stayer staying stays std stead steadfast steadfastly steadfastness steadier steadies steadiest steadily steadiness steady steak steaks steal stealer stealing steals stealthy steam steamed steamer steaminess steaming steamroll steamroller steams steamship steamy steel steels steely steep steepen steeper steepest steeplechase steeply steepness steeps steer steerage steered steerer steering steers steganography stein stela stele stellar stellate stem stemless stemma stemmed stemmer stems stench stenograph stenography stenosis stentor step steppe stepped stepper stepping steps stereo stereophonic stereophony stereoscopic stereotype stereotyped stereotypic stereotypical sterile sterileness sterilisation sterilise sterility sterilization sterilize stern sternness sterns sternutation sternutative sternutator sternutatory steroid stertor stet stetson stevedore stevens stevia stew steward stewardess stewed stewing stews stick sticker stickier stickiest stickily stickiness sticking sticks sticktight stickup sticky stied sties stiff stiffen stiffening stiffer stiffest stiffly stiffness stiffs stifle stifled stifling stifves stigma stigmatic stigmatisation stigmatise stigmatism stigmatist stigmatization stigmatize still stillbirth stillborn stiller stillest stillly stillness stills stilt stiltbird stilted stimulant stimulate stimulated stimulater stimulates stimulating stimulation stimuli stimulus sting stinger stinging stingray stingrays stings stingy stink stinker stinking stinkpot stinks stinky stint stinting stipend stipendiary stipple stipulate stipulation stir stirred stirrer stirring stirrup stirs stitch stitched stochasticity stock stockade stockbroker stockbrokers stocked stocker stockholder stockholding stockholdings stockhorn stocking stockings stockpile stocks stocktaking stocky stodginess stodgy stoep stoic stoical stoicism stoker stole stolen stolener stolenest stolenly stolenness stolid stolidity stolidness stolon stoma stomach stomaches stomatal stomate stomatous stomp stomped stomper stomping stomps stone stonecutter stonely stonemason stoneness stoner stoneroot stones stonest stonewall stony stonyhearted stood stoods stooge stool stoolie stoolpigeon stools stoop stooped stooper stooping stoops stop stopcock stoplight stopover stoppage stopped stopper stopping stopple stops storage storages store stored storehouse storer storeroom stores storey storeyed storied stories storing stork storks storm stormed stormer stormily storminess storming storms stormy story storyboard storyline storylines storyteller stoup stout stouthearted stoutness stove stovepipe stoves stow stowage stowed stower stowing stows strabismus straddle straggle straggling stragglingly straggly straight straightaway straighten straightened straightener straightening straightens straightforward straightforwardly straightforwardness straightjacket straightlaced straightness straightway strain strained strainer straining strains strait straiten straitjacket straitlaced straits strake strand strands strange strangely strangeness stranger strangers stranges strangle strangled stranglehold strangler strangling strangulate strangulation strap straphanger strapper strapping straps stratagem strategic strategical strategies strategize strategized strategizer strategizes strategizing strategy stratification stratified stratify stratum straw strawberries strawberry strawflower strawman straws strawworm stray strayer strayest strayly strayness strays streak stream streamer streaming streamings streamlet streamline streamlined streams street streetcar streetcars streets streetwalker strength strengthen strengthened strengthener strengthening strengthens strengths strenuous stress stressed stresses stretch stretchability stretched stretcher stretches stretchiness stretching streusel strew strewing stria striation stricken strickle strict stricter strictest strictly strictness stricts stricture stridden stride stridence stridency strident strides striding strife strike strikebreaker striker strikes strikeses striking strikingness string stringency stringent stringer stringing strings stringy strip stripe striper stripes stripling stripped stripper stripping strips striptease stripteaser strive striven striver strives striving strobile strobilus strode stroke strokes stroking stroll strolled stroller strolling strolls stroma stromateid strong stronger strongest strongly strongman strongness strongs strove struck strucks structural structuralism structure structured structures strudel struggle struggles strum struma strumpet strung strut struts strutted strutter strutting stub stubble stubborn stubbornness stubborns stubby stubs stucco stuck stucker stuckest stuckly stuckness stucks stud student students studhorse studied studieds studies studio studios studious studs study studyer studying stuff stuffed stuffer stuffiness stuffing stuffs stuffy stufves stultification stultify stumble stumblebum stumbler stump stumped stumper stumping stumps stumpy stun stung stunk stunned stunner stunning stuns stunt stunted stuntedness stunting stupe stupefaction stupefied stupefy stupefying stupendous stupid stupider stupidest stupidity stupidly stupidness stupor stuporous sturdiness sturdy sturgeon stutter sty stye styer stygian stying style styleless stylemark styler styles stylise stylish stylishness stylist stylize stylus stymie stymy stypsis styptic suasion suave suaveness suavity sub subaltern subaquatic subaqueous subatomic subcontract subdivide subdivision subdue subdued subduedness subgroup subhuman subject subjection subjective subjectivism subjects subjoining subjugate subjugation subjunction sublimate sublimation sublime sublimely sublunar sublunary submarine submarines submaxilla submerge submerged submergence submergible submerging submerse submersed submersible submersion submission submissive submissively submit submited submiter submiting submits submitter subnet subnormality subocular suborbital subordinate subordination suborn subornation subprogram subroutine subs subscribe subscribed subscriber subscribes subscribing subscript subscription subscriptions subsection subsequence subsequent subsequently subsequentness subservience subservient subservientness subside subsidence subsidiary subsiding subsidisation subsidise subsidization subsidize subsist subsistence subsister subspecies substance substandard substantial substantially substantiate substantiating substantiation substantive substitutability substitutable substitute substitutes substitution substrate substratum substructure subsume subsumption subtend subterfuge subterranean subterraneous subtext subtilise subtilize subtitle subtitles subtle subtleness subtler subtlest subtlety subtly subtract subtracter subtraction suburb suburban suburbanise suburbanize suburbia suburbs subvent subvention subversion subversive subversiveness subvert subverter subway subways succeed succeeder succeeding succeeds success successes successful successfully successfulness succession successive successiveness successor succinct succinctly succor succory succour succulent succumb succus such sucher suches suchest suchly suchness suck sucked sucker sucking suckle suckling sucks sucre suction sudan sudate sudation sudatorium sudatory sudden suddenly suddenness suddens sudor sudorific suds sue sued suede suedes suer sues suffer sufferance sufferer suffering suffers suffice sufficiency sufficient suffocate suffocation suffrage suffuse suffusion sugar sugarberry sugarcane sugarcoat sugariness sugars suggest suggested suggester suggesting suggestion suggestions suggestive suggests suicide suicides suing suit suitable suitably suitcase suitcases suite suited suiter suites suiting suits sulfur sulfurous sulk sulked sulker sulkiness sulking sulks sulky sullen sullenness sully sulphur sulphurous sultana sultriness sultry sum sumac sumach summaries summarise summarize summarized summarizer summarizes summarizing summary summate summation summed summer summercater summerhouse summers summersault summerset summertime summing summit summits summon summoning summons sump sumptuosity sumptuous sumptuousness sums sun sunbaked sunbathe sunbeam sunblind sunblock sunbow sunburn sunburns sunburst sundae sundaes sunday sundays sundown sundowner sundried sunfish sunflower sunflowers sung sunglasses sunglasseses sunglow sunk sunken sunless sunlight sunlights sunna sunnah sunned sunner sunnier sunniest sunnily sunniness sunning sunny sunray sunrise sunrises suns sunscreen sunset sunsets sunshade sunshine sunshines sunspot sunstroke suntan sunup sup super superable superabundance superannuate superannuated superannuation superb superber superbest superbia superbly superbness superbs superbug supercharge supercharged supercilious superciliousness supercilium supererogatory superficial superficiality superficies superfine superfluity superfluous supergrass superhighway superimpose superimposed superintend superintendence superintendent superior superiority superiors superlative superlunar superlunary superly superman supermarket supermarkets supernal supernatural supernaturalism supernaturalness superness supernormal supernova supernumerary superordinate superoxide superpatriotic superpatriotism superposable superpose superposition superpower superrer superrest supers superscribe superscript superscription supersede supersensitised supersensitive supersensitized supersonic superstar superstitious superstrate superstratum supervise supervised superviser supervises supervising supervision supervisor supervisors supine supinely supped supper supping supplant supplanting supple supplement supplemental supplementary supplementation supplemented supplementer supplementing supplements suppleness suppliant supplicant supplicate supplication supplicatory supplied supplier suppliers supplies supply supplyer supplying support supported supporter supporters supporting supportive supports supposal suppose supposed supposer supposes supposing supposition suppositional suppositious supposititious suppress suppressed suppresser suppression suppressor suppurate suppuration supra supranormal supremacy supreme supremely supremes sups sur sura surcharge surcoat surd sure surefooted surelies surely sureness surer sures surest surety surf surface surfaces surfboard surfed surfeit surfer surffish surfing surfperch surfs surge surged surgeon surgeons surger surgeries surgery surges surgical surging surliness surly surmisal surmise surmount surmountable surname surpass surpassing surplus surplusage surpluses surprisal surprise surprised surprises surprising surprisingly surreal surrealistic surrender surrendered surrenderer surrendering surrenders surreptitious surrey surrogate surround surrounded surrounder surrounding surroundings surrounds surveil surveillance surves survey surveyed surveyer surveying surveyor surveys survival survive survives surviving survivor survivors susceptible sushi sushis suspect suspects suspend suspended suspender suspending suspends suspense suspenseful suspension suspensive suspensor suspicion suspicions suspicious suspiciousness suspiration suspire sustain sustainability sustained sustainment sustains sustenance sustentation susurrant susurration susurrous susurrus sutler sutura suture suzerainty svelte swab swag swage swagger swaggering swaggie swagman swain swallow swallowwort swam swamp swampland swamps swampy swan swank swanky swans swap swapped swapper swapping swaps sward swarm swart swarthiness swarthy swash swashbuckler swashbuckling swath sway swayer sways swear swearer swearing swears swearword sweat sweatband sweatbox sweated sweater sweating sweats sweatsuit swede sweep sweeper sweeping sweeps sweet sweetbriar sweetbrier sweeten sweetener sweetening sweeter sweetest sweetheart sweetie sweetly sweetness sweets sweetsop swell swelled swellhead swelling swells swelter swept sweptback swepted swepter swepting swepts swerve swerved swerver swerves swerving swift swiftness swifts swig swill swilling swim swimmer swimmers swimming swims swimsuit swimsuits swimwear swindle swindler swing swinge swinger swinging swings swinish swipe swiped swiper swipes swiping swirl swirled swirler swirling swirls swish switch switched switcher switches switching swither swivel swob swollen swoon swooning swoop swoosh swop sword swordfish swordplay swords swordtail swore swored sworer swores sworing sworn sworns swosh swot swum swung sybaritic sycamore sycophant sycophantic syllabi syllabic syllabicate syllabify syllabise syllabize syllabub syllabus syllabuses sylph symbol symbolic symbolical symbolically symbolisation symbolise symboliser symbolism symbolist symbolization symbolize symbolized symbolizer symbolizes symbolizing symbols symmetric symmetrical symmetricalness symmetry sympathetic sympathetically sympathise sympathiser sympathize sympathizer sympathizes sympathy symphonic symphonies symphonious symphony symphysis symptom symptomatic symptoms synaeresis synagogue sync synchronal synchroneity synchronic synchronicity synchronisation synchronise synchronising synchronism synchronization synchronize synchronizing synchronous synchrony syncopate syncopation syncope syncretic syncretical syncretise syncretism syncretistic syncretistical syncretize syncs syndicalist syndicate syndication syndrome syneresis synergetic synergism synergistic synergistically synergy synopsis synoptic synoptical syntax synthesis synthesise synthesiser synthesist synthesize synthesizer synthetic synthetical syph syphilis syphon syringa syrinx syrup syrups syrupy system systematic systematisation systematiser systematist systematization systematizer systemiser systemizer systems tab tabby tabernacle table tableau tableland tables tablespoon tablespoonful tablet tablets tabloid taboo tabs tabu tabular tabularise tabularize tabulate tabulation tabulator tachygraphy tacit taciturnity tack tacker tackiness tacking tackle tackled tackler tackles tackling tacky taco tacos tact tactful tactfulness tactic tactical tactics tactile tactless tacts tactual tad tadpole tads taenia taffeta tag tagged tagger tagging tags tahini tai tail tailback tailfin taillike tailor tailored tailors tailspin tailwort taint taiwan taiwanese take takeaway takedown taken takens takeoff takeout takeover taker takes taking takings talc talcum tale talebearer talent talented talents tales taleteller talk talkative talked talker talking talks talky tall taller tallest tallis tallith tallly tallness talls tally tallyman talus tam tamal tamale tamarind tamarindo tambour tame tamed tamely tameness tamer tames tamest taming tammy tamp tamper tan tandem tang tanga tangelo tangency tangent tangential tangerine tangible tanginess tangle tangled tango tangos tangy tank tanka tankage tanked tanker tankful tanking tanks tanned tanner tanning tans tantalise tantalising tantalization tantalize tantalizing tantalum tantra tantrism tantrum taos tap tapa tapdance tape taped tapeline taper tapered tapering tapes tapestry taphouse taping tapir tapis tappa tapped tapper tapping taproom taproot taps tar tarabulus taradiddle tarantella tarantelle tarantula tardily tardy tare target targets tariff tarmac tarmacadam tarnish taro tarp tarpaulin tarps tarradiddle tarragon tarred tarrer tarring tarry tars tart tartan tartar tartness tarts tarweed tarzan task taskbar tasks tassel tassels taste tastefully tasteless tastelessness taster tastes tastily tasting tat tatar tater tats tatter tatterdemalion tattered tattily tatting tattle tattler tattletale tattoo tatty taught taunt taunted taunter taunting taunts taupe taupely taupeness tauper taupest taurus taut tauten tauter tautest tautly tautness tautog tautologic tautological tautology tavern taverns taw tawdriness tawdry tax taxable taxation taxed taxer taxes taxi taxicab taxing taxis taxonomer taxonomic taxonomical taxonomist taxonomy tchad tchotchke tchotchkeleh tea teaberry teacake teach teachable teacher teachers teaches teaching teacup teacupful teak teakwood teal tealer tealest teally tealness team teammate teammates teams teamster tear teardrop tearful tearing tears teas tease teased teaser teases teasing teaspoon teaspoonful teat teatime tebibyte tec tech teches technical technicality technically technician technicians technique techno technocrat technological technologies technologist technology techy tectonic tectonics teddy tedious tediousness tedium teem teemingness teen teenage teenaged teenager teenagers teens teeter teeterboard teetertotter teeth teething teeths teetotal teetotum tegument telamon telecasting telecom telecommunication telecommute telefax telegram telegraph telegraphic telegraphy telepathist telephone telephoner telephony telephoto telephotograph telephotography telescope telescopic television televisions tell teller telling tells telltale tellurian telluric telly telophase temblor temerity temp temper temperament temperamental temperance temperate temperately temperateness temperature temperatures tempered tempest tempestuous tempestuousness template templates temple temples templet tempo temporal temporality temporalty temporary temps tempt temptation tempted tempter tempting temptingness temptress tempts ten tenability tenableness tenacious tenaciousness tenacity tenancy tenant tenants tend tended tendencies tendency tender tenderer tenderest tenderhearted tenderise tenderize tenderloin tenderly tenderness tenders tending tendinous tendon tendons tends tenet tenfold tenge tenia tenner tennessean tennis tennises tenor tens tense tensely tenseness tenser tensest tensile tensiometer tension tensity tensor tent tentacle tentative tenth tenths tenting tents tenuity tenuous tenure tepid tepidity tepidness tequila tequilas terabyte teras tercet tergiversate tergiversation tergiversator teriyaki term termagant terminal terminals terminate terminated terminater terminates terminating termination terminology terminus termite termites terms ternary ternion terpsichore terpsichorean terrace terraces terrain terrains terrasse terrene terrestrial terrestrially terrible terribly terrier terrific terrified terrifies terrify terrifyer terrifying territorial territorialise territorialize territories territory terror terrorisation terrorise terrorism terrorisms terrorization terrorize terrors terry terrycloth terse tertian tertiary terzetto tesla tessellate tessellated tessellation test testament testdriven tested tester testicle testified testifies testify testifyer testifying testily testimonial testimonies testimony testing testings testis tests testudo testy tetanic tetanus tetanuses tetchy tether tetrad tetragon tetramethyldiarsine tetterwort teutonic text textbook textbooks textile texts texture thaddaeus thai thalweg than thanatos thane thank thanked thanker thankful thankfully thanking thankless thanks thankses thanksgiving thanksgivings thans that thatch thatcher thatll thatly thatness thats thatter thattest thaumaturge thaumaturgist thaumaturgy thaw thawed thawer thawing thaws the theanthropism theater theaters theatre theatrical theatrically thebes theca their theirs them thematic theme themes thems themselves then thenal thenar thence thens theocracy theodolite theologically theologise theologize theology theorem theoretic theoretical theoretically theories theorise theorize theory therapeutic therapeutical therapies therapist therapists therapy there thereabout thereabouts therebies thereby thered therefore therefrom therell thereness thereof theres thermal thermic thermodynamics thermograph thermometer thermometers thermometrograph thes these theses thesis thespian theurgy they theyd theyll theyre theyve thick thicken thickened thickener thickening thickens thicker thickest thicket thickets thickhead thickheaded thickly thickness thicks thickset thief thieve thieves thigh thighbone thighs thimble thimbleberry thimbleful thin thing thingamabob thingamajig thingmabob thingmajig things thingumabob thingumajig thingummy think thinker thinking thinks thinly thinner thinness thinnest thins third thirder thirdest thirdly thirdness thirds thirst thirstily thirstiness thirsts thirsty thirteen thirties thirty this thises thistle thither thole tholepin thong thoracic thorax thorn thorniness thornless thorns thorny thorough thoroughbred thoroughgoing thoroughly thoroughwort those thoses thou though thought thoughtful thoughtfully thoughtfulness thoughtfuls thoughtless thoughtlessly thoughtlessness thoughts thous thousand thousands thousandth thraldom thrall thralldom thrash thrasher thrashing thread threadbare threaded threader threading threadlike threads thready threat threaten threatened threatener threatening threatens threats three threefold threepenny threes threescore threesome threnody thresh thresher threshold threw threws thrift thriftiness thriftlessness thrifty thrill thrilled thriller thrilling thrive thrived thriver thrives thriving throat throats throb throbbing throe throne thrones throng throstle throttle throttlehold throttler throttling through throughout throughs throughway throw throwaway throwback thrower throwing thrown throws throwster thrum thrush thrust thruster thrusting thrusts thruway thud thug thumb thumbhole thumbnail thumbnails thumbs thumbscrew thump thumping thunder thunderbolt thunderclap thunderer thundering thunderous thunders thunderstorm thunderstruck thundery thurify thursday thursdays thus thusly thwack thwart thwarted thwarter thwarting thyme thymes thymus thyroid thyroidal thyroids thyromegaly tib tibia tick ticked ticker ticket tickets ticking tickle tickling ticklish ticks ticktack ticktock tiddler tiddly tide tided tider tides tidewater tidied tidies tidiness tiding tidings tidy tidyer tidying tie tieback tied tier tierce tiers ties tiff tiffin tiger tigers tight tighten tightened tightener tightening tightens tighter tightest tightfistedness tightfitting tightlipped tightly tightness tights tike tile tilefish tiles till tillage tilled tiller tilling tills tilt tilted tilter tilth tilting tilts timbale timber timbered timberland timbers timbre time timecard timed timekeeper timeless timelessness timelier timeliest timelily timeline timelines timeliness timely timeout timeouts timepiece timer timers times timetable timeworn timid timidity timidness timing timorous timorousness timothy timpani tin tinamou tinct tincture tinder tinderbox tinea tined ting tinge tingle tingling tinier tinies tiniest tinily tininess tink tinker tinkerer tinkle tinning tinny tins tinsel tint tintinnabulation tints tiny tip tipped tipper tipping tipple tippy tips tipsiness tipster tipsy tiptop tirade tire tired tiredness tireds tireless tirer tires tiresome tiresomeness tiring tiro tissue tissues tit titan titania tithe titi titillate titillating titillation titivate titlark title titles titration tittivate tittle tittup titty titular titulary tiyin tizzy toad toaded toader toading toads toady toadyish toast toaster toasting toasts tobacco tobacconist tobaccos toboggan tocology tocsin today todays toddle toddler toddlers toe toed toehold toenail toer toes toetoe toffee toffy tofu tofus tog together toggle toggles toil toiled toiler toilet toilets toilette toiling toils toilsome toing toitoi tokay token tokenish tokens told tolds toledo tolerable tolerance tolerances tolerant tolerate tolerated tolerater tolerates tolerating toleration toll tolled toller tolling tolls tollway tollways tom tomahawk tomatillo tomato tomatoer tomatoest tomatoly tomatoness tomatos tomb tomboy tombs tombstone tomentose tomentous tomentum tomfool tomfoolery tommyrot tomography tomorrow ton tonal tonality tone toned toner tones tonga tongs tongue tongued tongueless tongues tonic tonight tonights toning tonned tonner tonning tons tonsil tonsilla tonsils tonsure tontine too tooed tooer tooing took tooked tooker tooking tooks tool toolbar toolbars toolbox tools toon toos toot tooted tooter tooth toothbrush toothed toothless toothsome tooting toots top topaz topazly topazness topazzer topazzest topcoat tope topee toper topgallant tophus topi topiary topic topical topics topknot topknotted topless topminnow topmost topnotch topography topology toponomy toponymy topped topper topping topple toppled toppler topples toppling tops toque torah torch torched torcher torches torching tore tored torer tores toring torment tormented tormenter tormentor torn tornado tornados torner tornest tornly tornness torns toroid torpedo torpid torpidity torpidness torpor torque torrent torrential torrid torsion torsk torso torsos torticollis tortilla tortillas tortoise tortoises tortoiseshell tortrix tortuosity tortuous tortuously tortuousness torture tortured torturing torus tory tosh toss tossed tosser tosses tossing tostada tot total totalisator totaliser totalism totalistic totalitarian totalitarianism totalitarians totality totalizator totalizer totaller totallest totallies totally totalness totals tote totem toter totes tots totted totter tottering tottery totting toucan toucans touch touchable touchdown touched touches touching touchscreen touchscreens touchstone touchwood touchy tough toughened tougher toughest toughie toughly toughness toughs tour toured tourer touring tourism tourisms tourist touristry tourists tournament tournaments tourney tours tousle tousled tout touted touter touting touts tow towage toward towards towardses towboat towed towel towels tower towering towers towing town towned towner towning towns townsfolk township townships townsman townspeople tows toxaemia toxemia toxic toxicant toxiccer toxiccest toxicity toxicly toxicness toxin toy toyed toyer toying toys trablous trace traceable traced tracer traces trachea tracing track trackable tracked tracker tracking trackless tracks tracksuit tract tractability tractable tractableness tractile traction tractor trade traded trademark trademarks trader trades trading tradings tradition traditional traditionalism traditionality traditions traduce traducement traffic trafficator trafficker traffics tragedian tragedies tragedy tragic tragical tragicer tragicest tragicly tragicness tragicomedy tragicomic tragicomical trail trailblazer trailed trailer trailhead trailing trails trailside train trained trainee trainer trainers training trains traipse trait traitor traitorous traitorously traitorousness traits trajectory tram tramcar tramline trammel tramontana tramontane tramp tramper trample trampled trampler tramples trampling trams tramway trance tranquil tranquility tranquilize tranquillise tranquillity tranquillize trans transaction transactions transalpine transamination transcend transcendence transcendency transcendent transcendental transcribe transcriber transcript transcription transduction transes transeunt transexual transfer transferable transfered transferee transference transferer transfering transferrable transferral transfers transfiguration transfigure transfix transfixed transform transformable transformation transformed transformer transforming transforms transfuse transfusion transgendered transgress transgression transience transiency transient transistor transit transition transitions transitiveness transitivity transitoriness transitory transits translatable translate translated translater translates translating translation translations translator transliterate translocate translocation translunar translunary transmigrate transmissible transmission transmit transmittable transmittal transmittance transmitted transmitter transmitting transmogrify transmontane transmutability transmutable transmutation transmute transnational transom transonic transparence transparency transparent transparently transparentness transpirate transpiration transpire transplant transplantation transplanting transport transportable transportation transportations transported transporter transporting transports transpose transposed transposition transsexual transubstantiate transubstantiation transudate transudation transude trap trapezium trapezoid trapped trapper trapping traps trash trashes trashiness trashy trauma traumatic traumatise traumatize travail trave travel traveled traveler traveling travelling travels traversal traverse travesty trawl trawler tray trays treacherous treachery treacle treacly tread treading treadle treadmill treadmills treads treadwheel treason treasonable treasonist treasonous treasure treasured treasurer treasures treasuring treasury treat treated treater treaties treating treatment treatments treats treaty treble trebuchet trebucket tree treelike trees treetop treetops trefoil trek trematode tremble trembler trembling tremendous tremolo tremor tremors trench trenchant trencher trencherman trenches trend trended trender trending trends trendy trepan trephine trepid trespass tress trestle trey triad trial trials triangle triangles triangular triangulate triangulation triangulum triathlon triathlons tribade tribal tribalism tribals tribe tribes tribulation tribunal tribunals tribune tributary tribute tributes trice tricep triceps trick tricked tricker trickery trickily trickiness tricking trickle tricks trickster tricksy tricky triclinium tricycle tried trieded trieder triedest trieding triedly triedness trieds trier tries trifle trifling trig trigger triggerman triggers trigon trigonometry triiodomethane trike trilateral trilby trill trilled trillion trilogies trilogy trim trimester trimmed trimmer trimming trimmings trimness trims trine trinity trinket trio trios trip tripe triple tripleness tripler triplest triplet triplets triplex triplicity triply tripoli tripped tripper tripping trippingly trips trite triteness triton triumph triumphal triumphant triumphs trivet trivia trivial triviality trivially trod trodded trodden trodder trodding trods troglodyte troika trojan troll troller trolley trolleys trolling trollop trolls trombone troop trooper troops trope trophies trophy tropic tropical tropicals trot troth trotline trots trotskyist trotskyite trotted trotter trotting troubadour trouble troubled troubler troubles troubleshoot troubleshooted troubleshooter troubleshooting troubleshoots troublesome troublesomeness troublesomes troubling trough trounce trouncing troupe trouper trouser trousers trout trouts troy truant truce truces truck truckage trucked trucker trucking truckle trucks truculently trudge trudged trudger trudges trudging true truehearted truelove truely trueness truer trues truest truffle trulies truly trump trumped trumper trumpery trumpet trumpeter trumpets trumping trumps truncate truncated truncation truncheon trundle trunk trunks truss trust trusted trustee trusteeship truster trustfully trustfulness trusting trustingly trustingness trusts trustworthy trusty truth truthful truthfuls truths try tryer trying tryout tryouts tryst tsar tsarina tsatske tshatshke tsine tsunami tsunamis tub tuba tubbed tubber tubbing tubby tube tuber tubercle tubercular tuberculosis tuberculosises tuberculous tuberosity tubes tubful tubing tubs tuck tucked tucker tucket tucking tucks tues tuesday tuesdays tufa tuff tuffet tuft tufted tufts tug tugboat tugged tugger tugging tugs tuition tulip tulips tulipwood tulle tully tum tumble tumbled tumbler tumbles tumbleweed tumbling tumefy tumesce tumescent tumid tummy tumor tumors tumour tumult tumultuous tumultuously tumultuousness tumulus tun tuna tunas tundra tundras tune tuned tuneful tuneless tuner tunes tunic tunica tunicate tuning tunned tunnel tunnels tunner tunning tunny tuns tup tupelo tuppeny turban turbans turbid turbinal turbinate turbine turbofan turbojet turbot turbulence turbulency turbulent turbulently turd tureen turf turfs turgid turgidity turgidly turgidness turkey turmeric turmoil turn turnabout turnaround turncoat turncock turned turner turnery turning turnings turnip turnkey turnoff turnout turnover turnpike turnpikes turnround turns turntable turnup turpentine turpitude turps turquoise turret turtle turtledove turtleneck turtles turves tusk tusks tussle tussock tutelage tutor tutorial tutorials tutoring tutorings tutors tutorship tutu tux tuxedo tuxedos twaddle twain twang twat twayblade tweak twee tweed tweediness tweedle tweeds tweedy tweet tweets tweezer twelfth twelfths twelve twelvemonth twelves twenties twenty twerp twice twices twiddle twiddler twig twilight twilights twilit twill twin twinberry twine twinge twinkle twinkling twinned twins twirl twirler twirp twist twisted twister twisting twists twisty twit twitch twitching two twoed twoer twofer twofold twoing twopenny twos twoscore twosome tycoon tying tyke tyler tympan tympani tympanic tympanum type typecast typed typeface typer types typesetter typewrite typhoon typhoons typic typical typically typicals typification typify typing typo typographer typography tyrannic tyrannical tyrannise tyrannize tyrannous tyranny tyrant tyre tyro tzar ubermensch udder ugli uglier uglies ugliest uglily ugliness ugly uke ukulele ulcer ulcerate ulceration ulster ulterior ultimate ultimately ultra ultraer ultraest ultraly ultramarine ultramontane ultranationalism ultranationalistic ultraness ultras ultrasonic ultrasonography ultrasound ultraviolet ululate ululation umbellar umbellate umber umbilicus umbrage umbrageous umbrella umbrellas ump umpirage umpire umpires unable unableness unabler unablest unably unaccented unacceptable unaccepted unaccessible unaccommodating unaccompanied unaccountable unacknowledged unacquainted unadapted unadjusted unadulterated unadvisable unadvised unaffected unaffectionate unaffixed unafraid unagitated unai unaired unalienable unalike unalterability unalterable unaltered unambiguous unambiguously unanimous unannealed unanticipated unappareled unappealing unappeasable unappreciated unapproachable unarm unarmed unarmored unarmoured unarticulated unashamed unassailable unassisted unassumingness unattached unattackable unattended unattired unattractive unau unauthentic unauthorised unauthorized unavailing unavoidably unavowed unawakened unaware unawareness unawares unbacked unbalance unbalanced unbarred unbeatable unbecoming unbelief unbelievable unbelievably unbelieving unbeloved unbend unbendable unbending unbent unbiased unbiassed unbleached unblinking unblock unbloody unbodied unbolted unborn unborner unbornest unbornly unbornness unbosom unbound unbounded unboundedness unbowed unbrace unbridled unbroken unburden unburdened unbuttoned uncanny uncaring uncase uncategorised uncategorized uncaused unceasing unceasingly unceremonial unceremonious uncertain uncertainly uncertainness uncertainty unchain unchangeability unchangeableness unchanged unchanging unchangingness unchecked uncheerfulness unchewable unchurch uncivil uncivilised uncivilized unclad unclassified uncle unclean unclear uncles unclimbable uncloak unclothe unclouded uncloudedness unclutter unco uncoerced uncoiled uncollectible uncolored uncoloured uncomely uncomfortable uncomfortableness uncommitted uncommon uncommonness uncomplete uncompleted uncomplicated uncomplimentary uncompounded uncomprehensible uncompress uncompromising unconcern unconcerned unconditional unconditionally unconditionals unconditioned unconfined unconformist uncongenial unconnected unconquerable unconscionable unconscious unconsidered unconsolable unconstipated unconstraint uncontaminated uncontaminating uncontrived uncontrollable unconventional unconventionality unconvertible unconvinced unconvincing uncooperative uncoordinated uncork uncorrectable uncorrected uncorrupted uncounted uncouple uncouth uncouthness uncover uncovering uncritical uncrossed uncrowned uncrystallised uncrystallized unction unctuous unctuousness uncultivated uncultured uncurbed uncurled uncut undated undaunted undecided undecipherable undecomposed undefiled undefinable undefined undependable under underachieve underact underage underarm underbelly underbid underbodice underbody underbred undercharge underclothes underclothing undercoat undercover undercurrent undercut underdeveloped underdevelopment underdrawers underdress underestimate underestimation underexpose underexposure underfoot underframe underfur undergird undergo undergos undergrad undergraduate undergraduates underground undergrounds underhand underhanded underhandedly underhung underlay underlayment underlie underline underlined underliner underlines underling underlining underlying undermine underneath underpants underpass underpayment underperform underpin underplay underprice underquote underrate underrating underreckoning underrun unders underscore undersea underseal undersell undershirt undershirts undershoot undershot underslung underspend understand understandable understanded understander understanding understandings understands understate understated understood understructure understudy undertake undertaked undertaker undertakes undertaking undertide undertone undertow undervalue undervalued underwater underwear underwears underweight underworld underwrite underwriter undeserving undesirable undestroyable undetectable undeterminable undetermined undeterred undeveloped undeviating undid undifferentiated undigested undimmed undirected undischarged undisciplined undiscouraged undiscovered undismayed undisputable undistinguishable undivided undo undock undoer undoes undoing undomesticated undone undos undraped undress undressed undue undulate undulation undutiful undyed undynamic unearth unearthly unease uneasiness uneasy uneconomic uneconomical unedifying uneffective unembellished unembodied unemotional unemotionality unemployment unemployments unencumbered unending unendingly unenergetic unengaged unenlightened unenlightening unentitled unenviable unequal unequaled unequalled unequally unequivocal unequivocally unerasable unessential uneven unevenly unevenness unexampled unexceptionable unexchangeable unexciting unexclusive unexpected unexpectedly unexpended unexplainable unexplained unexploded unexploited unexplored unexpressed unexpressive unfading unfailing unfair unfairer unfairest unfairly unfairness unfaithful unfaithfuls unfaltering unfalteringly unfamiliar unfamiliarity unfashionable unfasten unfastened unfastener unfastidious unfathomable unfathomed unfavorable unfavourable unfazed unfearing unfeathered unfed unfeeling unfeelingly unfeelingness unfeigned unfeignedly unfertile unfinished unfirm unfit unfitness unfitted unfitting unfixed unflagging unflappable unflattering unflawed unfledged unflinching unflurried unflustered unfocused unfocussed unfold unfolded unfolder unfolding unfolds unforced unforeseen unforesightful unforfeitable unforgettable unforgivable unforgivably unforgiving unformed unfortunate unfortunately unfounded unfree unfreeze unfrequented unfriendliness unfriendly unfurl ungainly ungarbed ungarmented ungenerous ungentle unglamorous unglamourous unglazed ungodly ungovernable ungoverned ungraceful ungracefully ungracefulness ungracious ungraciously ungraded ungrateful ungratified ungratifying unguaranteed unguarded unguent unhallow unhallowed unhampered unhappily unhappiness unhappy unhardened unharmed unharmonious unhealthful unhealthy unheeding unhesitating unhindered unhinge unhinged unholy unhopeful unhurried unhurriedness unhurt unidentified unification unified unifieds unifies uniform uniformity uniformness uniforms unify unifyer unifying unilateral unilluminated unilluminating unimaginable unimaginative unimaginatively unimpeachable unimpeachably unimportance unimportant unimprisoned unimproved uninflected uninfluenced uninhibited uninitiate uninitiated uninquiring uninquisitive uninspired uninstall uninstructed unintegrated unintelligent unintelligibility unintelligible unintentional unintentionally uninterested uninteresting uninterrupted unintimidated uninventive uninvited uninviting uninvolved union unionise unionised unionize unionized unions unique uniquely uniqueness uniquer uniques uniquest unironed unison unit unitary unite united unitedly uniter unites unities uniting unitisation unitise unitization unitize units unitted unitter unitting unity univalent universal universalist universalistic universality universe universities university univocal unjust unjustifiable unjustifiably unjustified unjustness unkempt unkemptness unkept unkind unkindly unknot unknowing unknowingness unknowledgeable unknown unknowns unlace unlaced unlade unlatched unlawful unlax unleaded unlearn unlearned unleash unless unlesses unlettered unlifelike unlighted unlikable unlike unlikeable unlikelies unlikely unlikes unlimited unlined unlisted unlit unload unloaded unloader unloading unloads unlock unlocked unlocker unlocking unlocks unlogical unloose unloosen unluckily unlucky unmake unmanageable unmanful unmanfully unmanlike unmanly unmannered unmannerly unmarked unmarketable unmarried unmask unmasking unmatchable unmatched unmated unmeasurable unmeasured unmechanical unmelodic unmelodious unmerchantable unmercifulness unmerited unmindful unmindfulness unmingled unmistakable unmistakably unmixed unmovable unmoved unmoving unmown unmusical unnameable unnamed unnatural unnaturally unnecessarily unnerve unnerved unnerving unnoted unnoticeable unnumberable unnumbered unnumerable unobjectionable unobliging unobservant unobserved unobtainable unoccupied unoffending unofficial unofficially unoiled unopen unordered unorganised unorganized unoriginality unornamented unorthodox unorthodoxy unostentatious unpack unpacked unpacker unpacking unpacks unpaid unpainted unpaired unpalatability unpalatableness unparalleled unpardonably unpatriotic unperceiving unperceptive unpermissiveness unperturbed unpick unpitying unplanned unplayful unpleasantness unpledged unploughed unplowed unplug unplumbed unpointed unpolished unpolluted unprecedented unpredictability unpredictable unprejudiced unpremeditated unpretending unpretentious unprincipled unproblematic unprocessed unprocurable unproductive unproductively unprofitably unprogressive unpromised unprompted unpronounceable unprovoked unqualified unquestionable unquestionably unquestioning unquiet unquotable unranked unravel unreachable unreached unreactive unreadable unreal unrealism unreality unreasonable unreasonably unreasoning unreasoningly unreassuring unrecognised unrecognized unredeemable unredeemed unrefined unreflective unreformable unregenerate unregenerated unregistered unregularity unregulated unrehearsed unrelated unrelenting unreliable unremarkable unremarkably unremitting unremorseful unrepeatable unrepentant unreserved unresistant unresisting unresolvable unresolved unresponsive unrest unrestrained unrestricted unretentive unripe unripened unrivaled unrivalled unroll unruffled unruly unsafe unsaid unsalted unsanctification unsanitary unsated unsatiable unsatiably unsatiated unsatisfied unsaturated unsaved unsavoriness unsavory unsavoury unsay unscalable unscathed unscramble unscrew unsealed unseamed unseasonable unseasonableness unseasoned unseat unsecured unseeable unseeded unseeing unseemly unseen unselfish unselfishness unserviceable unsettle unsettled unsex unshaded unshakable unshakably unshaken unshod unshoed unshrinking unsighted unsized unskilled unskillful unsloped unsmooth unsnarl unsoiled unsoluble unsolvability unsolvable unsolved unsophisticated unsorted unsound unsounded unsoundness unsown unsparing unspeakable unspecific unspent unspoiled unspoilt unspoken unsporting unsportsmanlike unspotted unstable unstableness unstables unstained unstated unsteadily unsteadiness unsteady unstimulating unstinted unstinting unstrain unstrained unstructured unstuck unstudied unstylish unsubdivided unsubstantial unsubtle unsuccessful unsufferable unsufferably unsuitability unsuitable unsuitableness unsuited unsullied unsung unsupported unsure unsurmountable unsusceptibility unsuspecting unsuspicious unswayed unsweet unswept unswerving unswervingly unsyllabic unsymmetric unsymmetrical unsympathetic untactful untainted untalkative untangle untapped untarnished untasted unteach untellable untempered untempting untenable untenanted untested unthankful unthaw unthinking unthinkingly unthoughtful unthoughtfulness untidiness untie untied untier unties until untils untimbered untimeliness untimely untiring untitled unto untold untolder untoldest untoldly untoldness untos untouchable untouched untoward untracked untransmutable untraveled untravelled untreated untried untrimmed untrod untrodden untroubled untrue untrusting untruth untune untuneful untying untypical unusable unuseable unused unusual unusually unutterable unuttered unvalued unvaned unvanquishable unvaried unvarnished unvarying unveil unveiled unveiler unveiling unveils unvendible unverbalised unverbalized unvoiced unvoluntary unwanted unwarrantable unwarranted unwashed unwavering unwaveringly unwearying unwed unwedded unweds unwelcome unwell unwellness unwholesomeness unwieldiness unwieldy unwilling unwind unwinded unwinder unwinding unwinds unwise unwiseness unwished unwitting unworldly unworried unworthiness unworthy unwrap unwritten unyielding unzip upbeat upbeater upbeatest upbeatly upbeatness upbraid upbraiding upbringing upchuck upcoming upcountry update updated updates upend upending upgrade upgrades upheaval uphill uphold upholstery upkeep uplift upload uploaded uploader uploading uploads upmost upon upons upper uppercase upperly uppermost upperness upperrer upperrest uppers uppish uppity upraise upright uprightly uprightness uprise uprising uproar uproarious uproot uprooter upscale upset upsetly upsetness upsets upsetter upsettest upsetting upshot upside upstage upstair upstairs upstanding upstart upsurge uptake upthrow upthrust uptight uptime uptown uptowns upturned upward upwardly upwards upwind urania uranium uranologist uranology urban urbane urbanisation urbanise urbanity urbanization urbanize urbanly urbanner urbanness urbannest urbans urge urgency urgent urgenter urgentest urgently urgentness urges urging urinary urinate urine url urls urn urns urochord urochordate urodele urticaria urticate urtication urus usa usable usage usages usance usda use useable used usedder useddest usedly usedness useds useful usefuler usefulest usefully usefulness usefuls user username usernames users uses usher usherred usherrer usherring ushers using usmc usn ussher ussr usual usualer usualest usually usualness usuals usurer usurious usurp usurpation usury utensil uterus utile utilisation utilise utilitarian utilities utility utilization utilize utilized utilizer utilizes utilizing utmost utopia utopian utter utterance uttered utterer utterly uttermost utterness utterrer utterrest utters uxoricide vacancy vacant vacanter vacantest vacantly vacantness vacate vacation vacations vaccina vaccinate vaccination vaccine vaccines vaccinia vaccinum vacillant vacillate vacillating vacillation vacuity vacuous vacuum vacuums vagabond vagal vagrant vague vaguely vagueness vaguer vaguest vagus vain vainer vainest vainly vainness vains valance vale valediction valedictorian valedictory valence valencia valency valentine vales valet valetudinarianism valiance valiancy valiant valid validate validated validater validates validating validation validder validdest validity validly validness valids vallecula valley valleys valor valorous valorousness valour valse valuable valuableness valuate valuation valuator value valued valuer values valuing valve valves vamoose vamp vamper vampirism van vandal vandyke vane vaned vanes vanguard vanilla vanillas vanish vanishes vanishing vanities vanity vanned vanner vanning vanquish vans vantage vapid vapidity vapidness vapor vaporific vaporing vaporisation vaporise vaporish vaporizable vaporization vaporize vaporous vaporousness vapors vapour vapourific vapourisable vapourish vapourous vapourousness vapours varan variability variable variableness variance variant variate variation varicella varicolored varicoloured varied varieds variegate variegated variegation varies varieties variety variola various varlet varment varmint varna varnish varnishes varsity vary varyer varying vas vascularise vascularize vase vases vassal vast vaster vastest vastly vastness vasts vat vatic vatical vaticinate vaticination vaticinator vats vaudeville vault vaulted vaulter vaulting vaults vaunt vauntingly veal veals veau vector veer veered veerer veering veers veg vega vegetable vegetables vegetal vegetate vegetation vegetational vegetative vegetive veggie vehemence vehement vehicle vehicles veil veiled veiling veils vein veins velar velleity vellicate vellication vellum velocipede velocity velum velvet velvets velvety vena venal venation vend vendable vendee vender vendible vendor vendors vendue veneer veneering venerable venerate venerating veneration vengeance vengeful venial venire venom venomous vent vented venter venthole ventilate ventilation ventilator venting ventral ventricle vents venture ventured venturer ventures venturesome venturi venturing venturous venue venues venus veracious veranda verandah verb verbal verbaler verbalest verbalisation verbalise verbaliser verbalism verbalization verbalize verbalizer verbally verbalness verbals verbiage verbose verboten verbs verdancy verdict verdigris verdure verge veridical verier veries veriest verifiable verification verified verifier verifies verify verifyer verifying verily veriness veritable verity vermicular vermiculate vermiculated vermiculation vermilion vermillion vermin vernacular vernal vernier verruca versatile verse versed verses versification versify version versions verso versus versuses vertebra vertebrate vertex vertical verticality verticalness verticillate verticillated vertiginous vertigo vertu verve very vesica vesicate vesication vesicle vesiculate vesiculation vesper vespers vessel vest vesta vestal vestibule vestige vestigial vestry vests vesture vet veteran veterans veterinarian veterinary veto vetos vets vetted vetter vetting vex vexation vexatious vexed vexer vexes vexing via viability viable viableness viabler viablest viably viands vibe vibrancy vibrant vibrate vibration vibrations vibrato vibrator vicar vicarious vice vicereine viceroy vices vicinity vicious viciously viciousness vicissitude victim victimisation victimise victimised victimization victimize victimized victims victor victoria victorian victories victorious victory victual victualer victualler victuals vicuna videlicet video videodisc videodisk videos videotape vie vied vier vies view viewed viewer viewers viewfinder viewgraph viewing viewpoint views vigil vigilance vigilant vignette vigor vigorish vigorous vigorously vigors vigour vii viii vile vileness vilification vilify vilipend villa village villages villain villainage villainousness villains villainy villas villeinage vim vimmed vimmer vimming vims vinaceous vinaigrette vindicate vindicated vindication vindicatory vindictive vine vinegar vinegarish vinegars vinegary vinery vines vineyard vineyards vino vinous vintage vintner vinyl vinyls viola violate violated violater violates violating violation violations violative violator violence violences violent violents violet violets violin violinist violins violoncellist violoncello viper virago viral virals virgin virginal virginer virginest virginia virginly virginness virgins virgo virgule viridity virile virilise virility virilize virtu virtual virtualization virtually virtuals virtue virtuoso virtuous virtuously virtuousness virulence virulency virulent virus viruses visa visage visas visceral viscerally viscid viscidity viscidness viscose viscount viscountcy viscountess viscounty viscous visibility visible visibleness visibles visibly vision visionary visions visit visitant visitation visitor visitors visits visor visors vista vistas visual visualer visualest visualise visualised visualize visualized visualizer visualizes visualizing visually visualness vital vitalise vitaliser vitality vitalize vitalizer vitalness vitals vitamin vitamins vitellus vitiate vitiated vitreous vitrification vitrified vitrify vitrine vitriol vitriolic vituperate vituperation viva vivacious vivid vividder vividdest vividly vividness vivids vivification vivify vixen vizor vlog vocabularies vocabulary vocal vocalic vocalisation vocalise vocaliser vocalism vocalist vocalization vocalize vocalizer vocaller vocallest vocally vocalness vocals vocation vociferation vociferous vodka vodkas vodoun vogue vogueing voguish voice voiced voiceless voicelessness voicemail voicer voices voicing void voidance voider voiding voids volaille volatile volatilisable volatility volatilizable volcanic volcano volcanos vole volition volley volleyball volleyballs volleys volt volta voltage voltaic volts volubility volume volumed volumes voluminous voluntary volunteer volunteered volunteerer volunteering volunteers voluptuary voluptuous voluptuously voluptuousness volute voluted vomit vomiting vomitive vomitus voodoo voodooism voracious voraciousness voracity vortex votary vote voted voteless voter voters votes voting vouch vouched voucher vouchers vouches vouching vow vowed vowel vowelise vowelize vower vowing vows vox voyage voyeur vpn vulcanise vulcanize vulgar vulgarisation vulgarise vulgariser vulgarism vulgarity vulgarization vulgarize vulgarizer vulnerability vulnerable vulture vultures vulturine vulturous vying wacky wad wadded wadder wadding waddle wade waded wader wades wading wads wafer waffle waffles waft wafture wag wage wager wagerer wagerred wagerrer wagerring wagers wages wagged wagger waggery wagging waggishness waggle waggon wagon wags wahoo wail wails wain wainscot wainscoting wainscotting waist waistband waistcloth waistcoat waistline waists wait waited waiter waiting waitress waitresses waits waive waived waiver waives waiving wake wakeful wakefulness wakeless waken waker wakes waking waldmeister wale walk walkabout walkaway walked walker walkers walking walkout walkover walks walkway wall wallaby wallboard wallet wallets walleye wallflower wallop walloper walloping wallow wallowed wallower wallowing wallows wallpaper wallpapers walls walnut walnuter walnutest walnutly walnutness walnuts walrus walruses waltz waltzes wamble wampum wampumpeag wan wand wander wandered wanderer wandering wanderlust wanders wandflower wands wane wangle wangling wank wanly wanna wannabe wannabee wanner wanness wannest want wanted wanting wantings wanton wantonly wantonness wants wapiti war waratah warble warbler ward warded warder warding wardrobe wardrobes wards ware warehouse warehouses warehousing warfare warhead warhorse warlike warm warmed warmer warmest warmhearted warmheartedness warming warmly warmness warms warmth warmup warn warned warner warning warns warp warpath warped warper warping warps warragal warrant warrantee warranter warranties warrantor warrants warranty warred warren warrer warrigal warring warriorlike wars wart warts warwick wary was wasabi wases wash washables washbasin washboard washbowl washcloth washed washer washes washing washington washout washrag washroom washstand washup washy wasnt wasp waspish wasps wassail wassailer wassed wasser wassing wastage waste wasted wasteder wastedest wastedly wastedness wasteful wastefulness wasteland wastely wasteness waster wastes wastest wasteweir wasteyard wasting watch watchband watchdog watched watcher watches watchful watchfulness watchfuls watching watchstrap watchword water waterborne watercolor watercolour watercourse watercraft watercress waterer waterfall waterfalls waterfinder waterfront waterfronts wateriness watering waterless waterlessness waterlogged waterloo watermark watermelon watermelons waterproof waterproofed waterproofing waterred waterrer waterring waters waterscape watershed waterspout watertight waterway waterwheel waterworks watery watt wattle waul wave waved wavelength wavelet wavelike waver wavering waves wavies waviness waving wavy wawl wax waxberry waxed waxen waxer waxes waxflower waxies waxing waxlike waxwork waxy way wayfarer wayfaring waylay ways wayside wayward weak weaken weakened weakener weakening weakens weaker weakest weakfish weakling weakly weakness weaks weal wealth wealthiness wealths wealthy wean weaning weapon weaponed weaponry weapons wear wearable wearied wearier weariest wearily weariness wearing wearisome wears weary weasel weasels weather weatherboard weatherboarding weathers weathervane weave weaver weaverbird weaves weaving web webbed webbing webby webcam webcams weber webinar weblike webpage webs website websites webster wed wedded wedder wedding wedge wedged wedger wedges wedging wedlock wednesday wednesdays weds wee weed weeder weeds weedy week weekend weekender weekends weeklier weeklies weekliest weeklily weekliness weekly weeks weeness weenie weep weeped weeper weeping weeps weewee weft weigh weighed weigher weighing weighs weight weighted weightily weightiness weighting weights weighty weil weir weird weirder weirdest weirdie weirdly weirdness weirdo weirdy welch welcome welcomed welcomer welcomes welcoming weld welded welder welding welds welfare welfares welkin well wellbeing wellhead wellington wellness wells wellspring welsh welshman welt welter welterweight welts wench went wents were werent weres west westbound westerly western westerns wests westward wet wetback wetland wetlands wetly wetness wetnurse wets wetted wetter wettest wetting weve whack whacker whacking whacky whale whaler whales wham whammy whang whap wharf wharfage wharfs wharves what whatd whatever whatevers whatll whatnot whats whatsoever wheal wheat wheats wheedle wheedling wheel wheelbarrow wheelbarrows wheelchair wheelchairs wheeled wheeler wheeling wheels wheeze wheezing wheezy whelk whelm whelp when whenever whenevers whens where whereas whered wherefore wheres wheresoever wherever wherevers wherry whet whether whetstone whey wheys which whiches whiff whig while whiles whim whimper whimsey whimsical whimsicality whimsy whin whinberry whine whined whiner whines whiney whining whinstone whiny whip whipcord whiplash whipped whipper whippersnapper whippet whippets whipping whippy whips whipsaw whir whirl whirled whirler whirligig whirling whirlpool whirlpools whirls whirlybird whirr whirring whish whisk whisked whisker whiskered whiskerless whiskers whiskery whiskey whiskeys whisking whisks whisky whisper whispered whisperer whispering whispers whistle whistler whistles whistling whit white whitebait whiteboard whiteface whitefish whitehead whitelist whiten whitened whitener whiteness whiteout whites whitethorn whitethroat whitewash whitewater whitewood whiting whitish whitlow whittle whiz whizbang whizz whizzbang who whod whodunit whoed whoer whoever whoing whole wholehearted wholeness wholer wholes wholesale wholesaler wholesales wholesome wholesomes wholest wholl wholly wholy whom whomp whoop whooper whoosh whop whopper whore whorehouse whoremaster whoremonger whoreson whorl whorled whortleberry whos whose whoses whove why whys wicca wiccan wick wicked wickeder wickedest wickedly wickedness wicker wickerwork wicket wicks wickup wicopy wide wideband widely widen wideness widening widenned widenner widenning widens wider wides widespread widest widget widgets widow widowhood widows width wield wielded wielder wielding wields wiener wienerwurst wife wifi wifis wig wigged wigger wigging wiggle wiggler wiggly wight wigs wigwag wild wildcat wildebeest wilder wilderness wildernesses wildest wildfire wildfires wilding wildlife wildly wildness wilds wile wilful wiliness will willful williams willing willings willow willpower wills wilt wilted wilter wilting wilts wily wimble wimp win wince winced wincer winces winchester wincing wind windage windbag windbreaker windcheater winded winder windfall windflower windier windiest windily windiness winding windmill window windowpane windows windowsill windpipe winds windscreen windshield windshields windsock windup windward windy wine wineberry winemaker winery wines winfred wing wingback winged wings wingspan wingspread wink winker winking winkle winks winner winners winning winnings winnow winnowing wino wins winter winterberry wintergreen winters wintertime wintery wintry wipe wiped wipeout wiper wipes wiping wire wired wireless wirelesses wireman wirer wires wiretap wirework wiring wiry wisconsinite wisdom wisdoms wise wisecrack wisely wiseness wisent wiser wises wisest wish wished wisher wishes wishful wishing wisp wisplike wisps wispy wistful wit witch witches witchgrass with withal withdraw withdrawal withdrawer withdrawing withdrawn withdrawnness withdraws withdrew withe wither withered witherer withering withers withhold withholder withholding within withins without withstand withstander withy witless witloof witness witnessed witnesser witnesses witnessing wits witted witter witticism wittiness witting witty witwatersrand wive wives wiz wizard wizardly wizardry wizen wizened wlan woad woadwaxen wobble wobbly woe woebegone woed woeful woefully woefulness woer woes woing wok woke woked woken woker wokes woking wokked wokker wokking woks wolf wolffish wolfish wolflike wolfs wolverine wolverines wolves woman womanhood womanise womanize womanly womans womb wombat wombs women womens won wonder wondered wonderer wonderful wondering wonderingly wonderland wonderment wonders wondrous wonk wonky wonned wonner wonning wons wont wonton woo wood woodbine woodchuck woodcraft woodcut wooden woodener woodenest woodenly woodenness woodens woodgrain woodiness woodland woodlet woodman woodpecker woodpeckers woodruff woods woodsiness woodsman woodsy woodward woodwaxen woodwind woodwork woodworker woodworking woody wooed wooer woof wooing wool woolen woolgather woolgathering woollen woolly wools wooly woos woosh woozy wop worcester word wording wordless wordplay words wordy wore wores work workable workaday workbench workday worked worker workers workerses workfellow workforce workforces workhorse workhouse working workings workmanship workmate workout workouts workplace workplaces works worksheet workshop workshops workweek world worldliness worldling worldly worlds worldwide worm wormcast wormlike worms wormy worn worner wornest wornly wornness worns worried worrieds worries worriment worrisome worry worryer worrying worse worsen worsened worsening worses worship worshiped worshiper worshipful worshiping worshipper worships worst worsted worsts wort worth worthful worthier worthies worthiest worthily worthiness worthless worthlessness worths worthwhile worthy would wouldnt woulds wouldve wound wounded wounder wounding wounds wove woven wow wowed wower wowing wows wrack wraith wraithlike wrangle wrangler wrangling wrap wrapped wrapper wrappers wrapping wraps wrath wrawl wreak wreath wreathe wreck wrecked wrecker wrecking wrecks wren wrench wrenched wrencher wrenches wrenching wrens wrestle wrestled wrestler wrestles wrestling wretch wretched wretchedness wrick wriggle wriggler wriggling wriggly wright wring wringing wrings wrinkle wrinkled wrinkly wrist wristband wrists writ write writer writers writes writhe writhing writing writings writs written wrong wrongdoing wronger wrongest wrongful wrongfulness wrongly wrongness wrongs wrote wrotes wrought wrung wry wryneck wuss www wynfrith wyrd xanthous xerotes xerox xii xiii xiv xix xray xtc xvi xvii xviii xxx yacht yachts yack yahoo yak yaks yakuza yale yall yam yammer yams yank yanked yankee yanker yanking yanks yap yaps yard yardbird yarder yardman yards yardstick yarn yarns yaup yaw yawl yawn yawned yawner yawning yawns yawp yaws yea yeah year yearbook yearbooks yearlies yearling yearlong yearly yearn yearned yearner yearning yearns years yeas yeast yeastlike yeasty yell yelled yeller yelling yellow yellowbird yellowed yellowhammer yellowish yellowness yellows yellowtail yellowwood yells yelp yen yens yenta yeoman yeomanry yep yes yesterday yesterdays yesteryear yet yets yew yews yib yield yielded yielder yielding yields yip yob yobbo yobibyte yobo yodel yoga yogas yoghourt yoghurt yogi yogurt yogurts yoke yokel yokelish yokes yolk yolks yottabyte you youd youll young younger youngers youngest youngly youngness youngs youngster youngsters younker your youre yours yourself yourselfs yourselves yous youth youthful youthfulness youths youve yowl yuan yucky yummy zaftig zaire zany zap zapped zapper zapping zaps zeal zealot zealous zeals zebibyte zebra zebras zebrawood zeitgeist zen zens zep zephyr zeppelin zero zeroed zeroer zeroest zeroing zeroly zeroness zeros zest zester zestful zestfulness zests zesty zetland zettabyte zhou zib zilch zillion zimmer zinc zincs zinfandel zing zion zip zipped zipper zipping zippo zippy zips zit zither zithern zizz zodiac zodiacs zoftig zombi zombie zona zonal zonary zone zones zoo zooerastia zooerasty zoological zoology zoom zoomed zoomer zooming zooms zoos zucchini zucchinis zulu zymolysis zymolytic zymosis zymotic`.split(/\s+/).filter(w => w.length >= 3);

// ─── Main build process ────────────────────────────────────────────

function main() {
    const allWords = new Set();

    // 1. Add all base words from our curated lists
    for (const w of NOUNS) allWords.add(w.toUpperCase());
    for (const w of VERBS) allWords.add(w.toUpperCase());
    for (const w of ADJECTIVES) allWords.add(w.toUpperCase());
    for (const w of OTHER_WORDS) allWords.add(w.toUpperCase());
    for (const w of TWO_LETTER_WORDS) allWords.add(w.toUpperCase());
    for (const w of MANUAL_EXTRAS) allWords.add(w.toUpperCase());
    for (const w of CONTRACTIONS) allWords.add(w.toUpperCase());
    for (const w of WORDNET_EXTRAS) allWords.add(w.toUpperCase());
    for (const w of ENRICHED_WORDS) allWords.add(w.toUpperCase());
    console.log(`Base words: ${allWords.size} (including ${TWO_LETTER_WORDS.length} two-letter words, ${MANUAL_EXTRAS.length} manual extras, ${CONTRACTIONS.length} contractions)`);

    // 2. Generate proper inflections
    const beforeInflect = allWords.size;

    // Noun plurals
    for (const noun of NOUNS) {
        const forms = pluralize(noun.toLowerCase());
        for (const f of forms) allWords.add(f.toUpperCase());
    }

    // Irregular plurals
    for (const [singular, plural] of Object.entries(IRREGULAR_PLURALS)) {
        allWords.add(singular.toUpperCase());
        allWords.add(plural.toUpperCase());
    }

    // Verb forms
    const irregularVerbBases = new Set(Object.keys(IRREGULAR_VERBS));
    for (const verb of VERBS) {
        const vl = verb.toLowerCase();
        if (irregularVerbBases.has(vl)) {
            allWords.add(vl.toUpperCase());
            for (const form of IRREGULAR_VERBS[vl]) allWords.add(form.toUpperCase());
        } else {
            const forms = verbForms(vl);
            for (const f of forms) allWords.add(f.toUpperCase());
        }
    }

    // Also add irregular verb forms that may not be in VERBS list
    for (const [base, forms] of Object.entries(IRREGULAR_VERBS)) {
        allWords.add(base.toUpperCase());
        for (const f of forms) allWords.add(f.toUpperCase());
    }

    // Adjective forms (only for short adjectives that naturally take -er/-est)
    for (const adj of ADJECTIVES) {
        const al = adj.toLowerCase();
        if (al.length <= 6) {
            const forms = adjectiveForms(al);
            for (const f of forms) allWords.add(f.toUpperCase());
        }
    }

    console.log(`Generated ${allWords.size - beforeInflect} inflected forms`);

    // 3. Filter: remove banned words, too-short words, non-alpha
    const filtered = [];
    for (const w of allWords) {
        if (w.length < 2) continue;
        if (!/^[A-Z]+$/.test(w)) continue;
        if (BANNED.has(w)) continue;
        filtered.push(w);
    }

    // 4. Sort and write words.json directly
    filtered.sort();
    const filteredSet = new Set(filtered);

    // 5. Build category maps (only include words that exist in the dictionary)
    const categoryDefs = {
        food:       { words: CATEGORY_FOOD,       label: "Food & Cooking",  icon: "🍕" },
        animals:    { words: CATEGORY_ANIMALS,     label: "Animals",         icon: "🐾" },
        sports:     { words: CATEGORY_SPORTS,      label: "Sports",          icon: "⚽" },
        nature:     { words: CATEGORY_NATURE,      label: "Nature",          icon: "🌿" },
        technology: { words: CATEGORY_TECHNOLOGY,  label: "Technology",      icon: "💻" },
        body:       { words: CATEGORY_BODY,        label: "Body & Health",   icon: "🫀" },
        music:      { words: CATEGORY_MUSIC,       label: "Music",           icon: "🎵" },
        home:       { words: CATEGORY_HOME,        label: "Home",            icon: "🏠" },
        clothing:   { words: CATEGORY_CLOTHING,    label: "Clothing",        icon: "👗" },
        science:    { words: CATEGORY_SCIENCE,     label: "Science",         icon: "🔬" },
        nouns:      { words: NOUNS,                label: "Nouns",           icon: "📦" },
        verbs:      { words: VERBS,                label: "Verbs",           icon: "⚡" },
        adjectives: { words: ADJECTIVES,           label: "Adjectives",      icon: "✨" },
    };
    const categories = {};
    for (const [key, def] of Object.entries(categoryDefs)) {
        const baseWords = def.words.map(w => w.toUpperCase()).filter(w => filteredSet.has(w));
        // Expand: also include inflected forms (plurals, verb forms) that exist in dictionary
        const expanded = new Set(baseWords);
        for (const base of baseWords) {
            const bl = base.toLowerCase();
            for (const form of pluralize(bl)) {
                const uf = form.toUpperCase();
                if (filteredSet.has(uf)) expanded.add(uf);
            }
            for (const form of verbForms(bl)) {
                const uf = form.toUpperCase();
                if (filteredSet.has(uf)) expanded.add(uf);
            }
        }
        categories[key] = { label: def.label, icon: def.icon, words: [...expanded].sort() };
        console.log(`  Category "${def.label}": ${categories[key].words.length} words (${categories[key].words.length - baseWords.length} inflected)`);
    }

    const output = { words: filtered, categories };
    const outFile = path.join(__dirname, 'words.json');
    fs.writeFileSync(outFile, JSON.stringify(output));

    console.log(`\nDone! Wrote words.json: ${filtered.length} words (${fs.statSync(outFile).size} bytes)`);

    // Verify some common words
    const set = filteredSet;
    console.log('\nVerification:');
    for (const w of ['CAT', 'CATS', 'DOG', 'DOGS', 'RUN', 'RUNS', 'RUNNING', 'RAN',
                      'PLAY', 'PLAYS', 'PLAYED', 'PLAYING', 'PLAYER',
                      'WALK', 'WALKS', 'WALKED', 'WALKING',
                      'HOUSE', 'HOUSES', 'GAME', 'GAMES',
                      'FALL', 'FALLS', 'FELL', 'FALLEN', 'FALLING',
                      'BIG', 'BIGGER', 'BIGGEST',
                      'HAPPY', 'HAPPIER', 'HAPPIEST', 'HAPPILY',
                      'CHILDREN', 'PEOPLE', 'WOMEN', 'TEETH', 'MICE',
                      'AM', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO',
                      'HE', 'IF', 'IN', 'IS', 'IT', 'ME', 'MY', 'NO',
                      'OF', 'OK', 'ON', 'OR', 'SO', 'TO', 'UP', 'US', 'WE']) {
        console.log(`  ${w}: ${set.has(w) ? 'YES' : 'NO'}`);
    }
}

main();

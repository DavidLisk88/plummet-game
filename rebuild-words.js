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

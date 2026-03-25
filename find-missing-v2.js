// find-missing-v2.js — Advanced missing word finder
// Organized by real-life categories so nothing slips through.
// Every word here is something a normal American would say, read, or hear daily.

const fs = require('fs');
const path = require('path');

const wordsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
const currentWords = new Set(wordsJson.map(w => w.toUpperCase()));

// ═══════════════════════════════════════════════════════════════════════
// CATEGORY-ORGANIZED COMMON AMERICAN ENGLISH WORDS
// Every word must pass: "Would a typical American use or understand this
// word in normal conversation, texting, TV, or everyday reading?"
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = {

// ─── FOOD & DRINK ───────────────────────────────────────────────────
food: `
apple apricot avocado bacon bagel banana bean beef berry biscuit bread broccoli
brownie burger burrito butter cake candy caramel carrot celery cereal cheese
cherry chicken chili chip chocolate cinnamon clam cobbler coconut cod coffee
cookie corn cracker cranberry cream croissant crouton cucumber cupcake curry
danish dessert dip donut dough dressing dumpling egg enchilada fajita fig fish
flour fries frosting fruit fudge garlic ginger grape gravy guacamole ham
hamburger herb honey hummus ice jam jelly juice kale ketchup lemon lettuce lime
loaf lobster macaroni mango maple mayo meat meatball melon milk milkshake mint
muffin mushroom mustard noodle nut oat oatmeal olive onion orange pancake
parsley pasta peach peanut pear pepper pepperoni pickle pie pineapple pizza
plum popcorn pork potato pretzel pudding pumpkin radish raisin ranch raspberry
recipe rib rice roll salad salmon salsa sandwich sauce sausage seafood sesame
shrimp smoothie snack soda soup spaghetti spice spinach steak stew strawberry
sugar sundae sushi sweet syrup taco toast tofu tomato tortilla tuna turkey
vanilla vegetable vinegar waffle walnut watermelon wheat whip wine wing wrap
yam yogurt zucchini
`,

// ─── BODY & HEALTH ──────────────────────────────────────────────────
body: `
ankle arm back beard belly blood body bone brain breast breath chest chin
column ear elbow eye eyebrow eyelash face fat finger fist foot forehead gut
hair hand head heart heel hip jaw joint kidney knee knuckle leg limb lip liver
lung mouth muscle nail neck nerve nose palm rib scalp shin shoulder skeleton
skin skull spine stomach teeth thigh throat thumb toe tongue tooth torso vein
waist wrist
ache allergy antibiotic aspirin bandage bleed blister bruise burn cancer cast
checkup clinic cold condition cough cure dentist diagnosis diet disease dizzy
doctor dose drug exercise fever flu germ gym headache heal health heart hormone
hospital hurt illness immune infection injection injury itch medicine migraine
nausea nurse ointment operation pain patient pharmacy pill poison pregnant
prescription pulse rash recover remedy scar scrape shot sick sneeze sore
stress stretch sting stroke sunburn surgery sweat symptom temperature therapy
thermometer tissue treatment vaccine virus vitamin wound
`,

// ─── FAMILY & PEOPLE ────────────────────────────────────────────────
people: `
adult aunt baby bachelor bald beard blonde boss boyfriend bride brother buddy
child children classmate coach companion coworker cousin crush dad daughter
elder enemy ex family father female fiance fiancee folks friend gentleman girl
girlfriend godfather godmother grandchild granddaughter grandfather grandmother
grandparent grandson groom grownup guardian guy hero heroine host hostess
household human husband infant junior kid king knight lady landlord landlady
lover male man mate mayor mentor minister mom mother neighbor niece nobody
orphan parent partner passenger patient patron peer person pet player poet
prince princess professor queen relative rival roommate senior sibling sister
somebody someone son spouse stranger student teacher teenager tenant toddler
tribe twin uncle veteran victim villain visitor widow wife witness woman women
worker youngster youth
`,

// ─── HOME & HOUSEHOLD ───────────────────────────────────────────────
home: `
alarm apartment attic balcony barn basement bathroom bathtub bed bedroom bench
blanket blinds bookshelf bottle bowl brick broom bucket cabinet candle carpet
ceiling chair chimney closet couch counter cradle cupboard curtain cushion deck
doorbell doorknob doorstep doorway drawer dresser dryer driveway dust fan 
faucet fence fireplace floor freezer furniture garage garden gate glass grill
gutter hallway hammer handle hanger heater hose house household iron jar
kettle key kitchen knob ladder lamp latch laundry lawn light lock mailbox
mantle mat mattress mirror mop mug nail napkin nightstand oven pad paint pan
pantry patio pillow pipe plank plate pliers plumbing plug porch pot rack rag
refrigerator remote roof room rug saw screen screw shed shelf shower sink sofa
sponge spoon stairs stool stove switch table tile toilet tool towel trash tray
tub vacuum vase wall washer window wipe yard
`,

// ─── CLOTHING & FASHION ────────────────────────────────────────────
clothing: `
apron belt bikini blazer blouse boot bracelet buckle button cape cardigan chain
closet coat collar cotton costume crown diaper dress earring fabric fashion
flannel flip fur glasses glove gown handbag hat heel hood hoodie jacket jean
jersey jewel jewelry lace leather loafer mask mitten necklace nightgown outfit
overalls pajamas pants patch pattern pearl pin plaid pocket polo ponytail purse
robe sandal scarf shirt shoe shorts silk skirt sleeve sneaker sock stain strap
stripe suit sunglasses sweater swimsuit tank thread tie tights tuxedo umbrella
undershirt underwear uniform velvet vest wallet wardrobe watch wig wool wrist
zipper
`,

// ─── TRANSPORTATION & VEHICLES ──────────────────────────────────────
transport: `
accident airline airplane airport ambulance arrival ax axle bicycle bike board
boat brake bridge bumper bus cab cabin cable canal canoe captain cargo carpool
charter collision commute convertible crash crossing cruise cyclist dashboard
depart departure destination diesel dock downtown drive driver driveway engine
exit expressway fare ferry flight freeway fuel garage gas gear guardrail
handlebar headlight helicopter highway hood horn hub interstate intersection
lane license limousine luggage map mechanic merge mileage minivan mirror
motorcycle muffler navigate overpass parking passenger pavement pedestrian
pickup pilot plane platform plug port propeller radar railroad ramp rider road
route runway saddle sail sailboat sailor scooter seatbelt semi ship shortcut
shuttle sidewalk signal skateboard speed speedometer steer steering submarine
subway suitcase tank taxi terminal ticket tire tow tower track traffic trailer
train transit transport transportation travel trolley truck trunk tunnel turn
turnpike van vehicle wheel windshield wing yacht
`,

// ─── WORK & CAREER ──────────────────────────────────────────────────
work: `
accountant actor agenda analyst applicant appointment architect artist assembly
assistant attorney audit badge baker banker bartender benefit board bonus boss
brand broker budget builder business buyer career carpenter cashier chairman
chef clerk client clinic coach colleague commission committee company conference
consultant contract contractor coordinator corporation counsel coworker
customer deadline deal dealer delivery demand department designer developer
director discount dispatch distributor doctor draft driver duty earnings editor
electrician employee employer employment engineer enterprise entrepreneur
equipment estimate executive experience expert export factory farmer
feedback finance firefighter firm founder freelance fund furniture goal grant
headquarters hire housing import income industry inspector insurance intern
interview inventory invest investor invoice janitor journalist judge labor
landlord launch lawyer layout leader librarian loan lobby logistics maintenance
manager manufacturer market marketing mechanic media meeting mentor merchant
minister mortgage network nurse occupation offer office officer operator
organization outlet overhead owner painter paramedic partner patent paycheck
payment payroll pension permit photographer pilot plumber policy portfolio
position postal practice president producer profession professional professor
profile profit program programmer project promotion property proposal prospect
provider publisher raise ranger realtor receipt recruit referee referral rent
reporter representative request research researcher resource restaurant retail
retailer retirement revenue review roster salary salesman schedule secretary
sector security sergeant server shift shipping shortage skill software soldier
specialist staff startup station stockbroker strategy studio success supervisor
supplier surgeon talent task technician tenant therapist tip trademark trainer
transfer unemployment union utility vendor venture veteran volunteer wage
warehouse warranty website wholesale worker workforce workplace workshop
`,

// ─── SCHOOL & EDUCATION ────────────────────────────────────────────
school: `
absent academy algebra alphabet assignment attribute audit backpack biology
blackboard board bookmark bully cafeteria calculus campus career certificate
chalk chapter chart cheat chemistry class classroom coach college composition
computer conference counselor course crayon curriculum dean debate degree desk
detention diploma discipline draft education elementary enrollment eraser essay
exam examination exercise experiment expel faculty fiction final flashcard
folder formula freshman geography geometry gifted glossary grade graduate
graduation grammar guidance gymnasium hallway handout heading highlight
homework honor instruction instructor journal junior kindergarten knowledge
language lecture lesson library literacy literature locker lunch major marker
mascot math mathematics mentor midterm minor multiplication notebook nursery
paragraph pencil period philosophy physics plagiarism playground pop practice
principal problem professor program project preschool psychology publish pupil
puzzle quiz reader recess reference report research review roster rule scholar
scholarship science semester senior session skill spelling student study subject
substitute syllabus teacher technology term test textbook thesis title topic
tutor tutoring undergraduate university vocabulary volume yearbook
`,

// ─── EMOTIONS & PERSONALITY ─────────────────────────────────────────
emotions: `
admire adore afraid agony amaze anger angry annoy anxiety anxious appreciate
arrogant ashamed astonish attitude awe awkward bitter bless bliss blush bold
bore bother brave calm care carefree cautious cheer cheerful chill clever
comfortable concern confident confuse contempt content courage coward cranky
crazy creative cruel curious daring defeat delight deny depressed desire
despair despise devoted disappoint disgust disturb doubt doubtful dread eager
embarrass embrace emotional empathy encourage enjoy envy evil excite exhaust
faith fascinate fear fierce fond foolish forgive frantic frenzy friendly
frighten frustrated fulfill furious generous gentle genuine giddy glad glee
gloomy glow graceful grateful greed grief grumpy guilt guilty guts happy harsh
hate hope hopeful hopeless horror hostile humble humor humorous hysterical
ignore impatient impress impulse independent innocent insecure inspire intense
interest intimate irritate jealous jolly joy joyful keen kind kindness laugh
lazy lively lonely longing love loyal lust mad mature mean mellow mercy merry
miserable modest mood moody motive naughty neglect nervous nice nightmare
noble numb obsess offend optimistic outrage overcome overwhelm panic paranoid
passion passionate patience patient peaceful pity playful pleasant pleased
pleasure polite positive possessive precious pride profound proud provoke rage
rebel regret reject relax relief resist restless revenge rude ruthless sad
sane satisfy scare selfish sensitive serious shame shock shy sincere sloppy
smart smug sober solemn sorrow sorry sour spirit spiteful stern stingy stress
strong stubborn stunned stupid suffer sulk surprise suspicious sweet sympathy
tender tense terrify thankful thrill timid tired tolerate tough tragic tremble
triumph trust trustworthy ugly uncertain uncomfortable uneasy ungrateful
unhappy upset vain vibrant vicious vigor violent vulnerable warm wary weary
weird wicked wild willing wise wit witty wonder worried worship worthy wreck
yearn zeal
`,

// ─── NATURE & WEATHER ───────────────────────────────────────────────
nature: `
acre ash atmosphere autumn bark bay beach birch bloom blossom boulder branch
breeze brook brush bud bush canyon cave cliff climate cloud coast coral country
countryside creek current dam dawn desert dew dirt drought dry dune dusk dust
earthquake east echo eclipse ember environment erosion field fire flame flood
flower fog forest freeze frost galaxy garden glacier globe gorge grass gravel
grove gust harbor harvest hay haze heat hedge hill horizon hurricane ice island
jungle lake landscape lava lawn leaf lightning lily log marsh meadow mineral
moisture moon moss mountain mud nature north oak ocean orbit orchid outdoor
oxygen palm pasture path patio pebble petal pine plain planet plant plateau
plunge poison pollute pond pool prairie puddle rain rainbow rapids reef ridge
ripple river rock root rose sand sea season seed shade shadow shell shore shrub
sky slope smoke snowflake soil south spring star stem stone storm stream summit
sun sunflower sunlight sunrise sunset sunshine surf swamp terrain thermometer
thorn thunder tide timber tornado trail tree tropical trunk tsunami tulip
tundra valley vapor vine volcano wave weather weed west wetland wheat
whirlpool wilderness wildfire wind winter wood
`,

// ─── SPORTS & RECREATION ───────────────────────────────────────────
sports: `
ace archery arena athlete athletic badminton ball base baseball basket
basketball bat batter bench bicycle bike block board boat bow bowl bowling box
boxer boxing camp campfire camping canoe captain card catch champion
championship cheer cheerleader climb climbing coach coin competition
competitor contest corner court cricket cross cycling dart defense diamond dice
dive diver diving dodge dominoes draft dribble drill exercise fan fencing
field final fish fishing flag football foul freestyle frisbee game goal goalie
golf golfer grill gym gymnast gymnastics halftime handball hike hiking hockey
home homer homework hoop hurdle ice inning jog jogging judge jump kayak kick
kicker kickball lacrosse lane lap lead league lifeguard lineup marathon match
medal meet motorcycle net offense opponent outdoor outfield overtime paddle
paintball par park pass penalty ping pitch pitcher play player playoff pocket
point polo pool practice puck punt puzzle race racer rack racket rally referee
relay rematch ride rider rifle ring rink rival roller round rowing rugby run
runner rush score scout season serve server set shot sideline singles skate
skateboard ski skiing slam slice soccer softball speed sprint squad stadium
strike stroke surf surfing swim swimmer swimming tackle tag team teammate
tennis tie timeout tournament track trail trap triathlon trophy trot tryout
umpire uniform vault volleyball walk water whistle win winner workout
wrestling yoga
`,

// ─── TECHNOLOGY & MEDIA ─────────────────────────────────────────────
tech: `
account alarm algorithm animation app application audio avatar backup battery
binary blog bluetooth bookmark broadband browser bug button byte cable cache
camera cellular channel charger chat chip click clipboard cloud code compute
computer connect connection console cookie copy copyright crash cursor data
database default delete delivery desktop developer device digital disc disk
display domain dot download drag drive driver drone edit email emoji encode
engine error ethernet export extension feedback fiber file filter firewall
firmware flash folder font format forum frame frequency game gaming gigabyte
glitch graphic grid hack hacker handle hardware hashtag headphone homepage host
hotspot icon inbox input install instant interface internet keyboard laptop
laser layout lens library like link live load lobby login loop malware media
megabyte memory menu message microphone modem monitor motherboard mouse mute
navigate network notification offline online operating output password paste
patch photo pixel platform player playlist plugin podcast popup portal post
power preview print printer privacy process processor profile program
programmer prompt provider queue radio reboot record remote render reply
resolution retweet ringtone robot router scan scanner screen screenshot scroll
search selfie sensor server setting setup signal silicon site smartphone
snapshot social socket software speaker startup status storage stream
streaming subscribe surf swipe sync system tab tablet tag tech technology
template terminal text thread thumbnail timeline toggle toolbar touchscreen
transfer trending troll troubleshoot tutorial tweet undo update upgrade upload
url user username version video viral virtual volume wallpaper web webcam
website widget wifi wireless zoom
`,

// ─── MONEY & SHOPPING ───────────────────────────────────────────────
money: `
account afford allowance amount asset auction balance bank bargain bid bill
bitcoin bond bonus borrow brand browse budget bulk bundle buy buyer cancel card
cargo cart cash cashback cashier catalog cent change charge cheap check
checkout clearance clerk coin commission compare consumer contract cost coupon
credit currency customer deal debit debt delivery deposit digital dime
discount display dollar donate donation dozen due earn economic economy
estimate exchange expense export fee finance financial fortune franchise free
fund gift guarantee import income insurance interest invest investment invoice
jackpot lease lend listing loan lose loss lottery luxury margin market
merchandise merchant million mortgage negotiate offer order outlet owe
ownership package payment payroll penny percent percentage pickup portfolio
poverty premium price prime profit property purchase quarter quotation rate
rebate receipt refund register rent rental request retail retailer return
revenue reward rich sale sample save savings scan shelf shipment shop shopper
shopping sold spend sponsor stock store subscribe subscription supply surplus
swap tax tenant ticket tip token toll total trade trademark transaction
treasure trend trust value venture voucher wage wallet warehouse wealth
wholesale withdraw worth
`,

// ─── MUSIC & ENTERTAINMENT ──────────────────────────────────────────
entertainment: `
act actor actress album applause audience audition award backstage ballet band
bass beat blockbuster blues broadcast cable camera cartoon cast celebrity
channel character chart chord chorus cinema classic clip comedy composer
concert costume country curtain dance dancer director disco drama drum
drummer duet dvd episode fame fan fantasy festival fiction film flute folk
franchise gallery genre gospel graphic guitar harmony headliner headline hit
horror host idol indie instrument interview jazz jingle karaoke keyboard
laugh legend line lip lyric mainstream media melody memoir microphone
mix movie mural museum music musical musician mystery narrator nightclub
novel opera orchestra original painting parody passion perform performance
performer photograph piano piece pilot pitch play player playlist plot
podcast poem poet poetry pop popcorn portrait premiere producer production
profile program puppet puzzle radio rap rapper rating reality record recorder
recording reggae rehearsal release remix repeat replay review rhythm riff rock
role romance romantic saga scene score screen script season serial series
session show singer single sitcom sketch solo song songwriter sound
soundtrack spin stage standup star storyline stream studio style subtitle
symphony talent theme ticket title tone tour trailer trilogy tune video
viewer villain vocal volume western writer
`,

// ─── ANIMALS ────────────────────────────────────────────────────────
animals: `
alligator ant ape baboon badger bat bear beaver bee beetle bird bison buffalo
bug bull bunny butterfly buzzard calf camel canary cardinal caribou cat
caterpillar cheetah chicken chick chipmunk clam cobra cockroach cod colt
coral cougar cow coyote crab crane cricket crocodile crow cub cuckoo deer
dinosaur dog dolphin donkey dove dragon dragonfly duck eagle eel elephant elk
falcon fawn ferret finch firefly fish flamingo flea fly foal fox frog gerbil
giraffe goat goldfish goose gorilla grasshopper grizzly groundhog gull
hamster hare hawk hedgehog hen heron hippo hog hornet horse hound hummingbird
hyena iguana insect jackal jaguar jay jellyfish kangaroo kitten koala ladybug
lamb lark leopard lion lizard llama lobster loon lynx macaw magpie mammal
manatee mare minnow mole monkey moose mosquito moth mouse mule mussel newt
nightingale octopus opossum orca oriole osprey ostrich otter owl ox oyster
panda panther parakeet parrot peacock pelican penguin perch pheasant pig
pigeon pike piranha platypus pony poodle porcupine porpoise possum prairie
prawn puma puppy quail rabbit raccoon ram raptor rat raven reindeer reptile
robin rooster salmon sardine scorpion seahorse seal shark sheep shrimp skunk
slug snail snake sparrow spider squid squirrel stag stallion starfish stingray
stork swan termite tiger toad tortoise toucan trout tuna turkey turtle vulture
walrus wasp weasel whale whippet wolf wolverine woodpecker worm wren yak
zebra
`,

// ─── TIME & CALENDAR ────────────────────────────────────────────────
time: `
about after afternoon age ago alarm always annual anniversary anytime april
august autumn before begin birthday brunch calendar century clock daily date
dawn day daylight deadline decade delay dinner dusk early eight eleven era
evening event ever everyday february final finally first five forever four
frequently friday future half holiday hour hurry immediately instant interval
january july june just lately later lifetime lunch march may meanwhile
midnight millennium minute moment monday month monthly morning never next
night nine noon november now occasionally october often once overtime past
period present prior prompt punctual quarter rarely recent recently routine
saturday season second semester september seven shift six someday sometime
sometimes soon spring start sudden summer sunday sunrise sunset ten
thanksgiving third thirty thursday time timeout timer today tomorrow tonight
total tuesday twelve twenty twice two upon urgent usual usually wait weekend
weekly wednesday while winter within year yearly yesterday yet young
`,

// ─── COLORS & DESCRIPTIONS ──────────────────────────────────────────
colors: `
amber aqua auburn beige black blonde blue blush bronze brown burgundy cedar
charcoal cherry chestnut coral cream crimson cyan dark ebony emerald faded
flamingo forest fuchsia ginger gold golden gray green hazel indigo ivory jade
jet khaki lavender lemon light lilac lime magenta mahogany maroon mint mocha
mustard navy neon nude olive onyx orange orchid pale pastel peach pearl periwinkle
pink platinum plum powder purple raspberry red rose royal ruby rust sage salmon
sand sapphire scarlet shadow silver sky slate smoke steel stone strawberry tan
tangerine taupe teal tomato topaz turquoise vanilla violet walnut wheat white
wine yellow
`,

// ─── NUMBERS & QUANTITY ─────────────────────────────────────────────
numbers: `
ample average billion both bunch couple decimal deficit double dozen each eight
eighteen eighty eleven enough equal every excess extra few fewer fifteen fifty
first five forty four fourteen fourth fraction gallon gram half handful hundred
inch kilo less little loads lots many massive mega might million minimal
minimum minus more most much multiple narrow nine nineteen ninety none numerous
odd once ounce over pair per percent percentage pint plenty plus portion pound
quarter ratio remainder rest score second seven seventeen seventy several single
six sixteen sixty slight slim some sum surplus ten third thirteen thirty
thousand three tiny ton total triple twelve twenty twice two volume whole wide
zero zilch
`,

// ─── ACTIONS & VERBS (everyday) ─────────────────────────────────────
actions: `
absorb accept achieve acknowledge adapt address adjust adopt advise afford agree
aim allow amaze amuse analyze annoy apologize appeal appear apply approach
approve argue arrange arrest arrive assemble assign assist assume attach
attempt attend attract avoid awake bake balance ban bang bargain bathe
belong bend blame bless block blow boil bore borrow bounce brake brand breathe
brew brighten broaden broadcast browse bubble budget bump bundle bury calculate
cancel capture carve celebrate challenge chant charge chase chatter cheat
cherish chew choke choose chuckle circle clap classify claw clean climb cling
clip close coach collapse collect combat combine comfort command comment
commit communicate compare compete complain complete compose concentrate
concern conclude conduct confess confide confirm confront confuse connect
conquer consider consist construct consult consume contact contain continue
contrast contribute control convince cook cooperate cope correspond cost
cough counsel count couple crack crash crawl create creep criticize crop
cross crouch crush curl customize damage dare deal debate decay decorate
decrease defeat define delay delegate delete delight deliver demand demonstrate
deny depart depend deposit deprive derive describe deserve design desire
destroy detect determine develop devote diagnose dictate disagree disappear
disappoint discipline disconnect discourage discover discuss disguise dismiss
display dissolve distinguish distribute disturb divide dodge dominate donate
double download draft drag drain drape drift drink drip drone drop drown dry
dump earn educate elect eliminate embarrass embrace emerge emphasize employ
enable encounter encourage endure enforce engage enhance enjoy enroll ensure
enter entertain equip erase escape establish evaluate evolve exaggerate examine
exceed exchange excite exclude excuse execute exercise exhaust exhibit exist
expand expect experience experiment explain explode exploit explore export
expose express extend extract face facilitate factor fade fail fancy fascinate
fasten favor feature feed file finance find fix flash flatten flee flick
fling flip float flood flourish flow fluctuate flutter fly focus fold follow
forbid force forecast forever forgive format found frame freeze frighten
frustrate fuel fulfill function gain gamble gather generate glance glow grab
grade graduate grant grasp greet grieve grind guarantee guard guess guide
handle happen harass harm harvest haul heal hesitate highlight hire honor host
hunger hurry identify ignore illustrate imagine implement imply import impose
impress improve include incorporate increase indicate influence inform inhabit
inherit initial injure innovate inquire insert inspect inspire install insure
integrate intend interact interfere interpret interrupt interview introduce
invade invent investigate invest invite involve isolate itch join joke judge
justify kick kiss knock label lack land last laugh launch lean lecture lend
lessen liberate license lift lighten likewise limit line list listen load
loan locate lodge lower maintain manage manufacture map march master match
matter maximize measure mediate memorize mention merge migrate mind minimize
mobilize moderate modify monitor motivate multiply murder name narrow navigate
negotiate neglect nominate normalize note notice notify nourish nurture object
oblige observe obtain occupy occur offend offer oil omit operate oppose
opt order organize orient originate outline output outsource oven overcome
overlook oversee overturn owe own pace pack pair panic parade parallel park
participate pass paste pat pause peer perceive perfect perform permit persist
persuade photograph pilot pinch pioneer pitch place plan plant pledge plunge
point polish pop portray pose position possess postpone pour praise pray
predict prefer prepare prescribe present preserve press presume prevent
pride print prioritize proceed process produce profit program progress prohibit
project promote prompt pronounce propose prosper protect protest prove
provide provoke publish pull pump punish purchase pursue push qualify question
quit quote race rain rally range rank rate reach react read realize reap
reason rebuild recall receive reckon recognize recommend reconcile record
recover recruit recycle reduce refer reflect reform refrigerate refuse
regard regulate reinforce reject relapse relate relax relay release relieve
rely remain remark remedy remember remind remodel remove renew rent repair
repeat replace report represent reproduce request require rescue research
resemble reserve reside resign resist resolve resource respond restore
restrict result resume retain retire retrieve return reveal reverse review
revise revolutionize reward rinse risk roast rotate ruin rush sacrifice
satisfy save scan schedule score scratch screen search secure seek select
send sense separate serve settle shape share sharpen shelter shift shine ship
shock shop shorten shout showcase shrink shut signal simplify simulate sink
situate skip slam slice slide slip slow smash smell snap sneak soak solve
sort spark specialize specify spell spend spin splash split sponsor spot
spread squeeze stabilize stack stage stall stamp standardize stare start
state steal steer step stick stimulate stir stock stop store straighten
strain strategize strengthen stress stretch strike strip strive structure
struggle study stuff submit subscribe succeed suffer suggest summarize
supervise supplement supply support suppose surface surprise surrender
surround survey survive suspect suspend sustain swap switch symbolize tackle
target taste teach tear tease tempt tend terminate terrify test thank thicken
thread threaten thrive tidy tighten tire tolerate top touch tour trace track
trade trail train transfer transform transition translate transport trap travel
treasure treat trend trigger trim triple triumph trouble troubleshoot trust
try tune twist type undergo underline understand undertake undo unfold
unify unite unlock unpack update upgrade upload urge use utilize vacation
validate value vary venture verify view violate visit visualize voice
volunteer vote wager wait wander warn wash waste watch water wave weaken
wear weather weigh welcome whisper widen win withdraw witness wonder
work worry worship wrap wreck wrestle write yell yield
`,

// ─── PLACES & GEOGRAPHY ────────────────────────────────────────────
places: `
airport alley apartment arcade arena auditorium bakery bank bar barn basement
bathroom bay beach bedroom boardwalk bookstore border boulevard bowling bridge
building cabin cafeteria camp campus capitol carnival casino castle cathedral
cave cemetery chapel church cinema city classroom clinic closet club coast
coast college community complex concert continent corner corridor cottage
counter country countryside county court courthouse courtyard crossroads
cubicle dam deli den desert destination diner district dock dome dorm
downtown drive driveway dwelling factory fairground farm farmhouse ferry field
firehouse floor forest fountain freeway front gallery garage garden gate
gazebo globe golf gorge greenhouse grill grocery gym gymnasium habitat
halfway hall hallway harbor headquarters highway hill home homeland hospital
hostel hotel house hub hut intersection island jail junction junkyard
kindergarten kitchen lab laboratory lagoon lake landmark lane lawn library
lighthouse lobby local lodge loft lounge mall manor mansion marina market
marketplace meadow memorial metro mill mine monument motel mountain museum
nation national neighborhood nursery oasis observatory ocean office opera
orchard outlet outside palace paradise park parking parlor pasture pathway
patio pavilion peak peninsula penthouse pharmacy pier pizzeria plantation
platform playground plaza plot plaza pond pool porch port postal prairie
prison property pub quarter ranch range realm recreation reef region
republic reservoir resort restaurant ridge riverbank road rooftop room
route rural salon sanctuary schoolyard seashore shelter shop shore showroom
shrine sidewalk site skate skyline skyscraper slope snack stadium stage state
station store street strip studio suburb summit supermarket surface swamp
tavern temple terminal terrace territory theater throne tollway tower town
township trail treetop tunnel turnpike underground university uptown urban
valley vault venue village vineyard vista warehouse waterfall waterfront
wilderness workshop yard zone zoo
`,

// ─── GOVERNMENT & LAW ───────────────────────────────────────────────
government: `
abolish accuse acquit administration admit adopt advocate agenda alien
alliance ambassador amend amendment announce appeal appoint approve asylum
attorney authority authorize bail ballot ban bias bill bond border budget
bureau cabinet campaign candidate capital capitol census certificate chamber
charter chief citizen citizenship civil civilian claim coalition code
colony command commander commission commissioner committee community
compromise conduct confederate conference confiscate congress congressman
consent conservation conservative conspiracy constitution consumer contract
controversy convention convict cooperate corporation corrupt council counsel
counter county court crime criminal critic custom debate debt declare decree
defeat defendant defense deficit delegate democracy democrat department
deport deputy detective dictatorship diplomat director discharge discrimination
dispute dissolve district domestic donate draft due economy elect election
embassy emperor empire enforce equality estate evidence examine execute
executive exile export federal fine flag force foreign founder fraud freedom
fund govern government governor grant guilty headquarters homeland honor
illegal immigrant immigration impeach implement impose independence independent
indict inflation inspect institution integrity intelligence investigate
investigation jail judge judgment judicial jurisdiction jury justice justify
juvenile labor law lawsuit lawyer leader leadership legal legislation
legislator legislature legitimate liberal liberty license lobby local
majority mandate marshal mayor measure medal media mediate member memorial
military minister minority mission moderate monarchy monitor monopoly motion
municipal nation national negotiate neutral nominate oath objection obligation
observe offend offense official oppose opposition order ordinance outlaw
pardon parliament parole partisan party patrol peace penalty pension
permission permit petition platform pledge police policy political politician
politics poll popular population portrait poverty power preach precinct
president presidential primary prime principal principle priority prison
prisoner private procedure prohibit property proposal propose prosecution
prosecutor protest provision public punishment qualify quota radical rally
rank ratify realm rebel rebellion recruit referendum reform refugee regime
register regulate regulation reign reject release religion repeal represent
representative republic republican request resign resolution resolve respect
restrict retire revenue revolt revolution right role royal rule ruling rural
sanction scandal secretary security senate senator sentence serve session
settlement sheriff siege signature social socialist society soldier
sovereign speaker sponsor stability state statute strategy submit suburb
summit superior supreme surrender suspect tax territory terror terrorism
testimony threat throne title tolerance toll totalitarian trade tradition
treaty trial tribe tribunal troop truce trust union unite unity urban veteran
veto victim violation volunteer vote voter ward warrant welfare withdraw
witness
`,

// ─── RELATIONSHIPS & SOCIAL ─────────────────────────────────────────
social: `
acquaintance admirer affection ally argue argument associate attract
attraction bail bestow betray bias blind bond bother boundary breakup bride
buddy casual celebrate ceremony chat chemistry chum close commitment
communicate companion company compatible compliment compromise confide
conflict connect connection consent conversation cooperate couple cozy crush
cuddle custom date dating deceive dedication defend devotion disagree discord
distance divorce embrace empathy encounter endure engage engagement entertain
equal esteem eternal exchange exclusive expect faith familiar farewell fate
favor fetch fiance fight flatter flirt fond forever forgave forgive formal
foster friendship fuss gather generosity genuine gesture gifted gossip grace
grateful greet groom guardian guest harmony heartbreak heartfelt helpful
hitch honest honor hug humble humor intimate introduce isolate jerk join keep
kind kiss kneel lasting lead listen loner lonely longing lose lover loyal
loyalty maiden maintain manner marriage mate mingle miss modest namesake
neglect neutral nod nurture obey obligation offend open outgoing overcome pal
partner patience peer personal persuade piece pledge polite possess praise
precious pride privilege promise propose protect provide quarrel quest
rapport react reconcile reference reflect regard reject relate relationship
reliable reluctant remember repair repay replace rescue resent respect
respond reunion reveal rival romance roommate sacrifice selfish sensitive
separate settle share shelter shy sibling sincere smile social socialize soul
soulmate split sponsor spouse squabble stability stranger strengthen stubborn
submit support surrender suspicion sweet sympathize tender thoughtful thrive
toast tolerance toxic tradition treasure tribute trouble troublesome trust
truthful unconditional understand unfaithful unite unstable unwed vow warm
watchful wedding welcome wholesome willing withdraw witness worth yearn
`,

// ─── ADJECTIVES (common everyday) ───────────────────────────────────
adjectives: `
able absolute abstract abundant accurate actual adorable advanced affordable
aggressive agreeable alert alive all amazing ancient angry annual anxious
appropriate artistic attractive automatic available average aware awesome
awful awkward balanced basic beautiful beloved best better big blank blind
bloody bold boring bottom brave brief bright brilliant broad broken brutal
busy calm capable careful caring casual cautious certain challenging cheap
cheerful chief civilian classic clean clear clever close cold colorful
comfortable commercial common competitive complete complex comprehensive
confident confused conservative considerable consistent constant contemporary
content continuous convenient cool corporate correct costly countless country
covered cozy creative criminal critical cruel cultural curious current cute
daily damaged dangerous daring dark dead deaf dear decent deep defensive
deliberate delicate delightful dense dependent depressed desperate detailed
devastating digital dirty disabled disappointed distinct diverse divine
domestic dominant double downtown dramatic dress driven dry due dull dumb
dynamic eager early earned eastern easy economic educational effective
efficient elaborate elderly electric elegant elite elsewhere embarrassed
emotional empty endless engaged enormous entire environmental equal essential
established ethnic everyday evident evil exact excellent exceptional exciting
exclusive executive exhausted exotic expensive experienced experimental
explicit exposed extensive extra extraordinary extreme facial factual faded
faint fair faithful false familiar famous fancy fantastic far fascinating
fashionable fast fat fatal favorite federal feminine fictional fierce final
financial fine firm fiscal fit flat flexible fluffy fluid flying fond foolish
foreign formal former forward fragile fragrant frank free frequent fresh
friendly frightened frozen fulfilled full functional fundamental funny furious
future generous genetic gentle genuine gifted glad glamorous global golden
gorgeous graceful gradual grand graphic grateful gray greasy greatest
green grim gross growing guilty gummy hairy handsome handy happy
hardcore harmful harmless harsh hasty healthy hearty heavy helpful hidden
high historic hollow holy homeless honest hopeful hopeless horrible hostile
hot household huge human humble humid hungry identical ignorant ill illegal
imaginary immediate immense immune imperial imported impossible impressed
impressive inactive inadequate inappropriate incomplete incredible independent
indoor industrial inevitable informal informative initial innocent innovative
inside instant integral intellectual intense intentional interactive
interested interesting intermediate internal international intimate invasive
invisible involved irish isolated jealous joint jolly judicial junior keen
known laid landing large lasting late lateral latter lean least left legal
legitimate lengthy lesser level liberal light likely linear literal literary
little lively local logical lone lonely loose lost loud lovely low loyal
lucky magnetic magnificent main major male mandatory married masculine massive
matching mature meaningful mechanical medical medium memorable mental mere
mild military minimal minor minute missing mobile moderate modern modest moral
monthly more mortal multiple municipal musical mutual mysterious naked
narrow nasty national native natural naval nearby neat necessary negative
nervous neutral new nice noble noisy nominal normal notable notorious novel
nuclear numerous objective obvious occasional odd offensive official ongoing
online only open operational opposed opposite optional orange ordinary organic
original other outdoor outer outside outstanding overall overseas overwhelming
paid painful pale parallel parental partial particular passive past patient
peaceful pending perfect permanent permitted personal pet petty philosophical
physical pink plain plastic pleasant plenty plump poetic pointed polar polite
political poor popular portable positive possible potential powerful precious
predictable predominant pregnant premium prepared present presidential pretty
previous primary prime primitive principal prior private probable productive
professional profound progressive prominent promising proper prospective
protective proud psychological public pure purple qualified radical random
rapid rare raw ready realistic reasonable recent red regional regular
regulatory related relative relevant reliable reluctant remarkable remote
renewable repeated representative republican residential resistant respective
responsible responsive restricted resulting retail reverse revolutionary rich
rigid rival robust romantic rough round routine royal rude running rural
sacred sad safe satisfying scared scary scattered scientific secondary secure
selective self senior sensitive separate serial serious severe sexual shallow
sharp sheer short shy sick sideways significant silent silly similar simple
simultaneous sincere skilled slight slim slow small smart smooth sober social
soft solar sole solid sophisticated sorry southern spare spatial special
specific spiritual split spoken spontaneous stable standard static steady
steep stiff still straight strange strategic strict strong structural
stunning stupid subject substantial subtle suburban successful sudden
sufficient suitable sunny super superb superior supportive supreme sure
surgical surplus surprising suspicious sweet swift symbolic sympathetic
systematic tactical talented tall tan teenage temporary tender terminal
terrible thankful theatrical thick thin thorough thoughtful thrifty tidy
tight tiny tired tolerant top torn total tough toxic traditional tragic
tremendous tribal tropical troubled true trusted typical ugly ultimate
unable uncertain uncomfortable unconditional underground underlying unexpected
unfamiliar unfortunate unhappy uniform unique united universal unknown
unlikely unprecedented unusual upcoming upper upset upstairs urban urgent
useful usual valid valuable variable various vast verbal vertical veteran
viable vibrant vicious violent virtual visible visual vital vivid vocal
voluntary vulnerable wandering warm wasteful weak wealthy weary weird
welcome western wet wicked widespread wild willing windy wireless wise
wonderful wooden working worldwide worn worried worst worthwhile worthy
written wrong yellow youthful
`,

// ─── COMMON PHRASES / FUNCTIONAL WORDS ──────────────────────────────
functional: `
a about above across after again against ago ahead all almost along already
also always among an and another any anybody anymore anyone anything anyway
anywhere are around as at away back be because become been before began begin
behind being below beneath beside besides best better between beyond both
bottom bring but by came can come could did do does done down during each
either else enough even ever every everybody everyone everything everywhere
except far few find for from front further get give go going gone good got
had has have he her here hers herself high him himself his how however
i if in inside instead into is it its itself just keep last later least left
less let like little long look lose lot made make many may me might mine
more most much must my myself near need neither never new next no nobody none
nor not nothing now of off often oh on once one only onto or other others
otherwise our ours ourselves out outside over own part past per perhaps point
put quite rather really right round same say seem set several shall she
should since so some somebody someone something sometimes soon still such
sure take than that the their theirs them themselves then there therefore
these they thing this those though through throughout thus till to today
together tomorrow too top toward towards under underneath unless until up
upon us use used using usually very want was we well were what whatever when
whenever where wherever whether which while who whoever whole whom whose why
will with within without woke won wonder word work would wrong yeah yep yes
yet you your yours yourself yourselves
`,
};

// ═══════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

// Collect all unique words from all categories
const allChecked = new Set();
const missingByCategory = {};
let totalMissing = 0;

for (const [category, wordStr] of Object.entries(CATEGORIES)) {
    const words = wordStr.split(/\s+/).filter(w => w.length >= 2);
    const missing = [];
    for (const word of words) {
        const upper = word.toUpperCase();
        allChecked.add(upper);
        if (!currentWords.has(upper)) {
            missing.push(word);
        }
    }
    if (missing.length > 0) {
        missingByCategory[category] = missing;
        totalMissing += missing.length;
    }
}

console.log(`Checked ${allChecked.size} unique common words against your ${currentWords.size} dictionary entries.\n`);

if (totalMissing === 0) {
    console.log('No missing words found! Your dictionary covers all common American English.');
} else {
    console.log(`═══ MISSING WORDS: ${totalMissing} total ═══\n`);
    for (const [category, words] of Object.entries(missingByCategory)) {
        console.log(`── ${category.toUpperCase()} (${words.length} missing) ──`);
        // Print in rows of ~10 for readability
        for (let i = 0; i < words.length; i += 12) {
            console.log('  ' + words.slice(i, i + 12).join(', '));
        }
        console.log('');
    }
}

// Save for easy pasting
const allMissing = [];
for (const words of Object.values(missingByCategory)) allMissing.push(...words);
// Dedupe
const uniqueMissing = [...new Set(allMissing)];
uniqueMissing.sort();
fs.writeFileSync(path.join(__dirname, '_missing_words_v2.txt'), uniqueMissing.join('\n'));
console.log(`\nTotal unique missing: ${uniqueMissing.length}`);
console.log(`Saved to _missing_words_v2.txt`);

// Also categorize them for rebuild-words.js insertion
// Rough POS classification based on which categories they appeared in
const nounCats = new Set(['food','body','people','home','clothing','transport','work','school','places','animals','time','entertainment','money','nature','sports','tech','government','social']);
const verbCats = new Set(['actions','emotions']);
const adjCats = new Set(['adjectives','colors']);
const otherCats = new Set(['functional','numbers']);

const missingNouns = new Set();
const missingVerbs = new Set();
const missingAdjs = new Set();
const missingOther = new Set();

for (const [category, words] of Object.entries(missingByCategory)) {
    for (const w of words) {
        if (nounCats.has(category)) missingNouns.add(w);
        if (verbCats.has(category)) missingVerbs.add(w);
        if (adjCats.has(category)) missingAdjs.add(w);
        if (otherCats.has(category)) missingOther.add(w);
    }
}

console.log(`\n── Suggested POS breakdown ──`);
console.log(`  Nouns:      ${missingNouns.size}`);
console.log(`  Verbs:      ${missingVerbs.size}`);
console.log(`  Adjectives: ${missingAdjs.size}`);
console.log(`  Other:      ${missingOther.size}`);

// Write categorized file for easy insertion
let output = '';
output += '=== ADD TO NOUNS ===\n' + [...missingNouns].sort().join(' ') + '\n\n';
output += '=== ADD TO VERBS ===\n' + [...missingVerbs].sort().join(' ') + '\n\n';
output += '=== ADD TO ADJECTIVES ===\n' + [...missingAdjs].sort().join(' ') + '\n\n';
output += '=== ADD TO OTHER_WORDS ===\n' + [...missingOther].sort().join(' ') + '\n\n';
fs.writeFileSync(path.join(__dirname, '_missing_categorized.txt'), output);
console.log(`Saved categorized list to _missing_categorized.txt`);

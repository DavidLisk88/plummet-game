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
act age air aim ant ape arc arm art ash axe bag ban bar bat bay bed bet bid bin bit
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
head heal heap hear heat heel help herb herd here hero hide high hike hill hilt hint
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
navy near neat neck need nest news next nice nine node none noon norm nose note noun
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
worried worship wrapper writing younger acne cod doc cot rep rite`.split(/\s+/).filter(w => w.length >= 3);

const VERBS = `
ace act add age aid aim air ask ate ban bar bat bay bed bet bid bit boo bow bug bum
buy can cap car cob con cop cry cub cue cup cut dab dam dig dim din dip dog don dot
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
bate bath bear beat bell bend best bias bike bill bind bite blot blow blur boar boat
bolt bomb bond book boom boot bore boss bowl brag brew buck burn burp bury bust buzz
cage calm came camp care cart cave char chat chip chop cite clad clam clap claw clip
clog club clue coal coat coax cock code coil come cook cool cope copy cord core cost
coup cram crew crop crow cube curb cure curl dash date dawn deal deck deem deny dine
dock does dole dome done doom dose down doze drag draw drip drop drum duck duel dump
dunk dust earn ease echo edge edit emit envy even exit face fade fail fake fall farm
fast fawn fear feat feed feel file fill find fine fire fish fist flag flat flaw flee
flew flip flit flog flow foam fold foil fool foot ford forge fork form foul free fuel
fume fund fuse fuss gain gait gape gash gate gave gaze gift give glad glow glue grab
grade grin grip grit grow gush hack hail halt hand hang haul have hawk haze haul heal
heap hear heat heed heel help herd hide hike hint hire hiss hitch hold hole home hone
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
respect restore restore retain reverse`.split(/\s+/).filter(w => w.length >= 3);

const ADJECTIVES = `
bad big dry done dull due far fat few fit fun gay hot ill key mad new odd old raw red sad
shy wet fit
able aged airy arid avid bald bare best blue bold both busy calm cold cool damp dark
dead deaf dear deep dire drab drug dual dull dumb each easy edgy epic even evil faint
fair fake fast flat fond fond foul free full glad glib good gray grim half hard high
holy huge hurt idle just keen kind lame last late lazy left like live lone long lost
loud main male mass mean mere mild more much mute near neat next nice nude numb only
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
virgin visual wasted weekly wicked wooden worthy`.split(/\s+/).filter(w => w.length >= 3);

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
vile tub tube stud studs dog dogs`.split(/\s+/).filter(w => w.length >= 3);

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
const MANUAL_EXTRAS = `fever fevers bye
`.split(/\s+/).filter(w => w.length >= 2);

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
    console.log(`Base words: ${allWords.size} (including ${TWO_LETTER_WORDS.length} two-letter words, ${MANUAL_EXTRAS.length} manual extras)`);

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
    const outFile = path.join(__dirname, 'words.json');
    fs.writeFileSync(outFile, JSON.stringify(filtered));

    console.log(`\nDone! Wrote words.json: ${filtered.length} words (${fs.statSync(outFile).size} bytes)`);

    // Verify some common words
    const set = new Set(filtered);
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

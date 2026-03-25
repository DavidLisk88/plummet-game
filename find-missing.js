// find-missing.js
// Compares your current words.json against a curated list of ~5000 common
// everyday American English base words (no obscure / archaic / technical junk).
// Outputs missing words grouped by category for easy review.

const fs = require('fs');
const path = require('path');

// Load current dictionary
const wordsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
const currentWords = new Set(wordsJson.map(w => w.toUpperCase()));

// ─── Curated common American English words ──────────────────────────
// These are words any adult American uses or hears regularly.
// No archaic, technical, British-only, or obscure words.

const COMMON_WORDS = `
able about above accept accident according account across action activity actually
add address admit adult advice afford afraid after afternoon again against ago agree
ahead allow almost alone along already also always amount angry animal announce
another answer anybody anymore anything anyway apartment appear apple approach area
argue arm army around arrange arrive art article artist asleep assume attack attempt
attend attention aunt available average avoid awake aware awful

baby back background bad badly bag bake balance ball ban band bank bar barely barn
base baseball basic basically basket basketball bathroom battle beach bean bear beat
beautiful beauty because become bed bedroom beef been beer before began begin behind
believe bell belong below bend benefit beside best better between beyond bicycle bike
bill billion bird birth birthday bit bite black blade blame blanket bleed bless blind
block blog blood blow blue board boat body bomb bone book border born boss both
bother bottle bottom bowl box boy boyfriend brain brand brave bread break breakfast
breath breathe brick bridge brief bright bring broad broke brother brown brush buddy
budget bug build building bullet bunch burn bus business busy butter button buy buyer

cabin cake call calm came camera camp campaign campus cancel cancer candidate cap
capable capital capture car card care career careful carefully carry case cash cat
catch category cause celebrate cell center central century certain chain chair
chairman challenge champion chance change channel chapter character charge charity
chart chase cheap check cheese chest chicken chief child childhood chip chocolate
choice choose church cigarette circle citizen city civil claim class classroom clean
clear clearly climb clock close closely closer clothes clothing cloud club clue coach
coffee cold collect collection college color column combination combine come comfort
comfortable command comment commercial commission commit committee common communicate
community company compare competition complain complete completely complex computer
concern condition conference confirm conflict congress connect connection consider
construction consultant consumer contact contain content contest continue contract
contribute control conversation convince cook cookie cool cope copy corner corporate
correct cost couch could count counter country county couple courage course court
cousin cover cow crack craft crash crazy cream create crew crime criminal crisis
critical cross crowd cry cultural culture cup current currently customer cut cycle

dad daily damage dance danger dangerous dare dark darkness data database date daughter
day dead deal dear death debate debt decade decide decision deck deep deeply deer
defeat defend defense define definitely degree delay deliver delivery demand democracy
department depend depression describe description desert deserve design designer desire
desk despite destroy detail determine develop developer development device diet
difference different differently difficult difficulty digital dinner direction
directly director dirty disappear discipline discover discussion disease dish dismiss
display distance distinct distinction district diversity divide doctor document dog
dollar domestic door double doubt down downtown dozen draft drag drama dramatic draw
dream dress drink drive driver drop drug dry due during dust duty

each ear early earn earth ease easily east eastern easy eat economic economy edge
education educational effect effective effectively effort egg eight either election
electric element eliminate elsewhere email embrace emerge emergency emotion emotional
emphasis employ employee employer empty enable encounter encourage end enemy energy
engage engine engineer enjoy enormous enough ensure enter entire entirely entrance
entry environment episode equal equipment error escape especially essay essential
establish estate estimate evaluate even evening event eventually ever every everybody
everyday everyone everything everywhere evidence evil exact exactly exam examine
example excellent except exchange exciting executive exercise exhibit exist existence
existing expand expect expectation experience experiment expert explain explanation
explore explosion expose expression extend extra extreme extremely eye

face facility fact factor fail failure fair fairly faith fall familiar family famous
fan fancy fantastic far farm farmer fashion fast fat father fault favor favorite fear
feature federal fee feed feel feeling fellow female fence few fewer fiction field
fifteen fifth fifty fight fighter figure file fill film final finally finance
financial find finding fine finger finish fire firm first fish fit five fix flag flash
flat flight flip float floor flow flower fly focus folk follow following food foot
football force foreign forest forever forget form formal former forward found
foundation founder four fourth frame freedom french frequency frequently fresh friend
front fruit fuel full fully fun function fund fundamental funny furniture further
future

gain gallery game gang gap garage garden gas gate gather gave gender general
generally generate generation gentle gentleman german gesture get giant gift gifted
girl girlfriend give given glad glass global go goal god gold golden golf gone good
government governor grab grade gradually graduate grand grandfather grandmother grant
grass grave gray great green greet grew ground group grow growing growth guarantee
guard guess guest guide guilty guitar gun guy gym

habit hair half hall hand handle hang happen happy hard hardly hat hate have he head
headline health healthy hear hearing heart heat heavy height hell hello help helpful
her here hero herself hey hi hide high highlight highly hill him himself hint hip hire
his historical history hit hold hole holiday home hope horrible horse hospital host
hot hotel hour house household housing how however huge human humor hundred hungry
hunt hurt husband

ice idea identify identity ignore ill illegal illustrate image imagine imagination
immediate immediately impact implement implication important impose impossible impress
impression impressive improve improvement incident include including income increase
increasingly incredible incredibly independent indicate individual industrial industry
influence inform information initial initially injury inner innocent inside insist
install instance instead institution insurance intellectual intelligence intend
intention interest interesting internal international internet interview into
introduce introduction investigation investor invite involve involved irish island
issue item itself

jacket jail jam january jazz jean jersey job join joint joke journal journalist
journey joy judge judgment juice jump junior jury just justice justify

keen keep key kick kid kill killer kind king kiss kit kitchen knee knew knife knock
know knowledge

lack lady land landscape language large largely laser last late lately later laugh
launch law lawn lawyer lay layer lead leader leadership league lean learn learning
least leather leave left leg legal legend lesson let letter level liberal library lie
life lifestyle lift light like likely limit line link lip list listen literally
literary literature little live living load loan local locate location lock long look
lord lose loss lost lot loud love lovely lover low lower luck lunch

machine mad magazine mail main mainly maintain major majority make male mall man
manage management manager manner many map march mark market marriage married marry
mask mass massive master match mate material math matter may maybe mayor me meal mean
meaning meanwhile measure meat media medical medicine medium meet meeting member
membership memory mental mention menu mere merely message method middle might
military milk million mind mine minister minor minority minute miracle mirror miss
mission mistake mix model moderate modern mom moment money monitor month mood moon
moral more moreover morning most mostly mother motion mount mountain mouse mouth move
movement movie much multiple murder museum music musical muslim must mutual my myself
mystery

name narrative narrow nation national natural naturally nature near nearby nearly
necessarily necessary neck need negative negotiate neighbor neighborhood neither
nerve nervous network never nevertheless new newly news newspaper next nice night nine
nobody nod noise none nor normal normally north northern nose not note nothing notice
novel now nowhere number nurse nut

object objective obligation observation observe obstacle obtain obvious obviously
occasion occasionally occur ocean odd odds off offense offensive offer office officer
official often oil okay old olympic one online only onto open opening operate
operation operator opinion opponent opportunity oppose opposite opposition option
orange order ordinary organize orientation original other otherwise ought our out
outcome outside overcome overlook owe own owner

pace pack package page pain paint painting pair pale palm pan panel pants paper
parent park parking partner party pass passage passenger passion past path patient
pattern pause pay payment peace peak per percentage perception perfect perfectly
perform performance perhaps period permanent permission permit person personal
personality personally perspective phase philosophy phone photo photograph phrase
physical pick picture pie piece pile pilot pine pink pipe pitch place plan plane
planet planning plant plastic plate platform play player please pleasure plenty
pocket poem poet poetry point police policy political politician politics pollution
pool poor pop popular population porch portion portrait position positive possible
possibly post pot potato potential pound pour poverty power powerful practice pray
prayer precisely predict prefer preparation prepare prepared presence present
president presidential press pressure pretty prevent previous previously price pride
primary prince princess principal principle print prior priority prison prisoner
privacy private probably problem proceed process produce producer product production
profession professional professor profile profit program progress project promise
promote prompt proof proper properly property proportion proposal propose proposed
prospect protect protection protein protest prove provide provider province public
pull punch purchase pure purpose pursue push put

qualify quality quarter quarterback queen question quick quickly quiet quietly quit
quite quote

race racial racism racist rain raise range rank rapid rapidly rare rarely rate
rather raw reach react reaction read reader reading ready real realistic reality
realize really reason reasonable rebel receive recent recently recognize recommend
recommendation record recover red reduce reduction reflect reflection reform refrigerator
refuse regard regarding region regional regular regulation relate relation relationship
relative relatively release relevant relief religion religious rely remain remaining
remarkable remember remind remote remove repeat replace reply report reporter
represent representation representative request require requirement research
researcher resistance resolution resolve resort resource respond response
responsibility responsible rest restaurant restore result retain retire retirement
return reveal revenue review revolution rhythm rice rich rid ride rifle right ring
rise risk river road robot rock role roll romantic roof room root rope rough roughly
round route row rule run rush russian

sacred sad safe safety sail salad salary sale salt same sample sanction sand satellite
satisfy sauce save saving say scale scandal scene schedule scholar scholarship school
science scientific scientist scope score screen sea search season seat second secret
secretary section sector secure security seek seem self sell senate senator senior
sense sensitive sentence separate sequence series serious seriously serve service
session set setting settle setup seven several severe shadow shake shall shape share
sharp she sheet shelf shell shelter shift shine ship shirt shock shoe shoot shooting
shop shopping shore short shortly shot should shoulder shout show shower shut shut
sick side sight sign signal significance significant significantly silence silent
silver similar similarly simple simply since sing singer single sir sister sit site
situation six size ski skill skin sky slave slavery sleep slide slight slightly slim
slip slow slowly small smart smell smile smoke smooth snap snow so social society soft
software soil soldier solid solution solve some somebody someday somehow someone
something sometimes somewhat somewhere son song soon sophisticated sorry sort soul
sound soup source south southern space spanish speak speaker special specialist
specific specifically speech speed spend spirit split spokesman sport spot spread
spring squad stability stable staff stage stair stake stand standard standing star
stare start starting state statement station status stay steady steal steel step
stick still stock stomach stone stop store storm story straight strange stranger
strategic strategy stream street strength stress stretch strike string strip stroke
strong strongly structure struggle student studio study stuff stupid style subject
succeed success successful successfully such suddenly suffer sufficient sugar suggest
suggestion suit summer sun super supply support supporter suppose sure surely surface
surprise surprised surprising surprisingly surround survive survivor suspect
sweep sweet swim swing switch symbol symptom system

table tactic take tale talent talk tall tank tap tape target task tax tea teach
teacher teaching team tear technology television tell temperature temporary ten tend
tendency term terms terrible test testify testing text than thank that the theater
their them theme themselves then theory therapy there therefore these they thick thin
thing think thinking third thirty this those though thought thousand threat threaten
three throat through throughout throw thus ticket tie tight till time tiny tip tire
tired title to today toe together tomorrow tone tonight too tool top topic toss total
totally touch tough tour tourist toward towards tower town toy trace track trade
tradition traditional traffic trail train training transfer transform transition
translate transportation travel treat treatment treaty tree trend trial trick trip
troop trouble truck true truly trust truth try tube tuesday turn twice twin type
typical typically

ugly ultimately unable uncle under understand understanding unfortunately unhappy
uniform unique unit united university unknown unless unlike unlikely until unusual up
upon upper upset urban urge us use used useful user usual usually utility

vacation valley valuable value variety various vast vehicle venture version very
veteran via victim victory video view violence violent virtual virtually visible
vision visit visitor visual vital voice volume volunteer vote voter

wage wait wake walk wall wander want war warm warn warning wash watch water wave way
we weak weakness wealth weapon wear weather web website wedding week weekend weekly
weigh weight welcome welfare well western wet what whatever wheat wheel when whenever
where whereas wherever whether which while whisper white who whole whom whose why wide
widely wife wild will willing win wind window wine wing winner winter wire wisdom wise
wish with withdraw within without witness woman women wonder wonderful wood wooden
word work worker working world worried worry worse worst worth would wound wrap write
writer writing wrong

yard yeah year yell yellow yes yesterday yet yield you young youngster your yourself
youth
`.split(/\s+/).filter(w => w.length >= 2);

console.log(`Checking ${COMMON_WORDS.length} curated common words against your ${currentWords.size} dictionary entries...\n`);

const missing = [];
for (const word of COMMON_WORDS) {
    const upper = word.toUpperCase();
    if (!currentWords.has(upper)) {
        missing.push(word);
    }
}

console.log(`=== MISSING COMMON WORDS: ${missing.length} ===\n`);

// Group by first letter
const byLetter = {};
for (const w of missing) {
    const letter = w[0].toUpperCase();
    if (!byLetter[letter]) byLetter[letter] = [];
    byLetter[letter].push(w);
}

for (const letter of Object.keys(byLetter).sort()) {
    console.log(`${letter}: ${byLetter[letter].join(', ')}`);
}

console.log(`\nTotal missing: ${missing.length} common everyday words`);

// Also output as a format ready to paste into rebuild-words.js
fs.writeFileSync(path.join(__dirname, '_missing_words.txt'), missing.join('\n'));
console.log(`\nSaved to _missing_words.txt`);

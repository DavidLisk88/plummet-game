// find-missing-v3.js — Advanced 5+ letter word finder
// Finds longer, educated-but-not-obscure American English words.
// Think: SAT vocab, business speak, book/movie words, adult conversation.
// NOT: obscure animals, archaic terms, technical jargon nobody uses.
// ALL words must be 5+ letters to avoid easy grid matches.

const fs = require('fs');
const path = require('path');

const wordsJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
const currentWords = new Set(wordsJson.map(w => w.toUpperCase()));

// ═══════════════════════════════════════════════════════════════════════
// EDUCATED AMERICAN ENGLISH — 5+ LETTER WORDS
// Words you'd hear on the news, in a novel, at work, or in a smart
// conversation. Every word here passes: "Would a college-educated
// American recognize and potentially use this word?"
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = {

// ─── VOCABULARY / SAT-LEVEL WORDS ───────────────────────────────────
vocab: `
abrupt absurd acclaim adapt adequate advent adverse albeit allege allude
ambiguous ample analogy anomaly apathy arbitrary aspire assert astute audacity
authentic autonomy avid aversion

banter barren benign bewilder bizarre blatant blunder bolster breach brevity
brisk brute burden bypass

candid capable cascade catalyst caution chronic clarify cliche coherent
coincide commence compel competent compile comply component comprise concede
concise condemn condone confine conform confront conscience consensus
consequence conserve consist constrain contemplate contend contradict
controversy converse convey cope correspond credible crucial curtail

deceive decisive default defiant deficit delegate deliberate demolish denote
depict deplete derive designate detain deviate devote dilemma diminish
disclose discord discrepancy discrete dismal dismay dispatch disperse displace
dispose dispute disregard disrupt dissolve distinct distort diverse divert
doctrine dominate dormant drastic durable dynamic

elaborate elicit eligible elite eloquent elude embrace emerge emit emphasize
enable endorse endure enhance enigma entail entity envelop envision erode
essence eternal evade evident exaggerate exceed excerpt excessive exclusive
exempt exert exhaust exotic expedite explicit exploit extract exquisite

fable facet famine fathom feasible feeble ferocious fertile fiction fidelity
flair flourish fluctuate fluent foliage foolproof foremost format formidable
forthcoming foster fragile framework frantic friction frugal futile

generate genuine gesture gigantic glacier glimmer glimpse global gloomy
glossy grapple gratify gravity grieve grudge

habitat hamper haphazard hardy harmony harness hasten haven hazard heighten
hinder hoarse holistic homage horizon hostile humane humble hybrid

ideology ignite illuminate immense imminent immune impair impartial impede
implement implicit impose impoverish improvise impulse inadvertent incentive
incorporate increment indicate indifferent indulge inevitable infer infinite
inflict inhabit inherent inhibit initiate innate innovate inquire insight
instigate integrate integrity intent intercept interim intricate intrigue
invoke ironic isolate

jargon jeopardize jubilant justify

kindle knack

landmark languid lateral lavish legacy legitimate lenient liable liberal
linger literal lofty lucid luminous luster luxury

magnify maintain mandate manifest manipulate maximize meager mediate
mediocre melancholy menace mentor meticulous mingle minimal mitigate
momentum monotone morale mundane muster mutual

narrate navigate neglect negotiate nimble noble nominal nonchalant notable
notion novice nourish nurture

oblige obscure obsolete obstruct offset omit onset optimal orient ornate
oscillate outbreak outright outweigh overwhelm

pacify paradox parallel paramount partisan passion patent pathetic patron
peculiar pending penetrate perceive peril perpetual persist personnel
persuade pertinent petition phenomenon pioneer plight plunder plausible
potent precaution precede precise predecessor predominant preliminary
premise presume prevail prevalent primitive pristine proactive proclaim
procure profound prohibit prominent prompt prone propagate propel
prosecute prospect protocol provoke prudent

quaint quarantine quota

radical rampant rapport rationale ravage realm rebel reconcile redundant
refine refrain refuge refute reinforce reiterate relentless relevant
reluctant remedy remnant render repeal replenish repress reproach
reputable reside residue resilient resolve resonate restrain resume
retain retrieve revelation revenue revert revoke rhetoric rigorous
robust rupture

sanction saturate scarcity scenario scrutiny segment sentiment sequel
serene severe shrewd signify skeptical solemn solicit solitude somber
sovereign spatial speculate spontaneous stagger stagnant stance stature
steadfast sterile stimulate stipulate strive subordinate subscribe
subsequent subsidiary subtle succumb suffice superficial supplement
suppress surplus surplus sustain

tangible tariff tedious temperament tenant tentative tenure terminate
terrain testimony threshold thrive tolerate toxic trait tranquil
transcend transparent traverse trend trivial turbulent

unanimous undergo undermine undertake unprecedented unveil uphold
unravel upscale urban urgent utilize utter

vacant valid vanish variable venture venture verify versatile viable
vigilant vigor vindicate virtual vitality vivid volatile vulnerable

wary warrant wholesome wield withdraw withhold withstand wrath

yearn yield
`,

// ─── BUSINESS & PROFESSIONAL ────────────────────────────────────────
business: `
accelerate accomplish accountable accumulate acquisition adequate advertise
affiliate aggregate allocate amendment amortize analyst anticipate appraisal
arbitrate archive audit authorize automate

benchmark bilateral blueprint bottleneck brand breadth briefing broadcast
broker budget bureau bureaucracy buyout

calibrate campaign capital capitalize catalog centralize certify chancellor
charter chronicle circulate clientele collaborate collateral commerce
commodity communique compensate compliance compromise conglomerate consolidate
contingency conglomerate copyright credential criterion critique cumulative

deadline debrief decentralize default deficiency delegate demographics
depreciate designate deregulate deteriorate deviate differentiate
diligence directive disclaimer discretion diversify dividend documentation
downsize downturn

economize elaborate embargo embargo embezzle empower endorse enterprise
entrepreneur equity escalate evaluate evolve execute exempt expenditure
expertise exploit export facilitate feasibility fiduciary fiscal flagship
flexible forecast forfeit formulate franchise freelance frontline
fulfillment fundamental fundraise

garnish generate generic globalize governance gradual guarantee guideline

headquarter hierarchy holistic hospitality humanitarian hypothetical

idealize implement import incentive incorporate incremental incumbent
indispensable industrialize inflation infrastructure initiative innovate
inspect institute integrate integrity interface interim inventory
investigate invoice irrevocable iterate

jeopardize jurisdiction juxtapose

landmark leverage liability liaison liberate liquidate litigate lobby
logistics lucrative

magnate mainstream mandate marginalize marketplace maximize mediator
memorandum merchandise methodology milestone mislead mobilize modernize
monetary monopolize moratorium motivate multinational municipal

navigate negotiate niche nonprofit normalize notarize notification
nullify

objective obligation obsolete offshore optimize orchestrate outperform
outsource overhead overhaul oversight

paradigm paramount partnership patronize payout penetrate percentage
personnel petition phaseout pioneer pipeline placeholder plausible
portfolio potential predecessor premiere premium prevalent privatize
procurement productive proficiency prognosis prohibit projection
promotional proprietary prospectus prototype provision publicize 

qualify quantify quarterly questionnaire

rationale reallocate rebate recession recipient reconcile recruit
referendum regulate reimburse reinstate reinvest relocate remunerate
renegotiate renovate replenish repository repossess requisite
restructure retail retention revenue reverse revitalize

sabotage sanction scalable scrutinize segment seminar settlement shareholder
shortfall simulate solicit sovereign specialize specification stakeholder
standardize statistic statutory stimulus stipend stipulate strategic
streamline subordinate subcontract subscribe subsidize substantial successor
supplement supervise sustainability syndicate

tactful tangible tariff taxable telecommute tenacious tenure terminate
threshold timeline trademark transaction transcript transition transparency
tribunal troubleshoot turnaround turnover tutorial

unanimous undergird underperform underwrite unilateral unionize unprecedented
upgrade upscale usurp utilization

validate variable vendor venture verification versatile viability
volatile voucher

waiver warranty wholesale workforce

yield
`,

// ─── LITERARY & DESCRIPTIVE ─────────────────────────────────────────
literary: `
abandon abolish abode absorb abstain abundance abyss accomplish ache
acknowledge acrid adamant adept adhere adjacent admonish advent adverb
affiliate afflict aftermath aggravate agile agonize ailment aisle albeit
allegiance allure alteration ambitious amiable amidst ample amplify
ancestor ancient anecdote anguish animate anonymous anthem anticipate
antique appalling appetite applaud appraise apprehend aptitude arbitrary
ardent aroma arrogance articulate ascend assemble astonish astray atrocity
attain audible aurora austere avenge avert awhile

baffled banish barren beacon beckon befriend behold beneath benevolent
betray bewilder billow blaze bleach blemish blend blinding blissful bloat
blossom boisterous bolster bombard bonfire borderline bountiful brash
brazen breathtaking brilliance bristle brittle brood browse bruise bumble
burnish bustle

caliber calamity canopy captivate cardinal cascade cascade cascade casually
catastrophe cease celestial cherish chronicle circumstance clatter clemency
clutter coarse cobblestone coerce coincidence collide colossal commemorate
commence compassion compel compile comprehend compress comprise conceal
concoct confound congenial conjure conquer conquest conscience conscientious
consecutive conspicuous constellation contemplate contentment contradict
convulsion covet crackle cradle crescent crevice crimson crinkle crumble
culminate cunning curdle cushion customary

dagger dainty dangle dapper dazzle debris decadent deceive decipher
declare decree deem defiance defy delectable deliberate delicately
delirious deluge demolish denounce depart depict deplore depot derelict
desolate despair destined detest devastate devout diction dignify diligent
diminish diner disarray disbelief discern discipline discretion
disdain disenchant disgruntled disheveled disillusion disintegrate
dispatch dispel disposition dissolve distill distinct distort diverge
doctrine dodge domineering downfall drapery drench dreary drench drenched
drift drowsy dubious durable dwelling dwindle

earthy eccentric eclipse elope eloquent emanate embark embellish emblem
ember embrace emerge eminent emit endear endeavor endure engross enigma
enormous ensemble enthrall entreat enumerate envision epidemic epilogue
epitome equip eradicate errand essence estrange euphoria evacuate evaporate
everlasting evoke exasperate excavate exhilarate exonerate expanse
expedition explicit expressive exquisite extinct extravagant exuberant

facade facade fallacy falter fanatic fascinate feather feeble ferment
ferocity fervent fiasco fickle fidelity figment finale firecracker fixture
flamboyant flatter flaunt flawless fledgling flicker flinch flock flourish
fluster flutter folklore foolhardy foothold forbearance forecast foremost
forge forgo forklift forlorn formidable forsake fortify fortress fragile
fragment fragrance frail framework frenzy fresco friction frigid frolic
frontier frostbite frontier frown fruitful fruitless fumble fundamental
furnace furrow

gallant garland garnish garrulous gaze gesture ghastly giddy gingerly glare
gleaming glimmer glistening glitter gloat glorify glossary gnaw gourmand
graceful gradient grapple gratitude gravel gravitate. grenade grievance grim
groan grotesque grumble grudge guardian guise gullible gusto gutter

haggard hallmark hamper handiwork hapless harbor harken harmony harness
haste haven haywire heartfelt hectic heritage hesitant hibernate hideous
hilarious hoarse homage homestead horizon hostile hover howl huddle
humanitarian humid humiliate hustle

idyllic ignite illuminate immaculate immerse imminent impeccable impending
imperative impersonate implore imposing impractical improvise impulsive
inaccessible inadvertent incandescent incessant incline inconvenient
incredible indelible indignant indulge industrious infamous infatuate
infinite inflict ingenious inhabit inherent initial injustice innocence
innumerable insightful insolent instantaneous instinct insufficient
integral intellect intercept interlude intermittent intimate intimidate
intrepid intricate intrigue intuition invincible involuntary irony
irrelevant irresistible
`,

// ─── MODERN / POP CULTURE / SLANG (clean) ──────────────────────────
modern: `
activate admin algorithm analytics anime asteroid binge bitcoin
blockchain boutique branding breathtaking broadcast broadband browse
buffer burnout buzzer

caffeine carbon cargo charisma clickbait cluster comeback compile
copyright craving cringe customize

database debug deepfake default demographic diesel digital disrupt
download downtime drastically drone

ecosystem elaborate electric embed emission encrypt energize ensure
enzyme espresso ethernet evolve

fandom fashion filter fintech fitness flashback flexible footprint
forecast format fossil framework franchise freelance frequency fusion

gadget generate generic genome glamour global gorgeous graphic
greenhouse gridlock guarantee

hacker handicap hardware hashtag headline highlight holistic homepage
hormone horsepower hybrid hygiene

identity immersive impact implement import inclusive index indicate
inflate infrastructure innocent innovate insulin integrate intensive
interface invest irregular isotope

jumpstart justify

keynote kickstart

landmark laptop laser latitude launch layoff leverage lifestyle
limestone linear literacy livecast livestream locomotive logistics

magnitude mainstream makeup marathon massive matrix maximize memento
merchandise microwave milestone mindful minimize miracle mobility
molecule momentum monitor monopoly motivation multimedia multitask

navigate network neural nickname nitrogen nominate nostalgic notable
nuclear nutrient

offspring offline operate optimal organic original outshine output
override overthrow

pandemic panorama paradox parasite particle passport patience payload
penalty perceive perimeter persist persona petrol pharmacy phenomenon
pipeline platform plausible plywood pointless populate portable postcard
potential premiere prescribe prestige preview principle privacy profile
program progress propane prototype provision publicize pumpkin

quarantine questionnaire

radical rainfall random ransomware ratio realize rebrand recipe
recollect reconfigure recycle redirect reform regarding regulate
reimagine reinvent reliable relocate reluctant remnant renewable
replica research reservoir resilient retail retrofit revenue reverse
revitalize rewind ringtone rivalry roadblock robot rotate

sabotage safeguard satellite savvy scaffold scenario schedule scramble
seasonal secondary sequoia setback silicon simulate skeptical slogan
smartphone snapshot socialize sophisticated specimen spectacle spectacular
spectrum sponsor stability staggering standpoint stellar stereotype stimulate
stockpile storage strategy streamline structure stumble subscribe suburban
subtle sunscreen supplement supreme surface surplus surveillance sustain
symbolize syndrome systematic

template terminal terrain testament textile therapy threshold timeline
tolerate tourism traction trademark transform transit transmit transparent
trauma trend trigger trillion turmoil tutorial

ultimate umbrella uncover undercover undermine undergraduate underperform
underrate undertake unforgettable uniform unique universal unleash unlock
unprecedented uplift upscale uptight uranium

vaccination vanguard variable venture verdict versatile vibrant
viewpoint vintage virtual visceral visible vitamin vivid
volatility volume voluntary 

warehouse warranty wavelength whistle wholesale wildlife windfall
wireless withdraw wonderful workforce worldwide worthwhile

yearlong youthful
`,

// ─── EMOTIONS & PERSONALITY (5+ letters) ────────────────────────────
emotions5: `
abashed absorbed affable agitated aghast alarmed ambitious amiable amused
animated annoyed apologetic appreciative apprehensive assertive attentive

bashful belligerent bewildered blissful bored brazen brooding buoyant

callous captivated charitable charismatic charming clingy combative
compassionate complacent composed conceited concerned conflicted
considerate contemptuous contented cordial cowardly cunning

daring decisive defeated defensive defiant dejected delighted demanding
demure dependent despairing desperate detached determined devastated
devoted dignified diligent diplomatic disapproving discontented
discreet disgusted disheartened dismissive dispirited dissatisfied
distracted distraught distressed docile domineering doubtful downcast
driven dumbfounded dutiful

eager earnest easygoing ecstatic effervescent elated eloquent 
embarrassed empathetic empowered enchanted encouraging endearing energetic
engaged enlightened enraged enthusiastic envious euphoric exasperated
excited exhausted exhilarated expectant exuberant

faithful famished fanciful farsighted fastidious fearful fearless
feisty fervent festive fidgety fierce fiery flustered focused
foolhardy forceful forgiving forthright frantic frazzled freewheeling
frightened frisky frivolous frustrated fulfilled furious fussy

generous genial gentle giddy gleeful glorious gluttonous grateful
gracious greedy gregarious gritty grouchy grudging grumpy guarded
guilt gullible

haggard halfhearted hapless hardworking harmless harrowed harsh hasty
heartbroken heartless heavyhearted helpful helpless heroic hesitant
homesick hopeful hopeless horrified hospitable hostile humble humbled
humiliated hungry hyper hyperactive hysterical

idealistic ignorant imaginative imbalanced immaterial immature immodest
impartial impassioned impatient impetuous impish impressed impudent
impulsive inadequate inattentive incensed indecisive indifferent
indignant industrious infatuated inflexible informed ingenious inhibited
innocent innovative insatiable insightful insistent insolent inspired
insulted intense interested intolerant intrepid introvert intuitive
inventive irate irked irreverent irritable isolated

jaded jealous jolly jubilant judgmental jumpy justified

keenly kindhearted kindly

lackluster languid lazy levelheaded liberal lighthearted lively logical
lonesome loving loyal

magnanimous malicious materialistic mature meager mean measured
meditative melancholy melodramatic merciful meticulous miffed mindful
mirthful mischievous modest morose motivated mournful mystified

naive neglected negligent neighborly nervous neurotic nonchalant
nostalgic notorious numb nurturing

obedient objective obliging obnoxious observant obsessed obstinate
offended overbearing overjoyed overwhelmed

pampered panicked passionate passive passive patient patronizing
peaceful pensive perceptive perky permissive persistent persuasive
pessimistic petulant philosophical pitiful placid playful pleased
plucky poignant polished pompous possessive pragmatic prejudiced
preoccupied presumptuous pretentious productive profound protective
provoked prudent punctual puzzled

quarrelsome querulous quiet quizzical

rambunctious rational reassured receptive reckless reflective
refreshed regretful relieved relentless remorseful resentful reserved
resigned resilient resolute resourceful respectful responsive restless
restrained reverent righteous rigid romantic rotten rueful ruthless

sarcastic satisfied scholarly scornful secretive selfish sensitive
sentimental serene settled shameful sheepish sheltered shocked shrewd
sincere skeptical smothered solemn solitary somber sorrowful soulful
spellbound spirited spiteful squeamish standoffish steadfast stern
stoic strenuous stressed stubborn subdued submissive sulky sullen
superstitious supportive surprised suspicious sympathetic

tactful temperamental temperate tenacious tender terrified thankful
thorough thoughtful thoughtless thrifty timid tolerant tormented tough
tranquil triumphant troubled trusting trustworthy truthful turbulent

unaffected unappreciated unashamed uncertain uncommitted unconvinced
understanding undervalued undecided undeserving undeterred uneasy
unfazed unflappable ungrateful uninhibited uninspired unique unmoved
unnerved unperturbed unpredictable unreliable unrepentant unruffled
unselfish unsettled unyielding upbeat uptight

vague valiant validated vehement vengeful versatile vexed vibrant
vigilant vindictive virtuous vivacious volatile

warmhearted watchful weary wholehearted wistful withdrawn witty
worldly worried worthless wretched

yearning youthful zealous
`,

// ─── SCIENCE & KNOWLEDGE (accessible) ───────────────────────────────
science: `
absorb abstract accurate acoustic adapt altitude anatomy antenna
apparatus approximate aquatic astronaut atmosphere atomic bacteria
binocular biology blueprint calorie capacity carbon catalyst cellular
centimeter chemical chlorine chromosome circuit climate coexist
compound compress compute concentrate conductor congestion conscious
constellation contaminate continent coordinate crystal cultivate
cylinder debris decompose density detect device diagram diagnose
diameter digest digital dilute dinosaur dissolve distill domestic
dormant eclipse ecosystem electrode element elevation emission
encounter endanger energy enzyme epidemic equation erosion eruption
evaporate evidence evolution examine expand experiment explode
explore extract fertile fiber filter fission flexible flora forecast
formula fossil frequency friction fusion galaxy generate genetic
geology geometry glacier global glucose gopher gradient granite gravity
greenhouse habitat hemisphere heredity horizon hydrogen hypothesis
ignite illuminate immune incubate indicate infect inhabit inject
insulate interact investigate irrigate isolate isotope laboratory
latitude layer limestone longitude magnetic magnitude mammal marine
material membrane mercury metabolism microscope migrate mineral
molecule monitor mutation navigate neutron nitrogen nocturnal nuclear
nutrient observe obstacle offspring operate opponent optimal orbit
organic organism origin oxygen ozone parasite particle patent
peninsula percent perimeter pesticide petroleum phenomenon phosphorus
photon physics pigment plateau pollinate polymer populate predator
preserve pressure primate principle procedure protein proton
psychology pulse purify quantum radar radiation rectangle recycle
reflect refract regulate relative reproduce research residue
resource respiration revolve rotate rupture satellite saturate
sediment seismic sensor sequence silicon simulate skeleton solar
soluble solution specimen spectrum sphere stable stimulus substance
subtract sulfur summit superb surface survive telescope temperate
terrain territory texture theorem thermal tissue topography toxic
transform transmit transparent trillion tropical turbine ultraviolet
universe vaccine variable velocity venture vertical vibrate virus
visible voltage volume wavelength
`,

// ─── COOKING & KITCHEN (5+ letters) ─────────────────────────────────
cooking: `
absorb appetizer baste blanch blend blender braise caramelize casserole
chowder colander condiment crouton cuisine dehydrate delicacy devour
entree extract ferment fiesta filling flambeau flavor fondue
frosting garnish gourmet griddle grinder grocery immerse infuse
ingredient julienne knead ladle leftovers luscious marinate mixture
morsel nutrition organic overcooked panini parfait pastry platter
poached portion preserves protein puree ramekin ration recipe
reduction refrigerate remainder rinse risotto roasted rotisserie
saute savory scallop seasoning simmering skewer skillet smoothie
souffle spatula specialty spoonful steamed strudel succulent sundried
tablespoon teaspoon tenderloin teriyaki texture thicken topping
tortilla utensil whipped zesty
`,

// ─── TRAVEL & ADVENTURE ─────────────────────────────────────────────
travel: `
abroad accommodate adventure altitude ambassador archive backpacker
baggage balcony basin boulevard breathtaking brochure cabin campsite
canyon carriage cathedral charter climate cliffside coastal comfort
compass concierge continent corridor countryside cruise currency
customs daydream depart departure desert destination detour discover
district dolphin ecosystem embark embassy encounter equator escape
excursion exotic expedition explore festival foreign fountain frontier
glacier globetrotter gorilla guidebook halfway hammock harbor heritage
hiking hilltop horizon hostel humidity hurricane indigenous island
itinerary journey jungle kayaking knapsack lagoon landing landscape
latitude layover leisure lighthouse longitude luggage luxury mainland
marina meadow monument mountain navigate northeast northwest oasis
oceanfront outback outskirt overlook pacific paddle panorama paradise
parkway passport peninsula picturesque pilgrimage plaza porthole
postcard prairie rainfall rainforest ranger ravine recreation refuge
relaxation remotely renaissance rendezvous reservation retreat ridge
riverside roadside rooftop route runway safari scenery scenic seaport
seashore shelter shoreline shuttle sightsee snorkel snowfall souvenir
summit sunbathe sunset surfboard terrain territory thunderstorm topical
tourism trailhead trailside traverse treasure tropical turbulence
tycoon umbrella underwater vacation valley vantage venture viewpoint
vineyard volcano voyage wanderlust waterfall waterfront wayside
whitewater wildlife windmill winery woodland
`,

// ─── MUSIC & ARTS (5+ letter) ───────────────────────────────────────
arts: `
abstract acoustic album amplifier animate anthem applause architect
arrangement artisan artwork atelier audience audition backdrop ballet
baroque baroque baritone billboard biography blockbuster broadcast
brushstroke canvas caption caricature carving catalog ceramic chapter
choreography chronicle cinema classical collage collection comedian
comedy commentary composer composition concert conductor contemporary
copyright creative creativity crescendo cricket critique crossover
curator curtain dancer decorate depict design dialogue dimension
director documentary download dramatic easel edition editorial ensemble
episode etching exhibit exhibition expression fabric fantasy fiction
figurine filmmaker flashback folklore format framing gallery genre
graffiti graphic harmony headliner highlight illustration imagery
improvise indie inspiration instrument interlude intermission inventor
keyboard landscape laureate layout legend limelight lyricist maestro
manuscript masterpiece medley melody memoir memorabilia metronome
microphone miniature montage mosaic movement mural musician narrative
nocturne novelist observe opera orchestra originality overture palette
pastel patron percussion performer perspective philharmonic photographer
pigment playwright playlists podcast portrait pottery premiere profile
prodigy production projection prominence propaganda prose protagonist
publish quartet recital rehearsal renaissance rendition repertoire replica
review rhythm romance sculptor sculpture sensation sequel serenade silhouette
sketch soloist sonata soundtrack spectrum stage storyline storyboard
studio subtext summary sweep symphony tableau talent tapestry technique
tempo theater theatrical thriller timeline tradition trajectory tribute
trilogy troupe underscore vantage variation vaudeville vibrato viewing
villain vintage virtuoso visual vocation watercolor woodwind
`,

};

// ═══════════════════════════════════════════════════════════════════════
// ANALYSIS — only consider words 5+ letters
// ═══════════════════════════════════════════════════════════════════════

const allChecked = new Set();
const missingByCategory = {};
let totalMissing = 0;

for (const [category, wordStr] of Object.entries(CATEGORIES)) {
    const words = wordStr.split(/\s+/).filter(w => w.length >= 5 && /^[a-z]+$/i.test(w));
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

console.log(`Checked ${allChecked.size} unique 5+ letter words against your ${currentWords.size} dictionary entries.\n`);

if (totalMissing === 0) {
    console.log('No missing words found!');
} else {
    console.log(`═══ MISSING 5+ LETTER WORDS: ${totalMissing} total ═══\n`);
    for (const [category, words] of Object.entries(missingByCategory)) {
        console.log(`── ${category.toUpperCase()} (${words.length} missing) ──`);
        for (let i = 0; i < words.length; i += 12) {
            console.log('  ' + words.slice(i, i + 12).join(', '));
        }
        console.log('');
    }
}

// Dedupe and save
const allMissing = [];
for (const words of Object.values(missingByCategory)) allMissing.push(...words);
const uniqueMissing = [...new Set(allMissing)].sort();
fs.writeFileSync(path.join(__dirname, '_missing_words_v3.txt'), uniqueMissing.join('\n'));
console.log(`\nTotal unique missing (5+ letters): ${uniqueMissing.length}`);
console.log(`Saved to _missing_words_v3.txt`);

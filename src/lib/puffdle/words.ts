import { PUFFDLE_TARGET_WORDS as RAW_TARGET_WORDS } from "./words-data";

// Deduplicate and ensure clean lowercase 5-letter words
const TARGET_WORDS_SET = new Set<string>();
const UNIQUE_TARGET_WORDS: string[] = [];

for (const rawWord of RAW_TARGET_WORDS) {
  const word = rawWord.trim().toLowerCase();
  if (word.length === 5 && /^[a-z]{5}$/.test(word) && !TARGET_WORDS_SET.has(word)) {
    TARGET_WORDS_SET.add(word);
    UNIQUE_TARGET_WORDS.push(word);
  }
}

export const PUFFDLE_TARGET_WORDS: readonly string[] = Object.freeze(UNIQUE_TARGET_WORDS);

// Valid word lookup set for guesses
const VALID_GUESS_SET = new Set<string>(PUFFDLE_TARGET_WORDS);

// Supplemental valid 5-letter words that are acceptable as guesses
const SUPPLEMENTAL_VALID_WORDS = [
  "aahed", "aalii", "aargh", "abaca", "abaci", "aback", "abaft", "abaka", "abamp", "aband",
  "abash", "abask", "abaya", "abbas", "abbed", "abbes", "abbey", "abbot", "abcee", "abeam",
  "abear", "abele", "abers", "abets", "abhor", "abide", "abies", "abled", "abler", "ables",
  "ablet", "ablow", "abmho", "abode", "abohm", "aboil", "aboma", "aboon", "abord", "abore",
  "abort", "about", "above", "abram", "abray", "abrim", "abrin", "abris", "absey", "absit",
  "abuna", "abune", "abuse", "abuts", "abuzz", "abyes", "abysm", "abyss", "acais", "acari",
  "accas", "accoy", "acerb", "acers", "aceta", "achar", "ached", "aches", "achoo", "acids",
  "acidy", "acing", "acini", "ackee", "acker", "acmes", "acmic", "acned", "acnes", "acock",
  "acold", "acorn", "acred", "acres", "acrid", "acros", "acted", "actin", "acton", "actor",
  "acute", "acyls", "adage", "adapt", "adaws", "adays", "adbot", "addax", "added", "adder",
  "addio", "addle", "adeem", "adept", "adhan", "adieu", "adios", "adits", "adman", "admen",
  "admin", "admit", "admix", "adobe", "adobo", "adopt", "adore", "adorn", "adown", "adoze",
  "adrad", "adred", "adsum", "aduki", "adult", "adunc", "adust", "advew", "adyta", "adzed",
  "adzes", "aecia", "aedes", "aegis", "aeons", "aerie", "aeros", "aesir", "afald", "afara",
  "afars", "afear", "affix", "afire", "aflaj", "afoot", "afore", "afoul", "afrit", "afros",
  "after", "again", "agama", "agami", "agape", "agars", "agast", "agate", "agave", "agaze",
  "agene", "agent", "agers", "agila", "agile", "aging", "agios", "agism", "agist", "agita",
  "aglee", "aglet", "agley", "agloo", "aglow", "aglus", "agmas", "agone", "agons", "agony",
  "agora", "agree", "agria", "agrin", "agros", "agued", "agues", "aguna", "aguti", "ahead",
  "aheap", "ahent", "ahigh", "ahind", "ahing", "ahint", "ahold", "ahull", "ahuru", "aidas",
  "aided", "aider", "aides", "aidoi", "aidos", "aiery", "aigas", "aight", "ailed", "aimed",
  "aimer", "ainee", "ainga", "aioli", "aired", "airer", "airns", "airth", "airts", "aisle",
  "aitch", "aitus", "aiver", "aiyee", "aizle", "ajies", "ajiva", "ajuga", "ajwan", "akees",
  "akela", "akene", "aking", "akita", "akkas", "alaap", "alack", "alamo", "aland", "alane",
  "alang", "alans", "alant", "alapa", "alaps", "alarm", "alary", "alate", "alays", "albas",
  "albee", "album", "alcid", "alcos", "aldms", "alder", "aldol", "aleck", "alecs", "alefs",
  "aleft", "aleph", "alert", "alews", "aleye", "alfas", "algae", "algal", "algas", "algid",
  "algin", "algor", "algum", "alias", "alibi", "alien", "alifs", "align", "alike", "aline",
  "alist", "alive", "aliya", "alkie", "alkos", "alkyd", "alkyl", "allay", "allee", "allel",
  "alley", "allis", "allod", "allot", "allow", "alloy", "allyl", "almah", "almas", "almeh",
  "almes", "almud", "almug", "alods", "aloed", "aloes", "aloft", "aloha", "aloin", "alone",
  "along", "aloof", "aloos", "aloud", "alowe", "alpha", "altar", "alter", "altho", "altos",
  "alula", "alums", "alway", "amahs", "amain", "amass", "amate", "amaut", "amaze", "amban",
  "amber", "ambit", "amble", "ambos", "ambry", "ameba", "ameer", "amend", "amene", "amens",
  "ament", "amias", "amice", "amici", "amide", "amido", "amids", "amies", "amiga", "amigo",
  "amine", "amino", "amins", "amirs", "amiss", "amity", "amlas", "amman", "ammon", "ammos",
  "amnia", "amnic", "amnio", "amoks", "amole", "among", "amort", "amour", "amove", "amowt",
  "amped", "ample", "amply", "ampul", "amrit", "amuck", "amuse", "amyls", "anana", "anata",
  "ancho", "ancle", "ancon", "andro", "anear", "anele", "anent", "angas", "angel", "anger",
  "angle", "anglo", "angry", "angst", "anigh", "anile", "anils", "anima", "anime", "animi",
  "anion", "anise", "ankhs", "ankle", "ankus", "anlas", "annal", "annas", "annat", "annex",
  "annoy", "annul", "anoas", "anode", "anole", "anomy", "ansae", "antae", "antar", "antas",
  "anted", "antes", "antic", "antis", "antra", "antre", "antsy", "anura", "anvil", "anyon",
  "aorta", "apace", "apage", "apaid", "apart", "apayd", "apays", "apeak", "apeek", "apers",
  "apert", "apery", "apgar", "aphid", "aphis", "apian", "aping", "apiol", "apish", "apism",
  "apnea", "apode", "apods", "apoop", "aport", "appal", "appay", "appel", "apple", "apply",
  "appro", "appui", "appuy", "apres", "apron", "apses", "apsis", "apsos", "apted", "apter",
  "aptly", "aquae", "aquas", "araba", "araks", "arame", "arars", "arbas", "arbor", "arced",
  "archi", "arcos", "arcus", "ardeb", "ardor", "ardeb", "aread", "areae", "areal", "arear",
  "areas", "areca", "aredd", "arede", "arefy", "areic", "arena", "arene", "arepa", "arere",
  "arete", "arets", "arett", "argal", "argan", "argas", "argil", "argle", "argol", "argon",
  "argot", "argue", "argus", "arhat", "arias", "ariel", "ariki", "arils", "ariot", "arise",
  "arish", "arked", "arled", "arles", "armed", "armer", "armet", "armil", "armor", "arnas",
  "arnut", "aroba", "aroha", "aroid", "aroma", "arose", "arpas", "arpen", "arrah", "arras",
  "array", "arret", "arris", "arrow", "arroz", "arsed", "arses", "arsey", "arsis", "arson",
  "artal", "artel", "artic", "artis", "artsy", "aruhe", "arums", "arval", "arvee", "arvos",
  "aryls", "asana", "ascon", "ascot", "ascus", "asdic", "ashed", "ashen", "ashes", "ashet",
  "aside", "asist", "asked", "asker", "askew", "askoi", "askos", "aspen", "asper", "aspic",
  "aspie", "aspis", "aspro", "assai", "assam", "assay", "asses", "asset", "assez", "assot",
  "aster", "astir", "astun", "asura", "asway", "aswim", "asyla", "ataps", "ataxy", "atigi",
  "atilt", "atimy", "atlas", "atman", "atmas", "atmos", "atocs", "atoke", "atoks", "atoll",
  "atoms", "atomy", "atone", "atony", "atopy", "atria", "atrip", "attap", "attar", "attic",
  "audad", "audio", "audit", "auger", "aught", "augur", "aulas", "aulic", "auloi", "aulos",
  "aumil", "aunes", "aunts", "aunty", "aurae", "aural", "aurar", "auras", "aurei", "aures",
  "auric", "auris", "aurum", "autos", "auxin", "avail", "avale", "avant", "avast", "avels",
  "avens", "avers", "avert", "avgas", "avian", "avine", "avion", "avise", "aviso", "avize",
  "avoid", "avows", "avyze", "await", "awake", "award", "aware", "awarn", "awash", "awato",
  "awave", "aways", "awdls", "aweel", "aweto", "awful", "awing", "awmry", "awned", "awner",
  "awoke", "awols", "awork", "axels", "axial", "axile", "axils", "axing", "axiom", "axion",
  "axite", "axled", "axles", "axman", "axmen", "axoid", "axone", "axons", "ayahs", "ayaya",
  "ayelp", "aygre", "ayins", "ayont", "ayres", "ayrie", "azans", "azide", "azido", "azine",
  "azlon", "azoic", "azole", "azons", "azote", "azoth", "azuki", "azure", "azurn", "azury",
  "azygy", "azyme", "azyms", "baals", "babas", "babel", "babes", "babka", "baboo", "babul",
  "babus", "bacca", "bacco", "baccy", "bacha", "bachs", "backs", "bacon", "baddy", "badge",
  "badly", "baels", "baffs", "baffy", "bafts", "bagel", "baggy", "baghs", "bagie", "bahts",
  "bahus", "bahut", "bails", "bairn", "baisa", "baith", "baits", "baiza", "baize", "bajan",
  "bajra", "bajri", "bajus", "baked", "baken", "baker", "bakes", "bakra", "balas", "balds",
  "baldy", "baled", "baler", "bales", "balks", "balky", "balls", "bally", "balms", "balmy",
  "baloo", "balsa", "balti", "balun", "balus", "bambi", "banak", "banal", "banco", "bancs",
  "banda", "bandh", "bands", "bandy", "baned", "banes", "bangs", "bania", "banjo", "banks",
  "banns", "bants", "bantu", "banty", "banya", "bapus", "barbe", "barbs", "barby", "barca",
  "barde", "bardo", "bards", "bardy", "bared", "barer", "bares", "barfi", "barfs", "barge",
  "baric", "barks", "barky", "barms", "barmy", "barns", "barny", "baron", "barps", "barra",
  "barre", "barro", "barry", "barye", "basal", "basan", "based", "basen", "baser", "bases",
  "basho", "basic", "basij", "basil", "basin", "basis", "basks", "bason", "basse", "bassi",
  "basso", "bassy", "basta", "baste", "basti", "basto", "basts", "batch", "bated", "bates",
  "bathe", "baths", "batik", "baton", "batta", "batts", "battu", "batty", "bauds", "bauks",
  "baulk", "baurs", "bavin", "bawds", "bawdy", "bawks", "bawls", "bawns", "bawrs", "bawty",
  "bayed", "bayer", "bayes", "bayle", "bayou", "bayts", "bazar", "bazoo", "beach", "beads",
  "beady", "beaks", "beaky", "beals", "beams", "beamy", "beano", "beans", "beany", "beard",
  "beare", "bears", "beast", "beath", "beats", "beaty", "beaus", "beaut", "beaux", "bebop",
  "becap", "becke", "becks", "bedad", "bedel", "bedes", "bedew", "bedim", "bedye", "beech",
  "beedi", "beefs", "beefy", "beeps", "beers", "beery", "beets", "befit", "befog", "begad",
  "began", "begar", "begat", "begem", "beget", "begin", "begot", "begum", "begun", "beige",
  "beigy", "being", "beins", "bekah", "belah", "belar", "belay", "belch", "belee", "belga",
  "belie", "belle", "bells", "belly", "belon", "below", "belts", "bemad", "bemas", "bemix",
  "bemud", "bench", "bends", "bendy", "benes", "benet", "benga", "benis", "benne", "benni",
  "benny", "bento", "bents", "benty", "bepat", "beray", "beres", "beret", "bergs", "berko",
  "berks", "berme", "berms", "berob", "berry", "berth", "beryl", "besat", "besaw", "besee",
  "beses", "beset", "besit", "besom", "besot", "besti", "bests", "betas", "beted", "betel",
  "betes", "beths", "betid", "beton", "betta", "betty", "bevel", "bever", "bevor", "bevue",
  "bevvy", "bewet", "bewig", "bezel", "bezes", "bezil", "bezzy", "bhais", "bhaji", "bhang",
  "bhats", "bhels", "bhoot", "bhuna", "bhuts", "biach", "biali", "bialy", "bibbs", "bibes",
  "bible", "biccy", "bicep", "bices", "biddy", "bided", "bider", "bides", "bidet", "bidis",
  "bidon", "bield", "biers", "biffo", "biffs", "biffy", "bifid", "bigae", "biggs", "biggy",
  "bigha", "bight", "bigly", "bigos", "bigot", "bijou", "biked", "biker", "bikes", "bikie",
  "bilbo", "bilby", "biled", "biles", "bilge", "bilgy", "bilks", "bills", "billy", "bimah",
  "bimas", "bimbo", "binal", "bindi", "binds", "biner", "bines", "binge", "bingo", "bings",
  "bingy", "binit", "binks", "bints", "biogs", "biome", "biont", "biota", "biped", "bipod",
  "birch", "birds", "birks", "birle", "birls", "biros", "birrs", "birse", "birsy", "birth",
  "bises", "bisks", "bisom", "bison", "bitch", "biter", "bites", "bitos", "bitou", "bitsy",
  "bitte", "bitts", "bitty", "bivia", "bivvy", "bizes", "bizzo", "bizzy", "blabs", "black",
  "blade", "blads", "blady", "blaer", "blaes", "blaff", "blags", "blahs", "blain", "blame",
  "blams", "bland", "blank", "blare", "blart", "blase", "blash", "blast", "blate", "blats",
  "blatt", "blaud", "blawn", "blaws", "blays", "blaze", "bleak", "blear", "bleat", "blebs",
  "blech", "bleed", "bleep", "blees", "blend", "blent", "blert", "bless", "blest", "blets",
  "bleys", "blimp", "blimy", "blind", "bling", "blini", "blink", "blins", "bliny", "blips",
  "bliss", "blist", "blite", "blits", "blitz", "blive", "bloat", "blobs", "block", "blocs",
  "blogs", "bloke", "blond", "blood", "blook", "bloom", "bloop", "blore", "blots", "blown",
  "blows", "blowy", "blubs", "blude", "bluds", "bludy", "blued", "bluer", "blues", "bluet",
  "bluey", "bluff", "bluid", "blume", "blunk", "blunt", "blurb", "blurs", "blurt", "blush",
  "blype", "boabs", "boaks", "board", "boars", "boart", "boast", "boats", "bobac", "bobak",
  "bobas", "bobby", "bobol", "bobos", "bocca", "bocce", "bocci", "boche", "bocks", "boded",
  "bodes", "bodge", "bodhi", "bodle", "boeps", "boets", "boeuf", "boffo", "boffs", "bogan",
  "bogey", "boggy", "bogie", "bogle", "bogue", "bogus", "bohea", "bohos", "boils", "boing",
  "boink", "boite", "boked", "bokes", "bokos", "bolar", "bolas", "bolds", "boles", "bolix",
  "bolls", "bolos", "bolts", "bolus", "bomas", "bombe", "bombo", "bombs", "bonce", "bonds",
  "boned", "boner", "bones", "boney", "bongo", "bongs", "bonie", "bonks", "bonne", "bonny",
  "bonus", "bonza", "bonze", "booai", "booay", "boobs", "booby", "boody", "booed", "boofy",
  "boogy", "boohs", "books", "booky", "bools", "booms", "boomy", "boong", "boons", "boord",
  "boors", "boose", "boost", "booth", "boots", "booty", "booze", "boozy", "boppy", "borak",
  "boral", "boras", "borax", "borde", "bords", "bored", "boree", "borel", "borer", "bores",
  "borgo", "boric", "borks", "borms", "borna", "borne", "boron", "borts", "borty", "bortz",
  "bosie", "bosks", "bosky", "bosom", "boson", "bossy", "bosun", "botas", "botch", "botel",
  "botes", "bothy", "botte", "botts", "botty", "bouge", "bough", "bouks", "boule", "boult",
  "bound", "bourd", "bourg", "bourn", "bouse", "bousy", "bouts", "bovid", "bowat", "bowed",
  "bowel", "bower", "bowes", "bowet", "bowie", "bowls", "bowne", "bowrs", "bowse", "boxed",
  "boxen", "boxer", "boxes", "boxla", "boxty", "boyar", "boyau", "boyed", "boyfs", "boygs",
  "boyla", "boyos", "boysy", "bozos", "braai", "brace", "brach", "brack", "bract", "brads",
  "braes", "brags", "braid", "brail", "brain", "brake", "braky", "brame", "brand", "brane",
  "brank", "brans", "brant", "brash", "brass", "brast", "brats", "brava", "brave", "bravi",
  "bravo", "brawl", "brawn", "braws", "braxy", "brays", "braza", "braze", "bread", "break",
  "bream", "brede", "breds", "breed", "breem", "breer", "brees", "breid", "breis", "breme",
  "brens", "brent", "brere", "brers", "breve", "brews", "breys", "brier", "bries", "brigs",
  "briki", "briks", "brill", "brims", "brine", "bring", "brink", "brins", "briny", "brios",
  "brise", "brisk", "briss", "brith", "brits", "britt", "brize", "broad", "broch", "brock",
  "brods", "brogh", "brogs", "broil", "broke", "brome", "bromo", "bronc", "brond", "brood",
  "brook", "brool", "broom", "broos", "brose", "brosy", "broth", "brown", "brows", "brugh",
  "bruin", "bruit", "brule", "brume", "brung", "brunt", "brush", "brusk", "brust", "brute",
  "bruts", "buats", "buaze", "bubal", "bubas", "bubba", "bubbe", "bubby", "bubus", "buchu",
  "bucko", "bucks", "bucku", "budas", "buddy", "budge", "budis", "budos", "buffa", "buffe",
  "buffi", "buffo", "buffs", "buffy", "bufos", "bufty", "buggy", "bugle", "buhls", "buhrs",
  "buiks", "build", "built", "buist", "bukes", "bulbs", "bulge", "bulgy", "bulks", "bulky",
  "bulla", "bulls", "bully", "bulse", "bumbo", "bumfs", "bumph", "bumps", "bumpy", "bunas",
  "bunce", "bunch", "bunco", "bunde", "bundh", "bunds", "bundt", "bundu", "bundy", "bungs",
  "bungy", "bunia", "bunje", "bunjy", "bunko", "bunks", "bunns", "bunny", "bunts", "bunty",
  "bunya", "buoys", "buppy", "buran", "buras", "burbs", "burds", "buret", "burfi", "burgh",
  "burgs", "burin", "burka", "burke", "burks", "burls", "burly", "burns", "burnt", "buroo",
  "burps", "burry", "bursa", "burse", "burst", "busby", "bused", "buses", "bushy", "busks",
  "busky", "bussu", "busti", "busts", "busty", "butch", "buteo", "butes", "butle", "butte",
  "butts", "butty", "butut", "butyl", "buxom", "buyer", "buzzy", "bwana", "bwazi", "byded",
  "bydes", "byked", "bykes", "bylaw", "byres", "byrls", "byssi", "bytes", "byway", "caaed"
];

for (const supplementalWord of SUPPLEMENTAL_VALID_WORDS) {
  VALID_GUESS_SET.add(supplementalWord.toLowerCase());
}

/**
 * Standard epoch: 2024-01-01T00:00:00.000Z.
 */
export const PUFFDLE_EPOCH_MS = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
const MS_PER_DAY = 86_400_000;

/**
 * Deterministic pseudo-random 32-bit generator (Mulberry32).
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a deterministic full permutation of 0..N-1 for a specific cycle index.
 * Every word in the target words list appears EXACTLY ONCE per cycle (no repetitions).
 */
export function getCyclePermutation(cycleIndex: number, poolSize: number): number[] {
  const perm = Array.from({ length: poolSize }, (_, i) => i);
  // Hash cycle index to form seed
  const seed = (Math.imul(cycleIndex ^ 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
  const rng = mulberry32(seed);

  // Fisher-Yates shuffle
  for (let i = poolSize - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const temp = perm[i];
    perm[i] = perm[j];
    perm[j] = temp;
  }
  return perm;
}

/**
 * Returns UTC day number relative to epoch.
 */
export function getUtcDayNumber(dateOrTimestamp?: Date | number | string): number {
  let time: number;
  if (dateOrTimestamp === undefined) {
    time = Date.now();
  } else if (dateOrTimestamp instanceof Date) {
    time = dateOrTimestamp.getTime();
  } else if (typeof dateOrTimestamp === "number") {
    time = dateOrTimestamp;
  } else {
    time = new Date(dateOrTimestamp).getTime();
  }

  return Math.floor((time - PUFFDLE_EPOCH_MS) / MS_PER_DAY);
}

/**
 * Generates the deterministic daily Puffdle target word for any UTC date.
 * Words NEVER repeat within a full permutation cycle of N days.
 */
export function getDailyWord(dateOrTimestamp?: Date | number | string): {
  word: string;
  dayNumber: number;
} {
  const dayNumber = getUtcDayNumber(dateOrTimestamp);
  const poolSize = PUFFDLE_TARGET_WORDS.length;
  if (poolSize === 0) {
    return { word: "puffe", dayNumber };
  }

  const cycleIndex = Math.floor(dayNumber / poolSize);
  const dayInCycle = ((dayNumber % poolSize) + poolSize) % poolSize;
  const permutation = getCyclePermutation(cycleIndex, poolSize);
  const wordIndex = permutation[dayInCycle];

  return {
    word: PUFFDLE_TARGET_WORDS[wordIndex],
    dayNumber,
  };
}

/**
 * Picks a random word from the target words pool for Puffdle Unlimited.
 */
export function getRandomUnlimitedWord(): string {
  const poolSize = PUFFDLE_TARGET_WORDS.length;
  const index = Math.floor(Math.random() * poolSize);
  return PUFFDLE_TARGET_WORDS[index] || "puffe";
}

/**
 * Checks whether a 5-letter word is a valid guess in English.
 */
export function isValidGuess(word: string): boolean {
  if (typeof word !== "string") return false;
  const normalized = word.trim().toLowerCase();
  if (normalized.length !== 5) return false;
  if (!/^[a-z]{5}$/.test(normalized)) return false;
  return VALID_GUESS_SET.has(normalized);
}

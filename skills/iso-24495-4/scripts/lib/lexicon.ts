// Word lists that let the engine tell one kind of capitalised text from
// another. Both are curated by hand for this project. They are NOT distilled
// from a corpus, and no frequency claim is made for them: each entry is here
// because it does a specific job described below.
//
// The lists are variety-neutral. Where spellings diverge, both appear.

/**
 * Ordinary English words that turn up in shouted text: "SAVE DATA FIRST",
 * "BACK UP NOW", "PLEASE READ THIS". A run of capitals made mostly of these
 * is a person raising their voice, not a string of initialisms.
 *
 * Deliberately absent: CAN, SET, MIX, RAM, PIN, AID, REST, ACT, ARM, BUS and
 * other everyday words that are also common acronyms. Including them would
 * teach the engine to read "CAN RAM SET" as shouting, which is exactly the
 * sequence a technical writer needs flagged.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "above", "accept", "across", "add", "after", "again", "against",
  "all", "allow", "almost", "along", "already", "also", "always", "and", "another",
  "answer", "any", "anyone", "anything", "apply", "are", "area", "around", "as",
  "ask", "at", "away", "back", "backup", "bad", "be", "because", "become", "been",
  "before", "begin", "behind", "being", "below", "best", "better", "between",
  "beyond", "big", "both", "bring", "build", "but", "buy", "by", "call", "cancel",
  "cannot", "care", "carry", "case", "cause", "change", "check", "child", "choose",
  "clean", "clear", "click", "close", "code", "cold", "come", "common", "complete",
  "confirm", "consider", "contact", "continue", "control", "copy", "correct",
  "cost", "could", "count", "cover", "create", "cut", "danger", "dangerous",
  "data", "date", "day", "delete", "detail", "did", "different", "difficult",
  "disable", "do", "does", "done", "down", "download", "draft", "drive", "drop",
  "during", "each", "early", "easy", "edit", "either", "else", "email", "empty",
  "enable", "end", "enough", "enter", "error", "even", "ever", "every", "everyone",
  "everything", "exit", "expect", "explain", "fail", "failure", "far", "fast",
  "few", "file", "fill", "final", "find", "finish", "first", "fix", "follow",
  "for", "force", "form", "found", "free", "from", "full", "further", "get",
  "give", "go", "good", "great", "group", "had", "half", "hand", "happen", "hard",
  "has", "have", "having", "help", "her", "here", "high", "him", "his", "hold",
  "home", "hope", "how", "however", "if", "immediately", "important", "in",
  "include", "info", "information", "input", "inside", "install", "instead",
  "into", "is", "issue", "it", "its", "join", "just", "keep", "key", "kind",
  "know", "large", "last", "late", "later", "learn", "least", "leave", "left",
  "less", "let", "level", "life", "light", "like", "limit", "line", "link",
  "list", "little", "live", "load", "local", "lock", "log", "login", "logout",
  "long", "look", "lose", "loss", "lost", "made", "main", "make", "manage",
  "many", "mark", "may", "maybe", "mean", "menu", "message", "might", "mind",
  "minute", "miss", "money", "month", "more", "most", "move", "much", "must",
  "my", "name", "near", "need", "never", "new", "next", "nice", "no", "none",
  "nor", "not", "note", "nothing", "notice", "now", "number", "of", "off",
  "offer", "often", "old", "on", "once", "one", "online", "only", "open",
  "option", "or", "order", "other", "our", "out", "output", "over", "own",
  "page", "part", "pass", "password", "past", "pause", "pay", "people", "person",
  "phone", "pick", "place", "plan", "play", "please", "point", "possible",
  "power", "press", "prevent", "print", "problem", "process", "product",
  "protect", "provide", "public", "pull", "push", "put", "quick", "quit",
  "read", "ready", "real", "reason", "record", "reduce", "refresh", "refuse",
  "release", "remain", "remember", "remove", "repeat", "replace", "report",
  "request", "require", "reset", "restart", "restore", "result", "retry",
  "return", "review", "right", "risk", "room", "run", "safe", "safety", "same",
  "save", "say", "search", "second", "section", "see", "select", "send",
  "server", "service", "set", "settings", "several", "share", "she", "short",
  "should", "show", "shut", "side", "sign", "since", "single", "site", "size",
  "skip", "slow", "small", "so", "some", "someone", "something", "soon",
  "sorry", "sound", "space", "speak", "special", "speed", "spend", "stand",
  "start", "state", "stay", "step", "still", "stop", "store", "story",
  "submit", "such", "sure", "system", "take", "talk", "task", "tell", "test",
  "than", "thank", "that", "the", "their", "them", "then", "there", "these",
  "they", "thing", "think", "this", "those", "though", "through", "time", "to",
  "today", "together", "too", "took", "top", "total", "try", "turn", "two",
  "under", "understand", "undo", "unless", "until", "up", "update", "upgrade",
  "upload", "upon", "us", "use", "used", "user", "using", "value", "verify",
  "very", "view", "wait", "want", "warn", "warning", "was", "watch", "way",
  "we", "week", "welcome", "well", "were", "what", "when", "where", "whether",
  "which", "while", "who", "whole", "why", "will", "wipe", "wish", "with",
  "within", "without", "work", "world", "would", "write", "wrong", "year",
  "yes", "yet", "you", "your",
]);

/**
 * Words that are almost never capitalised in the middle of a sentence, so a
 * capitalised one after a full stop is strong evidence that a new sentence has
 * started. Function words and connectives only: a capitalised "Department" or
 * "Smith" proves nothing, because proper nouns are capitalised anywhere.
 */
export const EXCLUSIVE_STARTERS: ReadonlySet<string> = new Set([
  "a", "after", "afterwards", "again", "all", "also", "although", "and", "another",
  "any", "as", "at", "because", "before", "besides", "between", "both", "but",
  "by", "consequently", "during", "each", "either", "even", "every", "finally",
  "first", "for", "from", "furthermore", "he", "hence", "her", "here", "his",
  "how", "however", "if", "in", "instead", "into", "it", "its", "later",
  "likewise", "meanwhile", "moreover", "most", "much", "neither", "nevertheless",
  "next", "no", "none", "nonetheless", "nor", "not", "now", "of", "on", "once",
  "only", "or", "otherwise", "our", "over", "she", "similarly", "since", "so",
  "some", "still", "such", "than", "that", "the", "their", "then", "there",
  "therefore", "these", "they", "this", "those", "though", "thus", "to",
  "under", "unless", "until", "up", "us", "we", "what", "when", "whenever",
  "where", "whereas", "wherever", "whether", "which", "while", "who", "whom",
  "whose", "why", "with", "within", "without", "yet", "you", "your",
]);

/**
 * Product names written in lower case. A lower-case word after a full stop
 * usually continues a sentence, and these are the everyday exceptions.
 */
export const LOWERCASE_NAMES: ReadonlySet<string> = new Set([
  "iOS", "iPhone", "iPad", "iPadOS", "macOS", "watchOS", "tvOS", "visionOS",
  "eBay", "iTunes", "iCloud", "eSIM", "npm", "pnpm", "nginx", "ffmpeg",
]);

// ============================================================
// ACHIEVEMENT ENGINE v1.0 — Gamified user retention system
// XP, levels, badges, streaks, challenges, leaderboard
// ============================================================

export type AchievementCategory =
  | "tensor" | "network" | "optimizer" | "registers"
  | "tree" | "fetch" | "math" | "utility" | "system"
  | "ca" | "mastery" | "streak" | "exploration";

export type AchievementTier = "bronze" | "silver" | "gold" | "platinum" | "legendary";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  xp: number;
  icon: string;
  unlockedAt?: number;    // timestamp
  progress?: number;      // 0–1
  requirement: number;    // threshold
  current: number;        // current count
  hidden?: boolean;       // surprise achievements
}

export interface UserProfile {
  totalXP: number;
  level: number;
  title: string;
  commandsRun: number;
  sessionsStarted: number;
  currentStreak: number;   // days
  longestStreak: number;
  lastSessionDate: string; // YYYY-MM-DD
  unlockedIds: Set<string>;
  // per-category counts
  tensorOps: number;
  networksBuilt: number;
  networksTrained: number;
  optimizerSteps: number;
  fetchRequests: number;
  mathOps: number;
  treeEvals: number;
  caEvolves: number;
  pipesUsed: number;
  aliasesCreated: number;
  scriptsRun: number;
  benchmarksRun: number;
  demoRun: number;
  uniqueCommandsUsed: Set<string>;
}

export interface ChallengeTask {
  id: string;
  name: string;
  description: string;
  reward: number;         // XP
  target: number;
  current: number;
  done: boolean;
  expiresIn?: number;     // ms, undefined = permanent
}

// XP thresholds per level
const LEVEL_THRESHOLDS = [
  0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7200,
  9700, 12800, 16600, 21200, 26800, 33500, 41500, 51000, 62200, 75000,
];

const LEVEL_TITLES = [
  "Novice",        // 0
  "Apprentice",    // 1
  "Coder",         // 2
  "Hacker",        // 3
  "Engineer",      // 4
  "Architect",     // 5
  "Specialist",    // 6
  "Expert",        // 7
  "Master",        // 8
  "Grandmaster",   // 9
  "Virtuoso",      // 10
  "Sage",          // 11
  "Oracle",        // 12
  "Wizard",        // 13
  "Sorcerer",      // 14
  "Demi-God",      // 15
  "Neural God",    // 16
  "Singularity",   // 17
  "x86 Legend",    // 18
  "TRANSCENDENT",  // 19+
];

export function computeLevel(xp: number): { level: number; title: string; progress: number; nextXP: number } {
  let level = 0;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i;
    else break;
  }
  const currentThresh = LEVEL_THRESHOLDS[level] ?? 0;
  const nextThresh    = LEVEL_THRESHOLDS[level + 1] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] * 2;
  const progress      = Math.min(1, (xp - currentThresh) / (nextThresh - currentThresh));
  return {
    level,
    title: LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)],
    progress,
    nextXP: nextThresh - xp,
  };
}

// ── Achievement Definitions ─────────────────────────────────
export function buildAchievementCatalog(): Achievement[] {
  return [
    // TENSOR
    { id: "tensor_first",     name: "First Contact",       description: "Create your first tensor",              category: "tensor",    tier: "bronze",   xp: 10,  icon: "T",  requirement: 1,    current: 0 },
    { id: "tensor_10",        name: "Tensor Novice",        description: "Create 10 tensors",                     category: "tensor",    tier: "bronze",   xp: 25,  icon: "T",  requirement: 10,   current: 0 },
    { id: "tensor_100",       name: "Tensor Adept",         description: "Create 100 tensors",                    category: "tensor",    tier: "silver",   xp: 75,  icon: "T",  requirement: 100,  current: 0 },
    { id: "tensor_backward",  name: "Grad Student",         description: "Run backward pass",                     category: "tensor",    tier: "bronze",   xp: 20,  icon: "∇",  requirement: 1,    current: 0 },
    { id: "tensor_grad_10",   name: "Backprop Veteran",     description: "Run 10 backward passes",                category: "tensor",    tier: "silver",   xp: 60,  icon: "∇",  requirement: 10,   current: 0 },
    { id: "tensor_matmul",    name: "Matrix Mover",         description: "Perform a matmul operation",            category: "tensor",    tier: "bronze",   xp: 15,  icon: "⊗",  requirement: 1,    current: 0 },

    // NETWORK
    { id: "net_first",        name: "Network Architect",   description: "Build your first neural network",       category: "network",   tier: "bronze",   xp: 30,  icon: "N",  requirement: 1,    current: 0 },
    { id: "net_trained",      name: "First Blood",          description: "Train your first network",              category: "network",   tier: "silver",   xp: 50,  icon: "⚡", requirement: 1,    current: 0 },
    { id: "net_train_10",     name: "Deep Learner",         description: "Complete 10 training runs",             category: "network",   tier: "silver",   xp: 150, icon: "⚡", requirement: 10,   current: 0 },
    { id: "net_train_50",     name: "Gradient Warrior",     description: "Complete 50 training runs",             category: "network",   tier: "gold",     xp: 400, icon: "⚡", requirement: 50,   current: 0 },
    { id: "net_predict",      name: "Oracle",               description: "Run your first prediction",             category: "network",   tier: "bronze",   xp: 20,  icon: "◈",  requirement: 1,    current: 0 },
    { id: "net_5",            name: "Network Zoo",          description: "Build 5 different networks",            category: "network",   tier: "silver",   xp: 80,  icon: "N",  requirement: 5,    current: 0 },

    // OPTIMIZER
    { id: "adam_first",       name: "Adam Awakens",         description: "Create your first Adam optimizer",      category: "optimizer", tier: "bronze",   xp: 20,  icon: "∇",  requirement: 1,    current: 0 },
    { id: "adam_100",         name: "Step Counter",         description: "Perform 100 Adam steps",                category: "optimizer", tier: "silver",   xp: 100, icon: "∇",  requirement: 100,  current: 0 },
    { id: "adam_1000",        name: "Optimizer King",       description: "Perform 1000 Adam steps",               category: "optimizer", tier: "gold",     xp: 300, icon: "∇",  requirement: 1000, current: 0 },

    // REGISTERS / x86
    { id: "reg_first",        name: "Register Pusher",      description: "Set your first x86 register",           category: "registers", tier: "bronze",   xp: 15,  icon: "▤",  requirement: 1,    current: 0 },
    { id: "simd_first",       name: "SIMD Initiate",        description: "Run your first SIMD operation",          category: "registers", tier: "silver",   xp: 40,  icon: "▤",  requirement: 1,    current: 0 },
    { id: "reg_dump",         name: "Inspector",            description: "Dump the register file",                category: "registers", tier: "bronze",   xp: 10,  icon: "▤",  requirement: 1,    current: 0 },

    // TREE LOGIC
    { id: "tree_eval",        name: "Logician",             description: "Evaluate your first logic tree",        category: "tree",      tier: "bronze",   xp: 20,  icon: "⬡",  requirement: 1,    current: 0 },
    { id: "tree_chain",       name: "Backward Chainer",     description: "Run backward chaining",                 category: "tree",      tier: "silver",   xp: 40,  icon: "⬡",  requirement: 1,    current: 0 },
    { id: "tree_10",          name: "Reasoning Machine",    description: "Evaluate 10 logic trees",               category: "tree",      tier: "silver",   xp: 80,  icon: "⬡",  requirement: 10,   current: 0 },

    // FETCH / HTTP
    { id: "fetch_first",      name: "First Download",       description: "Make your first HTTP request",          category: "fetch",     tier: "bronze",   xp: 25,  icon: "⇣",  requirement: 1,    current: 0 },
    { id: "fetch_10",         name: "Web Crawler",          description: "Make 10 HTTP requests",                 category: "fetch",     tier: "silver",   xp: 75,  icon: "⇣",  requirement: 10,   current: 0 },
    { id: "spider_first",     name: "Spider-Man",           description: "Spider a website",                      category: "fetch",     tier: "gold",     xp: 100, icon: "🕷",  requirement: 1,    current: 0 },

    // MATH
    { id: "calc_first",       name: "Calculating",          description: "Run your first calculation",            category: "math",      tier: "bronze",   xp: 10,  icon: "∑",  requirement: 1,    current: 0 },
    { id: "math_50",          name: "Mathematician",        description: "Run 50 math operations",                category: "math",      tier: "silver",   xp: 60,  icon: "∑",  requirement: 50,   current: 0 },
    { id: "primes",           name: "Prime Suspect",        description: "Generate prime numbers",                category: "math",      tier: "bronze",   xp: 15,  icon: "∑",  requirement: 1,    current: 0 },
    { id: "matrix_det",       name: "Deterministic",        description: "Compute a matrix determinant",          category: "math",      tier: "silver",   xp: 35,  icon: "∑",  requirement: 1,    current: 0 },

    // CA
    { id: "ca_first",         name: "Living Code",          description: "Run your first CA evolution",           category: "ca",        tier: "silver",   xp: 50,  icon: "⬡",  requirement: 1,    current: 0 },
    { id: "ca_10",            name: "Automaton",            description: "Run 10 CA evolutions",                  category: "ca",        tier: "gold",     xp: 150, icon: "⬡",  requirement: 10,   current: 0 },

    // UTILITY / EXPLORATION
    { id: "pipe_first",       name: "Pipe Dream",           description: "Use your first pipe chain",             category: "utility",   tier: "bronze",   xp: 20,  icon: "|",  requirement: 1,    current: 0 },
    { id: "pipe_10",          name: "Pipeline Operator",    description: "Use 10 pipe chains",                    category: "utility",   tier: "silver",   xp: 60,  icon: "|",  requirement: 10,   current: 0 },
    { id: "alias_first",      name: "Shortcut King",        description: "Create your first alias",               category: "utility",   tier: "bronze",   xp: 15,  icon: "≡",  requirement: 1,    current: 0 },
    { id: "cmd_50",           name: "Prolific",             description: "Run 50 commands",                       category: "exploration", tier: "bronze",  xp: 50,  icon: "▶",  requirement: 50,   current: 0 },
    { id: "cmd_500",          name: "Power User",           description: "Run 500 commands",                      category: "exploration", tier: "silver",  xp: 200, icon: "▶",  requirement: 500,  current: 0 },
    { id: "cmd_2000",         name: "Terminal Veteran",     description: "Run 2000 commands",                     category: "exploration", tier: "gold",    xp: 600, icon: "▶",  requirement: 2000, current: 0 },
    { id: "unique_20",        name: "Explorer",             description: "Use 20 unique commands",                category: "exploration", tier: "silver",  xp: 80,  icon: "◎",  requirement: 20,   current: 0 },
    { id: "unique_50",        name: "Command Completionist", description: "Use 50 unique commands",               category: "exploration", tier: "gold",    xp: 250, icon: "◎",  requirement: 50,   current: 0 },
    { id: "benchmark_run",    name: "Speed Demon",          description: "Run the benchmark suite",               category: "system",    tier: "bronze",   xp: 25,  icon: "⏱",  requirement: 1,    current: 0 },
    { id: "demo_all",         name: "Demo Speedrunner",     description: "Run all demo modes",                    category: "system",    tier: "silver",   xp: 80,  icon: "▶",  requirement: 8,    current: 0 },

    // MASTERY
    { id: "full_pipeline",    name: "Full Pipeline",        description: "Build net + optimizer + train in one session", category: "mastery", tier: "gold",  xp: 200, icon: "⚡", requirement: 1, current: 0, hidden: true },
    { id: "xp_1000",          name: "XP Hoarder",           description: "Earn 1000 XP",                          category: "mastery",   tier: "gold",     xp: 100, icon: "★",  requirement: 1000, current: 0 },
    { id: "xp_5000",          name: "XP Legend",            description: "Earn 5000 XP",                          category: "mastery",   tier: "platinum", xp: 500, icon: "★",  requirement: 5000, current: 0 },
    { id: "multi_system",     name: "Polyglot Engineer",    description: "Use 6 different subsystems",            category: "mastery",   tier: "platinum", xp: 300, icon: "∞",  requirement: 6,    current: 0, hidden: true },

    // STREAK
    { id: "streak_3",         name: "Habit Forming",        description: "Use the terminal 3 days in a row",      category: "streak",    tier: "silver",   xp: 75,  icon: "🔥", requirement: 3,    current: 0 },
    { id: "streak_7",         name: "Week Warrior",         description: "Use the terminal 7 days in a row",      category: "streak",    tier: "gold",     xp: 200, icon: "🔥", requirement: 7,    current: 0 },
    { id: "streak_30",        name: "Monthly Legend",       description: "Use the terminal 30 days in a row",     category: "streak",    tier: "legendary", xp: 1000, icon: "🔥", requirement: 30, current: 0 },
  ];
}

// ── Achievement Store ────────────────────────────────────────
export class AchievementEngine {
  private profile:  UserProfile;
  private catalog:  Achievement[];
  private pending:  Achievement[] = []; // just-unlocked queue
  private challenges: ChallengeTask[];

  constructor() {
    this.profile   = this._loadProfile();
    this.catalog   = this._loadCatalog();
    this.challenges = this._buildDailyChallenges();
    this._checkStreak();
  }

  // ── Profile access ─────────────────────────────────────────
  getProfile(): Readonly<UserProfile> { return this.profile; }
  getCatalog(): Readonly<Achievement>[] { return this.catalog; }
  getChallenges(): ChallengeTask[] { return this.challenges; }
  drainPending(): Achievement[] {
    const p = [...this.pending];
    this.pending = [];
    return p;
  }

  getLevelInfo() { return computeLevel(this.profile.totalXP); }

  // ── Event tracking ──────────────────────────────────────────
  track(event: string, state?: Record<string, unknown>): void {
    const p = this.profile;
    p.commandsRun++;
    p.uniqueCommandsUsed.add(event);

    // Count events
    if (event.startsWith("tensor"))    p.tensorOps++;
    if (event.startsWith("tensor.backward") || event === "tensor_backward") p.tensorOps++;
    if (event.startsWith("net.build")) p.networksBuilt++;
    if (event.startsWith("net.train")) p.networksTrained++;
    if (event.startsWith("adam"))      p.optimizerSteps++;
    if (event.startsWith("fetch") || event.startsWith("wget")) p.fetchRequests++;
    if (event.startsWith("math") || event === "calc") p.mathOps++;
    if (event.startsWith("tree"))      p.treeEvals++;
    if (event.startsWith("ca"))        p.caEvolves++;
    if (event.startsWith("demo"))      p.demoRun++;
    if (event === "benchmark")         p.benchmarksRun++;
    if (event === "alias")             p.aliasesCreated++;
    if (event.startsWith("script.run")) p.scriptsRun++;
    if (event.includes("|"))           p.pipesUsed++;

    // Full pipeline detection
    if (p.networksBuilt > 0 && p.networksTrained > 0 && p.optimizerSteps > 0) {
      this._tryUnlock("full_pipeline");
    }

    // Subsystem diversity
    const systems = new Set<string>();
    if (p.tensorOps > 0)      systems.add("tensor");
    if (p.networksBuilt > 0)  systems.add("network");
    if (p.optimizerSteps > 0) systems.add("optimizer");
    if (p.fetchRequests > 0)  systems.add("fetch");
    if (p.mathOps > 0)        systems.add("math");
    if (p.treeEvals > 0)      systems.add("tree");
    if (p.caEvolves > 0)      systems.add("ca");
    this._updateAch("multi_system", systems.size);

    // Update catalog counters
    this._updateAch("tensor_first",     p.tensorOps);
    this._updateAch("tensor_10",        p.tensorOps);
    this._updateAch("tensor_100",       p.tensorOps);
    this._updateAch("tensor_backward",  state?.backwardCount as number ?? 0);
    this._updateAch("tensor_grad_10",   state?.backwardCount as number ?? 0);
    if (event === "tensor.matmul") this._tryUnlock("tensor_matmul");
    this._updateAch("net_first",        p.networksBuilt);
    this._updateAch("net_5",            p.networksBuilt);
    this._updateAch("net_trained",      p.networksTrained);
    this._updateAch("net_train_10",     p.networksTrained);
    this._updateAch("net_train_50",     p.networksTrained);
    if (event === "net.predict") this._tryUnlock("net_predict");
    this._updateAch("adam_first",       p.optimizerSteps);
    this._updateAch("adam_100",         p.optimizerSteps);
    this._updateAch("adam_1000",        p.optimizerSteps);
    if (event.startsWith("reg.set"))    this._tryUnlock("reg_first");
    if (event.startsWith("reg.simd"))   this._tryUnlock("simd_first");
    if (event === "reg.dump")           this._tryUnlock("reg_dump");
    this._updateAch("tree_eval",        p.treeEvals);
    this._updateAch("tree_10",          p.treeEvals);
    if (event === "tree.chain")         this._tryUnlock("tree_chain");
    this._updateAch("fetch_first",      p.fetchRequests);
    this._updateAch("fetch_10",         p.fetchRequests);
    if (event === "fetch.spider" || event === "wget.spider") this._tryUnlock("spider_first");
    if (event === "calc" || event === "math.eval") this._tryUnlock("calc_first");
    this._updateAch("math_50",          p.mathOps);
    if (event === "math.primes")        this._tryUnlock("primes");
    if (event === "matrix.det")         this._tryUnlock("matrix_det");
    this._updateAch("ca_first",         p.caEvolves);
    this._updateAch("ca_10",            p.caEvolves);
    if (event.includes("|"))            this._tryUnlock("pipe_first");
    this._updateAch("pipe_10",          p.pipesUsed);
    if (event === "alias")              this._tryUnlock("alias_first");
    this._updateAch("cmd_50",           p.commandsRun);
    this._updateAch("cmd_500",          p.commandsRun);
    this._updateAch("cmd_2000",         p.commandsRun);
    this._updateAch("unique_20",        p.uniqueCommandsUsed.size);
    this._updateAch("unique_50",        p.uniqueCommandsUsed.size);
    if (event === "benchmark")          this._tryUnlock("benchmark_run");
    this._updateAch("demo_all",         p.demoRun);
    this._updateAch("xp_1000",          p.totalXP);
    this._updateAch("xp_5000",          p.totalXP);

    // Update challenge progress
    this._updateChallenges(event);

    this._save();
  }

  // ── Challenge system ────────────────────────────────────────
  private _buildDailyChallenges(): ChallengeTask[] {
    const seed = Math.floor(Date.now() / 86400000); // changes daily
    const pool: ChallengeTask[] = [
      { id: `ch_tensor_${seed}`,  name: "Tensor Day",         description: "Create 5 tensors",             reward: 50,  target: 5,  current: 0, done: false },
      { id: `ch_train_${seed}`,   name: "Training Session",   description: "Complete a training run",      reward: 75,  target: 1,  current: 0, done: false },
      { id: `ch_math_${seed}`,    name: "Math Workout",       description: "Run 10 math operations",       reward: 40,  target: 10, current: 0, done: false },
      { id: `ch_explore_${seed}`, name: "Exploration",        description: "Use 5 different commands",     reward: 60,  target: 5,  current: 0, done: false },
      { id: `ch_pipe_${seed}`,    name: "Pipe Master",        description: "Use 3 pipe chains",            reward: 80,  target: 3,  current: 0, done: false },
    ];
    // Pick 3 deterministically based on day seed
    return [pool[seed % 5], pool[(seed + 1) % 5], pool[(seed + 2) % 5]];
  }

  private _updateChallenges(event: string): void {
    for (const c of this.challenges) {
      if (c.done) continue;
      if (c.id.startsWith("ch_tensor") && event.startsWith("tensor"))  c.current++;
      if (c.id.startsWith("ch_train")  && event.startsWith("net.train")) c.current++;
      if (c.id.startsWith("ch_math")   && (event.startsWith("math") || event === "calc")) c.current++;
      if (c.id.startsWith("ch_explore")) c.current++;
      if (c.id.startsWith("ch_pipe")   && event.includes("|")) c.current++;
      if (c.current >= c.target && !c.done) {
        c.done = true;
        this._addXP(c.reward, `Challenge: ${c.name}`);
      }
    }
  }

  // ── Internal helpers ────────────────────────────────────────
  private _updateAch(id: string, count: number): void {
    const ach = this.catalog.find(a => a.id === id);
    if (!ach || this.profile.unlockedIds.has(id)) return;
    ach.current = Math.max(ach.current, count);
    ach.progress = Math.min(1, ach.current / ach.requirement);
    if (ach.current >= ach.requirement) this._unlock(ach);
  }

  private _tryUnlock(id: string): void {
    const ach = this.catalog.find(a => a.id === id);
    if (!ach || this.profile.unlockedIds.has(id)) return;
    ach.current = ach.requirement;
    ach.progress = 1;
    this._unlock(ach);
  }

  private _unlock(ach: Achievement): void {
    if (this.profile.unlockedIds.has(ach.id)) return;
    ach.unlockedAt = Date.now();
    this.profile.unlockedIds.add(ach.id);
    this._addXP(ach.xp, `Achievement: ${ach.name}`);
    this.pending.push({ ...ach });
  }

  private _addXP(amount: number, _source: string): void {
    this.profile.totalXP += amount;
    const levelInfo = computeLevel(this.profile.totalXP);
    this.profile.level = levelInfo.level;
    this.profile.title = levelInfo.title;
    // Check XP achievements after adding XP
    this._updateAch("xp_1000", this.profile.totalXP);
    this._updateAch("xp_5000", this.profile.totalXP);
  }

  private _checkStreak(): void {
    const today = new Date().toISOString().slice(0, 10);
    const last  = this.profile.lastSessionDate;
    if (!last) {
      this.profile.lastSessionDate = today;
      this.profile.currentStreak = 1;
    } else if (last === today) {
      // same day — no change
    } else {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if (last === yesterday) {
        this.profile.currentStreak++;
        this.profile.longestStreak = Math.max(this.profile.longestStreak, this.profile.currentStreak);
      } else {
        this.profile.currentStreak = 1;
      }
      this.profile.lastSessionDate = today;
    }
    this._updateAch("streak_3",  this.profile.currentStreak);
    this._updateAch("streak_7",  this.profile.currentStreak);
    this._updateAch("streak_30", this.profile.currentStreak);
    this.profile.sessionsStarted++;
  }

  // ── Persistence ─────────────────────────────────────────────
  private _loadProfile(): UserProfile {
    try {
      const raw = localStorage.getItem("x86_profile");
      if (!raw) return this._defaultProfile();
      const p = JSON.parse(raw);
      p.unlockedIds = new Set(p.unlockedIds ?? []);
      p.uniqueCommandsUsed = new Set(p.uniqueCommandsUsed ?? []);
      return p;
    } catch { return this._defaultProfile(); }
  }

  private _defaultProfile(): UserProfile {
    return {
      totalXP: 0, level: 0, title: "Novice",
      commandsRun: 0, sessionsStarted: 0,
      currentStreak: 0, longestStreak: 0,
      lastSessionDate: "",
      unlockedIds: new Set(),
      tensorOps: 0, networksBuilt: 0, networksTrained: 0,
      optimizerSteps: 0, fetchRequests: 0, mathOps: 0,
      treeEvals: 0, caEvolves: 0, pipesUsed: 0,
      aliasesCreated: 0, scriptsRun: 0, benchmarksRun: 0,
      demoRun: 0, uniqueCommandsUsed: new Set(),
    };
  }

  private _loadCatalog(): Achievement[] {
    const catalog = buildAchievementCatalog();
    try {
      const raw = localStorage.getItem("x86_achievements");
      if (!raw) return catalog;
      const saved: Record<string, { current: number }> = JSON.parse(raw);
      for (const ach of catalog) {
        if (saved[ach.id]) {
          ach.current = saved[ach.id].current;
          ach.progress = Math.min(1, ach.current / ach.requirement);
        }
        if (this._loadProfile().unlockedIds.has(ach.id)) {
          ach.progress = 1;
        }
      }
    } catch { /* use defaults */ }
    return catalog;
  }

  private _save(): void {
    try {
      const p = this.profile;
      localStorage.setItem("x86_profile", JSON.stringify({
        ...p,
        unlockedIds: [...p.unlockedIds],
        uniqueCommandsUsed: [...p.uniqueCommandsUsed],
      }));
      const achState: Record<string, { current: number }> = {};
      for (const a of this.catalog) achState[a.id] = { current: a.current };
      localStorage.setItem("x86_achievements", JSON.stringify(achState));
    } catch { /* localStorage unavailable */ }
  }

  // ── Rendering ───────────────────────────────────────────────
  renderProfile(): string[] {
    const p    = this.profile;
    const info = computeLevel(p.totalXP);
    const bar  = this._xpBar(info.progress, 20);
    const unlocked = p.unlockedIds.size;
    const total    = this.catalog.length;
    return [
      "╔══════════════════════════════════════════════╗",
      `║  PLAYER PROFILE                              ║`,
      "╠══════════════════════════════════════════════╣",
      `║  Level   : ${String(info.level).padEnd(5)}  ${info.title.padEnd(16)}     ║`,
      `║  XP      : ${String(p.totalXP).padEnd(8)}  Next: ${String(info.nextXP).padEnd(8)}     ║`,
      `║  Progress: [${bar}]           ║`,
      "╠══════════════════════════════════════════════╣",
      `║  Commands Run    : ${String(p.commandsRun).padEnd(10)}              ║`,
      `║  Unique Commands : ${String(p.uniqueCommandsUsed.size).padEnd(10)}              ║`,
      `║  Tensors Created : ${String(p.tensorOps).padEnd(10)}              ║`,
      `║  Networks Trained: ${String(p.networksTrained).padEnd(10)}              ║`,
      `║  Adam Steps      : ${String(p.optimizerSteps).padEnd(10)}              ║`,
      `║  Fetch Requests  : ${String(p.fetchRequests).padEnd(10)}              ║`,
      "╠══════════════════════════════════════════════╣",
      `║  Streak  : ${String(p.currentStreak).padEnd(4)} days (best: ${String(p.longestStreak).padEnd(4)})       ║`,
      `║  Badges  : ${String(unlocked).padEnd(4)} / ${String(total).padEnd(4)} unlocked            ║`,
      "╚══════════════════════════════════════════════╝",
    ];
  }

  renderAchievements(filter?: AchievementCategory): string[] {
    const list = filter
      ? this.catalog.filter(a => a.category === filter)
      : this.catalog;
    const lines: string[] = [
      `[ACH] Achievements${filter ? ` — ${filter}` : " — All"}`,
      `  Unlocked: ${this.profile.unlockedIds.size} / ${this.catalog.length}`,
      "",
    ];
    const tiers: AchievementTier[] = ["legendary", "platinum", "gold", "silver", "bronze"];
    for (const tier of tiers) {
      const group = list.filter(a => a.tier === tier);
      if (!group.length) continue;
      lines.push(`  ── ${tier.toUpperCase()} ──`);
      for (const a of group) {
        const done = this.profile.unlockedIds.has(a.id);
        const bar  = this._progressBar(a.progress ?? 0, 8);
        if (a.hidden && !done) {
          lines.push(`  [???] ??? — Hidden achievement`);
          continue;
        }
        lines.push(`  [${done ? "✓" : " "}] ${a.icon} ${a.name.padEnd(22)} ${bar} ${a.xp}XP`);
        if (!done && a.requirement > 1) {
          lines.push(`       ${a.description} (${a.current}/${a.requirement})`);
        }
      }
    }
    return lines;
  }

  renderChallenges(): string[] {
    const lines = ["[ACH] Daily Challenges", ""];
    for (const c of this.challenges) {
      const bar = this._progressBar(Math.min(1, c.current / c.target), 10);
      lines.push(`  [${c.done ? "✓" : " "}] ${c.name.padEnd(20)} ${bar} ${c.reward}XP`);
      lines.push(`       ${c.description} (${c.current}/${c.target})`);
    }
    return lines;
  }

  private _xpBar(progress: number, width: number): string {
    const filled = Math.round(progress * width);
    return "█".repeat(filled) + "░".repeat(width - filled);
  }

  private _progressBar(progress: number, width: number): string {
    const filled = Math.round(progress * width);
    return "[" + "▓".repeat(filled) + "·".repeat(width - filled) + "]";
  }

  private _newlyUnlocked: Achievement[] = [];

  /** Drain newly unlocked achievements since last call (for toast polling) */
  drainNewlyUnlocked(): Achievement[] {
    const drained = [...this._newlyUnlocked];
    this._newlyUnlocked = [];
    return drained;
  }

  /** Push to newly unlocked queue when an achievement is earned */
  _notifyUnlock(a: Achievement): void {
    this._newlyUnlocked.push(a);
  }
}

// ── Global singleton ─────────────────────────────────────────
export const achievementEngine = new AchievementEngine();

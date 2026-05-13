const TICK_MS = 50;
const WORLD_W = 4200;
const WORLD_H = 2500;
const MAX_PLAYERS = 4;
const ROOM_CODE_RE = /^[A-Z]{6}$/;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const ISLANDS = [
  { id: 0, name: "Ilha Aurora", theme: "verdejante", x: 560, y: 530, r: 330, enemyX: 820, enemyY: 690, npcX: 430, npcY: 450, enemyName: "Batedor Folha", level: 1, rewardXp: 95, rewardMoney: 80 },
  { id: 1, name: "Cogumelo Carmesim", theme: "fungica", x: 1460, y: 540, r: 350, enemyX: 1715, enemyY: 680, npcX: 1325, npcY: 435, enemyName: "Esporo Bandido", level: 4, rewardXp: 170, rewardMoney: 145 },
  { id: 2, name: "Porto Miragem", theme: "persa", x: 2430, y: 520, r: 380, enemyX: 2695, enemyY: 700, npcX: 2260, npcY: 430, enemyName: "Corsário de Areia", level: 8, rewardXp: 290, rewardMoney: 235 },
  { id: 3, name: "Forja Magmática", theme: "magmatica", x: 1050, y: 1680, r: 390, enemyX: 1325, enemyY: 1840, npcX: 850, npcY: 1550, enemyName: "Golem Brasa", level: 13, rewardXp: 470, rewardMoney: 350 },
  { id: 4, name: "Templo Celeste", theme: "celeste", x: 2840, y: 1690, r: 420, enemyX: 3150, enemyY: 1845, npcX: 2630, npcY: 1545, enemyName: "Sentinela Nimbus", level: 19, rewardXp: 720, rewardMoney: 520 }
];

const FRUITS = {
  gas: { name: "Gás", tint: "#ff5ac8", aura: "nuvens rosas", defense: 0.10 },
  dragon: { name: "Dragon", tint: "#40ff87", aura: "asas verdes", defense: 0.05 },
  control: { name: "Control", tint: "#64dcff", aura: "quadrados azuis", defense: 0 },
  venom: { name: "Venom", tint: "#a647ff", aura: "gotas viscosas", defense: 0.03 },
  kitsune: { name: "Kitsune", tint: "#7197ff", aura: "caudas misticas", defense: 0.04 },
  luz: { name: "Luz", tint: "#ffe56a", aura: "particulas douradas", defense: 0.02 },
  gelo: { name: "Gelo", tint: "#9ee8ff", aura: "cristais frios", defense: 0.06 },
  bomba: { name: "Bomba", tint: "#ff7b3a", aura: "faíscas instaveis", defense: 0.04 },
  sombra: { name: "Sombra", tint: "#6c5cff", aura: "rastro escuro", defense: 0.05 },
  fenix: { name: "Fênix", tint: "#ff9b46", aura: "penas flamejantes", defense: 0.03 }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function randomCode() {
  let out = "";
  for (let i = 0; i < 6; i++) out += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return out;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function nowMs() { return Date.now(); }
function rnd(min, max) { return min + Math.random() * (max - min); }
function norm(x, y) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}
function xpNeed(level) {
  return Math.floor(120 * Math.pow(level, 1.42));
}
function safeText(v, fallback = "Jogador") {
  const s = String(v ?? fallback).replace(/[<>]/g, "").trim().slice(0, 16);
  return s || fallback;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create" && request.method === "POST") {
      let code = randomCode();
      // Six letters already gives millions of combinations. Try a few times to avoid fresh collisions.
      for (let i = 0; i < 4; i++) {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch("https://room/check");
        const data = await res.json();
        if (!data.exists) break;
        code = randomCode();
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ code }) });
      return json({ ok: true, code });
    }

    if (url.pathname.startsWith("/ws/")) {
      const code = (url.pathname.split("/")[2] || "").toUpperCase();
      if (!ROOM_CODE_RE.test(code)) return json({ ok: false, error: "Código inválido." }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }

    if (url.pathname === "/api/health") return json({ ok: true, service: "fruit-seas-online" });

    return env.ASSETS.fetch(request);
  }
};

export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.code = "------";
    this.players = new Map();
    this.sessions = new Map();
    this.projectiles = [];
    this.zones = [];
    this.enemies = [];
    this.started = false;
    this.created = false;
    this.lastTick = nowMs();
    this.loop = null;
    this.nextId = 1;
    this.initGame();
  }

  initGame() {
    this.enemies = [];
    for (const island of ISLANDS) {
      for (let i = 0; i < 5; i++) {
        this.enemies.push(this.makeEnemy(island, i));
      }
    }
  }

  makeEnemy(island, slot) {
    const hp = 180 + island.level * 55;
    const angle = (Math.PI * 2 * slot) / 5;
    return {
      id: `e${island.id}-${slot}`,
      island: island.id,
      name: island.enemyName,
      level: island.level,
      x: island.enemyX + Math.cos(angle) * rnd(40, 120),
      y: island.enemyY + Math.sin(angle) * rnd(40, 120),
      spawnX: island.enemyX,
      spawnY: island.enemyY,
      hp,
      maxHp: hp,
      alive: true,
      respawnAt: 0,
      hitAt: 0,
      attackAt: 0,
      status: {}
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const wsCode = (url.pathname.split("/")[2] || "").toUpperCase();
    if (ROOM_CODE_RE.test(wsCode) && !this.created) {
      this.code = wsCode;
      this.created = true;
    }

    if (url.pathname.endsWith("/check")) return json({ exists: this.created || this.players.size > 0 });

    if (url.pathname.endsWith("/init") && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      this.code = safeText(body.code, "------").toUpperCase();
      this.created = true;
      return json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return json({ ok: true, room: this.code, players: this.players.size, started: this.started });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const sid = crypto.randomUUID();
    this.sessions.set(server, { id: sid, playerId: null, input: { x: 0, y: 0, aimX: 1, aimY: 0 } });
    server.addEventListener("message", (event) => this.onMessage(server, event.data));
    server.addEventListener("close", () => this.onClose(server));
    server.addEventListener("error", () => this.onClose(server));

    this.send(server, { type: "hello", code: this.code, fruits: publicFruits(), islands: ISLANDS });
    this.ensureLoop();
    return new Response(null, { status: 101, webSocket: client });
  }

  onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const session = this.sessions.get(ws);
    if (!session) return;

    if (msg.type === "join") {
      if (session.playerId) return;
      if (this.players.size >= MAX_PLAYERS) {
        this.send(ws, { type: "error", error: "Sala cheia. O limite é 4 jogadores." });
        ws.close(1000, "room full");
        return;
      }
      const playerId = session.id;
      const island = ISLANDS[0];
      const isOwner = this.players.size === 0;
      const player = {
        id: playerId,
        name: safeText(msg.name, `Player ${this.players.size + 1}`),
        owner: isOwner,
        x: island.x + rnd(-80, 80),
        y: island.y + rnd(-70, 70),
        vx: 0,
        vy: 0,
        island: 0,
        fruit: FRUITS[msg.fruit] ? msg.fruit : "gas",
        level: 1,
        xp: 0,
        money: 0,
        hp: 1000,
        maxHp: 1000,
        alive: true,
        respawnAt: 0,
        input: { x: 0, y: 0, aimX: 1, aimY: 0 },
        cooldowns: {},
        status: {},
        mission: null,
        transformed: false,
        form: "base",
        transformUntil: 0,
        fury: 0,
        controlRoom: null,
        lastAttackAt: 0,
        color: pickColor(this.players.size)
      };
      this.players.set(playerId, player);
      session.playerId = playerId;
      this.send(ws, { type: "joined", id: playerId, owner: isOwner, code: this.code });
      this.broadcastLobby();
      this.broadcastState(true);
      return;
    }

    const player = session.playerId ? this.players.get(session.playerId) : null;
    if (!player) return;

    if (msg.type === "start") {
      if (player.owner) {
        this.started = true;
        this.broadcast({ type: "notice", text: "A aventura começou!" });
        this.broadcastState(true);
      }
      return;
    }

    if (msg.type === "input") {
      const x = clamp(Number(msg.x) || 0, -1, 1);
      const y = clamp(Number(msg.y) || 0, -1, 1);
      let aimX = Number(msg.aimX);
      let aimY = Number(msg.aimY);
      if (!Number.isFinite(aimX) || !Number.isFinite(aimY) || Math.hypot(aimX, aimY) < 0.05) {
        aimX = player.input.aimX || 1;
        aimY = player.input.aimY || 0;
      }
      const a = norm(aimX, aimY);
      player.input = { x, y, aimX: a.x, aimY: a.y };
      return;
    }

    if (msg.type === "fruit") {
      const key = String(msg.fruit || "").toLowerCase();
      if (FRUITS[key]) {
        player.fruit = key;
        player.transformed = false;
        player.form = "base";
        player.controlRoom = null;
        player.cooldowns = {};
        this.broadcast({ type: "notice", text: `${player.name} equipou ${FRUITS[key].name}.` });
        this.broadcastState(true);
      }
      return;
    }

    if (msg.type === "mission") {
      this.acceptMission(player);
      return;
    }

    if (msg.type === "skill") {
      if (!this.started && !player.owner) return;
      const key = String(msg.key || "").toLowerCase();
      if (!["m1", "z", "x", "c", "v"].includes(key)) return;
      const aim = this.resolveAim(player, msg.aimX, msg.aimY);
      this.useSkill(player, key, aim, Boolean(msg.held));
      return;
    }

    if (msg.type === "respawn") {
      if (!player.alive && nowMs() >= player.respawnAt) this.respawnPlayer(player);
    }
  }

  onClose(ws) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!session?.playerId) return;
    const wasOwner = this.players.get(session.playerId)?.owner;
    this.players.delete(session.playerId);
    if (wasOwner && this.players.size > 0) {
      const next = this.players.values().next().value;
      if (next) next.owner = true;
    }
    this.broadcastLobby();
    this.broadcastState(true);
  }

  ensureLoop() {
    if (this.loop) return;
    this.lastTick = nowMs();
    this.loop = setInterval(() => this.tick(), TICK_MS);
  }

  stopLoopIfEmpty() {
    if (this.sessions.size === 0 && this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  tick() {
    const t = nowMs();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;

    this.updatePlayers(dt, t);
    if (this.started) {
      this.updateEnemies(dt, t);
      this.updateProjectiles(dt, t);
      this.updateZones(dt, t);
    }
    this.broadcastState(false);
    this.stopLoopIfEmpty();
  }

  updatePlayers(dt, t) {
    for (const p of this.players.values()) {
      p.maxHp = 1000 + (p.level - 1) * 200;
      if (!p.alive) continue;
      this.applyStatuses(p, dt, t);
      this.updateForms(p, dt, t);

      let speed = 230;
      if (p.fruit === "kitsune" && p.transformed) speed *= 1.45;
      if (p.fruit === "venom" && p.transformed) speed *= 1.02;
      if (p.fruit === "luz" && p.transformed) speed *= 1.25;
      if (p.status.stunUntil > t) speed = 0;

      const nx = Number.isFinite(p.input.x) ? p.input.x : 0;
      const ny = Number.isFinite(p.input.y) ? p.input.y : 0;
      const n = Math.hypot(nx, ny) > 1 ? norm(nx, ny) : { x: nx, y: ny };
      p.vx = n.x * speed;
      p.vy = n.y * speed;
      p.x = clamp(p.x + p.vx * dt, 60, WORLD_W - 60);
      p.y = clamp(p.y + p.vy * dt, 60, WORLD_H - 60);
      p.island = nearestIslandId(p.x, p.y);
      if (p.hp <= 0) this.killPlayer(p, t);
    }
  }

  updateForms(p, dt, t) {
    if (p.fruit === "dragon" && p.form === "total") {
      p.fury = clamp(p.fury - 5 * dt, 0, 100);
      if (p.fury <= 0) {
        p.form = "base";
        p.transformed = false;
        this.broadcast({ type: "notice", text: `${p.name} voltou da forma Dragon.` });
      }
    }
    if ((p.fruit === "venom" || p.fruit === "kitsune" || p.fruit === "fenix" || p.fruit === "gelo" || p.fruit === "luz" || p.fruit === "sombra") && p.transformed && t > p.transformUntil) {
      p.transformed = false;
      p.form = "base";
    }
    if (p.controlRoom && t > p.controlRoom.until) p.controlRoom = null;
  }

  updateEnemies(dt, t) {
    for (const e of this.enemies) {
      if (!e.alive) {
        if (t >= e.respawnAt) {
          const island = ISLANDS[e.island];
          const fresh = this.makeEnemy(island, Number(e.id.split("-")[1]) || 0);
          Object.assign(e, fresh);
        }
        continue;
      }
      this.applyStatuses(e, dt, t);
      if (e.hp <= 0) { this.killEnemy(e, null, t); continue; }
      if (e.status.stunUntil > t) continue;

      const target = this.nearestPlayer(e, 460, e.island);
      if (!target) continue;
      const d = norm(target.x - e.x, target.y - e.y);
      const speed = 78 + e.level * 2;
      e.x += d.x * speed * dt;
      e.y += d.y * speed * dt;
      if (Math.hypot(target.x - e.x, target.y - e.y) < 42 && t - e.attackAt > 950) {
        e.attackAt = t;
        this.damagePlayer(target, 32 + e.level * 4, e);
      }
    }
  }

  updateProjectiles(dt, t) {
    const keep = [];
    for (const pr of this.projectiles) {
      if (t > pr.until) continue;
      if (pr.homing) {
        const target = this.nearestTarget({ x: pr.x, y: pr.y }, pr.source, 540);
        if (target) {
          const d = norm(target.x - pr.x, target.y - pr.y);
          pr.vx = pr.vx * 0.88 + d.x * pr.speed * 0.12;
          pr.vy = pr.vy * 0.88 + d.y * pr.speed * 0.12;
        }
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;

      let hit = false;
      for (const e of this.enemies) {
        if (!e.alive || e.island !== pr.island) continue;
        if (Math.hypot(e.x - pr.x, e.y - pr.y) < (pr.radius + 22)) {
          this.damageEnemy(e, pr.damage, pr.source, pr);
          hit = true;
          if (!pr.pierce) break;
        }
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.id === pr.source || p.island !== pr.island) continue;
        if (Math.hypot(p.x - pr.x, p.y - pr.y) < (pr.radius + 24)) {
          this.damagePlayer(p, pr.damage, pr);
          if (pr.poison) this.addDot(p, "poison", pr.poison.dps, pr.poison.duration, t);
          if (pr.burn) this.addDot(p, "burn", pr.burn.dps, pr.burn.duration, t);
          if (pr.stun) p.status.stunUntil = Math.max(p.status.stunUntil || 0, t + pr.stun);
          hit = true;
          if (!pr.pierce) break;
        }
      }
      if (hit && pr.explodeRadius) this.areaDamage(pr.x, pr.y, pr.explodeRadius, pr.explodeDamage || pr.damage, pr.source, { island: pr.island, stun: pr.stun });
      if (!hit || pr.pierce) keep.push(pr);
    }
    this.projectiles = keep.slice(-160);
  }

  updateZones(dt, t) {
    const keep = [];
    for (const z of this.zones) {
      if (t > z.until) continue;
      if (!z.lastTick || t - z.lastTick >= z.every) {
        z.lastTick = t;
        this.areaDamage(z.x, z.y, z.radius, z.damage, z.source, { island: z.island, dot: z.dot, stun: z.stun });
      }
      keep.push(z);
    }
    this.zones = keep.slice(-80);
  }

  applyStatuses(obj, dt, t) {
    if (obj.status.poisonUntil > t) obj.hp -= (obj.status.poisonDps || 0) * dt;
    if (obj.status.burnUntil > t) obj.hp -= (obj.status.burnDps || 0) * dt;
  }

  addDot(obj, type, dps, durationMs, t) {
    obj.status[`${type}Dps`] = Math.max(obj.status[`${type}Dps`] || 0, dps);
    obj.status[`${type}Until`] = Math.max(obj.status[`${type}Until`] || 0, t + durationMs);
  }

  resolveAim(player, ax, ay) {
    let aimX = Number(ax);
    let aimY = Number(ay);
    if (!Number.isFinite(aimX) || !Number.isFinite(aimY) || Math.hypot(aimX, aimY) < 0.08) {
      const target = this.nearestTarget(player, player.id, 720, player.island);
      if (target) return norm(target.x - player.x, target.y - player.y);
      aimX = player.input.aimX || 1;
      aimY = player.input.aimY || 0;
    }
    return norm(aimX, aimY);
  }

  useSkill(p, key, aim, held) {
    if (!p.alive) return;
    const t = nowMs();
    const fruit = p.fruit;
    const cdKey = key;
    const baseCd = cooldownFor(p, key, held);
    if ((p.cooldowns[cdKey] || 0) > t) return;
    p.cooldowns[cdKey] = t + baseCd;

    if (key === "v" && fruit !== "control") return this.toggleTransform(p, t);
    if (key === "m1") return this.useM1(p, aim, held, t);

    if (fruit === "gas") return this.skillGas(p, key, aim, t);
    if (fruit === "dragon") return this.skillDragon(p, key, aim, t);
    if (fruit === "control") return this.skillControl(p, key, aim, t);
    if (fruit === "venom") return this.skillVenom(p, key, aim, t);
    if (fruit === "kitsune") return this.skillKitsune(p, key, aim, t);
    if (fruit === "luz") return this.skillLight(p, key, aim, t);
    if (fruit === "gelo") return this.skillIce(p, key, aim, t);
    if (fruit === "bomba") return this.skillBomb(p, key, aim, t);
    if (fruit === "sombra") return this.skillShadow(p, key, aim, t);
    if (fruit === "fenix") return this.skillPhoenix(p, key, aim, t);
  }

  useM1(p, aim, held, t) {
    if (p.fruit === "control") {
      const full = held;
      this.areaDamage(p.x + aim.x * 80, p.y + aim.y * 80, full || p.controlRoom ? 90 : 58, full || p.controlRoom ? 100 : 30, p.id, { island: p.island });
      this.spawnZone(p.x + aim.x * 80, p.y + aim.y * 80, 80, 0, 300, p.id, "control-burst", p.island);
      return;
    }
    if (p.fruit === "gas") {
      const dmg = p.transformed ? 76 : 50;
      return this.spawnProjectile(p, aim, { speed: 620, life: 820, damage: dmg, radius: 18, pierce: true, kind: "gas-cut" });
    }
    if (p.fruit === "dragon") {
      if (p.form === "total") {
        return this.spawnZone(p.x + aim.x * 125, p.y + aim.y * 125, 135, 30, 1000, p.id, "dragon-flame", p.island, { every: 1000 });
      }
      const dmg = p.form === "hybrid" ? 27 : 25;
      return this.spawnProjectile(p, aim, { speed: 560, life: 1000, damage: dmg, radius: 18, homing: true, kind: "dragon-claw", burn: { dps: 5, duration: 2000 } });
    }
    if (p.fruit === "venom") {
      const dmg = p.transformed ? 22 : 20;
      return this.spawnProjectile(p, aim, { speed: 470, life: 1200, damage: dmg, radius: 20, homing: true, kind: "venom-m1", poison: { dps: p.transformed ? 11 : 10, duration: 3000 } });
    }
    if (p.fruit === "kitsune") {
      const dmg = p.transformed ? 26 : 25;
      return this.spawnProjectile(p, aim, { speed: p.transformed ? 650 : 590, life: p.transformed ? 1300 : 900, damage: dmg, radius: 19, homing: true, kind: "kitsune-claw" });
    }
    if (p.fruit === "luz") return this.spawnProjectile(p, aim, { speed: 850, life: 700, damage: p.transformed ? 44 : 36, radius: 14, pierce: true, kind: "light-m1" });
    if (p.fruit === "gelo") return this.spawnProjectile(p, aim, { speed: 500, life: 950, damage: p.transformed ? 42 : 34, radius: 18, stun: 250, kind: "ice-m1" });
    if (p.fruit === "bomba") return this.spawnProjectile(p, aim, { speed: 420, life: 1050, damage: 45, radius: 21, explodeRadius: 80, explodeDamage: 30, kind: "bomb-m1" });
    if (p.fruit === "sombra") return this.spawnProjectile(p, aim, { speed: 620, life: 850, damage: p.transformed ? 48 : 38, radius: 18, pierce: true, kind: "shadow-m1" });
    if (p.fruit === "fenix") return this.spawnProjectile(p, aim, { speed: 540, life: 1000, damage: p.transformed ? 42 : 35, radius: 18, burn: { dps: 6, duration: 2000 }, kind: "phoenix-m1" });

    this.areaDamage(p.x + aim.x * 54, p.y + aim.y * 54, 48, 15, p.id, { island: p.island });
  }

  toggleTransform(p, t) {
    if (p.fruit === "gas") {
      p.transformed = !p.transformed;
      p.form = p.transformed ? "gas-giant" : "base";
      p.transformUntil = p.transformed ? t + 10 * 60 * 1000 : 0;
      return;
    }
    if (p.fruit === "dragon") {
      if (p.transformed) { p.transformed = false; p.form = "base"; return; }
      if (p.fury >= 100) { p.transformed = true; p.form = "total"; return; }
      if (p.fury >= 50) { p.transformed = true; p.form = "hybrid"; return; }
      this.sendToPlayer(p.id, { type: "notice", text: "Dragon precisa de 50% de fúria para híbrido ou 100% para total." });
      p.cooldowns.v = t + 650;
      return;
    }
    const timed = ["venom", "kitsune", "fenix", "gelo", "luz", "sombra"].includes(p.fruit);
    if (timed) {
      p.transformed = !p.transformed;
      p.form = p.transformed ? "transformed" : "base";
      p.transformUntil = p.transformed ? t + 25000 : 0;
      return;
    }
    if (p.fruit === "control") {
      this.sendToPlayer(p.id, { type: "notice", text: "Control usa V para tempestade dentro da área azul criada pelo Z." });
    }
  }

  skillGas(p, key, aim, t) {
    if (key === "z") {
      p.x = clamp(p.x + aim.x * 155, 60, WORLD_W - 60);
      p.y = clamp(p.y + aim.y * 155, 60, WORLD_H - 60);
      this.areaDamage(p.x, p.y, 95, p.transformed ? 150 : 100, p.id, { island: p.island, stun: 1000, push: aim, pushPower: p.transformed ? 150 : 0 });
    } else if (key === "x") {
      this.spawnZone(p.x, p.y, p.transformed ? 180 : 135, p.transformed ? 150 : 120, 350, p.id, "gas-circle", p.island);
    } else if (key === "c") {
      const count = p.transformed ? 15 : 10;
      for (let i = 0; i < count; i++) this.spawnProjectile(p, spread(aim, 0.42), { speed: 520, life: 1100, damage: 10, radius: 13, kind: "gas-shot", poison: { dps: 5, duration: 3000 } });
    }
  }

  skillDragon(p, key, aim, t) {
    const mult = p.form === "hybrid" ? 1.02 : 1;
    if (key === "z") {
      const total = p.form === "total";
      this.spawnProjectile(p, aim, { speed: total ? 520 : 580, life: 1400, damage: Math.floor((total ? 200 : 100) * mult), radius: total ? 42 : 24, explodeRadius: total ? 150 : 86, kind: "dragon-fire", burn: { dps: 18, duration: 2500 } });
    } else if (key === "x") {
      if (p.form === "total") {
        this.spawnZone(p.x, p.y, 210, 200, 2100, p.id, "dragon-spin", p.island, { every: 2100 });
      } else {
        p.x = clamp(p.x + aim.x * 180, 60, WORLD_W - 60);
        p.y = clamp(p.y + aim.y * 180, 60, WORLD_H - 60);
        this.areaDamage(p.x, p.y, 105, Math.floor(150 * mult), p.id, { island: p.island, stun: 450 });
      }
    } else if (key === "c") {
      if (p.form === "total") {
        this.spawnZone(p.x + aim.x * 220, p.y + aim.y * 220, 250, 75, 5000, p.id, "dragon-rain", p.island, { every: 1000, dot: { type: "burn", dps: 10, duration: 2500 } });
      } else {
        for (let i = 0; i < 25; i++) this.spawnProjectile(p, spread(aim, 1.2), { speed: 410, life: 1800, damage: 5, radius: 9, homing: true, kind: "dragon-arrow" });
      }
    }
  }

  skillControl(p, key, aim, t) {
    if (key === "z") {
      if (p.controlRoom) { p.controlRoom = null; return; }
      p.controlRoom = { x: p.x, y: p.y, radius: 520, until: t + 10 * 60 * 1000 };
      return;
    }
    if (!p.controlRoom) {
      this.sendToPlayer(p.id, { type: "notice", text: "Ative a área azul do Control com Z antes de usar X, C ou V." });
      p.cooldowns[key] = t + 600;
      return;
    }
    if (key === "x") {
      for (let i = 0; i < 11; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * p.controlRoom.radius;
        this.spawnZone(p.controlRoom.x + Math.cos(a) * r, p.controlRoom.y + Math.sin(a) * r, 60, 120, 800, p.id, "control-mine", p.island, { every: 800 });
      }
    } else if (key === "c") {
      for (let i = 0; i < 6; i++) this.spawnProjectile(p, spread(aim, 0.9), { speed: 720, life: 1300, damage: 25, radius: 12, homing: true, kind: "control-spear" });
    } else if (key === "v") {
      this.spawnZone(p.controlRoom.x, p.controlRoom.y, p.controlRoom.radius, 20, 8000, p.id, "control-storm", p.island, { every: 1000 });
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        p.x = clamp(p.controlRoom.x + Math.cos(a) * rnd(80, p.controlRoom.radius - 80), 60, WORLD_W - 60);
        p.y = clamp(p.controlRoom.y + Math.sin(a) * rnd(80, p.controlRoom.radius - 80), 60, WORLD_H - 60);
      }
      p.controlRoom = null;
    }
  }

  skillVenom(p, key, aim, t) {
    if (key === "z") {
      const count = p.transformed ? 5 : 3;
      for (let i = 0; i < count; i++) this.spawnProjectile(p, spread(aim, 0.52), { speed: 460, life: 1250, damage: p.transformed ? 25 : 20, radius: 19, kind: "venom-orb", poison: { dps: p.transformed ? 15 : 10, duration: 3000 } });
    } else if (key === "x") {
      this.spawnZone(p.x + aim.x * 190, p.y + aim.y * 190, p.transformed ? 72 : 54, p.transformed ? 7 : 5, 3000, p.id, "venom-laser", p.island, { every: 100, dot: { type: "poison", dps: 11, duration: 1500 } });
    } else if (key === "c") {
      this.spawnZone(p.x, p.y, p.transformed ? 230 : 165, p.transformed ? 27 : 25, p.transformed ? 6000 : 5000, p.id, "venom-cloud", p.island, { every: 1000, dot: { type: "poison", dps: 7, duration: 1600 } });
    }
  }

  skillKitsune(p, key, aim, t) {
    if (key === "z") {
      if (p.transformed) {
        p.x = clamp(p.x + aim.x * 200, 60, WORLD_W - 60);
        p.y = clamp(p.y + aim.y * 200, 60, WORLD_H - 60);
        this.areaDamage(p.x, p.y, 115, 100, p.id, { island: p.island, stun: 350, dot: { type: "burn", dps: 5, duration: 3000 } });
      } else {
        this.spawnProjectile(p, aim, { speed: 430, life: 2000, damage: 75, radius: 16, homing: true, stun: 300, kind: "kitsune-ember" });
      }
    } else if (key === "x") {
      this.spawnProjectile(p, aim, { speed: 540, life: 1200, damage: p.transformed ? 125 : 100, radius: p.transformed ? 34 : 26, explodeRadius: p.transformed ? 120 : 90, stun: p.transformed ? 1500 : 1000, kind: "kitsune-spike" });
    } else if (key === "c") {
      const x = p.x + aim.x * 210, y = p.y + aim.y * 210;
      this.spawnProjectile(p, aim, { speed: 440, life: 1200, damage: p.transformed ? 55 : 50, radius: p.transformed ? 42 : 34, explodeRadius: p.transformed ? 145 : 120, kind: "kitsune-flame" });
      this.spawnZone(x, y, p.transformed ? 170 : 145, p.transformed ? 42 : 40, p.transformed ? 5000 : 4000, p.id, "blue-fire", p.island, { every: 1000, dot: { type: "burn", dps: 6, duration: 1500 } });
    }
  }

  skillLight(p, key, aim, t) {
    if (key === "z") this.spawnProjectile(p, aim, { speed: 940, life: 900, damage: p.transformed ? 105 : 90, radius: 18, pierce: true, kind: "light-beam" });
    if (key === "x") { p.x = clamp(p.x + aim.x * 260, 60, WORLD_W - 60); p.y = clamp(p.y + aim.y * 260, 60, WORLD_H - 60); this.areaDamage(p.x, p.y, 95, 85, p.id, { island: p.island }); }
    if (key === "c") this.spawnZone(p.x + aim.x * 240, p.y + aim.y * 240, 190, 38, 3500, p.id, "light-rain", p.island, { every: 600 });
  }

  skillIce(p, key, aim, t) {
    if (key === "z") this.spawnProjectile(p, aim, { speed: 540, life: 1300, damage: 85, radius: 23, stun: 650, kind: "ice-spear" });
    if (key === "x") { p.x = clamp(p.x + aim.x * 150, 60, WORLD_W - 60); p.y = clamp(p.y + aim.y * 150, 60, WORLD_H - 60); this.areaDamage(p.x, p.y, 120, 110, p.id, { island: p.island, stun: 1000 }); }
    if (key === "c") this.spawnZone(p.x, p.y, 185, 28, 4500, p.id, "ice-field", p.island, { every: 1000, stun: 250 });
  }

  skillBomb(p, key, aim, t) {
    if (key === "z") this.spawnProjectile(p, aim, { speed: 430, life: 1200, damage: 105, radius: 25, explodeRadius: 130, explodeDamage: 70, kind: "bomb-shot" });
    if (key === "x") this.areaDamage(p.x, p.y, 175, 135, p.id, { island: p.island });
    if (key === "c") for (let i = 0; i < 5; i++) this.spawnZone(p.x + rnd(-160, 160), p.y + rnd(-160, 160), 75, 85, 2600, p.id, "bomb-mine", p.island, { every: 1200 });
  }

  skillShadow(p, key, aim, t) {
    if (key === "z") this.spawnProjectile(p, aim, { speed: 660, life: 950, damage: 95, radius: 20, pierce: true, kind: "shadow-slash" });
    if (key === "x") { p.x = clamp(p.x + aim.x * 230, 60, WORLD_W - 60); p.y = clamp(p.y + aim.y * 230, 60, WORLD_H - 60); this.areaDamage(p.x, p.y, 115, 125, p.id, { island: p.island, stun: 500 }); }
    if (key === "c") this.spawnZone(p.x + aim.x * 110, p.y + aim.y * 110, 190, 34, 4200, p.id, "shadow-vortex", p.island, { every: 650, stun: 150 });
  }

  skillPhoenix(p, key, aim, t) {
    if (key === "z") this.spawnProjectile(p, aim, { speed: 610, life: 1100, damage: 90, radius: 24, homing: true, burn: { dps: 7, duration: 2500 }, kind: "phoenix-bird" });
    if (key === "x") {
      const heal = p.transformed ? 170 : 120;
      p.hp = clamp(p.hp + heal, 0, p.maxHp);
      this.spawnZone(p.x, p.y, 135, 0, 800, p.id, "phoenix-heal", p.island);
    }
    if (key === "c") { p.x = clamp(p.x + aim.x * 210, 60, WORLD_W - 60); p.y = clamp(p.y + aim.y * 210, 60, WORLD_H - 60); this.areaDamage(p.x, p.y, 145, 115, p.id, { island: p.island, dot: { type: "burn", dps: 8, duration: 2200 } }); }
  }

  spawnProjectile(p, aim, opts) {
    const t = nowMs();
    this.projectiles.push({
      id: `p${this.nextId++}`,
      source: p.id,
      island: p.island,
      x: p.x + aim.x * 35,
      y: p.y + aim.y * 35,
      vx: aim.x * opts.speed,
      vy: aim.y * opts.speed,
      speed: opts.speed,
      until: t + opts.life,
      damage: opts.damage,
      radius: opts.radius || 14,
      pierce: Boolean(opts.pierce),
      homing: Boolean(opts.homing),
      poison: opts.poison,
      burn: opts.burn,
      stun: opts.stun || 0,
      explodeRadius: opts.explodeRadius || 0,
      explodeDamage: opts.explodeDamage || 0,
      kind: opts.kind || "shot"
    });
  }

  spawnZone(x, y, radius, damage, duration, source, kind, island, extra = {}) {
    const t = nowMs();
    this.zones.push({ id: `z${this.nextId++}`, x, y, radius, damage, source, kind, island, until: t + duration, every: extra.every || 250, dot: extra.dot, stun: extra.stun || 0, lastTick: 0 });
  }

  areaDamage(x, y, radius, damage, source, options = {}) {
    const t = nowMs();
    const src = this.players.get(source);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (options.island !== undefined && e.island !== options.island) continue;
      if (Math.hypot(e.x - x, e.y - y) <= radius + 23) {
        this.damageEnemy(e, damage, source, options);
        if (options.stun) e.status.stunUntil = Math.max(e.status.stunUntil || 0, t + options.stun);
        if (options.dot) this.addDot(e, options.dot.type, options.dot.dps, options.dot.duration, t);
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.id === source) continue;
      if (options.island !== undefined && p.island !== options.island) continue;
      if (Math.hypot(p.x - x, p.y - y) <= radius + 26) {
        this.damagePlayer(p, damage, { source });
        if (options.stun) p.status.stunUntil = Math.max(p.status.stunUntil || 0, t + options.stun);
        if (options.dot) this.addDot(p, options.dot.type, options.dot.dps, options.dot.duration, t);
        if (options.push) {
          p.x = clamp(p.x + options.push.x * (options.pushPower || 90), 60, WORLD_W - 60);
          p.y = clamp(p.y + options.push.y * (options.pushPower || 90), 60, WORLD_H - 60);
        }
      }
    }
    if (src && damage > 0 && src.fruit === "dragon" && src.form !== "total") src.fury = clamp(src.fury + damage / 5, 0, 100);
  }

  damageEnemy(e, amount, source, meta = {}) {
    const src = this.players.get(source);
    let dmg = Number(amount) || 0;
    if (src) {
      if (src.fruit === "venom" && src.transformed) dmg *= 1.05;
      if (src.fruit === "kitsune" && src.transformed) dmg *= 1.01;
      if (src.fruit === "dragon" && src.form === "hybrid") dmg *= 1.02;
      if (src.fruit === "dragon" && src.form !== "total") src.fury = clamp(src.fury + dmg / 5, 0, 100);
    }
    e.hp -= dmg;
    e.hitAt = nowMs();
    if (e.hp <= 0) this.killEnemy(e, source, nowMs());
  }

  damagePlayer(p, amount, source) {
    let defense = 0;
    if (p.transformed) defense += FRUITS[p.fruit]?.defense || 0;
    if (p.fruit === "gas" && p.transformed) defense = Math.max(defense, 0.10);
    if (p.fruit === "dragon" && p.form === "hybrid") defense = Math.max(defense, 0.05);
    const dmg = Math.max(1, (Number(amount) || 0) * (1 - defense));
    p.hp -= dmg;
    if (p.hp <= 0) this.killPlayer(p, nowMs());
  }

  killEnemy(e, source, t) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    e.respawnAt = t + 10000;
    if (source) {
      const p = this.players.get(source);
      if (p?.mission?.active && p.mission.island === e.island) {
        p.mission.kills = clamp(p.mission.kills + 1, 0, 5);
        if (p.mission.kills >= 5) this.completeMission(p, ISLANDS[e.island]);
      }
    }
  }

  killPlayer(p, t) {
    p.alive = false;
    p.hp = 0;
    p.respawnAt = t + 3500;
    this.sendToPlayer(p.id, { type: "notice", text: "Você caiu! Toque em Reviver quando liberado." });
  }

  respawnPlayer(p) {
    const island = ISLANDS[p.island] || ISLANDS[0];
    p.x = island.x + rnd(-75, 75);
    p.y = island.y + rnd(-70, 70);
    p.hp = p.maxHp;
    p.alive = true;
    p.status = {};
  }

  acceptMission(p) {
    const island = ISLANDS[p.island] || ISLANDS[0];
    if (dist(p, { x: island.npcX, y: island.npcY }) > 210) {
      this.sendToPlayer(p.id, { type: "notice", text: `Chegue perto do NPC da ${island.name} para pegar missão.` });
      return;
    }
    p.mission = { active: true, island: island.id, kills: 0, target: 5 };
    this.sendToPlayer(p.id, { type: "notice", text: `Missão aceita: derrote 5 ${island.enemyName}.` });
  }

  completeMission(p, island) {
    p.money += island.rewardMoney;
    p.xp += island.rewardXp;
    const text = `Missão concluída! +${island.rewardXp} XP e +$${island.rewardMoney}.`;
    p.mission = null;
    while (p.xp >= xpNeed(p.level)) {
      p.xp -= xpNeed(p.level);
      p.level += 1;
      p.maxHp = 1000 + (p.level - 1) * 200;
      p.hp = p.maxHp;
    }
    this.sendToPlayer(p.id, { type: "notice", text });
  }

  nearestPlayer(pos, range = Infinity, island = null) {
    let best = null;
    let bestD = range;
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (island !== null && p.island !== island) continue;
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  nearestTarget(pos, source, range = Infinity, island = null) {
    let best = null;
    let bestD = range;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      if (island !== null && e.island !== island) continue;
      const d = Math.hypot(e.x - pos.x, e.y - pos.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.id === source) continue;
      if (island !== null && p.island !== island) continue;
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  broadcastLobby() {
    this.broadcast({ type: "lobby", players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, owner: p.owner, fruit: p.fruit })), started: this.started, code: this.code });
  }

  broadcastState(force) {
    const state = {
      type: "state",
      t: nowMs(),
      code: this.code,
      started: this.started,
      world: { w: WORLD_W, h: WORLD_H },
      islands: ISLANDS,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, owner: p.owner, x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), maxHp: p.maxHp,
        level: p.level, xp: p.xp, xpNeed: xpNeed(p.level), money: p.money, fruit: p.fruit, alive: p.alive,
        island: p.island, mission: p.mission, transformed: p.transformed, form: p.form, fury: Math.round(p.fury),
        color: p.color, controlRoom: p.controlRoom,
        cooldowns: remainingCooldowns(p.cooldowns), status: p.status, respawnIn: p.alive ? 0 : Math.max(0, p.respawnAt - nowMs())
      })),
      enemies: this.enemies.map(e => ({ id: e.id, name: e.name, level: e.level, island: e.island, x: Math.round(e.x), y: Math.round(e.y), hp: Math.round(e.hp), maxHp: e.maxHp, alive: e.alive, respawnIn: e.alive ? 0 : Math.max(0, e.respawnAt - nowMs()), status: e.status })),
      projectiles: this.projectiles.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), r: p.radius, kind: p.kind, island: p.island })),
      zones: this.zones.map(z => ({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: z.radius, kind: z.kind, island: z.island, until: z.until }))
    };
    this.broadcast(state);
  }

  sendToPlayer(playerId, data) {
    for (const [ws, session] of this.sessions.entries()) if (session.playerId === playerId) this.send(ws, data);
  }

  send(ws, data) {
    try { ws.send(JSON.stringify(data)); } catch {}
  }

  broadcast(data) {
    const text = JSON.stringify(data);
    for (const ws of this.sessions.keys()) {
      try { ws.send(text); } catch {}
    }
  }
}

function publicFruits() {
  return Object.entries(FRUITS).map(([key, f]) => ({ key, name: f.name, tint: f.tint, aura: f.aura }));
}

function nearestIslandId(x, y) {
  let best = 0, bestD = Infinity;
  for (const island of ISLANDS) {
    const d = Math.hypot(x - island.x, y - island.y);
    if (d < bestD) { bestD = d; best = island.id; }
  }
  return best;
}

function pickColor(i) {
  return ["#61dafb", "#ff73c9", "#a7ff67", "#ffd166"][i % 4];
}

function remainingCooldowns(cds) {
  const t = nowMs();
  const out = {};
  for (const [k, v] of Object.entries(cds)) out[k] = Math.max(0, Math.ceil((v - t) / 100) / 10);
  return out;
}

function cooldownFor(p, key, held) {
  if (key === "m1") {
    if (!p.fruit) return 1000;
    if (p.fruit === "gas") return 2000;
    if (p.fruit === "dragon" && p.form === "total") return 3000;
    if (p.fruit === "dragon") return 1000;
    if (p.fruit === "control") return 3000;
    if (p.fruit === "venom") return 3000;
    if (p.fruit === "kitsune") return 2000;
    return 1200;
  }
  const table = {
    z: { gas: 4200, dragon: 3400, control: 900, venom: 3600, kitsune: 3600, luz: 2800, gelo: 3400, bomba: 3600, sombra: 3200, fenix: 3400 },
    x: { gas: 5200, dragon: 5700, control: 5600, venom: 6000, kitsune: 5200, luz: 4600, gelo: 5200, bomba: 5200, sombra: 5600, fenix: 6500 },
    c: { gas: 7600, dragon: 9000, control: 7400, venom: 8200, kitsune: 8200, luz: 7600, gelo: 7800, bomba: 8000, sombra: 8200, fenix: 8400 },
    v: { gas: 1100, dragon: 1200, control: 9000, venom: 16000, kitsune: 16000, luz: 14000, gelo: 14000, bomba: 9000, sombra: 14000, fenix: 15000 }
  };
  return table[key]?.[p.fruit] || 2000;
}

function spread(aim, amount) {
  const base = Math.atan2(aim.y, aim.x);
  const a = base + rnd(-amount, amount);
  return { x: Math.cos(a), y: Math.sin(a) };
}

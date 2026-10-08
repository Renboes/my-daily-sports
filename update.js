// Met à jour data.json avec les calendriers F1 et NBA (heure de Paris).
// Lancé chaque nuit par GitHub Actions. Aucune dépendance (Node 18 ou plus).
const fs = require("fs");
const FILE = process.env.DATA_FILE || "data.json";

const paris = iso => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-CA", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { d: `${p.year}-${p.month}-${p.day}`, t: `${p.hour}:${p.minute}` };
};

const FR = [["indonesia","d'Indonésie"],["malaysia","de Malaisie"],["thailand","de Thaïlande"],["argentina","d'Argentine"],["americas","des Amériques"],["portugal","du Portugal"],["valencia","de Valence"],["san marino","de Saint-Marin"],["france","de France"],["spain","d'Espagne"],["catalunya","de Catalogne"],["german","d'Allemagne"],["czech","de Tchéquie"],["aragon","d'Aragon"],["singapore","de Singapour"],["united states","des États-Unis"],["mexic","du Mexique"],
  ["são paulo","du Brésil"],["sao paulo","du Brésil"],["brazil","du Brésil"],["las vegas","de Las Vegas"],
  ["qatar","du Qatar"],["abu dhabi","d'Abu Dhabi"],["australia","d'Australie"],["china","de Chine"],
  ["japan","du Japon"],["miami","de Miami"],["canad","du Canada"],["monaco","de Monaco"],
  ["barcelona","de Barcelone-Catalogne"],["austria","d'Autriche"],["britain","de Grande-Bretagne"],
  ["british","de Grande-Bretagne"],["belgi","de Belgique"],["hungar","de Hongrie"],["dutch","des Pays-Bas"],
  ["netherlands","des Pays-Bas"],["ital","d'Italie"],["spanish","d'Espagne"],["madrid","d'Espagne"],
  ["azerbaijan","d'Azerbaïdjan"],["bahrain","de Bahreïn"],["saudi","d'Arabie saoudite"]];
const gp = n => { const k = n.toLowerCase(); const f = FR.find(([w]) => k.includes(w)); return f ? "Grand Prix " + f[1] : n; };

const NBA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nba.com/",
  "Origin": "https://www.nba.com"
};
const get = async (url, headers = { "User-Agent": "my-daily-sports" }) => {
  for (let essai = 1; ; essai++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && essai < 3) { await new Promise(x => setTimeout(x, 1500 * essai)); continue; }
    let body = "";
    try { body = (await r.text()).slice(0, 150); } catch (e) {}
    throw new Error(url + " -> HTTP " + r.status + " " + body);
  }
};

async function f1() {
  const out = [], y = new Date().getFullYear();
  const S = [["FirstPractice","Essais libres 1"],["SecondPractice","Essais libres 2"],["ThirdPractice","Essais libres 3"],
             ["SprintQualifying","Sprint Shootout"],["Sprint","Sprint"],["Qualifying","Qualifications"]];
  for (const year of [y, y + 1]) {
    const j = await get(`https://api.jolpi.ca/ergast/f1/${year}.json?limit=100`);
    for (const r of j.MRData.RaceTable.Races || []) {
      const name = gp(r.raceName), de = r.Circuit.circuitName;
      const ses = S.filter(([k]) => r[k]).map(([k, l]) => [r[k], l]);
      ses.push([r, "Course"]);
      for (const [s, lab] of ses) {
        if (!s.date) continue;
        const { d, t } = paris(s.date + "T" + (s.time || "00:00:00Z"));
        out.push({ d, t: s.time ? t : "", l: "f1", ti: name + " : " + lab, de });
      }
    }
  }
  return out;
}

async function nbaSite() {
  const j = await get("https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json", NBA_HEADERS);
  const out = [];
  for (const gd of j.leagueSchedule.gameDates) for (const g of gd.games || []) {
    const h = g.homeTeam && g.homeTeam.teamName, a = g.awayTeam && g.awayTeam.teamName;
    if (!h || !a || !g.gameDateTimeUTC) continue;
    const { d, t } = paris(g.gameDateTimeUTC);
    out.push({ d, t, l: "nba", ti: h + " - " + a, de: [g.gameLabel, g.arenaName].filter(Boolean).join(", ") || "NBA" });
  }
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Source de secours : balldontlie (clé gratuite, 5 requêtes par minute)
async function nbaBdl(key) {
  const out = [], now = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const q = `seasons[]=${season}&per_page=100` + (cursor ? `&cursor=${cursor}` : "");
    const H = { Authorization: key };
    let j;
    try { j = await get(`https://api.balldontlie.io/nba/v1/games?${q}`, H); }
    catch (e) { if (!/404/.test(e.message)) throw e; j = await get(`https://api.balldontlie.io/v1/games?${q}`, H); }
    for (const g of j.data || []) {
      const h = g.home_team && g.home_team.name, a = g.visitor_team && g.visitor_team.name;
      if (!h || !a) continue;
      const iso = g.datetime || (/^\d{4}-\d\d-\d\dT/.test(g.status || "") ? g.status : null);
      const x = iso ? paris(iso) : { d: String(g.date).slice(0, 10), t: "" };
      out.push({ d: x.d, t: x.t, l: "nba", ti: h + " - " + a, de: "NBA" });
    }
    cursor = j.meta && j.meta.next_cursor;
    if (!cursor) break;
    await sleep(13000);
  }
  return out;
}

async function nba() {
  const key = process.env.BALLDONTLIE_KEY;
  if (key) {
    try { return await nbaBdl(key); }
    catch (e) { console.error("balldontlie :", e.message); }
  }
  return nbaSite();
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

// Football, rugby, NFL, NHL et UFC via le service public d'ESPN (sans clé).
// Identifiants : soccer/fra.1 = Ligue 1, rugby/270559 = Top 14, football/nfl, hockey/nhl, mma/ufc, etc.
const rangeBroken = {};
async function espnDaily(base, a, b) {
  const days = [];
  for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) days.push(ymd(d));
  const out = [];
  for (let i = 0; i < days.length; i += 5) {
    const res = await Promise.all(days.slice(i, i + 5).map(x => get(base + x)));
    for (const j of res) out.push(...(j.events || []));
    await sleep(150);
  }
  return out;
}
async function espnWindow(sport, slug, a, b) {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${slug}/scoreboard?dates=`;
  if (!rangeBroken[sport]) {
    try { return (await get(base + ymd(a) + "-" + ymd(b))).events || []; }
    catch (e) {
      if (!/HTTP 400/.test(e.message)) throw e;
      rangeBroken[sport] = true;
      console.log(sport + " : plage de dates refusée par ESPN, passage au jour par jour");
    }
  }
  return espnDaily(base, a, b);
}

async function espn(sport, slug, l, label, win) {
  const seen = new Map(), now = new Date();
  const start = win ? win[0] : new Date(now - 2 * 864e5);
  const end = win ? win[1] : new Date(Date.UTC(now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0), 5, 30));
  const days = +process.env.ESPN_DAYS || 120;
  for (let a = new Date(start); a < end; a.setDate(a.getDate() + 14)) {
    if (!win && rangeBroken[sport] && +a > +start + days * 864e5) break;
    const b = new Date(Math.min(+a + 13 * 864e5, +end));
    for (const e of await espnWindow(sport, slug, new Date(a), b)) {
      if (!e.date) continue;
      const c = e.competitions && e.competitions[0], cs = (c && c.competitors) || [];
      const { d, t } = paris(e.date);
      const venue = (c && c.venue && c.venue.fullName) || label;
      if (sport === "mma") { seen.set(e.id || e.date, { d, t, l, ti: e.name || e.shortName || label, de: venue }); continue; }
      const h = cs.find(x => x.homeAway === "home") || cs[0], v = cs.find(x => x.homeAway === "away") || cs[1];
      if (!h || !v || !h.team || !v.team) continue;
      const nm = x => x.team.shortDisplayName || x.team.displayName;
      seen.set(e.id || e.date + nm(h), { d, t, l, ti: nm(h) + " - " + nm(v), de: venue });
    }
  }
  return [...seen.values()];
}

// ---------- Euroligue : interface publique du site officiel (horaires annoncés en heure d'Europe centrale, comme Paris) ----------
const pick = (x, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((o, p) => (o == null ? o : o[p]), x); if (v != null && v !== "" && typeof v !== "object") return v; } return null; };
const MOIS = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
async function euroleague() {
  const now = new Date(), y = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, code = "E" + y;
  let games = null;
  const essais = [];
  trouve: for (const v of ["v3", "v2"]) for (const q of ["?limit=500", ""]) {
    try {
      const j = await get(`https://api-live.euroleague.net/${v}/competitions/E/seasons/${code}/games${q}`);
      const arr = Array.isArray(j) ? j : (j.data || j.games || j.items || j.results || []);
      if (arr.length) { games = arr; break trouve; }
      essais.push(v + " vide");
    } catch (e) { essais.push(e.message.slice(0, 140)); }
  }
  const out = [];
  if (games) {
    for (const x of games) {
      const h = pick(x, "local.club.name", "local.club.abbreviatedName", "local.name", "home.name", "homeTeam.name", "homeClub.name", "homeTeam", "home");
      const a = pick(x, "road.club.name", "road.club.abbreviatedName", "road.name", "away.name", "awayTeam.name", "awayClub.name", "awayTeam", "away");
      if (!h || !a) continue;
      const utc = pick(x, "utcDate", "gameUtc", "dateUtc");
      let d, t = "";
      if (utc) ({ d, t } = paris(/[zZ]|[+-]\d\d:?\d\d$/.test(utc) ? utc : utc + "Z"));
      else {
        const raw = String(pick(x, "date", "gameDate", "startDate") || ""), m = raw.match(/^(\d{4}-\d\d-\d\d)(?:[T ](\d\d:\d\d))?/);
        if (!m) continue;
        d = m[1]; t = m[2] || String(pick(x, "time", "startTime") || "").slice(0, 5);
      }
      const rd = pick(x, "round.round", "roundNumber", "round");
      out.push({ d, t, l: "euro", ti: h + " - " + a, de: [pick(x, "venue.name", "arena.name"), rd ? "Journée " + rd : null].filter(Boolean).join(", ") || "Euroligue" });
    }
    return out;
  }
  // dernier recours : ancien format XML
  try {
    const r = await fetch(`https://api-live.euroleague.net/v1/schedules?seasonCode=${code}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const xml = await r.text(), tag = (s, n) => (s.match(new RegExp("<" + n + ">([\\s\\S]*?)</" + n + ">")) || [])[1];
    for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const s = it[1], h = tag(s, "hometeam"), a = tag(s, "awayteam"), dt = tag(s, "date");
      if (!h || !a || !dt) continue;
      const m = dt.match(/^(\w{3})\w*\s+(\d+),\s*(\d{4})/), iso = m ? `${m[3]}-${MOIS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}` : dt.slice(0, 10);
      out.push({ d: iso, t: (tag(s, "startime") || tag(s, "starttime") || "").slice(0, 5), l: "euro", ti: h.trim() + " - " + a.trim(), de: tag(s, "arenaname") || "Euroligue" });
    }
  } catch (e) { essais.push(e.message.slice(0, 140)); }
  if (!out.length) throw new Error("aucun format reconnu : " + essais.join(" | "));
  return out;
}

// ---------- Biathlon : résultats de l'IBU (biathlonresults.com) ----------
const frRace = s => {
  let g = ""; s = String(s || "").replace(/\b(Women|Men)\b/i, m => { g = /women/i.test(m) ? "femmes" : "hommes"; return ""; }).trim();
  for (const [a, b] of [["Single Mixed Relay", "Relais mixte simple"], ["Mixed Relay", "Relais mixte"], ["Mass Start", "Mass start"], ["Pursuit", "Poursuite"], ["Individual", "Individuel"], ["Super Sprint", "Super sprint"], ["Relay", "Relais"]]) s = s.replace(new RegExp(a, "i"), b);
  return (s.replace(/(\d+)\.(\d+)\s*km/g, "$1,$2 km").replace(/(\d+)km/g, "$1 km") + (g ? " " + g : "")).trim();
};
async function biathlon() {
  const base = "https://biathlonresults.com/modules/sportapi/api/", now = new Date();
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const season = String(y % 100).padStart(2, "0") + String((y + 1) % 100).padStart(2, "0"), today = now.toISOString().slice(0, 10), out = [], bad = [];
  const arr = j => (Array.isArray(j) ? j : (j && (j.data || j.Events || j.Competitions)) || []);
  for (const level of [0, 1, 2]) {
    let evs = [];
    try { evs = arr(await get(`${base}Events?SeasonId=${season}&Level=${level}`)); } catch (e) { if (level === 1) throw e; }
    for (const ev of evs) {
      const desc = (ev.Description || "") + " " + (ev.ShortDescription || "");
      let l = null;
      if (/world championships/i.test(desc) && !/junior|youth|summer/i.test(desc)) l = "bch";
      else if (level === 1) l = "bwc";
      else if (level === 2 && /european championships/i.test(desc) && !/junior|youth/i.test(desc)) l = "beu";
      if (!l || !ev.EventId) continue;
      if (ev.EndDate && String(ev.EndDate).slice(0, 10) < today) continue;
      const place = ev.ShortDescription || ev.Organizer || ev.Description;
      for (const c of arr(await get(`${base}Competitions?EventId=${ev.EventId}`))) {
        const iso = v => { const x = String(v).trim().replace(" ", "T"); return /[zZ]|[+-]\d\d:?\d\d$/.test(x) ? x : x + "Z"; };
        let d, t = "";
        try {
          const utc = c.UTCStartTime || c.StartTimeUTC;
          if (utc) ({ d, t } = paris(iso(utc)));
          else if (c.StartTime && typeof ev.UTCOffset === "number") ({ d, t } = paris(new Date(Date.parse(iso(c.StartTime)) - ev.UTCOffset * 36e5).toISOString()));
          else throw new Error("pas d'heure UTC");
        } catch (e) {
          const m = String(c.StartTime || c.UTCStartTime || c.StartDate || "").match(/\d{4}-\d\d-\d\d/);
          if (!m) { bad.push(JSON.stringify(c).slice(0, 220)); continue; }
          d = m[0]; t = "";
        }
        out.push({ d, t, l, ti: place + " : " + frRace(c.Description || c.ShortDescription), de: ev.Description || place });
      }
      await sleep(150);
    }
  }
  if (!out.length) throw new Error("aucune course lisible, exemple : " + (bad[0] || "aucun"));
  return out;
}

// ---------- MotoGP : interface publique du site officiel (heures avec décalage, converties en heure de Paris) ----------
async function motogp() {
  const base = "https://api.motogp.pulselive.com/motogp/v1/results/", now = new Date(), y = now.getUTCFullYear(), today = now.toISOString().slice(0, 10), out = [];
  const arr = j => (Array.isArray(j) ? j : (j && (j.data || j.results || j.items)) || []);
  for (const s of arr(await get(base + "seasons")).filter(x => [y, y + 1].includes(+x.year))) {
    for (const e of arr(await get(`${base}events?seasonUuid=${s.id}`))) {
      if (e.test) continue;
      const end = String(e.date_end || e.dateEnd || "").slice(0, 10);
      if (end && end < today) continue;
      const cat = arr(await get(`${base}categories?eventUuid=${e.id}`)).find(c => /^motogp/i.test(c.name || ""));
      if (!cat) continue;
      const place = gp(e.name || (e.country && e.country.name) || "");
      for (const x of arr(await get(`${base}sessions?eventUuid=${e.id}&categoryUuid=${cat.id}`))) {
        if (!x.date) continue;
        const sn = String(x.name || x.type || "").toLowerCase(), no = (sn.match(/(\d)/) || [])[1], num = no ? " " + no : "";
        const lab = /sprint/.test(sn) ? "Sprint" : /race/.test(sn) ? "Course" : /warm/.test(sn) ? "Warm-up" : /qualif|^q\d/.test(sn) ? "Qualifications" + num
          : /free practice|^fp/.test(sn) ? "Essais libres" + num : /practice|^pr/.test(sn) ? "Practice" : (x.name || x.type);
        const iso = String(x.date), hasTz = /[zZ]|[+-]\d\d:?\d\d$/.test(iso);
        const { d, t } = hasTz ? paris(iso) : { d: iso.slice(0, 10), t: "" };
        out.push({ d, t, l: "moto", ti: place + " : " + lab, de: (e.circuit && e.circuit.name) || e.sname || "MotoGP" });
      }
      await sleep(150);
    }
  }
  return out;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  let events = data.events, fails = 0;
  const real = new Set(data.real || []);
  const sy = new Date().getUTCFullYear() + (new Date().getUTCMonth() >= 6 ? 1 : 0);
  const sources = [["f1", f1], ["nba", nba],
    ["l1", () => espn("soccer", "fra.1", "l1", "Ligue 1")],
    ["l2", () => espn("soccer", "fra.2", "l2", "Ligue 2")],
    ["ldn", () => espn("soccer", "uefa.nations", "ldn", "Ligue des Nations")],
    ["rt14", () => espn("rugby", "270559", "rt14", "Top 14")],
    ["rec", () => espn("rugby", "271937", "rec", "Coupe d'Europe")],
    ["r6n", () => espn("rugby", "180659", "r6n", "Six Nations", [new Date(Date.UTC(sy, 0, 25)), new Date(Date.UTC(sy, 2, 31))])],
    ["ucl", () => espn("soccer", "uefa.champions", "ucl", "Ligue des champions")],
    ["uel", () => espn("soccer", "uefa.europa", "uel", "Europa League")],
    ["pl", () => espn("soccer", "eng.1", "pl", "Premier League")],
    ["liga", () => espn("soccer", "esp.1", "liga", "La Liga")],
    ["sa", () => espn("soccer", "ita.1", "sa", "Serie A")],
    ["bl", () => espn("soccer", "ger.1", "bl", "Bundesliga")],
    ["nfl", () => espn("football", "nfl", "nfl", "NFL")],
    ["nhl", () => espn("hockey", "nhl", "nhl", "NHL")],
    ["ufc", () => espn("mma", "ufc", "ufc", "UFC")],
    ["moto", motogp],
    ["euro", euroleague],
    ["biathlon", biathlon, ["bwc", "bch", "beu"]]];
  events = events.filter(e => e.l !== "elite"); // Betclic Élite : uniquement les vraies affiches saisies dans manual.json
  for (const [l, fn, ls = [l]] of sources) {
    try {
      const fresh = await fn();
      if (!fresh.length) throw new Error("aucun événement reçu");
      events = events.filter(e => !ls.includes(e.l)).concat(fresh);
      fresh.forEach(e => real.add(e.l));
      console.log(l, "OK :", fresh.length, "événements");
    } catch (e) {
      fails++;
      console.error(l, "ÉCHEC, anciennes données conservées :", e.message);
    }
  }
  events.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  fs.writeFileSync(FILE, '{"updatedAt":"' + new Date().toISOString() + '","real":' + JSON.stringify([...real]) + ',"events":[\n' +
    events.map(e => JSON.stringify(e)).join(",\n") + "\n]}");
  if (fails === sources.length) process.exitCode = 1;
}
main();

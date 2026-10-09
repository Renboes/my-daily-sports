// Met à jour data.json avec les calendriers F1 et NBA (heure de Paris).
// Lancé chaque nuit par GitHub Actions. Aucune dépendance (Node 18 ou plus).
const fs = require("fs");
const FILE = process.env.DATA_FILE || "data.json";
const LIGHT = process.env.MODE === "results";   // mode « résultats » : ne relit que les derniers jours
let OLD = [];                                      // données déjà enregistrées (pour rattraper les résultats manquants)
let BACK = 100;                                   // jours passés relus (100 au premier passage, 3 ensuite)
const dd = d => d.toISOString().slice(0, 10);
const warned = {};
const warn1 = (k, m) => { if (!warned[k]) { warned[k] = 1; console.error(k, "résultats :", m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const podium = (rows, pole) => {
  const L = rows.slice(0, 3).map(x => x.position + ". " + (x.Driver && x.Driver.familyName));
  return L.length ? (pole ? "Pole : " + L[0].slice(3) + (L.length > 1 ? " · " + L.slice(1).join(" · ") : "") : L.join(" · ")) : null;
};
async function f1Results(year, round) {
  const base = `https://api.jolpi.ca/ergast/f1/${year}/${round}/`, res = {};
  for (const [k, file, field] of [["Course", "results", "Results"], ["Qualifications", "qualifying", "QualifyingResults"], ["Sprint", "sprint", "SprintResults"]]) {
    try {
      const r = (await get(base + file + ".json")).MRData.RaceTable.Races[0];
      if (r && r[field] && r[field].length) res[k] = podium(r[field], k === "Qualifications");
    } catch (e) {}
    await sleep(250);
  }
  return res;
}
async function f1() {
  const out = [], y = new Date().getFullYear(), today = dd(new Date());
  const S = [["FirstPractice","Essais libres 1"],["SecondPractice","Essais libres 2"],["ThirdPractice","Essais libres 3"],
             ["SprintQualifying","Sprint Shootout"],["Sprint","Sprint"],["Qualifying","Qualifications"]];
  for (const year of [y, y + 1]) {
    const j = await get(`https://api.jolpi.ca/ergast/f1/${year}.json?limit=100`);
    for (const r of j.MRData.RaceTable.Races || []) {
      const name = gp(r.raceName), de = r.Circuit.circuitName;
      const ses = S.filter(([k]) => r[k]).map(([k, l]) => [r[k], l]);
      ses.push([r, "Course"]);
      let res = {};
      if (r.date <= today && (!LIGHT || Date.now() - Date.parse(r.date) < 8 * 864e5)) res = await f1Results(year, r.round);
      for (const [s, lab] of ses) {
        if (!s.date) continue;
        const { d, t } = paris(s.date + "T" + (s.time || "00:00:00Z"));
        out.push({ d, t: s.time ? t : "", l: "f1", ti: name + " : " + lab, de, ...(res[lab] ? { sc: res[lab], fin: 1 } : {}) });
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
    out.push({ d, t, l: "nba", ti: h + " - " + a, de: [g.gameLabel, g.arenaName].filter(Boolean).join(", ") || "NBA", ...(g.gameStatus === 3 && g.homeTeam.score != null ? { sc: g.homeTeam.score + "-" + g.awayTeam.score, fin: 1 } : {}) });
  }
  return out;
}


// Source de secours : balldontlie (clé gratuite, 5 requêtes par minute)
async function nbaBdl(key, dates) {
  const out = [], now = new Date();
  const season = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  let cursor = "";
  for (let i = 0; i < 20; i++) {
    const q = (dates ? dates.map(x => "dates[]=" + x).join("&") : `seasons[]=${season}`) + "&per_page=100" + (cursor ? `&cursor=${cursor}` : "");
    const H = { Authorization: key };
    let j;
    try { j = await get(`https://api.balldontlie.io/nba/v1/games?${q}`, H); }
    catch (e) { if (!/404/.test(e.message)) throw e; j = await get(`https://api.balldontlie.io/v1/games?${q}`, H); }
    for (const g of j.data || []) {
      const h = g.home_team && g.home_team.name, a = g.visitor_team && g.visitor_team.name;
      if (!h || !a) continue;
      const iso = g.datetime || (/^\d{4}-\d\d-\d\dT/.test(g.status || "") ? g.status : null);
      const x = iso ? paris(iso) : { d: String(g.date).slice(0, 10), t: "" };
      out.push({ d: x.d, t: x.t, l: "nba", ti: h + " - " + a, de: "NBA", ...(/final/i.test(g.status || "") && g.home_team_score != null ? { sc: g.home_team_score + "-" + g.visitor_team_score, fin: 1 } : {}) });
    }
    cursor = j.meta && j.meta.next_cursor;
    if (!cursor) break;
    await sleep(13000);
  }
  return dates ? Object.assign(out, { from: dates[0], to: dd(new Date(Date.parse(dates[dates.length - 1]) + 864e5)) }) : out;
}

async function nba() {
  const key = process.env.BALLDONTLIE_KEY;
  if (key) {
    try { return await nbaBdl(key, LIGHT ? Array.from({ length: 4 }, (_, i) => dd(new Date(Date.now() - i * 864e5))).reverse() : null); }
    catch (e) { console.error("balldontlie :", e.message); }
  }
  return nbaSite();
}

const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");

// Football, rugby, NFL, NHL et UFC via le service public d'ESPN (sans clé).
// Identifiants : soccer/fra.1 = Ligue 1, rugby/270559 = Top 14, football/nfl, hockey/nhl, mma/ufc, etc.
const TEAMS = {};
const SPORT = { soccer: "foot", rugby: "rugby", football: "usfoot", hockey: "hockey", mma: "mma" };
const hex = v => (v && /^[0-9a-f]{6}$/i.test(v) ? "#" + v : null);
const rec = (x, k) => {
  const t = x.team;
  if (TEAMS[k]) return;
  const logo = t.logo || (t.logos && t.logos[0] && t.logos[0].href) || null;
  if (logo || t.color) TEAMS[k] = { logo, color: hex(t.color), alt: hex(t.alternateColor) };
};
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
  if (LIGHT && win) return Object.assign([], { skip: true });
  const start = win ? win[0] : new Date(+now - BACK * 864e5);
  const end = win ? win[1] : LIGHT ? new Date(+now + 864e5) : new Date(Date.UTC(now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0), 5, 30));
  const days = +process.env.ESPN_DAYS || 120;
  const sv = x => (x.score && typeof x.score === "object" ? (x.score.displayValue != null ? x.score.displayValue : x.score.value) : x.score);
  for (let a = new Date(start); a < end; a.setDate(a.getDate() + 14)) {
    if (!win && rangeBroken[sport] && +a > +now + days * 864e5) break;
    const b = new Date(Math.min(+a + 13 * 864e5, +end));
    for (const e of await espnWindow(sport, slug, new Date(a), b)) {
      if (!e.date) continue;
      const c = e.competitions && e.competitions[0], cs = (c && c.competitors) || [];
      const { d, t } = paris(e.date);
      const venue = (c && c.venue && c.venue.fullName) || label;
      const st = e.status && e.status.type, done = !!(st && (st.completed || st.state === "post")) && !/postpon|cancel|suspend|forfeit/i.test((st.name || "") + (st.description || ""));
      if (sport === "mma") {
        let sc = null;
        if (done) {
          const cp = (e.competitions || []).slice(-1)[0] || {}, cc = cp.competitors || [], w = cc.find(x => x.winner), lo = cc.find(x => !x.winner);
          const nmx = x => x && ((x.athlete && x.athlete.displayName) || (x.team && x.team.displayName));
          if (w && nmx(w)) sc = nmx(w) + (lo && nmx(lo) ? " bat " + nmx(lo) : " gagne");
        }
        seen.set(e.id || e.date, { d, t, l, ti: e.name || e.shortName || label, de: venue, ...(sc ? { sc, fin: 1 } : {}) });
        continue;
      }
      const h = cs.find(x => x.homeAway === "home") || cs[0], v = cs.find(x => x.homeAway === "away") || cs[1];
      if (!h || !v || !h.team || !v.team) continue;
      const nm = x => x.team.shortDisplayName || x.team.displayName;
      rec(h, SPORT[sport] + "|" + nm(h)); rec(v, SPORT[sport] + "|" + nm(v));
      const hs = sv(h), vs = sv(v);
      seen.set(e.id || e.date + nm(h), { d, t, l, ti: nm(h) + " - " + nm(v), de: venue, ...(done && hs != null && hs !== "" && vs != null && vs !== "" ? { sc: hs + "-" + vs, fin: 1 } : {}) });
    }
  }
  return Object.assign([...seen.values()], { from: dd(start), to: LIGHT || win ? dd(new Date(+end + 864e5)) : "9999-12-31" });
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
      const hs = pick(x, "local.score", "homeScore", "home.score"), as = pick(x, "road.score", "awayScore", "away.score");
      const played = pick(x, "played") === true || (hs != null && as != null && +hs + +as > 0 && Date.parse(d + "T" + (t || "23:59") + ":00Z") < Date.now() - 2 * 36e5);
      out.push({ d, t, l: "euro", ti: h + " - " + a, de: [pick(x, "venue.name", "arena.name"), rd ? "Journée " + rd : null].filter(Boolean).join(", ") || "Euroligue", ...(played && hs != null && as != null ? { sc: hs + "-" + as, fin: 1 } : {}) });
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
  const season = String(y % 100).padStart(2, "0") + String((y + 1) % 100).padStart(2, "0"), today = now.toISOString().slice(0, 10), since = dd(new Date(+now - (!LIGHT && !OLD.some(e => ["bwc", "bch", "beu"].includes(e.l) && e.sc) ? 100 : BACK) * 864e5)), out = [], bad = [];
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
      if (ev.EndDate && String(ev.EndDate).slice(0, 10) < since) continue;
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
        let res = null;
        const started = d < today || (d === today && t && t < paris(now.toISOString()).t);
        if (c.RaceId && started && (!LIGHT || d >= dd(new Date(+now - 4 * 864e5)))) {
          try {
            const rj = await get(`${base}Results?RaceId=${c.RaceId}`);
            const rk = x => String(x.Rank != null && x.Rank !== "" ? x.Rank : x.ResultOrder);
            const rows = (Array.isArray(rj) ? rj : rj.Results || rj.data || []).filter(x => /^\d+$/.test(rk(x))).sort((p, q) => +rk(p) - +rk(q)).slice(0, 3);
            const team = /relay/i.test(c.Description || "");
            if (rows.length < 3) warn1("biathlon", "réponse inattendue : " + JSON.stringify(rj).slice(0, 300));
            if (rows.length === 3) res = rows.map(x => rk(x) + ". " + (team ? (x.Nat || x.ShortName || x.Name) : (x.ShortName || x.FamilyName || x.Name))).join(" · ");
          } catch (e) { warn1("biathlon", e.message.slice(0, 250)); }
          await sleep(120);
        }
        out.push({ d, t, l, ti: place + " : " + frRace(c.Description || c.ShortDescription), de: ev.Description || place, ...(res ? { sc: res, fin: 1 } : {}) });
      }
      await sleep(150);
    }
  }
  if (!out.length) throw new Error("aucune course lisible, exemple : " + (bad[0] || "aucun"));
  return out;
}

// ---------- MotoGP : interface publique du site officiel (heures avec décalage, converties en heure de Paris) ----------
async function motogp() {
  let asked = 0, read = 0;
  const base = "https://api.motogp.pulselive.com/motogp/v1/results/", now = new Date(), y = now.getUTCFullYear(), today = now.toISOString().slice(0, 10), since = dd(new Date(+now - (!LIGHT && !OLD.some(e => e.l === "moto" && e.sc) ? 100 : BACK) * 864e5)), out = [];
  const arr = j => (Array.isArray(j) ? j : (j && (j.data || j.results || j.items)) || []);
  for (const s of arr(await get(base + "seasons")).filter(x => [y, y + 1].includes(+x.year))) {
    for (const e of arr(await get(`${base}events?seasonUuid=${s.id}`))) {
      if (e.test) continue;
      const end = String(e.date_end || e.dateEnd || "").slice(0, 10);
      if (end && end < since) continue;
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
        let res = null;
        const started = d < today || (d === today && t && t < paris(now.toISOString()).t);
        if (x.id && started && /^(Course|Sprint|Qualifications 2)$/.test(lab) && (!LIGHT || d >= dd(new Date(+now - 4 * 864e5)))) {
          try {
            asked++;
            const cj = await get(`${base}session/${x.id}/classification?seasonYear=${s.year}&test=false`), rows = (Array.isArray(cj) ? cj : cj.classification || cj.data || []).slice(0, 3);
            if (rows.length < 3) warn1("moto", "réponse inattendue : " + JSON.stringify(cj).slice(0, 300));
            const tc = w => (w.length > 3 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w);
            const nmr = r => { const ri = r.rider || {}, fn = String(ri.full_name || r.name || ""), m = fn.match(/(?:^|\s)([A-ZÀ-ÝÑ'’-]{2,}(?:\s+[A-ZÀ-ÝÑ'’-]{2,})*)$/); return ri.surname ? tc(ri.surname) : m ? m[1].split(/\s+/).map(tc).join(" ") : fn.split(" ").slice(-1)[0] || "?"; };
            if (rows.length === 3) read++;
            if (rows.length === 3) res = (lab === "Qualifications 2" ? "Pole : " : "1. ") + nmr(rows[0]) + " · 2. " + nmr(rows[1]) + " · 3. " + nmr(rows[2]);
          } catch (e) { warn1("moto", e.message.slice(0, 250)); }
          await sleep(120);
        }
        out.push({ d, t, l: "moto", ti: place + " : " + lab, de: (e.circuit && e.circuit.name) || e.sname || "MotoGP", ...(res ? { sc: res, fin: 1 } : {}) });
      }
      await sleep(150);
    }
  }
  console.log("moto : classements demandés", asked, "| lus", read);
  return out;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  OLD = data.events;
  BACK = LIGHT || data.backfilled ? 3 : 100;
  console.log("Mode :", LIGHT ? "résultats récents" : "calendriers complets", "| jours passés relus :", BACK);
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
  const key = e => [e.l, e.d, e.t, e.ti].join("|"), carry = new Map();
  for (const e of events) if (e.sc) carry.set(key(e), e);
  for (const [l, fn, ls = [l]] of sources) {
    try {
      let fresh = await fn();
      if (fresh.skip) { console.log(l, "ignoré en mode résultats"); continue; }
      if (!fresh.length) { if (LIGHT) { console.log(l, "rien de nouveau"); continue; } throw new Error("aucun événement reçu"); }
      const from = fresh.from || fresh.reduce((m, e) => (e.d < m ? e.d : m), "9999-12-31"), to = fresh.to || "9999-12-31";
      fresh = fresh.filter(e => e.d >= from && e.d <= to);
      fresh.forEach(e => { if (!e.sc) { const o = carry.get(key(e)); if (o) { e.sc = o.sc; e.fin = o.fin; } } });
      events = events.filter(e => !(ls.includes(e.l) && e.d >= from && e.d <= to)).concat(fresh);
      fresh.forEach(e => real.add(e.l));
      console.log(l, "OK :", fresh.length, "événements, dont", fresh.filter(e => e.sc).length, "avec résultat");
    } catch (e) {
      fails++;
      console.error(l, "ÉCHEC, anciennes données conservées :", e.message);
    }
  }
  const cmp = (a, b) => (a.d + a.t + a.l + a.ti).localeCompare(b.d + b.t + b.l + b.ti);
  const body = o => '"backfilled":' + (o.backfilled ? "true" : "false") + ',"real":' + JSON.stringify(o.real) + ',"teams":' + JSON.stringify(o.teams) + ',"events":[\n' + o.events.map(e => JSON.stringify(e)).join(",\n") + "\n]}";
  const avant = body({ backfilled: !!data.backfilled, real: data.real || [], teams: data.teams || {}, events: [...data.events].sort(cmp) });
  const apres = body({ backfilled: LIGHT ? !!data.backfilled : true, real: [...real], teams: Object.assign({}, data.teams || {}, TEAMS), events: [...events].sort(cmp) });
  if (apres === avant) console.log("Aucun changement : data.json reste inchangé");
  else fs.writeFileSync(FILE, '{"updatedAt":"' + new Date().toISOString() + '",' + apres);
  if (fails === sources.length) process.exitCode = 1;
}
main();

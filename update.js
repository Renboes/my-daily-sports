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

const FR = [["singapore","de Singapour"],["united states","des États-Unis"],["mexic","du Mexique"],
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
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
  return r.json();
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

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  let events = data.events, fails = 0;
  for (const [l, fn] of [["f1", f1], ["nba", nba]]) {
    try {
      const fresh = await fn();
      if (!fresh.length) throw new Error("aucun événement reçu");
      events = events.filter(e => e.l !== l).concat(fresh);
      console.log(l, "OK :", fresh.length, "événements");
    } catch (e) {
      fails++;
      console.error(l, "ÉCHEC, anciennes données conservées :", e.message);
    }
  }
  events.sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t));
  fs.writeFileSync(FILE, '{"updatedAt":"' + new Date().toISOString() + '","events":[\n' +
    events.map(e => JSON.stringify(e)).join(",\n") + "\n]}");
  if (fails === 2) process.exitCode = 1;
}
main();

// Relais « direct » : lit les scores en cours chez ESPN et les renvoie à l'application.
// Déployé automatiquement par Cloudflare Pages (dossier functions). Réponse gardée 20 secondes en mémoire.
const MAP = {
  l1: ["soccer", "fra.1"], l2: ["soccer", "fra.2"], ldn: ["soccer", "uefa.nations"], ucl: ["soccer", "uefa.champions"], uel: ["soccer", "uefa.europa"],
  pl: ["soccer", "eng.1"], liga: ["soccer", "esp.1"], sa: ["soccer", "ita.1"], bl: ["soccer", "ger.1"],
  rt14: ["rugby", "270559"], rec: ["rugby", "271937"], r6n: ["rugby", "180659"],
  nba: ["basketball", "nba"], nfl: ["football", "nfl"], nhl: ["hockey", "nhl"]
};
const json = (o, ttl) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=" + (ttl || 0), "Access-Control-Allow-Origin": "*" } });
const sv = x => (x && x.score && typeof x.score === "object" ? (x.score.displayValue != null ? x.score.displayValue : x.score.value) : x && x.score);

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const ls = [...new Set((url.searchParams.get("l") || "").split(",").filter(k => MAP[k]))].slice(0, 10);
  if (!ls.length) return json({ t: Date.now(), ev: [] }, 20);
  const cache = caches.default, key = new Request(url.origin + "/api/live?l=" + [...ls].sort().join(","));
  const hit = await cache.match(key);
  if (hit) return hit;
  const days = [0, 1].map(n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10).replace(/-/g, ""));
  const seen = new Map();
  await Promise.all(ls.flatMap(l => days.map(async d => {
    try {
      const u = "https://site.api.espn.com/apis/site/v2/sports/" + MAP[l][0] + "/" + MAP[l][1] + "/scoreboard?dates=" + d;
      const r = await fetch(u, { cf: { cacheTtl: 15, cacheEverything: true } });
      if (!r.ok) return;
      const j = await r.json();
      for (const e of j.events || []) {
        const st = e.status && e.status.type, state = st && st.state;
        if (state !== "in" && state !== "post") continue;
        if (/postpon|cancel|suspend|forfeit/i.test((st.name || "") + (st.description || ""))) continue;
        const c = e.competitions && e.competitions[0], cs = (c && c.competitors) || [];
        const h = cs.find(x => x.homeAway === "home") || cs[0], v = cs.find(x => x.homeAway === "away") || cs[1];
        if (!h || !v || !h.team || !v.team) continue;
        const nm = x => x.team.shortDisplayName || x.team.displayName;
        const hs = sv(h), as = sv(v);
        if (hs == null || as == null) continue;
        seen.set(l + "|" + e.id, { l, d: e.date, h: nm(h), a: nm(v), hs: +hs, as: +as, s: state, c: st.shortDetail || (e.status && e.status.displayClock) || "" });
      }
    } catch (err) { /* une source indisponible n'empêche pas les autres */ }
  })));
  const res = json({ t: Date.now(), ev: [...seen.values()] }, 20);
  await cache.put(key, res.clone());
  return res;
}

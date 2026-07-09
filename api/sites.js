// api/sites.js — DATA + TRANSFORM LAYER
// The Airtable schema is coupled here and ONLY here. index.html consumes the
// normalized shape returned below and never sees raw Airtable records.
// To rename an Airtable field, change the F map. Nothing else.

const F = {
  name:    "Project Name",
  city:    "City, State",           // array field: [city, stateAbbr]
  coords:  "Coordinates",           // rich text "[lat, lng](maps url)"
  grossMW: "Total Gross MW",
  itMW:    "Total IT Capacity",
  acres:   "Acres",
  type:    "Project Type",
  status:  "Status",
  bucket:  "Capacity Bucket",
  lead:    "Project Lead",
  source:  "Project Source",
  zoning:  "Zoning",
  county:  "County",
  address: "Address",
  utility: "Utility",
  power:   "Power Status",
  notes:   "State of Play",
  box:     "Box Link",
  cda:     "Commercial Development Analysis",
  pg:      "PG Analysis",
  mw: { "2026": "MW Gross 2026", "2027": "MW Gross 2027", "2028": "MW Gross 2028",
        "2029": "MW Gross 2029", "2030+": "MW Gross 2030+" },
  // ── Optional executive-signal fields ─────────────────────────────────────
  // Absent fields read as null; the dashboard degrades gracefully. Add these
  // columns in Airtable to activate the Attention strip tiles:
  nextGate:   "Next Gate",        // single line text, e.g. "2nd reading — moratorium"
  gateDate:   "Gate Date",        // date
  capital:    "Capital Exposed",  // currency/number, $ at risk (deposits, collateral)
  lastTouch:  "Last Updated",     // "Last modified time" field type
  // ── Community sentiment fields ───────────────────────────────────────────
  sentimentStatus:      "Sentiment Status",              // single select: Opposed/Restricted/Mixed/Supportive/Unknown
  sentimentSummary:     "Sentiment Summary",              // plain text
  sentimentSources:     "Sentiment Sources",              // plain text; one bare URL per line, optionally "url (label)"
  sentimentChanged:     "Sentiment Changed This Week",     // checkbox: sentiment shifted this week
  sentimentLastChecked: "Sentiment Last Checked",          // date
};

// NOTE: we intentionally do NOT pass fields[] to Airtable. Airtable 422s on
// unknown field names, which would make the optional fields above break the
// whole fetch until they exist. Server→browser payload is slimmed by
// normalization below, which is where it matters.

const STATE_NAMES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};

const sel = v => (v == null ? null : (typeof v === "object" && !Array.isArray(v) ? v.name ?? null : v));
// Formula fields can return numeric strings; Acres is singleLineText ("~73", "±74 ac") —
// pull the first numeric token instead of trusting parseFloat's prefix-only behavior.
const numOrNull = v => {
  if (v == null || typeof v === "object") return null; // formula error objects -> null
  const m = String(v).match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const oneLine = s => String(s || "").replace(/\s*\n\s*/g, " ").trim();

function mdLink(s) {
  if (!s) return null;
  const m = String(s).match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  return m ? { label: m[1], url: m[2] } : null;
}

// Sentiment Sources holds one citation per line, either "[label](url)" markdown
// or (the actual convention in use) a bare URL with an optional trailing
// "(label)", e.g. "https://example.com/article (Jan 29 2026)".
function sourceLinks(s) {
  if (!s) return [];
  const raw = String(s);
  const out = [];
  const mdRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let m;
  while ((m = mdRe.exec(raw))) out.push({ label: m[1], url: m[2] });
  // Drop already-captured markdown citations before scanning for bare URLs,
  // so a URL inside "[label](url)" isn't also picked up by the bare pass.
  const rest = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '');
  const bareRe = /(https?:\/\/\S+?)(?:\s*\(([^)]+)\))?(?=\s|$)/g;
  while ((m = bareRe.exec(rest))) out.push({ label: m[2] || m[1], url: m[1] });
  return out;
}

// "Coordinates" is rich text; extract lat/lng, auto-repair swapped order,
// and reject values outside the US envelope so bad data can't silently drop
// a pin into the ocean.
function parseCoords(raw) {
  if (!raw) return { lat: null, lng: null, invalid: false };
  const m = String(raw).match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!m) return { lat: null, lng: null, invalid: true };
  let lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (lat < 0 && lng > 0) [lat, lng] = [lng, lat]; // swapped-order repair (US: lat>0, lng<0)
  const ok = lat >= 17 && lat <= 72 && lng >= -180 && lng <= -60;
  return ok ? { lat, lng, invalid: false } : { lat: null, lng: null, invalid: true };
}

function normalize(rec) {
  const f = rec.fields || {};
  const cityArr = Array.isArray(f[F.city]) ? f[F.city].map(sel) : [];
  const cityName = cityArr[0] || null, stateAbbr = cityArr[1] || null;
  const c = parseCoords(f[F.coords]);
  const mwByYear = {};
  for (const [yr, field] of Object.entries(F.mw)) mwByYear[yr] = numOrNull(f[field]);
  const cda = mdLink(f[F.cda]), pg = mdLink(f[F.pg]);
  return {
    id: rec.id,                          // Airtable record id — the primary key everywhere client-side
    name: oneLine(f[F.name]),          // Project Name is multilineText in the base
    typ: sel(f[F.type]),
    status: sel(f[F.status]) || "Pre-qual",
    address: f[F.address] || null,
    cityState: cityName && stateAbbr ? `${cityName}, ${stateAbbr}` : cityName,
    stateName: STATE_NAMES[stateAbbr] || null,
    county: f[F.county] || null,
    lat: c.lat, lng: c.lng,
    coordsInvalid: c.invalid,            // present-but-unparseable ≠ absent; surfaced in Attention strip
    headlineMW: numOrNull(f[F.grossMW]),
    totalITMW: numOrNull(f[F.itMW]),
    acres: numOrNull(f[F.acres]),
    capacityBucket: sel(f[F.bucket]),
    lead: sel(f[F.lead]),
    source: sel(f[F.source]),
    zoning: sel(f[F.zoning]),
    mwByYear,
    links: {
      box: typeof f[F.box] === "string" && /^https?:\/\//.test(f[F.box]) ? f[F.box] : null,
      cda: cda && cda.url, pg: pg && pg.url,
    },
    // Markdown preserved verbatim — paragraphs, bullets, indents, bold all survive
    // to the client, which renders it with a sanitizing Markdown renderer.
    notesMd: (f[F.notes] || "").replace(/\r\n/g, "\n").trim() || null,
    power: sel(f[F.power]),
    utility: f[F.utility] || null,
    // optional exec-signal fields (null until the columns exist in Airtable)
    nextGate: sel(f[F.nextGate]) || null,
    gateDate: f[F.gateDate] || null,
    capital: numOrNull(f[F.capital]),
    lastTouch: f[F.lastTouch] || null,
    // optional community-sentiment fields (null until the columns exist in Airtable)
    sentimentStatus: sel(f[F.sentimentStatus]) || null,
    sentimentSummary: (f[F.sentimentSummary] || "").replace(/\r\n/g, "\n").trim() || null,
    sentimentSources: sourceLinks(f[F.sentimentSources]),
    sentimentChanged: !!f[F.sentimentChanged],
    sentimentLastChecked: f[F.sentimentLastChecked] || null,
  };
}

async function fetchPage(url, token, attempt = 0) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429 && attempt < 2) {           // Airtable rate limit: honor Retry-After once
    const wait = (parseInt(res.headers.get("Retry-After"), 10) || 1) * 1000;
    await new Promise(r => setTimeout(r, wait));
    return fetchPage(url, token, attempt + 1);
  }
  return res;
}

export default async function handler(req, res) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tableId = process.env.AIRTABLE_TABLE_ID;
    const token = process.env.AIRTABLE_TOKEN;
    if (!baseId || !tableId || !token) {
      return res.status(500).json({ error: "Missing Airtable environment variables" });
    }

    let records = [], offset = null, pages = 0;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${tableId}`);
      url.searchParams.set("pageSize", "100");
      if (offset) url.searchParams.set("offset", offset);
      const response = await fetchPage(url, token);
      if (!response.ok) {
        // Don't proxy Airtable's raw error body to the browser — it can include base/table ids.
        console.error("Airtable error", response.status, await response.text());
        return res.status(502).json({ error: `Upstream error (${response.status})` });
      }
      const data = await response.json();
      records = records.concat(data.records || []);
      offset = data.offset || null;
    } while (offset && ++pages < 30); // hard cap: 3,000 records; a runaway offset can't loop forever

    const sites = records.map(normalize).filter(s => s.name);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json({ fetchedAt: new Date().toISOString(), sites });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Internal error" });
  }
}

// Regenerates assets/stats.svg from live GitHub data.
//
//   node scripts/stats.mjs                       # needs GITHUB_TOKEN, hits the GraphQL API
//   STATS_JSON='{"repos":5,...}' node ...        # offline, renders from the given numbers
//
// Run by .github/workflows/stats.yml once a day. Delete both files to freeze the numbers.

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER = process.env.STATS_USER ?? "reshax123";
const OUT = "assets/stats.svg";

/* ---------------------------------------------------------------- data ---- */

async function graphql(query, variables, token) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": `${USER}-profile-stats`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

async function collect() {
  if (process.env.STATS_JSON) return JSON.parse(process.env.STATS_JSON);

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required (or pass STATS_JSON)");

  const head = await graphql(
    `query ($login: String!) {
       user(login: $login) {
         createdAt
         all: repositories(privacy: PUBLIC, ownerAffiliations: OWNER) { totalCount }
         forks: repositories(privacy: PUBLIC, ownerAffiliations: OWNER, isFork: true) { totalCount }
       }
     }`,
    { login: USER },
    token,
  );

  const repos = head.user.all.totalCount;
  const forks = head.user.forks.totalCount;
  const firstYear = new Date(head.user.createdAt).getUTCFullYear();
  const thisYear = new Date().getUTCFullYear();

  // contributionsCollection spans at most one year, so walk year by year.
  let contributions = 0;
  for (let year = firstYear; year <= thisYear; year++) {
    const data = await graphql(
      `query ($login: String!, $from: DateTime!, $to: DateTime!) {
         user(login: $login) {
           contributionsCollection(from: $from, to: $to) {
             contributionCalendar { totalContributions }
           }
         }
       }`,
      { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
      token,
    );
    contributions += data.user.contributionsCollection.contributionCalendar.totalContributions;
  }

  return {
    repos,
    contributions,
    forks,
    updated: new Date().toISOString().slice(0, 10),
  };
}

/* --------------------------------------------------------------- render ---- */

// Values an odometer passes through on its way to `target`, eased so it slows
// down as it arrives. Duplicates are collapsed, so small targets just count up.
function rollSteps(target, frames = 12) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    const eased = 1 - Math.pow(1 - t, 4);
    const value = Math.round(target * eased);
    if (out[out.length - 1] !== value) out.push(value);
  }
  if (out[0] !== 0) out.unshift(0);
  if (out[out.length - 1] !== target) out.push(target);
  return out;
}

// The profile README column is only ~830px wide, so everything here is sized
// to survive being scaled down to ~69%.
const STACK = 76; // vertical gap between stacked odometer digits

function cell(cx, index, value, label) {
  const steps = rollSteps(value);
  const digits = steps
    .map(
      (n, i) =>
        `      <text x="${cx}" y="${90 + i * STACK}" class="num">${n.toLocaleString("en-US")}</text>`,
    )
    .join("\n");
  const frames = steps.map((_, i) => `0 ${-i * STACK}`).join("; ");

  return `    <g clip-path="url(#clip${index})">
      <g>
${digits}
        <animateTransform attributeName="transform" type="translate"
          values="${frames}" calcMode="discrete"
          dur="${(steps.length * 0.1).toFixed(2)}s" repeatCount="1" fill="freeze"/>
      </g>
    </g>
    <text x="${cx}" y="124" class="lbl">${label}</text>
    <path d="M${cx - 84} 146 H${cx + 84}" stroke="#E8A33D" stroke-opacity="0.16" stroke-width="1.4"/>
    <path d="M${cx - 84} 146 H${cx + 84}" stroke="#F2E6CC" stroke-opacity="0.8" stroke-width="1.4"
          stroke-dasharray="44 124">
      <animate attributeName="stroke-dashoffset" values="168;0" dur="5s"
        begin="${(index * 1.6).toFixed(1)}s" repeatCount="indefinite"/>
    </path>`;
}

function render({ repos, contributions, forks, updated }) {
  const cells = [
    cell(200, 0, repos, "PUBLIC REPOS"),
    cell(600, 1, contributions, "CONTRIBUTIONS"),
    cell(1000, 2, forks, "FORKS MAINTAINED"),
  ].join("\n\n");

  const clips = [200, 600, 1000]
    .map(
      (cx, i) =>
        `    <clipPath id="clip${i}"><rect x="${cx - 170}" y="42" width="340" height="66"/></clipPath>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="170" viewBox="0 0 1200 170" role="img" aria-label="${repos} public repos, ${contributions} contributions, ${forks} forks maintained">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="170" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#101410"/>
      <stop offset="1" stop-color="#080A07"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="48" x2="0" y2="104" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FBF7EE"/>
      <stop offset="0.52" stop-color="#E6DCC4"/>
      <stop offset="1" stop-color="#E8A33D"/>
    </linearGradient>
${clips}
    <style><![CDATA[
      .num { font-family: ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto, sans-serif;
             font-size: 58px; font-weight: 600; letter-spacing: -1.2px;
             text-anchor: middle; fill: url(#metal); }
      .lbl { font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, monospace;
             font-size: 15px; letter-spacing: 2.6px; text-anchor: middle; fill: #7A837B; }
      .stamp { font-family: ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Menlo, monospace;
               font-size: 12px; letter-spacing: 1px; text-anchor: end; fill: #5A6156; }
    ]]></style>
  </defs>

  <rect width="1200" height="170" rx="14" fill="url(#panel)"/>
  <rect width="1200" height="170" rx="14" fill="none" stroke="#FFFFFF" stroke-opacity="0.06"/>
  <path d="M400 40 V130 M800 40 V130" stroke="#FFFFFF" stroke-opacity="0.07" stroke-width="1"/>

  <g>
${cells}
  </g>

  <text x="1170" y="161" class="stamp">updated ${updated}</text>
</svg>
`;
}

/* ----------------------------------------------------------------- main ---- */

const stats = await collect();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, render(stats), "utf8");

// The README carries the same numbers in the stats image's alt text, which is
// what a screen reader announces. Keep it in step so the two never disagree.
const summary = `${stats.repos} public repos · ${stats.contributions} contributions · ${stats.forks} forks maintained`;
const readme = "README.md";
const source = await readFile(readme, "utf8");
const synced = source.replace(
  /(<img src="assets\/stats\.svg" alt=")[^"]*(")/,
  `$1${summary}$2`,
);

if (synced !== source) await writeFile(readme, synced, "utf8");
console.log(`wrote ${OUT}`, stats);

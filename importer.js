// Lettura di un programma di allenamento da Excel.
// Formato atteso (come il file del trainer): un foglio per giorno, con le colonne
// ESERCIZIO | SERIE | REPS PRESCRITTE | RECUPERO | SETT 1 - PESO | SETT 1 - REPS | SETT 2 - PESO | ...

// Primo numero contenuto in un testo ("47,3kg" -> 47.3). null se non ce ne sono.
export function toNum(s) {
  const m = String(s ?? "").match(/\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(",", ".")) : null;
}

// Ripetizioni obiettivo di una serie: "4/6" -> 6, "10" -> 10, "8 (3" ISO)" -> 8
export function repsTarget(label) {
  const m = String(label ?? "").match(/^\s*(\d+)(?:\s*\/\s*(\d+))?/);
  if (!m) return 0;
  return parseInt(m[2] || m[1], 10);
}

// Divide valori doppi dei superset: "41kg+36kg", "12+8", "45kgX41kg"
const splitParts = (s) => String(s ?? "").split(/\+|x(?=\s*\d)/i);

const parseRest = (s) => {
  const n = toNum(s);
  return n && n >= 10 ? Math.round(n) : null;
};

const cap = (s) => {
  const t = String(s).trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

// Nome leggibile per un nuovo esercizio: toglie le parentesi e le maiuscole
export function niceName(raw) {
  return cap(String(raw).split("(")[0].replace(/\s+/g, " "));
}

// Collegamento nome del file -> esercizio della libreria (dal più specifico al più generico)
const ALIASES = [
  [/distensioni manubri.*inclinat/i, "Panca inclinata con manubri"],
  [/distensioni bilanciere.*panca piana|panca piana.*bilanciere/i, "Panca piana con bilanciere"],
  [/distensioni manubri|panca piana.*manubri|supine press/i, "Panca piana con manubri"],
  [/lat machine/i, "Lat machine"],
  [/chest press/i, "Chest press (macchina)"],
  [/low row/i, "Low row monolaterale (macchina)"],
  [/leg press/i, "Leg press"],
  [/curl.*cavo/i, "Curl al cavo basso"],
  [/h(a|u)mmer curl|curl a martello/i, "Curl a martello"],
  [/leg extension/i, "Leg extension"],
  [/hack squat/i, "Hack squat"],
  [/leg curl.*(prona|sdraiat)/i, "Leg curl sdraiato"],
  [/leg curl/i, "Leg curl"],
  [/shoulder press|lento avanti/i, "Shoulder press (macchina)"],
  [/alzate laterali.*cavo/i, "Alzate laterali al cavo basso"],
  [/alzate laterali/i, "Alzate laterali"],
  [/calf/i, "Calf raise in piedi"],
  [/pulley/i, "Pulley basso"],
  [/pec fly/i, "Pec fly (macchina)"],
  [/piegament|push.?up|flession/i, "Push-up (flessioni)"],
  [/push ?down|pushdown/i, "Pushdown ai cavi"],
  [/spider curl/i, "Spider curl"],
  [/curl.*asta ez/i, "Curl con bilanciere"],
  [/french press/i, "French press con bilanciere EZ"],
];

const tokens = (x) =>
  String(x)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

export function matchExercise(raw, exercises) {
  for (const [re, name] of ALIASES) {
    if (re.test(raw)) {
      const ex = exercises.find((e) => e.name === name);
      if (ex) return ex.id;
    }
  }
  // Se non c'è un collegamento noto: somiglianza tra le parole del nome
  const t = new Set(tokens(raw));
  let best = null, bestScore = 0;
  for (const e of exercises) {
    const et = tokens(e.name);
    if (!et.length) continue;
    const score = et.filter((w) => t.has(w)).length / et.length;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore >= 0.6 ? best.id : "";
}

export function parseWorkbook(XLSX, buf, exercises) {
  const wb = XLSX.read(buf, { type: "array" });
  const routines = [];

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const hi = rows.findIndex((r) => String(r[0]).trim().toUpperCase() === "ESERCIZIO");
    if (hi < 0) continue;

    const notes = [];
    const blocks = [];
    let cur = null;

    for (const row of rows.slice(hi + 1)) {
      const name = String(row[0]).replace(/\s+/g, " ").trim();
      const serieTxt = String(row[1]).trim();
      const isSet = /^\d+$/.test(serieTxt);

      if (name && !isSet) {
        // righe di solo testo (mobilità, cardio): diventano una nota della scheda
        if (serieTxt) notes.push(`${cap(name)}: ${serieTxt}`);
        cur = null;
        continue;
      }
      if (!name && !isSet) continue;
      if (name && isSet) {
        cur = { raw: name, rest: parseRest(row[3]), sets: [] };
        blocks.push(cur);
      }
      if (!cur) continue;
      if (!cur.rest) cur.rest = parseRest(row[3]);
      cur.sets.push({
        label: String(row[2]).trim(),
        cells: Array.from({ length: 9 }, (_, k) => [row[4 + 2 * k], row[5 + 2 * k]]),
      });
    }

    const items = [];
    for (const b of blocks) {
      // "PUSH DOWN FUNE+CURL ASTA EZ" -> due esercizi in superset
      const names = b.raw.includes("+") ? b.raw.split("+").map((s) => s.trim()).filter(Boolean) : [b.raw];
      const split = names.length > 1;
      names.forEach((nm, part) => {
        const labels = b.sets.map((s) => (split ? String(splitParts(s.label)[part] ?? "").trim() : s.label));
        const weeks = {};
        b.sets.forEach((s, si) =>
          s.cells.forEach(([w, r], k) => {
            const ws = String(w ?? "").trim();
            const rs = String(r ?? "").trim();
            if (!ws && !rs) return;
            const weight = toNum(split ? splitParts(ws)[part] : ws) ?? 0;
            let reps = toNum(split ? splitParts(rs)[part] : rs);
            if (!weight && reps == null) return; // "max" o celle senza numeri
            if (reps == null) reps = repsTarget(labels[si]) || 0;
            ((weeks[k + 1] ||= [])[si] = { weight, reps });
          })
        );
        items.push({
          raw: b.raw,
          name: nm,
          exId: matchExercise(nm, exercises),
          rest: b.rest || 90,
          sets: b.sets.length,
          labels,
          weeks,
        });
      });
    }
    if (!items.length) continue;

    const maxWeek = Math.max(0, ...items.flatMap((it) => Object.keys(it.weeks).map(Number)));
    routines.push({ name: cap(sheetName), notes: notes.join("\n"), startWeek: maxWeek + 1, items });
  }
  return routines;
}

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { repsTarget, parseWorkbook, niceName } from "./importer.js";

/* ------------------------------------------------------------------ */
/* Utilità                                                             */
/* ------------------------------------------------------------------ */
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => {
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const mmss = (sec) => {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtTime = (d) => new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const e1rm = (w, r) => (r > 0 ? w * (1 + r / 30) : 0); // formula di Epley
const kg = (w) => `${Math.round(w * 100) / 100}`;

const GROUPS = ["Petto", "Schiena", "Spalle", "Bicipiti", "Tricipiti", "Gambe", "Glutei", "Core", "Cardio", "Altro"];
const configured = SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("INCOLLA");
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const state = {
  user: null,
  tab: "home",
  view: null, // null | {name:"routine"|"workout"|"exercise", ...}
  exercises: [],
  programs: [],
  routines: [],
  workouts: [],
  sets: [],
  openWorkouts: new Set(),
  openWeeks: null, // settimane aperte nello storico (all'inizio: quella in corso)
  histLoaded: false,
  active: null,
  q: "",
  group: "",
  authMsg: null,
};

const app = $("#app");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2800);
}

const gSlug = (g) => String(g || "altro").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "") || "altro";
const gCls = (exId) => `g g-${gSlug(state.exercises.find((e) => e.id === exId)?.muscle_group)}`;
const exImg = (id) => state.exercises.find((e) => e.id === id)?.image_url || "";
const exName = (id) => state.exercises.find((e) => e.id === id)?.name ?? "Esercizio eliminato";
const activeKey = () => `gym.active.${state.user?.id}`;
const persistActive = () => {
  try {
    if (state.active) localStorage.setItem(activeKey(), JSON.stringify(state.active));
    else localStorage.removeItem(activeKey());
  } catch {}
};
const loadActive = () => {
  try {
    return JSON.parse(localStorage.getItem(activeKey()) || "null");
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/* Timer di recupero                                                   */
/* ------------------------------------------------------------------ */
let timerEnd = 0, timerTotal = 0, timerInt = null, audioCtx = null;

// Indici degli esercizi dell'allenamento che stanno nella stessa superserie
const grpOf = (ei) => {
  const ex = state.active.exercises, g = ex[ei].group;
  if (!g) return [ei];
  let a = ei, b = ei;
  while (a > 0 && ex[a - 1].group === g) a--;
  while (b < ex.length - 1 && ex[b + 1].group === g) b++;
  return Array.from({ length: b - a + 1 }, (_, k) => a + k);
};
// una superserie con un solo esercizio non ha senso: torna esercizio singolo
function cleanGroups(items) {
  const n = {};
  items.forEach((it) => it.superset_id && (n[it.superset_id] = (n[it.superset_id] || 0) + 1));
  items.forEach((it) => { if (it.superset_id && n[it.superset_id] < 2) it.superset_id = null; });
}

function startTimer(sec) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {}
  timerEnd = Date.now() + sec * 1000;
  timerTotal = sec;
  const el = $("#timer");
  el.innerHTML = `
    <div class="t-track"><div class="t-fill" id="t-fill"></div></div>
    <div class="t-row">
      <span class="t-label">Recupero</span>
      <strong class="t-time" id="t-time">${mmss(sec)}</strong>
      <button data-act="t-add" data-v="-15" aria-label="Togli 15 secondi">−15</button>
      <button data-act="t-add" data-v="15" aria-label="Aggiungi 15 secondi">+15</button>
      <button data-act="t-skip">Salta</button>
    </div>`;
  el.hidden = false;
  clearInterval(timerInt);
  timerInt = setInterval(tick, 250);
  tick();
}
function stopTimer() {
  clearInterval(timerInt);
  timerInt = null;
  $("#timer").hidden = true;
}
function tick() {
  const left = Math.ceil((timerEnd - Date.now()) / 1000);
  if (left <= 0) {
    stopTimer();
    beep();
    return;
  }
  const t = $("#t-time"), f = $("#t-fill");
  if (t) t.textContent = mmss(left);
  if (f) f.style.width = `${Math.min(100, (left / timerTotal) * 100)}%`;
}
function beep() {
  try {
    navigator.vibrate?.([250, 120, 250]);
  } catch {}
  try {
    if (!audioCtx) return;
    [0, 0.25].forEach((delay) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880;
      o.connect(g);
      g.connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + delay;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      o.start(t0);
      o.stop(t0 + 0.22);
    });
  } catch {}
}
document.addEventListener("visibilitychange", () => timerInt && tick());

/* ------------------------------------------------------------------ */
/* Dati                                                                */
/* ------------------------------------------------------------------ */
async function fetchAllRows(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function loadAll() {
  const [ex, ro, re, wk, pr] = await Promise.all([
    sb.from("exercises").select("*").order("name"),
    sb.from("routines").select("*").order("created_at"),
    fetchAllRows("routine_exercises"),
    fetchAllRows("routine_week_sets"),
    sb.from("programs").select("*").order("created_at"),
  ]);
  if (ex.error || ro.error || pr.error) throw ex.error || ro.error || pr.error;
  // carichi per settimana: weeks[settimana][numero serie - 1] = {weight, reps}
  const byItem = {};
  wk.forEach((s) => {
    const w = ((byItem[s.routine_exercise_id] ||= {})[s.week] ||= []);
    w[s.set_number - 1] = { weight: Number(s.weight), reps: s.reps };
  });
  state.exercises = ex.data;
  state.programs = pr.data;
  state.routines = ro.data.map((r) => ({
    ...r,
    items: re
      .filter((i) => i.routine_id === r.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ ...i, weeks: byItem[i.id] || {} })),
  }));
}

// Ultimi allenamenti, bastano giorno e data: servono a capire cosa tocca oggi
async function loadLast() {
  const { data } = await sb.from("workouts").select("routine_id,started_at").order("started_at", { ascending: false }).limit(40);
  state.lastRuns = data || [];
}

async function loadHistory() {
  const [w, s] = await Promise.all([
    sb.from("workouts").select("*").order("started_at", { ascending: false }).limit(100),
    sb.from("workout_sets").select("*").order("set_number").limit(5000),
  ]);
  if (w.error || s.error) throw w.error || s.error;
  state.workouts = w.data;
  state.sets = s.data;
  state.histLoaded = true;
}

async function saveRoutine(r) {
  const uid = state.user.id;
  let id = r.id;
  if (id) {
    const u = await sb.from("routines").update({ name: r.name, icon: r.icon ?? null }).eq("id", id);
    if (u.error) throw u.error;
    const before = state.routines.find((x) => x.id === id)?.items.map((i) => i.id) ?? [];
    const keep = r.items.filter((i) => i.id).map((i) => i.id);
    const remove = before.filter((x) => !keep.includes(x));
    if (remove.length) {
      const d = await sb.from("routine_exercises").delete().in("id", remove);
      if (d.error) throw d.error;
    }
  } else {
    const { data, error } = await sb.from("routines").insert({ name: r.name, user_id: uid, program_id: r.program_id, icon: r.icon ?? null }).select().single();
    if (error) throw error;
    id = data.id;
  }
  const row = (it, i) => ({
    routine_id: id,
    user_id: uid,
    exercise_id: it.exercise_id,
    position: i,
    target_sets: it.target_sets,
    target_reps: it.target_reps,
    rest_seconds: it.rest_seconds,
    rep_targets: it.rep_targets ?? null,
    notes: it.notes ?? null,
    superset_id: it.superset_id ?? null,
  });
  const existing = r.items.map((it, i) => ({ it, i })).filter((x) => x.it.id);
  const added = r.items.map((it, i) => ({ it, i })).filter((x) => !x.it.id);
  if (existing.length) {
    const { error } = await sb.from("routine_exercises").upsert(existing.map((x) => ({ id: x.it.id, ...row(x.it, x.i) })));
    if (error) throw error;
  }
  if (added.length) {
    const { error } = await sb.from("routine_exercises").insert(added.map((x) => row(x.it, x.i)));
    if (error) throw error;
  }
}

// Ultimi valori usati per ciascun esercizio, per precompilare le serie
async function fetchPrev(exerciseIds) {
  const prev = {};
  if (!exerciseIds.length) return prev;
  const { data } = await sb
    .from("workout_sets")
    .select("exercise_id,workout_id,set_number,weight,reps,created_at")
    .in("exercise_id", exerciseIds)
    .order("created_at", { ascending: false })
    .limit(400);
  const lastWorkout = {};
  (data || []).forEach((s) => {
    if (!(s.exercise_id in lastWorkout)) lastWorkout[s.exercise_id] = s.workout_id;
    if (lastWorkout[s.exercise_id] === s.workout_id) (prev[s.exercise_id] ||= []).push(s);
  });
  Object.values(prev).forEach((arr) => arr.sort((a, b) => a.set_number - b.set_number));
  return prev;
}

/* ------------------------------------------------------------------ */
/* Allenamento                                                         */
/* ------------------------------------------------------------------ */
function applyPrev(ex, prevSets) {
  ex.prev = (prevSets || []).map((p) => ({ weight: p.weight, reps: p.reps }));
  ex.prevLabel = "Ultima volta";
  ex.sets.forEach((s, i) => {
    const p = ex.prev[i] || ex.prev[ex.prev.length - 1];
    if (p && !s.done && s.weight === "") s.weight = p.weight ? String(p.weight) : "";
  });
}

async function startWorkout(routineId) {
  const r = routineId ? state.routines.find((x) => x.id === routineId) : null;
  const week = r ? r.current_week : null;
  const exs = (r ? r.items : []).map((it) => {
    const targets = it.rep_targets ? it.rep_targets.split("|").map((s) => s.trim()) : [];
    const cur = it.weeks?.[week];
    const earlier = Object.keys(it.weeks || {}).map(Number).filter((w) => w < week).sort((a, b) => b - a)[0];
    const base = cur || (earlier ? it.weeks[earlier] : null);
    const n = Math.max(it.target_sets, cur?.length || 0);
    const sets = Array.from({ length: n }, (_, i) => {
      const b = base?.[i] ?? base?.[base.length - 1];
      const target = repsTarget(targets[i] ?? targets[targets.length - 1]) || it.target_reps;
      return { weight: b && b.weight ? String(b.weight) : "", reps: String(cur?.[i]?.reps || target), done: false };
    });
    return {
      exercise_id: it.exercise_id,
      reId: it.id,
      group: it.superset_id || null,
      rest: it.rest_seconds,
      targets,
      note: it.notes || "",
      memo: it.memo || "",
      prevLabel: earlier ? `Settimana ${earlier}` : "",
      prev: earlier ? it.weeks[earlier].filter(Boolean).map((p) => ({ weight: p.weight, reps: p.reps })) : [],
      sets,
    };
  });
  state.active = {
    name: r ? r.name : "Allenamento libero",
    routineId: r?.id ?? null,
    week,
    notes: r?.notes || "",
    startedAt: Date.now(),
    exercises: exs,
  };
  try {
    // dove non ci sono dati di settimana, uso l'ultimo allenamento registrato
    const missing = exs.filter((e) => !e.prev.length);
    const prev = await fetchPrev(missing.map((e) => e.exercise_id));
    missing.forEach((e) => applyPrev(e, prev[e.exercise_id]));
  } catch {}
  persistActive();
  state.view = { name: "workout" };
  render();
}

async function addExerciseToWorkout(exerciseId) {
  const ex = { exercise_id: exerciseId, rest: 90, prev: [], sets: [{ weight: "", reps: "10", done: false }] };
  state.active.exercises.push(ex);
  try {
    const prev = await fetchPrev([exerciseId]);
    applyPrev(ex, prev[exerciseId]);
  } catch {}
  persistActive();
  render();
}

async function finishWorkout() {
  const a = state.active;
  const rows = [];
  a.exercises.forEach((e) =>
    e.sets.forEach((s, i) => {
      if (s.done && num(s.reps) > 0)
        rows.push({
          user_id: state.user.id,
          exercise_id: e.exercise_id,
          exercise_name: exName(e.exercise_id),
          set_number: i + 1,
          weight: num(s.weight),
          reps: Math.round(num(s.reps)),
          rest_seconds: e.rest,
        });
    })
  );
  if (!rows.length) return toast("Segna almeno una serie come completata");
  // se è stato fatto meno di metà, chiedo se conta come giorno fatto (la settimana avanza solo in quel caso)
  let counts = true;
  if (a.routineId && a.week) {
    const total = a.exercises.reduce((n, e) => n + e.sets.length, 0);
    if (total && rows.length / total < 0.5) {
      if (!confirm(`Hai completato solo ${rows.length} serie su ${total}.\n\nVuoi terminare e salvare comunque?\n(Annulla per tornare all'allenamento)`)) return;
      counts = confirm(`Conta come giorno fatto?\n\nOK: sì, la settimana di ${a.name} avanza.\nAnnulla: lo salvo solo nello storico e il giorno resta da fare.`);
    }
  }
  const { data: w, error } = await sb
    .from("workouts")
    .insert({
      user_id: state.user.id,
      routine_id: counts ? a.routineId : null,
      week: counts ? (a.week ?? null) : null,
      name: a.name,
      started_at: new Date(a.startedAt).toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return toast("Non sono riuscito a salvare. Controlla la connessione e riprova.");
  const ins = await sb.from("workout_sets").insert(rows.map((r) => ({ ...r, workout_id: w.id })));
  if (ins.error) {
    await sb.from("workouts").delete().eq("id", w.id);
    return toast("Non sono riuscito a salvare le serie. Riprova.");
  }

  // scheda a settimane: salvo i carichi della settimana e passo alla successiva
  let msg = counts ? "Allenamento salvato" : "Salvato nello storico: il giorno resta da fare";
  if (a.routineId && a.week && counts) {
    try {
      const wrows = [];
      a.exercises.forEach((e) => {
        if (!e.reId) return;
        e.sets.forEach((s, i) => {
          if (s.done && num(s.reps) > 0)
            wrows.push({ user_id: state.user.id, routine_exercise_id: e.reId, week: a.week, set_number: i + 1, weight: num(s.weight), reps: Math.round(num(s.reps)) });
        });
      });
      if (wrows.length) {
        const up = await sb.from("routine_week_sets").upsert(wrows, { onConflict: "routine_exercise_id,week,set_number" });
        if (up.error) throw up.error;
      }
      const r = state.routines.find((x) => x.id === a.routineId);
      if (r && r.current_week === a.week) {
        const u = await sb.from("routines").update({ current_week: a.week + 1 }).eq("id", r.id);
        if (u.error) throw u.error;
        msg = `Salvato. ${a.name}: ora sei alla settimana ${a.week + 1}`;
      }
      await loadAll();
    } catch (e) {
      console.error(e);
      msg = "Allenamento salvato, ma non sono riuscito ad aggiornare la settimana della scheda";
    }
  }

  state.active = null;
  persistActive();
  stopTimer();
  state.view = null;
  state.tab = "history";
  await loadHistory().catch(() => {});
  await loadLast().catch(() => {});
  toast(msg);
  render();
}

/* ------------------------------------------------------------------ */
/* Viste                                                               */
/* ------------------------------------------------------------------ */
function render() {
  if (!configured) {
    app.innerHTML = `<div class="auth"><h1>Configurazione mancante</h1>
      <p>Apri il file <b>config.js</b> e inserisci l'indirizzo e la chiave del tuo progetto Supabase. I passaggi sono nel file LEGGIMI.md.</p></div>`;
    return;
  }
  if (!state.user) return renderAuth();

  const v = state.view;
  let title, body, back = false;
  if (v?.name === "routine") { title = v.routine.id ? "Modifica giorno" : "Nuovo giorno"; body = routineHTML(); back = true; }
  else if (v?.name === "workout") { title = state.active.week ? `${state.active.name}, sett. ${state.active.week}` : state.active.name; body = workoutHTML(); back = true; }
  else if (v?.name === "exercise") { title = v.id ? "Esercizio" : "Nuovo esercizio"; body = exerciseHTML(); back = true; }
  else if (v?.name === "progress") { title = "Progressi"; body = progressHTML(); back = true; }
  else if (v?.name === "import") { title = "Importa da Excel"; body = importHTML(); back = true; }
  else if (v?.name === "program") { title = state.programs.find((x) => x.id === v.id)?.name ?? "Scheda"; body = programHTML(); back = true; }
  else if (v?.name === "day") { title = state.routines.find((x) => x.id === v.id)?.name ?? "Giorno"; body = dayHTML(); back = true; }
  else if (v?.name === "program-new") { title = "Nuova scheda"; body = programFormHTML(false); back = true; }
  else if (v?.name === "program-edit") { title = "Modifica scheda"; body = programFormHTML(true); back = true; }
  else if (v?.name === "xlsx") { title = "Esporta in Excel"; body = exportHTML(); back = true; }
  else {
    const t = {
      home: ["Allenamento", homeHTML],
      exercises: ["Esercizi", exercisesHTML],
      history: ["Storico", historyHTML],
      profile: ["Profilo", profileHTML],
    }[state.tab];
    title = t[0];
    body = t[1]();
  }
  const curTab = !v ? state.tab : ["exercise"].includes(v.name) ? "exercises" : "home";
  const ICONS = {
    home: '<svg viewBox="0 0 24 24"><path d="M3 9v6M6.5 6.5v11M17.5 6.5v11M21 9v6M6.5 12h11"/></svg>',
    exercises: '<svg viewBox="0 0 24 24"><path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.5 6.5h.01M3.5 12h.01M3.5 17.5h.01"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4.5v4h4M12 7.5V12l3 2"/></svg>',
    profile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.7-3.7 3.6-5.6 7.5-5.6s6.8 1.9 7.5 5.6"/></svg>',
  };
  const tabs = [["home", "Allenamento"], ["exercises", "Esercizi"], ["history", "Storico"], ["profile", "Profilo"]];
  app.innerHTML = `
    <header class="top">${back ? `<button class="back" data-act="back" aria-label="Indietro">‹</button>` : ""}<h1>${esc(title)}</h1></header>
    <main>${body}</main>
    <nav class="nav" aria-label="Sezioni">
      ${tabs.map(([k, l]) => `<button data-tab="${k}" ${curTab === k ? 'aria-current="page"' : ""}><span class="ic">${ICONS[k]}</span>${l}</button>`).join("")}
    </nav>`;
}

function renderAuth() {
  const m = state.authMsg;
  app.innerHTML = `
    <div class="auth">
      <img class="logo" src="icons/icon.svg" alt="" width="84" height="84">
      <h1 class="wm" aria-label="SpinGym">Sp<svg class="wm-i" viewBox="0 0 30 75" aria-hidden="true"><circle cx="15" cy="11" r="10" class="b"/><path d="M9.5 12C9.5 7 13 6 15 8.5 17 6 20.5 7 20.5 12c0 3-2.5 4.5-5.5 4.5S9.5 15 9.5 12Z" class="w"/><circle cx="12.6" cy="11.4" r="1.4" class="b"/><circle cx="17.4" cy="11.4" r="1.4" class="b"/><path d="M13.2 13.6h3.6L15 16.2Z" class="k"/><rect x="7.5" y="25" width="15" height="45" rx="7.5" class="b"/><ellipse cx="15" cy="50" rx="3.6" ry="14" class="w"/><ellipse cx="11" cy="72" rx="4.6" ry="2.4" class="k"/><ellipse cx="19" cy="72" rx="4.6" ry="2.4" class="k"/></svg>n<span class="g">Gym</span></h1>
      <p class="slogan">Spingiamo. Insieme.</p>
      <p>Le tue schede, i pesi, le ripetizioni e i recuperi. Accedi o crea un account per iniziare.</p>
      ${m ? `<div class="msg ${m.err ? "err" : ""}" role="alert">${esc(m.text)}</div>` : ""}
      <form id="auth-form" class="card">
        <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
        <label class="field">Password (minimo 6 caratteri)<input type="password" name="password" autocomplete="current-password" minlength="6" required></label>
        <button class="primary wide" type="submit" value="login">Accedi</button>
        <button class="ghost wide" type="submit" value="signup">Crea account</button>
      </form>
    </div>`;
}

function goBack() {
  const v = state.view;
  if (v?.name === "day") {
    const pid = state.routines.find((x) => x.id === v.id)?.program_id;
    state.view = pid ? { name: "program", id: pid } : null;
  } else if (v?.name === "progress") state.view = { name: "day", id: v.id };
  else if (v?.name === "program-edit") state.view = { name: "program", id: v.id };
  else if (v?.name === "routine")
    state.view = v.routine.id ? { name: "day", id: v.routine.id } : v.routine.program_id ? { name: "program", id: v.routine.program_id } : null;
  else state.view = null;
  render();
}

/* ------------------------------------------------------------------ */
/* Icone e colori delle schede                                         */
/* ------------------------------------------------------------------ */
const PI = {
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  barbell: '<path d="M2.5 12h19M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  kettlebell: '<path d="M9 10.5V8a3 3 0 0 1 6 0v2.5"/><path d="M12 10.5a6.5 6.5 0 0 0-6 9 1 1 0 0 0 1 .5h10a1 1 0 0 0 1-.5 6.5 6.5 0 0 0-6-9z"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2-.5-3 0-6 1-8z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6M10 17h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  mountain: '<path d="m3 19 6-11 4 6 2-3 6 8z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>',
};
const COLORS = ["teal", "blue", "violet", "red", "amber", "green", "pink"];
const PI_EXTRA = { moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>' };
const icon = (k) =>
  `<svg class="pi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PI[k] || PI_EXTRA[k] || PI.dumbbell}</svg>`;
const nEx = (n) => `${n} ${n === 1 ? "esercizio" : "esercizi"}`;
const pc = (c) => `pc-${COLORS.includes(c) ? c : "teal"}`;

function iconPickHTML(sel, withNone) {
  return `<div class="pick-ic ${withNone ? "n7" : ""}" role="group" aria-label="Icona">${withNone ? `<button type="button" class="pk num ${!sel ? "on" : ""}" data-act="ic-pick" data-v="" aria-label="Solo il numero">1</button>` : ""}${Object.keys(PI)
    .map((k) => `<button type="button" class="pk ${sel === k ? "on" : ""}" data-act="ic-pick" data-v="${k}" aria-label="${k}">${icon(k)}</button>`)
    .join("")}</div>`;
}
const colorPickHTML = (sel) =>
  `<div class="pick-col" role="group" aria-label="Colore">${COLORS.map((c) => `<button type="button" class="sw ${pc(c)} ${sel === c ? "on" : ""}" data-act="col-pick" data-v="${c}" aria-label="${c}"></button>`).join("")}</div>`;

const WD = [["L", "Lunedì"], ["M", "Martedì"], ["M", "Mercoledì"], ["G", "Giovedì"], ["V", "Venerdì"], ["S", "Sabato"], ["D", "Domenica"]];
const trainPickHTML = (sel = []) =>
  `<div class="pick-wd" role="group" aria-label="Giorni di allenamento">${WD.map(([l, n], i) => `<button type="button" class="wd ${sel.includes(i + 1) ? "on" : ""}" data-act="tr-toggle" data-v="${i + 1}" aria-pressed="${sel.includes(i + 1)}" aria-label="${n}">${l}</button>`).join("")}</div>`;
const DEFAULT_TRAIN = [1, 2, 4, 5];

function exportHTML() {
  const sel = state.view.sel;
  return `<p class="hint">Scegli le schede da esportare. Ottieni un unico file Excel: ogni giorno è un foglio, con tutte le settimane, i pesi e le ripetizioni.</p>
    ${state.programs
      .map((p) => {
        const on = sel.includes(p.id);
        const n = state.routines.filter((r) => r.program_id === p.id).length;
        return `<button class="pcard xsel ${pc(p.color)} ${on ? "on" : ""}" data-act="xlsx-toggle" data-id="${p.id}" aria-pressed="${on}">
        <span class="ptile">${icon(p.icon)}</span>
        <span class="ptxt"><b>${esc(p.name)}</b><small>${n} ${n === 1 ? "giorno" : "giorni"}</small></span>
        <span class="tick" aria-hidden="true">${on ? "✓" : ""}</span></button>`;
      })
      .join("")}
    <button class="primary wide" data-act="xlsx-run" ${sel.length ? "" : "disabled"}>Scarica il file Excel</button>`;
}

// Crea il file Excel (un foglio per giorno) e lo scarica sul telefono
async function exportXlsx(ids) {
  const progs = state.programs
    .filter((p) => ids.includes(p.id))
    .map((p) => ({
      name: p.name,
      days: state.routines
        .filter((r) => r.program_id === p.id)
        .map((r) => ({
          name: r.name,
          notes: r.notes,
          current_week: r.current_week,
          items: r.items.map((it) => ({
            name: exName(it.exercise_id),
            raw: it.notes || "",
            superset_id: it.superset_id || null,
            target_sets: it.target_sets,
            target_reps: it.target_reps,
            rep_targets: it.rep_targets,
            rest_seconds: it.rest_seconds,
            weeks: it.weeks || {},
          })),
        })),
    }))
    .filter((p) => p.days.length);
  if (!progs.length) return toast("Queste schede non hanno ancora giorni da esportare");
  const { buildXlsx } = await import("./exporter.js");
  const blob = buildXlsx(progs);
  const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = progs.length === 1 ? `scheda-${slug(progs[0].name) || "palestra"}.xlsx` : `schede-palestra-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast("File Excel scaricato: lo trovi nei Download");
}

function programFormHTML(edit) {
  const v = state.view;
  return `<section class="phead ${pc(v.color)}"><span class="ptile big">${icon(v.icon)}</span><div><b>${esc(v.title.trim() || "Nome della scheda")}</b><small>Anteprima</small></div></section>
    <label class="field">Nome della scheda<input data-bind="prog-name" value="${esc(v.title || "")}" placeholder="Es. Settembre, Massa, Forza" maxlength="60"></label>
    <div class="field"><span class="lbl">Icona</span>${iconPickHTML(v.icon, false)}</div>
    <div class="field"><span class="lbl">Colore</span>${colorPickHTML(v.color)}</div>
    <div class="field"><span class="lbl">Giorni in cui ti alleni di solito</span>${trainPickHTML(v.train)}
      <p class="hint">Negli altri giorni l'app ti dice che è riposo, ma puoi allenarti lo stesso quando vuoi.</p></div>
    <button class="primary wide" data-act="${edit ? "prog-update" : "prog-create"}">${edit ? "Salva" : "Crea scheda"}</button>
    ${edit ? "" : `<p class="hint">Dopo aver creato la scheda potrai aggiungere i giorni (Giorno 1, Giorno 2, ...) con i loro esercizi.</p>`}`;
}

// gruppi muscolari di un giorno, nell'ordine in cui compaiono
const dayGroups = (r) => [...new Set(r.items.map((i) => state.exercises.find((e) => e.id === i.exercise_id)?.muscle_group).filter(Boolean))];
const gchips = (r) => {
  const g = dayGroups(r);
  return g.length ? `<span class="gchips">${g.slice(0, 4).map((x) => `<span class="gchip g g-${gSlug(x)}"><i></i>${esc(x)}</span>`).join("")}${g.length > 4 ? `<span class="gchip more">+${g.length - 4}</span>` : ""}</span>` : "";
};

// giorno della settimana di oggi (1 = lunedì ... 7 = domenica) e allenamenti fatti da lunedì
const todayIso = () => new Date().getDay() || 7;
function sessionsThisWeek(days) {
  const d = new Date();
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (todayIso() - 1)).getTime();
  return (state.lastRuns || []).filter((w) => new Date(w.started_at).getTime() >= monday && days.some((x) => x.id === w.routine_id)).length;
}

// Giorno "di oggi": quello rimasto più indietro (settimana più bassa); a parità, il primo della scheda.
// Così funziona anche se i giorni si fanno in ordine sparso.
function nextDay(p) {
  const days = state.routines.filter((r) => r.program_id === p.id);
  if (!days.length) return null;
  const low = Math.min(...days.map((d) => d.current_week));
  return days.find((d) => d.current_week === low);
}
function heroProgram() {
  const pin = state.programs.find((p) => p.pinned && state.routines.some((r) => r.program_id === p.id));
  if (pin) return pin;
  const last = (state.lastRuns || []).find((w) => state.routines.some((r) => r.id === w.routine_id));
  const r = last && state.routines.find((x) => x.id === last.routine_id);
  return state.programs.find((p) => p.id === r?.program_id) || state.programs.find((p) => state.routines.some((r2) => r2.program_id === p.id)) || null;
}

function homeHTML() {
  const a = state.active;
  let h = "";
  if (a)
    h += `<section class="live"><div><strong>${esc(a.name)}${a.week ? `, settimana ${a.week}` : ""}</strong><span>iniziato alle ${fmtTime(a.startedAt)}</span></div>
      <button class="primary" data-act="resume">Riprendi</button></section>`;
  const hp = heroProgram(), hd = hp && nextDay(hp);
  if (hp && hd) {
    const days = state.routines.filter((r) => r.program_id === hp.id);
    const train = hp.train_days || DEFAULT_TRAIN;
    const planned = train.length;
    const done = sessionsThisWeek(days);
    // con 0 giorni scelti non c'è un calendario: si propone sempre il prossimo giorno
    const allDone = planned > 0 && done >= planned;
    const trainToday = planned === 0 || train.includes(todayIso());
    const week = planned
      ? `Questa settimana: ${done} su ${planned} allenamenti`
      : `Questa settimana: ${done} ${done === 1 ? "allenamento" : "allenamenti"}`;
    if (trainToday && !allDone)
      h += `<section class="hero ${pc(hp.color)}">
      <span class="hero-ic">${icon(hd.icon || hp.icon)}</span>
      <small class="hero-k">Oggi tocca</small>
      <h2>${esc(hd.name)}</h2>
      <p>${esc(hp.name)} · settimana ${hd.current_week} · ${nEx(hd.items.length)}</p>
      ${gchips(hd)}
      <p class="hero-wk">${week}</p>
      <div class="hero-row">
        <button class="hero-btn" data-act="start" data-id="${hd.id}" ${a ? "disabled" : ""}>Inizia</button>
        <button class="hero-lnk" data-act="open-program" data-id="${hp.id}">Cambia giorno</button>
      </div></section>`;
    else
      h += `<section class="hero rest">
      <span class="hero-ic">${icon("moon")}</span>
      <small class="hero-k">${allDone ? "Settimana completata" : "Oggi riposo"}</small>
      <h2>Goditi il relax</h2>
      <p>${allDone ? "Hai fatto tutti gli allenamenti previsti: ottimo lavoro." : "Il corpo cresce quando riposi. Se hai voglia, puoi allenarti lo stesso."}</p>
      <p class="hero-wk">${week}</p>
      <div class="hero-row">
        <button class="hero-btn" data-act="start" data-id="${hd.id}" ${a ? "disabled" : ""}>Allenati: ${esc(hd.name)}</button>
        <button class="hero-lnk" data-act="open-program" data-id="${hp.id}">Altro giorno</button>
      </div></section>`;
  }
  h += `<div class="sec-h"><h2>Le tue schede</h2><button class="link" data-act="new-program">Nuova scheda</button></div>`;
  if (!state.programs.length)
    h += `<p class="empty">Non hai ancora nessuna scheda. Creane una, oppure importala da un file Excel.</p>`;
  h += state.programs
    .map((p) => {
      const days = state.routines.filter((r) => r.program_id === p.id);
      return `<button class="pcard ${pc(p.color)}" data-act="open-program" data-id="${p.id}">
        <span class="ptile">${icon(p.icon)}</span>
        <span class="ptxt"><b>${esc(p.name)}${p.pinned ? ` <em class="badge">Attiva</em>` : ""}</b><small>${days.length} ${days.length === 1 ? "giorno" : "giorni"}${days.length ? `: ${esc(days.map((d) => d.name).join(", "))}` : ""}</small></span>
        <span class="chev" aria-hidden="true">›</span></button>`;
    })
    .join("");
  h += `<button class="ghost wide" data-act="start" data-id="" ${a ? "disabled" : ""}>Allenamento libero</button>`;
  h += `<label class="ghost wide filelabel">Importa da Excel<input type="file" id="imp-file" accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" hidden></label>`;
  if (state.programs.length) h += `<button class="ghost wide" data-act="xlsx-view">Esporta schede in Excel</button>`;
  if (a) h += `<p class="hint">Hai un allenamento in corso: riprendilo o terminalo prima di iniziarne un altro.</p>`;
  return h;
}

function programHTML() {
  const p = state.programs.find((x) => x.id === state.view.id);
  if (!p) return `<p class="empty">Scheda non trovata.</p>`;
  const days = state.routines.filter((r) => r.program_id === p.id);
  const nx = nextDay(p);
  return `<section class="phead ${pc(p.color)}"><span class="ptile big">${icon(p.icon)}</span><div><b>${esc(p.name)}</b><small>${days.length} ${days.length === 1 ? "giorno" : "giorni"}${p.pinned ? " · scheda attiva" : ""}</small></div></section>
    ${
      days.length
        ? days
            .map(
              (r, i) => `<button class="pcard dcard ${pc(p.color)}" data-act="open-day" data-id="${r.id}">
        <span class="ptile ${r.icon ? "" : "num"}">${r.icon ? icon(r.icon) : i + 1}</span>
        <span class="ptxt"><b>${esc(r.name)}${nx?.id === r.id ? ` <em class="badge">Oggi</em>` : ""}</b>
          ${gchips(r)}<small>Settimana ${r.current_week}, ${nEx(r.items.length)}</small></span>
        <span class="chev" aria-hidden="true">›</span></button>`
            )
            .join("")
        : `<p class="empty">Questa scheda non ha ancora giorni. Aggiungine uno.</p>`
    }
    ${days.length ? `<button class="pcard extra" data-act="start" data-id="" ${state.active ? "disabled" : ""}>
        <span class="ptile">${icon("star")}</span>
        <span class="ptxt"><b>Allenamento extra</b><small>Scegli tu gli esercizi. Non cambia le settimane.</small></span>
        <span class="chev" aria-hidden="true">›</span></button>` : ""}
    <button class="ghost wide" data-act="add-day">Aggiungi giorno</button>
    ${state.programs.length > 1 ? `<button class="ghost wide" data-act="prog-pin">${p.pinned ? "Non è più la scheda attiva" : "Usa questa come scheda attiva"}</button>` : ""}
    ${days.length ? `<button class="ghost wide" data-act="xlsx-one">Esporta in Excel</button>` : ""}
    <div class="row"><button class="ghost" data-act="prog-edit">Modifica scheda</button><button class="danger-btn" data-act="prog-delete">Elimina scheda</button></div>`;
}

// Raggruppa gli esercizi consecutivi con la stessa chiave (superserie / dropset)
function blocksOf(list, key = "superset_id") {
  const out = [];
  list.forEach((it, i) => {
    const last = out[out.length - 1];
    if (it[key] && last && last[0].it[key] === it[key]) last.push({ it, i });
    else out.push([{ it, i }]);
  });
  return out;
}
const LTR = ["A", "B", "C", "D", "E", "F"];
const ltr = (k) => `<i class="ltr">${LTR[k]}</i>`;

function dayExHTML(it, k = -1, showNote = true) {
  return `<h3>${k >= 0 ? ltr(k) : ""}${esc(exName(it.exercise_id))}</h3>
        ${exImg(it.exercise_id) ? `<details class="how"><summary>Come si fa</summary>${imgPairHTML(exImg(it.exercise_id), exName(it.exercise_id))}</details>` : ""}
        ${showNote && it.notes ? `<p class="hint">${esc(it.notes)}</p>` : ""}
        <p class="hint">${it.target_sets} serie, recupero ${it.rest_seconds} s${it.rep_targets ? `, obiettivo ${esc(it.rep_targets.split("|").map((s) => s.trim()).join(", "))}` : ""}</p>
        <label class="memo">Note<textarea rows="2" data-bind="memo" data-re="${it.id}" placeholder="Promemoria per questo esercizio">${esc(it.memo || "")}</textarea></label>`;
}

function dayHTML() {
  const r = state.routines.find((x) => x.id === state.view.id);
  if (!r) return `<p class="empty">Giorno non trovato.</p>`;
  const a = state.active;
  return `<section class="card">
      <div class="weekbar">
        <button class="wk" data-act="wk-dec" data-id="${r.id}" aria-label="Settimana precedente" ${r.current_week <= 1 ? "disabled" : ""}>‹</button>
        <span>Settimana <b>${r.current_week}</b></span>
        <button class="wk" data-act="wk-inc" data-id="${r.id}" aria-label="Settimana successiva">›</button>
      </div>
      <button class="primary wide" data-act="start" data-id="${r.id}" ${a ? "disabled" : ""}>Inizia la settimana ${r.current_week}</button>
      ${a ? `<p class="hint">Hai un allenamento in corso: riprendilo o terminalo prima di iniziarne un altro.</p>` : ""}
      <div class="row"><button class="ghost" data-act="progress" data-id="${r.id}">Progressi</button><button class="ghost" data-act="edit-routine" data-id="${r.id}">Modifica giorno</button></div>
    </section>
    ${r.notes ? `<section class="card"><p class="hint" style="white-space:pre-line">${esc(r.notes)}</p></section>` : ""}
    ${blocksOf(r.items)
      .map((b) =>
        b.length === 1
          ? `<section class="card ${gCls(b[0].it.exercise_id)}">${dayExHTML(b[0].it)}</section>`
          : `<section class="card sup ${gCls(b[0].it.exercise_id)}">
        <span class="sup-tag">Superserie</span>
        ${b.every((x) => x.it.notes === b[0].it.notes) && b[0].it.notes ? `<p class="hint">${esc(b[0].it.notes)}</p>` : ""}
        ${b.map((x, k) => `<div class="sup-ex">${dayExHTML(x.it, k, !b.every((y) => y.it.notes === b[0].it.notes))}</div>`).join("")}
      </section>`
      )
      .join("")}`;
}

function routineItemHTML(it, i, k = -1) {
  return `<div class="ritem">
        <div class="card-h"><h3>${k >= 0 ? ltr(k) : ""}${esc(exName(it.exercise_id))}</h3>
          <button class="link danger" data-act="r-del-ex" data-i="${i}">Rimuovi</button></div>
        <div class="trio">
          <label>Serie<input type="number" inputmode="numeric" min="1" value="${it.target_sets}" data-bind="r-item" data-i="${i}" data-f="target_sets"></label>
          <label>Ripetizioni<input type="number" inputmode="numeric" min="1" value="${it.target_reps}" data-bind="r-item" data-i="${i}" data-f="target_reps"></label>
          <label>Recupero (s)<input type="number" inputmode="numeric" min="0" step="5" value="${it.rest_seconds}" data-bind="r-item" data-i="${i}" data-f="rest_seconds"></label>
        </div></div>`;
}

function routineHTML() {
  const r = state.view.routine;
  return `
    <label class="field">Nome del giorno<input data-bind="r-name" value="${esc(r.name)}" placeholder="Es. Giorno 1, Push, Gambe" maxlength="60"></label>
    <div class="field"><span class="lbl">Icona del giorno</span>${iconPickHTML(r.icon, true)}</div>
    ${blocksOf(r.items)
      .map((b, bi) => {
        const first = b[0].i, last = b[b.length - 1].i;
        const up = bi > 0 ? `<button class="link" data-act="r-up" data-i="${first}" aria-label="Sposta su">Su</button>` : "";
        return b.length === 1
          ? `<section class="card">${routineItemHTML(b[0].it, first)}
        <div class="row">${up}<button class="ghost" data-act="r-pair" data-i="${last}">+ Abbina un esercizio</button></div></section>`
          : `<section class="card sup">
        <div class="card-h"><span class="sup-tag">Superserie</span>${up}</div>
        ${b.map((x, k) => routineItemHTML(x.it, x.i, k)).join("")}
        <div class="row"><button class="ghost" data-act="r-pair" data-i="${last}">+ Altro esercizio</button><button class="ghost" data-act="r-split" data-i="${first}">Separa</button></div></section>`;
      })
      .join("")}
    <button class="ghost wide" data-act="r-add-ex">Aggiungi esercizio</button>
    <button class="primary wide" data-act="r-save">Salva giorno</button>
    ${r.id ? `<button class="danger-btn wide" data-act="r-delete">Elimina giorno</button>` : ""}`;
}

// Tabella: serie / obiettivo / settimana precedente
function prevTableHTML(e) {
  if (!e.targets?.length && !e.prev?.length) return "";
  const tg = (i) => e.targets?.[i] ?? e.targets?.[e.targets.length - 1] ?? "";
  const rows = e.sets
    .map((_, i) => {
      const p = e.prev?.[i];
      return `<tr><td>${i + 1}</td><td>${tg(i) ? esc(tg(i)) : "–"}</td><td>${p ? `<b>${kg(p.weight)}</b> kg × ${p.reps}` : "–"}</td></tr>`;
    })
    .join("");
  return `<table class="pt"><thead><tr><th>Serie</th><th>Obiettivo</th><th>${esc(e.prevLabel || "Ultima volta")}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function exHeadHTML(e, ei, k = -1) {
  return `<div class="card-h"><h3>${k >= 0 ? ltr(k) : ""}${esc(exName(e.exercise_id))}</h3><button class="link danger" data-act="w-del-ex" data-e="${ei}">Rimuovi</button></div>
      ${exImg(e.exercise_id) ? `<details class="how"><summary>Come si fa</summary>${imgPairHTML(exImg(e.exercise_id), exName(e.exercise_id))}</details>` : ""}
      ${prevTableHTML(e)}
      ${e.reId ? `<label class="memo">Note<textarea rows="2" data-bind="memo" data-re="${e.reId}" placeholder="Promemoria per questo esercizio">${esc(e.memo)}</textarea></label>` : ""}`;
}

function setBtnsHTML(ei, rest, canDel) {
  return `<div class="row">
        <button class="ghost" data-act="w-add-set" data-e="${ei}">+ Serie</button>
        ${canDel ? `<button class="ghost" data-act="w-del-set" data-e="${ei}">− Serie</button>` : ""}
        <label class="rest">Recupero <input type="number" inputmode="numeric" min="0" step="5" value="${rest}" data-bind="w-rest" data-e="${ei}"> s</label>
      </div>`;
}

function workoutHTML() {
  const a = state.active;
  const list = blocksOf(a.exercises, "group")
    .map((b) => {
      if (b.length === 1) {
        const e = b[0].it, ei = b[0].i;
        return `<section class="card ${gCls(e.exercise_id)}">
      ${exHeadHTML(e, ei)}
      ${e.note ? `<p class="hint">${esc(e.note)}</p>` : ""}
      <div class="sets">
        <div class="set-h"><span>Serie</span><span>Peso (kg)</span><span>Ripetizioni</span><span></span></div>
        ${e.sets
          .map(
            (s, si) => `<div class="set ${s.done ? "done" : ""}">
          <span class="n">${si + 1}</span>
          <input type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${esc(s.weight)}" data-bind="w-set" data-e="${ei}" data-s="${si}" data-f="weight" aria-label="Peso serie ${si + 1}">
          <input type="number" inputmode="numeric" min="0" placeholder="0" value="${esc(s.reps)}" data-bind="w-set" data-e="${ei}" data-s="${si}" data-f="reps" aria-label="Ripetizioni serie ${si + 1}">
          <button class="check" data-act="w-check" data-e="${ei}" data-s="${si}" aria-pressed="${s.done}" aria-label="Serie ${si + 1} completata">✓</button>
        </div>`
          )
          .join("")}
      </div>
      ${setBtnsHTML(ei, e.rest, e.sets.length > 1)}</section>`;
      }
      // superserie: gli esercizi si alternano serie per serie, un solo ✓ per serie
      const n = Math.max(...b.map((x) => x.it.sets.length));
      const first = b[0].i;
      const note = b[0].it.note && b.every((x) => x.it.note === b[0].it.note) ? b[0].it.note : "";
      return `<section class="card sup ${gCls(b[0].it.exercise_id)}">
      <span class="sup-tag">Superserie</span>
      ${note ? `<p class="hint">${esc(note)}</p>` : ""}
      ${b.map((x, k) => `<div class="sup-ex">${exHeadHTML(x.it, x.i, k)}</div>`).join("")}
      <div class="sets">
        <div class="set-h g2"><span>Serie</span><span>Peso (kg) e ripetizioni</span><span></span></div>
        ${Array.from({ length: n }, (_, si) => {
          const done = b.every((x) => !x.it.sets[si] || x.it.sets[si].done);
          return `<div class="set g2 ${done ? "done" : ""}">
          <span class="n">${si + 1}</span>
          <div class="gin">${b
            .map((x, k) => {
              const s = x.it.sets[si];
              if (!s) return "";
              return `<div class="gl">${ltr(k)}
            <input type="number" inputmode="decimal" step="any" min="0" placeholder="0" value="${esc(s.weight)}" data-bind="w-set" data-e="${x.i}" data-s="${si}" data-f="weight" aria-label="Peso ${LTR[k]} serie ${si + 1}">
            <input type="number" inputmode="numeric" min="0" placeholder="0" value="${esc(s.reps)}" data-bind="w-set" data-e="${x.i}" data-s="${si}" data-f="reps" aria-label="Ripetizioni ${LTR[k]} serie ${si + 1}"></div>`;
            })
            .join("")}</div>
          <button class="check" data-act="w-check" data-e="${first}" data-s="${si}" aria-pressed="${done}" aria-label="Serie ${si + 1} completata">✓</button>
        </div>`;
        }).join("")}
      </div>
      ${setBtnsHTML(first, Math.max(...b.map((x) => x.it.rest || 0)), n > 1)}</section>`;
    })
    .join("");
  return `${a.notes ? `<section class="card"><p class="hint" style="white-space:pre-line">${esc(a.notes)}</p></section>` : ""}
    ${list || `<p class="empty">Allenamento libero: aggiungi gli esercizi che vuoi fare.</p>`}
    <button class="ghost wide" data-act="w-add-ex">Aggiungi esercizio</button>
    <button class="primary wide" data-act="w-finish">Termina e salva</button>
    <button class="danger-btn wide" data-act="w-cancel">Annulla allenamento</button>`;
}

function filteredExercises(q = state.q, g = state.group) {
  const s = q.trim().toLowerCase();
  return state.exercises.filter(
    (e) => (!g || e.muscle_group === g) && (!s || e.name.toLowerCase().includes(s))
  );
}
// Le immagini incluse nell'app hanno due fotogrammi: "-0" (partenza) e "-1" (arrivo)
function imgFrames(url) {
  return /-0\.webp$/.test(url || "") ? [url, url.replace(/-0\.webp$/, "-1.webp")] : url ? [url] : [];
}
function exListHTML(list, act) {
  if (!list.length) return `<p class="empty">Nessun esercizio trovato. Prova con un altro nome o crea il tuo esercizio.</p>`;
  return list
    .map(
      (e) => `<button class="ex-item g g-${gSlug(e.muscle_group)}" data-act="${act}" data-id="${e.id}">
        ${e.image_url ? `<img class="ex-thumb" src="${esc(imgFrames(e.image_url)[0])}" alt="" loading="lazy">` : ""}
        <span class="ex-txt"><b>${esc(e.name)}</b><small>${esc(e.muscle_group)}${e.equipment ? `, ${esc(e.equipment)}` : ""}</small></span>
        ${e.owner ? `<span class="tag">Tuo</span>` : ""}</button>`
    )
    .join("");
}

function exercisesHTML() {
  return `
    <input type="search" placeholder="Cerca un esercizio" value="${esc(state.q)}" data-bind="ex-q" aria-label="Cerca un esercizio">
    <div class="chips">
      <button class="chip" data-group="" aria-pressed="${state.group === ""}">Tutti</button>
      ${GROUPS.map((g) => `<button class="chip g-${gSlug(g)}" data-group="${g}" aria-pressed="${state.group === g}"><i class="dot"></i>${g}</button>`).join("")}
    </div>
    <div id="ex-list" style="display:grid;gap:6px">${exListHTML(filteredExercises(), "ex-open")}</div>
    <button class="ghost wide" data-act="ex-new">Crea un tuo esercizio</button>`;
}

function imgPairHTML(url, name) {
  const f = imgFrames(url);
  if (!f.length) return "";
  const labels = ["Partenza", "Arrivo"];
  return `<div class="ex-imgs">${f
    .map((s, i) => `<figure><img class="ex-img" src="${esc(s)}" alt="${esc(name)}${f.length > 1 ? ": " + labels[i].toLowerCase() : ""}" loading="lazy">${f.length > 1 ? `<figcaption>${labels[i]}</figcaption>` : ""}</figure>`)
    .join("")}</div>`;
}

// Grafico dell'esercizio: dalla scheda (settimane) se c'è, altrimenti dallo storico (date)
function exChartHTML(e) {
  const items = state.routines.flatMap((r) => r.items.filter((it) => it.exercise_id === e.id).map((it) => ({ it, r })));
  const best = items.map((x) => ({ ...x, wp: weekPoints(x.it) })).sort((a, b) => b.wp.pts.length - a.wp.pts.length)[0];
  if (best && best.wp.pts.length >= 2)
    return `<section class="card"><h3>Progressi</h3>${lineChartHTML(best.wp.pts, best.wp.unit, `${best.wp.caption} · ${best.r.name}`)}</section>`;
  const byW = {};
  (state.sets || []).filter((x) => x.exercise_id === e.id && x.weight > 0).forEach((x) => (byW[x.workout_id] = Math.max(byW[x.workout_id] || 0, Number(x.weight))));
  const pts = state.workouts
    .filter((w) => byW[w.id])
    .map((w) => ({ t: new Date(w.started_at), v: byW[w.id] }))
    .sort((a, b) => a.t - b.t)
    .slice(-12)
    .map((p) => ({ label: `${p.t.getDate()}/${p.t.getMonth() + 1}`, v: p.v }));
  if (pts.length >= 2) return `<section class="card"><h3>Progressi</h3>${lineChartHTML(pts, "kg", "Carico più alto per allenamento")}</section>`;
  return "";
}

function exerciseHTML() {
  const v = state.view;
  if (!v.id)
    return `<form id="ex-form" class="card">
      <label class="field">Nome<input name="name" required maxlength="80"></label>
      <label class="field">Gruppo muscolare<select name="muscle_group">${GROUPS.map((g) => `<option>${g}</option>`).join("")}</select></label>
      <label class="field">Attrezzo (facoltativo)<input name="equipment" maxlength="40"></label>
      <label class="field">Come si esegue (facoltativo)<textarea name="instructions"></textarea></label>
      <label class="field">Indirizzo di un'immagine (facoltativo)<input type="url" name="image_url" placeholder="https://..."></label>
      <button class="primary wide" type="submit">Salva esercizio</button></form>`;
  const e = state.exercises.find((x) => x.id === v.id);
  if (!e) return `<p class="empty">Esercizio non trovato.</p>`;
  return `<article class="card">
      ${imgPairHTML(e.image_url, e.name)}
      <h3>${esc(e.name)}</h3>
      <div class="row"><span class="tag">${esc(e.muscle_group)}</span>${e.equipment ? `<span class="tag">${esc(e.equipment)}</span>` : ""}</div>
      <p>${esc(e.instructions || "Nessuna descrizione.")}</p>
    </article>
    ${exChartHTML(e)}
    ${e.owner === state.user.id ? `<button class="danger-btn wide" data-act="ex-delete" data-id="${e.id}">Elimina esercizio</button>` : ""}`;
}

/* ------------------------------------------------------------------ */
/* Settimane e grafici                                                 */
/* ------------------------------------------------------------------ */
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
// lunedì della settimana (ora locale) e chiave "AAAA-MM-GG"
function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() || 7) - 1));
  return x;
}
const dkey = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
function weekTitle(mon) {
  const cur = mondayOf(new Date()).getTime();
  const diff = Math.round((cur - mon.getTime()) / (7 * 86400000));
  if (diff === 0) return "Questa settimana";
  if (diff === 1) return "Settimana scorsa";
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return mon.getMonth() === sun.getMonth()
    ? `${mon.getDate()}–${sun.getDate()} ${MESI[sun.getMonth()]}`
    : `${mon.getDate()} ${MESI[mon.getMonth()].slice(0, 3)} – ${sun.getDate()} ${MESI[sun.getMonth()].slice(0, 3)}`;
}
const fmtN = (n) => (Math.abs(n) >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10).replace(".", ","));

// Grafico a linea: punti [{ label, v }], evidenzia il valore più alto (record)
function lineChartHTML(pts, unit, caption) {
  if (pts.length < 2) return "";
  const W = 320, H = 150, L = 34, R = 14, T = 22, B = 24;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const x = (i) => L + ((W - L - R) * i) / (pts.length - 1);
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const max = Math.max(...vs), iMax = vs.lastIndexOf(max);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
  const step = Math.ceil(pts.length / 7);
  const tx = Math.min(Math.max(x(iMax), L + 18), W - R - 18);
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}: massimo ${kg(max)} ${unit}">
      ${[lo, (lo + hi) / 2, hi].map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="gl"/><text x="${L - 6}" y="${(y(t) + 3.5).toFixed(1)}" class="ty">${fmtN(t)}</text>`).join("")}
      <path d="${area}" class="ar"/><path d="${line}" class="ln"/>
      ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="${i === iMax ? 4.5 : 3}" class="pt${i === iMax ? " mx" : ""}"/>`).join("")}
      ${pts.map((p, i) => (i % step === 0 || i === pts.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 7}" class="tx">${esc(p.label)}</text>` : "")).join("")}
      <text x="${tx.toFixed(1)}" y="${(y(max) - 9).toFixed(1)}" class="tv">${kg(max)} ${unit}</text>
    </svg><figcaption>${esc(caption)}</figcaption></figure>`;
}

// Punti per settimana di un esercizio della scheda: carico più alto (o ripetizioni, se a corpo libero)
function weekPoints(it) {
  const weeks = Object.keys(it.weeks || {}).map(Number).sort((a, b) => a - b);
  const sets = (w) => (it.weeks[w] || []).filter(Boolean);
  const heavy = weeks.some((w) => sets(w).some((s) => Number(s.weight) > 0));
  const pts = weeks
    .map((w) => ({ label: `S${w}`, v: Math.max(0, ...sets(w).map((s) => Number(heavy ? s.weight : s.reps) || 0)) }))
    .filter((p) => p.v > 0);
  return { pts, unit: heavy ? "kg" : "rip.", caption: heavy ? "Carico più alto per settimana" : "Ripetizioni migliori per settimana" };
}

// Grafico a barre: allenamenti fatti nelle ultime settimane
function weeksBarHTML() {
  const mon = mondayOf(new Date());
  const weeks = Array.from({ length: 8 }, (_, k) => {
    const m = new Date(mon);
    m.setDate(m.getDate() - 7 * (7 - k));
    return m;
  });
  const count = weeks.map((m) => state.workouts.filter((w) => dkey(mondayOf(w.started_at)) === dkey(m)).length);
  const top = Math.max(4, ...count);
  const W = 320, H = 110, B = 22, T = 16, bw = 26, gap = (W - 8 * bw) / 8;
  return `<figure class="chart bars"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Allenamenti nelle ultime 8 settimane">
      ${count
        .map((c, k) => {
          const h = ((H - B - T) * c) / top, xx = gap / 2 + k * (bw + gap), yy = H - B - h;
          return `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width="${bw}" height="${Math.max(h, 2).toFixed(1)}" rx="6" class="${k === 7 ? "bar cur" : "bar"}"/>
          ${c ? `<text x="${(xx + bw / 2).toFixed(1)}" y="${(yy - 5).toFixed(1)}" class="tv">${c}</text>` : ""}
          <text x="${(xx + bw / 2).toFixed(1)}" y="${H - 7}" class="tx">${weeks[k].getDate()}/${weeks[k].getMonth() + 1}</text>`;
        })
        .join("")}
    </svg><figcaption>Allenamenti per settimana (ultime 8)</figcaption></figure>`;
}

function historyHTML() {
  if (!state.workouts.length)
    return `<p class="empty">Qui comparirà lo storico dei tuoi allenamenti. Termina il tuo primo allenamento per iniziare.</p>`;
  // Record personali: miglior serie (per massimale stimato) di ogni esercizio
  const best = {};
  state.sets.forEach((s) => {
    if (s.weight > 0 && s.reps > 0) {
      const v = e1rm(s.weight, s.reps);
      if (!best[s.exercise_name] || v > best[s.exercise_name].v) best[s.exercise_name] = { v, w: s.weight, r: s.reps };
    }
  });
  const prs = Object.entries(best).sort((a, b) => a[0].localeCompare(b[0], "it")).slice(0, 12);
  let h = "";
  if (prs.length)
    h += `<section class="card"><h3>Record personali</h3><p class="hint">Miglior serie per esercizio, con massimale stimato.</p>
      <div>${prs.map(([n, b]) => `<div class="pr"><b>${esc(n)}</b><span>${kg(b.w)} kg × ${b.r} (≈ ${kg(Math.round(b.v * 10) / 10)} kg)</span></div>`).join("")}</div></section>`;
  h = `<section class="card">${weeksBarHTML()}</section>` + h;
  h += `<div class="sec-h"><h2>Allenamenti</h2></div>`;
  // raggruppati per settimana (da lunedì a domenica); al tocco si aprono i giorni
  const groups = [];
  state.workouts.forEach((w) => {
    const m = mondayOf(w.started_at), k = dkey(m);
    let g = groups.find((x) => x.k === k);
    if (!g) groups.push((g = { k, m, list: [] }));
    g.list.push(w);
  });
  if (!state.openWeeks) state.openWeeks = new Set([dkey(mondayOf(new Date()))]);
  h += groups
    .map((g) => {
      const open = state.openWeeks.has(g.k);
      const ws = state.sets.filter((x) => g.list.some((w) => w.id === x.workout_id));
      const vol = ws.reduce((t, x) => t + x.weight * x.reps, 0);
      const names = [...g.list].reverse().map((w) => w.name);
      const days = open
        ? g.list
            .map((w) => {
              const ss = state.sets.filter((x) => x.workout_id === w.id);
              const v = ss.reduce((t, x) => t + x.weight * x.reps, 0);
              const mins = w.finished_at ? Math.round((new Date(w.finished_at) - new Date(w.started_at)) / 60000) : null;
              const wo = state.openWorkouts.has(w.id);
              let detail = "";
              if (wo) {
                const by = {};
                ss.forEach((x) => (by[x.exercise_name] ||= []).push(x));
                detail =
                  Object.entries(by).map(([n, arr]) => `<div class="hist-ex"><b>${esc(n)}</b><span>${arr.map((x) => `${kg(x.weight)} kg × ${x.reps}`).join(", ")}</span></div>`).join("") +
                  `<button class="link danger" data-act="h-delete" data-id="${w.id}">Elimina allenamento</button>`;
              }
              return `<div class="hday">
              <div class="card-h"><div><b>${esc(w.name)}</b><p class="hint">${fmtDate(w.started_at)}${w.week ? `, settimana ${w.week}` : ""}</p></div>
                <button class="link" data-act="h-toggle" data-id="${w.id}" aria-expanded="${wo}">${wo ? "Chiudi" : "Dettagli"}</button></div>
              <div class="stats"><span>${ss.length} serie</span><span>Volume ${Math.round(v)} kg</span>${mins !== null ? `<span>${mins} min</span>` : ""}</div>
              ${detail}</div>`;
            })
            .join("")
        : "";
      return `<article class="card hweek">
        <button class="hweek-h" data-act="hw-toggle" data-k="${g.k}" aria-expanded="${open}">
          <span><b>${weekTitle(g.m)}</b><small>${g.list.length} ${g.list.length === 1 ? "allenamento" : "allenamenti"} · volume ${Math.round(vol)} kg</small>
            <span class="gchips">${names.map((n) => `<span class="gchip">${esc(n)}</span>`).join("")}</span></span>
          <span class="chev ${open ? "open" : ""}" aria-hidden="true">›</span></button>
        ${days}</article>`;
    })
    .join("");
  return h;
}

function profileHTML() {
  return `<section class="card">
      <h3>Account</h3><p class="hint">${esc(state.user.email)}</p>
      <button class="ghost wide" data-act="logout">Esci</button></section>
    <section class="card">
      <h3>Aggiornamenti</h3>
      <p class="hint">Se non vedi le novità dell'app, tocca qui: scarica di nuovo tutti i file. I tuoi dati non si toccano.</p>
      <button class="ghost wide" data-act="app-update">Aggiorna l'app</button></section>
    <section class="card">
      <h3>I tuoi dati</h3>
      <p class="hint">Puoi scaricare una copia di tutti i tuoi dati in formato JSON.</p>
      <button class="ghost wide" data-act="export">Scarica i miei dati</button></section>
    <section class="card">
      <h3>Elimina account</h3>
      <p class="hint">Cancella per sempre l'account e tutti i dati collegati: schede, allenamenti e esercizi creati da te.</p>
      <button class="danger-btn wide" data-act="delete-account">Elimina il mio account</button></section>`;
}

/* ------------------------------------------------------------------ */
/* Selettore di esercizi (finestra a comparsa)                          */
/* ------------------------------------------------------------------ */
let pickCb = null;
function openPicker(cb) {
  pickCb = cb;
  const s = $("#sheet");
  s.innerHTML = `<div class="sheet-body" role="dialog" aria-modal="true" aria-label="Scegli un esercizio">
    <header><h2>Scegli un esercizio</h2><button class="link" data-act="pk-close">Chiudi</button></header>
    <input type="search" placeholder="Cerca" data-bind="pk-q" aria-label="Cerca un esercizio">
    <div class="sheet-list" id="pk-list">${exListHTML(state.exercises, "pk-pick")}</div></div>`;
  s.hidden = false;
}
function closePicker() {
  $("#sheet").hidden = true;
  pickCb = null;
}

/* ------------------------------------------------------------------ */
/* Eventi                                                              */
/* ------------------------------------------------------------------ */
async function guard(fn, errMsg = "Qualcosa non ha funzionato. Controlla la connessione e riprova.") {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast(errMsg);
  }
}

document.addEventListener("click", (ev) => {
  const tabBtn = ev.target.closest("[data-tab]");
  if (tabBtn) {
    state.tab = tabBtn.dataset.tab;
    state.view = null;
    render();
    if (state.tab === "history") guard(async () => { await loadHistory(); render(); });
    return;
  }
  const grp = ev.target.closest("[data-group]");
  if (grp) {
    state.group = grp.dataset.group;
    render();
    return;
  }
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const d = el.dataset;
  const a = state.active;
  const v = state.view;

  switch (d.act) {
    /* timer */
    case "t-add":
      timerEnd += Number(d.v) * 1000;
      timerTotal = Math.max(timerTotal, Math.ceil((timerEnd - Date.now()) / 1000));
      tick();
      break;
    case "t-skip": stopTimer(); break;

    /* navigazione */
    case "back": goBack(); break;
    case "app-update":
      if (state.active && !confirm("Hai un allenamento in corso. L'app si ricarica ma l'allenamento resta salvato. Continuare?")) return;
      guard(async () => {
        const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
        await Promise.all(regs.map((r) => r.unregister()));
        await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
        location.reload();
      }, "Non sono riuscito ad aggiornare. Chiudi e riapri l'app.");
      break;
    case "logout": guard(async () => { await sb.auth.signOut(); }); break;

    /* home e schede */
    case "resume": state.view = { name: "workout" }; render(); break;
    case "start": guard(() => startWorkout(d.id || null)); break;
    case "new-program": state.view = { name: "program-new", title: "", icon: "dumbbell", color: COLORS[state.programs.length % COLORS.length], train: [...DEFAULT_TRAIN] }; render(); break;
    case "prog-create": {
      const name = (v.title || "").trim();
      if (!name) return toast("Dai un nome alla scheda");
      guard(async () => {
        const { data, error } = await sb.from("programs").insert({ name, user_id: state.user.id, icon: v.icon, color: v.color, train_days: v.train }).select().single();
        if (error) throw error;
        await loadAll();
        state.view = { name: "program", id: data.id };
        render();
      });
      break;
    }
    case "open-program": state.view = { name: "program", id: d.id }; render(); break;
    case "open-day": state.view = { name: "day", id: d.id }; render(); break;
    case "xlsx-view": state.view = { name: "xlsx", sel: state.programs.map((p) => p.id) }; render(); break;
    case "xlsx-toggle": v.sel = v.sel.includes(d.id) ? v.sel.filter((x) => x !== d.id) : [...v.sel, d.id]; render(); break;
    case "xlsx-run": guard(() => exportXlsx(v.sel), "Non sono riuscito a creare il file Excel."); break;
    case "xlsx-one": guard(() => exportXlsx([v.id]), "Non sono riuscito a creare il file Excel."); break;
    case "prog-pin": {
      const p = state.programs.find((x) => x.id === v.id);
      const make = !p.pinned;
      guard(async () => {
        const r1 = await sb.from("programs").update({ pinned: false }).neq("id", p.id);
        if (r1.error) throw r1.error;
        const r2 = await sb.from("programs").update({ pinned: make }).eq("id", p.id);
        if (r2.error) throw r2.error;
        await loadAll();
        render();
        toast(make ? "Ora questa è la tua scheda attiva" : "Scheda attiva rimossa: la home usa l'ultima che hai fatto");
      });
      break;
    }
    case "prog-edit": {
      const p = state.programs.find((x) => x.id === v.id);
      state.view = { name: "program-edit", id: p.id, title: p.name, icon: p.icon || "dumbbell", color: p.color || "teal", train: [...(p.train_days || DEFAULT_TRAIN)] };
      render();
      break;
    }
    case "prog-update": {
      const nm = (v.title || "").trim();
      if (!nm) return toast("Dai un nome alla scheda");
      guard(async () => {
        const { error } = await sb.from("programs").update({ name: nm, icon: v.icon, color: v.color, train_days: v.train }).eq("id", v.id);
        if (error) throw error;
        await loadAll();
        state.view = { name: "program", id: v.id };
        render();
      });
      break;
    }
    case "ic-pick": if (v.name === "routine") v.routine.icon = d.v || null; else v.icon = d.v; render(); break;
    case "col-pick": v.color = d.v; render(); break;
    case "tr-toggle": {
      const n = Number(d.v);
      v.train = v.train.includes(n) ? v.train.filter((x) => x !== n) : [...v.train, n].sort();
      render();
      break;
    }
    case "prog-delete": {
      const p = state.programs.find((x) => x.id === v.id);
      if (!confirm(`Eliminare la scheda «${p.name}» con tutti i suoi giorni e i carichi? Lo storico degli allenamenti resta.`)) return;
      guard(async () => {
        const { error } = await sb.from("programs").delete().eq("id", p.id);
        if (error) throw error;
        await loadAll();
        state.view = null;
        render();
      });
      break;
    }
    case "add-day":
      state.view = { name: "routine", routine: { id: null, program_id: v.id, name: "", items: [] } };
      render();
      break;
    case "edit-routine": {
      const r = state.routines.find((x) => x.id === d.id);
      state.view = { name: "routine", routine: { id: r.id, program_id: r.program_id, name: r.name, icon: r.icon || null, items: r.items.map((i) => ({ ...i })) } };
      render();
      break;
    }
    case "r-add-ex":
      openPicker((id) => {
        v.routine.items.push({ exercise_id: id, target_sets: 3, target_reps: 10, rest_seconds: 90 });
        render();
      });
      break;
    case "r-del-ex": v.routine.items.splice(Number(d.i), 1); cleanGroups(v.routine.items); render(); break;
    case "r-up": {
      const bl = blocksOf(v.routine.items);
      const bi = bl.findIndex((b) => b[0].i === Number(d.i));
      if (bi > 0) {
        [bl[bi - 1], bl[bi]] = [bl[bi], bl[bi - 1]];
        v.routine.items = bl.flat().map((x) => x.it);
      }
      render();
      break;
    }
    case "r-split": {
      const g = v.routine.items[Number(d.i)].superset_id;
      v.routine.items.forEach((it) => { if (it.superset_id === g) it.superset_id = null; });
      render();
      break;
    }
    case "r-pair": {
      // aggiunge un esercizio subito dopo, nella stessa superserie
      const at = Number(d.i);
      openPicker((id) => {
        const items = v.routine.items, base = items[at];
        const g = base.superset_id || crypto.randomUUID();
        base.superset_id = g;
        items.splice(at + 1, 0, { exercise_id: id, target_sets: base.target_sets, target_reps: 10, rest_seconds: base.rest_seconds, superset_id: g });
        render();
      });
      break;
    }
    case "r-save":
      if (!v.routine.name.trim()) return toast("Dai un nome al giorno");
      if (!v.routine.items.length) return toast("Aggiungi almeno un esercizio");
      guard(async () => {
        await saveRoutine({ ...v.routine, name: v.routine.name.trim() });
        await loadAll();
        state.view = v.routine.id ? { name: "day", id: v.routine.id } : { name: "program", id: v.routine.program_id };
        toast("Giorno salvato");
        render();
      });
      break;
    case "r-delete":
      if (!confirm("Eliminare questo giorno con i suoi carichi? Lo storico degli allenamenti resta.")) return;
      guard(async () => {
        const { error } = await sb.from("routines").delete().eq("id", v.routine.id);
        if (error) throw error;
        await loadAll();
        state.view = { name: "program", id: v.routine.program_id };
        render();
      });
      break;

    /* settimane e importazione */
    case "wk-dec":
    case "wk-inc": {
      const r = state.routines.find((x) => x.id === d.id);
      const next = Math.max(1, r.current_week + (d.act === "wk-inc" ? 1 : -1));
      guard(async () => {
        const { error } = await sb.from("routines").update({ current_week: next }).eq("id", r.id);
        if (error) throw error;
        r.current_week = next;
        render();
      });
      break;
    }
    case "progress": state.view = { name: "progress", id: d.id }; render(); break;
    case "imp-cancel": state.view = null; render(); break;
    case "imp-save": guard(saveImport, "Non sono riuscito a salvare l'importazione. Riprova."); break;

    /* allenamento in corso */
    case "w-check": {
      // una superserie ha un solo ✓ per serie: vale per tutti gli esercizi del gruppo
      const mem = grpOf(Number(d.e)).filter((m) => a.exercises[m].sets[d.s]);
      const done = !mem.every((m) => a.exercises[m].sets[d.s].done);
      mem.forEach((m) => (a.exercises[m].sets[d.s].done = done));
      persistActive();
      if (done) startTimer(Math.max(...mem.map((m) => a.exercises[m].rest || 0)) || 90);
      else stopTimer();
      render();
      break;
    }
    case "w-add-set": {
      grpOf(Number(d.e)).forEach((m) => {
        const ex = a.exercises[m], last = ex.sets[ex.sets.length - 1];
        ex.sets.push({ weight: last?.weight ?? "", reps: last?.reps ?? "10", done: false });
      });
      persistActive();
      render();
      break;
    }
    case "w-del-set": grpOf(Number(d.e)).forEach((m) => { if (a.exercises[m].sets.length > 1) a.exercises[m].sets.pop(); }); persistActive(); render(); break;
    case "w-del-ex": a.exercises.splice(Number(d.e), 1); persistActive(); render(); break;
    case "w-add-ex": openPicker((id) => addExerciseToWorkout(id)); break;
    case "w-finish": guard(finishWorkout); break;
    case "w-cancel":
      if (!confirm("Annullare l'allenamento? Le serie non salvate andranno perse.")) return;
      state.active = null;
      persistActive();
      stopTimer();
      state.view = null;
      render();
      break;

    /* selettore */
    case "pk-close": closePicker(); break;
    case "pk-pick": {
      const cb = pickCb;
      closePicker();
      cb?.(d.id);
      break;
    }

    /* esercizi */
    case "ex-open":
      state.view = { name: "exercise", id: d.id };
      render();
      if (!state.histLoaded) loadHistory().then(render).catch(() => {}); // serve per il grafico dallo storico
      break;
    case "ex-new": state.view = { name: "exercise", id: null }; render(); break;
    case "ex-delete":
      if (!confirm("Eliminare questo esercizio? Verrà tolto anche dalle tue schede.")) return;
      guard(async () => {
        const { error } = await sb.from("exercises").delete().eq("id", d.id);
        if (error) throw error;
        await loadAll();
        state.view = null;
        render();
      });
      break;

    /* storico */
    case "hw-toggle":
      state.openWeeks.has(d.k) ? state.openWeeks.delete(d.k) : state.openWeeks.add(d.k);
      render();
      break;
    case "h-toggle":
      state.openWorkouts.has(d.id) ? state.openWorkouts.delete(d.id) : state.openWorkouts.add(d.id);
      render();
      break;
    case "h-delete": {
      const w = state.workouts.find((x) => x.id === d.id);
      const r = w && state.routines.find((x) => x.id === w.routine_id);
      // la settimana torna indietro solo se era avanzata proprio per questo allenamento
      const back = !!(r && w.week && r.current_week === w.week + 1 && !state.workouts.some((x) => x.id !== w.id && x.routine_id === w.routine_id && x.week === w.week));
      if (!confirm(back ? `Eliminare questo allenamento?\n${r.name} torna alla settimana ${w.week}.` : "Eliminare questo allenamento?")) return;
      guard(async () => {
        const { error } = await sb.from("workouts").delete().eq("id", d.id);
        if (error) throw error;
        if (back) {
          const u = await sb.from("routines").update({ current_week: w.week }).eq("id", r.id);
          if (u.error) throw u.error;
        }
        await loadAll();
        await loadHistory();
        await loadLast().catch(() => {});
        render();
      });
      break;
    }

    /* profilo */
    case "export":
      guard(async () => {
        const tables = ["exercises", "routines", "routine_exercises", "workouts", "workout_sets"];
        const out = { exported_at: new Date().toISOString(), email: state.user.email };
        for (const t of tables) {
          const { data, error } = await sb.from(t).select("*");
          if (error) throw error;
          out[t] = t === "exercises" ? data.filter((x) => x.owner) : data;
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
        const link = Object.assign(document.createElement("a"), { href: url, download: "palestra-dati.json" });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
      break;
    case "delete-account":
      if (!confirm("Eliminare definitivamente l'account e tutti i dati? Non si può annullare.")) return;
      guard(async () => {
        const { error } = await sb.rpc("delete_my_account");
        if (error) throw error;
        try { localStorage.removeItem(activeKey()); } catch {}
        await sb.auth.signOut();
        toast("Account eliminato");
      });
      break;
  }
});

// Campi che si aggiornano mentre scrivi, senza ridisegnare la pagina (così la tastiera non si chiude)
document.addEventListener("input", (ev) => {
  const el = ev.target;
  const b = el.dataset?.bind;
  if (!b) return;
  const d = el.dataset;
  switch (b) {
    case "r-name": state.view.routine.name = el.value; break;
    case "r-item": state.view.routine.items[d.i][d.f] = Math.max(0, Math.round(num(el.value))); break;
    case "w-set": state.active.exercises[d.e].sets[d.s][d.f] = el.value; persistActive(); break;
    case "w-rest": grpOf(Number(d.e)).forEach((m) => (state.active.exercises[m].rest = Math.max(0, Math.round(num(el.value))))); persistActive(); break;
    case "memo": setMemo(d.re, el.value); break;
    case "prog-name": state.view.title = el.value; { const b = document.querySelector(".phead b"); if (b) b.textContent = el.value.trim() || "Nome della scheda"; } break;
    case "imp-prog": state.view.programName = el.value; break;
    case "imp-name": state.view.routines[d.r].name = el.value; break;
    case "imp-week": state.view.routines[d.r].startWeek = Math.max(1, Math.round(num(el.value)) || 1); break;
    case "imp-match":
      state.view.routines[d.r].items[d.i].exId = el.value;
      render();
      break;
    case "ex-q":
      state.q = el.value;
      $("#ex-list").innerHTML = exListHTML(filteredExercises(), "ex-open");
      break;
    case "pk-q":
      $("#pk-list").innerHTML = exListHTML(filteredExercises(el.value, ""), "pk-pick");
      break;
  }
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  if (f.id === "auth-form") {
    ev.preventDefault();
    const mode = ev.submitter?.value || "login";
    const email = f.email.value.trim(), password = f.password.value;
    state.authMsg = null;
    const btns = f.querySelectorAll("button");
    btns.forEach((b) => (b.disabled = true));
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) state.authMsg = { err: true, text: "Email o password non corretti." };
    } else {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) state.authMsg = { err: true, text: "Non è stato possibile creare l'account: " + error.message };
      else if (!data.session) state.authMsg = { text: "Account creato. Controlla la tua email e conferma l'indirizzo, poi accedi." };
    }
    if (!state.user) renderAuth();
  }
  if (f.id === "ex-form") {
    ev.preventDefault();
    const fd = new FormData(f);
    guard(async () => {
      const { error } = await sb.from("exercises").insert({
        owner: state.user.id,
        name: fd.get("name").trim(),
        muscle_group: fd.get("muscle_group"),
        equipment: fd.get("equipment").trim() || null,
        instructions: fd.get("instructions").trim() || null,
        image_url: fd.get("image_url").trim() || null,
      });
      if (error) throw error;
      await loadAll();
      state.view = null;
      toast("Esercizio creato");
      render();
    });
  }
});

/* ------------------------------------------------------------------ */
/* Avvio                                                               */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Progressi per settimana e importazione da Excel                      */
/* ------------------------------------------------------------------ */
function progressHTML() {
  const r = state.routines.find((x) => x.id === state.view.id);
  if (!r) return `<p class="empty">Scheda non trovata.</p>`;
  const weeks = [...new Set(r.items.flatMap((it) => Object.keys(it.weeks || {}).map(Number)))].sort((a, b) => a - b);
  if (!weeks.length)
    return `<p class="empty">Ancora nessun dato. Dopo il primo allenamento di questa scheda vedrai qui i carichi di ogni settimana.</p>`;
  return (
    `<p class="hint">${esc(r.name)}: sei alla settimana ${r.current_week}. ▲ e ▼ indicano il peso rispetto alla settimana precedente.</p>` +
    r.items
      .map((it) => {
        const n = Math.max(it.target_sets, ...weeks.map((w) => it.weeks?.[w]?.length || 0));
        const head = weeks.map((w) => `<th class="${w === r.current_week ? "cur" : ""}">Sett. ${w}</th>`).join("");
        const body = Array.from({ length: n }, (_, i) => {
          const cells = weeks
            .map((w) => {
              const s = it.weeks?.[w]?.[i];
              if (!s) return `<td class="${w === r.current_week ? "cur" : ""}">-</td>`;
              const p = it.weeks?.[w - 1]?.[i];
              const mark = p ? (s.weight > p.weight ? ' <span class="up">▲</span>' : s.weight < p.weight ? ' <span class="down">▼</span>' : "") : "";
              return `<td class="${w === r.current_week ? "cur" : ""}">${kg(s.weight)}×${s.reps}${mark}</td>`;
            })
            .join("");
          return `<tr><th scope="row">${i + 1}</th>${cells}</tr>`;
        }).join("");
        const wp = weekPoints(it);
        return `<section class="card ${gCls(it.exercise_id)}"><h3>${esc(exName(it.exercise_id))}</h3>${it.notes ? `<p class="hint">${esc(it.notes)}</p>` : ""}
          ${lineChartHTML(wp.pts, wp.unit, wp.caption)}
          <div class="grid-wrap"><table class="grid"><thead><tr><th>Serie</th>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
      })
      .join("")
  );
}

async function getXLSX() {
  const m = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm");
  return m.default?.read ? m.default : m;
}

async function handleImportFile(file) {
  toast("Leggo il file…");
  const XLSX = await getXLSX();
  const routines = parseWorkbook(XLSX, await file.arrayBuffer(), state.exercises);
  if (!routines.length) return toast("Non ho trovato schede in questo file");
  state.tab = "home";
  state.view = { name: "import", file: file.name, programName: guessProgramName(file.name), routines };
  render();
}

function importHTML() {
  const v = state.view;
  const opts = (sel) =>
    `<option value="">Scegli…</option><option value="__new" ${sel === "__new" ? "selected" : ""}>Crea come nuovo esercizio</option>` +
    state.exercises.map((e) => `<option value="${e.id}" ${e.id === sel ? "selected" : ""}>${esc(e.name)}</option>`).join("");
  const missing = v.routines.reduce((n, r) => n + r.items.filter((i) => !i.exId).length, 0);
  return `<p class="hint">Ho letto <b>${v.routines.length}</b> giorni dal file «${esc(v.file)}». Verranno raccolti in un'unica scheda: controlla il nome, i collegamenti agli esercizi e la settimana di partenza, poi salva.</p>
    <label class="field">Nome della scheda<input data-bind="imp-prog" value="${esc(v.programName)}" maxlength="60"></label>
    ${v.routines
      .map(
        (r, ri) => `<section class="card">
        <label class="field">Nome del giorno<input data-bind="imp-name" data-r="${ri}" value="${esc(r.name)}"></label>
        <label class="field">Parti dalla settimana<input type="number" inputmode="numeric" min="1" value="${r.startWeek}" data-bind="imp-week" data-r="${ri}"></label>
        ${r.notes ? `<p class="hint" style="white-space:pre-line">${esc(r.notes)}</p>` : ""}
        ${r.items
          .map(
            (it, i) => `<div class="imp-row"><div><b>${esc(it.name)}</b>
            <small>${it.sets} serie, ${Object.keys(it.weeks).length} settimane di dati${it.raw !== it.name ? `, dal file: ${esc(it.raw)}` : ""}</small></div>
            <select data-bind="imp-match" data-r="${ri}" data-i="${i}" aria-label="Esercizio per ${esc(it.name)}">${opts(it.exId)}</select></div>`
          )
          .join("")}
      </section>`
      )
      .join("")}
    ${missing ? `<p class="msg err">${missing} esercizi non sono ancora collegati: scegli un esercizio o «Crea come nuovo esercizio».</p>` : ""}
    <p class="hint">Se importi lo stesso file due volte avrai la scheda doppia: potrai eliminare quella in più.</p>
    <button class="primary wide" data-act="imp-save">Importa la scheda</button>
    <button class="ghost wide" data-act="imp-cancel">Annulla</button>`;
}

async function saveImport() {
  const v = state.view;
  const uid = state.user.id;
  if (v.routines.some((r) => r.items.some((i) => !i.exId))) return toast("Collega tutti gli esercizi o scegli «Crea come nuovo»");
  if (!v.programName.trim()) return toast("Dai un nome alla scheda");
  if (v.routines.some((r) => !r.name.trim())) return toast("Ogni giorno deve avere un nome");

  const created = {};
  const createdRoutines = [];
  let programId = null;
  try {
    for (const r of v.routines)
      for (const it of r.items) {
        if (it.exId !== "__new") { it._id = it.exId; continue; }
        const nm = niceName(it.name);
        if (!created[nm]) {
          const { data, error } = await sb.from("exercises").insert({ owner: uid, name: nm, muscle_group: "Altro" }).select().single();
          if (error) throw error;
          created[nm] = data.id;
        }
        it._id = created[nm];
      }

    const pr = await sb.from("programs").insert({ name: v.programName.trim(), user_id: uid }).select().single();
    if (pr.error) throw pr.error;
    programId = pr.data.id;

    for (const r of v.routines) {
      const ro = await sb.from("routines").insert({ name: r.name.trim(), user_id: uid, program_id: programId, notes: r.notes || null, current_week: r.startWeek }).select().single();
      if (ro.error) throw ro.error;
      createdRoutines.push(ro.data.id);
      const gmap = {};
      const rows = r.items.map((it, i) => ({
        routine_id: ro.data.id,
        user_id: uid,
        exercise_id: it._id,
        position: i,
        target_sets: it.sets,
        target_reps: repsTarget(it.labels[0]) || 10,
        rest_seconds: it.rest,
        rep_targets: it.labels.join(" | "),
        notes: it.raw,
        superset_id: it.group ? (gmap[it.group] ||= crypto.randomUUID()) : null,
      }));
      const ins = await sb.from("routine_exercises").insert(rows).select("id,position");
      if (ins.error) throw ins.error;
      const idByPos = {};
      ins.data.forEach((x) => (idByPos[x.position] = x.id));
      const wrows = [];
      r.items.forEach((it, i) =>
        Object.entries(it.weeks).forEach(([w, sets]) =>
          sets.forEach((s, si) => {
            if (s) wrows.push({ user_id: uid, routine_exercise_id: idByPos[i], week: Number(w), set_number: si + 1, weight: s.weight, reps: s.reps });
          })
        )
      );
      for (let k = 0; k < wrows.length; k += 500) {
        const { error } = await sb.from("routine_week_sets").insert(wrows.slice(k, k + 500));
        if (error) throw error;
      }
    }
  } catch (e) {
    if (programId) await sb.from("programs").delete().eq("id", programId);
    throw e;
  }
  await loadAll();
  state.view = { name: "program", id: programId };
  state.tab = "home";
  toast("Scheda importata");
  render();
}

function guessProgramName(fileName) {
  const parts = fileName.replace(/\.[^.]+$/, "").split(/[_\-\s]+/).filter(Boolean);
  const pick = parts.length >= 3 ? parts[parts.length - 1] : parts.join(" ");
  return pick ? pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase() : "Scheda";
}

// Note per esercizio: mentre scrivi aggiorno lo stato, quando esci dal campo salvo nel database
function setMemo(reId, text) {
  state.routines.forEach((r) => r.items.forEach((it) => { if (it.id === reId) it.memo = text; }));
  const e = state.active?.exercises.find((x) => x.reId === reId);
  if (e) {
    e.memo = text;
    persistActive();
  }
}
async function saveMemo(reId, text) {
  const { error } = await sb.from("routine_exercises").update({ memo: text.trim() || null }).eq("id", reId);
  toast(error ? "Non sono riuscito a salvare la nota" : "Nota salvata");
}

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset?.bind === "memo") saveMemo(el.dataset.re, el.value);
  if (el.id === "imp-file" && el.files?.[0]) {
    const f = el.files[0];
    el.value = "";
    guard(() => handleImportFile(f), "Non riesco a leggere il file. Controlla che sia un Excel (.xlsx) e di avere connessione.");
  }
});

// Un allenamento iniziato prima delle superserie non ha il gruppo: lo prende dalla scheda
function syncActiveGroups() {
  const a = state.active;
  if (!a?.exercises) return;
  const sup = {};
  state.routines.forEach((r) => r.items.forEach((i) => (sup[i.id] = i.superset_id || null)));
  let changed = false;
  a.exercises.forEach((e) => {
    if (e.group === undefined && e.reId && e.reId in sup) {
      e.group = sup[e.reId];
      changed = true;
    }
  });
  if (changed) persistActive();
}

async function setUser(u) {
  state.user = u;
  if (u) {
    state.active = loadActive();
    try { await loadAll(); } catch (e) { console.error(e); toast("Non riesco a caricare i dati. Controlla la connessione."); }
    await loadLast().catch(() => {});
    syncActiveGroups();
  } else {
    state.active = null;
    state.view = null;
    state.tab = "home";
    stopTimer();
  }
  render();
}

async function init() {
  if (!configured) return render();
  const { data } = await sb.auth.getSession();
  await setUser(data.session?.user ?? null);
  sb.auth.onAuthStateChange((_ev, session) => {
    const id = session?.user?.id ?? null;
    if (id !== (state.user?.id ?? null)) setTimeout(() => setUser(session?.user ?? null), 0);
  });
}
init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  // Quando arriva una versione nuova dell'app la carico subito, senza dover aprire l'app due volte.
  // Durante un allenamento non ricarico (il timer si perderebbe): avviso e basta.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    if (state.active) return toast("Nuova versione pronta: riapri l'app a fine allenamento");
    reloaded = true;
    location.reload();
  });
}

-- =====================================================================
-- SCHEMA DATABASE APP PALESTRA
-- Da incollare nel "SQL Editor" di Supabase ed eseguire (pulsante Run).
-- =====================================================================

-- ---------- Tabelle ----------

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  owner uuid references auth.users(id) on delete cascade,  -- NULL = esercizio comune a tutti
  name text not null,
  muscle_group text not null,
  equipment text,
  instructions text,
  image_url text,
  created_at timestamptz not null default now()
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.routine_exercises (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  position int not null default 0,
  target_sets int not null default 3,
  target_reps int not null default 10,
  rest_seconds int not null default 90
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid references public.routines(id) on delete set null,
  name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  notes text
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id uuid references public.exercises(id) on delete set null,
  exercise_name text not null,
  set_number int not null,
  weight numeric not null default 0,
  reps int not null default 0,
  rest_seconds int,
  created_at timestamptz not null default now()
);

create index on public.routine_exercises (routine_id);
create index on public.workouts (user_id, started_at desc);
create index on public.workout_sets (workout_id);
create index on public.workout_sets (user_id, exercise_id, created_at desc);

-- ---------- Sicurezza: ognuno vede solo i propri dati ----------

alter table public.exercises         enable row level security;
alter table public.routines          enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.workouts          enable row level security;
alter table public.workout_sets      enable row level security;

-- Esercizi: leggi quelli comuni + i tuoi; modifichi solo i tuoi
create policy "exercises_select" on public.exercises
  for select to authenticated using (owner is null or owner = auth.uid());
create policy "exercises_insert" on public.exercises
  for insert to authenticated with check (owner = auth.uid());
create policy "exercises_update" on public.exercises
  for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "exercises_delete" on public.exercises
  for delete to authenticated using (owner = auth.uid());

-- Tutte le altre tabelle: accesso solo alle proprie righe
create policy "routines_all" on public.routines
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "routine_exercises_all" on public.routine_exercises
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "workouts_all" on public.workouts
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "workout_sets_all" on public.workout_sets
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Cancellazione account (richiesta GDPR) ----------
-- Permette a ogni utente di eliminare il proprio account e tutti i suoi dati.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- Esercizi iniziali (comuni a tutti) ----------

insert into public.exercises (name, muscle_group, equipment, instructions) values
-- Petto
('Panca piana con bilanciere', 'Petto', 'Bilanciere', 'Sdraiati sulla panca con i piedi a terra e le scapole addotte. Scendi con il bilanciere al centro del petto, gomiti a circa 45-60 gradi dal busto, poi spingi verso l''alto.'),
('Panca inclinata con manubri', 'Petto', 'Manubri', 'Panca inclinata a 30 gradi. Scendi controllando i manubri ai lati del petto alto e spingi riavvicinandoli senza farli sbattere.'),
('Croci ai cavi', 'Petto', 'Cavi', 'Con i cavi all''altezza delle spalle, porta le mani davanti al petto con i gomiti leggermente flessi. Torna indietro lentamente sentendo l''allungamento.'),
('Push-up (flessioni)', 'Petto', 'Corpo libero', 'Mani poco più larghe delle spalle, corpo in linea retta. Scendi fino a sfiorare il pavimento con il petto e risali.'),
('Dip alle parallele', 'Petto', 'Parallele', 'Busto leggermente inclinato in avanti. Scendi fino a che le spalle sono all''altezza dei gomiti e risali senza bloccare i gomiti in alto.'),
-- Schiena
('Trazioni alla sbarra', 'Schiena', 'Sbarra', 'Presa poco più larga delle spalle. Parti da braccia tese, porta il mento sopra la sbarra tirando i gomiti verso i fianchi.'),
('Lat machine', 'Schiena', 'Macchina', 'Siediti bloccando le cosce. Tira la barra verso la parte alta del petto, spingendo il petto in fuori e senza dondolare.'),
('Rematore con bilanciere', 'Schiena', 'Bilanciere', 'Busto inclinato in avanti con schiena neutra. Tira il bilanciere verso l''ombelico portando i gomiti indietro.'),
('Rematore con manubrio', 'Schiena', 'Manubrio', 'Un ginocchio e una mano appoggiati sulla panca. Tira il manubrio verso l''anca con il gomito vicino al corpo.'),
('Stacco da terra', 'Schiena', 'Bilanciere', 'Piedi larghi come le anche, bilanciere sopra il centro del piede. Schiena neutra, spingi il pavimento con le gambe e porta le anche in avanti fino a stare in piedi.'),
('Pulley basso', 'Schiena', 'Cavi', 'Seduto con busto eretto, tira la maniglia verso l''addome stringendo le scapole, poi torna lentamente.'),
-- Spalle
('Military press con bilanciere', 'Spalle', 'Bilanciere', 'In piedi, bilanciere all''altezza delle clavicole. Spingi sopra la testa contraendo glutei e addome, senza inarcare la schiena.'),
('Lento avanti con manubri', 'Spalle', 'Manubri', 'Seduto con schienale a 80-90 gradi. Spingi i manubri sopra la testa e scendi fino all''altezza delle orecchie.'),
('Alzate laterali', 'Spalle', 'Manubri', 'Braccia leggermente flesse, solleva i manubri lateralmente fino all''altezza delle spalle e scendi lentamente.'),
('Face pull', 'Spalle', 'Cavi', 'Con la corda all''altezza del viso, tira verso la fronte aprendo i gomiti all''esterno e ruotando le spalle indietro.'),
-- Bicipiti
('Curl con bilanciere', 'Bicipiti', 'Bilanciere', 'In piedi, gomiti fermi ai fianchi. Fletti i gomiti portando il bilanciere verso le spalle e scendi lentamente.'),
('Curl con manubri alternato', 'Bicipiti', 'Manubri', 'Alterna le braccia ruotando il polso verso l''alto durante la salita. Evita di dondolare con il busto.'),
('Curl a martello', 'Bicipiti', 'Manubri', 'Presa neutra (palmi uno di fronte all''altro). Fletti il gomito senza ruotare il polso.'),
-- Tricipiti
('French press con bilanciere EZ', 'Tricipiti', 'Bilanciere EZ', 'Sdraiato, braccia verticali. Fletti solo i gomiti portando il bilanciere verso la fronte, poi estendi.'),
('Pushdown ai cavi', 'Tricipiti', 'Cavi', 'Gomiti fermi ai fianchi. Spingi la barra o la corda verso il basso fino a estendere completamente le braccia.'),
('Estensioni sopra la testa con manubrio', 'Tricipiti', 'Manubrio', 'Tieni il manubrio con due mani dietro la testa. Estendi i gomiti verso l''alto mantenendoli fermi e vicini.'),
-- Gambe
('Squat con bilanciere', 'Gambe', 'Bilanciere', 'Bilanciere sui trapezi, piedi larghi come le spalle. Scendi spingendo le anche indietro e le ginocchia in linea con i piedi, poi risali spingendo il pavimento.'),
('Leg press', 'Gambe', 'Macchina', 'Piedi a metà pedana, larghezza spalle. Scendi fino a circa 90 gradi di flessione senza staccare il bacino dallo schienale.'),
('Affondi con manubri', 'Gambe', 'Manubri', 'Fai un passo avanti e scendi fino a che entrambe le ginocchia sono a circa 90 gradi. Spingi con il piede davanti per tornare su.'),
('Leg extension', 'Gambe', 'Macchina', 'Siediti regolando lo schienale. Estendi le ginocchia contraendo i quadricipiti e scendi lentamente.'),
('Leg curl', 'Gambe', 'Macchina', 'Fletti le ginocchia portando i talloni verso i glutei, poi torna lentamente alla posizione iniziale.'),
('Stacco rumeno', 'Gambe', 'Bilanciere', 'Ginocchia leggermente flesse. Spingi le anche indietro facendo scendere il bilanciere vicino alle gambe fino a sentire allungare i femorali, poi risali.'),
('Calf raise in piedi', 'Gambe', 'Macchina', 'Sali sulle punte il più in alto possibile, fermati un istante e scendi con allungamento completo.'),
-- Glutei
('Hip thrust', 'Glutei', 'Bilanciere', 'Schiena alta appoggiata alla panca, bilanciere sulle anche. Spingi le anche in alto fino ad allineare busto e cosce, contraendo i glutei.'),
('Glute bridge', 'Glutei', 'Corpo libero', 'Sdraiato con ginocchia flesse, spingi le anche verso l''alto contraendo i glutei e scendi senza appoggiare del tutto.'),
('Calci ai cavi', 'Glutei', 'Cavi', 'Con la cavigliera, spingi la gamba indietro con il ginocchio quasi esteso senza inarcare la zona lombare.'),
-- Core
('Plank', 'Core', 'Corpo libero', 'Appoggio su avambracci e punte dei piedi, corpo in linea retta. Contrai addome e glutei e mantieni la posizione.'),
('Crunch', 'Core', 'Corpo libero', 'Sdraiato con ginocchia flesse, solleva spalle e parte alta della schiena contraendo l''addome, poi scendi lentamente.'),
('Sollevamento gambe alla sbarra', 'Core', 'Sbarra', 'Appeso alla sbarra, solleva le gambe tese o flesse fino all''altezza delle anche senza dondolare.'),
('Russian twist', 'Core', 'Corpo libero', 'Seduto con busto inclinato indietro e piedi sollevati, ruota il busto da un lato all''altro.'),
-- Cardio
('Corsa sul tapis roulant', 'Cardio', 'Macchina', 'Mantieni un ritmo costante o alterna fasi veloci e lente. Inserisci distanza o durata nelle note dell''allenamento.'),
('Cyclette', 'Cardio', 'Macchina', 'Regola la sella all''altezza delle anche. Pedala a ritmo costante o a intervalli.'),
('Vogatore', 'Cardio', 'Macchina', 'Spingi con le gambe, poi indietro con il busto e infine tira con le braccia. Ritorna nell''ordine inverso.');

-- =====================================================================
-- AGGIORNAMENTO: settimane per scheda e importazione da Excel
-- (già applicato al progetto; serve solo se ricrei il database da zero)
-- =====================================================================

alter table public.routines
  add column current_week int not null default 1,
  add column notes text;

alter table public.routine_exercises
  add column rep_targets text,
  add column notes text;

alter table public.workouts
  add column week int;

create table public.routine_week_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_exercise_id uuid not null references public.routine_exercises(id) on delete cascade,
  week int not null,
  set_number int not null,
  weight numeric not null default 0,
  reps int not null default 0,
  unique (routine_exercise_id, week, set_number)
);

create index on public.routine_week_sets (user_id);

alter table public.routine_week_sets enable row level security;

create policy "routine_week_sets_all" on public.routine_week_sets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Esercizi aggiunti dopo la versione iniziale: chest press, low row monolaterale,
-- curl al cavo basso, hack squat, shoulder press, pec fly, panca piana con manubri,
-- leg curl sdraiato, alzate laterali al cavo basso, spider curl.

-- =====================================================================
-- AGGIORNAMENTO: scheda con più giorni e note per esercizio
-- (già applicato al progetto; serve solo se ricrei il database da zero,
--  e solo se non ci sono ancora righe in "routines")
-- =====================================================================

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index on public.programs (user_id);

alter table public.programs enable row level security;

create policy "programs_all" on public.programs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter table public.routines
  add column program_id uuid not null references public.programs(id) on delete cascade;

create index on public.routines (program_id);

alter table public.routine_exercises
  add column memo text;

-- Superserie: esercizi con lo stesso superset_id (consecutivi) si fanno insieme
alter table public.routine_exercises add column if not exists superset_id uuid;

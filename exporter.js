// Esportazione delle schede in Excel (.xlsx), nello stesso formato del file originale:
// un foglio per giorno, titolo, intestazione, una riga per serie, peso e ripetizioni per ogni settimana.
// Il file viene costruito qui (XML + archivio zip), senza librerie esterne.

const enc = new TextEncoder();

/* ------------------------------------------------------------------ zip (senza compressione) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // nomi in UTF-8
    h.setUint16(10, dosTime, true);
    h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ------------------------------------------------------------------ stili (come il file originale) */
const S = { title: 1, head: 2, name: 3, cell: 4, week: 5, note: 6 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF1F4E78"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF203864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="medium"/><bottom style="thin"/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ------------------------------------------------------------------ utilità */
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (n) => {
  let s = "";
  for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const kg = (w) => (w === null || w === undefined || w === "" || Number(w) === 0 ? "" : `${String(Number(w)).replace(".", ",")}kg`);

// gruppi di esercizi consecutivi con lo stesso superset_id
function blocks(items) {
  const out = [];
  items.forEach((it) => {
    const last = out[out.length - 1];
    if (it.superset_id && last && last[0].superset_id === it.superset_id) last.push(it);
    else out.push([it]);
  });
  return out;
}
const target = (it, i) => {
  const t = (it.rep_targets || "").split("|").map((s) => s.trim()).filter(Boolean);
  return t[i] ?? t[t.length - 1] ?? (it.target_reps ? String(it.target_reps) : "");
};

/* ------------------------------------------------------------------ foglio di un giorno */
function sheetXML(prog, day, weeks) {
  const last = 3 + weeks * 2; // ultima colonna (indice da 0)
  const rows = new Map();
  const merges = [];
  const heights = {};
  const put = (r, c, v, s, num = false) => {
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push({ c, v, s, num });
  };
  const box = (r1, r2, c1, c2, s) => {
    // le celle unite hanno lo stesso stile, così il bordo si vede su tutto il riquadro
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) put(r, c, "", s);
    if (r1 !== r2 || c1 !== c2) merges.push(`${col(c1)}${r1}:${col(c2)}${r2}`);
  };

  put(1, 0, `${prog.name} — ${day.name}`.toUpperCase(), S.title);
  box(1, 1, 0, last, S.title);
  heights[1] = 28;
  const head = ["ESERCIZIO", "SERIE", "REPS PRESCRITTE", "RECUPERO"];
  for (let w = 1; w <= weeks; w++) head.push(`SETT ${w} — PESO`, `SETT ${w} — REPS`);
  head.forEach((h, c) => put(3, c, h, S.head));
  heights[3] = 32;

  let r = 4;
  const notes = (day.notes || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:]{1,30}):\s*(.*)$/);
    return m ? { label: m[1].trim(), text: m[2] } : { label: "Note", text: l };
  });
  const noteRow = (n) => {
    put(r, 0, n.label.toUpperCase(), S.name);
    put(r, 1, n.text, S.note);
    box(r, r, 1, last, S.note);
    heights[r] = 22;
    r++;
  };
  notes.filter((n) => !/cardio/i.test(n.label)).forEach(noteRow);

  for (const b of blocks(day.items)) {
    const n = Math.max(1, ...b.map((it) => Math.max(it.target_sets || 0, ...Object.values(it.weeks || {}).map((s) => s.length))));
    const sameRaw = b.every((it) => it.raw && it.raw === b[0].raw);
    const name = b.length === 1 ? b[0].raw || b[0].name.toUpperCase() : sameRaw ? b[0].raw : b.map((it) => it.name.toUpperCase()).join("+");
    const rest = Math.max(...b.map((it) => it.rest_seconds || 0));
    const r1 = r;
    for (let i = 0; i < n; i++, r++) {
      const tg = b.map((it) => target(it, i)).filter(Boolean).join("+");
      heights[r] = tg.length > 16 ? 32 : 22; // testo lungo nelle reps prescritte: riga più alta
      put(r, 1, i + 1, S.cell, true);
      put(r, 2, tg, S.cell);
      for (let w = 1; w <= weeks; w++) {
        const sets = b.map((it) => it.weeks?.[w]?.[i]).filter(Boolean);
        const c = 2 + w * 2;
        put(r, c, sets.map((s) => kg(s.weight)).filter(Boolean).join("+"), S.week);
        if (b.length === 1 && sets[0] && sets[0].reps !== null && sets[0].reps !== undefined) put(r, c + 1, Number(sets[0].reps), S.week, true);
        else put(r, c + 1, sets.map((s) => s.reps).filter((v) => v !== null && v !== undefined).join("+"), S.week);
      }
    }
    put(r1, 0, name, S.name);
    box(r1, r - 1, 0, 0, S.name);
    put(r1, 3, rest ? `${rest}"` : "", S.cell);
    box(r1, r - 1, 3, 3, S.cell);
  }
  notes.filter((n) => /cardio/i.test(n.label)).forEach(noteRow);

  const widths = [36, 8, 16, 12];
  for (let w = 1; w <= weeks; w++) widths.push(13, 11);
  const sheetData = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((rn) => {
      const cells = rows
        .get(rn)
        .sort((a, b) => a.c - b.c)
        .map(({ c, v, s, num }) => {
          const ref = `${col(c)}${rn}`;
          if (num && v !== "" && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
          if (v === "" || v === null || v === undefined) return `<c r="${ref}" s="${s}"/>`;
          return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
        })
        .join("");
      const ht = heights[rn] ? ` ht="${heights[rn]}" customHeight="1"` : "";
      return `<row r="${rn}"${ht}>${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${sheetData}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

/* ------------------------------------------------------------------ file completo */
// programs: [{ name, days: [{ name, notes, current_week, items: [{ name, raw, superset_id, target_sets, target_reps, rep_targets, rest_seconds, weeks }] }] }]
export function buildXlsx(programs) {
  const sheets = [];
  const used = new Set();
  const single = programs.length === 1;
  for (const p of programs) {
    // tutte le settimane con dati, più quella in corso (vuota, da compilare)
    const weeks = Math.max(
      1,
      ...p.days.map((d) => Math.max(d.current_week || 1, ...d.items.flatMap((it) => Object.keys(it.weeks || {}).map(Number))))
    );
    for (const d of p.days) {
      let name = (single ? d.name.toUpperCase() : `${p.name} - ${d.name}`).replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Foglio";
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${name.slice(0, 26)} (${k})`;
      used.add(name.toLowerCase());
      sheets.push({ name, xml: sheetXML(p, d, weeks) });
    }
  }
  if (!sheets.length) throw new Error("Nessun giorno da esportare");
  const files = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: "xl/styles.xml", text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ];
  return zip(files);
}

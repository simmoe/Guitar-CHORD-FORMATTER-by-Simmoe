/**
 * Engangs-migration v1/v2 → v3 → v4.
 *
 * v3-modellen er WYSIWYG: chord-linjen i `rawInput` og bass-linjen i
 * `bassLines[rowIdx]` er literal pipe-notation. Tidligere versioner
 * havde auto-fordeling, slot-format, `chordNudges`, `barEdits` og
 * `bassEdits` — alt sammen runtime-deriveret. Vi "fryser" det aktuelle
 * visuelle output ind i den nye literal-form ÉN gang, og smider de
 * gamle felter væk.
 *
 * v4-modellen gør `rows: Row[]` kanonisk: brugerens kind-valg per
 * række (chord/lyric/header/blank) persisteres direkte, så manuelle
 * type-skift (fx via gutter-dropdown) overlever load. `rawInput`
 * bevares som læsbar fallback.
 *
 * Migration er idempotent: kør på v4 → ingen ændring.
 */
import type { SongDoc } from './types';
import { CHORD_PATTERN, isSectionHeader, normalizeAccidentals, transposeChord } from './chordFormatter';
import { parseRows } from './songParse';

const V3 = 3;
const V4 = 4;

/**
 * Legacy-aware chord-line detection: i v1/v2 kunne en chord-linje
 * indeholde `-` (slot-placeholders), `*`/`**` (footnote-markers),
 * `N.C.` osv. Vi smider dem væk inden vi tester. Bruges KUN under
 * migration til at klassificere rækker som chord vs. lyric, så vi
 * kan distribuere indholdet korrekt før det fryses ned i v3-form.
 */
function legacyIsChordLine(line: string): boolean {
	const stripped = line
		.replace(/\*+/g, ' ')
		.replace(/\bN\.?C\.?\b/gi, ' ')
		.replace(/(?:^|\s)-+(?=\s|$)/g, ' ')
		.replace(/\|/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (!stripped) return false;
	const rx = new RegExp(`^${CHORD_PATTERN}(\\s+${CHORD_PATTERN})*$`);
	return rx.test(stripped);
}

// Legacy felter vi læser men ikke længere persisterer.
type LegacySong = SongDoc & {
	barEdits?: Record<string, 'bar' | 'space'>;
	bassEdits?: Record<string, string | null>;
	chordNudges?: Record<string, number>;
};

/**
 * Migrer ÉT dokument til seneste skema (v4). Idempotent.
 * Først v1/v2 → v3 (frys auto-output ind i literal pipe-notation),
 * derefter v3 → v4 (populér `rows` fra `rawInput`).
 */
export function migrateSong(input: SongDoc): SongDoc {
	return migrateToV4(migrateToV3(input));
}

/**
 * v3 → v4: udled `rows` fra `rawInput` ÉN gang. Fra og med v4 er
 * `rows` autoritativ; `rawInput` opdateres kun via `serializeRows`
 * ved save og fungerer som læsbar fallback.
 */
export function migrateToV4(input: SongDoc): SongDoc {
	const v = input.schemaVersion ?? 1;
	if (v >= V4 && input.rows && input.rows.length > 0) return input;
	return {
		...input,
		rows: parseRows(input.rawInput ?? ''),
		schemaVersion: V4
	};
}

/** Migrer ÉT dokument. Returnér uændret hvis allerede v3. */
export function migrateToV3(input: SongDoc): SongDoc {
	const legacy = input as LegacySong;
	if ((legacy.schemaVersion ?? 1) >= V3) {
		return stripLegacyFields(legacy);
	}

	// Step 1: hvis < v2, remap row-keyed dictionaries fra "pair-index"
	// til "split-index" (chord-linjen er nu sin egen row).
	const v1ToV2 = (legacy.schemaVersion ?? 1) < 2;
	const rowMap = v1ToV2 ? buildPairToSplitRowMap(legacy.rawInput) : null;
	const remap = <V,>(m: Record<string, V> | undefined): Record<string, V> | undefined => {
		if (!m || !rowMap) return m;
		const out: Record<string, V> = {};
		for (const [k, v] of Object.entries(m)) {
			const colon = k.indexOf(':');
			const oldRow = Number(colon === -1 ? k : k.slice(0, colon));
			if (!Number.isFinite(oldRow)) continue;
			const newRow = rowMap[oldRow];
			if (newRow === undefined) continue;
			out[colon === -1 ? String(newRow) : `${newRow}${k.slice(colon)}`] = v;
		}
		return out;
	};

	const chordNudges = remap(legacy.chordNudges) ?? {};
	const barEdits = remap(legacy.barEdits) ?? {};
	const bassEdits = remap(legacy.bassEdits) ?? {};
	const bassLines: Record<string, string> = { ...(remap(legacy.bassLines) ?? {}) };

	// Step 2: walk linjerne og frys output ind i rawInput + bassLines.
	const lines = legacy.rawInput.split('\n');
	const rows = parseRowsForMigration(lines);
	const newLines = [...lines];
	const barsPerLine = legacy.barsPerLine ?? 4;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.kind !== 'chord') continue;

		// 2a: hvis brugeren havde nudges på denne række (eller chord-line
		//     stadig var i slot-format), distribuér NU og skriv resultatet
		//     tilbage som chord-rækkens line.
		const next = rows[i + 1];
		const lyric = next?.kind === 'lyric' ? next.text : '';
		const nudges = collectRowNudges(chordNudges, i);
		const baked = bakeChordLine(row.text, lyric, nudges);
		if (baked !== row.text) newLines[row.lineNo] = baked;

		// 2b: hvis ingen bass-line er sat, generér én fra (gammel) auto +
		//     bassEdits og gem.
		const key = String(i);
		if (typeof bassLines[key] === 'string' && bassLines[key].trim() !== '') continue;
		const auto = legacyComputeBassLine(row.text, lyric, barsPerLine, bassEdits, i);
		if (auto.trim() !== '') bassLines[key] = auto;
	}

	const merged: SongDoc = {
		...legacy,
		rawInput: newLines.join('\n'),
		bassLines: Object.keys(bassLines).length > 0 ? bassLines : undefined,
		schemaVersion: V3
	};
	return stripLegacyFields(merged);
}

function stripLegacyFields(s: LegacySong): SongDoc {
	// Fjern legacy-felter fra det returnerede objekt så resten af appen
	// aldrig ser dem (de findes stadig i Firestore indtil næste save).
	const { barEdits: _be, bassEdits: _bes, chordNudges: _cn, ...rest } = s;
	return rest;
}

// ──────────────────────────────────────────────────────────────────────
// Row-walker brugt udelukkende af migrationen
// ──────────────────────────────────────────────────────────────────────
type MigrationRow =
	| { kind: 'blank'; lineNo: number }
	| { kind: 'header'; lineNo: number; text: string }
	| { kind: 'chord'; lineNo: number; text: string }
	| { kind: 'lyric'; lineNo: number; text: string };

function parseRowsForMigration(lines: string[]): MigrationRow[] {
	const rows: MigrationRow[] = [];
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		if (line.trim() === '') rows.push({ kind: 'blank', lineNo: n });
		else if (isSectionHeader(line)) rows.push({ kind: 'header', lineNo: n, text: line });
		else if (legacyIsChordLine(line)) rows.push({ kind: 'chord', lineNo: n, text: line });
		else rows.push({ kind: 'lyric', lineNo: n, text: line });
	}
	return rows;
}

/** v1 (chord+lyric var ÉN row) → v2 split-mapping. */
function buildPairToSplitRowMap(rawInput: string): Record<number, number> {
	const lines = rawInput.split('\n');
	const map: Record<number, number> = {};
	let oldIdx = 0;
	let newIdx = 0;
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || isSectionHeader(line)) {
			map[oldIdx++] = newIdx++;
			i++;
			continue;
		}
		if (legacyIsChordLine(line)) {
			const next = i + 1 < lines.length ? lines[i + 1] : '';
			const nextIsLyric = next.trim() !== '' && !isSectionHeader(next) && !legacyIsChordLine(next);
			if (nextIsLyric) {
				map[oldIdx++] = newIdx;
				newIdx += 2;
				i += 2;
				continue;
			}
		}
		map[oldIdx++] = newIdx++;
		i++;
	}
	return map;
}

// ──────────────────────────────────────────────────────────────────────
// Legacy chord-line distribution
// ──────────────────────────────────────────────────────────────────────
const CHORD_SLOTS = 8;
const CHORD_RX = new RegExp(CHORD_PATTERN, 'g');
const CHORD_TOK = new RegExp(`^${CHORD_PATTERN}$`);

function collectRowNudges(nudges: Record<string, number>, rowIdx: number): number[] {
	const out: number[] = [];
	const prefix = `${rowIdx}:`;
	for (const [k, v] of Object.entries(nudges)) {
		if (!k.startsWith(prefix)) continue;
		const idx = Number(k.slice(prefix.length));
		if (Number.isFinite(idx)) out[idx] = v;
	}
	return out;
}

function isSlotFormat(line: string): boolean {
	const tokens = line.trim().split(/\s+/);
	return tokens.length > 1 && tokens.some((t) => t === '-');
}

/**
 * Frys en chord-line til literal monospace fordelt over lyric-bredden
 * (eller eksakte slot-positioner hvis input var slot-format). Hvis
 * der hverken er nudges, slot-format eller lyric → returnér linjen som
 * den er.
 */
function bakeChordLine(chordLine: string, lyric: string, nudges: number[]): string {
	if (chordLine.includes('|')) return chordLine; // pipe-notation = allerede WYSIWYG
	const slot = isSlotFormat(chordLine);
	if (!slot && nudges.length === 0 && lyric === '') return chordLine;

	const placed = placeChords(chordLine, lyric, nudges, slot);
	if (placed.length === 0) return chordLine;
	let out = '';
	for (const p of placed) {
		if (p.col > out.length) out += ' '.repeat(p.col - out.length);
		else if (out.length > 0) out += ' ';
		out += p.name;
	}
	return out.replace(/\s+$/, '');
}

function placeChords(
	chordLine: string,
	lyricLine: string,
	nudges: number[],
	slotFormatHint: boolean
): { name: string; col: number }[] {
	const L = Math.max(1, lyricLine.length || chordLine.length || 1);

	if (slotFormatHint) {
		const tokens = chordLine.trim().split(/\s+/);
		const slots = tokens.length;
		const slotWidth = L / slots;
		const placed: { name: string; col: number }[] = [];
		let cursor = 0;
		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i];
			if (tok === '-' || tok === '' || !CHORD_TOK.test(tok)) continue;
			const name = normalizeAccidentals(tok);
			let target = Math.round(i * slotWidth);
			if (target < cursor) target = cursor;
			placed.push({ name, col: target });
			cursor = target + name.length + 1;
		}
		return placed;
	}

	const chords: string[] = [];
	let m: RegExpExecArray | null;
	CHORD_RX.lastIndex = 0;
	while ((m = CHORD_RX.exec(chordLine)) !== null) chords.push(normalizeAccidentals(m[0]));
	if (chords.length === 0) return [];

	const slotWidth = L / CHORD_SLOTS;
	const placed: { name: string; col: number }[] = [];
	let cursor = 0;
	for (let i = 0; i < chords.length; i++) {
		const baseSlot = Math.round((i * CHORD_SLOTS) / chords.length);
		const nudge = nudges[i] ?? 0;
		const slot = Math.max(0, Math.min(CHORD_SLOTS - 1, baseSlot + nudge));
		let target = Math.round(slot * slotWidth);
		if (target < cursor) target = cursor;
		placed.push({ name: chords[i], col: target });
		cursor = target + chords[i].length + 1;
	}
	return placed;
}

// ──────────────────────────────────────────────────────────────────────
// Legacy bass-line auto-generering
// ──────────────────────────────────────────────────────────────────────

function chordToBassName(fullChord: string): string {
	let tone = fullChord;
	if (fullChord.includes('/')) {
		tone = fullChord.split('/')[1];
	} else {
		const rootMatch = fullChord.match(/^[A-G][#b]?/);
		if (rootMatch) tone = rootMatch[0];
	}
	return transposeChord(tone, 0);
}

function buildLegacyBars(chordLine: string, refLine: string, barsPerLine: number): string[][] {
	if (chordLine.includes('|')) {
		const segments = chordLine
			.split('|')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		const bars = segments.map((seg) => {
			const names: string[] = [];
			let m: RegExpExecArray | null;
			CHORD_RX.lastIndex = 0;
			while ((m = CHORD_RX.exec(seg)) !== null) names.push(chordToBassName(m[0]));
			return names;
		});
		fillEmpty(bars);
		return bars;
	}

	const chordsWithPos: { name: string; pos: number }[] = [];
	let m: RegExpExecArray | null;
	CHORD_RX.lastIndex = 0;
	while ((m = CHORD_RX.exec(chordLine)) !== null) {
		chordsWithPos.push({ name: chordToBassName(m[0]), pos: m.index });
	}
	if (chordsWithPos.length === 0) return [];

	const refLen = refLine.length;
	const lastPos = chordsWithPos[chordsWithPos.length - 1].pos;
	const gaps: number[] = [];
	for (let g = 1; g < chordsWithPos.length; g++) {
		gaps.push(chordsWithPos[g].pos - chordsWithPos[g - 1].pos);
	}
	const avgGap = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
	const positionalLen = lastPos + Math.max(avgGap, 3);
	const lineLen = Math.max(chordLine.length, refLen, positionalLen, 1);
	const barWidth = lineLen / barsPerLine;

	const bars: string[][] = [];
	for (let b = 0; b < barsPerLine; b++) bars.push([]);
	for (const c of chordsWithPos) {
		const barIdx = Math.min(Math.floor(c.pos / barWidth), barsPerLine - 1);
		bars[barIdx].push(c.name);
	}
	fillEmpty(bars);
	return bars;
}

function fillEmpty(bars: string[][]): void {
	let lastChord: string | null = null;
	for (const bar of bars) {
		if (bar.length === 0 && lastChord) bar.push(lastChord);
		else if (bar.length > 0) lastChord = bar[bar.length - 1];
	}
	if (lastChord) {
		for (const bar of bars) if (bar.length === 0) bar.push(lastChord);
	}
}

/**
 * Beregn den auto-genererede bass-linje (samme algoritme som legacy
 * `computeAutoBassLine`), anvend `bassEdits` for samme række, og
 * returnér en pipe-notations-streng. Tom streng hvis ingen akkorder.
 */
function legacyComputeBassLine(
	chordLine: string,
	lyric: string,
	barsPerLine: number,
	bassEdits: Record<string, string | null>,
	rowIdx: number
): string {
	const bars = buildLegacyBars(chordLine, lyric, barsPerLine);
	if (bars.length === 0) return '';
	const effective = bars.map((bar, barIdx) =>
		bar
			.map((name, chordIdx) => {
				const key = `${rowIdx}:${barIdx}:${chordIdx}`;
				const override = bassEdits[key];
				if (override === null) return null;
				return typeof override === 'string' ? override : name;
			})
			.filter((x): x is string => x !== null)
	);
	return effective
		.map((bar) => bar.join(' '))
		.filter((s) => s.length > 0)
		.join(' | ');
}

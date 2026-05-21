/**
 * Strukturerede rows til contenteditable-editor.
 *
 * Fra og med skema v4 er `Row[]` sangens kanoniske form i Firestore.
 * `parseRows`/`serializeRows` bruges nu kun til engangs-konvertering
 * ved import (UG-fetch eller manuel paste fra ekstern kilde) og som
 * migration-helper. `rawInput` bevares som læsbar fallback i
 * dokumentet og holdes i sync ved save via `serializeRows`.
 */
import { cleanSectionHeader, isChordLine, isSectionHeader, sectionHeaderType, transposeBassLine } from './chordFormatter';

export type Row =
	| { kind: 'blank' }
	| { kind: 'header'; text: string }
	| { kind: 'chord'; text: string }
	| { kind: 'lyric'; text: string };

export function parseRows(rawInput: string): Row[] {
	const lines = rawInput.split('\n');
	const rows: Row[] = [];
	for (const line of lines) {
		if (line.trim() === '') {
			rows.push({ kind: 'blank' });
			continue;
		}
		if (isSectionHeader(line)) {
			rows.push({ kind: 'header', text: cleanSectionHeader(line) });
			continue;
		}
		if (isChordLine(line)) {
			rows.push({ kind: 'chord', text: line });
			continue;
		}
		rows.push({ kind: 'lyric', text: line });
	}
	return rows;
}

const IMPORTED_CHORD_GAP_WIDTH = 5;

function replaceWideChordGaps(line: string): string {
	return line
		.trim()
		.replace(/\s{3,}/g, (gap) => {
			const spacerCount = Math.max(1, Math.round(gap.length / IMPORTED_CHORD_GAP_WIDTH));
			return ` ${Array(spacerCount).fill('-').join(' ')} `;
		})
		.replace(/\s+/g, ' ');
}

/**
 * Engangs-normalisering til importerede/pastede sange: UG bruger ofte
 * brede mellemrum til akkordplacering, men editoren kollapser whitespace
 * visuelt. Vi gør kun de store gaps eksplicitte med `-` placeholders.
 */
export function normalizeImportedChordSpacing(rows: Row[]): Row[] {
	return rows.map((row) =>
		row.kind === 'chord' && /\s{3,}/.test(row.text)
			? { kind: 'chord', text: replaceWideChordGaps(row.text) }
			: row
	);
}

export function serializeRows(rows: Row[]): string {
	return rows
		.map((r) => (r.kind === 'blank' ? '' : r.text))
		.join('\n');
}

/**
 * Transponér alle chord-rækkers tekst med n halvtoner. Lyric-, header-
 * og blank-rækker bevares uændret. Bruges når brugeren trykker ±-knappen.
 */
export function transposeRows(rows: Row[], semitones: number): Row[] {
	if (semitones === 0) return rows;
	return rows.map((r) =>
		r.kind === 'chord' ? { kind: 'chord', text: transposeBassLine(r.text, semitones) } : r
	);
}

/**
 * Sektioner i sangen — én pr. header. `headerRowIdx` er rækkens index
 * i `rows[]`, `bodyStart`/`bodyEnd` afgrænser rækkerne mellem denne
 * header og den næste (bodyEnd er eksklusiv). `headerIdx` er headerens
 * 0-baserede placering i header-listen.
 */
export interface Section {
	headerIdx: number;
	headerRowIdx: number;
	headerText: string;
	type: ReturnType<typeof sectionHeaderType>;
	bodyStart: number;
	bodyEnd: number;
}

export function buildSections(rows: Row[]): Section[] {
	const sections: Section[] = [];
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (r.kind !== 'header') continue;
		sections.push({
			headerIdx: sections.length,
			headerRowIdx: i,
			headerText: r.text,
			type: sectionHeaderType(r.text),
			bodyStart: i + 1,
			bodyEnd: rows.length
		});
	}
	for (let s = 0; s < sections.length - 1; s++) {
		sections[s].bodyEnd = sections[s + 1].headerRowIdx;
	}
	return sections;
}

/** Find seneste sektion af samme type FØR den givne sektion. */
export function findPreviousSameType(sections: Section[], headerIdx: number): Section | null {
	const cur = sections[headerIdx];
	if (!cur) return null;
	for (let i = headerIdx - 1; i >= 0; i--) {
		if (sections[i].type === cur.type) return sections[i];
	}
	return null;
}

/**
 * Sektion-header-ord vi accepterer. Hvis brugerens lyric-linje kunne
 * være et prefix af en af disse, holder vi den som lyric for ikke at
 * "afklassificere" "C" til en akkord-linje når brugeren faktisk er ved
 * at skrive "Chorus".
 */
const HEADER_KEYWORDS = [
	'chorus', 'pre-chorus', 'verse', 'vers', 'omkvæd', 'refræn',
	'bridge', 'c-stykke', 'intro', 'outro', 'solo', 'interlude',
	'mellemspil', 'coda', 'riff'
];

function couldBeHeaderPrefix(text: string): boolean {
	const t = text.trim().toLowerCase();
	if (!t || t.length > 12) return false;
	return HEADER_KEYWORDS.some((kw) => kw.startsWith(t));
}

/**
 * Auto-promote til chord-linje er kun sikkert når brugeren har skrevet noget
 * der **utvetydigt** er chord-notation. Et enkelt token som "Cm7" eller "Am"
 * kunne lige så godt være lyric-tekst (eller indledningen på et længere ord),
 * og det er irriterende hvis det skifter til monospace blå styling så snart
 * man blur'er linjen. Vi kræver derfor enten:
 *   - mindst 2 tokens adskilt af whitespace ("Em G D A"), eller
 *   - pipe-notation ("| Am | Em |")
 * Multi-token og pipe-formen er måder brugeren eksplicit signalerer
 * akkord-linje. Hvis ingen af delene er der, lader vi den blive som lyric —
 * man kan altid eksplicit klikke ind i linjen via chord-modal'en.
 */
function isUnambiguousChordLine(text: string): boolean {
	if (!isChordLine(text)) return false;
	const stripped = text.replace(/\|/g, ' ').trim();
	if (text.includes('|')) return true;
	const tokens = stripped.split(/\s+/).filter(Boolean);
	return tokens.length >= 2;
}

export function reclassify(row: Row): Row {
	if (row.kind === 'lyric' && isSectionHeader(row.text)) {
		return { kind: 'header', text: cleanSectionHeader(row.text) };
	}
	if (
		row.kind === 'lyric' &&
		row.text.trim() !== '' &&
		isUnambiguousChordLine(row.text) &&
		!(!row.text.includes(' ') && couldBeHeaderPrefix(row.text))
	) {
		return { kind: 'chord', text: row.text };
	}
	if (row.kind === 'chord' && row.text.trim() !== '' && !isChordLine(row.text)) {
		return { kind: 'lyric', text: row.text };
	}
	if (row.kind === 'header' && !isSectionHeader(row.text)) {
		return isUnambiguousChordLine(row.text)
			? { kind: 'chord', text: row.text }
			: { kind: 'lyric', text: row.text };
	}
	return row;
}

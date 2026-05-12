/**
 * Chord/text formatter — minimal WYSIWYG-helpers.
 *
 * Vi auto-genererer INTET længere: både chord-linjen (venstre) og
 * bass-linjen (højre) er literal pipe-notation som brugeren har
 * skrevet, og rendres ens via {@link renderBarLine}. Resten af denne
 * fil er klassificering, transponering og HTML-entity-dekodning.
 */

// Regex: rod + modifier + valgfri bass-tone
export const CHORD_PATTERN = '[A-G][#b]?(?:[majsudigotb0-9#\\+\\-\\(\\)\\^∆°ø]*)(?:/[A-G][#b]?)?';
// En akkord-linje består af akkord-tokens og/eller `-`-spacers (placeholders
// for tomme slag) adskilt af whitespace. `|` strippes inden test.
const chordOrSpacerToken = `(?:${CHORD_PATTERN}|-+)`;
const chordOnlyLineRegex = new RegExp(`^${chordOrSpacerToken}(\\s+${chordOrSpacerToken})*$`);

/**
 * Stilregel: vi viser ALDRIG `A#`/`D#` — altid `Bb`/`Eb`. Andre kryds
 * (`C#`, `F#`, `G#`) bevares.
 */
export function normalizeAccidentals(text: string): string {
	return text.replace(/A#/g, 'Bb').replace(/D#/g, 'Eb');
}

/** Sand hvis linjen er en akkord-only linje (med eller uden pipes). */
export function isChordLine(line: string): boolean {
	const stripped = line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
	if (!stripped) return false;
	return chordOnlyLineRegex.test(stripped);
}

// ============================================================================
// Render én pipe/bar-linje (chord ELLER bass — samme format)
// ============================================================================

/**
 * Render en linje i pipe-notation til HTML. Tokens parses som enten
 * `|` (taktstreg), `-` (placeholder for tomt slag) eller chord-navn.
 *
 * Eksempler:
 *  - `"C | F | G | Am"` → fire takter
 *  - `"Bb C | Dm"` → to akkorder i første takt, én i anden
 *  - `"C - - F"` → akkord, to tomme slag, akkord (dashes vises muted)
 *  - `"C    F    G    Am"` (uden pipes) → fire akkorder uden takter
 *
 * `transpose` flytter alle akkorder med n halvtoner. Returnerer en
 * tom streng hvis linjen ikke indeholder akkorder.
 */
export function renderBarLine(line: string, transpose: number = 0): string {
	if (!line || line.trim() === '') return '';
	const tokens = line.trim().split(/\s+/);
	const out: string[] = [];
	let prevWasBar = false;
	for (const tok of tokens) {
		if (tok === '|') {
			out.push(`<span class="bar-sep">|</span>`);
			prevWasBar = true;
			continue;
		}
		if (out.length > 0) out.push(' ');
		if (/^-+$/.test(tok)) {
			out.push(`<span class="chord-spacer">${tok}</span>`);
		} else {
			const name = transpose === 0 ? normalizeAccidentals(tok) : transposeChord(tok, transpose);
			out.push(`<b class="bass-chord">${escapeHtml(name)}</b>`);
		}
		prevWasBar = false;
	}
	return out.join('');
}

// ============================================================================
// Sektionshjælpere
// ============================================================================

export function isSectionHeader(line: string): boolean {
	const l = line.trim().toLowerCase();
	if (l.length > 50) return false;
	return (
		l.startsWith('[') ||
		l.includes('verse') ||
		l.includes('vers') ||
		l.includes('chorus') ||
		l.includes('omkvæd') ||
		l.includes('refræn') ||
		l.includes('bridge') ||
		l.includes('c-stykke') ||
		l.includes('intro') ||
		l.includes('outro') ||
		l.includes('solo') ||
		l.includes('interlude') ||
		l.includes('mellemspil') ||
		l.includes('coda')
	);
}

/** Fjern firkantede klammer, hash-tegn og lignende UG-dekoration. */
export function cleanSectionHeader(text: string): string {
	return text
		.replace(/[\[\]]/g, '')
		.replace(/^#+\s*/g, '')
		.replace(/^[-=*_]{2,}\s*/g, '')
		.replace(/\s*[-=*_]{2,}\s*$/g, '')
		.trim();
}

export type SectionHeaderType =
	| 'intro'
	| 'verse'
	| 'pre-chorus'
	| 'chorus'
	| 'bridge'
	| 'solo'
	| 'interlude'
	| 'outro'
	| 'coda'
	| 'other';

export function sectionHeaderType(text: string): SectionHeaderType {
	const t = cleanSectionHeader(text).toLowerCase();
	if (t.includes('pre-chorus') || t.includes('pre chorus') || t.includes('prechorus')) {
		return 'pre-chorus';
	}
	if (t.includes('verse') || t.includes('vers')) return 'verse';
	if (t.includes('chorus') || t.includes('omkvæd') || t.includes('refræn')) return 'chorus';
	if (t.includes('bridge') || t.includes('c-stykke')) return 'bridge';
	if (t.includes('intro')) return 'intro';
	if (t.includes('outro')) return 'outro';
	if (t.includes('solo')) return 'solo';
	if (t.includes('interlude') || t.includes('mellemspil')) return 'interlude';
	if (t.includes('coda') || /\btag\b/.test(t)) return 'coda';
	return 'other';
}

export function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Transponering
// ============================================================================

const SHARP_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const FLAT_TO_SHARP: Record<string, string> = {
	Db: 'C#',
	Eb: 'D#',
	Gb: 'F#',
	Ab: 'G#',
	Bb: 'A#'
};

/** Transponer én akkord (root + modifier + evt. /bass) med n halvtoner. */
export function transposeChord(chord: string, semitones: number): string {
	if (semitones === 0) return normalizeAccidentals(chord);
	const re = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;
	const m = chord.match(re);
	if (!m) return normalizeAccidentals(chord);
	const [, root, modifier, bass] = m;
	const newRoot = shiftNote(root, semitones);
	const newBass = bass ? shiftNote(bass, semitones) : null;
	return normalizeAccidentals(newRoot + modifier + (newBass ? '/' + newBass : ''));
}

function shiftNote(note: string, semitones: number): string {
	const normalized = FLAT_TO_SHARP[note] ?? note;
	const idx = SHARP_NOTES.indexOf(normalized as (typeof SHARP_NOTES)[number]);
	if (idx === -1) return note;
	const shifted = (((idx + semitones) % 12) + 12) % 12;
	return SHARP_NOTES[shifted];
}

/**
 * Transponer hele rawInput-strengen: kun chord-only linjer får skiftet
 * deres akkorder; lyric-linjer og section-headers bevares.
 */
export function transposeRawInput(rawInput: string, semitones: number): string {
	const lines = rawInput.split('\n');
	return lines
		.map((line) => {
			if (isSectionHeader(line)) return line;
			if (isChordLine(line)) return transposeChordsInLine(line, semitones);
			return line;
		})
		.join('\n');
}

/** Transponer alle akkorder i en bass-linje (pipe-notation). */
export function transposeBassLine(line: string, semitones: number): string {
	if (semitones === 0) return normalizeAccidentals(line);
	return transposeChordsInLine(line, semitones);
}

/**
 * Normalisér alle akkorder uden at transponere — A# → Bb, D# → Eb, +
 * dekod evt. HTML-entities. Kaldes ved load fra Firestore og i save.
 */
export function normalizeRawInputAccidentals(rawInput: string): string {
	return transposeRawInput(decodeHtmlEntities(rawInput), 0);
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
	nbsp: '\u00a0', hellip: '…', ndash: '–', mdash: '—',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
	aelig: 'æ', AElig: 'Æ', oslash: 'ø', Oslash: 'Ø',
	aring: 'å', Aring: 'Å', auml: 'ä', Auml: 'Ä',
	ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
	eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È',
	ecirc: 'ê', Ecirc: 'Ê', euml: 'ë', Euml: 'Ë',
	agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â',
	atilde: 'ã', Atilde: 'Ã', ccedil: 'ç', Ccedil: 'Ç',
	iacute: 'í', Iacute: 'Í', igrave: 'ì', Igrave: 'Ì',
	icirc: 'î', Icirc: 'Î', iuml: 'ï', Iuml: 'Ï',
	oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò',
	ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ',
	uacute: 'ú', Uacute: 'Ú', ugrave: 'ù', Ugrave: 'Ù',
	ucirc: 'û', Ucirc: 'Û', ntilde: 'ñ', Ntilde: 'Ñ',
	yacute: 'ý', Yacute: 'Ý'
};

export function decodeHtmlEntities(text: string): string {
	if (!text || text.indexOf('&') === -1) return text;
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
		if (body[0] === '#') {
			const hex = body[1] === 'x' || body[1] === 'X';
			const num = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (Number.isFinite(num) && num > 0 && num < 0x110000) {
				try {
					return String.fromCodePoint(num);
				} catch {
					return full;
				}
			}
			return full;
		}
		return NAMED_HTML_ENTITIES[body] ?? full;
	});
}

/**
 * Transponer alle akkorder INDE i en linje (pipes/whitespace bevares).
 * Selv ved semitones=0 gennemløbes alle akkorder for at anvende
 * `normalizeAccidentals`.
 */
function transposeChordsInLine(line: string, semitones: number): string {
	return line.replace(new RegExp(CHORD_PATTERN, 'g'), (chord) => {
		const transposed = transposeChord(chord, semitones);
		if (transposed.length === chord.length) return transposed;
		if (transposed.length < chord.length) {
			return transposed + ' '.repeat(chord.length - transposed.length);
		}
		return transposed;
	});
}

// ============================================================================
// Kategorier
// ============================================================================

export function uniqueCategoriesFromSongs(
	songs: { categories?: string[] | null }[]
): string[] {
	const set = new Set<string>();
	for (const s of songs) {
		for (const c of s.categories ?? []) {
			if (c?.trim()) set.add(c.trim());
		}
	}
	return Array.from(set).sort((a, b) => a.localeCompare(b, 'da'));
}

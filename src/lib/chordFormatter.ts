/**
 * Chord formatter — port af legacy/sketch.js til ren TypeScript.
 *
 * Tager rå chord/tekst-input (UG-format eller paste fra anden kilde) og
 * producerer en HTML-streng der kan {@html ...}-renderes i en Svelte-
 * komponent. Holder samme heuristik som legacy-versionen:
 *
 *  - Detekterer "section headers" som [Verse] / Chorus etc.
 *  - Detekterer chord-only linjer (positional eller pipe |...|)
 *  - I "separate" mode: viser akkord-linjen ovenover, og placerer
 *    rytme/bass-tabs ud for tekstlinjen nedenunder
 *  - I "inline" mode: indsætter chord-superscripts inde i tekstlinjen
 *  - Rytme-kolonnen har klikbare "bar-sep"-spans der kan toggles mellem
 *    space og taktstreg via barEdits-overrides
 */

import type { BarEdits } from './types';

export interface FormatOptions {
	barsPerLine: 2 | 4 | 8;
	chordLayout: 'inline' | 'separate';
	/**
	 * Brugerens override for hver separator i rytme-kolonnen, keyed på
	 * `${rowIndex}:${separatorIndex}`. Findes nøglen ikke, bruges
	 * algoritmens kvalificerede gæt.
	 */
	barEdits?: BarEdits;
	/**
	 * Hvis sat, transponeres alle akkorder med dette antal halvtoner.
	 * Bruges både til "skift toneart"-knappen og capo-visning.
	 */
	transpose?: number;
}

// Regex: rod + modifier + valgfri bass-tone
const CHORD_PATTERN = '[A-G][#b]?(?:[majsudigotb0-9#\\+\\-\\(\\)\\^∆°ø]*)(?:/[A-G][#b]?)?';
const chordPattern = new RegExp(`(${CHORD_PATTERN})`, 'g');
const chordOnlyLineRegex = new RegExp(`^${CHORD_PATTERN},?(\\s+${CHORD_PATTERN},?)*$`);

/** Hovedfunktion: rå tekst → HTML-streng for hele chord-grid'et. */
export function formatSong(rawText: string, options: FormatOptions): string {
	const text = preCleanInput(rawText);
	const lines = text.split('\n');
	const gridItems: string[] = [];
	let mode: 'chords' | 'not-chords' = 'not-chords';
	let pendingRhythm = '';
	let rowIndex = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// "--" → kommentar/spacer som vises som ren tekst
		if (line.includes('--')) {
			gridItems.push(`<div class="lyrics-cell">${escapeHtml(line)}</div>`);
			gridItems.push(`<div class="rhythm-cell"></div>`);
			rowIndex++;
			mode = 'not-chords';
			continue;
		}

		// Section header [Verse], Chorus, Omkvæd, Intro, …
		if (isSectionHeader(line)) {
			const cleanLine = line.replace(/[\[\]]/g, '').trim();
			gridItems.push(`<div class="section-header-cell">${formatSectionHeader(cleanLine)}</div>`);
			mode = 'not-chords';
			pendingRhythm = '';
			continue;
		}

		// Chord-only linje
		if (isPipeChordLine(line) || chordOnlyLineRegex.test(line.trim())) {
			let nextIdx = i + 1;
			while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
			const nextLine = nextIdx < lines.length ? lines[nextIdx] : '';
			const nextIsLyrics =
				nextLine.trim() !== '' &&
				!isSectionHeader(nextLine) &&
				!isPipeChordLine(nextLine) &&
				!chordOnlyLineRegex.test(nextLine.trim());

			if (nextIsLyrics && options.chordLayout === 'inline') {
				mode = 'chords';
				continue;
			}

			// Separate mode (eller chord-line uden lyric efter): vis akkord-linjen
			const lyricsCell = `<span class="chord-line">${escapeHtml(transposeChordsInLine(line.replace(/\s+$/, ''), options.transpose ?? 0))}</span>`;
			let refLine = line;
			if (!line.includes('|')) {
				const lyricRef = nextIsLyrics ? nextLine : '';
				if (lyricRef.length > refLine.length) refLine = lyricRef;
			}
			const rhythm = extractRhythmPattern(line, refLine, options, rowIndex);

			if (nextIsLyrics) {
				pendingRhythm = rhythm;
				gridItems.push(`<div class="lyrics-cell">${lyricsCell}</div>`);
				gridItems.push(`<div class="rhythm-cell"></div>`);
			} else {
				gridItems.push(`<div class="lyrics-cell">${lyricsCell}</div>`);
				gridItems.push(`<div class="rhythm-cell">${rhythm}</div>`);
			}
			rowIndex++;
			mode = 'not-chords';
			continue;
		}

		// Tom linje → spring helt over
		if (line.trim() === '') {
			mode = 'not-chords';
			continue;
		}

		// Lyric-linje
		let lyricsCell: string;
		let rhythmCell = '';
		if (mode === 'chords') {
			lyricsCell = formatChordTextPair(lines[i - 1], line, options);
			rhythmCell = extractRhythmPattern(lines[i - 1], line, options, rowIndex);
			mode = 'not-chords';
		} else {
			lyricsCell = escapeHtml(line);
			rhythmCell = pendingRhythm;
			pendingRhythm = '';
		}
		gridItems.push(`<div class="lyrics-cell">${lyricsCell}</div>`);
		gridItems.push(`<div class="rhythm-cell">${rhythmCell}</div>`);
		rowIndex++;
	}

	return `<div class="chord-grid">${gridItems.join('')}</div>`;
}

// ============================================================================
// Sektionshjælpere — tæt på legacy
// ============================================================================

function preCleanInput(text: string): string {
	return text.trim().replace(/(\n\s*){3,}/g, '\n\n');
}

function isSectionHeader(line: string): boolean {
	const l = line.trim().toLowerCase();
	if (l.length > 50) return false;
	return (
		l.startsWith('[') ||
		l.includes('verse') ||
		l.includes('vers') ||
		l.includes('chorus') ||
		l.includes('omkvæd') ||
		l.includes('bridge') ||
		l.includes('c-stykke') ||
		l.includes('intro') ||
		l.includes('outro')
	);
}

function isPipeChordLine(line: string): boolean {
	const stripped = line.replace(/\|/g, '').trim();
	if (!stripped) return false;
	return (
		line.includes('|') &&
		new RegExp(`^${CHORD_PATTERN}(\\s+${CHORD_PATTERN})*$`).test(stripped)
	);
}

function formatSectionHeader(text: string): string {
	const t = text.trim().toLowerCase();
	let bg = '#eeeeee';
	if (t.includes('verse') || t.includes('vers')) bg = '#e8f5e9';
	else if (t.includes('chorus') || t.includes('omkvæd')) bg = '#ffebee';
	else if (t.includes('bridge') || t.includes('c-stykke')) bg = '#fff3e0';
	else if (t.includes('intro')) bg = '#e3f2fd';
	else if (t.includes('outro')) bg = '#f3e5f5';
	return `<div class="section-header" style="background-color:${bg};">${escapeHtml(text)}</div>`;
}

export function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================================
// Rytme-kolonne: bar-segmenter + klikbare separators
// ============================================================================

function extractRhythmPattern(
	chordLine: string,
	referenceLine: string | null,
	options: FormatOptions,
	rowIndex: number
): string {
	const transpose = options.transpose ?? 0;
	const chordToLabel = (fullChord: string): string => {
		let tone = fullChord;
		if (fullChord.includes('/')) {
			tone = fullChord.split('/')[1];
		} else {
			const rootMatch = fullChord.match(/^[A-G][#b]?/);
			if (rootMatch) tone = rootMatch[0];
		}
		const transposed = transpose === 0 ? tone : transposeChord(tone, transpose);
		return `<b class="bass-chord">${escapeHtml(transposed)}</b>`;
	};

	// Pipe-bar notation: trust den som den er
	if (chordLine.includes('|')) {
		const segments = chordLine
			.split('|')
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
		if (segments.length > 0) {
			const bars = segments.map((seg) => {
				const labels: string[] = [];
				let m: RegExpExecArray | null;
				chordPattern.lastIndex = 0;
				while ((m = chordPattern.exec(seg)) !== null) {
					labels.push(chordToLabel(m[0]));
				}
				return labels;
			});
			fillEmptyBars(bars);
			return renderBarsWithToggleableSeparators(bars, options.barEdits, rowIndex);
		}
	}

	// Positional inferens
	const chordsWithPos: { label: string; pos: number }[] = [];
	let match: RegExpExecArray | null;
	chordPattern.lastIndex = 0;
	while ((match = chordPattern.exec(chordLine)) !== null) {
		chordsWithPos.push({ label: chordToLabel(match[0]), pos: match.index });
	}
	if (chordsWithPos.length === 0) return '';

	const barsPerLine = options.barsPerLine;
	const refLen = referenceLine ? referenceLine.length : 0;
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
		const barIndex = Math.min(Math.floor(c.pos / barWidth), barsPerLine - 1);
		bars[barIndex].push(c.label);
	}
	fillEmptyBars(bars);
	return renderBarsWithToggleableSeparators(bars, options.barEdits, rowIndex);
}

function fillEmptyBars(bars: string[][]): void {
	let lastChord: string | null = null;
	for (let b = 0; b < bars.length; b++) {
		if (bars[b].length === 0 && lastChord) {
			bars[b].push(lastChord);
		} else if (bars[b].length > 0) {
			lastChord = bars[b][bars[b].length - 1];
		}
	}
	// Hvis første takter også er tomme, prøv at fylde dem fra første kendte
	if (lastChord) {
		for (let b = 0; b < bars.length; b++) {
			if (bars[b].length === 0) bars[b].push(lastChord);
		}
	}
}

function renderBarsWithToggleableSeparators(
	bars: string[][],
	barEdits: BarEdits | undefined,
	rowIndex: number
): string {
	let out = '';
	let sepIndex = 0;
	for (let b = 0; b < bars.length; b++) {
		for (let c = 0; c < bars[b].length; c++) {
			out += bars[b][c];
			const isLastInBar = c === bars[b].length - 1;
			const isLastBar = b === bars.length - 1;
			if (isLastInBar && isLastBar) continue;

			const defaultType: 'bar' | 'space' = isLastInBar ? 'bar' : 'space';
			const editKey = `${rowIndex}:${sepIndex}`;
			const type = barEdits?.[editKey] ?? defaultType;
			const title =
				type === 'bar' ? 'Klik for at fjerne taktstreg' : 'Klik for at indsætte taktstreg';
			const content = type === 'bar' ? ' | ' : ' ';
			out += `<span class="bar-sep" data-type="${type}" data-key="${editKey}" title="${title}">${content}</span>`;
			sepIndex++;
		}
	}
	return out;
}

// ============================================================================
// Inline mode: indsæt chord-superscripts i tekstlinjen
// ============================================================================

function formatChordTextPair(
	chordLine: string,
	lyricLine: string,
	options: FormatOptions
): string {
	const transpose = options.transpose ?? 0;
	let formattedLine = '';
	let startCoords = 0;
	let trailingChordCount = 0;

	chordPattern.lastIndex = 0;
	const matches: { chord: string; index: number }[] = [];
	let m: RegExpExecArray | null;
	while ((m = chordPattern.exec(chordLine)) !== null) {
		matches.push({ chord: m[0], index: m.index });
	}

	if (matches.length === 0) return escapeHtml(lyricLine);

	for (let i = 0; i < matches.length; i++) {
		const { chord, index: chordIndex } = matches[i];
		let insertPos = chordIndex;

		if (insertPos < lyricLine.length && lyricLine[insertPos] === ' ') {
			let nextWordIdx = -1;
			for (let k = insertPos; k < lyricLine.length; k++) {
				if (lyricLine[k] !== ' ') {
					nextWordIdx = k;
					break;
				}
			}
			if (nextWordIdx !== -1 && nextWordIdx - insertPos < 5) insertPos = nextWordIdx;
		}

		if (
			insertPos > 0 &&
			insertPos < lyricLine.length &&
			lyricLine[insertPos] !== ' ' &&
			lyricLine[insertPos - 1] !== ' '
		) {
			let wStart = insertPos;
			while (wStart > 0 && lyricLine[wStart - 1] !== ' ') wStart--;
			let wEnd = insertPos;
			while (wEnd < lyricLine.length && lyricLine[wEnd] !== ' ') wEnd++;
			if (wEnd - wStart <= 6) insertPos = wStart;
		}

		if (insertPos < startCoords) insertPos = startCoords;

		const transposedChord = transpose === 0 ? chord : transposeChord(chord, transpose);

		if (insertPos >= lyricLine.length) {
			if (startCoords < lyricLine.length) {
				formattedLine += escapeHtml(lyricLine.substring(startCoords));
				startCoords = lyricLine.length;
			}
			if (trailingChordCount > 0) {
				formattedLine += `<sup class='chord'>| ${escapeHtml(transposedChord)}</sup> `;
			} else {
				const padding = formattedLine.length > 0 && !formattedLine.endsWith(' ') ? ' ' : '';
				formattedLine += padding + `<sup class='chord'>${escapeHtml(transposedChord)}</sup> `;
			}
			trailingChordCount++;
			continue;
		}

		if (insertPos > startCoords) {
			formattedLine += escapeHtml(lyricLine.substring(startCoords, insertPos));
		}
		formattedLine += `<sup class='chord'>${escapeHtml(transposedChord)}</sup>`;
		startCoords = insertPos;
	}

	if (startCoords < lyricLine.length) {
		formattedLine += escapeHtml(lyricLine.substring(startCoords));
	}
	return formattedLine;
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

/** Transponer en enkelt chord-string (root + modifier + evt. /bass) med n halvtoner. */
export function transposeChord(chord: string, semitones: number): string {
	if (semitones === 0) return chord;
	// Match root, modifier, bass
	const re = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/;
	const m = chord.match(re);
	if (!m) return chord;
	const [, root, modifier, bass] = m;
	const newRoot = shiftNote(root, semitones);
	const newBass = bass ? shiftNote(bass, semitones) : null;
	return newRoot + modifier + (newBass ? '/' + newBass : '');
}

function shiftNote(note: string, semitones: number): string {
	const normalized = FLAT_TO_SHARP[note] ?? note;
	const idx = SHARP_NOTES.indexOf(normalized as (typeof SHARP_NOTES)[number]);
	if (idx === -1) return note;
	const shifted = (((idx + semitones) % 12) + 12) % 12;
	return SHARP_NOTES[shifted];
}

/**
 * Transponer alle akkorder INDE i en linje (chord-only line eller pipe-line)
 * mens whitespace og pipes bevares præcist — for at chord-positions stadig
 * stemmer over tekstlinjen i monospace-rendering.
 */
function transposeChordsInLine(line: string, semitones: number): string {
	if (semitones === 0) return line;
	return line.replace(new RegExp(CHORD_PATTERN, 'g'), (chord) => {
		const transposed = transposeChord(chord, semitones);
		// Pad med spaces hvis transposed er kortere/længere så positions bevares
		if (transposed.length === chord.length) return transposed;
		// Kortere: pad med space efter
		if (transposed.length < chord.length) {
			return transposed + ' '.repeat(chord.length - transposed.length);
		}
		// Længere: trim det fra det efterfølgende whitespace ved render-tid (kan ikke
		// gøres deterministisk her, så vi accepterer at linjen bliver lidt længere).
		return transposed;
	});
}

// ============================================================================
// Kategorier — udtræk unikke fra alle sange
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

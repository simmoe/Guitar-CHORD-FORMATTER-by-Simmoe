/**
 * Deterministisk farve-mapping for kategori-pills og -chips.
 *
 * Vi bruger paletten fra sangoversigten, hvor kategorier fordeles efter deres
 * position i den sorterede kategoriliste. Det undgår collisions så længe der
 * er farver nok i paletten.
 */

import type { CategoryColor, CategoryColorMap } from './types';

export interface PastelSwatch {
	/** Lys baggrundsfarve — bruges på pills og inaktive chips. */
	bg: string;
	/** Mørk same-hue tekstfarve med god kontrast mod bg (WCAG AA). */
	text: string;
	/** Lidt mørkere variant af bg — bruges som border for at give pillerne kant. */
	border: string;
}

/**
 * 20 håndvalgte pasteller hen over color-wheelet. Rækkefølgen er bevidst
 * jævnt fordelt på hue, så naboer i hashen ikke ligner hinanden.
 */
export const PASTEL_PALETTE: PastelSwatch[] = [
	{ bg: '#FCE0E0', text: '#8A2A2A', border: '#F2C2C2' }, // rose
	{ bg: '#FCEAD2', text: '#824817', border: '#F2D2A8' }, // peach
	{ bg: '#FAF3CC', text: '#6B5410', border: '#EFE4A6' }, // butter
	{ bg: '#E4F1CE', text: '#3F5C18', border: '#CFE3AC' }, // sage
	{ bg: '#D2EBDA', text: '#1F5E3F', border: '#B5DCC2' }, // mint
	{ bg: '#D2EAF2', text: '#1F4F62', border: '#B2D7E3' }, // sky
	{ bg: '#D9DEF2', text: '#2D3870', border: '#BCC4E3' }, // periwinkle
	{ bg: '#E3D7F0', text: '#4A2A75', border: '#CCBBE3' }, // lavender
	{ bg: '#F2D5EA', text: '#6E2058', border: '#E3B8D5' }, // pink-purple
	{ bg: '#F0D9CB', text: '#6B361A', border: '#E3BCA5' }, // terracotta
	{ bg: '#F8D7DD', text: '#7A2637', border: '#EAB5C0' }, // blush
	{ bg: '#F8DFC7', text: '#7A4218', border: '#E9C49E' }, // apricot
	{ bg: '#F3E8B9', text: '#665214', border: '#E3D48D' }, // straw
	{ bg: '#DCECC4', text: '#3C5B16', border: '#C4DA9E' }, // pistachio
	{ bg: '#CBECDD', text: '#1A5D46', border: '#A8DCC5' }, // seafoam
	{ bg: '#C8E8EA', text: '#175963', border: '#A4D6DA' }, // aqua
	{ bg: '#CFE2F6', text: '#24527A', border: '#AFCBEA' }, // powder blue
	{ bg: '#D7D4F3', text: '#35306F', border: '#BDB7E6' }, // soft indigo
	{ bg: '#EAD2F2', text: '#5A2870', border: '#D6B3E4' }, // lilac
	{ bg: '#F4D1DE', text: '#73304A', border: '#E5AEC2' } // mauve
];

function isCategoryColor(value: unknown): value is CategoryColor {
	const c = value as Partial<CategoryColor> | undefined;
	return (
		typeof c?.bg === 'string' &&
		typeof c?.text === 'string' &&
		typeof c?.border === 'string'
	);
}

function sameColor(a: CategoryColor | undefined, b: CategoryColor | undefined): boolean {
	if (!isCategoryColor(a) || !isCategoryColor(b)) return false;
	return a.bg === b.bg && a.text === b.text && a.border === b.border;
}

export function colorForCategory(
	cat: string,
	colorMap: CategoryColorMap
): CategoryColor {
	const color = colorMap[cat];
	return isCategoryColor(color) ? color : PASTEL_PALETTE[0];
}

export function assignMissingCategoryColors(
	categories: string[],
	current: CategoryColorMap
): CategoryColorMap {
	const next: CategoryColorMap = {};
	for (const [cat, color] of Object.entries(current)) {
		if (isCategoryColor(color)) next[cat] = color;
	}
	const used = new Set(Object.values(next).map((c) => `${c.bg}|${c.text}|${c.border}`));
	let changed = false;

	for (const cat of categories) {
		if (next[cat]) continue;
		let swatch = PASTEL_PALETTE[0];
		for (const candidate of PASTEL_PALETTE) {
			const key = `${candidate.bg}|${candidate.text}|${candidate.border}`;
			if (!used.has(key)) {
				swatch = candidate;
				break;
			}
		}
		next[cat] = swatch;
		used.add(`${swatch.bg}|${swatch.text}|${swatch.border}`);
		changed = true;
	}

	if (!changed && hasSameCategoryColors(next, current)) return current;

	// Hvis et dokument blev seedet med gamle/hash-baserede værdier, lader vi
	// eksisterende kategorier være urørte. Kun nye kategorier får farver her.
	return next;
}

export function hasSameCategoryColors(a: CategoryColorMap, b: CategoryColorMap): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (!sameColor(a[key], b[key])) return false;
	}
	return true;
}

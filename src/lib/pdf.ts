/**
 * Klient-side PDF-eksport.
 *
 * Vi bruger `html2canvas-pro` (forken der understøtter moderne farve-
 * funktioner som `oklch()` — Tailwind v4 bruger dem) til at rasterisere
 * hver "side" til en canvas, og pakker dem i en jsPDF.
 *
 * Output bliver et raster-PDF (1-2 MB pr. A4-side ved scale=2). Tekst
 * er ikke selectable, men chord-grid'et og typografien gengives 1:1
 * med skærm-renderingen — netop det vi vil have.
 *
 * For input-elementerne forventer vi at deres baggrund er hvid og
 * skrifttypen mørk; det er allerede tilfældet for `.print-page`-artikler
 * (de bruger `bg-white text-[var(--color-ink)]`).
 */
import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';
import { mount, unmount, tick } from 'svelte';
import PrintableSong from './components/PrintableSong.svelte';
import type { SongDoc } from './types';

interface ExportOptions {
	filename: string;
	withBassTabs?: boolean;
	fitSinglePage?: boolean;
	scale?: number;
	imageFormat?: 'png' | 'jpeg';
	jpegQuality?: number;
}

const MIN_LAYOUT_SCALE = 0.55;
const MAX_LAYOUT_SCALE = 1.45;
const FIT_HEIGHT_SAFETY = 0.995;
const PDF_MARGIN_MM = 5;
const OFFSCREEN_PAGE_PADDING = '2mm 3mm';

interface SavedStyles {
	el: HTMLElement;
	layoutScale: string;
}

interface SliceBounds {
	offsetY: number;
	height: number;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

function restoreStyles(el: HTMLElement, saved: SavedStyles): void {
	saved.el.style.setProperty('--pdf-layout-scale', saved.layoutScale);
}

async function waitForLayout(): Promise<void> {
	await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

async function applyLayoutScale(
	el: HTMLElement,
	targetHeightPx: number,
	fitSinglePage: boolean
): Promise<SavedStyles> {
	const scaleEl = (el.matches('.print-page')
		? el
		: el.querySelector<HTMLElement>('.print-page')) ?? el;
	const saved: SavedStyles = {
		el: scaleEl,
		layoutScale: scaleEl.style.getPropertyValue('--pdf-layout-scale')
	};
	scaleEl.style.setProperty('--pdf-layout-scale', '1');
	await waitForLayout();

	if (!fitSinglePage) return saved;

	const naturalHeight = el.scrollHeight;
	if (naturalHeight <= 0) return saved;

	let low = MIN_LAYOUT_SCALE;
	let high = MAX_LAYOUT_SCALE;
	let best = MIN_LAYOUT_SCALE;

	for (let i = 0; i < 8; i++) {
		const mid = (low + high) / 2;
		scaleEl.style.setProperty('--pdf-layout-scale', String(mid));
		await waitForLayout();
		if (el.scrollHeight <= targetHeightPx) {
			best = mid;
			low = mid;
		} else {
			high = mid;
		}
	}

	scaleEl.style.setProperty('--pdf-layout-scale', String(best));
	await waitForLayout();
	return saved;
}

function sectionBreaksForCanvas(pageEl: HTMLElement, canvas: HTMLCanvasElement): number[] {
	const pageRect = pageEl.getBoundingClientRect();
	const scaleY = canvas.height / pageRect.height;
	const breaks = new Set<number>([0, canvas.height]);
	for (const section of pageEl.querySelectorAll<HTMLElement>('.pdf-song-section')) {
		const rect = section.getBoundingClientRect();
		const top = Math.max(0, Math.round((rect.top - pageRect.top) * scaleY));
		const bottom = Math.min(canvas.height, Math.round((rect.bottom - pageRect.top) * scaleY));
		if (top > 0) breaks.add(top);
		if (bottom > 0 && bottom < canvas.height) breaks.add(bottom);
	}
	return [...breaks].sort((a, b) => a - b);
}

function findBestSectionBreak(
	breaks: number[],
	offsetY: number,
	maxHeight: number,
	canvasHeight: number
): number | null {
	const hardLimit = Math.min(canvasHeight, offsetY + maxHeight);
	let best: number | null = null;
	for (const b of breaks) {
		if (b <= offsetY + 1) continue;
		if (b <= hardLimit + 1) best = b;
		else break;
	}
	return best && best > offsetY ? best : null;
}

function makeSliceBounds(
	canvas: HTMLCanvasElement,
	slicePxHeight: number,
	breaks: number[]
): SliceBounds[] {
	const slices: SliceBounds[] = [];
	let offsetY = 0;
	while (offsetY < canvas.height) {
		const remaining = canvas.height - offsetY;
		if (remaining <= slicePxHeight + 1) {
			slices.push({ offsetY, height: remaining });
			break;
		}

		const nextBreak = findBestSectionBreak(breaks, offsetY, slicePxHeight, canvas.height);
		const height = nextBreak ? nextBreak - offsetY : Math.min(slicePxHeight, remaining);
		slices.push({ offsetY, height });
		offsetY += height;
	}
	return slices;
}

/**
 * Konverter et array af DOM-elementer (hver = én sang) til en PDF og
 * trigger download.
 *
 * `fitSinglePage` (default `true`): vi justerer PDF-layoutets
 * CSS-variable `--pdf-layout-scale`, så korte/collapsede sange kan vokse
 * og lange sange kan krympe inden snapshot. Hvis indholdet stadig er for
 * højt efter minimumsskalaen, deles snapshot'et over flere A4-sider.
 *
 * Default-output er PNG ved scale 3 — lossless og skarpt.
 */
async function pagesToPdf(pages: HTMLElement[], opts: ExportOptions): Promise<void> {
	const renderScale = opts.scale ?? 3;
	const imageFormat = opts.imageFormat ?? 'png';
	const jpegQuality = opts.jpegQuality ?? 0.92;

	const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	const margin = PDF_MARGIN_MM;
	const pageWidth = pdf.internal.pageSize.getWidth();
	const pageHeight = pdf.internal.pageSize.getHeight();
	const usableW = pageWidth - margin * 2;
	const usableH = pageHeight - margin * 2;

	let pdfPageIndex = 0;

	for (const pageEl of pages) {
		const targetHeightPx =
			pageEl.getBoundingClientRect().width * (usableH / usableW) * FIT_HEIGHT_SAFETY;
		const pageFitSinglePage = pageEl.dataset.fitSinglePage !== 'false';
		const saved = await applyLayoutScale(pageEl, targetHeightPx, pageFitSinglePage);
		const canvas = await html2canvas(pageEl, {
			scale: renderScale,
			backgroundColor: '#ffffff',
			useCORS: true,
			logging: false
		});
		restoreStyles(pageEl, saved);

		const slicePxHeight = canvas.width * (usableH / usableW);
		const slices: HTMLCanvasElement[] = [];

		if (canvas.height <= slicePxHeight + 1) {
			slices.push(canvas);
		} else {
			const breaks = sectionBreaksForCanvas(pageEl, canvas);
			for (const bounds of makeSliceBounds(canvas, slicePxHeight, breaks)) {
				const slice = document.createElement('canvas');
				slice.width = canvas.width;
				slice.height = bounds.height;
				const ctx = slice.getContext('2d');
				if (!ctx) throw new Error('Kunne ikke oprette canvas-context til PDF-slice');
				ctx.drawImage(canvas, 0, -bounds.offsetY);
				slices.push(slice);
			}
		}

		for (const slice of slices) {
			const imgData =
				imageFormat === 'jpeg'
					? slice.toDataURL('image/jpeg', jpegQuality)
					: slice.toDataURL('image/png');
			const w = usableW;
			const h = w * (slice.height / slice.width);
			if (pdfPageIndex > 0) pdf.addPage();
			pdf.addImage(imgData, imageFormat === 'jpeg' ? 'JPEG' : 'PNG', margin, margin, w, h);
			pdfPageIndex++;
		}
	}

	pdf.save(opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`);
}

/**
 * Eksporter en eller flere SongDoc'er til PDF. Mounter `PrintableSong`
 * off-screen for hver sang, fanger snapshot, og pakker dem i én PDF.
 *
 * Brug på song detail-siden (én sang) og evt. som alternativ til print-
 * sidens browser-print (flere sange).
 */
export async function exportSongsAsPdf(
	songs: SongDoc[],
	opts: ExportOptions
): Promise<void> {
	if (songs.length === 0) return;

	const wrapper = document.createElement('div');
	wrapper.style.position = 'fixed';
	wrapper.style.left = '-10000px';
	wrapper.style.top = '0';
	wrapper.style.width = '210mm';
	wrapper.style.background = '#ffffff';
	wrapper.style.color = '#000000';
	wrapper.style.zIndex = '-1';
	wrapper.classList.add('pdf-snapshot-page');
	if (opts.withBassTabs === false) wrapper.classList.add('no-bass-tabs');
	document.body.appendChild(wrapper);

	const components: ReturnType<typeof mount>[] = [];
	const pageEls: HTMLElement[] = [];
	for (const song of songs) {
		const pageDiv = document.createElement('div');
		pageDiv.style.background = '#ffffff';
		pageDiv.style.padding = OFFSCREEN_PAGE_PADDING;
		pageDiv.dataset.fitSinglePage = String(opts.fitSinglePage ?? song.fitSinglePage ?? true);
		pageDiv.classList.add('pdf-snapshot-page');
		wrapper.appendChild(pageDiv);
		const c = mount(PrintableSong, { target: pageDiv, props: { song } });
		components.push(c);
		pageEls.push(pageDiv);
	}

	// Vent på at Svelte's tick + browser-layout (fonts, grid) er færdig.
	await tick();
	await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

	try {
		await pagesToPdf(pageEls, opts);
	} finally {
		for (const c of components) unmount(c);
		document.body.removeChild(wrapper);
	}
}

/**
 * Eksporter EKSISTERENDE `.print-page`-elementer i DOM'en (dvs. når
 * brugeren allerede er på `/print`-siden hvor sangene er renderet).
 * Spar at re-mounte komponenter — vi tager bare snapshot af hvad der
 * allerede står på skærmen.
 */
export async function exportExistingPagesAsPdf(
	pages: HTMLElement[],
	opts: ExportOptions
): Promise<void> {
	if (pages.length === 0) return;
	for (const page of pages) page.classList.add('pdf-snapshot-page');
	try {
		await pagesToPdf(pages, opts);
	} finally {
		for (const page of pages) page.classList.remove('pdf-snapshot-page');
	}
}

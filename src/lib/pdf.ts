/**
 * Klient-side PDF-eksport.
 *
 * Vi bruger `html2canvas-pro` (forken der understøtter moderne farve-
 * funktioner som `oklch()` — Tailwind v4 bruger dem) til at rasterisere
 * hver "side" til en canvas, og pakker dem i en jsPDF.
 *
 * Output bliver et raster-PDF. Tekst
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
import AudienceSongbook from './components/AudienceSongbook.svelte';
import ChordSongbookCover from './components/ChordSongbookCover.svelte';
import PrintableSong from './components/PrintableSong.svelte';
import SongbookToc from './components/SongbookToc.svelte';
import { categoryImageDataUrl } from './firebase/images';
import {
	buildSongbookTocPages,
	tocPageCountForSongs,
	type SongbookTocSong
} from './songbookToc';
import type { CategoryMeta, SongDoc } from './types';

export type SongbookPrintEntry =
	| { type: 'song'; song: SongDoc; withBassTabs?: boolean }
	| { type: 'set'; id: string; label: string };

interface ExportOptions {
	filename: string;
	withBassTabs?: boolean;
	fitSinglePage?: boolean;
	scale?: number;
	imageFormat?: 'png' | 'jpeg';
	jpegQuality?: number;
	coverTitle?: string;
	coverMeta?: CategoryMeta;
	includeCover?: boolean;
}

interface AudienceExportOptions extends ExportOptions {
	title: string;
	categoryMeta?: CategoryMeta;
}

const MIN_LAYOUT_SCALE = 0.55;
const MAX_LAYOUT_SCALE = 1.45;
const FIT_HEIGHT_SAFETY = 0.995;
const PDF_MARGIN_MM = 5;
const OFFSCREEN_PAGE_PADDING = '2mm 3mm';
const DEFAULT_RENDER_SCALE = 2;
const DEFAULT_JPEG_QUALITY = 0.82;

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

function safePdfFilename(filename: string): string {
	const base = filename
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/['’`´]/g, '')
		.replace(/[^a-zA-Z0-9æøåÆØÅ._ -]+/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/-+/g, '-')
		.trim()
		.replace(/^[.\- ]+|[.\- ]+$/g, '');
	const withExtension = base || 'sangbog';
	return withExtension.toLowerCase().endsWith('.pdf') ? withExtension : `${withExtension}.pdf`;
}

function restoreStyles(el: HTMLElement, saved: SavedStyles): void {
	saved.el.style.setProperty('--pdf-layout-scale', saved.layoutScale);
}

async function waitForLayout(): Promise<void> {
	await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

async function waitForImages(root: HTMLElement): Promise<void> {
	const images = [...root.querySelectorAll<HTMLImageElement>('img')];
	await Promise.all(
		images.map(
			(img) =>
				new Promise<void>((resolve) => {
					if (img.complete && img.naturalWidth > 0) {
						resolve();
						return;
					}
					const done = () => resolve();
					img.addEventListener('load', done, { once: true });
					img.addEventListener('error', done, { once: true });
				})
		)
	);
}

async function urlToDataUrl(url: string | undefined): Promise<string | undefined> {
	if (!url) return undefined;
	if (url.startsWith('data:')) return url;
	try {
		const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
		if (!response.ok) return undefined;
		const blob = await response.blob();
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result?.toString() ?? '');
			reader.onerror = () => reject(reader.error ?? new Error('Kunne ikke læse cover-billede'));
			reader.readAsDataURL(blob);
		});
	} catch (err) {
		console.warn('Kunne ikke indlejre cover-billede i PDF:', err);
		return undefined;
	}
}

async function inlineCategoryImage(meta: CategoryMeta | undefined): Promise<CategoryMeta | undefined> {
	if (!meta?.imageUrl) return meta;
	const imageUrl = meta.imagePath
		? await categoryImageDataUrl(meta.imagePath).catch((err) => {
				console.warn('Kunne ikke hente kategori-billede via function:', err);
				return undefined;
			})
		: await urlToDataUrl(meta.imageUrl);
	return imageUrl ? { ...meta, imageUrl } : meta;
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
		const label = section.querySelector<HTMLElement>('.pdf-section-label');
		const labelRect = label?.getBoundingClientRect();
		// Section labels sit slightly above the section border; include their
		// visual bounds so a page slice cannot cut the label in half.
		const visualTop = labelRect ? Math.min(rect.top, labelRect.top) : rect.top;
		const visualBottom = labelRect ? Math.max(rect.bottom, labelRect.bottom) : rect.bottom;
		const top = Math.max(0, Math.round((visualTop - pageRect.top) * scaleY));
		const bottom = Math.min(canvas.height, Math.round((visualBottom - pageRect.top) * scaleY));
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
 * Default-output er JPEG ved scale 2. Det holder sangbøger i en rimelig
 * størrelse; kaldere kan stadig vælge PNG ved behov.
 */
async function pagesToPdf(pages: HTMLElement[], opts: ExportOptions): Promise<void> {
	const renderScale = opts.scale ?? DEFAULT_RENDER_SCALE;
	const imageFormat = opts.imageFormat ?? 'jpeg';
	const jpegQuality = opts.jpegQuality ?? DEFAULT_JPEG_QUALITY;

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

	pdf.save(safePdfFilename(opts.filename));
}

/**
 * Eksporter en eller flere SongDoc'er til PDF. Mounter `PrintableSong`
 * off-screen for hver sang, fanger snapshot, og pakker dem i én PDF.
 *
 * Sangbogs-export (`includeCover`) får samme indholdsfortegnelse som
 * publikums-PDF'en: cover → indhold → sange/sæt.
 */
export async function exportSongsAsPdf(
	songs: SongDoc[] | SongbookPrintEntry[],
	opts: ExportOptions
): Promise<void> {
	if (songs.length === 0) return;
	const entries = normalizePrintEntries(songs);

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
	const contentMounts: Array<{
		el: HTMLElement;
		entry: SongbookPrintEntry;
		component?: ReturnType<typeof mount>;
	}> = [];
	const coverMeta = await inlineCategoryImage(opts.coverMeta);
	if (opts.includeCover) {
		const coverDiv = document.createElement('div');
		coverDiv.style.background = '#ffffff';
		coverDiv.dataset.fitSinglePage = 'false';
		coverDiv.classList.add('pdf-snapshot-page');
		wrapper.appendChild(coverDiv);
		const cover = mount(ChordSongbookCover, {
			target: coverDiv,
			props: {
				title: opts.coverTitle ?? opts.filename,
				songCount: entries.filter((entry) => entry.type === 'song').length,
				categoryMeta: coverMeta
			}
		});
		components.push(cover);
		pageEls.push(coverDiv);
	}

	for (const entry of entries) {
		const pageDiv = document.createElement('div');
		pageDiv.style.background = '#ffffff';
		pageDiv.classList.add('pdf-snapshot-page');
		wrapper.appendChild(pageDiv);
		if (entry.type === 'set') {
			pageDiv.dataset.fitSinglePage = 'false';
			pageDiv.innerHTML = setBreakPageHtml(entry.label);
			contentMounts.push({ el: pageDiv, entry });
		} else {
			const song = entry.song;
			pageDiv.style.padding = OFFSCREEN_PAGE_PADDING;
			pageDiv.dataset.fitSinglePage = String(opts.fitSinglePage ?? song.fitSinglePage ?? true);
			if ((entry.withBassTabs ?? song.showBassTabs ?? true) === false) {
				pageDiv.classList.add('no-bass-tabs');
			}
			const c = mount(PrintableSong, { target: pageDiv, props: { song } });
			components.push(c);
			contentMounts.push({ el: pageDiv, entry, component: c });
		}
		pageEls.push(pageDiv);
	}

	// Vent på at Svelte's tick + browser-layout (fonts, grid) er færdig.
	await tick();
	await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
	await waitForImages(wrapper);
	await waitForLayout();

	if (opts.includeCover) {
		await insertChordSongbookToc({
			wrapper,
			pageEls,
			contentMounts,
			components
		});
		await tick();
		await waitForLayout();
	}

	try {
		await pagesToPdf(pageEls, opts);
	} finally {
		for (const c of components) unmount(c);
		document.body.removeChild(wrapper);
	}
}

async function insertChordSongbookToc(args: {
	wrapper: HTMLElement;
	pageEls: HTMLElement[];
	contentMounts: Array<{
		el: HTMLElement;
		entry: SongbookPrintEntry;
		component?: ReturnType<typeof mount>;
	}>;
	components: ReturnType<typeof mount>[];
}): Promise<void> {
	const { wrapper, pageEls, contentMounts, components } = args;
	const songCount = contentMounts.filter((item) => item.entry.type === 'song').length;
	if (songCount === 0) return;
	const tocCount = tocPageCountForSongs(songCount);

	let cursor = 2 + tocCount;
	const tocSongs: SongbookTocSong[] = [];

	for (const item of contentMounts) {
		const pageCount = await estimatePdfPageCount(item.el);
		if (item.entry.type === 'song') {
			tocSongs.push({
				id: item.entry.song.id,
				title: item.entry.song.title,
				artist: item.entry.song.artist,
				page: cursor
			});
			if (item.component) {
				unmount(item.component);
				const idx = components.indexOf(item.component);
				if (idx >= 0) components.splice(idx, 1);
			}
			item.el.replaceChildren();
			const c = mount(PrintableSong, {
				target: item.el,
				props: { song: item.entry.song, pageNumber: cursor }
			});
			item.component = c;
			components.push(c);
			if ((item.entry.withBassTabs ?? item.entry.song.showBassTabs ?? true) === false) {
				item.el.classList.add('no-bass-tabs');
			}
		}
		cursor += pageCount;
	}

	const coverEl = pageEls[0];
	const tocHost = document.createElement('div');
	wrapper.insertBefore(tocHost, coverEl?.nextSibling ?? null);
	const tocComponent = mount(SongbookToc, {
		target: tocHost,
		props: { pages: buildSongbookTocPages(tocSongs) }
	});
	components.push(tocComponent);
	await tick();

	const tocPageEls = [...tocHost.querySelectorAll<HTMLElement>('.songbook-toc-page')];
	for (const tocPage of tocPageEls) tocPage.classList.add('pdf-snapshot-page');
	pageEls.splice(1, 0, ...tocPageEls);
}

async function estimatePdfPageCount(pageEl: HTMLElement): Promise<number> {
	const usableW = 210 - PDF_MARGIN_MM * 2;
	const usableH = 297 - PDF_MARGIN_MM * 2;
	const widthPx = pageEl.getBoundingClientRect().width || pageEl.scrollWidth;
	if (widthPx <= 0) return 1;
	const targetHeightPx = widthPx * (usableH / usableW) * FIT_HEIGHT_SAFETY;
	const pageFitSinglePage = pageEl.dataset.fitSinglePage !== 'false';
	const saved = await applyLayoutScale(pageEl, targetHeightPx, pageFitSinglePage);
	const height = Math.max(pageEl.scrollHeight, pageEl.getBoundingClientRect().height);
	restoreStyles(pageEl, saved);
	if (height <= 0 || targetHeightPx <= 0) return 1;
	return Math.max(1, Math.ceil(height / targetHeightPx - 1e-6));
}

function normalizePrintEntries(input: SongDoc[] | SongbookPrintEntry[]): SongbookPrintEntry[] {
	return input.map((entry) =>
		'type' in entry && (entry.type === 'song' || entry.type === 'set')
			? entry
			: { type: 'song', song: entry as SongDoc }
	);
}

function setBreakPageHtml(label: string): string {
	const safeLabel = escapeHtml(label.trim() || 'Sæt');
	return `<article class="set-break-page">
		<div>
			<p>Sæt</p>
			<h1>${safeLabel}</h1>
		</div>
	</article>`;
}

function escapeHtml(str: string): string {
	return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function exportAudienceSongbookAsPdf(
	songs: SongDoc[],
	opts: AudienceExportOptions
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
	document.body.appendChild(wrapper);

	const pageDiv = document.createElement('div');
	pageDiv.style.background = '#ffffff';
	pageDiv.dataset.fitSinglePage = 'false';
	pageDiv.classList.add('pdf-snapshot-page');
	wrapper.appendChild(pageDiv);
	const categoryMeta = await inlineCategoryImage(opts.categoryMeta);

	const component = mount(AudienceSongbook, {
		target: pageDiv,
		props: { title: opts.title, songs, categoryMeta }
	});

	await tick();
	await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
	await waitForImages(wrapper);
	await waitForLayout();

	try {
		const pages = [...pageDiv.querySelectorAll<HTMLElement>('.audience-page')];
		await pagesToPdf(pages.length > 0 ? pages : [pageDiv], {
			...opts,
			fitSinglePage: false,
			imageFormat: opts.imageFormat ?? 'jpeg',
			jpegQuality: opts.jpegQuality ?? 0.86
		});
	} finally {
		unmount(component);
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

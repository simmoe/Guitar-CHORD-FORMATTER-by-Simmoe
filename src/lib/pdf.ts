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
	scale?: number;
	imageFormat?: 'png' | 'jpeg';
	jpegQuality?: number;
}

/**
 * Konverter et array af DOM-elementer (hver = én side) til en PDF og
 * trigger download. Hver side skaleres så den fylder A4'eren bredde med
 * 10mm margin og clipper hvis indholdet er for højt (sjældent for
 * chord-sheets).
 *
 * Default: PNG ved scale 3. Det er lossless og giver skarp tekst i
 * stedet for JPEG-komprimeringens "udvaskede" snapshot-look. Filerne
 * bliver lidt større, men chord-sheets fylder typisk fortsat under 2 MB
 * pr. side.
 */
async function pagesToPdf(pages: HTMLElement[], opts: ExportOptions): Promise<void> {
	const scale = opts.scale ?? 3;
	const imageFormat = opts.imageFormat ?? 'png';
	const jpegQuality = opts.jpegQuality ?? 0.92;

	const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
	const margin = 10;
	const pageWidth = pdf.internal.pageSize.getWidth();
	const pageHeight = pdf.internal.pageSize.getHeight();
	const usableW = pageWidth - margin * 2;
	const usableH = pageHeight - margin * 2;

	for (let i = 0; i < pages.length; i++) {
		const canvas = await html2canvas(pages[i], {
			scale,
			backgroundColor: '#ffffff',
			useCORS: true,
			logging: false
		});
		const imgData =
			imageFormat === 'jpeg'
				? canvas.toDataURL('image/jpeg', jpegQuality)
				: canvas.toDataURL('image/png');
		const ratio = canvas.height / canvas.width;
		const w = usableW;
		const h = Math.min(w * ratio, usableH);
		if (i > 0) pdf.addPage();
		pdf.addImage(imgData, imageFormat === 'jpeg' ? 'JPEG' : 'PNG', margin, margin, w, h);
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
	if (opts.withBassTabs === false) wrapper.classList.add('no-bass-tabs');
	document.body.appendChild(wrapper);

	const components: ReturnType<typeof mount>[] = [];
	const pageEls: HTMLElement[] = [];
	for (const song of songs) {
		const pageDiv = document.createElement('div');
		pageDiv.style.background = '#ffffff';
		pageDiv.style.padding = '6mm 8mm';
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
	await pagesToPdf(pages, opts);
}

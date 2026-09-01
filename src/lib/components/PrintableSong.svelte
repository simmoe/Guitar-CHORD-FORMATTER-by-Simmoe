<script lang="ts">
	/**
	 * Self-contained "én sang som A4-side" markup. Bruges både af
	 * `/print` og af PDF-export-utilen (som mounter komponenten
	 * off-screen for at fange et html2canvas-snapshot).
	 *
	 * Fra v4 er `song.rows` autoritativ; falder tilbage til `parseRows`
	 * af `rawInput` hvis et legacy-dokument slipper igennem.
	 */
	import { renderBarLine, sectionHeaderType, transposeBassLine } from '$lib/chordFormatter';
	import { buildSections, parseRows, transposeRows, type Row } from '$lib/songParse';
	import type { BassLines, SongDoc } from '$lib/types';

	interface Props {
		song: SongDoc;
		/** Optional page number shown in the PDF footer (songbook exports). */
		pageNumber?: number;
	}
	const { song, pageNumber }: Props = $props();

	const semitones = $derived(song.transpose ?? 0);
	const baseRows = $derived(song.rows ?? parseRows(song.rawInput ?? ''));
	const rows = $derived(transposeRows(baseRows, semitones));
	const bassLines = $derived(transposeBassLines(song.bassLines, semitones));
	const collapsedSet = $derived(new Set(song.collapsedSections ?? []));
	const sections = $derived(buildPrintableSections(rows, collapsedSet));

	function transposeBassLines(bl: BassLines | undefined, n: number): BassLines {
		if (!bl) return {};
		const out: BassLines = {};
		for (const [k, v] of Object.entries(bl)) out[k] = transposeBassLine(v, n);
		return out;
	}

	type PrintableRow = { rowIdx: number; row: Row };
	type PrintableSection = {
		label: string;
		type: ReturnType<typeof sectionHeaderType>;
		compact: boolean;
		rows: PrintableRow[];
	};

	function buildPrintableSections(rs: Row[], collapsed: Set<number>): PrintableSection[] {
		const built = buildSections(rs);
		if (built.length === 0) {
			return [
				{
					label: '',
					type: 'other',
					compact: false,
					rows: rs.map((row, rowIdx) => ({ rowIdx, row }))
				}
			];
		}
		return built
			.map((section) => {
				const sectionRows = rs
					.slice(section.bodyStart, section.bodyEnd)
					.map((row, offset) => ({ rowIdx: section.bodyStart + offset, row }));
				const hasContent = sectionRows.some(
					({ row }) => row.kind !== 'blank' && (row.kind === 'header' || row.text.trim() !== '')
				);
				const compact = collapsed.has(section.headerIdx) || !hasContent;
				return {
					label: section.headerText,
					type: section.type,
					compact,
					rows: compact ? [] : sectionRows
				};
			});
	}

	function bassHtmlFor(rowIdx: number): string {
		const line = bassLines[String(rowIdx)];
		return line?.trim() ? renderPrintableBarLine(line) : '';
	}

	function renderPrintableBarLine(line: string): string {
		const normalized = line.replace(/[\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ');
		return renderBarLine(normalized).replace(
			new RegExp('<span class="chord-spacer">-+</span>', 'g'),
			'<span class="chord-spacer pdf-spacer">&nbsp;</span>'
		);
	}
</script>

<article class="print-page mb-8 rounded-md bg-white p-6 text-[var(--color-ink)]">
	<header class="print-song-header mb-4 border-b border-[var(--color-border-subtle)] pb-3">
		<h2 class="font-display text-2xl font-bold">{song.title}</h2>
		<div class="print-song-meta text-right text-sm text-[var(--color-ink-muted)]">
			{#if song.artist}<span>{song.artist}</span>{/if}
			{#if song.artist && song.key}<span> · </span>{/if}
			{#if song.key}<span>Toneart: <b>{song.key}</b></span>{/if}
		</div>
	</header>
	<div class="pdf-song-sections">
		{#each sections as section}
			<section
				class="pdf-song-section pdf-song-section--{section.type}"
				class:pdf-song-section--unlabeled={!section.label}
				class:pdf-song-section--compact={section.compact}
			>
				{#if section.label}
					<div class="pdf-section-label">{section.label}</div>
				{/if}
				{#if !section.compact}
					<div class="pdf-section-grid">
						{#each section.rows as item}
							{#if item.row.kind === 'blank'}
								<div class="pdf-line pdf-line--blank"></div>
								<div class="pdf-bass pdf-line--blank">{@html bassHtmlFor(item.rowIdx)}</div>
							{:else if item.row.kind === 'chord'}
								<div class="pdf-line pdf-chord">{@html renderPrintableBarLine(item.row.text)}</div>
								<div class="pdf-bass">{@html bassHtmlFor(item.rowIdx)}</div>
							{:else if item.row.kind === 'lyric'}
								<div class="pdf-line pdf-lyric">{item.row.text}</div>
								<div class="pdf-bass">{@html bassHtmlFor(item.rowIdx)}</div>
							{/if}
						{/each}
					</div>
				{/if}
			</section>
		{/each}
	</div>
	{#if pageNumber != null}
		<footer class="pdf-page-number">{pageNumber}</footer>
	{/if}
</article>

<style>
	.print-page {
		position: relative;
	}
	.pdf-page-number {
		position: absolute;
		right: 0;
		bottom: 0;
		color: #9ca3af;
		font-family: var(--font-display);
		font-size: 9pt;
	}
</style>

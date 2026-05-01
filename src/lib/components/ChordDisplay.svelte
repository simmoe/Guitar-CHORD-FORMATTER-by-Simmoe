<script lang="ts">
	import { formatSong, type FormatOptions } from '$lib/chordFormatter';
	import type { BarEdits, ChordLayout } from '$lib/types';

	interface Props {
		rawInput: string;
		barsPerLine: 2 | 4 | 8;
		chordLayout: ChordLayout;
		barEdits?: BarEdits;
		transpose?: number;
		/** Hvis sat, kan brugeren klikke på taktstreger og toggle dem. */
		editable?: boolean;
		/** Kaldes hver gang barEdits ændres af et klik (kun når editable). */
		onBarEditsChange?: (next: BarEdits) => void;
	}

	const {
		rawInput,
		barsPerLine,
		chordLayout,
		barEdits = {},
		transpose = 0,
		editable = false,
		onBarEditsChange
	}: Props = $props();

	const html = $derived.by(() => {
		const opts: FormatOptions = { barsPerLine, chordLayout, barEdits, transpose };
		return formatSong(rawInput, opts);
	});

	function handleClick(event: MouseEvent) {
		if (!editable || !onBarEditsChange) return;
		const target = event.target as HTMLElement | null;
		if (!target?.classList.contains('bar-sep')) return;
		const key = target.getAttribute('data-key');
		if (!key) return;
		const currentType = (target.getAttribute('data-type') ?? 'space') as 'bar' | 'space';
		const nextType = currentType === 'bar' ? 'space' : 'bar';
		onBarEditsChange({ ...barEdits, [key]: nextType });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="chord-wrap"
	class:edit-mode={editable}
	role="presentation"
	onclick={handleClick}
>
	{@html html}
</div>

<style>
	.chord-wrap :global(.chord-grid) {
		max-width: 100%;
	}
</style>

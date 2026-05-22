<script lang="ts">
	/**
	 * Contenteditable chord-grid editor (WYSIWYG).
	 *
	 * - Venstre side: chord-rækkens `text` er literal pipe-notation
	 *   (fx `C | F | G | Am`). Vises præcis som skrevet.
	 * - Højre side: `bassLines[rowIdx]` er literal pipe-notation. Hvis
	 *   ikke sat, er højre celle tom. Aldrig auto-deriveret.
	 * - Begge sider rendres via samme `renderBarLine` for visuel symmetri.
	 * - Ingen cross-talk: redigering på den ene side ændrer aldrig den
	 *   anden, og drag-and-drop fungerer kun inden for samme side.
	 */
	import {
		buildSections,
		findPreviousSameType,
		parseRows,
		type Row
	} from '$lib/songParse';
	import {
		cleanSectionHeader,
		normalizeAccidentals,
		renderBarLine,
		sectionHeaderType
	} from '$lib/chordFormatter';
	import type { BassLines, CollapsedSections } from '$lib/types';
	import { tick } from 'svelte';

	interface Props {
		rows: Row[];
		barsPerLine: 2 | 4 | 8;
		bassLines?: BassLines;
		collapsedSections?: CollapsedSections;
		readOnly?: boolean;
		onRowsChange?: (next: Row[]) => void;
		onBassLinesChange?: (next: BassLines) => void;
		onCollapsedSectionsChange?: (next: CollapsedSections) => void;
	}

	let {
		rows: rowsProp,
		bassLines = {},
		collapsedSections = [],
		readOnly = false,
		onRowsChange,
		onBassLinesChange,
		onCollapsedSectionsChange
	}: Props = $props();

	let hoveredRow = $state<number | null>(null);
	let hoverToolbar = $state<{ rowIdx: number; top: number; left: number; width: number } | null>(null);
	let rows = $state<Row[]>([]);
	let lastEmitted = $state<Row[] | null>(null);

	$effect(() => {
		if (rowsProp === lastEmitted) return;
		// Eksternt opdaterede rows (fx transponer-knap, første load eller
		// undo). Adopter kun hvis brugeren ikke aktivt skriver, så vi ikke
		// overskriver in-flight contenteditable-input.
		if (
			document.activeElement &&
			(document.activeElement as HTMLElement).closest?.('.editable-song')
		) {
			return;
		}
		rows = rowsProp;
	});

	// ──────────────────────────────────────────────────────────────────────
	// Undo (Cmd/Ctrl+Z) — coalesces typing-bursts til ét trin pr. 400ms.
	// ──────────────────────────────────────────────────────────────────────
	type Snapshot = { rows: Row[]; bassLines: BassLines };
	const MAX_UNDO = 100;
	let undoStack: Snapshot[] = [];
	let lastSnapshotTime = 0;

	function pushUndo(rs: Row[], bl: BassLines) {
		const now = Date.now();
		if (now - lastSnapshotTime < 400 && undoStack.length > 0) return;
		undoStack.push({ rows: rs.map((r) => ({ ...r }) as Row), bassLines: { ...bl } });
		if (undoStack.length > MAX_UNDO) undoStack.shift();
		lastSnapshotTime = now;
	}

	function undo() {
		const snap = undoStack.pop();
		if (!snap) return;
		(document.activeElement as HTMLElement | null)?.blur?.();
		rows = snap.rows;
		lastEmitted = snap.rows;
		lastSnapshotTime = 0;
		onRowsChange?.(snap.rows);
		onBassLinesChange?.(snap.bassLines);
	}

	function emit(nextRows: Row[]) {
		pushUndo(rows, bassLines);
		rows = nextRows;
		lastEmitted = nextRows;
		onRowsChange?.(nextRows);
	}

	// ──────────────────────────────────────────────────────────────────────
	// Sektioner (verse/chorus/…)
	// ──────────────────────────────────────────────────────────────────────
	const sections = $derived(buildSections(rows));
	const collapsedSet = $derived(new Set(collapsedSections));
	const rowToHeaderIdx = $derived.by(() => {
		const map = new Array<number>(rows.length).fill(-1);
		for (const s of sections) {
			for (let i = s.bodyStart; i < s.bodyEnd; i++) map[i] = s.headerIdx;
		}
		return map;
	});

	function isRowHidden(rowIdx: number): boolean {
		const h = rowToHeaderIdx[rowIdx];
		return h >= 0 && collapsedSet.has(h);
	}

	function toggleSectionCollapsed(headerIdx: number) {
		if (!onCollapsedSectionsChange) return;
		const set = new Set(collapsedSections);
		if (set.has(headerIdx)) set.delete(headerIdx);
		else set.add(headerIdx);
		onCollapsedSectionsChange([...set].sort((a, b) => a - b));
	}

	// ──────────────────────────────────────────────────────────────────────
	// Row-keyed `bassLines` skal følge med når rækker indsættes/slettes.
	// Helpers: shift keys ≥ idx ±delta, eller drop keys i et interval.
	// ──────────────────────────────────────────────────────────────────────
	function shiftBassLines(start: number, delta: number, dropRange?: [number, number]) {
		const out: BassLines = {};
		for (const [k, v] of Object.entries(bassLines)) {
			const r = Number(k);
			if (!Number.isFinite(r)) continue;
			if (dropRange && r >= dropRange[0] && r < dropRange[1]) continue;
			const newR = r >= start ? r + delta : r;
			out[String(newR)] = v;
		}
		if (JSON.stringify(out) !== JSON.stringify(bassLines)) onBassLinesChange?.(out);
	}

	function deleteSection(headerIdx: number) {
		const cur = sections[headerIdx];
		if (!cur) return;
		const start = cur.headerRowIdx;
		const end = cur.bodyEnd;
		const removed = end - start;
		if (removed <= 0) return;

		emit([...rows.slice(0, start), ...rows.slice(end)]);
		shiftBassLines(end, -removed, [start, end]);
		if (onCollapsedSectionsChange) {
			const v = collapsedSections
				.filter((h) => h !== headerIdx)
				.map((h) => (h > headerIdx ? h - 1 : h))
				.sort((a, b) => a - b);
			if (JSON.stringify(v) !== JSON.stringify(collapsedSections)) {
				onCollapsedSectionsChange(v);
			}
		}
	}

	function copyFromPreviousSameType(headerIdx: number) {
		const cur = sections[headerIdx];
		if (!cur) return;
		const src = findPreviousSameType(sections, headerIdx);
		if (!src) return;

		const srcRows = rows.slice(src.bodyStart, src.bodyEnd).map((r) => ({ ...r }));
		const tgtStart = cur.bodyStart;
		const tgtEnd = cur.bodyEnd;
		const delta = srcRows.length - (tgtEnd - tgtStart);

		// Kopiér også bass-linjer for de kilde-rækker hvor de er sat —
		// så det nye copy-pasted indhold visuelt matcher kilden.
		const next = [...rows.slice(0, tgtStart), ...srcRows, ...rows.slice(tgtEnd)];
		emit(next);

		const out: BassLines = {};
		for (const [k, v] of Object.entries(bassLines)) {
			const r = Number(k);
			if (!Number.isFinite(r)) continue;
			if (r >= tgtStart && r < tgtEnd) continue; // gamle target-linjer ryddes
			const newR = r >= tgtEnd ? r + delta : r;
			out[String(newR)] = v;
		}
		const offset = tgtStart - src.bodyStart;
		for (let i = 0; i < srcRows.length; i++) {
			const srcRowIdx = src.bodyStart + i;
			const v = bassLines[String(srcRowIdx)];
			if (v) out[String(srcRowIdx + offset)] = v;
		}
		if (JSON.stringify(out) !== JSON.stringify(bassLines)) onBassLinesChange?.(out);
	}

	function chordRowIndicesInSection(start: number, end: number): number[] {
		const out: number[] = [];
		for (let i = start; i < end; i++) {
			if (rows[i]?.kind === 'chord') out.push(i);
		}
		return out;
	}

	function previousSameTypeHasChords(headerIdx: number): boolean {
		const src = findPreviousSameType(sections, headerIdx);
		if (!src) return false;
		return chordRowIndicesInSection(src.bodyStart, src.bodyEnd).length > 0;
	}

	function copyChordsAndBassFromPreviousSameType(headerIdx: number) {
		if (!onBassLinesChange) return;
		const cur = sections[headerIdx];
		const src = findPreviousSameType(sections, headerIdx);
		if (!cur || !src) return;

		const srcChordRows = chordRowIndicesInSection(src.bodyStart, src.bodyEnd);
		const targetChordRows = chordRowIndicesInSection(cur.bodyStart, cur.bodyEnd);
		if (srcChordRows.length === 0 || targetChordRows.length === 0) return;

		const nextRows = [...rows];
		const next: BassLines = { ...bassLines };
		let changed = false;
		const count = Math.min(srcChordRows.length, targetChordRows.length);
		for (let i = 0; i < count; i++) {
			const srcRow = rows[srcChordRows[i]];
			const targetIdx = targetChordRows[i];
			const targetRow = rows[targetIdx];
			if (srcRow?.kind === 'chord' && targetRow?.kind === 'chord' && srcRow.text !== targetRow.text) {
				nextRows[targetIdx] = { ...targetRow, text: srcRow.text };
				changed = true;
			}

			const srcLine = bassLines[String(srcChordRows[i])];
			const targetKey = String(targetIdx);
			if (srcLine?.trim()) {
				if (next[targetKey] !== srcLine) {
					next[targetKey] = srcLine;
					changed = true;
				}
			} else if (next[targetKey]) {
				delete next[targetKey];
				changed = true;
			}
		}
		if (!changed) return;
		emit(nextRows);
		onBassLinesChange(next);
	}

	function moveSection(sourceHeaderIdx: number, targetHeaderIdx: number) {
		if (sourceHeaderIdx === targetHeaderIdx) return;
		const source = sections[sourceHeaderIdx];
		const target = sections[targetHeaderIdx];
		if (!source || !target) return;

		const sourceStart = source.headerRowIdx;
		const sourceEnd = source.bodyEnd;
		const movingRows = rows.slice(sourceStart, sourceEnd);
		const withoutSource = [...rows.slice(0, sourceStart), ...rows.slice(sourceEnd)];

		let insertAt = target.headerRowIdx;
		if (target.headerRowIdx > sourceStart) insertAt -= movingRows.length;

		const next = [...withoutSource.slice(0, insertAt), ...movingRows, ...withoutSource.slice(insertAt)];
		emit(next);

		const oldToNew = new Map<number, number>();
		for (let oldIdx = 0; oldIdx < rows.length; oldIdx++) {
			let newIdx: number;
			if (oldIdx >= sourceStart && oldIdx < sourceEnd) {
				newIdx = insertAt + (oldIdx - sourceStart);
			} else {
				newIdx = oldIdx;
				if (oldIdx >= sourceEnd) newIdx -= movingRows.length;
				if (newIdx >= insertAt) newIdx += movingRows.length;
			}
			oldToNew.set(oldIdx, newIdx);
		}

		const movedBassLines: BassLines = {};
		for (const [k, v] of Object.entries(bassLines)) {
			const oldIdx = Number(k);
			const newIdx = oldToNew.get(oldIdx);
			if (newIdx !== undefined) movedBassLines[String(newIdx)] = v;
		}
		if (JSON.stringify(movedBassLines) !== JSON.stringify(bassLines)) {
			onBassLinesChange?.(movedBassLines);
		}

		if (onCollapsedSectionsChange) {
			const nextSections = buildSections(next);
			const sourceLabel = source.headerText;
			const collapsedLabels = new Set(
				collapsedSections.map((idx) => sections[idx]?.headerText).filter(Boolean)
			);
			// Bevar collapsed-state for de sektioner der allerede var collapsed.
			// Hvis den flyttede sektion var collapsed, følger den også med via label.
			const nextCollapsed = nextSections
				.map((s, idx) => (collapsedLabels.has(s.headerText) || s.headerText === sourceLabel && collapsedSet.has(sourceHeaderIdx) ? idx : -1))
				.filter((idx) => idx >= 0);
			if (JSON.stringify(nextCollapsed) !== JSON.stringify(collapsedSections)) {
				onCollapsedSectionsChange(nextCollapsed);
			}
		}

		hoveredRow = null;
	}

	// ──────────────────────────────────────────────────────────────────────
	// Cell-redigering (lyric/header/blank)
	// ──────────────────────────────────────────────────────────────────────
	function setField(idx: number, value: string) {
		const r = rows[idx];
		if (!r) return;
		const next = [...rows];
		if (r.kind === 'lyric') next[idx] = { ...r, text: value };
		else if (r.kind === 'header') next[idx] = { ...r, text: value };
		else if (r.kind === 'blank') next[idx] = { kind: 'lyric', text: value };
		else return;
		emit(next);
	}

	function onCellInput(e: Event, idx: number) {
		const text = (e.currentTarget as HTMLElement).innerText.replace(/\n+$/, '');
		setField(idx, text);
	}

	function onCellBlur(idx: number) {
		const r = rows[idx];
		if (!r) return;
		if (r.kind === 'header') {
			const cleaned = cleanSectionHeader(r.text);
			if (cleaned === r.text) return;
			const next = [...rows];
			next[idx] = { kind: 'header', text: cleaned };
			const el = document.querySelector(
				`.editable-song [data-row="${idx}"][data-field="text"]`
			) as HTMLElement | null;
			if (el && el.innerText !== cleaned) el.innerText = cleaned;
			emit(next);
		}
	}

	async function focusRow(idx: number) {
		await tick();
		const root = document.querySelector(`.editable-song`);
		if (!root) return;
		const el = root.querySelector(`[data-row="${idx}"][data-field]`) as HTMLElement | null;
		el?.focus();
		if (el) {
			const range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(false);
			const s = window.getSelection();
			s?.removeAllRanges();
			s?.addRange(range);
		}
	}

	function onCellKeydown(e: KeyboardEvent, idx: number) {
		const target = e.currentTarget as HTMLElement;
		const text = target.innerText;

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			splitRowAtCaret(idx, target);
			return;
		}

		if (e.key === 'Backspace' && text === '') {
			if (rows.length === 1) return;
			e.preventDefault();
			deleteRow(idx, true);
			return;
		}

		if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
			e.preventDefault();
			deleteRow(idx, false);
			return;
		}

		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
			if (undoStack.length > 0) {
				e.preventDefault();
				undo();
				return;
			}
		}

		if (e.key === 'ArrowUp' && idx > 0) {
			e.preventDefault();
			focusRow(idx - 1);
		} else if (e.key === 'ArrowDown' && idx < rows.length - 1) {
			e.preventDefault();
			focusRow(idx + 1);
		}
	}

	function getCaretOffset(el: HTMLElement): number {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return 0;
		const range = sel.getRangeAt(0);
		if (!el.contains(range.startContainer)) return 0;
		const pre = range.cloneRange();
		pre.selectNodeContents(el);
		pre.setEnd(range.startContainer, range.startOffset);
		return pre.toString().length;
	}

	function splitRowAtCaret(idx: number, cellEl: HTMLElement) {
		const row = rows[idx];
		if (!row) return;
		const caret = getCaretOffset(cellEl);

		const next = [...rows];
		let newRow: Row;
		const root = document.querySelector('.editable-song');
		const textCellEl = root?.querySelector(
			`[data-row="${idx}"][data-field="text"]`
		) as HTMLElement | null;

		if (row.kind === 'lyric' || row.kind === 'chord' || row.kind === 'header') {
			const before = row.text.slice(0, caret);
			const after = row.text.slice(caret);
			next[idx] = { ...row, text: before } as Row;
			newRow = { ...row, text: after } as Row;
			if (textCellEl) textCellEl.innerText = before;
		} else {
			newRow = { kind: 'blank' };
		}

		next.splice(idx + 1, 0, newRow);
		emit(next);
		shiftBassLines(idx + 1, 1);
		focusRow(idx + 1);
		requestAnimationFrame(() => {
			const root2 = document.querySelector('.editable-song');
			const el = root2?.querySelector(
				`[data-row="${idx + 1}"][data-field="text"]`
			) as HTMLElement | null;
			if (!el) return;
			const range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(true);
			const s = window.getSelection();
			s?.removeAllRanges();
			s?.addRange(range);
		});
	}

	function deleteRow(idx: number, focusPrev = false) {
		if (idx < 0 || idx >= rows.length) return;
		if (rows.length <= 1) {
			emit([{ kind: 'blank' }]);
			focusRow(0);
			return;
		}
		const next = rows.filter((_, i) => i !== idx);
		emit(next);
		shiftBassLines(idx + 1, -1, [idx, idx + 1]);
		const target = focusPrev ? Math.max(0, idx - 1) : Math.min(idx, next.length - 1);
		focusRow(target);
		hoveredRow = null;
	}

	function insertRowAbove(idx: number) {
		if (idx < 0 || idx > rows.length) return;
		let insertIdx = idx;
		const target = rows[idx];
		if (target?.kind === 'header') {
			const targetHeaderIdx = sections.findIndex((s) => s.headerRowIdx === idx);
			const prev = targetHeaderIdx > 0 ? sections[targetHeaderIdx - 1] : null;
			// Hvis forrige formstykke er klappet sammen, ville en blank linje lige
			// før næste header teknisk ligge i forrige formstykke og derfor blive
			// skjult. I det tilfælde lægger vi linjen før den collapsed sektion,
			// så brugeren faktisk kan se og skrive i den.
			if (prev && collapsedSet.has(prev.headerIdx) && idx === prev.bodyEnd) {
				insertIdx = prev.headerRowIdx;
			}
		}
		const next = [...rows.slice(0, insertIdx), { kind: 'blank' as const }, ...rows.slice(insertIdx)];
		emit(next);
		shiftBassLines(insertIdx, 1);
		focusRow(insertIdx);
		hoveredRow = insertIdx;
	}

	function onCellPaste(e: ClipboardEvent, idx: number) {
		const text = e.clipboardData?.getData('text/plain') ?? '';
		if (!text.includes('\n')) return;
		e.preventDefault();
		const pasted = parseRows(text);
		const next = [...rows];
		const replaceCurrent = isEmptyRow(rows[idx]);
		if (replaceCurrent) next.splice(idx, 1, ...pasted);
		else next.splice(idx + 1, 0, ...pasted);
		emit(next);
		const inserted = pasted.length;
		const after = replaceCurrent ? idx + 1 : idx + 2;
		const delta = replaceCurrent ? inserted - 1 : inserted;
		if (delta !== 0) shiftBassLines(after - delta, delta);
	}

	function isEmptyRow(r: Row): boolean {
		if (r.kind === 'blank') return true;
		return r.text.trim() === '';
	}

	// ──────────────────────────────────────────────────────────────────────
	// Type-dropdown: Akkord / Lyrics / Form
	// ──────────────────────────────────────────────────────────────────────
	type LineKind = 'chord' | 'lyric' | 'form';

	function rowKindToOption(r: Row): LineKind | null {
		if (r.kind === 'chord') return 'chord';
		if (r.kind === 'lyric') return 'lyric';
		if (r.kind === 'header') return 'form';
		return null;
	}

	function changeRowKind(idx: number, target: LineKind) {
		const r = rows[idx];
		if (!r) return;
		const current = rowKindToOption(r);
		if (current === target) return;

		const text = r.kind === 'blank' ? '' : r.text;
		const nextRow: Row =
			target === 'chord'
				? { kind: 'chord', text: normalizeAccidentals(text) }
				: target === 'lyric'
					? { kind: 'lyric', text }
					: { kind: 'header', text: cleanSectionHeader(text) };
		const next = [...rows];
		next[idx] = nextRow;
		emit(next);
	}

	// Action der initierer cell-indhold uden at konkurrere med cursoren.
	function init(node: HTMLElement, text: string) {
		if (node.innerText !== text) node.innerText = text;
		return {
			update(newText: string) {
				if (document.activeElement === node) return;
				if (node.innerText !== newText) node.innerText = newText;
			}
		};
	}

	// ──────────────────────────────────────────────────────────────────────
	// Bass-line lookup: hvilken chord-row "ejer" bass-linjen for række i?
	// Hvis i er en lyric umiddelbart efter en chord, så er det chord-rækken
	// ovenover. Ellers ingen.
	// ──────────────────────────────────────────────────────────────────────
	function chordRowAbove(i: number): number | null {
		if (i <= 0) return null;
		const cur = rows[i];
		if (cur?.kind !== 'lyric') return null;
		const prev = rows[i - 1];
		if (prev?.kind !== 'chord') return null;
		return i - 1;
	}

	function bassHtmlFor(rowIdx: number): string {
		const line = bassLines[String(rowIdx)];
		if (!line || line.trim() === '') return '';
		return renderBarLine(line);
	}

	// ──────────────────────────────────────────────────────────────────────
	// Modaler — chord-modal og bass-modal har SAMME format og hint.
	// ──────────────────────────────────────────────────────────────────────
	let chordModal = $state<{ rowIdx: number; value: string } | null>(null);
	let bassModal = $state<{ rowIdx: number; value: string } | null>(null);

	function openChordModal(rowIdx: number) {
		const row = rows[rowIdx];
		if (!row || row.kind !== 'chord') return;
		chordModal = { rowIdx, value: row.text };
	}

	function saveChordModal() {
		if (!chordModal) return;
		const trimmed = normalizeAccidentals(chordModal.value.trim());
		const next = [...rows];
		const r = next[chordModal.rowIdx];
		if (!r || r.kind !== 'chord') {
			chordModal = null;
			return;
		}
		next[chordModal.rowIdx] = { ...r, text: trimmed };
		emit(next);
		chordModal = null;
	}

	function openBassModal(rowIdx: number) {
		const row = rows[rowIdx];
		if (!row || row.kind !== 'chord') return;
		bassModal = { rowIdx, value: bassLines[String(rowIdx)] ?? '' };
	}

	function saveBassModal() {
		if (!bassModal || !onBassLinesChange) return;
		const trimmed = normalizeAccidentals(bassModal.value.trim());
		const k = String(bassModal.rowIdx);
		const next: BassLines = { ...bassLines };
		if (trimmed === '') delete next[k];
		else next[k] = trimmed;
		onBassLinesChange(next);
		bassModal = null;
	}

	// ──────────────────────────────────────────────────────────────────────
	// Drag-and-drop — kun WITHIN-side (chord ↔ chord, bass ↔ bass).
	// ──────────────────────────────────────────────────────────────────────
	type DragCol = 'chord' | 'bass';
	let dragInfo = $state<{ rowIdx: number; col: DragCol } | null>(null);
	let dropTarget = $state<{ rowIdx: number; col: DragCol } | null>(null);
	let sectionDrag = $state<{ headerIdx: number } | null>(null);
	let sectionDropTarget = $state<number | null>(null);

	function onLineDragStart(e: DragEvent, rowIdx: number, col: DragCol) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData('application/x-chord-line', JSON.stringify({ rowIdx, col }));
		const r = rows[rowIdx];
		const text =
			col === 'chord' && r?.kind === 'chord' ? r.text : bassLines[String(rowIdx)] ?? '';
		if (text) e.dataTransfer.setData('text/plain', text);
		dragInfo = { rowIdx, col };
	}

	function onLineDragEnd() {
		dragInfo = null;
		dropTarget = null;
	}

	function onLineDragOver(e: DragEvent, rowIdx: number, col: DragCol) {
		if (!dragInfo || dragInfo.col !== col || dragInfo.rowIdx === rowIdx) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		if (dropTarget?.rowIdx !== rowIdx || dropTarget?.col !== col) {
			dropTarget = { rowIdx, col };
		}
	}

	function onLineDragLeave(rowIdx: number, col: DragCol) {
		if (dropTarget?.rowIdx === rowIdx && dropTarget?.col === col) dropTarget = null;
	}

	function onLineDrop(e: DragEvent, targetIdx: number, col: DragCol) {
		e.preventDefault();
		const raw = e.dataTransfer?.getData('application/x-chord-line');
		dropTarget = null;
		dragInfo = null;
		if (!raw) return;
		let info: { rowIdx: number; col: DragCol };
		try {
			info = JSON.parse(raw);
		} catch {
			return;
		}
		if (info.col !== col || info.rowIdx === targetIdx) return;
		if (col === 'chord') copyChordLine(info.rowIdx, targetIdx);
		else copyBassLine(info.rowIdx, targetIdx);
	}

	function copyChordLine(srcIdx: number, tgtIdx: number) {
		const src = rows[srcIdx];
		const tgt = rows[tgtIdx];
		if (src?.kind !== 'chord' || tgt?.kind !== 'chord') return;
		if (!src.text.trim()) return;
		const next = [...rows];
		next[tgtIdx] = { ...tgt, text: src.text };
		emit(next);
	}

	function copyBassLine(srcIdx: number, tgtIdx: number) {
		if (!onBassLinesChange) return;
		const srcLine = bassLines[String(srcIdx)];
		if (!srcLine || !srcLine.trim()) return;
		onBassLinesChange({ ...bassLines, [String(tgtIdx)]: srcLine });
	}

	function onSectionDragStart(e: DragEvent, headerIdx: number) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('application/x-song-section', String(headerIdx));
		e.dataTransfer.setData('text/plain', sections[headerIdx]?.headerText ?? 'Formstykke');
		sectionDrag = { headerIdx };
		sectionDropTarget = null;
	}

	function onSectionDragEnd() {
		sectionDrag = null;
		sectionDropTarget = null;
	}

	function onSectionDragOver(e: DragEvent, headerIdx: number) {
		if (!sectionDrag || sectionDrag.headerIdx === headerIdx) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		if (sectionDropTarget !== headerIdx) sectionDropTarget = headerIdx;
	}

	function onSectionDragLeave(headerIdx: number) {
		if (sectionDropTarget === headerIdx) sectionDropTarget = null;
	}

	function onSectionDrop(e: DragEvent, targetHeaderIdx: number) {
		e.preventDefault();
		const raw = e.dataTransfer?.getData('application/x-song-section');
		const sourceHeaderIdx = raw ? Number(raw) : sectionDrag?.headerIdx;
		sectionDrag = null;
		sectionDropTarget = null;
		if (sourceHeaderIdx === undefined || !Number.isInteger(sourceHeaderIdx)) return;
		moveSection(sourceHeaderIdx, targetHeaderIdx);
	}

	function focusOnMount(node: HTMLInputElement) {
		requestAnimationFrame(() => {
			node.focus();
			node.select();
		});
	}

	function showRowToolbar(e: MouseEvent, rowIdx: number): void {
		if (readOnly) return;
		hoveredRow = rowIdx;
		const rowEl = e.currentTarget as HTMLElement;
		const rowRect = rowEl.getBoundingClientRect();
		const toolbarWidth = 128;
		hoverToolbar = {
			rowIdx,
			top: Math.max(8, rowRect.top - 4),
			left: rowRect.right + 4,
			width: toolbarWidth
		};
	}

	function hideRowToolbar(): void {
		hoverToolbar = null;
		hoveredRow = null;
	}

	function hideRowToolbarSoon(): void {
		requestAnimationFrame(() => {
			if (document.querySelector('.floating-row-toolbar:hover')) return;
			hoverToolbar = null;
			hoveredRow = null;
		});
	}

	// Fælles hint vist i begge modaler.
	const MODAL_HINT = 'Skriv linjen som du vil have den. Brug `|` mellem takter, mellemrum mellem akkorder i samme takt, og `-` for et tomt slag. Fx `C | F - G | Am - - -`.';
</script>

{#snippet rowGutter(i: number)}
	{@const currentKind = rowKindToOption(rows[i])}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="row-gutter"
		aria-hidden="true"
	></div>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="editable-song chord-grid"
	class:read-only={readOnly}
	role={readOnly ? 'presentation' : 'textbox'}
	aria-multiline={readOnly ? undefined : 'true'}
	tabindex={readOnly ? undefined : -1}
		onmouseleave={readOnly ? undefined : hideRowToolbarSoon}
>
	{#each rows as row, i (i)}
		{#if row.kind === 'header'}
			{@const headerIdx = sections.findIndex((s) => s.headerRowIdx === i)}
			{@const isCollapsed = headerIdx >= 0 && collapsedSet.has(headerIdx)}
			{@const prevSame = headerIdx >= 0 ? findPreviousSameType(sections, headerIdx) : null}
			{@render rowGutter(i)}
			<div
				class="section-header-cell"
				class:section-header-cell--collapsed={isCollapsed}
				class:section-drop-target={sectionDropTarget === headerIdx}
				class:section-drag-source={sectionDrag?.headerIdx === headerIdx}
				draggable={readOnly || headerIdx < 0 ? 'false' : 'true'}
				ondragstart={readOnly || headerIdx < 0 ? undefined : (e) => onSectionDragStart(e, headerIdx)}
				ondragend={readOnly ? undefined : onSectionDragEnd}
				ondragover={readOnly || headerIdx < 0 ? undefined : (e) => onSectionDragOver(e, headerIdx)}
				ondragleave={readOnly || headerIdx < 0 ? undefined : () => onSectionDragLeave(headerIdx)}
				ondrop={readOnly || headerIdx < 0 ? undefined : (e) => onSectionDrop(e, headerIdx)}
				onmouseenter={readOnly ? undefined : () => (hoveredRow = i)}
			>
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<div
					class="section-header-edit section-header--{sectionHeaderType(row.text)}"
					contenteditable={readOnly ? 'false' : 'plaintext-only'}
					use:init={row.text}
					data-row={i}
					data-field="text"
					oninput={readOnly ? undefined : (e) => onCellInput(e, i)}
					onblur={readOnly ? undefined : () => onCellBlur(i)}
					onkeydown={readOnly ? undefined : (e) => onCellKeydown(e, i)}
					onpaste={readOnly ? undefined : (e) => onCellPaste(e, i)}
					role={readOnly ? 'presentation' : 'textbox'}
					tabindex={readOnly ? undefined : 0}
					aria-label={readOnly ? undefined : 'Sektionsnavn'}
				></div>
				{#if headerIdx >= 0 && !readOnly}
					<div class="section-header-actions">
						{#if prevSame}
							<button
								type="button"
								class="section-action-btn"
								title="Kopiér indhold fra forrige {prevSame.headerText}"
								aria-label="Kopiér indhold fra forrige {prevSame.headerText}"
								onmousedown={(e) => e.preventDefault()}
								onclick={() => copyFromPreviousSameType(headerIdx)}
							>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
									<rect x="9" y="9" width="11" height="11" rx="2"></rect>
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
								</svg>
							</button>
							{#if previousSameTypeHasChords(headerIdx)}
								<button
									type="button"
									class="section-action-btn section-action-btn--bass"
									title="Kopiér akkorder og bas fra forrige {prevSame.headerText}"
									aria-label="Kopiér akkorder og bas fra forrige {prevSame.headerText}"
									onmousedown={(e) => e.preventDefault()}
									onclick={() => copyChordsAndBassFromPreviousSameType(headerIdx)}
								>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
										<path d="M9 18V5l12-2v13"></path>
										<circle cx="6" cy="18" r="3"></circle>
										<circle cx="18" cy="16" r="3"></circle>
									</svg>
								</button>
							{/if}
						{/if}
						<button
							type="button"
							class="section-action-btn"
							class:is-active={isCollapsed}
							title={isCollapsed ? 'Klap ud' : 'Klap sammen (skjules også ved print)'}
							aria-label={isCollapsed ? 'Klap sektion ud' : 'Klap sektion sammen'}
							aria-expanded={!isCollapsed}
							onmousedown={(e) => e.preventDefault()}
							onclick={() => toggleSectionCollapsed(headerIdx)}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="chevron">
								<polyline points="6 9 12 15 18 9"></polyline>
							</svg>
						</button>
						<button
							type="button"
							class="section-action-btn section-action-btn--danger"
							title="Slet hele sektionen (kan fortrydes med ⌘Z)"
							aria-label="Slet sektion"
							onmousedown={(e) => e.preventDefault()}
							onclick={() => deleteSection(headerIdx)}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<polyline points="3 6 5 6 21 6"></polyline>
								<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
								<path d="M10 11v6"></path>
								<path d="M14 11v6"></path>
								<path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
							</svg>
						</button>
					</div>
				{/if}
			</div>
		{:else if isRowHidden(i)}
			<!-- skjult af kollapset sektion -->
		{:else if row.kind === 'blank' || row.kind === 'lyric'}
			{@render rowGutter(i)}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="lyrics-cell blank-cell"
				class:lyric-cell={row.kind === 'lyric'}
				contenteditable={readOnly ? 'false' : 'plaintext-only'}
				use:init={row.kind === 'blank' ? '' : row.text}
				data-row={i}
				data-field="text"
				oninput={readOnly ? undefined : (e) => onCellInput(e, i)}
				onblur={readOnly ? undefined : () => onCellBlur(i)}
				onkeydown={readOnly ? undefined : (e) => onCellKeydown(e, i)}
				onpaste={readOnly ? undefined : (e) => onCellPaste(e, i)}
					onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
					onfocus={readOnly ? undefined : hideRowToolbar}
					onclick={readOnly ? undefined : hideRowToolbar}
				role={readOnly ? 'presentation' : 'textbox'}
				tabindex={readOnly ? undefined : 0}
				aria-label={readOnly ? undefined : row.kind === 'blank' ? 'Tom linje' : 'Tekst-linje'}
			></div>
			{@const bassChordIdx = chordRowAbove(i)}
			{#if bassChordIdx !== null}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="rhythm-cell rhythm-cell-clickable"
					class:drop-target={dropTarget?.rowIdx === bassChordIdx && dropTarget?.col === 'bass'}
					class:drag-source={dragInfo?.rowIdx === bassChordIdx && dragInfo?.col === 'bass'}
					title={readOnly ? undefined : 'Klik for at redigere · træk for at kopiere bass-linjen'}
					draggable={readOnly ? 'false' : 'true'}
					ondragstart={readOnly ? undefined : (e) => onLineDragStart(e, bassChordIdx, 'bass')}
					ondragend={readOnly ? undefined : onLineDragEnd}
					ondragover={readOnly ? undefined : (e) => onLineDragOver(e, bassChordIdx, 'bass')}
					ondragleave={readOnly ? undefined : () => onLineDragLeave(bassChordIdx, 'bass')}
					ondrop={readOnly ? undefined : (e) => onLineDrop(e, bassChordIdx, 'bass')}
					onclick={readOnly ? undefined : () => { hideRowToolbar(); openBassModal(bassChordIdx); }}
					onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
				>
					{@html bassHtmlFor(bassChordIdx)}
				</div>
			{:else}
				<div
					class="rhythm-cell"
					onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
				></div>
			{/if}
		{:else if row.kind === 'chord'}
			{@render rowGutter(i)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			{@const hasLyricBelow = rows[i + 1]?.kind === 'lyric'}
			<div
				class="lyrics-cell chord-cell chord-cell-clickable"
				class:drop-target={dropTarget?.rowIdx === i && dropTarget?.col === 'chord'}
				class:drag-source={dragInfo?.rowIdx === i && dragInfo?.col === 'chord'}
				data-row={i}
				title={readOnly ? undefined : 'Klik for at redigere · træk for at kopiere til en anden linje'}
				draggable={readOnly ? 'false' : 'true'}
				ondragstart={readOnly ? undefined : (e) => onLineDragStart(e, i, 'chord')}
				ondragend={readOnly ? undefined : onLineDragEnd}
				ondragover={readOnly ? undefined : (e) => onLineDragOver(e, i, 'chord')}
				ondragleave={readOnly ? undefined : () => onLineDragLeave(i, 'chord')}
				ondrop={readOnly ? undefined : (e) => onLineDrop(e, i, 'chord')}
				onclick={readOnly ? undefined : () => { hideRowToolbar(); openChordModal(i); }}
				onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
				role={readOnly ? 'presentation' : 'button'}
				tabindex={readOnly ? undefined : 0}
				aria-label={readOnly ? undefined : `Rediger akkord-linje for række ${i + 1}`}
			>{#if row.text.trim()}{@html renderBarLine(row.text)}{:else}&nbsp;{/if}</div>
			{#if hasLyricBelow}
				<div
					class="rhythm-cell"
					onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
				></div>
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					class="rhythm-cell rhythm-cell-clickable"
					class:drop-target={dropTarget?.rowIdx === i && dropTarget?.col === 'bass'}
					class:drag-source={dragInfo?.rowIdx === i && dragInfo?.col === 'bass'}
					title={readOnly ? undefined : 'Klik for at redigere · træk for at kopiere bass-linjen'}
					draggable={readOnly ? 'false' : 'true'}
					ondragstart={readOnly ? undefined : (e) => onLineDragStart(e, i, 'bass')}
					ondragend={readOnly ? undefined : onLineDragEnd}
					ondragover={readOnly ? undefined : (e) => onLineDragOver(e, i, 'bass')}
					ondragleave={readOnly ? undefined : () => onLineDragLeave(i, 'bass')}
					ondrop={readOnly ? undefined : (e) => onLineDrop(e, i, 'bass')}
					onclick={readOnly ? undefined : () => { hideRowToolbar(); openBassModal(i); }}
					onmouseenter={readOnly ? undefined : (e) => showRowToolbar(e, i)}
				>
					{@html bassHtmlFor(i)}
				</div>
			{/if}
		{/if}
	{/each}
</div>

{#if hoverToolbar && !readOnly}
	{@const toolbarRowIdx = hoverToolbar.rowIdx}
	{@const currentKind = rowKindToOption(rows[toolbarRowIdx])}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="floating-row-toolbar"
		style:top={`${hoverToolbar.top}px`}
		style:left={`${hoverToolbar.left}px`}
		style:width={`${hoverToolbar.width}px`}
		onmouseenter={() => (hoveredRow = hoverToolbar?.rowIdx ?? null)}
		onmouseleave={hideRowToolbarSoon}
	>
		<div class="gutter-action-row">
			<button
				type="button"
				class="gutter-btn gutter-insert"
				title="Indsæt tom linje ovenover"
				aria-label="Indsæt linje ovenover"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => insertRowAbove(toolbarRowIdx)}
			>
				↑
			</button>
			<button
				type="button"
				class="gutter-btn del-btn"
				title="Slet linje (⌘⇧K)"
				aria-label="Slet linje"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => deleteRow(toolbarRowIdx)}
			>
				×
			</button>
		</div>
		{#if currentKind !== null}
			<div class="gutter-kind-row">
				<select
					class="gutter-btn gutter-kind"
					aria-label="Linjetype"
					title="Linjetype"
					value={currentKind}
					onmousedown={(e) => e.stopPropagation()}
					onchange={(e) =>
						changeRowKind(toolbarRowIdx, (e.currentTarget as HTMLSelectElement).value as LineKind)}
				>
					<option value="chord">Akkord</option>
					<option value="lyric">Lyrics</option>
					<option value="form">Form</option>
				</select>
			</div>
		{/if}
	</div>
{/if}

{#if (chordModal || bassModal) && !readOnly}
	{@const isBass = !!bassModal}
	{@const m = (isBass ? bassModal : chordModal) as { rowIdx: number; value: string }}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="bass-modal-backdrop"
		onclick={() => {
			chordModal = null;
			bassModal = null;
		}}
	>
		<div
			class="bass-modal"
			role="dialog"
			aria-modal="true"
			aria-label={isBass ? 'Rediger bass-linje' : 'Rediger akkord-linje'}
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h3>{isBass ? 'Rediger bass-linje' : 'Rediger akkord-linje'}</h3>
			<p class="bass-modal-hint">{MODAL_HINT}</p>
			<input
				type="text"
				class="bass-modal-input"
				value={m.value}
				oninput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					if (isBass && bassModal) bassModal = { ...bassModal, value: v };
					else if (chordModal) chordModal = { ...chordModal, value: v };
				}}
				use:focusOnMount
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						if (isBass) saveBassModal();
						else saveChordModal();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						chordModal = null;
						bassModal = null;
					}
				}}
				placeholder="C | F - G | Am - - -"
				spellcheck="false"
				autocomplete="off"
				autocorrect="off"
				autocapitalize="off"
			/>
			<div class="bass-modal-actions">
				<span style="flex: 1"></span>
				<button
					type="button"
					class="bass-modal-btn"
					onclick={() => {
						chordModal = null;
						bassModal = null;
					}}>Annullér</button
				>
				<button
					type="button"
					class="bass-modal-btn bass-modal-btn--primary"
					onclick={() => (isBass ? saveBassModal() : saveChordModal())}
				>
					Gem (Enter)
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.editable-song {
		min-height: 4rem;
		position: relative;
	}
	.editable-song.read-only,
	.editable-song.read-only :global(*) {
		cursor: default !important;
		caret-color: transparent !important;
	}
	.editable-song.read-only .lyrics-cell:hover,
	.editable-song.read-only .lyrics-cell:focus,
	.editable-song.read-only .chord-cell-clickable:hover,
	.editable-song.read-only .chord-cell-clickable:focus-visible,
	.editable-song.read-only .rhythm-cell:hover,
	.editable-song.read-only .section-header-edit:focus {
		background: transparent !important;
		outline: none !important;
		box-shadow: none !important;
	}
	.editable-song.read-only .blank-cell:empty::before {
		content: '' !important;
	}
	.editable-song.chord-grid {
		grid-template-columns: minmax(0, 1fr) max-content;
		column-gap: 4.2em;
	}
	.editable-song.chord-grid > * + .rhythm-cell {
		justify-self: end;
		margin-left: 0;
	}
	.editable-song.chord-grid :global(.section-header-cell) {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.4em;
		border-radius: 999px;
	}
	.editable-song:not(.read-only) .section-header-cell {
		cursor: grab;
	}
	.editable-song .section-header-cell.section-drag-source {
		opacity: 0.45;
	}
	.editable-song .section-header-cell.section-drop-target {
		background: rgba(245, 158, 11, 0.16);
		box-shadow: inset 0 0 0 2px var(--color-accent, #f59e0b);
	}
	.editable-song .section-header-cell.section-drop-target::before {
		content: 'Slip her';
		color: var(--color-accent, #f59e0b);
		font-size: 0.7em;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.editable-song .section-header-actions {
		display: inline-flex;
		gap: 0.25em;
		opacity: 0;
		transition: opacity 120ms ease;
	}
	.editable-song .section-header-cell:hover .section-header-actions,
	.editable-song .section-header-cell:focus-within .section-header-actions,
	.editable-song .section-header-cell--collapsed .section-header-actions {
		opacity: 1;
	}
	.editable-song .section-action-btn {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6em;
		height: 1.6em;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.18));
		background: rgba(255, 255, 255, 0.08);
		color: var(--color-ink-muted, #b9c1cf);
		cursor: pointer;
		line-height: 0;
		transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
	}
	.editable-song .section-action-btn:hover {
		background: rgba(245, 158, 11, 0.18);
		color: var(--color-accent, #f59e0b);
	}
	.editable-song .section-action-btn--bass:hover {
		background: rgba(13, 148, 136, 0.18);
		color: #0f766e;
	}
	.editable-song .section-action-btn--danger:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #ef4444;
	}
	.editable-song .section-action-btn .chevron {
		transition: transform 150ms ease;
	}
	.editable-song .section-action-btn.is-active .chevron {
		transform: rotate(-90deg);
	}
	.editable-song .section-header-cell--collapsed .section-header-edit {
		opacity: 0.7;
	}
	.editable-song .section-header-cell--collapsed::after {
		content: '…';
		color: var(--color-ink-faint, #6b7280);
		font-size: 0.85em;
		letter-spacing: 0.15em;
		margin-left: 0.2em;
	}
	.editable-song .row-gutter {
		display: none;
	}
	.floating-row-toolbar {
		position: fixed;
		z-index: 500;
		padding: 3px;
		border-radius: 0.35em;
		background: rgba(15, 23, 42, 0.78);
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.28);
		backdrop-filter: blur(3px);
		color: #ffffff;
	}
	.editable-song .gutter-action-row,
	.editable-song .gutter-kind-row,
	.floating-row-toolbar .gutter-action-row,
	.floating-row-toolbar .gutter-kind-row {
		display: flex;
		justify-content: center;
		gap: 4px;
		width: 100%;
	}
	.floating-row-toolbar .gutter-action-row {
		justify-content: space-evenly;
	}
	.floating-row-toolbar .gutter-kind {
		color: #ffffff;
		border-color: rgba(255, 255, 255, 0.28);
		background-color: rgba(255, 255, 255, 0.08);
		width: 100%;
	}
	.editable-song .gutter-btn {
		appearance: none;
		background: transparent;
		border: 0;
		padding: 0;
		width: 1.45em;
		height: 1.35em;
		line-height: 1;
		font-size: 0.9em;
		font-weight: 700;
		color: var(--color-ink-faint, #9ca3af);
		cursor: pointer;
		border-radius: 3px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 100ms ease, color 100ms ease;
	}
	.editable-song .gutter-insert:hover {
		background: rgba(245, 158, 11, 0.18);
		color: var(--color-accent, #f59e0b);
	}
	.editable-song .gutter-insert:focus-visible {
		outline: 2px solid var(--color-accent, #f59e0b);
		outline-offset: 1px;
	}
	.editable-song .del-btn:hover {
		background: rgba(220, 38, 38, 0.12);
		color: #dc2626;
	}
	.editable-song .del-btn:focus-visible {
		outline: 2px solid #dc2626;
		outline-offset: 1px;
	}
	.editable-song .gutter-kind {
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
			linear-gradient(135deg, currentColor 50%, transparent 50%);
		background-position:
			calc(100% - 7px) 55%,
			calc(100% - 4px) 55%;
		background-size: 3px 3px, 3px 3px;
		background-repeat: no-repeat;
		border: 1px solid var(--color-border-subtle, rgba(0, 0, 0, 0.12));
		padding: 0 1.2em 0 0.35em;
		width: auto;
		height: 1.45em;
		min-width: 0;
		font-size: 0.68em;
		font-weight: 600;
		font-family: inherit;
		color: var(--color-ink-muted, #6b7280);
		cursor: pointer;
		border-radius: 4px;
		line-height: 1.2;
	}
	.editable-song .gutter-kind:hover {
		background-color: rgba(245, 158, 11, 0.12);
		color: var(--color-ink, #1f2937);
		border-color: var(--color-accent, #f59e0b);
	}
	.editable-song .gutter-kind:focus-visible {
		outline: 2px solid var(--color-accent, #f59e0b);
		outline-offset: 1px;
	}
	.editable-song .lyrics-cell,
	.editable-song .section-header-edit {
		outline: none;
		min-width: 1ch;
		caret-color: var(--color-accent);
	}
	.editable-song .lyrics-cell:focus,
	.editable-song .section-header-edit:focus {
		background: rgba(245, 158, 11, 0.08);
		border-radius: 3px;
	}
	.editable-song .lyrics-cell:hover {
		background: rgba(245, 158, 11, 0.04);
		border-radius: 3px;
	}
	.editable-song .blank-cell {
		min-height: 1.2em;
	}
	.editable-song:has(> :nth-child(2):last-child) .blank-cell:empty::before {
		content: 'Skriv eller paste sang her — fx [Verse 1] og chord/lyric-linjer fra Ultimate Guitar';
		color: var(--color-ink-faint);
		font-style: italic;
		pointer-events: none;
	}
	.editable-song .chord-cell {
		font-family: var(--font-mono);
		color: var(--color-chord);
		font-weight: 600;
		font-size: 14px;
	}
	.editable-song .chord-cell-clickable,
	.editable-song .rhythm-cell-clickable {
		cursor: pointer;
		white-space: pre;
		border-radius: 3px;
		padding: 0 0.15rem;
		min-height: 1.2em;
		transition: background-color 100ms ease, box-shadow 100ms ease, opacity 100ms ease;
	}
	.editable-song .chord-cell-clickable:hover,
	.editable-song .chord-cell-clickable:focus-visible,
	.editable-song .rhythm-cell-clickable:hover {
		background: rgba(245, 158, 11, 0.08);
		outline: none;
	}
	.editable-song .chord-cell-clickable.drag-source,
	.editable-song .rhythm-cell-clickable.drag-source {
		opacity: 0.45;
	}
	.editable-song .chord-cell-clickable.drop-target,
	.editable-song .rhythm-cell-clickable.drop-target {
		background: rgba(245, 158, 11, 0.22);
		box-shadow: inset 0 0 0 2px var(--color-accent, #f59e0b);
	}
	@media print {
		.editable-song .chord-cell-clickable,
		.editable-song .rhythm-cell-clickable {
			cursor: auto;
			background: transparent !important;
		}
	}
	.editable-song .lyric-cell {
		font-weight: 700;
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	/* ── Modal ─────────────────────────────────────────────────────── */
	.bass-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
		padding: 1rem;
	}
	.bass-modal {
		background: #fff;
		border-radius: 12px;
		padding: 1.4rem 1.6rem 1.2rem;
		min-width: 380px;
		max-width: min(560px, 92vw);
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
	}
	.bass-modal h3 {
		margin: 0 0 0.4rem;
		font-size: 1.05rem;
		font-weight: 700;
		color: #111827;
	}
	.bass-modal-hint {
		margin: 0 0 1rem;
		font-size: 0.85rem;
		line-height: 1.4;
		color: #6b7280;
	}
	.bass-modal-input {
		width: 100%;
		font-family: var(--font-mono);
		font-size: 1rem;
		font-weight: 600;
		padding: 0.55rem 0.7rem;
		border: 1.5px solid #d1d5db;
		border-radius: 6px;
		outline: none;
		transition: border-color 100ms ease, box-shadow 100ms ease;
		box-sizing: border-box;
	}
	.bass-modal-input:focus {
		border-color: var(--color-accent, #f59e0b);
		box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18);
	}
	.bass-modal-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}
	.bass-modal-btn {
		appearance: none;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.45rem 0.95rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		background: #fff;
		color: #1f2937;
		cursor: pointer;
		transition: background 100ms ease, border-color 100ms ease;
	}
	.bass-modal-btn:hover {
		background: #f3f4f6;
	}
	.bass-modal-btn--primary {
		background: var(--color-accent, #f59e0b);
		border-color: var(--color-accent, #f59e0b);
		color: #fff;
	}
	.bass-modal-btn--primary:hover {
		background: #d97706;
		border-color: #d97706;
	}
	.editable-song .section-header-edit {
		display: inline-block;
		padding: 0.15rem 0.7rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #1f2937;
		background: #eeeeee;
		border: 1px solid rgba(0, 0, 0, 0.06);
	}
	.editable-song .section-header--intro { background: #e3f2fd; color: #0d47a1; }
	.editable-song .section-header--verse { background: #e8f5e9; color: #1b5e20; }
	.editable-song .section-header--pre-chorus { background: #fff8e1; color: #8d6e00; }
	.editable-song .section-header--chorus { background: #ffebee; color: #b71c1c; }
	.editable-song .section-header--bridge { background: #fff3e0; color: #b3501a; }
	.editable-song .section-header--solo { background: #fff9c4; color: #6c5b00; }
	.editable-song .section-header--interlude { background: #e0f2f1; color: #0d6e63; }
	.editable-song .section-header--outro { background: #ede7f6; color: #4527a0; }
	.editable-song .section-header--coda { background: #efebe9; color: #4e342e; }
	.editable-song .section-header--other { background: #eeeeee; color: #1f2937; }
</style>

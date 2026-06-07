import { decodeHtmlEntities } from './chordFormatter';

export interface UgBookmarkletPayload {
	source: 'ug-bookmarklet';
	version: 1;
	title: string;
	artist: string;
	rawInput: string;
	sourceUrl: string;
	keyGuess?: string;
	tuning?: string;
	capo?: number;
}

export interface UgParsedPayload {
	title: string;
	artist: string;
	rawInput: string;
	sourceUrl: string;
	keyGuess?: string;
	tuning?: string;
	capo?: number;
}

export const UG_IMPORT_STORAGE_KEY = 'chordFormatter.pendingUgImport.v1';

function cleanUgContent(s: string): string {
	let cleaned = s
		.replace(/\r\n/g, '\n')
		.replace(/\[ch\]([\s\S]*?)\[\/ch\]/g, '$1')
		.replace(/\[\/?tab\]/g, '')
		.replace(/\u00a0/g, ' ')
		.trim();

	const firstSection = cleaned.match(/^\s*\[[^\]\n]+\]\s*$/m);
	if (firstSection && typeof firstSection.index === 'number' && firstSection.index > 0) {
		cleaned = cleaned.slice(firstSection.index).trim();
	}
	return stripTrailingUgJunk(cleaned);
}

function stripTrailingUgJunk(text: string): string {
	const chordToken = '[A-G][#b]?(?:m|maj|min|dim|sus|add)?\\d?';
	const junkPatterns: RegExp[] = [
		/^\s*\*+\s+(?:it\s+has\s+been\s+suggested|suggested|note|notes?|this\s+song|you\s+can|thanks?|please|rate)\b/i,
		/^\s*Capo\s+(?:I+|VI*|IX|X|\d+)\s*$/i,
		new RegExp(`^\\s*${chordToken}\\s*=\\s*${chordToken}\\s*$`),
		/^\s*\*+\s*Alternates?\b/i,
		/^\s*Open\s*\(/i
	];

	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (junkPatterns.some((rx) => rx.test(lines[i]))) {
			let cutIdx = i;
			while (cutIdx > 0 && lines[cutIdx - 1].trim() === '') cutIdx--;
			return lines.slice(0, cutIdx).join('\n').trimEnd();
		}
	}
	return text;
}

function normalizeCapo(v: unknown): number | undefined {
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

export function parseUgStoreData(store: unknown, sourceUrl: string): UgParsedPayload {
	const pageData = (store as any)?.store?.page?.data;
	const tab = pageData?.tab;
	const wiki = pageData?.tab_view?.wiki_tab;
	const meta = pageData?.tab_view?.meta;
	if (!tab || !wiki?.content) {
		throw new Error('Kunne ikke finde tab-data på Ultimate Guitar-siden.');
	}

	const title = decodeHtmlEntities(String(tab.song_name ?? tab.title ?? ''));
	const artist = decodeHtmlEntities(String(tab.artist_name ?? tab.artist ?? ''));
	const rawInput = cleanUgContent(decodeHtmlEntities(String(wiki.content)));
	const tuning = meta?.tuning?.value ? String(meta.tuning.value) : undefined;
	const capo = meta?.capo != null ? normalizeCapo(meta.capo) : undefined;
	const keyGuess = meta?.tonality ? String(meta.tonality) : undefined;

	return {
		title,
		artist,
		rawInput,
		sourceUrl,
		...(keyGuess ? { keyGuess } : {}),
		...(tuning ? { tuning } : {}),
		...(capo !== undefined ? { capo } : {})
	};
}

export function normalizeBookmarkletPayload(data: unknown): UgBookmarkletPayload {
	const payload = data as Partial<UgBookmarkletPayload>;
	if (payload?.source !== 'ug-bookmarklet' || payload.version !== 1) {
		throw new Error('Import-data kom ikke fra UG-bookmarkletten.');
	}
	if (!payload.rawInput?.trim()) {
		throw new Error('Bookmarkletten fandt ingen akkord/tekst-data på UG-siden.');
	}
	return {
		source: 'ug-bookmarklet',
		version: 1,
		title: payload.title?.trim() || 'Untitled',
		artist: payload.artist?.trim() ?? '',
		rawInput: cleanUgContent(decodeHtmlEntities(payload.rawInput)),
		sourceUrl: payload.sourceUrl ?? '',
		...(payload.keyGuess ? { keyGuess: payload.keyGuess } : {}),
		...(payload.tuning ? { tuning: payload.tuning } : {}),
		...(payload.capo !== undefined ? { capo: payload.capo } : {})
	};
}

export function bookmarkletHref(appOrigin: string): string {
	const origin = appOrigin.replace(/\/$/, '');
	const targetUrl = `${origin}/ug-import`;
	const code = `(function(){var origin=${JSON.stringify(origin)};var target=${JSON.stringify(targetUrl)};function decode(s){var d=document.createElement('textarea');d.innerHTML=s||'';return d.value;}function clean(s){return String(s||'').replace(/\\r\\n/g,'\\n').replace(/\\[ch\\]([\\s\\S]*?)\\[\\/ch\\]/g,'$1').replace(/\\[\\/?tab\\]/g,'').replace(/\\u00a0/g,' ').trim();}function meta(n){var e=document.querySelector('meta[property=\"'+n+'\"],meta[name=\"'+n+'\"]');return e&&e.content||'';}function titleArtist(){var t=meta('og:title')||document.title||'';t=t.replace(/\\s*@\\s*Ultimate-?Guitar\\.Com\\s*$/i,'').replace(/\\s*\\(Chords\\)\\s*$/i,'');var m=t.match(/^(.+?)\\s+-\\s+(.+)$/);return m?{artist:m[1].trim(),title:m[2].trim()}:{artist:'',title:t.trim()};}try{var payload=null;var el=document.querySelector('div.js-store[data-content]');if(el){var data=JSON.parse(decode(el.getAttribute('data-content')));var page=(data.store&&data.store.page&&data.store.page.data)||{};var tab=page.tab||{};var view=page.tab_view||{};var wiki=view.wiki_tab||{};var metaData=view.meta||{};if(wiki.content){payload={source:'ug-bookmarklet',version:1,title:String(tab.song_name||tab.title||''),artist:String(tab.artist_name||tab.artist||''),rawInput:clean(wiki.content),sourceUrl:location.href,keyGuess:metaData.tonality||undefined,tuning:metaData.tuning&&metaData.tuning.value||undefined,capo:metaData.capo};}}if(!payload){var pres=[].slice.call(document.querySelectorAll('pre'));var pre=pres.sort(function(a,b){return (b.innerText||'').length-(a.innerText||'').length;})[0];var raw=pre&&clean(pre.innerText||pre.textContent||'');if(!raw||raw.length<20){alert('Kunne ikke finde chord-blokken på denne UG-side. Prøv at scrolle til akkorderne og klik igen.');return;}var ta=titleArtist();payload={source:'ug-bookmarklet',version:1,title:ta.title,artist:ta.artist,rawInput:raw,sourceUrl:location.href};}var w=window.open(target,'_blank');function send(){try{w&&w.postMessage(payload,origin);}catch(e){}}var tries=0;var timer=setInterval(function(){tries++;send();if(tries>20)clearInterval(timer);},500);setTimeout(send,100);}catch(e){alert('UG-import fejlede: '+(e&&e.message?e.message:e));}})();`;
	return `javascript:${encodeURIComponent(code)}`;
}

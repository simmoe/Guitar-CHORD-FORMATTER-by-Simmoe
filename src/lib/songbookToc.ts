export interface SongbookTocSong {
	id: string;
	title: string;
	artist?: string;
	page: number;
}

export interface SongbookTocPage {
	number: number;
	songs: SongbookTocSong[];
}

export const TOC_ITEMS_PER_PAGE = 28;

export function buildSongbookTocPages(songs: SongbookTocSong[]): SongbookTocPage[] {
	const pages: SongbookTocPage[] = [];
	for (let i = 0; i < songs.length; i += TOC_ITEMS_PER_PAGE) {
		pages.push({
			number: 2 + pages.length,
			songs: songs.slice(i, i + TOC_ITEMS_PER_PAGE)
		});
	}
	return pages.length > 0 ? pages : [{ number: 2, songs: [] }];
}

export function tocPageCountForSongs(songCount: number): number {
	return Math.max(1, Math.ceil(songCount / TOC_ITEMS_PER_PAGE));
}

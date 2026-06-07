import { httpsCallable } from 'firebase/functions';
import { getFns } from './client';

export async function categoryImageDataUrl(imagePath: string): Promise<string> {
	const callable = httpsCallable<{ imagePath: string }, { dataUrl: string }>(
		getFns(),
		'categoryImageDataUrl'
	);
	const result = await callable({ imagePath });
	return result.data.dataUrl;
}

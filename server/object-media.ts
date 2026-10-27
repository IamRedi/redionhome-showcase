import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, chmodSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function importObjectMedia(bytes: Buffer, root: string, kind: 'photo' | 'video') {
    const id = randomUUID(), dir = path.join(root, 'media', `.upload-${id}`), final = path.join(root, 'media', id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        writeFileSync(path.join(dir, 'original'), bytes, { mode: 0o400 });
        let width: number, height: number;
        if (kind === 'photo') {
            const meta = await sharp(bytes, { limitInputPixels: 50000000 }).metadata();
            if (!meta.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? ''))
                throw Error('INVALID_MEDIA');
            const result = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(dir, 'preview.jpg'));
            width = result.width;
            height = result.height;
        }
        else {
            if (bytes.subarray(4, 8).toString() !== 'ftyp')
                throw Error('INVALID_MEDIA');
            const source = path.join(dir, 'original');
            const probe = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-show_streams', '-show_format', '-of', 'json', source], { timeout: 10000, maxBuffer: 1000000 });
            const metadata = JSON.parse(probe.stdout), video = metadata.streams?.find((s: {
                codec_type: string;
            }) => s.codec_type === 'video');
            if (!video || video.width * video.height > 8294400 || !Number.isFinite(Number(metadata.format?.duration)) || Number(metadata.format.duration) > 120 || Number(metadata.format.duration) <= 0)
                throw Error('INVALID_MEDIA');
            await run('ffmpeg', ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-f', 'mov', '-i', source, '-t', '120', '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-c:a', 'aac', '-map_metadata', '-1', '-map_chapters', '-1', '-movflags', '+faststart', path.join(dir, 'video.mp4')], { timeout: 120000, maxBuffer: 1000000 });
            width = Math.min(1280, video.width);
            height = Math.round(video.height * width / video.width / 2) * 2;
            await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', path.join(dir, 'video.mp4'), '-frames:v', '1', path.join(dir, 'preview.jpg')], { timeout: 10000 });
        }
        writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id, kind, width, height, levels: [] }), { mode: 0o600 });
        chmodSync(path.join(dir, 'original'), 0o400);
        renameSync(dir, final);
        return { id, kind };
    }
    catch (e) {
        rmSync(dir, { recursive: true, force: true });
        throw e;
    }
}

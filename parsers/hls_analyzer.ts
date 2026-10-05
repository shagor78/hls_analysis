import { HlsAnalysisReport, HlsMediaTrack, HlsVariantNode } from '../database/models.ts';
import { safeFetchWithRetry } from '../scanner/ssrf_guard.ts';

const RECOGNIZED_HLS_TAGS = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF',
  '#EXTINF',
  '#EXT-X-MEDIA',
  '#EXT-X-TARGETDURATION',
  '#EXT-X-ENDLIST',
  '#EXT-X-KEY',
  '#EXT-X-SESSION-KEY',
  '#EXT-X-MAP',
  '#EXT-X-VERSION',
];

function parseAttributeList(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("([^"]*)"|([^,]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrString)) !== null) {
    const key = match[1].toUpperCase();
    const val = match[3] !== undefined ? match[3] : match[4];
    attrs[key] = val.trim();
  }
  return attrs;
}

function resolveRelativeUrl(relativeOrAbsolute: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute;
  }
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    return relativeOrAbsolute;
  }
}

/**
 * Parses a variant or media M3U8 playlist content into segments, target duration, and encryption metadata.
 * Explicitly detects #EXT-X-KEY / DRM without attempting to decrypt or bypass.
 */
export function parseVariantPlaylistContent(
  content: string,
  playlistUrl: string
): {
  targetDuration?: number;
  isEndlist: boolean;
  encryptionMethod?: string;
  encryptionKeyUri?: string;
  drmDetected: boolean;
  recognizedTags: string[];
  segments: HlsVariantNode['segments'];
} {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const foundTags = new Set<string>();
  let targetDuration: number | undefined;
  let isEndlist = false;
  let encryptionMethod: string | undefined;
  let encryptionKeyUri: string | undefined;
  let drmDetected = false;
  const segments: HlsVariantNode['segments'] = [];

  let pendingDuration = 0;
  let pendingTitle: string | undefined;

  for (const line of lines) {
    for (const tag of RECOGNIZED_HLS_TAGS) {
      if (line.startsWith(tag)) {
        foundTags.add(tag);
      }
    }

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const val = Number(line.replace('#EXT-X-TARGETDURATION:', '').trim());
      if (!Number.isNaN(val)) targetDuration = val;
      continue;
    }

    if (line.startsWith('#EXT-X-ENDLIST')) {
      isEndlist = true;
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      const attrPart = line.slice(line.indexOf(':') + 1);
      const attrs = parseAttributeList(attrPart);
      const method = attrs['METHOD'] || 'UNKNOWN';
      if (method !== 'NONE') {
        encryptionMethod = method;
        encryptionKeyUri = attrs['URI'] ? resolveRelativeUrl(attrs['URI'], playlistUrl) : undefined;
        drmDetected = true;
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const body = line.replace('#EXTINF:', '');
      const commaIdx = body.indexOf(',');
      const durStr = commaIdx !== -1 ? body.slice(0, commaIdx) : body;
      const dur = parseFloat(durStr);
      pendingDuration = Number.isNaN(dur) ? 0 : dur;
      pendingTitle = commaIdx !== -1 ? body.slice(commaIdx + 1).trim() : undefined;
      continue;
    }

    if (!line.startsWith('#')) {
      segments.push({
        index: segments.length + 1,
        duration: pendingDuration,
        title: pendingTitle,
        url: resolveRelativeUrl(line, playlistUrl),
        status: 'available',
      });
      pendingDuration = 0;
      pendingTitle = undefined;
    }
  }

  return {
    targetDuration,
    isEndlist,
    encryptionMethod,
    encryptionKeyUri,
    drmDetected,
    recognizedTags: Array.from(foundTags),
    segments,
  };
}

/**
 * Parses a Master or Variant M3U8 string directly (can also fetch child variants when online).
 */
export async function analyzeHlsManifest(
  masterUrl: string,
  rawManifestContent?: string,
  fetchVariants = true
): Promise<HlsAnalysisReport> {
  let content = rawManifestContent;

  if (!content) {
    const resp = await safeFetchWithRetry(masterUrl, { timeoutMs: 8000, maxRetries: 2 });
    if (!resp.ok) {
      return {
        id: `hls-${Date.now()}`,
        master_url: masterUrl,
        is_master_playlist: false,
        valid_syntax: false,
        recognized_tags: [],
        is_vod_endlist: false,
        drm_or_encrypted: false,
        variants: [],
        audio_tracks: [],
        subtitle_tracks: [],
        total_segments: 0,
        analyzed_at: new Date().toISOString(),
        warning: resp.error || `Failed to fetch HLS manifest (HTTP ${resp.status})`,
      };
    }
    content = resp.bodyText;
  }

  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const validSyntax = lines.length > 0 && lines[0].startsWith('#EXTM3U');
  const recognizedTagsSet = new Set<string>();

  for (const line of lines) {
    for (const tag of RECOGNIZED_HLS_TAGS) {
      if (line.startsWith(tag)) recognizedTagsSet.add(tag);
    }
  }

  const isMaster = lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'));
  const audioTracks: HlsMediaTrack[] = [];
  const subtitleTracks: HlsMediaTrack[] = [];
  const variants: HlsVariantNode[] = [];
  let drmOrEncrypted = false;
  let encryptionDetails: string | undefined;

  if (isMaster) {
    let pendingStreamInf: Record<string, string> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-SESSION-KEY:') || line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttributeList(line.slice(line.indexOf(':') + 1));
        if (attrs['METHOD'] && attrs['METHOD'] !== 'NONE') {
          drmOrEncrypted = true;
          encryptionDetails = `Method: ${attrs['METHOD']}${attrs['KEYFORMAT'] ? ` (${attrs['KEYFORMAT']})` : ''} — Protected stream detected; decryption/bypass strictly disabled.`;
        }
      }

      if (line.startsWith('#EXT-X-MEDIA:')) {
        const attrs = parseAttributeList(line.replace('#EXT-X-MEDIA:', ''));
        const mediaType = attrs['TYPE'];
        const track: HlsMediaTrack = {
          type: mediaType === 'SUBTITLES' ? 'SUBTITLES' : 'AUDIO',
          group_id: attrs['GROUP-ID'] || 'default',
          name: attrs['NAME'] || 'Track',
          language: attrs['LANGUAGE'],
          default: attrs['DEFAULT'] === 'YES',
          autoselect: attrs['AUTOSELECT'] === 'YES',
          uri: attrs['URI'] ? resolveRelativeUrl(attrs['URI'], masterUrl) : undefined,
        };
        if (mediaType === 'AUDIO') {
          audioTracks.push(track);
        } else if (mediaType === 'SUBTITLES') {
          subtitleTracks.push(track);
        }
        continue;
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        pendingStreamInf = parseAttributeList(line.replace('#EXT-X-STREAM-INF:', ''));
        continue;
      }

      if (!line.startsWith('#') && pendingStreamInf) {
        const variantUrl = resolveRelativeUrl(line, masterUrl);
        const resolution = pendingStreamInf['RESOLUTION'] || 'Unknown';
        const bandwidth = Number(pendingStreamInf['BANDWIDTH'] || pendingStreamInf['AVERAGE-BANDWIDTH'] || 0);
        const codecs = pendingStreamInf['CODECS'] || 'Unknown';
        const frameRate = pendingStreamInf['FRAME-RATE'] ? Number(pendingStreamInf['FRAME-RATE']) : undefined;

        const variantNode: HlsVariantNode = {
          id: `var-${variants.length + 1}`,
          url: variantUrl,
          resolution,
          bandwidth,
          codecs,
          frame_rate: frameRate,
          audio_group: pendingStreamInf['AUDIO'],
          subtitle_group: pendingStreamInf['SUBTITLES'],
          drm_detected: drmOrEncrypted,
          segments: [],
        };

        variants.push(variantNode);
        pendingStreamInf = null;
      }
    }

    // Optionally fetch up to 4 variant playlists to populate segment dependency tree
    if (fetchVariants && variants.length > 0) {
      const variantsToInspect = variants.slice(0, 4);
      await Promise.all(
        variantsToInspect.map(async (v) => {
          const vResp = await safeFetchWithRetry(v.url, { timeoutMs: 5000, maxRetries: 1 });
          if (vResp.ok && vResp.bodyText) {
            const parsedVar = parseVariantPlaylistContent(vResp.bodyText, v.url);
            v.target_duration = parsedVar.targetDuration;
            v.is_endlist = parsedVar.isEndlist;
            v.encryption_method = parsedVar.encryptionMethod;
            v.encryption_key_uri = parsedVar.encryptionKeyUri;
            v.drm_detected = v.drm_detected || parsedVar.drmDetected;
            if (parsedVar.drmDetected) {
              drmOrEncrypted = true;
              encryptionDetails = `Variant encrypted with ${parsedVar.encryptionMethod}. Protected stream respected (no bypass).`;
            }
            for (const t of parsedVar.recognizedTags) recognizedTagsSet.add(t);
            v.segments = parsedVar.segments.slice(0, 15);
          }
        })
      );
    }
  } else if (validSyntax) {
    // Single-variant / Media playlist
    const parsedVar = parseVariantPlaylistContent(content, masterUrl);
    for (const t of parsedVar.recognizedTags) recognizedTagsSet.add(t);
    drmOrEncrypted = parsedVar.drmDetected;
    if (parsedVar.drmDetected) {
      encryptionDetails = `Media playlist encrypted with ${parsedVar.encryptionMethod}. Protected stream respected.`;
    }
    variants.push({
      id: 'var-primary',
      url: masterUrl,
      resolution: 'Media Playlist',
      bandwidth: 0,
      codecs: 'Detected in TS/fMP4',
      target_duration: parsedVar.targetDuration,
      is_endlist: parsedVar.isEndlist,
      encryption_method: parsedVar.encryptionMethod,
      encryption_key_uri: parsedVar.encryptionKeyUri,
      drm_detected: parsedVar.drmDetected,
      segments: parsedVar.segments.slice(0, 25),
    });
  }

  const totalSegments = variants.reduce((acc, v) => acc + v.segments.length, 0);
  const firstTargetDuration = variants.find((v) => v.target_duration)?.target_duration;
  const isVodEndlist = variants.some((v) => Boolean(v.is_endlist));

  return {
    id: `hls-${Date.now()}`,
    master_url: masterUrl,
    is_master_playlist: isMaster,
    valid_syntax: validSyntax,
    recognized_tags: Array.from(recognizedTagsSet),
    target_duration: firstTargetDuration,
    is_vod_endlist: isVodEndlist,
    drm_or_encrypted: drmOrEncrypted,
    encryption_details: encryptionDetails,
    variants,
    audio_tracks: audioTracks,
    subtitle_tracks: subtitleTracks,
    total_segments: totalSegments,
    analyzed_at: new Date().toISOString(),
  };
}

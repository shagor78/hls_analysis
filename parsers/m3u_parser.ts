import { ChannelCategory, NormalizedChannelRecord } from '../database/models.ts';

export type DuplicateDetectionRule = 'stream_url' | 'name' | 'tvg_id' | 'url_and_name';

const SUPPORTED_CATEGORIES: ChannelCategory[] = [
  'Bangla',
  'Hindi',
  'English',
  'Sports',
  'News',
  'Movies',
  'Kids',
  'Music',
  'International',
  'Other',
];

/**
 * Maps raw group-title or channel hints to one of the supported standard categories.
 * Does not invent metadata when it cannot be verified — defaults to 'Other'.
 */
export function normalizeCategory(rawGroup?: string, channelName?: string): ChannelCategory {
  const combined = `${rawGroup || ''} ${channelName || ''}`.toLowerCase();

  for (const cat of SUPPORTED_CATEGORIES) {
    if (rawGroup && rawGroup.trim().toLowerCase() === cat.toLowerCase()) {
      return cat;
    }
  }

  if (/\b(bangla|bengali|dhaka|bd|desh|jamuna|somoy|ntv|atn)\b/i.test(combined)) return 'Bangla';
  if (/\b(hindi|bollywood|india|mumbai|zee|star plus|sony sab|aaj tak)\b/i.test(combined)) return 'Hindi';
  if (/\b(sport|sports|cricket|football|soccer|espn|ten sports|Willow|euro|premier)\b/i.test(combined))
    return 'Sports';
  if (/\b(news|chronicle|headline|bulletin|press|bbc|cnn|al jazeera|ndtv)\b/i.test(combined)) return 'News';
  if (/\b(movie|movies|cinema|film|hbo|box office|premiere|action|classic)\b/i.test(combined)) return 'Movies';
  if (/\b(kid|kids|cartoon|junior|nick|disney|pogo|baby|anime)\b/i.test(combined)) return 'Kids';
  if (/\b(music|mtv|vh1|9xm|acoustic|melody|beats|radio|song)\b/i.test(combined)) return 'Music';
  if (/\b(english|uk|us|usa|american|british)\b/i.test(combined)) return 'English';
  if (/\b(international|world|global|arabic|french|spanish|korean|dw)\b/i.test(combined))
    return 'International';

  return 'Other';
}

export function inferStreamType(url: string): NormalizedChannelRecord['type'] {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8') || clean.includes('/hls/') || clean.includes('.isml/.m3u8') || clean.includes('.ism/.m3u8')) {
    return 'HLS';
  }
  if (clean.endsWith('.ts') || clean.includes('/mpegts/')) {
    return 'MPEG-TS';
  }
  if (clean.endsWith('.mp4') || clean.endsWith('.m4v')) {
    return 'MP4';
  }
  return 'HLS';
}

function extractAttribute(extinfLine: string, attrName: string): string {
  const regex = new RegExp(`${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const match = extinfLine.match(regex);
  if (match && match[1]) return match[1].trim();

  const unquotedRegex = new RegExp(`${attrName}\\s*=\\s*([^\\s,]+)`, 'i');
  const unquotedMatch = extinfLine.match(unquotedRegex);
  return unquotedMatch && unquotedMatch[1] ? unquotedMatch[1].trim() : '';
}

export interface M3uParseResult {
  validHeader: boolean;
  epgUrl?: string;
  channels: NormalizedChannelRecord[];
  duplicatesCount: number;
  categoriesSummary: Record<ChannelCategory, number>;
}

/**
 * Parses standard IPTV M3U / M3U8 playlists (#EXTM3U, #EXTINF, tvg-id, tvg-name, tvg-logo, group-title).
 * Performs configurable duplicate detection without fabricating missing metadata.
 */
export function parseM3uPlaylist(
  content: string,
  baseUrl = '',
  duplicateRule: DuplicateDetectionRule = 'stream_url'
): M3uParseResult {
  const lines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const validHeader = lines.length > 0 && lines[0].startsWith('#EXTM3U');
  let headerEpgUrl = '';

  if (validHeader) {
    headerEpgUrl =
      extractAttribute(lines[0], 'url-tvg') ||
      extractAttribute(lines[0], 'x-tvg-url') ||
      extractAttribute(lines[0], 'tvg-url');
  }

  const channels: NormalizedChannelRecord[] = [];
  const now = new Date().toISOString();

  let pendingExtInf: string | null = null;
  let pendingGroupFromExtGrp: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXTINF:')) {
      pendingExtInf = line;
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroupFromExtGrp = line.replace('#EXTGRP:', '').trim();
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    // Stream URL line
    let resolvedUrl = line;
    if (baseUrl && !/^https?:\/\//i.test(line)) {
      try {
        resolvedUrl = new URL(line, baseUrl).toString();
      } catch {
        resolvedUrl = line;
      }
    }

    let tvgId = '';
    let tvgName = '';
    let tvgLogo = '';
    let groupTitle = pendingGroupFromExtGrp || '';
    let displayName = '';
    let resolution = 'Unknown';

    if (pendingExtInf) {
      tvgId = extractAttribute(pendingExtInf, 'tvg-id');
      tvgName = extractAttribute(pendingExtInf, 'tvg-name');
      tvgLogo = extractAttribute(pendingExtInf, 'tvg-logo');
      const extractedGroup = extractAttribute(pendingExtInf, 'group-title');
      if (extractedGroup) groupTitle = extractedGroup;

      const commaIdx = pendingExtInf.lastIndexOf(',');
      if (commaIdx !== -1) {
        displayName = pendingExtInf.slice(commaIdx + 1).trim();
      }

      // Check if resolution is explicitly stated in the channel name (do not invent otherwise)
      if (/\b(1080p|fhd|1920x1080)\b/i.test(displayName)) {
        resolution = '1920x1080';
      } else if (/\b(720p|1280x720)\b/i.test(displayName)) {
        resolution = '1280x720';
      } else if (/\b(480p|848x480|640x480)\b/i.test(displayName)) {
        resolution = '848x480';
      } else if (/\b(4k|2160p|3840x2160)\b/i.test(displayName)) {
        resolution = '3840x2160';
      }
    }

    const finalName = displayName || tvgName || `Channel ${channels.length + 1}`;
    const category = normalizeCategory(groupTitle, finalName);

    channels.push({
      id: `ch-parsed-${Date.now()}-${channels.length + 1}`,
      name: finalName,
      category,
      logo: tvgLogo || '',
      stream_url: resolvedUrl,
      type: inferStreamType(resolvedUrl),
      resolution,
      tvg_id: tvgId || undefined,
      tvg_name: tvgName || undefined,
      group_title: groupTitle || category,
      epg_url: headerEpgUrl || undefined,
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 0,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    });

    pendingExtInf = null;
    pendingGroupFromExtGrp = null;
  }

  // Apply duplicate detection
  const annotated = detectDuplicates(channels, duplicateRule);
  const duplicatesCount = annotated.filter((c) => c.is_duplicate).length;

  const categoriesSummary: Record<ChannelCategory, number> = {
    Bangla: 0,
    Hindi: 0,
    English: 0,
    Sports: 0,
    News: 0,
    Movies: 0,
    Kids: 0,
    Music: 0,
    International: 0,
    Other: 0,
  };

  for (const ch of annotated) {
    categoriesSummary[ch.category] = (categoriesSummary[ch.category] || 0) + 1;
  }

  return {
    validHeader,
    epgUrl: headerEpgUrl || undefined,
    channels: annotated,
    duplicatesCount,
    categoriesSummary,
  };
}

/**
 * Marks duplicate channels based on configurable rules ('stream_url', 'name', 'tvg_id', 'url_and_name').
 */
export function detectDuplicates(
  channels: NormalizedChannelRecord[],
  rule: DuplicateDetectionRule = 'stream_url'
): NormalizedChannelRecord[] {
  const seenMap = new Map<string, string>(); // key -> first channel ID

  return channels.map((ch) => {
    let key = '';
    if (rule === 'stream_url') {
      key = ch.stream_url.trim().toLowerCase();
    } else if (rule === 'name') {
      key = ch.name.trim().toLowerCase();
    } else if (rule === 'tvg_id') {
      key = (ch.tvg_id || ch.stream_url).trim().toLowerCase();
    } else {
      key = `${ch.stream_url.trim().toLowerCase()}::${ch.name.trim().toLowerCase()}`;
    }

    if (key && seenMap.has(key)) {
      return {
        ...ch,
        is_duplicate: true,
        duplicate_of: seenMap.get(key),
      };
    }

    if (key) {
      seenMap.set(key, ch.id);
    }

    return {
      ...ch,
      is_duplicate: false,
      duplicate_of: undefined,
    };
  });
}

/**
 * Exports normalized channels into standard M3U format (`channels.m3u` or category playlists).
 */
export function exportChannelsToM3u(
  channels: NormalizedChannelRecord[],
  options: { excludeDuplicates?: boolean; categoryFilter?: ChannelCategory; epgUrl?: string } = {}
): string {
  const filtered = channels.filter((ch) => {
    if (options.excludeDuplicates && ch.is_duplicate) return false;
    if (options.categoryFilter && ch.category !== options.categoryFilter) return false;
    return true;
  });

  const header = options.epgUrl ? `#EXTM3U url-tvg="${options.epgUrl}"` : '#EXTM3U';
  const lines: string[] = [header];

  for (const ch of filtered) {
    const attrs: string[] = [];
    if (ch.tvg_id) attrs.push(`tvg-id="${ch.tvg_id}"`);
    if (ch.tvg_name || ch.name) attrs.push(`tvg-name="${ch.tvg_name || ch.name}"`);
    if (ch.logo) attrs.push(`tvg-logo="${ch.logo}"`);
    attrs.push(`group-title="${ch.category}"`);

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    lines.push(`#EXTINF:-1${attrStr},${ch.name}`);
    lines.push(ch.stream_url);
  }

  return lines.join('\n') + '\n';
}

/**
 * Exports normalized channels into JSON format matching the required normalized channel record specification.
 */
export function exportChannelsToJson(
  channels: NormalizedChannelRecord[],
  excludeDuplicates = false
): string {
  const filtered = excludeDuplicates ? channels.filter((c) => !c.is_duplicate) : channels;
  const normalizedRecords = filtered.map((ch) => ({
    name: ch.name,
    category: ch.category,
    logo: ch.logo,
    stream_url: ch.stream_url,
    type: ch.type,
    resolution: ch.resolution,
    status: ch.status,
    validation_status: ch.validation_status,
    latency_ms: ch.latency_ms,
    tvg_id: ch.tvg_id || null,
    is_duplicate: ch.is_duplicate,
  }));
  return JSON.stringify(normalizedRecords, null, 2);
}

/**
 * Exports normalized channels into CSV format (`channels.csv` or `failed-streams.csv`).
 */
export function exportChannelsToCsv(
  channels: NormalizedChannelRecord[],
  onlyFailed = false
): string {
  const filtered = onlyFailed
    ? channels.filter((c) => c.validation_status !== 'ONLINE')
    : channels;

  const headers = [
    'name',
    'category',
    'logo',
    'stream_url',
    'type',
    'resolution',
    'status',
    'validation_status',
    'latency_ms',
    'is_duplicate',
  ];

  const escapeCsv = (val: unknown): string => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = filtered.map((ch) =>
    [
      ch.name,
      ch.category,
      ch.logo,
      ch.stream_url,
      ch.type,
      ch.resolution,
      ch.status,
      ch.validation_status,
      ch.latency_ms,
      ch.is_duplicate,
    ]
      .map(escapeCsv)
      .join(',')
  );

  return [headers.join(','), ...rows].join('\n') + '\n';
}

import {
  db,
  MediaType,
  NormalizedChannelRecord,
  ScanCheckpoint,
  ScannedSourceRecord,
} from '../database/models.ts';
import { normalizeCategory, parseM3uPlaylist } from '../parsers/m3u_parser.ts';
import { getSecurityConfig, RateLimitedPool, safeFetchWithRetry } from './ssrf_guard.ts';

export function detectMediaType(url: string, contentType: string, bodySample: string): MediaType {
  const cleanUrl = url.split('?')[0].toLowerCase();
  const ct = contentType.toLowerCase();
  const trimmedBody = bodySample.trim();

  if (trimmedBody.startsWith('#EXTM3U')) {
    if (
      trimmedBody.includes('#EXT-X-STREAM-INF') ||
      trimmedBody.includes('#EXT-X-TARGETDURATION') ||
      cleanUrl.endsWith('.m3u8')
    ) {
      return 'HLS';
    }
    return 'M3U';
  }

  if (cleanUrl.endsWith('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegurl')) {
    return 'M3U8';
  }
  if (cleanUrl.endsWith('.m3u')) {
    return 'M3U';
  }
  if (cleanUrl.endsWith('.ts') || ct.includes('mp2t')) {
    return 'MPEG-TS';
  }
  if (cleanUrl.endsWith('.mp4') || ct.includes('video/mp4')) {
    return 'MP4';
  }
  if (
    cleanUrl.endsWith('.xml') ||
    cleanUrl.includes('epg') ||
    trimmedBody.startsWith('<?xml') ||
    trimmedBody.includes('<tv')
  ) {
    return cleanUrl.includes('epg') || trimmedBody.includes('<programme') ? 'EPG' : 'XML_API';
  }
  if (
    cleanUrl.endsWith('.json') ||
    ct.includes('application/json') ||
    trimmedBody.startsWith('{') ||
    trimmedBody.startsWith('[')
  ) {
    return 'JSON_API';
  }
  if (/\.(png|jpg|jpeg|svg|webp)$/i.test(cleanUrl) || ct.startsWith('image/')) {
    return 'LOGO';
  }

  return 'UNKNOWN';
}

/**
 * Extracts publicly declared media links (.m3u, .m3u8, .mp4, .ts, EPG .xml, JSON APIs)
 * from an authorized webpage or HTML manifest without scraping credentials or bypassing WAF.
 */
export function extractMediaLinksFromText(text: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const urlRegex = /(https?:\/\/[^\s"'<>\\]+)|(["'](\/[^\s"'<>\\]+\.(?:m3u8|m3u|mp4|ts|xml|json))["'])/gi;
  let match: RegExpExecArray | null;

  while ((match = urlRegex.exec(text)) !== null) {
    const raw = match[1] || match[3];
    if (!raw) continue;
    try {
      const resolved = new URL(raw, baseUrl).toString();
      if (/\.(m3u8|m3u|mp4|ts|xml|json|png|svg)(\?.*)?$/i.test(resolved) || /\/hls\/|\/live\//i.test(resolved)) {
        urls.add(resolved);
      }
    } catch {
      // Ignore malformed URLs
    }
  }

  return Array.from(urls);
}

export interface ScanSourceOptions {
  targetUrl?: string;
  localContent?: string;
  localFileName?: string;
  sourceType?: 'website' | 'api' | 'm3u' | 'hls' | 'local';
  timeoutMs?: number;
  maxRetries?: number;
  concurrency?: number;
  rateLimitRps?: number;
  checkpointId?: string;
}

export interface ScanSourceSummary {
  checkpoint: ScanCheckpoint;
  scannedSources: ScannedSourceRecord[];
  discoveredChannels: NormalizedChannelRecord[];
}

/**
 * Scans an authorized URL or local M3U/JSON/XML payload, records source telemetry,
 * extracts channels, and stores checkpoints for resumable operation.
 */
export async function runAuthorizedSourceScan(
  options: ScanSourceOptions
): Promise<ScanSourceSummary> {
  const secCfg = getSecurityConfig();
  const timeoutMs = options.timeoutMs ?? secCfg.timeoutMs;
  const maxRetries = options.maxRetries ?? secCfg.maxRetries;
  const concurrency = options.concurrency ?? secCfg.concurrency;
  const rateLimitRps = options.rateLimitRps ?? secCfg.rateLimitRps;

  const scannedSources: ScannedSourceRecord[] = [];
  const discoveredChannels: NormalizedChannelRecord[] = [];
  const now = new Date().toISOString();

  // Handle local M3U/M3U8/JSON upload directly
  if (options.localContent) {
    const fileName = options.localFileName || 'local-upload.m3u';
    const mediaType = detectMediaType(fileName, 'text/plain', options.localContent);
    const srcRecord: ScannedSourceRecord = {
      id: `src-local-${Date.now()}`,
      url: `local://${fileName}`,
      source_origin: 'Local Authorized File Upload',
      http_status: 200,
      content_type: mediaType === 'JSON_API' ? 'application/json' : 'audio/x-mpegurl',
      response_size: Buffer.byteLength(options.localContent, 'utf-8'),
      response_time_ms: 4,
      media_type: mediaType,
      working_status: 'working',
      discovered_at: now,
    };
    scannedSources.push(srcRecord);

    if (mediaType === 'M3U' || mediaType === 'M3U8' || mediaType === 'HLS' || options.localContent.includes('#EXTINF')) {
      const parsed = parseM3uPlaylist(options.localContent);
      discoveredChannels.push(...parsed.channels);
    } else if (mediaType === 'JSON_API') {
      try {
        const jsonData = JSON.parse(options.localContent);
        const list = Array.isArray(jsonData) ? jsonData : jsonData.channels || jsonData.data || [];
        for (const item of list) {
          if (item && (item.stream_url || item.url)) {
            const streamUrl = String(item.stream_url || item.url);
            discoveredChannels.push({
              id: `ch-json-${Date.now()}-${discoveredChannels.length + 1}`,
              name: String(item.name || item.title || `Channel ${discoveredChannels.length + 1}`),
              category: normalizeCategory(item.category || item.group, item.name),
              logo: String(item.logo || item.tvg_logo || ''),
              stream_url: streamUrl,
              type: streamUrl.endsWith('.mp4') ? 'MP4' : streamUrl.endsWith('.ts') ? 'MPEG-TS' : 'HLS',
              resolution: String(item.resolution || 'Unknown'),
              status: 'online',
              validation_status: 'ONLINE',
              latency_ms: 10,
              is_duplicate: false,
              drm_protected: false,
              last_checked: now,
            });
          }
        }
      } catch {
        // Ignore JSON parse error
      }
    }

    const checkpoint: ScanCheckpoint = {
      id: `chk-${Date.now()}`,
      target_url: `local://${fileName}`,
      total_items: 1 + discoveredChannels.length,
      processed_items: 1 + discoveredChannels.length,
      status: 'completed',
      pending_urls: [],
      started_at: now,
      updated_at: new Date().toISOString(),
    };

    db.transaction((state) => {
      state.sources.unshift(...scannedSources);
      state.channels.unshift(...discoveredChannels);
      state.checkpoints.unshift(checkpoint);
    });

    db.logAudit(
      'SCAN_SOURCE',
      `local://${fileName}`,
      'SUCCESS',
      `Scanned local file (${srcRecord.response_size} bytes), discovered ${discoveredChannels.length} channels.`
    );

    return { checkpoint, scannedSources, discoveredChannels };
  }

  const targetUrl = (options.targetUrl || '').trim();
  if (!targetUrl) {
    throw new Error('Target URL or local file content is required.');
  }

  // Primary fetch with SSRF protection
  const primaryResp = await safeFetchWithRetry(targetUrl, {
    timeoutMs,
    maxRetries,
  });

  if (primaryResp.ssrfBlocked) {
    db.logAudit('SECURITY_BLOCK', targetUrl, 'BLOCKED', primaryResp.error || 'SSRF Blocked');
    throw new Error(primaryResp.error || 'Blocked by SSRF Protection');
  }

  const detectedPrimaryType = detectMediaType(
    targetUrl,
    primaryResp.contentType,
    primaryResp.bodyText.slice(0, 2000)
  );

  const primaryRecord: ScannedSourceRecord = {
    id: `src-${Date.now()}-primary`,
    url: targetUrl,
    source_origin: options.sourceType ? `Authorized ${options.sourceType.toUpperCase()} Scan` : 'Direct URL Scan',
    http_status: primaryResp.status,
    content_type: primaryResp.contentType || 'unknown',
    response_size: primaryResp.contentLength,
    response_time_ms: primaryResp.latencyMs,
    media_type: detectedPrimaryType,
    working_status: primaryResp.unauthorized
      ? 'unauthorized'
      : primaryResp.ok
      ? 'working'
      : 'failed',
    error_message: primaryResp.error,
    discovered_at: now,
  };

  scannedSources.push(primaryRecord);

  const childUrlsToProbe: string[] = [];

  if (primaryResp.ok && primaryResp.bodyText) {
    if (
      detectedPrimaryType === 'M3U' ||
      detectedPrimaryType === 'M3U8' ||
      detectedPrimaryType === 'HLS'
    ) {
      if (primaryResp.bodyText.includes('#EXTINF') && !primaryResp.bodyText.includes('#EXT-X-TARGETDURATION')) {
        const parsed = parseM3uPlaylist(primaryResp.bodyText, targetUrl);
        discoveredChannels.push(...parsed.channels);
        if (parsed.epgUrl) childUrlsToProbe.push(parsed.epgUrl);
      } else {
        // Single HLS Master or Variant stream
        discoveredChannels.push({
          id: `ch-hls-${Date.now()}`,
          name: targetUrl.split('/').filter(Boolean).pop() || 'HLS Stream',
          category: 'Other',
          logo: '',
          stream_url: targetUrl,
          type: 'HLS',
          resolution: primaryResp.bodyText.includes('1920x1080')
            ? '1920x1080'
            : primaryResp.bodyText.includes('1280x720')
            ? '1280x720'
            : 'Unknown',
          status: 'online',
          validation_status: 'ONLINE',
          latency_ms: primaryResp.latencyMs,
          is_duplicate: false,
          drm_protected: primaryResp.bodyText.includes('#EXT-X-KEY'),
          last_checked: now,
        });
      }
    } else if (detectedPrimaryType === 'JSON_API') {
      try {
        const parsedJson = JSON.parse(primaryResp.bodyText);
        const items = Array.isArray(parsedJson)
          ? parsedJson
          : parsedJson.channels || parsedJson.streams || parsedJson.data || [];
        for (const item of items) {
          if (item && (item.stream_url || item.url)) {
            const sUrl = String(item.stream_url || item.url);
            discoveredChannels.push({
              id: `ch-api-${Date.now()}-${discoveredChannels.length + 1}`,
              name: String(item.name || item.title || `API Channel ${discoveredChannels.length + 1}`),
              category: normalizeCategory(item.category, item.name),
              logo: String(item.logo || ''),
              stream_url: sUrl,
              type: 'HLS',
              resolution: String(item.resolution || 'Unknown'),
              status: 'online',
              validation_status: 'ONLINE',
              latency_ms: primaryResp.latencyMs,
              is_duplicate: false,
              drm_protected: false,
              last_checked: now,
            });
          }
        }
      } catch {
        // Non-channel JSON
      }
    } else {
      // Extract embedded media resources from HTML/XML
      const extracted = extractMediaLinksFromText(primaryResp.bodyText, targetUrl);
      childUrlsToProbe.push(...extracted.slice(0, 15));
    }
  }

  // Probe discovered child URLs with rate limiting and concurrency pool
  if (childUrlsToProbe.length > 0) {
    const pool = new RateLimitedPool(rateLimitRps);
    const childResults = await pool.runAll(childUrlsToProbe, concurrency, async (childUrl, idx) => {
      const r = await safeFetchWithRetry(childUrl, { timeoutMs, maxRetries: 1 });
      const mType = detectMediaType(childUrl, r.contentType, r.bodyText.slice(0, 1000));
      const rec: ScannedSourceRecord = {
        id: `src-${Date.now()}-child-${idx}`,
        url: childUrl,
        source_origin: targetUrl,
        http_status: r.status,
        content_type: r.contentType || 'unknown',
        response_size: r.contentLength,
        response_time_ms: r.latencyMs,
        media_type: mType,
        working_status: r.unauthorized ? 'unauthorized' : r.ok ? 'working' : 'failed',
        error_message: r.error,
        discovered_at: new Date().toISOString(),
      };
      return rec;
    });
    scannedSources.push(...childResults);
  }

  const checkpoint: ScanCheckpoint = {
    id: options.checkpointId || `chk-${Date.now()}`,
    target_url: targetUrl,
    total_items: scannedSources.length,
    processed_items: scannedSources.length,
    status: 'completed',
    pending_urls: [],
    started_at: now,
    updated_at: new Date().toISOString(),
  };

  db.transaction((state) => {
    state.sources.unshift(...scannedSources);
    if (discoveredChannels.length > 0) {
      state.channels.unshift(...discoveredChannels);
    }
    state.checkpoints.unshift(checkpoint);
  });

  db.logAudit(
    'SCAN_SOURCE',
    targetUrl,
    primaryResp.ok ? 'SUCCESS' : 'WARNING',
    `HTTP ${primaryResp.status} (${primaryResp.latencyMs}ms). Sources: ${scannedSources.length}, Channels: ${discoveredChannels.length}`
  );

  return {
    checkpoint,
    scannedSources,
    discoveredChannels,
  };
}

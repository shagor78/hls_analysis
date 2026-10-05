import React, { useState } from 'react';
import { Play, RefreshCw, ShieldAlert } from 'lucide-react';
import { HlsAnalysisReport } from '../types.ts';

interface Props {
  analyses: HlsAnalysisReport[];
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

const SAMPLE_MULTI_VARIANT_MANIFEST = `#EXTM3U
#EXT-X-VERSION:4
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-stereo",NAME="Bangla Main",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="bn"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio-stereo",NAME="English Secondary",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="en",URI="audio_en/prog_index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English Subtitles",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="subs_en/prog_index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=4850000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="audio-stereo",SUBTITLES="subs"
1080p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2450000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio-stereo",SUBTITLES="subs"
720p/playlist.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=920000,RESOLUTION=848x480,CODECS="avc1.42001e,mp4a.40.2",AUDIO="audio-stereo"
480p/playlist.m3u8`;

export const HlsAnalyzerView: React.FC<Props> = ({ analyses, onRefresh, notify }) => {
  const [masterUrl, setMasterUrl] = useState<string>(
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  );
  const [rawManifest, setRawManifest] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const activeReport = analyses[selectedIndex] || analyses[0];

  const handleAnalyze = async (useSampleManifest = false) => {
    setBusy(true);
    try {
      const payload = useSampleManifest
        ? {
            masterUrl: 'https://cdn.authorized-ott.example/live/master.m3u8',
            rawManifestContent: SAMPLE_MULTI_VARIANT_MANIFEST,
            fetchVariants: false,
          }
        : {
            masterUrl,
            rawManifestContent: rawManifest.trim() ? rawManifest : undefined,
            fetchVariants: true,
          };

      const res = await fetch('/api/hls/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'HLS analysis failed');
      await onRefresh();
      setSelectedIndex(0);
      notify(
        `Analyzed HLS playlist: ${data.variants?.length || 0} variants, ${data.recognized_tags?.length || 0} HLS tags recognized.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Analysis failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const renderAsciiDependencyTree = (report: HlsAnalysisReport): string => {
    const lines: string[] = ['Master M3U8'];
    report.variants.forEach((v, idx) => {
      const isLastVar = idx === report.variants.length - 1;
      const varBranch = isLastVar ? ' └── ' : ' ├── ';
      const childIndent = isLastVar ? '      ' : ' │    ';
      const label =
        v.resolution.includes('1080')
          ? '1080p playlist'
          : v.resolution.includes('720')
          ? '720p playlist'
          : v.resolution.includes('480')
          ? '480p playlist'
          : `${v.resolution} playlist`;

      lines.push(
        `${varBranch}${label} (${Math.round(v.bandwidth / 1000)} kbps · ${v.codecs})`
      );

      const segs =
        v.segments.length > 0
          ? v.segments.slice(0, 4)
          : [
              { index: 1, duration: 10, url: 'segment 001.ts' },
              { index: 2, duration: 10, url: 'segment 002.ts' },
            ];

      segs.forEach((seg, sIdx) => {
        const isLastSeg = sIdx === segs.length - 1;
        const segBranch = isLastSeg ? '└── ' : '├── ';
        const segFileName = seg.url.split('/').pop() || `segment 00${seg.index}.ts`;
        lines.push(`${childIndent}${segBranch}${segFileName} (${seg.duration}s)`);
      });
    });
    return lines.join('\n');
  };

  return (
    <div className="space-y-6">
      {/* Input Controls */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">HLS Manifest & Dependency Tree Analyzer</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Parses Master & Variant <code className="font-mono">.m3u8</code> playlists, resolutions, bandwidth, codecs, audio/subtitle tracks, and segment URLs without bypassing DRM.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={busy}
              onClick={() => handleAnalyze(true)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Load Multi-Track Sample M3U8
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Authorized Master or Variant M3U8 URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={masterUrl}
                  onChange={(e) => setMasterUrl(e.target.value)}
                  placeholder="https://example.com/live/channel/index.m3u8"
                  className="flex-1 px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
                <button
                  disabled={busy}
                  onClick={() => handleAnalyze(false)}
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
                >
                  {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Analyze HLS
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-slate-500">Quick Presets:</span>
              <button
                onClick={() =>
                  setMasterUrl('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
                }
                className="underline hover:text-emerald-400"
              >
                Mux Big Buck Bunny Master
              </button>
              <span>·</span>
              <button
                onClick={() =>
                  setMasterUrl(
                    'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8'
                  )
                }
                className="underline hover:text-emerald-400"
              >
                Apple BipBop fMP4 Master
              </button>
              <span>·</span>
              <button
                onClick={() =>
                  setMasterUrl('https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8')
                }
                className="underline hover:text-emerald-400"
              >
                Akamai Sintel Multi-Audio
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Optional Raw .m3u8 Manifest Paste
            </label>
            <textarea
              rows={3}
              value={rawManifest}
              onChange={(e) => setRawManifest(e.target.value)}
              placeholder="#EXTM3U&#10;#EXT-X-STREAM-INF:BANDWIDTH=4600000,RESOLUTION=1920x1080..."
              className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
            />
          </div>
        </div>
      </div>

      {activeReport && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Dependency Tree & Recognized Tags */}
          <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
            <div>
              <h3 className="text-base font-semibold">HLS Dependency Tree</h3>
              <p className="text-xs text-slate-500 font-mono truncate mt-0.5">
                {activeReport.master_url}
              </p>
            </div>

            {activeReport.drm_or_encrypted && (
              <div className="p-3 border border-amber-500/40 bg-amber-500/10 rounded-md flex items-start gap-2.5 text-xs">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">DRM / Encryption Detected:</span>{' '}
                  {activeReport.encryption_details ||
                    'Stream uses #EXT-X-KEY encryption. Decryption and DRM bypass are strictly disabled.'}
                </div>
              </div>
            )}

            <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs leading-relaxed overflow-x-auto border border-slate-800">
              {renderAsciiDependencyTree(activeReport)}
            </pre>

            <div>
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                Recognized HLS Specification Tags
              </div>
              <div className="text-xs font-mono text-slate-700 dark:text-slate-300">
                {activeReport.recognized_tags.join(' · ') || '#EXTM3U'}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 font-mono text-xs tabular-nums">
              <div>
                <div className="text-slate-500 font-sans">Target Duration</div>
                <div className="font-semibold mt-0.5">
                  {activeReport.target_duration ? `${activeReport.target_duration}s` : 'Live / Dynamic'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-sans">Playlist Mode</div>
                <div className="font-semibold mt-0.5">
                  {activeReport.is_vod_endlist ? 'VOD (#EXT-X-ENDLIST)' : 'Live Sliding Window'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 font-sans">Indexed Segments</div>
                <div className="font-semibold mt-0.5">{activeReport.total_segments}</div>
              </div>
            </div>
          </div>

          {/* Right Column: Variant Table & Audio/Subtitle Tracks */}
          <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-6">
            <div>
              <h3 className="text-base font-semibold mb-3">
                Variant Playlists ({activeReport.variants.length})
              </h3>
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3">Resolution</th>
                      <th className="py-2.5 px-3 text-right">Bandwidth</th>
                      <th className="py-2.5 px-3">Codecs</th>
                      <th className="py-2.5 px-3 text-right">Segments</th>
                      <th className="py-2.5 px-3">Variant URL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                    {activeReport.variants.map((v) => (
                      <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold">{v.resolution}</td>
                        <td className="py-2.5 px-3 text-right">
                          {v.bandwidth ? `${Math.round(v.bandwidth / 1000)} kbps` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                          {v.codecs}
                        </td>
                        <td className="py-2.5 px-3 text-right">{v.segments.length}</td>
                        <td className="py-2.5 px-3 max-w-xs truncate text-slate-500" title={v.url}>
                          {v.url}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Audio Tracks (#EXT-X-MEDIA TYPE=AUDIO)
                </h4>
                {activeReport.audio_tracks.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Muxed audio inside primary MPEG-TS / fMP4 variant streams.
                  </p>
                ) : (
                  <div className="space-y-1.5 text-xs font-mono">
                    {activeReport.audio_tracks.map((t, i) => (
                      <div
                        key={i}
                        className="p-2.5 border border-slate-200 dark:border-slate-800 rounded-md"
                      >
                        {t.name} · group={t.group_id} · lang={t.language || 'und'}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Subtitle Tracks (#EXT-X-MEDIA TYPE=SUBTITLES)
                </h4>
                {activeReport.subtitle_tracks.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No separate #EXT-X-MEDIA subtitle rendition declared.
                  </p>
                ) : (
                  <div className="space-y-1.5 text-xs font-mono">
                    {activeReport.subtitle_tracks.map((t, i) => (
                      <div
                        key={i}
                        className="p-2.5 border border-slate-200 dark:border-slate-800 rounded-md"
                      >
                        {t.name} · group={t.group_id} · lang={t.language || 'und'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  FolderArchive,
  GitBranch,
  HardDrive,
  Layers,
  Moon,
  Play,
  Radar,
  RefreshCw,
  Search,
  Shield,
  Sun,
  Terminal,
  Upload,
  Wand2,
} from 'lucide-react';
import { CliAndDocsView } from './components/CliAndDocsView.tsx';
import { DatabaseAndApiView } from './components/DatabaseAndApiView.tsx';
import { HlsAnalyzerView } from './components/HlsAnalyzerView.tsx';
import { MigrationWizardView } from './components/MigrationWizardView.tsx';
import { AppStateResponse, ChannelCategory } from './types.ts';

type WorkspaceTab =
  | 'dashboard'
  | 'wizard'
  | 'scanner'
  | 'hls'
  | 'channels'
  | 'validator'
  | 'database'
  | 'backup'
  | 'security'
  | 'cli';

const ALL_CATEGORIES: ChannelCategory[] = [
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

const SAMPLE_IPTV_PLAYLIST = `#EXTM3U url-tvg="https://epg.authorized-ott.example/guide.xml"
#EXTINF:-1 tvg-id="jamuna.tv.bd" tvg-name="Jamuna TV 1080p" tvg-logo="/api/assets/logo/jamuna.svg" group-title="Bangla",Jamuna Television 1080p
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
#EXTINF:-1 tvg-id="sony.ten.in" tvg-name="Sports Cricket HD" tvg-logo="/api/assets/logo/cricket.svg" group-title="Sports",Sports Cricket Live 720p
https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8
#EXTINF:-1 tvg-id="bollywood.classic.in" tvg-name="Bollywood Premiere" tvg-logo="/api/assets/logo/bolly.svg" group-title="Hindi",Bollywood Premiere 1080p
https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8
#EXTINF:-1 tvg-id="world.news.en" tvg-name="English Global News" tvg-logo="/api/assets/logo/engnews.svg" group-title="News",English Global News 720p
https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8`;

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [state, setState] = useState<AppStateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Dashboard & Channel Table Filters, Sort, and Pagination
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'name' | 'category' | 'latency_ms' | 'status'>('name');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [page, setPage] = useState<number>(1);
  const pageSize = 8;

  // Source Scanner state
  const [scanUrl, setScanUrl] = useState<string>(
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  );
  const [scanSourceType, setScanSourceType] = useState<'website' | 'api' | 'm3u' | 'hls'>('hls');
  const [localM3uText, setLocalM3uText] = useState<string>('');
  const [scanTimeout, setScanTimeout] = useState<number>(8000);
  const [scanRetries, setScanRetries] = useState<number>(3);
  const [scanConcurrency, setScanConcurrency] = useState<number>(5);
  const [scanRateLimit, setScanRateLimit] = useState<number>(10);
  const [scanBusy, setScanBusy] = useState<boolean>(false);

  // M3U Parser & Duplicate Rule state
  const [m3uInput, setM3uInput] = useState<string>(SAMPLE_IPTV_PLAYLIST);
  const [dupRule, setDupRule] = useState<'stream_url' | 'name' | 'tvg_id' | 'url_and_name'>(
    'stream_url'
  );
  const [excludeDupsOnExport, setExcludeDupsOnExport] = useState<boolean>(true);
  const [m3uBusy, setM3uBusy] = useState<boolean>(false);

  // Validator state
  const [validatingBusy, setValidatingBusy] = useState<boolean>(false);

  // Media Backup state
  const [backupName, setBackupName] = useState<string>('Production OTT Full Backup');
  const [backupMode, setBackupMode] = useState<'Metadata Only' | 'Media Archive'>('Media Archive');
  const [hlsCaptureType, setHlsCaptureType] = useState<'Playlist backup' | 'Segment recording'>(
    'Playlist backup'
  );
  const [backupTypes, setBackupTypes] = useState<string[]>([
    'M3U8',
    'TS',
    'MP4',
    'JSON',
    'XML',
    'logos',
    'metadata',
  ]);
  const [backupBusy, setBackupBusy] = useState<boolean>(false);

  // Security Settings state
  const [allowPrivateNets, setAllowPrivateNets] = useState<boolean>(false);
  const [allowlistInput, setAllowlistInput] = useState<string>('');

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      const data = (await res.json()) as AppStateResponse;
      setState(data);
      setAllowPrivateNets(data.securityConfig.allowPrivateNetworks);
      setAllowlistInput(data.securityConfig.urlAllowlist.join(', '));
    } catch (err) {
      console.error('Failed to load state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const filteredAndSortedChannels = useMemo(() => {
    if (!state) return [];
    const q = searchQuery.trim().toLowerCase();

    const filtered = state.channels.filter((ch) => {
      if (categoryFilter !== 'ALL' && ch.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && ch.validation_status !== statusFilter) return false;
      if (q) {
        return (
          ch.name.toLowerCase().includes(q) ||
          ch.stream_url.toLowerCase().includes(q) ||
          ch.category.toLowerCase().includes(q) ||
          (ch.tvg_id && ch.tvg_id.toLowerCase().includes(q))
        );
      }
      return true;
    });

    return filtered.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortField === 'category') cmp = a.category.localeCompare(b.category);
      else if (sortField === 'latency_ms') cmp = a.latency_ms - b.latency_ms;
      else if (sortField === 'status') cmp = a.validation_status.localeCompare(b.validation_status);
      return sortAsc ? cmp : -cmp;
    });
  }, [state, searchQuery, categoryFilter, statusFilter, sortField, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedChannels.length / pageSize));
  const paginatedChannels = filteredAndSortedChannels.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  const handleBulkValidate = async () => {
    setValidatingBusy(true);
    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeoutMs: scanTimeout,
          maxRetries: scanRetries,
          concurrency: scanConcurrency,
          rateLimitRps: scanRateLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');
      await fetchState();
      notify(`Validated ${data.results?.length || 0} streams with exponential backoff & HLS syntax checks.`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Bulk validation failed', 'error');
    } finally {
      setValidatingBusy(false);
    }
  };

  const handleRunSourceScan = async (isLocal = false) => {
    setScanBusy(true);
    try {
      const payload = isLocal
        ? {
            localContent: localM3uText || SAMPLE_IPTV_PLAYLIST,
            localFileName: 'uploaded-playlist.m3u',
            sourceType: 'local',
          }
        : {
            targetUrl: scanUrl,
            sourceType: scanSourceType,
            timeoutMs: scanTimeout,
            maxRetries: scanRetries,
            concurrency: scanConcurrency,
            rateLimitRps: scanRateLimit,
          };

      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Source scan failed');
      await fetchState();
      notify(
        `Scanned ${data.scannedSources?.length || 1} sources, discovered ${data.discoveredChannels?.length || 0} channels.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Scan blocked or failed', 'error');
    } finally {
      setScanBusy(false);
    }
  };

  const handleParseM3u = async () => {
    setM3uBusy(true);
    try {
      const res = await fetch('/api/m3u/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: m3uInput,
          duplicateRule: dupRule,
          importToCatalog: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'M3U parse failed');
      await fetchState();
      notify(
        `Parsed ${data.channels?.length || 0} channels (${data.duplicatesCount || 0} duplicates flagged by ${dupRule}).`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Failed to parse playlist', 'error');
    } finally {
      setM3uBusy(false);
    }
  };

  const handleApplyDuplicateRule = async (removeDuplicates = false) => {
    try {
      const res = await fetch('/api/channels/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: dupRule, removeDuplicates }),
      });
      const data = await res.json();
      await fetchState();
      notify(
        removeDuplicates
          ? `Deduplicated catalog using rule "${dupRule}".`
          : `Evaluated duplicate rule "${dupRule}": ${data.duplicatesCount} duplicates detected.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Duplicate check failed', 'error');
    }
  };

  const handleRunMediaBackup = async () => {
    setBackupBusy(true);
    try {
      const res = await fetch('/api/media-backup/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: backupName,
          mode: backupMode,
          hlsCaptureType,
          includedTypes: backupTypes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Media backup failed');
      await fetchState();
      notify(
        `Media backup created in ${data.archive_path} (${data.channels_count} channels, ${data.skipped_drm_count} DRM streams skipped).`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Media backup error', 'error');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleSaveSecuritySettings = async () => {
    try {
      const allowlist = allowlistInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch('/api/security/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowPrivateNetworks: allowPrivateNets,
          urlAllowlist: allowlist,
          rateLimitRps: scanRateLimit,
          timeoutMs: scanTimeout,
          maxRetries: scanRetries,
          concurrency: scanConcurrency,
        }),
      });
      if (!res.ok) throw new Error('Failed to update security configuration');
      await fetchState();
      notify('Updated SSRF, URL allowlist, rate limit, and worker concurrency policies.');
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Error saving security policy', 'error');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      setLocalM3uText(content);
      setM3uInput(content);
      notify(`Loaded local file "${file.name}" (${content.length} bytes).`);
    };
    reader.readAsText(file);
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="max-w-md w-full space-y-3 text-center">
          <RefreshCw className="w-6 h-6 animate-spin text-emerald-500 mx-auto" />
          <div className="text-sm font-medium">Loading StreamVault OTT Migration & Backup Suite…</div>
        </div>
      </div>
    );
  }

  const migrationProgressPct =
    state.db_migrations.length > 0 || state.media_backups.length > 0 ? 100 : 85;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar Contract: Strictly 3 zones (Brand Wordmark — 5 Clean Nav Links — Primary Actions) */}
      <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 flex items-center justify-between shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#dashboard"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap"
        >
          StreamVault
        </a>

        {/* Zone 2: 5 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${
              activeTab === 'dashboard' ? 'text-slate-900 dark:text-white underline underline-offset-8' : ''
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('wizard')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${
              activeTab === 'wizard' ? 'text-slate-900 dark:text-white underline underline-offset-8' : ''
            }`}
          >
            Migration Wizard
          </button>
          <button
            onClick={() => setActiveTab('hls')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${
              activeTab === 'hls' ? 'text-slate-900 dark:text-white underline underline-offset-8' : ''
            }`}
          >
            HLS Analyzer
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${
              activeTab === 'database' ? 'text-slate-900 dark:text-white underline underline-offset-8' : ''
            }`}
          >
            Database & API
          </button>
          <button
            onClick={() => setActiveTab('cli')}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap ${
              activeTab === 'cli' ? 'text-slate-900 dark:text-white underline underline-offset-8' : ''
            }`}
          >
            CLI & Tests
          </button>
        </nav>

        {/* Zone 3: 2 primary actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setDarkMode(!darkMode)}
            aria-label="Toggle dark or light theme"
            className="p-2 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <a
            href="/api/export/channels.m3u"
            download="channels.m3u"
            className="px-3.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap"
          >
            Export Playlist
          </a>
        </div>
      </header>

      {/* Main Workspace Canvas: Left Sidebar (256px) + Main Content Viewport */}
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 hidden lg:flex flex-col justify-between shrink-0">
          <div className="space-y-1">
            {[
              { id: 'dashboard', label: 'Overview Dashboard', icon: Layers },
              { id: 'wizard', label: '10-Step Migration Wizard', icon: Wand2 },
              { id: 'scanner', label: 'Source Scanner', icon: Radar },
              { id: 'hls', label: 'HLS Dependency Analyzer', icon: GitBranch },
              { id: 'channels', label: 'Channel Discovery & M3U', icon: FileSpreadsheet },
              { id: 'validator', label: 'Stream Validator', icon: Activity },
              { id: 'database', label: 'Database & API Migration', icon: Database },
              { id: 'backup', label: 'Media Backup & Reports', icon: FolderArchive },
              { id: 'security', label: 'Security & Audit Logs', icon: Shield },
              { id: 'cli', label: 'CLI & Automated Tests', icon: Terminal },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as WorkspaceTab)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 space-y-1">
            <div className="font-medium text-slate-700 dark:text-slate-300">
              Authorized Scope Active
            </div>
            <div>SSRF Guard · Secret Masking · Audit Log</div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-6 space-y-6 max-w-[1440px] mx-auto">
          {/* Mobile Workspace Switcher */}
          <div className="flex lg:hidden overflow-x-auto gap-1.5 pb-2 border-b border-slate-200 dark:border-slate-800">
            {[
              { id: 'dashboard', label: 'Dashboard' },
              { id: 'wizard', label: 'Wizard' },
              { id: 'scanner', label: 'Scanner' },
              { id: 'hls', label: 'HLS Tree' },
              { id: 'channels', label: 'M3U Parser' },
              { id: 'validator', label: 'Validator' },
              { id: 'database', label: 'DB & API' },
              { id: 'backup', label: 'Backups & Reports' },
              { id: 'security', label: 'Audit & Security' },
              { id: 'cli', label: 'CLI & Tests' },
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setActiveTab(m.id as WorkspaceTab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                  activeTab === m.id
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-300 dark:border-slate-700'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {toast && (
            <div
              className={`p-3.5 rounded-md border text-xs font-medium flex items-center justify-between ${
                toast.type === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              <span>{toast.message}</span>
              <button onClick={() => setToast(null)} className="underline ml-4">
                Dismiss
              </button>
            </div>
          )}

          {/* TAB 1: OVERVIEW DASHBOARD */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* 11 Required Dashboard Metrics */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h1 className="text-xl font-semibold">
                      OTT Platform Migration & HLS Telemetry Overview
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                      Authorized inventory across M3U8 playlists, MPEG-TS relays, MP4 VOD origins, catalog APIs, and relational database tables.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      disabled={validatingBusy}
                      onClick={handleBulkValidate}
                      className="px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-1.5 whitespace-nowrap"
                    >
                      {validatingBusy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Activity className="w-3.5 h-3.5" />
                      )}
                      Bulk Validate Streams
                    </button>
                    <button
                      onClick={() => setActiveTab('wizard')}
                      className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      Launch 10-Step Wizard
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-5 gap-x-6 pt-5 font-mono tabular-nums">
                  <div>
                    <div className="text-xs font-sans text-slate-500">Total Sources</div>
                    <div className="text-2xl font-semibold mt-1">{state.summary.total_sources}</div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">Working Streams</div>
                    <div className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                      {state.summary.online}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">Failed Streams</div>
                    <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">
                      {state.summary.offline + state.summary.timeout + state.summary.invalid}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">M3U8 Sources</div>
                    <div className="text-2xl font-semibold mt-1">{state.summary.m3u8_sources}</div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">MPEG-TS Sources</div>
                    <div className="text-2xl font-semibold mt-1">
                      {state.summary.mpeg_ts_sources}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">MP4 Sources</div>
                    <div className="text-2xl font-semibold mt-1">{state.summary.mp4_sources}</div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">Channels</div>
                    <div className="text-2xl font-semibold mt-1">
                      {state.summary.total_channels}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">Categories</div>
                    <div className="text-2xl font-semibold mt-1">
                      {Object.keys(state.summary.categories_breakdown).length}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">API Sources</div>
                    <div className="text-2xl font-semibold mt-1">{state.summary.api_sources}</div>
                  </div>
                  <div>
                    <div className="text-xs font-sans text-slate-500">Database Tables</div>
                    <div className="text-2xl font-semibold mt-1">
                      {state.summary.database_tables}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center justify-between text-xs font-sans text-slate-500">
                      <span>Migration Readiness Progress</span>
                      <span className="font-mono">{migrationProgressPct}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-2">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${migrationProgressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Channel Directory with Search, Filter, Sort, Pagination, and Export Buttons */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setPage(1);
                        }}
                        placeholder="Search channels, URLs, tvg-id…"
                        className="pl-9 pr-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent w-64"
                      />
                    </div>

                    <select
                      value={categoryFilter}
                      onChange={(e) => {
                        setCategoryFilter(e.target.value);
                        setPage(1);
                      }}
                      className="px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="ALL" className="bg-slate-900 text-white">All Categories</option>
                      {ALL_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat} className="bg-slate-900 text-white">
                          {cat}
                        </option>
                      ))}
                    </select>

                    <select
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPage(1);
                      }}
                      className="px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="ALL" className="bg-slate-900 text-white">All Statuses</option>
                      <option value="ONLINE" className="bg-slate-900 text-white">ONLINE</option>
                      <option value="OFFLINE" className="bg-slate-900 text-white">OFFLINE</option>
                      <option value="TIMEOUT" className="bg-slate-900 text-white">TIMEOUT</option>
                      <option value="INVALID_M3U8" className="bg-slate-900 text-white">INVALID_M3U8</option>
                      <option value="UNAUTHORIZED" className="bg-slate-900 text-white">UNAUTHORIZED</option>
                      <option value="SERVER_ERROR" className="bg-slate-900 text-white">SERVER_ERROR</option>
                    </select>
                  </div>

                  {/* Quick Export Bar */}
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href="/api/export/channels.m3u"
                      download="channels.m3u"
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> channels.m3u
                    </a>
                    <a
                      href="/api/export/channels.json"
                      download="channels.json"
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> channels.json
                    </a>
                    <a
                      href="/api/export/channels.csv"
                      download="channels.csv"
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> channels.csv
                    </a>
                    <a
                      href="/api/export/scan-report.json"
                      download="scan-report.json"
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" /> scan-report.json
                    </a>
                  </div>
                </div>

                {/* High-Density Channel Data Grid */}
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3">
                          <button
                            onClick={() => {
                              if (sortField === 'name') setSortAsc(!sortAsc);
                              else {
                                setSortField('name');
                                setSortAsc(true);
                              }
                            }}
                            className="flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-white"
                          >
                            Channel <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-2.5 px-3">
                          <button
                            onClick={() => {
                              if (sortField === 'category') setSortAsc(!sortAsc);
                              else {
                                setSortField('category');
                                setSortAsc(true);
                              }
                            }}
                            className="flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-white"
                          >
                            Category · Format <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-2.5 px-3">Resolution · Codec</th>
                        <th className="py-2.5 px-3">Stream URL</th>
                        <th className="py-2.5 px-3">
                          <button
                            onClick={() => {
                              if (sortField === 'status') setSortAsc(!sortAsc);
                              else {
                                setSortField('status');
                                setSortAsc(true);
                              }
                            }}
                            className="flex items-center gap-1 font-semibold hover:text-slate-900 dark:hover:text-white"
                          >
                            Validation Status <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="py-2.5 px-3 text-right">
                          <button
                            onClick={() => {
                              if (sortField === 'latency_ms') setSortAsc(!sortAsc);
                              else {
                                setSortField('latency_ms');
                                setSortAsc(true);
                              }
                            }}
                            className="flex items-center justify-end gap-1 font-semibold ml-auto hover:text-slate-900 dark:hover:text-white"
                          >
                            Latency <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {paginatedChannels.map((ch) => (
                        <tr key={ch.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded bg-slate-800 flex items-center justify-center overflow-hidden shrink-0 border border-slate-700">
                                {ch.logo ? (
                                  <img
                                    src={ch.logo}
                                    alt={`${ch.name} logo`}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-[10px] font-mono font-bold text-emerald-400">
                                    TV
                                  </span>
                                )}
                              </div>
                              <div>
                                <div className="font-medium text-slate-900 dark:text-slate-100">
                                  {ch.name}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono">
                                  {ch.tvg_id || ch.id}
                                  {ch.is_duplicate ? ' · Duplicate' : ''}
                                  {ch.drm_protected ? ' · Protected/DRM' : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                            {ch.category} · <span className="font-mono">{ch.type}</span>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {ch.resolution}
                            {ch.codec ? ` · ${ch.codec}` : ''}
                          </td>
                          <td
                            className="py-2.5 px-3 font-mono text-slate-500 max-w-xs truncate"
                            title={ch.stream_url}
                          >
                            {ch.stream_url}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            <span
                              className={
                                ch.validation_status === 'ONLINE'
                                  ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                  : ch.validation_status === 'UNAUTHORIZED'
                                  ? 'text-amber-600 dark:text-amber-400 font-semibold'
                                  : 'text-red-600 dark:text-red-400 font-semibold'
                              }
                            >
                              {ch.validation_status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {ch.latency_ms > 0 ? `${ch.latency_ms} ms` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Bar */}
                <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                  <div className="font-mono tabular-nums">
                    Showing {(page - 1) * pageSize + 1}–
                    {Math.min(page * pageSize, filteredAndSortedChannels.length)} of{' '}
                    {filteredAndSortedChannels.length} channels
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-40 flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Prev
                    </button>
                    <span className="font-mono tabular-nums">
                      Page {page} / {totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="px-2.5 py-1 border border-slate-300 dark:border-slate-700 rounded disabled:opacity-40 flex items-center gap-1"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Scan History & Error / Audit Logs */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6 space-y-3">
                  <h3 className="text-sm font-semibold">Recent Scan History & Checkpoints</h3>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {state.sources.slice(0, 5).map((src) => (
                      <div key={src.id} className="py-2.5 flex items-center justify-between gap-4">
                        <div className="truncate">
                          <div className="font-mono truncate text-slate-800 dark:text-slate-200">
                            {src.url}
                          </div>
                          <div className="text-slate-500">
                            {src.source_origin} · {src.media_type} · {src.content_type}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div
                            className={
                              src.working_status === 'working'
                                ? 'text-emerald-500'
                                : src.working_status === 'unauthorized'
                                ? 'text-amber-500'
                                : 'text-red-500'
                            }
                          >
                            HTTP {src.http_status} · {src.working_status.toUpperCase()}
                          </div>
                          <div className="text-slate-500">{src.response_time_ms} ms</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6 space-y-3">
                  <h3 className="text-sm font-semibold">Error & Security Audit Logs</h3>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {state.audit_logs.slice(0, 5).map((log) => (
                      <div key={log.id} className="py-2.5">
                        <div className="flex items-center justify-between font-mono">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {log.operation} · {log.status}
                          </span>
                          <span className="text-slate-500 tabular-nums">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                          {log.details}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 10-STEP MIGRATION WIZARD */}
          {activeTab === 'wizard' && (
            <MigrationWizardView state={state} onRefresh={fetchState} notify={notify} />
          )}

          {/* TAB 3: SOURCE SCANNER */}
          {activeTab === 'scanner' && (
            <div className="space-y-6">
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">Authorized Source Scanner</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Scans Website URLs, API URLs, M3U/M3U8 playlists, HLS streams, or local files. Detects M3U, M3U8, HLS, MPEG-TS, MP4, JSON/XML APIs, logos, and EPG guides with SSRF protection.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Input Resource Type
                    </label>
                    <select
                      value={scanSourceType}
                      onChange={(e) => setScanSourceType(e.target.value as typeof scanSourceType)}
                      className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="hls" className="bg-slate-900 text-white">HLS URL (.m3u8)</option>
                      <option value="m3u" className="bg-slate-900 text-white">M3U / M3U8 Playlist URL</option>
                      <option value="api" className="bg-slate-900 text-white">JSON / XML API URL</option>
                      <option value="website" className="bg-slate-900 text-white">Authorized Website URL</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Authorized Target URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={scanUrl}
                        onChange={(e) => setScanUrl(e.target.value)}
                        className="flex-1 px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                      />
                      <button
                        disabled={scanBusy}
                        onClick={() => handleRunSourceScan(false)}
                        className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
                      >
                        {scanBusy ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        Scan URL
                      </button>
                    </div>
                  </div>
                </div>

                {/* Reliability & Rate Limit Controls */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono tabular-nums">
                  <div>
                    <label className="block text-xs font-sans text-slate-500 mb-1">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={scanTimeout}
                      onChange={(e) => setScanTimeout(Number(e.target.value) || 8000)}
                      className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-sans text-slate-500 mb-1">
                      Max Retries (Backoff)
                    </label>
                    <input
                      type="number"
                      value={scanRetries}
                      onChange={(e) => setScanRetries(Number(e.target.value) || 3)}
                      className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-sans text-slate-500 mb-1">
                      Worker Concurrency
                    </label>
                    <input
                      type="number"
                      value={scanConcurrency}
                      onChange={(e) => setScanConcurrency(Number(e.target.value) || 5)}
                      className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-sans text-slate-500 mb-1">
                      Rate Limit (RPS)
                    </label>
                    <input
                      type="number"
                      value={scanRateLimit}
                      onChange={(e) => setScanRateLimit(Number(e.target.value) || 10)}
                      className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                </div>

                {/* Local M3U/M3U8 Upload */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Upload className="w-4 h-4" />
                    <span>Upload Local .m3u / .m3u8 / .json File</span>
                    <input
                      type="file"
                      accept=".m3u,.m3u8,.json,.xml,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    disabled={scanBusy}
                    onClick={() => handleRunSourceScan(true)}
                    className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Scan Uploaded / Sample Local M3U File
                  </button>
                </div>
              </div>

              {/* Scanned Sources Telemetry Table */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <h3 className="text-base font-semibold">
                  Scanned Media Sources ({state.sources.length})
                </h3>
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3">URL</th>
                        <th className="py-2.5 px-3 text-right">HTTP Status</th>
                        <th className="py-2.5 px-3">Content-Type</th>
                        <th className="py-2.5 px-3 text-right">Response Size</th>
                        <th className="py-2.5 px-3 text-right">Response Time</th>
                        <th className="py-2.5 px-3">Detected Media Type</th>
                        <th className="py-2.5 px-3">Working / Failed Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                      {state.sources.map((src) => (
                        <tr key={src.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 max-w-xs truncate" title={src.url}>
                            {src.url}
                          </td>
                          <td className="py-2.5 px-3 text-right">{src.http_status}</td>
                          <td className="py-2.5 px-3 text-slate-500">{src.content_type}</td>
                          <td className="py-2.5 px-3 text-right">
                            {(src.response_size / 1024).toFixed(1)} KB
                          </td>
                          <td className="py-2.5 px-3 text-right">{src.response_time_ms} ms</td>
                          <td className="py-2.5 px-3 font-semibold">{src.media_type}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={
                                src.working_status === 'working'
                                  ? 'text-emerald-500 font-semibold'
                                  : src.working_status === 'unauthorized'
                                  ? 'text-amber-500 font-semibold'
                                  : 'text-red-500 font-semibold'
                              }
                            >
                              {src.working_status.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: HLS ANALYZER */}
          {activeTab === 'hls' && (
            <HlsAnalyzerView
              analyses={state.hls_analyses}
              onRefresh={fetchState}
              notify={notify}
            />
          )}

          {/* TAB 5: CHANNEL DISCOVERY & M3U PARSER */}
          {activeTab === 'channels' && (
            <div className="space-y-6">
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">
                      IPTV M3U/M3U8 Parser, Category Normalizer & Duplicate Detector
                    </h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Parses <code className="font-mono">#EXTINF</code>, <code className="font-mono">tvg-id</code>, <code className="font-mono">tvg-name</code>, <code className="font-mono">tvg-logo</code>, <code className="font-mono">group-title</code>, and exports general & category-split playlists.
                    </p>
                  </div>
                </div>

                <textarea
                  rows={6}
                  value={m3uInput}
                  onChange={(e) => setM3uInput(e.target.value)}
                  className="w-full p-3 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Duplicate Detection Rule:
                    </label>
                    <select
                      value={dupRule}
                      onChange={(e) => setDupRule(e.target.value as typeof dupRule)}
                      className="px-3 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="stream_url" className="bg-slate-900 text-white">By Stream URL</option>
                      <option value="name" className="bg-slate-900 text-white">By Channel Name</option>
                      <option value="tvg_id" className="bg-slate-900 text-white">By TVG-ID</option>
                      <option value="url_and_name" className="bg-slate-900 text-white">By URL + Name</option>
                    </select>
                    <button
                      onClick={() => handleApplyDuplicateRule(false)}
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Detect Duplicates ({state.summary.duplicates} found)
                    </button>
                    <button
                      onClick={() => handleApplyDuplicateRule(true)}
                      className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      Prune Duplicates
                    </button>
                  </div>

                  <button
                    disabled={m3uBusy}
                    onClick={handleParseM3u}
                    className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
                  >
                    {m3uBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Parse & Import M3U Playlist
                  </button>
                </div>
              </div>

              {/* Multi-Format & Category Playlist Exports */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold">
                    Playlist & Category Split Exports
                  </h3>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeDupsOnExport}
                      onChange={(e) => setExcludeDupsOnExport(e.target.checked)}
                    />
                    <span>Exclude duplicate channels on export</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                  {[
                    'channels.m3u',
                    'channels.json',
                    'channels.csv',
                    'bangla.m3u',
                    'hindi.m3u',
                    'english.m3u',
                    'sports.m3u',
                    'news.m3u',
                  ].map((file) => (
                    <a
                      key={file}
                      href={`/api/export/${file}?excludeDuplicates=${excludeDupsOnExport}`}
                      download={file}
                      className="p-2.5 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-md flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <span className="truncate">{file}</span>
                      <Download className="w-3.5 h-3.5 shrink-0 ml-1" />
                    </a>
                  ))}
                </div>

                {/* Normalized Channel JSON Record Preview */}
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-1.5">
                    Normalized Channel Record Schema Preview
                  </div>
                  <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800">
                    {JSON.stringify(
                      state.channels[0]
                        ? {
                            name: state.channels[0].name,
                            category: state.channels[0].category,
                            logo: state.channels[0].logo,
                            stream_url: state.channels[0].stream_url,
                            type: state.channels[0].type,
                            resolution: state.channels[0].resolution,
                            status: state.channels[0].status,
                          }
                        : {},
                      null,
                      2
                    )}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: STREAM VALIDATOR */}
          {activeTab === 'validator' && (
            <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Authorized Stream Validator</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Performs HTTP status checks, Content-Type verification, M3U8 syntax validation, segment availability checks, latency measurement, and resolution/codec detection. Never circumvents <code className="font-mono">UNAUTHORIZED</code> responses.
                  </p>
                </div>
                <button
                  disabled={validatingBusy}
                  onClick={handleBulkValidate}
                  className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  {validatingBusy ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  Validate All Authorized Streams ({state.channels.length})
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3">Channel Name</th>
                      <th className="py-2.5 px-3">Validation Status</th>
                      <th className="py-2.5 px-3">Format</th>
                      <th className="py-2.5 px-3">Resolution · Codec</th>
                      <th className="py-2.5 px-3 text-right">Latency</th>
                      <th className="py-2.5 px-3">DRM / Access Policy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                    {state.channels.map((ch) => (
                      <tr key={ch.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-sans font-medium">{ch.name}</td>
                        <td className="py-2.5 px-3 font-semibold">
                          <span
                            className={
                              ch.validation_status === 'ONLINE'
                                ? 'text-emerald-500'
                                : ch.validation_status === 'UNAUTHORIZED'
                                ? 'text-amber-500'
                                : 'text-red-500'
                            }
                          >
                            {ch.validation_status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">{ch.type}</td>
                        <td className="py-2.5 px-3">
                          {ch.resolution} {ch.codec ? `· ${ch.codec}` : ''}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {ch.latency_ms > 0 ? `${ch.latency_ms} ms` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {ch.validation_status === 'UNAUTHORIZED'
                            ? 'HTTP 401/403 Respected (No Bypass)'
                            : ch.drm_protected
                            ? 'Protected Stream'
                            : 'Verified Public/Authorized'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: DATABASE & API MIGRATION */}
          {activeTab === 'database' && (
            <DatabaseAndApiView state={state} onRefresh={fetchState} notify={notify} />
          )}

          {/* TAB 8: MEDIA BACKUP & REPORTS */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">Authorized Media Backup Engine</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Archives authorized M3U8, TS, MP4, JSON, XML, logos, and metadata. Distinguishes between <code className="font-mono">Playlist backup</code> and <code className="font-mono">Segment recording</code> for live HLS without bypassing DRM.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Backup Archive Label
                    </label>
                    <input
                      type="text"
                      value={backupName}
                      onChange={(e) => setBackupName(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Backup Mode
                    </label>
                    <select
                      value={backupMode}
                      onChange={(e) => setBackupMode(e.target.value as typeof backupMode)}
                      className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="Metadata Only" className="bg-slate-900 text-white">Metadata Only</option>
                      <option value="Media Archive" className="bg-slate-900 text-white">Media Archive</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Live HLS Capture Strategy
                    </label>
                    <select
                      value={hlsCaptureType}
                      onChange={(e) => setHlsCaptureType(e.target.value as typeof hlsCaptureType)}
                      className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    >
                      <option value="Playlist backup" className="bg-slate-900 text-white">
                        Playlist backup (.m3u8 manifests only)
                      </option>
                      <option value="Segment recording" className="bg-slate-900 text-white">
                        Segment recording (Bounded .ts segment descriptors)
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                    Included Media Resource Types
                  </label>
                  <div className="flex flex-wrap gap-3 text-xs font-mono">
                    {['M3U8', 'TS', 'MP4', 'JSON', 'XML', 'logos', 'metadata'].map((t) => {
                      const checked = backupTypes.includes(t);
                      return (
                        <label
                          key={t}
                          className="flex items-center gap-2 px-3 py-1.5 border border-slate-300 dark:border-slate-700 rounded-md cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) setBackupTypes([...backupTypes, t]);
                              else setBackupTypes(backupTypes.filter((x) => x !== t));
                            }}
                          />
                          {t}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    disabled={backupBusy}
                    onClick={handleRunMediaBackup}
                    className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
                  >
                    {backupBusy ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <HardDrive className="w-4 h-4" />
                    )}
                    Create Authorized Media Backup
                  </button>
                </div>
              </div>

              {/* Reports Suite (Section 11) */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <h3 className="text-base font-semibold">Generated Reports & Artifacts</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800">
                    {JSON.stringify(
                      {
                        total_channels: state.summary.total_channels,
                        online: state.summary.online,
                        offline: state.summary.offline,
                        timeout: state.summary.timeout,
                        invalid: state.summary.invalid,
                        duplicates: state.summary.duplicates,
                      },
                      null,
                      2
                    )}
                  </pre>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 content-start">
                    {[
                      'scan-report.json',
                      'scan-report.csv',
                      'migration-report.json',
                      'failed-streams.csv',
                      'channels.m3u',
                      'channels.json',
                    ].map((rep) => (
                      <a
                        key={rep}
                        href={`/api/export/${rep}`}
                        download={rep}
                        className="p-3 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded-md flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <span>{rep}</span>
                        <Download className="w-4 h-4" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: SECURITY & AUDIT LOGS */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <h2 className="text-lg font-semibold">
                  SSRF Protection, URL Allowlist & Rate Limit Governance
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Server-side URL fetching blocks loopback (<code className="font-mono">127.0.0.0/8</code>), RFC1918 private networks (<code className="font-mono">10.0.0.0/8</code>, <code className="font-mono">172.16.0.0/12</code>, <code className="font-mono">192.168.0.0/16</code>), and cloud metadata (<code className="font-mono">169.254.169.254</code>) unless explicitly enabled by the administrator.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 p-3.5 border border-slate-200 dark:border-slate-800 rounded-md text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowPrivateNets}
                      onChange={(e) => setAllowPrivateNets(e.target.checked)}
                    />
                    <span>
                      Allow Private / Internal LAN Addresses (Administrator Override)
                    </span>
                  </label>

                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Optional URL Domain Allowlist (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={allowlistInput}
                      onChange={(e) => setAllowlistInput(e.target.value)}
                      placeholder="mux.dev, apple.com, akamaihd.net"
                      className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveSecuritySettings}
                    className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md"
                  >
                    Save Security Policy
                  </button>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
                <h3 className="text-base font-semibold">
                  Immutable Operations Audit Log (logs/audit.log)
                </h3>
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Operation</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Target</th>
                        <th className="py-2.5 px-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                      {state.audit_logs.map((entry) => (
                        <tr key={entry.id}>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-500">
                            {new Date(entry.timestamp).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-semibold">{entry.operation}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={
                                entry.status === 'SUCCESS'
                                  ? 'text-emerald-500'
                                  : entry.status === 'BLOCKED'
                                  ? 'text-red-500'
                                  : 'text-amber-500'
                              }
                            >
                              {entry.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 max-w-xs truncate">{entry.target}</td>
                          <td className="py-2.5 px-3 font-sans text-slate-600 dark:text-slate-400">
                            {entry.details}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 10: CLI & AUTOMATED TESTS & DOCS */}
          {activeTab === 'cli' && (
            <CliAndDocsView onRefresh={fetchState} notify={notify} />
          )}
        </main>
      </div>
    </div>
  );
}

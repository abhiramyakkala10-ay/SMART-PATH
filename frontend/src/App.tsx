import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import Lenis from 'lenis';
import {
  ArrowDown,
  ArrowUpRight,
  ArrowRightLeft,
  Compass,
  LocateFixed,
  MapPinned,
  Navigation,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';

type LocationDetails = {
  lat: number;
  lon: number;
  label: string;
  display_name?: string;
};

type RouteResult = {
  id: string;
  name: string;
  rank?: number;
  color?: string;
  distance_meters: number;
  duration_minutes: number;
  coordinates: [number, number][];
  description: string;
};

type AlgorithmStep = {
  node_id: string;
  distance_m: number;
  visited_count: number;
};

type SearchResult = {
  name: string;
  display_name: string;
  lat: number;
  lon: number;
};

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const DEFAULT_SOURCE: LocationDetails = { lat: 17.3616, lon: 78.4747, label: 'Charminar, Hyderabad, India' };
const DEFAULT_DESTINATION: LocationDetails = { lat: 17.4435, lon: 78.3772, label: 'HITEC City, Hyderabad, India' };
const ROUTE_COLORS = ['#C9A24A', '#E4C675', '#A8843B', '#F0DDA8', '#8F6A2B'];

function createMarkerIcon(label: string, color: string) {
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="display:flex;align-items:center;justify-content:center; width: 28px; height: 28px; border-radius: 9999px; background:${color}; color:white; font-weight:700; font-size:12px; border:3px solid rgba(255,255,255,0.9); box-shadow:0 10px 20px rgba(15,23,42,0.2);">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function MapBoundsController({ positions }: { positions: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (!positions.length) {
      map.setView([20.5937, 78.9629], 5);
      return;
    }

    const bounds = L.latLngBounds(positions);
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 12 });
  }, [positions, map]);

  return null;
}

function RouteBackdrop({ className, idPrefix }: { className: string; idPrefix: string }) {
  const roadGradient = `${idPrefix}-road`;
  const fineRoadGradient = `${idPrefix}-fine-road`;

  return (
    <svg className={className} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={roadGradient} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#c9a24a" stopOpacity=".05" />
          <stop offset="50%" stopColor="#e9c66e" stopOpacity=".75" />
          <stop offset="100%" stopColor="#c9a24a" stopOpacity=".08" />
        </linearGradient>
        <linearGradient id={fineRoadGradient} x1="0" x2="1">
          <stop stopColor="#e7d9b3" stopOpacity="0" />
          <stop offset=".5" stopColor="#e7d9b3" stopOpacity=".22" />
          <stop offset="1" stopColor="#e7d9b3" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="map-grid" fill="none" stroke={`url(#${fineRoadGradient})`} strokeWidth="1">
        <path d="M-50 180 400 120 820 210 1190 120 1660 210" />
        <path d="M-80 310 330 260 780 360 1180 265 1650 350" />
        <path d="M-80 470 350 420 780 520 1170 420 1660 520" />
        <path d="M-70 650 380 590 800 700 1210 600 1660 690" />
        <path d="M-40 830 390 770 820 880 1220 780 1640 880" />
        <path d="M180 -40 230 220 170 480 260 760 220 1040" />
        <path d="M480 -40 540 230 470 490 570 770 520 1040" />
        <path d="M790 -40 850 220 790 510 890 780 830 1040" />
        <path d="M1100 -40 1160 240 1090 520 1190 790 1140 1040" />
        <path d="M1410 -40 1460 220 1390 500 1490 780 1450 1040" />
      </g>
      <g fill="none" stroke={`url(#${roadGradient})`} strokeLinecap="round">
        <path className="hero-route-back" strokeWidth="18" d="M190 830 C330 760 315 625 510 585 S720 640 860 490 1035 410 1080 300 1280 220 1430 130" />
        <path className="hero-route-front" strokeWidth="2" d="M190 830 C330 760 315 625 510 585 S720 640 860 490 1035 410 1080 300 1280 220 1430 130" />
        <path stroke={`url(#${fineRoadGradient})`} strokeWidth="2" d="M-20 720 C180 670 220 530 370 510 S650 400 750 280 1010 270 1190 160 1450 100 1640 60" />
        <path stroke={`url(#${fineRoadGradient})`} strokeWidth="2" d="M-30 260 C180 330 280 370 450 310 S740 180 890 260 1110 550 1290 510 1480 360 1650 420" />
      </g>
      <g className="hero-map-pins">
        <circle cx="190" cy="830" r="8" />
        <circle cx="1430" cy="130" r="8" />
      </g>
    </svg>
  );
}

function App() {
  const heroRef = useRef<HTMLElement>(null);
  const [source, setSource] = useState<LocationDetails>(DEFAULT_SOURCE);
  const [destination, setDestination] = useState<LocationDetails>(DEFAULT_DESTINATION);
  const [sourceQuery, setSourceQuery] = useState('Charminar, Hyderabad');
  const [destinationQuery, setDestinationQuery] = useState('HITEC City, Hyderabad');
  const [sourceSuggestions, setSourceSuggestions] = useState<SearchResult[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<SearchResult[]>([]);
  const [activeSearch, setActiveSearch] = useState<'source' | 'destination' | null>(null);
  const [mode, setMode] = useState('drive');
  const [alternatives, setAlternatives] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<'source' | 'destination'>('source');
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [algorithmSteps, setAlgorithmSteps] = useState<AlgorithmStep[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMapFullscreen, setMapFullscreen] = useState(false);
  const [heroInteractive, setHeroInteractive] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReduceMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }

    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.1,
    });
    let frameId = 0;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let isSettling = false;
    let settleId = 0;

    const unsubscribe = lenis.on('scroll', ({ scroll }) => {
      if (isSettling) {
        return;
      }

      if (settleTimer) {
        clearTimeout(settleTimer);
      }

      settleTimer = setTimeout(() => {
        const heroHeight = heroRef.current?.offsetHeight ?? window.innerHeight * 2;
        const transitionEnd = heroHeight - window.innerHeight;
        if (scroll < transitionEnd * 0.06 || scroll > transitionEnd * 0.94) {
          return;
        }

        const progress = scroll / transitionEnd;
        const destination = progress >= 0.5 ? transitionEnd : 0;
        isSettling = true;
        lenis.scrollTo(destination, {
          duration: 1.35,
          easing: (value) => 1 - Math.pow(1 - value, 4),
          onComplete: () => {
            window.clearTimeout(settleId);
            settleId = window.setTimeout(() => {
              isSettling = false;
            }, 120);
          },
        });
      }, 220);
    });

    const tick = (time: number) => {
      lenis.raf(time);
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
      unsubscribe();
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      window.clearTimeout(settleId);
      lenis.destroy();
    };
  }, [reduceMotion]);

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end end'],
  });
  const easedProgress = useSpring(scrollYProgress, {
    stiffness: 72,
    damping: 24,
    mass: 0.35,
  });
  const heroScale = useTransform(easedProgress, [0, 1], [1, 1.2]);
  const heroOpacity = useTransform(easedProgress, [0, 0.5, 1], [1, 0.58, 0]);
  const heroBlur = useTransform(easedProgress, [0, 1], ['blur(0px)', 'blur(1px)']);
  const mapOpacity = useTransform(easedProgress, [0, 0.38, 0.9, 1], [0.12, 0.66, 1, 1]);
  const mapBlur = useTransform(easedProgress, [0, 0.38, 0.78, 1], ['blur(15px)', 'blur(7px)', 'blur(0px)', 'blur(0px)']);
  const mapScale = useTransform(easedProgress, [0, 1], [1.025, 1]);

  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    setHeroInteractive(progress < 0.58);
  });

  const routePolylines = useMemo(
    () =>
      routes.map((route) => ({
        id: route.id,
        color: ROUTE_COLORS[((route.rank || 1) - 1) % ROUTE_COLORS.length],
        coords: route.coordinates,
      })),
    [routes],
  );

  useEffect(() => {
    if (activeSearch !== 'source') {
      return;
    }

    const handler = setTimeout(() => {
      if (sourceQuery.trim()) {
        void fetchResults(sourceQuery, 'source');
      } else {
        setSourceSuggestions([]);
      }
    }, 450);

    return () => clearTimeout(handler);
  }, [sourceQuery, activeSearch]);

  useEffect(() => {
    if (activeSearch !== 'destination') {
      return;
    }

    const handler = setTimeout(() => {
      if (destinationQuery.trim()) {
        void fetchResults(destinationQuery, 'destination');
      } else {
        setDestinationSuggestions([]);
      }
    }, 450);

    return () => clearTimeout(handler);
  }, [destinationQuery, activeSearch]);

  useEffect(() => {
    if (!routes.length) {
      setSelectedRouteId(null);
      return;
    }
    setSelectedRouteId((previous) => previous || routes[0].id);
  }, [routes]);

  async function fetchResults(query: string, target: 'source' | 'destination') {
    try {
      const response = await fetch(`${API_BASE_URL}/api/search?query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error('Unable to fetch search results');
      }

      const data = (await response.json()) as { results?: SearchResult[] };
      const items = data.results || [];
      if (target === 'source') {
        setSourceSuggestions(items);
      } else {
        setDestinationSuggestions(items);
      }
    } catch {
      if (target === 'source') {
        setSourceSuggestions([]);
      } else {
        setDestinationSuggestions([]);
      }
    }
  }

  async function findRoutes() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { lat: source.lat, lon: source.lon },
          destination: { lat: destination.lat, lon: destination.lon },
          mode,
          alternatives,
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { detail?: string };
        throw new Error(data.detail || 'Unable to find routes');
      }

      const result = (await response.json()) as {
        routes?: RouteResult[];
        shortest_route?: RouteResult;
        dijkstra_steps?: AlgorithmStep[];
      };

      const nextRoutes = result.routes || [];
      setRoutes(nextRoutes);
      setSelectedRouteId(nextRoutes[0]?.id || null);
      setAlgorithmSteps(result.dijkstra_steps || []);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? `Cannot reach the route service at ${API_BASE_URL}. Check that the backend is running and accessible.`
          : err instanceof Error
            ? err.message
            : 'Something went wrong while finding routes.',
      );
      setRoutes([]);
    } finally {
      setIsLoading(false);
    }
  }

  function applySuggestion(suggestion: SearchResult, target: 'source' | 'destination') {
    const nextLocation = {
      lat: suggestion.lat,
      lon: suggestion.lon,
      label: suggestion.name,
      display_name: suggestion.display_name,
    };

    if (target === 'source') {
      setSource(nextLocation);
      setSourceQuery(suggestion.name);
      setSourceSuggestions([]);
      setActiveSearch(null);
    } else {
      setDestination(nextLocation);
      setDestinationQuery(suggestion.name);
      setDestinationSuggestions([]);
      setActiveSearch(null);
    }
  }

  function clearRoute() {
    setRoutes([]);
    setSelectedRouteId(null);
    setAlgorithmSteps([]);
    setError(null);
  }

  function swapLocations() {
    setSource(destination);
    setDestination(source);
    setSourceQuery(destination.label);
    setDestinationQuery(source.label);
  }

  const selectedRoute = routes.find((route) => route.id === selectedRouteId) || routes[0];

  const analyticsData = useMemo(
    () =>
      routes.map((route, index) => ({
        name: `R${index + 1}`,
        distance: Number((route.distance_meters / 1000).toFixed(1)),
        duration: Number(route.duration_minutes.toFixed(1)),
      })),
    [routes],
  );

  const mapCoordinates = selectedRoute?.coordinates || [
    [source.lat, source.lon],
    [destination.lat, destination.lon],
  ];

  const handleMapClick = (lat: number, lon: number) => {
    const nextLocation = { lat, lon, label: `Selected point (${lat.toFixed(4)}, ${lon.toFixed(4)})` };
    if (selectedTarget === 'source') {
      setSource(nextLocation);
      setSourceQuery(nextLocation.label);
    } else {
      setDestination(nextLocation);
      setDestinationQuery(nextLocation.label);
    }
  };

  const handleFullscreen = async () => {
    const target = document.getElementById('map-panel');
    if (!target) {
      return;
    }

    if (!document.fullscreenElement) {
      await target.requestFullscreen();
      setMapFullscreen(true);
    } else {
      await document.exitFullscreen();
      setMapFullscreen(false);
    }
  };

  const scrollToMap = () => {
    const heroHeight = heroRef.current?.offsetHeight ?? window.innerHeight;
    window.scrollTo({ top: heroHeight - window.innerHeight, behavior: 'smooth' });
  };

  return (
    <div className="site-scroll">
      <section ref={heroRef} className="hero-scroll-section">
        <div className="hero-sticky">
          <motion.div
            className="hero-foreground"
            style={{
              scale: heroScale,
              opacity: heroOpacity,
              filter: heroBlur,
              pointerEvents: heroInteractive ? 'auto' : 'none',
            }}
          >
          <div className="hero-landscape" aria-hidden="true">
            <div className="hero-glow hero-glow-one" />
            <div className="hero-glow hero-glow-two" />
            <RouteBackdrop className="hero-map-lines" idPrefix="hero" />
          </div>

          <motion.header
            className="hero-nav"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15 }}
          >
            <a className="hero-wordmark" href="#top" aria-label="SmartPath home">SMARTPATH<span>®</span></a>
            <div className="hero-nav-right">
              <span>INTELLIGENT ROUTE PLANNING</span>
              <button type="button" onClick={scrollToMap}>
                OPEN THE MAP <ArrowUpRight size={15} />
              </button>
            </div>
          </motion.header>

          <motion.div
            id="top"
            className="hero-content"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.12, delayChildren: 0.22 } },
            }}
          >
            <motion.p
              className="hero-kicker"
              variants={{ hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0 } }}
            >
              A CLEARER WAY THROUGH THE CITY
            </motion.p>
            <motion.h1 variants={{ hidden: { opacity: 0, y: 26 }, visible: { opacity: 1, y: 0 } }}>
              Smart<span>Path</span>
            </motion.h1>
            <motion.p
              className="hero-description"
              variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0 } }}
            >
              Find your way, not just a way.
              <span> Compare real road routes across Hyderabad and beyond.</span>
            </motion.p>
            <motion.button
              type="button"
              className="hero-cta"
              onClick={scrollToMap}
              variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}
              whileHover={{ y: -3, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              EXPLORE YOUR ROUTE <ArrowUpRight size={16} />
            </motion.button>
          </motion.div>

          <div className="hero-footer">
            <span>BUILT AROUND THE ROADS YOU ACTUALLY TAKE</span>
            <button type="button" onClick={scrollToMap}>
              SCROLL TO NAVIGATE <ArrowDown size={14} />
            </button>
            <span>17° 23' N&nbsp;&nbsp; 78° 29' E</span>
          </div>
          </motion.div>
        </div>
      </section>

      <section id="planner" className="planner-section">
      <div className="planner-backdrop" aria-hidden="true">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <RouteBackdrop className="planner-map-lines" idPrefix="planner" />
      </div>
      <motion.div
      className="planner-underlay"
      style={{ opacity: mapOpacity, filter: mapBlur, scale: mapScale }}
      >
      <motion.div
      className="app-shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.65, ease: 'easeOut' }}
    >
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Navigation size={19} /></div>
          <div>
            <p className="eyebrow">SMARTPATH <span>/</span> ROUTE INTELLIGENCE</p>
            <h1>Move with a better sense of direction.</h1>
          </div>
        </div>
        <div className="header-meta">
          <span className="live-indicator"><i /> ROUTE ENGINE ONLINE</span>
          <span className="location-chip"><MapPinned size={14} /> HYDERABAD, IN</span>
        </div>
      </header>

      <div className="app-layout">
      <motion.aside
        className="sidebar glass-panel"
        initial={{ opacity: 0, x: -18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center justify-between gap-4 border-b border-slate-700/80 pb-4">
          <div className="flex items-center gap-4">
            <div className="planner-brand-mark flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg">
              <Navigation className="h-6 w-6 text-slate-950" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-amber-300">Plan a journey</p>
              <h2 className="mt-1 text-xl font-bold text-white">Where to next?</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={clearRoute}
            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
          >
            Clear route
          </button>
        </div>

        <div className="sidebar-content mt-5 space-y-4">
          <div className="location-card rounded-2xl border border-slate-700 bg-slate-800/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <MapPinned className="h-4 w-4 text-emerald-400" />
                Source
              </div>
              <button type="button" onClick={() => { setSelectedTarget('source'); setActiveSearch(null); }} className={`map-select ${selectedTarget === 'source' ? 'is-active' : ''}`}>
                Select on map
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                value={sourceQuery}
                onFocus={() => setActiveSearch('source')}
                onBlur={() => setTimeout(() => setActiveSearch(null), 120)}
                onChange={(event) => setSourceQuery(event.target.value)}
                placeholder="Search source city or landmark"
                className="location-input w-full rounded-xl border border-slate-600 bg-slate-900/80 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-amber-400"
              />
            </div>
            {activeSearch === 'source' && sourceSuggestions.length > 0 && (
              <div className="suggestion-list mt-2 max-h-52 overflow-auto rounded-xl border border-slate-700 bg-slate-950/60 p-2">
                {sourceSuggestions.map((item) => (
                  <motion.button
                    key={`${item.lat}-${item.lon}`}
                    type="button"
                    onClick={() => applySuggestion(item, 'source')}
                    onMouseDown={(event) => event.preventDefault()}
                    className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-800"
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.display_name}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-400">S</span>
                  </motion.button>
                ))}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-400">{source.label} • {source.lat.toFixed(4)}, {source.lon.toFixed(4)}</div>
          </div>

          <div className="flex items-center justify-center">
            <motion.button
              type="button"
              onClick={swapLocations}
              className="inline-flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800 p-2.5 text-slate-200 transition hover:border-amber-400 hover:text-amber-200"
              aria-label="Swap locations"
              whileHover={{ rotate: 180, scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 280, damping: 17 }}
            >
              <ArrowRightLeft className="h-5 w-5" />
            </motion.button>
          </div>

          <div className="location-card rounded-2xl border border-slate-700 bg-slate-800/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <MapPinned className="h-4 w-4 text-rose-400" />
                Destination
              </div>
              <button type="button" onClick={() => { setSelectedTarget('destination'); setActiveSearch(null); }} className={`map-select ${selectedTarget === 'destination' ? 'is-active' : ''}`}>
                Select on map
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input
                value={destinationQuery}
                onFocus={() => setActiveSearch('destination')}
                onBlur={() => setTimeout(() => setActiveSearch(null), 120)}
                onChange={(event) => setDestinationQuery(event.target.value)}
                placeholder="Search destination city or landmark"
                className="location-input w-full rounded-xl border border-slate-600 bg-slate-900/80 py-2.5 pl-9 pr-3 text-sm text-white outline-none ring-0 placeholder:text-slate-500 focus:border-amber-400"
              />
            </div>
            {activeSearch === 'destination' && destinationSuggestions.length > 0 && (
              <div className="suggestion-list mt-2 max-h-52 overflow-auto rounded-xl border border-slate-700 bg-slate-950/60 p-2">
                {destinationSuggestions.map((item) => (
                  <motion.button
                    key={`${item.lat}-${item.lon}`}
                    type="button"
                    onClick={() => applySuggestion(item, 'destination')}
                    onMouseDown={(event) => event.preventDefault()}
                    className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-slate-800"
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-100">{item.name}</div>
                      <div className="mt-1 text-xs text-slate-400">{item.display_name}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-rose-400">D</span>
                  </motion.button>
                ))}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-400">{destination.label} • {destination.lat.toFixed(4)}, {destination.lon.toFixed(4)}</div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-3">
              <label className="mb-2 block flex items-center gap-2 text-sm font-medium text-slate-200">
                <Compass className="h-4 w-4 text-amber-300" />
                Travel mode
              </label>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="w-full rounded-xl border border-slate-600 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400"
              >
                <option value="drive">Drive</option>
                <option value="bike">Bike</option>
                <option value="walk">Walk</option>
              </select>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-3">
              <label className="mb-2 block flex items-center gap-2 text-sm font-medium text-slate-200">
                <SlidersHorizontal className="h-4 w-4 text-amber-300" />
                Alternatives
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={alternatives}
                onChange={(event) => setAlternatives(Number(event.target.value))}
                className="w-full accent-amber-400"
              />
              <div className="mt-2 text-sm text-slate-300">{alternatives} routes</div>
            </div>
          </div>

          <div className="flex gap-3">
            <motion.button
              type="button"
              onClick={findRoutes}
              disabled={isLoading}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-300 to-amber-600 px-4 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-amber-600/30 transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60"
              whileHover={!isLoading ? { y: -2, scale: 1.01 } : undefined}
              whileTap={!isLoading ? { scale: 0.98 } : undefined}
              transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            >
              <Route className="h-4 w-4" />
              {isLoading ? 'Calculating...' : 'Find Routes'}
            </motion.button>
            <button
              type="button"
              onClick={() => {
                setSource(DEFAULT_SOURCE);
                setDestination(DEFAULT_DESTINATION);
              }}
              className="flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-medium text-slate-100 hover:border-slate-500"
            >
              <LocateFixed className="h-4 w-4" />
              Reset
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -6, height: 0 }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {routes.length > 0 && (
          <div className="section-card rounded-2xl border border-slate-700 bg-slate-800/60 p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
              <Sparkles className="h-4 w-4 text-amber-300" />
              Route options
            </div>
            <div className="space-y-3">
                {routes.map((route) => (
                  <motion.button
                    key={route.id}
                    type="button"
                    onClick={() => setSelectedRouteId(route.id)}
                    className={`route-card w-full rounded-2xl border p-3 text-left transition ${selectedRoute?.id === route.id ? 'is-selected border-amber-400 bg-amber-500/10' : 'border-slate-700 bg-slate-900/40 hover:border-slate-500'}`}
                    layout
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.99 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: ROUTE_COLORS[((route.rank || 1) - 1) % ROUTE_COLORS.length] }} />
                        <span className="text-sm font-semibold text-slate-100">{route.name}</span>
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.25em] text-slate-400">#{route.rank || 1}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                      <span>{(route.distance_meters / 1000).toFixed(1)} km</span>
                      <span>{route.duration_minutes.toFixed(1)} min</span>
                    </div>
                  </motion.button>
                ))}
            </div>
          </div>
          )}

          {algorithmSteps.length > 0 && (
            <motion.div
              className="section-card rounded-2xl border border-slate-700 bg-slate-800/60 p-3"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
                <Compass className="h-4 w-4 text-amber-300" />
                Dijkstra exploration
              </div>
              <div className="max-h-36 overflow-auto pr-1 text-sm text-slate-300">
                {algorithmSteps.slice(0, 8).map((step, index) => (
                  <div key={`${step.node_id}-${index}`} className="mb-2 rounded-xl border border-slate-700 bg-slate-900/60 px-2 py-2">
                    <span className="text-amber-300">Step {index + 1}</span> • Node {step.node_id} • {step.distance_m.toFixed(0)} m
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </motion.aside>

      <motion.main
        className="map-workspace glass-panel ml-4 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900/70 shadow-soft backdrop-blur"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="map-topbar flex items-center justify-between border-b border-slate-700/80 px-4 py-3 md:px-5">
          <div>
            <p className="eyebrow text-xs uppercase tracking-[0.28em] text-amber-300">YOUR JOURNEY</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Explore the route</h2>
          </div>
          <div className="flex items-center gap-2">
            <motion.button
              type="button"
              onClick={handleFullscreen}
              className="rounded-xl border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 transition hover:border-amber-400 hover:text-amber-200"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              {isMapFullscreen ? 'Exit full' : 'Full map'}
            </motion.button>
          </div>
        </div>

        <div id="map-panel" className="map-panel relative flex-1 overflow-hidden">
          <MapContainer center={[17.40, 78.43]} zoom={11} scrollWheelZoom className="h-full w-full">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapBoundsController positions={mapCoordinates} />

            <Marker position={[source.lat, source.lon]} icon={createMarkerIcon('S', '#22C55E')}>
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                Source: {source.label}
              </Tooltip>
            </Marker>

            <Marker position={[destination.lat, destination.lon]} icon={createMarkerIcon('D', '#EF4444')}>
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                Destination: {destination.label}
              </Tooltip>
            </Marker>

            {routePolylines.map((route) => (
              <Polyline
                key={route.id}
                positions={route.coords}
                pathOptions={{
                  color: route.color,
                  weight: selectedRoute?.id === route.id ? 7 : 5,
                  opacity: selectedRoute?.id === route.id ? 1 : 0.8,
                  dashArray: selectedRoute?.id === route.id ? undefined : '9 7',
                  className: selectedRoute?.id === route.id ? 'selected-route-line' : 'alternative-route-line',
                }}
              />
            ))}

            <MapClickHandler onSelect={handleMapClick} />
          </MapContainer>

          <div className="map-legend absolute bottom-4 left-4 z-[500] rounded-2xl border border-slate-700 bg-slate-900/85 p-3 shadow-lg">
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300">
              <X className="h-3.5 w-3.5 text-slate-400" />
              Map legend
            </div>
            <div className="space-y-2 text-xs text-slate-200">
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Source</div>
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Destination</div>
              <div className="flex items-center gap-2"><span className="shortest-route-swatch h-2.5 w-2.5 rounded-full" /> Shortest route</div>
            </div>
          </div>
        </div>

        <div className="route-insights border-t border-slate-700/80 bg-slate-900/70 px-4 py-4 md:px-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">Selected route</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{selectedRoute ? selectedRoute.name : 'No route selected'}</h3>
            </div>
            {selectedRoute && (
              <div className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-right text-sm text-slate-200">
                <div>{(selectedRoute.distance_meters / 1000).toFixed(1)} km</div>
                <div className="text-slate-400">{selectedRoute.duration_minutes.toFixed(1)} min</div>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
          {selectedRoute && (
            <motion.div
              key={selectedRoute.id}
              className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.24 }}
            >
              <div className="insight-card rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-3 text-sm font-medium text-slate-200">Distance breakdown</div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analyticsData}>
                      <defs>
                        <linearGradient id="distanceFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#E4C675" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#C9A24A" stopOpacity={0.15} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <YAxis stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <ChartTooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 12 }}
                        labelStyle={{ color: '#e2e8f0' }}
                      />
                      <Area type="monotone" dataKey="distance" stroke="#C9A24A" fill="url(#distanceFill)" strokeWidth={2.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="insight-card rounded-2xl border border-slate-700 bg-slate-800/70 p-4">
                <div className="mb-3 text-sm font-medium text-slate-200">Current route summary</div>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between"><span>Distance</span><strong className="text-white">{(selectedRoute.distance_meters / 1000).toFixed(1)} km</strong></div>
                  <div className="flex items-center justify-between"><span>Duration</span><strong className="text-white">{selectedRoute.duration_minutes.toFixed(1)} min</strong></div>
                  <div className="flex items-center justify-between"><span>Mode</span><strong className="text-white">{mode}</strong></div>
                  <div className="flex items-center justify-between"><span>Points</span><strong className="text-white">{selectedRoute.coordinates.length}</strong></div>
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>
      </motion.main>
      </div>
      </motion.div>
      </motion.div>
      </section>
    </div>
  );
}

function MapClickHandler({ onSelect }: { onSelect: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event: L.LeafletMouseEvent) {
      onSelect(event.latlng.lat, event.latlng.lng);
    },
  });

  return null;
}

export default App;

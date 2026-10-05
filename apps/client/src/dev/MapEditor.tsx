import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  cloneGrid,
  createGrid,
  DEFAULT_RULES,
  generateMaze,
  isBorderEdge,
  layoutWalls,
  listMapSources,
  MAX_SPAWNS,
  parseLayout,
  resizeGrid,
  tileCenter,
  validateMapSource,
  type LayoutGrid,
  type MapSource,
} from "@tank-arena/shared";
import { SLOT_COLORS } from "../game/GameRenderer.ts";
import {
  cellAt,
  cornerSpawns,
  edgeAt,
  edgeRect,
  edgeValue,
  EMPTY_MAP,
  sameEdge,
  setEdge,
  slugify,
  toggleSpawn,
  withGrid,
  type Edge,
  type Point,
} from "./editorModel.ts";

const DRAFT_KEY = "tank-arena.editor.draft";
const TANK_RADIUS = DEFAULT_RULES.tank.radius;
const MIN_TILES = 2;
const MAX_TILES = 40;

type Tool = "wall" | "spawn";
type Hover = { kind: "edge"; edge: Edge } | { kind: "cell"; col: number; row: number } | null;

interface Status {
  kind: "ok" | "error";
  text: string;
}

function copySource(source: MapSource): MapSource {
  return { ...source, layout: [...source.layout] };
}

function loadInitial(): MapSource {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw) as Partial<MapSource>;
      if (Array.isArray(draft.layout) && typeof draft.tileSize === "number" && typeof draft.wallThickness === "number") {
        parseLayout(draft.layout);
        return draft as MapSource;
      }
    }
  } catch {
    /* ignore corrupt or outdated drafts */
  }
  const first = listMapSources()[0];
  return copySource(first ?? EMPTY_MAP);
}

/**
 * Dev-only visual map editor (`/?editor`). Maps are a grid of tiles; click a
 * tile border to toggle a wall on it (drag to paint several), click a tile with
 * the Spawn tool to place numbered spawn points, or generate a random maze.
 * Save: the Vite dev server writes the map as a TypeScript module under
 * packages/shared/src/maps/data so it ships in source.
 */
export function MapEditor() {
  const [map, setMap] = useState<MapSource>(loadInitial);
  const [past, setPast] = useState<MapSource[]>([]);
  const [future, setFuture] = useState<MapSource[]>([]);
  const [tool, setTool] = useState<Tool>("wall");
  const [hover, setHover] = useState<Hover>(null);
  const [paint, setPaint] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [loops, setLoops] = useState(12);
  const [layoutDraft, setLayoutDraft] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const grid = useMemo(() => parseLayout(map.layout), [map.layout]);
  const ts = map.tileSize;
  const t = map.wallThickness;
  const width = grid.cols * ts + t;
  const height = grid.rows * ts + t;
  const walls = useMemo(() => layoutWalls(grid, ts, t), [grid, ts, t]);
  const sources = listMapSources();
  const errors = useMemo(() => validateMapSource(map, TANK_RADIUS), [map]);
  const existsInSource = sources.some((s) => s.id === map.id);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  }, [map]);

  const layoutText = layoutDraft ?? map.layout.join("\n");

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => setScale(width / Math.max(1, svg.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [width, height]);

  /** Records an undo step and applies a change. */
  function commit(next: MapSource | ((m: MapSource) => MapSource)) {
    const value = typeof next === "function" ? next(map) : next;
    setPast((p) => [...p.slice(-99), map]);
    setFuture([]);
    setMap(value);
  }

  function updateGrid(change: (g: LayoutGrid) => LayoutGrid) {
    commit((m) => withGrid(m, change(cloneGrid(grid))));
  }

  function undo() {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([...future, map]);
    setMap(prev);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture(future.slice(0, -1));
    setPast([...past, map]);
    setMap(next);
  }

  // Keyboard shortcuts read the latest handlers through a ref so the window
  // listener is installed once.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Escape") {
        setPaint(null);
        setHover(null);
      } else if (e.key === "w") {
        setTool("wall");
      } else if (e.key === "s") {
        setTool("spawn");
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toWorld(e: ReactPointerEvent): Point {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - box.left) / box.width) * width, y: ((e.clientY - box.top) / box.height) * height };
  }

  function hitTest(p: Point): Hover {
    if (tool === "wall") {
      const edge = edgeAt(grid, ts, t, p, ts * 0.3);
      return edge ? { kind: "edge", edge } : null;
    }
    const cell = cellAt(grid, ts, t, p);
    return cell ? { kind: "cell", ...cell } : null;
  }

  function isLocked(edge: Edge): boolean {
    return isBorderEdge(grid, edge.kind, edge.col, edge.row);
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = hitTest(toWorld(e));
    if (!hit) return;
    if (hit.kind === "edge") {
      if (isLocked(hit.edge)) {
        setStatus({ kind: "error", text: "The outer border is always walled." });
        return;
      }
      const value = !edgeValue(grid, hit.edge);
      updateGrid((g) => setEdge(g, hit.edge, value));
      setPaint(value);
    } else {
      updateGrid((g) => toggleSpawn(g, hit));
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const hit = hitTest(toWorld(e));
    setHover((prev) => (prev?.kind === "edge" && hit?.kind === "edge" && sameEdge(prev.edge, hit.edge) ? prev : hit));
    if (paint !== null && hit?.kind === "edge" && !isLocked(hit.edge) && edgeValue(grid, hit.edge) !== paint) {
      // Painting continues the stroke started on pointer down; that commit recorded the undo step.
      setMap((m) => withGrid(m, setEdge(parseLayout(m.layout), hit.edge, paint)));
    }
  }

  function endStroke() {
    setPaint(null);
  }

  function setSize(cols: number, rows: number) {
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
    cols = Math.min(MAX_TILES, Math.max(MIN_TILES, cols));
    rows = Math.min(MAX_TILES, Math.max(MIN_TILES, rows));
    if (cols === grid.cols && rows === grid.rows) return;
    updateGrid((g) => resizeGrid(g, cols, rows));
  }

  function clearWalls() {
    updateGrid((g) => {
      const next = createGrid(g.cols, g.rows);
      next.spawns = g.spawns;
      return next;
    });
  }

  function makeMaze() {
    updateGrid((g) => {
      const next = generateMaze(g.cols, g.rows, seed, loops / 100);
      next.spawns = g.spawns;
      return next;
    });
  }

  function applyLayoutText() {
    const lines = layoutText.split("\n").filter((line) => line.length > 0);
    try {
      parseLayout(lines);
      commit({ ...map, layout: lines });
      setLayoutDraft(null);
      setStatus({ kind: "ok", text: "Layout applied." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  function loadSource(source: MapSource) {
    if (past.length > 0 && !confirm("Discard unsaved changes to the current map?")) return;
    setMap(copySource(source));
    setPast([]);
    setFuture([]);
    setLayoutDraft(null);
    setStatus(null);
  }

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/__editor/maps/${encodeURIComponent(map.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(map),
      });
      const body = (await res.json()) as { ok?: boolean; file?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setPast([]);
      setFuture([]);
      setStatus({ kind: "ok", text: `Saved to ${body.file}. It is now selectable on the home page.` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteMap() {
    if (!confirm(`Delete "${map.id}" from the source tree?`)) return;
    try {
      const res = await fetch(`/__editor/maps/${encodeURIComponent(map.id)}`, { method: "DELETE" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setStatus({ kind: "ok", text: `Deleted ${map.id}.ts from source.` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
  }

  const dirty = past.length > 0;
  const hoverEdge = hover?.kind === "edge" && !isLocked(hover.edge) ? hover.edge : undefined;
  const gridLines: number[] = [];
  for (let k = 0; k <= Math.max(grid.cols, grid.rows); k++) gridLines.push(k);

  return (
    <div className="editor">
      <aside className="editor-panel">
        <h2>Map editor</h2>
        <p className="muted">
          Dev only. Saving writes <span className="mono">packages/shared/src/maps/data/{map.id}.ts</span>.
        </p>

        <section>
          <h3>Map</h3>
          <label className="field">
            Name
            <input value={map.name} onChange={(e) => commit({ ...map, name: e.target.value })} />
          </label>
          <label className="field">
            Id <span className="muted">(file name; a-z, 0-9, -)</span>
            <input
              className="mono"
              value={map.id}
              onChange={(e) => commit({ ...map, id: e.target.value })}
              onBlur={() => commit({ ...map, id: slugify(map.id) })}
            />
          </label>
          <div className="editor-row">
            <label className="field">
              Columns
              <input type="number" min={MIN_TILES} max={MAX_TILES} value={grid.cols} onChange={(e) => setSize(Number(e.target.value), grid.rows)} />
            </label>
            <label className="field">
              Rows
              <input type="number" min={MIN_TILES} max={MAX_TILES} value={grid.rows} onChange={(e) => setSize(grid.cols, Number(e.target.value))} />
            </label>
          </div>
          <div className="editor-row">
            <label className="field">
              Tile size
              <input type="number" min={2 * TANK_RADIUS + 2} step={4} value={ts} onChange={(e) => commit({ ...map, tileSize: Number(e.target.value) })} />
            </label>
            <label className="field">
              Wall thickness
              <input type="number" min={1} value={t} onChange={(e) => commit({ ...map, wallThickness: Number(e.target.value) })} />
            </label>
          </div>
        </section>

        <section>
          <h3>Tools</h3>
          <div className="editor-row">
            <button className={tool === "wall" ? "primary" : ""} onClick={() => setTool("wall")} title="Click a tile border to toggle a wall, drag to paint (W)">
              Wall
            </button>
            <button className={tool === "spawn" ? "primary" : ""} onClick={() => setTool("spawn")} title="Click a tile to add or remove a spawn (S)">
              Spawn
            </button>
            <button onClick={undo} disabled={past.length === 0}>
              Undo
            </button>
            <button onClick={redo} disabled={future.length === 0}>
              Redo
            </button>
          </div>
          <div className="editor-row">
            <button onClick={clearWalls}>Clear walls</button>
            <button onClick={() => updateGrid((g) => ({ ...g, spawns: cornerSpawns(g) }))}>Corner spawns</button>
          </div>
          <p className="muted help">
            Walls sit on tile borders only; the outer border is always closed. Spawns are numbered in player-slot order
            (max {MAX_SPAWNS}) and face the map centre. Ctrl+Z / Ctrl+Shift+Z undo / redo.
          </p>
        </section>

        <section>
          <h3>Maze generator</h3>
          <div className="editor-row">
            <label className="field">
              Seed
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
            </label>
            <label className="field">
              Loops %
              <input type="number" min={0} max={100} value={loops} onChange={(e) => setLoops(Number(e.target.value))} />
            </label>
          </div>
          <div className="editor-row">
            <button className="primary" onClick={makeMaze}>
              Generate maze
            </button>
            <button
              onClick={() => {
                setSeed(Math.floor(Math.random() * 100000));
              }}
            >
              Random seed
            </button>
          </div>
          <p className="muted help">Replaces all inner walls with a random labyrinth of the current size; spawns are kept. Higher loop % opens more shortcuts.</p>
        </section>

        <section>
          <h3>Save</h3>
          {errors.length > 0 && (
            <ul className="error editor-errors">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="editor-row">
            <button className="primary" onClick={save} disabled={saving || errors.length > 0}>
              {saving ? "Saving…" : existsInSource ? "Save (overwrite)" : "Save as new map"}
            </button>
            {existsInSource && (
              <button className="ghost" onClick={deleteMap}>
                Delete from source
              </button>
            )}
          </div>
          {status && <p className={status.kind === "error" ? "error" : "muted"}>{status.text}</p>}
          {dirty && !status && <p className="muted">Unsaved changes (draft kept in this browser).</p>}
        </section>

        <section>
          <h3>Maps in source</h3>
          <div className="editor-row">
            <select value={existsInSource ? map.id : ""} onChange={(e) => loadSource(sources.find((s) => s.id === e.target.value)!)}>
              {!existsInSource && <option value="">— unsaved: {map.id} —</option>}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
            <button onClick={() => loadSource(EMPTY_MAP)}>New</button>
          </div>
          <details>
            <summary className="muted">Layout text</summary>
            <textarea
              className="mono"
              rows={Math.min(24, map.layout.length)}
              spellCheck={false}
              value={layoutText}
              onChange={(e) => setLayoutDraft(e.target.value)}
            />
            <div className="editor-row">
              <button onClick={applyLayoutText} disabled={layoutDraft === null || layoutDraft === map.layout.join("\n")}>
                Apply layout
              </button>
              <button onClick={() => setLayoutDraft(null)} disabled={layoutDraft === null}>
                Revert
              </button>
            </div>
          </details>
        </section>
      </aside>

      <main className="editor-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ aspectRatio: `${width} / ${height}`, cursor: hover ? "pointer" : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={() => {
            setHover(null);
            endStroke();
          }}
        >
          <rect width={width} height={height} fill="#1a2029" />
          {gridLines.map((k) => (
            <g key={k} stroke="#2a3447" strokeWidth={scale} strokeDasharray={`${3 * scale} ${3 * scale}`}>
              {k <= grid.cols && <line x1={t / 2 + k * ts} y1={0} x2={t / 2 + k * ts} y2={height} />}
              {k <= grid.rows && <line x1={0} y1={t / 2 + k * ts} x2={width} y2={t / 2 + k * ts} />}
            </g>
          ))}

          {walls.map((w, i) => (
            <rect key={i} x={w.x} y={w.y} width={w.width} height={w.height} fill="#8a97ad" />
          ))}

          {hoverEdge && (
            <rect
              {...edgeRect(hoverEdge, ts, t)}
              fill={edgeValue(grid, hoverEdge) ? "#ff8a65" : "#4fc3f7"}
              fillOpacity={0.9}
              pointerEvents="none"
            />
          )}
          {hover?.kind === "cell" && (
            <rect x={hover.col * ts + t} y={hover.row * ts + t} width={ts - t} height={ts - t} fill="#4fc3f7" fillOpacity={0.15} pointerEvents="none" />
          )}

          {grid.spawns.map((s, i) => {
            const c = tileCenter(ts, t, s.col, s.row);
            const angle = Math.atan2(height / 2 - c.y, width / 2 - c.x);
            const color = `#${(SLOT_COLORS[i % SLOT_COLORS.length] ?? 0xffffff).toString(16).padStart(6, "0")}`;
            return (
              <g key={i} pointerEvents="none">
                <circle cx={c.x} cy={c.y} r={TANK_RADIUS} fill={color} fillOpacity={0.75} stroke={color} strokeWidth={2 * scale} />
                <line
                  x1={c.x}
                  y1={c.y}
                  x2={c.x + Math.cos(angle) * TANK_RADIUS * 1.8}
                  y2={c.y + Math.sin(angle) * TANK_RADIUS * 1.8}
                  stroke={color}
                  strokeWidth={3 * scale}
                />
                <text x={c.x} y={c.y} fill="#06232f" fontSize={14 * Math.max(1, scale)} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                  {i + 1}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="muted editor-status mono">
          {grid.cols} × {grid.rows} tiles of {ts} px · {width} × {height} px · {walls.length} wall segments · {grid.spawns.length} spawns
          {tool === "wall" ? " · click a tile border to toggle a wall" : " · click a tile to add/remove a spawn"}
        </p>
      </main>
    </div>
  );
}

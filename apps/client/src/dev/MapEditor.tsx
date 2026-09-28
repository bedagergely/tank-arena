import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  asciiMap,
  DEFAULT_RULES,
  listMapSources,
  validateMapSource,
  type MapSource,
  type Rect,
} from "@tank-arena/shared";
import { SLOT_COLORS } from "../game/GameRenderer.ts";
import {
  borderWalls,
  clampPointToMap,
  clampRectToMap,
  cloneMap,
  EMPTY_MAP,
  handleCursor,
  handlePosition,
  HANDLES,
  rectFromCorners,
  resizeRect,
  slugify,
  snapPoint,
  spawnAt,
  wallAt,
  type Handle,
  type Point,
  type Selection,
} from "./editorModel.ts";

const DRAFT_KEY = "tank-arena.editor.draft";
const SNAP_STEPS = [0, 5, 10, 20, 40];
const TANK_RADIUS = DEFAULT_RULES.tank.radius;

type Tool = "wall" | "spawn";

type Drag =
  | { kind: "draw"; start: Point; current: Point }
  | { kind: "move-wall"; index: number; start: Point; orig: Rect }
  | { kind: "resize-wall"; index: number; handle: Handle; orig: Rect }
  | { kind: "move-spawn"; index: number; start: Point; orig: Point };

interface Status {
  kind: "ok" | "error";
  text: string;
}

function loadInitial(): MapSource {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as MapSource;
  } catch {
    /* ignore corrupt drafts */
  }
  const first = listMapSources()[0];
  return first ? cloneMap(first) : cloneMap(EMPTY_MAP);
}

/**
 * Dev-only visual map editor (`/?editor`). Draw wall rectangles of any size,
 * place spawn points, then Save: the Vite dev server writes the map as a
 * TypeScript module under packages/shared/src/maps/data so it ships in source.
 */
export function MapEditor() {
  const [map, setMap] = useState<MapSource>(loadInitial);
  const [past, setPast] = useState<MapSource[]>([]);
  const [future, setFuture] = useState<MapSource[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>("wall");
  const [snapStep, setSnapStep] = useState(20);
  const [borderThickness, setBorderThickness] = useState(40);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [saving, setSaving] = useState(false);
  const [ascii, setAscii] = useState("");
  const [scale, setScale] = useState(1);
  const svgRef = useRef<SVGSVGElement>(null);

  const sources = listMapSources();
  const errors = useMemo(() => validateMapSource(map, TANK_RADIUS), [map]);
  const existsInSource = sources.some((s) => s.id === map.id);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(map));
  }, [map]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => setScale(map.width / Math.max(1, svg.getBoundingClientRect().width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [map.width, map.height]);

  /** Records an undo step and applies a change. */
  function commit(next: MapSource | ((m: MapSource) => MapSource)) {
    const value = typeof next === "function" ? next(map) : next;
    setPast((p) => [...p.slice(-99), map]);
    setFuture([]);
    setMap(value);
  }

  function undo() {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast(past.slice(0, -1));
    setFuture([...future, map]);
    setMap(prev);
    setSelection(null);
  }

  function redo() {
    const next = future[future.length - 1];
    if (!next) return;
    setFuture(future.slice(0, -1));
    setPast([...past, map]);
    setMap(next);
    setSelection(null);
  }

  function deleteSelection() {
    if (!selection) return;
    commit((m) =>
      selection.kind === "wall"
        ? { ...m, walls: m.walls.filter((_, i) => i !== selection.index) }
        : { ...m, spawns: m.spawns.filter((_, i) => i !== selection.index) },
    );
    setSelection(null);
  }

  function nudge(dx: number, dy: number) {
    if (!selection) return;
    const step = snapStep || 1;
    commit((m) => {
      if (selection.kind === "wall") {
        const w = m.walls[selection.index]!;
        const moved = clampRectToMap({ ...w, x: w.x + dx * step, y: w.y + dy * step }, m.width, m.height);
        return { ...m, walls: m.walls.map((r, i) => (i === selection.index ? moved : r)) };
      }
      const s = m.spawns[selection.index]!;
      const p = clampPointToMap({ x: s.x + dx * step, y: s.y + dy * step }, m.width, m.height);
      return { ...m, spawns: m.spawns.map((sp, i) => (i === selection.index ? { ...sp, ...p } : sp)) };
    });
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === "Escape") {
        setSelection(null);
        setDrag(null);
      } else if (e.key === "w") {
        setTool("wall");
      } else if (e.key === "s") {
        setTool("spawn");
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        nudge(e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0);
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toWorld(e: ReactPointerEvent): Point {
    const svg = svgRef.current!;
    const box = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * map.width,
      y: ((e.clientY - box.top) / box.height) * map.height,
    };
  }

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const raw = toWorld(e);
    const p = snapPoint(raw, snapStep);

    const spawnIndex = spawnAt(map.spawns, raw, TANK_RADIUS);
    if (spawnIndex >= 0) {
      setSelection({ kind: "spawn", index: spawnIndex });
      setDrag({ kind: "move-spawn", index: spawnIndex, start: p, orig: map.spawns[spawnIndex]! });
      return;
    }

    const wallIndex = wallAt(map.walls, raw);
    if (wallIndex >= 0) {
      setSelection({ kind: "wall", index: wallIndex });
      setDrag({ kind: "move-wall", index: wallIndex, start: p, orig: map.walls[wallIndex]! });
      return;
    }

    if (tool === "spawn") {
      const point = clampPointToMap(p, map.width, map.height);
      commit((m) => ({ ...m, spawns: [...m.spawns, point] }));
      setSelection({ kind: "spawn", index: map.spawns.length });
      return;
    }

    setSelection(null);
    setDrag({ kind: "draw", start: p, current: p });
  }

  function onHandleDown(e: ReactPointerEvent<SVGRectElement>, handle: Handle) {
    if (e.button !== 0 || !selection || selection.kind !== "wall") return;
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    setDrag({ kind: "resize-wall", index: selection.index, handle, orig: map.walls[selection.index]! });
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const p = snapPoint(toWorld(e), snapStep);
    switch (drag.kind) {
      case "draw":
        setDrag({ ...drag, current: p });
        break;
      case "move-wall": {
        const moved = clampRectToMap(
          { ...drag.orig, x: drag.orig.x + (p.x - drag.start.x), y: drag.orig.y + (p.y - drag.start.y) },
          map.width,
          map.height,
        );
        setMap((m) => ({ ...m, walls: m.walls.map((w, i) => (i === drag.index ? moved : w)) }));
        break;
      }
      case "resize-wall": {
        const clamped = clampPointToMap(p, map.width, map.height);
        const resized = resizeRect(drag.orig, drag.handle, clamped, Math.max(1, snapStep));
        setMap((m) => ({ ...m, walls: m.walls.map((w, i) => (i === drag.index ? resized : w)) }));
        break;
      }
      case "move-spawn": {
        const moved = clampPointToMap(
          { x: drag.orig.x + (p.x - drag.start.x), y: drag.orig.y + (p.y - drag.start.y) },
          map.width,
          map.height,
        );
        setMap((m) => ({ ...m, spawns: m.spawns.map((s, i) => (i === drag.index ? { ...s, ...moved } : s)) }));
        break;
      }
    }
  }

  function onPointerUp() {
    if (!drag) return;
    if (drag.kind === "draw") {
      const r = clampRectToMap(rectFromCorners(drag.start, drag.current), map.width, map.height);
      if (r.width > 0 && r.height > 0) {
        commit((m) => ({ ...m, walls: [...m.walls, r] }));
        setSelection({ kind: "wall", index: map.walls.length });
      }
    } else {
      // Live edits went straight to `map`; record the pre-drag state for undo.
      const before: MapSource =
        drag.kind === "move-spawn"
          ? { ...map, spawns: map.spawns.map((s, i) => (i === drag.index ? { ...s, ...drag.orig } : s)) }
          : { ...map, walls: map.walls.map((w, i) => (i === drag.index ? drag.orig : w)) };
      setPast((p) => [...p.slice(-99), before]);
      setFuture([]);
    }
    setDrag(null);
  }

  function updateWall(index: number, patch: Partial<Rect>) {
    commit((m) => ({ ...m, walls: m.walls.map((w, i) => (i === index ? { ...w, ...patch } : w)) }));
  }

  function updateSpawn(index: number, patch: Partial<MapSource["spawns"][number]>) {
    commit((m) => ({ ...m, spawns: m.spawns.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function loadSource(source: MapSource) {
    if (past.length > 0 && !confirm("Discard unsaved changes to the current map?")) return;
    setMap(cloneMap(source));
    setPast([]);
    setFuture([]);
    setSelection(null);
    setStatus(null);
  }

  function newMap() {
    const base = cloneMap(EMPTY_MAP);
    loadSource({ ...base, walls: borderWalls(base.width, base.height, borderThickness) });
  }

  function importAscii() {
    const rows = ascii
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);
    try {
      const src = asciiMap({ id: map.id, name: map.name, tileSize: snapStep || 40, rows });
      commit(src);
      setSelection(null);
      setStatus({ kind: "ok", text: `Imported ${src.walls.length} walls and ${src.spawns.length} spawns.` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    }
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

  const selectedWall = selection?.kind === "wall" ? map.walls[selection.index] : undefined;
  const selectedSpawn = selection?.kind === "spawn" ? map.spawns[selection.index] : undefined;
  const preview = drag?.kind === "draw" ? rectFromCorners(drag.start, drag.current) : null;
  const handleSize = 8 * scale;
  const dirty = past.length > 0;

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
              Width
              <input type="number" min={100} step={10} value={map.width} onChange={(e) => commit({ ...map, width: Number(e.target.value) })} />
            </label>
            <label className="field">
              Height
              <input type="number" min={100} step={10} value={map.height} onChange={(e) => commit({ ...map, height: Number(e.target.value) })} />
            </label>
          </div>
          <div className="editor-row">
            <label className="field">
              Border
              <input type="number" min={1} value={borderThickness} onChange={(e) => setBorderThickness(Number(e.target.value))} />
            </label>
            <button onClick={() => commit({ ...map, walls: [...map.walls, ...borderWalls(map.width, map.height, borderThickness)] })}>
              Add border walls
            </button>
          </div>
        </section>

        <section>
          <h3>Tools</h3>
          <div className="editor-row">
            <button className={tool === "wall" ? "primary" : ""} onClick={() => setTool("wall")} title="Drag on empty space to draw a wall (W)">
              Wall
            </button>
            <button className={tool === "spawn" ? "primary" : ""} onClick={() => setTool("spawn")} title="Click empty space to add a spawn (S)">
              Spawn
            </button>
            <label className="field">
              Snap
              <select value={snapStep} onChange={(e) => setSnapStep(Number(e.target.value))}>
                {SNAP_STEPS.map((s) => (
                  <option key={s} value={s}>
                    {s === 0 ? "off" : `${s} px`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="editor-row">
            <button onClick={undo} disabled={past.length === 0}>
              Undo
            </button>
            <button onClick={redo} disabled={future.length === 0}>
              Redo
            </button>
            <button onClick={deleteSelection} disabled={!selection}>
              Delete
            </button>
          </div>
          <p className="muted help">
            Drag walls to move, drag the square handles to resize, arrows nudge, Del deletes, Ctrl+Z / Ctrl+Shift+Z undo / redo.
            Spawns are numbered in player-slot order and face the map centre unless given an angle.
          </p>
        </section>

        {selectedWall && selection?.kind === "wall" && (
          <section>
            <h3>Wall {selection.index + 1}</h3>
            <div className="editor-grid">
              {(["x", "y", "width", "height"] as const).map((k) => (
                <label className="field" key={k}>
                  {k}
                  <input
                    type="number"
                    min={k === "width" || k === "height" ? 1 : 0}
                    value={selectedWall[k]}
                    onChange={(e) => updateWall(selection.index, { [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        {selectedSpawn && selection?.kind === "spawn" && (
          <section>
            <h3>Spawn {selection.index + 1}</h3>
            <div className="editor-grid">
              <label className="field">
                x
                <input type="number" value={selectedSpawn.x} onChange={(e) => updateSpawn(selection.index, { x: Number(e.target.value) })} />
              </label>
              <label className="field">
                y
                <input type="number" value={selectedSpawn.y} onChange={(e) => updateSpawn(selection.index, { y: Number(e.target.value) })} />
              </label>
              <label className="field">
                angle° <span className="muted">(blank = face centre)</span>
                <input
                  type="number"
                  step={15}
                  value={selectedSpawn.angle === undefined ? "" : Math.round((selectedSpawn.angle * 180) / Math.PI)}
                  onChange={(e) =>
                    updateSpawn(selection.index, {
                      angle: e.target.value === "" ? undefined : (Number(e.target.value) * Math.PI) / 180,
                    })
                  }
                />
              </label>
            </div>
          </section>
        )}

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
            <button onClick={newMap}>New</button>
          </div>
          <details>
            <summary className="muted">Import ASCII grid</summary>
            <textarea
              className="mono"
              rows={6}
              placeholder={"#####\n#1.2#\n#####"}
              value={ascii}
              onChange={(e) => setAscii(e.target.value)}
            />
            <button onClick={importAscii} disabled={ascii.trim().length === 0}>
              Import ({snapStep || 40} px tiles)
            </button>
          </details>
        </section>
      </aside>

      <main className="editor-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${map.width} ${map.height}`}
          style={{ aspectRatio: `${map.width} / ${map.height}`, cursor: tool === "spawn" ? "copy" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          <defs>
            {snapStep > 0 && (
              <pattern id="grid-minor" width={snapStep} height={snapStep} patternUnits="userSpaceOnUse">
                <path d={`M ${snapStep} 0 L 0 0 0 ${snapStep}`} fill="none" stroke="#243042" strokeWidth={scale} />
              </pattern>
            )}
            <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
              <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#2f3d52" strokeWidth={scale} />
            </pattern>
          </defs>
          <rect width={map.width} height={map.height} fill="#1a2029" />
          {snapStep > 0 && <rect width={map.width} height={map.height} fill="url(#grid-minor)" />}
          <rect width={map.width} height={map.height} fill="url(#grid-major)" />

          {map.walls.map((w, i) => {
            const selected = selection?.kind === "wall" && selection.index === i;
            return (
              <rect
                key={i}
                x={w.x}
                y={w.y}
                width={w.width}
                height={w.height}
                fill="#3a4556"
                stroke={selected ? "#4fc3f7" : "#556274"}
                strokeWidth={selected ? 2 * scale : scale}
                style={{ cursor: "move" }}
              />
            );
          })}

          {preview && preview.width > 0 && preview.height > 0 && (
            <rect {...preview} fill="rgba(79,195,247,0.25)" stroke="#4fc3f7" strokeWidth={scale} strokeDasharray={`${4 * scale} ${4 * scale}`} />
          )}

          {map.spawns.map((s, i) => {
            const selected = selection?.kind === "spawn" && selection.index === i;
            const angle = s.angle ?? Math.atan2(map.height / 2 - s.y, map.width / 2 - s.x);
            const color = `#${(SLOT_COLORS[i % SLOT_COLORS.length] ?? 0xffffff).toString(16).padStart(6, "0")}`;
            return (
              <g key={i} style={{ cursor: "move" }}>
                <circle cx={s.x} cy={s.y} r={TANK_RADIUS} fill={color} fillOpacity={0.75} stroke={selected ? "#ffffff" : color} strokeWidth={2 * scale} />
                <line
                  x1={s.x}
                  y1={s.y}
                  x2={s.x + Math.cos(angle) * TANK_RADIUS * 1.8}
                  y2={s.y + Math.sin(angle) * TANK_RADIUS * 1.8}
                  stroke={color}
                  strokeWidth={3 * scale}
                />
                <text x={s.x} y={s.y} fill="#06232f" fontSize={14 * Math.max(1, scale)} fontWeight={700} textAnchor="middle" dominantBaseline="central">
                  {i + 1}
                </text>
              </g>
            );
          })}

          {selectedWall &&
            HANDLES.map((h) => {
              const p = handlePosition(selectedWall, h);
              return (
                <rect
                  key={h}
                  x={p.x - handleSize / 2}
                  y={p.y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="#ffffff"
                  stroke="#4fc3f7"
                  strokeWidth={scale}
                  style={{ cursor: handleCursor(h) }}
                  onPointerDown={(e) => onHandleDown(e, h)}
                />
              );
            })}
        </svg>
        <p className="muted editor-status mono">
          {map.width} × {map.height} · {map.walls.length} walls · {map.spawns.length} spawns
          {drag?.kind === "draw" && preview ? ` · drawing ${preview.width} × ${preview.height}` : ""}
        </p>
      </main>
    </div>
  );
}

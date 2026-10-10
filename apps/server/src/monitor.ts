import { basicAuth, monitor, type ExpressMiddleware } from "colyseus";

export interface MonitorConfig {
  /** Whether the panel is mounted at all. */
  enabled: boolean;
  /** Basic-auth username; only meaningful once `password` is set. */
  user: string;
  /** Basic-auth password. When set, the panel sits behind a browser prompt. */
  password?: string;
}

/**
 * Resolve how the monitoring panel is exposed from the environment.
 *
 * The panel grants full control over rooms and clients, so it is never mounted
 * unprotected in production: `MONITOR_PASSWORD` must be set for it to appear at
 * all. Development keeps it open for convenience.
 */
export function resolveMonitorConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const password = env.MONITOR_PASSWORD?.trim() || undefined;
  return {
    enabled: env.NODE_ENV !== "production" || password !== undefined,
    user: env.MONITOR_USER?.trim() || "admin",
    password,
  };
}

/**
 * Middleware for mounting at `/monitor`, or `null` when the panel is disabled
 * (production without `MONITOR_PASSWORD`). Pass the result straight to
 * `app.use("/monitor", ...)`.
 */
export function monitorMiddleware(env: NodeJS.ProcessEnv = process.env): ExpressMiddleware | null {
  const { enabled, user, password } = resolveMonitorConfig(env);
  if (!enabled) return null;
  return monitor(password ? { use: [basicAuth({ users: { [user]: password } })] } : {});
}

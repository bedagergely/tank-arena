import { listen } from "@colyseus/tools";
import app from "./app.config.ts";

// Listens on PORT (default 2567).
listen(app);

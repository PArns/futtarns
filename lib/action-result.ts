export type ActionResult =
  | {
      ok: true;
      message?: string;
      link?: string;
      /** Shown once and never again, such as a new MCP key. */
      secret?: string;
    }
  | { ok: false; error: string };

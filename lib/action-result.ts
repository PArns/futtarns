export type ActionResult =
  { ok: true; message?: string; link?: string } | { ok: false; error: string };

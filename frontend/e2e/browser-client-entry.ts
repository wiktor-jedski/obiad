/**
 * Browser entry that exposes the generated TypeScript API client to the
 * real-stack smoke scenario (task 22; ARCH-008, ARCH-022).
 *
 * The e2e launcher bundles this file with `bun build --target browser
 * --format iife` into its owned temporary directory and injects the bundle
 * into Chromium with `page.addScriptTag`. The scenario then executes
 * generated-client requests inside the browser, through the preview origin's
 * same-origin `/api` proxy. This entry is never part of the application
 * bundle and performs no request at load time.
 */
import { client } from "../src/client/client.gen";

(globalThis as Record<string, unknown>).__obiadGeneratedClient = client;

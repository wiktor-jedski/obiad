import { client } from "../src/client/client.gen";

declare global {
  var __obiadGeneratedClient: typeof client;
}

globalThis.__obiadGeneratedClient = client;

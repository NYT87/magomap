/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The magomap extension's id; unset means the published one (apps/extension/src/extensionId.ts). */
  readonly VITE_MAGOMAP_EXTENSION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

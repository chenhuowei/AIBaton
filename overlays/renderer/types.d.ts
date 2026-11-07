// Ambient declarations for Electron-only globals referenced by AionUi 2.2.2
// renderer files. The Tauri build never uses these at runtime, but they must
// type-check. This project intentionally does NOT depend on `electron`.

declare namespace Electron {
  interface WebviewTag extends HTMLElement {
    src: string;
    partition?: string;
    reload(): void;
    canGoBack?: () => boolean;
    canGoForward?: () => boolean;
    goBack(): void;
    goForward(): void;
    getWebContentsId?: () => number;
    executeJavaScript(code: string): Promise<unknown>;
    addEventListener(type: string, listener: (event: never) => void): void;
    removeEventListener(type: string, listener: (event: never) => void): void;
    [key: string]: unknown;
  }
  interface ConsoleMessageEvent extends Event {
    message: string;
    level: string;
    line: number;
    sourceId: string;
  }
}

declare module 'electron' {
  export type OpenDialogOptions = {
    title?: string;
    defaultPath?: string;
    buttonLabel?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<
      | 'openFile'
      | 'openDirectory'
      | 'multiSelections'
      | 'showHiddenFiles'
      | 'createDirectory'
      | 'promptToCreate'
      | 'noResolveAliases'
      | 'treatPackageAsDirectory'
      | 'dontAddToRecent'
    >;
  };
}

// Compile-time globals injected by electron.vite.config.ts in upstream;
// vite.config.ts provides the same defines for this project.
declare const __APP_VERSION__: string;

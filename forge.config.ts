import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import MakerAppImage from "./makers/MakerAppImage";
import MakerNSIS from "./makers/MakerNSIS";
import MakerDMG from "./makers/MakerDMG";
import { COPYRIGHT } from "./makers/CommonConfig";

const config: ForgeConfig = {
  packagerConfig: {
    icon: "./public/assets/icons/icon",
    appBundleId: "com.lukethehawk.altusplus",
    appCategoryType: "public.app-category.social-networking",
    // The exe's copyright line; without it, it keeps Electron's own.
    appCopyright: COPYRIGHT,
    // No whatsapp:// registration here: the app registers itself only while
    // its setting is on, so another WhatsApp app keeps the links by default.
    asar: true,
    // The Vite bundles in .vite/ inline every runtime dependency; this
    // plugin-vite version does not prune the app folder by itself, so ship
    // only the bundles and package.json instead of sources and node_modules.
    ignore: (file: string) =>
      !!file && file !== "/package.json" && !file.startsWith("/.vite"),
    // Update source and cache folder for electron-updater.
    extraResource: ["./app-update.yml"],
  },
  rebuildConfig: {},
  makers: [new MakerAppImage(), new MakerDMG(), new MakerNSIS()],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
        },
        {
          entry: "src/whatsapp.preload.ts",
          config: "vite.whatsapp.preload.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Switches baked into the packaged executable (not used by `yarn start`).
    new FusesPlugin({
      version: FuseVersion.V1,
      // The exe cannot be reused as a Node.js runtime, or be given code
      // through NODE_OPTIONS or a debugger, by another program.
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Refuse to start if app.asar was modified after the build, and never
      // load the app from anywhere else.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      // Left as is:
      // - GrantFileProtocolExtraPrivileges: the app window is loaded from
      //   file:// inside app.asar, which fails (ERR_FILE_NOT_FOUND) without
      //   it; turning it off needs a custom protocol for the window first.
      // - EnableCookieEncryption: it changes how the WhatsApp sessions are
      //   stored and could sign the accounts out.
    }),
  ],
};

export default config;

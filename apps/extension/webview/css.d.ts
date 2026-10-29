// esbuild bundles the UI's CSS imports; TS 6+ checks side-effect imports, so give them a type.
declare module "*.css";

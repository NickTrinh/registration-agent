// tsconfig pins `types: ["chrome"]`, which excludes Vite's ambient client
// types — so imported static assets need their own module declaration. The
// mascot sprite strips (tools/mascot/strips/*.png) are imported for their
// bundled, hashed URL; Rollup emits them under assets/ (web-accessible).
declare module "*.png" {
  const src: string;
  export default src;
}

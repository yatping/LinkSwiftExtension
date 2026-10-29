declare module '*.user.js' {
  const run: (env: Record<string, unknown>) => void;
  export default run;
}
declare module '*.css?raw' {
  const css: string;
  export default css;
}
declare module 'sweetalert2/dist/sweetalert2.js' {
  import Swal from 'sweetalert2';
  export default Swal;
}
declare module 'js-md5' {
  const md5: (message: string | ArrayBuffer | Uint8Array) => string;
  export default md5;
}

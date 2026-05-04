declare module 'imagetracerjs' {
  const tracer: {
    imagedataToSVG: (imgd: ImageData, opts: Record<string, unknown>) => string;
    [key: string]: unknown;
  };
  export default tracer;
}

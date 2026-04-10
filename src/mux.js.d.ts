declare module 'mux.js' {
  export const mp4: {
    Transmuxer: new () => {
      on(event: 'data', callback: (segment: { initSegment: Uint8Array; data: Uint8Array }) => void): void;
      on(event: 'done', callback: () => void): void;
      on(event: 'error', callback: (err: Error) => void): void;
      push(data: Uint8Array): void;
      flush(): void;
    };
  };
  export default { mp4: typeof mp4 };
}

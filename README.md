# `jset_web`
Generating colored [Julia sets](https://en.wikipedia.org/wiki/Julia_set)
in the browser using wasm.

Right now this is still pretty primitive. It only does the Mandlebrot iterator
with a fixed coloring. Eventually I'd like to have
  * user-specifiable polynomial iteration
  * user-specifiable color map
  * perhaps some type of smoothing, blurring, or downsampling
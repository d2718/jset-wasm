# `jset_web`
Generating colored [Julia sets](https://en.wikipedia.org/wiki/Julia_set)
in the browser using wasm.

## Use

To draw a trippy "fractal" on an HTML `<canvas>` using this module requires
the following steps:

  * Load the wasm module into your Javascript script. If you want it to
    signal to the browser when it panics, expose your panic singnalling script
    to the `pnk()` function, like so:
```javascript
    let wasm_mod = {};
    WebAssembly.instantiateStreaming(
        fetch("http:// ... /jset_web.wasm"),
        {
            "env": {
                "pnk": your_panic_alert_function,
            },
        }
    ).then(obj => wasm_mod = obj);
```

  * Call `set_gradient()` for each color gradient in your trippy fractal.
    For example, to have it fade from black to blue to cyan to white to black
    again:
```javascript
//                   |-start color--|  |-end color----|
// args: gradient #, red, green, blue, red, green, blue, # of steps
wasm_mod.instance.exports.set_gradient(0,   0,   0,   0,   0,   0, 255, 256);
wasm_mod.instance.exports.set_gradient(1,   0,   0, 255,   0, 255, 255, 256);
wasm_mod.instance.exports.set_gradient(2,   0, 255, 255, 255, 255, 255, 256);
wasm_mod.instance.exports.set_gradient(3, 255, 255, 255,   0,   0,   0, 256);
```

  * Call `set_n_gradients()` to inform the module of the number of gradients.
```javascript
wasm_mod.instance.exports.set_n_gradients(4); // We set gradients 0-3 above.
```

  * Call `update_color_map()` to make a color map out of the gradient
    information you have set.
```javascript
wasm_mod.instance.exports.update_color_map();
```

  * If you want to use the polynomial iterator, specify the polynomial
    function to use with `set_coeff()` to set each coefficient and
    to tell the module how many coefficients you want to use `set_n_coeffs()`.
```javascript
    // Specify iterator as f(z) = z^2 + 0.7e^(i0.63π)

    // Calculate the real and imaginary parts of the constant term from
    // its polar coordinates:
    const re_part = 0.7 * Math.cos(0.63 * Math.PI);
    const im_part = 0.7 * Math.sin(0.63 * Math.PI);

    wasm_mod.instance.exports.set_coeff(0, re_part, im_part);
    wasm_mod.instance.exports.set_coeff(1, 0, 0);
    wasm_mod.instance.exports.set_coeff(2, 1.0, 0);
    wasm_mod.instance.exports.set_n_coeffs(3);
```

Be careful with the polynomial iterator. While the Mandlebrot iterator is
guaranteed to produce an interesting image, most sets of polynomial
coefficients will not. The one specified in the example above will, so if
you want quick results, start with that, and make _small_ incremental
changes until you have something you like. Keep your coefficients small,
especially the higher-degree ones.

  * Call `redraw()` with the appropriate image parameters to churn through
    all the calculations and write image data to the exposed `IMAGE` buffer.
```javascript
    wasm_mod.instance.exports.redraw(
        xpix,   // width of canvas in pixels
        ypix,   // height of canvas in pixels
        x,      // real coordinate of upper-left-hand corner of image
        y,      // imaginary coordinate of upper-left-hand corner of image
        width,  // width of image on the Complex plane
        poly_p  // boolean indicating whenther to use the polynomial iterator
    );
```

  * Wrap the `IMAGE` buffer in a `Uint8ClampedArray`, wrap it in an
    `ImageData` object, and put it in the `<canvas>`'s `"2d"` context.
```javascript
    const data = new ImageData(
        new UInt8ClampedArray(
            wasm_mod.instance.exports.memory.buffer,
            wasm_mod.instance.exports.BUFFER.value,
            4 * xpix * ypix     // 4 bytes of data per pixel
        ),
        xpix                    // image width in pixels
    );
    const canvas = document.getElementById("your-canvas");
    canvas.getContext("2d").putImageData(data, 0, 0);
```

The most time-consuming step is the call to `redraw()`--it's the one that
iterates a complex value associated with each pixel until it either diverges
or runs out of color map. If you don't need to redo the iteration, but just
want to _recolor_ the image, you can use the exposed function `recolor()`:

```javascript
wasm_mod.instance.exports.set_gradient(0, 0,   0, 0,   0, 255,   0, 128);
wasm_mod.instance.exports.set_gradient(0, 0, 255, 0,   0,   0, 255, 256);
wasm_mod.instance.exports.set_gradient(0, 0, 255, 255, 0,   0,   0, 256);
wasm_mod.instance.exports.set_n_gradients(3); // We just specified 3 gradients.

wasm_mod.instance.exports.recolor(xpix, ypix); // <-- This call right here.

// Then we need to shove the data into the <canvas> again.
const data = new ImageData(
    new UInt8ClampedArray(
        wasm_mod.instance.exports.memory.buffer,
        wasm_mod.instance.exports.BUFFER.value,
        4 * xpix * ypix     // 4 bytes of data per pixel
    ),
    xpix                    // image width in pixels
);
const canvas = document.getElementById("your-canvas");
canvas.getContext("2d").putImageData(data, 0, 0);
```

There is one caveat here: If you specify a new color map that is _longer_ than
the old color map (that is, the sum of the number of shades in the collection
of gradients is larger), it won't display properly until you call `redraw()`
again. I don't think it's possible to fix this while keeping the `recolor()`
call fast.

## Plans

All the core functionality is now implemented. 

  * ~~user-specifiable polynomial iteration~~ done!
  * ~~user-specifiable color map~~ done!
  * perhaps some type of smoothing, blurring, or downsampling
  * improved UI of the web interface
    + drag-resizable canvas
    + better ergonomics/visuals for entering polynomial coefficients
    + fixed-size controls `<div>`
    + sucking less on mobile

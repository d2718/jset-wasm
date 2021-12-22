/*!
WASM module for coloring Julia sets based on divergence speed.

All arrays are of static size to avoid allocation. Current limitations are:
  * image size 1920 x 1080 pixels
  * 16 gradients
  * 65,535 individual color steps

All functions are only ever called single-threadedly from Javascript, so
anything marked `unsafe` actually isn't. This is basically C. I've still
tried to minimize the amount of actual code in `unsafe` blocks, though.

To render an image in an HTML `<canvas>` using this module:
  * Load this wasm module into your JS script. If you want this module to
    signal when it panics, bind your function to indicate panic to the
    `pnk()` function. Do this with, for example, the following environment
    object as the second argument to `WebAssembly.instantiateStreaming()`:
    ```javascript
    {
        "env": {
            "pnk": your_panic_function,
        },
    }
    ```
  * Call `set_gradient(n, r0, b0, g0, r1, g1, b1, n_steps)` for each gradient
    in your color map.
  * Call `set_n_gradients(n)` to let the module know the number of
    gradients in your color map.
  * Call `update_color_map()` to process those gradients into an array of
    individual colors used in the next step.
  * If you are using the polynomial iterator, call `set_coeff(n, re, im)`
    for each complex coefficient in your polynomial, then call
    `set_n_coeffs(n)` to let the module know how many coefficients your
    polynomial has.
  * Call `redraw(xpix, ypix, x, y, width, use_poly_iter)` to write image
    data to the exposed `IMAGE` buffer.
  * Finally, wrap the `IMAGE` buffer in a `Uint8ClampedArray`, and use the
    `<canvas>` context's `.putImageData()` method to insert the image into
    the canvas.
*/

#![no_std]

/// This function is exposed by the JS; it is intended to signal a panic.
extern { fn pnk(); }

/// Just signals a panic and then goes busy-wait catatonic.
#[panic_handler]
fn handle_panic(_: &core::panic::PanicInfo) -> ! {
    unsafe { pnk(); }
    loop {};
}

/// largest allowable image width
const MAX_WIDTH: usize  = 1920;
/// largest allowable image height
const MAX_HEIGHT: usize = 1080;
/// image data buffer size calculated from `MAX_WIDTH` and `MAX_HEIGHT`
const IMAGE_SIZE: usize = MAX_WIDTH * MAX_HEIGHT;
/// maximum number gradients in the color map
const MAX_GRADIENTS: usize = 16;
/// maximum number of individual color steps in the color map
const COLOR_MAP_LENGTH: usize = 65_536;
/// maximum number of polynomial coefficients (unused!)
const MAX_COEFFS: usize = 7;

/**
The actual data that gets passed to the HTML canvas in a Javascript
`Uint8ClampedArray`. Format of each u32 is `0xAABBGGRR`.
*/
#[no_mangle]
static mut IMAGE:   [u32; IMAGE_SIZE] = [0; IMAGE_SIZE];
/**
Output of the "iterator" stage; value is the number of steps it takes any
given pixel's point do diverge.
*/
static mut ITERMAP: [u16; IMAGE_SIZE] = [0; IMAGE_SIZE];
/**
The collection of actual color values. `COLOR_MAP[n]` is the color a pixel
will be colored when its point takes `n` iterations to exceed the modulus
limit.
*/
static mut COLOR_MAP: [u32; COLOR_MAP_LENGTH] = [0; COLOR_MAP_LENGTH];

/**
The color gradients.

The first gradient goes from `(R0[0], G0[0], B0[0])` to `(R1[0], B1[0], G1[0])`
in `SHADES[0]` steps. The second goes from `(R0[1], G0[1], B0[1])` to
`(R1[1], G1[1], B1[1])` in `SHADES[`]` steps, etc.
*/
static mut R0:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut R1:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut G0:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut G1:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut B0:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut B1:      [u8; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
static mut SHADES: [u16; MAX_GRADIENTS] = [0; MAX_GRADIENTS];
/// The number of gradients in the current color scheme.
static mut N_GRADIENTS: usize = 7;
/// The color to color points that iterate past the end of the gradient.
static DEFAULT_COLOR: u32 = 0xFF_00_00_00;
/**
The number of shades in the _last used_ colormap. This is currently unused,
but will be useful when coloration without reiteration is refined.
*/
static mut LAST_COLORMAP_LENGTH: usize = 0;
/**
The number of shades in the last _calculated_ color map. This should be the
number used by the _currently running_ coloring routine.
*/
static mut CURRENT_COLORMAP_LENGTH: usize = 0;

/**
The default iteration limit. Points are colored based on how many iterations
it takes for their squared moduli to exceed this limit.
*/
static SQ_MOD_LIMIT: f64 = 1_000_000.0;

/**
This is obviously a complex number abstraction. I only introduced it because
I was screwing up the arithmetic in the polynomial iterator, and this made
it easier to think about.
*/
#[derive(Clone, Copy)]
struct Cx { re: f64, im: f64 }

impl Cx {
    fn add(&self, other: &Cx) -> Cx {
        Cx {
            re: self.re + other.re,
            im: self.im + other.im,
        }
    }
    
    fn mul(&self, other: &Cx) -> Cx {
        Cx {
            re: (self.re * other.re) - (self.im * other.im),
            im: (self.im * other.re) + (self.re * other.im),
        }
    }
    
    fn sqmod(&self) -> f64 { (self.re * self.re) + (self.im * self.im) }
}

/**
Coefficients for the polynomial iterator. `COEFFS[0]` is the constant term;
`COEFFS[6]` is the sextic term. If you need more terms, just change the
value of `MAX_COEFFS` above.
*/
static mut COEFFS: [Cx; MAX_COEFFS] = [Cx { re: 0.0, im: 0.0 }; MAX_COEFFS ];

/// Number of coefficients currently in use by the polynomial iterator.
static mut N_COEFFS: usize = 1;

/**
Populate the `COLOR_MAP` based on color gradient data.

The first eight arguments are immutable references to the color gradient
data (above). `colors` is a `&mut` to the `COLOR_MAP`, and `map_length` is
an `&mut` to `CURRENT_COLORMAP_LENGTH`, which gets set at the end..
*/
fn make_color_map(
    r_starts: &[u8; MAX_GRADIENTS],
    r_ends:   &[u8; MAX_GRADIENTS],
    g_starts: &[u8; MAX_GRADIENTS],
    g_ends:   &[u8; MAX_GRADIENTS],
    b_starts: &[u8; MAX_GRADIENTS],
    b_ends:   &[u8; MAX_GRADIENTS],
    shade_counts: &[u16; MAX_GRADIENTS],
    n_gradients: usize,
    colors: &mut [u32; COLOR_MAP_LENGTH],
    map_length: &mut usize
) {
    let mut color_idx: usize = 0;
    for step_n in 0..n_gradients {
        let (r0, r1) = (r_starts[step_n] as f32, r_ends[step_n] as f32);
        let (g0, g1) = (g_starts[step_n] as f32, g_ends[step_n] as f32);
        let (b0, b1) = (b_starts[step_n] as f32, b_ends[step_n] as f32);
        let dr = r1-r0;
        let dg = g1-g0;
        let db = b1-b0;
        let n_shades = shade_counts[step_n] as f32;
        for n in 0..(shade_counts[step_n]){
            let frac = (n as f32) / n_shades;
            let r = r0 + (frac * dr);
            let g = g0 + (frac * dg);
            let b = b0 + (frac * db);
            // Each pixel's layout is `0xAA_BB_GG_RR`
            let col: u32 = (r as u32) | ((g as u32) << 8) | ((b as u32) << 16)
                                      | 0xFF_00_00_00u32;
            colors[color_idx] = col;
            color_idx = color_idx + 1;
        }
    }
    
    // Set `CURRENT_COLORMAP_LENGTH`.
    *map_length = color_idx;
    
    // Fill the rest of the buffer with zeros. Originally the first zero
    // value was used as a zigamorph for determining the length of the
    // color map, but now that value is explicitly stored. I think it's
    // still a good idea to zero the whole thing, though, and it's fast.
    for n in color_idx..COLOR_MAP_LENGTH {
        colors[n] = 0u32;
    }
}

/**
Exported function to set the values for gradient `n`. Takes `n` followed
by the RGB values (in that order) of the beginning color, then the end
color, then finally the number of shades it should take to fade between
the two.
*/
#[no_mangle]
pub unsafe extern fn set_gradient(
    n: usize,
    r0: u8, g0: u8, b0: u8,
    r1: u8, g1: u8, b1: u8,
    shades: u16
) {
    if n < MAX_GRADIENTS {
        R0[n] = r0; R1[n] = r1;
        G0[n] = g0; G1[n] = g1;
        B0[n] = b0; B1[n] = b1;
        SHADES[n] = shades;
    }
}

/**
Exported function to set the number of gradients in the current color map.
Without this value, `make_color_map()` has no idea how many of the gradient
steps to use.
*/
#[no_mangle]
pub unsafe fn set_n_gradients(n: usize) { 
    if n < MAX_GRADIENTS { N_GRADIENTS = n; }
}

/**
Exported function to recalculate/repopulate the `COLOR_MAP`, presumably
after calling `set_gradient()` and `set_n_gradients()`.
*/
#[no_mangle]
pub unsafe extern fn update_color_map() {
    // This is only ever called from JS, so `&mut COLRMAP` will only ever
    // exist here when this function is running.
    make_color_map(
        &R0, &R1, &G0, &G1, &B0, &B1,
        &SHADES, N_GRADIENTS,
        &mut COLOR_MAP, &mut CURRENT_COLORMAP_LENGTH
    );
}

/**
Walk the iteration data in `ITERMAP` and use the color data in `COLOR_MAP`
to write the actual image data to the `IMAGE` buffer.

The first two arguements are immutable references to `ITERMAP` and
`COLOR_MAP`, `outbuff` is an `&mut` to `IMAGE`, `default_color` should be
self-explanatory, `npix` is the total number of pixels in the image
(that is, the length of the meaningful data in `ITERMAP`), and `n_shades`
is the value of `CURRENT_COLORMAP_LENGTH` (that is, the length of the
meaningful data in `COLOR_MAP`).
*/
fn color_itermap(
    itrmap: &[u16; IMAGE_SIZE],
    colormap: &[u32; COLOR_MAP_LENGTH],
    outbuff: &mut [u32; IMAGE_SIZE],
    default_color: u32,
    npix: usize,
    n_shades: usize,
) {
    for n in 0..npix {
        let col_idx = itrmap[n] as usize;
        if col_idx < n_shades {
            outbuff[n] = colormap[col_idx];
        } else {
            outbuff[n] = default_color;
        }
    }
}

/**
Exported function to set coefficients for the polynomial iterator.
*/
#[no_mangle]
pub unsafe extern fn set_coeff(n: usize, re: f64, im: f64) {
    if n < MAX_COEFFS {
        COEFFS[n] = Cx{ re, im };
    }
}

/**
Exported function to set the number of coefficients for the polynomial
iterator to use.
*/
#[no_mangle]
pub unsafe extern fn set_n_coeffs(n: usize) {
    if n < MAX_COEFFS { N_COEFFS = n; }
}

/**
Return how many iterations of z = z^2 + c the point `x` + i`y` takes before its
squared modulus exceeds `sq_mod_limit` (or `iter_limit`, if it doesn't
exceed it by `iter_limit` iterations). `iter_limit` should be the length
of the valid data in `COLOR_MAP`.
*/
fn mandelbrot_iter(
    x: f64, y: f64,
    sq_mod_limit: f64, iter_limit: u16
) -> u16 {
    let c = Cx { re: x, im: y };
    let mut cur = Cx { re: 0.0, im: 0.0 };
    
    for n in 0..iter_limit {
        cur = c.add(&cur.mul(&cur));
        if cur.sqmod() > sq_mod_limit { return n; }
    }
    return  iter_limit;
}

/**
Given the pixel dimensions of the image (`xpix`, `ypix`), the coordinates of
the upper-left-hand corner of the image (`x`, `y`), and the width of the
image on the Complex Plane (`width`), fill the appropriate amount of
`ITERMAP` (passed as `&mut buff`) with iteration data.

`map_length` is the length of the data in `COLOR_MAP` (that is, the value
of `CURRENT_COLORMAP_LENGTH`); `last_map_length` is an `&mut` to
`LAST_COLORMAP_LENGTH`, which it sets when it's done.
*/
fn calc_mbrot_itermap(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64,
    buff: &mut [u16; IMAGE_SIZE],
    map_length: usize,
    last_map_length: &mut usize
) {
    // Limit our image size so that we can fit within our static buffer.
    let xpix = if xpix > MAX_WIDTH  { MAX_WIDTH }  else { xpix };
    let ypix = if ypix > MAX_HEIGHT { MAX_HEIGHT } else { ypix };
    
    let xpixf = xpix as f64;
    let ypixf = ypix as f64;
    let height = width * ypixf / xpixf;
    
    let n_shades = map_length as u16;
    
    for yp in 0..ypix {
        let y_val = y - height * ((yp as f64) / ypixf);
        let idx_base: usize = yp * xpix;
        for xp in 0..xpix {
            let x_val = x + width * ((xp as f64) / xpixf);
            let idx = idx_base + xp;
            let n = mandelbrot_iter(x_val, y_val, SQ_MOD_LIMIT, n_shades);
            buff[idx] = n;
        }
    }
    
    *last_map_length = map_length;
}

/**
Like `mandlebrot_iter()`, above, it determines how many iterations of the
polynomial iterator (whose coefficients are given by `coeffs`) it takes for
the given point's squared modulus to exceed `sq_mod_limit`.

The extra two arguments in there are a reference to `COEFFS` (`coeffs`) and
the degree of the polynomial (`degree`, which is one less than the number
of coefficients to use).
*/
fn polynomial_iter(
    x: f64, y: f64,
    coeffs: &[Cx; MAX_COEFFS],
    degree: usize,
    sq_mod_limit: f64,
    iter_limit: u16
) -> u16 {
    let mut cur = Cx { re: x, im: y };
    
    for n in 0..iter_limit {
        let mut new = Cx { re: 0.0, im: 0.0 };
        let mut z   = Cx { re: 1.0, im: 0.0 };
        for m in 0..degree {
            let t = z.mul(&coeffs[m]);
            new = new.add(&t);
            z = z.mul(&cur);
        }
        let t = z.mul(&coeffs[degree]);
        cur = new.add(&t);
        if cur.sqmod() > sq_mod_limit { return n; }
    }
    return iter_limit
}

/**
Like `calc_mbrot_itermap()`, above, but uses the polynomial iterator. The
two extra arguments at the end specify the polynomial:

  * `coeffs` should be a references to `COEFFS`
  * `n_coeffs` should be the values of `N_COEFFS`
*/
fn calc_poly_itermap(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64,
    buff: &mut [u16; IMAGE_SIZE],
    map_length: usize,
    last_map_length: &mut usize,
    coeffs: &[Cx; MAX_COEFFS],
    n_coeffs: usize
) {
    // Limit our image size so that we can fit within our static buffer.
    let xpix = if xpix > MAX_WIDTH  { MAX_WIDTH }  else { xpix };
    let ypix = if ypix > MAX_HEIGHT { MAX_HEIGHT } else { ypix };
    
    // Limit number of polynomial terms to sane amount.
    let degree = if n_coeffs < 1 { return; }    // Stop; this is stupid.
            else if n_coeffs > MAX_COEFFS { MAX_COEFFS-1 }
            else { n_coeffs-1 };
    
    let xpixf = xpix as f64;
    let ypixf = ypix as f64;
    let height = width * ypixf / xpixf;
    
    let n_shades = map_length as u16;
    
    for yp in 0..ypix {
        let y_val = y - height * ((yp as f64) / ypixf);
        let idx_base: usize = yp * xpix;
        for xp in 0..xpix {
            let x_val = x + width * ((xp as f64) / xpixf);
            let idx = idx_base + xp;
            let n = polynomial_iter(
                x_val, y_val,
                coeffs,
                degree,
                SQ_MOD_LIMIT, n_shades
            );
            buff[idx] = n;
        }
    }
    
    *last_map_length = map_length;
}

/**
Exported function to rewrite the `IMAGE` data after having changed the
color gradients via calls to  `set_gradient()` and `set_n_gradients()`.
*/
#[no_mangle]
pub unsafe extern fn recolor(xpix: usize, ypix: usize) {
    color_itermap(
        &ITERMAP, &COLOR_MAP, &mut IMAGE,
        DEFAULT_COLOR, xpix*ypix, CURRENT_COLORMAP_LENGTH
    );
}

/**
Exported function to rewrite the iteration map after changing the view
on the plane or the size of the image. Also calls `color_itermap()` to
rewrite the `IMAGE` data.
  * `xpix` and `ypix`: image dimensions in pixels.
  * `x` and `y`: coordinates of the upper-left-hand corner of the image
  * `width`: the width of the image on the Complex Plaine
  * `use_polynomial_iterator`: if this is `false`, the Mandlebrot iterator
    will be used to create the iteration map; if `true`, the polynomial
    iterator will be used
*/
#[no_mangle]
pub unsafe extern fn redraw(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64,
    use_polynomial_iterator: bool
) {
    if use_polynomial_iterator {
        calc_poly_itermap(
            xpix, ypix, x, y, width,
            &mut ITERMAP, CURRENT_COLORMAP_LENGTH, &mut LAST_COLORMAP_LENGTH,
            &COEFFS, N_COEFFS
        );
    } else {
        calc_mbrot_itermap(
            xpix, ypix, x, y, width,
            &mut ITERMAP, CURRENT_COLORMAP_LENGTH, &mut LAST_COLORMAP_LENGTH
        );
    }
    color_itermap(
        &ITERMAP, &COLOR_MAP, &mut IMAGE,
        DEFAULT_COLOR, xpix*ypix, CURRENT_COLORMAP_LENGTH
    );
}

/* Debugging stuff that isn't necessary once it's been debugged.

extern { fn dbg(c: char); }
fn dbg_msg(msg: &str) {
    for ch in msg.chars() { unsafe { dbg(ch); } }
}
fn dbg_num(n: usize) {
    let mut chz: [usize; 16] = [0usize; 16];
    let mut num = n;
    for i in 0usize..16 {
        let dig = num % 10;
        chz[i] = dig;
        num = num / 10;
    }
    for m in chz.iter().rev() {
        let ch = (*m as u8) + ('0' as u8);
        unsafe { dbg(ch as char); }
    }
}
fn dbg_float(x: f64) {
    let neg = x < 0.0;
    let n = if neg { (-x * 1_000_000.0) as usize }
            else { (x * 1_000_000.0) as usize };
    if neg {
        dbg_msg("f-"); dbg_num(n);
    } else {
        dbg_msg("f+"); dbg_num(n);
    }
}
*/
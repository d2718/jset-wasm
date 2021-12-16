//! lib.rs

const MAX_WIDTH: usize  = 1920;
const MAX_HEIGHT: usize = 1080;
const BUFFER_SIZE: usize = MAX_WIDTH * MAX_HEIGHT;

#[no_mangle]
static mut BUFFER: [u32; BUFFER_SIZE] = [0; BUFFER_SIZE];

fn mandelbrot_iter(
    x: f64, y: f64,
    sq_mod_limit: f64, iter_limit: usize
) -> usize {
    
    let mut cur_x: f64 = 0.0;
    let mut cur_y: f64 = 0.0;
    
    for n in 0..iter_limit {
        let xsq = cur_x * cur_x;
        let ysq = cur_y * cur_y;
        if xsq + ysq > sq_mod_limit { return n; }
        cur_y = (2.0f64 * cur_x * cur_y) + y;
        cur_x = (xsq - ysq) + x;
    }
    return iter_limit;
}

fn color(n: usize) -> u32 {
    let (r, g, b): (u32, u32, u32) = {
        if n < 256       { (0,              0,               n as u32) }
        else if n < 512  { (0,              (n-256) as u32,  255u32) }
        else if n < 768  { (0,              255u32,          (768-n) as u32) }
        else if n < 1024 { ((n-768) as u32, 255u32,          0u32) }
        else if n < 1280 { (255u32,         (1280-n) as u32, 0u32) }
        else if n < 1536 { (255u32,         0u32,            (n-1280) as u32) }
        else             { (0u32,           0u32,            0u32) }   
    };
    let val: u32 = (b << 16) | (g << 8) | r | 0xFF_00_00_00;
    return val
}

#[no_mangle]
pub unsafe extern fn redraw(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64
) {
    // This function is _only_ ever called from Javascript, which is
    // single-threaded, so this `mut` reference to `BUFFER` is the _only_
    // one which will ever exist at one time.
    safe_redraw(xpix, ypix, x, y, width, &mut BUFFER);
}

fn safe_redraw(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64,
    buff: &mut [u32; BUFFER_SIZE]
) {
    // Limit our image size so that we can fit within our static buffer.
    let xpix = if xpix > MAX_WIDTH  { MAX_WIDTH }  else { xpix };
    let ypix = if ypix > MAX_HEIGHT { MAX_HEIGHT } else { ypix };
    
    let xpixf = xpix as f64;
    let ypixf = ypix as f64;
    let height = width * ypixf / xpixf;
    
    for yp in 0..ypix {
        let y_val = y - height * ((yp as f64) / ypixf);
        let idx_base: usize = yp * xpix;
        for xp in 0..xpix {
            let x_val = x + width * ((xp as f64) / xpixf);
            let idx = idx_base + xp;
            let n = mandelbrot_iter(x_val, y_val, 4.0f64, 1536usize);
            let colr = color(n);
            buff[idx] = colr;
        }
    }
}
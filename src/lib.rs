//! lib.rs

#![no_std]

extern { fn pnk(); }

#[panic_handler]
fn handle_panic(_: &core::panic::PanicInfo) -> ! {
    unsafe { pnk(); }
    loop {};
}

const MAX_WIDTH: usize  = 1920;
const MAX_HEIGHT: usize = 1080;
const BUFFER_SIZE: usize = MAX_WIDTH * MAX_HEIGHT;
const COLOR_BUFF_SIZE: usize = 65_536;
const MAX_COLOR_STEPS: usize = 16;

#[no_mangle]
static mut BUFFER:  [u32; BUFFER_SIZE] = [0; BUFFER_SIZE];
static mut ITERMAP: [u16; BUFFER_SIZE] = [0; BUFFER_SIZE];
static mut COLRMAP: [u32; COLOR_BUFF_SIZE] = [0; COLOR_BUFF_SIZE];

// Color map values.
static mut R0: [u8; MAX_COLOR_STEPS] = [  0,   0,   0,   0, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut R1: [u8; MAX_COLOR_STEPS] = [  0,   0,   0, 255, 255, 255,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut G0: [u8; MAX_COLOR_STEPS] = [  0,   0, 255, 255, 255,   0,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut G1: [u8; MAX_COLOR_STEPS] = [  0, 255, 255, 255,   0,   0,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut B0: [u8; MAX_COLOR_STEPS] = [  0, 255, 255,   0,   0,   0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut B1: [u8; MAX_COLOR_STEPS] = [255, 255,   0,   0,   0, 255,   0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut SHADES: [u16; MAX_COLOR_STEPS] = [ 256, 256, 256, 256, 256, 256, 256, 0, 0, 0, 0, 0, 0, 0, 0, 0];
static mut N_STEPS: usize = 7;
static DEFAULT_COLOR: u32 = 0xFF_00_00_00;

fn make_color_map(
    r_starts: &[u8; MAX_COLOR_STEPS],
    r_ends:   &[u8; MAX_COLOR_STEPS],
    g_starts: &[u8; MAX_COLOR_STEPS],
    g_ends:   &[u8; MAX_COLOR_STEPS],
    b_starts: &[u8; MAX_COLOR_STEPS],
    b_ends:   &[u8; MAX_COLOR_STEPS],
    shade_counts: &[u16; MAX_COLOR_STEPS],
    total_steps: usize,
    colors: &mut [u32; COLOR_BUFF_SIZE]
) {
    let mut color_idx: usize = 0;
    for step_n in 0..total_steps {
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
            let col: u32 = (r as u32) | ((g as u32) << 8) | ((b as u32) << 16)
                                      | 0xFF_00_00_00u32;
            colors[color_idx] = col;
            color_idx = color_idx + 1;
        }
    }
    
    // fill the rest of the buffer with zeros
    // the first zero falue will be used as a zigamorph later on
    for n in color_idx..COLOR_BUFF_SIZE {
        colors[n] = 0u32;
    }
}

#[no_mangle]
pub unsafe extern fn set_color_step(
    n: usize,
    r0: u8, g0: u8, b0: u8,
    r1: u8, g1: u8, b1: u8,
    shades: u16
) {
    if n < MAX_COLOR_STEPS {
        R0[n] = r0; R1[n] = r1;
        G0[n] = g0; G1[n] = g1;
        B0[n] = b0; B1[n] = b1;
        SHADES[n] = shades;
    }
}

#[no_mangle]
pub unsafe fn set_n_steps(n: usize) { 
    if n < MAX_COLOR_STEPS { N_STEPS = n; }
}

#[no_mangle]
pub unsafe extern fn update_color_map() {
    // This is only ever called from JS, so `&mut COLRMAP` will only ever
    // exist here when this function is running.
    make_color_map(
        &R0, &R1, &G0, &G1, &B0, &B1,
        &SHADES, N_STEPS as usize,
        &mut COLRMAP
    );
}

fn mandelbrot_iter(
    x: f64, y: f64,
    sq_mod_limit: f64, iter_limit: u16
) -> u16 {
    
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

fn color_itermap(
    itrmap: &[u16; BUFFER_SIZE],
    colormap: &[u32; COLOR_BUFF_SIZE],
    outbuff: &mut [u32; BUFFER_SIZE],
    default_color: u32,
    npix: usize,
) {
    let mut n_shades: usize = 0;
    
    // limit number of iterations
    for n in 0..COLOR_BUFF_SIZE {
        if colormap[n] == 0u32 {
            n_shades = n; break;
        }
    }
    
    for n in 0..npix {
        let col_idx = itrmap[n] as usize;
        if col_idx < n_shades {
            outbuff[n] = colormap[col_idx];
        } else {
            outbuff[n] = default_color;
        }
    }
}

#[no_mangle]
pub unsafe extern fn recolor(xpix: usize, ypix: usize) {
    color_itermap(&ITERMAP, &COLRMAP, &mut BUFFER, DEFAULT_COLOR, xpix*ypix);
}

#[no_mangle]
pub unsafe extern fn redraw(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64
) {
    // This function is _only_ ever called from Javascript, which is
    // single-threaded, so the following `mut` references will always
    // be unique.
    iterate(xpix, ypix, x, y, width, &mut ITERMAP);
    recolor(xpix, ypix);
}

fn iterate(
    xpix: usize, ypix: usize,
    x: f64, y: f64,
    width: f64,
    buff: &mut [u16; BUFFER_SIZE]
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
            let n = mandelbrot_iter(x_val, y_val, 4.0f64, 1792u16);
            buff[idx] = n;
        }
    }
}

//~ extern { fn dbg(c: char); }
//~ fn dbg_msg(msg: &str) {
    //~ for ch in msg.chars() { unsafe { dbg(ch); } }
//~ }
//~ fn dbg_num(n: usize) {
    //~ let mut chz: [usize; 16] = [0usize; 16];
    //~ let mut num = n;
    //~ for i in 0usize..16 {
        //~ let dig = num % 10;
        //~ chz[i] = dig;
        //~ num = num / 10;
    //~ }
    //~ for m in chz.iter().rev() {
        //~ let ch = (*m as u8) + ('0' as u8);
        //~ unsafe { dbg(ch as char); }
    //~ }
//~ }
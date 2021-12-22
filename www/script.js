
"use strict";

const WASM_URI = "jset_web.wasm";

/*
`debug_chars` and `debug_char()` are to allow the wasm module to print debug
information to the console in a way that doesn't involve passing explicit
strings.
*/
let debug_chars = new Array();
function debug_char(c) {
    if (c == 10) {
        console.log(debug_chars.join(""));
        debug_chars = new Array();
    } else {
        debug_chars.push(String.fromCharCode(c));
    }
}

/*
`panique()` gets called by the wasm module if it panics. It _shouldn't_ panic,
but just in case, let's have a clear error signal.
*/
function panique() {
    console.log("WASM module has panicked.");
    const pdiv = document.getElementById("panic-background");
    pdiv.style.zIndex = 10;
    pdiv.style.display = "block";
}

/*
Utility function for explicitly removing all all the DOM nodes beneath
a given element. (To clear it, or in preparation for removing it.)
*/
function recursive_clear(elt) {
    while (elt.firstChild) {
        recursive_clear(elt.lastChild);
        elt.removeChild(elt.lastChild);
    }
}

/*
This variable will hold a reference to the wasm module after `init()`
(see below) has been called.
*/ 
var jswmod = {};

/*
A reference to the main canvas, so we don't have to type
`document.getElementById("demo-canvas")` all the time, and also because it's
clearer and more concises when looking at the code.
*/
const CANVAS = document.getElementById("demo-canvas");

/*
Methods for showing/setting the contents of/hiding a status div, but they
don't seem to work all the time, so IDK.
*/
const STATUS = {
    set: function(txt) {
        const div = document.getElementById("status");
        console.log(`Setting status: "${txt}"`);
        recursive_clear(div);
        div.appendChild(document.createTextNode(txt));
        div.style.display = "inline-block";
    },
    add: function(txt) {
        const div = document.getElementById("status");
        console.log(`Adding status: "${txt}"`);
        div.appendChild(document.createTextNode("\n"));
        div.appendChild(document.createTextNode(txt));
        div.style.display = "inline-block";
    },
    hide: function() {
        const div = document.getElementById("status");
        console.log("hiding status...")
        div.style.display = "none";
    },
};

/*
This is a debugging function to help determine if the contents of the
image buffer in the wasm module have changed. It returns the last three
digits of a checksum of the buffer contents.
*/
function checksum_buffer() {
    const arr = new Uint8ClampedArray(
        jswmod.exports.memory.buffer,
        jswmod.exports.BUFFER.value,
        4 * 1920 * 1080
    );
    
    let csum = 0;
    for (let n of arr) { csum = csum + n; }
    return csum % 1000;
}

/*
Default size/zoom parameters for drawing the image. The `render_image()`
function (below) takes an object of this form as an argument.
*/
const DEFAULT_PARAMS = {
    x_pixels: 1200,     // image width in pixels
    y_pixels: 800,      // image height in pixels
    x: -2.0,            // real coordinate of upper-left-hand corner
    y: 1.0,             // imaginary coordinate of upper-left-hand corner
    width: 3.0,         // width of image on the Complex Plane
    zoom: 2.0,          // default zoom factor
    iter: {             // iteration parameters
        type: "mandlebrot"  // use the mandlebrot iterator by default
    },
};
/*
Zooming/panning and resising the image from the control panel stashes changes
to the image parameters here. These are used by several functions, like
`render_image()`, right below.
*/
let current_params = DEFAULT_PARAMS;

/* Update the CANVAS with the current data in the wasm module's IMAGE buffer. */
function update_canvas(xpix, ypix) {
    CANVAS.width  = xpix;
    CANVAS.height = ypix;
    
    const img_data = new ImageData(
        new Uint8ClampedArray(
            jswmod.exports.memory.buffer,
            jswmod.exports.IMAGE.value,
            4 * xpix * ypix
        ),
        xpix
    );
    CANVAS.getContext("2d").putImageData(img_data, 0, 0);
}

/*
Ask the wasm module to re-iterate and recolor the image with the current
image parameters. Takes an argument with the same structure as the
`DEFAULT_PARAMS` constant, above.
*/
function render_image(params) {
    STATUS.set("Drawing...");
    //console.log(params);
    //console.log(` pre cksum: ${checksum_buffer()}`);

    jswmod.exports.redraw(
        params.x_pixels,
        params.y_pixels,
        params.x,
        params.y,
        params.width,
        (params.iter.type == "polynomial"),
    );
    
    //console.log(`post cksum: ${checksum_buffer()}`);
    
    update_canvas(params.x_pixels, params.y_pixels);
    STATUS.hide();
}

function recolor() {
    STATUS.set("Coloring...");
    const params = current_params;
    //console.log(params);
    //console.log(` pre cksum: ${checksum_buffer()}`);
    COLOR.update_map();
    //console.log(`post cksum: ${checksum_buffer()}`);
    update_canvas(params.x_pixels, params.y_pixels);
    STATUS.hide();
}

/*
Fetch the wasm module and generate an image with the default parameters.
None of the other stuff on the page can really happen until this is called.
*/
async function init() {
    STATUS.set("Loading...");
    WebAssembly.instantiateStreaming(
        fetch(WASM_URI),
        { "env": { 
            "dbg": debug_char,
            "pnk": panique,
        }, }
    )
    .then(function(obj) {
        jswmod = obj.instance;
        jswmod.exports.update_color_map();
        STATUS.hide();
        COLOR.update_map();
        render_image(DEFAULT_PARAMS);
    }).catch(function(err) {
        STATUS.set("Error fetching WASM module; see console.");
        console.log(err);
    });
}

/*
Called when the canvas is clicked, this function returns an object containing
the pixel coordinates of the click and whether the shift or control keys
were down.
*/
function click_details(evt) {
    const p = current_params;
    const crect = CANVAS.getBoundingClientRect();
    const xfrac = (evt.x - crect.left) / crect.width;
    const yfrac = (evt.y - crect.top) / crect.height;
    const height = p.width * p.y_pixels / p.x_pixels;
    
    const newx = p.x + (xfrac * p.width);
    const newy = p.y - (yfrac * height);
    
    return {
        x: newx,
        y: newy,
        shift: evt.shiftKey,
        ctrl:  evt.ctrlKey,
    };
}

/*
Given a `click` object (as returned by `click_details()`, above), this
generates new size/zoom parameters (see `DEFAULT_PARAMS`, above) based on
the location of the click and modifier keys.
  * just a click: recenter the image there
  * shift-click:  recenter and zoom in
  * ctrl-click:   recenter and zoom out
*/
function new_params(click) {
    const p = current_params;
    const height = p.width * p.y_pixels / p.x_pixels;
    let zoom_factor = 1.0;
    if (click.shift) { zoom_factor = p.zoom; }
    else if (click.ctrl) { zoom_factor = 1.0 / p.zoom; }
    
    const new_width = p.width / zoom_factor;
    const new_height = height / zoom_factor;
    const newx = click.x - (new_width / 2);
    const newy = click.y + (new_height / 2);
    
    const np = {
        x_pixels: p.x_pixels,
        y_pixels: p.y_pixels,
        x: newx,
        y: newy,
        width: new_width,
        zoom: p.zoom,
        iter: p.iter,
    };
    
    current_params = np;
    return np;
}

CANVAS.onclick = function(evt) {
    const click = click_details(evt);
    const new_p = new_params(click);
    render_image(new_p);
};

/**
Shift- and control- clicking on mobile is tough, so for now there is this
hack of zoom in/out buttons that fire this function.
*/
function mobile_zoom(zoom_in) {
    const p = current_params;
    const height = p.width * p.y_pixels / p.x_pixels;
    let new_x, new_y, new_width;
    if (zoom_in) {
        const frac = (1 - (1/p.zoom)) / 2;
        new_x = p.x + frac * p.width;
        new_y = p.y - frac * height;
        new_width = p.width / p.zoom;
    } else {
        const frac = (p.zoom - 1) / 2;
        new_x = p.x - frac * p.width;
        new_y = p.y + frac * height;
        new_width = p.width * p.zoom;
    }
    
    const new_params = {
        x_pixels: p.x_pixels,
        y_pixels: p.y_pixels,
        x: new_x,
        y: new_y,
        width: new_width,
        zoom: p.zoom,
        iter: p.iter,
    };
    
    current_params = new_params;
    render_image(new_params);
}
// And we add the function to the buttons.
document.getElementById("m-zoom-in").onclick = function(evt) {
    evt.preventDefault();
    mobile_zoom(true);
}
document.getElementById("m-zoom-out").onclick = function(evt) {
    evt.preventDefault();
    mobile_zoom(false);
}

// Color Map

const COLOR = {
    MAX_STEPS:  16,
    MAX_SHADES: 65535-1,
    tbody:  document.querySelector("div#color-map table tbody"),
    add:    document.getElementById("add-color"),
    hexre:  /[0-9a-fA-F][0-9a-fA-F]/g,
    defaults: [
        ["#000000", 128, "#ffffff"],
        ["#ffffff", 256, "#000000"],
    ],
};
COLOR.to_rgb = function(s) {
    return Array.from(s.matchAll(COLOR.hexre), m => parseInt(m, 16));
};
COLOR.get_params = function() {
    const froms = Array.from(
        COLOR.tbody.querySelectorAll("input.from"),
        ipt => COLOR.to_rgb(ipt.value)
    );
    const tos = Array.from(
        COLOR.tbody.querySelectorAll("input.to"),
        ipt => COLOR.to_rgb(ipt.value)
    );
    const steps = Array.from(
        COLOR.tbody.querySelectorAll('input[type="number"]'),
        function(ipt) { 
            const n = parseInt(ipt.value, 10);
            if (n > 255) { return 255; }
            else if (n < 0) { return 0; }
            else { return n; }
        }
    );
    
    const new_params = {
        r_starts: new Array(),
        g_starts: new Array(),
        b_starts: new Array(),
        r_ends:   new Array(),
        g_ends:   new Array(),
        b_ends:   new Array(),
        n_steps:  steps.length,
        shades:   steps,
    };
    
    for (const rgb of froms) {
        new_params.r_starts.push(rgb[0]);
        new_params.g_starts.push(rgb[1]);
        new_params.b_starts.push(rgb[2]);
    }
    for (const rgb of tos) {
        new_params.r_ends.push(rgb[0]);
        new_params.g_ends.push(rgb[1]);
        new_params.b_ends.push(rgb[2]);
    }
    
    return new_params;
}

COLOR.update_map = function() {
    const p = COLOR.get_params();
    
    if (p.n_steps > COLOR.MAX_STEPS) {
        console.log("Too many steps in color map.");
        return null;
    }
    const total_shades = p.shades.reduce((tot, x) => tot+x);
    if (total_shades > COLOR.MAX_SHADES) {
        console.log("Too many shades in color map.");
        return null;
    }
    
    for (let n = 0; n < p.n_steps; n++) {
        jswmod.exports.set_gradient(n,
            p.r_starts[n], p.g_starts[n], p.b_starts[n],
            p.r_ends[n], p.g_ends[n], p.b_ends[n],
            p.shades[n]
        );
    }
    jswmod.exports.set_n_gradients(p.n_steps);
    jswmod.exports.update_color_map();
    const iparms = current_params;
    jswmod.exports.recolor(iparms.x_pixels, iparms.y_pixels);
}

function add_gradient(start, steps, end) {
    const tr = document.createElement("tr");
    
    const std = document.createElement("td");
    const sipt = document.createElement("input");
    sipt.type = "color";
    sipt.setAttribute("class", "from");
    if (start) { sipt.value = start; }
    else { sipt.value = "#000000"; }
    std.appendChild(sipt);
    tr.appendChild(std);
    
    const ntd = document.createElement("td");
    const nipt = document.createElement("input");
    nipt.type = "number";
    nipt.setAttribute("min", "0");
    nipt.setAttribute("max", "65535");
    if (steps) { nipt.value = steps; }
    else { nipt.value = 1; }
    ntd.appendChild(nipt);
    tr.appendChild(ntd);
    
    const etd = document.createElement("td");
    const eipt = document.createElement("input");
    eipt.type = "color";
    eipt.setAttribute("class", "to");
    if (end) { eipt.value = end; }
    else { eipt.value = "#000000"; }
    etd.appendChild(eipt);
    tr.appendChild(etd);
    
    const dtd = document.createElement("td");
    const dbutt = document.createElement("button");
    dbutt.type = "button";
    dbutt.appendChild(document.createTextNode("[x]"));
    dbutt.title = "remove this color gradient";
    dbutt.setAttribute("class", "remove-gradient");
    dbutt.onclick = function() {
        recursive_clear(tr);
        tr.parentElement.removeChild(tr);
    }
    dtd.appendChild(dbutt);
    tr.appendChild(dtd);
    
    COLOR.tbody.appendChild(tr);
}

// Set initial color parameter defaults.
for (const tup of COLOR.defaults) {
    add_gradient(tup[0], tup[1], tup[2]);
}
COLOR.current_params = COLOR.get_params();
console.log(COLOR.current_params);

COLOR.add.onclick = function(evt) { 
    evt.preventDefault();
    let new_color = "#000000";
    const tos = document.querySelectorAll("input.to");
    if(tos.length > 0) {
        new_color = tos[tos.length-1].value;
    }
    add_gradient(new_color, 256, "#000000");
}

// Iteration Parametrization

const ITER = {
    select_form: document.getElementById("iter-type"),
    param_form:  document.getElementById("poly-params"),
    param_div:   document.getElementById("polynomial"),
    rvals: document.querySelectorAll("input.r"),
    tvals: document.querySelectorAll("input.t"),
};

// Show/hide polynomial parameters or iterator selection.
function switch_iter_type() {
    const data = new FormData(ITER.select_form);
    if (data.get("iter-pick") == "mandlebrot") {
        ITER.param_div.style.display = "none";
    } else {
        ITER.param_div.style.display = "flex";
    }
}
for (let rbutt of document.querySelectorAll('input[name="iter-pick"]')) {
    rbutt.onclick = switch_iter_type;
}

// Disable higher-order coefficient inputs on polynomial degree selection.
function enable_poly_inputs() {
    const data = new FormData(ITER.param_form);
    const n_coeffs = Number(data.get("ncoeff"));
    const len = ITER.rvals.length;
    for (let n = 0; n < n_coeffs; n++) {
        ITER.rvals[n].disabled = false;
        ITER.tvals[n].disabled = false;
    }
    for (let n = n_coeffs; n < len; n++) {
        ITER.rvals[n].disabled = true;
        ITER.tvals[n].disabled = true;
    }
}
for (let rbutt of document.querySelectorAll('input[name="ncoeff"]')) {
    rbutt.onclick = enable_poly_inputs;
}
// Set polynomial inputs to match default selection.
enable_poly_inputs();

ITER.get_params = function() {
    const type_data = new FormData(ITER.select_form);
    const iter_type = type_data.get("iter-pick");
    
    if (iter_type == "mandlebrot") { return { type: "mandlebrot" }; }
    
    const parm_data = new FormData(ITER.param_form);
    const n_coeffs = Number(parm_data.get("ncoeff"));
    
    const re = new Array();
    const im = new Array();
    for (let n = 0; n < n_coeffs; n++) {
        const r = Number(ITER.rvals[n].value);
        const pi_t = Number(ITER.tvals[n].value) * Math.PI;
        re.push(r * Math.cos(pi_t));
        im.push(r * Math.sin(pi_t));
    }
    
    return {
        type: "polynomial",
        n: n_coeffs,
        re: re,
        im: im,
    };
}

ITER.set_params = function(p) {
    if (p.type == "mandlebrot") { return; }
    
    for (let n = 0; n < p.n; n++) {
        jswmod.exports.set_coeff(n, p.re[n], p.im[n]);
    }
    jswmod.exports.set_n_coeffs(p.n);
}

// Control panel elements and resizing functionality.

const CONTROL = {
    div:     document.getElementById("control"),
    open:    document.getElementById("control-open"),
    close:   document.getElementById("control-close"),
    width:   document.getElementById("ixpix"),
    height:  document.getElementById("iypix"),
    outline: document.getElementById("canvas-outline"),
    zoom_bar: document.getElementById("izbar"),
    zoom_num: document.getElementById("iznum"),
    /*  The size we've set the canvas to by adjusting the values of
        `CONTROL.width` and `CONTROL.height`. */
    new_x:   DEFAULT_PARAMS.x_pixels,
    new_y:   DEFAULT_PARAMS.y_pixels,
};

/**
Function to shows a guide outline over the current image when the image
size controls' values are changed.
*/
function resize_canvas_box() {
    const crect = CANVAS.getBoundingClientRect();
    const outline = CONTROL.outline;
    outline.style.top = crect.top + "px";
    outline.style.left = crect.left + "px";
    outline.style.width = CONTROL.width.value + "px";
    outline.style.height = CONTROL.height.value + "px";
    outline.style.display = "inline-block";
    CONTROL.new_x = parseInt(CONTROL.width.value);
    CONTROL.new_y = parseInt(CONTROL.height.value);
}

function set_zoom(evt) {
    console.log(evt);
    const new_z = Number(evt.target.value);
    if (new_z) {
        current_params.zoom = new_z;
        if (CONTROL.zoom_bar == evt.target) {
            CONTROL.zoom_num.value = new_z;
        } else {
            CONTROL.zoom_bar.value = new_z;
        }
    }
}
CONTROL.zoom_bar.addEventListener("input", set_zoom);
CONTROL.zoom_num.addEventListener("input", set_zoom);

CONTROL.open.onclick = function(evt) {
    evt.preventDefault();
    CONTROL.width.value = CANVAS.width;
    CONTROL.height.value = CANVAS.height;
    CONTROL.div.style.display = "inline-flex";
};
CONTROL.close.onclick = function(evt) {
    evt.preventDefault();
    CONTROL.div.style.display = "none";
    // Ensure we hide the guide outline if it's showing.
    CONTROL.outline.style.display = "none";
    const iter_params = ITER.get_params();
    console.log(iter_params);
    ITER.set_params(iter_params);
    
    // Check to see if we should re-render the image.
    let re_render = false;
    // yes, if the size of the image has changed...
    if ((CONTROL.new_x != current_params.x_pixels)
        || (CONTROL.new_y != current_params.y_pixels))
    { re_render = true; }
    // of if any of the iterations parameters have changed
    for (let k in iter_params) {
        if (iter_params.hasOwnProperty(k)) {
            if (iter_params[k] != current_params.iter[k]) {
                re_render = true;
                break;
            }
        }
    }
    
    if (re_render) {
        COLOR.update_map();
        current_params.x_pixels = CONTROL.new_x;
        current_params.y_pixels = CONTROL.new_y;
        current_params.iter = iter_params;
        render_image(current_params);
    // Otherwise just recolor the image automatically, even if the color map
    // hasn't changed, because this is cheap.
    } else {
        recolor();
    }
};
CONTROL.width.addEventListener("input", resize_canvas_box);
CONTROL.height.addEventListener("input", resize_canvas_box);

// Help

const HELP = {
    div:    document.getElementById("help"),
    open:   document.getElementById("help-open"),
    close:  document.getElementById("help-close"),
};
HELP.open.onclick = function() {
    HELP.div.style.display = "inline-block";
}
HELP.close.onclick = function() {
    HELP.div.style.display = "none";
}

init();
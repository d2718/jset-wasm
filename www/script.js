
"use strict";

const WASM_URI = "jset_web.wasm";

let debug_chars = new Array();
function debug_char(c) {
    if (c == 10) {
        console.log(debug_chars.join(""));
        debug_chars = new Array();
    } else {
        debug_chars.push(String.fromCharCode(c));
    }
}

function panique() {
    console.log("WASM module has panicked.");
}

function recursive_clear(elt) {
    while (elt.firstChild) {
        recursive_clear(elt.lastChild);
        elt.removeChild(elt.lastChild);
    }
}

var jswmod = {};
const CANVAS = document.getElementById("demo-canvas");
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

function dbg(txt) {
    let dd = document.getElementById("dbg");
    dd.innerHTML = txt;
}

const DEFAULT_PARAMS = {
    x_pixels: 1200,
    y_pixels: 800,
    x: -2.0,
    y: 1.0,
    width: 3.0
};
let current_params = DEFAULT_PARAMS;

function render_image(params) {
    STATUS.set("Drawing...");
    //console.log(params);
    
    CANVAS.width = params.x_pixels;
    CANVAS.height = params.y_pixels;
    
    //console.log(` pre cksum: ${checksum_buffer()}`);

    jswmod.exports.redraw(
        params.x_pixels,
        params.y_pixels,
        params.x,
        params.y,
        params.width
    );
    
    //console.log(`post cksum: ${checksum_buffer()}`);
    
    const img_data = new ImageData(
        new Uint8ClampedArray(
            jswmod.exports.memory.buffer,
            jswmod.exports.BUFFER.value,
            4 * params.x_pixels * params.y_pixels,
        ),
        params.x_pixels,
    );
    
    const ctx = CANVAS.getContext("2d");
    ctx.putImageData(img_data, 0, 0);
    STATUS.hide();
}

function recolor(color_params) {
    STATUS.set("Coloring...");
    const params = current_params;
    //console.log(params);
    
    //console.log(` pre cksum: ${checksum_buffer()}`);
    
    COLOR.update_map(color_params);

    //console.log(`post cksum: ${checksum_buffer()}`);
    
    const img_data = new ImageData(
        new Uint8ClampedArray(
            jswmod.exports.memory.buffer,
            jswmod.exports.BUFFER.value,
            4 * params.x_pixels * params.y_pixels,
        ),
        params.x_pixels,
    );
    
    const ctx = CANVAS.getContext("2d");
    ctx.putImageData(img_data, 0, 0);
    STATUS.hide();
}

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
        COLOR.update_map(COLOR.current_params);
        render_image(DEFAULT_PARAMS);
    }).catch(function(err) {
        STATUS.set("Error fetching WASM module; see console.");
        console.log(err);
    });
}

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

function new_params(click) {
    const p = current_params;
    const height = p.width * p.y_pixels / p.x_pixels;
    let zoom_factor = 1.0;
    if (click.shift) { zoom_factor = 2.0; }
    else if (click.ctrl) { zoom_factor = 0.5; }
    
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
    };
    
    current_params = np;
    return np;
}

CANVAS.onclick = function(evt) {
    const click = click_details(evt);
    const new_p = new_params(click);
    render_image(new_p);
};

// Canvas Control

const CONTROL = {
    div:     document.getElementById("control"),
    open:    document.getElementById("control-open"),
    close:   document.getElementById("control-close"),
    width:   document.getElementById("ixpix"),
    height:  document.getElementById("iypix"),
    outline: document.getElementById("canvas-outline"),
    new_x:   DEFAULT_PARAMS.x_pixels,
    new_y:   DEFAULT_PARAMS.y_pixels,
};

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

CONTROL.open.onclick = function(evt) {
    evt.preventDefault();
    CONTROL.width.value = CANVAS.width;
    CONTROL.height.value = CANVAS.height;
    CONTROL.div.style.display = "inline-flex";
};
CONTROL.close.onclick = function(evt) {
    evt.preventDefault();
    CONTROL.div.style.display = "none";
    CONTROL.outline.style.display = "none";
    recolor(COLOR.get_params());
    if ((CONTROL.new_x != current_params.x_pixels)
        || (CONTROL.new_y != current_params.y_pixels))
    {
        current_params.x_pixels = CONTROL.new_x;
        current_params.y_pixels = CONTROL.new_y;
        render_image(current_params);
    }
};
CONTROL.width.addEventListener("input", resize_canvas_box);
CONTROL.height.addEventListener("input", resize_canvas_box);

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

COLOR.update_map = function(p) {
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
        jswmod.exports.set_color_step(n,
            p.r_starts[n], p.g_starts[n], p.b_starts[n],
            p.r_ends[n], p.g_ends[n], p.b_ends[n],
            p.shades[n]
        );
    }
    jswmod.exports.set_n_steps(p.n_steps);
    jswmod.exports.update_color_map();
    const iparms = current_params;
    jswmod.exports.recolor(iparms.x_pixels, iparms.y_pixels);
}

function add_color_step(start, steps, end) {
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
    add_color_step(tup[0], tup[1], tup[2]);
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
    add_color_step(new_color, 256, "#000000");
}

init();
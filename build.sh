#!/bin/bash

set -euo pipefail

TARGET=wasm32-unknown-unknown
BINARY=target/$TARGET/release/jset_web.wasm
OUTPUT=www/jset_web.wasm

cargo build --target $TARGET --release

wasm-snip --snip-rust-fmt-code --snip-rust-panicking-code \
	  -o $BINARY $BINARY

wasm-strip $BINARY
wasm-opt -o $OUTPUT -Oz $BINARY
ls -l $OUTPUT

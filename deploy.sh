#!/bin/bash

TARGET=d2718.net:~/wr/jset/

scp www/index.html $TARGET
scp www/jset_web.wasm $TARGET
scp www/script.js $TARGET
scp www/style.css $TARGET

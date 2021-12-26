#!/bin/bash

TARGET=d2718.net:~/wr/jset/

curl -X POST --data-urlencode 'input@www/script.js' \
     https://www.toptal.com/developers/javascript-minifier/raw > www/min.js

curl -X POST --data-urlencode 'input@www/style.css' \
    https://www.toptal.com/developers/cssminifier/raw > www/min.css

scp www/index.html $TARGET
scp www/jset_web.wasm $TARGET
scp www/icomoon.woff $TARGET
scp www/min.js $TARGET/script.js
rm www/min.js
scp www/min.css $TARGET/style.css
rm www/min.css

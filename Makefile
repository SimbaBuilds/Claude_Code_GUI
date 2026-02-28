.PHONY: run-gui gui build build-css install dev

BUN := ~/.bun/bin/bun

run-gui:
	$(BUN) run src/server/index.ts

gui: run-gui

dev:
	$(BUN) run --watch src/server/index.ts

build:
	$(BUN) build src/client/main.tsx --outdir dist/client --minify

build-css:
	$(BUN)x @tailwindcss/cli -i src/client/styles/globals.css -o dist/client/styles/globals.css

install:
	$(BUN) install

all: install build build-css
